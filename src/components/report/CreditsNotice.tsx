"use client";

// Out-of-credits surfaces for the report page. A metered scan (a private / installed-org repo) is
// refused by the credit gate with a plain JSON 402 `{ code: "INSUFFICIENT_CREDITS", balance }`
// BEFORE the SSE stream opens (see /api/scan/stream). That is not a scan failure and a "Try again"
// cannot clear it — the only thing that can is credits — so it gets its own notice next to the
// monthly-quota ones in QuotaNotice.tsx rather than falling into the generic Empty.
//
// The action mirrors what the org dashboard already offers: CreditsControl (the credits popover in
// the org shell header, which owns the /api/billing/checkout links) and, behind it, the plans page.

import { EmptyState } from "@/components/EmptyState";
import { repoKey } from "@/components/report/repoKey";

/**
 * The org dashboard that owns this repo's credits, or null when the owner can't be read off the
 * requested repo. A metered scan is by construction an INSTALLED org's repo and the scan route
 * resolves its org slug as `parsed.owner.toLowerCase()` (resolveScanAuth in src/lib/scan.ts) — so
 * the owner segment of the repo the user asked about IS the org whose balance was refused. The
 * credits control lives in that dashboard's header (OrgShellActions), so the slug is the whole link.
 */
export function creditsOrgHref(repo: string): string | null {
  const owner = repoKey(repo).split("/")[0];
  if (!owner) return null;
  return `/org/${encodeURIComponent(owner)}`;
}

/** Human copy for a refused balance — "0 credits left" reads better than a bare number. */
export function creditsBalanceLine(balance: number): string {
  if (!Number.isFinite(balance)) return "No scan credits left.";
  return `${balance} scan credit${balance === 1 ? "" : "s"} left.`;
}

/**
 * The blocked state when the credit gate refused the scan. No "Try again" (an immediate retry just
 * re-trips the same gate); instead it names the balance and leads to the credits control on the
 * owning org's dashboard, with the plans page as the fallback path.
 */
export function CreditsBlocked({
  message,
  balance,
  repo,
}: {
  message: string;
  balance: number;
  /** The requested repo — its owner names the org whose dashboard holds the credits control. */
  repo?: string;
}) {
  const orgHref = repo ? creditsOrgHref(repo) : null;
  return (
    <EmptyState
      icon="🪙"
      title="Out of scan credits"
      body={
        <>
          {message}{" "}
          <span className="type-mono-sm tabular-nums text-slate-300">{creditsBalanceLine(balance)}</span>
        </>
      }
      actions={[
        ...(orgHref ? [{ label: "Add credits →", href: orgHref, primary: true }] : []),
        { label: "See plans →", href: "/pricing", primary: !orgHref },
        { label: "← Back home", href: "/" },
      ]}
    />
  );
}
