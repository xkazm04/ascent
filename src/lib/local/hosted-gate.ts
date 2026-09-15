// THE HOSTED GATE (ADR-0001 §2) — the pure translation of the loop's three self-hosted checks into
// facts a multi-tenant deployment can actually answer, plus the two gates hosted dispatch adds.
//
// This module is PURE: no Prisma, no env, no clock. It is given facts and returns a decision, which
// is what makes the gate table testable as a table rather than as a stack of mocked route calls. The
// facts are read by `resolveHostedGate` in loop-engine.ts, which is the only place that touches IO.
//
// ── THE MAPPING, and why each row is what it is ───────────────────────────────────────────────────
//
//   selfHosted()              a LOCAL lane spawns an agent in a checkout on the server's own disk.
//                             A hosted lane touches no disk, so the check does not apply to it —
//                             and it stays, unchanged and forever, on every /api/org/local/* route.
//   ASCENT_AUTOPILOT=1        a deployment-wide env cannot express "org A opted in, org B did not".
//                             Its cloud equivalent is a per-org ENTITLEMENT (`planAllows`), which is
//                             stored per org and is the deliberate opt-in the env var stood for.
//   a verified local pairing  proves Ascent can reach the code and is allowed to edit it. On cloud
//                             that proof is the repo's recorded ADMISSION decision — `agents-allowed`
//                             — which is a decision a person made and can reverse, not an inference.
//   requireOrgRole("owner")   unchanged. It was already tenancy-correct, and the route still applies
//                             it to every write regardless of executor.
//
// Two gates are ADDED, because a hosted lane spends Ascent's money in the customer's repository and
// the local path never had to answer for either:
//
//   a credit ceiling          refused at ARM time, not discovered mid-cycle.
//   delivery is `pr` only     `land` fast-forwards into a working copy; hosted has none, and a hosted
//                             agent must never write to a customer's default branch.
//
// And one gate is added that is neither tenancy nor money: a deployment that operates NO hosted
// worker cannot arm a hosted lane, because the lane would sit queued forever. That is the honest
// answer to "can this org dispatch?" on every deployment that has not registered a dispatcher — see
// lane-dispatcher.ts for why nothing registers one by default.

/** Why hosted dispatch is refused. Ordered as the gate checks them: deployment, then tenant, then
 *  money, then the per-request facts only an arm attempt knows. */
export type HostedBlock =
  | "unknown-org"
  | "no-dispatcher"
  | "not-entitled"
  | "over-ceiling"
  | "no-credit"
  | "repo-not-admitted"
  | "delivery-not-pr";

/** The facts that decide whether an ORG could arm a hosted run at all — everything the status read
 *  can know without a repo set in hand. */
export interface HostedGateFacts {
  /** `false` ONLY when a DB is configured and no org row matched (deletion / casing / typo). */
  orgExists: boolean;
  /** Does this DEPLOYMENT operate a hosted worker? `hostedDispatchAvailable()`. */
  dispatcherAvailable: boolean;
  /** `planAllows("hostedLoop", plan)` — the per-org opt-in the env var could not express. */
  entitled: boolean;
  /** Is there room under the org's monthly hosted-lane ceiling for at least one more lane? */
  ceilingHeadroom: boolean;
  /** Can the org pay for at least one hosted lane (unlimited plan, or a balance covering its reservation)? */
  creditHeadroom: boolean;
}

/** The org-level block, or null when the org could arm a hosted run. */
export function hostedGateBlock(f: HostedGateFacts): HostedBlock | null {
  if (!f.orgExists) return "unknown-org";
  // Deployment before tenant on purpose: telling an org to upgrade its plan for a capability this
  // deployment does not operate would be selling them something that cannot be delivered.
  if (!f.dispatcherAvailable) return "no-dispatcher";
  if (!f.entitled) return "not-entitled";
  // Ceiling before credit, for the reason `decideHostedCharge` gives: buying credits does not lift it.
  if (!f.ceilingHeadroom) return "over-ceiling";
  if (!f.creditHeadroom) return "no-credit";
  return null;
}

/** One sentence naming the single next action. This string travels to the browser and is rendered
 *  verbatim, so it says what to DO, not what failed. */
export function hostedBlockReason(block: HostedBlock, detail?: string): string {
  switch (block) {
    case "unknown-org":
      return "No such organization.";
    case "no-dispatcher":
      return "This deployment operates no hosted worker, so a hosted run would never be picked up. Self-host Ascent to run local lanes, or point your own agent at this org with a remote-agent run.";
    case "not-entitled":
      return "Hosted loop runs are not included in this organization's plan. Upgrade to dispatch runs from Ascent Cloud.";
    case "over-ceiling":
      return "This organization has reached its monthly ceiling for hosted loop runs. It resets on the 1st (UTC); a larger plan raises it.";
    case "no-credit":
      return "This organization has no credit headroom, and a hosted run spends credits. Add credits to dispatch one.";
    case "repo-not-admitted":
      return `${detail ?? "That repository"} is not admitted for autonomous agents. Set its admission to "agents-allowed" on Governance before dispatching a hosted run into it.`;
    case "delivery-not-pr":
      return "A hosted run delivers pull requests only — Ascent has no working copy of your repository to land into.";
  }
}

/** The HTTP status an arm attempt refused by this block should answer with. Distinct codes on
 *  purpose: 402 is fixable with money, 403 with a decision, 409 not by the caller at all. */
export function hostedBlockStatus(block: HostedBlock): number {
  switch (block) {
    case "unknown-org":
      return 404;
    case "no-dispatcher":
      return 409;
    case "not-entitled":
    case "repo-not-admitted":
      return 403;
    case "over-ceiling":
    case "no-credit":
      return 402;
    case "delivery-not-pr":
      return 400;
  }
}

/**
 * The server's answer to "can this org dispatch?", as it travels on `GET /api/org/loop`.
 *
 * `available` and `enabled` are DIFFERENT facts and the cockpit renders them differently: `available`
 * false means nothing the org does will help (no worker on this deployment), while `enabled` false
 * with `available` true names something an owner can actually go and fix.
 */
export interface HostedDispatchStatus {
  enabled: boolean;
  /** Why not, in one sentence. `null` exactly when `enabled`. */
  reason: string | null;
  available: boolean;
}

export function hostedDispatchStatus(f: HostedGateFacts): HostedDispatchStatus {
  const block = hostedGateBlock(f);
  return {
    enabled: block == null,
    reason: block == null ? null : hostedBlockReason(block),
    available: f.dispatcherAvailable,
  };
}
