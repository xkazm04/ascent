// The inputs the Settings tab resolves once (owner gate first, in SettingsTab.tsx) and hands to whichever
// composition the theme picks. Pure types: nothing here reads a request.
import type { OrgLlmConfigPublic } from "@/lib/db";
import type { OrgRetentionView } from "@/lib/db/retention-policy";
import type { LaneRouting } from "@/lib/llm/lane-routes-load";

export interface SettingsData {
  slug: string;
  config: OrgLlmConfigPublic | null;
  retention: OrgRetentionView | null;
  laneRouting: LaneRouting | null;
  plan: string;
  planAllowed: boolean;
  planChangesEnabled: boolean;
  portalEnabled: boolean;
  encryptionConfigured: boolean;
}
