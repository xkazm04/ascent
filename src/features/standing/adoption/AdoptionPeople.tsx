// Who carries the habit, composition: the champions as ruled rows with a thin share bar (a login is an id,
// so it stays mono), and the team matrix with its hatched not-judged rows.
// pull apart stay apart here: a withheld list leads with the not-judged hatch, a measured zero with the void.
// Server-safe.
import Link from "next/link";
import { BarRow, Frame, HairlineList, SectionHead } from "@/components/kit";
import { orgTabHref } from "@/lib/org/orgTabs";
import { CHAMPION_MIN_POP } from "@/lib/org/champions";
import { Legend, MatrixGrid, StateSwatch, WhyChip } from "@/components/shared/viz";
import type { AdoptionOverview } from "@/lib/org/adoption";
import { CHAMPION_HINT, CODEOWNERS_HINT } from "./adoptionHints";
import { TEAM_AXES, TEAM_SHOW_LIMIT, teamMatrixRows, teamMatrixStates, unjudgedTeamCount } from "./adoptionTeamMatrix";

const LINK = "focus-ring type-caption text-slate-300 transition hover:text-white";

function Absence({ state, children }: { state: "not-judged" | "missing"; children: React.ReactNode }) {
  return (
    <div className="mt-4 flex items-start gap-2">
      <StateSwatch state={state} className="mt-1" />
      <p className="type-body-sm text-slate-300">{children}</p>
    </div>
  );
}

export function Champions({ champions, totalContributors, slug }: { champions: AdoptionOverview["champions"]; totalContributors: number; slug: string }) {
  const withheld = totalContributors < CHAMPION_MIN_POP;
  return (
    <Frame aria-label="AI champions">
      <SectionHead
        level="named"
        as="h3"
        eyebrow="Champions"
        title="Who carries"
        named="the habit."
        actions={
          <>
            <WhyChip hint={CHAMPION_HINT} label="what a champion is for" align="end" />
            <Link href={orgTabHref(slug, "contributors")} className={LINK}>
              Contributors →
            </Link>
          </>
        }
      />
      {withheld ? (
        <Absence state="not-judged">
          Withheld: with fewer than {CHAMPION_MIN_POP} contributors, naming a champion identifies one or two people, so this reads as a ranking rather than a
          culture signal.
        </Absence>
      ) : champions.length === 0 ? (
        <Absence state="missing">No AI-attributed contributors yet.</Absence>
      ) : (
        <HairlineList className="mt-4">
          {champions.map((c) => (
            <BarRow
              key={c.login}
              name={c.login}
              value={c.aiShare}
              label={`${c.aiShare}% AI-attributed`}
              title={`${c.login}: ${c.aiShare}% AI-attributed across ${c.commits} commits in ${c.repos} repo${c.repos === 1 ? "" : "s"}`}
              readout={`${c.aiShare}% · ${c.aiCommits}/${c.commits}`}
            />
          ))}
        </HairlineList>
      )}
    </Frame>
  );
}

export function Teams({ teams, pairing, slug }: { teams: AdoptionOverview["teams"]; pairing: AdoptionOverview["teamPairing"]; slug: string }) {
  const rows = teamMatrixRows(teams);
  const unjudged = unjudgedTeamCount(teams);
  return (
    <Frame aria-label="Team adoption">
      <SectionHead
        level="named"
        as="h3"
        eyebrow="Teams"
        title="Where the habit has"
        named="spread."
        actions={
          <>
            <WhyChip hint={CODEOWNERS_HINT} label="team attribution" align="end" />
            <Link href={orgTabHref(slug, "teams")} className={LINK}>
              Teams →
            </Link>
          </>
        }
      />
      {rows.length === 0 ? (
        <Absence state="missing">
          No CODEOWNERS team attribution yet. Add CODEOWNERS files to the fleet&apos;s repos and re-scan so adoption can roll up by team; without it, every repo
          belongs to the fleet and to no team, and the spread between teams cannot be drawn at all.
        </Absence>
      ) : (
        <>
          <MatrixGrid className="mt-5" axes={[...TEAM_AXES]} rows={rows} title="Team adoption" />
          <Legend className="mt-3" states={teamMatrixStates(rows)} />
          {unjudged > 0 && (
            <p className="mt-3 type-caption text-slate-400">
              {unjudged} team{unjudged === 1 ? "" : "s"} carry no contributor attribution: hatched, not scored.
            </p>
          )}
          {teams.length > TEAM_SHOW_LIMIT && (
            <p className="mt-2 type-caption text-slate-400">
              +{teams.length - TEAM_SHOW_LIMIT} more team{teams.length - TEAM_SHOW_LIMIT === 1 ? "" : "s"} on the Teams tab.
            </p>
          )}
          {pairing && (
            <p className="mt-5 border-l-2 border-divider pl-4 type-body-sm text-slate-300">
              <span className="type-caption text-slate-400">Suggested pairing</span>
              <br />
              <span className="text-white">{pairing.leader.name}</span> ({pairing.leader.aiCommitShare}%) could mentor <span className="text-white">{pairing.learner.name}</span> (
              {pairing.learner.aiCommitShare}%), a {pairing.gap}-point gap in working AI patterns to spread team-to-team.
            </p>
          )}
        </>
      )}
    </Frame>
  );
}
