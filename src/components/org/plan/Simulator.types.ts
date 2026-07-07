import type { FleetProjection } from "@/lib/scoring/orgsim";

export interface DimOption {
  id: string;
  label: string;
  avg: number;
}
export interface RepoOption {
  fullName: string;
  name: string;
}

/** A saved what-if snapshot for the client-side compare scratchpad (SIM-5). */
export interface SavedScenario {
  id: number;
  label: string;
  before: FleetProjection["before"];
  after: FleetProjection["after"];
  promotions: number;
  affected: number;
}
