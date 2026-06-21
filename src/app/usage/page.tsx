import { SiteFooter, SiteHeader } from "@/components/Brand";
import { EmptyState } from "@/components/EmptyState";
import { SignInNotice } from "@/components/SignInNotice";
import { UsageTrend } from "@/components/usage/UsageTrend";
import { AllotmentPanel } from "./AllotmentPanel";
import { getBadgeReach, getCreditReconciliation, getCreditState, getQuotaEventTotals, getUsageSummary, isDbConfigured, type BadgeReach, type CreditReconciliation, type CreditState, type QuotaEventTotals, type UsageSummary } from "@/lib/db";
import { getActiveOrg, getSessionState, isAuthConfigured, PUBLIC_ORG } from "@/lib/auth";
import { timeAgo } from "@/lib/ui";

export const metadata = {
  title: "Usage & metering — Ascent",
  description: "Scan volume, token usage and estimated cost for your organization's Ascent scans.",
};

export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl px-5 py-10">{children}</main>
      <SiteFooter />
    </>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Shell>
      <EmptyState icon="📊" title={title} body={children} actions={[{ label: "← Home", href: "/" }]} />
    </Shell>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="font-mono text-sm uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-3xl font-bold tabular-nums text-white">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {sub && <div className="mt-1 text-sm text-slate-500">{sub}</div>}
    </div>
  );
}

// Per-provider label + accent so the "By inference engine" bars are distinguishable at a glance
// (was every provider in the same azure with its raw id). Unknown ids fall back to accent + the id.
const PROVIDER_META: Record<string, { label: string; color: string }> = {
  gemini: { label: "Gemini", color: "#4285f4" },
  bedrock: { label: "AWS Bedrock", color: "#ff9900" },
  claude: { label: "Claude", color: "#d97757" },
  "claude-cli": { label: "Claude CLI", color: "#d97757" },
  mock: { label: "Mock (deterministic)", color: "#94a3b8" },
};
function providerMeta(id: string): { label: string; color: string } {
  return PROVIDER_META[id] ?? { label: id, color: "var(--color-accent)" };
}

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

  // Mirror /api/usage: a DB-on + auth-off deployment must not serve per-tenant usage. Without
  // auth configured there's no session to scope by, so only the shared public org is available;
  // an explicit ?org=<slug> for anything else is refused rather than silently served.
  if (!isAuthConfigured() && org.toLowerCase() !== PUBLIC_ORG) {
    return (
      <Notice title="Per-organization usage needs authentication">
        Configure GitHub OAuth (and the GitHub App) to view usage for a specific organization.
        The shared public usage view is available without signing in.
      </Notice>
    );
  }

  // Cross-tenant IDOR guard — mirror the sibling /api/usage route (route.ts:67-76). The route
  // membership-checks the requested slug; this page (which "computes the same summary directly")
  // previously split only on auth-on vs auth-off and never verified membership, so any signed-in
  // user could open /usage?org=<competitor> and read that tenant's scan volume, repo names,
  // token/cost spend and credit balance. With auth configured, a non-public org requires a session
  // whose installations include it.
  if (isAuthConfigured() && org.toLowerCase() !== PUBLIC_ORG) {
    const orgLc = org.toLowerCase();
    if (!session || !session.installations.some((i) => i.login.toLowerCase() === orgLc)) {
      return (
        <Notice title="You don't have access to this organization">
          Usage for this organization is visible only to its members. Choose an organization you
          belong to from the switcher, or view the shared public usage.
        </Notice>
      );
    }
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
      <div className="animate-fade-up">
        <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">Usage &amp; metering</div>
        <h1 className="mt-1 text-2xl font-bold text-white">
          Organization: <span className="font-mono">{usage.org}</span>
        </h1>
        <p className="mt-2 max-w-2xl text-base text-slate-400">
          Each computed scan is one metered unit (cached re-scans aren&apos;t recounted). Public
          scans are free; private scans are billable under the usage-based plan.
        </p>

        {/* Low-balance / depleted notice — the "am I about to be cut off?" answer, surfaced
            BEFORE the 402 paywall does it for us. Links to the org dashboard's credits chip,
            which is where top-ups (manual grants today, billing later) actually happen. */}
        {lowBalance && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3">
            <p className="text-base text-warn">
              {creditBalance === 0
                ? "Out of private-scan credits — the next private scan will be refused (402) until you top up."
                : `Low balance: ${creditBalance} credit${creditBalance === 1 ? "" : "s"} left vs ${billable.toLocaleString()} private scans in the last ${usage.periodDays}d.`}
            </p>
            <a
              href={`/org/${encodeURIComponent(org)}`}
              className="focus-ring shrink-0 rounded-md border border-warn/40 px-3 py-1.5 text-sm font-medium text-warn transition hover:bg-warn/10"
            >
              Manage credits →
            </a>
          </div>
        )}

        {/* Trend is the lead: usage as a per-day time series (billable vs free), with export. */}
        <div className="mt-8">
          <UsageTrend daily={usage.daily} org={usage.org} days={usage.periodDays} />
        </div>

        {/* Compact totals beneath the trend, for at-a-glance context. */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total scans" value={usage.totalScans} sub="all time" />
          <Stat label={`Last ${usage.periodDays}d`} value={usage.periodScans} sub="computed scans" />
          <Stat label="Billable (private)" value={billable} sub={`metered · last ${usage.periodDays}d`} />
          <Stat label="Repos scanned" value={usage.distinctRepos} sub="distinct" />
        </div>

        {/* Cost + tokens — turns metering into an actual billing view (was "per-scan rate is TBD").
            The prepaid balance leads it: credits are the currency that actually gates scans. */}
        <div className={`mt-4 grid gap-4 sm:grid-cols-2 ${credit ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
          {credit && (
            <Stat
              label="Credits"
              value={credit.unlimited ? "Unlimited" : credit.balance}
              sub={
                credit.unlimited
                  ? "enterprise plan — included"
                  : runwayDays != null
                    ? runwayDays > 365
                      ? "over a year at current burn"
                      : `≈ ${runwayDays}d at current burn`
                    : "private scans remaining"
              }
            />
          )}
          <Stat
            label="Est. cost"
            value={usage.estimatedCostUsd != null ? `$${usage.estimatedCostUsd.toFixed(2)}` : "—"}
            sub={
              usage.costBasis === "env"
                ? `last ${usage.periodDays}d · configured rates`
                : usage.costBasis === "builtin"
                  ? `last ${usage.periodDays}d · built-in rates (approx.)`
                  : "set LLM_*_COST_PER_MTOK to estimate"
            }
          />
          <Stat label="Input tokens" value={usage.inputTokens} sub={`last ${usage.periodDays}d`} />
          <Stat label="Output tokens" value={usage.outputTokens} sub={`last ${usage.periodDays}d`} />
        </div>

        {/* Burn-vs-allotment: is this org over- or under-provisioned for its tier? Renders only for a
            metered plan with a monthly allotment (not Free/Enterprise). The 90% line is the top-up nudge
            BEFORE the hard 402 — the right-sizing signal /usage was missing. */}
        {credit && <AllotmentPanel plan={credit.plan} billableInPeriod={billable} periodDays={usage.periodDays} />}

        {/* Reconciliation (USE-4): metered private scans vs the credit ledger for the same period —
            does what was billed line up with what was debited? Refunds (failed/deduped scans) net it back. */}
        {recon && recon.entries > 0 && (
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold text-white">
              Reconciliation <span className="font-normal text-slate-500">· scans vs credit ledger · last {usage.periodDays}d</span>
            </h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Billable scans" value={billable} sub="private · metered" />
              <Stat label="Credits debited" value={recon.debited} sub="from the ledger" />
              <Stat label="Refunds" value={recon.refunded} sub="failed / deduped scans" />
              <Stat
                label="Net credits"
                value={`${recon.net >= 0 ? "+" : ""}${recon.net.toLocaleString()}`}
                sub={recon.granted > 0 ? `incl. ${recon.granted.toLocaleString()} granted` : "debits − refunds/grants"}
              />
            </div>
            {billable !== recon.debited - recon.refunded && (
              <p className="mt-3 text-sm text-slate-500">
                {billable} billable scans vs {Math.max(0, recon.debited - recon.refunded)} net credits debited — differences
                come from unlimited-plan scans (not debited), grants, or scans/ledger rows straddling the window edge.
              </p>
            )}
          </div>
        )}

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold text-white">
              Public vs private{" "}
              <span className="font-normal text-slate-500">· last {usage.periodDays}d</span>
            </h2>
            <div className="mt-3 space-y-2 text-base">
              {usage.periodScans === 0 ? (
                // Match the "By engine" panel's empty state — without this the bars divide by a zero
                // period total and render as silent zero-width bars rather than a clear "no scans".
                <p className="text-slate-500">No scans in this period.</p>
              ) : (
                <>
                  <Bar label="Public (free)" value={usage.publicScans} total={usage.periodScans} color="#94a3b8" pattern />
                  <Bar label="Private (billable)" value={usage.privateScans} total={usage.periodScans} color="var(--color-accent)" />
                </>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold text-white">
              By inference engine{" "}
              <span className="font-normal text-slate-500">· last {usage.periodDays}d</span>
            </h2>
            <div className="mt-3 space-y-2 text-base">
              {usage.byProvider.length === 0 ? (
                <p className="text-slate-500">No scans in this period.</p>
              ) : (
                usage.byProvider.map((p) => (
                  <Bar key={p.provider} label={providerMeta(p.provider).label} value={p.count} total={usage.periodScans} color={providerMeta(p.provider).color} />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Top repos by metered volume — which repos drove the bill / token spend (per-repo attribution). */}
        {usage.byRepo.length > 0 && (
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold text-white">
              Top repositories{" "}
              <span className="font-normal text-slate-500">· by metered scans · last {usage.periodDays}d</span>
            </h2>
            <div className="mt-3 space-y-2 text-base">
              {usage.byRepo.map((r) => (
                <div key={r.fullName} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-mono text-sm text-slate-300">{r.fullName}</span>
                  <span className="shrink-0 font-mono tabular-nums text-slate-400">
                    {r.scans.toLocaleString()} scan{r.scans === 1 ? "" : "s"}
                    {r.tokens > 0 ? ` · ${r.tokens.toLocaleString()} tok` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Badge reach (USE-1): where the public README badge is embedded + how often it's fetched.
            Lower-bound — README badges are camo/CDN-cached, so most views never reach the origin. */}
        {badgeReach && badgeReach.totalImpressions > 0 && (
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold text-white">
              Badge reach <span className="font-normal text-slate-500">· public README badge · all time</span>
            </h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <Stat label="Impressions" value={badgeReach.totalImpressions} sub="origin badge fetches" />
              <Stat label="Embedding hosts" value={badgeReach.distinctHosts} sub="distinct" />
              <Stat label="Badged repos" value={badgeReach.distinctRepos} sub="distinct" />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <div className="font-mono text-sm uppercase tracking-widest text-slate-500">Top embedding hosts</div>
                <div className="mt-2 space-y-1.5 text-base">
                  {badgeReach.topHosts.map((h) => (
                    <div key={h.host} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-mono text-sm text-slate-300">{h.host}</span>
                      <span className="shrink-0 font-mono tabular-nums text-slate-400">{h.impressions.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="font-mono text-sm uppercase tracking-widest text-slate-500">Most-fetched badges</div>
                <div className="mt-2 space-y-1.5 text-base">
                  {badgeReach.topRepos.map((r) => (
                    <div key={r.fullName} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-mono text-sm text-slate-300">{r.fullName}</span>
                      <span className="shrink-0 font-mono tabular-nums text-slate-400">{r.impressions.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              A lower bound: README badges are served through GitHub&apos;s image proxy and edge caches, so
              most views are answered from cache and never reach the origin to be counted. Click-throughs are
              tagged <span className="font-mono">?ref=badge</span> for attribution in your analytics.
            </p>
          </div>
        )}

        {/* Abuse & limits (QUOTA-6): how often the free funnel's guardrails fired — weekly-quota
            denials + rate-limit trips. All-time counters; public view only. */}
        {quotaEvents && quotaEvents.total > 0 && (
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-base font-semibold text-white">
              Abuse &amp; limits <span className="font-normal text-slate-500">· free-funnel guardrails · all time</span>
            </h2>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div>
                <div className="font-mono text-sm uppercase tracking-widest text-slate-500">Weekly-quota denials</div>
                <div className="mt-2 space-y-1.5 text-base">
                  {quotaEvents.quotaDenies.length === 0 ? (
                    <p className="text-slate-500">None — no one&apos;s hit the weekly free-scan cap.</p>
                  ) : (
                    quotaEvents.quotaDenies.map((d) => (
                      <div key={d.scope} className="flex items-center justify-between gap-3">
                        <span className="font-mono text-sm text-slate-300">{d.scope === "user" ? "signed-in" : "anonymous"}</span>
                        <span className="shrink-0 font-mono tabular-nums text-slate-400">{d.count.toLocaleString()}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div>
                <div className="font-mono text-sm uppercase tracking-widest text-slate-500">Rate-limit trips</div>
                <div className="mt-2 space-y-1.5 text-base">
                  {quotaEvents.rateLimitTrips.length === 0 ? (
                    <p className="text-slate-500">None recorded.</p>
                  ) : (
                    quotaEvents.rateLimitTrips.map((t) => (
                      <div key={t.scope} className="flex items-center justify-between gap-3">
                        <span className="font-mono text-sm text-slate-300">{t.scope}</span>
                        <span className="shrink-0 font-mono tabular-nums text-slate-400">{t.count.toLocaleString()}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              The per-minute burst limiter on scan/import is an in-memory backstop and isn&apos;t counted here;
              these are the durable signals (weekly-quota denials + the badge limiter).
            </p>
          </div>
        )}

        <p className="mt-6 text-sm text-slate-500">
          Window:{" "}
          {usage.firstScanAt
            ? usage.lastScanAt
              ? `${timeAgo(usage.firstScanAt)} → ${timeAgo(usage.lastScanAt)}`
              : timeAgo(usage.firstScanAt) /* single point — don't render "→ unknown" */
            : "no scans recorded"}
          .
          {usage.costBasis === "env"
            ? " Cost is estimated from the configured per-MTok rates (LLM_INPUT/OUTPUT_COST_PER_MTOK)."
            : usage.costBasis === "builtin"
              ? " Cost is an approximate estimate from built-in per-model list prices; set LLM_INPUT/OUTPUT_COST_PER_MTOK to override with your rates."
              : " No built-in rate matches this period's models — set LLM_INPUT_COST_PER_MTOK / LLM_OUTPUT_COST_PER_MTOK to estimate spend."}{" "}
          Per-org attribution activates with auth / the GitHub App.
        </p>
      </div>
    </Shell>
  );
}

function Bar({
  label,
  value,
  total,
  color,
  pattern,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  pattern?: boolean;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono tabular-nums text-slate-400">
          {value.toLocaleString()} · {pct}%
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            backgroundColor: color,
            // Redundant (non-color) encoding so the public/free vs private/billable split stays
            // legible without relying on hue alone (CVD): the free series is stippled.
            backgroundImage: pattern
              ? "repeating-linear-gradient(45deg, rgba(255,255,255,0.3) 0 3px, transparent 3px 6px)"
              : undefined,
          }}
        />
      </div>
    </div>
  );
}
