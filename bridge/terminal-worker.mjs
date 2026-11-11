import { spawn } from 'node-pty';

let terminal;
let closing = false;
let finished = false;

function finish(code) {
  if (finished) return;
  finished = true;
  if (process.connected) process.send({ type: 'exit', code }, () => process.exit(code));
  else process.exit(code);
}

function close() {
  if (closing) return;
  closing = true;
  try {
    terminal?.kill();
  } finally {
    setTimeout(() => finish(0), 1250);
  }
}

process.on('disconnect', close);
process.on('message', (message) => {
  try {
    if (message.type === 'start') {
      terminal = spawn(message.program, message.args, {
        ...message.options,
        useConptyDll: true,
        env: { ...process.env, TERM: 'xterm-256color' },
      });
      terminal.onData((data) => {
        if (process.connected && !process.send({ type: 'output', data }, () => {})) close();
      });
      terminal.onExit(({ exitCode }) => finish(exitCode ?? 1));
    }
    if (message.type === 'input' && !closing) terminal?.write(message.data);
    if (message.type === 'resize' && !closing) terminal?.resize(message.cols, message.rows);
    if (message.type === 'close') close();
  } catch (error) {
    if (process.connected) process.send({ type: 'output', data: error.message + '\r\n' }, () => {});
    finish(1);
  }
});
