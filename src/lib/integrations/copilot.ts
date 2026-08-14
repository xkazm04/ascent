// GitHub Copilot connector (W3b) — seats and engagement from the Copilot Metrics + Billing APIs.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS CONNECTOR DOES NOT REPORT: COST.
//
// The Copilot Metrics API (`GET /orgs/{org}/copilot/metrics`) returns activity — active users,
// engaged users, per-feature engagement. The billing endpoint returns SEAT COUNTS. Neither returns
// money: GitHub does not expose the org's negotiated per-seat price through the API, and enterprise
// agreements vary. So this connector stores `costCents: 0`, and 0 here means **not reported**, never
// "spent nothing".
//
// That distinction is load-bearing, and getting it wrong would be worse than having no connector at
// all: the ROI model's allocated branch divides an org total across repos by git weight, so a
// zero-cost allocated source would have rendered every repository as "$0 spend / shadow AI" — a
// confident, connected-looking, entirely fabricated answer. `OrgUsageRollup.hasAllocatedCost` exists
// precisely to keep this connector out of that branch.
//
// The honest value it DOES add: seats and engaged-user counts are real, they are what a Copilot org
// is actually billed on, and "42 seats, 11 engaged users" is a true and useful sentence.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

import type { UsageRecordInput } from "@/lib/db";

/** The slice of `GET /orgs/{org}/copilot/billing/seats` this reads. */
export interface CopilotSeatsResponse {
  total_seats?: number;
}

/** One day from `GET /orgs/{org}/copilot/metrics`. Only the fields we can honestly use. */
export interface CopilotMetricsDay {
  date?: string;
  total_active_users?: number;
  total_engaged_users?: number;
}

export interface CopilotSyncInput {
  seats: CopilotSeatsResponse | null;
  metrics: CopilotMetricsDay[];
}

/** UTC day-bucket start for an ISO `YYYY-MM-DD`, or null when unparseable. */
function dayStart(date: string | undefined): Date | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * Map a Copilot pull into org-scoped usage records — one per day the metrics API reported.
 *
 * `seats` is a LEVEL, not a per-day measurement: the billing endpoint returns today's total, so it
 * is stamped on every day bucket and the rollup takes the peak (matching how `getOrgUsageRollup`
 * already treats seats). `sessions` carries engaged users, which is the closest honest analogue to
 * "attempts" this API offers — it is a count of humans, and the UI must never call it sessions.
 *
 * `costCents` is ALWAYS 0. See the module header: 0 means not reported.
 */
export function buildCopilotUsage(orgSlug: string, input: CopilotSyncInput): UsageRecordInput[] {
  const totalSeats = typeof input.seats?.total_seats === "number" ? Math.max(0, Math.round(input.seats.total_seats)) : 0;

  const out: UsageRecordInput[] = [];
  for (const day of input.metrics) {
    const periodStart = dayStart(day.date);
    if (!periodStart) continue; // a malformed day is dropped rather than bucketed to the epoch
    const engaged = typeof day.total_engaged_users === "number" ? Math.max(0, Math.round(day.total_engaged_users)) : 0;
    out.push({
      source: "copilot",
      scope: "org",
      scopeKey: orgSlug.toLowerCase(),
      periodStart,
      tokens: 0, // not reported by this API
      costCents: 0, // NOT REPORTED — never "free". See the module header.
      sessions: engaged,
      seats: totalSeats,
      fidelity: "allocated",
    });
  }
  return out;
}

/** What a sync attempt produced, for the route's response and the audit row. */
export interface CopilotSyncResult {
  days: number;
  seats: number;
  engagedPeak: number;
}

export function summarizeCopilotSync(records: UsageRecordInput[]): CopilotSyncResult {
  return {
    days: records.length,
    seats: records.reduce((n, r) => Math.max(n, r.seats ?? 0), 0),
    engagedPeak: records.reduce((n, r) => Math.max(n, r.sessions ?? 0), 0),
  };
}

const GH = "https://api.github.com";

/** One authenticated GitHub GET. Returns null on any non-2xx — the caller degrades, never throws. */
async function ghJson<T>(path: string, token: string): Promise<T | null> {
  try {
    const res = await fetch(`${GH}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Pull the org's Copilot seats + daily metrics.
 *
 * Both calls need an org-admin-scoped credential with `manage_billing:copilot` (or
 * `read:enterprise`). A 403 from either — the common case, since the Ascent App installation does
 * NOT carry Copilot admin scope by default — degrades that half to null rather than failing the
 * sync, so an org that can read metrics but not billing still gets its engagement data.
 */
export async function fetchCopilot(orgLogin: string, token: string): Promise<CopilotSyncInput> {
  const org = encodeURIComponent(orgLogin);
  const [seats, metrics] = await Promise.all([
    ghJson<CopilotSeatsResponse>(`/orgs/${org}/copilot/billing/seats`, token),
    ghJson<CopilotMetricsDay[]>(`/orgs/${org}/copilot/metrics`, token),
  ]);
  return { seats, metrics: Array.isArray(metrics) ? metrics : [] };
}
