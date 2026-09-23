import type { OrgRepo } from "@/components/onboarding/types";
import { byProminence } from "@/components/onboarding/byProminence";
import { isCovered } from "@/components/onboarding/repoStanding";
import type { ImportPlan } from "@/components/onboarding/importPlan";

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
  /** Which step the snapshot was taken on. Everything used to rehydrate to "select", including a
   *  snapshot written mid-scan — so a refresh during a scan dropped the user on the repo picker with
   *  no sign that a run was still going server-side (and still spending: the import route's mapPool
   *  is not tied to the request signal). "scanning" re-enters the scan step instead. */
  phase?: Phase;
  /** The import run's server-side handle, from the stream's opening `queued` frame. With it, a
   *  rehydrated "scanning" snapshot RE-ATTACHES (polls GET /api/org/scan/queue) rather than either
   *  abandoning the run or re-running it, which would scan and charge the same repos twice. */
  runId?: string | null;
  /** v2 (first-run-onboarding-wizard#A): the snapshot records WHAT the run is, not only where the
   *  user was. Absent on a v1 snapshot, which still resumes; only the plan-dependent disclosures then
   *  fall back to their defaults. Encode/decode through OnboardingFlow.run.ts, never by hand. */
  version?: 2;
  /** The run's resolved request plan, so a re-attached done screen discloses live vs preview truthfully
   *  and a preview-then-upgrade run still writes its owed upgrade handoff. Null before it resolves. */
  plan?: RunPlan | null;
  /** The select-step consent this run was started with, so a Retry after a reload reproduces the
   *  batch's plan instead of reading module stores the reload reset to their defaults. */
  consent?: RunConsent | null;
}

/** One run's resolved plan: the import request matrix plus the mode facts the done screen discloses. */
export interface RunPlan extends ImportPlan {
  /** The token-less public funnel (real, free, allowance-metered). */
  publicFunnel: boolean;
  /** Why a preview ran when the default explanation would misdiagnose (a failed credit read). */
  previewCause: "credit_unknown" | null;
}

/** The select step's two per-run choices, recorded when the run starts. */
export interface RunConsent {
  previewFirst: boolean;
  watchOptIn: boolean;
}

// Cap the installation selector so a large org (hundreds/thousands of repos) yields a usable
// list rather than an endless wall of buttons — mirrors the public listing's bound. The
// most prominent repos surface first; the rest are added from the dashboard's Repositories tab.
export const MAX_LIST = 50;

export const MAX_SELECT = 10;

// The single "default selection" rule: repos WITHOUT a live score first, then prominence; take the top
// MAX_SELECT and seed the selection from their fullNames. The coverage tier (first-run-onboarding-
// wizard#B) spends the 10 slots on what the org has not measured yet, instead of re-buying the same
// top-starred scores on every "Scan another"; a preview-scored repo is NOT covered (its live scan is
// owed). With no standing on any row (the public listing) every repo is in the same tier, so the
// result is exactly the old prominence top-N. Re-sorting an already-sorted/sliced list is idempotent,
// so every phase entry point can route through this without changing its result.
export function topSelection(list: OrgRepo[]): Set<string> {
  const tier = (r: OrgRepo) => (isCovered(r.standing) ? 1 : 0);
  return new Set(
    [...list]
      .sort((a, b) => tier(a) - tier(b) || byProminence(a, b))
      .slice(0, MAX_SELECT)
      .map((r) => r.fullName),
  );
}
