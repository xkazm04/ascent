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
// 0.4.0 hardens both halves of that: a decline now joins its blocker by MINTED FINDING ID rather than by
// the blocker's rendered prose (rewording a blocker used to orphan every decline made against it), and a
// decline is RE-SURFACED — the blocker stays open, annotated with what changed — when the finding changes
// kind, hardens in severity, or ages past DECLINE_MAX_AGE_DAYS. A decline is a decision about the repo as
// it was; it must not silently keep suppressing a finding about the repo as it now is.
//
// PERSISTENCE / RE-SCAN SURVIVAL is the load-bearing property: declines are stored per repo in
// Repository.passportOverridesJson keyed by FIELD PATH, never inside the scan-derived passportJson. A new
// scan rewrites passportJson only (see scans-persist), so the overlay re-applies the same declines to the
// freshly generated passport — a re-scan can never silently clear an owner's decision.
//
// Pure module: clones, never mutates its input; no IO, no clock.

import type { AppPassport, Criticality, DeclinedByChoice, FindingSeverity, Lifecycle, PassportFinding } from "@/lib/types";
import { deriveProductionScore } from "./passport-score";

/** One owner decline, keyed by field path in the store. */
export interface DeclineEntry {
  /** Optional owner rationale, trimmed and length-capped on parse. */
  reason?: string;
  /** Optional YYYY-MM-DD the choice was made (caller-supplied; this module never reads a clock). */
  at?: string;
  /** 0.4.0: the finding's CAUSE CODE as it stood when the owner declined. The baseline for "has this
   *  gap changed in KIND since it was accepted?". Absent on declines recorded before 0.4.0 — and an
   *  absent baseline must read as UNKNOWN (no comparison), never as a fabricated match. */
  code?: string;
  /** 0.4.0: the finding's severity as it stood when the owner declined — the baseline for "has this
   *  gap HARDENED since it was accepted?". Absent on pre-0.4.0 declines, same rule as `code`. */
  severity?: FindingSeverity;
}

/** How long an accepted gap stands before the owner is asked to re-confirm it.
 *
 *  365 days, replacing "forever" — before 0.4.0 a decline persisted by path indefinitely and `at` was
 *  display-only, so a team that accepted "no dependency/secret/SAST scanning" while the repo was an
 *  internal prototype kept that blocker suppressed after the repo started handling customer data. The
 *  risk was accepted about a different repo than the one that now exists.
 *
 *  A year is the deliberate trade-off against the opposite failure: re-surfacing eagerly (on any
 *  wording change or score jitter) trains owners to re-decline reflexively, which destroys the signal
 *  value of a decline entirely. So re-confirmation fires on exactly three things — the finding's KIND
 *  changed, its SEVERITY rose, or a year passed — and never on a rewording, which is precisely what
 *  minted finding ids make possible.
 *
 *  Measured against the passport's own `generatedAt`, never a clock: this module stays pure. */
export const DECLINE_MAX_AGE_DAYS = 365;

const SEVERITY_RANK: Record<FindingSeverity, number> = { info: 0, warn: 1, block: 2, critical: 3 };

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
  /** 0.4.0: the MINTED ID of the finding this decline stands down (see `mint` in passport.ts). This is
   *  the join key. It replaced a regex over the builder's blocker PROSE, which meant that rewording a
   *  blocker silently detached every decline made against it — accepted gaps reappeared as open
   *  blockers and the owner's stated reason was orphaned, with nothing to notice it had happened. */
  finding?: string;
  /** Pre-0.4.0 fallback ONLY: a passport object that carries `blockers` but no `findings` (an
   *  un-migrated blob) is still matched by prose so an existing decline is not orphaned by the very
   *  change that fixes orphaning. upgradePassport back-fills `findings`, so this is a safety net. */
  legacyBlocker?: RegExp;
}

export const DECLINABLE_PATHS: Record<string, DeclinableField> = {
  // stack.monitoring — the classic "no error tracking by choice"
  "stack.monitoring.errorTracking": { label: "Error tracking", axis: "production", finding: "prod.zero-observability", legacyBlocker: /^zero observability/i },
  "stack.monitoring.logs": { label: "Structured logs", axis: null },
  "stack.monitoring.metrics": { label: "Metrics", axis: null },
  "stack.monitoring.tracing": { label: "Distributed tracing", axis: null },
  "stack.monitoring.uptime": { label: "Uptime/health endpoint", axis: null },
  // production sub-scales
  "productionReadiness.observability": { label: "Observability", axis: "production", finding: "prod.zero-observability", legacyBlocker: /^zero observability/i },
  "productionReadiness.ci": { label: "CI merge gating", axis: "production", finding: "prod.ci-not-gating", legacyBlocker: /^ci does not gate merges/i },
  "productionReadiness.security": { label: "Security scanning", axis: "production", finding: "prod.no-security-scanning", legacyBlocker: /^no dependency\/secret\/sast scanning/i },
  "productionReadiness.tests": { label: "Test depth", axis: null },
  "productionReadiness.delivery.iac": { label: "Infrastructure as code", axis: null },
  "productionReadiness.delivery.rollback": { label: "Rollback path", axis: null },
  // automation artifacts
  "automationReadiness.artifacts.manifest": { label: "Agent manifest (.ai/manifest.yaml)", axis: "automation", finding: "auto.no-manifest", legacyBlocker: /^no in-repo \.ai\/manifest/i },
  "automationReadiness.artifacts.contextGraph": { label: "Context graph", axis: "automation", finding: "auto.no-context-graph", legacyBlocker: /^no machine-readable context graph/i },
  "automationReadiness.artifacts.memory": { label: "Agent memory", axis: "automation", finding: "auto.no-memory", legacyBlocker: /^no agent memory/i },
  "automationReadiness.artifacts.skills": { label: "Agent skills library", axis: "automation", finding: "auto.no-skills", legacyBlocker: /^no reusable agent skills/i },
  "automationReadiness.artifacts.evals": { label: "Evals / golden set", axis: null },
  "automationReadiness.aiInWorkflow": { label: "AI actually in the workflow", axis: "automation", finding: "auto.no-ai-in-workflow", legacyBlocker: /^no evidence ai is actually used/i },
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

/** ESCALATION — the same gap is not the same risk on a throwaway prototype and on a GA, business-
 *  critical service. `critical` is never emitted by a scan: it is what a `block` finding BECOMES once
 *  the owner marks the repo business/mission-critical or GA. That is the precise change of circumstance
 *  behind "the accepted risk was accepted about a different repo than the one that exists now", and it
 *  is owner-declared rather than inferred, so it cannot fire on scan jitter. */
function effectiveSeverity(f: PassportFinding, identity: AppPassport["identity"]): FindingSeverity {
  const raised =
    identity.criticality === "business" || identity.criticality === "mission-critical" || identity.lifecycle === "ga";
  return raised && f.severity === "block" ? "critical" : f.severity;
}

/** Whole days between two YYYY-MM-DD days, or null when either is missing/unparseable. Date.parse of a
 *  bare date is UTC by spec, so this is deterministic and clock-free. */
function daysBetween(from: string | undefined, to: string | undefined): number | null {
  if (!from || !to || !ISO_DAY.test(from) || !ISO_DAY.test(to)) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 86_400_000);
}

/** Has this accepted gap CHANGED since it was accepted? Returns the sentence the owner is asked to
 *  re-decide on, or null when the decision still stands.
 *
 *  A decline recorded before 0.4.0 carries no `code`/`severity` baseline. Absence reads as UNKNOWN and
 *  skips those two comparisons — a detector that postdates a stored record must never manufacture the
 *  "false" that would let it claim nothing changed, nor the "true" that would re-open every old
 *  decision at once. Age still applies, because `at` was always recorded. */
function reconfirmReason(entry: DeclineEntry, current: PassportFinding | null, sev: FindingSeverity, generatedAt: string | undefined): string | null {
  if (current && entry.code && entry.code !== current.code) {
    return `The finding changed kind since this was accepted (was "${entry.code}", now "${current.code}"). Re-confirm the decision against the gap that exists now.`;
  }
  if (current && entry.severity && SEVERITY_RANK[sev] > SEVERITY_RANK[entry.severity]) {
    return `This gap hardened since it was accepted (severity ${entry.severity} -> ${sev}). Re-confirm that the trade-off still holds.`;
  }
  const age = daysBetween(entry.at, generatedAt);
  if (age !== null && age > DECLINE_MAX_AGE_DAYS) {
    return `Accepted ${age} days ago, past the ${DECLINE_MAX_AGE_DAYS}-day re-confirmation window. Confirm it still reflects this repo.`;
  }
  return null;
}

/** Project the stored declines onto a passport: retire each matching blocker line and re-render it under
 *  `passport.declined` with its label + reason. Deterministic (paths sorted); scores are never touched —
 *  a choice to skip a gap is not the same as closing it, and the score must stay honest.
 *
 *  0.4.0 changes two things here. The match is by MINTED FINDING ID, not by the blocker's prose, so a
 *  reworded blocker keeps its declines. And a decline that no longer describes the repo it was made
 *  about (kind changed / severity rose / aged out) does NOT retire its blocker: the blocker stays open
 *  AND the decision is rendered with `needsReconfirm`, so the reader sees both the live gap and the
 *  reasoning they are being asked to reaffirm. */
function applyDeclines(next: AppPassport, declined: Record<string, DeclineEntry>): void {
  const out: DeclinedByChoice[] = [];
  for (const path of Object.keys(declined).sort()) {
    const field = DECLINABLE_PATHS[path];
    if (!field) continue; // unknown path — ignore (must-ignore-unknown)
    const entry = declined[path] ?? {};
    const axis =
      field.axis === "automation" ? next.automationReadiness : field.axis === "production" ? next.productionReadiness : null;

    // Join on the minted id; fall back to the prose regex only for an un-migrated blob with no findings.
    let current: PassportFinding | null = null;
    let index = -1;
    if (axis && field.finding) {
      if (axis.findings) {
        index = axis.findings.findIndex((f) => f.id === field.finding);
        current = index >= 0 ? (axis.findings[index] ?? null) : null;
      } else if (field.legacyBlocker) {
        index = axis.blockers.findIndex((b) => field.legacyBlocker!.test(b));
      }
    }

    const sev = current ? effectiveSeverity(current, next.identity) : null;
    const reconfirm = current || entry.at ? reconfirmReason(entry, current, sev ?? "info", next.generatedAt) : null;

    let retired: string | undefined;
    if (axis && index >= 0 && !reconfirm) {
      // The decision stands: retire the line from `blockers` AND from `findings`, keeping them in sync.
      const text = current ? current.text : axis.blockers[index];
      const bi = current ? axis.blockers.indexOf(current.text) : index;
      if (bi >= 0) axis.blockers.splice(bi, 1);
      if (current && axis.findings) axis.findings.splice(index, 1);
      retired = text;
    } else if (current) {
      // Re-surfaced: the blocker deliberately stays in the list, annotated below.
      retired = current.text;
    }

    out.push({
      path,
      label: field.label,
      ...(entry.reason ? { reason: entry.reason } : {}),
      ...(retired ? { blocker: retired } : {}),
      ...(current ? { findingId: current.id } : {}),
      ...(entry.at ? { at: entry.at } : {}),
      ...(reconfirm ? { needsReconfirm: true, reconfirmReason: reconfirm } : {}),
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

/** Validate a `declined` map: keeps only allow-listed paths, trims/caps reasons, drops bad dates, and
 *  (0.4.0) keeps the `code`/`severity` baseline the decline was made against so a later scan can tell
 *  whether the accepted gap still describes this repo. A caller that omits the baseline gets a decline
 *  that simply never re-surfaces on kind/severity — the honest reading of "we don't know what it was". */
export function parseDeclined(raw: unknown): Record<string, DeclineEntry> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, DeclineEntry> = {};
  for (const [path, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isDeclinablePath(path)) continue;
    const entry: DeclineEntry = {};
    if (v && typeof v === "object") {
      const o = v as { reason?: unknown; at?: unknown; code?: unknown; severity?: unknown };
      if (typeof o.reason === "string" && o.reason.trim()) entry.reason = o.reason.trim().slice(0, MAX_REASON);
      if (typeof o.at === "string" && ISO_DAY.test(o.at)) entry.at = o.at;
      if (typeof o.code === "string" && /^[a-z0-9-]{1,64}$/.test(o.code)) entry.code = o.code;
      if (typeof o.severity === "string" && Object.hasOwn(SEVERITY_RANK, o.severity)) entry.severity = o.severity as FindingSeverity;
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
