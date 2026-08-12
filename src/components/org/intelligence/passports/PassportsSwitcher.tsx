"use client";

// PROTOTYPE SCAFFOLD (P1 — Autonomy Passport). Throwaway A/B strip that lets the Passports tab
// render the untouched baseline portfolio or any of the three directional variants of the
// "what can you safely hand an agent in this repo?" reframe. The server tab does the fetching and
// the tier derivation; this client wrapper only holds the selection.
//
// Delete this file (and the `autonomy/` folder's losers) when a direction wins.

import { useState } from "react";
import type { DecisionMap } from "@/lib/org/decision-map";
import { PassportPortfolio } from "./PassportPortfolio";
import type { PassportRow } from "./PassportTable";
import type { RepoAutonomy } from "./autonomy/autonomyModel";
import { AutonomyClearance } from "./autonomy/AutonomyClearance";
import { AutonomyAirlock } from "./autonomy/AutonomyAirlock";
import { AutonomyWrit } from "./autonomy/AutonomyWrit";

type VariantId = "baseline" | "clearance" | "airlock" | "writ";

const VARIANTS: { id: VariantId; label: string; note: string }[] = [
  { id: "baseline", label: "Baseline", note: "current automation × production portfolio" },
  { id: "clearance", label: "A · Clearance", note: "the passport as a security clearance, per repo" },
  { id: "airlock", label: "B · Airlock", note: "tier chambers and the sealed doors between them" },
  { id: "writ", label: "C · Writ", note: "the org's standing delegation order, as a document" },
];

export function PassportsSwitcher({
  rows,
  autonomy,
  org,
  decisions,
}: {
  rows: PassportRow[];
  autonomy: RepoAutonomy[];
  org: string;
  decisions: DecisionMap;
}) {
  const [variant, setVariant] = useState<VariantId>("baseline");
  const active = VARIANTS.find((v) => v.id === variant)!;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-divider bg-surface/40 px-3 py-2">
        <span className="font-mono text-xs uppercase tracking-[0.22em] text-slate-600">prototype</span>
        <div className="flex flex-wrap gap-1">
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVariant(v.id)}
              aria-pressed={v.id === variant}
              className={`focus-ring rounded px-2.5 py-1 font-mono text-xs uppercase tracking-[0.18em] transition ${
                v.id === variant ? "bg-accent/15 text-accent" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="text-sm text-slate-500">{active.note}</span>
      </div>

      {variant === "baseline" && <PassportPortfolio rows={rows} org={org} decisions={decisions} />}
      {variant === "clearance" && <AutonomyClearance repos={autonomy} />}
      {variant === "airlock" && <AutonomyAirlock repos={autonomy} />}
      {variant === "writ" && <AutonomyWrit repos={autonomy} org={org} />}
    </div>
  );
}
