"use client";

// The redesigned Practices page. Layer 1 is the rollout library (PracticeRolloutStrip: one row per
// practice, grouped by dimension, stages drawn beside the counts — the ledger table merged into it
// 2026-09-16); layer 2 is the
// shared PracticeDetailModal (opened from any row) and NewPracticeModal (opened by "+ New practice").
// The server page fetches; this client wrapper owns the authored-playbook list (so a newly-created
// practice appears without a reload), the selected detail row, and the create-modal flag.
// Altimeter keeps this markup. Prism renders PracticesPageV2, which calls the same hook.

import { SectionHeader, SectionEmpty } from "@/components/org/shared/ui";
import { PracticeRolloutStrip } from "./PracticeRolloutStrip";
import { PracticeDetailModal } from "./PracticeDetailModal";
import { NewPracticeModal } from "./NewPracticeModal";
import { usePracticesLibrary } from "./usePracticesLibrary";
import type { OrgPractice, PlaybookRow, PlaybookAdoption } from "@/lib/db";
import type { PracticeDimOption } from "./practicesData";

export function PracticesView({
  slug,
  initialPlaybooks,
  practices,
  adoption,
  dimOptions,
  repoOptions,
  rolloutSlot,
}: {
  slug: string;
  /** Server-rendered panels that belong with the rollout matrix — the fleet foundation rollout and
   *  the guidance-coherence measure. Rendered directly under it so the shared checklist and its
   *  measurement read as ONE section (2026-09-15: moved here from the Repositories tab). */
  rolloutSlot?: React.ReactNode;
  initialPlaybooks: PlaybookRow[];
  practices: OrgPractice[];
  adoption: Record<string, PlaybookAdoption>;
  dimOptions: PracticeDimOption[];
  repoOptions: string[];
}) {
  const view = usePracticesLibrary({ initialPlaybooks, practices, adoption, dimOptions, repoOptions });
  const { playbooks, rows, rollout, dimLabels, openRow, showCreate, draft } = view;

  return (
    <div className="space-y-5">
      {/* §2.3 — a header is a noun phrase. The old description fused a definition, a provenance
          split, an interaction instruction and the CTA's own name. The definition and the
          authored/mined split are drawn (the rollout matrix, the ledger's Source column); the
          instruction was an affordance problem and is fixed on the row itself; the CTA names
          itself. What survives is the library's scope: how many, and of which kind. */}
      <SectionHeader
        title="Practice Library"
        description={`${rows.length} practices · ${playbooks.length} authored`}
        right={
          <button
            onClick={() => {
              view.setDraft(null);
              view.setShowCreate(true);
            }}
            className="focus-ring rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 type-body-sm font-medium text-white transition hover:bg-accent/20"
          >
            + New practice
          </button>
        }
      />

      {/* G7-20 + the merged ledger: every practice, what it has put in motion and what it moved —
          folded from the rows, so it costs no extra query. A row opens the detail modal. */}
      {rows.length === 0 ? (
        <SectionEmpty>
          No practices yet. Author one with “+ New practice”, or scan this org&apos;s repos to mine some.
        </SectionEmpty>
      ) : (
        <PracticeRolloutStrip rollout={rollout} rows={rows} fleetSize={repoOptions.length} onOpen={view.setOpenRow} />
      )}
      {rolloutSlot}

      <PracticeDetailModal
        row={openRow}
        slug={slug}
        dimLabels={dimLabels}
        repoOptions={repoOptions}
        onClose={() => view.setOpenRow(null)}
        onRemoveAuthored={view.removeAuthored}
        onPromoteMined={view.promoteMined}
      />
      <NewPracticeModal
        open={showCreate}
        slug={slug}
        dimOptions={dimOptions}
        draft={draft}
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
