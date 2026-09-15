// The C3 share contract for the developer's session shape: what `POST /api/me/mentor/share` accepts
// for `CareSessionShape`, written down before any producer exists (study 2026-09-15, points 6, 7, 9).
//
// Three rules live here, each because a null or a number could otherwise mean two things:
//   SCOPE    every field declares its window, numerator and denominator. The moment a second producer
//            exists (an org fork of the mentor, a Codex reader) a field without a written scope gets
//            filled with a different one, and the band then compares unlike numbers.
//   REASON   an empty field says WHY: never shared, left out, too few sessions, or not measurable by
//            this producer. One null used to carry all four, and every one rendered "not shared".
//   LAUNCHER only sessions a person started interactively count. SDK, CI and loop-lane sessions are
//            not the developer's habit and would inflate turns and dilute the plan-mode ratio.
//
// PURE module, no db import: the Developer render is a client component.

import { emptyDeveloperView, type CareSessionShape, type CareShapeField, type DeveloperView } from "./developer-view";

/** The one window every shape field is measured over. A payload declaring another is refused. */
export const CARE_SHAPE_WINDOW_DAYS = 30;

/** Below this many interactive sessions in the window a ratio describes a handful, not a habit. */
export const CARE_SHAPE_MIN_SESSIONS = 5;

/**
 * Claude Code `entrypoint` values that mean a person launched the session. Anything else (sdk-ts,
 * sdk-py, mcp, claude-code-github-action, an unknown or missing value) is programmatic and excluded:
 * under-counting a habit is recoverable, attributing a bot's sessions to a person is not.
 */
export const CARE_INTERACTIVE_ENTRYPOINTS: ReadonlySet<string> = new Set(["cli", "claude-desktop"]);

/** True when a session may be folded into the shape. */
export function careCountsTowardShape(entrypoint: string | null | undefined): boolean {
  return Boolean(entrypoint && CARE_INTERACTIVE_ENTRYPOINTS.has(entrypoint));
}

export interface CareFieldScope {
  numerator: string;
  /** Null for a plain count over the window. */
  denominator: string | null;
  unit: "per-week" | "per-session" | "pct" | "count";
}

const SESSIONS = "interactive sessions in the window";

/** The scope of each field. Every field shares `CARE_SHAPE_WINDOW_DAYS`; the record forces a scope per field. */
export const CARE_SHAPE_SCOPE: Record<CareShapeField, CareFieldScope> = {
  sessionsPerWeek: { numerator: SESSIONS, denominator: "weeks in the window (days / 7)", unit: "per-week" },
  turnsPerSession: { numerator: "prompts a person sent (tool rounds are not turns)", denominator: SESSIONS, unit: "per-session" },
  planModePct: { numerator: "sessions that entered plan mode at least once", denominator: SESSIONS, unit: "pct" },
  retriesPerSession: { numerator: "errors seen 3 or more times in one session, once per error", denominator: SESSIONS, unit: "per-session" },
  testsBeforeCommitPct: { numerator: "commits with a test run after the last edit", denominator: "commits made in interactive sessions", unit: "pct" },
  skillInvokes30d: { numerator: "Skill tool calls in interactive sessions", denominator: null, unit: "count" },
  compactionsPerSession: { numerator: "context compactions, automatic or manual", denominator: SESSIONS, unit: "per-session" },
};

/** Why a shape value is empty. The first two are derived here; the last two only a producer can declare. */
export type CareShapeEmptyReason = "no-share-received" | "not-shared" | "below-sample" | "not-collected";
export type CareShapeDeclaredReason = Extract<CareShapeEmptyReason, "below-sample" | "not-collected">;
const DECLARABLE: ReadonlySet<string> = new Set<CareShapeDeclaredReason>(["below-sample", "not-collected"]);

/** The reason a field has no value, or null when it has one. */
export function careShapeEmptyReason(view: DeveloperView, field: CareShapeField): CareShapeEmptyReason | null {
  const shared = view.sharedFields.includes(field);
  if (shared && view.shape[field] != null) return null;
  // A shared null always arrives with a declared reason (the validator refuses one without); the
  // fallback only covers a hand-built view, and "not measured" is the claim that asserts least.
  if (shared) return view.shapeReasons[field] ?? "not-collected";
  return view.setup.lastShareAt == null && view.sharedFields.length === 0 ? "no-share-received" : "not-shared";
}

/** The incoming share payload's shape section. A field left out of `fields` is not shared. */
export interface CareShapePayload {
  contract: 1;
  windowDays: typeof CARE_SHAPE_WINDOW_DAYS;
  launcher: "interactive-only";
  /** Programmatic sessions the producer dropped, so the exclusion is visible rather than silent. */
  excludedProgrammatic: number;
  fields: Partial<Record<CareShapeField, number | { reason: CareShapeDeclaredReason }>>;
}

export type CareShapeValidation =
  | { ok: true; shape: CareSessionShape; sharedFields: CareShapeField[]; shapeReasons: DeveloperView["shapeReasons"] }
  | { ok: false; errors: string[] };

const TOP_KEYS = new Set(["contract", "windowDays", "launcher", "excludedProgrammatic", "fields"]);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Validate an incoming payload. Refuses rather than repairs: an unknown key or a stretched window is a different contract. */
export function validateCareShapePayload(input: unknown): CareShapeValidation {
  if (!isObject(input)) return { ok: false, errors: ["payload is not an object"] };
  const errors: string[] = [];
  for (const k of Object.keys(input)) if (!TOP_KEYS.has(k)) errors.push(`unknown key: ${k}`);
  if (input.contract !== 1) errors.push("contract must be 1");
  if (input.windowDays !== CARE_SHAPE_WINDOW_DAYS) errors.push(`windowDays must be ${CARE_SHAPE_WINDOW_DAYS}`);
  if (input.launcher !== "interactive-only") errors.push("launcher must be interactive-only");
  if (!isCount(input.excludedProgrammatic)) errors.push("excludedProgrammatic must be a non-negative integer");
  if (!isObject(input.fields)) errors.push("fields must be an object");

  const shape: CareSessionShape = { ...emptyDeveloperView().shape };
  const sharedFields: CareShapeField[] = [];
  const shapeReasons: DeveloperView["shapeReasons"] = {};
  for (const [key, value] of Object.entries(isObject(input.fields) ? input.fields : {})) {
    // Own keys only: `"toString" in CARE_SHAPE_SCOPE` is true through the prototype.
    if (!Object.hasOwn(CARE_SHAPE_SCOPE, key)) {
      errors.push(`unknown field: ${key}`);
      continue;
    }
    const field = key as CareShapeField;
    const { unit } = CARE_SHAPE_SCOPE[field];
    if (isObject(value)) {
      const ok = Object.keys(value).length === 1 && typeof value.reason === "string" && DECLARABLE.has(value.reason);
      if (!ok) errors.push(`${field}: an empty field declares exactly one reason, below-sample or not-collected`);
      else shapeReasons[field] = value.reason as CareShapeDeclaredReason;
    } else if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      errors.push(`${field}: must be a finite non-negative number or a reason`);
    } else if (unit === "pct" && value > 100) {
      errors.push(`${field}: a ratio is out of range (0 to 100)`);
    } else if (unit === "count" && !Number.isInteger(value)) {
      errors.push(`${field}: a count must be an integer`);
    } else {
      shape[field] = value;
    }
    sharedFields.push(field);
  }
  return errors.length ? { ok: false, errors } : { ok: true, shape, sharedFields, shapeReasons };
}

/** Short label and hover for an empty shape field. US English, no digits in the label. */
export const CARE_SHAPE_REASON_COPY: Record<CareShapeEmptyReason, { label: string; title: string }> = {
  "no-share-received": {
    label: "nothing shared yet",
    title: "Your mentor has not sent a share to this workspace. Nothing is stored, and this is not a zero.",
  },
  "not-shared": {
    label: "not shared",
    title: "You did not share this count. Nothing is stored, and this is not a zero.",
  },
  "below-sample": {
    label: "too few sessions",
    title: `Shared, but fewer than ${CARE_SHAPE_MIN_SESSIONS} interactive sessions ran in the last ${CARE_SHAPE_WINDOW_DAYS} days, so a number would describe a handful of sessions, not a habit.`,
  },
  "not-collected": {
    label: "not measured",
    title: "Shared, but your mentor cannot measure this count from the tools you use. Not a zero.",
  },
};
