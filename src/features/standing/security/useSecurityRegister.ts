"use client";

// The Security register's state: ONE hook both compositions (SecurityRiskRegister v1, .v2) call, so the
// sort, the "show all" slice and the D9 drill-in target cannot drift between Altimeter and Prism. The matrix
// above the table and the table are both driven by the SAME `visible` slice.
import { useMemo, useState } from "react";
import type { HeatTarget } from "@/components/org/shared/RepoDimensionModal";
import type { SecurityRegisterRow } from "@/lib/org/security";
import { DEFAULT_DIR, sortRows, VISIBLE_DEFAULT, type RegisterAdvisories, type SortKey } from "./securityRegisterShared";
import type { ThSort } from "./SecurityRiskRegisterParts";

export function useSecurityRegister(rows: SecurityRegisterRow[], advisories: RegisterAdvisories[] | null) {
  const [target, setTarget] = useState<HeatTarget | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("risk");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const advByRepo = useMemo(() => (advisories ? new Map(advisories.map((a) => [a.fullName, a])) : null), [advisories]);
  const sorted = useMemo(() => sortRows(rows, sortKey, dir, advByRepo), [rows, sortKey, dir, advByRepo]);
  const visible = showAll ? sorted : sorted.slice(0, VISIBLE_DEFAULT);

  function toggle(k: SortKey) {
    if (sortKey === k) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setDir(DEFAULT_DIR[k]);
    }
  }
  const sort: ThSort = { key: sortKey, dir, onSort: toggle };

  return { target, setTarget, showAll, toggleShowAll: () => setShowAll((s) => !s), advByRepo, visible, sort };
}
