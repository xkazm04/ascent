import Link from "next/link";
import type { Metadata } from "next";
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
import { CollapsibleSection, OVERVIEW_COLLAPSE_COOKIE } from "@/components/org/CollapsibleSection";
import { getOrgBenchmark, getOrgGapAnalysis, getOrgMovers, getOrgRecommendations, getOrgRollup, listGoals, listSegments } from "@/lib/db";
import { canReadOrg } from "@/lib/authz";
import { cookies } from "next/headers";
import { levelForScore } from "@/lib/maturity/model";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
import { resolveOrgWindow } from "@/lib/org/period";
import type { RepoMove } from "@/lib/db";

export const dynamic = "force-dynamic";

// SHELL-2: shareable metadata for the fleet dashboard. Real fleet numbers are surfaced ONLY when the
// org is publicly readable (canReadOrg is true for the shared public org, and — with a session — the
// viewer's own orgs). An unfurl is fetched without cookies, so a private org always degrades to the
// neutral description here and the neutral card in the co-located opengraph-image — never leaking
// private fleet aggregates to whoever holds the link. The OG image advertises summary_large_image.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const rollup = (await canReadOrg(slug)) ? await getOrgRollup(slug).catch(() => null) : null;
  const title = `${slug} — fleet maturity · Ascent`;
  const description =
    rollup && rollup.repoCount > 0
      ? `${slug}'s fleet averages ${rollup.avgOverall}/100 (${levelForScore(rollup.avgOverall).id} · ${levelForScore(rollup.avgOverall).name}) across ${rollup.scannedCount}/${rollup.repoCount} scanned repos on Ascent.`
      : `AI-native engineering maturity across ${slug}'s fleet on Ascent — a 5-level ladder across 9 dimensions, with evidence.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

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
                {/* Show the level pair only when its direction AGREES with the score tone (gainer→up,
                    regresser→down). A repo can gain score while its level dropped (or vice versa); the
                    old `levelDelta !== 0` showed a contradictory "L4→L3" next to a green ▲, so omit the
                    level pair when it would contradict the headline arrow. */}
                {((tone === "up" && m.levelDelta > 0) || (tone === "down" && m.levelDelta < 0)) && (
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
  const cookieStore = await cookies();
  // OVR-5: an explicit ?range= wins (shareable links stay authoritative); otherwise the remembered
  // period cookie, then the default. Shared with every other org tab via resolveOrgWindow so the range
  // carries across navigation.
  const period = await resolveOrgWindow(sp);
  const win = { start: period.start, end: period.end };

  // OVR-4: which overview sections the user has collapsed (server-read so SSR matches — no flash).
  const collapsed = new Set((cookieStore.get(OVERVIEW_COLLAPSE_COOKIE)?.value ?? "").split(",").filter(Boolean));
  const sectionOpen = (id: string) => !collapsed.has(id);

  // Optional segment scope: validate the `?segment=` id against the org's segments (a bogus id
  // falls back to the whole fleet) so every aggregate below is scoped to the same tagged repos.
  const segments = (await listSegments(slug)) ?? [];
  const segParam = Array.isArray(sp.segment) ? sp.segment[0] : sp.segment;
  const activeSegment = segments.find((s) => s.id === segParam) ?? null;
  const segmentId = activeSegment?.id ?? null;

  // The six section queries are independent of each other — only `segmentId` (validated from
  // `listSegments` above) feeds them — so fetch concurrently rather than as a ~6-stage await
  // waterfall (each helper is itself 2-3 DB round trips; serialized they dominated the landing
  // tab's TTFB). The sibling tabs (practices/plan/delivery) already use Promise.all.
  const [rollup, movers, orgRecs, benchmark, gaps, goals] = await Promise.all([
    getOrgRollup(slug, win, segmentId),
    getOrgMovers(slug, win, segmentId),
    getOrgRecommendations(slug, 5, segmentId),
    getOrgBenchmark(slug),
    getOrgGapAnalysis(slug, segmentId),
    listGoals(slug),
  ]);
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

  // OVR-6: connect the org's stated goals to its most-glanced numbers. Match an active goal by metric
  // (already fetched via listGoals) and surface its target + pace verdict on the headline tile.
  const PACE_NOTE: Record<string, { label: string; color: string }> = {
    reached: { label: "reached", color: "#34d399" },
    "on-pace": { label: "on track", color: "#84cc16" },
    behind: { label: "behind", color: "#f97316" },
    tracking: { label: "tracking", color: "#94a3b8" },
  };
  const goalNote = (metric: string) => {
    const g = (goals ?? []).find((x) => x.status === "active" && x.metric === metric);
    if (!g) return undefined;
    const p = PACE_NOTE[g.pace] ?? PACE_NOTE.tracking!;
    return { target: g.target, label: p.label, color: p.color };
  };

  const trend: TrendPoint[] = rollup.trend.map((t) => ({ score: t.avg, at: t.date }));
  const maxPosture = Math.max(1, ...POSTURE_ORDER.map((p) => rollup.postureCounts[p] ?? 0));
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
          goal={goalNote("overall")}
        />
        <Tile
          label="AI Adoption"
          value={rollup.avgAdoption}
          color={scoreHex(rollup.avgAdoption)}
          delta={rollup.deltas?.adoption}
          deltaLabel={period.comparisonLabel}
          goal={goalNote("adoption")}
        />
        <Tile
          label="Engineering Rigor"
          value={rollup.avgRigor}
          color={scoreHex(rollup.avgRigor)}
          delta={rollup.deltas?.rigor}
          deltaLabel={period.comparisonLabel}
          goal={goalNote("rigor")}
        />
        <Tile label="Repos scanned" value={`${rollup.scannedCount}/${rollup.repoCount}`} />
      </div>

      {/* Trajectory — forward-looking GPS over the maturity trend */}
      {rollup.forecast && <Trajectory forecast={rollup.forecast} />}

      {/* Goals & standing */}
      <CollapsibleSection id="goals" title="Goals & standing" defaultOpen={sectionOpen("goals")}>
        <div className="grid gap-6 lg:grid-cols-2">
          <GoalsOverview slug={slug} goals={goals ?? []} />
          <OrgStanding benchmark={benchmark} regressionCount={regressionCount} periodStart={Boolean(period.start)} />
        </div>
      </CollapsibleSection>

      {/* Where the gaps live — common org gaps vs repo-specific */}
      {gaps && (gaps.commonGaps.length > 0 || gaps.repoSpecific.length > 0) && (
        <OrgGapsSection gaps={gaps} slug={slug} />
      )}

      {/* Posture + dimension averages */}
      <CollapsibleSection id="posture" title="Posture & dimensions" defaultOpen={sectionOpen("posture")}>
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
      </CollapsibleSection>

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
        <CollapsibleSection id="movers" title="Movers & regressions" defaultOpen={sectionOpen("movers")}>
          <div className="grid gap-6 lg:grid-cols-2">
            <MoversList title="Top gainers" tone="up" moves={movers.gainers.slice(0, 5)} emptyText={moversEmpty} />
            <MoversList title="Regressions" tone="down" moves={movers.regressers.slice(0, 5)} emptyText={moversEmpty} />
          </div>
        </CollapsibleSection>
      )}

      {/* Highest-leverage moves */}
      {orgRecs && orgRecs.length > 0 && <OrgLeverageMoves recs={orgRecs} slug={slug} />}
    </div>
  );
}
