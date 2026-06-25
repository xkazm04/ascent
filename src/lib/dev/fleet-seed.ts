// Synthetic fleet generator for demos: builds realistic ScanReport HISTORIES (multiple scans per
// repo, back-dated over a window) so the org-intelligence dashboards — Overview standing + Trajectory
// forecast, Repositories leaderboard, Contributors, Live War Room — render at scale, and the public
// landing register looks alive. Each report is persisted through the real persistScanReport path
// (src/lib/db/scans-persist.ts), so the data is shaped exactly like a genuine scan.
//
// Deterministic by construction: a repo's data + its per-scan head SHAs derive from a seeded PRNG
// keyed on the repo name, so re-running the seed is idempotent — the same SHAs dedup instead of
// piling up duplicate scans. Display-only; never feeds real scoring.

import type {
  AiUsage,
  Contributor,
  DimensionId,
  DimensionResult,
  LlmRoadmapItem,
  Posture,
  ProviderName,
  RepoArchetype,
  ScanReport,
  TeamOwnership,
} from "@/lib/types";
import {
  axisScore,
  clamp,
  DIMENSION_BY_ID,
  DIMENSIONS,
  levelForScore,
  nextLevel,
  overallScoreFor,
  postureFor,
  weightsFor,
} from "@/lib/maturity/model";

// ── Seeded PRNG (stable across runs so SHAs/data are reproducible → idempotent seeding) ──────────

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 40-char hex string shaped like a git SHA, derived deterministically from `s`. */
function fakeSha(s: string): string {
  let out = "";
  let n = hash32(s);
  while (out.length < 40) {
    n = hash32(out + ":" + n.toString(16));
    out += n.toString(16).padStart(8, "0");
  }
  return out.slice(0, 40);
}

// ── Content pools ────────────────────────────────────────────────────────────────────────────────

const NAME_PREFIXES = [
  "platform", "payments", "web", "mobile", "data", "infra", "identity",
  "growth", "billing", "search", "notifications", "analytics",
];
const NAME_NOUNS = [
  "service", "api", "gateway", "worker", "dashboard", "sdk",
  "engine", "pipeline", "store", "portal", "console", "scheduler",
];
const LANGS = ["TypeScript", "TypeScript", "TypeScript", "Python", "Go", "Rust", "Java", "Ruby"];
const TEAM_POOL = [
  "@acme/platform", "@acme/payments", "@acme/web", "@acme/data",
  "@acme/infra", "@acme/identity", "@acme/mobile", "@acme/growth",
];
const PERSON_POOL = [
  "ada", "linus", "grace", "margaret", "dennis", "barbara", "ken", "katherine",
  "alan", "radia", "guido", "bjarne", "anita", "shafi", "leslie", "jean",
];

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length]!;
}

function phraseFor(score: number): string {
  if (score >= 85) return "comprehensive and enforced in CI";
  if (score >= 65) return "solid, with automation in the loop";
  if (score >= 45) return "established but uneven across the repo";
  if (score >= 25) return "present in places, not yet systematic";
  return "largely manual / ad hoc";
}

// ── Per-repo report-history generation ─────────────────────────────────────────────────────────

interface RepoSpec {
  owner: string;
  name: string;
  primaryLanguage: string;
  stars: number;
  archetype: RepoArchetype;
  /** Newest-scan overall target (0..100). */
  target: number;
  /** Points the repo moved across the window (positive = improving toward `target`). */
  trendPoints: number;
}

function dimensionsFor(spec: RepoSpec, overallTarget: number, rng: () => number): DimensionResult[] {
  const w = weightsFor(spec.archetype);
  return DIMENSIONS.map((d) => {
    // Per-dimension offset gives each repo a believable shape (adoption vs rigor strengths), stable
    // per (repo, dimension); then small per-scan noise so the trend line isn't a ruler.
    const offset = (hash32(spec.owner + "/" + spec.name + ":" + d.id) % 31) - 15; // -15..+15
    const noise = (rng() - 0.5) * 8;
    const score = clamp(Math.round(overallTarget + offset + noise));
    return {
      id: d.id,
      name: DIMENSION_BY_ID[d.id].name,
      weight: w[d.id],
      score,
      signalScore: clamp(Math.round(score + (rng() - 0.5) * 6)),
      llmScore: clamp(Math.round(score + (rng() - 0.5) * 6)),
      summary: `${DIMENSION_BY_ID[d.id].name} is ${phraseFor(score)}.`,
      evidence: score >= 45 ? [`Detected ${DIMENSION_BY_ID[d.id].name.toLowerCase()} signals in CI + config`] : [],
      strengths: score >= 60 ? [`Healthy ${DIMENSION_BY_ID[d.id].name.toLowerCase()} coverage`] : [],
      gaps: score < 55 ? [`${DIMENSION_BY_ID[d.id].name} not yet enforced on every path`] : [],
    } satisfies DimensionResult;
  });
}

function roadmapFor(dims: DimensionResult[], level: string): LlmRoadmapItem[] {
  const weakest = [...dims].sort((a, b) => a.score - b.score).slice(0, 3);
  const up = nextLevel(level);
  return weakest.map((d, i) => ({
    title: `Strengthen ${d.name}`,
    dimension: d.id,
    impact: d.score < 40 ? "high" : d.score < 60 ? "medium" : "low",
    effort: d.score < 40 ? "high" : "medium",
    rationale: `${d.name} is the lowest-leverage gap holding this repo below the next level.`,
    explore: [`What would make ${d.name.toLowerCase()} pass automatically in CI?`],
    levelUnlock: i === 0 && up ? `${level}->${up.id}` : undefined,
  }));
}

function contributorsFor(spec: RepoSpec, adoption: number, rng: () => number): Contributor[] {
  const count = 5 + Math.floor(rng() * 11); // 5..15
  const aiFraction = clamp(adoption + (rng() - 0.5) * 20, 5, 95) / 100;
  const used = new Set<string>();
  const out: Contributor[] = [];
  for (let i = 0; i < count; i++) {
    let login = pick(rng, PERSON_POOL);
    while (used.has(login)) login = `${pick(rng, PERSON_POOL)}-${i}`;
    used.add(login);
    const commits = 5 + Math.floor(rng() * 120);
    out.push({
      login,
      name: login[0]!.toUpperCase() + login.slice(1),
      commits,
      aiCommits: Math.round(commits * aiFraction * rng()),
      lastActiveAt: undefined,
    });
  }
  return out;
}

function teamsFor(spec: RepoSpec, rng: () => number): TeamOwnership[] {
  const count = 2 + Math.floor(rng() * 3); // 2..4
  const chosen = new Set<string>();
  while (chosen.size < count) chosen.add(pick(rng, TEAM_POOL));
  return [...chosen].map((slug, i) => ({
    slug: slug.toLowerCase(),
    ownedPaths: 1 + Math.floor(rng() * 8),
    isDefaultOwner: i === 0,
  }));
}

/** Build one repo's full back-dated scan history (oldest → newest), ready to persist in order. */
export function reportsForRepo(spec: RepoSpec, scansPerRepo: number, weeksBack: number, now: number): ScanReport[] {
  const reports: ScanReport[] = [];
  const N = Math.max(1, scansPerRepo);
  for (let i = 0; i < N; i++) {
    const p = N === 1 ? 1 : i / (N - 1); // 0 (oldest) → 1 (newest)
    const rng = mulberry32(hash32(`${spec.owner}/${spec.name}#${i}`));
    const overallTarget = clamp(spec.target - spec.trendPoints * (1 - p));
    const dims = dimensionsFor(spec, overallTarget, rng);
    const overallScore = overallScoreFor(dims, spec.archetype);
    const scoreOf = (id: DimensionId) => dims.find((d) => d.id === id)?.score ?? 0;
    const adoptionScore = axisScore("adoption", scoreOf, spec.archetype);
    const rigorScore = axisScore("rigor", scoreOf, spec.archetype);
    const level = levelForScore(overallScore);
    const posture: Posture = postureFor(adoptionScore, rigorScore);
    // Back-date from `now` (newest, p=1) to weeksBack ago (oldest, p=0), at ms precision so the series
    // is strictly chronological for ANY (scansPerRepo, weeksBack) — a day-rounded offset could collide
    // for high scan counts and reorder the history. Still spans many distinct calendar days, which the
    // Trajectory forecast needs (it groups scans by day and fits a line).
    const msAgo = Math.round(weeksBack * 7 * 86_400_000 * (1 - p));
    const scannedAt = new Date(now - msAgo).toISOString();
    const commitFraction = clamp(adoptionScore + (rng() - 0.5) * 20, 0, 100) / 100;
    const aiUsage: AiUsage = {
      detected: adoptionScore >= 40,
      commitFraction,
      signals: adoptionScore >= 40 ? ["AI co-author trailers in recent commits"] : [],
    };
    reports.push({
      repo: {
        owner: spec.owner,
        name: spec.name,
        url: `https://github.com/${spec.owner}/${spec.name}`,
        stars: spec.stars,
        forks: Math.round(spec.stars / 8),
        primaryLanguage: spec.primaryLanguage,
        defaultBranch: "main",
        headSha: fakeSha(`${spec.owner}/${spec.name}#${i}`),
        isPrivate: false,
      },
      overallScore,
      level,
      archetype: spec.archetype,
      adoptionScore,
      rigorScore,
      posture,
      aiUsage,
      contributors: contributorsFor(spec, adoptionScore, rng),
      teams: teamsFor(spec, rng),
      commitActivity: Array.from({ length: 12 }, () => Math.floor(rng() * 40)),
      dimensions: dims,
      headline: `${spec.name} is ${level.name} (${overallScore}/100) — ${posture.label}.`,
      strengths: [`${posture.label} posture`, "Active contributor base"],
      risks: rigorScore < 50 ? ["Guardrails lag AI adoption"] : ["Maintain rigor as velocity grows"],
      roadmap: roadmapFor(dims, level.id),
      discrepancies: [],
      confidence: 0.9,
      scannedAt,
      engine: { provider: "mock" as ProviderName, model: "ascent-seed" },
    });
  }
  return reports;
}

// ── Fleet + curated-public spec builders ──────────────────────────────────────────────────────

/** Generate `count` synthetic repo specs for a named org, with a believable spread of maturity. */
export function fleetSpecs(org: string, count: number): RepoSpec[] {
  const specs: RepoSpec[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    const rng = mulberry32(hash32(`${org}/repo#${i}`));
    let name = `${NAME_PREFIXES[i % NAME_PREFIXES.length]}-${NAME_NOUNS[Math.floor(i / NAME_PREFIXES.length) % NAME_NOUNS.length]}`;
    let suffix = 2;
    while (used.has(name)) name = `${name}-${suffix++}`;
    used.add(name);
    const archetype: RepoArchetype = rng() < 0.7 ? "org" : rng() < 0.6 ? "team" : "solo";
    specs.push({
      owner: org,
      name,
      primaryLanguage: pick(rng, LANGS),
      stars: Math.floor(rng() * 4000),
      archetype,
      target: clamp(28 + Math.floor(rng() * 60)), // 28..88 — a real fleet spread
      trendPoints: Math.floor((rng() - 0.35) * 26), // mostly improving, some flat/declining
    });
  }
  return specs;
}

/** A handful of well-known public repos, scored high, for the landing register + the sample hero. */
export function curatedPublicSpecs(): RepoSpec[] {
  const raw: Omit<RepoSpec, "trendPoints">[] = [
    { owner: "vercel", name: "next.js", primaryLanguage: "TypeScript", stars: 121000, archetype: "org", target: 86 },
    { owner: "anthropics", name: "claude-code", primaryLanguage: "TypeScript", stars: 31000, archetype: "org", target: 89 },
    { owner: "facebook", name: "react", primaryLanguage: "JavaScript", stars: 224000, archetype: "org", target: 80 },
    { owner: "supabase", name: "supabase", primaryLanguage: "TypeScript", stars: 71000, archetype: "org", target: 78 },
    { owner: "prisma", name: "prisma", primaryLanguage: "TypeScript", stars: 39000, archetype: "org", target: 76 },
    { owner: "langchain-ai", name: "langchain", primaryLanguage: "Python", stars: 92000, archetype: "org", target: 74 },
    { owner: "denoland", name: "deno", primaryLanguage: "Rust", stars: 97000, archetype: "org", target: 72 },
    { owner: "withastro", name: "astro", primaryLanguage: "TypeScript", stars: 46000, archetype: "org", target: 70 },
  ];
  return raw.map((r) => ({ ...r, trendPoints: 8 + (hash32(r.name) % 8) }));
}
