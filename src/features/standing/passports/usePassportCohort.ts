"use client";

// The baseline portfolio's one filter: a quadrant cohort, plus the repo a scatter point asked the
// table to open. Both compositions call this so the chart, the docket and the rows stay one cohort.
import { useMemo, useState } from "react";
import { COHORT_META, cohortOf, type PassportCohort } from "@/lib/org/passport-display";
import type { ScatterPoint } from "./PassportScatter";
import type { PassportRow } from "./PassportTable";

export function usePassportCohort(rows: PassportRow[]) {
  const [filter, setFilter] = useState<PassportCohort | null>(null);
  const [focus, setFocus] = useState<{ fullName: string } | null>(null);

  const visible = useMemo(
    () => rows.filter((r) => filter === null || cohortOf(r.autoScore, r.prodScore) === filter),
    [rows, filter],
  );

  const points: ScatterPoint[] = rows.map((r) => ({
    name: r.name,
    x: r.autoScore,
    y: r.prodScore,
    band: r.band,
    faded: filter !== null && cohortOf(r.autoScore, r.prodScore) !== filter,
    placeholder: r.placeholder,
  }));

  const toggle = (c: PassportCohort) => setFilter((cur) => (cur === c ? null : c));
  const scopeLabel = filter === null ? "all passports" : COHORT_META[filter].label;

  const onPoint = (name: string) => {
    const row = rows.find((r) => r.name === name);
    if (row) setFocus({ fullName: row.fullName });
  };

  return { filter, setFilter, focus, visible, points, toggle, scopeLabel, onPoint };
}
