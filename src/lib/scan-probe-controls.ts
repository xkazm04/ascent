// PURE mappers for the control probe (moonshot #10, lane W3-L). No I/O, no DB, no clock of its own —
// every function here takes what was read and returns what should be recorded, so the whole
// unknown-is-not-off discipline and the heartbeat arithmetic are testable without a network or a
// database.
//
// The vocabulary is the reconciled one (W3-#1): kebab-case control ids, and
// `state ∈ pass | fail | unmeasurable`. The mapping from this lane's original spec is exact:
// `unknown` → `unmeasurable`, and **unmeasurable never means off** — a control we could not read is
// not a control we observed to be absent.

import type { Governance, SecurityPosture } from "@/lib/types";
import type { ControlObservationRow, ControlSample, ControlState } from "@/lib/db/control-observations";

/**
 * The controls a probe can observe — a 1:1 projection of `Governance` + `SecurityPosture` + repo
 * metadata. Frozen for W3-M: the governance ledger's catalogue, timeline and pack all key on these.
 */
export const CONTROL_IDS = {
  branchProtection: "branch-protection",
  requiredPullRequest: "required-pull-request",
  requiredApprovals: "required-approvals",
  requiredCodeOwnerReview: "required-code-owner-review",
  requiredStatusChecks: "required-status-checks",
  signedCommits: "signed-commits",
  linearHistory: "linear-history",
  rulesetCount: "ruleset-count",
  orgSecurityPolicy: "org-security-policy",
  advisories: "advisories",
  repoVisibility: "repo-visibility",
  repoArchived: "repo-archived",
  repoPresent: "repo-present",
} as const;

/** Every governance-derived control, in catalogue order. Used to emit a complete `unmeasurable` set
 *  when the protection-bearing read was denied. */
export const GOVERNANCE_CONTROL_IDS: readonly string[] = [
  CONTROL_IDS.branchProtection,
  CONTROL_IDS.requiredPullRequest,
  CONTROL_IDS.requiredApprovals,
  CONTROL_IDS.requiredCodeOwnerReview,
  CONTROL_IDS.requiredStatusChecks,
  CONTROL_IDS.signedCommits,
  CONTROL_IDS.linearHistory,
  CONTROL_IDS.rulesetCount,
];

export const POSTURE_CONTROL_IDS: readonly string[] = [CONTROL_IDS.orgSecurityPolicy, CONTROL_IDS.advisories];

/** Repo metadata a probe reads from `GET /repos/{owner}/{repo}`. Null = the read failed for a reason
 *  other than 404 (which is `present: false`, a real observation). */
export interface RepoMeta {
  present: boolean;
  visibility: "public" | "private" | null;
  archived: boolean | null;
  defaultBranch: string | null;
}

const unmeasurable = (controlId: string): ControlSample => ({ controlId, state: "unmeasurable", value: null });

/** A boolean control: observed-on = pass, observed-off = fail. Only a caller that COULD read emits it. */
function bool(controlId: string, on: boolean, evidence?: Record<string, unknown>): ControlSample {
  return { controlId, state: on ? "pass" : "fail", value: on ? "true" : "false", evidence };
}

/**
 * Default-branch governance → samples.
 *
 * `g === null` means the protection-bearing read was DENIED or absent (`fetchBranchGovernance`
 * returns null rather than inventing `protected: false`), and so does `g.readable === false`. Both
 * emit the full governance set as `unmeasurable`: recording "we could not read this" for every
 * control is what lets a later successful read register as a transition, and what stops the pack
 * from reporting an unreadable repo as an unprotected one.
 */
export function governanceToSamples(g: Governance | null): ControlSample[] {
  if (!g || !g.readable) return GOVERNANCE_CONTROL_IDS.map(unmeasurable);
  const branch = { branch: g.defaultBranch };
  return [
    bool(CONTROL_IDS.branchProtection, g.protected, branch),
    bool(CONTROL_IDS.requiredPullRequest, g.requiresPullRequest, branch),
    {
      controlId: CONTROL_IDS.requiredApprovals,
      // A required-approvals count of 0 is "no approval bar", which is an observed absence, not an
      // unreadable one. The COUNT rides in `value`, so 2 → 1 is a change even though both pass.
      state: (g.requiredApprovals > 0 ? "pass" : "fail") as ControlState,
      value: String(g.requiredApprovals),
      evidence: branch,
    },
    bool(CONTROL_IDS.requiredCodeOwnerReview, g.requiresCodeOwnerReview, branch),
    bool(CONTROL_IDS.requiredStatusChecks, g.requiresStatusChecks, branch),
    bool(CONTROL_IDS.signedCommits, g.requiresSignatures, branch),
    bool(CONTROL_IDS.linearHistory, g.linearHistory, branch),
    {
      controlId: CONTROL_IDS.rulesetCount,
      state: (g.ruleCount > 0 ? "pass" : "fail") as ControlState,
      value: String(g.ruleCount),
      evidence: branch,
    },
  ];
}

/**
 * GitHub-native security posture → samples.
 *
 * `advisories` records the published-advisory count as a positive maturity signal (an active
 * coordinated-disclosure program), exactly as `SecurityPosture` documents it. `fail` there means "no
 * published advisory program observed" — never "this repo is insecure"; the count in `value` is the
 * fact, and the state is only the bar.
 */
export function postureToSamples(p: SecurityPosture | null): ControlSample[] {
  if (!p) return POSTURE_CONTROL_IDS.map(unmeasurable);
  return [
    bool(CONTROL_IDS.orgSecurityPolicy, p.orgSecurityPolicy),
    {
      controlId: CONTROL_IDS.advisories,
      state: (p.advisoryCount > 0 ? "pass" : "fail") as ControlState,
      // The count is a FLOOR when the API page filled — say so rather than asserting an exact number.
      value: p.advisoryCapped ? `${p.advisoryCount}+` : String(p.advisoryCount),
      evidence: { capped: p.advisoryCapped },
    },
  ];
}

/**
 * Repo metadata → samples.
 *
 * `repo-present` is the one this lane exists for: `reconcileListedRepos` never runs for an
 * App-installed org, so a renamed/archived/deleted private repo burned a rescan slot forever with
 * nothing to notice. A 404 on the per-repo read IS the observation (`fail`); any other failure is
 * `unmeasurable`, so a GitHub blip can never flag a live repo as gone.
 *
 * `repo-visibility` is a DESCRIPTOR, not a bar — it is always `pass`, and the fact lives in `value`.
 * A public → private flip therefore still registers as a change, because the ledger's transition
 * test compares the (state, value) pair rather than the state alone.
 */
export function repoMetaToSamples(m: RepoMeta | null): ControlSample[] {
  if (!m) return [CONTROL_IDS.repoPresent, CONTROL_IDS.repoVisibility, CONTROL_IDS.repoArchived].map(unmeasurable);
  if (!m.present) {
    return [
      { controlId: CONTROL_IDS.repoPresent, state: "fail", value: "false" },
      unmeasurable(CONTROL_IDS.repoVisibility),
      unmeasurable(CONTROL_IDS.repoArchived),
    ];
  }
  return [
    { controlId: CONTROL_IDS.repoPresent, state: "pass", value: "true" },
    m.visibility
      ? { controlId: CONTROL_IDS.repoVisibility, state: "pass" as ControlState, value: m.visibility }
      : unmeasurable(CONTROL_IDS.repoVisibility),
    m.archived === null
      ? unmeasurable(CONTROL_IDS.repoArchived)
      : // An archived repo is a governance-relevant degraded state (nothing can be fixed in it), so
        // "archived" is the FAIL side of this control.
        { controlId: CONTROL_IDS.repoArchived, state: (m.archived ? "fail" : "pass") as ControlState, value: String(m.archived) },
  ];
}

/** 24h — the heartbeat window. One re-assertion per control per day is enough to prove continuity
 *  without turning the ledger into a log. */
export const HEARTBEAT_AFTER_MS = 24 * 60 * 60_000;

/**
 * Decide which samples are worth writing: everything that CHANGED since the last observation, plus
 * any control whose last row is older than `heartbeatAfterMs` (flagged `heartbeat`, so the writer
 * knows it is a re-assertion and not a transition).
 *
 * A control with no previous row at all is always written — that first row is the baseline the whole
 * chain hangs off. Everything else unchanged and recently seen is dropped: 100 identical probes over
 * 25h write 2 rows per control, not 100.
 */
export function diffSamples(
  prev: readonly ControlObservationRow[],
  next: readonly ControlSample[],
  heartbeatAfterMs: number,
  now: number,
): ControlSample[] {
  const prevBy = new Map(prev.map((p) => [p.controlId, p]));
  const out: ControlSample[] = [];
  for (const s of next) {
    const p = prevBy.get(s.controlId);
    if (!p) {
      out.push(s); // baseline
      continue;
    }
    if (p.state !== s.state || p.value !== s.value) {
      out.push(s);
      continue;
    }
    const observedAt = Date.parse(p.observedAt);
    // An unparseable stamp is treated as due rather than as fresh: re-asserting one extra row is
    // cheap, while wrongly reading a broken stamp as "seen recently" silently ends the heartbeat.
    if (!Number.isFinite(observedAt) || now - observedAt >= heartbeatAfterMs) out.push({ ...s, heartbeat: true });
  }
  return out;
}
