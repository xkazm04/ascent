// Server-only resolution of the org dashboard's time window, honoring the "remember my period" cookie.
//
// Every org tab must resolve the window the SAME way or the selected range silently resets when the
// user navigates: the Overview tab read the cookie fallback, but the sibling tabs (Security, Executive)
// called resolveWindow(sp) directly — so a range chosen on Overview was lost on every other tab. This
// centralizes the precedence so the cookie carries the period across navigation without each nav link
// having to thread ?range= through.

import { cookies } from "next/headers";
import { parsePeriodCookie, PERIOD_COOKIE, resolveWindow, type ResolvedWindow } from "@/lib/window";

/**
 * Resolve the org dashboard window with the canonical precedence:
 *   1. an explicit `?range=` in the URL (shareable links stay authoritative),
 *   2. the user's remembered period cookie (set by the TimeRangeSelector),
 *   3. the default range.
 * Server-only (reads cookies). Use on EVERY org tab that scopes data to the selected window.
 */
export async function resolveOrgWindow(
  sp: { range?: string | string[]; from?: string | string[]; to?: string | string[] },
): Promise<ResolvedWindow> {
  const remembered = sp.range ? null : parsePeriodCookie((await cookies()).get(PERIOD_COOKIE)?.value);
  return resolveWindow(remembered ?? sp);
}

/**
 * The window as the HALF-OPEN bounds the db layer queries with — `{ start, endExclusive }`, one
 * closure convention, no inclusive alias.
 *
 * Every org tab hand-wrote `{ start: period.start, end: period.end }` when handing the period to an
 * aggregate, which is how the inclusive dialect spread from one deprecated field to a dozen query
 * builders: a row in the final millisecond of the window is matched by `lt: endExclusive` and missed
 * by `lte: end`, so two tabs on the same period could disagree about a boundary row. This is the one
 * shape to pass instead (`upperBound()` in `src/lib/db/org-shared.ts` prefers `endExclusive`), and
 * the named migration target `ResolvedWindow.end`'s deprecation points at. A caller that genuinely
 * cannot express `lt` calls `inclusiveEnd()` at its own edge rather than carrying both bounds.
 *
 * WHAT THE WINDOW MEANS DEPENDS ON THE READER — the bounds are one convention, the ENDPOINT is not,
 * and the difference is by design (each reader's own header states its rule; pinned by
 * `src/lib/org/period.dialect.test.ts`):
 *   - `getOrgRollup` — "current" is each repo's latest scan AT-OR-BEFORE the upper bound, with NO
 *     lower bound. A repo last scanned before `start` still counts in the fleet average, because the
 *     rollup answers "where does the fleet stand as of the end of this period", not "what happened
 *     during it". Only its trend/baseline queries use `start`.
 *   - `getOrgMovers` / `getOrgTeamRollup` — "now" is the latest scan INSIDE `[start, endExclusive)`,
 *     compared against the latest scan strictly before `start`. Both ends are measurements, so a repo
 *     with no scan during the period simply has no move to report.
 *   - `getOrgRepoHistories` — EVERY scan in `[start, endExclusive)`, not an endpoint at all.
 * The visible consequence: a repo not scanned during the period is in the rollup average and absent
 * from movers. That is not a bug and the counts are not expected to reconcile.
 */
export function orgWindowBounds(w: ResolvedWindow): { start: Date | null; endExclusive: Date | null } {
  return { start: w.start, endExclusive: w.endExclusive };
}
