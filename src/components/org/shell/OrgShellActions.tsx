// The org's persistent header actions (alerts · credits · scan), folded into the OrgHeader's right
// cluster. Extracted from the org layout so that file stays under the refactor's 200-line .tsx cap
// (docs/ORG-TABS-REFACTOR.md §3); pure relocation, no behaviour change. The old in-content
// "scanned · watched" line and the plan-tier chip stay dropped — the header carries only identity
// plus the live actions.
//
// A server component: the three controls inside it are the client ones, and every env/plan decision
// below must stay on the server (the Polar SDK never crosses the boundary).

import { AlertsControl } from "@/components/org/shared/AlertsControl";
import { CreditsControl } from "@/components/org/shared/CreditsControl";
import { OrgScanButton } from "@/components/org/shared/OrgScanButton";
import type { getCreditState } from "@/lib/db";
import { creditGrantsEnabled } from "@/lib/env";
import { scanAllowance } from "@/lib/plans";
import { creditPacks, polarEnabled } from "@/lib/polar";

type CreditState = Awaited<ReturnType<typeof getCreditState>>;

export function OrgShellActions({
  slug,
  kind,
  credit,
  watchedCount,
  usageThisMonth,
}: {
  slug: string;
  kind: string;
  /** Prepaid scan-credit state, or null for the shared public org (which is free). */
  credit: CreditState | null;
  watchedCount: number;
  /** Month-to-date metered scans, so the chip knows the free allowance still covers scans at 0. */
  usageThisMonth: number;
}) {
  // Must match the endpoint's own gate (creditGrantsEnabled hard-disables in production), or the
  // control renders for an owner whose every submission then 403s.
  const grantsEnabled = creditGrantsEnabled();
  // Polar credit purchase (CRED-1): show the "Buy credits" packs when billing is configured. The
  // packs are plain serializable data; the SDK stays server-side (CreditsControl declares its own
  // Pack type).
  const buyEnabled = polarEnabled();
  const packs = buyEnabled ? creditPacks() : [];
  // Free metered scans left in the plan's monthly allowance, so the credits chip doesn't say "out of
  // credits / paused" at balance 0 while the allowance still covers scans. null allowance = unlimited
  // (Enterprise) — the chip shows "Unlimited" anyway, so 0 here is harmless.
  const planAllowance = credit ? scanAllowance(credit.plan) : null;
  const allowanceRemaining = planAllowance == null ? 0 : Math.max(0, planAllowance - usageThisMonth);

  return (
    <>
      {slug !== "public" && <AlertsControl org={slug} />}
      {credit && (
        <CreditsControl
          org={slug}
          initialBalance={credit.balance}
          unlimited={credit.unlimited}
          grantsEnabled={grantsEnabled}
          buyEnabled={buyEnabled}
          packs={packs}
          allowanceRemaining={allowanceRemaining}
        />
      )}
      {/* The bulk org-scan persists scans UNDER this org — correct for a fleet, wrong for a personal
          workspace (its repos' series live in the shared public corpus; rescans go through the public
          report flow until the Phase-3 persist/decision org split lands). */}
      {kind !== "personal" && (
        <div data-tour="scan-scope">
          <OrgScanButton org={slug} watchedCount={watchedCount} />
        </div>
      )}
    </>
  );
}
