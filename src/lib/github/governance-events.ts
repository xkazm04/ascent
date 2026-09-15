// PURE normalizers for governance-bearing webhook deliveries (moonshot #1). No I/O, no DB, no clock.
//
// ── What this module does NOT do, and why ────────────────────────────────────────────────────────
//
// It does not turn a webhook payload into a control STATE. W3-L's ledger contract is explicit that
// "a `branch_protection_rule.deleted` delivery is treated as 're-read this repo', not as 'protection
// is off'", because a validly-signed but replayed or misrouted delivery would otherwise write a false
// governance record that outlives it. Only the probe's own re-read from GitHub produces a state.
//
// There is also a mechanical reason, and it is the sharper one: the probe diffs against the NEWEST
// observation. A webhook row asserting `fail` would become that newest observation, so when the probe
// re-read and confirmed `fail` seconds later it would find nothing changed and write nothing — and
// the alert path, which reads `transition: true` rows, would never fire. Payload-sourced state
// wouldn't merely be weaker evidence; it would SWALLOW the alert it was meant to raise.
//
// ── What it does instead ─────────────────────────────────────────────────────────────────────────
//
// A delivery carries two things the probe genuinely cannot recover afterwards: WHO acted, and WHEN.
// `normalizeGovernanceEvent` extracts exactly those, plus which controls the event touches, and the
// caller writes an ATTRIBUTION row per control whose state and value are copied UNCHANGED from the
// current observation. Because the (state, value) pair is unchanged, the row is not a transition, it
// cannot mask the probe's, and it asserts nothing about the control — it records "GitHub told us
// <login> touched this control area at <time>", which is true, useful and modest.
//
// Unknown event, unparseable payload, or no actor: `[]`. Never a throw — a normalizer that can fail
// the webhook handler is a normalizer that drops deliveries.

/** Which controls an event's payload bears on, and who moved them. */
export interface GovernanceAttribution {
  controlIds: string[];
  /** GitHub login of the actor GitHub named. Null when the payload carried none — never invented. */
  actorLogin: string | null;
  /** ISO instant the event happened, when the payload states one; else null (the caller stamps its
   *  own receipt time rather than this module guessing at one). */
  occurredAt: string | null;
  /** The citable slice: the event, its action, and the rule/ruleset name when there is one. */
  evidence: Record<string, unknown>;
}

// The control ids each subscribed event bears on. Kept as literal strings rather than importing
// CONTROL_IDS so this module stays free of the probe's import graph; `governance-events.test.ts`
// asserts every id here exists in the catalogue, which is the guard that actually matters.
const BRANCH_PROTECTION_CONTROLS = [
  "branch-protection",
  "required-pull-request",
  "required-approvals",
  "required-code-owner-review",
  "required-status-checks",
  "signed-commits",
  "linear-history",
];

const EVENT_CONTROLS: Record<string, string[]> = {
  branch_protection_rule: BRANCH_PROTECTION_CONTROLS,
  // A ruleset can enforce any of the branch-protection bars PLUS the ruleset count itself.
  repository_ruleset: [...BRANCH_PROTECTION_CONTROLS, "ruleset-count"],
  // A repository event moves the descriptors, not the bars: renamed, archived, privatised, deleted.
  repository: ["repo-visibility", "repo-archived", "repo-present"],
  // Owner-level access changes. Deliberately NOT mapped to a membership or RBAC control: identity-
  // graph modelling is deck item #21, and inventing a control id for it here would pre-empt it.
  member: [],
  team: [],
};

type Payload = {
  action?: unknown;
  sender?: { login?: unknown };
  rule?: { name?: unknown; updated_at?: unknown };
  repository_ruleset?: { name?: unknown; updated_at?: unknown };
  repository?: { updated_at?: unknown; full_name?: unknown };
};

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** ISO-normalize a GitHub timestamp, or null. GitHub sends ISO-8601; anything unparseable is dropped
 *  rather than passed through, so a malformed stamp can never land on an evidence row. */
function iso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Read a governance-bearing delivery into the attribution the ledger can record.
 *
 * Returns null (not a throw, not a partial object) for an event this module does not subscribe, for
 * a payload that is not an object, and for an event whose control list is empty — there is nothing
 * to attribute against.
 */
export function normalizeGovernanceEvent(event: string, payload: unknown): GovernanceAttribution | null {
  const controlIds = EVENT_CONTROLS[event];
  if (!controlIds || controlIds.length === 0) return null;
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Payload;

  const ruleName = str(p.rule?.name) ?? str(p.repository_ruleset?.name);
  const evidence: Record<string, unknown> = { event, action: str(p.action) ?? null };
  if (ruleName) evidence.rule = ruleName;

  return {
    controlIds: [...controlIds],
    actorLogin: str(p.sender?.login),
    occurredAt: iso(p.rule?.updated_at) ?? iso(p.repository_ruleset?.updated_at) ?? iso(p.repository?.updated_at),
    evidence,
  };
}

/** Every event this module can normalize — the subscription list a caller should route on. */
export const GOVERNANCE_EVENTS: readonly string[] = Object.entries(EVENT_CONTROLS)
  .filter(([, ids]) => ids.length > 0)
  .map(([e]) => e);

// ── The AI-change reducer's half of the same webhook fan-in ──────────────────────────────────────

export interface ReviewApproval {
  prNumber: number;
  /** The login GitHub named as the reviewer. Null on a deleted account — never a placeholder. */
  approverLogin: string | null;
  /** The review's OWN submission time, as GitHub reports it. Distinct from when we observed it. */
  approvedAt: string | null;
}

/**
 * Read an approving review off a `pull_request_review` delivery.
 *
 * Only `action === "submitted"` with `state === "approved"` counts. A `dismissed` review is NOT a
 * negative signal here: the row's `approved` flag is never turned OFF by a webhook, because a
 * dismissal we happen to observe and one we happen to miss would then produce different stored
 * evidence for the same repository. The next scan re-reads the full review set and is authoritative
 * for withdrawal.
 */
export function readReviewApproval(payload: unknown): ReviewApproval | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as {
    action?: unknown;
    review?: { state?: unknown; user?: { login?: unknown }; submitted_at?: unknown };
    pull_request?: { number?: unknown };
  };
  if (str(p.action) !== "submitted") return null;
  // GitHub sends the review state lower-cased on webhooks and upper-cased on the REST/GraphQL read.
  if (str(p.review?.state)?.toLowerCase() !== "approved") return null;
  const prNumber = typeof p.pull_request?.number === "number" ? p.pull_request.number : null;
  if (prNumber === null) return null;
  return {
    prNumber,
    approverLogin: str(p.review?.user?.login),
    approvedAt: iso(p.review?.submitted_at),
  };
}
