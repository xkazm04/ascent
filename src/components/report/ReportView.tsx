"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DimensionId, LevelId, LlmRoadmapItem, PersistedRecommendation, RecStatus, ScanReport } from "@/lib/types";
import type { RepositoryHistory } from "@/lib/db/scans";
import { ARCHETYPE_LABEL, DIMENSION_BY_ID, LEVELS, LLM_GUARDBAND, axisScore } from "@/lib/maturity/model";
import { cheapestPathToNextLevel, projectDimensionClose } from "@/lib/scoring/engine";
import { evaluateGate } from "@/lib/scoring/gate";
import { DIMENSION_SHORT, EFFORT_CLASS, IMPACT_CLASS, LEVEL_CLASSES, LEVEL_GLYPH, LEVEL_HEX, freshness, scoreGlyph, scoreHex, timeAgo } from "@/lib/ui";
import { PostureQuadrant, RadarChart, ScoreRing, useMounted, usePrefersReducedMotion } from "@/components/report/Charts";
import { Sparkline, TrendChart, type TrendPoint } from "@/components/report/TrendChart";
import { DeltaPill } from "@/components/report/deltas";

export function ReportView({ report, onRetest }: { report: ScanReport; onRetest?: () => void }) {
  const { repo, level } = report;
  // Keyless deterministic demo (no LLM). Drive every engine-related treatment off this single
  // flag so the demo signal stays consistent everywhere the engine is shown.
  const isMock = report.engine.provider === "mock";
  const lc = LEVEL_CLASSES[level.id];
  const curIdx = LEVELS.findIndex((l) => l.id === level.id);
  const nextLevel = curIdx >= 0 && curIdx < LEVELS.length - 1 ? LEVELS[curIdx + 1] : null;

  const [history, setHistory] = useState<RepositoryHistory | null>(null);
  const [recs, setRecs] = useState<PersistedRecommendation[] | null>(null);

  useEffect(() => {
    const repoRef = `${repo.owner}/${repo.name}`;
    let active = true;
    (async () => {
      try {
        const [h, r] = await Promise.all([
          fetch(`/api/history?repo=${encodeURIComponent(repoRef)}`),
          fetch(`/api/recommendations?repo=${encodeURIComponent(repoRef)}`),
        ]);
        if (active && h.ok) setHistory((await h.json()) as RepositoryHistory);
        if (active && r.ok) setRecs(((await r.json()).items ?? []) as PersistedRecommendation[]);
      } catch {
        /* DB not configured / offline — trend & tracking degrade silently */
      }
    })();
    return () => {
      active = false;
    };
  }, [repo.owner, repo.name]);

  // Reconcile the live report with persisted history. `history.scans` is newest-first and
  // MAY already include the scan being viewed (it can be persisted mid-stream) — or may not,
  // if the history fetch raced the write. Identify whether the current scan is stored (by
  // timestamp), and pick the baseline for deltas as the most recent scan STRICTLY older than
  // this report. This keeps the headline ring's "since last scan" delta and the trend line's
  // last point in agreement: no double-counting when the current scan IS stored, and no
  // skipping the true previous when it ISN'T.
  const scans = history?.scans ?? [];
  const currentStored = scans.some((s) => s.scannedAt === report.scannedAt);
  const baselineScan = scans.find((s) => s.scannedAt < report.scannedAt) ?? null;

  // Overall-score series (oldest → newest). Append the current point when it isn't persisted
  // yet, so the last trend dot always matches the ScoreRing rather than omitting it.
  const trendPoints: TrendPoint[] = (() => {
    const chrono: TrendPoint[] = [...scans]
      .reverse()
      .map((s) => ({ score: s.overallScore, at: s.scannedAt, engine: s.engineProvider }));
    if (!currentStored)
      chrono.push({ score: report.overallScore, at: report.scannedAt, engine: report.engine.provider });
    return chrono;
  })();

  const overallDelta = baselineScan ? report.overallScore - baselineScan.overallScore : null;
  const prevDimScores = baselineScan ? new Map(baselineScan.dimensions.map((d) => [d.dimId, d.score])) : null;

  // Baseline scan's posture position, for the quadrant trail. Persisted history doesn't store
  // the archetype, so re-roll the axes under the current lens (a faithful-enough trail).
  const prevPosture = baselineScan
    ? (() => {
        const m = new Map(baselineScan.dimensions.map((d) => [d.dimId as DimensionId, d.score]));
        const scoreFor = (id: DimensionId) => m.get(id) ?? 0;
        return {
          adoption: axisScore("adoption", scoreFor, report.archetype),
          rigor: axisScore("rigor", scoreFor, report.archetype),
        };
      })()
    : null;

  // Per-dimension score series (chronological) for sparklines. Append the current report as
  // the last point when it isn't persisted yet, and push ONLY scores that are present in
  // each scan (a dimension absent from an older scan yields a shorter series — a gap — never
  // a fabricated 0).
  const dimSeries = (() => {
    const chrono: { at: string; engine: string; dimensions: { dimId: string; score: number }[] }[] = [
      ...scans,
    ]
      .reverse()
      .map((s) => ({ at: s.scannedAt, engine: s.engineProvider, dimensions: s.dimensions }));
    if (!currentStored) {
      chrono.push({
        at: report.scannedAt,
        engine: report.engine.provider,
        dimensions: report.dimensions.map((d) => ({ dimId: d.id, score: d.score })),
      });
    }
    if (chrono.length < 2) return null;
    const m = new Map<string, TrendPoint[]>();
    for (const s of chrono) {
      for (const d of s.dimensions) {
        const arr = m.get(d.dimId) ?? [];
        arr.push({ score: d.score, at: s.at, engine: s.engine });
        m.set(d.dimId, arr);
      }
    }
    return m;
  })();

  return (
    <div className="animate-fade-up space-y-8" data-testid="report">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <a
            href={repo.url}
            target="_blank"
            rel="noreferrer"
            className="text-2xl font-bold text-white hover:text-accent"
          >
            {repo.owner}/{repo.name}
          </a>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
            {repo.primaryLanguage && <span>{repo.primaryLanguage}</span>}
            <span>★ {repo.stars.toLocaleString()}</span>
            <span>updated {timeAgo(repo.pushedAt)}</span>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2 text-xs sm:justify-end">
            <span className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-slate-400">
              {ARCHETYPE_LABEL[report.archetype]}
            </span>
            {report.aiUsage.detected && (
              <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-accent">
                AI usage detected
                {report.aiUsage.commitFraction > 0 ? ` · ${Math.round(report.aiUsage.commitFraction * 100)}% commits` : ""}
              </span>
            )}
            {isMock ? (
              <span
                className="rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-sky-300"
                title="Keyless demo: scores are computed from deterministic signals, not LLM-written analysis"
              >
                Demo · deterministic rubric
              </span>
            ) : (
              <span className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-slate-400">
                engine: {report.engine.provider} · {report.engine.model}
              </span>
            )}
            <span className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-slate-400">
              confidence {Math.round(report.confidence * 100)}%
            </span>
          </div>
          <FreshnessControl report={report} onRetest={onRetest} />
        </div>
      </div>

      {/* Reliability caveats */}
      {report.warnings && report.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="font-mono text-[11px] uppercase tracking-widest text-amber-400">Heads up</div>
          <ul className="mt-2 space-y-1 text-sm text-amber-200/90">
            {report.warnings.map((w, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden>⚠</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Score + headline + ladder */}
      <div className="relative grid gap-6 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 p-6 lg:grid-cols-[auto_1fr]">
        <div aria-hidden className="strata pointer-events-none absolute inset-0" />
        <div className="relative flex flex-col items-center justify-center">
          <ScoreRing score={report.overallScore} level={level} />
          {overallDelta !== null && <DeltaPill delta={overallDelta} suffix="since last scan" className="mt-3" />}
        </div>
        <div className="relative flex flex-col justify-center">
          <div className={`inline-flex w-fit items-center gap-2 rounded-full border ${lc.border} ${lc.bg} px-3 py-1 text-sm font-semibold ${lc.text}`}>
            <span aria-hidden>{LEVEL_GLYPH[level.id]}</span>
            {level.id} — {level.name}
          </div>
          <p className="mt-3 text-lg font-medium text-white">{report.headline}</p>
          {isMock && (
            <p className="mt-1 text-sm text-sky-300/80">
              Scores are computed from deterministic signals, not LLM-written analysis.
            </p>
          )}
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{level.description}</p>
          <LevelLadder currentId={level.id} />
        </div>
      </div>

      {/* Posture — Adoption × Rigor */}
      <PosturePanel report={report} prev={prevPosture} />

      {/* Trend over time */}
      {trendPoints.length >= 1 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-white">Maturity over time</h2>
              <p className="text-sm text-slate-400">
                {trendPoints.length === 1
                  ? "Baseline established — re-scan later to track progress."
                  : `${trendPoints.length} scans tracked.`}
              </p>
            </div>
            {overallDelta !== null && <DeltaPill delta={overallDelta} className="mt-3" />}
          </div>
          <div className="mt-4">
            <TrendChart points={trendPoints} />
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-x-5 gap-y-1 text-right">
            {scans.length >= 2 && (
              <Link
                href={`/report/compare?repo=${encodeURIComponent(`${repo.owner}/${repo.name}`)}`}
                className="font-mono text-xs uppercase tracking-widest text-accent hover:text-accent-soft"
              >
                What changed →
              </Link>
            )}
            <Link
              href={`/trends?repo=${encodeURIComponent(`${repo.owner}/${repo.name}`)}`}
              className="font-mono text-xs uppercase tracking-widest text-accent hover:text-accent-soft"
            >
              Dimension-level trends →
            </Link>
          </div>
        </div>
      )}

      {/* Strengths / Risks */}
      {(report.strengths.length > 0 || report.risks.length > 0) && (
        <div className="grid gap-5 md:grid-cols-2">
          <ListCard title="Strengths" items={report.strengths} tone="good" />
          <ListCard title="Risks & gaps" items={report.risks} tone="bad" />
        </div>
      )}

      {/* Radar + dimension breakdown */}
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="flex items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <RadarChart dimensions={report.dimensions} />
        </div>
        <div className="space-y-3">
          {report.dimensions.map((d, i) => (
            <DimensionCard key={d.id} d={d} index={i} prevScore={prevDimScores?.get(d.id)} series={dimSeries?.get(d.id)} />
          ))}
        </div>
      </div>

      {/* Contributors — recent activity + AI attribution */}
      {report.contributors.filter((c) => c.login !== "unknown").length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="text-lg font-semibold text-white">Recent contributors</h2>
          <p className="mt-1 text-sm text-slate-400">
            From sampled commit history — bar shows the share that&apos;s AI-attributed.
          </p>
          <div className="mt-3 space-y-2">
            {report.contributors
              .filter((c) => c.login !== "unknown")
              .slice(0, 8)
              .map((c) => {
                const pctAI = c.commits ? Math.round((c.aiCommits / c.commits) * 100) : 0;
                return (
                  <div key={c.login} className="flex items-center gap-3 text-sm">
                    <span className="w-40 shrink-0 truncate text-slate-200">{c.login}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${pctAI}%` }} />
                    </div>
                    <span className="w-32 shrink-0 text-right font-mono text-xs text-slate-500">
                      {c.aiCommits}/{c.commits} AI · {pctAI}%
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Pull request signals — how systematically the team ships (GraphQL ingestion) */}
      {report.prStats && report.prStats.analyzed > 0 && <PrSignalsPanel stats={report.prStats} />}

      {/* Trust ladder — where this repo sits, what the next rung needs */}
      <TrustLadder currentId={report.level.id} />

      {/* Gaps to explore — trust-gap exploration, not a directive list */}
      <div>
        <h2 className="text-xl font-bold text-white">
          Gaps to explore{nextLevel ? ` — your next rung: ${nextLevel.id} ${nextLevel.name}` : " — sustaining the summit"}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {recs && recs.length > 0
            ? "Inputs to explore at your own pace — these aren't orders. Track what you take on."
            : "Where trust in AI could grow — open questions to explore, quick wins first."}
        </p>
        <NextLevelPath report={report} />
        <div className="mt-4">
          {recs && recs.length > 0 ? (
            <RecommendationTracker items={recs} report={report} />
          ) : (
            <RoadmapSteps items={report.roadmap} report={report} />
          )}
        </div>
      </div>

      {report.discrepancies.length > 0 && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] p-5">
          <h2 className="text-lg font-semibold text-white">Flagged for review</h2>
          <p className="mt-1 text-sm text-slate-400">
            The AI auditor believes these deterministic signals may be wrong — worth verifying,
            and a useful signal for improving the detectors.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {report.discrepancies.map((d, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-mono text-xs text-amber-400">{d.dimension}</span>
                <span className="text-slate-300">{d.claim}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <BadgeShare report={report} />

      <div className="flex justify-center pt-2">
        <Link
          href="/"
          className="rounded-xl border border-slate-700 px-5 py-2.5 text-sm text-slate-300 transition hover:border-accent hover:text-white"
        >
          ← Scan another repo
        </Link>
      </div>
    </div>
  );
}

/**
 * Scan-freshness control: "Scanned 4m ago · Re-test". The relative time advances on a 30s
 * ticker (no reload). Re-test re-runs the scan — cheap when the repo is unchanged (a conditional
 * request returns a free 304 and the persisted scan is served), a full re-score when it moved.
 * In the live scan view `onRetest` re-triggers the in-page SSE run; on a server-rendered pinned
 * permalink (no callback) it links to the live scanner with `fresh=1` to force a re-check.
 */
function FreshnessControl({ report, onRetest }: { report: ScanReport; onRetest?: () => void }) {
  // Re-render every 30s so "just now" → "1m ago" → "2m ago" stays honest without a reload.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const retestHref = `/report?repo=${encodeURIComponent(report.repo.url)}&fresh=1`;
  const retestClass =
    "inline-flex items-center gap-1 rounded-full border border-slate-700 px-2.5 py-1 font-medium text-slate-300 transition hover:border-accent hover:text-white";
  const refreshIcon = (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3 shrink-0" fill="none">
      <path
        d="M13 8a5 5 0 1 1-1.46-3.54M13 2.5V5h-2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-slate-500">
      <span className="inline-flex items-center gap-1.5">
        <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3 shrink-0" fill="none">
          <path
            d="M8 4v4l2.5 1.5M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Scanned <span className="text-slate-300">{freshness(report.scannedAt)}</span>
      </span>
      {onRetest ? (
        <button type="button" onClick={onRetest} className={retestClass}>
          {refreshIcon}
          Re-test
        </button>
      ) : (
        <a href={retestHref} className={retestClass}>
          {refreshIcon}
          Re-test
        </a>
      )}
    </div>
  );
}

function PosturePanel({
  report,
  prev,
}: {
  report: ScanReport;
  prev?: { adoption: number; rigor: number } | null;
}) {
  return (
    <div className="grid items-center gap-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-6 sm:grid-cols-2">
      <div className="flex flex-col justify-center">
        <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent">Posture</div>
        <h2 className="mt-1 text-xl font-bold text-white">{report.posture.label}</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-400">{report.posture.blurb}</p>
        <div className="mt-5 flex flex-col gap-4">
          <AxisBar label="AI Adoption" value={report.adoptionScore} hint="tooling · agentic · commit signals" />
          <AxisBar label="Engineering Rigor" value={report.rigorScore} hint="tests · CI/CD · docs · quality" />
        </div>
      </div>
      <div className="flex items-center justify-center">
        <PostureQuadrant
          adoption={report.adoptionScore}
          rigor={report.rigorScore}
          posture={report.posture}
          prev={prev}
        />
      </div>
    </div>
  );
}

function AxisBar({ label, value, hint }: { label: string; value: number; hint: string }) {
  const color = scoreHex(value);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-white">{label}</span>
        <span className="flex items-center gap-1 font-mono text-sm tabular-nums" style={{ color }}>
          <span aria-hidden>{scoreGlyph(value)}</span>
          {value}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate-600">{hint}</div>
    </div>
  );
}

function LevelLadder({ currentId }: { currentId: string }) {
  return (
    <div className="mt-5 flex gap-1.5">
      {LEVELS.map((l) => {
        const active = l.id === currentId;
        const lc = LEVEL_CLASSES[l.id];
        return (
          <div key={l.id} className="flex-1 text-center">
            <div
              className={`h-1.5 rounded-full ${active ? "" : "bg-slate-800"}`}
              style={active ? { backgroundColor: scoreHex(l.band[0]) } : undefined}
            />
            <div aria-hidden className={`mt-1 text-xs leading-none ${active ? lc.text : "text-slate-600"}`}>
              {LEVEL_GLYPH[l.id]}
            </div>
            <div className={`mt-0.5 text-[10px] ${active ? lc.text : "text-slate-600"}`}>{l.id}</div>
          </div>
        );
      })}
    </div>
  );
}

function ListCard({ title, items, tone }: { title: string; items: string[]; tone: "good" | "bad" }) {
  if (items.length === 0) return null;
  const mark = tone === "good" ? "text-emerald-400" : "text-amber-400";
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
      <h3 className="font-semibold text-white">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm text-slate-300">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className={mark}>{tone === "good" ? "▲" : "▼"}</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DimensionCard({
  d,
  index = 0,
  prevScore,
  series,
}: {
  d: ScanReport["dimensions"][number];
  index?: number;
  prevScore?: number;
  series?: TrendPoint[];
}) {
  const [open, setOpen] = useState(false);
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const color = scoreHex(d.score);
  const delta = prevScore !== undefined ? d.score - prevScore : null;

  // One motion language (reuses animate-fade-up's ease-out): the score-fill grows from 0 on
  // mount with a small per-row stagger; the detail panel is a height+opacity accordion; the
  // chevron rotates 90°. prefers-reduced-motion snaps everything to its final state instead.
  const fillWidth = reduced || mounted ? `${d.score}%` : "0%";
  const fillTransition = reduced ? undefined : `width 0.7s ease-out ${Math.min(index * 60, 480)}ms`;
  const detailTransition = reduced ? undefined : "grid-template-rows 0.3s ease-out, opacity 0.3s ease-out";
  const chevronTransition = reduced ? undefined : "transform 0.3s ease-out";

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="font-mono text-xs text-slate-500">{d.id}</span>
        <span className="flex-1 font-semibold text-white">{d.name}</span>
        {delta !== null && delta !== 0 && (
          <span className={`text-xs font-semibold ${delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
            {delta > 0 ? "▲+" : "▼"}
            {delta}
          </span>
        )}
        <span className="text-xs text-slate-500">{Math.round(d.weight * 100)}%</span>
        <span className="flex w-14 items-center justify-end gap-1 text-lg font-bold" style={{ color }}>
          <span aria-hidden className="text-xs">{scoreGlyph(d.score)}</span>
          {d.score}
        </span>
        <span
          aria-hidden
          className="inline-block text-slate-500"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: chevronTransition }}
        >
          ▸
        </span>
      </button>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full" style={{ width: fillWidth, backgroundColor: color, transition: fillTransition }} />
      </div>
      <div
        className="grid"
        style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0, transition: detailTransition }}
      >
        <div className="overflow-hidden" aria-hidden={!open}>
          <div className="mt-3 space-y-3 text-sm">
            {d.summary && <p className="leading-relaxed text-slate-300">{d.summary}</p>}
            {d.evidence.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence</div>
                <ul className="mt-1 space-y-1 text-slate-400">
                  {d.evidence.map((e, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-slate-600">·</span>
                      <span>{e}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {d.gaps.length > 0 && (
              <div className="text-slate-400">
                <span className="text-xs font-semibold uppercase tracking-wide text-amber-400/80">Gaps: </span>
                {d.gaps.join(" · ")}
              </div>
            )}
            {series && series.length >= 2 && (
              <div className="flex items-center gap-3 border-t border-slate-800 pt-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Trend</span>
                <Sparkline points={series} />
                <span className="text-xs text-slate-500">
                  {series[0].score} → {series[series.length - 1].score}
                </span>
              </div>
            )}
            <ProvenanceTrack signal={d.signalScore} llm={d.llmScore} blended={d.score} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Score provenance micro-viz — makes the deterministic-signal + guardbanded-LLM blend
 * auditable instead of a black box. A shaded ±LLM_GUARDBAND zone is centered on the signal
 * score; ticks mark the signal and the (clamped) LLM judgment; a filled bar runs to the
 * blended result. Zero-dependency inline SVG over a 0..100 scale, like Charts.tsx.
 */
function ProvenanceTrack({ signal, llm, blended }: { signal: number; llm: number; blended: number }) {
  const W = 240;
  const H = 22;
  const padX = 2;
  const trackY = 14;
  const x = (v: number) => padX + (Math.max(0, Math.min(100, v)) / 100) * (W - padX * 2);
  const bandLo = Math.max(0, signal - LLM_GUARDBAND);
  const bandHi = Math.min(100, signal + LLM_GUARDBAND);
  const color = scoreHex(blended);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-auto w-full" role="img" aria-label={`Score provenance: signal ${signal}, LLM ${llm}, blended ${blended}`}>
      {/* baseline track */}
      <line x1={x(0)} x2={x(100)} y1={trackY} y2={trackY} stroke="#1e293b" strokeWidth={3} strokeLinecap="round" />
      {/* ±guardband zone around the signal */}
      <rect x={x(bandLo)} y={trackY - 4} width={x(bandHi) - x(bandLo)} height={8} rx={2} fill="#3b9eff" opacity={0.14}>
        <title>Guardband: the LLM can move the score at most ±{LLM_GUARDBAND} from the signal</title>
      </rect>
      {/* filled bar from signal → blended result */}
      <line x1={x(signal)} x2={x(blended)} y1={trackY} y2={trackY} stroke={color} strokeWidth={3} strokeLinecap="round" />
      {/* signal tick */}
      <g>
        <line x1={x(signal)} x2={x(signal)} y1={trackY - 6} y2={trackY + 6} stroke="#94a3b8" strokeWidth={2} />
        <title>Signal (deterministic): {signal}</title>
      </g>
      {/* llm tick */}
      <g>
        <circle cx={x(llm)} cy={trackY} r={3} fill="#cbd5e1" stroke="#0f172a" strokeWidth={1} />
        <title>LLM judgment: {llm}</title>
      </g>
      {/* blended marker */}
      <g>
        <circle cx={x(blended)} cy={trackY} r={3.5} fill={color} stroke="#020617" strokeWidth={1} />
        <title>Blended result: {blended}</title>
      </g>
      {/* compact text legend (kept for non-hover/screen contexts) */}
      <text x={padX} y={7} fontSize={7} fontFamily="monospace" className="fill-slate-500">
        signal {signal}
      </text>
      <text x={W - padX} y={7} fontSize={7} fontFamily="monospace" textAnchor="end" className="fill-slate-500">
        llm {llm} · blended {blended}
      </text>
    </svg>
  );
}

function RoadmapMeta({ item }: { item: Pick<LlmRoadmapItem, "impact" | "effort"> }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`rounded-md border px-2 py-0.5 ${IMPACT_CLASS[item.impact]}`}>impact: {item.impact}</span>
      <span className={`rounded-md border px-2 py-0.5 ${EFFORT_CLASS[item.effort]}`}>effort: {item.effort}</span>
    </div>
  );
}

function ExploreList({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-accent">Explore</div>
      <ul className="mt-1.5 space-y-1 text-sm text-slate-300">
        {items.map((q, i) => (
          <li key={i} className="flex gap-2">
            <span className="select-none text-slate-600">→</span>
            <span>{q}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrustLadder({ currentId }: { currentId: LevelId }) {
  const cur = LEVELS.findIndex((l) => l.id === currentId);
  const next = cur >= 0 && cur < LEVELS.length - 1 ? LEVELS[cur + 1] : null;
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Trust ladder</h2>
        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">trust = adoption × rigor</span>
      </div>
      <div className="mt-3 flex gap-1.5">
        {LEVELS.map((l, i) => {
          const reached = i <= cur;
          const isCurrent = i === cur;
          return (
            <div key={l.id} className="flex-1">
              <div className="h-1.5 rounded-full" style={{ backgroundColor: reached ? LEVEL_HEX[l.id] : "#1e293b" }} />
              <div aria-hidden className="mt-1 text-xs leading-none" style={{ color: reached ? LEVEL_HEX[l.id] : "#475569" }}>
                {LEVEL_GLYPH[l.id]}
              </div>
              <div className={`mt-0.5 font-mono text-[10px] ${isCurrent ? "text-white" : "text-slate-600"}`}>
                {l.id}
                {isCurrent ? " ◂ you" : ""}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {next
          ? `Next rung — ${next.id} ${next.name}: ${next.tagline}. The gaps below are inputs to explore on the way.`
          : "Top of the ladder — the work now is sustaining trust and sharing what works."}
      </p>
    </div>
  );
}

const IMPACT_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
const EFFORT_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };
const priorityScore = (it: LlmRoadmapItem) => IMPACT_RANK[it.impact] * 10 - EFFORT_RANK[it.effort];
const isQuickWin = (it: LlmRoadmapItem) => it.impact === "high" && it.effort !== "high";

/** A what-if payoff chip: the overall-score upside of fully closing this dimension's gap. */
function PayoffChip({ report, dim }: { report: ScanReport; dim: DimensionId }) {
  const proj = projectDimensionClose(report, dim);
  if (proj.deltaScore <= 0) return null;
  return (
    <span
      className="rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-accent"
      title="Projected effect on your overall score if this gap is fully closed"
    >
      ↑ up to +{proj.deltaScore} pts{proj.levelUp ? ` · ${proj.fromLevel}→${proj.level}` : ""}
    </span>
  );
}

/** Headline of the cheapest combination of gaps to close to reach the next maturity band. */
function NextLevelPath({ report }: { report: ScanReport }) {
  const path = cheapestPathToNextLevel(report);
  if (!path.target || !path.reachable || path.steps.length === 0) return null;
  const names = path.steps.map((s) => DIMENSION_SHORT[s.dimension]).join(" + ");
  return (
    <div className="mt-3 rounded-lg border border-accent/20 bg-accent/[0.06] p-3 text-sm">
      <span className="font-mono text-[10px] uppercase tracking-widest text-accent">Fastest path</span>
      <p className="mt-1 text-slate-300">
        Closing <span className="font-semibold text-white">{names}</span> projects to{" "}
        <span className="font-semibold text-white">~{path.projected.overallScore}/100</span> — enough to reach{" "}
        <span className="font-semibold" style={{ color: scoreHex(path.target.score) }}>
          {path.target.level} {path.target.name}
        </span>
        .
      </p>
    </div>
  );
}

/** Prioritized, numbered next-steps for public scans — quick wins first. */
function RoadmapSteps({ items, report }: { items: LlmRoadmapItem[]; report: ScanReport }) {
  const ordered = [...items].sort((a, b) => priorityScore(b) - priorityScore(a));
  return (
    <ol className="space-y-3">
      {ordered.map((item, i) => {
        const axis = DIMENSION_BY_ID[item.dimension]?.axis;
        const quick = isQuickWin(item);
        return (
          <li
            key={i}
            className="rounded-xl border bg-slate-900/40 p-5"
            style={quick ? { borderColor: "rgba(16,185,129,0.35)" } : { borderColor: "rgb(30,41,59)" }}
          >
            <div className="flex items-start gap-4">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-700 font-mono text-sm text-slate-300">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-white">{item.title}</h3>
                  {quick && (
                    <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
                      ⚡ Quick win
                    </span>
                  )}
                </div>
                {item.rationale && (
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{item.rationale}</p>
                )}
                <ExploreList items={item.explore} />
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-md border px-2 py-0.5 ${IMPACT_CLASS[item.impact]}`}>
                    impact: {item.impact}
                  </span>
                  <span className={`rounded-md border px-2 py-0.5 ${EFFORT_CLASS[item.effort]}`}>
                    effort: {item.effort}
                  </span>
                  {axis && (
                    <span className="rounded-md border border-slate-700 px-2 py-0.5 text-slate-400">
                      lifts {axis === "adoption" ? "AI Adoption" : "Engineering Rigor"}
                    </span>
                  )}
                  <PayoffChip report={report} dim={item.dimension} />
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const STATUS_LABEL: Record<RecStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  dismissed: "Dismissed",
};
const STATUS_ACCENT: Record<RecStatus, string> = {
  open: "#64748b",
  in_progress: "#eab308",
  done: "#22c55e",
  dismissed: "#475569",
};

/** A per-row save failure: the change the user attempted, and whether it's recoverable. */
interface RowError {
  /** The status change that failed — re-applied by the Retry button. */
  status: RecStatus;
  /** "config" = persistence not available (503, retry won't help); "transient" = retryable. */
  kind: "config" | "transient";
  message: string;
}

/** Small busy indicator for the row currently saving (frozen, not spinning, under reduced motion). */
function RowSpinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-accent motion-reduce:animate-none"
    />
  );
}

function RecommendationTracker({
  items: initial,
  report,
}: {
  items: PersistedRecommendation[];
  report: ScanReport;
}) {
  const [items, setItems] = useState(initial);
  // Per-id saving set (not a single shared string) so overlapping in-flight PATCHes each
  // disable only their own row instead of one freezing/clobbering another.
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, RowError>>({});
  const [announcement, setAnnouncement] = useState("");

  const setSaving = (id: string, on: boolean) =>
    setSavingIds((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const dismissed = items.filter((i) => i.status === "dismissed").length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  function clearError(id: string) {
    setErrors((e) => {
      if (!e[id]) return e;
      const next = { ...e };
      delete next[id];
      return next;
    });
  }

  async function setStatus(id: string, status: RecStatus) {
    const row = items.find((i) => i.id === id);
    const title = row?.title ?? "Recommendation";
    // Capture ONLY this row's prior status for a targeted rollback. Reverting to a whole-list
    // snapshot (the old `setItems(prev)`) would clobber other rows' concurrent optimistic or
    // already-confirmed changes when several updates overlap.
    const priorStatus = row?.status;
    const rollback = () =>
      setItems((cur) =>
        cur.map((i) => (i.id === id && priorStatus !== undefined ? { ...i, status: priorStatus } : i)),
      );

    setSaving(id, true);
    clearError(id);
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, status } : i))); // optimistic, this row only
    try {
      const res = await fetch(`/api/recommendations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        // Distinguish "tracking simply isn't available" (503 — no DB) from a transient failure,
        // so the message is honest and only retryable errors offer a Retry.
        const kind: RowError["kind"] = res.status === 503 ? "config" : "transient";
        const message =
          kind === "config"
            ? "Progress tracking isn’t available here — it needs a connected database, so this change can’t be saved."
            : "Couldn’t save that change. Check your connection and retry.";
        rollback(); // revert ONLY this row
        setErrors((e) => ({ ...e, [id]: { status, kind, message } }));
        setAnnouncement(`Couldn’t update “${title}”: ${message}`);
        return;
      }
      setAnnouncement(`“${title}” marked ${STATUS_LABEL[status]}.`);
    } catch {
      rollback();
      setErrors((e) => ({
        ...e,
        [id]: { status, kind: "transient", message: "Couldn’t save that change. Check your connection and retry." },
      }));
      setAnnouncement(`Couldn’t update “${title}”: network error.`);
    } finally {
      setSaving(id, false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Polite live region — announces every save success/failure for screen readers. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-white">
            {done} of {total} done
            {dismissed > 0 && <span className="text-slate-500"> · {dismissed} dismissed</span>}
          </span>
          <span className="text-slate-400">{pct}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {items.map((item) => {
        const muted = item.status === "done" || item.status === "dismissed";
        const err = errors[item.id];
        const saving = savingIds.has(item.id);
        const edge = err ? (err.kind === "config" ? "#eab308" : "#ef4444") : STATUS_ACCENT[item.status];
        return (
          <div
            key={item.id}
            aria-busy={saving}
            className="rounded-xl border bg-slate-900/40 p-5"
            style={{ borderLeftWidth: 3, borderLeftColor: edge }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className={`font-semibold ${muted ? "text-slate-400 line-through decoration-slate-600" : "text-white"}`}>
                {item.title}
              </h3>
              <div className="flex items-center gap-2 text-xs">
                <RoadmapMeta item={item} />
                <PayoffChip report={report} dim={item.dimension} />
                {saving && <RowSpinner />}
                <select
                  value={item.status}
                  disabled={saving}
                  onChange={(e) => setStatus(item.id, e.target.value as RecStatus)}
                  aria-label="Recommendation status"
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 outline-none focus:border-accent disabled:opacity-50"
                  style={{ color: STATUS_ACCENT[item.status] }}
                >
                  {(Object.keys(STATUS_LABEL) as RecStatus[]).map((s) => (
                    <option key={s} value={s} className="text-slate-200">
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {item.rationale && <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.rationale}</p>}
            {!muted && <ExploreList items={item.explore} />}
            {err && (
              <div
                role="alert"
                className={`mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                  err.kind === "config"
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-200/90"
                    : "border-red-500/30 bg-red-500/5 text-red-200/90"
                }`}
              >
                <span aria-hidden>{err.kind === "config" ? "ⓘ" : "⚠"}</span>
                <span className="flex-1">{err.message}</span>
                {err.kind === "transient" && (
                  <button
                    type="button"
                    onClick={() => setStatus(item.id, err.status)}
                    disabled={saving}
                    className="rounded-md border border-red-500/40 px-2 py-0.5 font-medium text-red-200 transition hover:bg-red-500/10 disabled:opacity-50"
                  >
                    Retry
                  </button>
                )}
                {err.kind === "config" && (
                  <button
                    type="button"
                    onClick={() => clearError(item.id)}
                    className="rounded-md border border-amber-500/40 px-2 py-0.5 font-medium text-amber-200 transition hover:bg-amber-500/10"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function fmtHours(h: number | null): string {
  if (h == null) return "—";
  if (h < 1) return "<1h";
  if (h < 48) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function PrMetric({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-xl font-bold tabular-nums" style={{ color: color ?? "#fff" }}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

function PrSignalsPanel({ stats }: { stats: NonNullable<ScanReport["prStats"]> }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white">Pull request signals</h2>
          <p className="mt-1 text-sm text-slate-400">
            How systematically the team ships — from the {stats.analyzed} most recent of {stats.totalCount} PRs.
          </p>
        </div>
        {stats.aiInvolvedRate > 0 && (
          <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-[11px] text-accent">
            {stats.aiInvolvedRate}% AI-involved
            {stats.aiGovernedRate != null && ` · ${stats.aiGovernedRate}% reviewed`}
          </span>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <PrMetric label="Review coverage" value={`${stats.reviewedRate}%`} color={scoreHex(stats.reviewedRate)} hint="human PRs reviewed" />
        <PrMetric label="Merge rate" value={`${stats.mergeRate}%`} color={scoreHex(stats.mergeRate)} hint="vs closed unmerged" />
        <PrMetric label="Small PRs" value={`${stats.smallPrRate}%`} color={scoreHex(stats.smallPrRate)} hint="≤200 lines" />
        <PrMetric label="Time to merge" value={fmtHours(stats.medianHoursToMerge)} hint="median" />
        <PrMetric label="Time to review" value={fmtHours(stats.medianHoursToFirstReview)} hint="median 1st" />
        <PrMetric label="Revert rate" value={`${stats.revertRate}%`} color={stats.revertRate > 10 ? "#f97316" : "#fff"} hint="reverted PRs" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-slate-500">
        <span>avg {stats.avgLineChanges} lines · {stats.avgChangedFiles} files</span>
        <span>{stats.avgReviews} reviews / {stats.avgComments} comments per PR</span>
        {stats.botAuthoredRate > 0 && <span>{stats.botAuthoredRate}% bot-authored</span>}
        {stats.tools.length > 0 && (
          <span className="flex items-center gap-1.5">
            tools:
            {stats.tools.map((t) => (
              <span key={t.name} className="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300">
                {t.name} {t.count}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

function BadgeShare({ report }: { report: ScanReport }) {
  const [copied, setCopied] = useState<"level" | "gate" | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const path = `/api/badge/${report.repo.owner}/${report.repo.name}`;
  const gatePath = `${path}?gate`;
  const reportUrl = `${origin}/report?repo=${encodeURIComponent(report.repo.url)}`;
  const markdown = `[![Ascent: ${report.level.id} ${report.level.name}](${origin}${path})](${reportUrl})`;
  const gateMarkdown = `[![Ascent gate](${origin}${gatePath})](${reportUrl})`;

  // Pass/fail against the default (archetype-aware) policy — the same one the gate badge renders.
  const gate = evaluateGate(report);

  const copy = (text: string, which: "level" | "gate") => {
    navigator.clipboard?.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-white">Share your maturity badge</h3>
        <span
          className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${
            gate.pass
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/40 bg-red-500/10 text-red-300"
          }`}
          title={
            gate.pass
              ? `Passes the default ${report.archetype} maturity gate`
              : gate.failures.map((f) => f.message).join("\n")
          }
        >
          maturity gate: {gate.pass ? "pass" : "fail"}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-400">Drop the level badge into your README — or the gate badge to hold a bar in CI.</p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={path} alt="Ascent level badge" className="h-7" />
        <code className="flex-1 overflow-x-auto rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-300">
          {markdown}
        </code>
        <button
          type="button"
          onClick={() => copy(markdown, "level")}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition hover:bg-accent-soft"
        >
          {copied === "level" ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={gatePath} alt="Ascent gate badge" className="h-7" />
        <code className="flex-1 overflow-x-auto rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-300">
          {gateMarkdown}
        </code>
        <button
          type="button"
          onClick={() => copy(gateMarkdown, "gate")}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-accent hover:text-white"
        >
          {copied === "gate" ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}
