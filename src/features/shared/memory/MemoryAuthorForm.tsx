"use client";

// Extracted from MemoryPanel — the write form (members on a Team+ plan) plus the non-author upsell, and
// the two-step write path this module exists for:
//
//   1. "Check for duplicates" runs the write-intelligence pass (design doc §8) against the org's own
//      memories and renders a CheckVerdict.
//   2. "Save" writes, optionally carrying `supersedeId` — which makes the write a CORRECTION that
//      retires the memory it replaces.
//
// 3. "Correct" on a card loads that row here with it already armed as the supersede target (a
//    "Correcting" banner, a struck excerpt of the target, Cancel and "Save correction"). No check is
//    needed for it; the check stays available and never re-aims the armed target.
//
// The check is OPTIONAL. Save is always enabled with content: a duplicate check is a guardrail, not a
// gate, and a model that is slow, absent, or wrong must never stop someone recording what they learned.
//
// The kind/namespace/confidence/visibility/source/tags input rows live in MemoryAuthorFormFields.tsx,
// and MemoryFormState in MemoryTypes.ts — both extracted to keep this file under the 200-LOC .tsx cap
// (docs/ORG-TABS-REFACTOR.md §3).

import { useEffect, useRef } from "react";
import { StateSwatch, WhyChip } from "@/components/org/viz";
import { CheckVerdict } from "@/features/shared/memory/MemoryCheckVerdict";
import { MemoryAuthorFormFields } from "@/features/shared/memory/MemoryAuthorFormFields";
import type { CheckResponse } from "@/features/shared/memory/memoryCheck";
import type { MemoryFormState } from "@/features/shared/memory/MemoryTypes";
import type { MemoryRow } from "@/lib/db";

export function MemoryAuthorForm({
  canWrite,
  planAllowed,
  kinds,
  namespaces,
  form,
  setForm,
  busy,
  checking,
  verdict,
  supersedeId,
  setSupersedeId,
  onCheck,
  onCancelCheck,
  onDismissVerdict,
  onSave,
  correcting,
  onCancelCorrection,
}: {
  canWrite: boolean;
  planAllowed: boolean;
  kinds: readonly string[];
  namespaces: string[];
  form: MemoryFormState;
  setForm: (patch: Partial<MemoryFormState>) => void;
  busy: boolean;
  checking: boolean;
  verdict: CheckResponse | null;
  supersedeId: string | null;
  setSupersedeId: (id: string | null) => void;
  onCheck: () => void;
  onCancelCheck: () => void;
  onDismissVerdict: () => void;
  onSave: () => void;
  /** The row a card's "Correct" loaded into the form, or null. */
  correcting: MemoryRow | null;
  onCancelCorrection: () => void;
}) {
  // A card's "Correct" happens up in the list; bring the reader to the form it filled.
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const correctingId = correcting?.id ?? null;
  useEffect(() => {
    if (!correctingId) return;
    contentRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    contentRef.current?.focus({ preventScroll: true });
  }, [correctingId]);

  /* Write form (members on a Team+ plan) — or an upsell when the plan doesn't include memory writes. */
  if (!canWrite) {
    return (
      !planAllowed && (
        <p className="mt-5 border-t border-slate-800 pt-4 type-body-sm text-slate-500">
          Writing to Shared Org Memory is a <span className="text-slate-300">Team-plan</span> feature.
          Members can read, search and recall everything the org already remembers.
        </p>
      )
    );
  }

  const hasContent = form.content.trim().length > 0;
  const savingCorrection = Boolean(correcting && supersedeId === correcting.id);

  return (
    <div className="mt-5 space-y-2 border-t border-slate-800 pt-4">
      {correcting && <CorrectionBanner target={correcting} onCancel={onCancelCorrection} disabled={busy} />}
      <textarea
        ref={contentRef}
        value={form.content}
        onChange={(e) => setForm({ content: e.target.value })}
        placeholder="What should the org remember? e.g. “We chose Supabase GitHub OAuth over the custom flow; the custom one is dormant.”"
        rows={4}
        aria-label="Memory content"
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 type-mono-sm text-slate-200 placeholder:text-slate-600"
      />

      <MemoryAuthorFormFields kinds={kinds} namespaces={namespaces} form={form} setForm={setForm} />

      {verdict && (
        <CheckVerdict
          verdict={verdict}
          supersedeId={supersedeId}
          setSupersedeId={setSupersedeId}
          onDismiss={onDismissVerdict}
        />
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        {/* (D) The dedup half of the panel's old header paragraph, moved to where it is actually
            relevant: the moment someone is about to write. */}
        <WhyChip
          align="end"
          label="duplicate check"
          hint="A new write is checked against what is already stored, so a correction can replace the memory it fixes instead of sitting beside it. The check is a guardrail, never a gate — Save is always available."
        />
        {checking ? (
          <button
            onClick={onCancelCheck}
            className="rounded-lg border border-slate-700 px-3 py-1.5 type-body-sm text-slate-400 hover:border-orange-400/60 hover:text-orange-300"
            title="Stop the running check"
          >
            Checking… cancel
          </button>
        ) : (
          <button
            onClick={onCheck}
            disabled={!hasContent || busy}
            className="rounded-lg border border-slate-700 px-3 py-1.5 type-body-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
            title="Ask the configured model whether this duplicates or corrects an existing memory"
          >
            Check for duplicates
          </button>
        )}
        <button
          onClick={onSave}
          disabled={busy || checking || !hasContent}
          className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 type-body-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
        >
          {busy ? "Saving…" : savingCorrection ? "Save correction" : supersedeId ? "Save & supersede" : "Save memory"}
        </button>
      </div>
    </div>
  );
}

/** What the form is correcting: the target wears the `superseded` mark it will carry once saved. */
function CorrectionBanner({ target, onCancel, disabled }: { target: MemoryRow; onCancel: () => void; disabled: boolean }) {
  const excerpt = target.content.length > 140 ? `${target.content.slice(0, 140)}…` : target.content;
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2">
      <div className="min-w-0">
        <p className="type-body-sm font-medium text-slate-200">Correcting</p>
        <p data-state="superseded" className="mt-1 flex items-start gap-1.5">
          <StateSwatch state="superseded" size={11} className="mt-1 shrink-0" />
          <span className="type-caption text-slate-400 line-through decoration-slate-500 opacity-50">{excerpt}</span>
        </p>
      </div>
      <button
        onClick={onCancel}
        disabled={disabled}
        className="shrink-0 rounded-lg border border-slate-700 px-2.5 py-1 type-body-sm text-slate-400 hover:text-white disabled:opacity-50"
      >
        Cancel
      </button>
    </div>
  );
}
