"use client";

// The passports portfolio (P3) as one interactive unit: a cohort chip bar (the headline counts, doubled
// as filters), the automation×production scatter, the top-blockers pareto, and the passport table — all
// driven by ONE cohort filter so a number can always be clicked into the repos behind it. A scatter
// quadrant click and its chip set the same filter; a scatter point click expands + scrolls to that
// repo's table row. Rows arrive fully hydrated from the server page (cached passports) — no fetches.

import { useMemo, useState } from "react";
import { PassportScatter, type ScatterPoint } from "@/components/org/PassportScatter";
import { PassportTable, type PassportRow } from "@/components/org/PassportTable";
import { PassportBlockerPareto } from "@/components/org/PassportBlockerPareto";
import { COHORT_META, COHORT_ORDER, cohortOf, type PassportCohort } from "@/lib/org/passport-display";

type Filter = PassportCohort | "no-obs" | null;

const NO_OBS_META = { label: "No observability", color: "#f97316" };

export function PassportPortfolio({ rows, repoTotal }: { rows: PassportRow[]; repoTotal: number }) {
  const [filter, setFilter] = useState<Filter>(null);
  const [focus, setFocus] = useState<{ fullName: string } | null>(null);

  const matches = (r: PassportRow, f: Filter) =>
    f === null ? true : f === "no-obs" ? r.observability === "none" : cohortOf(r.autoScore, r.prodScore) === f;

  const counts = useMemo(() => {
    const c: Record<Exclude<Filter, null>, number> = { ready: 0, gap: 0, hostile: 0, early: 0, "no-obs": 0 };
    for (const r of rows) {
      c[cohortOf(r.autoScore, r.prodScore)] += 1;
      if (r.observability === "none") c["no-obs"] += 1;
    }
    return c;
  }, [rows]);

  const visible = useMemo(() => rows.filter((r) => matches(r, filter)), [rows, filter]);

  const points: ScatterPoint[] = rows.map((r) => ({
    name: r.name,
    x: r.autoScore,
    y: r.prodScore,
    band: r.band,
    faded: !matches(r, filter),
  }));

  // A chip or scatter quadrant toggles its cohort; re-selecting the active one clears the filter.
  const toggle = (f: Exclude<Filter, null>) => setFilter((cur) => (cur === f ? null : f));

  const chip = (f: Exclude<Filter, null>, label: string, color: string, blurb?: string) => {
    const on = filter === f;
    return (
      <button
        key={f}
        type="button"
        onClick={() => toggle(f)}
        aria-pressed={on}
        title={blurb}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-sm transition ${
          on ? "bg-accent font-semibold text-[#04070e]" : "text-slate-400 hover:text-white"
        }`}
      >
        <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: on ? "#04070e" : color }} />
        {label}
        <span className={on ? "text-[#04070e]/70" : "text-slate-600"}>{counts[f]}</span>
      </button>
    );
  };

  const scopeLabel = filter === null ? "all passports" : filter === "no-obs" ? NO_OBS_META.label : COHORT_META[filter].label;

  const onPoint = (name: string) => {
    const row = rows.find((r) => r.name === name);
    if (row) setFocus({ fullName: row.fullName });
  };

  return (
    <div className="space-y-6">
      {/* Cohort chips — the headline counts, each one a filter (was a grid of static tiles) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/40 p-0.5">
          <button
            type="button"
            onClick={() => setFilter(null)}
            aria-pressed={filter === null}
            className={`rounded-md px-2.5 py-1 font-mono text-sm transition ${
              filter === null ? "bg-accent font-semibold text-[#04070e]" : "text-slate-400 hover:text-white"
            }`}
          >
            All <span className={filter === null ? "text-[#04070e]/70" : "text-slate-600"}>{rows.length}</span>
          </button>
          {COHORT_ORDER.map((id) => chip(id, COHORT_META[id].label, COHORT_META[id].color, COHORT_META[id].blurb))}
          {chip("no-obs", NO_OBS_META.label, NO_OBS_META.color, "zero error tracking / logs / metrics / tracing")}
        </div>
        <span className="font-mono text-sm text-slate-500">
          {rows.length} of {repoTotal} repos have passports
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-divider bg-surface/40 p-4">
            <div className="font-mono text-sm uppercase tracking-widest text-slate-500">Automation × Production</div>
            <PassportScatter points={points} active={filter} onCohort={toggle} onPoint={onPoint} />
          </div>
          <PassportBlockerPareto rows={visible} scopeLabel={scopeLabel} />
        </div>
        {visible.length === 0 ? (
          <p className="self-start rounded-2xl border border-divider bg-surface/40 p-6 text-sm text-slate-500">
            No repos in the {scopeLabel} cohort for the current scope — clear the filter or widen the segment / stack.
          </p>
        ) : (
          <PassportTable rows={visible} focus={focus} />
        )}
      </div>
    </div>
  );
}
