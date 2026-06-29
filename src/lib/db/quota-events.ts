// Public-funnel abuse observability (QUOTA-6). A running tally per (kind, scope) bumped fire-and-forget
// when the free funnel pushes back — a weekly-quota denial or a rate-limit trip. Read back on the public
// /usage view so an operator can see how often the guardrails fire (and whether a limit needs tuning).
// Best-effort by design: a failed write must never break the path that's already rejecting a request.
// No-op / null when persistence is off, like the rest of src/lib/db.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { bumpCounter } from "@/lib/db/best-effort";

export type QuotaEventKind = "quota_deny" | "rate_limit";

/** Best-effort: bump the (kind, scope) tally. Swallows every error. */
export async function recordQuotaEvent(kind: QuotaEventKind, scope: string): Promise<void> {
  const s = (scope || "unknown").toLowerCase().slice(0, 60);
  await bumpCounter(() =>
    getPrisma().quotaEvent.upsert({
      where: { kind_scope: { kind, scope: s } },
      update: { count: { increment: 1 }, lastSeen: new Date() },
      create: { kind, scope: s, count: 1 },
    }),
  );
}

export interface QuotaEventTotals {
  /** Weekly free-scan denials, by scope (anon / signed-in). */
  quotaDenies: { scope: string; count: number }[];
  /** Per-minute rate-limit trips, by limiter name (badge, …). */
  rateLimitTrips: { scope: string; count: number }[];
  /** All counted events. */
  total: number;
}

/** All-time abuse counters (small table, few rows). Null when persistence is off. */
export async function getQuotaEventTotals(): Promise<QuotaEventTotals | null> {
  if (!isDbConfigured()) return null;
  const rows = await getPrisma().quotaEvent.findMany({ orderBy: { count: "desc" } });
  return {
    quotaDenies: rows.filter((r) => r.kind === "quota_deny").map((r) => ({ scope: r.scope, count: r.count })),
    rateLimitTrips: rows.filter((r) => r.kind === "rate_limit").map((r) => ({ scope: r.scope, count: r.count })),
    total: rows.reduce((a, r) => a + r.count, 0),
  };
}
