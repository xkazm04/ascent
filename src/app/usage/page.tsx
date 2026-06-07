import { SiteFooter, SiteHeader } from "@/components/Brand";
import { EmptyState } from "@/components/EmptyState";
import { SignInNotice } from "@/components/SignInNotice";
import { UsageTrend } from "@/components/usage/UsageTrend";
import { getUsageSummary, isDbConfigured, type UsageSummary } from "@/lib/db";
import { getActiveOrg, getSessionState, isAuthConfigured } from "@/lib/auth";
import { timeAgo } from "@/lib/ui";

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
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-3xl font-bold tabular-nums text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; days?: string }>;
}) {
  const { org: orgParam, days: daysParam } = await searchParams;
  const days = Math.min(365, Math.max(1, Number(daysParam) || 30));

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
  let usage: UsageSummary | null;
  try {
    usage = await getUsageSummary(org, days);
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

  const billable = usage.privateScans; // public scans are free; private are metered

  return (
    <Shell>
      <div className="animate-fade-up">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">Usage &amp; metering</div>
        <h1 className="mt-1 text-2xl font-bold text-white">
          Organization: <span className="font-mono">{usage.org}</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Each computed scan is one metered unit (cached re-scans aren&apos;t recounted). Public
          scans are free; private scans are billable under the usage-based plan.
        </p>

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

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
            <h2 className="text-sm font-semibold text-white">
              Public vs private{" "}
              <span className="font-normal text-slate-500">· last {usage.periodDays}d</span>
            </h2>
            <div className="mt-3 space-y-2 text-sm">
              <Bar label="Public (free)" value={usage.publicScans} total={usage.periodScans} color="#94a3b8" pattern />
              <Bar label="Private (billable)" value={usage.privateScans} total={usage.periodScans} color="var(--color-accent)" />
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
            <h2 className="text-sm font-semibold text-white">
              By inference engine{" "}
              <span className="font-normal text-slate-500">· last {usage.periodDays}d</span>
            </h2>
            <div className="mt-3 space-y-2 text-sm">
              {usage.byProvider.length === 0 ? (
                <p className="text-slate-500">No scans in this period.</p>
              ) : (
                usage.byProvider.map((p) => (
                  <Bar key={p.provider} label={p.provider} value={p.count} total={usage.periodScans} color="var(--color-accent)" />
                ))
              )}
            </div>
          </div>
        </div>

        <p className="mt-6 text-xs text-slate-500">
          Window: {usage.firstScanAt ? `${timeAgo(usage.firstScanAt)} → ${timeAgo(usage.lastScanAt ?? undefined)}` : "no scans recorded"}.
          Per-scan rate is TBD; per-org attribution activates with auth / the GitHub App.
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
          {value} · {pct}%
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
