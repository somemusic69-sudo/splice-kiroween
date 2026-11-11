import before from './recordings/retry-before.log?raw';
import after from './recordings/retry-after.log?raw';

export const sampleLogs = before.trim();
export const sampleVerification = after.trim();

export const sampleDiagnosis = [
  'The worker passes a value in seconds to a scheduler that expects milliseconds.',
  'The 2 ms delay causes retries before the 2,000 ms upstream cooldown has elapsed.',
  'Convert the configured delay at the scheduler boundary. The regression test should verify that 2 seconds schedules 2,000 milliseconds.',
].join('\n\n');

export const sampleDiff = [
  'diff --git a/retry.mjs b/retry.mjs',
  '--- a/retry.mjs',
  '+++ b/retry.mjs',
  '@@ -1,3 +1,3 @@',
  ' export function scheduleRetry(delaySeconds, retry, schedule = setTimeout) {',
  '-  return schedule(retry, delaySeconds);',
  '+  return schedule(retry, delaySeconds * 1000);',
  ' }',
].join('\n') + '\n';
