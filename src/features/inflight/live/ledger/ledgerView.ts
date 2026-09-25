// WHICH VIEW THE LIVE TAB OPENS ON — pure, so the rule is a fact about a function (spark
// theater-upgrade, 2026-09-18).
//
//   ?view=wall     → the wall, unchanged
//   ?view=ledger   → the Ledger
//   ?view=cockpit  → the Cockpit
//   ?view=desk     → the Desk (beta) — explicit only, never the default, until it is battle proven
//   anything else  → the Ledger when the org has a STANDING RUNNER (a continuous drive that has not
//                    ended), else the Cockpit.
//
// Why the default follows the runner: the operator who comes back to a runner that has been working
// for them wants "what happened, what waits for me" (the Ledger); an org with no runner has nothing to
// report yet, and its next step is setup (the Cockpit). An explicit `?view=` always wins, so a bookmark
// or a second screen lands exactly where it was pointed.

export type ResolvedLiveView = "wall" | "ledger" | "cockpit" | "desk";

const EXPLICIT: readonly string[] = ["wall", "ledger", "cockpit", "desk"];

/** True when resolving `view` depends on whether a runner exists — the caller probes only then. */
export const needsRunnerProbe = (view: string): boolean => !EXPLICIT.includes(view);

export function resolveLiveView(view: string, hasRunner: boolean): ResolvedLiveView {
  if (EXPLICIT.includes(view)) return view as ResolvedLiveView;
  return hasRunner ? "ledger" : "cockpit";
}
