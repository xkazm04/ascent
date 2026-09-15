// The cockpit's GATE, pure. It decides what this cockpit may dispatch, and — when it may dispatch
// nothing — which setup state names the single next action.
//
// IT USED TO ANSWER FROM `selfHosted` ALONE, and that was the bug ADR-0001 names: deployment mode is
// a value the browser reads off its own page, and "is this deployment self-hosted" is not the same
// question as "can this organization start a run". A cloud owner who could already arm a run was
// shown a self-hosting guide, and the `hosted` card's own comment conceded it. The gate now takes a
// SERVER FACT — `hosted`, from `GET /api/org/loop` — and infers nothing.
//
// ── THE ONE-PREDICATE RULE, RESTATED RATHER THAN DROPPED ──────────────────────────────────────────
//
// This file was one function because the loop and the drive have the same blast radius: both spawn
// `claude -p` inside a real checkout, so widening the gate for one and not the other was the failure
// mode it existed to make impossible. That rule is intact and is now stated in the type: there are
// two DISPATCH MODES, and the drive is bound to `local` — the only mode whose work touches this
// server's disk. A hosted run spawns nothing here, so it is a different capability with a different
// gate, and `canDriveLocally` is how a caller says which one it means. A caller that reaches for
// `canDispatch` when it meant the drive is now making a visible mistake rather than an invisible one.

import type { CockpitSetupState } from "./CockpitSetup";
import type { StartLoopInput } from "./loopClient";
// The server's answer to "can this org dispatch a run Ascent gets worked" (ADR-0001 §3), imported
// from the pure module that DECLARES it rather than restated here: the route composes that exact
// object and this gate branches on two of its three fields, so a local copy is a silent drift.
import type { HostedDispatchStatus as HostedDispatchFact } from "@/lib/local/hosted-gate";

export type { HostedDispatchFact };

export interface CockpitGateInput {
  selfHosted: boolean;
  repoCount: number;
  isOwner: boolean;
  /** `autopilotEnabled()`, as last reported by the loop's status poll. LOCAL lanes only. */
  enabled: boolean;
  pairedCount: number;
  /** The `hosted` field of the status payload. `null` = the server did not say — an older server, or
   *  a status read that has not landed yet — and the gate then behaves exactly as it did before the
   *  field existed. An absent answer is never read as a yes. */
  hosted?: HostedDispatchFact | null;
}

/** What this cockpit may start. `local` spawns an agent on this server's disk; `hosted` asks Ascent
 *  Cloud to get the lanes worked and touches no disk here. `null` = neither. */
export type CockpitDispatchMode = "local" | "hosted" | null;

export function cockpitDispatchMode(o: CockpitGateInput): CockpitDispatchMode {
  return cockpitSetupState(o) == null ? (o.selfHosted ? "local" : "hosted") : null;
}

/**
 * The blocking state, or null when a run may be started in EITHER mode.
 *
 * THE PRECEDENCE IS UNCHANGED. The cloud block still outranks every local check, so a cloud
 * deployment's answer is decided by one branch and cannot fall through into a question about
 * pairings it has no concept of. The ONLY behaviour that changed is what that branch does when the
 * server says this org can dispatch: it stops blocking, and the remaining two checks (repos,
 * ownership) apply to a hosted org for exactly the reasons they apply to a local one.
 */
export function cockpitSetupState(o: CockpitGateInput): CockpitSetupState | null {
  if (!o.selfHosted && o.hosted?.enabled !== true) {
    // TWO CLOUD STATES, and the split is `available`. A deployment that operates no hosted worker
    // offers the reader nothing to fix, so it keeps the original card — which is honest on that
    // deployment and points at self-hosting and the remote-agent door. A deployment that DOES operate
    // one is telling this org something specific about itself, and that deserves its own card.
    return o.hosted?.available === true ? "hosted-not-enabled" : "hosted";
  }
  if (o.repoCount === 0) return "no-repos";
  if (!o.isOwner) return "not-owner";
  // Past here a hosted org is cleared: `autopilot-off` and `unpaired` are statements about this
  // server's own disk and its ASCENT_AUTOPILOT env, and neither is a fact about a hosted tenant.
  if (!o.selfHosted) return null;
  if (!o.enabled) return "autopilot-off";
  if (o.pairedCount === 0) return "unpaired";
  return null;
}

/** Can this cockpit start a run at all, in either mode? */
export const canDispatch = (o: CockpitGateInput): boolean => cockpitDispatchMode(o) != null;

/** Can this cockpit start a DRIVE? Local mode only, by construction: a drive is a sequence of local
 *  runs, each spawning `claude -p` inside a paired working copy on this server. */
export const canDriveLocally = (o: CockpitGateInput): boolean => cockpitDispatchMode(o) === "local";

/** The sentence the setup card shows. The `hosted-not-enabled` card renders the SERVER's sentence,
 *  because only the server knows which of plan / ceiling / credit / admission refused. Every other card
 *  keeps the route's own error copy. */
export function cockpitSetupMessage(setup: CockpitSetupState | null, hosted: HostedDispatchFact | null | undefined, error: string | null): string | null {
  return setup === "hosted-not-enabled" ? (hosted?.reason ?? null) : error;
}

/**
 * THE EXECUTOR IS STAMPED HERE, not in the panel that collects the dials. Which engine works a run is
 * a property of the DEPLOYMENT AND THE TENANT, already decided by the gate; a run panel that had to ask
 * would be re-deriving the gate a fourth time. `delivery` is forced with it because ADR-0001 makes
 * hosted pr-only — the route refuses `land` and `branch` with a 400, and arming a request the server
 * is certain to reject would be showing the operator an error instead of a run.
 */
export function armedStartInput(i: StartLoopInput, mode: CockpitDispatchMode): StartLoopInput {
  return mode === "hosted" ? { ...i, executor: "hosted", delivery: "pr" } : i;
}
