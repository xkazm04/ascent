// BandLadder bands and the per-repo tier rail, as Ladder steps. No score hue.
//
// A measured empty tier is open and says 0: nobody holding it is a count. A tier whose holders
// were all scored by the placeholder engine is not measured, and its count is not printed.
// The rail reads T0 to T3, least grant to most. A placeholder repo marks every rung up to the
// issued floor as not measured. Rungs above it stay open.

import type { LadderState, LadderStep } from "@/components/kit";
import type { LadderBand, LadderEdge } from "@/components/org/viz/BandLadder";
import { TIERS, TIER_META, type AutonomyTier } from "./autonomyTiers";

const countOf = (count: number | null | undefined): number | null =>
  typeof count === "number" && Number.isFinite(count) ? count : null;

function bandStep(tier: AutonomyTier, band: LadderBand | undefined): LadderStep {
  const meta = TIER_META[tier];
  const key = `t${tier}`;
  if (!band || band.state === "not-judged" || band.state === "missing") {
    return { key, label: meta.code, state: "unmeasured", detail: meta.label };
  }
  const n = countOf(band.count);
  if (n == null) return { key, label: meta.code, state: "open", detail: meta.label };
  const repos = `${n} ${n === 1 ? "repo" : "repos"}`;
  const state: LadderState = n > 0 ? "reached" : "open";
  return { key, label: meta.code, state, detail: `${repos}, ${meta.label}` };
}

/** Fleet register: one step per tier, plus the placeholder edge when the register has one. */
export function clearanceLadderSteps(bands: LadderBand[], edge: LadderEdge | null): LadderStep[] {
  const byId = new Map(bands.map((band) => [band.id, band]));
  const steps = TIERS.map((tier) => bandStep(tier, byId.get(`t${tier}`)));
  if (!edge) return steps;
  const n = countOf(edge.count);
  return [
    ...steps,
    {
      key: "placeholder",
      label: "Placeholder",
      state: "unmeasured",
      detail: n == null ? edge.label : `${n} ${edge.label}`,
    },
  ];
}

function railState(step: AutonomyTier, tier: AutonomyTier, placeholder: boolean): LadderState {
  if (placeholder) return step <= tier ? "unmeasured" : "open";
  if (step < tier) return "reached";
  if (step === tier) return "current";
  return "open";
}

/** Per-repo rail. `engine === "mock"` means the floor was not graded. */
export function tierRailSteps(tier: AutonomyTier, engine: string | null): LadderStep[] {
  const placeholder = engine === "mock";
  return TIERS.map((step) => ({
    key: `t${step}`,
    label: TIER_META[step].code,
    state: railState(step, tier, placeholder),
    detail: step === tier ? TIER_META[step].label : undefined,
  }));
}
