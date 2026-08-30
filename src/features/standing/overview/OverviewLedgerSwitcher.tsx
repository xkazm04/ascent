"use client";

// /prototype scaffold — the variant tab strip over the Overview's data region. Throwaway: every
// variant takes the identical serialised OverviewLedgerData, Baseline is selected on load so nothing
// changes for a reader who never touches the strip, and consolidation deletes this file.

import { useState } from "react";
import { OverviewLedgerBaseline, type OverviewLedgerData } from "./OverviewLedger";
import { OverviewFrontPage } from "./OverviewFrontPage";
import { OverviewAltimeter } from "./OverviewAltimeter";

const VARIANTS = [
  { id: "baseline", label: "Baseline", render: (d: OverviewLedgerData) => <OverviewLedgerBaseline {...d} /> },
  { id: "front-page", label: "Front page", render: (d: OverviewLedgerData) => <OverviewFrontPage {...d} /> },
  { id: "altimeter", label: "Altimeter", render: (d: OverviewLedgerData) => <OverviewAltimeter {...d} /> },
] as const;

type VariantId = (typeof VARIANTS)[number]["id"];

export function OverviewLedger(d: OverviewLedgerData) {
  const [variant, setVariant] = useState<VariantId>("baseline");
  const active = VARIANTS.find((v) => v.id === variant) ?? VARIANTS[0];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="type-label tracking-[0.22em] text-slate-500">Prototype</span>
        <div role="tablist" aria-label="Overview variant" className="flex w-fit items-center gap-1 rounded-full border border-divider bg-surface/40 p-1">
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={v.id === variant}
              onClick={() => setVariant(v.id)}
              className={`focus-ring type-label rounded-full px-3 py-1 tracking-[0.18em] transition ${
                v.id === variant ? "bg-accent text-on-accent" : "text-slate-400 hover:text-white"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {/* Keyed so a switch remounts the variant and replays its entrance beat. */}
      <div key={active.id}>{active.render(d)}</div>
    </div>
  );
}
