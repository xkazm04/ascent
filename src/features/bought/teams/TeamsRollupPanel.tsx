// The Teams tab's one data region — moved verbatim from the old page.tsx body (minus the layout
// guards, which stay in the org layout).

import { DIMS, ExportCsvLink, SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/shared/dashboard/ui";
import { ScopeFilterBar } from "@/components/shared/scope/ScopeFilterBar";
import { TeamsMatrix } from "./TeamsMatrix";
import { TeamsSignals } from "./TeamsSignals";
import { TeamsStandings } from "./TeamsStandings";
import { TeamsUnowned } from "./TeamsUnowned";
import { ATTRIBUTION_HINT, deltaFootnote, teamAnchorId } from "./teamsShared";
import { teamsRollupV2 } from "./TeamsRollupPanel.v2";
import { getOrgTeamRollup, getTeamStandingsProvenance } from "@/lib/db";
import { resolveOrgScope } from "@/lib/org/scope";
import { orgWindowBounds, resolveOrgWindow } from "@/lib/org/period";
// The Delivery tab's settle helper, reused rather than re-implemented: one classification of a
// settled query ("null value" vs "actually failed") for every tab that degrades per section.
import { settle } from "@/features/bought/delivery/deliveryLoad";
import { decisionMap } from "@/lib/org/decision-map";
import { explainTeamStandings } from "@/lib/org/teamStandings";
import { WhyChip } from "@/components/shared/viz";
import { scoreHex } from "@/lib/ui";

export async function TeamsRollupPanel({ slug, sp }: { slug: string; sp: { [key: string]: string | string[] | undefined } }) {
  // Optional segment + tech-stack scope (parity with Contributors/Delivery): bogus id/key → whole fleet.
  const { barProps, segmentId, techGroupId, activeStack } = await resolveOrgScope(slug, sp);

  // Honor the dashboard-wide period selector (fleet-rollups-insights 07-16 #2): Teams was the only
  // fleet surface that ignored it — its movers silently compared "latest vs previous scan" (a
  // cadence-dependent span per repo) while every sibling tab re-scoped to the selected window. The
  // window now threads into the rollup (period-scoped, half-open baseline like getOrgMovers) and the
  // Δ surfaces are labeled with what they actually compare.
  const period = await resolveOrgWindow(sp);
  // The one window shape the db layer queries with (`{ start, endExclusive }`) — this panel used to
  // hand-write the inclusive `{ start, end }` pair, which is how the inclusive dialect spread: a row
  // in the window's final millisecond is matched by `lt: endExclusive` and missed by `lte: end`, so
  // Teams and its sibling tabs could disagree about a boundary scan on the same period.
  const window = period.start ? orgWindowBounds(period) : undefined;
  const deltaLabel = window && period.comparisonLabel ? period.comparisonLabel : "since last scan";

  // Per-section degradation (the Delivery tab's G4-10 fix, applied here): under Promise.all a blip on
  // decisionMap — a side annotation on the unowned list — rejected the whole tab and blanked the
  // rollup, the matrix, the standings and the signals that would all have rendered fine. Each query
  // now fails on its own, with an explicit "couldn't load" banner rather than an empty state that
  // would claim the org has no CODEOWNERS attribution.
  //
  // The provenance read joins this set instead of being awaited serially after it: it now resolves
  // the org through the cached getOrgBySlug, so it costs one indexed row read on a resolver the
  // rollup has already warmed.
  const [rollupSettled, decisionsSettled, provenanceSettled] = await Promise.allSettled([
    getOrgTeamRollup(slug, segmentId, techGroupId, window),
    decisionMap(slug, "teams"),
    getTeamStandingsProvenance(slug),
  ]);
  const { value: rollup, failed: rollupFailed } = settle(rollupSettled);
  const { value: decisionsValue, failed: decisionsFailed } = settle(decisionsSettled);
  const { value: standingsProvenance } = settle(provenanceSettled);
  const decisions = decisionsValue ?? {};
  for (const [label, r] of [
    ["getOrgTeamRollup", rollupSettled],
    ["decisionMap", decisionsSettled],
    ["getTeamStandingsProvenance", provenanceSettled],
  ] as const) {
    if (r.status === "rejected") console.error(`[teams/${slug}] ${label} failed:`, r.reason);
  }

  const hasFilters = barProps.segments.length > 0 || barProps.techGroups.length > 0;
  const filterBar = hasFilters && <ScopeFilterBar {...barProps} window={window} />;

  if (!rollup || rollup.teams.length === 0) {
    return (
      <div>
        {filterBar && <div className="mb-4 flex justify-end">{filterBar}</div>}
        {/* "Couldn't load" is a different claim from "no team attribution" — telling someone to go
            write a CODEOWNERS when the query simply threw sends them at work they may not need. */}
        {rollupFailed ? (
          <SectionEmpty>
            Team attribution couldn&apos;t load right now (a query failed). Try refreshing this page.
          </SectionEmpty>
        ) : (
        <SectionEmpty>
          {segmentId
            ? "No team attribution for this segment. Pick another segment, or add CODEOWNERS team owners to its repos and re-scan."
            : "No team attribution yet. Teams are parsed from each repo's CODEOWNERS file at scan time. Add a CODEOWNERS that assigns paths to @org/team owners, then re-scan and this view fills in."}
        </SectionEmpty>
        )}
        {/* The fix-it list: exactly which scanned repos need a CODEOWNERS owner, with the snippet. */}
        {rollup && <TeamsUnowned slug={slug} unowned={rollup.unowned} decisions={decisions} />}
      </div>
    );
  }

  // Deterministic "why the top leads / why the bottom lags" decomposition, derived from the same
  // scan-gathered rollup the table renders (see explainTeamStandings). Rendered live so it always
  // agrees with the table above; the snapshot captured at scan time supplies the provenance stamp.
  const standings = explainTeamStandings(rollup.teams);
  // The snapshot is WHOLE-ORG (persistTeamStandings takes no filter). Under an active segment/stack
  // filter these standings are NOT what that scan captured, so the stamp says fleet-wide instead of
  // implying the filtered decomposition was the thing recorded.
  const scoped = segmentId != null || techGroupId != null;

  return teamsRollupV2({
    slug, rollup, standings, decisions, decisionsFailed, deltaLabel, dims: DIMS, filterBar,
    capturedAt: standingsProvenance?.generatedAt ?? null,
    capturedScopeNote: scoped && standingsProvenance ? "captured fleet-wide, not for this filter" : null,
    exportLink: <ExportCsvLink org={slug} kind="teams" segmentId={segmentId} stack={activeStack?.key} className="shrink-0" />,
  });
}
