// Props both Passports compositions take. The entry builds `scope` (segment control and CSV export)
// once, so the two themes cannot grow different filters.
import type { ReactNode } from "react";
import type { DecisionMap } from "@/lib/org/decision-map";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";
import type { PassportRow } from "./PassportTable";
import type { RepoAutonomy } from "./autonomy/autonomyModel";
import type { CapabilityMatrixInput } from "./capabilityAgg";

export interface PassportsData {
  slug: string;
  rows: PassportRow[];
  autonomy: RepoAutonomy[];
  capabilities: CapabilityMatrixInput[];
  rollout: FoundationRolloutRow[];
  decisions: DecisionMap;
  /** Segment selector and CSV export, rendered by the server entry. */
  scope: ReactNode;
  /** The onward link to Read, or null while the fleet has nothing scanned. Built by the entry. */
  nextMove: ReactNode;
}
