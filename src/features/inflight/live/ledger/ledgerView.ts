// WHICH VIEW THE LIVE TAB OPENS ON — pure, so the rule is a fact about a function (spark
// theater-upgrade, 2026-09-18).
//
//   ?view=wall     → the wall, unchanged
//   ?view=ledger   → the Ledger
//   ?view=cockpit  → the Cockpit
//   anything else  → the Ledger when the org has a STANDING RUNNER (a continuous drive that has not
//                    ended), else the Cockpit.
//
// Why the default follows the runner: the operator who comes back to a runner that has been working
// for them wants "what happened, what waits for me" (the Ledger); an org with no runner has nothing to
// report yet, and its next step is setup (the Cockpit). An explicit `?view=` always wins, so a bookmark
// or a second screen lands exactly where it was pointed.

export type ResolvedLiveView = "wall" | "ledger" | "cockpit";

/** True when resolving `view` depends on whether a runner exists — the caller probes only then. */
export const needsRunnerProbe = (view: string): boolean => view !== "wall" && view !== "ledger" && view !== "cockpit";

export function resolveLiveView(view: string, hasRunner: boolean): ResolvedLiveView {
  if (view === "wall" || view === "ledger" || view === "cockpit") return view;
  return hasRunner ? "ledger" : "cockpit";
}
