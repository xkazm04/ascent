"use client";

// PROTOTYPE SCAFFOLD (P1 — Autonomy Passport), consolidated: Clearance won the round; the other two
// variants are deleted. Baseline STAYS the default tab because Clearance still runs on clearly-labeled
// derived/mock gates — it only becomes the render once the real data spine lands. The server tab does
// the fetching and the tier derivation; this client wrapper only holds the selection.

import type { DecisionMap } from "@/lib/org/decision-map";
import { PassportPortfolio } from "./PassportPortfolio";
import type { PassportRow } from "./PassportTable";
import type { RepoAutonomy } from "./autonomy/autonomyModel";
import { AutonomyClearance } from "./autonomy/AutonomyClearance";
import { CapabilityMatrix } from "./CapabilityMatrix";
import type { CapabilityMatrixInput } from "./capabilityAgg";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";
import { ControlMatrixPanel } from "./controls/ControlMatrixPanel";
import { PASSPORT_VARIANTS, usePassportVariant } from "./passportVariants";

export function PassportsSwitcher({
  rows,
  autonomy,
  capabilities,
  rollout,
  org,
  decisions,
}: {
  rows: PassportRow[];
  autonomy: RepoAutonomy[];
  /** Every repo in scope, INCLUDING those with no readout — the matrix lists them as unassessed
   *  rather than dropping them, which is the only way "not looked at" stays visible. */
  capabilities: CapabilityMatrixInput[];
  /** Spec #35 handoff 2 (UAT `PRIYA-L1-05`): the report-back column’s data, read once on the server
   *  and passed through rather than fetched here — the matrix is otherwise a pure render. */
  rollout: FoundationRolloutRow[];
  org: string;
  decisions: DecisionMap;
}) {
  const [variant, setVariant] = usePassportVariant();


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-divider bg-surface/40 px-3 py-2">
        <span className="type-label tracking-[0.22em] text-slate-600">prototype</span>
        <div className="flex flex-wrap gap-1">
          {PASSPORT_VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVariant(v.id)}
              aria-pressed={v.id === variant}
              /* /org redesign: the active variant's `note` used to render as a permanent sentence
                 beside the switcher. A one-line gloss of a control belongs ON the control, where it
                 is reachable on hover/focus and absent at first sight (§2.1 D). */
              title={v.note}
              className={`focus-ring rounded px-2.5 py-1 type-label tracking-[0.18em] transition ${
                v.id === variant ? "bg-accent/15 text-accent" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {variant === "baseline" && <PassportPortfolio rows={rows} org={org} decisions={decisions} />}
      {variant === "clearance" && <AutonomyClearance repos={autonomy} />}
      {variant === "capabilities" && <CapabilityMatrix repos={capabilities} rollout={rollout} />}
      {variant === "controls" && <ControlMatrixPanel org={org} />}
    </div>
  );
}
