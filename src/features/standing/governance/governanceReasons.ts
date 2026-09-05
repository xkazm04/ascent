// Fail-reason catalog for the "Where the fleet fails" card — pure data, no JSX. Moved out of the old
// governance page.tsx unchanged (docs/ORG-TABS-REFACTOR.md: pure fns/data get their own camelCase
// module before JSX gets split further).

import type { GateFailure, GatePolicy } from "@/lib/scoring/gate";

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
  // #8 — the repo's admission decision is "blocked" and AI authorship was nevertheless observed.
  admission: "AI authorship in a blocked repository",
  // #16 — a control the repo's own doctor run reports failing.
  control: "A required control is failing",
  // Not a gate failure: the repo scored nothing, so it was never judged. It has a bar because the
  // alternative is a card that omits it entirely and reads as an all-clear (the same reason the card's
  // empty state names this bucket by hand).
  incomplete: "Scored nothing — not judged",
};

/**
 * Conditions the FLEET path cannot judge — ever, by construction — and which must therefore never
 * render as a measured "0 repos".
 *
 * `evaluateGateLite` scores from the rollup's persisted numbers. A rollup row carries no conformance
 * ledger and no PR stats, so `control` (#16) and `admission` (#8) are skipped on every repo, every
 * time. `governance.ts` says exactly this in a comment — *"these stay 0 honestly, because the
 * criteria were never DUE here"* — and the comment never reached the screen: a lead who had just
 * declared two required controls read "A required control is failing — 0 repos" beside five
 * genuinely measured rows while the per-repo CI gate blocked PRs on precisely those controls
 * (UAT 2026-08-30, PRIYA-L1-02). A structural zero rendered as a measurement is a lie the dashboard
 * tells with a straight face; these rows say "not judged fleet-wide" instead.
 *
 * NOTE the two that look similar but are NOT here: `provenance` and `governance` are real fleet
 * measurements — the rollup carries `aiGovernedRate` / `aiPrSample` and the branch-protection fields,
 * and `evaluateGateLite` evaluates both (honest-null skip per repo when unmeasurable). Their zeros
 * are earned. Only add a code here when the fleet path can never evaluate it at all.
 */
export const FLEET_UNJUDGED_REASONS = new Set<GateFailure["code"]>(["admission", "control"]);

/** Where a condition IS judged, for the row that cannot be judged here. */
export const FLEET_UNJUDGED_NOTE = "not judged fleet-wide — the per-repo gate decides it";

/** Does the org's stored bar actually carry a criterion the fleet view cannot judge? */
export function unjudgedBarsDeclared(p: GatePolicy | null): boolean {
  return Boolean(p?.requireChecks?.length || p?.forbidAiAuthorship);
}

/**
 * The escalation for ONE unjudged row: what this operator has declared under it, in her own numbers.
 *
 * WHY PER-ROW (UAT `RC-N2`). `unjudgedBarsDeclared` reached only the all-clear sentence, so the two
 * unjudged rows printed the identical em-dash line whether the org had declared nothing or had just
 * set two required controls — and the strongest reading of `PRIYA-L1-02` is precisely the lead who
 * HAD. "Not judged fleet-wide" is true either way and says nothing about her stake in it; this
 * sentence is the half that does. Null when she has declared nothing under the row, because there is
 * then nothing to acknowledge and an empty escalation is worse than none.
 *
 * The counts come from the stored policy, never from a literal: the row must not be able to say
 * "2 of these" while the editor holds three.
 */
export function unjudgedBarDeclaration(code: GateFailure["code"], p: GatePolicy | null): string | null {
  if (code === "control") {
    const n = p?.requireChecks?.length ?? 0;
    return n ? `you have declared ${n} required control${n === 1 ? "" : "s"}; the per-repo gate enforces ${n === 1 ? "it" : "them"}` : null;
  }
  if (code === "admission") {
    return p?.forbidAiAuthorship ? "you have declared this bar; the per-repo gate enforces it" : null;
  }
  return null;
}

/**
 * The words an EARNED zero gets (UAT `RC-N3`). A structural zero already has its own sentence
 * (`FLEET_UNJUDGED_NOTE`); a measured zero had only the glyph, and a reader cannot tell "14 repos
 * carried the inputs and none failed" from "nothing here could be measured" — the same complaint
 * `FLEET_UNJUDGED_REASONS` answered one column over. Composed from the overview's own counts.
 *
 * Null for every non-zero count (the meter speaks for itself) and for every code whose inputs are
 * present on every judged repo by construction — those never appear in `measuredOn`.
 */
export function earnedZeroNote(
  code: GateFailure["code"],
  count: number,
  assessed: number,
  measuredOn: Partial<Record<GateFailure["code"], number>>,
  barSet: Partial<Record<GateFailure["code"], boolean>>,
): string | null {
  if (count !== 0) return null;
  const measured = measuredOn[code];
  if (measured === undefined) return null;
  // A bar nobody set is not a bar every repo cleared. Said first, because it explains the zero
  // completely and the sample size is then beside the point.
  if (barSet[code] === false) return "not part of this org's bar";
  if (measured === 0) return assessed ? `no judged repo carried the inputs (0 of ${assessed})` : "nothing judged yet";
  return `measured on ${measured} of ${assessed} judged repo${assessed === 1 ? "" : "s"}`;
}

export const GOVERNANCE_FAIL_REASONS = (Object.keys(FAIL_REASON_LABELS) as GateFailure["code"][]).map(
  (key) => ({ key, label: FAIL_REASON_LABELS[key], fleetJudged: !FLEET_UNJUDGED_REASONS.has(key) }),
);
