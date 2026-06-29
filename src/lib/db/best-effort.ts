// Shared best-effort DB write for the fire-and-forget counter upserts (badge-reach impressions and
// public-funnel quota events). The contract is identical for both: no-op when persistence is off, and
// swallow EVERY error so a failed analytics/observability write never breaks the hot path it rides on
// (a public badge GET, a request the quota guard is already rejecting). The model-specific upsert
// (and its composite key) stays at the call site — only this guard + swallow skeleton is shared.

import { isDbConfigured } from "@/lib/db/client";

/** Run a counter upsert best-effort: skipped when the DB is unconfigured, and any thrown error is
 *  swallowed. `run` is a thunk so `getPrisma()` is only evaluated once persistence is confirmed on. */
export async function bumpCounter(run: () => Promise<unknown>): Promise<void> {
  if (!isDbConfigured()) return;
  try {
    await run();
  } catch {
    /* best-effort tally — never surface to the hot path that triggered it */
  }
}
