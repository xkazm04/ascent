import { SignInNotice } from "@/components/SignInNotice";
import { EmptyState } from "@/components/EmptyState";
import { Shell, Notice } from "./usageShell";
import { UsageDashboard } from "./usageDashboard";
import { getBadgeReach, getCreditReconciliation, getCreditState, getQuotaEventTotals, getUsageSummary, isDbConfigured, type BadgeReach, type CreditReconciliation, type CreditState, type QuotaEventTotals, type UsageSummary } from "@/lib/db";
import { getActiveOrg, getSessionState, isAuthConfigured, PUBLIC_ORG } from "@/lib/auth";
import { canReadOrg } from "@/lib/authz";

export const metadata = {
  title: "Usage & metering — Ascent",
  description: "Scan volume, token usage and estimated cost for your organization's Ascent scans.",
};

export const dynamic = "force-dynamic";

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; days?: string }>;
}) {
  const { org: orgParam, days: daysParam } = await searchParams;

  const { session, status } = await getSessionState();
  if (isAuthConfigured() && !session) {
    return (
      <Shell>
        <SignInNotice next="/usage" expired={status === "expired"} />
      </Shell>
    );
  }
  // An explicit ?org= wins; otherwise follow the org remembered via the header switcher
  // (which itself falls back to the first installation, else public).
  const org = orgParam || (await getActiveOrg(session));

  // Bound the window AFTER the org is known, mirroring /api/usage: the UNAUTHENTICATED public org
  // is capped tighter (90d) so an anonymous caller can't force the 365-day full-window aggregate
  // the API path refuses (this page computes the same summary directly). Non-numeric input → 30.
  const days = Math.min(org.toLowerCase() === PUBLIC_ORG ? 90 : 365, Math.max(1, Number(daysParam) || 30));

  // Cross-tenant IDOR guard — the canonical read-side tenant gate (the same canReadOrg the sibling
  // /api/usage route and the other org-scoped pages use). It opens PUBLIC_ORG to everyone, requires
  // installation membership for a private org under custom OAuth, and additionally honors the
  // Supabase login wall + the ASCENT_OPEN_ORG_DASHBOARDS opt-in — which the two hand-rolled branches
  // this replaces (a bare auth-off refusal + an inline membership check) silently missed.
  if (!(await canReadOrg(org))) {
    return (
      <Notice title="You don't have access to this organization">
        Usage for this organization is visible only to its members. Choose an organization you
        belong to from the switcher, or view the shared public usage.
      </Notice>
    );
  }

  if (!isDbConfigured()) {
    return (
      <Notice title="Usage metering needs a database">
        Metering aggregates stored scans — set DATABASE_URL (local Postgres or Aurora DSQL)
        to start counting.
      </Notice>
    );
  }

  // getUsageSummary returns null when the DB isn't configured and can throw on a transient
  // blip (deploy, dropped connection, env race) between the isDbConfigured() check above and
  // the query. Either way, degrade to the notice instead of crashing this billing page.
  // Credit state rides the same round-trip: prepaid credits are the actual billing currency
  // (a depleted org gets a hard 402 on its next private scan), so the billing page must show
  // the balance. Skipped for the shared public org (free, never metered — mirrors the org
  // layout's header chip), and best-effort: a credit-read blip hides the panel, not the page.
  let usage: UsageSummary | null;
  let credit: CreditState | null = null;
  // Badge reach rides the same round-trip, best-effort — a tally read blip hides the panel, not the page.
  let badgeReach: BadgeReach | null = null;
  // Credit reconciliation for the panel (USE-4) — non-public orgs only; best-effort.
  let recon: CreditReconciliation | null = null;
  // Public-funnel abuse counters (QUOTA-6) — only meaningful on the shared public view; best-effort.
  let quotaEvents: QuotaEventTotals | null = null;
  try {
    [usage, credit, badgeReach, recon, quotaEvents] = await Promise.all([
      getUsageSummary(org, days),
      org.toLowerCase() === PUBLIC_ORG
        ? Promise.resolve(null)
        : getCreditState(org).catch(() => null),
      getBadgeReach(org).catch(() => null),
      org.toLowerCase() === PUBLIC_ORG ? Promise.resolve(null) : getCreditReconciliation(org, days).catch(() => null),
      org.toLowerCase() === PUBLIC_ORG ? getQuotaEventTotals().catch(() => null) : Promise.resolve(null),
    ]);
  } catch {
    usage = null;
  }
  if (!usage) {
    return (
      <Notice title="Usage metering is temporarily unavailable">
        We couldn&apos;t reach the database to compute your usage summary. This is usually
        transient — please refresh in a moment.
      </Notice>
    );
  }

  // A reachable DB with zero scans is a deliberate "nothing metered yet" moment, not a populated
  // dashboard that happens to read all zeros — route it through the canonical EmptyState with a
  // path to the first scan instead of four 0 stats and two empty bar panels.
  if (usage.totalScans === 0) {
    return (
      <Shell>
        <EmptyState
          icon="📊"
          title="No scans metered yet"
          body="Public scans are free; private scans are billable under the usage-based plan. Scan a repository to start metering usage."
          actions={[{ label: "Scan a repo", href: "/", primary: true }]}
        />
      </Shell>
    );
  }

  const billable = usage.privateScans; // public scans are free; private are metered

  // Prepaid-credit context: the balance gates whether private scans keep working (402 when 0),
  // so it leads the billing row. Runway is derived from the period's observed burn and shown
  // only when there IS a burn — a derived figure needs a real basis, not a fabricated one.
  const creditBalance = credit && !credit.unlimited ? credit.balance : null;
  const dailyBurn = usage.periodDays > 0 ? billable / usage.periodDays : 0;
  const runwayDays = creditBalance != null && dailyBurn > 0 ? Math.floor(creditBalance / dailyBurn) : null;
  // Low = the balance wouldn't cover another period at the current burn (or is already 0).
  const lowBalance = creditBalance != null && (creditBalance === 0 || (billable > 0 && creditBalance <= billable));

  return (
    <Shell>
      <UsageDashboard
        org={org}
        usage={usage}
        credit={credit}
        badgeReach={badgeReach}
        recon={recon}
        quotaEvents={quotaEvents}
        billable={billable}
        creditBalance={creditBalance}
        runwayDays={runwayDays}
        lowBalance={lowBalance}
      />
    </Shell>
  );
}
