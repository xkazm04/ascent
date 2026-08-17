"use client";

// The Cockpit variant's readouts.
//
// `CareCockpitReadout` — the personal instrument header: the four numbers a developer would glance at
// before a session, as mono readouts with their units spelled out.
// `CareCockpitFleetGauges` — org mode's gauges, each printing its own DENOMINATOR and the floor on the
// face. A gauge with a hidden denominator is how a fleet dashboard starts lying; here the floor rule is
// part of the instrument, not a footnote.

import { Meter } from "@/components/org/shared/ui";
import { careKeptSaving, type CareOrgView, type CarePersonalView } from "@/lib/org/care-view";

function Readout({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <div className="bg-ink px-4 py-3">
      <div className="font-mono text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-bold tabular-nums text-white">{value}</span>
        {unit ? <span className="font-mono text-sm uppercase tracking-widest text-slate-500">{unit}</span> : null}
      </div>
      {note ? <div className="text-sm text-slate-500">{note}</div> : null}
    </div>
  );
}

export function CareCockpitReadout({ personal }: { personal: CarePersonalView }) {
  const kept = personal.moves.filter((m) => m.state === "kept").length;
  const trying = personal.moves.filter((m) => m.state === "trying").length;
  const saving = careKeptSaving(personal.moves);
  const pending = personal.moves
    .filter((m) => m.state !== "kept" && m.state !== "dropped" && m.expectedSaving != null)
    .reduce((a, m) => a + (m.expectedSaving ?? 0), 0);

  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-divider bg-divider sm:grid-cols-2 lg:grid-cols-4">
      <Readout label="Adjustments held" value={String(kept)} unit="kept" note="closed by you, not by us" />
      <Readout
        label="Measured effect"
        value={saving == null ? "—" : (saving / 60).toFixed(1)}
        unit={saving == null ? undefined : "h/wk"}
        note="your own estimate on kept moves"
      />
      <Readout label="Under trial" value={String(trying)} unit="open" note="each with a session budget" />
      <Readout
        label="Available effect"
        value={pending ? (pending / 60).toFixed(1) : "—"}
        unit={pending ? "h/wk" : undefined}
        note="if every proposed adjustment held"
      />
    </div>
  );
}

function Gauge({ label, n, of, note }: { label: string; n: number; of: number; note: string }) {
  const pct = of ? (n / of) * 100 : 0;
  return (
    <div className="rounded-xl border border-divider bg-ink p-4">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-slate-400">{label}</span>
        <span className="font-mono text-sm tabular-nums text-white">
          {n}
          <span className="text-slate-500"> / {of}</span>
        </span>
      </div>
      <Meter className="mt-3" value={pct} ariaLabel={`${label}: ${n} of ${of}`} />
      <p className="mt-2 text-sm text-slate-500">{note}</p>
    </div>
  );
}

export function CareCockpitFleetGauges({ org }: { org: CareOrgView }) {
  const keptTotal = org.topKeptMoves.reduce((a, m) => a + m.keptBy, 0);
  return (
    <div className="mt-3">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Gauge label="Mentor set up" n={org.adoption.setUp} of={org.population} note="Developers who installed it locally. Installing does not share anything." />
        <Gauge label="Sharing an aggregate" n={org.adoption.sharing} of={org.population} note="Chose to send counts. Reversible, per field, from their machine." />
        <Gauge
          label="Above the floor"
          n={Math.min(org.adoption.sharing, org.floor)}
          of={org.floor}
          note={`Aggregates unlock at ${org.floor} participants — the same floor Contributors and Adoption use.`}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-divider pt-3">
        <span className="font-mono text-sm uppercase tracking-widest text-slate-500">
          moves kept fleet-wide <span className="tabular-nums text-slate-300">{keptTotal}</span>
        </span>
        <span className="font-mono text-sm uppercase tracking-widest text-slate-500">
          per-person rows <span className="text-slate-300">none — not in the view model</span>
        </span>
      </div>
    </div>
  );
}
