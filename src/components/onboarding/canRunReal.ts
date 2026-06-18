import type { OrgCredit } from "@/components/onboarding/OnboardingFlow";

/**
 * The onboarding "money gate": decides whether a scan runs for real (drawing prepaid
 * credits) versus as a disclosed preview/mock.
 *
 * A REAL scan runs only on the App path (an installation id is present) AND when the
 * credit object was read for the CURRENT org (`credit.org === sourceLabel`, so a stale
 * credit from a previously-picked org can never enable billing against the wrong tenant)
 * AND the org actually has headroom (`unlimited` or `balance > 0`). Anything else is a
 * disclosed preview — the public-handle funnel is always a preview.
 *
 * Behavior-preserving extraction of the inline expression that used to live in
 * OnboardingFlow.startScan. The boolean logic is identical to the original.
 */
export function canRunRealScan(args: {
  sourceInstallId?: string | null;
  credit?: OrgCredit | null;
  sourceLabel: string;
}): boolean {
  const { sourceInstallId, credit, sourceLabel } = args;
  return !!sourceInstallId && !!credit && credit.org === sourceLabel && (credit.unlimited || credit.balance > 0);
}
