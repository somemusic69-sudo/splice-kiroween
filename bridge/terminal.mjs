import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

const worker = fileURLToPath(new URL('./terminal-worker.mjs', import.meta.url));

export function spawnTerminal(program, args, options) {
  const child = fork(worker, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  const events = new EventEmitter();
  let exitCode;
  let killTimer;

  function send(message) {
    if (child.connected) child.send(message, () => {});
  }

  child.on('message', (message) => {
    if (message.type === 'output') events.emit('output', message.data);
    if (message.type === 'exit') exitCode = message.code;
  });
  child.once('error', (error) => events.emit('output', 'Terminal could not start: ' + error.message + '\r\n'));
  child.once('close', (code) => {
    clearTimeout(killTimer);
    events.emit('exit', { exitCode: exitCode ?? code ?? 1 });
  });
  send({ type: 'start', program, args, options });
  return {
    onData: (listener) => events.on('output', listener),
    onExit: (listener) => events.once('exit', listener),
    write: (data) => send({ type: 'input', data }),
    resize: (cols, rows) => send({ type: 'resize', cols, rows }),
    kill() {
      send({ type: 'close' });
      killTimer ??= setTimeout(() => child.kill(), 2200);
      killTimer.unref();
    },
  };
}
