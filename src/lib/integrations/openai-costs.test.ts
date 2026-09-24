// @vitest-environment node
//
// The OpenAI Admin Costs client, driven only by the recorded fixture (openai-costs.fixture.ts).
// No test reaches api.openai.com: `fetchImpl` is injected, and `sleep` is injected so a 429 backoff
// costs no wall-clock time.
//
// The rule these pin hardest: a pull that stopped early (page cap, rate limit, outage) is NEVER
// reported complete. Only OpenAI's own `has_more: false` makes a window complete.

import { describe, expect, it, vi } from "vitest";
import {
  COSTS_MAX_PAGES,
  COSTS_PAGE_BUCKETS,
  buildOpenAIUsage,
  costsWindowStart,
  fetchOpenAICosts,
  type OpenAICostsPage,
} from "./openai-costs";
import { COSTS_PAGE_1, COSTS_PAGE_2, FIXTURE_START } from "./openai-costs.fixture";

const KEY = "sk-admin-fixture-not-a-real-key";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function scripted(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("unscripted fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const noSleep = vi.fn(async () => {});

describe("fetchOpenAICosts: pagination", () => {
  it("follows next_page to the end and reports the window complete", async () => {
    const { fetchImpl, calls } = scripted(json(COSTS_PAGE_1), json(COSTS_PAGE_2));
    const pull = await fetchOpenAICosts(KEY, { startTime: FIXTURE_START, fetchImpl, sleep: noSleep });
    expect(pull).toMatchObject({ complete: true, stop: null, pages: 2 });
    expect(pull.buckets).toHaveLength(3);
    const first = new URL(calls[0]!.url);
    expect(first.origin + first.pathname).toBe("https://api.openai.com/v1/organization/costs");
    expect(first.searchParams.get("start_time")).toBe(String(FIXTURE_START));
    expect(first.searchParams.get("bucket_width")).toBe("1d");
    expect(first.searchParams.get("limit")).toBe(String(COSTS_PAGE_BUCKETS));
    expect(first.searchParams.get("page")).toBeNull();
    expect(new URL(calls[1]!.url).searchParams.get("page")).toBe(COSTS_PAGE_1.next_page);
    // The admin key travels only as the bearer header, never in the URL.
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(calls.every((c) => !c.url.includes(KEY))).toBe(true);
  });

  it("passes a project filter as repeated project_ids", async () => {
    const { fetchImpl, calls } = scripted(json(COSTS_PAGE_2));
    await fetchOpenAICosts(KEY, { startTime: FIXTURE_START, projectIds: ["proj_a", "proj_b"], fetchImpl, sleep: noSleep });
    expect(new URL(calls[0]!.url).searchParams.getAll("project_ids")).toEqual(["proj_a", "proj_b"]);
  });

  it("stops at the page cap and reports it as PARTIAL, keeping what it read", async () => {
    const endless: OpenAICostsPage = { ...COSTS_PAGE_1, has_more: true, next_page: "page_next" };
    const { fetchImpl, calls } = scripted(...Array.from({ length: COSTS_MAX_PAGES + 2 }, () => json(endless)));
    const pull = await fetchOpenAICosts(KEY, { startTime: FIXTURE_START, fetchImpl, sleep: noSleep });
    expect(calls).toHaveLength(COSTS_MAX_PAGES);
    expect(pull).toMatchObject({ complete: false, stop: "page-cap", pages: COSTS_MAX_PAGES });
    expect(pull.buckets.length).toBe(COSTS_MAX_PAGES * 2);
  });

  it("treats has_more without a cursor as malformed, not as the end of the window", async () => {
    const { fetchImpl } = scripted(json({ ...COSTS_PAGE_1, next_page: null }));
    const pull = await fetchOpenAICosts(KEY, { startTime: FIXTURE_START, fetchImpl, sleep: noSleep });
    expect(pull).toMatchObject({ complete: false, stop: "malformed", pages: 1 });
  });
});

describe("fetchOpenAICosts: rate limits and failures are typed and bounded", () => {
  it("waits out a 429 (Retry-After, capped) and continues", async () => {
    const sleep = vi.fn(async () => {});
    const { fetchImpl } = scripted(json({}, 429, { "retry-after": "2" }), json(COSTS_PAGE_2));
    const pull = await fetchOpenAICosts(KEY, { startTime: FIXTURE_START, fetchImpl, sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(pull).toMatchObject({ complete: true, stop: null });
  });

  it("caps a huge Retry-After so one sync cannot sleep past its route budget", async () => {
    const sleep = vi.fn(async () => {});
    const { fetchImpl } = scripted(json({}, 429, { "retry-after": "3600" }), json(COSTS_PAGE_2));
    await fetchOpenAICosts(KEY, { startTime: FIXTURE_START, fetchImpl, sleep });
    expect(sleep.mock.calls[0]![0]).toBeLessThanOrEqual(5000);
  });

  it("gives up after its retry budget and reports rate-limited PARTIAL with the pages it had", async () => {
    const { fetchImpl } = scripted(json(COSTS_PAGE_1), json({}, 429), json({}, 429), json({}, 429));
    const pull = await fetchOpenAICosts(KEY, { startTime: FIXTURE_START, fetchImpl, sleep: noSleep });
    expect(pull).toMatchObject({ complete: false, stop: "rate-limited", pages: 1 });
    expect(pull.buckets).toHaveLength(2);
  });

  it.each([
    [401, "denied"],
    [403, "denied"],
    [500, "unreachable"],
  ] as const)("maps HTTP %i to %s", async (status, stop) => {
    const { fetchImpl } = scripted(json({ error: { message: "nope" } }, status));
    const pull = await fetchOpenAICosts(KEY, { startTime: FIXTURE_START, fetchImpl, sleep: noSleep });
    expect(pull).toMatchObject({ complete: false, stop, pages: 0, buckets: [] });
  });

  it("maps a thrown fetch (timeout, DNS) to unreachable", async () => {
    const { fetchImpl } = scripted(new Error("The operation was aborted due to timeout"));
    const pull = await fetchOpenAICosts(KEY, { startTime: FIXTURE_START, fetchImpl, sleep: noSleep });
    expect(pull).toMatchObject({ complete: false, stop: "unreachable" });
  });

  it("bounds every request with a timeout signal", async () => {
    const { fetchImpl, calls } = scripted(json(COSTS_PAGE_2));
    await fetchOpenAICosts(KEY, { startTime: FIXTURE_START, fetchImpl, sleep: noSleep });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("buildOpenAIUsage: fixture buckets become org-scope allocated day records with real cost", () => {
  const buckets = [...COSTS_PAGE_1.data!, ...COSTS_PAGE_2.data!];

  it("sums a day's results in dollars, then rounds once to cents", () => {
    const { records } = buildOpenAIUsage("Acme", buckets);
    expect(records.map((r) => r.costCents)).toEqual([129, 1250, 0]);
    expect(records.every((r) => r.source === "openai" && r.scope === "org" && r.scopeKey === "acme")).toBe(true);
    expect(records.every((r) => r.fidelity === "allocated" && r.tokens === 0 && r.seats === 0)).toBe(true);
    expect(records[0]!.periodStart.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("reports the covered span from the first bucket's start to the last bucket's end", () => {
    const { from, through } = buildOpenAIUsage("acme", buckets);
    expect(from?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(through?.toISOString()).toBe("2026-08-04T00:00:00.000Z");
  });

  it("accepts the spec schema's `result` spelling and a numeric-string amount", () => {
    const { records } = buildOpenAIUsage("acme", [
      { start_time: FIXTURE_START, end_time: FIXTURE_START + 86_400, result: [{ amount: { value: "3.10", currency: "usd" } }] },
    ]);
    expect(records[0]!.costCents).toBe(310);
  });

  it("never converts a non-USD amount; it counts it as skipped instead", () => {
    const { records, skippedNonUsd } = buildOpenAIUsage("acme", [
      {
        start_time: FIXTURE_START,
        end_time: FIXTURE_START + 86_400,
        results: [
          { amount: { value: 2, currency: "usd" } },
          { amount: { value: 9, currency: "eur" } },
        ],
      },
    ]);
    expect(records[0]!.costCents).toBe(200);
    expect(skippedNonUsd).toBe(1);
  });

  it("drops a bucket with no usable start time rather than filing it under the epoch", () => {
    const { records } = buildOpenAIUsage("acme", [{ results: [{ amount: { value: 5, currency: "usd" } }] }]);
    expect(records).toEqual([]);
  });
});

describe("costsWindowStart", () => {
  it("starts at a UTC midnight, the requested number of days back including today", () => {
    const now = Date.UTC(2026, 8, 24, 15, 30);
    expect(new Date(costsWindowStart(now, 3) * 1000).toISOString()).toBe("2026-09-22T00:00:00.000Z");
  });
});
