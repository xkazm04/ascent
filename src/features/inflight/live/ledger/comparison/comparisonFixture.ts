// FIXTURES for the comparison view — built from the committed `compare-metrics` types, so a change to
// the wire contract breaks these at compile time rather than at read time.

import type { ArmResult, ComparisonReport, ConstraintVerdict, Counted, Reliability } from "@/lib/local/compare-metrics";

export const counted = <T,>(value: T, n: number, predicate: string): Counted<T> => ({ value, n, predicate });

export function reliability(over: Partial<Reliability> = {}): Reliability {
  return {
    perTrial: counted(0.667, 300, "completed trials"),
    n: 3,
    anyOfN: 0.963,
    allOfN: 0.297,
    modelled: false,
    ...over,
  };
}

export function armResult(armId: string, over: Partial<ArmResult> = {}): ArmResult {
  return {
    armId,
    label: `claude:sonnet plan -> pi:qwen3.8:27b (${armId})`,
    claudeTokensPerVerifiedPoint: 41_200,
    verifiedPoints: 12,
    claudeTokens: 494_400,
    localTokens: 2_100_000,
    costAllCompleted: counted(320_000_000, 300, "completed trials"),
    costConditioned: counted(288_000_000, 294, "every arm succeeded"),
    reliability: reliability(),
    landed: 9,
    failed: 2,
    voided: 0,
    parked: 0,
    timedOut: 0,
    belowFloor: false,
    ...over,
  };
}

export function constraintVerdict(id: string, over: Partial<ConstraintVerdict> = {}): ConstraintVerdict {
  const base: ConstraintVerdict = {
    constraint: { id, label: `Constraint ${id}`, direction: "at-most", threshold: 3, kind: "quality" },
    observed: 1,
    cleared: true,
  };
  return { ...base, ...over, constraint: { ...base.constraint, ...(over.constraint ?? {}) } };
}

export function comparisonReport(over: Partial<ComparisonReport> = {}): ComparisonReport {
  return {
    optimized: { id: "claude-tokens-per-verified-point", label: "Claude tokens per verified point", direction: "at-most" },
    constraints: [constraintVerdict("c1")],
    arms: [armResult("claude"), armResult("local")],
    advance: "local",
    note: null,
    ...over,
  };
}
