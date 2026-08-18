// The pure reconciliations behind the gate-policy editor, extracted from useGatePolicyEditor.ts so
// every file stays under the 200-LOC cap (AGENTS.md). No React, no state, no JSX — the hook composes
// these and re-exports the two the rest of the app already imports (`SweepPlan`, `appliesWhen`).

import type { GatePolicy } from "@/lib/scoring/gate";
import type { DimensionId } from "@/lib/types";

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

/** The policy's per-dimension floors minus D9, as form strings. D9 has its own dedicated control. */
export function floorsExceptD9(p: GatePolicy | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [dim, floor] of Object.entries(p?.minDimensionFor ?? {})) {
    if (dim !== "D9" && floor != null) out[dim] = String(floor);
  }
  return out;
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
  if (req.forbidPostures?.length && !req.forbidPostures.every((p) => stored?.forbidPostures?.includes(p)))
    out.push("forbidden postures");
  return out;
}
