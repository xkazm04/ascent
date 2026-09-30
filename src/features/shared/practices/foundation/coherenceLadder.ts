// The five-number spread as a ladder. Every measured quantile is an observed step (reached); the
// number is the label so it stays paper. Repos with no coherence are a hatched step, never a zero.
import type { LadderStep } from "@/components/kit";
import type { CoherenceSpread } from "./coherenceSpread";

export function coherenceLadderSteps(spread: CoherenceSpread): LadderStep[] {
  if (!spread.five) return [];
  const f = spread.five;
  const steps: LadderStep[] = [
    { key: "min", label: String(f.min), state: "reached", detail: "Minimum" },
    { key: "q1", label: String(f.q1), state: "reached", detail: "Lower quartile" },
    { key: "median", label: String(f.median), state: "reached", detail: "Median" },
    { key: "q3", label: String(f.q3), state: "reached", detail: "Upper quartile" },
    { key: "max", label: String(f.max), state: "reached", detail: "Maximum" },
  ];
  if (spread.unmeasured > 0) {
    steps.push({
      key: "unmeasured",
      label: "Not assessed",
      state: "unmeasured",
      detail: `${spread.unmeasured} excluded`,
    });
  }
  return steps;
}
