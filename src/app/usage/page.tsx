import { SignInNotice } from "@/components/SignInNotice";
import { EmptyState } from "@/components/EmptyState";
import { Shell, Notice } from "./usageShell";
import { UsageDashboard } from "./usageDashboard";
import { getBadgeReach, getCreditReconciliation, getCreditState, getQuotaEventTotals, getUsageSummary, isDbConfigured, type BadgeReach, type CreditReconciliation, type CreditState, type QuotaEventTotals, type UsageSummary } from "@/lib/db";
import { boundUsageDays } from "@/lib/db/usage";
import { getActiveOrg, PUBLIC_ORG } from "@/lib/auth";
import { resolveSignInState } from "@/lib/signin-gate";
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

  // The gate used to be `isAuthConfigured() && !session` — the DORMANT custom-OAuth predicate, false
  // in production, so a signed-out visitor was never prompted. resolveSignInState checks the ACTIVE
  // Supabase wall first and names the button that actually works.
  const { needsSignIn, provider, expired, session } = await resolveSignInState();

  // An explicit ?org= wins; otherwise follow the org remembered via the header switcher (which itself
  // falls back to the first installation, else public). Resolved BEFORE the sign-in wall so the wall
  // can special-case the public funnel the way canReadOrg does. Safe for an anonymous session (null):
  // the option set collapses to public, so a stray active-org cookie can't resolve to a private slug.
  const org = orgParam || (await getActiveOrg(session));

  // Only prompt sign-in for a NON-public org. The shared public org's usage is readable anonymously —
  // canReadOrg(PUBLIC_ORG) is unconditionally true and the sibling GET /api/usage?org=public serves
  // signed-out callers via requireOrgRead — so walling it here made the PAGE stricter than its own API
  // and contradicted the "view the shared public usage" copy in the access Notice below. A private org
  // still walls (the canReadOrg gate at the bottom would only render a dead "no access" notice with no
  // prompt), and a signed-in viewer skips this entirely.
  if (needsSignIn && org.toLowerCase() !== PUBLIC_ORG) {
    return (
      <Shell>
        <SignInNotice next="/usage" provider={provider} expired={expired} />
      </Shell>
    );
  }

  // Bound the window AFTER the org is known, mirroring /api/usage via the shared boundUsageDays: the
  // UNAUTHENTICATED public org is capped tighter (90d) so an anonymous caller can't force the 365-day
  // full-window aggregate the API path refuses (this page computes the same summary directly). The
  // helper FLOORS a fractional ?days= so `since`, the day axis, and the counts share one integer window
  // (an un-floored 1.5 stepped the axis by half-days and silently dropped today from the chart/CSV).
  const days = boundUsageDays(daysParam, org.toLowerCase() === PUBLIC_ORG);

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
