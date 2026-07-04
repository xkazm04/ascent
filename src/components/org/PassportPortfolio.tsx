"use client";

// The passports portfolio (P3) as one interactive unit: the automation×production scatter (whose
// quadrants ARE the only filter — click to isolate a cohort, click again or hit the ✕ chip to reset
// to all), the top-blockers docket, and the passport table — all driven by that one filter so the
// chart, the fix-list and the rows can never disagree. A scatter point click expands + scrolls to
// that repo's table row. Rows arrive fully hydrated from the server page (cached passports) — no
// fetches.

import { useEffect, useMemo, useRef, useState } from "react";
import { PassportScatter, type ScatterPoint } from "@/components/org/PassportScatter";
import { PassportTable, type PassportRow } from "@/components/org/PassportTable";
import { PassportBlockerPareto } from "@/components/org/PassportBlockerPareto";
import { COHORT_META, cohortOf, type PassportCohort } from "@/lib/org/passport-display";

/** Replays the brand phase-in beat on `dep` change WITHOUT remounting children — a keyed remount
 *  would wipe the table's sort/expansion state, so instead the animation class is removed, a reflow
 *  is forced, and the class re-added. Skips the initial mount (the page already has its entrance)
 *  and degrades to nothing under reduced motion (the utility is gated in globals.css). */
function PhaseReplay({ dep, className, children }: { dep: unknown; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el) return;
    el.classList.remove("animate-phase-in");
    void el.offsetWidth; // flush styles so re-adding the class restarts the animation
    el.classList.add("animate-phase-in");
  }, [dep]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

export function PassportPortfolio({ rows, org }: { rows: PassportRow[]; org: string }) {
  const [filter, setFilter] = useState<PassportCohort | null>(null);
  const [focus, setFocus] = useState<{ fullName: string } | null>(null);

  const matches = (r: PassportRow) => filter === null || cohortOf(r.autoScore, r.prodScore) === filter;
  const visible = useMemo(
    () => rows.filter((r) => filter === null || cohortOf(r.autoScore, r.prodScore) === filter),
    [rows, filter],
  );

  const points: ScatterPoint[] = rows.map((r) => ({
    name: r.name,
    x: r.autoScore,
    y: r.prodScore,
    band: r.band,
    faded: !matches(r),
  }));

  // A quadrant click toggles its cohort; re-clicking the active one (or the ✕ chip) clears it.
  const toggle = (c: PassportCohort) => setFilter((cur) => (cur === c ? null : c));
  const scopeLabel = filter === null ? "all passports" : COHORT_META[filter].label;

  const onPoint = (name: string) => {
    const row = rows.find((r) => r.name === name);
    if (row) setFocus({ fullName: row.fullName });
  };

  return (
    <div className="space-y-6">
      {/* Row 1: scatter (the filter control) + blocker docket; row 2: the table at full width. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-divider bg-surface/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-mono text-sm uppercase tracking-widest text-slate-500">Automation × Production</div>
            {filter && (
              <button
                type="button"
                onClick={() => setFilter(null)}
                title="Reset to all passports"
                className="focus-ring animate-fade-in flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 font-mono text-xs text-slate-300 transition hover:border-accent hover:text-white"
              >
                <span aria-hidden>✕</span> {COHORT_META[filter].label}
              </button>
            )}
          </div>
          <PassportScatter points={points} active={filter} onCohort={toggle} onPoint={onPoint} />
        </div>
        {/* h-full keeps the docket stretching to the scatter's height like it did as a bare grid child */}
        <PhaseReplay dep={filter} className="h-full">
          <PassportBlockerPareto rows={visible} scopeLabel={scopeLabel} org={org} max={8} />
        </PhaseReplay>
      </div>
      <PhaseReplay dep={filter}>
        {visible.length === 0 ? (
          <p className="rounded-2xl border border-divider bg-surface/40 p-6 text-sm text-slate-500">
            No repos in the {scopeLabel} cohort for the current scope — click the highlighted quadrant again (or the ✕ above) to clear it.
          </p>
        ) : (
          <PassportTable rows={visible} focus={focus} />
        )}
      </PhaseReplay>
    </div>
  );
}
