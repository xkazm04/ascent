"use client";

// The redesigned Practices page. Layer 1 is a dense ledger table (one row per practice); layer 2 is the
// shared PracticeDetailModal (opened from any row) and NewPracticeModal (opened by "+ New practice").
// The server page fetches; this client wrapper owns the authored-playbook list (so a newly-created
// practice appears without a reload), the selected detail row, and the create-modal flag.

import { useMemo, useState } from "react";
import { SectionHeader, SectionEmpty } from "@/components/org/shared/ui";
import { buildPracticeRows, summarizeRollout, type PracticeRow } from "./practiceRows";
import { PracticeRolloutStrip } from "./PracticeRolloutStrip";
import { PracticeLedger } from "./PracticeLedger";
import { PracticeDetailModal } from "./PracticeDetailModal";
import { NewPracticeModal } from "./NewPracticeModal";
import { usePracticeHash } from "./usePracticeHash";
import { practiceToPlaybookDraft, type PlaybookDraft } from "./promotePractice";
import type { OrgPractice, PlaybookRow, PlaybookAdoption } from "@/lib/db";

interface DimOption {
  id: string;
  label: string;
}

export function PracticesView({
  slug,
  initialPlaybooks,
  practices,
  adoption,
  dimOptions,
  repoOptions,
}: {
  slug: string;
  initialPlaybooks: PlaybookRow[];
  practices: OrgPractice[];
  adoption: Record<string, PlaybookAdoption>;
  dimOptions: DimOption[];
  repoOptions: string[];
}) {
  const [playbooks, setPlaybooks] = useState<PlaybookRow[]>(initialPlaybooks);
  const [openRow, setOpenRow] = useState<PracticeRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // G7-25: the prefill for the author form when a mined practice is promoted. Null = a blank "+ New
  // practice". Held HERE (not in the modal) because the hand-off crosses two layer-2 dialogs: the
  // detail modal closes and the author form opens in its place.
  const [draft, setDraft] = useState<PlaybookDraft | null>(null);

  const dimLabels = useMemo(() => new Map(dimOptions.map((d) => [d.id, d.label])), [dimOptions]);
  const rows = useMemo(
    () => buildPracticeRows(practices, playbooks, adoption, repoOptions.length),
    [practices, playbooks, adoption, repoOptions.length],
  );

  const rollout = useMemo(() => summarizeRollout(rows), [rows]);

  // `#practice-<id>` deep links (governance / briefing / initiatives / overview) land on the row AND
  // open its apply flow — the destination those surfaces actually promised.
  usePracticeHash(rows, setOpenRow);

  // Optimistic remove for an authored playbook (DELETE is admin-gated); restore on failure so a 403
  // can't leave a data-loss illusion — mirrors PlaybooksPanel.remove.
  function removeAuthored(id: string) {
    const prev = playbooks;
    setPlaybooks((p) => p.filter((x) => x.id !== id));
    setOpenRow(null);
    void fetch(`/api/org/playbooks/${id}`, { method: "DELETE" })
      .then((r) => {
        if (!r.ok) setPlaybooks(prev);
      })
      .catch(() => setPlaybooks(prev));
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Practice Library"
        descriptionClassName="max-w-3xl"
        description="Your org's standards in one place: playbooks you author and practices mined from your strongest repos. Open a row for the exemplar, gaps, and apply actions; add your own with “+ New practice”."
        right={
          <button
            onClick={() => {
              setDraft(null);
              setShowCreate(true);
            }}
            className="focus-ring rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent/20"
          >
            + New practice
          </button>
        }
      />

      {/* G7-20: what the library has actually put in motion, and what it moved — folded from the
          rows below, so it costs no extra query and can never disagree with them. */}
      <PracticeRolloutStrip rollout={rollout} />

      {rows.length === 0 ? (
        <SectionEmpty>
          No practices yet. Author one with “+ New practice”, or scan this org&apos;s repos to mine some.
        </SectionEmpty>
      ) : (
        <PracticeLedger rows={rows} onOpen={setOpenRow} />
      )}

      <PracticeDetailModal
        row={openRow}
        slug={slug}
        dimLabels={dimLabels}
        repoOptions={repoOptions}
        onClose={() => setOpenRow(null)}
        onRemoveAuthored={removeAuthored}
        onPromoteMined={(p: OrgPractice) => {
          setDraft(practiceToPlaybookDraft(p));
          setOpenRow(null);
          setShowCreate(true);
        }}
      />
      <NewPracticeModal
        open={showCreate}
        slug={slug}
        dimOptions={dimOptions}
        draft={draft}
        onClose={() => {
          setShowCreate(false);
          setDraft(null);
        }}
        onCreated={(next) => {
          setPlaybooks(next);
          setDraft(null);
        }}
      />
    </div>
  );
}
