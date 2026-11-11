import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const MAX_PATCH = 192 * 1024;
const SAFE_PATH = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;

export function git(cwd, args, input) {
  return new Promise((done, fail) => {
    const child = spawn('git', ['--no-optional-locks', '-c', 'core.quotePath=false', ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 15_000,
    });
    const stdout = [];
    const stderr = [];
    let size = 0;
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        child.kill();
        fail(new Error('Git output exceeded the limit.'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 24) stderr.push(chunk);
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (code === 0) done(Buffer.concat(stdout).toString());
      else fail(new Error(Buffer.concat(stderr).toString().trim() || 'Git command failed.'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function permittedPath(path) {
  return SAFE_PATH.test(path) && path.split('/').every((part) =>
    part !== '.' && part !== '..' && part.toLowerCase() !== '.git'
    && part.toLowerCase() !== '.kiro' && !part.endsWith('.'));
}

async function sourceFile(cwd, path, limit) {
  if (!permittedPath(path)) throw new Error('The patch contains an unsupported path.');
  const target = resolve(cwd, path);
  const info = await lstat(target);
  const actual = await realpath(target);
  const rel = relative(cwd, actual);
  if (!info.isFile() || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)
      || rel.split(sep).join('/') !== path || info.size > limit) {
    throw new Error(`File is outside the checkout, linked, or too large: ${path}`);
  }
  const listed = await git(cwd, ['ls-files', '--stage', '-z', '--', path]);
  if (!/^100(?:644|755) [0-9a-f]+ 0\t/.test(listed) || listed.split('\0').length !== 2) {
    throw new Error(`File must be tracked and free of merge conflicts: ${path}`);
  }
  return readFile(actual);
}

export async function checkoutSnapshot(checkout) {
  const cwd = await realpath(checkout.path);
  const top = await realpath((await git(cwd, ['rev-parse', '--show-toplevel'])).trim());
  if (relative(cwd, top)) throw new Error('Configure the path to the Git checkout root.');
  const head = (await git(cwd, ['rev-parse', 'HEAD'])).trim();
  const source = new Map();
  let bytes = 0;
  for (const path of checkout.agentFiles) {
    const content = await sourceFile(cwd, path, 128 * 1024);
    bytes += content.length;
    if (bytes > 256 * 1024) throw new Error('Selected source files exceed 256 KiB.');
    source.set(path, {
      text: new TextDecoder('utf-8', { fatal: true }).decode(content),
      hash: createHash('sha256').update(content).digest('hex'),
    });
  }
  return { cwd, head, source };
}

export function extractDiff(text) {
  const matches = [...text.matchAll(/^```diff[^\S\n]*\r?\n([\s\S]*?)^```[^\S\n]*(?:\r?\n|$)/gm)];
  return matches.length === 1 ? matches[0][1].replace(/\r\n/g, '\n') : undefined;
}

async function confirmSnapshot(snapshot, files) {
  const { cwd, head, source } = snapshot;
  if ((await git(cwd, ['rev-parse', 'HEAD'])).trim() !== head) {
    throw new Error('The checkout revision changed. Generate a new patch.');
  }
  for (const path of files) {
    const hash = createHash('sha256').update(await sourceFile(cwd, path, 128 * 1024)).digest('hex');
    if (hash !== source.get(path)?.hash) {
      throw new Error(`The reviewed file changed: ${path}. Generate a new patch.`);
    }
  }
}

export async function preparePatch(snapshot, diff) {
  if (Buffer.byteLength(diff) > MAX_PATCH || !diff.startsWith('diff --git ')
      || /^(?:old mode|new mode|deleted file mode|new file mode|rename |copy |GIT binary patch|Binary files)/m.test(diff)) {
    throw new Error('Only text edits to existing files are supported.');
  }
  const summaries = await git(snapshot.cwd, ['apply', '--numstat', '-z', '-'], diff);
  const files = summaries.split('\0').filter(Boolean).map((row) => {
    const match = /^\d+\t\d+\t(.+)$/.exec(row);
    if (!match || !snapshot.source.has(match[1])) {
      throw new Error('The patch changes a file outside the configured source list.');
    }
    return match[1];
  });
  if (!files.length || new Set(files).size !== files.length) {
    throw new Error('The patch must contain one text diff per affected file.');
  }
  await confirmSnapshot(snapshot, files);
  await git(snapshot.cwd, ['apply', '--check', '--whitespace=nowarn', '-'], diff);
  return { id: randomUUID(), files, diff, snapshot };
}

export async function applyPatch(patch) {
  const { snapshot, files, diff } = patch;
  await confirmSnapshot(snapshot, files);
  await git(snapshot.cwd, ['apply', '--check', '--whitespace=nowarn', '-'], diff);
  await confirmSnapshot(snapshot, files);
  await git(snapshot.cwd, ['apply', '--whitespace=nowarn', '-'], diff);
}
