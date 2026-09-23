// ONE RUN-SPEC PARSER, behind both start doors (challenge-2026-09-23b, local-autopilot-loop-engine#A).
//
// A loop run is started through two doors: `/api/org/loop` (a manual run, dials at the top of the body)
// and `/api/org/local/drive` (a bounded drive or the standing runner, dials under `body.dials`, applied
// to every run the drive dispatches). Until this module each door kept its own copy of the same dial
// rules, and the copies had stopped agreeing: a sent `null` was a 400 on one and "omitted" on the
// other, a `modelPolicy` typo was silently "single" on one and a 400 on the other, and a fractional
// cycle count was rounded on one and truncated on the other. A dial added later could reach one door
// and not the other. Now both doors call this, so an input has ONE verdict wherever it arrives.
//
// THE CONVENTIONS, stated once:
//   - a field that is absent OR sent as `null` is omitted: the deployment default;
//   - a field that was sent and is not recognised is a 400 naming the band. Never clamped, rounded or
//     guessed (`run-limits.ts`), with ONE deliberate exception kept from both routes: an agent model
//     or effort off the roster falls back to the deployment default, so a stale tab still starts;
//   - counts are whole numbers: `2.6` cycles is a caller error, not 2 or 3.
//
// THE SPLIT-ARM RULE. An arm whose planning half differs from its executing half is only split when
// the planning session runs, because that session is the only thing that spawns the planning half.
// So a split arm with no `planMode` implies `on`, and an explicit `off` is refused: it would run the
// executing transport for both halves and record `planModel: null` under the split arm's name.
//
// DEPENDENCY-FREE (no db, no `process`), like `run-limits.ts` and `arm.ts`. The caps are passed in by
// the routes, which already import them, so this module never pulls the db layer.

import { MAX_COMPARE_ARMS, MIN_COMPARE_ARMS, MODEL_TOKEN, isSplitArm, normalizeArmPolicy, normalizeArmSet, type Arm, type ArmPolicy } from "@/lib/local/arm";
import { normalizeAgentEffort, normalizeAgentModel, type AgentEffort, type AgentModel } from "@/lib/local/agent-options";
import {
  AGENT_TIMEOUT_CAP_MS,
  AGENT_TIMEOUT_MIN_MS,
  BATCH_SIZE_CAP,
  VERIFY_TIMEOUT_CAP_MS,
  VERIFY_TIMEOUT_MIN_MS,
  normalizeAgentTimeoutMs,
  normalizeBatchSize,
  normalizeVerifyMode,
  normalizeVerifyTimeoutMs,
  type VerifyMode,
} from "@/lib/local/run-limits";

export type PlanMode = "on" | "off";

/** The dials of a run, ONLY the ones the caller set (an empty object = every deployment default). */
export interface RunDialSpec {
  batchSize?: number;
  agentTimeoutMs?: number;
  verifyMode?: VerifyMode;
  verifyTimeoutMs?: number;
  rescanCadence?: "cycle" | "run";
  /** The pre-arms vocabulary: a Claude model pair keyed by model name. Never merged with `arms`. */
  modelPolicy?: "single" | "ab";
  models?: string[];
  arms?: Arm[];
  armPolicy?: ArmPolicy;
  planMode?: PlanMode;
}

/** The run's shape: how many cycles, how many lanes at once, and the agent configuration. */
export interface RunShape {
  maxCycles: number;
  concurrency: number;
  model: AgentModel | null;
  effort: AgentEffort | null;
}

export interface RunSpec extends RunShape {
  dials: RunDialSpec;
}

export interface RunCaps {
  maxCycles: number;
  concurrency: number;
}

export type RunSpecParse<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** The defaults every run before these dials existed used. */
export const DEFAULT_MAX_CYCLES = 3;
export const DEFAULT_CONCURRENCY = 2;

/** One integer rule: omitted/null = `fallback`; anything sent must be a whole number in `[min, max]`. */
export function parseWholeCount(v: unknown, fallback: number, min: number, max: number, name: string): RunSpecParse<number> {
  if (v === undefined || v === null) return { ok: true, value: fallback };
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return fail(`${name} must be a whole number ${min}–${max}.`);
  return { ok: true, value: v };
}

/** `on` when any arm is split and the caller named no mode; otherwise the mode the caller named. */
export function impliedPlanMode(arms: readonly Arm[] | null | undefined, planMode: PlanMode | null | undefined): PlanMode | undefined {
  if (planMode) return planMode;
  return arms && arms.some(isSplitArm) ? "on" : undefined;
}

/** maxCycles, concurrency, model and effort, from the top of either door's body. */
export function parseRunShape(raw: Record<string, unknown>, caps: RunCaps): RunSpecParse<RunShape> {
  const maxCycles = parseWholeCount(raw.maxCycles, DEFAULT_MAX_CYCLES, 1, caps.maxCycles, "maxCycles");
  if (!maxCycles.ok) return maxCycles;
  const concurrency = parseWholeCount(raw.concurrency, DEFAULT_CONCURRENCY, 1, caps.concurrency, "concurrency");
  if (!concurrency.ok) return concurrency;
  return {
    ok: true,
    value: { maxCycles: maxCycles.value, concurrency: concurrency.value, model: normalizeAgentModel(raw.model), effort: normalizeAgentEffort(raw.effort) },
  };
}

/** The dials. `prefix` is how the error names a field (`"dials."` on the drive door). */
export function parseRunDials(b: Record<string, unknown>, prefix = ""): RunSpecParse<RunDialSpec> {
  const out: RunDialSpec = {};
  if (b.batchSize != null) {
    const v = normalizeBatchSize(b.batchSize);
    if (v === null) return fail(`${prefix}batchSize must be a whole number 1–${BATCH_SIZE_CAP}.`);
    out.batchSize = v;
  }
  if (b.agentTimeoutMs != null) {
    const v = normalizeAgentTimeoutMs(b.agentTimeoutMs);
    if (v === null) return fail(`${prefix}agentTimeoutMs must be a whole number of milliseconds between ${AGENT_TIMEOUT_MIN_MS} and ${AGENT_TIMEOUT_CAP_MS}.`);
    out.agentTimeoutMs = v;
  }
  if (b.verifyMode != null) {
    const v = normalizeVerifyMode(b.verifyMode);
    if (v === null) return fail(`${prefix}verifyMode must be 'on' or 'off'.`);
    out.verifyMode = v;
  }
  if (b.verifyTimeoutMs != null) {
    const v = normalizeVerifyTimeoutMs(b.verifyTimeoutMs);
    if (v === null) return fail(`${prefix}verifyTimeoutMs must be a whole number of milliseconds between ${VERIFY_TIMEOUT_MIN_MS} and ${VERIFY_TIMEOUT_CAP_MS}.`);
    out.verifyTimeoutMs = v;
  }
  if (b.rescanCadence != null) {
    if (b.rescanCadence !== "cycle" && b.rescanCadence !== "run") return fail(`${prefix}rescanCadence must be 'cycle' or 'run'.`);
    out.rescanCadence = b.rescanCadence;
  }
  if (b.modelPolicy === "ab") {
    // Each name is checked against the SAME token rule the spawn doors enforce: `shell: true` re-parses
    // argv on Windows, so an unvalidated model name is an argument-injection surface.
    const raw = Array.isArray(b.models) ? b.models.filter((m): m is string => typeof m === "string") : [];
    const models = [...new Set(raw.map((m) => m.trim()).filter(Boolean))];
    if (models.length !== 2) return fail(`An A/B run needs exactly two distinct models in '${prefix}models'.`);
    const bad = models.find((m) => !MODEL_TOKEN.test(m));
    if (bad) return fail(`Invalid model "${bad}".`);
    out.modelPolicy = "ab";
    out.models = models;
  } else if (b.modelPolicy === "single") {
    out.modelPolicy = "single";
  } else if (b.modelPolicy != null) {
    return fail(`${prefix}modelPolicy must be 'single' or 'ab'.`);
  }
  // THE ARMS. `normalizeArmSet` is the one validator the cockpit's arm builder also reads. A caller
  // that ASKED for arms and got them wrong is a 400 naming the band, never a run quietly armed with one.
  if (b.arms != null || b.armPolicy != null) {
    const armPolicy = normalizeArmPolicy(b.armPolicy) ?? "single";
    const arms = normalizeArmSet(b.arms, armPolicy);
    if (!arms) {
      return fail(
        armPolicy === "compare"
          ? `A comparison run needs ${MIN_COMPARE_ARMS}–${MAX_COMPARE_ARMS} arms in '${prefix}arms', each with a distinct id, a known transport and a valid model.`
          : `A single-arm run needs exactly one arm in '${prefix}arms', with a known transport and a valid model.`,
      );
    }
    out.arms = arms;
    out.armPolicy = armPolicy;
  }
  let planMode: PlanMode | undefined;
  if (b.planMode != null) {
    if (b.planMode !== "on" && b.planMode !== "off") return fail(`${prefix}planMode must be 'on' or 'off'.`);
    planMode = b.planMode;
  }
  const split = out.arms?.find(isSplitArm);
  if (split && planMode === "off") {
    return fail(
      `${prefix}planMode 'off' would run arm "${split.id}" on its executing transport for both halves; send 'on' or drop the arm's planning half.`,
    );
  }
  const mode = impliedPlanMode(out.arms, planMode);
  if (mode) out.planMode = mode;
  return { ok: true, value: out };
}

/** The dial fields a drive reads ONLY from `dials`. Sent at the top of a drive body they would be dropped. */
const DRIVE_DIALS_ONLY = ["arms", "armPolicy", "planMode"] as const;

/**
 * A whole start body. `"body"` = the loop door (dials at the top), `"dials"` = the drive door (dials
 * under `body.dials`, and an arm field at the top is a stale client, refused rather than dropped).
 */
export function parseRunSpec(raw: unknown, caps: RunCaps, dialsAt: "body" | "dials"): RunSpecParse<RunSpec> {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const shape = parseRunShape(body, caps);
  if (!shape.ok) return shape;
  let dialsRaw: Record<string, unknown> = body;
  if (dialsAt === "dials") {
    const stale = DRIVE_DIALS_ONLY.find((k) => body[k] !== undefined);
    if (stale) return fail(`'${stale}' belongs in dials.${stale} on a drive; a drive does not read it from the top of the body.`);
    const d = body.dials;
    if (d != null && (typeof d !== "object" || Array.isArray(d))) return fail("dials must be an object.");
    dialsRaw = (d as Record<string, unknown> | null | undefined) ?? {};
  }
  const dials = parseRunDials(dialsRaw, dialsAt === "dials" ? "dials." : "");
  if (!dials.ok) return dials;
  return { ok: true, value: { ...shape.value, dials: dials.value } };
}
