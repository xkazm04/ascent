"use client";

// Extracted from MemoryPanel — the write form (members on a Team+ plan) plus the non-author upsell, and
// the two-step write path this module exists for:
//
//   1. "Check for duplicates" runs the write-intelligence pass (design doc §8) against the org's own
//      memories and renders a CheckVerdict.
//   2. "Save" writes, optionally carrying `supersedeId` — which makes the write a CORRECTION that
//      retires the memory it replaces.
//
// The check is OPTIONAL. Save is always enabled with content: a duplicate check is a guardrail, not a
// gate, and a model that is slow, absent, or wrong must never stop someone recording what they learned.
//
// The kind/namespace/confidence/visibility/source/tags input rows live in MemoryAuthorFormFields.tsx,
// and MemoryFormState in MemoryTypes.ts — both extracted to keep this file under the 200-LOC .tsx cap
// (docs/ORG-TABS-REFACTOR.md §3).

import { CheckVerdict } from "@/features/shared/memory/MemoryCheckVerdict";
import { MemoryAuthorFormFields } from "@/features/shared/memory/MemoryAuthorFormFields";
import type { CheckResponse } from "@/features/shared/memory/memoryCheck";
import type { MemoryFormState } from "@/features/shared/memory/MemoryTypes";

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
}) {
  /* Write form (members on a Team+ plan) — or an upsell when the plan doesn't include memory writes. */
  if (!canWrite) {
    return (
      !planAllowed && (
        <p className="mt-5 border-t border-slate-800 pt-4 text-sm text-slate-500">
          Writing to Shared Org Memory is a <span className="text-slate-300">Team-plan</span> feature.
          Members can read, search and recall everything the org already remembers.
        </p>
      )
    );
  }

  const hasContent = form.content.trim().length > 0;

  return (
    <div className="mt-5 space-y-2 border-t border-slate-800 pt-4">
      <textarea
        value={form.content}
        onChange={(e) => setForm({ content: e.target.value })}
        placeholder="What should the org remember? e.g. “We chose Supabase GitHub OAuth over the custom flow; the custom one is dormant.”"
        rows={4}
        aria-label="Memory content"
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200 placeholder:text-slate-600"
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
        {checking ? (
          <button
            onClick={onCancelCheck}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-400 hover:border-orange-400/60 hover:text-orange-300"
            title="Stop the running check"
          >
            Checking… cancel
          </button>
        ) : (
          <button
            onClick={onCheck}
            disabled={!hasContent || busy}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
            title="Ask the configured model whether this duplicates or corrects an existing memory"
          >
            Check for duplicates
          </button>
        )}
        <button
          onClick={onSave}
          disabled={busy || checking || !hasContent}
          className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
        >
          {busy ? "Saving…" : supersedeId ? "Save & supersede" : "Save memory"}
        </button>
      </div>
    </div>
  );
}
