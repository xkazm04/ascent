// @vitest-environment jsdom
//
// A per-minute limiter refusal (429 `rate_limited` / `rate_limit_unavailable`) is classified as
// `throttled`, not left as the generic error whose only action is an immediate retry that re-trips
// the same window. The monthly quota keeps its salvage path (guard), and a throttled RE-TEST keeps the
// report mounted and resumes in rescan mode.
//
// Fetch/SSE stubbing follows useReportScan.doors.dom.test.tsx.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { useReportScan } from "./useReportScan";
import { isTransientScanError } from "./ReportRescanAlert";

const validReport = () => ({
  repo: { owner: "acme", name: "app", url: "https://github.com/acme/app", stars: 1 },
  level: { id: "L3", name: "Practicing", description: "d" },
  posture: { label: "AI-native", blurb: "b" },
  engine: { provider: "anthropic", model: "claude" },
  aiUsage: { detected: true, commitFraction: 0.3 },
  overallScore: 71,
  adoptionScore: 60,
  rigorScore: 80,
  confidence: 0.9,
  headline: "h",
  archetype: "product",
  scannedAt: "2026-06-18T00:00:00.000Z",
  strengths: ["s1"],
  risks: ["r1"],
  dimensions: [
    { id: "D1", name: "Dim One", score: 70, signalScore: 65, llmScore: 75, weight: 0.2, summary: "ok", evidence: ["e1"], strengths: ["ds1"], gaps: ["g1"] },
  ],
  contributors: [{ login: "alice", commits: 10, aiCommits: 3 }],
  roadmap: [{ title: "Do X", dimension: "D1", impact: "high", effort: "low" }],
  discrepancies: [],
});

type Handler = () => Response;
let streamQueue: Handler[];
let calls: string[];

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({ ok: status < 300, status, body: null, headers: new Headers(headers), json: async () => body }) as unknown as Response;
const liveResult: Handler = () => {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(`event: result\ndata: ${JSON.stringify(validReport())}\n\n`));
      c.close();
    },
  });
  return { ok: true, status: 200, body, headers: new Headers(), json: async () => null } as unknown as Response;
};
const globalThrottle: Handler = () =>
  reply(429, { error: "Rate limit exceeded.", code: "rate_limited", scope: "global", limiter: "scan", retryAfterSec: 20 }, { "retry-after": "20" });

beforeEach(() => {
  window.sessionStorage.clear();
  calls = [];
  streamQueue = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("/api/scan/stream")) {
        const h = streamQueue.shift();
        if (!h) throw new Error("unexpected stream call");
        return h();
      }
      if (url.includes("peek=1&latest=1")) return reply(204, null);
      return reply(204, null); // cache peek miss
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useReportScan - a per-minute 429 is a throttle, not a generic failure", () => {
  it("classifies a global rate_limited refusal and offers no immediate retry", async () => {
    streamQueue = [globalThrottle];
    const { result } = renderHook(() => useReportScan("acme/app", true));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    const s = result.current.state;
    if (s.status !== "error") throw new Error("expected error");
    expect(s.throttled).toMatchObject({ scope: "global", limiter: "scan" });
    expect(s.throttled!.retryAt).toBeGreaterThan(Date.now() + 15_000);
    expect(s.message).not.toMatch(/Scan failed \(429\)/);
    expect(isTransientScanError(s)).toBe(false);
    // No salvage peek for a throttle: that path belongs to the monthly quota.
    expect(calls.some((u) => u.includes("peek=1&latest=1"))).toBe(false);
  });

  it("an unreadable 429 body still classifies from the retry-after header", async () => {
    streamQueue = [() => ({ ...reply(429, null, { "retry-after": "12" }), json: () => Promise.reject(new SyntaxError("x")) }) as unknown as Response];
    const { result } = renderHook(() => useReportScan("acme/app", true));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    const s = result.current.state;
    expect(s.status === "error" && s.throttled?.scope).toBe("unknown");
  });

  it("guard: a monthly_quota 429 still runs the latest=1 salvage peek and lands blocked", async () => {
    streamQueue = [() => reply(429, { error: "Out.", code: "monthly_quota", scope: "user", resetAt: 1 })];
    const { result } = renderHook(() => useReportScan("acme/app", true));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    const s = result.current.state;
    if (s.status !== "error") throw new Error("expected error");
    expect(s.blocked).toEqual({ scope: "user", resetAt: 1 });
    expect(s.throttled).toBeUndefined();
    expect(calls.some((u) => u.includes("peek=1&latest=1"))).toBe(true);
  });

  it("a throttled re-test keeps the report mounted, and resuming re-runs it in rescan mode", async () => {
    streamQueue = [liveResult, globalThrottle, liveResult];
    const { result } = renderHook(() => useReportScan("acme/app", true));
    await waitFor(() => expect(result.current.state.status).toBe("done"));

    act(() => result.current.retest());
    await waitFor(() => expect(result.current.rescan.errorClass.throttled).toBeDefined());
    expect(result.current.state.status).toBe("done"); // never blanked
    expect(result.current.autoResumes).toBe(0);

    act(() => result.current.resumeThrottled(true));
    expect(result.current.state.status).toBe("done");
    await waitFor(() => expect(result.current.rescan).toEqual({ active: false, error: null, errorClass: {} }));
    expect(result.current.autoResumes).toBe(1);
    expect(calls.filter((u) => u.startsWith("/api/scan/stream"))).toHaveLength(3);
  });

  it("a manual resume does not spend an automatic one", async () => {
    streamQueue = [globalThrottle, liveResult];
    const { result } = renderHook(() => useReportScan("acme/app", true));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    act(() => result.current.resumeThrottled(false));
    await waitFor(() => expect(result.current.state.status).toBe("done"));
    expect(result.current.autoResumes).toBe(0);
  });
});
