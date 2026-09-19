// Shared, pure presentational helpers for the App Readiness Passport (P2/P3) — band labels/colors and
// compact stack chips, so the per-repo card and the fleet table/scatter render the same vocabulary.

import type { AppPassport, ArtifactGrade, PassportFinding, ProductionBand } from "@/lib/types";
import { upgradePassport } from "@/lib/analyze/passport-migrate";

/** Normalize any passport handed to a view — a passport can reach a component straight off a persisted
 *  report blob (not only via parsePassportJson), so the display layer lifts old stored shapes too. Cheap:
 *  returns the same object when it is already current. */
export const passportForDisplay = (pp: AppPassport): AppPassport => upgradePassport(pp);

// ── graded artifact ladders (0.2.0) ─────────────────────────────────────────────────────────────
export const GRADE_LABEL: Record<ArtifactGrade, string> = {
  none: "None",
  adhoc: "Ad-hoc",
  curated: "Curated",
  governed: "Governed",
};
/** Meter fill for a grade — same 0–100 vocabulary the production rungs use. */
export const GRADE_PCT: Record<ArtifactGrade, number> = { none: 0, adhoc: 33, curated: 67, governed: 100 };
export const gradeLabel = (g: string): string => GRADE_LABEL[g as ArtifactGrade] ?? g;

export const BAND_LABEL: Record<ProductionBand, string> = {
  prototype: "Prototype",
  internal: "Internal",
  beta: "Beta",
  production: "Production",
  hardened: "Hardened",
};

export const BAND_COLOR: Record<ProductionBand, string> = {
  prototype: "#dc2626",
  internal: "#d97706",
  beta: "#3b9eff",
  production: "#16a34a",
  hardened: "#84cc16",
};

export const bandLabel = (b: string): string => BAND_LABEL[b as ProductionBand] ?? b;
export const bandColor = (b: string): string => BAND_COLOR[b as ProductionBand] ?? "#94a3b8";

// ── Readiness cohorts (P3 portfolio) ────────────────────────────────────────────────────────────
// The automation×production plane splits at 65 (the L4 / production-band boundary) into four
// quadrant cohorts; "no-obs" is the orthogonal zero-observability slice. One vocabulary for the
// scatter's quadrants, the filter chips, and the headline counts, so they can never disagree.

/** Quadrant cutoff on both axes — the L4 / production-band boundary. */
export const PASSPORT_SPLIT = 65;

export type PassportCohort = "ready" | "gap" | "hostile" | "early";

export const COHORT_META: Record<PassportCohort, { label: string; color: string; blurb: string }> = {
  ready: { label: "Ready to ship", color: "#84cc16", blurb: "automation ≥65 · production ≥65" },
  gap: { label: "Automatable, not prod-ready", color: "#d97706", blurb: "automation ≥65 · production <65" },
  hostile: { label: "Prod-grade, agent-hostile", color: "#3b9eff", blurb: "automation <65 · production ≥65" },
  early: { label: "Early on both axes", color: "#94a3b8", blurb: "automation <65 · production <65" },
};

export const COHORT_ORDER: PassportCohort[] = ["ready", "gap", "hostile", "early"];

/** Which quadrant cohort a passport's two scores fall into. */
export function cohortOf(autoScore: number, prodScore: number): PassportCohort {
  if (autoScore >= PASSPORT_SPLIT) return prodScore >= PASSPORT_SPLIT ? "ready" : "gap";
  return prodScore >= PASSPORT_SPLIT ? "hostile" : "early";
}

/** Compact named-stack chips for a passport: frameworks, persistence engines, integration vendors,
 *  and observability presence — the "first sight" comparison row. Bounded. */
export function passportStackChips(pp: AppPassport, max = 8): string[] {
  const chips: string[] = [];
  for (const f of pp.stack.frameworks) chips.push(f);
  for (const p of pp.stack.persistence) if (p.engine) chips.push(p.engine);
  for (const i of pp.stack.integrations) chips.push(i.name);
  return [...new Set(chips)].slice(0, max);
}

// ── production rung honesty (present vs enforced vs unassessable) ────────────────────────────────
// The builder already distinguishes these three facts. The card and fleet table used to paint
// anything that was not a gate as a miss: `checks` wore the same warn tone as `none`, and
// `prod.observability-unassessable` still rendered the rung as `none`. Unassessable is not a 0.

export type RungHonesty = "enforced" | "present" | "absent" | "unassessable";
export type ProductionRung = "ci" | "tests" | "security" | "observability";

const ENFORCED_LEVELS: Record<ProductionRung, ReadonlySet<string>> = {
  ci: new Set(["gated", "delivery", "progressive"]),
  tests: new Set(["substantial", "comprehensive"]),
  security: new Set(["gated", "supply-chain"]),
  observability: new Set(["metrics", "tracing"]),
};

const ABSENT_LEVELS: Record<ProductionRung, ReadonlySet<string>> = {
  ci: new Set(["none"]),
  tests: new Set(["none"]),
  security: new Set(["none"]),
  observability: new Set(["none"]),
};

const UNASSESSABLE_CODE: Record<ProductionRung, string | null> = {
  ci: "ci-unassessable",
  tests: null,
  security: "security-unassessable",
  observability: "observability-unassessable",
};

function findingCodes(findings: readonly Pick<PassportFinding, "id" | "code">[] | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const f of findings ?? []) {
    if (f.code) out.add(f.code);
    const id = f.id;
    if (!id) continue;
    const dot = id.indexOf(".");
    out.add(dot >= 0 ? id.slice(dot + 1) : id);
  }
  return out;
}

/** Classify a production sub-rung. An evidence-limit finding on a `none` level is unassessable,
 *  never absent: the scan could not look, which is not a miss and not a 0. */
export function rungHonesty(
  rung: ProductionRung,
  level: string,
  findings?: readonly Pick<PassportFinding, "id" | "code">[] | null,
): RungHonesty {
  if (ENFORCED_LEVELS[rung].has(level)) return "enforced";
  const code = UNASSESSABLE_CODE[rung];
  if (code && ABSENT_LEVELS[rung].has(level) && findingCodes(findings).has(code)) return "unassessable";
  if (ABSENT_LEVELS[rung].has(level)) return "absent";
  return "present";
}

export function deliveryRungHonesty(d: { migrations: string; iac: boolean; rollback: boolean }): RungHonesty {
  if (d.rollback) return "enforced";
  if (d.iac || d.migrations !== "none") return "present";
  return "absent";
}

/** Present and unassessable are named. Enforced is named only on the CI/security gate ladders —
 *  tests/observability use the same green tone at the top of their scale without claiming a gate. */
export function rungDisplayValue(rung: ProductionRung, level: string, honesty: RungHonesty): string {
  if (honesty === "unassessable") return "unassessable";
  if (honesty === "present") return `${level} · present`;
  if (honesty === "enforced" && (rung === "ci" || rung === "security")) return `${level} · enforced`;
  return level;
}

export function deliveryRungValue(
  d: { migrations: string; iac: boolean; rollback: boolean },
  honesty: RungHonesty,
): string {
  const base = `migrations: ${d.migrations}${d.iac ? " · iac" : ""}${d.rollback ? " · rollback" : ""}`;
  if (honesty === "present") return `${base} · present`;
  if (honesty === "enforced") return `${base} · enforced`;
  return base;
}

export const RUNG_HONESTY_COLOR: Record<RungHonesty, string> = {
  enforced: "#84cc16",
  present: "#7dd3fc",
  absent: "#f97316",
  unassessable: "#64748b",
};

export const RUNG_HONESTY_CLASS: Record<RungHonesty, string> = {
  enforced: "text-emerald-300",
  present: "text-sky-300",
  absent: "text-orange-300",
  unassessable: "text-slate-500",
};

export const RUNG_HONESTY_HINT: Record<RungHonesty, string> = {
  enforced: "Enforced: a failing check blocks the merge or release.",
  present: "Present but not enforced — it exists, it does not gate.",
  absent: "Assessed and absent.",
  unassessable: "Could not be assessed on this scan. Unassessable is not a miss and is not a 0.",
};

export interface RungView {
  id: ProductionRung | "delivery";
  label: string;
  honesty: RungHonesty;
  value: string;
}

/** The five production sub-rungs as the card and table both render them. */
export function productionRungViews(prod: AppPassport["productionReadiness"]): RungView[] {
  const findings = prod.findings;
  const ci = rungHonesty("ci", prod.ci.level, findings);
  const tests = rungHonesty("tests", prod.tests.level, findings);
  const security = rungHonesty("security", prod.security.level, findings);
  const observability = rungHonesty("observability", prod.observability.level, findings);
  const delivery = deliveryRungHonesty(prod.delivery);
  return [
    { id: "ci", label: "CI", honesty: ci, value: rungDisplayValue("ci", prod.ci.level, ci) },
    { id: "tests", label: "Tests", honesty: tests, value: rungDisplayValue("tests", prod.tests.level, tests) },
    { id: "security", label: "Security", honesty: security, value: rungDisplayValue("security", prod.security.level, security) },
    { id: "observability", label: "Observability", honesty: observability, value: rungDisplayValue("observability", prod.observability.level, observability) },
    { id: "delivery", label: "Delivery", honesty: delivery, value: deliveryRungValue(prod.delivery, delivery) },
  ];
}
