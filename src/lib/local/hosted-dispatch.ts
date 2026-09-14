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
// THE CREDIT READ IS A HEADROOM CHECK, NOT A DEBIT. ADR-0001 makes per-lane metering a precondition
// of the first hosted lane rather than a follow-up, and that precondition is enforced structurally:
// nothing registers a `LaneDispatcher`, so `dispatcherAvailable` is false, so no hosted run can be
// armed on any deployment today. When a dispatcher is registered, this refusal is what stops a run
// with no headroom from being armed — the debit itself belongs with the metering work (ADR-0001 T2)
// and is deliberately not faked here with an invented per-lane price.

import { getCreditState } from "@/lib/db/credits";
// The NON-SEEDING admission reader: this is a gate, and a gate must not create the decision row it is
// about to read. Same reason the two other gate surfaces use it (org-admission.ts:179).
import { readRepoAdmission } from "@/lib/db/org-admission";
import { planAllowsHostedLoop } from "@/lib/plans";
import { hostedDispatchAvailable } from "@/lib/local/lane-dispatcher";
import { hostedDispatchStatus, type HostedBlock, type HostedDispatchStatus, type HostedGateFacts } from "@/lib/local/hosted-gate";

export type { HostedBlock, HostedDispatchStatus, HostedGateFacts };

/** Read the org-level facts ADR-0001's gate table turns into an answer. */
export async function resolveHostedFacts(orgSlug: string): Promise<HostedGateFacts> {
  const credit = await getCreditState(orgSlug).catch(() => null);
  // An unreadable credit state is UNKNOWN, and an unknown answer to "can this org pay" is a refusal,
  // not a pass. `orgExists: false` is the block the caller turns into a 404.
  if (!credit) return { orgExists: false, dispatcherAvailable: hostedDispatchAvailable(), entitled: false, creditHeadroom: false };
  return {
    orgExists: credit.orgExists !== false,
    dispatcherAvailable: hostedDispatchAvailable(),
    entitled: planAllowsHostedLoop(credit.plan),
    creditHeadroom: credit.unlimited || credit.balance > 0,
  };
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
