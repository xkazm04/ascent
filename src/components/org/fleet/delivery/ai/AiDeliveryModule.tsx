"use client";

// "AI delivery intelligence" — the delivery tab's AI ROI & governance section. Two complementary
// views over ONE model (aiDeliveryModel): the Table reconciles spend against AI output per repo
// (metadata-rich at a glance), the Map surfaces the diagnostic that hides between the columns (where
// the money goes vs. what it produces). A segmented toggle switches views; the section owns the
// heading + the "noCostSource spend" honesty badge so neither view repeats them. Client (view state).

import { useState } from "react";
import { SectionHeader } from "@/components/org/shared/ui";
import type { AiDeliveryModel } from "./aiDeliveryModel";
import { FidelityBadge } from "./aiShared";
import { AiRoiLedger } from "./AiRoiLedger";
import { AiRoiQuadrant } from "./AiRoiQuadrant";

const VIEWS = [
  { id: "table", label: "Table" },
  { id: "map", label: "Map" },
] as const;
type ViewId = (typeof VIEWS)[number]["id"];

export function AiDeliveryModule({ model, slug }: { model: AiDeliveryModel; slug: string }) {
  const [view, setView] = useState<ViewId>("table");
  return (
    <div id="ai-delivery" className="scroll-mt-24">
      <SectionHeader
        title="AI delivery intelligence"
        description="Where AI spend goes, what it produces, and whether that work gets reviewed — billing joined to git-attributed AI output."
        right={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <FidelityBadge fidelity={model.fidelity} />
            <div role="tablist" aria-label="AI delivery view" className="inline-flex rounded-md border border-divider bg-surface/40 p-0.5 font-mono text-sm">
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
      <div className="mt-4">{view === "table" ? <AiRoiLedger model={model} slug={slug} /> : <AiRoiQuadrant model={model} slug={slug} />}</div>
    </div>
  );
}
