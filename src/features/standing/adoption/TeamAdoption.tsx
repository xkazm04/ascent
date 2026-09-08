// TeamAdoption — per-team AI commit share (CODEOWNERS attribution) as a MATRIX, not a meter stack.
//
// The header used to say "where AI habits live, and where they haven't spread yet". The second half
// of that sentence is the absence in the picture, and the meters could not draw it: a team with no
// contributor attribution rendered a red bar reading "0% · 0/0", identical to a team measured at a
// genuine 0%. `adoptionTeamMatrix.ts` splits the two into `measured` and `not-judged`, and MatrixGrid
// hatches the second and prints no numeral on it. Server-safe.

import Link from "next/link";
import { orgTabHref } from "@/lib/org/orgTabs";
import { Card, InlineEmpty, SectionHeader } from "@/components/org/shared/ui";
import { Legend, MatrixGrid, StateSwatch, WhyChip } from "@/components/org/viz";
import type { AdoptionOverview } from "@/lib/org/adoption";
import { CODEOWNERS_HINT } from "./adoptionHints";
import { TEAM_AXES, TEAM_SHOW_LIMIT, teamMatrixRows, teamMatrixStates, unjudgedTeamCount } from "./adoptionTeamMatrix";

export function TeamAdoption({
  teams,
  pairing,
  slug,
}: {
  teams: AdoptionOverview["teams"];
  pairing: AdoptionOverview["teamPairing"];
  slug: string;
}) {
  const rows = teamMatrixRows(teams);
  const unjudged = unjudgedTeamCount(teams);

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Team adoption"
        right={
          <span className="flex shrink-0 items-center gap-2">
            <WhyChip hint={CODEOWNERS_HINT} label="team attribution" align="end" />
            <Link href={orgTabHref(slug, "teams")} className="type-label tracking-widest text-slate-500 transition hover:text-accent">
              Teams →
            </Link>
          </span>
        }
      />
      {rows.length === 0 ? (
        // (O) The argument belongs HERE, where the reader has nothing to look at and a reason to act.
        // It leads with the void mark so the absence is encoded before it is explained.
        <div className="mt-3 flex items-start gap-2">
          <StateSwatch state="missing" className="mt-1" />
          <InlineEmpty>
            No CODEOWNERS team attribution yet. Add CODEOWNERS files to the fleet&apos;s repos and re-scan so adoption can roll up by team —
            without it, every repo belongs to the fleet and to no team, and the spread between teams cannot be drawn at all.
          </InlineEmpty>
        </div>
      ) : (
        <>
          <MatrixGrid className="mt-4" axes={[...TEAM_AXES]} rows={rows} title="Team adoption" />
          <Legend className="mt-3" states={teamMatrixStates(rows)} />
          {unjudged > 0 && (
            <p className="mt-2 type-mono-sm text-slate-600">
              {unjudged} team{unjudged === 1 ? "" : "s"} carry no contributor attribution — hatched, not scored.
            </p>
          )}
          {teams.length > TEAM_SHOW_LIMIT && (
            <p className="mt-2 type-mono-sm text-slate-600">
              +{teams.length - TEAM_SHOW_LIMIT} more team{teams.length - TEAM_SHOW_LIMIT === 1 ? "" : "s"} on the Teams tab.
            </p>
          )}
          {pairing && (
            // Not a caveat and not a description: the one concrete move the numbers imply, phrased as
            // an invitation. It has no visual encoding to move into, so §2.1's escape clause applies.
            <p className="mt-4 border-l-2 border-accent pl-3 type-body-sm text-slate-400">
              <span className="type-label tracking-widest text-accent">Suggested pairing</span>
              <br />
              <span className="text-slate-200">{pairing.leader.name}</span> ({pairing.leader.aiCommitShare}%) could mentor{" "}
              <span className="text-slate-200">{pairing.learner.name}</span> ({pairing.learner.aiCommitShare}%), a {pairing.gap}-point gap in
              working AI patterns to spread team-to-team.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
