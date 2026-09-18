// ONE READ AT A TIME — the poll's concurrency guard, pure so it can be pinned without a renderer.
//
// The cockpit's poll used to be a `setInterval`, and an interval does not wait: a status read slower
// than the cadence (a cold route, a busy laptop, a reconcile pass on the server) had the next one
// start beside it, and the two then raced to write the same state in whichever order they happened to
// land. The poll is now a `setTimeout` CHAIN (`useLoopRun`) whose next tick is armed only after this
// one settles, and every tick — the chain's and the ones an action asks for after a start, stop or
// retry — goes through `run()` here, so there is never a second read in flight.
//
// A read asked for WHILE one is in flight is not dropped and not started beside it: it gets exactly
// ONE fresh read after the current one, shared by everyone who asked in the meantime. That matters for
// an action: the read already in flight may have left before the stop landed, and handing its answer
// to the caller that just pressed Stop would briefly print "Stop" again.

export interface SerialTicker {
  /** Run the read, or join the one queued behind a read already in flight. Never two at once. */
  run: () => Promise<void>;
  /** When the last read SETTLED (ms since epoch), `now` while one is in flight, 0 before any read.
   *  The poll arms its next tick relative to this, so a re-armed chain does not read twice in a row. */
  lastAt: () => number;
}

export function serialTicker(read: () => Promise<void>, now: () => number = Date.now): SerialTicker {
  let current: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  let settledAt = 0;

  const start = (): Promise<void> => {
    const p = read()
      .catch(() => undefined)
      .finally(() => {
        current = null;
        settledAt = now();
      });
    current = p;
    return p;
  };

  const run = (): Promise<void> => {
    if (!current) return start();
    if (!queued) {
      queued = current.then(() => {
        queued = null;
        // Somebody may have started a read between the settle and this continuation — join it.
        return current ?? start();
      });
    }
    return queued;
  };

  return { run, lastAt: () => (current ? now() : settledAt) };
}
