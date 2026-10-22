"use client";

// View switch. Segmented replaces the mono prototype bar. Each view is composed from the kit
// and calls the passports hooks.
import { Segmented } from "@/components/kit";
import { AutonomyClearance } from "./autonomy/AutonomyClearance";
import { CapabilityMatrixView } from "./CapabilityMatrix";
import { ControlMatrixPanel } from "./controls/ControlMatrixPanel";
import type { PassportsData } from "./passportData";
import { PassportPortfolio } from "./PassportPortfolio";
import { PASSPORT_VARIANTS, usePassportVariant, type PassportVariantId } from "./passportVariants";

export function PassportsSwitcher({ rows, autonomy, capabilities, rollout, slug, decisions }: PassportsData) {
  const [variant, setVariant] = usePassportVariant();
  return (
    <div className="space-y-8">
      <Segmented
        label="Passport view"
        value={variant}
        onSelect={(key) => setVariant(key as PassportVariantId)}
        options={PASSPORT_VARIANTS.map((v) => ({ key: v.id, label: v.label, title: v.note }))}
      />
      {variant === "baseline" && <PassportPortfolio rows={rows} org={slug} decisions={decisions} />}
      {variant === "clearance" && <AutonomyClearance repos={autonomy} />}
      {variant === "capabilities" && <CapabilityMatrixView repos={capabilities} rollout={rollout} />}
      {variant === "controls" && <ControlMatrixPanel org={slug} />}
    </div>
  );
}
