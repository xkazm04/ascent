// Executive briefing — assembles the existing org aggregates (maturity rollup, corpus benchmark,
// movers, goals, forecast) into one exec-grade narrative, plus a markdown serializer that doubles as
// the "Copy for LLM" payload (paste into Claude Code / an LLM to get next actions). Pure assembly over
// @/lib/db; no new queries. Powers /org/[slug]/executive and (Phase 5.2) the scheduled PDF digest.

import {
  getOrgBenchmark,
  getOrgMovers,
  getOrgRollup,
  listGoals,
  type OrgWindow,
  type RepoMove,
} from "@/lib/db";
import { getOrgEngineMix, getOrgRecsActioned, type EngineMixEntry } from "@/lib/db/org-rollup";
import { forecastHeadline } from "@/lib/maturity/forecast";
import { DIMENSION_BY_ID, levelForScore } from "@/lib/maturity/model";
import type { DimensionId } from "@/lib/types";

const ENGINE_LABEL: Record<string, string> = {
  "claude-cli": "Claude CLI",
  claude: "Claude",
  gemini: "Gemini",
  bedrock: "AWS Bedrock",
  mock: "Mock (deterministic)",
};

/** Human label for an inference-engine provider id. */
export function engineLabel(provider: string): string {
  return ENGINE_LABEL[provider] ?? provider;
}

/** "Claude CLI ×18, Mock ×2" — the period's scoring provenance, busiest engine first. */
export function engineMixLabel(mix: EngineMixEntry[]): string {
  return mix.map((e) => `${engineLabel(e.provider)} ×${e.count}`).join(", ");
}

/** True when the deterministic mock engine produced SOME (but not all) of the period's scores — a
 *  partial fallback that quietly weakens the read: the "mock-degraded quarter" an examiner must see. */
export function engineMixDegraded(mix: EngineMixEntry[]): boolean {
  const mock = mix.find((e) => e.provider === "mock")?.count ?? 0;
  const real = mix.reduce((a, e) => a + (e.provider === "mock" ? 0 : e.count), 0);
  return mock > 0 && real > 0;
}

/** One-line value-realization summary ("3 recommendations completed · fleet +6 pts · 2 repos leveled
 *  up"), or null when nothing measurable happened this period — so the renewal line only appears when
 *  there's value to show, never as an empty "0 · 0 · 0". Shared by the exec page and the markdown. */
export function valueRealizedLine(vr: ExecBriefing["valueRealized"]): string | null {
  const parts: string[] = [];
  if (vr.recsActioned > 0) parts.push(`${vr.recsActioned} recommendation${vr.recsActioned === 1 ? "" : "s"} completed`);
  else if (vr.recsEngaged > 0) parts.push(`${vr.recsEngaged} recommendation${vr.recsEngaged === 1 ? "" : "s"} actioned`);
  if (vr.pointsMoved != null && vr.pointsMoved !== 0) parts.push(`fleet ${vr.pointsMoved > 0 ? "+" : ""}${vr.pointsMoved} pts`);
  if (vr.reposPromoted > 0) parts.push(`${vr.reposPromoted} repo${vr.reposPromoted === 1 ? "" : "s"} leveled up`);
  return parts.length ? parts.join(" · ") : null;
}

export interface BriefingDim {
  dimId: string;
  label: string;
  avg: number;
}
export interface BriefingMove {
  name: string;
  dOverall: number;
  levelFrom: string;
  levelTo: string;
}
export interface BriefingGoal {
  label: string;
  current: number;
  target: number;
  pct: number;
  pace: string;
  etaDays: number | null;
}

export interface ExecBriefing {
  org: string;
  periodTitle: string;
  generatedOn: string; // YYYY-MM-DD
  maturity: { overall: number; levelId: string; levelName: string; adoption: number; rigor: number };
  coverage: { scanned: number; total: number };
  /** Overall-score delta vs the window's start, or null for all-time / no baseline. */
  periodDelta: number | null;
  /** End-state comparison against the immediately-preceding equal-length window (EXEC-4); null for
   *  all-time or when the prior window has no scans. Whole-fleet (not cohort-matched) — a "vs previous
   *  period" read across headline + dimensions. */
  priorPeriod: {
    overall: number;
    adoption: number;
    rigor: number;
    dOverall: number;
    dAdoption: number;
    dRigor: number;
    /** Per-dimension now/prior/delta, biggest movers first (capped). */
    dims: { dimId: string; label: string; now: number; prior: number; delta: number }[];
  } | null;
  forecastHeadline: string | null;
  /** Trend confidence (R² as 0–100) behind the forecast headline; null when there's too little history.
   *  Carried so the executive read shows the same "· noisy" honesty the overview Trajectory card does. */
  forecastConfidence: number | null;
  /** Which inference engine(s) produced this period's scores — provenance so a mock-degraded quarter
   *  is auditable in the durable briefing, not just the transient scan stream. */
  engineMix: EngineMixEntry[];
  /** Fleet adoption rate (0..100) — share of scanned repos at a HIGH-adoption posture (AI-Native or
   *  Fast & Ungoverned). The "is the standardization landing across the fleet" number a platform lead
   *  tracks cycle-over-cycle; null when nothing is scanned. */
  adoptionRate: number | null;
  /** Full-fleet movement scale this period (not just the top-3 listed) — how many comparable repos moved
   *  up vs down, so a 200-repo fleet sees the spread, not a capped list. */
  movement: { up: number; down: number; compared: number };
  /** Value realized THIS period — the renewal-justification: recs acted on, points moved, repos
   *  promoted. Answers "did anyone use it, and did it move the number?" rather than leaving a renewer
   *  to reconstruct it. */
  valueRealized: {
    /** Recommendations with any status change in the window (engagement). */
    recsEngaged: number;
    /** Recommendations moved to "done" in the window (completion). */
    recsActioned: number;
    /** Overall fleet points moved vs the period baseline; null on the all-time window. */
    pointsMoved: number | null;
    /** Repos that crossed up a maturity level in the window. */
    reposPromoted: number;
  };
  benchmark: {
    percentile: number | null;
    corpusRepos: number;
    corpusAvgOverall: number;
    /** Same-language peer cohort (sharper than the whole corpus); null when too few peers. */
    cohort: { language: string; repos: number; overallPercentile: number | null; adoptionPercentile: number | null } | null;
  } | null;
  strengths: BriefingDim[];
  risks: BriefingDim[];
  security: BriefingDim | null;
  topGainers: BriefingMove[];
  topRegressions: BriefingMove[];
  goals: BriefingGoal[];
  regressionCount: number;
}

const named = (d: { dimId: string; avg: number }): BriefingDim => ({
  dimId: d.dimId,
  label: DIMENSION_BY_ID[d.dimId as DimensionId]?.name ?? d.dimId,
  avg: d.avg,
});
const moveRow = (m: RepoMove): BriefingMove => ({
  name: m.name,
  dOverall: m.dOverall,
  levelFrom: m.levelFrom,
  levelTo: m.levelTo,
});

/** Assemble the briefing for an org over an optional window. Null when nothing has been scanned. */
export async function buildExecBriefing(
  orgSlug: string,
  window?: OrgWindow,
  periodTitle = "all time",
  segmentId?: string | null,
): Promise<ExecBriefing | null> {
  // EXEC-4: the immediately-preceding equal-length window — its END state is the start of this one,
  // so current-minus-prior reads as movement across the period (per dimension + headline). Only when
  // the window has a start (all-time has no "previous period").
  const priorWindow: OrgWindow | undefined = window?.start
    ? {
        start: new Date(window.start.getTime() - ((window.end ?? new Date()).getTime() - window.start.getTime())),
        end: window.start,
      }
    : undefined;

  const [rollup, benchmark, movers, goals, priorRollup, engineMix, recsActivity] = await Promise.all([
    getOrgRollup(orgSlug, window, segmentId),
    getOrgBenchmark(orgSlug),
    getOrgMovers(orgSlug, window, segmentId),
    listGoals(orgSlug),
    priorWindow ? getOrgRollup(orgSlug, priorWindow, segmentId) : Promise.resolve(null),
    getOrgEngineMix(orgSlug, window, segmentId),
    getOrgRecsActioned(orgSlug, window, segmentId),
  ]);
  if (!rollup || rollup.scannedCount === 0) return null;

  const level = levelForScore(rollup.avgOverall);
  const dimSorted = [...rollup.dimAverages].sort((a, b) => b.avg - a.avg);
  const security = rollup.dimAverages.find((d) => d.dimId === "D9");

  // Strengths = top dims; risks = bottom dims. On a sparse fleet (<6 distinct dims) slice(0,3) and
  // slice(-3) would overlap, listing the same dim as both a top strength AND a top risk. Keep the two
  // lists DISJOINT by excluding any strength from the risk pool (rich-fleet behavior is unchanged —
  // there they were already disjoint). Ordering preserved: strengths strongest-first, risks weakest-first.
  const strengthDims = dimSorted.slice(0, 3);
  const strengthIds = new Set(strengthDims.map((d) => d.dimId));
  const riskDims = dimSorted
    .filter((d) => !strengthIds.has(d.dimId))
    .slice(-3)
    .reverse();

  const priorPeriod =
    priorRollup && priorRollup.scannedCount > 0
      ? (() => {
          const priorBy = new Map(priorRollup.dimAverages.map((d) => [d.dimId, d.avg]));
          return {
            overall: priorRollup.avgOverall,
            adoption: priorRollup.avgAdoption,
            rigor: priorRollup.avgRigor,
            dOverall: rollup.avgOverall - priorRollup.avgOverall,
            dAdoption: rollup.avgAdoption - priorRollup.avgAdoption,
            dRigor: rollup.avgRigor - priorRollup.avgRigor,
            dims: rollup.dimAverages
              .map((d) => ({
                dimId: d.dimId,
                label: DIMENSION_BY_ID[d.dimId as DimensionId]?.name ?? d.dimId,
                now: d.avg,
                prior: priorBy.get(d.dimId) ?? 0,
                delta: d.avg - (priorBy.get(d.dimId) ?? 0),
              }))
              .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
              .slice(0, 6),
          };
        })()
      : null;

  return {
    org: orgSlug,
    periodTitle,
    generatedOn: new Date().toISOString().slice(0, 10),
    maturity: {
      overall: rollup.avgOverall,
      levelId: level.id,
      levelName: level.name,
      adoption: rollup.avgAdoption,
      rigor: rollup.avgRigor,
    },
    coverage: { scanned: rollup.scannedCount, total: rollup.repoCount },
    periodDelta: rollup.baseline ? rollup.avgOverall - rollup.baseline.avgOverall : null,
    priorPeriod,
    forecastHeadline: rollup.forecast ? forecastHeadline(rollup.forecast) : null,
    forecastConfidence: rollup.forecast ? Math.round(rollup.forecast.fitQuality * 100) : null,
    engineMix,
    adoptionRate:
      rollup.scannedCount > 0
        ? Math.round((((rollup.postureCounts["ai-native"] ?? 0) + (rollup.postureCounts["ungoverned"] ?? 0)) / rollup.scannedCount) * 100)
        : null,
    movement: {
      up: movers?.gainers.length ?? 0,
      down: movers?.regressers.length ?? 0,
      compared: movers?.comparedRepos ?? 0,
    },
    valueRealized: {
      recsEngaged: recsActivity.engaged,
      recsActioned: recsActivity.actioned,
      pointsMoved: rollup.baseline ? rollup.avgOverall - rollup.baseline.avgOverall : null,
      reposPromoted: movers?.levelChanges?.filter((m) => m.levelDelta > 0).length ?? 0,
    },
    benchmark: benchmark
      ? {
          percentile: benchmark.overallPercentile,
          corpusRepos: benchmark.corpusRepos,
          corpusAvgOverall: benchmark.corpusAvgOverall,
          cohort: benchmark.cohort
            ? {
                language: benchmark.cohort.language,
                repos: benchmark.cohort.repos,
                overallPercentile: benchmark.cohort.overallPercentile,
                adoptionPercentile: benchmark.cohort.adoptionPercentile,
              }
            : null,
        }
      : null,
    strengths: strengthDims.map(named),
    risks: riskDims.map(named),
    security: security ? named(security) : null,
    topGainers: (movers?.gainers ?? []).slice(0, 3).map(moveRow),
    topRegressions: (movers?.regressers ?? []).slice(0, 3).map(moveRow),
    goals: (goals ?? []).map((g) => ({
      label: g.label,
      current: g.current,
      target: g.target,
      pct: g.pct,
      pace: g.pace,
      etaDays: g.etaDays,
    })),
    regressionCount: movers?.regressers.length ?? 0,
  };
}

/**
 * Serialize a briefing to a self-contained markdown brief — the "Copy for LLM" payload. It states the
 * current standing, strengths/weaknesses, movement and goals, and ends with an explicit ASK so a dev
 * can paste it straight into Claude Code / an LLM and get back the highest-leverage next actions.
 */
export function briefingMarkdown(b: ExecBriefing): string {
  const out: string[] = [];
  const delta = b.periodDelta == null ? "" : ` (${b.periodDelta >= 0 ? "+" : ""}${b.periodDelta} vs ${b.periodTitle} start)`;
  const moveLine = (arrow: string, m: BriefingMove) =>
    `- ${arrow} ${m.name}: ${m.dOverall >= 0 ? "+" : ""}${m.dOverall}${m.levelFrom !== m.levelTo ? ` (${m.levelFrom}→${m.levelTo})` : ""}`;

  out.push(`# Ascent — AI-native engineering maturity briefing: ${b.org}`);
  out.push(`Generated ${b.generatedOn} · period: ${b.periodTitle}`);
  out.push("");
  out.push("## Standing");
  out.push(`- Overall maturity: **${b.maturity.overall}/100** (${b.maturity.levelId} ${b.maturity.levelName})${delta}`);
  out.push(`- AI Adoption: ${b.maturity.adoption}/100 · Engineering Rigor: ${b.maturity.rigor}/100`);
  out.push(`- Coverage: ${b.coverage.scanned}/${b.coverage.total} repositories scanned`);
  const vline = valueRealizedLine(b.valueRealized);
  if (vline) out.push(`- Value this period: ${vline}`);
  if (b.adoptionRate != null) out.push(`- Fleet adoption: ${b.adoptionRate}% of scanned repos at a high AI-adoption posture`);
  if (b.benchmark?.percentile != null) {
    out.push(`- Benchmark: ${b.benchmark.percentile}th percentile vs ${b.benchmark.corpusRepos} repos (corpus avg ${b.benchmark.corpusAvgOverall})`);
  }
  if (b.benchmark?.cohort && b.benchmark.cohort.overallPercentile != null) {
    const c = b.benchmark.cohort;
    out.push(
      `- Peer cohort (${c.language}): ${c.overallPercentile}th percentile overall vs ${c.repos} ${c.language} repos${c.adoptionPercentile != null ? `; ${c.adoptionPercentile}th on AI adoption` : ""}`,
    );
  }
  if (b.forecastHeadline)
    out.push(
      `- Trajectory: ${b.forecastHeadline}${b.forecastConfidence != null ? ` (trend confidence ${b.forecastConfidence}%${b.forecastConfidence < 50 ? ", noisy" : ""})` : ""}`,
    );
  if (b.engineMix.length)
    out.push(
      `- Scored by: ${engineMixLabel(b.engineMix)}${engineMixDegraded(b.engineMix) ? " — ⚠ some scores used the deterministic mock engine, not the live model" : ""}`,
    );
  if (b.priorPeriod) {
    const p = b.priorPeriod;
    const d = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
    out.push("");
    out.push("## vs previous period");
    out.push(`- Overall ${p.overall} → ${b.maturity.overall} (${d(p.dOverall)}) · Adoption ${d(p.dAdoption)} · Rigor ${d(p.dRigor)}`);
    for (const dim of p.dims.filter((x) => x.delta !== 0)) {
      out.push(`- ${dim.dimId} ${dim.label}: ${dim.prior} → ${dim.now} (${d(dim.delta)})`);
    }
  }
  out.push("");
  out.push("## Strengths (top dimensions)");
  for (const d of b.strengths) out.push(`- ${d.dimId} ${d.label}: ${d.avg}/100`);
  out.push("");
  out.push("## Weakest dimensions (where to focus)");
  for (const d of b.risks) out.push(`- ${d.dimId} ${d.label}: ${d.avg}/100`);
  if (b.security) out.push(`- Security (${b.security.dimId} ${b.security.label}): ${b.security.avg}/100`);
  if (b.topGainers.length || b.topRegressions.length) {
    out.push("");
    out.push("## Movement this period");
    if (b.movement.compared > 0)
      out.push(`- ${b.movement.up + b.movement.down} of ${b.movement.compared} compared repos moved (${b.movement.up} ▲ / ${b.movement.down} ▼)`);
    for (const m of b.topGainers) out.push(moveLine("▲", m));
    for (const m of b.topRegressions) out.push(moveLine("▼", m));
  }
  if (b.goals.length) {
    out.push("");
    out.push("## Goals");
    for (const g of b.goals) {
      out.push(`- ${g.label}: ${g.current}/${g.target} (${g.pct}%, ${g.pace}${g.etaDays != null ? `, ETA ~${g.etaDays}d` : ""})`);
    }
  }
  // Name the recommended next move ON-SCREEN — the product makes the call (the fleet's weakest
  // dimension is its highest-leverage lift) instead of offloading the decision to the reader's LLM.
  const focus = b.risks[0] ?? b.security ?? null;
  if (focus) {
    out.push("");
    out.push("## Recommended next move");
    out.push(
      `Raise **${focus.dimId} ${focus.label}** — the fleet's weakest dimension at ${focus.avg}/100. It carries the most headroom, so closing it is the highest-leverage lift toward the next maturity level.`,
    );
  }
  out.push("");
  out.push("## Ask");
  out.push(
    focus
      ? `Elaborate the recommended move above (raise ${focus.dimId} ${focus.label}) into concrete, repo-level steps: for the repositories weakest on this dimension, the specific change to make and the practice that addresses it — then any second-order move across the other weak dimensions.`
      : "Given this AI-native engineering maturity briefing, propose the highest-leverage actions to raise overall maturity next quarter, focused on the weakest dimensions above. For each action give: the concrete change, which repositories it applies to, and which dimension it should move.",
  );
  return out.join("\n");
}
