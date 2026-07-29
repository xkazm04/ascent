"use client";

// The kind/namespace/confidence/visibility + source/tags input rows of MemoryAuthorForm. Extracted per
// the 200-LOC .tsx cap (docs/ORG-TABS-REFACTOR.md §3): pure relocation, same markup and className
// strings; form state stays in useMemoryLibrary and is passed in as props.

import { CONFIDENCE_BANDS, MEMORY_KIND_HINT, MEMORY_KIND_LABEL, type MemoryKind } from "@/lib/org/memory-kinds";
import type { MemoryFormState } from "@/components/org/library/memory/MemoryTypes";

const fieldClass =
  "rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600";
const selectClass =
  "rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200";

export function MemoryAuthorFormFields({
  kinds,
  namespaces,
  form,
  setForm,
}: {
  kinds: readonly string[];
  namespaces: string[];
  form: MemoryFormState;
  setForm: (patch: Partial<MemoryFormState>) => void;
}) {
  return (
    <>
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
    </>
  );
}
