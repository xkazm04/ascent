"use client";

// VARIANT 2 — CLIMB / TRAJECTORY.
//
// Metaphor: the developer's own ascent, told the way the product already tells a repository's. The
// trajectory chart leads (moves kept over time, time returned as the shaded area, the repos you commit
// to as elevation ticks in the right margin); the altimeter reads your habits as altitude inside the
// org's own band; moves are the NEXT HANDHOLDS — only what is still ahead of you (proposed / trying),
// with what you already kept collapsed into the record below.
//
// Org mode is the DISTRIBUTION of climbs: bands, never a line per person.

import { Kicker, SectionHeading } from "@/components/ui";
import { Card, SectionHeader, TILE_LEDGER, Tile } from "@/components/org/shared/ui";
import { CareFixtureChip } from "./CareBits";
import { CareProfileCard } from "./CareProfileCard";
import { CareClimbDistribution, CareClimbTrajectory } from "./CareClimbChart";
import { CareAltimeter } from "./CareAltimeter";
import { CareMovesBoard } from "./CareMovesBoard";
import { CareRepoGaps } from "./CareRepoGaps";
import { CareJournal } from "./CareJournal";
import { CarePrivacyLedger, CareSetupStrip } from "./CarePrivacyLedger";
import { CareWhyStrip } from "./CareWhyStrip";
import {
  CareOrgAdoptionTiles,
  CareOrgAsks,
  CareOrgFloorNote,
  CareOrgKeptMoves,
  CareOrgOutcomes,
  CareOrgSuppressed,
} from "./CareOrgAggregate";
import { careKeptSaving, type CareView } from "@/lib/org/care-view";

function Personal({ view }: { view: CareView }) {
  const personal = view.personal!;
  const kept = personal.moves.filter((m) => m.state === "kept");
  const trying = personal.moves.filter((m) => m.state === "trying").length;
  const saving = careKeptSaving(personal.moves);
  const gaps = personal.myRepos.reduce((a, r) => a + r.openRecommendations.length, 0);

  return (
    <div className="space-y-8">
      <SectionHeading
        size="page"
        kicker="Your climb"
        title={personal.profile.sharedAt ? "Higher than last month, in your own units" : "The climb starts with one kept move"}
        intro="Ascent charts a repository's ascent. This is yours — the same instrument, pointed at the way you work, and only at what you chose to send."
        right={<CareFixtureChip demo={view.demo} />}
      />

      <div className={`${TILE_LEDGER} sm:grid-cols-2 lg:grid-cols-4`}>
        <Tile label="Moves kept" value={kept.length} sub="decisions you closed" />
        <Tile label="Time back / week" value={saving == null ? "—" : `${(saving / 60).toFixed(1)} h`} sub="your own estimate" />
        <Tile label="In trial" value={trying} sub="open trials with a session budget" />
        <Tile label="Gaps within reach" value={gaps} sub={`across ${personal.myRepos.length} repos you commit to`} />
      </div>

      <section>
        <Kicker>Trajectory</Kicker>
        <CareClimbTrajectory personal={personal} />
      </section>

      <section>
        <SectionHeader
          title="Altimeter"
          description="Your habits as altitude inside the org's anonymous band. Not a score, and nobody sees your needle."
        />
        <CareAltimeter personal={personal} />
      </section>

      <section>
        <SectionHeader
          title="Next handholds"
          description="What is still ahead: proposed and in trial. Each carries the evidence from your journal and, where the fleet has any, what the same move did elsewhere."
        />
        <CareMovesBoard moves={personal.moves} layout="stack" onlyStates={["trying", "proposed"]} />
      </section>

      <section>
        <SectionHeader title="Holds you already have" description="Kept moves. A kept move that describes an artifact can be promoted into the registry with you as its author." />
        <CareMovesBoard moves={personal.moves} layout="stack" onlyStates={["kept", "dropped"]} />
      </section>

      <section>
        <SectionHeader title="The face you are climbing" description="The repos you commit to and their open recommendations — the map the local mentor cannot see." />
        <CareRepoGaps repos={personal.myRepos} layout="cards" />
      </section>

      <section>
        <SectionHeader title="Why the app is part of the climb" description="Each line is counted from your own data." />
        <CareWhyStrip personal={personal} />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <SectionHeader size="sm" title="The record" description="Retro lines, kept across machines." />
          <CareJournal journal={personal.journal} layout="spine" limit={6} />
        </Card>
        <Card>
          <SectionHeader size="sm" title="Profile & setup" description="Self-stated. Edited on your machine, remembered here." />
          <div className="mt-4">
            <CareProfileCard profile={personal.profile} />
          </div>
          <div className="mt-5 border-t border-divider pt-4">
            <CareSetupStrip setup={personal.setup} />
          </div>
          <CarePrivacyLedger setup={personal.setup} layout="list" />
        </Card>
      </div>
    </div>
  );
}

function Org({ view }: { view: CareView }) {
  const org = view.org!;
  return (
    <div className="space-y-8">
      <SectionHeading
        size="page"
        kicker="Distribution of climbs"
        title={org.belowFloor ? "Not enough climbers to show a distribution" : "How the workspace is climbing"}
        intro="Every climb here is anonymous and opt-in. The distribution is quartiles; a single climber's line is not drawable on this tab."
        right={<CareFixtureChip demo={view.demo} />}
      />

      <section>
        <div className="mb-2">
          <CareOrgFloorNote org={org} />
        </div>
        {org.belowFloor ? <CareOrgSuppressed org={org} /> : <CareOrgAdoptionTiles org={org} />}
      </section>

      {org.belowFloor ? null : (
        <>
          <section>
            <SectionHeader title="Session shape, as bands" description="Interquartile ranges with the median marked." />
            <CareClimbDistribution org={org} />
          </section>

          <section>
            <SectionHeader title="Holds people kept" description="The moves that stuck across the workspace — candidates to author into the registry." />
            <CareOrgKeptMoves org={org} layout="rows" />
          </section>

          <section>
            <SectionHeader title="What is in the way" description="Interview themes, counted." />
            <CareOrgAsks org={org} />
          </section>

          <section>
            <SectionHeader title="Altitude gained" description="Kept moves against the repository deltas that followed them." />
            <CareOrgOutcomes org={org} />
          </section>
        </>
      )}
    </div>
  );
}

export function CarePanelClimb({ view }: { view: CareView; slug: string }) {
  return view.mode === "personal" ? <Personal view={view} /> : <Org view={view} />;
}
