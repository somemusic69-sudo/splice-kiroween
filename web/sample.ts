import before from './recordings/retry-before.log?raw';
import after from './recordings/retry-after.log?raw';

export const sampleLogs = before.trim();
export const sampleVerification = after.trim();

export const sampleDiagnosis = [
  'The server was supposed to wait 2 seconds before trying again. It waited only 2 milliseconds.',
  'The setting uses seconds, but the timer reads milliseconds. That is why retries happened before the service could recover.',
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
