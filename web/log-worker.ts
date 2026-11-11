import init, { analyze } from './wasm/splice_logs.js';

let raw = '';
const engine = init();
void engine.then(
  () => self.postMessage({ ready: true }),
  () => self.postMessage({ fatal: 'Could not load the WASM log engine.' }),
);

self.onmessage = async ({ data }) => {
  try {
    await engine;
    if (typeof data.raw === 'string') raw = data.raw;
    const report = JSON.parse(analyze(raw, data.level, data.pattern));
    self.postMessage({ id: data.id, ...report });
  } catch {
    self.postMessage({ id: data.id, error: 'Could not analyze the log.' });
  }
};
