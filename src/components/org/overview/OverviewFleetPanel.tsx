// The Overview's data region: the fleet rollup card + the repo × dimension heatmap. Its own
// <Suspense> boundary in OrgTabChunks, because it is the tab's ONE genuinely slow data source (two
// rollup queries over every repo's scan history) — so the period control and the scope readout above
// it paint without waiting on it.

import { DIMS, OrgEmpty } from "@/components/org/shared/ui";
import { RepoCategoryRollup } from "./RepoCategoryRollup";
import { RepoDimensionHeatmap } from "./RepoDimensionHeatmap";
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
}: {
  slug: string;
  /** The SHARED scope promise created once in OverviewTab and awaited in both boundaries — one
   *  query, two independently-streaming regions. Awaiting a promise twice does not re-run it. */
  scope: Promise<OrgScope>;
  win: Pick<ResolvedWindow, "start" | "end">;
  periodTitle: string;
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

  return (
    <div className="space-y-6">
      <div data-tour="results-view">
        <RepoCategoryRollup trajectories={trajectories} periodTitle={periodTitle} orgSlug={slug} />
      </div>

      {/* The second Fleet-level instrument, beside the rollup so "which cohorts are moving" and
          "who's strong/weak per dimension" read together. Cells open the per-dimension modal. */}
      {heatmapRows.length > 0 && <RepoDimensionHeatmap org={slug} dims={DIMS} rows={heatmapRows} />}
    </div>
  );
}
