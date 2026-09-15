"use client";

// The Developer route's single render (docs/REGISTRY-AND-CARE-IMPL.md §5).
//
// Metaphor: a private notebook a calm colleague keeps for you. Single editorial column, a Dateline
// masthead in the first person, generous rhythm. The moves are a board because a board is how you
// look at your own intentions; the journal is dated entries because that is what a notebook is.
//
// PERSONAL BY CONSTRUCTION: this component renders the SIGNED-IN developer's own view and has no org
// branch at all. The anonymized org aggregate lives in the Contributors tab (§5.2) — the surveillance-y
// direction is not merely hidden here, it is unreachable from this file.
//
// SEVEN `SectionHeader description=`s used to live in this file, the highest count of any file in the
// /org redesign, and most of them were privacy or consent language. Six are gone: each one is now
// either a picture (the ledger's void column, the shape strip's voids, the reach matrix) or an
// affordance beside the thing it qualifies. The survivor states a window and an order, nothing else.
// A consent guarantee never moved into a hover — it either became a visible invariant or stayed
// visible as text (the moves board's "nothing here is assigned to you").

import { Dateline } from "@/components/ui";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { WhyChip } from "@/components/org/viz";
import { CareFixtureChip } from "./CareBits";
import { CareProfileCard } from "./CareProfileCard";
import { CareMovesBoard } from "./CareMovesBoard";
import { CareSessionShape } from "./CareSessionShape";
import { CareRepoGaps } from "./CareRepoGaps";
import { CareJournal } from "./CareJournal";
import { CarePrivacyLedger, CareSetupStrip } from "./CarePrivacyLedger";
import { CareWhyStrip } from "./CareWhyStrip";
import { DeveloperActivityStrip } from "./DeveloperActivityStrip";
import { careKeptSaving, type DeveloperView } from "@/lib/org/developer-view";

const ACTIVITY_HINT =
  "Read out of this workspace's contributor snapshot — the same rows the Contributors tab aggregates, " +
  "shown here unfloored because the naming floor exists to stop the org reading a person, not to stop " +
  "a person reading themself.";

export function DeveloperCompanion({ view, slug }: { view: DeveloperView; slug: string }) {
  const saving = careKeptSaving(view.moves);
  const kept = view.moves.filter((m) => m.state === "kept").length;

  return (
    <div className="space-y-8">
      <Dateline
        left={view.login ? `${view.login} · private to you` : "Your notebook · nobody signed in"}
        right={
          <span className="flex items-center gap-3">
            {kept ? <>{kept} moves kept{saving != null ? ` · ~${(saving / 60).toFixed(1)} h/wk back` : ""}</> : "no moves kept yet"}
            <CareFixtureChip demo={view.demo} />
          </span>
        }
      />

      <section>
        <SectionHeader
          title="Your activity here"
          right={<WhyChip hint={ACTIVITY_HINT} label="where these numbers come from" align="end" />}
        />
        <DeveloperActivityStrip view={view} slug={slug} />
      </section>

      <Card>
        <CareProfileCard profile={view.profile} />
      </Card>

      <section>
        <SectionHeader title="What your laptop cannot see" />
        <CareWhyStrip personal={view} />
      </section>

      <section>
        <SectionHeader title="Moves" />
        <CareMovesBoard moves={view.moves} />
      </section>

      <section>
        <SectionHeader title="Your session shape, 30 days" />
        <CareSessionShape personal={view} />
      </section>

      <section>
        <SectionHeader title="The repos you commit to" />
        <CareRepoGaps repos={view.myRepos} />
      </section>

      <section>
        <SectionHeader title="Journal" description={`${view.journal.length} entries · newest first`} />
        <CareJournal journal={view.journal} />
      </section>

      <Card>
        <SectionHeader size="sm" title="Setup" />
        <div className="mt-3">
          <CareSetupStrip setup={view.setup} />
        </div>
        <CarePrivacyLedger setup={view.setup} />
      </Card>
    </div>
  );
}
