// The Skills tab's view model: a skill's LIFECYCLE (authored → adopted → copied → run → quiet) as the
// §2.4 state vocabulary, so the tab can draw it instead of badging and describing it.
//
// THE DISTINCTION THIS FILE EXISTS TO KEEP. `src/lib/org/skill-usage.ts` already splits `dormant`
// into three states with three different remedies — `abandoned` (used, then silence), `unused` (never
// used, but this org's event pathway demonstrably works) and `unmeasured` (no skill event of any kind
// has EVER been recorded for this org). The UI then collapsed all three back into one amber "dormant"
// chip, which is the exact conflation the redesign is about: a skill nobody ever measured was painted
// with the same warning as one the fleet tried and dropped. `unmeasured` is `not-judged` here — a
// hatch, and `rendersValue` is false for it, so a cell or badge in that state STRUCTURALLY cannot
// print a duration or a count.
//
// Pure: no JSX, no hooks, no DB import. Every encoding is the kit's; nothing is re-defined here.

import type { MatrixCell, MatrixRow, VizState } from "@/components/org/viz";
import type { OutcomeStatus } from "@/lib/org/skill-outcomes";
import { usageVerdictLabel, type SkillUsage, type SkillUsageState } from "@/lib/org/skill-usage";
import type { SkillRow } from "@/lib/db";

/** One skill's usage reading, as an epistemic state.
 *  `active`/`abandoned` are MEASURED — events exist and we read them, whatever they said.
 *  `new`/`unused` are DECLARED — the skill is published to the library and has never been observed
 *  running; the outline-only mark is "exists on paper", which is precisely what that is.
 *  `unmeasured` is NOT-JUDGED — the org's pathway emitted nothing at all, so "never used" is a claim
 *  the data cannot support. */
export const USAGE_VIZ_STATE: Record<SkillUsageState, VizState> = {
  active: "measured",
  abandoned: "measured",
  new: "declared",
  unused: "declared",
  unmeasured: "not-judged",
};

export function usageVizState(u: SkillUsage | undefined): VizState {
  if (!u) return "not-judged";
  const mapped = u.state ? USAGE_VIZ_STATE[u.state] : undefined;
  if (mapped) return mapped;
  // A row carrying only the coarse verdict (a legacy or hand-built one): `dormant` there could be any
  // of the three finer states, and picking one would invent the distinction this module protects.
  return u.verdict === "active" ? "measured" : u.verdict === "new" ? "declared" : "not-judged";
}

/** The badge word. Never collapses the three dormant states into one adjective. */
export function usageBadgeLabel(u: SkillUsage): string {
  switch (u.state) {
    case "active":
    case "new":
      return u.state;
    case "abandoned":
      return "dormant";
    case "unused":
      return "never used";
    case "unmeasured":
      return "not measured";
    default:
      return usageVerdictLabel(u.verdict).toLowerCase();
  }
}

const age = (days: number) => (days === 0 ? "today" : `${days}d ago`);

/** "invoked 4d ago" / "never used" — the evidence behind the verdict, never a bare adjective.
 *  An `unmeasured` skill gets neither: with no event anywhere in the org, "never used" would be a
 *  measurement of absence taken from an instrument that was never switched on. */
export function usageDetail(u: SkillUsage): string {
  if (u.state === "unmeasured") return `no skill events recorded in this org · added ${age(u.ageDays)}`;
  if (u.lastUsedAt === null || u.daysSinceUse === null) return `never used · added ${age(u.ageDays)}`;
  const when = u.daysSinceUse === 1 ? "yesterday" : age(u.daysSinceUse);
  // Three verbs for three facts. `invoked` is the strongest — the skill RAN — and must not collapse
  // into "used", which is what a copy/download is; `synced` is a pull and stays visibly weaker.
  const kind = u.lastUsedType === "invoke" ? "invoked" : u.lastUsedType === "download" ? "used" : "synced";
  return `${kind} ${when}`;
}

// ── Reuse across the fleet ───────────────────────────────────────────────────────────────────────

/** Adopted is a share of the fleet (0..100, the maturity ramp's home) and prints a number. Copied and
 *  Ran are counts, and a count on that ramp would report a young library as a failing one — they
 *  carry state and no number, the same rule Practices arrived at for Landed/Verified. */
export const REUSE_AXES = ["Adopted", "Copied", "Ran"] as const;

/** How many lanes/rows a first-sight graphic draws before it stops being readable. */
export const VIZ_ROW_LIMIT = 10;

function adoptedCell(s: SkillRow, fleetSize: number): MatrixCell {
  // No fleet, no denominator. Practices shipped the same bug the other way round: a share drawn
  // against a denominator nobody assembled reads as a measurement.
  if (fleetSize <= 0) return { state: "not-judged" };
  if (s.adoptionCount <= 0) return { state: "declared" };
  return { state: "measured", score: Math.min(100, Math.round((s.adoptionCount / fleetSize) * 100)) };
}

function ranCell(u: SkillUsage | undefined): MatrixCell {
  if (!u || u.state === "unmeasured") return { state: "not-judged" };
  return { state: u.invokes > 0 ? "measured" : "declared" };
}

/** Skills ranked by reach, most-reused first — the order a reader scans for "what is actually used". */
export function rankSkills(skills: SkillRow[], limit = VIZ_ROW_LIMIT): SkillRow[] {
  return [...skills]
    .sort((a, b) => b.adoptionCount - a.adoptionCount || b.downloadCount - a.downloadCount)
    .slice(0, limit);
}

export function reuseRows(skills: SkillRow[], usage: Record<string, SkillUsage>, fleetSize: number): MatrixRow[] {
  return rankSkills(skills).map((s) => ({
    id: s.id,
    label: s.name,
    cells: [
      adoptedCell(s, fleetSize),
      { state: s.downloadCount > 0 ? "measured" : "declared" } as MatrixCell,
      ranCell(usage[s.id]),
    ],
  }));
}

// ── Outcomes ─────────────────────────────────────────────────────────────────────────────────────

/** A before/after pair that exists and agrees on its instrument is MEASURED; a pair with a side that
 *  does not exist is MISSING (a void, never a zero delta); a pair that exists but cannot be compared
 *  across rubric versions is NOT-JUDGED — and so prints no number at all. */
export const OUTCOME_VIZ_STATE: Record<OutcomeStatus, VizState> = {
  measured: "measured",
  "no-before-scan": "missing",
  "no-after-scan": "missing",
  "instrument-mismatch": "not-judged",
  "instrument-unknown": "not-judged",
};
