import { Stat } from "./usagePanels";
import type { BadgeReach, QuotaEventTotals } from "@/lib/db";

/* Badge reach (USE-1): where the public README badge is embedded + how often it's fetched.
   Lower-bound — README badges are camo/CDN-cached, so most views never reach the origin. */
export function BadgeReachPanel({ badgeReach }: { badgeReach: BadgeReach | null }) {
  if (!badgeReach || badgeReach.totalImpressions <= 0) return null;
  return (
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
  );
}

/* Abuse & limits (QUOTA-6): how often the free funnel's guardrails fired — monthly-quota
   denials + rate-limit trips. All-time counters; public view only. */
export function AbuseLimitsPanel({ quotaEvents }: { quotaEvents: QuotaEventTotals | null }) {
  if (!quotaEvents || quotaEvents.total <= 0) return null;
  return (
    <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <h2 className="text-base font-semibold text-white">
        Abuse &amp; limits <span className="font-normal text-slate-500">· free-funnel guardrails · all time</span>
      </h2>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="font-mono text-sm uppercase tracking-widest text-slate-500">Monthly-quota denials</div>
          <div className="mt-2 space-y-1.5 text-base">
            {quotaEvents.quotaDenies.length === 0 ? (
              <p className="text-slate-500">None — no one&apos;s hit the monthly free-scan cap.</p>
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
        these are the durable signals (monthly-quota denials + the badge limiter).
      </p>
    </div>
  );
}
