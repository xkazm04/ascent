// The Teams tab's one data region — moved verbatim from the old page.tsx body (minus the layout
// guards, which stay in the org layout).

import { DIMS, ExportCsvLink, SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/shared/ui";
import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { TeamsMatrix } from "./TeamsMatrix";
import { TeamsSignals } from "./TeamsSignals";
import { TeamsStandings } from "./TeamsStandings";
import { TeamsUnowned } from "./TeamsUnowned";
import { deltaFootnote, teamAnchorId } from "./teamsShared";
import { getOrgTeamRollup, getTeamStandingsProvenance } from "@/lib/db";
import { resolveOrgScope } from "@/lib/org/scope";
import { orgWindowBounds, resolveOrgWindow } from "@/lib/org/period";
// The Delivery tab's settle helper, reused rather than re-implemented: one classification of a
// settled query ("null value" vs "actually failed") for every tab that degrades per section.
import { settle } from "@/features/bought/delivery/deliveryLoad";
import { decisionMap } from "@/lib/org/decision-map";
import { explainTeamStandings } from "@/lib/org/teamStandings";
import { WhyChip } from "@/components/org/viz";
import { scoreHex } from "@/lib/ui";

/**
 * (D) The attribution mechanics, demoted out of the tab's lede and its closing footnote. Both said
 * some of this; neither said all of it, and it sat permanently above and below a populated grid.
 */
const ATTRIBUTION_HINT =
  "Teams are parsed from each repo's CODEOWNERS at scan time, so this view is as current as the last scan. A repo counts toward EVERY team that owns part of it, which means the repo counts here sum to more than the fleet: these are figures about responsibility, never a ranking.";

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
  const filterBar = hasFilters && <ScopeFilterBar {...barProps} />;

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

  return (
    <div>
      {/* The tab's lede was an essay (§1 A1): it named the component, defined the data source, and
          argued the framing, above a panel the reader had not looked at yet. The source moves to the
          Attribution WhyChip below, the framing to the standings' own chip, and the description of
          what the grid contains is deleted — the grid says it. */}
      {filterBar && <div className="flex justify-end">{filterBar}</div>}

      {/* Summary ledger — the shared hairline tile band; each stat deep-links to its evidence. */}
      <div className={`mt-6 ${TILE_GRID}`}>
        <Tile label="Teams" value={rollup.teamCount} sub="from CODEOWNERS" href="#teams-matrix" />
        <Tile label="Attributed repos" value={rollup.attributedRepos} sub="scanned, with a team owner" href="#teams-matrix" />
        <Tile
          label="Unowned repos"
          value={rollup.unownedRepos}
          sub={rollup.unownedRepos > 0 ? "no CODEOWNERS team → fix" : "every scanned repo has an owner"}
          color={rollup.unownedRepos > 0 ? "var(--color-warn)" : undefined}
          href={rollup.unownedRepos > 0 ? "#unowned" : undefined}
        />
        <Tile
          label="Knowledge leader"
          value={rollup.knowledgeLeader ? `${rollup.knowledgeLeader.aiCommitShare}%` : "—"}
          sub={rollup.knowledgeLeader ? rollup.knowledgeLeader.name : "no AI-attributed activity yet"}
          // Color by the metric SHOWN (AI commit share), not the ranking knowledgeScore — otherwise a
          // team with low AI share but high adoption rendered its "30%" tinted green, disagreeing with
          // both the number it sits on and the matrix rows (which color by aiCommitShare).
          color={rollup.knowledgeLeader ? scoreHex(rollup.knowledgeLeader.aiCommitShare) : undefined}
          href={rollup.knowledgeLeader ? `#${teamAnchorId(rollup.knowledgeLeader.slug)}` : undefined}
        />
      </div>

      {/* The matrix — every team × every dimension, sortable, rows expand to repos/champions. */}
      <div id="teams-matrix" className="mt-8 scroll-mt-24">
        <SectionHeader
          title={
            <span className="flex items-center gap-2">
              Teams × dimensions
              <WhyChip hint={ATTRIBUTION_HINT} label="how a repo is attributed to a team" />
            </span>
          }
          description={`${rollup.attributedRepos} attributed repos · Δ ${deltaLabel}`}
          right={<ExportCsvLink org={slug} kind="teams" segmentId={segmentId} stack={activeStack?.key} className="shrink-0" />}
        />
        <TeamsMatrix teams={rollup.teams} dims={DIMS} leaderSlug={rollup.knowledgeLeader?.slug ?? null} deltaLabel={deltaLabel} />
      </div>

      {/* Why the top leads and the bottom lags — factor decomposition against the fleet mean. */}
      {standings && (
        <TeamsStandings
          standings={standings}
          teams={rollup.teams}
          capturedAt={standingsProvenance?.generatedAt ?? null}
          capturedScopeNote={scoped && standingsProvenance ? "captured fleet-wide, not for this filter" : null}
        />
      )}

      {/* Headline signals: knowledge leader + top pairing opportunities, linked into the matrix. */}
      <TeamsSignals slug={slug} leader={rollup.knowledgeLeader} pairings={rollup.pairings} />

      <TeamsUnowned slug={slug} unowned={rollup.unowned} decisions={decisions} />

      {/* The decisions annotation degrades alone: the lists above still render, and this says the
          annotations are missing rather than letting them read as "no decisions recorded". */}
      {decisionsFailed && (
        <div className="mt-4">
          <SectionEmpty>
            Recorded decisions couldn&apos;t load right now, so the lists above show none. Try refreshing this page.
          </SectionEmpty>
        </div>
      )}

      {/* The Δ footnote is DERIVED from the same deltaLabel the column header and its tooltips use.
          It used to assert "each repo's two latest scans" under a period-scoped Δ — a footnote
          contradicting the column two sections above it. It KEEPS its sentence: what a delta
          compares is not an epistemic state with an encoding, and a reader who mis-reads the window
          mis-reads every Δ on the page.
          The attribution mechanics that shared this paragraph moved to ATTRIBUTION_HINT (D), and the
          GitHub-Teams roadmap line to the feature doc (F) — a roadmap is not runtime chrome. */}
      <p className="mt-6 max-w-3xl type-mono-sm text-slate-600">Δ compares {deltaFootnote(deltaLabel)}.</p>
    </div>
  );
}
