// The cockpit's GATE, pure. One function decides whether this deployment can dispatch agents at all,
// and — when it cannot — which of the five setup states names the single next action.
//
// It is the client mirror of the guards the two routes enforce (`selfHostGuard` → owner →
// `autopilotEnabled()` → a paired working copy), and it is deliberately ONE function: the loop and
// the drive have exactly the same blast radius (both spawn `claude -p` inside a real checkout), so
// they get exactly the same gate. Widening it for one and not the other is the failure mode this
// exists to make impossible.

import type { CockpitSetupState } from "./CockpitSetup";

export interface CockpitGateInput {
  selfHosted: boolean;
  repoCount: number;
  isOwner: boolean;
  /** `autopilotEnabled()`, as last reported by the loop's status poll. */
  enabled: boolean;
  pairedCount: number;
}

/** The blocking state, or null when a run (and therefore a drive) may be started. */
export function cockpitSetupState(o: CockpitGateInput): CockpitSetupState | null {
  if (!o.selfHosted) return "hosted";
  if (o.repoCount === 0) return "no-repos";
  if (!o.isOwner) return "not-owner";
  if (!o.enabled) return "autopilot-off";
  if (o.pairedCount === 0) return "unpaired";
  return null;
}

/** Can this cockpit start a run or a drive? The same predicate for both, by construction. */
export const canDispatch = (o: CockpitGateInput): boolean => cockpitSetupState(o) == null;
