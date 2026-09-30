"use client";

// Prism view switch. Segmented replaces the mono prototype bar. Each view is composed from the kit
// and calls the same hooks as its Altimeter twin.
import { Segmented } from "@/components/kit";
import { AutonomyClearanceV2 } from "./autonomy/AutonomyClearance.v2";
import { CapabilityMatrixV2 } from "./CapabilityMatrix.v2";
import { ControlMatrixPanelV2 } from "./controls/ControlMatrixPanel.v2";
import type { PassportsData } from "./passportData";
import { PassportPortfolioV2 } from "./PassportPortfolio.v2";
import { PASSPORT_VARIANTS, usePassportVariant, type PassportVariantId } from "./passportVariants";

export function PassportsSwitcherV2({ rows, autonomy, capabilities, rollout, slug, decisions }: PassportsData) {
  const [variant, setVariant] = usePassportVariant();
  return (
    <div className="space-y-8">
      <Segmented
        label="Passport view"
        value={variant}
        onSelect={(key) => setVariant(key as PassportVariantId)}
        options={PASSPORT_VARIANTS.map((v) => ({ key: v.id, label: v.label, title: v.note }))}
      />
      {variant === "baseline" && <PassportPortfolioV2 rows={rows} org={slug} decisions={decisions} />}
      {variant === "clearance" && <AutonomyClearanceV2 repos={autonomy} />}
      {variant === "capabilities" && <CapabilityMatrixV2 repos={capabilities} rollout={rollout} />}
      {variant === "controls" && <ControlMatrixPanelV2 org={slug} />}
    </div>
  );
}
