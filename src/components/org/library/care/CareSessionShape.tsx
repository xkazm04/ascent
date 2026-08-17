"use client";

// The session-shape strip: the 30-day counts the developer CHOSE to share, each optionally against an
// anonymous org band (quartiles only — a band can never be resolved back to a person).
//
// Three layouts because the three variants read the same six numbers differently:
//   `ledger` — a TILE_LEDGER row of stats (Companion: quiet, editorial).
//   `bands`  — value plotted inside its p25–p75 band on a rule (Climb: where you sit on the mountain).
//   `dials`  — Meter per field with the band's median as the threshold marker (Cockpit).
// A field the developer did not share renders as an explicit "not shared" cell, never as a zero.

import { Meter, TILE_LEDGER, Tile } from "@/components/org/shared/ui";
import {
  CARE_SHAPE_LABEL,
  CARE_SHAPE_ORDER,
  CARE_SHAPE_PCT,
  careBandVerdict,
  careShapeValue,
  type CareBand,
  type CarePersonalView,
  type CareShapeField,
} from "@/lib/org/care-view";

/** A field's own scale, so a count and a percentage can share one visual rule. */
function scaleMax(field: CareShapeField, value: number | null, band: CareBand | undefined): number {
  if (CARE_SHAPE_PCT.has(field)) return 100;
  const candidates = [value ?? 0, band?.p75 ?? 0, band?.p50 ?? 0];
  return Math.max(1, Math.ceil(Math.max(...candidates) * 1.25));
}

function NotShared({ label }: { label: string }) {
  return (
    <div className="bg-ink px-5 py-3.5">
      <div className="font-mono text-[13px] uppercase leading-snug tracking-[0.12em] text-slate-600">{label}</div>
      <div className="mt-0.5 font-mono text-2xl font-bold tabular-nums text-slate-700">—</div>
      <div className="mt-0.5 text-sm text-slate-600">not shared</div>
    </div>
  );
}

function BandRule({ field, value, band }: { field: CareShapeField; value: number | null; band: CareBand | undefined }) {
  const max = scaleMax(field, value, band);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / max) * 100))}%`;
  return (
    <div className="relative mt-2 h-6" role="img" aria-label={`${CARE_SHAPE_LABEL[field]}: ${careShapeValue(field, value)}`}>
      <div className="absolute inset-x-0 top-3 h-px bg-divider" />
      {band ? (
        <div className="absolute top-2 h-2 rounded-full bg-slate-800" style={{ left: pct(band.p25), width: `calc(${pct(band.p75)} - ${pct(band.p25)})` }} />
      ) : null}
      {band ? <div className="absolute top-1 h-4 w-px bg-slate-500" style={{ left: pct(band.p50) }} /> : null}
      {value != null ? (
        <div
          className="absolute top-1 h-4 w-1 rounded-full bg-accent"
          style={{ left: pct(value) }}
          title={`${CARE_SHAPE_LABEL[field]}: ${careShapeValue(field, value)}`}
        />
      ) : null}
    </div>
  );
}

export function CareSessionShape({
  personal,
  layout = "ledger",
}: {
  personal: CarePersonalView;
  layout?: "ledger" | "bands" | "dials";
}) {
  const shared = new Set(personal.sharedFields);
  const bands = personal.orgBands;

  if (layout === "ledger") {
    return (
      <div className={`${TILE_LEDGER} mt-3 sm:grid-cols-2 lg:grid-cols-3`}>
        {CARE_SHAPE_ORDER.map((field) => {
          const value = personal.shape[field];
          if (!shared.has(field) || value == null) return <NotShared key={field} label={CARE_SHAPE_LABEL[field]} />;
          const verdict = careBandVerdict(field, value, bands?.[field]);
          return <Tile key={field} label={CARE_SHAPE_LABEL[field]} value={careShapeValue(field, value)} sub={verdict ? `org: ${verdict}` : "no org band"} />;
        })}
      </div>
    );
  }

  if (layout === "bands") {
    return (
      <div className="mt-3 space-y-4">
        {CARE_SHAPE_ORDER.map((field) => {
          const value = shared.has(field) ? personal.shape[field] : null;
          const band = bands?.[field];
          const verdict = careBandVerdict(field, value, band);
          return (
            <div key={field}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="font-mono text-xs uppercase tracking-[0.18em] text-slate-400">{CARE_SHAPE_LABEL[field]}</span>
                <span className="font-mono text-sm tabular-nums text-white">
                  {shared.has(field) ? careShapeValue(field, value) : <span className="text-slate-600">not shared</span>}
                </span>
              </div>
              <BandRule field={field} value={value} band={band} />
              <p className="text-sm text-slate-500">
                {band ? (
                  <>
                    org band {careShapeValue(field, band.p25)}–{careShapeValue(field, band.p75)} · median {careShapeValue(field, band.p50)}
                    {verdict ? ` · you are ${verdict}` : ""}
                  </>
                ) : (
                  "no org band — comparison is opt-in"
                )}
              </p>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {CARE_SHAPE_ORDER.map((field) => {
        const value = shared.has(field) ? personal.shape[field] : null;
        const band = bands?.[field];
        const max = scaleMax(field, value, band);
        const verdict = careBandVerdict(field, value, band);
        return (
          <div key={field} className="rounded-xl border border-divider bg-ink p-4">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-slate-400">{CARE_SHAPE_LABEL[field]}</span>
              <span className="font-mono text-xl font-bold tabular-nums text-white">
                {value == null ? <span className="text-slate-700">—</span> : careShapeValue(field, value)}
              </span>
            </div>
            <Meter
              className="mt-3"
              value={value == null ? 0 : (value / max) * 100}
              threshold={band ? (band.p50 / max) * 100 : undefined}
              ariaLabel={`${CARE_SHAPE_LABEL[field]} against the org median`}
            />
            <p className="mt-2 text-sm text-slate-500">
              {value == null ? "not shared" : verdict ? `org median marked · you are ${verdict}` : "no org band"}
            </p>
          </div>
        );
      })}
    </div>
  );
}
