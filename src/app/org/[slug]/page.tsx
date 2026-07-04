import type { Metadata } from "next";
import { TimeRangeSelector } from "@/components/org/TimeRangeSelector";
import { DIMS, OrgEmpty } from "@/components/org/ui";
import { RepoCategoryRollup } from "@/components/org/RepoCategoryRollup";
import { RepoDimensionHeatmap } from "@/components/org/RepoDimensionHeatmap";
import { buildTrajectories } from "@/components/org/repoTrajectory";
import { getOrgRepoHistories, getOrgRollup } from "@/lib/db";
import { resolveOrgScope } from "@/lib/org/scope";
import { canReadOrg } from "@/lib/authz";
import { levelForScore } from "@/lib/maturity/model";
import { resolveOrgWindow } from "@/lib/org/period";

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

export default async function OrgOverview({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  // An explicit ?range= wins (shareable links stay authoritative); otherwise the remembered period
  // cookie, then the default. Shared with every org tab via resolveOrgWindow so the range carries across.
  const period = await resolveOrgWindow(sp);
  const win = { start: period.start, end: period.end };

  // Segment + tech-stack scope still applies via deep links (?segment=/?stack= carried from other tabs);
  // the in-view Type/Stack/Level dropdowns replace the old top-of-page selectors.
  const { activeSegment, segmentId, activeStack, techGroupId } = await resolveOrgScope(slug, sp);

  // The repos×time Overview needs exactly two reads: the fleet snapshot (latest per repo + counts) and
  // each repo's per-scan history. Both are core, so fetch them together and let a failure throw to
  // error.tsx as one (no half-rendered dashboard).
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
        href={`/org/${slug}/repositories`}
        cta="View repositories"
      />
    );
  }

  // Repos×time model — join each repo's latest snapshot with its per-scan history. Pure + serializable,
  // so it's derived here on the server and passed to the client view.
  const trajectories = buildTrajectories(
    rollup.repos.map((r) => ({ fullName: r.fullName, name: r.name, owner: r.owner, techStack: r.techStack, latest: r.latest })),
    histories,
  );

  // Repo × dimension heatmap rows — the scanned fleet's per-dimension scores, the same lean projection
  // the Repositories tab fed before this instrument moved here (next to the Fleet rollup) so the two
  // Fleet-level reads sit side by side. Empty (all-unscanned view) hides the card below.
  const heatmapRows = rollup.repos
    .filter((r) => r.latest)
    .map((r) => ({
      name: r.name,
      fullName: r.fullName,
      dims: r.latest!.dims.map((d) => ({ dimId: d.dimId, score: d.score })),
    }));

  return (
    <div className="space-y-6">
      {/* Period control + active-scope readout (filtering now lives in the view's header dropdowns) */}
      <div data-tour="results-controls" className="flex flex-wrap items-center justify-between gap-3">
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
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <TimeRangeSelector range={period.key} from={period.from} to={period.to} />
        </div>
      </div>

      <div data-tour="results-view">
        <RepoCategoryRollup trajectories={trajectories} periodTitle={period.title} orgSlug={slug} />
      </div>

      {/* Repo × dimension heatmap — the second Fleet-level instrument, moved here from the Repositories
          tab so "which cohorts are moving" (Fleet) and "who's strong/weak per dimension" (heatmap) read
          together. Self-contained Surface card (matches the Fleet card); cells open the per-dimension modal. */}
      {heatmapRows.length > 0 && <RepoDimensionHeatmap org={slug} dims={DIMS} rows={heatmapRows} />}
    </div>
  );
}
