import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './style.css';
import { sampleDiagnosis, sampleDiff, sampleLogs, sampleVerification } from './sample';

type Target = { id: string; label: string; agentFiles?: string[] };
type Group = { level: string; message: string; sample: string; count: number };
type Report = { id: number; total: number; matched: number; groups: Group[]; excerpt: string };
type Patch = { id: string; diff: string; files: string[] };
type AgentEvent = { type: string; text?: string; patch?: Patch };
type View = 'logs' | 'kiro' | 'patch';

function get<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const button = (id: string) => get<HTMLButtonElement>(id);
const input = (id: string) => get<HTMLInputElement>(id);
const select = (id: string) => get<HTMLSelectElement>(id);
const area = (id: string) => get<HTMLTextAreaElement>(id);
const live = !!document.querySelector('meta[name="splice-local"]');
const views: View[] = live ? ['logs', 'kiro', 'patch'] : ['logs', 'patch'];
let authenticated = false;
let filterId = 0;
let reviewFilterId = 0;
let sampleInput = false;
let sampleVerified = false;
let report: Report | undefined;
let currentPatch: Patch | undefined;
let running: AbortController | undefined;
let socket: WebSocket | undefined;
let checkoutOptions: Target[] = [];
let lastTerminal: Record<string, string | number> | undefined;
let reconnectTimer: number | undefined;

document.body.classList.add(live ? 'live' : 'demo');
input('pattern-mode').checked = live;
get('mode').textContent = live ? 'Local workspace' : 'Sample workspace';
get('agent-description').textContent = 'Running Kiro sends the preview and question to the Kiro service. The agent can read your selected checkout.';
button('apply').textContent = live ? 'Apply patch' : 'Test fix';
get('terminal-status').textContent = live ? 'Disconnected' : 'Recorded SSH logs';
get('terminal-hint').textContent = 'Select terminal output to inspect it.';
if (!live) {
  get('engine').textContent = 'Loading log tools…';
  get('engine').title = 'Log analysis runs in WebAssembly on this device.';
  button('tab-patch').textContent = 'Diagnosis & fix';
  get('terminal-heading').textContent = 'Server log replay';
  get('patch-heading').textContent = 'Diagnosis & fix';
  get('excerpt-label').textContent = 'Log excerpt';
  get('sample-diagnosis-text').textContent = sampleDiagnosis;
  area('excerpt').placeholder = 'Choose a message or use the matching lines to prepare an excerpt.';
  button('use-filtered').textContent = 'Use matching lines';
  button('review').textContent = 'View diagnosis';

  const workspace = document.querySelector('.workspace')!;
  const toolsPane = document.querySelector('.tools-pane')!;
  const stackedLayout = matchMedia('(max-width: 850px)');
  function positionTools() {
    if (stackedLayout.matches) workspace.prepend(toolsPane);
    else workspace.append(toolsPane);
  }
  positionTools();
  stackedLayout.addEventListener('change', positionTools);
}

const terminal = new Terminal({
  fontFamily: 'Cascadia Mono, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.25,
  scrollback: 3500,
  disableStdin: !live,
  theme: { background: '#121212', foreground: '#eae5db', cursor: '#f3bd68', selectionBackground: '#785e3f' },
});
const fit = new FitAddon();
terminal.loadAddon(fit);
terminal.open(get('terminal'));
if (live) terminal.writeln('Attach to an SSH target or open a local PowerShell session.');
new ResizeObserver(() => fit.fit()).observe(get('terminal'));

function activate(view: View, focus = false) {
  for (const item of views) {
    const tab = button('tab-' + item);
    const active = item === view;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    get(item).hidden = !active;
    if (active && focus) tab.focus();
  }
}

for (const [index, view] of views.entries()) {
  const tab = button('tab-' + view);
  tab.onclick = () => activate(view);
  tab.onkeydown = (event) => {
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % views.length; break;
      case 'ArrowLeft': next = (index + views.length - 1) % views.length; break;
      case 'Home': next = 0; break;
      case 'End': next = views.length - 1; break;
      default: return;
    }
    event.preventDefault();
    activate(views[next], true);
  };
}

const worker = new Worker(new URL('./log-worker.ts', import.meta.url), { type: 'module' });

function status(id: string, message: string, error = false) {
  const node = get(id);
  node.textContent = message;
  node.classList.toggle('error', error);
  if (id === 'agent-status' || id === 'agent-files') node.hidden = !message;
  if (id === 'patch-status') get('patch-result').hidden = !message;
}

function renderResults(message: Report | { error: string }) {
  report = 'error' in message ? undefined : message;
  button('use-filtered').disabled = !report?.excerpt;
  const results = get('log-results');
  results.replaceChildren();
  if (!report) {
    status('log-count', 'Filter error', true);
    const error = document.createElement('p');
    error.className = 'empty error';
    error.textContent = 'error' in message ? message.error : '';
    results.append(error);
    return;
  }
  status('log-count', `${report.matched} / ${report.total} lines`);
  if (!report.groups.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No matching messages.';
    results.append(empty);
    return;
  }
  for (const group of report.groups) {
    const row = document.createElement('button');
    row.className = 'log-entry';
    row.title = 'Add this message to the excerpt';
    const severity = document.createElement('span');
    severity.className = 'level ' + group.level;
    severity.textContent = group.level;
    const message = document.createElement('span');
    message.textContent = group.message;
    const count = document.createElement('span');
    count.textContent = String(group.count);
    row.append(severity, message, count);
    row.onclick = () => {
      const excerpt = area('excerpt');
      setExcerpt([excerpt.value, group.sample].filter(Boolean).join('\n').slice(0, excerpt.maxLength));
    };
    results.append(row);
  }
}

worker.onmessage = ({ data }) => {
  if (data.ready) {
    button('review-errors').disabled = false;
    status('engine', live ? 'WASM ready' : 'Log tools ready');
  }
  else if (data.fatal) status('engine', data.fatal, true);
  else if (data.id === filterId) {
    renderResults(data);
    if (data.id === reviewFilterId && report?.excerpt) {
      setExcerpt(report.excerpt);
      activate('logs', true);
    }
  }
};
worker.onerror = () => status('engine', 'WASM unavailable', true);

function filter(raw?: string) {
  button('use-filtered').disabled = true;
  const query = input('query').value;
  const pattern = input('pattern-mode').checked ? query : '(?i)' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  worker.postMessage({ id: ++filterId, raw, level: select('severity').value, pattern });
}

function loadLogs(raw: string, label: string, fromSample = false) {
  if (new TextEncoder().encode(raw).byteLength > 2 * 1024 * 1024) {
    status('log-source', 'Logs must be 2 MiB or smaller.', true);
    return;
  }
  sampleInput = fromSample;
  status('log-source', label);
  filter(raw);
  setExcerpt('');
  activate('logs');
}

function setExcerpt(value: string) {
  area('excerpt').value = value;
  area('context').value = value;
  button('review').disabled = !value.trim() || (!live && !sampleInput);
  syncRun();
}

function syncRun() {
  button('run').disabled = !!running || !area('context').value.trim()
    || !authenticated || !select('checkout').value;
}

input('query').oninput = () => filter();
input('pattern-mode').onchange = () => filter();
select('severity').onchange = () => filter();
input('import').onchange = async () => {
  const file = input('import').files?.[0];
  input('import').value = '';
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    status('log-source', 'Logs must be 2 MiB or smaller.', true);
    return;
  }
  try {
    loadLogs(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()), file.name);
  } catch {
    status('log-source', 'Could not read this file as UTF-8.', true);
  }
};
area('excerpt').oninput = () => setExcerpt(area('excerpt').value);
button('use-filtered').onclick = () => setExcerpt(report?.excerpt ?? '');
button('review').onclick = () => {
  if (live) {
    activate('kiro', true);
    return;
  }
  if (!sampleVerified) showPatch({ id: 'sample', diff: sampleDiff, files: ['retry.mjs'] });
  activate('patch', true);
};
button('show-patch').onclick = () => activate('patch', true);
button('edit-excerpt').onclick = () => {
  activate('logs');
  area('excerpt').focus();
};
function showSourceList() {
  const files = checkoutOptions.find((item) => item.id === select('checkout').value)?.agentFiles;
  status('agent-files', files?.length ? 'Source files sent with the excerpt: ' + files.join(', ') : '');
  syncRun();
}

select('checkout').onchange = () => {
  showPatch();
  get('response').hidden = true;
  status('agent-status', '');
  showSourceList();
};
terminal.onSelectionChange(() => { button('capture').disabled = !terminal.hasSelection(); });
button('capture').onclick = () => loadLogs(terminal.getSelection(), 'Terminal selection', !live);

function focusTerminal() {
  get('terminal-heading').focus();
}

button('review-errors').onclick = () => {
  if (!sampleInput) sample();
  select('severity').value = 'ERROR';
  input('query').value = '';
  input('pattern-mode').checked = false;
  status('log-source', 'retry-worker.log');
  reviewFilterId = filterId + 1;
  filter(sampleLogs);
};

function showPatch(patch?: Patch) {
  currentPatch = patch;
  const diff = get('diff');
  diff.replaceChildren();
  const details = get<HTMLDetailsElement>('diff-details');
  details.hidden = !patch;
  details.open = live;
  get('sample-diagnosis').hidden = !patch;
  let added = 0;
  let removed = 0;
  for (const line of patch?.diff.trimEnd().split('\n') ?? []) {
    const row = document.createElement('span');
    row.textContent = line || ' ';
    if (line.startsWith('+') && !line.startsWith('+++ ')) {
      row.className = 'added';
      added++;
    }
    if (line.startsWith('-') && !line.startsWith('--- ')) {
      row.className = 'removed';
      removed++;
    }
    if (line.startsWith('@@')) row.className = 'range';
    diff.append(row);
  }
  get('patch-changes').textContent = `+${added} / −${removed}`;
  get('patch-changes').hidden = !live || !patch;
  get('patch-summary').textContent = live
    ? (patch ? patch.files.join(', ') : 'Run the incident agent to prepare a patch.')
    : (patch ? 'Proposed change: convert the retry delay to milliseconds before starting the timer.' : 'Review the errors and open the sample diagnosis.');
  button('apply').disabled = !patch;
  button('discard').disabled = !patch;
  button('show-patch').hidden = !patch;
  button('run').classList.toggle('accent', !patch);
  button('verify-terminal').hidden = true;
  get('patch-result').classList.remove('verified');
  status('patch-status', '');
}

function sample() {
  showPatch();
  get('response').hidden = true;
  sampleVerified = false;
  input('pattern-mode').checked = false;
  status('agent-status', '');
  select('severity').value = '';
  input('query').value = '';
  terminal.reset();
  terminal.writeln('\x1b[33m$ tmux attach -t splice\x1b[0m');
  terminal.writeln('$ tail -n 6 /tmp/splice-retry.log');
  for (const line of sampleLogs.split(/\r?\n/)) terminal.writeln(line);
  terminal.writeln('\r\n$ ');
  loadLogs(sampleLogs, 'retry-worker.log', true);
}

button('sample').onclick = sample;

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch('/api/' + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${response.status}).`);
  }
  return response;
}

function post(path: string, body: object, signal?: AbortSignal) {
  return api(path, { method: 'POST', body: JSON.stringify(body), signal });
}

function agentEvent(event: AgentEvent) {
  if (event.type === 'text') {
    const output = get('response');
    output.hidden = false;
    const atBottom = output.scrollHeight - output.clientHeight - output.scrollTop < 20;
    output.append(document.createTextNode(event.text ?? ''));
    if (atBottom) output.scrollTop = output.scrollHeight;
  }
  if (event.type === 'status') status('agent-status', event.text ?? '');
  if (event.type === 'error') status('agent-status', event.text ?? 'Kiro failed.', true);
  if (event.type === 'patch') showPatch(event.patch);
}

function verifySample() {
  return new Promise<{ before: number; after: number }>((resolve, reject) => {
    const verifier = new Worker(new URL('./sample-verification.ts', import.meta.url), { type: 'module' });
    const timeout = window.setTimeout(() => {
      verifier.terminate();
      reject(new Error('The sample regression test timed out.'));
    }, 5000);
    function close() {
      window.clearTimeout(timeout);
      verifier.terminate();
    }
    verifier.onmessage = ({ data }) => {
      close();
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    verifier.onerror = () => {
      close();
      reject(new Error('The browser could not run the sample regression test.'));
    };
    verifier.postMessage('verify');
  });
}

button('run').onclick = async () => {
  if (running || !area('context').value.trim()) return;
  showPatch();
  get('response').textContent = '';
  get('response').hidden = true;
  running = new AbortController();
  select('checkout').disabled = true;
  syncRun();
  button('cancel').hidden = false;
  status('agent-status', 'Starting Kiro CLI…');
  try {
    const response = await post('agent', {
      checkout: select('checkout').value,
      excerpt: area('context').value,
      question: input('question').value,
    }, running.signal);
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let remainder = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = (remainder + value).split('\n');
      remainder = lines.pop() ?? '';
      for (const line of lines.filter(Boolean)) agentEvent(JSON.parse(line));
    }
  } catch (error) {
    const cancelled = running.signal.aborted;
    status('agent-status', cancelled ? 'Cancelled.' : String((error as Error).message), !cancelled);
  } finally {
    running = undefined;
    select('checkout').disabled = false;
    button('cancel').hidden = true;
    syncRun();
  }
};

button('cancel').onclick = () => running?.abort();

button('apply').onclick = async () => {
  const patch = currentPatch;
  if (!patch) return;
  button('apply').disabled = true;
  button('discard').disabled = true;
  button('sample').disabled = true;
  select('checkout').disabled = true;
  button('run').disabled = true;
  try {
    let result = 'Patch applied to the checkout. Run your tests in PowerShell.';
    if (live) {
      await post('apply', { id: patch.id });
    } else {
      status('patch-status', 'Testing the repair in your browser…');
      const { before, after } = await verifySample();
      result = `Test passed · ${before} ms → ${after.toLocaleString('en-US')} ms`;
      sampleVerified = true;
      terminal.writeln('\r\n\x1b[32mPASS\x1b[0m Browser regression: ' + before + ' ms → ' + after + ' ms');
      terminal.writeln('\r\nRecorded post-fix logs');
      for (const line of sampleVerification.split(/\r?\n/)) terminal.writeln(line);
    }
    currentPatch = undefined;
    button('show-patch').hidden = true;
    status('patch-status', result);
    get('patch-result').classList.add('verified');
    button('verify-terminal').textContent = live ? 'Open PowerShell' : 'View recovery logs';
    button('verify-terminal').hidden = false;
  } catch (error) {
    status('patch-status', (error as Error).message, true);
    button('apply').disabled = false;
    button('discard').disabled = false;
  } finally {
    button('sample').disabled = false;
    select('checkout').disabled = false;
    syncRun();
  }
};

button('verify-terminal').onclick = () => {
  if (live) button('powershell').click();
  focusTerminal();
};

button('discard').onclick = async () => {
  if (!currentPatch) return;
  try {
    if (live) await post('discard', { id: currentPatch.id });
    showPatch();
    status('patch-status', 'Patch discarded.');
  } catch (error) {
    status('patch-status', (error as Error).message, true);
  }
};

function terminalMessage(message: object) {
  if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 1024 * 1024) {
    socket.send(JSON.stringify(message));
  }
}

terminal.onData((data) => terminalMessage({ type: 'input', data }));
terminal.onResize(({ cols, rows }) => terminalMessage({ type: 'resize', cols, rows }));

function disconnect() {
  window.clearTimeout(reconnectTimer);
  lastTerminal = undefined;
  const previous = socket;
  socket = undefined;
  previous?.close();
  button('disconnect').disabled = true;
  status('terminal-status', 'Disconnected');
}

function connect(params: Record<string, string | number>, retry = false) {
  if (!retry) {
    disconnect();
    terminal.reset();
  }
  lastTerminal = params;
  status('terminal-status', retry ? 'Reattaching…' : 'Connecting…');
  button('disconnect').disabled = false;
  fit.fit();
  const query = new URLSearchParams(Object.entries({ ...params, cols: terminal.cols, rows: terminal.rows }).map(([key, value]) => [key, String(value)]));
  const ws = new WebSocket(`ws://${location.host}/terminal?${query}`);
  socket = ws;
  let exited = false;
  let opened = false;
  ws.onopen = () => { opened = true; };
  ws.onmessage = ({ data }) => {
    if (socket !== ws) return;
    const message = JSON.parse(data);
    if (message.type === 'ready') {
      status('terminal-status', params.kind === 'ssh' ? 'SSH / tmux' : 'PowerShell');
      terminal.focus();
    }
    if (message.type === 'output') terminal.write(message.data);
    if (message.type === 'exit' || message.type === 'error') {
      exited = true;
      const error = message.type === 'error' || message.code !== 0;
      const details = message.message ?? (error ? `Terminal exited (${message.code}). See output.` : 'Terminal session ended.');
      status('terminal-status', details, error);
    }
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = undefined;
    if (!exited && lastTerminal && params.kind === 'ssh' && opened && !retry) {
      reconnectTimer = window.setTimeout(() => connect(params, true), 700);
      return;
    }
    if (!exited) status('terminal-status', 'Connection closed. Reattach to the same tmux session to resume.', true);
    button('disconnect').disabled = true;
  };
}

button('connect').onclick = () => connect({ kind: 'ssh', target: select('target').value, tmux: input('tmux').value });
button('powershell').onclick = () => connect({ kind: 'shell', checkout: select('checkout').value });
button('disconnect').onclick = disconnect;

async function initialize() {
  syncRun();
  if (!live) {
    fit.fit();
    sample();
    return;
  }
  button('connect').disabled = true;
  button('powershell').disabled = true;
  try {
    const key = location.hash.slice(1);
    if (key) {
      history.replaceState(null, '', location.pathname);
      await post('session', { key });
    }
    const { targets, checkouts } = await (await api('config')).json() as { targets: Target[]; checkouts: Target[] };
    checkoutOptions = checkouts;
    for (const [id, items] of [['target', targets], ['checkout', checkouts]] as const) {
      for (const item of items) select(id).append(new Option(item.label, item.id));
    }
    authenticated = true;
    button('connect').disabled = !targets.length;
    button('powershell').disabled = !checkouts.length;
    if (!targets.length && !checkouts.length) status('terminal-status', 'Add targets and checkouts to splice.local.json.');
    showSourceList();
  } catch (error) {
    status('terminal-status', (error as Error).message, true);
  }
}

void initialize();
