// The MONEY GATE: real LLM scan vs. disclosed preview, settled before any import POST.
//
// G7-17 changed what "no installation" means here. It used to mean "preview" — the public-handle
// funnel, the product's highest-intent first run, always showed deterministic numbers no model
// produced (and those rows land in the public corpus the register ranks). It now means "real, free,
// public-only": the same deal `/report?repo=` has always offered, metered by the monthly public-scan
// allowance server-side rather than by prepaid credits. Everything below this point is the App path.
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

import { canRunRealPublicScan, canRunRealScan } from "@/components/onboarding/canRunReal";
import type { OrgCredit } from "@/components/onboarding/OnboardingFlow.model";

export type CreditRead = OrgCredit | "failed" | null;

export interface ScanModeDecision {
  canRunReal: boolean;
  /** The balance could not be read at all (transient) — distinct from "verifiably no credits". */
  creditUnknown: boolean;
  /** True when this run is the token-less PUBLIC path: real inference, no credits, public repos only.
   *  Distinct from the App path's `canRunReal` because the cost disclosure differs — a public run
   *  spends the free monthly public-scan allowance, never a prepaid credit. */
  publicFunnel: boolean;
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

  // G7-17: the PUBLIC-handle path settles first and settles differently. There is no installation, so
  // there is no balance to read, nothing to wait on, and nothing to fail closed about — the scan is
  // real and free, exactly as `/report?repo=` has always been. Short-circuiting here also keeps the
  // credit machinery below untouched for the App path it was written for.
  if (canRunRealPublicScan({ sourceInstallId })) {
    return { canRunReal: true, creditUnknown: false, publicFunnel: true };
  }

  let settled: CreditRead = credit && credit.org === sourceLabel ? credit : null;
  // Only the App path reaches here (the public path returned above), but the `sourceInstallId` guards
  // are kept so this block stays correct on its own terms.
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
    publicFunnel: false,
  };
}
