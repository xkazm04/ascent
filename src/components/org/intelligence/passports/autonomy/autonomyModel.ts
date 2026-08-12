// ⚠️ PROTOTYPE DERIVATION — NOT a production data model. ⚠️
//
// The Autonomy Passport reframe (P1) asks a question the passport does not yet answer directly:
// "what can you safely hand an agent in THIS repo?" There is no `autonomyTier` column, no gate
// table, no scan signal named "sandbox" or "hooks". This module derives the whole tier ladder from
// the AppPassport + org rollup fields that DO exist today, and marks every gate with a `source`:
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
import { scoreHex } from "@/lib/ui";

// ── tiers ───────────────────────────────────────────────────────────────────────────────────────

export type AutonomyTier = 0 | 1 | 2 | 3;

export const TIERS: AutonomyTier[] = [0, 1, 2, 3];

export interface TierMeta {
  id: AutonomyTier;
  code: string;
  label: string;
  /** What a human may actually delegate at this tier. */
  grant: string;
  /** The single sentence a lead needs to act on it. */
  blurb: string;
  /** Anchor score used ONLY to pull a color off the shared red→green ramp (never a hand-picked hex). */
  anchor: number;
}

export const TIER_META: Record<AutonomyTier, TierMeta> = {
  0: {
    id: 0,
    code: "T0",
    label: "Observe only",
    grant: "Read, explain, review. No writes.",
    blurb: "The agent can answer questions about this repo. Nothing it produces should be merged unread.",
    anchor: 22,
  },
  1: {
    id: 1,
    code: "T1",
    label: "Tests & docs",
    grant: "Agent-authored tests, docs, comments — human merges.",
    blurb: "A real test loop exists, so an agent's tests and docs can be checked before they land.",
    anchor: 52,
  },
  2: {
    id: 2,
    code: "T2",
    label: "Refactors with review",
    grant: "Behaviour-preserving refactors and small features, reviewed PRs only.",
    blurb: "Gated CI plus a reproducible environment means a bad refactor is caught by the machine first.",
    anchor: 74,
  },
  3: {
    id: 3,
    code: "T3",
    label: "Scheduled autonomous",
    grant: "Unattended, scheduled agent runs opening their own PRs.",
    blurb: "Context contract, guardrails and gates are strong enough that nobody has to be watching.",
    anchor: 93,
  },
};

export const tierHex = (t: AutonomyTier): string => scoreHex(TIER_META[t].anchor);

// ── gates ───────────────────────────────────────────────────────────────────────────────────────

export type GateId = "tests" | "ci" | "sandbox" | "context" | "hooks";
export type GateStatus = "pass" | "partial" | "fail";
export type GateSource = "scan" | "derived" | "mock";

export interface AutonomyGate {
  id: GateId;
  /** Full name for headings. */
  label: string;
  /** 3–7 char mono token for dense boards. */
  short: string;
  status: GateStatus;
  /** 0–100, colored through `scoreHex` like every other score in the app. */
  score: number;
  /** What the scan actually saw, verbatim-ish. */
  evidence: string;
  /** The one action that moves this gate up. */
  action: string;
  source: GateSource;
  /** Tier this gate first becomes mandatory for. */
  gatesTier: AutonomyTier;
}

export const GATE_ORDER: GateId[] = ["tests", "ci", "sandbox", "context", "hooks"];

/** Gates that must be at least `partial` (T1/T2) or `pass` (T3) to hold a tier. */
const TIER_REQUIRES: Record<AutonomyTier, GateId[]> = {
  0: [],
  1: ["tests"],
  2: ["tests", "ci", "sandbox"],
  3: ["tests", "ci", "sandbox", "context", "hooks"],
};

const TEST_RANK = ["none", "smoke", "partial", "substantial", "comprehensive"];
const CI_RANK = ["none", "build", "checks", "gated", "delivery", "progressive"];
const SEC_RANK = ["none", "policy", "scanning", "gated", "supply-chain"];

const statusOf = (score: number): GateStatus => (score >= 70 ? "pass" : score >= 40 ? "partial" : "fail");

/** Stable pseudo-random 0..1 from a string — mock gates must not flicker between renders. */
function hashUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function testsGate(pp: AppPassport): AutonomyGate {
  const t = pp.productionReadiness.tests;
  const sv = pp.automationReadiness.selfVerify;
  const ladder = (Math.max(0, TEST_RANK.indexOf(t.level)) / 4) * 70;
  const loop = (sv.test ? 20 : 0) + (t.criticalPathCovered ? 10 : 0);
  const score = Math.round(Math.min(100, ladder + loop));
  const cov = t.coveragePct != null ? `${t.coveragePct}% coverage` : "coverage unreported";
  return {
    id: "tests",
    label: "Test loop",
    short: "TESTS",
    status: statusOf(score),
    score,
    evidence: `${t.level} suite · ${cov}${sv.test ? " · agent-runnable test command" : " · no discoverable test command"}`,
    action: !sv.test
      ? "Publish a one-command test entry point an agent can run unattended."
      : t.criticalPathCovered
        ? "Raise the suite from " + t.level + " toward comprehensive on the critical path."
        : "Cover the critical path — an agent cannot self-check what is untested.",
    source: "scan",
    gatesTier: 1,
  };
}

function ciGate(pp: AppPassport, protectedBranch: boolean | undefined): AutonomyGate {
  const ci = pp.productionReadiness.ci;
  const ladder = (Math.max(0, CI_RANK.indexOf(ci.level)) / 5) * 65;
  const gateBonus = Math.min(20, ci.gates.length * 7);
  const prot = protectedBranch === true ? 15 : 0;
  const score = Math.round(Math.min(100, ladder + gateBonus + prot));
  return {
    id: "ci",
    label: "CI gates",
    short: "CI",
    status: statusOf(score),
    score,
    evidence: `${ci.level}${ci.provider ? ` on ${ci.provider}` : " · no provider detected"} · ${
      ci.gates.length ? `${ci.gates.length} required check${ci.gates.length === 1 ? "" : "s"}` : "no required checks"
    }${protectedBranch === true ? " · branch protected" : protectedBranch === false ? " · branch unprotected" : ""}`,
    action:
      ci.level === "none"
        ? "Add CI that runs on every PR — the machine review agent output depends on."
        : protectedBranch !== true
          ? "Protect the default branch so an agent PR cannot bypass the checks."
          : "Promote checks to required status gates on the default branch.",
    source: "scan",
    gatesTier: 2,
  };
}

/** ⚠️ DERIVED PROXY. The scan does not look for devcontainer.json / Dockerfile / nix / sandbox
 *  config today. This approximates "can an agent get a reproducible environment" from delivery
 *  discipline (IaC, rollback, versioned migrations) + a declared package manager. */
function sandboxGate(pp: AppPassport): AutonomyGate {
  const d = pp.productionReadiness.delivery;
  const pm = pp.stack.packageManager;
  const score = Math.round(
    Math.min(100, (d.iac ? 35 : 0) + (d.rollback ? 20 : 0) + (d.migrations === "versioned" ? 25 : d.migrations === "scripted" ? 12 : 0) + (pm ? 20 : 0)),
  );
  const bits = [
    d.iac ? "infrastructure-as-code" : "no IaC",
    d.rollback ? "rollback path" : "no rollback path",
    `${d.migrations} migrations`,
    pm ? `${pm} lockfile` : "no declared package manager",
  ];
  return {
    id: "sandbox",
    label: "Reproducible sandbox",
    short: "SNDBX",
    status: statusOf(score),
    score,
    evidence: bits.join(" · "),
    action: !pm
      ? "Declare a package manager + lockfile so an agent's environment matches CI's."
      : !d.iac
        ? "Check the environment definition into the repo (devcontainer or IaC)."
        : "Give the agent a disposable environment it can break without consequence.",
    source: "derived",
    gatesTier: 2,
  };
}

/** ⚠️ PART SCAN, PART MOCK. Presence of AGENTS.md/CLAUDE.md, the context graph, the manifest and
 *  memory/skills grades ARE observed. FRESHNESS (the research's sharpest finding — quality over
 *  presence) is NOT: the scan records no "last edited vs repo change rate" for context files. */
function contextGate(pp: AppPassport, conformance: number | null, key: string): AutonomyGate {
  const a = pp.automationReadiness.artifacts;
  const files = a.agentInstructions.length;
  const graph = a.contextGraph === "full" ? 25 : a.contextGraph === "partial" ? 12 : 0;
  const grade = (g: string) => (g === "governed" ? 12 : g === "curated" ? 8 : g === "adhoc" ? 4 : 0);
  const observed = Math.min(100, Math.min(30, files * 15) + graph + (a.manifest ? 10 : 0) + grade(a.memory) + grade(a.skills) + (conformance != null ? Math.round(conformance * 0.11) : 0));
  // MOCK: staleness penalty. Replace with a real freshness signal (see DATA_MODEL_GAPS).
  const staleDays = Math.round(hashUnit(key + ":ctx") * 210);
  const stalePenalty = files === 0 ? 0 : Math.min(25, Math.floor(staleDays / 12));
  const score = Math.round(Math.max(0, observed - stalePenalty));
  return {
    id: "context",
    label: "Context contract",
    short: "AGENTS",
    status: statusOf(score),
    score,
    evidence: `${files ? a.agentInstructions.join(", ") : "no AGENTS.md / CLAUDE.md"} · ${a.contextGraph} context graph${
      a.manifest ? " · .ai manifest" : ""
    } · last touched ~${staleDays}d ago (mock)`,
    action:
      files === 0
        ? "Write a human-curated AGENTS.md — LLM-generated context files measurably hurt."
        : stalePenalty > 12
          ? "Refresh the context file; it has drifted behind the repo's change rate."
          : "Deepen the context graph so an unattended run starts oriented.",
    source: files === 0 ? "scan" : "mock",
    gatesTier: 3,
  };
}

/** ⚠️ MOCK. Pre-commit/pre-push hooks, agent permission policy and tool allow-lists are not scanned
 *  at all. Approximated from lint/typecheck self-verify + security posture so the shape is right. */
function hooksGate(pp: AppPassport, key: string): AutonomyGate {
  const sv = pp.automationReadiness.selfVerify;
  const sec = pp.productionReadiness.security;
  const base = (sv.lint ? 22 : 0) + (sv.typecheck ? 22 : 0) + (Math.max(0, SEC_RANK.indexOf(sec.level)) / 4) * 36;
  // MOCK: whether a hook config exists in the repo.
  const hooked = hashUnit(key + ":hooks") > 0.55;
  const score = Math.round(Math.min(100, base + (hooked ? 20 : 0)));
  return {
    id: "hooks",
    label: "Guardrails & hooks",
    short: "HOOKS",
    status: statusOf(score),
    score,
    evidence: `${sv.lint ? "lint" : "no lint"} · ${sv.typecheck ? "typecheck" : "no typecheck"} · ${sec.level} security${
      hooked ? " · pre-commit hooks (mock)" : " · no hook config (mock)"
    }`,
    action: !sv.typecheck
      ? "Add a typecheck an agent must pass before it can push."
      : !hooked
        ? "Install pre-commit/pre-push hooks so guardrails run without a reviewer present."
        : "Scope the agent's tool allow-list and no-AI paths explicitly.",
    source: "mock",
    gatesTier: 3,
  };
}

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

export interface GateBottleneck {
  gate: GateId;
  label: string;
  short: string;
  /** Repos this gate is currently blocking from their next tier. */
  blocked: string[];
  /** Mean score across the whole fleet for this gate. */
  mean: number;
  source: GateSource;
}

export function fleetBottlenecks(repos: RepoAutonomy[]): GateBottleneck[] {
  return GATE_ORDER.map((id) => {
    const all = repos.map((r) => r.gates.find((g) => g.id === id)!);
    const blocked = repos.filter((r) => r.blocking.some((g) => g.id === id)).map((r) => r.name);
    return {
      gate: id,
      label: all[0]?.label ?? id,
      short: all[0]?.short ?? id.toUpperCase(),
      blocked,
      mean: all.length ? Math.round(all.reduce((s, g) => s + g.score, 0) / all.length) : 0,
      source: all[0]?.source ?? "mock",
    };
  }).sort((a, b) => b.blocked.length - a.blocked.length || a.mean - b.mean);
}

export const tierCounts = (repos: RepoAutonomy[]): Record<AutonomyTier, number> => ({
  0: repos.filter((r) => r.tier === 0).length,
  1: repos.filter((r) => r.tier === 1).length,
  2: repos.filter((r) => r.tier === 2).length,
  3: repos.filter((r) => r.tier === 3).length,
});

// ── what a real implementation needs ────────────────────────────────────────────────────────────

/** Signals this surface wants that the scan does not produce today. */
export const DATA_MODEL_GAPS = [
  "sandbox: detect devcontainer.json / Dockerfile / nix / .tool-versions — 'can an agent get a reproducible env'",
  "context freshness: last-modified of AGENTS.md/CLAUDE.md vs repo commit rate (quality over presence)",
  "hooks: .husky / lefthook / pre-commit config, plus Claude/agent settings.json hook + permission blocks",
  "agent policy: declared tool allow-list, no-AI paths, review tier by risk (feeds P2 AI stance)",
  "attribution: AI-assisted PR share via git trailers, to verify a granted tier is actually being used",
  "persistence: an autonomyTier column per repo + an owner override, so a grant is a decision, not a guess",
] as const;
