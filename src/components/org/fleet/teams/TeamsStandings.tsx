// "Why the standings look this way" — the explanatory section under the Teams × dimensions table.
// The table shows WHERE each team sits; this decomposes WHY the extremes sit there. Two columns
// (leader | laggard), each a factor-attribution chart: one bar per dimension driving the team's
// distance from the fleet mean (green = above, orange = below), sized to a shared scale so the two
// sides are directly comparable — plus the human/trajectory context (AI adoption, momentum,
// champions). Purpose-built, not a card grid. Server-safe (no hooks); all data from the scan rollup
// via explainTeamStandings.

import { Surface, deltaHex, fmtDelta, signedDelta } from "@/components/ui";
import { SectionHeader, postureLabel } from "@/components/org/shared/ui";
import { CHAMPION_MIN_POP } from "@/components/org/shared/champions";
import { teamAnchorId } from "./teamsShared";
import { DIMENSION_SHORT, scoreHex, timeAgo } from "@/lib/ui";
import type { DimensionId } from "@/lib/types";
import type { StandingFactor, TeamStanding, TeamStandings } from "@/lib/org/teamStandings";

function FactorBar({ factor, maxAbsDelta }: { factor: StandingFactor; maxAbsDelta: number }) {
  // Min 6% so a small-but-real delta still reads as a bar rather than a sliver.
  const pct = Math.max(6, Math.round((Math.abs(factor.delta) / maxAbsDelta) * 100));
  const color = deltaHex(factor.delta);
  const short = DIMENSION_SHORT[factor.dimId as DimensionId] ?? factor.label;
  return (
    <div
      className="flex items-center gap-3"
      title={`${factor.label}: this team ${factor.teamAvg} vs fleet ${factor.fleetAvg} (${signedDelta(factor.delta)})`}
    >
      <span className="w-20 shrink-0 truncate text-sm text-slate-300">{short}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
        <div className="animate-meter h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-sm" style={{ color: scoreHex(factor.teamAvg) }}>
        {factor.teamAvg}
      </span>
      <span className="w-9 shrink-0 text-right font-mono text-sm" style={{ color }}>
        {signedDelta(factor.delta)}
      </span>
    </div>
  );
}

function StandingColumn({
  standing,
  maxAbsDelta,
  role,
  fleetAvgOverall,
}: {
  standing: TeamStanding;
  maxAbsDelta: number;
  role: "leader" | "laggard";
  fleetAvgOverall: number;
}) {
  const leads = role === "leader";
  const badgeColor = deltaHex(standing.overallDelta);
  // CHAMPION_MIN_POP is a privacy floor that "must be applied IDENTICALLY everywhere champions are
  // surfaced" (champions.ts) — Contributors, Adoption and TeamsMatrixDetail all gate on it, but this
  // card previously didn't, so a 1-person team's sole AI user was crowned a champion here alone.
  // (ambiguity-ui 2026-07-16 #3)
  const hasChampions =
    standing.contributors >= CHAMPION_MIN_POP && standing.champions.length > 0 && standing.aiCommitShare > 0;
  return (
    <div className="p-5">
      <div className="text-sm font-medium" style={{ color: badgeColor }}>
        {leads ? "▲ Leads the fleet" : "▼ Trails the fleet"}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <a
          href={`#${teamAnchorId(standing.slug)}`}
          title={`${standing.slug} — jump to its row`}
          className="focus-ring rounded font-mono text-lg text-white transition hover:text-accent"
        >
          {standing.slug}
        </a>
        <span className="font-mono text-lg" style={{ color: scoreHex(standing.avgOverall) }}>
          {standing.avgOverall}
        </span>
        <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-xs" style={{ color: badgeColor }}>
          {signedDelta(standing.overallDelta)} vs fleet {fleetAvgOverall}
        </span>
        <span className="font-mono text-xs text-slate-500">{postureLabel(standing.posture)}</span>
      </div>

      <p className="mt-3 text-sm text-slate-500">
        {leads ? "Widest leads over the fleet average, by dimension:" : "Biggest drags below the fleet average, by dimension:"}
      </p>
      <div className="mt-2 space-y-1.5">
        {standing.factors.map((f) => (
          <FactorBar key={f.dimId} factor={f} maxAbsDelta={maxAbsDelta} />
        ))}
      </div>

      {/* Human / trajectory context — separate signals from the maturity-score bars above. */}
      <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-divider pt-3 text-sm">
        <div>
          <dt className="text-slate-500">AI adoption</dt>
          <dd className="mt-0.5 font-mono" style={{ color: scoreHex(standing.aiCommitShare) }}>
            {standing.aiCommitShare}%{" "}
            <span className="text-xs" style={{ color: deltaHex(standing.aiShareDelta) }}>
              {signedDelta(standing.aiShareDelta)}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Momentum</dt>
          <dd className="mt-0.5 font-mono">
            {standing.comparedRepos > 0 ? (
              <span style={{ color: deltaHex(standing.avgDelta) }}>
                {fmtDelta(standing.avgDelta)}{" "}
                <span className="text-xs text-slate-500">
                  ▲{standing.improving} ▼{standing.declining}
                </span>
              </span>
            ) : (
              <span className="text-slate-600">no prior scan</span>
            )}
          </dd>
        </div>
        {hasChampions && (
          <div className="min-w-0">
            <dt className="text-slate-500">AI champions</dt>
            <dd className="mt-0.5 flex flex-wrap gap-1">
              {standing.champions.slice(0, 3).map((c) => (
                <span
                  key={c.login}
                  className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-xs text-accent"
                  title={`${c.aiCommits} AI commits · ${c.aiShare}% of their commits AI-attributed`}
                >
                  {c.login}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function TeamsStandings({ standings, capturedAt }: { standings: TeamStandings; capturedAt?: Date | null }) {
  const { leader, laggard, spread, fleetAvgOverall, maxAbsDelta, teamCount } = standings;
  return (
    <div id="standings" className="mt-10 scroll-mt-24">
      <SectionHeader
        title="Why the standings look this way"
        description={
          <>
            <span className="font-mono text-slate-300">{leader.slug}</span> leads at {leader.avgOverall} and{" "}
            <span className="font-mono text-slate-300">{laggard.slug}</span> trails at {laggard.avgOverall} — a{" "}
            <span className="text-slate-200">{spread}-point spread</span> across {teamCount} teams. Each bar attributes the gap
            to a specific dimension, measured against the fleet average of {fleetAvgOverall}.
          </>
        }
        right={
          <span className="font-mono text-xs text-slate-600">
            {capturedAt ? `captured by the org scan ${timeAgo(capturedAt.toISOString())}` : "live preview · captured on your next org scan"}
          </span>
        }
      />
      <Surface className="mt-3">
        <div className="grid divide-y divide-divider md:grid-cols-2 md:divide-x md:divide-y-0">
          <StandingColumn standing={leader} maxAbsDelta={maxAbsDelta} role="leader" fleetAvgOverall={fleetAvgOverall} />
          <StandingColumn standing={laggard} maxAbsDelta={maxAbsDelta} role="laggard" fleetAvgOverall={fleetAvgOverall} />
        </div>
      </Surface>
      <p className="mt-2 text-sm text-slate-500">
        A decomposition, not a verdict — a low dimension is where a pairing or a borrowed pattern would move the number most.
        {/* Honest caption for the gate above — the old `CHAMPION_MIN_POP > 0 &&` was compile-time
            true (it guarded nothing) and the copy omitted the population floor entirely. */}
        {` Champions shown only for teams with at least ${CHAMPION_MIN_POP} contributors and AI-attributed activity.`}
      </p>
    </div>
  );
}
