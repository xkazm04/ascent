import type { OrgRepo } from "@/components/onboarding/types";
import { byProminence } from "@/components/onboarding/byProminence";

/** Credit context for the select step's cost disclosure, tagged with the org it was read for so a
 *  late response from a previously-picked org can never label the current one. */
export interface OrgCredit {
  org: string;
  balance: number;
  unlimited: boolean;
  /** Included free monthly scans still available (the route's allowanceRemaining; null/absent =
   *  unknown/unlimited). The money-gate counts this as real-scan headroom alongside purchased balance. */
  allowanceRemaining?: number | null;
}

export type Phase = "pick" | "select" | "scanning" | "done";

// ONB-2: a refresh, an auth bounce, or accidental navigation used to drop the user back to step one.
// We persist just the inputs needed to rebuild the wizard (not the volatile repo list / scan rows) to
// sessionStorage, and rehydrate on mount by re-fetching the chosen source's repos and re-applying the
// saved selection — landing the user back on the select step where they left off.
export const RESUME_KEY = "ascent:onboarding:v1";
export interface ResumeSnapshot {
  org: string;
  sourceLabel: string;
  sourceInstallId: string | null;
  selected: string[];
}

// Cap the installation selector so a large org (hundreds/thousands of repos) yields a usable
// list rather than an endless wall of buttons — mirrors the public listing's bound. The
// most prominent repos surface first; the connect page offers full search over the rest.
export const MAX_LIST = 50;

export const MAX_SELECT = 10;

// The single "default selection" rule: sort by prominence, take the top MAX_SELECT, seed the selection
// from their fullNames. Re-sorting an already-sorted/sliced list through `byProminence` is idempotent,
// so every phase entry point can route through this without changing its result.
export function topSelection(list: OrgRepo[]): Set<string> {
  return new Set([...list].sort(byProminence).slice(0, MAX_SELECT).map((r) => r.fullName));
}
