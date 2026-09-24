// OpenAI Codex connector: org cost from the Admin Costs API (`GET /v1/organization/costs`).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS CONNECTOR REPORTS: MONEY, ABOVE REPO LEVEL.
//
// The Costs API returns daily buckets of real spend (USD), optionally filtered to projects. It does
// not know which repository a dollar was spent on, so every record here is `scope: "org"`,
// `fidelity: "allocated"`, and flows through the SAME rollup Copilot and the JSON ingest use
// (`getOrgUsageRollup` in src/lib/db/integrations.ts): an org-scope row with `costCents > 0` is what
// sets `hasAllocatedCost`, and the delivery model then distributes the org total across repos by
// git-attributed AI volume. No parallel rollup exists for this source, by design.
//
// It reports NO TOKENS (the Costs API returns amounts, not usage), so `tokens` is 0 and the catalog
// row does not claim token counts.
//
// PARTIAL IS A FIRST-CLASS OUTCOME. Pagination is bounded (`COSTS_MAX_PAGES`) and 429s get a bounded
// retry budget, so a pull can stop before OpenAI says the window is exhausted. `complete` is true ONLY
// when OpenAI returned `has_more: false`; every other exit names why it stopped (`stop`), and the sync
// route records that as a partial sync rather than as a complete window.
//
// THE ADMIN KEY is a high-value secret: it appears only in the Authorization header built here. It is
// never placed in a URL, never logged, never echoed into an error.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

import type { UsageRecordInput } from "@/lib/db";

export const OPENAI_API = "https://api.openai.com/v1";
/** Buckets per page (the API allows 1..180, default 7). 31 keeps each page to about a month. */
export const COSTS_PAGE_BUCKETS = 31;
/** Hard page cap per sync. 4 x 31 covers the 90-day window with one page to spare. */
export const COSTS_MAX_PAGES = 4;
/** Days pulled per sync, today included: the longest Delivery window. */
export const COSTS_WINDOW_DAYS = 90;
/** 429 retries across the WHOLE pull, not per page, so a throttled org cannot loop the route. */
export const COSTS_MAX_RETRIES = 2;
/** Upper bound on one Retry-After wait; the sync route has a 60 s budget. */
export const COSTS_RETRY_CAP_MS = 5_000;
/** Per-request budget covering headers AND body (the signal aborts the body stream too). */
export const COSTS_TIMEOUT_MS = 20_000;

export interface OpenAICostsAmount {
  value?: number | string;
  currency?: string;
}
export interface OpenAICostsResult {
  object?: string;
  amount?: OpenAICostsAmount;
  line_item?: string | null;
  project_id?: string | null;
}
/** One day bucket. The spec's schema says `result`, its example and the cookbook say `results`. */
export interface OpenAICostsBucket {
  object?: string;
  start_time?: number;
  end_time?: number;
  results?: OpenAICostsResult[];
  result?: OpenAICostsResult[];
}
export interface OpenAICostsPage {
  object?: string;
  data?: OpenAICostsBucket[];
  has_more?: boolean;
  next_page?: string | null;
}

/** Why a pull yielded less than the whole window. Typed, so the route answers from fact. */
export type OpenAIFailure = "denied" | "rate-limited" | "unreachable" | "malformed";
export type OpenAIStop = "page-cap" | OpenAIFailure;

export interface OpenAICostsPull {
  buckets: OpenAICostsBucket[];
  /** Pages successfully read. */
  pages: number;
  /** True only when OpenAI itself said the window is exhausted (`has_more: false`). */
  complete: boolean;
  /** Why the pull stopped short; null exactly when `complete`. */
  stop: OpenAIStop | null;
}

export interface FetchCostsOptions {
  /** Unix seconds, inclusive. */
  startTime: number;
  /** Restrict to these OpenAI projects; empty/absent = every project in the organization. */
  projectIds?: readonly string[];
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** UTC midnight `days - 1` days before `now`, in unix seconds: a window of `days` buckets ending today. */
export function costsWindowStart(now: number, days = COSTS_WINDOW_DAYS): number {
  const today = Math.floor(now / 86_400_000) * 86_400;
  return today - (days - 1) * 86_400;
}

function costsUrl(startTime: number, projectIds: readonly string[], page: string | null): string {
  const q = new URLSearchParams({ start_time: String(startTime), bucket_width: "1d", limit: String(COSTS_PAGE_BUCKETS) });
  for (const p of projectIds) q.append("project_ids", p);
  if (page) q.set("page", page);
  return `${OPENAI_API}/organization/costs?${q.toString()}`;
}

function retryAfterMs(res: Response): number {
  const s = Number(res.headers.get("retry-after"));
  const ms = Number.isFinite(s) && s > 0 ? s * 1000 : 1000;
  return Math.min(ms, COSTS_RETRY_CAP_MS);
}

/** Pull the cost buckets from `startTime` to now. Never throws; a short pull says why it stopped. */
export async function fetchOpenAICosts(adminKey: string, opts: FetchCostsOptions): Promise<OpenAICostsPull> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const projectIds = opts.projectIds ?? [];
  const buckets: OpenAICostsBucket[] = [];
  const short = (stop: OpenAIStop): OpenAICostsPull => ({ buckets, pages, complete: false, stop });
  let pages = 0;
  let retries = 0;
  let cursor: string | null = null;

  while (pages < COSTS_MAX_PAGES) {
    let body: OpenAICostsPage;
    try {
      const res = await doFetch(costsUrl(opts.startTime, projectIds, cursor), {
        headers: { authorization: `Bearer ${adminKey}`, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(COSTS_TIMEOUT_MS),
      });
      if (res.status === 429) {
        if (retries >= COSTS_MAX_RETRIES) return short("rate-limited");
        retries++;
        await sleep(retryAfterMs(res));
        continue;
      }
      if (!res.ok) return short(res.status === 401 || res.status === 403 ? "denied" : "unreachable");
      body = (await res.json()) as OpenAICostsPage;
    } catch {
      // A timeout, a reset, or a body that is not JSON. None of it is the operator's fault.
      return short("unreachable");
    }
    if (!body || !Array.isArray(body.data)) return short("malformed");
    pages++;
    buckets.push(...body.data);
    if (body.has_more !== true) return { buckets, pages, complete: true, stop: null };
    // "There is more" without a cursor cannot be followed; calling it the end would record a
    // truncated window as complete.
    if (typeof body.next_page !== "string" || !body.next_page) return short("malformed");
    cursor = body.next_page;
  }
  return short("page-cap");
}

function dollars(amount: OpenAICostsAmount | undefined): number | null {
  const raw = amount?.value;
  const v = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isFinite(v) ? v : null;
}

export interface OpenAIUsageBuild {
  records: UsageRecordInput[];
  /** Results in a currency other than USD. Counted, never converted. */
  skippedNonUsd: number;
  /** Start of the first bucket stored, end of the last: the span this pull actually covers. */
  from: Date | null;
  through: Date | null;
}

/**
 * Cost buckets → one org-scope, allocated record per UTC day. A day's results are summed in dollars
 * and rounded to cents once, so ten sub-cent line items are not each rounded to zero. A day whose
 * `results` is empty is a real "$0 that day" (OpenAI reported the bucket) and is stored as such.
 */
export function buildOpenAIUsage(orgSlug: string, buckets: readonly OpenAICostsBucket[]): OpenAIUsageBuild {
  const byDay = new Map<number, number>();
  let skippedNonUsd = 0;
  let through = 0;
  for (const b of buckets) {
    if (typeof b.start_time !== "number" || !Number.isFinite(b.start_time) || b.start_time <= 0) continue;
    const day = Math.floor(b.start_time / 86_400) * 86_400_000;
    let sum = byDay.get(day) ?? 0;
    for (const r of b.results ?? b.result ?? []) {
      if ((r.amount?.currency ?? "").toLowerCase() !== "usd") {
        skippedNonUsd++;
        continue;
      }
      sum += dollars(r.amount) ?? 0;
    }
    byDay.set(day, sum);
    const end = typeof b.end_time === "number" && Number.isFinite(b.end_time) ? b.end_time * 1000 : day + 86_400_000;
    through = Math.max(through, end);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const records: UsageRecordInput[] = days.map((day) => ({
    source: "openai",
    scope: "org",
    scopeKey: orgSlug.toLowerCase(),
    periodStart: new Date(day),
    tokens: 0, // the Costs API reports money, not tokens
    costCents: Math.max(0, Math.round(byDay.get(day)! * 100)),
    sessions: 0,
    seats: 0,
    fidelity: "allocated",
  }));
  return {
    records,
    skippedNonUsd,
    from: days.length ? new Date(days[0]!) : null,
    through: days.length ? new Date(through) : null,
  };
}

/** What a sync produced, for the route's response and the audit row. Money only, never the key. */
export function summarizeOpenAISync(records: readonly UsageRecordInput[]): { days: number; costCents: number } {
  return { days: records.length, costCents: records.reduce((s, r) => s + (r.costCents ?? 0), 0) };
}
