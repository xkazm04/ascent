import { DIMS, ExportCsvLink, SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/ui";
import { TeamsMatrix } from "@/components/org/TeamsMatrix";
import { TeamsSignals } from "@/components/org/TeamsSignals";
import { TeamsStandings } from "@/components/org/TeamsStandings";
import { TeamsUnowned } from "@/components/org/TeamsUnowned";
import { teamAnchorId } from "@/components/org/teamsShared";
import { getOrgTeamRollup, getTeamStandingsProvenance } from "@/lib/db";
import { explainTeamStandings } from "@/lib/org/teamStandings";
import { scoreHex } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function TeamsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const rollup = await getOrgTeamRollup(slug);

  if (!rollup || rollup.teams.length === 0) {
    return (
      <div>
        <SectionEmpty>
          No team attribution yet. Teams are parsed from each repo&apos;s CODEOWNERS file at scan time — add a CODEOWNERS that
          assigns paths to @org/team owners, then re-scan and this view fills in.
        </SectionEmpty>
        {/* The fix-it list: exactly which scanned repos need a CODEOWNERS owner, with the snippet. */}
        {rollup && <TeamsUnowned slug={slug} unowned={rollup.unowned} />}
      </div>
    );
  }

  // Deterministic "why the top leads / why the bottom lags" decomposition, derived from the same
  // scan-gathered rollup the table renders (see explainTeamStandings). Rendered live so it always
  // agrees with the table above; the snapshot captured at scan time supplies the provenance stamp.
  const standings = explainTeamStandings(rollup.teams);
  const standingsProvenance = standings ? await getTeamStandingsProvenance(slug) : null;

  return (
    <div>
      <p className="max-w-3xl text-base text-slate-400">
        The fleet rolled up by the teams that own it (from each repo&apos;s{" "}
        <span className="font-mono text-slate-300">CODEOWNERS</span>) — where institutional AI knowledge sits and where a
        pairing could spread it. Inputs to explore, not a ranking.
      </p>

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
          title="Teams × dimensions"
          description="Each team's maturity, AI knowledge, movement, and per-dimension averages in one grid — click a header to sort, a team to open its repos and champions."
          right={<ExportCsvLink org={slug} kind="teams" className="shrink-0" />}
        />
        <TeamsMatrix teams={rollup.teams} dims={DIMS} leaderSlug={rollup.knowledgeLeader?.slug ?? null} />
      </div>

      {/* Why the top leads and the bottom lags — factor decomposition against the fleet mean. */}
      {standings && <TeamsStandings standings={standings} capturedAt={standingsProvenance?.generatedAt ?? null} />}

      {/* Headline signals: knowledge leader + top pairing opportunities, linked into the matrix. */}
      <TeamsSignals slug={slug} leader={rollup.knowledgeLeader} pairings={rollup.pairings} />

      <TeamsUnowned slug={slug} unowned={rollup.unowned} />

      <p className="mt-6 max-w-3xl font-mono text-sm text-slate-600">
        Attribution parses CODEOWNERS at scan time; a repo counts toward every team that owns part of it, so numbers reflect
        responsibility, never a ranking. Δ compares each repo&apos;s two latest scans. GitHub Teams (GraphQL) attribution is
        on the roadmap.
      </p>
    </div>
  );
}
