// G4-10: the Delivery tab used to fetch its four rollups (PR signals, governance, activity, usage)
// via a single `Promise.all`, which rejects on the FIRST failing query — a transient DB blip on any
// ONE of the four blanked the whole page, discarding three sections that would have rendered fine.
// The page now uses `Promise.allSettled` and this module's pure helpers to classify each settled
// result and decide the top-level empty-state copy, kept here (not inline in the page) so the
// classification is unit-testable without rendering the async server component.

/** One settled query, reduced to what the page needs: its value (null on rejection) and whether it
 *  actually FAILED (as opposed to legitimately resolving to null/empty). The two are different facts —
 *  a degraded panel must say it failed, not render the same empty state as "no data exists". */
export interface SettledResult<T> {
  value: T | null;
  failed: boolean;
}

/** Reduce a `Promise.allSettled` entry to a `SettledResult`. Pure. */
export function settle<T>(r: PromiseSettledResult<T>): SettledResult<T> {
  return r.status === "fulfilled" ? { value: r.value, failed: false } : { value: null, failed: true };
}

/**
 * The Delivery tab's top-level empty-state copy, when all three visible sections (PR/governance/
 * activity) came back empty. Distinguishes THREE different reasons a reader could be staring at this
 * screen, and only one of them is "go configure a GitHub token":
 *   1. A query genuinely THREW — the honest story is "try again", never a token-setup nudge (the org
 *      may already have a token configured; blaming it sends the reader on a wild goose chase).
 *   2. A segment/tech-stack filter matched no repo, or its repos have no signals yet.
 *   3. The whole org has never scanned with a GitHub token.
 * Pure — no JSX, no fetch — so the branch is unit-testable without rendering the page.
 */
export function deliveryEmptyMessage(opts: { anyFailed: boolean; segmentId: string | null; techGroupId: string | null }): string {
  if (opts.anyFailed) {
    return "Delivery data couldn't load right now (a query failed). Try refreshing this page.";
  }
  if (opts.segmentId || opts.techGroupId) {
    return "No delivery signals for this filter. Pick another segment/stack or scan more of its repos (signals need a GitHub token).";
  }
  return "Delivery signals (pull requests, branch governance, commit activity) need a GitHub token. Re-scan with a token configured to populate this tab.";
}

/**
 * How the AI ROI spend layer should be presented, given the settled usage query.
 *
 * A rejected `getOrgUsageRollup` is NOT "no cost source". `buildAiDeliveryModel(pr, null)` assigns
 * fidelity `"none"` (the "No cost source" badge + connect-a-provider prompt), so feeding it a failed
 * query would send the reader to Integrations for a connector they may already have. The three facts:
 *   - `unavailable` — the query threw; we do not know whether a cost source exists
 *   - `none`        — the query succeeded and no provider reported cost
 *   - `present`     — the query succeeded and a cost source is connected
 * must not share a render path.
 */
export type AiRoiSpendKind = "unavailable" | "none" | "present";

export function aiRoiSpendKind(
  usage: { hasMeasured?: boolean; hasAllocatedCost?: boolean } | null,
  failed: boolean,
): AiRoiSpendKind {
  if (failed) return "unavailable";
  if (usage?.hasMeasured || usage?.hasAllocatedCost) return "present";
  return "none";
}

/** Copy for the AI ROI panel when the usage query threw. Never mentions "no cost source". */
export function aiRoiUnavailableMessage(): string {
  return "AI ROI spend is unavailable right now (the usage query failed). Try refreshing this page.";
}
