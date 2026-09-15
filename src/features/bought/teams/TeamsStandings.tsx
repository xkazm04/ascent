// "Team standings" — the section under the Teams matrix that decomposes WHY the extremes sit where
// they do. The matrix shows where each team is; this shows what is carrying it there.
//
// It opens on a shape now (`TeamsSpread`), not on a paragraph. The old header description narrated
// the picture — who leads, who trails, the point spread, the team count, and which baseline the bars
// diverge from — five facts that are five features of a box plot. What survived the demotion is the
// one thing no shape can carry: that the box and the bars are measured over DIFFERENT populations,
// which now rides a WhyChip on the spread (`TWO_POPULATIONS_HINT`).
//
// Server-safe (no hooks); all data from the scan rollup via explainTeamStandings. The two columns
// live in the co-located TeamsStandingColumn.

import { Surface } from "@/components/ui";
import { SectionHeader } from "@/components/org/shared/ui";
import { WhyChip } from "@/components/org/viz";
import { timeAgo } from "@/lib/ui";
import type { TeamRollup } from "@/lib/db";
import type { TeamStandings as TeamStandingsModel } from "@/lib/org/teamStandings";
import { StandingColumn } from "./TeamsStandingColumn";
import { TeamsSpread } from "./TeamsSpread";

/** The framing the section's footer used to assert permanently, on demand instead (§2.1 D). */
const NOT_A_VERDICT_HINT =
  "A decomposition, not a verdict: a low dimension is where a pairing or a borrowed pattern would move the number most. A repo counts toward every team that owns part of it, so these are figures about responsibility, never a ranking.";

export function TeamsStandings({
  standings,
  teams,
  capturedAt,
  // The captured snapshot is whole-org (persistTeamStandings takes no segment/stack filter), while
  // these standings are computed under whatever filter is active. When the two disagree the page
  // passes this and the stamp says so, rather than dating a filtered decomposition with a fleet-wide
  // capture — provenance for something else is worse than no provenance.
  capturedScopeNote = null,
}: {
  standings: TeamStandingsModel;
  /** The rollup rows behind the spread. Optional so the section still renders without the box. */
  teams?: TeamRollup[];
  capturedAt?: Date | null;
  capturedScopeNote?: string | null;
}) {
  const { leader, laggard, fleetAvgOverall, maxAbsDelta } = standings;
  return (
    <div id="standings" className="mt-10 scroll-mt-24">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            Team standings
            <WhyChip hint={NOT_A_VERDICT_HINT} label="what this decomposition is for" />
          </span>
        }
        description={`overall score · ${standings.teamCount} teams`}
        right={
          <span className="type-caption text-slate-600">
            {capturedAt ? `captured by the org scan ${timeAgo(capturedAt.toISOString())}` : "live preview · captured on your next org scan"}
            {capturedAt && capturedScopeNote ? ` · ${capturedScopeNote}` : ""}
          </span>
        }
      />
      {teams && teams.length > 0 && <TeamsSpread teams={teams} standings={standings} />}
      <Surface className="mt-4">
        <div className="grid divide-y divide-divider md:grid-cols-2 md:divide-x md:divide-y-0">
          <StandingColumn standing={leader} maxAbsDelta={maxAbsDelta} role="leader" fleetAvgOverall={fleetAvgOverall} />
          <StandingColumn standing={laggard} maxAbsDelta={maxAbsDelta} role="laggard" fleetAvgOverall={fleetAvgOverall} />
        </div>
      </Surface>
    </div>
  );
}
