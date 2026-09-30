"use client";

// Prism AI delivery. Table and map share one model. Fidelity is a word plus its existing title,
// never a status-colored badge. The ribbon stays: a missing stage is a gap, not a zero.
import { useState } from "react";
import { Caption, Frame, SectionHead, Segmented } from "@/components/kit";
import { FlowRibbon, WhyChip } from "@/components/org/viz";
import type { ModelFidelity } from "./aiDeliveryModel";
import type { AiDeliveryModel } from "./aiDeliveryModel";
import { aiDeliveryStages } from "./aiDeliveryFlow";
import { AiRoiLedgerV2 } from "./AiRoiLedger.v2";
import { AiRoiQuadrant } from "./AiRoiQuadrant";

const JOIN_HINT =
  "Billing joined to git-attributed AI output: the adoption and governance figures are measured from each repo's own history, while the money comes from whatever a connected provider reports, and is absent, never estimated, when none does.";

const FIDELITY: Record<ModelFidelity, { label: string; title: string }> = {
  measured: {
    label: "Measured spend",
    title: "Spend attributed to the exact repo by the provider (Claude Code telemetry). Adoption & governance are always real (git).",
  },
  allocated: {
    label: "Allocated spend",
    title: "Provider reports above repo level; Ascent distributes it to repos by AI-attributed PR volume. Adoption & governance are real (git).",
  },
  none: {
    label: "No cost source",
    title: "No provider reports cost, so there is no spend layer: the money columns are empty rather than estimated. Connect one under Govern → Integrations. Adoption & governance are real (git).",
  },
};

export function AiDeliveryModuleV2({ model, slug }: { model: AiDeliveryModel; slug: string }) {
  const [view, setView] = useState<"table" | "map">("table");
  const stages = aiDeliveryStages(model);
  const broken = stages.some((s) => s.value === null);
  const fidelity = FIDELITY[model.fidelity];
  return (
    <Frame id="ai-delivery">
      <SectionHead
        eyebrow="AI delivery"
        title="Spend, output, and review."
        named={<span title={fidelity.title}>{fidelity.label}</span>}
        lede={<WhyChip hint={JOIN_HINT} label="how spend and output are joined" />}
        actions={
          <Segmented
            label="AI delivery view"
            variant="soft"
            value={view}
            onSelect={(key) => setView(key === "map" ? "map" : "table")}
            options={[
              { key: "table", label: "Table" },
              { key: "map", label: "Map" },
            ]}
          />
        }
      />
      <div className="mt-6">
        <FlowRibbon stages={stages} title="AI spend to reviewed output" />
        {broken && <Caption className="mt-2">A missing stage is a gap in the chain, not a zero.</Caption>}
      </div>
      <div className="mt-6">
        {view === "table" ? <AiRoiLedgerV2 model={model} slug={slug} /> : <AiRoiQuadrant model={model} slug={slug} />}
      </div>
    </Frame>
  );
}
