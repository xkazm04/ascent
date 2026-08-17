// The Overview's data region — the whole front page of the org dashboard, in reading order:
//   1. the headline standing strip (where the fleet stands + its maturity trend sparkline),
//   2. posture composition + per-dimension averages (the composition behind that headline),
//   3. the fleet rollup card (which cohorts are moving),
//   4. the repo × dimension heatmap (who is strong/weak, cell-by-cell).
//
// All four read ONE rollup. `getOrgRollup` is NOT React-`cache()`d, so splitting the standing strip
// into its own <Suspense> boundary would buy a second identical query, not a second stream — the
// panels share this boundary on purpose. Its own <Suspense> in OverviewTab, because it is the tab's
// ONE genuinely slow data source (two rollup queries over every repo's scan history) — so the period
// control and the scope readout above it paint without waiting on it.

import { OrgEmpty } from "@/components/org/shared/ui";
import { OverviewLedger } from "./OverviewLedger";
import { buildScoreBadges, buildTrendPoints } from "./overviewStanding";
import { buildTrajectories } from "./repoTrajectory";
import { getOrgRepoHistories, getOrgRollup } from "@/lib/db";
import type { OrgScope } from "@/lib/org/scope";
import type { ResolvedWindow } from "@/lib/window";
import { orgTabHref } from "@/lib/org/orgTabs";

export async function OverviewFleetPanel({
  slug,
  scope,
  win,
  periodTitle,
  sortDim,
  search,
}: {
  slug: string;
  /** The SHARED scope promise created once in OverviewTab and awaited in both boundaries — one
   *  query, two independently-streaming regions. Awaiting a promise twice does not re-run it. */
  scope: Promise<OrgScope>;
  win: Pick<ResolvedWindow, "start" | "end">;
  periodTitle: string;
  /** `?dim=` deep link from the dimension grid's ▦ affordance — seeds the heatmap's weakest-first
   *  column sort. Ignored by the heatmap when it isn't a real column. */
  sortDim?: string;
  /** The tab's current query string, carried into the panels' deep links so a drill-in keeps the
   *  period + segment/stack scope the numbers were computed under. */
  search?: string;
}) {
  const { segmentId, techGroupId } = await scope;

  // The repos×time Overview needs exactly two reads: the fleet snapshot (latest per repo + counts)
  // and each repo's per-scan history. Both are core, so fetch them together and let a failure throw
  // to the tab's error boundary as one (no half-rendered dashboard).
  const [rollup, histories] = await Promise.all([
    getOrgRollup(slug, win, segmentId, techGroupId),
    getOrgRepoHistories(slug, win, segmentId, techGroupId),
  ]);

  // Reaching here with a null rollup means this view's scoped query (period + segment) found nothing
  // where the layout's did — render a page-scale empty state with a way out, not a blank panel.
  if (!rollup) {
    return (
      <OrgEmpty
        title="No data for this view"
        body="No scans match the selected period or segment yet. Widen the time range, clear the segment filter, or scan some repositories to populate the dashboard."
        href={orgTabHref(slug, "repositories")}
        cta="View repositories"
      />
    );
  }

  // Repos×time model — join each repo's latest snapshot with its per-scan history. Pure +
  // serializable, so it's derived here on the server and passed to the client view.
  const trajectories = buildTrajectories(
    rollup.repos.map((r) => ({ fullName: r.fullName, name: r.name, owner: r.owner, techStack: r.techStack, latest: r.latest })),
    histories,
  );

  // Repo × dimension heatmap rows — the scanned fleet's per-dimension scores. Empty (all-unscanned
  // view) hides the card below.
  const heatmapRows = rollup.repos
    .filter((r) => r.latest)
    .map((r) => ({
      name: r.name,
      fullName: r.fullName,
      dims: r.latest!.dims.map((d) => ({ dimId: d.dimId, score: d.score })),
    }));

  // The whole region is one client component (the fleet rollup and heatmap hold interaction state).
  // Everything it renders is derived HERE, on the server, and handed over serialised — nothing in
  // OverviewLedger awaits.
  return (
    <OverviewLedger
      slug={slug}
      search={search ?? ""}
      periodTitle={periodTitle}
      sortDim={sortDim}
      badges={buildScoreBadges(rollup)}
      trend={{ points: buildTrendPoints(rollup.trend), label: periodTitle }}
      postureCounts={rollup.postureCounts}
      dims={rollup.dimAverages}
      dimDeltas={rollup.dimDeltas ?? null}
      deltaLabel={`vs ${periodTitle.toLowerCase()}`}
      trajectories={trajectories}
      heatmapRows={heatmapRows}
    />
  );
}
