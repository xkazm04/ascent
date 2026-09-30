"use client";

// Sort and expansion for the passport table. A scatter point passes a fresh `focus` object; the
// effect opens that row and scrolls it into view. Both compositions call this hook.
import { useEffect, useMemo, useRef, useState } from "react";
import { compareRows, type SortKey, type ThSort } from "./passportTableSort";
import type { PassportRow } from "./PassportTable";

export function usePassportTable(rows: PassportRow[], focus?: { fullName: string } | null) {
  const [sortKey, setSortKey] = useState<SortKey>("prodScore");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  useEffect(() => {
    if (!focus) return;
    // Respond to an external scatter-point focus by expanding that row and scrolling it into view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded(focus.fullName);
    rowRefs.current[focus.fullName]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);

  const sorted = useMemo(() => [...rows].sort((a, b) => compareRows(a, b, sortKey, dir)), [rows, sortKey, dir]);

  function toggle(key: SortKey) {
    if (key === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDir(key === "name" ? "asc" : "desc");
    }
  }

  const sort: ThSort = { key: sortKey, dir, onSort: toggle };
  return { sorted, sort, expanded, setExpanded, rowRefs };
}
