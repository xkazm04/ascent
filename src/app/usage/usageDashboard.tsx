import { UsageTrend } from "@/components/usage/UsageTrend";
import { Surface } from "@/components/ui";
import { AllotmentPanel } from "./AllotmentPanel";
import { Stat, Bar, providerMeta } from "./usagePanels";
import { BadgeReachPanel, AbuseLimitsPanel } from "./usageAllTimePanels";
import type { BadgeReach, CreditReconciliation, CreditState, QuotaEventTotals, UsageSummary } from "@/lib/db";
import { timeAgo } from "@/lib/ui";

export function UsageDashboard({
  org,
  usage,
  credit,
  badgeReach,
  recon,
  quotaEvents,
  billable,
  creditBalance,
  runwayDays,
  lowBalance,
}: {
  org: string;
  usage: UsageSummary;
  credit: CreditState | null;
  badgeReach: BadgeReach | null;
  recon: CreditReconciliation | null;
  quotaEvents: QuotaEventTotals | null;
  billable: number;
  creditBalance: number | null;
  runwayDays: number | null;
  lowBalance: boolean;
}) {
  return (
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
        <Surface className="mt-6 p-6">
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
        </Surface>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Surface className="p-6">
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
        </Surface>
        <Surface className="p-6">
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
        </Surface>
      </div>

      {/* Top repos by metered volume — which repos drove the bill / token spend (per-repo attribution). */}
      {usage.byRepo.length > 0 && (
        <Surface className="mt-6 p-6">
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
        </Surface>
      )}

      <BadgeReachPanel badgeReach={badgeReach} />

      <AbuseLimitsPanel quotaEvents={quotaEvents} />

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
  );
}
