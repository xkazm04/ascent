// Public-funnel abuse observability (QUOTA-6). A running tally per (kind, scope) bumped fire-and-forget
// when the free funnel pushes back — a monthly-quota denial or a rate-limit trip. Read back on the public
// /usage view so an operator can see how often the guardrails fire (and whether a limit needs tuning).
// Best-effort by design: a failed write must never break the path that's already rejecting a request.
// No-op / null when persistence is off, like the rest of src/lib/db.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { bumpCounter } from "@/lib/db/best-effort";

export type QuotaEventKind =
  | "quota_deny"
  | "rate_limit"
  // Scan-outcome tallies (KPI: scan pipeline error rate). A failed scan writes no Scan row — the table
  // only holds successes — so without these counters a pipeline failure burns quota and LLM spend and
  // leaves no trace at all. Classified and emitted by src/lib/scan-outcome.ts.
  | "scan_started"
  | "scan_rejected"
  | "scan_failed"
  | "scan_degraded";

/** The two abuse kinds the public /usage view reports on. Kept explicit so the scan-outcome kinds
 *  above never leak into that panel's counts (its `total` gates whether the panel renders at all). */
const ABUSE_KINDS = ["quota_deny", "rate_limit"];

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
  /** Monthly (rolling 30-day) free-scan denials, by scope (anon / signed-in). */
  quotaDenies: { scope: string; count: number }[];
  /** Per-minute rate-limit trips, by limiter name (badge, …). */
  rateLimitTrips: { scope: string; count: number }[];
  /** All counted events. */
  total: number;
}

/** All-time abuse counters (small table, few rows). Null when persistence is off. */
export async function getQuotaEventTotals(): Promise<QuotaEventTotals | null> {
  if (!isDbConfigured()) return null;
  const rows = await getPrisma().quotaEvent.findMany({
    where: { kind: { in: ABUSE_KINDS } },
    orderBy: { count: "desc" },
  });
  return {
    quotaDenies: rows.filter((r) => r.kind === "quota_deny").map((r) => ({ scope: r.scope, count: r.count })),
    rateLimitTrips: rows.filter((r) => r.kind === "rate_limit").map((r) => ({ scope: r.scope, count: r.count })),
    total: rows.reduce((a, r) => a + r.count, 0),
  };
}
