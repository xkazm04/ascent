// THE DRIVE'S RUN DIALS — validated once at the route, stored on the drive (`LoopDrive.dialsJson`),
// and handed to EVERY run the drive dispatches (spark theater-upgrade, 2026-09-18; WP2).
//
// WHY THIS EXISTS. Until 2026-09-18 a drive armed each run with scope, cycles, lanes, model, effort and
// delivery — and nothing else. Batch size, the agent's session ceiling, the guard, its timeout, the
// rescan cadence and the model policy were silently dropped, so every drive run used the deployment
// defaults whatever the operator had set on the cockpit's dials. A drive is a sequence of runs of ONE
// experiment; a dial that reaches the first manual run but not the drive's is two experiments.
//
// The validators are the loop route's own (`run-limits.ts`): an unrecognised value that was SENT is a
// 400 naming the band, an omitted one is the deployment default. Never clamped, never guessed.
// DEPENDENCY-FREE (no db, no `process`), like `run-limits.ts`.

import type { DriveDials } from "@/lib/local/runner-types";
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

/** The same token rule the loop route and `agent.ts` enforce on a model name before a spawn. */
const MODEL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** The subset of `StartLoopRunInput` the dials set. Structural, so this module needs no engine import. */
export interface DialRunInput {
  batchSize?: number;
  agentTimeoutMs?: number;
  verifyMode?: VerifyMode;
  verifyTimeoutMs?: number;
  rescanCadence?: "cycle" | "run";
  modelPolicy?: "ab";
  models?: string[];
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
  if (dials.modelPolicy === "ab" && dials.models && dials.models.length === 2) {
    out.modelPolicy = "ab";
    out.models = [...dials.models];
  }
  return out;
}

export type ParsedDials = { ok: true; dials: DriveDials | null } | { ok: false; error: string };

/** Validate the `dials` object of a drive start. Absent/null = no dials (the deployment defaults). */
export function parseDriveDials(raw: unknown): ParsedDials {
  if (raw === undefined || raw === null) return { ok: true, dials: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "dials must be an object." };
  const b = raw as Record<string, unknown>;
  const dials: DriveDials = {};
  if (b.batchSize != null) {
    const v = normalizeBatchSize(b.batchSize);
    if (v === null) return { ok: false, error: `dials.batchSize must be a whole number 1–${BATCH_SIZE_CAP}.` };
    dials.batchSize = v;
  }
  if (b.agentTimeoutMs != null) {
    const v = normalizeAgentTimeoutMs(b.agentTimeoutMs);
    if (v === null) {
      return { ok: false, error: `dials.agentTimeoutMs must be a whole number of milliseconds between ${AGENT_TIMEOUT_MIN_MS} and ${AGENT_TIMEOUT_CAP_MS}.` };
    }
    dials.agentTimeoutMs = v;
  }
  if (b.verifyMode != null) {
    const v = normalizeVerifyMode(b.verifyMode);
    if (v === null) return { ok: false, error: "dials.verifyMode must be 'on' or 'off'." };
    dials.verifyMode = v;
  }
  if (b.verifyTimeoutMs != null) {
    const v = normalizeVerifyTimeoutMs(b.verifyTimeoutMs);
    if (v === null) {
      return { ok: false, error: `dials.verifyTimeoutMs must be a whole number of milliseconds between ${VERIFY_TIMEOUT_MIN_MS} and ${VERIFY_TIMEOUT_CAP_MS}.` };
    }
    dials.verifyTimeoutMs = v;
  }
  if (b.rescanCadence != null) {
    if (b.rescanCadence !== "cycle" && b.rescanCadence !== "run") return { ok: false, error: "dials.rescanCadence must be 'cycle' or 'run'." };
    dials.rescanCadence = b.rescanCadence;
  }
  if (b.modelPolicy != null && b.modelPolicy !== "single") {
    if (b.modelPolicy !== "ab") return { ok: false, error: "dials.modelPolicy must be 'single' or 'ab'." };
    const raw = Array.isArray(b.models) ? b.models.filter((m): m is string => typeof m === "string") : [];
    const arms = [...new Set(raw.map((m) => m.trim()).filter(Boolean))];
    if (arms.length !== 2) return { ok: false, error: "An A/B drive needs exactly two distinct models in 'dials.models'." };
    const bad = arms.find((m) => !MODEL_TOKEN.test(m));
    if (bad) return { ok: false, error: `Invalid model "${bad}".` };
    dials.modelPolicy = "ab";
    dials.models = arms;
  } else if (b.modelPolicy === "single") {
    dials.modelPolicy = "single";
  }
  return { ok: true, dials: Object.keys(dials).length > 0 ? dials : null };
}
