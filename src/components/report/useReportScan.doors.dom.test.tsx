// @vitest-environment jsdom
//
// useReportScan's two peeks degrade by design, and the door sweep kept both degrades exactly: a
// failed CACHE peek (thrown, or a 200 whose body cannot be read) falls through to the live SSE scan,
// and a failed quota SALVAGE peek falls through to the blocked wall. What changed is that neither is
// silent any more — each reaches a console.warn naming the read, so a broken cache tier is no longer
// indistinguishable from an honest miss. Pinned per site, with the quiet twins pinned too: a genuine
// miss (204) warns nothing, and an unmount mid-peek (the cleanup aborts it, so the fetch rejects with
// an AbortError) is a cancel, not a failure — no warn, no further request.
//
// Fetch/SSE stubbing follows useReportScan.dom.test.tsx and useReportScan.persist.dom.test.tsx.

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { act } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { useReportScan } from "./useReportScan";

function validReport(owner = "acme", name = "app"): Record<string, unknown> {
  return {
    repo: { owner, name, url: `https://github.com/${owner}/${name}`, stars: 42 },
    level: { id: "L3", name: "Practicing", description: "desc" },
    posture: { label: "AI-native", blurb: "blurb" },
    engine: { provider: "anthropic", model: "claude" },
    aiUsage: { detected: true, commitFraction: 0.3 },
    overallScore: 71,
    adoptionScore: 60,
    rigorScore: 80,
    confidence: 0.9,
    headline: "A solid repo",
    archetype: "product",
    scannedAt: "2026-06-18T00:00:00.000Z",
    strengths: ["s1"],
    risks: ["r1"],
    dimensions: [
      {
        id: "D1",
        name: "Dim One",
        score: 70,
        signalScore: 65,
        llmScore: 75,
        weight: 0.2,
        summary: "ok",
        evidence: ["e1"],
        strengths: ["ds1"],
        gaps: ["g1"],
      },
    ],
    contributors: [{ login: "alice", commits: 10, aiCommits: 3 }],
    roadmap: [{ title: "Do X", dimension: "D1", impact: "high", effort: "low" }],
    discrepancies: [],
  };
}

type Handler = (init?: RequestInit) => Response | Promise<Response>;
/** `peek` = the cache peek (peek=1&recent=1), `salvage` = the quota salvage (peek=1&latest=1). */
let routes: { peek?: Handler; salvage?: Handler; stream?: Handler };
let calls: string[];

function stubFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      const h = url.startsWith("/api/scan/stream")
        ? routes.stream
        : url.includes("peek=1&latest=1")
          ? routes.salvage
          : routes.peek;
      if (!h) throw new Error(`unexpected fetch ${url}`);
      return h(init);
    }),
  );
}

const NETWORK = new TypeError("Failed to fetch");
const BAD_BODY = new SyntaxError("Unexpected end of JSON input");
const thrown: Handler = () => {
  throw NETWORK;
};
const reply = (status: number, json: () => Promise<unknown>, headers: Record<string, string> = {}) =>
  ({ ok: status >= 200 && status < 300, status, body: null, headers: new Headers(headers), json }) as unknown as Response;
/** A genuine cache miss / nothing saved. */
const miss: Handler = () => reply(204, async () => null);
/** A 200 whose body cannot be read (truncated / not JSON). */
const unreadable = (headers: Record<string, string> = {}): Handler => () =>
  reply(200, () => Promise.reject(BAD_BODY), headers);
/** The live stream answers with one `result` frame and closes. */
const liveResult: Handler = () => {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(`event: result\ndata: ${JSON.stringify(validReport())}\n\n`));
      c.close();
    },
  });
  return { ok: true, status: 200, body, headers: new Headers(), json: async () => null } as unknown as Response;
};
/** The pre-stream monthly-quota refusal that triggers the salvage peek. */
const quotaRefusal: Handler = () =>
  reply(429, async () => ({ error: "Out of free scans.", code: "monthly_quota", scope: "user", resetAt: 1 }));
/** Never answers; rejects with an AbortError when the hook's cleanup aborts — what a real fetch does.
 *  `aborts` counts delivered rejections, so a cancel twin cannot pass by never reaching the catch. */
let aborts = 0;
const hangUntilAbort: Handler = (init) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => {
      aborts += 1;
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });

let warn: MockInstance<typeof console.warn>;
const reportWarns = () => warn.mock.calls.filter((c) => String(c[0]).startsWith("[report]"));
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

beforeEach(() => {
  // A leftover resume anchor would make the hook skip the cache peek (it "rejoins" instead).
  window.sessionStorage.clear();
  routes = {};
  aborts = 0;
  stubFetch();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useReportScan doors — the cache peek", () => {
  it("a thrown peek falls through to the live scan and warns naming the read", async () => {
    routes = { peek: thrown, stream: liveResult };
    const { result } = renderHook(() => useReportScan("acme/app", false));

    await waitFor(() => expect(result.current.state.status).toBe("done"));
    // The degrade is unchanged: a MISS by degradation — the stream ran and its report is what renders.
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("peek=1&recent=1");
    expect(calls[1]).toBe("/api/scan/stream");
    expect(warn).toHaveBeenCalledWith("[report] cache peek failed; running a live scan:", NETWORK);
  });

  it("a 200 peek whose body is unreadable reads as a miss: warned, then the live scan runs", async () => {
    routes = { peek: unreadable({ "x-ascent-cache": "hit-db" }), stream: liveResult };
    const { result } = renderHook(() => useReportScan("acme/app", false));

    await waitFor(() => expect(result.current.state.status).toBe("done"));
    expect(calls[1]).toBe("/api/scan/stream");
    expect(warn).toHaveBeenCalledWith("[report] cache peek body unreadable; treating it as a miss:", BAD_BODY);
    // It is the BODY door, not the thrown-fetch one — the fetch itself succeeded.
    expect(reportWarns().some((c) => String(c[0]).startsWith("[report] cache peek failed"))).toBe(false);
    // The hit-db header belonged to a body nobody could read: this is the stream's (non-durable) report.
    expect(result.current.persisted).toBe(false);
  });

  it("twin: a genuine miss (204) runs the live scan with NO warn", async () => {
    routes = { peek: miss, stream: liveResult };
    const { result } = renderHook(() => useReportScan("acme/app", false));

    await waitFor(() => expect(result.current.state.status).toBe("done"));
    expect(calls[1]).toBe("/api/scan/stream");
    expect(reportWarns()).toEqual([]);
  });

  it("twin: unmounting mid-peek aborts it — a cancel, not a failure: NO warn and no live scan", async () => {
    routes = { peek: hangUntilAbort, stream: liveResult };
    const { unmount } = renderHook(() => useReportScan("acme/app", false));

    await waitFor(() => expect(calls).toHaveLength(1));
    unmount();
    await settle();
    expect(aborts).toBe(1); // the peek DID reject into the hook's catch…
    expect(reportWarns()).toEqual([]); // …which saw the cancel and stayed quiet
    expect(calls).toHaveLength(1);
  });
});

describe("useReportScan doors — the quota salvage peek", () => {
  /** `initialFresh` skips the cache peek, so the 429 is the first answer and the salvage the second. */
  const runScan = () => renderHook(() => useReportScan("acme/app", true));

  async function blockedWall(result: ReturnType<typeof runScan>["result"]) {
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    const state = result.current.state;
    if (state.status !== "error") throw new Error("expected an error state");
    return state;
  }

  it("a thrown salvage peek shows the quota wall and warns naming the read", async () => {
    routes = { stream: quotaRefusal, salvage: thrown };
    const { result } = runScan();

    const state = await blockedWall(result);
    expect(state.blocked).toEqual({ scope: "user", resetAt: 1 });
    expect(state.message).toBe("Out of free scans.");
    expect(calls.some((u) => u.includes("peek=1&latest=1"))).toBe(true);
    expect(warn).toHaveBeenCalledWith("[report] salvage peek failed; showing the quota wall:", NETWORK);
  });

  it("a stale 200 salvage whose body is unreadable shows the same wall, warned as unreadable", async () => {
    routes = { stream: quotaRefusal, salvage: unreadable({ "x-ascent-stale": "true" }) };
    const { result } = runScan();

    const state = await blockedWall(result);
    expect(state.blocked).toEqual({ scope: "user", resetAt: 1 });
    expect(warn).toHaveBeenCalledWith("[report] salvage peek body unreadable; treating it as a miss:", BAD_BODY);
  });

  it("twin: nothing saved to salvage (204) shows the same wall with NO warn", async () => {
    routes = { stream: quotaRefusal, salvage: miss };
    const { result } = runScan();

    const state = await blockedWall(result);
    expect(state.blocked).toEqual({ scope: "user", resetAt: 1 });
    expect(reportWarns()).toEqual([]);
  });

  it("twin: unmounting mid-salvage aborts it — NO warn", async () => {
    routes = { stream: quotaRefusal, salvage: hangUntilAbort };
    const { result, unmount } = runScan();

    await waitFor(() => expect(calls.some((u) => u.includes("peek=1&latest=1"))).toBe(true));
    expect(result.current.state.status).toBe("loading");
    unmount();
    await settle();
    expect(aborts).toBe(1);
    expect(reportWarns()).toEqual([]);
  });
});
