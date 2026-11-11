import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleRetry } from './retry.mjs';

test('converts the configured seconds to scheduler milliseconds', () => {
  const retry = () => {};
  const schedule = (callback, ms) => {
    assert.equal(callback, retry);
    assert.equal(ms, 2000);
  };
  scheduleRetry(2, retry, schedule);
});

test('converts a one-second delay without hardcoding the result', () => {
  const retry = () => {};
  const schedule = (callback, ms) => {
    assert.equal(callback, retry);
    assert.equal(ms, 1000);
  };
  scheduleRetry(1, retry, schedule);
});
