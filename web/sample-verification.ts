import { applyPatch } from 'diff';
import fixtureSource from '../fixture/source/retry.mjs?raw';
import { sampleDiff } from './sample';

type ScheduleRetry = (seconds: number, retry: () => void, schedule: (callback: () => void, ms: number) => void) => void;

async function scheduledDelay(source: string, seconds: number) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    const { scheduleRetry } = await import(/* @vite-ignore */ url) as { scheduleRetry: ScheduleRetry };
    const retry = () => {};
    let delay: number | undefined;
    scheduleRetry(seconds, retry, (callback, milliseconds) => {
      if (callback !== retry) throw new Error('The scheduler received the wrong retry callback.');
      delay = milliseconds;
    });
    return delay;
  } finally {
    URL.revokeObjectURL(url);
  }
}

self.onmessage = async () => {
  try {
    const source = fixtureSource.replace(/\r\n/g, '\n');
    const patched = applyPatch(source, sampleDiff, { fuzzFactor: 0 });
    if (patched === false) throw new Error('The bundled diff could not be applied.');
    const before = await scheduledDelay(source, 2);
    const after = await scheduledDelay(patched, 2);
    const secondCase = await scheduledDelay(patched, 1);
    if (before !== 2 || after !== 2000 || secondCase !== 1000) {
      throw new Error('The retry regression did not pass.');
    }
    self.postMessage({ before, after });
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
