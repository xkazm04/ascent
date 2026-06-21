import { Card, Meter, POSTURE_LABEL, SectionEmpty, SectionHeader, Tile, deltaHex, fmtDelta } from "@/components/org/ui";
import { CHAMPION_MIN_POP } from "@/components/org/champions";
import { SegmentSelector } from "@/components/org/SegmentSelector";
import { TechStackSelector } from "@/components/org/TechStackSelector";
import { getOrgTeamRollup, listSegments, listTechStackGroups, type TeamRollup } from "@/lib/db";
import { levelForScore } from "@/lib/maturity/model";
import { scoreHex } from "@/lib/ui";

export const dynamic = "force-dynamic";

function MetricBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between font-mono text-sm uppercase tracking-widest text-slate-500">
        <span>{label}</span>
        <span style={{ color: scoreHex(value) }}>{value}</span>
      </div>
      <Meter className="mt-1" size="sm" value={value} color={scoreHex(value)} threshold={50} />
    </div>
  );
}

function TeamCard({ team }: { team: TeamRollup }) {
  const level = levelForScore(team.avgOverall);
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-base text-white">{team.slug}</span>
            <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm" style={{ color: scoreHex(team.avgOverall) }}>
              {level.id} · {team.avgOverall}
            </span>
          </div>
          <div className="mt-1 font-mono text-sm text-slate-500">
            {team.repoCount} repo{team.repoCount === 1 ? "" : "s"}
            {team.totalOwned > team.repoCount && ` (${team.totalOwned} owned)`}
            {team.defaultOwnerCount > 0 && ` · primary owner of ${team.defaultOwnerCount}`}
            {" · "}
            {POSTURE_LABEL[team.posture] ?? team.posture}
          </div>
        </div>
        {team.comparedRepos > 0 && (
          <div className="text-right">
            <div className="font-mono text-sm uppercase tracking-widest text-slate-500">since last scan</div>
            <div className="mt-0.5 font-mono text-base" style={{ color: deltaHex(team.avgDelta) }}>
              {fmtDelta(team.avgDelta)}
            </div>
            <div className="font-mono text-sm text-slate-600">
              ▲{team.improving} ▼{team.declining}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MetricBar label="Overall" value={team.avgOverall} />
        <MetricBar label="Adoption" value={team.avgAdoption} />
        <MetricBar label="Rigor" value={team.avgRigor} />
      </div>

      {/* AI knowledge + strongest/weakest dimension */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <div className="font-mono text-sm uppercase tracking-widest text-slate-500">AI knowledge</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-xl font-bold" style={{ color: scoreHex(team.aiCommitShare) }}>
              {team.aiCommitShare}%
            </span>
            <span className="text-sm text-slate-500">of recent commits · {team.aiContributors}/{team.contributors} AI-active</span>
          </div>
          {team.contributors >= CHAMPION_MIN_POP && team.champions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {team.champions.map((c) => (
                <span key={c.login} className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-accent" title={`${c.aiCommits} AI commits · ${c.aiShare}% AI`}>
                  {c.login} · {c.aiShare}%
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <div className="font-mono text-sm uppercase tracking-widest text-slate-500">Dimension shape</div>
          <div className="mt-1.5 space-y-1.5 text-sm">
            {team.strongest && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Strongest · {team.strongest.label}</span>
                <span className="font-mono" style={{ color: scoreHex(team.strongest.avg) }}>{team.strongest.avg}</span>
              </div>
            )}
            {team.weakest && team.weakest.dimId !== team.strongest?.dimId && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Could grow · {team.weakest.label}</span>
                <span className="font-mono" style={{ color: scoreHex(team.weakest.avg) }}>{team.weakest.avg}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Owned repos */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {team.repos.map((r) => (
          <span
            key={r.fullName}
            className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-slate-400"
            title={`${r.fullName} · overall ${r.overall}${r.isDefaultOwner ? " · primary owner" : ""}`}
          >
            {r.name}
            <span className="ml-1" style={{ color: scoreHex(r.overall) }}>{r.overall}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default async function TeamsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  // Optional segment scope (parity with Contributors/Delivery): a bogus id falls back to the fleet.
  const segments = (await listSegments(slug)) ?? [];
  const segParam = Array.isArray(sp.segment) ? sp.segment[0] : sp.segment;
  const segmentId = segments.find((s) => s.id === segParam)?.id ?? null;

  // Optional tech-stack scope (Feature 3b), composes with the segment filter.
  const techGroups = await listTechStackGroups(slug);
  const stackParam = Array.isArray(sp.stack) ? sp.stack[0] : sp.stack;
  const activeStack = techGroups.find((g) => g.key === stackParam) ?? null;

  const rollup = await getOrgTeamRollup(slug, segmentId, activeStack?.id ?? null);

  const segmentBar = (segments.length > 0 || techGroups.length > 0) && (
    <div className="mb-4 flex flex-wrap justify-end gap-2">
      {segments.length > 0 && <SegmentSelector segments={segments} active={segmentId} />}
      <TechStackSelector groups={techGroups} active={activeStack?.key ?? null} />
    </div>
  );

  if (!rollup || rollup.teams.length === 0) {
    return (
      <div>
        {segmentBar}
        <SectionEmpty>
          {segmentId
            ? "No team attribution for this segment — pick another segment, or add CODEOWNERS team owners to its repos and re-scan."
            : "No team attribution yet. Teams are parsed from each repo's CODEOWNERS file at scan time — add a CODEOWNERS that assigns paths to @org/team owners, then re-scan and this view fills in."}
        </SectionEmpty>
      </div>
    );
  }

  return (
    <div>
      {segmentBar}
      <p className="max-w-3xl text-base text-slate-400">
        Your fleet, rolled up by the teams that own it (from each repo&apos;s <span className="font-mono text-slate-300">CODEOWNERS</span>).
        Inputs to explore how AI capability is distributed across the org — which team carries the most institutional AI
        knowledge, and where a pairing could spread it. Not a ranking, and not a to-do list for anyone.
      </p>

      {/* Summary tiles */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Teams" value={rollup.teamCount} sub="from CODEOWNERS" />
        <Tile label="Attributed repos" value={rollup.attributedRepos} sub="scanned repos with a team owner" />
        <Tile
          label="Unowned repos"
          value={rollup.unownedRepos}
          sub="scanned, no CODEOWNERS team"
          color={rollup.unownedRepos > 0 ? "#f97316" : "#fff"}
        />
        <Tile
          label="Knowledge leader"
          value={rollup.knowledgeLeader ? `${rollup.knowledgeLeader.aiCommitShare}%` : "—"}
          sub={rollup.knowledgeLeader ? rollup.knowledgeLeader.name : "no AI activity yet"}
          color={rollup.knowledgeLeader ? scoreHex(rollup.knowledgeLeader.knowledgeScore) : "#fff"}
        />
      </div>

      {/* Headline inputs: knowledge leader + suggested pairing */}
      {(rollup.knowledgeLeader || rollup.pairing) && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {rollup.knowledgeLeader && (
            <Card>
              <div className="font-mono text-sm uppercase tracking-widest text-accent">🧠 Most institutional AI knowledge</div>
              <div className="mt-2 font-mono text-lg text-white">{rollup.knowledgeLeader.slug}</div>
              <p className="mt-2 text-base text-slate-400">
                <span className="text-slate-200">{rollup.knowledgeLeader.aiCommitShare}%</span> of this team&apos;s recent commits are
                AI-attributed and its repos average <span className="text-slate-200">{rollup.knowledgeLeader.avgAdoption}</span> on
                adoption — a natural place to source patterns others could borrow. An input, not a verdict.
              </p>
            </Card>
          )}
          {rollup.pairing && (
            <Card>
              <div className="font-mono text-sm uppercase tracking-widest text-accent">🤝 A pairing to consider</div>
              <div className="mt-2 text-base text-slate-300">
                <span className="font-mono text-white">{rollup.pairing.mentorSlug}</span> is strong on{" "}
                <span className="text-slate-200">{rollup.pairing.label}</span> ({rollup.pairing.mentorScore}), where{" "}
                <span className="font-mono text-white">{rollup.pairing.learnerSlug}</span> sits at {rollup.pairing.learnerScore} — a{" "}
                <span style={{ color: deltaHex(rollup.pairing.gap) }}>{rollup.pairing.gap}-point</span> gap on the same dimension.
              </div>
              <p className="mt-2 text-sm text-slate-500">
                The biggest learnable gap across teams — an invitation to pair, never a directive. People decide what to pick up.
              </p>
            </Card>
          )}
        </div>
      )}

      {/* Per-team rollups */}
      <div className="mt-8">
        <SectionHeader
          title="Teams"
          description="Each team's Adoption × Rigor, AI-commit knowledge, dimension shape, and movement since the last scan — across the repos it owns."
        />
        <div className="mt-3 grid gap-4">
          {rollup.teams.map((t) => (
            <TeamCard key={t.slug} team={t} />
          ))}
        </div>
      </div>

      <p className="mt-6 max-w-3xl rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-base text-slate-400">
        <span className="text-slate-300">How to read this:</span> a repo is attributed to every team named in its CODEOWNERS, so a
        team&apos;s numbers reflect the repos it&apos;s responsible for. These are inputs to explore where AI capability could spread —
        a strong team&apos;s approach is a pattern others can borrow, and a soft dimension is where a pairing could help. The aim is
        to map the fleet to how the org actually works, not to rank teams.
      </p>
      <p className="mt-4 font-mono text-sm text-slate-600">
        Team attribution is parsed from CODEOWNERS at scan time ({rollup.attributedRepos} attributed ·{" "}
        {rollup.unownedRepos} unowned). Movers compare each repo&apos;s two most recent scans. GitHub Teams (GraphQL) attribution is
        still on the roadmap.
      </p>
    </div>
  );
}
