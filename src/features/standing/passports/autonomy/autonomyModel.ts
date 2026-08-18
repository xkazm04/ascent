// ⚠️ PROTOTYPE DERIVATION — NOT a production data model. ⚠️
//
// The Autonomy Passport reframe (P1) asks: "what can you safely hand an agent in THIS repo?"
// Since passport 0.3.0 (W1b) the production answer lives in `pp.autonomy` (derived by
// src/lib/analyze/passport-autonomy.ts) and the artifacts block carries REAL `sandbox`/`hooks`
// detector booleans — this module PREFERS those when present and keeps its own derivation as the
// fallback for pre-0.3.0 data. Every gate is marked with a `source`:
//
//   source: "scan"    — read straight off observed passport/scan fields. Trustworthy today.
//   source: "derived" — a PROXY assembled from adjacent observed fields. Directionally right,
//                       but the scan does not measure the named thing (see each gate's note).
//   source: "mock"    — NOT observed at all. A placeholder so the surface can be designed; the
//                       value is a deterministic function of the repo so it is stable across
//                       renders, but it is fiction. Every variant renders these visibly flagged.
//
// The scan-side work this surface implies is listed at the bottom of the file (DATA_MODEL_GAPS).

import type { AppPassport } from "@/lib/types";

import { ciGate, contextGate, hooksGate, sandboxGate, testsGate } from "./autonomyGateBuilders";
import { GATE_ORDER, type AutonomyGate, type GateId } from "./autonomyGates";
import { TIERS, type AutonomyTier } from "./autonomyTiers";

// Barrel — the tier vocabulary (autonomyTiers.ts), the gate shape (autonomyGates.ts) and the five
// per-gate derivations (autonomyGateBuilders.ts) live in co-located modules under the 200-LOC rule,
// but this file stays the single import surface: every name the surface used to export still is.
export { TIERS, TIER_META, tierHex } from "./autonomyTiers";
export type { AutonomyTier, TierMeta } from "./autonomyTiers";
export { GATE_ORDER } from "./autonomyGates";
export type { AutonomyGate, GateId, GateSource, GateStatus } from "./autonomyGates";

// ── tier requirements ───────────────────────────────────────────────────────────────────────────

/** Gates that must be at least `partial` (T1/T2) or `pass` (T3) to hold a tier. */
const TIER_REQUIRES: Record<AutonomyTier, GateId[]> = {
  0: [],
  1: ["tests"],
  2: ["tests", "ci", "sandbox"],
  3: ["tests", "ci", "sandbox", "context", "hooks"],
};

// ── the per-repo verdict ────────────────────────────────────────────────────────────────────────

export interface RepoAutonomy {
  fullName: string;
  name: string;
  purpose: string;
  tier: AutonomyTier;
  nextTier: AutonomyTier | null;
  gates: AutonomyGate[];
  /** Gates that stop `nextTier`, worst first. */
  blocking: AutonomyGate[];
  /** 0–100 readiness for `nextTier` (mean of that tier's required gates). */
  nextProgress: number;
  autoScore: number;
  prodScore: number;
  band: string;
  stack: string[];
  confidence: number;
  lastScanAt: string | null;
  /** "mock" = placeholder scan engine; the verdict rests on a floor score. */
  engine: string | null;
}

export interface AutonomyInput {
  fullName: string;
  name: string;
  passport: AppPassport;
  protectedBranch?: boolean;
  aiConformance?: number | null;
  lastScanAt?: string | null;
  engine?: string | null;
}

const holds = (gates: Map<GateId, AutonomyGate>, tier: AutonomyTier): boolean =>
  TIER_REQUIRES[tier].every((id) => {
    const g = gates.get(id);
    if (!g) return false;
    return tier === 3 ? g.status === "pass" : g.status !== "fail";
  });

export function deriveAutonomy(input: AutonomyInput): RepoAutonomy {
  const pp = input.passport;
  const list: AutonomyGate[] = [
    testsGate(pp),
    ciGate(pp, input.protectedBranch),
    sandboxGate(pp),
    contextGate(pp, input.aiConformance ?? null, input.fullName),
    hooksGate(pp, input.fullName),
  ];
  const map = new Map(list.map((g) => [g.id, g]));

  let tier: AutonomyTier = 0;
  for (const t of TIERS) if (holds(map, t)) tier = t;
  // Prefer the REAL persisted verdict (0.3.0 pp.autonomy, derived by passport-autonomy.ts with the
  // token-honesty cap) over this surface's gate-score approximation when the passport carries it.
  const persisted = pp.autonomy?.tier;
  if (persisted) tier = Number(persisted.slice(1)) as AutonomyTier;

  const nextTier = tier < 3 ? ((tier + 1) as AutonomyTier) : null;
  const required = nextTier ? TIER_REQUIRES[nextTier] : [];
  const blocking = required
    .map((id) => map.get(id)!)
    .filter((g) => (nextTier === 3 ? g.status !== "pass" : g.status === "fail"))
    .sort((a, b) => a.score - b.score);
  const nextProgress = required.length ? Math.round(required.reduce((s, id) => s + map.get(id)!.score, 0) / required.length) : 100;

  return {
    fullName: input.fullName,
    name: input.name,
    purpose: pp.identity.purpose,
    tier,
    nextTier,
    gates: GATE_ORDER.map((id) => map.get(id)!),
    blocking,
    nextProgress,
    autoScore: pp.automationReadiness.score,
    prodScore: pp.productionReadiness.score,
    band: pp.productionReadiness.band,
    stack: [...pp.stack.frameworks, ...pp.stack.persistence.map((p) => p.engine).filter(Boolean as unknown as (v: string | undefined) => v is string)].slice(0, 5),
    confidence: pp.evidence.confidence,
    lastScanAt: input.lastScanAt ?? null,
    engine: input.engine ?? null,
  };
}

// ── fleet aggregates ────────────────────────────────────────────────────────────────────────────

export const tierCounts = (repos: RepoAutonomy[]): Record<AutonomyTier, number> => ({
  0: repos.filter((r) => r.tier === 0).length,
  1: repos.filter((r) => r.tier === 1).length,
  2: repos.filter((r) => r.tier === 2).length,
  3: repos.filter((r) => r.tier === 3).length,
});

// ── what a real implementation needs ────────────────────────────────────────────────────────────

/** Signals this surface wants that the scan does not produce today.
 *  CLOSED by W1b (passport 0.3.0): sandbox + hooks detectors (artifacts.sandbox/.hooks) and the
 *  derived `pp.autonomy` tier block persisted in the passport JSON. */
export const DATA_MODEL_GAPS = [
  // W4 note: the DATA now exists — scans persist per-guidance-file freshness/quality/drift as
  // Repository.contextHealthJson (src/lib/analyze/context-health.ts). Remaining gap is WIRING:
  // this surface reads only AppPassport, so contextGate's staleness penalty is still mock until
  // the gate consumes contextHealth (the planned "present AND healthy" T1 predicate, W4 v2).
  "context freshness: signal persisted (W4 contextHealthJson) but not yet consumed by this gate — contextGate still mocks staleness",
  "agent policy: declared tool allow-list, no-AI paths, review tier by risk (feeds P2 AI stance)",
  "attribution: AI-assisted PR share via git trailers, to verify a granted tier is actually being used",
  "owner override: pp.autonomy is derived + persisted, but a grant should also be an overridable recorded decision",
] as const;
