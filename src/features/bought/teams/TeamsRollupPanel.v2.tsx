// The Prism composition of the Teams rollup: a masthead that states how much of the fleet has a named
// owner (the one number a CODEOWNERS file moves), then the matrix, the standings, the signals and the
// unowned list as ruled Frames. The panel (TeamsRollupPanel) does every read and hands the finished values
// here, so v1 and v2 cannot disagree. Scope bar and CSV link arrive as slots (no org/shared import here).
// Server-safe: TeamsMatrix is the client part.
import type { ComponentProps, ReactNode } from "react";
import { Caption, Frame, Masthead, SectionHead, type MastheadFigure } from "@/components/kit";
import { WhyChip } from "@/components/org/viz";
import type { getOrgTeamRollup } from "@/lib/db";
import { TeamsMatrix } from "./TeamsMatrix";
import { TeamsSignals } from "./TeamsSignals";
import { TeamsStandings } from "./TeamsStandings";
import { TeamsUnowned } from "./TeamsUnowned";
import { ATTRIBUTION_HINT, deltaFootnote } from "./teamsShared";

export interface TeamsRollupV2Props {
  slug: string;
  rollup: NonNullable<Awaited<ReturnType<typeof getOrgTeamRollup>>>;
  standings: ComponentProps<typeof TeamsStandings>["standings"] | null;
  capturedAt: ComponentProps<typeof TeamsStandings>["capturedAt"];
  capturedScopeNote: string | null;
  decisions: ComponentProps<typeof TeamsUnowned>["decisions"];
  decisionsFailed: boolean;
  deltaLabel: string;
  dims: ComponentProps<typeof TeamsMatrix>["dims"];
  filterBar: ReactNode;
  exportLink: ReactNode;
}

export function teamsRollupV2(p: TeamsRollupV2Props) {
  const { slug, rollup: r } = p;
  const total = r.attributedRepos + r.unownedRepos;
  const figures: MastheadFigure[] = [
    { label: "Teams", value: r.teamCount, detail: "From CODEOWNERS" },
    { label: "Attributed repos", value: r.attributedRepos, detail: "Scanned, with a team owner" },
    {
      label: "Unowned repos",
      value: r.unownedRepos,
      tone: r.unownedRepos > 0 ? "watch" : "good",
      detail: r.unownedRepos > 0 ? "No CODEOWNERS team; fix below" : "Every scanned repo has an owner",
    },
    {
      label: "Knowledge leader",
      value: r.knowledgeLeader ? `${r.knowledgeLeader.aiCommitShare}%` : "—",
      detail: r.knowledgeLeader ? r.knowledgeLeader.name : "No AI-attributed activity yet",
    },
  ];
  return (
    <div data-role="teams-v2" className="space-y-10">
      <Masthead
        eyebrow="Bought · teams"
        statement={`${r.attributedRepos} of ${total} repositories`}
        named="have a named owner."
        lede="Figures about responsibility, never a ranking: a repo counts toward every team that owns part of it."
        figures={figures}
        aside={p.filterBar}
        pattern="dots"
      />
      <Frame id="teams-matrix" edge="both" className="scroll-mt-24" aria-label="Teams by dimension">
        <SectionHead
          eyebrow="Matrix"
          title="Every team,"
          named="every dimension."
          lede={`${r.attributedRepos} attributed repos · Δ ${p.deltaLabel}`}
          actions={
            <div className="flex items-center gap-3">
              <WhyChip hint={ATTRIBUTION_HINT} label="how a repo is attributed to a team" />
              {p.exportLink}
            </div>
          }
        />
        <div className="mt-5">
          <TeamsMatrix teams={r.teams} dims={p.dims} leaderSlug={r.knowledgeLeader?.slug ?? null} deltaLabel={p.deltaLabel} />
        </div>
      </Frame>
      {p.standings && (
        <Frame aria-label="Standings">
          <TeamsStandings standings={p.standings} teams={r.teams} capturedAt={p.capturedAt} capturedScopeNote={p.capturedScopeNote} />
        </Frame>
      )}
      <Frame aria-label="Signals">
        <TeamsSignals slug={slug} leader={r.knowledgeLeader} pairings={r.pairings} />
      </Frame>
      <Frame aria-label="Unowned repositories">
        <TeamsUnowned slug={slug} unowned={r.unowned} decisions={p.decisions} />
        {p.decisionsFailed && (
          <Caption className="mt-4">Recorded decisions couldn&apos;t load right now, so the lists above show none. Try refreshing this page.</Caption>
        )}
      </Frame>
      <Caption>Δ compares {deltaFootnote(p.deltaLabel)}.</Caption>
    </div>
  );
}

