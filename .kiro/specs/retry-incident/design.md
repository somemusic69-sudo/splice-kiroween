# Retry incident design

Keep the scheduler, log generator, and test in separate files. Inject the scheduling function into the scheduler so the regression test observes its arguments without a two-second wait. Use the same injection in the log generator to deterministically simulate an upstream cooldown.

Seed a disposable Git checkout from the fixture sources. Mount the checkout read-only in a Linux container with OpenSSH and tmux so local patches can be verified over SSH without altering the application repository.
