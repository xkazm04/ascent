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

import { CheckVerdict } from "@/components/org/MemoryPanel.CheckVerdict";
import type { CheckResponse } from "@/components/org/memoryCheck";
import {
  CONFIDENCE_BANDS,
  MEMORY_KIND_HINT,
  MEMORY_KIND_LABEL,
  type MemoryKind,
} from "@/lib/org/memory-kinds";

const fieldClass =
  "rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600";
const selectClass =
  "rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200";

export interface MemoryFormState {
  content: string;
  kind: MemoryKind;
  namespace: string;
  visibility: string;
  source: string;
  confidence: number;
  tagsText: string;
}

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
        placeholder="What should the org remember? e.g. “We chose Supabase GitHub OAuth over the custom flow — the custom one is dormant.”"
        rows={4}
        aria-label="Memory content"
        className={`w-full font-mono ${fieldClass}`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="mem-kind">
          Kind
        </label>
        <select
          id="mem-kind"
          value={form.kind}
          onChange={(e) => setForm({ kind: e.target.value as MemoryKind })}
          className={selectClass}
          title={MEMORY_KIND_HINT[form.kind]}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {MEMORY_KIND_LABEL[k as MemoryKind] ?? k}
            </option>
          ))}
        </select>

        {/* Free-text namespace with the org's existing ones as suggestions — a new grouping is just typed. */}
        <input
          value={form.namespace}
          onChange={(e) => setForm({ namespace: e.target.value })}
          placeholder="Namespace (optional)"
          aria-label="Namespace"
          list="mem-namespaces"
          className={`w-40 font-mono ${fieldClass}`}
        />
        <datalist id="mem-namespaces">
          {namespaces.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        <select
          value={form.confidence}
          onChange={(e) => setForm({ confidence: Number(e.target.value) })}
          aria-label="Confidence"
          className={selectClass}
          title="How much should the org trust this? Drives ranking and future pruning."
        >
          {CONFIDENCE_BANDS.map((b) => (
            <option key={b.id} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>

        <select
          value={form.visibility}
          onChange={(e) => setForm({ visibility: e.target.value })}
          aria-label="Visibility"
          className={selectClass}
          title="Shared: every member can read it. Private: only you."
        >
          <option value="shared">Shared</option>
          <option value="private">Private</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={form.source}
          onChange={(e) => setForm({ source: e.target.value })}
          placeholder="Source / provenance (optional) — e.g. RFC-14, incident #92"
          aria-label="Source"
          className={`min-w-[12rem] flex-1 ${fieldClass}`}
        />
        <input
          value={form.tagsText}
          onChange={(e) => setForm({ tagsText: e.target.value })}
          placeholder="Tags, comma-separated (optional)"
          aria-label="Tags"
          className={`min-w-[10rem] flex-1 ${fieldClass}`}
        />
      </div>

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
