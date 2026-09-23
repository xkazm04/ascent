// THE DRIVE'S RUN DIALS — validated once at the route, stored on the drive (`LoopDrive.dialsJson`),
// and handed to EVERY run the drive dispatches (spark theater-upgrade, 2026-09-18; WP2).
//
// WHY THIS EXISTS. Until 2026-09-18 a drive armed each run with scope, cycles, lanes, model, effort and
// delivery — and nothing else. Batch size, the agent's session ceiling, the guard, its timeout, the
// rescan cadence and the model policy were silently dropped, so every drive run used the deployment
// defaults whatever the operator had set on the cockpit's dials. A drive is a sequence of runs of ONE
// experiment; a dial that reaches the first manual run but not the drive's is two experiments.
//
// The validators are the loop route's own: both doors call `run-spec.ts` (challenge-2026-09-23b), so
// an unrecognised value that was SENT is a 400 naming the band and an omitted or null one is the
// deployment default on either door. Never clamped, never guessed.
// DEPENDENCY-FREE (no db, no `process`), like `run-limits.ts`.

import type { DriveDials } from "@/lib/local/runner-types";
import type { Arm, ArmPolicy } from "@/lib/local/arm";
import type { VerifyMode } from "@/lib/local/run-limits";
import { impliedPlanMode, parseRunDials, type RunDialSpec } from "@/lib/local/run-spec";

/** The subset of `StartLoopRunInput` the dials set. Structural, so this module needs no engine import. */
export interface DialRunInput {
  batchSize?: number;
  agentTimeoutMs?: number;
  verifyMode?: VerifyMode;
  verifyTimeoutMs?: number;
  rescanCadence?: "cycle" | "run";
  modelPolicy?: "ab";
  models?: string[];
  arms?: Arm[];
  armPolicy?: ArmPolicy;
  /** `on` runs the planning session first; null = off. A split arm is only split when it is `on`. */
  planMode?: "on" | null;
}

/** The run-input fields a drive's dials set — ONLY the ones that are set, so a drive with no dials
 *  arms its runs with exactly the object it always did. */
export function dialRunInput(dials: DriveDials | null | undefined): DialRunInput {
  if (!dials) return {};
  const out: DialRunInput = {};
  if (dials.batchSize != null) out.batchSize = dials.batchSize;
  if (dials.agentTimeoutMs != null) out.agentTimeoutMs = dials.agentTimeoutMs;
  if (dials.verifyMode != null) out.verifyMode = dials.verifyMode;
  if (dials.verifyTimeoutMs != null) out.verifyTimeoutMs = dials.verifyTimeoutMs;
  if (dials.rescanCadence != null) out.rescanCadence = dials.rescanCadence;
  // THE ARMS WIN when the drive carries them: the two vocabularies are never merged, so a drive armed
  // with arms dispatches arm runs and one armed the old way dispatches exactly what it always did.
  if (dials.arms && dials.arms.length > 0) {
    out.arms = dials.arms.map((a) => ({ ...a }));
    out.armPolicy = dials.armPolicy === "compare" ? "compare" : "single";
  } else if (dials.modelPolicy === "ab" && dials.models && dials.models.length === 2) {
    out.modelPolicy = "ab";
    out.models = [...dials.models];
  }
  // PLAN MODE travels with the arms. Implied again here, not only at the route, so a drive stored
  // before the route implied it (split arms in `dialsJson`, no `planMode`) still plans on resume.
  const planMode = impliedPlanMode(out.arms, dials.planMode ?? undefined);
  if (planMode) out.planMode = planMode === "on" ? "on" : null;
  return out;
}

export type ParsedDials = { ok: true; dials: DriveDials | null } | { ok: false; error: string };

/** The parsed dial spec as the drive stores it (`LoopDrive.dialsJson`): null when nothing was set. */
export function toDriveDials(spec: RunDialSpec): DriveDials | null {
  return Object.keys(spec).length > 0 ? { ...spec } : null;
}

/** Validate the `dials` object of a drive start. Absent/null = no dials (the deployment defaults).
 *  The rules are `run-spec.ts`'s, the SAME function the loop route calls on its flat body. */
export function parseDriveDials(raw: unknown): ParsedDials {
  if (raw === undefined || raw === null) return { ok: true, dials: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "dials must be an object." };
  const parsed = parseRunDials(raw as Record<string, unknown>, "dials.");
  return parsed.ok ? { ok: true, dials: toDriveDials(parsed.value) } : parsed;
}
