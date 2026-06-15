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
import { forecastHeadline } from "@/lib/maturity/forecast";
import { DIMENSION_BY_ID, levelForScore } from "@/lib/maturity/model";
import type { DimensionId } from "@/lib/types";

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

  const [rollup, benchmark, movers, goals, priorRollup] = await Promise.all([
    getOrgRollup(orgSlug, window),
    getOrgBenchmark(orgSlug),
    getOrgMovers(orgSlug, window),
    listGoals(orgSlug),
    priorWindow ? getOrgRollup(orgSlug, priorWindow) : Promise.resolve(null),
  ]);
  if (!rollup || rollup.scannedCount === 0) return null;

  const level = levelForScore(rollup.avgOverall);
  const dimSorted = [...rollup.dimAverages].sort((a, b) => b.avg - a.avg);
  const security = rollup.dimAverages.find((d) => d.dimId === "D9");

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
    strengths: dimSorted.slice(0, 3).map(named),
    risks: dimSorted.slice(-3).reverse().map(named),
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
  if (b.benchmark?.percentile != null) {
    out.push(`- Benchmark: ${b.benchmark.percentile}th percentile vs ${b.benchmark.corpusRepos} repos (corpus avg ${b.benchmark.corpusAvgOverall})`);
  }
  if (b.benchmark?.cohort && b.benchmark.cohort.overallPercentile != null) {
    const c = b.benchmark.cohort;
    out.push(
      `- Peer cohort (${c.language}): ${c.overallPercentile}th percentile overall vs ${c.repos} ${c.language} repos${c.adoptionPercentile != null ? `; ${c.adoptionPercentile}th on AI adoption` : ""}`,
    );
  }
  if (b.forecastHeadline) out.push(`- Trajectory: ${b.forecastHeadline}`);
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
  out.push("");
  out.push("## Ask");
  out.push(
    "Given this AI-native engineering maturity briefing, propose the 3 highest-leverage actions to raise overall maturity next quarter, focused on the weakest dimensions above. For each action give: the concrete change, which repositories it applies to, and which dimension it should move.",
  );
  return out.join("\n");
}
