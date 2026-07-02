import { DIMS, ExportCsvLink, SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/ui";
import { ScopeFilterBar } from "@/components/org/ScopeFilterBar";
import { TeamsMatrix } from "@/components/org/TeamsMatrix";
import { TeamsSignals } from "@/components/org/TeamsSignals";
import { TeamsUnowned } from "@/components/org/TeamsUnowned";
import { getOrgTeamRollup } from "@/lib/db";
import { resolveOrgScope } from "@/lib/org/scope";
import { scoreHex } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function TeamsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  // Optional segment + tech-stack scope (parity with Contributors/Delivery): bogus id/key → whole fleet.
  const { segments, segmentId, techGroups, activeStack, techGroupId } = await resolveOrgScope(slug, sp);

  const rollup = await getOrgTeamRollup(slug, segmentId, techGroupId);

  const hasFilters = segments.length > 0 || techGroups.length > 0;
  const filterBar = hasFilters && (
    <ScopeFilterBar segments={segments} segmentId={segmentId} techGroups={techGroups} activeStack={activeStack} />
  );

  if (!rollup || rollup.teams.length === 0) {
    return (
      <div>
        {filterBar && <div className="mb-4 flex justify-end">{filterBar}</div>}
        <SectionEmpty>
          {segmentId
            ? "No team attribution for this segment — pick another segment, or add CODEOWNERS team owners to its repos and re-scan."
            : "No team attribution yet. Teams are parsed from each repo's CODEOWNERS file at scan time — add a CODEOWNERS that assigns paths to @org/team owners, then re-scan and this view fills in."}
        </SectionEmpty>
        {/* The fix-it list: exactly which scanned repos need a CODEOWNERS owner, with the snippet. */}
        {rollup && <TeamsUnowned slug={slug} unowned={rollup.unowned} />}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-base text-slate-400">
          The fleet rolled up by the teams that own it (from each repo&apos;s{" "}
          <span className="font-mono text-slate-300">CODEOWNERS</span>) — where institutional AI knowledge sits and where a
          pairing could spread it. Inputs to explore, not a ranking.
        </p>
        {filterBar && <div className="flex shrink-0 items-center gap-2">{filterBar}</div>}
      </div>

      {/* Summary tiles */}
      <div className={`mt-6 ${TILE_GRID}`}>
        <Tile label="Teams" value={rollup.teamCount} sub="from CODEOWNERS" />
        <Tile label="Attributed repos" value={rollup.attributedRepos} sub="scanned, with a team owner" />
        <Tile
          label="Unowned repos"
          value={rollup.unownedRepos}
          sub={rollup.unownedRepos > 0 ? "no CODEOWNERS team — fix list below" : "every scanned repo has an owner"}
          color={rollup.unownedRepos > 0 ? "var(--color-warn)" : undefined}
        />
        <Tile
          label="Knowledge leader"
          value={rollup.knowledgeLeader ? `${rollup.knowledgeLeader.aiCommitShare}%` : "—"}
          sub={rollup.knowledgeLeader ? rollup.knowledgeLeader.name : "no AI-attributed activity yet"}
          color={rollup.knowledgeLeader ? scoreHex(rollup.knowledgeLeader.knowledgeScore) : undefined}
        />
      </div>

      {/* Headline signals: knowledge leader + top pairing opportunities, linked into the matrix. */}
      <TeamsSignals slug={slug} leader={rollup.knowledgeLeader} pairings={rollup.pairings} />

      {/* The matrix — every team × every dimension, sortable, rows expand to repos/champions. */}
      <div className="mt-8">
        <SectionHeader
          title="Teams × dimensions"
          description="Each team's maturity, AI knowledge, movement, and per-dimension averages in one grid — click a header to sort, a team to open its repos and champions."
          right={<ExportCsvLink org={slug} kind="teams" segmentId={segmentId} className="shrink-0" />}
        />
        <TeamsMatrix teams={rollup.teams} dims={DIMS} leaderSlug={rollup.knowledgeLeader?.slug ?? null} />
      </div>

      <TeamsUnowned slug={slug} unowned={rollup.unowned} />

      <p className="mt-6 max-w-3xl font-mono text-sm text-slate-600">
        Attribution parses CODEOWNERS at scan time; a repo counts toward every team that owns part of it, so numbers reflect
        responsibility, never a ranking. Δ compares each repo&apos;s two latest scans. GitHub Teams (GraphQL) attribution is
        on the roadmap.
      </p>
    </div>
  );
}
