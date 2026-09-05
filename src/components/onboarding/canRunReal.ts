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
 *
 * `credit.allowanceRemaining` is the ONE source of truth for the free monthly allowance: this gate
 * counts it as headroom here, and the recurring-cost disclosure (importCost.ts) subtracts the SAME
 * value. Keep the two in agreement — a gate that qualifies an org on its allowance while the cost copy
 * ignores that allowance is precisely finding #1 (an inflated "pauses at zero" alarm for a qualifying
 * org). Both derive the allowance from OrgCredit.allowanceRemaining (checkScanEntitlement); neither
 * hardcodes the per-plan constant.
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

/**
 * The PUBLIC-handle path (G7-17): no installation, so no private repo can be read and no credit can be
 * drawn — but that is an argument for a REAL scan, not against one.
 *
 * `/report?repo=` has always scored a public repo for real, free, with no account, metered only by the
 * monthly public-scan allowance (src/lib/public-scan-quota.ts). The onboarding funnel is the SAME work
 * on the SAME kind of repo, so scoring it with the deterministic rubric made the product's highest-
 * intent first run the one place it showed numbers no model produced — and those numbers land in the
 * public corpus that the public register ranks. Routing this path to a real scan is what makes the
 * register trustworthy at its source.
 *
 * The server is the authority: `/api/org/import` runs the token-less public path (private repos 404 by
 * construction) and charges the same public-scan allowance, capping/refusing the batch when it is
 * exhausted. This predicate only decides what the client REQUESTS.
 */
export function canRunRealPublicScan(args: { sourceInstallId?: string | null }): boolean {
  return !args.sourceInstallId;
}
