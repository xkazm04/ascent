import type { OrgCredit } from "@/components/onboarding/OnboardingFlow";

/**
 * The onboarding "money gate": decides whether a scan runs for real (drawing prepaid
 * credits) versus as a disclosed preview/mock.
 *
 * A REAL scan runs only on the App path (an installation id is present) AND when the
 * credit object was read for the CURRENT org (`credit.org === sourceLabel`, so a stale
 * credit from a previously-picked org can never enable billing against the wrong tenant)
 * AND the org actually has headroom. Headroom is the SAME hybrid the server enforces:
 * `unlimited`, OR a positive purchased `balance`, OR remaining INCLUDED monthly free scans
 * (`allowanceRemaining > 0`). Keying on purchased balance alone wrongly downgraded a
 * Free-tier org's entitled free scans to a preview. Anything else is a disclosed preview —
 * the public-handle funnel is always a preview.
 */
export function canRunRealScan(args: {
  sourceInstallId?: string | null;
  credit?: OrgCredit | null;
  sourceLabel: string;
}): boolean {
  const { sourceInstallId, credit, sourceLabel } = args;
  if (!sourceInstallId || !credit || credit.org !== sourceLabel) return false;
  return credit.unlimited || credit.balance > 0 || (credit.allowanceRemaining ?? 0) > 0;
}
