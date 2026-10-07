// WHERE a wizard run is imported to, and where "View dashboard" lands.
//
// Normally the source IS the org: the App path imports under the installation's login, the public-handle
// path under the handle. The one exception is a SIGNED-IN viewer on the GATED CLOUD scanning a public
// handle (no installation): requireOrgAccess answers 403 to a non-member of that handle's org, so the
// run goes into the shared "public" org instead - real, charged to the viewer's own public-scan
// allowance, no Membership created and no admin power over "public" (operator decision, ask d0eb7d6c,
// 2026-10-07). The App path, self-hosted and auth-off deployments are unchanged.
//
// The deployment facts are the ones /onboarding already computes server-side (resolveFirstRun); they
// are threaded in as props, never re-fetched.

import type { FirstRunMode } from "@/lib/first-run";

export interface OnboardingDeployment {
  mode: FirstRunMode;
  /** The login wall is up. */
  gated: boolean;
  signedIn: boolean;
}

/** The org the import POST targets and the dashboard hand-off opens. */
export function importOrg(
  sourceLabel: string,
  sourceInstallId: string | null,
  deployment: OnboardingDeployment | null | undefined,
): string {
  if (sourceInstallId) return sourceLabel;
  if (deployment && deployment.mode === "cloud" && deployment.gated && deployment.signedIn) return "public";
  return sourceLabel;
}
