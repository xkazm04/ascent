"use client";

// Column state shared by both matrix variants: which columns are EXPANDED (the latest by default —
// derived, not synced, so a new run arriving expands itself without an effect), and the ref that
// scrolls the latest column into view when it changes.

import { useCallback, useEffect, useRef, useState } from "react";

export function useOutcomeColumns(latestId: string | null) {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const isExpanded = useCallback((id: string) => overrides.get(id) ?? id === latestId, [overrides, latestId]);
  const toggle = useCallback(
    (id: string) => setOverrides((prev) => new Map(prev).set(id, !(prev.get(id) ?? id === latestId))),
    [latestId],
  );
  const latestRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // jsdom has no scrollIntoView; the optional call keeps the dom tests honest about that.
    latestRef.current?.scrollIntoView?.({ inline: "end", block: "nearest" });
  }, [latestId]);
  return { isExpanded, toggle, latestRef };
}
