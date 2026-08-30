"use client";

// Prototype tab strip (throwaway) — A/B between the baseline ledger and the round's two variants
// without forking the call site. Baseline is the default so nothing changes on load.

import { useState } from "react";
import { OverviewLedgerBaseline, type OverviewLedgerData } from "./OverviewLedgerBaseline";
import { OverviewNextRung } from "./OverviewNextRung";
import { OverviewCheapestPoints } from "./OverviewCheapestPoints";

const VARIANTS = [
  { id: "baseline", label: "Baseline" },
  { id: "next-rung", label: "Next rung" },
  { id: "cheapest-points", label: "Cheapest points" },
] as const;
type VariantId = (typeof VARIANTS)[number]["id"];

export function OverviewLedgerSwitcher(d: OverviewLedgerData) {
  const [variant, setVariant] = useState<VariantId>("baseline");
  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Prototype variant" className="flex gap-1 rounded-xl border border-divider bg-surface/40 p-1">
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            role="tab"
            type="button"
            aria-selected={variant === v.id}
            onClick={() => setVariant(v.id)}
            className={`focus-ring rounded-lg px-3 py-1.5 type-body-sm transition-colors ${
              variant === v.id ? "bg-surface-strong/60 text-accent" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {variant === "baseline" && <OverviewLedgerBaseline {...d} />}
      {variant === "next-rung" && <OverviewNextRung {...d} />}
      {variant === "cheapest-points" && <OverviewCheapestPoints {...d} />}
    </div>
  );
}
