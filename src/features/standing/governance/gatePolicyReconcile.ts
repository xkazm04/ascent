// The pure reconciliations behind the gate-policy editor, extracted from useGatePolicyEditor.ts so
// every file stays under the 200-LOC cap (AGENTS.md). No React, no state, no JSX — the hook composes
// these and re-exports the two the rest of the app already imports (`SweepPlan`, `appliesWhen`).

import type { GatePolicy } from "@/lib/scoring/gate";
import { clampToDisplayRange } from "@/lib/scoring/gate-numeric";
import { isValidCheckId } from "@/lib/standard/check-ids";
import type { DimensionId, LevelId } from "@/lib/types";

/** What the POST handler scheduled after the save (see the gate-policy route). */
export type SweepPlan =
  | { status: "scheduled"; repos: number; cap: number }
  | { status: "skipped"; reason: "no-installation" | "no-watched-repos"; repos: number; cap: number };

/**
 * Say WHEN the new bar actually takes effect — the one thing this form never told the owner. Saving
 * used to imply instant org-wide enforcement while every already-open PR kept its stale verdict until
 * the next push. The copy is driven by the server's sweep plan, so it is honest in BOTH installation
 * states rather than promising a re-check the App can't perform. Exported for its unit test.
 */
export function appliesWhen(sweep: SweepPlan | undefined): string | null {
  if (!sweep) return null;
  if (sweep.status === "scheduled") {
    return `Open PRs re-check within a minute: up to ${sweep.cap} across ${sweep.repos} watched ${
      sweep.repos === 1 ? "repo" : "repos"
    }. Anything past that applies on the next push, or a "Re-run" on the check.`;
  }
  return sweep.reason === "no-watched-repos"
    ? "No watched repos yet, so nothing was re-checked. The new bar applies the next time a repo is scanned or gated."
    : "No GitHub App installation, so open PRs were not re-checked. The new bar applies on each PR's next push or CI run.";
}

/**
 * The GatePolicy fields this editor actually renders — and therefore the ONLY ones its save is
 * entitled to replace. Everything else is carried through untouched by `passthroughPolicyFields`.
 *
 * Why (UAT 2026-08-30, NADIA-L1-07 / PRIYA-L1-01): the form builds its payload field by field and the
 * POST replaces the stored policy wholesale, so an unrendered bar was DELETED on any unrelated edit.
 * `requireChecks` and `minAiGovernedRate` now have controls and live here so a save can add or clear
 * them. Remaining passthrough: `forbidAiAuthorship`.
 *
 * The fix is round-trip, not server-side merge: a merging POST could never CLEAR a field, so
 * unchecking "Require a protected default branch" would stop working. The form owns exactly what it
 * shows and touches nothing else.
 *
 * When a field gains a control here, add it to this list in the same change — otherwise the editor
 * would show it AND stash a stale copy of it, and the stash would win.
 */
export const EDITED_POLICY_FIELDS = [
  "minLevel",
  "minOverall",
  "minDimension",
  "minDimensionFor",
  "forbidPostures",
  "requireProtectedBranch",
  "requireChecks",
  "minAiGovernedRate",
] as const satisfies readonly (keyof GatePolicy)[];

/**
 * Same ceiling as `MAX_REQUIRE_CHECKS` in `@/lib/scoring/gate`. Copied so this client module never
 * value-imports the evaluator (gate-numeric.ts documents that bundle break). The roundtrip test
 * asserts the two stay equal.
 */
export const REQUIRE_CHECKS_CAP = 100;

/** Valid, unique, sorted, capped — the same shape `sanitizeGatePolicy` stores. */
export function normalizeRequireChecks(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => isValidCheckId(id)))].sort().slice(0, REQUIRE_CHECKS_CAP);
}

/** Drop a malformed id, a duplicate, or anything past the cap; otherwise append and re-normalize. */
export function addRequireCheckId(prev: readonly string[], id: string): string[] {
  const trimmed = id.trim();
  if (!isValidCheckId(trimmed) || prev.includes(trimmed) || prev.length >= REQUIRE_CHECKS_CAP) {
    return prev as string[];
  }
  return normalizeRequireChecks([...prev, trimmed]);
}

/**
 * The stored policy minus the fields this form edits — the bars it must hand back byte-identical.
 * Seeded from the server's echo on every save, never from the request, so the carried copy can't
 * drift from what is actually stored.
 */
export function passthroughPolicyFields(p: GatePolicy | null): GatePolicy {
  if (!p) return {};
  const edited = new Set<string>(EDITED_POLICY_FIELDS);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (!edited.has(k) && v !== undefined) out[k] = v;
  }
  return out as GatePolicy;
}

/** Assemble the POST body from the form's owned fields plus the untouched passthrough bars. */
export function buildEditedPolicy(input: {
  passthrough: GatePolicy;
  minLevel: string;
  minOverall: string;
  minDimension: string;
  otherFloors: Record<string, string>;
  security: boolean;
  securityFloor: string;
  noUngoverned: boolean;
  requireProtection: boolean;
  requireChecks: readonly string[];
  aiGoverned: boolean;
  aiGovernedRate: string;
}): GatePolicy {
  const p: GatePolicy = { ...input.passthrough };
  if (input.minLevel) p.minLevel = input.minLevel as LevelId;
  if (input.minOverall.trim()) p.minOverall = Number(input.minOverall);
  if (input.minDimension.trim()) p.minDimension = Number(input.minDimension);
  const floors: Partial<Record<DimensionId, number>> = {};
  for (const [dim, raw] of Object.entries(input.otherFloors)) {
    if (raw.trim()) floors[dim as DimensionId] = clampToDisplayRange(raw);
  }
  if (input.security) floors.D9 = clampToDisplayRange(input.securityFloor);
  if (Object.keys(floors).length) p.minDimensionFor = floors;
  if (input.noUngoverned || input.security) p.forbidPostures = ["ungoverned"];
  if (input.requireProtection) p.requireProtectedBranch = true;
  const checks = normalizeRequireChecks(input.requireChecks);
  if (checks.length) p.requireChecks = checks;
  else delete p.requireChecks;
  if (input.aiGoverned) p.minAiGovernedRate = clampToDisplayRange(input.aiGovernedRate);
  else delete p.minAiGovernedRate;
  return p;
}

/** The policy's per-dimension floors minus D9, as form strings. D9 has its own dedicated control. */
export function floorsExceptD9(p: GatePolicy | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [dim, floor] of Object.entries(p?.minDimensionFor ?? {})) {
    if (dim !== "D9" && floor != null) out[dim] = String(floor);
  }
  return out;
}

/** Form-owned snapshot — seeds `useState` and re-seeds from the server echo. */
export function seedEditorFields(p: GatePolicy | null) {
  const d9 = p?.minDimensionFor?.D9;
  const air = p?.minAiGovernedRate;
  return {
    minLevel: p?.minLevel ?? "",
    minOverall: p?.minOverall != null ? String(p.minOverall) : "",
    minDimension: p?.minDimension != null ? String(p.minDimension) : "",
    security: d9 != null,
    // ci-gate-status-checks #2: seed D9 from the persisted value; default 50 when newly enabled.
    securityFloor: d9 != null ? String(d9) : "50",
    otherFloors: floorsExceptD9(p),
    noUngoverned: Boolean(p?.forbidPostures?.includes("ungoverned")),
    requireProtection: Boolean(p?.requireProtectedBranch),
    requireChecks: normalizeRequireChecks(p?.requireChecks ?? []),
    aiGoverned: air != null,
    aiGovernedRate: air != null ? String(air) : "100",
    passthrough: passthroughPolicyFields(p),
  };
}

// Which requested fields did the server's sanitizer silently DROP? sanitizeGatePolicy discards any
// ≤0 / out-of-range floor ("not set" by contract), so a save can succeed while shedding fields the
// form shows as enabled — e.g. Security checkbox on + floor cleared → `{ D9: 0 }` → no D9 floor
// stored at all. The old null-vs-non-null echo check couldn't see a PARTIALLY-dropped policy, so the
// owner was told "the gate now enforces it" about a bar that was never stored.
export function droppedFields(req: GatePolicy, stored: GatePolicy | null): string[] {
  const out: string[] = [];
  if (req.minLevel != null && stored?.minLevel !== req.minLevel) out.push("minimum level");
  if (req.minOverall != null && stored?.minOverall !== req.minOverall) out.push("min overall");
  if (req.minDimension != null && stored?.minDimension !== req.minDimension) out.push("min per-dimension");
  for (const [dim, floor] of Object.entries(req.minDimensionFor ?? {})) {
    if (floor == null) continue;
    if (stored?.minDimensionFor?.[dim as DimensionId] === floor) continue;
    // D9 is named for what it is; the rest are named by dimension so the message points at the row
    // the owner has to fix. Every one of these can be shed by the ≤0 / out-of-range sanitizer rule.
    out.push(dim === "D9" ? "security floor (D9)" : `${dim} floor`);
  }
  if (req.requireProtectedBranch && !stored?.requireProtectedBranch) out.push("protected-branch requirement");
  if (req.minAiGovernedRate != null && stored?.minAiGovernedRate !== req.minAiGovernedRate) out.push("AI-review bar");
  if (req.forbidPostures?.length && !req.forbidPostures.every((p) => stored?.forbidPostures?.includes(p)))
    out.push("forbidden postures");
  if (req.requireChecks?.length) {
    const kept = stored?.requireChecks ?? [];
    if (!req.requireChecks.every((c) => kept.includes(c))) out.push("required controls");
  }
  return out;
}
