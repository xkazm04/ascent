// The one bound both followers of GET /api/org/scan/queue share (useImportReattach in the wizard,
// useOrgScanButton in the org header). Plain TypeScript, no React: each hook hands it a `read` and
// gets a cleanup back.
//
// WHY A CEILING. The queued tail is drained by the cron worker (docs/features/fleet/rescan.md: the
// rescore drain is a daily pass, and on a deployment without the GitHub App it returns before
// draining at all). A follow that only stopped at `pending === 0` therefore ran for as long as the
// tab stayed open on exactly the deployments where the tail never drains.
//
// THE VALUES. 120 reads at the unchanged 15 s spacing is 30 minutes of following: long enough to
// outlast the inline drain and any near-term worker pass a user is still watching for, short enough
// that a forgotten tab stops costing a query per tick. The wall-clock cap is the same 30 minutes
// but measured with real time (hidden time included), so a slow endpoint or a tab hidden for an
// hour cannot stretch the budget past what the read cap already promises.
//
// REACHING THE CEILING IS NOT EVIDENCE THE RUN FINISHED. The caller's `onCeiling` must say "stopped
// checking", never settle or claim completion.

/** Spacing between reads, scheduled after the previous read completes. Unchanged from the original polls. */
export const QUEUE_FOLLOW_POLL_MS = 15_000;
/** Most reads one follow makes. A failed or blipped read counts. */
export const QUEUE_FOLLOW_MAX_READS = 120;
/** Wall-clock ceiling from when the follow began (hidden time counts). */
export const QUEUE_FOLLOW_MAX_MS = 30 * 60_000;

export interface QueueFollowOptions {
  /** One read. Resolve "stop" when the follow is over for a reason of its own (settled, refused). */
  read: () => Promise<"more" | "stop">;
  /** The ceiling was reached with the run still unaccounted for. Fires at most once. */
  onCeiling: () => void;
  /** Make the first read at once (true) or one interval from now (false). */
  immediate: boolean;
}

/** Start following; returns the cleanup. A new follow always starts a fresh budget. */
export function startQueueFollow({ read, onCeiling, immediate }: QueueFollowOptions): () => void {
  const startedAt = Date.now();
  let reads = 0;
  let stopped = false;
  let reading = false;
  let paused = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const overBudget = () => reads >= QUEUE_FOLLOW_MAX_READS || Date.now() - startedAt >= QUEUE_FOLLOW_MAX_MS;
  const hitCeiling = () => {
    stopped = true;
    onCeiling();
  };

  const step = async () => {
    timer = undefined;
    if (stopped || reading) return;
    if (overBudget()) return hitCeiling();
    if (document.visibilityState === "hidden") {
      paused = true; // no read while hidden; the visibilitychange listener resumes
      return;
    }
    reading = true;
    reads += 1;
    const outcome = await read().catch(() => "more" as const);
    reading = false;
    if (stopped) return;
    if (outcome === "stop") {
      stopped = true;
      return;
    }
    if (overBudget()) return hitCeiling();
    timer = setTimeout(() => void step(), QUEUE_FOLLOW_POLL_MS);
  };

  const onVisibility = () => {
    if (document.visibilityState === "hidden" || !paused || stopped) return;
    paused = false;
    void step(); // read once immediately, then the cadence resumes
  };
  document.addEventListener("visibilitychange", onVisibility);

  if (immediate) void step();
  else timer = setTimeout(() => void step(), QUEUE_FOLLOW_POLL_MS);

  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
