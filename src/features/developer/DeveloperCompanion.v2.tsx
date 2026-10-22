"use client";

// The Prism (v2) composition of the Developer home: a masthead in the first person (what is kept, what
// it is worth), then ruled Frames instead of a notebook of cards. Same view model and the same share
// hook as v1; PERSONAL BY CONSTRUCTION still holds (no org branch exists here). Sections keep their
// bodies; what changes is the structure around them.
import { Frame, Masthead, SectionHead, type MastheadFigure } from "@/components/kit";
import { WhyChip } from "@/components/org/viz";
import { CareFixtureChip } from "./CareBits";
import { CareProfileCard } from "./CareProfileCard";
import { CareMovesBoard } from "./CareMovesBoard";
import { CareSessionShape } from "./CareSessionShape";
import { CareRepoGaps } from "./CareRepoGaps";
import { CareJournal } from "./CareJournal";
import { CarePrivacyLedger, CareSetupStrip } from "./CarePrivacyLedger";
import { CareWhyStrip } from "./CareWhyStrip";
import { CareShareUpload } from "./CareShareUpload";
import { DeveloperActivityStripV2 } from "./DeveloperActivityStrip.v2";
import { ACTIVITY_HINT } from "./DeveloperCompanion.v1";
import { useCareShare } from "./useCareShare";
import { careKeptSaving, type DeveloperView } from "@/lib/org/developer-view";

function figures(view: DeveloperView, kept: number, saving: number | null): MastheadFigure[] {
  const out: MastheadFigure[] = [{ label: "Moves kept", value: kept, detail: kept ? "your own decisions" : "none yet" }];
  if (saving != null) out.push({ label: "Time back", value: `~${(saving / 60).toFixed(1)} h/wk`, detail: "from the moves you kept" });
  if (view.activity && view.activity.commits > 0) {
    out.push({ label: "AI-attributed share", value: `${view.activity.aiShare}%`, detail: `${view.activity.aiCommits} of ${view.activity.commits} commits` });
  }
  return out;
}

export function DeveloperCompanionV2({ view, slug }: { view: DeveloperView; slug: string }) {
  const saving = careKeptSaving(view.moves);
  const kept = view.moves.filter((m) => m.state === "kept").length;
  const { sharing, closeShare, openShare, setupRef } = useCareShare();

  return (
    <div data-role="developer-v2" className="stagger-children space-y-10">
      <Masthead
        eyebrow={view.login ? `${view.login} · private to you` : "Your notebook · nobody signed in"}
        statement="Your notebook,"
        named="private to you."
        lede="Your own activity, the moves you chose and what the laptop cannot see. Nothing here is shown to the org."
        figures={figures(view, kept, saving)}
        aside={<CareFixtureChip demo={view.demo} />}
        pattern="dots"
      />

      <Frame aria-label="Your activity here">
        <SectionHead
          eyebrow="Activity"
          title="Your activity"
          named="here."
          actions={<WhyChip hint={ACTIVITY_HINT} label="where these numbers come from" align="end" />}
        />
        <div className="mt-5">
          <DeveloperActivityStripV2 view={view} slug={slug} />
        </div>
      </Frame>

      <Frame aria-label="Profile">
        <SectionHead eyebrow="Profile" title="What you said" named="you want." />
        <div className="mt-5">
          <CareProfileCard profile={view.profile} onShare={openShare} />
        </div>
      </Frame>

      <Frame aria-label="What your laptop cannot see">
        <SectionHead eyebrow="Reach" title="What your laptop" named="cannot see." />
        <div className="mt-5">
          <CareWhyStrip personal={view} />
        </div>
      </Frame>

      <Frame aria-label="Moves">
        <SectionHead eyebrow="Moves" title="What you are" named="trying." />
        <div className="mt-5">
          <CareMovesBoard moves={view.moves} />
        </div>
      </Frame>

      <Frame aria-label="Session shape">
        <SectionHead eyebrow="Last 30 days" title="Your session" named="shape." />
        <div className="mt-5">
          <CareSessionShape personal={view} />
        </div>
      </Frame>

      <Frame aria-label="The repos you commit to">
        <SectionHead eyebrow="Repositories" title="The repos you" named="commit to." />
        <div className="mt-5">
          <CareRepoGaps repos={view.myRepos} activityState={view.activityState} />
        </div>
      </Frame>

      <Frame aria-label="Journal">
        <SectionHead eyebrow={`${view.journal.length} entries · newest first`} title="The" named="journal." />
        <div className="mt-5">
          <CareJournal journal={view.journal} />
        </div>
      </Frame>

      <Frame aria-label="Setup">
        <div ref={setupRef}>
          <SectionHead eyebrow="Setup" title="What is connected," named="and what stays here." />
        </div>
        <div className="mt-5">
          <CareSetupStrip setup={view.setup} onShare={openShare} />
        </div>
        {sharing ? <CareShareUpload view={view} onClose={closeShare} /> : null}
        <CarePrivacyLedger setup={view.setup} />
      </Frame>
    </div>
  );
}
