// One side of the standings decomposition — the leader column or the laggard column.
//
// Extracted from TeamsStandings so that file can stay the orchestrator (and stay under the 200-LOC
// cap) once the spread distribution moved in above it. Server-safe: no hooks, no handlers.
//
// Each bar attributes one dimension's distance from the fleet mean; the two columns share a bar
// scale (`maxAbsDelta`) so they are directly comparable, which is the whole reason they sit side by
// side rather than as two cards.

import { deltaHex, fmtDelta, signedDelta } from "@/components/ui";
import { postureLabel } from "@/components/org/shared/ui";
import { CHAMPION_MIN_POP } from "@/components/org/shared/champions";
import { STATE_LABEL, StateSwatch, WhyChip, stateTitle } from "@/components/org/viz";
import { teamAnchorId } from "./teamsShared";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
import type { DimensionId } from "@/lib/types";
import type { StandingFactor, TeamStanding } from "@/lib/org/teamStandings";

/** The privacy floor, as a sentence — demoted out of the section's footer caption (§2.1 D). */
export const CHAMPION_FLOOR_HINT = `Champions are named only for teams with at least ${CHAMPION_MIN_POP} contributors and AI-attributed activity: below that population, "champion" identifies a specific individual.`;

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
      <span className="w-20 shrink-0 truncate type-body-sm text-slate-300">{short}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
        <div className="animate-meter h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-8 shrink-0 text-right type-mono-sm" style={{ color: scoreHex(factor.teamAvg) }}>
        {factor.teamAvg}
      </span>
      <span className="w-9 shrink-0 text-right type-mono-sm" style={{ color }}>
        {signedDelta(factor.delta)}
      </span>
    </div>
  );
}

export function StandingColumn({
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
    standing.contributors >= CHAMPION_MIN_POP &&
    standing.champions.length > 0 &&
    standing.aiCommitShare !== null &&
    standing.aiCommitShare > 0;
  const share = standing.aiCommitShare;
  const shareDelta = standing.aiShareDelta;
  return (
    <div className="p-5">
      <div className="type-body-sm font-medium" style={{ color: badgeColor }}>
        {leads ? "▲ Leads the fleet" : "▼ Trails the fleet"}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <a
          href={`#${teamAnchorId(standing.slug)}`}
          title={`${standing.slug}: jump to its row`}
          className="focus-ring rounded font-mono type-lede text-white transition hover:text-accent"
        >
          {standing.slug}
        </a>
        <span className="font-mono type-lede" style={{ color: scoreHex(standing.avgOverall) }}>
          {standing.avgOverall}
        </span>
        <span className="rounded border border-slate-700 px-1.5 py-0.5 type-caption" style={{ color: badgeColor }}>
          {signedDelta(standing.overallDelta)} vs fleet {fleetAvgOverall}
        </span>
        <span className="type-caption text-slate-500">{postureLabel(standing.posture)}</span>
      </div>

      <p className="mt-3 type-label tracking-[0.22em] text-slate-500">
        {leads ? "Widest leads, by dimension" : "Biggest drags, by dimension"}
      </p>
      <div className="mt-2 space-y-1.5">
        {standing.factors.map((f) => (
          <FactorBar key={f.dimId} factor={f} maxAbsDelta={maxAbsDelta} />
        ))}
      </div>

      {/* Human / trajectory context — separate signals from the maturity-score bars above. */}
      <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-divider pt-3 type-body-sm">
        <div>
          <dt className="text-slate-500">AI adoption</dt>
          {/* NULL is not a zero: a team scanned without commit history has no share to print, so the
              readout becomes the kit's hatched mark and no numeral is rendered at all. */}
          {share === null || shareDelta === null ? (
            <dd className="mt-0.5 flex items-center gap-1.5" title={stateTitle("not-judged", `${standing.slug} · AI commit share`)}>
              <StateSwatch state="not-judged" size={12} />
              <span className="type-note text-slate-600">{STATE_LABEL["not-judged"]}</span>
            </dd>
          ) : (
            <dd className="mt-0.5 font-mono" style={{ color: scoreHex(share) }}>
              {share}%{" "}
              <span className="type-note" style={{ color: deltaHex(shareDelta) }}>
                {signedDelta(shareDelta)}
              </span>
            </dd>
          )}
        </div>
        <div>
          <dt className="text-slate-500">Momentum</dt>
          <dd className="mt-0.5 font-mono">
            {standing.comparedRepos > 0 ? (
              <span style={{ color: deltaHex(standing.avgDelta) }}>
                {fmtDelta(standing.avgDelta)}{" "}
                <span className="type-note text-slate-500">
                  ▲{standing.improving} ▼{standing.declining}
                </span>
              </span>
            ) : (
              // No prior scan is an absence, drawn as the void rather than said in words.
              <span className="inline-flex items-center gap-1.5" title={stateTitle("missing", `${standing.slug} · momentum`)}>
                <StateSwatch state="missing" size={12} />
                <span className="type-note text-slate-600">{STATE_LABEL.missing}</span>
              </span>
            )}
          </dd>
        </div>
        {hasChampions && (
          <div className="min-w-0">
            <dt className="flex items-center gap-1 text-slate-500">
              AI champions
              <WhyChip hint={CHAMPION_FLOOR_HINT} label="champion population floor" />
            </dt>
            <dd className="mt-0.5 flex flex-wrap gap-1">
              {standing.champions.slice(0, 3).map((c) => (
                <span
                  key={c.login}
                  className="rounded border border-slate-700 px-1.5 py-0.5 type-caption text-accent"
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
