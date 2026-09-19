// The Autonomy Passport surface (P1) asks: "what can you safely hand an agent in THIS repo?"
//
// ONE VERDICT (Direction 8). This module used to run its OWN five-gate ladder to a tier, then
// overwrite that tier with the persisted `pp.autonomy.tier` while KEEPING the prototype ladder's
// `blocking` list and `nextProgress` — so a repo shown at T2 could list conditions the T2 predicate
// had never consulted, and the "what would raise this" line described a ladder nobody grades against.
// The tier, the blocking conditions and the progress now ALL come from `deriveAutonomyForStored`
// (src/lib/analyze/passport-autonomy.ts) — the same symbol `derivedTierFor` (src/lib/db/org-admission.ts)
// seeds an admission row from, so the tab and the governance perimeter cannot disagree about a repo.
//
// The five gates are RETAINED AS PRESENTATION ONLY: they are the evidence rows under "conditions of
// clearance" — what the scan saw about tests, CI, sandbox, context and hooks — and they no longer
// decide anything. Each still declares its own `source`:
//
//   source: "scan"    — read straight off observed passport/scan fields. Trustworthy today.
//   source: "derived" — a PROXY assembled from adjacent observed fields. Directionally right,
//                       but the scan does not measure the named thing (see each gate's note).
//   source: "mock"    — NOT observed at all. A placeholder so the surface can be designed; the
//                       value is a deterministic function of the repo so it is stable across
//                       renders, but it is fiction. Every variant renders these visibly flagged.
//
// The scan-side work this surface implies is listed at the bottom of the file (DATA_MODEL_GAPS).

import { TOKENLESS_MISSING, deriveAutonomyForStored } from "@/lib/analyze/passport-autonomy";
import type { ManifestReadout } from "@/lib/standard/readout";
import type { AppPassport, ContextHealth } from "@/lib/types";

import { ciGate, contextGate, hooksGate, sandboxGate, testsGate } from "./autonomyGateBuilders";
import { GATE_ORDER, type AutonomyGate } from "./autonomyGates";
import type { AutonomyTier } from "./autonomyTiers";

// Barrel — the tier vocabulary (autonomyTiers.ts), the gate shape (autonomyGates.ts) and the five
// per-gate derivations (autonomyGateBuilders.ts) live in co-located modules under the 200-LOC rule,
// but this file stays the single import surface: every name the surface used to export still is.
export { TIERS, TIER_META, tierHex } from "./autonomyTiers";
export type { AutonomyTier, TierMeta } from "./autonomyTiers";
export { GATE_ORDER } from "./autonomyGates";
export type { AutonomyGate, GateId, GateSource, GateStatus } from "./autonomyGates";

// ── the shared ladder's shape ───────────────────────────────────────────────────────────────────

/**
 * How many predicates the shared ladder checks CUMULATIVELY for each tier — T1's three, plus T2's
 * three, plus T3's three (see `tierPredicates` in src/lib/analyze/passport-autonomy.ts). The resolver
 * reports only the UNMET ones, so this is the denominator that turns "3 conditions left" into a
 * progress percentage. It is pinned by a test that counts the real predicates against a
 * floor passport, so a predicate added upstream fails here loudly instead of skewing a meter.
 */
export const LADDER_PREDICATES: Record<1 | 2 | 3, number> = { 1: 3, 2: 6, 3: 9 };

// ── the per-repo verdict ────────────────────────────────────────────────────────────────────────

export interface RepoAutonomy {
  fullName: string;
  name: string;
  purpose: string;
  tier: AutonomyTier;
  nextTier: AutonomyTier | null;
  /** The five evidence rows. PRESENTATION ONLY — they explain, they do not decide. */
  gates: AutonomyGate[];
  /** The shared ladder's unmet conditions for `nextTier`, in the resolver's own words. */
  blocking: string[];
  /** 0–100 readiness for `nextTier`: the share of that tier's cumulative predicates already met. */
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
  /** #13 — the scan's readout of this repo's `.ai/manifest.yaml`; null-safe, absent keeps today's scoring. */
  manifest?: ManifestReadout | null;
  /** W4 — the persisted context-health read (Repository.contextHealthJson). Absent/null = freshness
   *  UNKNOWN, which the context gate says rather than inventing. */
  contextHealth?: ContextHealth | null;
}

export function deriveAutonomy(input: AutonomyInput): RepoAutonomy {
  const pp = input.passport;
  // The evidence rows. Built for display; nothing below reads their scores.
  const list: AutonomyGate[] = [
    testsGate(pp),
    ciGate(pp, input.protectedBranch),
    sandboxGate(pp),
    contextGate(pp, input.aiConformance ?? null, input.manifest ?? null, input.contextHealth ?? null),
    hooksGate(pp, input.fullName),
  ];
  const map = new Map(list.map((g) => [g.id, g]));

  // THE verdict. `deriveAutonomyForStored` is the shared resolver: the same call `derivedTierFor`
  // makes when it seeds an admission row, so this tab and the Governance Perimeter show one tier for
  // one repo. It is called even when `pp.autonomy` is present — that block was written BY this
  // resolver (buildPassport / upgradePassport), so re-deriving is free of surprise and keeps a
  // pre-0.3.0 row, which carries no block at all, on exactly the same path.
  const verdict = deriveAutonomyForStored(pp);
  const tier = Number(verdict.tier.slice(1)) as AutonomyTier;
  const nextTier = tier < 3 ? ((tier + 1) as AutonomyTier) : null;

  // The unmet conditions for the NEXT rung, verbatim from the ladder that decided the tier. The
  // tokenless cap is one of them, and it leads the list — a repo that cannot climb because the scan
  // had no token must say so rather than list three conditions it may already meet.
  const blocking = nextTier ? (verdict.unlocks.find((u) => u.tier === `T${nextTier}`)?.missing ?? []) : [];
  const total = nextTier ? LADDER_PREDICATES[nextTier] : 0;
  // The tokenless entry is a VISIBILITY caveat, not a predicate, so it is excluded from the
  // denominator's arithmetic — counting it would push a meter below the repo's real standing.
  const unmet = blocking.filter((m) => m !== TOKENLESS_MISSING).length;
  const nextProgress = total ? Math.max(0, Math.round((100 * (total - Math.min(unmet, total))) / total)) : 100;

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
 *  derived `pp.autonomy` tier block persisted in the passport JSON.
 *  CLOSED by moonshot #8 (the agent-admission compiler): "owner override — pp.autonomy is derived +
 *  persisted, but a grant should also be an overridable recorded decision". `RepoAdmission` is that
 *  decision: `derivedTier` keeps the measurement, `grantedTier` carries the grant, `decidedBy`
 *  separates the two, and the Governance Perimeter is where an owner moves it. */
export const DATA_MODEL_GAPS = [
  // CLOSED by Direction 8: contextGate now consumes the persisted Repository.contextHealthJson
  // (threaded through PassportsTab), and the fabricated staleness penalty is gone. A repo whose scan
  // recorded no freshness reads as UNKNOWN — no penalty, and the evidence says so — rather than
  // carrying an invented "last touched ~Nd ago" under a "scan" provenance pin.
  "agent policy: declared tool allow-list, no-AI paths, review tier by risk (feeds P2 AI stance)",
  "attribution: AI-assisted PR share via git trailers, to verify a granted tier is actually being used",
] as const;
