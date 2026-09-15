"use client";

// "AI delivery intelligence" — the delivery tab's AI ROI & governance section. Two complementary
// views over ONE model (aiDeliveryModel): the Table reconciles spend against AI output per repo
// (metadata-rich at a glance), the Map surfaces the diagnostic that hides between the columns (where
// the money goes vs. what it produces). A segmented toggle switches views; the section owns the
// heading + the spend-provenance honesty badge so neither view repeats them. Client (view state).
//
// The header's description — "Where AI spend goes, what it produces, and whether that work gets
// reviewed: billing joined to git-attributed AI output" — was a sentence naming a three-stage flow,
// so it is now the flow (`aiDeliveryStages` → `FlowRibbon`), sitting above both views because it is
// the reading they share. With no cost source the spend stage is a void and the chain breaks; with no
// AI-PR sample the reviewed stage does the same.

import { useState } from "react";
import { SectionHeader } from "@/components/org/shared/ui";
import { FlowRibbon, Legend, WhyChip } from "@/components/org/viz";
import type { AiDeliveryModel } from "./aiDeliveryModel";
import { aiDeliveryStages } from "./aiDeliveryFlow";
import { FidelityBadge } from "./aiShared";
import { AiRoiLedger } from "./AiRoiLedger";
import { AiRoiQuadrant } from "./AiRoiQuadrant";

const VIEWS = [
  { id: "table", label: "Table" },
  { id: "map", label: "Map" },
] as const;
type ViewId = (typeof VIEWS)[number]["id"];

/** (D) Where the money half comes from — the provenance the badge abbreviates. */
const JOIN_HINT =
  "Billing joined to git-attributed AI output: the adoption and governance figures are measured from each repo's own history, while the money comes from whatever a connected provider reports — and is absent, never estimated, when none does.";

export function AiDeliveryModule({ model, slug }: { model: AiDeliveryModel; slug: string }) {
  const [view, setView] = useState<ViewId>("table");
  const stages = aiDeliveryStages(model);
  const broken = stages.some((s) => s.value === null);

  return (
    <div id="ai-delivery" className="scroll-mt-24">
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            AI delivery intelligence
            <WhyChip hint={JOIN_HINT} label="how spend and output are joined" />
          </span>
        }
        right={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <FidelityBadge fidelity={model.fidelity} />
            <div role="tablist" aria-label="AI delivery view" className="inline-flex rounded-md border border-divider bg-surface/40 p-0.5 type-mono-sm">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={view === v.id}
                  onClick={() => setView(v.id)}
                  className={`focus-ring rounded px-3 py-1 transition ${
                    view === v.id ? "bg-accent/15 text-accent" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {/* §2.2 — first sight is the spend → output → reviewed chain, shared by both views below. */}
      <div className="mt-4">
        <FlowRibbon stages={stages} title="AI spend to reviewed output" />
        <Legend className="mt-2" states={broken ? ["measured", "missing"] : ["measured"]} />
      </div>

      <div className="mt-4">{view === "table" ? <AiRoiLedger model={model} slug={slug} /> : <AiRoiQuadrant model={model} slug={slug} />}</div>
    </div>
  );
}
