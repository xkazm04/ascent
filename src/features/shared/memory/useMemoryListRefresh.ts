"use client";

// The filtered list read behind useMemoryLibrary, split out for the 200-LOC src/features cap: one
// refresh(), the debounced re-query when a filter changes, and the list-read error. The hook keeps the
// rows; this one only asks for them and says when the ask failed.

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { fetchMemoryList, type MemoryListFilters } from "@/features/shared/memory/memoryLibraryApi";
import type { MemoryRow } from "@/lib/db";

export function useMemoryListRefresh({
  slug,
  filters,
  setMemories,
  setNamespaces,
  setLoading,
}: {
  slug: string;
  filters: MemoryListFilters;
  setMemories: Dispatch<SetStateAction<MemoryRow[]>>;
  setNamespaces: Dispatch<SetStateAction<string[]>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
}) {
  // Kept apart from the write/archive `error` so neither one hides or clears the other.
  const [listError, setListError] = useState<string | null>(null);
  const didMount = useRef(false);

  /** One list read. `signal` belongs to the filter state that asked for it: once superseded, the
   *  request is aborted and neither its rows nor its loading flag may land. A failed read empties the
   *  list and sets `listError`, so old rows are never left standing under the new filter. */
  async function refresh(signal?: AbortSignal) {
    setLoading(true);
    try {
      const body = await fetchMemoryList(slug, filters, signal);
      if (signal?.aborted) return;
      setMemories(body.memories ?? []);
      setNamespaces(body.namespaces ?? []);
      setListError(null);
    } catch (e) {
      if (signal?.aborted || (e as Error).name === "AbortError") return;
      setMemories([]);
      setListError(e instanceof Error && e.message ? e.message : "Couldn't load the list. Try again.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  // Re-query the server when a filter changes (debounced so typing doesn't spam). Skips the first run
  // so the server-rendered `initial` isn't immediately refetched. The debounce covers the TIMER; the
  // AbortController covers the request it started, so a slower superseded read cannot win the setState.
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => void refresh(ac.signal), 250);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.namespace, filters.kind, filters.source, filters.sort]);

  return { refresh, listError };
}
