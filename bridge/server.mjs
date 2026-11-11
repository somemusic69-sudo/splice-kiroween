import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { applyPatch, checkoutSnapshot, extractDiff, preparePatch } from './git.mjs';
import { diagnose } from './kiro.mjs';
import { spawnTerminal } from './terminal.mjs';

const TOKEN = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const SSH_ALIAS = /^[a-z0-9][a-z0-9_.-]{0,127}$/i;
const SESSION_MS = 8 * 60 * 60 * 1000;
const PATCH_MS = 30 * 60 * 1000;
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const contentTypes = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', wasm: 'application/wasm' };
const fail = (status, message) => Object.assign(new Error(message), { status });

export function validateConfig(config) {
  const targets = new Map();
  const checkouts = new Map();
  for (const target of config.targets ?? []) {
    if (!ID.test(target.id ?? '') || !SSH_ALIAS.test(target.alias ?? '') || targets.has(target.id)) {
      throw new Error('Invalid or duplicate SSH target in splice.local.json.');
    }
    targets.set(target.id, { ...target, label: target.label ?? target.alias });
  }
  for (const checkout of config.checkouts ?? []) {
    if (!ID.test(checkout.id ?? '') || typeof checkout.path !== 'string' || !isAbsolute(checkout.path)
        || !Array.isArray(checkout.agentFiles) || !checkout.agentFiles.length || checkout.agentFiles.length > 32
        || checkout.agentFiles.some((path) => typeof path !== 'string') || checkouts.has(checkout.id)) {
      throw new Error('Invalid or duplicate Git checkout in splice.local.json.');
    }
    checkouts.set(checkout.id, { ...checkout, label: checkout.label ?? checkout.id });
  }
  for (const key of ['sshConfig', 'kiroExecutable']) {
    const path = config[key];
    if (path !== undefined && (typeof path !== 'string' || !isAbsolute(path))) {
      throw new Error(`Use an absolute path for ${key} in splice.local.json.`);
    }
  }
  return { targets, checkouts, sshConfig: config.sshConfig, kiroExecutable: config.kiroExecutable };
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function body(req) {
  if (req.headers['content-type'] !== 'application/json') throw fail(415, 'Expected JSON.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 100_000) {
      req.resume();
      throw fail(413, 'Request is too large.');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks));
  } catch {
    throw fail(400, 'Invalid JSON.');
  }
}

function dimensions(cols, rows) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > 500 || rows > 250) {
    throw new Error('Terminal dimensions are out of range.');
  }
  return { cols, rows };
}

export function createBridge(config, { pty = spawnTerminal, runAgent = diagnose, sessionMs = SESSION_MS } = {}) {
  const { targets, checkouts, sshConfig, kiroExecutable } = validateConfig(config);
  const patches = new Map();
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  let launchKey = randomBytes(32).toString('hex');
  let browserSession;
  let activeAgent;
  let applying = false;
  let terminals = 0;

  const authority = () => '127.0.0.1:' + server.address().port;
  const origin = () => 'http://' + authority();

  function sameOrigin(req) {
    return req.headers.origin === origin()
      || (req.method === 'GET' && !req.headers.origin && req.headers['sec-fetch-site'] === 'same-origin');
  }

  function sessionValid(req) {
    const session = /(?:^|;\s*)splice_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
    return !!session && !!browserSession && browserSession.until > Date.now()
      && timingSafeEqual(Buffer.from(session), Buffer.from(browserSession.token));
  }

  async function agent(res, { checkout, excerpt, question }) {
    const project = checkouts.get(checkout);
    if (!project || typeof excerpt !== 'string' || !excerpt.trim() || excerpt.length > 16_000
        || typeof question !== 'string' || question.length > 1000) {
      throw fail(400, 'Select a checkout and provide a reviewed excerpt.');
    }
    if (activeAgent) throw fail(409, 'An incident agent is already running.');
    const controller = new AbortController();
    activeAgent = controller;
    const abort = () => controller.abort(new Error('Browser disconnected.'));
    res.once('close', abort);
    const expiry = setTimeout(abort, Math.max(0, browserSession.until - Date.now()));
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
    res.flushHeaders();
    const emit = (event) => {
      if (!controller.signal.aborted) res.write(JSON.stringify(event) + '\n');
    };
    try {
      const snapshot = await checkoutSnapshot(project);
      const answer = await runAgent({ snapshot, excerpt, question, signal: controller.signal, emit, executable: kiroExecutable });
      controller.signal.throwIfAborted();
      const diff = extractDiff(answer);
      if (diff) {
        const patch = await preparePatch(snapshot, diff);
        controller.signal.throwIfAborted();
        for (const [id, existing] of patches) if (existing.until < Date.now()) patches.delete(id);
        if (patches.size >= 12) patches.delete(patches.keys().next().value);
        patches.set(patch.id, { ...patch, until: Date.now() + PATCH_MS });
        emit({ type: 'patch', patch: { id: patch.id, files: patch.files, diff: patch.diff } });
      }
      emit({ type: 'status', text: diff ? 'Patch ready for review.' : 'Diagnosis ready. Kiro returned no unified diff.' });
    } catch (error) {
      emit({ type: 'error', text: error.message });
    } finally {
      clearTimeout(expiry);
      activeAgent = undefined;
      res.removeListener('close', abort);
      res.end();
    }
  }

  async function route(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self'; connect-src 'self' ws://" + authority() + "; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (req.headers.host !== authority()) throw fail(403, 'Invalid loopback host.');
    const { pathname } = new URL(req.url, origin());
    if (!pathname.startsWith('/api/')) {
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (req.method !== 'GET' || !/^(?:index\.html|setup\.html|assets\/[\w.-]+\.(?:js|css|wasm))$/.test(file)) {
        throw fail(404, 'Page not found.');
      }
      const ext = file.split('.').at(-1);
      let data = await readFile(join(dist, file)).catch(() => { throw fail(404, 'Build Splice with npm run build:wasm and npm run build.'); });
      if (file === 'index.html') {
        data = data.toString().replace('<head>', '<head><meta name="splice-local" content="1">');
      }
      res.writeHead(200, { 'Content-Type': contentTypes[ext] });
      res.end(data);
      return;
    }
    if (!sameOrigin(req)) throw fail(403, 'This request must come from the local cockpit.');
    if (pathname === '/api/session' && req.method === 'POST') {
      const { key } = (await body(req)) ?? {};
      if (!launchKey || typeof key !== 'string' || !TOKEN.test(key)
          || !timingSafeEqual(Buffer.from(key), Buffer.from(launchKey))) {
        throw fail(401, 'Launch link expired. Restart Splice for a fresh link.');
      }
      launchKey = undefined;
      browserSession = { token: randomBytes(32).toString('hex'), until: Date.now() + sessionMs };
      res.setHeader('Set-Cookie', `splice_session=${browserSession.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.ceil(sessionMs / 1000)}`);
      json(res, 200, { ok: true });
      return;
    }
    if (!sessionValid(req)) throw fail(401, 'Local session expired. Restart Splice and use the launch link.');
    if (pathname === '/api/config' && req.method === 'GET') {
      json(res, 200, {
        targets: [...targets.values()].map(({ id, label }) => ({ id, label })),
        checkouts: [...checkouts.values()].map(({ id, label, agentFiles }) => ({ id, label, agentFiles })),
      });
      return;
    }
    if (req.method !== 'POST' || !['/api/agent', '/api/apply', '/api/discard'].includes(pathname)) {
      throw fail(404, 'Unknown endpoint.');
    }
    const payload = (await body(req)) ?? {};
    if (!sessionValid(req)) throw fail(401, 'Local session expired.');
    if (pathname === '/api/agent') {
      await agent(res, payload);
      return;
    }
    const patch = patches.get(payload.id);
    if (!patch || patch.until < Date.now()) throw fail(404, 'Patch expired or was discarded.');
    if (applying) throw fail(409, 'A patch is being applied.');
    if (pathname === '/api/apply') {
      applying = true;
      try {
        await applyPatch(patch);
      } catch (error) {
        throw fail(409, error.message);
      } finally {
        applying = false;
      }
    }
    patches.delete(payload.id);
    json(res, 200, { ok: true });
  }

  const server = createServer((req, res) => {
    route(req, res).catch((error) => {
      if (!res.headersSent) json(res, error.status ?? 500, { error: error.status ? error.message : 'Local bridge request failed.' });
      else res.end();
    });
  });

  server.on('upgrade', (req, socket, head) => {
    if (req.headers.host !== authority() || req.headers.origin !== origin()
        || !sessionValid(req) || !req.url.startsWith('/terminal?') || terminals >= 4) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      terminals++;
      ws.once('close', () => { terminals--; });
      void connectTerminal(ws, new URL(req.url, origin()).searchParams);
    });
  });

  async function connectTerminal(ws, params) {
    const send = (data) => {
      if (ws.readyState !== 1) return;
      if (ws.bufferedAmount > 2 * 1024 * 1024) ws.close(1013, 'Terminal output backlog');
      else ws.send(JSON.stringify(data));
    };
    let terminal;
    const expiry = setTimeout(() => ws.close(1008, 'Local session expired'), Math.max(0, browserSession.until - Date.now()));
    ws.on('error', () => ws.terminate());
    ws.once('close', () => {
      clearTimeout(expiry);
      terminal?.kill();
      terminal = undefined;
    });
    try {
      const size = dimensions(Number(params.get('cols')), Number(params.get('rows')));
      let cwd = process.cwd();
      let executable;
      let args;
      if (params.get('kind') === 'ssh') {
        const target = targets.get(params.get('target'));
        const session = params.get('tmux');
        if (!target || !ID.test(session ?? '')) throw new Error('Choose a configured SSH alias and a valid tmux session name.');
        executable = 'ssh.exe';
        args = ['-tt', '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes',
          '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', target.alias, 'tmux', 'new-session', '-A', '-s', session];
        if (sshConfig) args.unshift('-F', sshConfig);
      } else if (params.get('kind') === 'shell') {
        const checkout = checkouts.get(params.get('checkout'));
        if (!checkout) throw new Error('Choose a configured Git checkout in the Kiro tab.');
        cwd = await realpath(checkout.path);
        executable = 'powershell.exe';
        args = ['-NoLogo', '-NoProfile'];
      } else {
        throw new Error('Unknown terminal type.');
      }
      if (ws.readyState !== 1) return;
      terminal = pty(executable, args, { ...size, cwd, name: 'xterm-256color' });
      terminal.onData((data) => send({ type: 'output', data }));
      terminal.onExit(({ exitCode }) => {
        terminal = undefined;
        send({ type: 'exit', code: exitCode });
        ws.close();
      });
      ws.on('message', (raw, binary) => {
        try {
          if (binary || !terminal) return;
          const message = JSON.parse(raw.toString());
          if (message.type === 'input' && typeof message.data === 'string') terminal.write(message.data);
          if (message.type === 'resize') {
            const { cols, rows } = dimensions(message.cols, message.rows);
            terminal.resize(cols, rows);
          }
        } catch {
          ws.close(1008, 'Invalid terminal message');
        }
      });
      send({ type: 'ready' });
    } catch (error) {
      send({ type: 'error', message: error.message });
      ws.close();
    }
  }

  return { server, launchUrl: () => origin() + '/#' + launchKey };
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => '') === await realpath(fileURLToPath(import.meta.url))) {
  const configFile = process.env.SPLICE_CONFIG ?? 'splice.local.json';
  const config = await readFile(configFile, 'utf8').then((text) => JSON.parse(text.replace(/^\uFEFF/, ''))).catch((error) => {
    if (error.code === 'ENOENT') return {};
    throw error;
  });
  const bridge = createBridge(config);
  bridge.server.listen(Number(process.env.SPLICE_PORT ?? 49371), '127.0.0.1', () => {
    console.log('Open this single-use launch link in your browser:\n' + bridge.launchUrl());
  });
}
