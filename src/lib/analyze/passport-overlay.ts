// Owner overrides for the App Readiness Passport — the READ-TIME overlay that turns the passport from a
// display artifact into DECISION MEMORY.
//
// Two kinds of owner input live here:
//  1. Non-observable facts a scan can't see: criticality / lifecycle / rollback (P4, 0.1.0).
//  2. DECLINED BY CHOICE (0.2.0): "I have seen this gap and I am deliberately opting out" — e.g. no error
//     tracking on an internal cron worker. A decline is NOT a fix: it never moves a score. It retires the
//     gap from `blockers` and re-renders it under `passport.declined` with the owner's reason, so the next
//     reader sees a decision instead of an unread finding.
//
// PERSISTENCE / RE-SCAN SURVIVAL is the load-bearing property: declines are stored per repo in
// Repository.passportOverridesJson keyed by FIELD PATH, never inside the scan-derived passportJson. A new
// scan rewrites passportJson only (see scans-persist), so the overlay re-applies the same declines to the
// freshly generated passport — a re-scan can never silently clear an owner's decision.
//
// Pure module: clones, never mutates its input; no IO, no clock.

import type { AppPassport, Criticality, DeclinedByChoice, Lifecycle } from "@/lib/types";
import { deriveProductionScore } from "./passport-score";

/** One owner decline, keyed by field path in the store. */
export interface DeclineEntry {
  /** Optional owner rationale, trimmed and length-capped on parse. */
  reason?: string;
  /** Optional YYYY-MM-DD the choice was made (caller-supplied; this module never reads a clock). */
  at?: string;
}

/** Owner-set overrides for the fields a scan can't observe (P4) plus declined-by-choice gaps (0.2.0).
 *  Applied as a read-time overlay over the scan-derived passport; `rollback` re-derives the production
 *  score/band (it feeds the delivery axis). */
export interface PassportOverrides {
  criticality?: Criticality;
  lifecycle?: Lifecycle;
  rollback?: boolean;
  /** Declines keyed by an allowed dotted passport field path (see DECLINABLE_PATHS). */
  declined?: Record<string, DeclineEntry>;
}

// ── the allow-list of declinable field paths ──────────────────────────────────────────────────────
// A decline is only meaningful for a gap an owner can legitimately choose to live with. Enforcement
// facts a SCAN couldn't observe (the tokenless branch-protection caveat) are deliberately NOT declinable
// — that would let an owner silence a limitation of the evidence rather than accept a real trade-off.

interface DeclinableField {
  label: string;
  /** Which blocker list this decline retires a line from, if any. */
  axis: "automation" | "production" | null;
  /** Matches the builder-authored blocker line this decline stands down. */
  blocker?: RegExp;
}

export const DECLINABLE_PATHS: Record<string, DeclinableField> = {
  // stack.monitoring — the classic "no error tracking by choice"
  "stack.monitoring.errorTracking": { label: "Error tracking", axis: "production", blocker: /^zero observability/i },
  "stack.monitoring.logs": { label: "Structured logs", axis: null },
  "stack.monitoring.metrics": { label: "Metrics", axis: null },
  "stack.monitoring.tracing": { label: "Distributed tracing", axis: null },
  "stack.monitoring.uptime": { label: "Uptime/health endpoint", axis: null },
  // production sub-scales
  "productionReadiness.observability": { label: "Observability", axis: "production", blocker: /^zero observability/i },
  "productionReadiness.ci": { label: "CI merge gating", axis: "production", blocker: /^ci does not gate merges/i },
  "productionReadiness.security": { label: "Security scanning", axis: "production", blocker: /^no dependency\/secret\/sast scanning/i },
  "productionReadiness.tests": { label: "Test depth", axis: null },
  "productionReadiness.delivery.iac": { label: "Infrastructure as code", axis: null },
  "productionReadiness.delivery.rollback": { label: "Rollback path", axis: null },
  // automation artifacts
  "automationReadiness.artifacts.manifest": { label: "Agent manifest (.ai/manifest.yaml)", axis: "automation", blocker: /^no in-repo \.ai\/manifest/i },
  "automationReadiness.artifacts.contextGraph": { label: "Context graph", axis: "automation", blocker: /^no machine-readable context graph/i },
  "automationReadiness.artifacts.memory": { label: "Agent memory", axis: "automation", blocker: /^no agent memory/i },
  "automationReadiness.artifacts.skills": { label: "Agent skills library", axis: "automation", blocker: /^no reusable agent skills/i },
  "automationReadiness.artifacts.evals": { label: "Evals / golden set", axis: null },
  "automationReadiness.aiInWorkflow": { label: "AI actually in the workflow", axis: "automation", blocker: /^no evidence ai is actually used/i },
};

/** True when `path` is one an owner may decline. Exported for route-level validation. */
export const isDeclinablePath = (path: string): boolean => Object.hasOwn(DECLINABLE_PATHS, path);

const MAX_REASON = 280;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// ── the overlay ───────────────────────────────────────────────────────────────────────────────────

const CRITICALITY = new Set<Criticality>(["experimental", "internal", "business", "mission-critical"]);
const LIFECYCLE = new Set<Lifecycle>(["prototype", "alpha", "beta", "ga", "maintenance", "deprecated"]);

function isEmpty(ov: PassportOverrides): boolean {
  return (
    ov.criticality === undefined &&
    ov.lifecycle === undefined &&
    ov.rollback === undefined &&
    (ov.declined === undefined || Object.keys(ov.declined).length === 0)
  );
}

/** Project the stored declines onto a passport: retire each matching blocker line and re-render it under
 *  `passport.declined` with its label + reason. Deterministic (paths sorted); scores are never touched —
 *  a choice to skip a gap is not the same as closing it, and the score must stay honest. */
function applyDeclines(next: AppPassport, declined: Record<string, DeclineEntry>): void {
  const out: DeclinedByChoice[] = [];
  for (const path of Object.keys(declined).sort()) {
    const field = DECLINABLE_PATHS[path];
    if (!field) continue; // unknown path — ignore (must-ignore-unknown)
    const entry = declined[path] ?? {};
    const list =
      field.axis === "automation"
        ? next.automationReadiness.blockers
        : field.axis === "production"
          ? next.productionReadiness.blockers
          : null;
    let retired: string | undefined;
    if (list && field.blocker) {
      const i = list.findIndex((b) => field.blocker!.test(b));
      if (i >= 0) retired = list.splice(i, 1)[0];
    }
    out.push({
      path,
      label: field.label,
      ...(entry.reason ? { reason: entry.reason } : {}),
      ...(retired ? { blocker: retired } : {}),
    });
  }
  if (out.length) next.declined = out;
}

/** Apply owner overrides as an overlay over a scan-derived passport (P4 + 0.2.0 declines). Returns the
 *  passport unchanged when there are none. criticality/lifecycle are identity-only; a `rollback` change
 *  re-derives the production score + band. Pure — clones, never mutates input. */
export function applyPassportOverrides(pp: AppPassport, ov: PassportOverrides | null | undefined): AppPassport {
  if (!ov || isEmpty(ov)) return pp;
  const next: AppPassport = JSON.parse(JSON.stringify(pp));
  if (ov.criticality) next.identity.criticality = ov.criticality;
  if (ov.lifecycle) next.identity.lifecycle = ov.lifecycle;
  if (ov.rollback !== undefined && ov.rollback !== next.productionReadiness.delivery.rollback) {
    next.productionReadiness.delivery.rollback = ov.rollback;
    const { score, band } = deriveProductionScore(next.productionReadiness);
    next.productionReadiness.score = score;
    next.productionReadiness.band = band;
  }
  if (ov.declined && Object.keys(ov.declined).length) applyDeclines(next, ov.declined);
  return next;
}

/** Validate a `declined` map: keeps only allow-listed paths, trims/caps reasons, drops bad dates. */
export function parseDeclined(raw: unknown): Record<string, DeclineEntry> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, DeclineEntry> = {};
  for (const [path, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isDeclinablePath(path)) continue;
    const entry: DeclineEntry = {};
    if (v && typeof v === "object") {
      const o = v as { reason?: unknown; at?: unknown };
      if (typeof o.reason === "string" && o.reason.trim()) entry.reason = o.reason.trim().slice(0, MAX_REASON);
      if (typeof o.at === "string" && ISO_DAY.test(o.at)) entry.at = o.at;
    }
    out[path] = entry;
  }
  return Object.keys(out).length ? out : null;
}

/** Tolerant parse + validate of stored overrides JSON — drops unknown enum values and unknown declinable
 *  paths. Null when empty. */
export function parsePassportOverrides(raw: string | null | undefined): PassportOverrides | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PassportOverrides>;
    const out: PassportOverrides = {};
    if (v.criticality && CRITICALITY.has(v.criticality)) out.criticality = v.criticality;
    if (v.lifecycle && LIFECYCLE.has(v.lifecycle)) out.lifecycle = v.lifecycle;
    if (typeof v.rollback === "boolean") out.rollback = v.rollback;
    const declined = parseDeclined(v.declined);
    if (declined) out.declined = declined;
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}
