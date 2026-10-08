"use client";

// Prism composition. The open practice replaces the page (a level). Otherwise: masthead, house
// pattern, registry, ledger, library, foundation, coherence. One library hook.
import type { ReactNode } from "react";
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import { RegistrySyncStripV2 } from "./RegistrySyncStrip.v2";
import { NewPracticeModalV2 } from "./NewPracticeModal.v2";
import { HousePatternV2 } from "./HousePattern.v2";
import { PracticeDetailV2 } from "./PracticeDetail.v2";
import { PracticeDriftV2 } from "./PracticeDrift.v2";
import { PracticeLibraryV2 } from "./PracticeLibrary.v2";
import { PracticesMastheadV2 } from "./PracticesMasthead.v2";
import { RegistryPracticesV2 } from "./RegistryPractices.v2";
import { FoundationRolloutPanel } from "./foundation/FoundationRolloutPanel";
import { GuidanceCoherenceV2 } from "./foundation/GuidanceCoherence.v2";
import { usePracticesLibrary } from "./usePracticesLibrary";
import type { PracticesPageData } from "./practicesData";

export function PracticesPageV2({ data, filters }: { data: PracticesPageData; filters: ReactNode }) {
  const view = usePracticesLibrary({
    initialPlaybooks: data.playbooks,
    practices: data.practices,
    adoption: data.adoption,
    dimOptions: data.dimOptions,
    repoOptions: data.repoOptions,
    theme: "prism",
  });

  return (
    <div data-role="practices-v2" className="space-y-10">
      {view.openRow ? (
        <PracticeDetailV2
          row={view.openRow}
          rows={view.rows}
          slug={data.slug}
          dimLabels={view.dimLabels}
          repoOptions={data.repoOptions}
          onOpen={view.open}
          onClose={view.close}
          onRemoveAuthored={view.removeAuthored}
          onPromoteMined={view.promoteMined}
        />
      ) : (
        <>
          <RegistrySyncStripV2 sync={data.sync} slug={data.slug} artifact="practices" />
          <PracticesMastheadV2 data={data} filters={filters} />
          {data.mined && <HousePatternV2 mined={data.mined} reposWithShape={data.reposWithShape} />}
          <RegistryPracticesV2 org={data.slug} rows={data.shapeRows} registryBase={data.registryBase} repoOptions={data.repoOptions} />
          {data.adoptionLedger && <PracticeDriftV2 slug={data.slug} summary={data.adoptionLedger} />}
          <PracticeLibraryV2
            rows={view.rows}
            rollout={view.rollout}
            fleetSize={data.repoOptions.length}
            onOpen={view.open}
            onCreate={() => {
              view.setDraft(null);
              view.setShowCreate(true);
            }}
          />
          <FoundationRolloutPanel slug={data.slug} rows={data.foundationRows} theme="prism" />
          {data.coherence && <GuidanceCoherenceV2 rows={data.coherence} />}
          <NextMoveLink href={orgTabHref(data.slug, "live")} to="live" />
        </>
      )}
      <NewPracticeModalV2
        open={view.showCreate}
        slug={data.slug}
        dimOptions={data.dimOptions}
        draft={view.draft}
        onClose={() => {
          view.setShowCreate(false);
          view.setDraft(null);
        }}
        onCreated={(next) => {
          view.setPlaybooks(next);
          view.setDraft(null);
        }}
      />
    </div>
  );
}
