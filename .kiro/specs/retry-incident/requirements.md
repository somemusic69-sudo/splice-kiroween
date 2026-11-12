# Retry incident requirements

1. The fixture exposes an SSH endpoint on Windows loopback and supports a persistent Linux tmux session.
2. The worker accepts a configured delay in seconds. The scheduling API expects milliseconds. The seeded bug passes seconds unchanged.
3. For a two-second configuration, the fixture emits repeatable early-retry error and warning messages before the fix and a success message after it.
4. The regression test asserts that the scheduling callback receives 2,000 milliseconds and the original retry callback. A second case asserts that a one-second configuration receives 1,000 milliseconds, so a hardcoded result cannot pass.
5. The fixture can be reset independently of Splice and runs without production access.
