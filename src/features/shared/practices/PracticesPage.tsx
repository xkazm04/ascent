"use client";

// Composition. The open practice replaces the page (a level). Otherwise: masthead, house
// pattern, registry, ledger, library, foundation, coherence. One library hook.
import type { ReactNode } from "react";
import { NextMoveLink } from "@/components/shared/dashboard/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import { RegistrySyncStripView } from "./RegistrySyncStrip";
import { NewPracticeModal } from "./NewPracticeModal";
import { HousePatternView } from "./HousePattern";
import { PracticeDetail } from "./PracticeDetail";
import { PracticeDrift } from "./PracticeDrift";
import { PracticeLibrary } from "./PracticeLibrary";
import { PracticesMasthead } from "./PracticesMasthead";
import { RegistryPractices } from "./RegistryPractices";
import { FoundationRolloutPanel } from "./foundation/FoundationRolloutPanel";
import { GuidanceCoherence } from "./foundation/GuidanceCoherence";
import { usePracticesLibrary } from "./usePracticesLibrary";
import type { PracticesPageData } from "./practicesData";

export function PracticesPage({ data, filters }: { data: PracticesPageData; filters: ReactNode }) {
  const view = usePracticesLibrary({
    initialPlaybooks: data.playbooks,
    practices: data.practices,
    adoption: data.adoption,
    dimOptions: data.dimOptions,
    repoOptions: data.repoOptions,
  });

  return (
    <div data-role="practices-v2" className="space-y-10">
      {view.openRow ? (
        <PracticeDetail
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
          <RegistrySyncStripView sync={data.sync} slug={data.slug} artifact="practices" />
          <PracticesMasthead data={data} filters={filters} />
          {data.mined && <HousePatternView mined={data.mined} reposWithShape={data.reposWithShape} />}
          <RegistryPractices org={data.slug} rows={data.shapeRows} registryBase={data.registryBase} repoOptions={data.repoOptions} />
          {data.adoptionLedger && <PracticeDrift slug={data.slug} summary={data.adoptionLedger} />}
          <PracticeLibrary
            rows={view.rows}
            rollout={view.rollout}
            fleetSize={data.repoOptions.length}
            onOpen={view.open}
            onCreate={() => {
              view.setDraft(null);
              view.setShowCreate(true);
            }}
          />
          <FoundationRolloutPanel slug={data.slug} rows={data.foundationRows} />
          {data.coherence && <GuidanceCoherence rows={data.coherence} />}
          <NextMoveLink href={orgTabHref(data.slug, "live")} to="live" />
        </>
      )}
      <NewPracticeModal
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
