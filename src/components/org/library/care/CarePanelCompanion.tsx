"use client";

// VARIANT 1 — COMPANION / JOURNAL.
//
// Metaphor: a private notebook a calm colleague keeps for you. Single editorial column, a Dateline
// masthead in the first person, generous rhythm, no gauges. The moves are a board because a board is
// how you look at your own intentions; the journal is dated entries because that is what a notebook
// is. Copy is invitational throughout ("you chose", "nothing is assigned").
//
// Org mode reads as a SHARED notebook — "what helps here" — not as a dashboard of people.

import { Dateline } from "@/components/ui";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { CareFixtureChip, CarePrivacyNote } from "./CareBits";
import { CareProfileCard } from "./CareProfileCard";
import { CareMovesBoard } from "./CareMovesBoard";
import { CareSessionShape } from "./CareSessionShape";
import { CareRepoGaps } from "./CareRepoGaps";
import { CareJournal } from "./CareJournal";
import { CarePrivacyLedger, CareSetupStrip } from "./CarePrivacyLedger";
import { CareWhyStrip } from "./CareWhyStrip";
import {
  CareOrgAdoptionTiles,
  CareOrgAsks,
  CareOrgBands,
  CareOrgFloorNote,
  CareOrgKeptMoves,
  CareOrgOutcomes,
  CareOrgSuppressed,
} from "./CareOrgAggregate";
import { careKeptSaving, type CareView } from "@/lib/org/care-view";

function Personal({ view }: { view: CareView }) {
  const personal = view.personal!;
  const saving = careKeptSaving(personal.moves);
  const kept = personal.moves.filter((m) => m.state === "kept").length;

  return (
    <div className="space-y-8">
      <Dateline
        left={personal.profile.sharedAt ? "Your notebook · private to this workspace" : "Your notebook · nothing shared yet"}
        right={
          <span className="flex items-center gap-3">
            {kept ? <>{kept} moves kept{saving != null ? ` · ~${(saving / 60).toFixed(1)} h/wk back` : ""}</> : "no moves kept yet"}
            <CareFixtureChip demo={view.demo} />
          </span>
        }
      />

      <Card>
        <CareProfileCard profile={personal.profile} />
      </Card>

      <section>
        <SectionHeader
          title="Why this lives here and not only on your laptop"
          description="Counted from what you shared — not a claim."
        />
        <CareWhyStrip personal={personal} />
      </section>

      <section>
        <SectionHeader
          title="Moves"
          description="Proposed by your local mentor from your own journal. You decide what to try, keep or drop — nothing here is assigned to you."
        />
        <CareMovesBoard moves={personal.moves} layout="columns" />
      </section>

      <section>
        <SectionHeader
          title="How your sessions looked, 30 days"
          description="Only the counts you chose to share. The org band, when shown, is quartiles across everyone who opted in — never a person."
          right={<CarePrivacyNote>Only what you chose to share is here.</CarePrivacyNote>}
        />
        <CareSessionShape personal={personal} layout="ledger" />
      </section>

      <section>
        <SectionHeader
          title="The repos you commit to"
          description="Their open recommendations, so a move can be grounded in more than the one working copy your mentor can read."
        />
        <CareRepoGaps repos={personal.myRepos} layout="cards" />
      </section>

      <section>
        <SectionHeader title="Journal" description="Weekly retros and closed moves, kept across machines." />
        <CareJournal journal={personal.journal} layout="entries" />
      </section>

      <Card>
        <SectionHeader size="sm" title="Setup" description="The mentor runs on your machine. This is what it is allowed to send." />
        <div className="mt-3">
          <CareSetupStrip setup={personal.setup} />
        </div>
        <CarePrivacyLedger setup={personal.setup} layout="list" />
      </Card>
    </div>
  );
}

function Org({ view }: { view: CareView }) {
  const org = view.org!;
  return (
    <div className="space-y-8">
      <Dateline
        left="A shared notebook of what helps · anonymized"
        right={
          <span className="flex items-center gap-3">
            {org.belowFloor ? "suppressed under the floor" : `${org.adoption.sharing} of ${org.population} sharing`}
            <CareFixtureChip demo={view.demo} />
          </span>
        }
      />

      <section>
        <SectionHeader title="Care in this workspace" description="Counts of people who set the mentor up and chose to share an aggregate. Nothing else." />
        <div className="mt-2">
          <CareOrgFloorNote org={org} />
        </div>
        {org.belowFloor ? <CareOrgSuppressed org={org} /> : <CareOrgAdoptionTiles org={org} />}
      </section>

      {org.belowFloor ? null : (
        <>
          <section>
            <SectionHeader
              title="What people kept"
              description="The moves developers here tried and chose to keep. The ones that describe an artifact can be authored into the registry."
            />
            <CareOrgKeptMoves org={org} layout="cards" />
          </section>

          <section>
            <SectionHeader title="What people said wastes their time" description="Interview themes, anonymized and counted — the registry's backlog, written by the people who feel it." />
            <CareOrgAsks org={org} />
          </section>

          <section>
            <SectionHeader title="How sessions look here" description="Quartiles across everyone sharing. A developer comparing themselves sees these bands and no names." />
            <CareOrgBands org={org} />
          </section>

          <section>
            <SectionHeader title="Did it move anything" description="Kept moves against the repository score deltas that followed." />
            <CareOrgOutcomes org={org} />
          </section>
        </>
      )}
    </div>
  );
}

export function CarePanelCompanion({ view }: { view: CareView; slug: string }) {
  return view.mode === "personal" ? <Personal view={view} /> : <Org view={view} />;
}
