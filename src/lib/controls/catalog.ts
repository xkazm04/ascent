// The control CATALOGUE — the human-facing half of the frozen control vocabulary (moonshot #1).
//
// The ids and the state mapping are NOT defined here. `src/lib/scan-probe-controls.ts` (W3-L) owns
// both: `CONTROL_IDS` is the kebab-case catalogue and `governanceToSamples`/`postureToSamples`/
// `repoMetaToSamples` are the only mappers from a read to a `ControlState`. Duplicating either here
// would give the ledger two catalogues that drift — the exact failure this file exists to prevent.
//
// What this module adds is everything a HUMAN surface needs and a probe does not: a label, a scope,
// which sources can ever produce the control, and one sentence saying what a `fail` on it means.
// The timeline card, the conformance pack and the alert message all read those from here, so a
// control renamed for readability changes one string in one file.

import { CONTROL_IDS, GOVERNANCE_CONTROL_IDS, POSTURE_CONTROL_IDS } from "@/lib/scan-probe-controls";
import type { ControlState, ObservationSource } from "@/lib/db/control-observations";

export interface ControlDef {
  id: string;
  label: string;
  /** `repo` controls are observed per repository; `org` controls hold for the whole installation. */
  scope: "repo" | "org";
  /** Which provenances can ever produce this control. A control the App cannot observe live says so
   *  rather than letting a coverage read imply a webhook gap that never existed. */
  sources: readonly ObservationSource[];
  /** What a `fail` on this control MEANS. Printed beside the state so nobody reads "fail" as
   *  "insecure" on a descriptor control. */
  failMeans: string;
  /** True when the control is a DESCRIPTOR rather than a bar (`repo-visibility`): its state is always
   *  `pass` and the fact lives in `value`, so a surface must render the value, not the state. */
  descriptor?: boolean;
}

const SCAN_PROBE: readonly ObservationSource[] = ["scan", "probe"];

/**
 * Every control the ledger can carry, in catalogue order.
 *
 * Order is the order a reader should meet them: the branch-protection bar first (the controls a
 * change-management examiner asks about), then the org-level posture, then the repo descriptors that
 * explain why a bar might be unreadable.
 */
export const CONTROLS: readonly ControlDef[] = [
  {
    id: CONTROL_IDS.branchProtection,
    label: "Branch protection",
    scope: "repo",
    sources: SCAN_PROBE,
    failMeans: "The default branch carries no protection rule.",
  },
  {
    id: CONTROL_IDS.requiredPullRequest,
    label: "Pull request required",
    scope: "repo",
    sources: SCAN_PROBE,
    failMeans: "The default branch accepts direct pushes.",
  },
  {
    id: CONTROL_IDS.requiredApprovals,
    label: "Required approvals",
    scope: "repo",
    sources: SCAN_PROBE,
    failMeans: "No approving review is required before merge. The count is the value.",
  },
  {
    id: CONTROL_IDS.requiredCodeOwnerReview,
    label: "Code-owner review",
    scope: "repo",
    sources: SCAN_PROBE,
    failMeans: "A code owner's approval is not required.",
  },
  {
    id: CONTROL_IDS.requiredStatusChecks,
    label: "Status checks",
    scope: "repo",
    sources: SCAN_PROBE,
    failMeans: "No status check must pass before merge.",
  },
  {
    id: CONTROL_IDS.signedCommits,
    label: "Signed commits",
    scope: "repo",
    sources: SCAN_PROBE,
    failMeans: "Commit signatures are not required.",
  },
  {
    id: CONTROL_IDS.linearHistory,
    label: "Linear history",
    scope: "repo",
    sources: SCAN_PROBE,
    failMeans: "Merge commits are permitted on the default branch.",
  },
  {
    id: CONTROL_IDS.rulesetCount,
    label: "Repository rulesets",
    scope: "repo",
    sources: SCAN_PROBE,
    failMeans: "No repository ruleset applies. The rule count is the value.",
  },
  {
    id: CONTROL_IDS.orgSecurityPolicy,
    label: "Security policy",
    scope: "org",
    sources: SCAN_PROBE,
    failMeans: "No SECURITY.md was found for the organization.",
  },
  {
    id: CONTROL_IDS.advisories,
    label: "Published advisories",
    scope: "repo",
    sources: SCAN_PROBE,
    failMeans: "No coordinated-disclosure advisory was observed. NOT a statement that the repo is insecure.",
  },
  {
    id: CONTROL_IDS.repoVisibility,
    label: "Visibility",
    scope: "repo",
    sources: SCAN_PROBE,
    descriptor: true,
    failMeans: "Never fails — this control reports the visibility in its value.",
  },
  {
    id: CONTROL_IDS.repoArchived,
    label: "Not archived",
    scope: "repo",
    sources: SCAN_PROBE,
    failMeans: "The repository is archived: nothing in it can be remediated.",
  },
  {
    id: CONTROL_IDS.repoPresent,
    label: "Repository reachable",
    scope: "repo",
    sources: SCAN_PROBE,
    failMeans: "GitHub answered 404 — renamed, deleted, or moved beyond this installation's token.",
  },
];

const BY_ID = new Map(CONTROLS.map((c) => [c.id, c]));

/** The catalogue entry, or null for an id the catalogue does not know. Null rather than a synthesized
 *  entry: a row carrying an unknown control id is a real fact (an older row, a future control) and a
 *  surface should say "unknown control" rather than invent a label for it. */
export function controlDef(id: string): ControlDef | null {
  return BY_ID.get(id) ?? null;
}

/** The label a human sees. Falls back to the raw id — never to a blank or a guess. */
export function controlLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

/** Catalogue order for sorting a timeline. Unknown ids sort last, in id order, rather than jumping
 *  to the front on a `-1` from an `indexOf` miss. */
export function controlOrder(id: string): number {
  const i = CONTROLS.findIndex((c) => c.id === id);
  return i === -1 ? CONTROLS.length : i;
}

/** The governance-derived subset — the controls a branch-protection read produces. Re-exported from
 *  W3-L's module so there is one list, not two. */
export { GOVERNANCE_CONTROL_IDS, POSTURE_CONTROL_IDS, CONTROL_IDS };

/**
 * How a state should READ on a surface.
 *
 * `unmeasurable` is deliberately not given a colour word: it is neither good nor bad, it is absent
 * evidence, and every renderer that colours it inherits the mistake of treating a read failure as a
 * finding. The whole honesty contract of this item lives in that third arm.
 */
export function stateTone(state: ControlState): "good" | "bad" | "unknown" {
  return state === "pass" ? "good" : state === "fail" ? "bad" : "unknown";
}
