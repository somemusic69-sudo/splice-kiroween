# Retry incident Kiro CLI verification

- Read the requirements and design before implementing or reviewing the fixture.
- Verify the fixture on a disposable checkout. Run `node --test retry.test.mjs` and confirm it fails with 2 versus 2000.
- Use the fixture logs as evidence. Generate a one-file patch at the scheduler boundary and have the operator apply it in Splice.
- Run the same test again. Verify the success logs through the reattached tmux session.
