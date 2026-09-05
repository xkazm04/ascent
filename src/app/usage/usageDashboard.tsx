import { UsageTrend } from "@/components/usage/UsageTrend";
import { Surface } from "@/components/ui";
import { AllotmentPanel } from "./AllotmentPanel";
import { Stat, Bar, providerMeta } from "./usagePanels";
import { AbuseLimitsPanel } from "./usageAllTimePanels";
import { LanePanels } from "./usageLanePanels";
import { ShowbackMatrixPanel } from "./usageShowbackPanel";
import type { CreditReconciliation, CreditState, QuotaEventTotals, UsageSummary } from "@/lib/db";
import type { CreditNotice } from "./creditNotice";
import { timeAgo } from "@/lib/ui";
import { costHeadline } from "./costHeadline";

export function UsageDashboard({
  org,
  usage,
  credit,
  recon,
  quotaEvents,
  billable,
  runwayDays,
  notice,
}: {
  org: string;
  usage: UsageSummary;
  credit: CreditState | null;
  recon: CreditReconciliation | null;
  quotaEvents: QuotaEventTotals | null;
  billable: number;
  runwayDays: number | null;
  notice: CreditNotice | null;
}) {
  // The shared anonymous funnel has no tenant behind it, so several of this page's claims are true
  // there and false everywhere else. Resolved once, here, rather than asserted in the copy.
  const isPublicFunnel = usage.unmeteredFunnel;
  return (
    <div className="animate-fade-up">
      <div className="type-mono-sm uppercase tracking-[0.3em] text-accent">Usage &amp; metering</div>
      <h1 className="mt-1 type-heading font-bold text-white">
        Organization: <span className="font-mono">{usage.org}</span>
      </h1>
      <p className="mt-2 max-w-2xl type-body text-slate-400">
        Each computed scan is one metered unit (cached re-scans aren&apos;t recounted). Public
        scans are free; private scans are billable under the usage-based plan.
      </p>

      {/* Low-balance / depleted notice — the "am I about to be cut off?" answer, surfaced
          BEFORE the 402 paywall does it for us. Links to the org dashboard's credits chip,
          which is where top-ups (manual grants today, billing later) actually happen.

          UAT DANA-L1-003 (recurrence 2): the decision is NOT made here. `creditNotice` derives it
          from `resolveScanCharge` — the same resolver that issues the 402 — so this banner can no
          longer contradict the AllotmentPanel below it, and can no longer fire on a brand-new org
          that still holds its full monthly allowance. */}
      {notice && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3">
          <p className="type-body text-warn">
            {notice.kind === "denied"
              ? "Out of private-scan credits and this month's included allowance is spent. The next private scan will be refused (402) until you top up."
              : `Low balance: ${notice.balance} credit${notice.balance === 1 ? "" : "s"} left vs ${billable.toLocaleString()} private scans in the last ${usage.periodDays}d.`}
          </p>
          <a
            href={`/org/${encodeURIComponent(org)}`}
            className="focus-ring shrink-0 rounded-md border border-warn/40 px-3 py-1.5 type-body-sm font-medium text-warn transition hover:bg-warn/10"
          >
            Manage credits →
          </a>
        </div>
      )}

      {/* Trend is the lead: usage as a per-day time series (billable vs free), with export. */}
      <div className="mt-8">
        <UsageTrend
          daily={usage.daily}
          org={usage.org}
          days={usage.periodDays}
          /* The zero-fill was clamped at the org's first scan, so the chart covers fewer days than
             were asked for. Told, not inferred: the alternative was 360 bars of measured-looking
             zero for an org that is five days old. */
          shortened={usage.effectiveSince !== usage.windowSince}
        />
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
                ? "enterprise plan: included"
                : runwayDays != null
                  ? runwayDays > 365
                    ? "over a year at current burn"
                    : `≈ ${runwayDays}d at current burn`
                  : "private scans remaining"
            }
          />
        )}
        {/* Est. cost prices EVERY lane, not just scans (UAT VICTOR-L1-05): the headline used to fold
            the Scan rows alone while "Spend by lane" below it summed to 4.5x that — the first number
            a finance reader sees contradicted the page's own itemization. `costHeadline` also carries
            the lane scope and the unpriced-call floor into the caption, so the tile can never imply a
            completeness the lane rows disprove. */}
        <Stat label="Est. cost" {...costHeadline(usage)} />
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
          <h2 className="type-body font-semibold text-white">
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
          {/* The ledger and the scans are now counted over ONE window — the same UTC-day-anchored
              half-open `[since, before)` the page resolves once and hands to both reads. This note
              used to offer "rows straddling the window edge" as an explanation, which was true of
              the OLD rolling wall-clock ledger cutoff and is no longer a cause: naming a fixed
              mismatch as an incidental one taught the reader to shrug at a real gap. */}
          {billable !== recon.debited - recon.refunded && (
            <p className="mt-3 type-body-sm text-slate-500">
              {billable} billable scans vs {Math.max(0, recon.debited - recon.refunded)} net credits debited over the
              same window. Differences come from unlimited-plan scans (not debited) or from credit grants, not from
              the two figures being measured over different periods.
            </p>
          )}
        </Surface>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Surface className="p-6">
          <h2 className="type-body font-semibold text-white">
            Public vs private{" "}
            <span className="font-normal text-slate-500">· last {usage.periodDays}d</span>
          </h2>
          <div className="mt-3 space-y-2 type-body">
            {usage.periodScans === 0 ? (
              // Match the "By engine" panel's empty state — without this the bars divide by a zero
              // period total and render as silent zero-width bars rather than a clear "no scans".
              <p className="text-slate-500">No scans in this period.</p>
            ) : (
              <>
                {/* publicScans = periodScans - billable (G1-08), so this bucket is "free" as a whole —
                    public repos plus any private scan that ran keyless/mock or on the org's own BYOM
                    provider — not literally just public-repo scans (G1-38). */}
                <Bar
                  label="Free (public + mock/BYOM)"
                  value={usage.publicScans}
                  total={usage.periodScans}
                  color="var(--color-tone-flat)"
                  pattern
                />
                <Bar label="Private (billable)" value={usage.privateScans} total={usage.periodScans} color="var(--color-accent)" />
              </>
            )}
          </div>
        </Surface>
        <Surface className="p-6">
          <h2 className="type-body font-semibold text-white">
            By inference engine{" "}
            <span className="font-normal text-slate-500">· last {usage.periodDays}d</span>
          </h2>
          <div className="mt-3 space-y-2 type-body">
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

      {/* Every OTHER inference lane the product runs — Athena, org memory, the briefing narrative,
          the local agent — and which team's work drives them. Sits directly under the provider
          breakdown because it answers the next question that one raises: not "which engine", but
          "which part of the product, and for whom". */}
      <LanePanels byLane={usage.byLane} byTeam={usage.byTeam} periodDays={usage.periodDays} />

      {/* MC-B45 — the join those two panels cannot make between them, and the matrix spec #11
          promised. Directly under them because it is the same calls read a third way, not new data. */}
      <ShowbackMatrixPanel
        byLaneTeam={usage.byLaneTeam}
        byLane={usage.byLane}
        byTeam={usage.byTeam}
        periodDays={usage.periodDays}
      />

      {/* Top repos by metered volume — which repos drove the bill / token spend (per-repo attribution). */}
      {usage.byRepo.length > 0 && (
        <Surface className="mt-6 p-6">
          <h2 className="type-body font-semibold text-white">
            Top repositories{" "}
            <span className="font-normal text-slate-500">· by metered scans · last {usage.periodDays}d</span>
          </h2>
          <div className="mt-3 space-y-2 type-body">
            {usage.byRepo.map((r) => (
              <div key={r.fullName} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate type-mono-sm text-slate-300">{r.fullName}</span>
                <span className="shrink-0 font-mono tabular-nums text-slate-400">
                  {r.scans.toLocaleString()} scan{r.scans === 1 ? "" : "s"}
                  {r.tokens > 0 ? ` · ${r.tokens.toLocaleString()} tok` : ""}
                </span>
              </div>
            ))}
          </div>
        </Surface>
      )}

      <AbuseLimitsPanel quotaEvents={quotaEvents} />

      {/* This line reads an ALL-TIME aggregate (getUsageSummary's `_min`/`_max` over the org's whole
          Scan history, not the period), so labelling it "Window" made the one sentence on the page
          that names the window the one sentence that ignores it. The period is stated on every tile
          and panel above; this is the org's lifetime span, and now says so. */}
      <p className="mt-6 type-body-sm text-slate-500">
        First scan → last scan (all time):{" "}
        {usage.firstScanAt
          ? usage.lastScanAt
            ? `${timeAgo(usage.firstScanAt)} → ${timeAgo(usage.lastScanAt)}`
            : timeAgo(usage.firstScanAt) /* single point — don't render "→ unknown" */
          : "no scans recorded"}
        .
        {usage.costBasis === "env"
          ? " Scan cost is estimated from the configured per-MTok rates (LLM_INPUT/OUTPUT_COST_PER_MTOK); the other lanes are priced from built-in per-model list prices at the time of the call."
          : usage.costBasis === "builtin"
            ? " Cost is an approximate estimate from built-in per-model list prices; set LLM_INPUT/OUTPUT_COST_PER_MTOK to override the scan lane with your rates."
            : " No built-in rate matches this period's scan models: set LLM_INPUT_COST_PER_MTOK / LLM_OUTPUT_COST_PER_MTOK to estimate scan spend."}{" "}
        {usage.allLanesUnpricedCalls > 0
          ? `The headline is the sum of every lane and a FLOOR: ${usage.allLanesUnpricedCalls.toLocaleString()} call${usage.allLanesUnpricedCalls === 1 ? "" : "s"} in this period could not be priced and contribute $0 to it.`
          : "The headline is the sum of every lane below."}{" "}
        {/* MC-B31 (VICTOR-L1-06): this used to tell EVERY reader that "per-org attribution activates
            with auth / the GitHub App" — including a fully-attributed private org looking at its own
            per-team, per-repo, per-lane breakdown, which is that attribution. It belongs to the shared
            public funnel, which genuinely has no tenant. A private org gets the thing this page had no
            route to instead: where the price of the next scan is written. */}
        {isPublicFunnel ? (
          "These are the shared public funnel's aggregate figures: per-org attribution activates with auth / the GitHub App."
        ) : (
          <>
            Figures are attributed to this organization.{" "}
            <a href="/pricing" className="focus-ring text-slate-400 underline decoration-slate-700 underline-offset-2 hover:text-white">
              See plans &amp; credit pricing
            </a>
            .
          </>
        )}
      </p>
    </div>
  );
}
