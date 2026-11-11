export function scheduleRetry(delaySeconds, retry, schedule = setTimeout) {
  return schedule(retry, delaySeconds);
}
