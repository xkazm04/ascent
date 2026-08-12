// ─────────────────────────────────────────────────────────────────────────────
// ⚠ PROTOTYPE MOCK — NOT A DATA SOURCE. ⚠
//
// The Context Health panel measures the QUALITY of a repo's agent-context layer
// (AGENTS.md / CLAUDE.md / .cursorrules) rather than its mere presence. Ascent's
// scan today only detects PRESENCE (src/lib/analyze/index.ts D5 adds points for
// "Found CLAUDE.md" / "Found AGENTS.md"; passport.automationReadiness.artifacts
// .agentInstructions lists the paths). There is no persisted signal for a context
// file's last-edit date, size, authorship provenance, or how much of the repo it
// actually describes.
//
// So this module SPLITS the inputs:
//   REAL  — read straight off OrgRepoRow (@/lib/db/org-rollup):
//             · presence + file paths  ← passport.automationReadiness.artifacts.agentInstructions
//             · change rate            ← activity.commitsWeekly (GitHub commit_activity)
//             · docs posture           ← latest.dims D5
//             · last scan              ← lastScanAt
//   MOCK  — deterministically synthesized from a hash of the repo's fullName, so
//           the panel is stable across reloads and reviewable side-by-side:
//             · context file age, bytes, authorship, specificity, path coverage
//
// Every mocked field is marked `[MOCK]` below. When the real signal lands (see the
// "Data-model needs" note at the bottom), delete the synthesis and keep the derive*
// functions — those are real math over whatever inputs exist.
// ─────────────────────────────────────────────────────────────────────────────

import type { OrgRepoRow } from "@/lib/db/org-rollup";

/** Who wrote the context file. Research finding this panel exists to surface: human-curated
 *  context pays off, LLM-generated context measurably hurts. Presence-checkers can't tell them apart. */
export type ContextProvenance = "human" | "mixed" | "generated" | "none";

/** Freshness band for a repo's context layer, derived from remaining potency (see `decayPotency`). */
export type ContextBand = "fresh" | "aging" | "stale" | "absent";

export interface ContextFile {
  /** REAL when the passport listed it; otherwise the conventional name. */
  path: string;
  /** [MOCK] days since the file was last edited. */
  ageDays: number;
  /** [MOCK] file size — a proxy for how much guidance it actually carries. */
  bytes: number;
  /** [MOCK] human / mixed / generated. */
  authorship: ContextProvenance;
  /** [MOCK] 0..100 — how repo-specific the prose is vs generic boilerplate. */
  specificity: number;
}

export interface RepoContextHealth {
  fullName: string;
  name: string;
  /** REAL — the passport detected at least one agent-instruction file. */
  present: boolean;
  files: ContextFile[];
  /** The freshest context file — the one the agent most likely reads first. */
  primary: ContextFile | null;
  /** REAL — mean weekly commits over the trailing ~1 month window. */
  commitsPerWeek: number;
  /** REAL — D5 (Docs) score from the latest scan, or null when unscanned. */
  docsScore: number | null;
  /** Days since the freshest context file was touched (`primary.ageDays`). */
  ageDays: number;
  /** Commits that landed on the repo SINCE the context file was last edited — the drift driver. */
  churnSinceEdit: number;
  /** 0..100 — remaining "potency" of the context under that churn. */
  potency: number;
  /** 100 − potency. How far the map has fallen behind the territory. */
  driftPct: number;
  /** Days until potency halves at the repo's current change rate. Infinity for a quiet repo. */
  halfLifeDays: number;
  /** [MOCK] how many of the repo's top-level areas the context file actually names. */
  coverage: { covered: number; total: number };
  /** [MOCK] 0..100 repo-specificity of the prose. */
  specificity: number;
  provenance: ContextProvenance;
  /** 0..100 composite context-quality score (specificity · potency · coverage, provenance-penalized). */
  quality: number;
  band: ContextBand;
  /** One-line plain-language verdict — what the row is telling you. */
  verdict: string;
}

// ── deterministic pseudo-random (mock only) ──────────────────────────────────

/** FNV-1a — stable across processes so two reloads render identical prototype data. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic 0..1 draw for `key` on axis `salt`. [MOCK] */
function draw(key: string, salt: string): number {
  return (hash(`${key}::${salt}`) % 10_000) / 10_000;
}

// ── real math (keep these when the real signal lands) ────────────────────────

/** Mean of a numeric series, 0 for empty. */
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/**
 * Exponential decay of context potency under code churn. A context file doesn't rot with the
 * calendar — it rots with the commits that landed after it was written. `tolerance` is how many
 * commits the file can absorb before it's half wrong; a longer, more specific file tolerates more.
 */
export function decayPotency(churnSinceEdit: number, tolerance: number): number {
  if (tolerance <= 0) return 0;
  return Math.round(100 * Math.pow(0.5, churnSinceEdit / tolerance));
}

/** Days until potency halves at `commitsPerWeek`. Infinity when nothing is landing. */
export function halfLife(tolerance: number, commitsPerWeek: number): number {
  if (commitsPerWeek <= 0) return Infinity;
  return (tolerance / commitsPerWeek) * 7;
}

/** Composite 0..100 context quality. Provenance is a multiplier, not an addend: an LLM-generated
 *  context file that is fresh and broad is still worse than a shorter human-curated one. */
export function contextQuality(input: {
  specificity: number;
  potency: number;
  coverageRatio: number;
  provenance: ContextProvenance;
}): number {
  if (input.provenance === "none") return 0;
  const base = 0.42 * input.specificity + 0.33 * input.potency + 0.25 * input.coverageRatio * 100;
  const penalty = input.provenance === "generated" ? 0.62 : input.provenance === "mixed" ? 0.86 : 1;
  return Math.max(0, Math.min(100, Math.round(base * penalty)));
}

function bandFor(present: boolean, potency: number): ContextBand {
  if (!present) return "absent";
  if (potency >= 66) return "fresh";
  if (potency >= 33) return "aging";
  return "stale";
}

function verdictFor(r: Omit<RepoContextHealth, "verdict">): string {
  if (!r.present) {
    return r.commitsPerWeek >= 4
      ? `No agent context — ${Math.round(r.commitsPerWeek)} commits/wk landing unguided`
      : "No agent context file detected";
  }
  if (r.provenance === "generated") return "Context reads as LLM-generated — the pattern that measurably hurts";
  if (r.band === "stale") return `${r.churnSinceEdit} commits since last edit — the map no longer matches`;
  if (r.coverage.covered / Math.max(1, r.coverage.total) < 0.4) {
    return `Names ${r.coverage.covered}/${r.coverage.total} areas — most of the repo is undescribed`;
  }
  if (r.specificity < 45) return "Generic boilerplate — little repo-specific guidance";
  if (r.band === "fresh") return "Human-curated, current, and specific";
  return `Aging — ${r.churnSinceEdit} commits since last edit`;
}

// ── row builder ──────────────────────────────────────────────────────────────

const CONVENTIONAL = ["AGENTS.md", "CLAUDE.md", ".claude/CLAUDE.md", ".cursorrules"];

export function buildContextHealth(repos: OrgRepoRow[]): RepoContextHealth[] {
  return repos.map((r) => {
    // REAL: presence + paths from the passport's automation-readiness artifacts.
    const declared = r.passport?.automationReadiness.artifacts.agentInstructions ?? [];
    const present = declared.length > 0;
    // REAL: change rate from the already-ingested GitHub commit_activity blob.
    const commitsPerWeek = Math.round(mean(r.activity?.commitsWeekly ?? []) * 10) / 10;
    // REAL: D5 Docs score — the closest existing proxy, used to bias the mock so the
    // prototype's fake numbers at least point the same way the real scan does.
    const docsScore = r.latest?.dims.find((d) => d.dimId === "D5")?.score ?? null;
    const docsBias = (docsScore ?? 45) / 100;

    const paths = present ? declared : [];
    const files: ContextFile[] = paths.map((p, i) => {
      const k = `${r.fullName}:${p}`;
      // [MOCK] age skews younger for repos that score well on D5.
      const ageDays = Math.round(3 + draw(k, "age") * 240 * (1.25 - docsBias));
      const bytes = Math.round(400 + draw(k, "bytes") * 11_000 * (0.4 + docsBias));
      const spec = Math.round(15 + draw(k, "spec") * 85 * (0.5 + docsBias * 0.7));
      const provDraw = draw(k, "prov");
      const authorship: ContextProvenance =
        provDraw > 0.72 ? "human" : provDraw > 0.34 ? "mixed" : "generated";
      return {
        path: p || CONVENTIONAL[i % CONVENTIONAL.length] || "AGENTS.md",
        ageDays,
        bytes,
        authorship,
        specificity: Math.min(100, spec),
      };
    });

    const primary = files.length ? files.reduce((a, b) => (b.ageDays < a.ageDays ? b : a)) : null;
    const ageDays = primary?.ageDays ?? 0;
    const churnSinceEdit = Math.round((commitsPerWeek * ageDays) / 7);
    // Tolerance scales with how much real guidance the file carries (size × specificity).
    const tolerance = primary ? Math.max(8, (primary.bytes / 1000) * (primary.specificity / 12)) : 0;
    const potency = present ? decayPotency(churnSinceEdit, tolerance) : 0;

    // [MOCK] how many of the repo's areas the file actually names.
    const total = 4 + Math.round(draw(r.fullName, "areas") * 9);
    const covered = present ? Math.min(total, Math.round(total * (0.2 + draw(r.fullName, "cov") * 0.8 * (0.5 + docsBias)))) : 0;

    const specificity = primary?.specificity ?? 0;
    const provenance: ContextProvenance = primary?.authorship ?? "none";
    const quality = contextQuality({ specificity, potency, coverageRatio: covered / total, provenance });

    const partial: Omit<RepoContextHealth, "verdict"> = {
      fullName: r.fullName,
      name: r.name,
      present,
      files,
      primary,
      commitsPerWeek,
      docsScore,
      ageDays,
      churnSinceEdit,
      potency,
      driftPct: 100 - potency,
      halfLifeDays: halfLife(tolerance, commitsPerWeek),
      coverage: { covered, total },
      specificity,
      provenance,
      quality,
      band: bandFor(present, potency),
    };
    return { ...partial, verdict: verdictFor(partial) };
  });
}

export interface ContextFleetSummary {
  repos: number;
  /** REAL-derived: how many repos have ANY agent-instruction file — what competitors measure. */
  withContext: number;
  /** The quality-over-presence headline: repos whose context clears a usable quality bar. */
  withUsableContext: number;
  /** Mean context quality across the fleet, 0 for repos with none. */
  avgQuality: number;
  /** Median half-life in days across repos that have context and are actually moving. */
  medianHalfLifeDays: number | null;
  /** Repos whose context has decayed past its own half-life. */
  pastHalfLife: number;
  /** Repos whose primary context file reads as LLM-generated — the negative-value cohort. */
  generated: number;
  /** Commits that have landed fleet-wide since each repo's context was last touched. */
  unguidedCommits: number;
}

/** The quality bar a context file must clear to count as an asset rather than decoration. */
export const USABLE_QUALITY = 55;

export function fleetContextSummary(rows: RepoContextHealth[]): ContextFleetSummary {
  const withContext = rows.filter((r) => r.present);
  const halves = withContext.map((r) => r.halfLifeDays).filter((d) => Number.isFinite(d)).sort((a, b) => a - b);
  return {
    repos: rows.length,
    withContext: withContext.length,
    withUsableContext: rows.filter((r) => r.quality >= USABLE_QUALITY).length,
    avgQuality: rows.length ? Math.round(rows.reduce((a, r) => a + r.quality, 0) / rows.length) : 0,
    medianHalfLifeDays: halves.length ? Math.round(halves[Math.floor(halves.length / 2)] ?? 0) : null,
    pastHalfLife: withContext.filter((r) => r.potency < 50).length,
    generated: rows.filter((r) => r.provenance === "generated").length,
    unguidedCommits: rows.reduce((a, r) => a + r.churnSinceEdit, 0),
  };
}

export const PROVENANCE_LABEL: Record<ContextProvenance, string> = {
  human: "Human-curated",
  mixed: "Mixed authorship",
  generated: "LLM-generated",
  none: "No context",
};

// ── Data-model needs discovered while building this panel ─────────────────────
// To make this real, a scan would need to persist, per detected context file:
//   1. lastCommitAt for the file (git log -1 -- <path>) — the freshness clock.
//   2. byteSize + heading/section count — the "does it carry guidance" proxy.
//   3. the head SHA at that file's last edit, so churnSinceEdit is a real commit
//      count (git rev-list <sha>..HEAD --count) rather than a rate × age estimate.
//   4. an authorship signal — co-author trailers / commit-message provenance, or an
//      LLM pass grading the prose as curated vs generated.
//   5. the set of repo paths the file references, vs the repo's actual top-level
//      areas — the coverage ratio.
// (1)–(3) are cheap, git-side, and repo-keyed. (4)–(5) need the LLM leg of the scan.
