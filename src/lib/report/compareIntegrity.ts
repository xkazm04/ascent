import type { ScoreIntegrity } from "@/lib/types";

/** Explain scoring-rule changes independently of repository evidence changes. */
export function diffScoreIntegrity(before?: ScoreIntegrity, after?: ScoreIntegrity): string[] {
  if (!before && !after) return [];
  if (!before || !after) {
    return [`Scoring integrity was not recorded on the ${before ? "newer" : "baseline"} scan; its scoring levers cannot be compared.`];
  }

  const lines: string[] = [];
  if (before.d9Unmeasurable !== after.d9Unmeasurable) {
    lines.push(after.d9Unmeasurable
      ? "D9 became unmeasurable and was excluded from the newer scan's score."
      : "D9 returned to the newer scan's scoring basis.");
  }
  if (Boolean(before.widenCapped) !== Boolean(after.widenCapped)) {
    lines.push(after.widenCapped
      ? "The newer scan capped discrepancy widening and used deterministic signals."
      : "The newer scan no longer capped discrepancy widening.");
  }
  for (const [label, oldDims, newDims] of [
    ["Widened guardband", before.widenedDims, after.widenedDims],
    ["Unmeasured", before.unmeasuredDims ?? [], after.unmeasuredDims ?? []],
  ] as const) {
    const added = newDims.filter((id) => !oldDims.includes(id));
    const removed = oldDims.filter((id) => !newDims.includes(id));
    if (added.length) lines.push(`${label} in the newer scan: ${added.join(", ")}.`);
    if (removed.length) lines.push(`${label} no longer applies: ${removed.join(", ")}.`);
  }
  if (before.effectiveBlend !== after.effectiveBlend) {
    lines.push(`Realized model blend changed from ${Math.round(before.effectiveBlend * 100)}% to ${Math.round(after.effectiveBlend * 100)}%.`);
  }
  return lines;
}
