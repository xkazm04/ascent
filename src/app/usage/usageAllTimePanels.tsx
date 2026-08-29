import { Surface } from "@/components/ui";
import type { QuotaEventTotals } from "@/lib/db";

/* Abuse & limits (QUOTA-6): how often the free funnel's guardrails fired — monthly-quota
   denials + rate-limit trips. All-time counters; public view only. */
export function AbuseLimitsPanel({ quotaEvents }: { quotaEvents: QuotaEventTotals | null }) {
  if (!quotaEvents || quotaEvents.total <= 0) return null;
  return (
    <Surface className="mt-6 p-6">
      <h2 className="text-base font-semibold text-white">
        Abuse &amp; limits <span className="font-normal text-slate-500">· free-funnel guardrails · all time</span>
      </h2>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="font-mono text-sm uppercase tracking-widest text-slate-500">Monthly-quota denials</div>
          <div className="mt-2 space-y-1.5 text-base">
            {quotaEvents.quotaDenies.length === 0 ? (
              <p className="text-slate-500">None. No one&apos;s hit the monthly free-scan cap.</p>
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
        these are the durable signals (monthly-quota denials + rate-limit trips).
      </p>
    </Surface>
  );
}
