"use client";

// The Developer route's single render — the COMPANION direction, which won the 2026-08-18 prototype
// round (docs/REGISTRY-AND-CARE-IMPL.md §5, "Companion won"). Climb and Cockpit are deleted.
//
// Metaphor: a private notebook a calm colleague keeps for you. Single editorial column, a Dateline
// masthead in the first person, generous rhythm, no gauges. The moves are a board because a board is
// how you look at your own intentions; the journal is dated entries because that is what a notebook
// is. Copy is invitational throughout ("you chose", "nothing is assigned").
//
// PERSONAL BY CONSTRUCTION: this component renders the SIGNED-IN developer's own view and has no org
// branch at all. The anonymized org aggregate lives in the Contributors tab (§5.2) — the surveillance-y
// direction is not merely hidden here, it is unreachable from this file.

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
import { DeveloperActivityStrip } from "./DeveloperActivityStrip";
import { careKeptSaving, type DeveloperView } from "@/lib/org/developer-view";

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

      {/* The git-side half: what ascent already knows about this login, unfloored because it is
          their own data. Grounded in the org's contributor snapshot — never a claim. */}
      <section>
        <SectionHeader
          title="Your activity here"
          description="Read out of this workspace's contributor snapshot — the same numbers the Contributors tab aggregates, for you alone."
        />
        <DeveloperActivityStrip view={view} slug={slug} />
      </section>

      <Card>
        <CareProfileCard profile={view.profile} />
      </Card>

      <section>
        <SectionHeader
          title="Why this lives here and not only on your laptop"
          description="Counted from what you shared — not a claim."
        />
        <CareWhyStrip personal={view} />
      </section>

      <section>
        <SectionHeader
          title="Moves"
          description="Proposed by your local mentor from your own journal. You decide what to try, keep or drop — nothing here is assigned to you."
        />
        <CareMovesBoard moves={view.moves} layout="columns" />
      </section>

      <section>
        <SectionHeader
          title="How your sessions looked, 30 days"
          description="Only the counts you chose to share. The org band, when shown, is quartiles across everyone who opted in — never a person."
          right={<CarePrivacyNote>Only what you chose to share is here.</CarePrivacyNote>}
        />
        <CareSessionShape personal={view} layout="ledger" />
      </section>

      <section>
        <SectionHeader
          title="The repos you commit to"
          description="Their open recommendations, so a move can be grounded in more than the one working copy your mentor can read."
        />
        <CareRepoGaps repos={view.myRepos} layout="cards" />
      </section>

      <section>
        <SectionHeader title="Journal" description="Weekly retros and closed moves, kept across machines." />
        <CareJournal journal={view.journal} layout="entries" />
      </section>

      <Card>
        <SectionHeader size="sm" title="Setup" description="The mentor runs on your machine. This is what it is allowed to send." />
        <div className="mt-3">
          <CareSetupStrip setup={view.setup} />
        </div>
        <CarePrivacyLedger setup={view.setup} layout="list" />
      </Card>
    </div>
  );
}
