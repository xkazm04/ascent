// HOSTED DISPATCH — the IO half of ADR-0001's gate table. `hosted-gate.ts` decides; this module
// reads the facts it decides on, and it is the ONLY place that does.
//
// Two readers, deliberately separate:
//
//   resolveHostedGate(org)      what `GET /api/org/loop` reports as `hosted`. Org-level only: plan
//                               entitlement, credit headroom, and whether this deployment operates a
//                               worker at all. It knows no repo set, so it cannot and does not
//                               pretend to answer "may you dispatch into THAT repo".
//   admissionBlockFor(org, …)   the per-repo half, which only an arm attempt can ask. One refusal
//                               refuses the WHOLE run for the same reason a broken pairing does in
//                               `startLoopRun`: a half-armed run that discovers the problem three
//                               lanes in has already spent on the others.
//
// THE STATUS READ IS A HEADROOM CHECK, NOT A DEBIT. The per-org ceiling (ADR-0001 T2) debits at ARM
// time, in `startHostedRun` through `reserveHostedRunCredits`; what this reader reports is only whether
// ONE more lane would pass that decision, so the cockpit can name the block before an owner clicks.
//
// And a third caller: `dispatchHostedLane` is the ONLY sanctioned way to hand a lane to the registered
// `LaneDispatcher`. It re-checks the ceiling first, so the spend limit sits in front of every dispatch
// and not just every arm — a plan downgraded after arming stops at the next lane, not the next month.

import { readHostedCeilingState, type HostedCeilingState } from "@/lib/db/hosted-credits";
// The NON-SEEDING admission reader: this is a gate, and a gate must not create the decision row it is
// about to read. Same reason the two other gate surfaces use it (org-admission.ts:179).
import { readRepoAdmission } from "@/lib/db/org-admission";
import { planAllowsHostedLoop } from "@/lib/plans";
import { getLaneDispatcher, hostedDispatchAvailable, type DispatchResult, type HostedLaneRef } from "@/lib/local/lane-dispatcher";
import { hostedBlockReason, hostedDispatchStatus, type HostedBlock, type HostedDispatchStatus, type HostedGateFacts } from "@/lib/local/hosted-gate";
import { decideHostedCharge, withinCeilingAtDispatch } from "@/lib/local/hosted-ceiling";

export type { HostedBlock, HostedDispatchStatus, HostedGateFacts };

/** Read the org-level facts ADR-0001's gate table turns into an answer. */
export async function resolveHostedFacts(orgSlug: string): Promise<HostedGateFacts> {
  const state = await readHostedCeilingState(orgSlug).catch(() => null);
  return hostedFactsFrom(state, hostedDispatchAvailable());
}

/** Turn a ceiling read into gate facts. Pure, exported for the tests. An unreadable state (no DB, or
 *  the read threw) is UNKNOWN, and an unknown answer to "can this org pay" is a refusal, not a pass. */
export function hostedFactsFrom(state: HostedCeilingState | null, dispatcherAvailable: boolean): HostedGateFacts {
  if (!state) return { orgExists: false, dispatcherAvailable, entitled: false, ceilingHeadroom: false, creditHeadroom: false };
  const one = decideHostedCharge({ lanes: 1, ...state });
  return {
    orgExists: state.orgExists,
    dispatcherAvailable,
    entitled: planAllowsHostedLoop(state.plan),
    ceilingHeadroom: one.ok || one.block !== "over-ceiling",
    creditHeadroom: one.ok || one.block !== "no-credit",
  };
}

/**
 * Hand one queued hosted lane to the registered dispatcher, BEHIND THE CEILING.
 *
 * A refusal is data (`DispatchResult`), never a throw, for the dispatcher contract's reason: one lane
 * that cannot be handed off must not abort the drain of the rest. What it refuses on:
 *   • no dispatcher registered (nothing to hand the lane to);
 *   • the ceiling state is unreadable (unknown spend is not permission to spend);
 *   • the org is no longer entitled, or is past its ceiling with this lane counted.
 * The balance is NOT re-checked: this lane's credits were debited when it was armed.
 */
export async function dispatchHostedLane(
  lane: HostedLaneRef,
  deps: { state?: (org: string) => Promise<HostedCeilingState | null> } = {},
): Promise<DispatchResult> {
  const dispatcher = getLaneDispatcher();
  if (!dispatcher) return { ok: false, reason: hostedBlockReason("no-dispatcher") };
  const state = await (deps.state ?? readHostedCeilingState)(lane.orgSlug).catch(() => null);
  if (!state || !state.orgExists) return { ok: false, reason: "Could not read this organization's hosted spend, so the lane was not dispatched." };
  if (!planAllowsHostedLoop(state.plan)) return { ok: false, reason: hostedBlockReason("not-entitled") };
  if (!withinCeilingAtDispatch(state.spentThisMonth, state.ceiling)) return { ok: false, reason: hostedBlockReason("over-ceiling") };
  return dispatcher.dispatch(lane);
}

/** The `hosted` field on `GET /api/org/loop` — the server fact the cockpit's gate reads instead of
 *  inferring dispatch capability from deployment mode in the browser. */
export async function resolveHostedGate(orgSlug: string): Promise<HostedDispatchStatus> {
  return hostedDispatchStatus(await resolveHostedFacts(orgSlug));
}

/**
 * The per-repo gate: every repo in the set must carry a recorded admission of `agents-allowed`.
 *
 * Returns the first offending repo, or null when the whole set is admitted. A repo with NO admission
 * row and no assessed tier reads as not admitted — `readRepoAdmission` returns null there, and
 * treating an absent decision as permission is the one reading this gate must never take.
 */
export async function firstUnadmittedRepo(orgSlug: string, repos: readonly string[]): Promise<string | null> {
  for (const repo of repos) {
    const row = await readRepoAdmission(orgSlug, repo).catch(() => null);
    if (!row || row.mode !== "agents-allowed") return repo;
  }
  return null;
}
