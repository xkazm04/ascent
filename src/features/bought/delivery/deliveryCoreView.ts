// Props both Delivery compositions render. The panel resolves them once.
import type { ReactNode } from "react";
import type { OrgActivity, OrgGovernance, OrgPrSignals } from "@/lib/db";
import type { ResolvedWindow } from "@/lib/window";
import type { AiDeliveryModel } from "./ai/aiDeliveryModel";
import type { AiRoiSpendKind } from "./deliveryLoad";

export interface DeliveryCoreViewProps {
  slug: string;
  period: ResolvedWindow;
  segmentBar: ReactNode;
  segmentId: string | null;
  techGroupId: string | null;
  pr: OrgPrSignals | null;
  gov: OrgGovernance | null;
  activity: OrgActivity | null;
  prFailed: boolean;
  govFailed: boolean;
  activityFailed: boolean;
  spendKind: AiRoiSpendKind;
  aiModel: AiDeliveryModel | null;
  withholdAllocatedRoi: boolean;
  /** Copy for a failed usage query. Never the "no cost source" sentence. */
  aiUnavailable: string;
}
