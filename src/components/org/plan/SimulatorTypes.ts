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
  /** The repo scope the scenario was simulated against — "3 repos" / "all (12)". Without it, two
   *  identically-labelled cards simulated over different fleet slices compared as if they were the
   *  same experiment, reading scope size as scenario quality (investment 07-16 #4). */
  scope: string;
  /** The immutable legs + concrete repo set the projection covered, captured at save time so a saved
   *  scenario can still be committed as an Initiative after the live form has moved on. Single-leg
   *  only at the button (the same non-atomicity policy trackAsInitiative documents). */
  fixes: FleetProjection["fixes"];
  repos: string[];
  before: FleetProjection["before"];
  after: FleetProjection["after"];
  promotions: number;
  affected: number;
}
