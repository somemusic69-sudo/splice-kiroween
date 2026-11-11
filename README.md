# Splice

Splice is a local-first incident cockpit for Windows 11. It puts an SSH/tmux terminal, a browser WASM log explorer, a Kiro CLI incident agent, and Git patch review in one tab. The Kiroween 2026 entry is in the **Frankenstein** category.

## Run on Windows 11

Install Node.js 22.12 or newer, Git, Windows OpenSSH Client, and [Rust through rustup](https://rustup.rs/). Install [Kiro CLI](https://kiro.dev/docs/cli/) with the V3 harness and run `kiro-cli login` from PowerShell. Make sure these executables are available on PATH. If npm needs to build the ConPTY module from source, use the Windows C++ build tools required by [node-pty](https://github.com/microsoft/node-pty).

```powershell
npm ci
rustup target add wasm32-unknown-unknown
npm run build:wasm
npm run build
npm start
```

Open the single-use loopback link printed by the bridge. Restart Splice to issue a new link when the browser session expires. The default port is 49371. Set `SPLICE_PORT` to choose another port or `SPLICE_CONFIG` to use a different configuration file.

Copy `splice.example.json` to `splice.local.json` for your own project. Set each target to an OpenSSH alias from your Windows SSH config and set each checkout to its absolute Git root. List the tracked UTF-8 files the agent may see and the patch may edit in `agentFiles`. Set up SSH authentication and verify the host key before connecting. The remote host needs tmux.

Set `sshConfig` to the absolute path of a dedicated OpenSSH config or `kiroExecutable` to the absolute path of a portable CLI when needed. To try the browser sample locally after building, run `npm run preview`.

## Run the disposable retry incident

1. Install Docker Desktop with the Linux engine. From the Splice root, run `powershell -NoProfile -ExecutionPolicy Bypass -File .\fixture\setup.ps1`. It seeds a separate Git checkout in `.fixture/source`, creates a fixture-only SSH key, starts the container on loopback port 2222, and prints an OpenSSH alias. Copy that block into `~/.ssh/config`. The fixture host key comes directly from the container.
2. Start or restart the bridge. Select **Retry fixture**, leave the tmux name as `splice`, and click **Attach SSH**. At the remote prompt, run:

   ```sh
   node /incident/incident.mjs | tee /tmp/splice-retry.log
   ```

3. Select the log lines in the terminal and click **Send selection to Logs**. Filter for `retry`, use the filtered lines, then click **Review for Kiro**. Edit the excerpt in **Logs** before sending it. Select **Retry worker** and click **Run Kiro**. The diagnosis should identify the seconds/milliseconds mismatch.
4. Open **Patch**. The expected fix multiplies the configured seconds by 1,000 at the scheduling boundary. Apply the reviewed patch and open **PowerShell** in the terminal pane:

   ```powershell
   git diff
   node --test retry.test.mjs
   ```

5. Reattach to **Retry fixture** with the same tmux name and run `node /incident/incident.mjs` again. The fixture mounts the disposable checkout read-only on Linux, so the patched source is available immediately. Expect `retry scheduled after 2000ms` and `retry succeeded after upstream cooldown`. For your own application, use the local terminal to follow your existing deployment process.
6. Stop the fixture with `docker compose -f fixture/compose.yml down`. The disposable checkout stays available for review. Restore its original retry file with `git -C .fixture/source restore retry.mjs` to replay the incident.

## How it works

- **Terminal.** xterm.js sends keystrokes and resize events to a loopback Node bridge. ConPTY runs Windows OpenSSH or local PowerShell. SSH requests use strict host-key checking and the existing SSH agent. The remote tmux session survives disconnects.
- **Logs.** A Rust WebAssembly module runs in a browser worker. It parses JSON lines and plain text, filters by level and regex, and groups repeated messages. Imported logs and terminal selections live in browser memory.
- **Kiro.** The bridge runs locally authenticated Kiro CLI over ACP V3. A custom agent gets the edited excerpt, question, and text snapshots of the checkout's configured source files. These go to the Kiro service when the operator clicks **Run Kiro**. The app keeps the transcript in memory. Kiro CLI can retain its own session records under the user’s Kiro configuration. The runtime agent has no execution tools.
- **Patch.** The bridge retains the patch and file hashes for review. It verifies the checkout revision and affected files before using Git to check and apply a diff. Supported patches are text edits to existing, allowlisted Git files. The terminal is available for operator-run tests and deployment.

## Judge build

The [public demo](https://somemusic69-sudo.github.io/splice-kiroween/) opens on **The Retry Haunting**, a recorded retry incident. Click **Find the clues** to prepare the excerpt, then follow the tabs to the cause and the fix. **Test the fix** applies the bundled diff in a browser worker and runs the retry code before and after the repair. **See the server recover** takes you to the recorded post-fix SSH logs. The disposable fixture is the live SSH and Kiro test path.

To publish, push the repository to a public GitHub repo with a `main` branch. In **Settings → Pages**, choose **GitHub Actions** as the source and run **Publish Splice demo**. The workflow builds the static app and reports the live URL in its deployment output.

## Verification

```powershell
npm test
cargo test --locked --manifest-path crates/logs/Cargo.toml
npx playwright install chromium
npm run test:browser
```

For Microsoft Edge on Windows, set `$env:SPLICE_BROWSER = 'msedge'` before the browser tests. See [submission notes](docs/submission.md) for the Devpost copy and recording sequence.
