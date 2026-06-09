import Link from "next/link";
import { TrendChart, type TrendPoint } from "@/components/report/TrendChart";
import { Trajectory } from "@/components/org/Trajectory";
import { GoalsOverview } from "@/components/org/GoalsOverview";
import { PeriodSummary } from "@/components/org/PeriodSummary";
import { TimeRangeSelector } from "@/components/org/TimeRangeSelector";
import { SegmentSelector } from "@/components/org/SegmentSelector";
import { OrgStanding } from "@/components/org/OrgStanding";
import { OrgGapsSection } from "@/components/org/OrgGapsSection";
import { OrgLeverageMoves } from "@/components/org/OrgLeverageMoves";
import { Card, InlineEmpty, Meter, OrgEmpty, SectionHeader, Tile, TILE_GRID, postureLabel, POSTURE_ORDER } from "@/components/org/ui";
import { getOrgBenchmark, getOrgGapAnalysis, getOrgMovers, getOrgRecommendations, getOrgRollup, listGoals, listSegments } from "@/lib/db";
import { levelForScore } from "@/lib/maturity/model";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
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
            <div key={m.fullName} className="flex items-center justify-between gap-3 text-base">
              <span className="min-w-0 truncate font-mono text-sm text-slate-200">{m.name}</span>
              <span className="flex shrink-0 items-center gap-2 font-mono text-sm">
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
  // The layout decides whether to render the org shell at all (org exists + has data); reaching here
  // with a null rollup means this view's scoped query (period + segment) found nothing where the
  // layout's did — e.g. a segment that matches no repos or a window with no scans. Render a page-scale
  // empty state with a way out, not a silent blank panel inside the shell.
  if (!rollup) {
    return (
      <OrgEmpty
        title="No data for this view"
        body="No scans match the selected period or segment yet. Widen the time range, clear the segment filter, or scan some repositories to populate the dashboard."
        href={`/org/${slug}/repositories`}
        cta="View repositories"
      />
    );
  }

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
        <span className="font-mono text-sm uppercase tracking-widest text-slate-500">
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
          <Link href={`/org/${slug}/segments`} className="font-mono text-sm text-slate-500 hover:text-accent">
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
        <OrgStanding benchmark={benchmark} regressionCount={regressionCount} periodStart={Boolean(period.start)} />
      </div>

      {/* Where the gaps live — common org gaps vs repo-specific */}
      {gaps && (gaps.commonGaps.length > 0 || gaps.repoSpecific.length > 0) && (
        <OrgGapsSection gaps={gaps} slug={slug} />
      )}

      {/* Posture + dimension averages */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader size="sm" title="Posture distribution" />
          <div className="mt-3 space-y-2">
            {POSTURE_ORDER.map((p) => {
              const n = rollup.postureCounts[p] ?? 0;
              return (
                <div key={p} className="flex items-center gap-3 text-base">
                  <span className="w-36 shrink-0 text-slate-300">{postureLabel(p)}</span>
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
              <div key={d.dimId} className="flex items-center gap-3 text-sm">
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
          <SectionHeader size="sm" title="Org maturity over time" right={<span className="font-mono text-sm text-slate-500">{period.title}</span>} />
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
      {orgRecs && orgRecs.length > 0 && <OrgLeverageMoves recs={orgRecs} slug={slug} />}
    </div>
  );
}
