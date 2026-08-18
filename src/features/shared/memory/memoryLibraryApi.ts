// The /api/org/memory calls behind useMemoryLibrary — the filtered list read and the write — plus the
// empty write-form shape. Split out of useMemoryLibrary.ts for the 200-LOC src/features cap: nothing
// here touches React, so the hook keeps every piece of state and these stay plain awaitable calls.

import type { MemoryFormState } from "@/features/shared/memory/MemoryTypes";
import type { MemoryRow, MemorySort } from "@/lib/db";

export const EMPTY_FORM: MemoryFormState = {
  content: "",
  kind: "semantic",
  namespace: "",
  visibility: "shared",
  source: "",
  confidence: 1,
  tagsText: "",
};

export type MemoryListFilters = {
  sort: MemorySort;
  namespace: string;
  kind: string;
  search: string;
};

/** Read the filtered list. Returns null on a non-OK response so the caller keeps the current list. */
export async function fetchMemoryList(
  slug: string,
  filters: MemoryListFilters,
): Promise<{ memories: MemoryRow[]; namespaces: string[] } | null> {
  const params = new URLSearchParams({ org: slug, sort: filters.sort });
  if (filters.namespace) params.set("namespace", filters.namespace);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.search.trim()) params.set("search", filters.search.trim());
  const res = await fetch(`/api/org/memory?${params.toString()}`);
  if (!res.ok) return null;
  return (await res.json()) as { memories: MemoryRow[]; namespaces: string[] };
}

/** Write one memory. `supersedeId` (when chosen) retires the memory this one corrects, atomically. */
export async function postMemory(
  slug: string,
  form: MemoryFormState,
  supersedeId: string | null,
): Promise<void> {
  const tags = form.tagsText.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
  const res = await fetch("/api/org/memory", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      org: slug,
      content: form.content,
      kind: form.kind,
      namespace: form.namespace || undefined,
      visibility: form.visibility,
      source: form.source || undefined,
      confidence: form.confidence,
      tags,
      supersedeId: supersedeId ?? undefined,
    }),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Failed.");
}
