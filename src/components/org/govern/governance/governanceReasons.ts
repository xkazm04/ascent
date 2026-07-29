// Fail-reason catalog for the "Where the fleet fails" card — pure data, no JSX. Moved out of the old
// governance page.tsx unchanged (docs/ORG-TABS-REFACTOR.md: pure fns/data get their own camelCase
// module before JSX gets split further).

export const GOVERNANCE_FAIL_REASONS = [
  { key: "level", label: "Below required level" },
  { key: "dimension", label: "A dimension below floor" },
  { key: "posture", label: "Ungoverned posture" },
  { key: "overall", label: "Below overall score" },
  // Surface the protected-branch condition now that the fleet view actually evaluates it
  // (ci-gate-status-checks #1) — previously this bar was advertised but never enforced here.
  { key: "governance", label: "Unprotected default branch" },
] as const;
