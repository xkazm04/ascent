import Link from "next/link";
import { TrendChart, type TrendPoint } from "@/components/report/TrendChart";
import { Trajectory } from "@/components/org/Trajectory";
import { GoalsOverview } from "@/components/org/GoalsOverview";
import { PeriodSummary } from "@/components/org/PeriodSummary";
import { TimeRangeSelector } from "@/components/org/TimeRangeSelector";
import { SegmentSelector } from "@/components/org/SegmentSelector";
import { Card, InlineEmpty, Meter, SectionHeader, Tile, TILE_GRID, POSTURE_LABEL, POSTURE_ORDER } from "@/components/org/ui";
import { getOrgBenchmark, getOrgGapAnalysis, getOrgMovers, getOrgRecommendations, getOrgRollup, listGoals, listSegments } from "@/lib/db";
import { levelForScore } from "@/lib/maturity/model";
import { DIMENSION_SHORT, IMPACT_CLASS, scoreHex } from "@/lib/ui";
import { resolveWindow } from "@/lib/window";
import type { RepoMove } from "@/lib/db";

export const dynamic = "force-dynamic";

function MoversList({ title, tone, moves, emptyText }: { title: string; tone: "up" | "down"; moves: RepoMove[]; emptyText: string }) {
  const color = tone === "up" ? "#84cc16" : "#f97316";
  const arrow = tone === "up" ? "▲" : "▼";
  return (
    <Card>
      <SectionHeader size="sm" title={title} />
      {moves.length === 0 ? (
        <InlineEmpty>{emptyText}</InlineEmpty>
      ) : (
        <div className="mt-3 space-y-2">
          {moves.map((m) => (
            <div key={m.fullName} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-mono text-xs text-slate-200">{m.name}</span>
              <span className="flex shrink-0 items-center gap-2 font-mono text-xs">
                {m.levelDelta !== 0 && (
                  <span className="text-slate-500">
                    {m.levelFrom}→{m.levelTo}
                  </span>
                )}
                <span style={{ color }}>
                  {arrow} {Math.abs(m.dOverall)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default async function OrgOverview({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const period = resolveWindow(sp);
  const win = { start: period.start, end: period.end };

  // Optional segment scope: validate the `?segment=` id against the org's segments (a bogus id
  // falls back to the whole fleet) so every aggregate below is scoped to the same tagged repos.
  const segments = (await listSegments(slug)) ?? [];
  const segParam = Array.isArray(sp.segment) ? sp.segment[0] : sp.segment;
  const activeSegment = segments.find((s) => s.id === segParam) ?? null;
  const segmentId = activeSegment?.id ?? null;

  const rollup = await getOrgRollup(slug, win, segmentId);
  if (!rollup) return null;

  const level = levelForScore(rollup.avgOverall);
  const trend: TrendPoint[] = rollup.trend.map((t) => ({ score: t.avg, at: t.date }));
  const maxPosture = Math.max(1, ...POSTURE_ORDER.map((p) => rollup.postureCounts[p] ?? 0));
  const movers = await getOrgMovers(slug, win, segmentId);
  const orgRecs = await getOrgRecommendations(slug, 5, segmentId);
  const benchmark = await getOrgBenchmark(slug);
  const gaps = await getOrgGapAnalysis(slug, segmentId);
  const goals = await listGoals(slug);
  const regressionCount = movers?.regressers.length ?? 0;
  const moversEmpty = period.start ? "None this period." : "None since last scan.";

  return (
    <div className="space-y-6">
      {/* Period + segment controls — drive the tiles' deltas, the trend, and the movers below */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[11px] uppercase tracking-widest text-slate-500">
          Showing · {period.title}
          {activeSegment && (
            <>
              {" · "}
              <span className="text-accent">{activeSegment.name}</span> segment
            </>
          )}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentSelector segments={segments} active={segmentId} />
          <TimeRangeSelector range={period.key} from={period.from} to={period.to} />
        </div>
      </div>
      {segments.length > 0 && (
        <div className="-mt-3">
          <Link href={`/org/${slug}/segments`} className="font-mono text-[11px] text-slate-500 hover:text-accent">
            Compare segments side by side →
          </Link>
        </div>
      )}

      {/* Period-in-review banner — auto-summary of net fleet movement over the window */}
      <PeriodSummary window={period} rollup={rollup} movers={movers} />

      {/* Tiles */}
      <div className={TILE_GRID}>
        <Tile
          label="Org maturity"
          value={rollup.avgOverall}
          sub={`${level.id} · ${level.name}`}
          color={scoreHex(rollup.avgOverall)}
          delta={rollup.deltas?.overall}
          deltaLabel={period.comparisonLabel}
        />
        <Tile
          label="AI Adoption"
          value={rollup.avgAdoption}
          color={scoreHex(rollup.avgAdoption)}
          delta={rollup.deltas?.adoption}
          deltaLabel={period.comparisonLabel}
        />
        <Tile
          label="Engineering Rigor"
          value={rollup.avgRigor}
          color={scoreHex(rollup.avgRigor)}
          delta={rollup.deltas?.rigor}
          deltaLabel={period.comparisonLabel}
        />
        <Tile label="Repos scanned" value={`${rollup.scannedCount}/${rollup.repoCount}`} />
      </div>

      {/* Trajectory — forward-looking GPS over the maturity trend */}
      {rollup.forecast && <Trajectory forecast={rollup.forecast} />}

      {/* Goals & standing */}
      <div className="grid gap-6 lg:grid-cols-2">
        <GoalsOverview slug={slug} goals={goals ?? []} />

        <Card>
          <SectionHeader size="sm" title="Standing" />
          <div className="mt-4 space-y-3 text-sm">
            {benchmark && benchmark.overallPercentile != null ? (
              <div className="flex items-baseline justify-between">
                <span className="text-slate-300">vs the Ascent corpus</span>
                <span>
                  <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: scoreHex(benchmark.overallPercentile) }}>
                    {benchmark.overallPercentile}
                  </span>
                  <span className="ml-1 font-mono text-xs text-slate-500">pctile · {benchmark.corpusRepos} repos</span>
                </span>
              </div>
            ) : (
              <InlineEmpty>Benchmark fills in once other orgs are scanned.</InlineEmpty>
            )}
            {benchmark && (
              <div className="font-mono text-[11px] text-slate-500">
                corpus avg: overall {benchmark.corpusAvgOverall} · adopt {benchmark.corpusAvgAdoption} · rigor {benchmark.corpusAvgRigor}
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              {regressionCount > 0 ? (
                <span className="rounded-full border border-orange-500/40 bg-orange-500/10 px-2.5 py-1 font-mono text-[11px] text-orange-300">
                  ⚠ {regressionCount} repo{regressionCount > 1 ? "s" : ""} regressed {period.start ? "this period" : "since last scan"}
                </span>
              ) : (
                <span className="rounded-full border border-slate-700 px-2.5 py-1 font-mono text-[11px] text-slate-400">no regressions</span>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Where the gaps live — common org gaps vs repo-specific */}
      {gaps && (gaps.commonGaps.length > 0 || gaps.repoSpecific.length > 0) && (
        <div>
          <SectionHeader
            title="Where the gaps live"
            description="Common across the org (fix once — reuse a practice) vs repo-specific (outliers lagging what the rest already handles)."
          />
          <div className="mt-3 grid gap-6 lg:grid-cols-2">
            {/* Common organization gaps */}
            <Card>
              <h3 className="font-mono text-[11px] uppercase tracking-widest text-accent">Common organization gaps</h3>
              {gaps.commonGaps.length === 0 ? (
                <InlineEmpty>No fleet-wide gaps — strengths are broad.</InlineEmpty>
              ) : (
                <ul className="mt-3 space-y-2">
                  {gaps.commonGaps.map((g) => (
                    <li key={g.dimId} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-white">{g.label}</span>
                        <span className="font-mono text-[11px] text-orange-300">weak in {g.weakCount}/{g.total}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-slate-500">
                        <span>org avg {g.avg}</span>
                        {g.exemplar && (
                          <span>
                            learn from <span className="text-slate-300">{g.exemplar.name}</span> ({g.exemplar.score})
                          </span>
                        )}
                        <Link href={`/org/${slug}/practices`} className="text-accent hover:text-white">
                          reuse a practice →
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Repo-specific gaps */}
            <Card>
              <h3 className="font-mono text-[11px] uppercase tracking-widest text-slate-400">Repo-specific gaps</h3>
              {gaps.repoSpecific.length === 0 ? (
                <InlineEmpty>No notable outliers — repos move together.</InlineEmpty>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {gaps.repoSpecific.slice(0, 8).map((o, i) => (
                    <li key={`${o.fullName}-${o.dimId}-${i}`} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">
                        <Link href={`/report?repo=${encodeURIComponent(o.fullName)}`} className="font-mono text-xs text-white hover:text-accent">
                          {o.name}
                        </Link>{" "}
                        <span className="text-slate-500">{o.label}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-slate-500">
                        {o.score} vs {o.orgAvg} org
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* Posture + dimension averages */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader size="sm" title="Posture distribution" />
          <div className="mt-3 space-y-2">
            {POSTURE_ORDER.map((p) => {
              const n = rollup.postureCounts[p] ?? 0;
              return (
                <div key={p} className="flex items-center gap-3 text-sm">
                  <span className="w-36 shrink-0 text-slate-300">{POSTURE_LABEL[p]}</span>
                  <Meter className="flex-1" value={(n / maxPosture) * 100} />
                  <span className="w-6 text-right font-mono tabular-nums text-slate-400">{n}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <SectionHeader size="sm" title="Dimension averages" />
          <div className="mt-3 space-y-1.5">
            {rollup.dimAverages.map((d) => (
              <div key={d.dimId} className="flex items-center gap-3 text-xs">
                <span className="w-20 shrink-0 text-slate-400">{DIMENSION_SHORT[d.dimId as keyof typeof DIMENSION_SHORT] ?? d.dimId}</span>
                <Meter className="flex-1" value={d.avg} color={scoreHex(d.avg)} />
                <span className="w-7 text-right font-mono tabular-nums" style={{ color: scoreHex(d.avg) }}>
                  {d.avg}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Trend */}
      {trend.length >= 1 && (
        <Card>
          <SectionHeader size="sm" title="Org maturity over time" right={<span className="font-mono text-[11px] text-slate-500">{period.title}</span>} />
          <div className="mt-3">
            <TrendChart points={trend} />
          </div>
        </Card>
      )}

      {/* Movers & regressions */}
      {movers && movers.comparedRepos > 0 && (movers.gainers.length > 0 || movers.regressers.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <MoversList title="Top gainers" tone="up" moves={movers.gainers.slice(0, 5)} emptyText={moversEmpty} />
          <MoversList title="Regressions" tone="down" moves={movers.regressers.slice(0, 5)} emptyText={moversEmpty} />
        </div>
      )}

      {/* Highest-leverage moves */}
      {orgRecs && orgRecs.length > 0 && (
        <div>
          <SectionHeader
            title="Gaps to explore across the fleet"
            description="Trust gaps ranked by how many repos they touch — inputs to explore and apply systematically, not a to-do list."
          />
          <div className="mt-3 space-y-2">
            {orgRecs.map((rec, i) => (
              <div key={`${rec.dimId}-${rec.title}`} className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-700 font-mono text-sm text-slate-300">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-white">{rec.title}</span>
                    <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                      {DIMENSION_SHORT[rec.dimId as keyof typeof DIMENSION_SHORT] ?? rec.dimId}
                    </span>
                    <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${IMPACT_CLASS[rec.impact] ?? "border-slate-700 text-slate-400"}`}>
                      {rec.impact} impact
                    </span>
                  </div>
                  <div className="mt-1.5 font-mono text-[11px] text-slate-500">
                    affects {rec.repoCount} repo{rec.repoCount > 1 ? "s" : ""}: {rec.repos.slice(0, 6).join(", ")}
                    {rec.repos.length > 6 ? ` +${rec.repos.length - 6}` : ""}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-xs text-slate-500" title="leverage = repos × impact × dimension weight">
                  ⚡{rec.leverage}
                </span>
              </div>
            ))}
          </div>
          <Link href={`/org/${slug}/repositories`} className="mt-3 inline-block font-mono text-[11px] uppercase tracking-widest text-accent hover:text-white">
            Browse all repositories →
          </Link>
        </div>
      )}
    </div>
  );
}
