import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { createBridge } from '../bridge/server.mjs';
import { applyPatch, checkoutSnapshot, git, preparePatch } from '../bridge/git.mjs';

const before = 'export const delay = (seconds) => seconds;\n';
const after = 'export const delay = (seconds) => seconds * 1000;\n';
const diff = [
  'diff --git a/retry.mjs b/retry.mjs', '--- a/retry.mjs', '+++ b/retry.mjs',
  '@@ -1 +1 @@', '-' + before.trimEnd(), '+' + after.trimEnd(), '',
].join('\n');

async function checkout(t) {
  const path = await mkdtemp(join(tmpdir(), 'splice-test-'));
  t.after(() => rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }));
  await writeFile(join(path, 'retry.mjs'), before);
  await writeFile(join(path, 'outside.mjs'), before);
  await git(path, ['init', '-q']);
  await git(path, ['config', 'core.autocrlf', 'false']);
  await git(path, ['add', '.']);
  await git(path, ['-c', 'user.name=Splice Test', '-c', 'user.email=splice@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
  return { path, id: 'worker', agentFiles: ['retry.mjs'] };
}

test('prepares and applies reviewed edits, rejecting stale and unlisted files', async (t) => {
  const repo = await checkout(t);
  const path = join(repo.path, 'retry.mjs');
  const snapshot = await checkoutSnapshot(repo);
  await assert.rejects(preparePatch(snapshot, diff.replaceAll('retry.mjs', 'outside.mjs')), /outside the configured/);
  await assert.rejects(preparePatch(snapshot, diff.replace('--- a/', 'new mode 100755\n--- a/')), /Only text edits/);
  const patch = await preparePatch(snapshot, diff);
  assert.deepEqual(patch.files, ['retry.mjs']);
  assert.equal(await readFile(path, 'utf8'), before);
  await writeFile(path, before + '// operator change\n');
  await assert.rejects(applyPatch(patch), /reviewed file changed/);
  await writeFile(path, before);
  await applyPatch(patch);
  assert.equal(await readFile(path, 'utf8'), after);
});

async function launch(t, config, options) {
  const bridge = createBridge(config, options);
  bridge.server.listen(0, '127.0.0.1');
  await once(bridge.server, 'listening');
  t.after(() => new Promise((resolve) => bridge.server.close(resolve)));
  const url = new URL(bridge.launchUrl());
  const origin = url.origin;
  const post = (path, data, cookie, from = origin) => fetch(origin + '/api/' + path, {
    method: 'POST',
    headers: { Origin: from, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(data),
  });
  const unlock = () => post('session', { key: url.hash.slice(1) });
  return { origin, post, unlock };
}

test('enforces origin, launch key and expiry', async (t) => {
  const { origin, post, unlock } = await launch(t, {}, { sessionMs: 600 });
  assert.equal((await post('session', {}, '', 'https://example.invalid')).status, 403);
  const response = await unlock();
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await unlock()).status, 401);
  const config = () => fetch(origin + '/api/config', { headers: { 'Sec-Fetch-Site': 'same-origin', Cookie: cookie } });
  assert.equal((await config()).status, 200);
  await delay(620);
  assert.equal((await config()).status, 401);
});

test('streams diagnosis, and discarding preserves the checkout', async (t) => {
  const repo = await checkout(t);
  const { post, unlock } = await launch(t, { checkouts: [repo] }, {
    runAgent: async ({ snapshot, excerpt, emit }) => {
      assert.equal(excerpt, 'ERROR retry too soon');
      assert.deepEqual([...snapshot.source.keys()], ['retry.mjs']);
      emit({ type: 'text', text: 'The units differ.' });
      return 'The units differ.\n```diff\n' + diff + '```\n';
    },
  });
  const cookie = (await unlock()).headers.get('set-cookie').split(';')[0];
  const response = await post('agent', { checkout: 'worker', excerpt: 'ERROR retry too soon', question: 'What happened?' }, cookie);
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events[0].text, 'The units differ.');
  const id = events.find((event) => event.type === 'patch').patch.id;
  assert.equal((await post('discard', { id }, cookie)).status, 200);
  assert.equal((await post('apply', { id }, cookie)).status, 404);
  assert.equal(await readFile(join(repo.path, 'retry.mjs'), 'utf8'), before);
});

test('connects an authenticated terminal, forwards input and preserves the tmux name', async (t) => {
  const events = new EventEmitter();
  let args;
  const { origin, unlock } = await launch(t, { targets: [{ id: 'host', alias: 'fixture' }] }, {
    pty: (_program, options) => {
      args = options;
      return {
        onData: (callback) => events.on('output', callback),
        onExit: (callback) => events.on('exit', callback),
        write: (data) => events.emit('input', data),
        resize: (cols, rows) => events.emit('resize', cols, rows),
        kill: () => events.removeAllListeners('output'),
      };
    },
  });
  const cookie = (await unlock()).headers.get('set-cookie').split(';')[0];
  const url = origin.replace('http:', 'ws:') + '/terminal?kind=ssh&target=host&tmux=incident&cols=80&rows=25';
  const rejected = new WebSocket(url, { origin: 'https://example.invalid', headers: { Cookie: cookie } });
  assert.match(String((await once(rejected, 'error'))[0]), /403/);
  for (let attempt = 0; attempt < 2; attempt++) {
    const ws = new WebSocket(url, { origin, headers: { Cookie: cookie } });
    t.after(() => ws.terminate());
    const [ready] = await once(ws, 'message');
    assert.equal(JSON.parse(ready).type, 'ready');
    assert.deepEqual(args.slice(-6), ['fixture', 'tmux', 'new-session', '-A', '-s', 'incident']);
    assert.ok(args.includes('StrictHostKeyChecking=yes'));
    const input = once(events, 'input');
    ws.send(JSON.stringify({ type: 'input', data: 'pwd\r' }));
    assert.deepEqual(await input, ['pwd\r']);
    const resize = once(events, 'resize');
    ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
    assert.deepEqual(await resize, [100, 30]);
    const closed = once(ws, 'close');
    ws.close();
    await closed;
  }
});

test('opens a real Windows ConPTY PowerShell session', { skip: process.platform !== 'win32', timeout: 15_000 }, async (t) => {
  const project = await checkout(t);
  const { origin, unlock } = await launch(t, { checkouts: [project] });
  const cookie = (await unlock()).headers.get('set-cookie').split(';')[0];
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/terminal?kind=shell&checkout=worker&cols=100&rows=30', {
    origin, headers: { Cookie: cookie },
  });
  try {
    const [ready] = await once(ws, 'message');
    assert.deepEqual(JSON.parse(ready), { type: 'ready' });
    const result = new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('PowerShell did not return the expected output.')), 7000);
      ws.on('message', (raw) => {
        const message = JSON.parse(raw);
        if (message.type !== 'output') return;
        output += message.data;
        if (!output.includes('76129')) return;
        clearTimeout(timer);
        resolve();
      });
    });
    ws.send(JSON.stringify({ type: 'resize', cols: 110, rows: 31 }));
    ws.send(JSON.stringify({ type: 'input', data: 'Write-Output (76100 + 29)\r' }));
    await result;
    const exited = once(ws, 'close');
    ws.send(JSON.stringify({ type: 'input', data: 'exit\r' }));
    await exited;
  } finally {
    if (ws.readyState < WebSocket.CLOSING) {
      const closed = once(ws, 'close');
      ws.close();
      await closed;
    }
  }
});
