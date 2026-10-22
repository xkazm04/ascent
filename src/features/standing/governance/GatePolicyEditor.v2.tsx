"use client";

// Prism editor for the org gate policy. Same hook as the Altimeter editor. Value controls are
// FormFields; the three sub-forms are the Prism rows, not the shared Altimeter markup.
import type { GatePolicy } from "@/lib/scoring/gate";
import { Eyebrow, GhostAction, PrimaryAction } from "@/components/kit";
import { useGatePolicyEditor } from "./useGatePolicyEditor";
import { AiGovernedRateRowV2 } from "./AiGovernedRateRow.v2";
import { DimensionFloorRowsV2 } from "./DimensionFloorRows.v2";
import { GatePolicyFieldsV2 } from "./GatePolicyFields.v2";
import { RequireChecksRowsV2 } from "./RequireChecksRows.v2";
import { usePolicyPreview } from "./usePolicyPreview";
import { PolicyImpactStrip } from "./PolicyImpactStrip";
import { guardSave } from "./policyPreviewModel";

export function GatePolicyEditorV2({ org, initial }: { org: string; initial: GatePolicy | null }) {
  const f = useGatePolicyEditor(org, initial);
  const p = usePolicyPreview(org, f.draft);
  return (
    <div className="mt-8">
      <Eyebrow>Edit policy</Eyebrow>
      <GatePolicyFieldsV2 f={f} />
      <DimensionFloorRowsV2 floors={f.otherFloors} onChange={f.setDimFloor} />
      <AiGovernedRateRowV2 enabled={f.aiGoverned} rate={f.aiGovernedRate} onEnabled={f.setAiGoverned} onRate={f.setAiGovernedRate} />
      <RequireChecksRowsV2 checks={f.requireChecks} onAdd={f.addRequireCheck} onRemove={f.removeRequireCheck} />
      <PolicyImpactStrip preview={p} />
      <div className="mt-4 flex flex-wrap items-center gap-3" aria-busy={f.busy !== null}>
        <PrimaryAction onClick={() => guardSave(p, f.save, (m) => window.confirm(m))} disabled={f.busy !== null}>
          {f.busy === "save" ? "Saving…" : p.saveLabel}
        </PrimaryAction>
        <GhostAction onClick={f.reset} disabled={f.busy !== null}>
          Reset to default
        </GhostAction>
      </div>
      <div role="status" aria-live="polite" className="mt-3">
        <p className="type-body-sm text-slate-200">{f.msg ? (f.msg.kind === "error" ? `Error: ${f.msg.text}` : f.msg.text) : ""}</p>
        <p className="mt-1 type-body-sm text-slate-400">{f.applies ?? ""}</p>
      </div>
    </div>
  );
}
