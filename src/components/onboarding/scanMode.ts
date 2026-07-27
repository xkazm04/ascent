// The MONEY GATE: real LLM scan vs. disclosed preview, settled before any import POST.
//
// Relocated out of useOnboardingFlow (the 300-LOC spirit for dense .ts modules) once a SECOND caller
// appeared: a per-repo retry on the done screen must re-check the gate exactly as the batch did — a
// retry that skipped it could charge an org whose balance drained mid-run, or downgrade a paying org
// to a mock. One implementation, two callers, identical decision. Behavior is preserved exactly:
//
//   1. Prefer an already-settled balance for THIS source (tagged with its org, so a late response
//      from a previously-picked org can't mislabel).
//   2. Otherwise AWAIT the in-flight read kicked off at load time — a fast click must not race an
//      unresolved fetch into a fabricated preview (ONB-1).
//   3. "failed" means the balance is UNKNOWN, not zero: retry the read ONCE, because a single network
//      blip must not silently downgrade a paying org's first scan.
//   4. Still unknown ⇒ fail closed to a preview (never charge on an unknown balance), but report the
//      cause so the done screen can explain it honestly instead of saying "install the GitHub App".

import { canRunRealScan } from "@/components/onboarding/canRunReal";
import type { OrgCredit } from "@/components/onboarding/OnboardingFlow.model";

export type CreditRead = OrgCredit | "failed" | null;

export interface ScanModeDecision {
  canRunReal: boolean;
  /** The balance could not be read at all (transient) — distinct from "verifiably no credits". */
  creditUnknown: boolean;
}

export async function resolveScanMode(args: {
  sourceInstallId: string | null;
  sourceLabel: string;
  /** The last balance the UI holds, if any (used only when tagged with the current source). */
  credit: OrgCredit | null;
  /** The in-flight read kicked off when the source loaded; read AND replaced on a retry. */
  creditReady: { current: Promise<CreditRead> | null };
  /** One-shot credit read (the hook's, so the UI's `credit` state stays in sync). */
  fetchCredit: (org: string) => Promise<CreditRead>;
}): Promise<ScanModeDecision> {
  const { sourceInstallId, sourceLabel, credit, creditReady, fetchCredit } = args;

  let settled: CreditRead = credit && credit.org === sourceLabel ? credit : null;
  // The public-handle path has no installation id, so canRunRealScan is false regardless — no wait.
  if (sourceInstallId && !settled && creditReady.current) {
    settled = await creditReady.current;
  }
  if (sourceInstallId && settled === "failed") {
    const retry = fetchCredit(sourceLabel);
    creditReady.current = retry;
    settled = await retry;
  }
  const creditUnknown = settled === "failed";
  const settledCredit = settled === "failed" ? null : settled;
  return {
    canRunReal: canRunRealScan({ sourceInstallId, credit: settledCredit, sourceLabel }),
    creditUnknown,
  };
}
