"use client";

// VARIANT 3 — INSTRUMENT / COCKPIT.
//
// Metaphor: the flight deck of your own working week. The session-shape DIALS lead (Meters against the
// org's median as a threshold marker), moves read as ADJUSTMENTS with an expected effect on those
// dials, and the privacy ledger is a literal switch panel — because in a cockpit the state of every
// switch is readable at a glance, which is exactly the property a privacy surface needs.
//
// Org mode is fleet gauges with the FLOOR printed on the instrument face.

import { Dateline, Kicker } from "@/components/ui";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { CareFixtureChip } from "./CareBits";
import { CareProfileCard } from "./CareProfileCard";
import { CareSessionShape } from "./CareSessionShape";
import { CareMovesBoard } from "./CareMovesBoard";
import { CareRepoGaps } from "./CareRepoGaps";
import { CareJournal } from "./CareJournal";
import { CarePrivacyLedger, CareSetupStrip } from "./CarePrivacyLedger";
import { CareWhyStrip } from "./CareWhyStrip";
import { CareCockpitFleetGauges, CareCockpitReadout } from "./CareCockpitGauges";
import {
  CareOrgAsks,
  CareOrgBands,
  CareOrgFloorNote,
  CareOrgKeptMoves,
  CareOrgOutcomes,
  CareOrgSuppressed,
} from "./CareOrgAggregate";
import { type CareView } from "@/lib/org/care-view";

function Personal({ view }: { view: CareView }) {
  const personal = view.personal!;
  const sharedCount = personal.sharedFields.length;

  return (
    <div className="space-y-8">
      <Dateline
        left="Your instrument · 30-day window · counts only"
        right={
          <span className="flex items-center gap-3">
            {sharedCount} of 6 channels shared
            <CareFixtureChip demo={view.demo} />
          </span>
        }
      />

      <section>
        <Kicker>Readout</Kicker>
        <div className="mt-3">
          <CareCockpitReadout personal={personal} />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Dials"
          description="Each channel you chose to share, with the org's anonymous median as the marker on the track. A channel you did not share has no needle — it is not a zero."
        />
        <CareSessionShape personal={personal} layout="dials" />
      </section>

      <section>
        <SectionHeader
          title="Adjustments"
          description="What the mentor proposes to move those dials, with the evidence behind each and the effect it expects. You hold every switch."
        />
        <CareMovesBoard moves={personal.moves} layout="stack" onlyStates={["trying", "proposed"]} />
      </section>

      <section>
        <SectionHeader
          title="Adjustments already locked in"
          description="Kept and dropped, with the reason recorded so the mentor never asks again. A kept move can be authored into the registry."
        />
        <CareMovesBoard moves={personal.moves} layout="stack" onlyStates={["kept", "dropped"]} />
      </section>

      <section>
        <SectionHeader
          title="Switch panel"
          description="Exactly what leaves your machine, field by field. Three rows can never be switched on — they are not settings."
          right={<CareSetupStrip setup={personal.setup} />}
        />
        <CarePrivacyLedger setup={personal.setup} layout="switch" />
      </section>

      <section>
        <SectionHeader
          title="Cross-repo feed"
          description="The standing of the repos you commit to. This is the input a machine-local mentor has no way to read."
        />
        <CareRepoGaps repos={personal.myRepos} layout="rows" />
      </section>

      <section>
        <SectionHeader title="What the app adds to the skill" description="Counted from this workspace, not asserted." />
        <CareWhyStrip personal={personal} />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <SectionHeader size="sm" title="Flight log" description="Retro lines, persisted across machines." />
          <CareJournal journal={personal.journal} layout="entries" limit={6} />
        </Card>
        <Card>
          <SectionHeader size="sm" title="Pilot" description="Self-stated in the local interview; never inferred." />
          <div className="mt-4">
            <CareProfileCard profile={personal.profile} tone="readout" />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Org({ view }: { view: CareView }) {
  const org = view.org!;
  return (
    <div className="space-y-8">
      <Dateline
        left="Fleet care instrument · aggregates only"
        right={
          <span className="flex items-center gap-3">
            floor {org.floor} · population {org.population}
            <CareFixtureChip demo={view.demo} />
          </span>
        }
      />

      <section>
        <SectionHeader
          title="Gauges"
          description="Every gauge prints its own denominator, and the floor is on the face — an aggregate you cannot audit is not an aggregate."
        />
        <div className="mt-2">
          <CareOrgFloorNote org={org} />
        </div>
        {org.belowFloor ? <CareOrgSuppressed org={org} /> : <CareCockpitFleetGauges org={org} />}
      </section>

      {org.belowFloor ? null : (
        <>
          <section>
            <SectionHeader title="Adjustments that held" description="Most-kept moves, as counts. Promotable ones become registry skills authored by the people who proved them." />
            <CareOrgKeptMoves org={org} layout="rows" />
          </section>

          <section>
            <SectionHeader title="Reported friction" description="Anonymized interview themes — the registry backlog, straight from the flight deck." />
            <CareOrgAsks org={org} />
          </section>

          <section>
            <SectionHeader title="Shape distribution" description="Quartiles across participants. There is no per-person row in this view model." />
            <CareOrgBands org={org} />
          </section>

          <section>
            <SectionHeader title="Effect on the fleet" description="Kept moves against the repository score deltas that followed." />
            <CareOrgOutcomes org={org} />
          </section>
        </>
      )}
    </div>
  );
}

export function CarePanelCockpit({ view }: { view: CareView; slug: string }) {
  return view.mode === "personal" ? <Personal view={view} /> : <Org view={view} />;
}
