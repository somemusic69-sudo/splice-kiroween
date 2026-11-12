import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import { extractDiff } from '../bridge/git.mjs';
import { validateConfig } from '../bridge/server.mjs';

const runs = { numRuns: 200 };
const fence = '```';

// Lines that can never open or close a fenced block, and never contain a line break.
const plainLine = fc.string({ maxLength: 40 }).filter((line) => !/[\r\n]/.test(line) && !line.startsWith(fence));
const textLines = fc.array(plainLine, { maxLength: 8 });
const joinLines = (lines) => lines.map((line) => line + '\n').join('');
const toCrlf = (text) => text.replaceAll('\n', '\r\n');

// extractDiff: pulls the single ```diff block out of agent output.

test('extractDiff returns exactly the body of a single diff block', () => {
  fc.assert(fc.property(textLines, textLines, textLines, (before, body, after) => {
    const text = joinLines(before) + fence + 'diff\n' + joinLines(body) + fence + '\n' + joinLines(after);
    assert.equal(extractDiff(text), joinLines(body));
  }), runs);
});

test('extractDiff gives the same result for CRLF and LF line endings', () => {
  fc.assert(fc.property(textLines, textLines, textLines, (before, body, after) => {
    const text = joinLines(before) + fence + 'diff\n' + joinLines(body) + fence + '\n' + joinLines(after);
    assert.equal(extractDiff(toCrlf(text)), extractDiff(text));
  }), runs);
});

test('extractDiff returns undefined unless there is exactly one diff block', () => {
  fc.assert(fc.property(textLines, textLines, textLines, (before, body, after) => {
    assert.equal(extractDiff(joinLines(before) + joinLines(after)), undefined);
    const block = fence + 'diff\n' + joinLines(body) + fence + '\n';
    assert.equal(extractDiff(joinLines(before) + block + joinLines(after) + block), undefined);
  }), runs);
});

test('extractDiff never throws, never returns carriage returns, and only returns text from its input', () => {
  fc.assert(fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (text) => {
    const diff = extractDiff(text);
    if (diff === undefined) return;
    assert.equal(typeof diff, 'string');
    assert.ok(!diff.includes('\r\n'));
    assert.ok(text.replace(/\r\n/g, '\n').includes(diff));
  }), runs);
  fc.assert(fc.property(fc.array(fc.constantFrom('```diff', '```', '\n', '\r\n', 'a', ' ', '+', '-'), { maxLength: 30 }), (parts) => {
    const diff = extractDiff(parts.join(''));
    assert.ok(diff === undefined || typeof diff === 'string');
  }), runs);
});

// validateConfig: gate for splice.local.json.

const id = fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,15}$/);
const alias = fc.stringMatching(/^[a-z0-9][a-z0-9_.-]{0,15}$/);
const absolute = fc.stringMatching(/^[a-z][a-z0-9]{0,8}(?:\/[a-z][a-z0-9]{0,8}){0,3}$/).map((path) => resolve('/splice-test', path));
const relativePath = fc.stringMatching(/^[a-z][a-z0-9]{0,8}(?:\/[a-z][a-z0-9]{0,8}){0,3}$/);
const files = fc.array(fc.stringMatching(/^[a-z]{1,8}\.mjs$/), { minLength: 1, maxLength: 32 });
const uniqueIds = (max) => fc.uniqueArray(id, { maxLength: max });

const validConfig = fc.record({
  targets: uniqueIds(4).chain((ids) => fc.tuple(...ids.map((targetId) => fc.record({ id: fc.constant(targetId), alias })))),
  checkouts: uniqueIds(4).chain((ids) => fc.tuple(...ids.map((checkoutId) => fc.record({ id: fc.constant(checkoutId), path: absolute, agentFiles: files })))),
});

const rejected = (config) => {
  try {
    validateConfig(config);
    return false;
  } catch (error) {
    return error instanceof Error;
  }
};

test('validateConfig accepts well-formed configs and keeps every entry', () => {
  fc.assert(fc.property(validConfig, (config) => {
    const result = validateConfig(config);
    assert.equal(result.targets.size, config.targets.length);
    assert.equal(result.checkouts.size, config.checkouts.length);
    for (const target of config.targets) assert.equal(result.targets.get(target.id).label, target.alias);
    for (const checkout of config.checkouts) assert.equal(result.checkouts.get(checkout.id).label, checkout.id);
  }), runs);
});

test('validateConfig rejects duplicate target and checkout ids', () => {
  fc.assert(fc.property(id, alias, absolute, files, (name, host, path, agentFiles) => {
    const target = { id: name, alias: host };
    const checkout = { id: name, path, agentFiles };
    assert.ok(rejected({ targets: [target, { ...target, alias: 'other' }] }));
    assert.ok(rejected({ checkouts: [checkout, { ...checkout }] }));
  }), runs);
});

test('validateConfig rejects ids and aliases outside the allowed character set', () => {
  const badId = fc.string({ maxLength: 12 }).filter((value) => !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value));
  const badAlias = fc.string({ maxLength: 12 }).filter((value) => !/^[a-z0-9][a-z0-9_.-]{0,127}$/i.test(value));
  fc.assert(fc.property(badId, badAlias, alias, absolute, files, (name, host, goodAlias, path, agentFiles) => {
    assert.ok(rejected({ targets: [{ id: name, alias: goodAlias }] }));
    assert.ok(rejected({ targets: [{ id: 'ok', alias: host }] }));
    assert.ok(rejected({ checkouts: [{ id: name, path, agentFiles }] }));
  }), runs);
});

test('validateConfig rejects relative checkout, sshConfig and kiroExecutable paths', () => {
  fc.assert(fc.property(id, relativePath, files, (name, path, agentFiles) => {
    assert.ok(rejected({ checkouts: [{ id: name, path, agentFiles }] }));
    assert.ok(rejected({ sshConfig: path }));
    assert.ok(rejected({ kiroExecutable: path }));
  }), runs);
});

test('validateConfig rejects empty, oversized and non-string agentFiles lists', () => {
  fc.assert(fc.property(id, absolute, fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 33, maxLength: 40 }), fc.anything().filter((v) => typeof v !== 'string'), (name, path, many, notString) => {
    assert.ok(rejected({ checkouts: [{ id: name, path, agentFiles: [] }] }));
    assert.ok(rejected({ checkouts: [{ id: name, path, agentFiles: many }] }));
    assert.ok(rejected({ checkouts: [{ id: name, path, agentFiles: ['a.mjs', notString] }] }));
  }), runs);
});
