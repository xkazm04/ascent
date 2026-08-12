// ⚠️ PROTOTYPE MOCK — NOT A DATA MODEL, NOT PERSISTED, NOT AN API.
// ============================================================================
// The org's published "AI stance" (permitted tools/models, no-AI zones, risk-tiered review
// requirements, provenance requirements, versioning, per-repo compliance) has NO backing schema yet.
// This module invents a *shape* so the three directional variants in this folder can be evaluated
// against something concrete. Everything here is deterministic-from-name pseudo-data EXCEPT the repo
// spine, which is real: repo fullName / level / overall come from `buildGovernanceOverview` (the
// nearest real governance data we already read on this tab).
//
// When a real stance lands, this file is deleted and the types move to `src/lib/org/stance.ts` with
// a Prisma model behind them. See the final report for the data-model needs this surfaced.

import type { GovernanceOverview } from "@/lib/org/governance";

export type StanceToolStatus = "permitted" | "conditional" | "forbidden";
export type StanceTierId = "T0" | "T1" | "T2" | "T3";
export type StanceAck = "current" | "stale" | "unacked";

/** One entry on the tool/model allowlist. */
export interface StanceTool {
  id: string;
  name: string;
  vendor: string;
  kind: "agent" | "assistant" | "model" | "review";
  status: StanceToolStatus;
  /** The condition or the rationale for the verdict — the sentence a dev needs. */
  note: string;
  /** Repos observed using it (adoption side of the allowlist). */
  reposUsing: number;
}

/** A path or repo the stance declares off-limits to AI authorship. */
export interface StanceZone {
  id: string;
  scope: "path" | "repo";
  pattern: string;
  reason: string;
  /** Repos the pattern matches. */
  repos: string[];
  /** Commits observed inside the zone carrying AI-authorship provenance. */
  violations: number;
}

/** A risk tier: what review a change of this class requires before it can merge. */
export interface StanceTier {
  id: StanceTierId;
  name: string;
  blurb: string;
  review: string;
  examples: string[];
  repos: string[];
}

/** A provenance requirement (trailers, PR labels, signed attribution). */
export interface StanceProvenance {
  id: string;
  label: string;
  requirement: string;
  enforced: boolean;
  /** % of the fleet actually emitting it. */
  coverage: number;
}

/** One published revision of the stance. */
export interface StanceVersion {
  version: string;
  date: string;
  author: string;
  summary: string;
  changes: string[];
}

/** Per-repo compliance readout against the CURRENT stance version. */
export interface RepoStanceCompliance {
  name: string;
  fullName: string;
  /** Real scan data from the governance overview. */
  overall: number;
  level: string;
  tier: StanceTierId;
  ack: StanceAck;
  ackVersion: string | null;
  violations: number;
  /** % of AI-attributed commits carrying the required trailer. */
  provenance: number;
  /** 0..100 rollup of the four checks below. */
  compliance: number;
}

export interface AiStanceDoc {
  published: boolean;
  org: string;
  title: string;
  version: string;
  effective: string;
  owner: string;
  reviewCadence: string;
  summary: string;
  tools: StanceTool[];
  zones: StanceZone[];
  tiers: StanceTier[];
  provenance: StanceProvenance[];
  history: StanceVersion[];
  repos: RepoStanceCompliance[];
  /** % of repos that have acknowledged the current version. */
  adoptionRate: number;
  /** % of repos with zero open violations. */
  cleanRate: number;
}

// ---------------------------------------------------------------------------
// deterministic pseudo-data (stable across renders so A/B comparison is fair)
// ---------------------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const num = (s: string, salt: string, min: number, max: number) => min + (hash(s + salt) % (max - min + 1));
const pick = <T,>(s: string, salt: string, arr: readonly T[]): T => arr[hash(s + salt) % arr.length] as T;

const TOOLS: readonly Omit<StanceTool, "reposUsing">[] = [
  { id: "claude-code", name: "Claude Code", vendor: "Anthropic", kind: "agent", status: "permitted", note: "Default delegated agent. Org workspace only; personal keys are not permitted." },
  { id: "copilot", name: "GitHub Copilot", vendor: "GitHub", kind: "assistant", status: "permitted", note: "Inline completion across the fleet. Enterprise seat required." },
  { id: "codex-cloud", name: "Codex Cloud", vendor: "OpenAI", kind: "agent", status: "conditional", note: "Pilot repos only (see tier T1). Not permitted where customer data is in scope." },
  { id: "opus-4", name: "claude-opus", vendor: "Anthropic", kind: "model", status: "permitted", note: "Approved for code, review and planning. Extended thinking allowed." },
  { id: "gpt-frontier", name: "Frontier preview models", vendor: "any", kind: "model", status: "conditional", note: "Preview/beta model IDs need a named DRI and a 30-day review." },
  { id: "byo-key", name: "Personal API keys", vendor: "any", kind: "assistant", status: "forbidden", note: "No org code may cross an unmanaged key — no DPA, no audit trail, no spend control." },
  { id: "ai-review", name: "Agent pre-review", vendor: "internal", kind: "review", status: "permitted", note: "Required on T2+; never counts as the human approval." },
];

const ZONES: readonly Omit<StanceZone, "repos" | "violations">[] = [
  { id: "z-crypto", scope: "path", pattern: "**/crypto/**, **/auth/session*", reason: "Security-critical primitives — human authorship only, reviewed by the security DRI." },
  { id: "z-migrations", scope: "path", pattern: "prisma/migrations/**, drizzle/**", reason: "Irreversible schema changes; agents may propose, never author." },
  { id: "z-licence", scope: "path", pattern: "LICENSE, NOTICE, **/third_party/**", reason: "Licence and attribution text must be human-attested." },
  { id: "z-payments", scope: "repo", pattern: "billing-service", reason: "PCI scope — no AI authorship until the audit closes (review 2026-Q4)." },
];

const TIERS: readonly Omit<StanceTier, "repos">[] = [
  { id: "T0", name: "Open", blurb: "Docs, tests, comments, formatting.", review: "Normal review. AI authorship needs no extra approval.", examples: ["docs/**", "*.test.ts", "README"] },
  { id: "T1", name: "Guarded", blurb: "Feature code inside a covered module.", review: "One human approval + green CI. Agent pre-review recommended.", examples: ["src/components/**", "src/app/**"] },
  { id: "T2", name: "Elevated", blurb: "Data access, API contracts, infra.", review: "Two approvals, one from the module owner. Agent pre-review REQUIRED.", examples: ["src/lib/db/**", "api/**", "terraform/**"] },
  { id: "T3", name: "Restricted", blurb: "Security, payments, migrations, licensing.", review: "Human authorship only. Security DRI approval. No agent commits.", examples: ["crypto/**", "prisma/migrations/**"] },
];

const PROVENANCE: readonly Omit<StanceProvenance, "coverage">[] = [
  { id: "trailer", label: "Co-authored trailer", requirement: "Every AI-assisted commit carries `Co-Authored-By: <agent>`.", enforced: true },
  { id: "pr-label", label: "PR disclosure", requirement: "PRs with AI-authored hunks carry the `ai-assisted` label.", enforced: true },
  { id: "session", label: "Session link", requirement: "Delegated (T1+) PRs link the agent session transcript.", enforced: false },
  { id: "model-id", label: "Model attribution", requirement: "The model ID and thinking level are recorded on the PR.", enforced: false },
];

const HISTORY: readonly StanceVersion[] = [
  { version: "v1.3", date: "2026-07-28", author: "platform-eng", summary: "Agent pre-review made mandatory on T2.", changes: ["T2 review: agent pre-review recommended → REQUIRED", "Added `**/third_party/**` to no-AI zones", "Codex Cloud moved permitted → conditional (pilot repos)"] },
  { version: "v1.2", date: "2026-05-14", author: "platform-eng", summary: "Provenance trailers enforced in CI.", changes: ["Co-authored trailer: advisory → enforced", "Added the `ai-assisted` PR label requirement"] },
  { version: "v1.1", date: "2026-03-02", author: "security", summary: "billing-service placed out of scope for AI authorship.", changes: ["New repo-scope zone: billing-service (PCI)", "Personal API keys explicitly forbidden"] },
  { version: "v1.0", date: "2026-01-19", author: "cto", summary: "First published stance. Four tiers, one allowlist.", changes: ["Published the tier model T0–T3", "Published the initial tool allowlist"] },
];

/** The revision in force — HISTORY is newest-first, so this is its head. */
const CURRENT_VERSION: StanceVersion = HISTORY[0]!;

/** Clearly-labelled stand-ins used only when the org has no failing repos to borrow names from. */
const PLACEHOLDER_REPOS = ["web-app", "api-gateway", "billing-service", "design-system", "data-pipeline", "mobile-client"];

function tierFor(fullName: string): StanceTierId {
  if (fullName.includes("billing") || fullName.includes("payment")) return "T3";
  return pick(fullName, "tier", ["T0", "T1", "T1", "T2", "T2", "T3"] as const);
}

/**
 * Build the mock stance around the REAL repo spine the governance overview already read.
 * `published: false` renders every variant's "publish your stance" empty state.
 */
export function buildMockStance(g: GovernanceOverview | null, org: string, published = true): AiStanceDoc {
  const seen = new Map<string, { name: string; fullName: string; overall: number; level: string }>();
  for (const f of g?.failures ?? []) seen.set(f.fullName, { name: f.name, fullName: f.fullName, overall: f.overall, level: f.level });
  for (const c of g?.closestToGreen ?? []) {
    if (!seen.has(c.fullName)) seen.set(c.fullName, { name: c.name, fullName: c.fullName, overall: num(c.fullName, "ov", 55, 88), level: pick(c.fullName, "lv", ["L2", "L3", "L4"] as const) });
  }
  if (seen.size === 0) {
    for (const n of PLACEHOLDER_REPOS) {
      const fullName = `${org}/${n}`;
      seen.set(fullName, { name: n, fullName, overall: num(fullName, "ov", 48, 92), level: pick(fullName, "lv", ["L2", "L3", "L4"] as const) });
    }
  }

  const repos: RepoStanceCompliance[] = [...seen.values()].map((r) => {
    const tier = tierFor(r.fullName);
    const ack = pick(r.fullName, "ack", ["current", "current", "current", "stale", "unacked"] as const);
    const violations = ack === "unacked" ? num(r.fullName, "v", 1, 6) : num(r.fullName, "v", 0, 2);
    const provenance = ack === "current" ? num(r.fullName, "p", 72, 100) : num(r.fullName, "p", 18, 70);
    const compliance = Math.max(
      0,
      Math.min(100, Math.round((ack === "current" ? 40 : ack === "stale" ? 22 : 0) + provenance * 0.4 - violations * 6 + 20)),
    );
    return { ...r, tier, ack, ackVersion: ack === "unacked" ? null : ack === "stale" ? "v1.2" : "v1.3", violations, provenance, compliance };
  });

  const zones: StanceZone[] = ZONES.map((z) => {
    const matched = repos.filter((r) => (z.scope === "repo" ? r.name.includes(z.pattern) : hash(r.fullName + z.id) % 3 !== 0)).map((r) => r.fullName);
    return { ...z, repos: matched, violations: matched.reduce((a, fn) => a + (hash(fn + z.id) % 5 === 0 ? num(fn, z.id, 1, 3) : 0), 0) };
  });

  const acked = repos.filter((r) => r.ack === "current").length;
  return {
    published,
    org,
    title: "AI engineering stance",
    version: CURRENT_VERSION.version,
    effective: CURRENT_VERSION.date,
    owner: "platform-eng · @cto (DRI)",
    reviewCadence: "Reviewed quarterly · next 2026-10-01",
    summary:
      "What every engineer may hand to an agent, what stays human, and what a PR must carry to prove which is which. One stance, applied to every repo in the fleet.",
    tools: TOOLS.map((t) => ({ ...t, reposUsing: t.status === "forbidden" ? num(t.id, "u", 0, 2) : num(t.id, "u", 1, Math.max(2, repos.length)) })),
    zones,
    tiers: TIERS.map((t) => ({ ...t, repos: repos.filter((r) => r.tier === t.id).map((r) => r.fullName) })),
    provenance: PROVENANCE.map((p) => ({ ...p, coverage: p.enforced ? num(p.id, "c", 68, 96) : num(p.id, "c", 12, 55) })),
    history: [...HISTORY],
    repos,
    adoptionRate: repos.length ? Math.round((acked / repos.length) * 100) : 0,
    cleanRate: repos.length ? Math.round((repos.filter((r) => r.violations === 0).length / repos.length) * 100) : 0,
  };
}

/** Shared status → color. `permitted`/`forbidden` are verdicts, not levels — success/danger tokens. */
export const TOOL_STATUS_HEX: Record<StanceToolStatus, string> = {
  permitted: "#10b981",
  conditional: "#f97316",
  forbidden: "#ef4444",
};

/** Tier color runs the same red→green *direction* as the level ramp, inverted: T3 is the tightest. */
export const TIER_HEX: Record<StanceTierId, string> = {
  T0: "#22c55e",
  T1: "#84cc16",
  T2: "#f97316",
  T3: "#ef4444",
};

export const ACK_LABEL: Record<StanceAck, string> = {
  current: "Acknowledged v1.3",
  stale: "On an older version",
  unacked: "Never acknowledged",
};
