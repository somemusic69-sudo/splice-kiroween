import { scheduleRetry } from './retry.mjs';

const stamp = () => new Date().toISOString();
const plain = (level, message) => console.log(`${stamp()} ${level} ${message}`);
const structured = (level, message) => console.log(JSON.stringify({ ts: stamp(), level, message }));

plain('INFO', 'worker started');
let delay;
scheduleRetry(2, () => {}, (_, ms) => { delay = ms; });

if (delay < 2000) {
  for (let attempt = 0; attempt < 2; attempt++) {
    structured('ERROR', 'retry fired before upstream cooldown');
    plain('WARN', `retry delay was ${delay}ms; upstream cooldown is 2000ms`);
  }
  plain('ERROR', 'retry budget exhausted');
} else {
  plain('INFO', `retry scheduled after ${delay}ms`);
  plain('INFO', 'retry succeeded after upstream cooldown');
}
