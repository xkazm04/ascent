"use client";

// PROTOTYPE SCAFFOLD (P1 — Autonomy Passport), consolidated: Clearance won the round; the other two
// variants are deleted. Baseline STAYS the default tab because Clearance still runs on clearly-labeled
// derived/mock gates — it only becomes the render once the real data spine lands. The server tab does
// the fetching and the tier derivation; this client wrapper only holds the selection.

import { useState } from "react";
import type { DecisionMap } from "@/lib/org/decision-map";
import { PassportPortfolio } from "./PassportPortfolio";
import type { PassportRow } from "./PassportTable";
import type { RepoAutonomy } from "./autonomy/autonomyModel";
import { AutonomyClearance } from "./autonomy/AutonomyClearance";
import { CapabilityMatrix } from "./CapabilityMatrix";
import type { CapabilityMatrixInput } from "./capabilityAgg";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";
import { ControlMatrixPanel } from "./controls/ControlMatrixPanel";

type VariantId = "baseline" | "clearance" | "capabilities" | "controls";

const VARIANTS: { id: VariantId; label: string; note: string }[] = [
  { id: "baseline", label: "Baseline", note: "current automation × production portfolio" },
  { id: "clearance", label: "Clearance", note: "the passport as a security clearance, per repo" },
  { id: "capabilities", label: "Capabilities", note: "what each repo declares, and what its own doctor proved" },
  // A SIBLING of Capabilities, deliberately not folded into it: Capabilities is what the repo
  // DECLARES (read from its manifest at scan time), Controls is what its own CI JUDGED and reported
  // back. Same subject, two independent sources of evidence — merging them would hide which is which.
  // MC-B10 — "Controls" until 2026-08-31, which collided with the Security tab's D9 check battery
  // AND with the Governance tab's control-observation ledger. Three different catalogues, one word,
  // one dashboard: an appsec lead reading "controls" on any tab could not tell which they had.
  // Each now says what it is made of; this one is the repo's own doctor checks.
  { id: "controls", label: "Doctor checks", note: "per-check doctor findings, reported by each repo's own CI" },
];

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
  const [variant, setVariant] = useState<VariantId>("baseline");
  const active = VARIANTS.find((v) => v.id === variant)!;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-divider bg-surface/40 px-3 py-2">
        <span className="type-label tracking-[0.22em] text-slate-600">prototype</span>
        <div className="flex flex-wrap gap-1">
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVariant(v.id)}
              aria-pressed={v.id === variant}
              className={`focus-ring rounded px-2.5 py-1 type-label tracking-[0.18em] transition ${
                v.id === variant ? "bg-accent/15 text-accent" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="type-body-sm text-slate-500">{active.note}</span>
      </div>

      {variant === "baseline" && <PassportPortfolio rows={rows} org={org} decisions={decisions} />}
      {variant === "clearance" && <AutonomyClearance repos={autonomy} />}
      {variant === "capabilities" && <CapabilityMatrix repos={capabilities} rollout={rollout} />}
      {variant === "controls" && <ControlMatrixPanel org={org} />}
    </div>
  );
}
