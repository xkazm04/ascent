// Props both briefing compositions share. Shaped once in the tab entry.
import type { ExecBriefing } from "@/lib/org/briefing";
import type { ResolvedWindow } from "@/lib/window";
import type { resolveStackScope } from "@/lib/org/scope";
import type { ImpactLedger } from "@/lib/db/org-impact";
import type { TransitionProgramRow } from "@/lib/db/org-program";
import type { OrgBranding } from "@/lib/db/branding";

type Stack = Awaited<ReturnType<typeof resolveStackScope>>;

export type ExecutiveView = {
  slug: string;
  period: ResolvedWindow;
  segmentId: string | null;
  techGroups: Stack["techGroups"];
  activeStack: Stack["activeStack"];
  briefing: ExecBriefing;
  md: string;
  impact: ImpactLedger | null;
  program: TransitionProgramRow | null;
  canShare: boolean;
  branding: OrgBranding | null;
  canBrand: boolean;
};
