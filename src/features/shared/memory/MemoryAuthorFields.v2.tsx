"use client";

// Kind, namespace, confidence, visibility, source and tags. Ids that already existed stay (`mem-kind`).
// Accessible names and the option values are the Altimeter controls.
import { FormField, Input, Select } from "@/components/kit";
import { CONFIDENCE_BANDS, MEMORY_KIND_HINT, MEMORY_KIND_LABEL, type MemoryKind } from "@/lib/org/memory-kinds";
import type { MemoryFormState } from "./MemoryTypes";

export function MemoryAuthorFieldsV2({
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
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label="Kind" htmlFor="mem-kind" hint={MEMORY_KIND_HINT[form.kind]}>
        <Select
          id="mem-kind"
          value={form.kind}
          onChange={(e) => setForm({ kind: e.target.value as MemoryKind })}
          title={MEMORY_KIND_HINT[form.kind]}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {MEMORY_KIND_LABEL[k as MemoryKind] ?? k}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Namespace" htmlFor="mem-namespace" hint="Optional. A new grouping is typed, not picked.">
        <Input
          id="mem-namespace"
          value={form.namespace}
          onChange={(e) => setForm({ namespace: e.target.value })}
          placeholder="Namespace (optional)"
          aria-label="Namespace"
          list="mem-namespaces"
        />
        <datalist id="mem-namespaces">
          {namespaces.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </FormField>
      <FormField label="Confidence" htmlFor="mem-confidence" hint="How much the org should trust this. It drives ranking and pruning.">
        <Select
          id="mem-confidence"
          value={form.confidence}
          onChange={(e) => setForm({ confidence: Number(e.target.value) })}
          aria-label="Confidence"
          title="How much should the org trust this? Drives ranking and future pruning."
        >
          {CONFIDENCE_BANDS.map((b) => (
            <option key={b.id} value={b.value}>
              {b.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Visibility" htmlFor="mem-visibility" hint="Shared: every member can read it. Private: only you.">
        <Select
          id="mem-visibility"
          value={form.visibility}
          onChange={(e) => setForm({ visibility: e.target.value })}
          aria-label="Visibility"
          title="Shared: every member can read it. Private: only you."
        >
          <option value="shared">Shared</option>
          <option value="private">Private</option>
        </Select>
      </FormField>
      <FormField label="Source" htmlFor="mem-source" className="sm:col-span-2">
        <Input
          id="mem-source"
          value={form.source}
          onChange={(e) => setForm({ source: e.target.value })}
          placeholder="Source / provenance (optional), e.g. RFC-14, incident #92"
          aria-label="Source"
        />
      </FormField>
      <FormField label="Tags" htmlFor="mem-tags" className="sm:col-span-2">
        <Input
          id="mem-tags"
          value={form.tagsText}
          onChange={(e) => setForm({ tagsText: e.target.value })}
          placeholder="Tags, comma-separated (optional)"
          aria-label="Tags"
        />
      </FormField>
    </div>
  );
}
