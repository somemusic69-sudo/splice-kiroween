# Kiroween 2026 submission

## Devpost description

At 2 a.m., an on-call developer has a retry storm to investigate. Splice lets them select the evidence in an SSH/tmux terminal, group errors with browser-side Rust WebAssembly, and send a reviewed excerpt to a Kiro CLI incident agent. The agent proposes a diff, the developer reviews it, and the local bridge checks the Git revision and file contents before applying it. They run the regression in PowerShell and return to the same tmux session to verify the fix.

**Category** · Frankenstein

**Try it.** The public demo opens on recorded SSH logs from the retry incident. Filter for **ERROR**, use the filtered lines, review the sample diagnosis, and apply and test the sample patch. The browser runs the retry fixture and shows the delay change from **2 ms to 2,000 ms**. [Live demo](https://somemusic69-sudo.github.io/splice-kiroween/) · [Source and Windows setup](https://github.com/somemusic69-sudo/splice-kiroween)

## Kiro integration

Splice launches Kiro CLI through ACP V3 and streams the incident agent’s response into the cockpit. The tracked custom agent takes the operator’s question, log excerpt, and allowlisted source snapshots and returns a diagnosis and patch. The tracked retry incident spec defines the fixture and its regression test. In the submitted development write-up, describe the Kiro CLI development session and the outcomes actually verified.

On Windows, the live run passed with a signed-in Kiro CLI. Splice captured logs from a real Linux tmux session, filtered the evidence in WASM, obtained a Kiro-generated diff, and applied it after review. The PowerShell regression passed and the reattached SSH session showed the corrected retry behavior.

## Recording outline

| Time | Screen and narration |
| --- | --- |
| 0:00–0:25 | Open Splice on Windows. Attach to the disposable Linux fixture and run the retry worker in tmux. |
| 0:25–0:55 | Select the incident lines and group the repeated errors through WASM. Show the excerpt before sending it. |
| 0:55–1:30 | Send the excerpt to the real Kiro CLI incident agent. Explain the milliseconds mismatch while the diagnosis appears. |
| 1:30–2:05 | Open the unified diff, apply the reviewed patch, and run the regression test from local PowerShell. |
| 2:05–2:35 | Reattach to the same tmux session, show the corrected logs, then show the public judge demo and repo. |

Before submitting, add the public YouTube walkthrough and the links above to Devpost. Record the Windows run with real Kiro output. The deadline is December 5, 2026 at 5:00 a.m. WIB. [Official rules](https://kiroween.devpost.com/rules)
