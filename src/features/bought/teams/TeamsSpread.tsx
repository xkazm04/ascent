// The standings, as a shape — the first thing the section shows.
//
// It used to open on a sentence: "<leader> leads at 78 and <laggard> trails at 41, a 37-point spread
// across 6 teams." Every number in it is a position on a box plot, and the one thing the sentence
// could not give is the part a director actually needs: whether the fleet is CLUSTERED with two
// outliers or spread evenly across the range. `Distribution` draws that, and generates its own
// sr-only table from the same five numbers the geometry is (§2.2, §2.6).
//
// Server-safe: no hooks, no handlers. `Distribution`/`WhyChip` carry their own client boundary.

import { Distribution, WhyChip } from "@/components/org/viz";
import { Kicker } from "@/components/ui";
import type { TeamRollup } from "@/lib/db";
import type { TeamStandings } from "@/lib/org/teamStandings";
import { teamAnchorId } from "./teamsShared";
import { teamSpread } from "./teamsViz";

/**
 * The two fleet averages on this page are DIFFERENT KINDS OF NUMBER and always were; the section's
 * old lede put them one clause apart without saying so. This is the (D) disclosure of that.
 */
export const TWO_POPULATIONS_HINT =
  "The box plots the spread of TEAM averages. The factor bars below diverge from a different baseline: the fleet mean over distinct live-scored repos, where a repo owned by three teams still votes once. Mock-floor rows are excluded from both.";

export function TeamsSpread({ teams, standings }: { teams: TeamRollup[]; standings: TeamStandings }) {
  const five = teamSpread(teams);
  // Fewer than two teams carrying an average is not a distribution — and `explainTeamStandings`
  // already returns null below two teams, so this is belt-and-braces rather than a live branch.
  if (!five) return null;

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <Kicker tone="muted" as="span">
          Team maturity spread
        </Kicker>
        <WhyChip hint={TWO_POPULATIONS_HINT} label="which population each baseline is over" />
      </div>
      <Distribution
        className="mt-1 max-w-md"
        {...five}
        digits={0}
        label={`Team maturity across ${standings.teamCount} teams`}
      />
      {/* The ends of the whisker, named — the labels of a chart, not a sentence about it. */}
      <div className="mt-1 flex max-w-md justify-between type-mono-sm text-slate-600">
        <a href={`#${teamAnchorId(standings.laggard.slug)}`} className="focus-ring rounded transition hover:text-accent">
          {standings.laggard.slug}
        </a>
        <a href={`#${teamAnchorId(standings.leader.slug)}`} className="focus-ring rounded transition hover:text-accent">
          {standings.leader.slug}
        </a>
      </div>
    </div>
  );
}
