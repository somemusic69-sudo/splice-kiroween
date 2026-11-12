# Kiroween 2026 submission

## Devpost description

Splice helps on-call developers turn server errors into a tested fix without leaving one workspace. They select evidence in an SSH/tmux terminal, group errors with browser-side Rust WebAssembly, and send a reviewed excerpt to Kiro CLI. Splice checks that the Git revision and files still match what Kiro analyzed before applying the developer-approved change. The developer can test it in PowerShell and return to the same tmux session to verify the fix.

**Category** · Frankenstein

**Try it.** A service should wait two seconds before retrying, but it waits only two milliseconds. Click **Review errors**, **View diagnosis**, and **Test fix** to see the browser verify the change from **2 ms to 2,000 ms**. [Live demo](https://somemusic69-sudo.github.io/splice-kiroween/) · [Source and Windows setup](https://github.com/somemusic69-sudo/splice-kiroween)

## Kiro integration

Splice launches Kiro CLI through ACP V3 and streams the incident agent’s response into the cockpit. The tracked custom agent takes the operator’s question, log excerpt, and allowlisted source snapshots and returns a diagnosis and patch. Its tool permissions deny execution and writes, so the operator reviews and applies the patch.

During development, we asked the signed-in Kiro CLI incident agent to review the tracked retry specification, fixture, and regression test. Kiro identified that a single test input could pass with a hardcoded 2,000 ms result and suggested checking a second input. We added a one-second case to the fixture and the browser verification. Both cases must pass after the patch. The spec and the agent profile are in the root `.kiro` directory.

On Windows, the live run passed with a signed-in Kiro CLI. Splice captured logs from a real Linux tmux session, filtered the evidence in WASM, obtained a Kiro-generated diff, and applied it after review. The PowerShell regression passed and the reattached SSH session showed the corrected retry behavior.

## How we used Kiro

Everything below is in the root `.kiro` directory of the repo.

- **Specs.** `.kiro/specs/retry-incident` holds the requirements, design, and tasks for the disposable retry incident. The regression contract in the requirements (2 s → 2,000 ms and 1 s → 1,000 ms) is the same one the fixture test and the browser check enforce.
- **Steering.** `.kiro/steering/splice.md` keeps Kiro inside the project's safety lines: loopback-only bridge, raw logs stay in the browser worker, the agent reads evidence as data and only proposes a text diff, and tests and deploys stay in the operator's terminal.
- **Custom agent.** `.kiro/agents/splice-incident.json` is the runtime incident agent. It has no tools and a deny-all permission rule, so it can explain and propose a diff but can never run commands or write files.
- **Hooks.** `.kiro/hooks` has three `PostFileSave` command hooks (Kiro hooks v1 format): Rust log-crate edits run `cargo test`, bridge and test edits run `npm test`, and web or `index.html` edits run the typecheck and build. A broken change fails right after the save, not at CI time.
- **Property-based tests.** The Rust log crate has 11 proptest properties, for example "group counts sum to the matched lines", "every excerpt line passes the level and regex filters", and "filtering never adds matches". The bridge has 9 fast-check properties for diff extraction and config validation. They found no bugs, and they now guard the parser and the patch path.
- **Kiro Crew.** We used Kiro Crew as a goal loop over the finished build. It ran every check, caught a mismatch between the spec and the tests (the spec was missing the one-second case), and ran parallel subagents for the property tests, the hooks, and a judge-style design review of this demo.

<!-- TODO before submitting: add which Kiro you built with (IDE / CLI / Web / Crew) and how they differed, whether you used MCP or Kiro powers, and which parts you vibe-coded vs. built from the spec. Only write what is true. -->

## Recording outline

| Time | Screen and narration |
| --- | --- |
| 0:00–0:25 | Open Splice on Windows. Attach to the disposable Linux fixture and run the retry worker in tmux. |
| 0:25–0:55 | Select the incident lines and group the repeated errors through WASM. Show the excerpt before sending it. |
| 0:55–1:30 | Send the excerpt to the real Kiro CLI incident agent. Explain the milliseconds mismatch while the diagnosis appears. |
| 1:30–2:05 | Open the unified diff, apply the reviewed patch, and run the regression test from local PowerShell. |
| 2:05–2:35 | Reattach to the same tmux session, show the corrected logs, then show the public judge demo and repo. |

Before submitting, add the public YouTube walkthrough and the links above to Devpost. Record the Windows run with real Kiro output. The deadline is December 5, 2026 at 5:00 a.m. WIB. [Official rules](https://kiroween.devpost.com/rules)
