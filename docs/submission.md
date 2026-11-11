# Kiroween 2026 submission

## Devpost description

**Splice** is a local-first incident cockpit that stitches an old-school SSH/tmux terminal, Rust WebAssembly log tools, and Kiro CLI together in one browser tab. A developer can attach to a Linux host from Windows, select server logs, and filter repeated errors locally. They review the excerpt, ask the incident agent for a diagnosis, and inspect the proposed change in a unified diff. The bridge checks the revision and file contents before applying the approved patch to the local checkout. The developer can run tests and return to the same tmux session to verify the fix.

**Category** · Frankenstein

## Kiro integration

Splice launches Kiro CLI through ACP V3 and streams the incident agent’s response into the cockpit. The tracked custom agent takes the operator’s question, log excerpt, and allowlisted source snapshots and returns a diagnosis and patch. The tracked retry incident spec defines the fixture and its regression test. In the submitted development write-up, describe the Kiro CLI development session and the outcomes actually verified.

## Recording outline

| Time | Screen and narration |
| --- | --- |
| 0:00–0:25 | Open Splice on Windows. Attach to the disposable Linux fixture and run the retry worker in tmux. |
| 0:25–0:55 | Select the incident lines and group the repeated errors through WASM. Show the excerpt before sending it. |
| 0:55–1:30 | Send the excerpt to the real Kiro CLI incident agent. Explain the milliseconds mismatch while the diagnosis appears. |
| 1:30–2:05 | Open the unified diff, apply the reviewed patch, and run the regression test from local PowerShell. |
| 2:05–2:35 | Reattach to the same tmux session, show the corrected logs, then show the public judge demo and repo. |

Before submitting, add the verified GitHub and Pages URLs and the public YouTube walkthrough to Devpost. The deadline is December 5, 2026 at 5:00 a.m. WIB. [Official rules](https://kiroween.devpost.com/rules)
