// Fail-reason catalog for the "Where the fleet fails" card — pure data, no JSX. Moved out of the old
// governance page.tsx unchanged (docs/ORG-TABS-REFACTOR.md: pure fns/data get their own camelCase
// module before JSX gets split further).

import type { GateFailure } from "@/lib/scoring/gate";

/**
 * EVERY code the gate can emit, labelled. Typed as a total `Record` over `GateFailure["code"]` on
 * purpose: the list used to be a hand-maintained array and had silently fallen two codes behind the
 * union — `provenance` (the AI-review bar, W2) and `incomplete` (the not-judged bucket) had no entry,
 * so a fleet failing for either rendered a card with no bar for it and a reader concluded nothing had
 * failed. With a Record, adding a code to the union without a label here is a compile error, so this
 * list cannot drift again. Key order is display order.
 */
const FAIL_REASON_LABELS: Record<GateFailure["code"], string> = {
  level: "Below required level",
  dimension: "A dimension below floor",
  posture: "Ungoverned posture",
  overall: "Below overall score",
  // Surface the protected-branch condition now that the fleet view actually evaluates it
  // (ci-gate-status-checks #1) — previously this bar was advertised but never enforced here.
  governance: "Unprotected default branch",
  provenance: "AI changes merged without human review",
  // Not a gate failure: the repo scored nothing, so it was never judged. It has a bar because the
  // alternative is a card that omits it entirely and reads as an all-clear (the same reason the card's
  // empty state names this bucket by hand).
  incomplete: "Scored nothing — not judged",
};

export const GOVERNANCE_FAIL_REASONS = (Object.keys(FAIL_REASON_LABELS) as GateFailure["code"][]).map(
  (key) => ({ key, label: FAIL_REASON_LABELS[key] }),
);
