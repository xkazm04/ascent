import Link from "next/link";
import type { Metadata } from "next";
import { TrendChart, type TrendPoint } from "@/components/report/TrendChart";
import { Trajectory } from "@/components/org/Trajectory";
import { OrgScoreBadges, type ScoreBadge } from "@/components/org/OrgScoreBadges";
import { PeriodSummary } from "@/components/org/PeriodSummary";
import { TimeRangeSelector } from "@/components/org/TimeRangeSelector";
import { SegmentSelector } from "@/components/org/SegmentSelector";
import { TechStackSelector } from "@/components/org/TechStackSelector";
import { OrgGapsSection } from "@/components/org/OrgGapsSection";
import { PostureDimensionsPanel } from "@/components/org/PostureDimensionsPanel";
import { Card, InlineEmpty, OrgEmpty, SectionHeader, DIRECTION_TONE } from "@/components/org/ui";
import { CollapsibleSection, OVERVIEW_COLLAPSE_COOKIE } from "@/components/org/CollapsibleSection";
import { getOrgGapAnalysis, getOrgMovers, getOrgRollup, listGoals } from "@/lib/db";
import { resolveOrgScope } from "@/lib/org/scope";
import { canReadOrg } from "@/lib/authz";
import { cookies } from "next/headers";
import { levelForScore } from "@/lib/maturity/model";
import { scoreHex } from "@/lib/ui";
import { resolveOrgWindow } from "@/lib/org/period";
import type { RepoMove } from "@/lib/db";
import { GOAL_PACE_TONE } from "@/components/org/plan/goalView";
import type { GoalPace } from "@/lib/maturity/forecast";

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
  const { arrow, color } = DIRECTION_TONE[tone === "up" ? "rising" : "falling"];
  return (
    <Card>
      <SectionHeader size="sm" title={title} />
      {moves.length === 0 ? (
        <InlineEmpty>{emptyText}</InlineEmpty>
      ) : (
        <div className="mt-3 space-y-2">
          {moves.map((m) => (
            <div key={m.fullName} className="flex items-center justify-between gap-3 text-base">
              {/* GA: a mover is a lead, not just a stat — open its stored report to see WHAT moved. */}
              <Link
                href={`/report/${m.fullName}`}
                title={`Open ${m.fullName}'s report`}
                className="focus-ring min-w-0 truncate font-mono text-sm text-slate-200 transition hover:text-accent"
              >
                {m.name}
              </Link>
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

  // Optional segment + tech-stack scope (a bogus id/key falls back to the whole fleet): every aggregate
  // below is scoped to the same repos, and the two filters compose.
  const { segments, activeSegment, segmentId, techGroups, activeStack, techGroupId } = await resolveOrgScope(slug, sp);

  // The section queries are independent of each other — only `segmentId` (validated from
  // `listSegments` above) feeds them — so fetch concurrently rather than as an await waterfall (each
  // helper is itself 2-3 DB round trips; serialized they dominated the landing tab's TTFB). The
  // sibling tabs (practices/plan/delivery) already use Promise.all. `goals` (goal chips) is PERIPHERAL
  // — a transient failure must not reject the whole Promise.all and throw the entire dashboard to
  // error.tsx over a non-core widget, so it degrades individually via `.catch(() => null)` (the same
  // way generateMetadata already tolerates a failed rollup). The core fetches stay all-or-nothing.
  const [rollup, movers, gaps, goals] = await Promise.all([
    getOrgRollup(slug, win, segmentId, techGroupId),
    getOrgMovers(slug, win, segmentId, techGroupId),
    getOrgGapAnalysis(slug, segmentId, techGroupId),
    listGoals(slug).catch(() => null),
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
  // (already fetched via listGoals) and surface its target + pace verdict on the headline tile. The
  // tile wants short, lowercase labels ("on track"/"behind"), but the COLOR comes from the canonical
  // GOAL_PACE_TONE so the pace palette stays single-sourced with the Plan tab's PaceChip.
  const PACE_LABEL: Record<GoalPace, string> = {
    reached: "reached",
    "on-pace": "on track",
    behind: "behind",
    tracking: "tracking",
  };
  const goalNote = (metric: string) => {
    const g = (goals ?? []).find((x) => x.status === "active" && x.metric === metric);
    if (!g) return undefined;
    return { target: g.target, label: PACE_LABEL[g.pace] ?? PACE_LABEL.tracking, color: GOAL_PACE_TONE[g.pace].color };
  };

  const trend: TrendPoint[] = rollup.trend.map((t) => ({ score: t.avg, at: t.date }));
  const moversEmpty = period.start ? "None this period." : "None since last scan.";

  // Headline numbers as compact header badges (replacing the large Tile grid). Deltas + goal verdicts
  // are derived here so their palette stays single-sourced with the rest of the page.
  const badges: ScoreBadge[] = [
    { label: "Org maturity", value: rollup.avgOverall, sub: `${level.id} · ${level.name}`, color: scoreHex(rollup.avgOverall), delta: rollup.deltas?.overall, goal: goalNote("overall") },
    { label: "AI Adoption", value: rollup.avgAdoption, color: scoreHex(rollup.avgAdoption), delta: rollup.deltas?.adoption, goal: goalNote("adoption") },
    { label: "Engineering Rigor", value: rollup.avgRigor, color: scoreHex(rollup.avgRigor), delta: rollup.deltas?.rigor, goal: goalNote("rigor") },
    { label: "Repos scanned", value: `${rollup.scannedCount}/${rollup.repoCount}` },
  ];

  return (
    <div className="space-y-6">
      {/* Period + segment controls — drive the badges' deltas, the trend, and the movers below */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-sm uppercase tracking-widest text-slate-500">
          Showing · {period.title}
          {activeSegment && (
            <>
              {" · "}
              <span className="text-accent">{activeSegment.name}</span> segment
            </>
          )}
          {activeStack && (
            <>
              {" · "}
              <span className="text-accent">{activeStack.label}</span> stack
            </>
          )}
          {/* GB: the compare-segments link rides the controls line instead of its own block. */}
          {segments.length > 0 && (
            <>
              {" · "}
              <Link href={`/org/${slug}/segments`} className="focus-ring text-slate-500 transition hover:text-accent">
                compare segments →
              </Link>
            </>
          )}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentSelector segments={segments} active={segmentId} />
          <TechStackSelector groups={techGroups} active={activeStack?.key ?? null} />
          <TimeRangeSelector range={period.key} from={period.from} to={period.to} />
        </div>
      </div>

      {/* Headline numbers — compact header panel (was the large Tile grid) */}
      <OrgScoreBadges badges={badges} />

      {/* Posture + dimension averages — one panel: composition bar + practice-linked dim grid */}
      <CollapsibleSection id="posture" title="Posture & dimensions" defaultOpen={sectionOpen("posture")}>
        <PostureDimensionsPanel slug={slug} postureCounts={rollup.postureCounts} dims={rollup.dimAverages} />
      </CollapsibleSection>

      {/* Period-in-review banner — auto-summary of net fleet movement over the window */}
      <PeriodSummary window={period} rollup={rollup} movers={movers} />

      {/* Trajectory — forward-looking GPS over the maturity trend */}
      {rollup.forecast && <Trajectory forecast={rollup.forecast} />}

      {/* Where the gaps live — common org gaps vs repo-specific */}
      {gaps && (gaps.commonGaps.length > 0 || gaps.repoSpecific.length > 0) && (
        <OrgGapsSection gaps={gaps} slug={slug} />
      )}

      {/* Trend — needs at least two points; a single rollup is just a lone dot in an empty axis. */}
      {trend.length >= 2 && (
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
    </div>
  );
}
