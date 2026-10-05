// @vitest-environment jsdom
//
// The PRE-STREAM refusals of /api/scan/stream — the three JSON responses the scan hook can get back
// before any SSE frame exists (401 sign-in wall, 402 out-of-credits, 429 monthly quota). These are
// the branches that decide whether the user sees an actionable wall or a dead-end "Try again", and
// until now the hook had no tests at all: the 402 fell through to the generic error, so an org out
// of credits was told "Couldn't scan that repo" with a retry that re-trips the same gate.
//
// Every case runs with `initialFresh: true` so the hook skips its cache peek and the POST to
// /api/scan/stream is the first request — the refusal under test.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useReportScan } from "./useReportScan";

type Reply = { status: number; body: unknown; ok?: boolean };
/** URL → reply. `stream` is the POST; `peek` is the quota-salvage GET. */
let replies: { stream: Reply; peek?: Reply };
let calls: string[];

function stubFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const reply = url.startsWith("/api/scan/stream") ? replies.stream : (replies.peek ?? { status: 204, body: null });
      return {
        ok: reply.ok ?? (reply.status >= 200 && reply.status < 300),
        status: reply.status,
        // The hook's refusal branch is `!res.ok || !res.body` — a JSON refusal carries no stream.
        body: null,
        headers: new Headers(),
        json: async () => reply.body,
      } as unknown as Response;
    }),
  );
}

beforeEach(stubFetch);
afterEach(() => vi.unstubAllGlobals());

const runScan = () => renderHook(() => useReportScan("acme/app", true));

describe("useReportScan — pre-stream refusals", () => {
  it("402 INSUFFICIENT_CREDITS becomes a credits-classified error carrying the balance", async () => {
    replies = {
      stream: {
        status: 402,
        body: {
          error: "This organization is out of private-scan credits. Add credits to continue.",
          code: "INSUFFICIENT_CREDITS",
          balance: 0,
        },
      },
    };
    const { result } = runScan();
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    const state = result.current.state;
    if (state.status !== "error") throw new Error("expected an error state");
    expect(state.credits).toEqual({ balance: 0 });
    // Not misfiled as one of the other walls, and not the generic transient failure.
    expect(state.blocked).toBeUndefined();
    expect(state.authRequired).toBeUndefined();
    expect(state.message).toMatch(/credits/i);
    // A 402 is terminal for this request: no salvage peek, no second attempt.
    expect(calls).toEqual(["/api/scan/stream"]);
  });

  it("keeps a non-zero balance rather than flattening it to 0", async () => {
    replies = { stream: { status: 402, body: { code: "INSUFFICIENT_CREDITS", balance: 3 } } };
    const { result } = runScan();
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    const state = result.current.state;
    if (state.status !== "error") throw new Error("expected an error state");
    expect(state.credits).toEqual({ balance: 3 });
  });

  it("401 auth_required becomes the sign-in class", async () => {
    replies = { stream: { status: 401, body: { error: "Sign in to run a scan.", code: "auth_required" } } };
    const { result } = runScan();
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    const state = result.current.state;
    if (state.status !== "error") throw new Error("expected an error state");
    expect(state.authRequired).toBe(true);
    expect(state.credits).toBeUndefined();
  });

  it("429 monthly_quota becomes the quota class with its attribution scope", async () => {
    replies = {
      stream: { status: 429, body: { error: "Out of free scans.", code: "monthly_quota", scope: "user", resetAt: 1 } },
      // Salvage peek finds nothing saved for this repo → the blocked wall stands.
      peek: { status: 204, body: null },
    };
    const { result } = runScan();
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    const state = result.current.state;
    if (state.status !== "error") throw new Error("expected an error state");
    // The reset horizon rides along so the re-scan banner can say when the window reopens.
    expect(state.blocked).toEqual({ scope: "user", resetAt: 1 });
    expect(state.credits).toBeUndefined();
    // The quota branch — unlike the 401/402 ones — tries the salvage peek before walling.
    expect(calls.some((u) => u.includes("peek=1&latest=1"))).toBe(true);
  });

  it("an unclassified refusal stays the generic (retryable) failure", async () => {
    replies = { stream: { status: 500, body: { error: "Boom." } } };
    const { result } = runScan();
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    const state = result.current.state;
    if (state.status !== "error") throw new Error("expected an error state");
    expect(state.credits).toBeUndefined();
    expect(state.blocked).toBeUndefined();
    expect(state.authRequired).toBeUndefined();
    expect(state.notFound).toBeUndefined();
  });
});

// ── REJOIN A LIVE SCAN AFTER A RELOAD (repo-report-shell-tabs #4) ────────────────────────────────
//
// A reload of /report?repo= used to be a cold first load: peek a cache that cannot hit (the report was
// never persisted), then start a SECOND full ingest + LLM run. The anchor written at scan start is what
// tells the remounted hook it already owns this scan, so it goes straight to the stream and lets the
// server's coalescer hand it the run already under way. These cases pin the two client halves: the skip
// of the peek, and the explicit `joined` frame being the ONLY thing that sets `resumed`.

import { act } from "react";
import { scanAnchorSubject, writeScanAnchor, readScanAnchor, type ScanAnchorStore } from "./scanResume";
import { scanClientTimeoutMs } from "./scanEstimate";

/** A controllable SSE body: `push` writes one frame, `close` ends the stream. */
function sseStub() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const enc = new TextEncoder();
  return {
    body,
    push: (event: string, data: unknown) =>
      act(() => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }),
    close: () =>
      act(() => {
        controller.close();
      }),
  };
}

describe("useReportScan — rejoining a live scan after a reload", () => {
  const store = (): ScanAnchorStore => window.sessionStorage;

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("with a live anchor for this subject it skips the peek and POSTs the stream directly", async () => {
    const sse = sseStub();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return { ok: true, status: 200, body: sse.body, headers: new Headers(), json: async () => null } as unknown as Response;
      }),
    );
    writeScanAnchor(store(), scanAnchorSubject({ repo: "acme/app", fresh: false }), Date.now());

    renderHook(() => useReportScan("acme/app", false));

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    // The whole point: no cache peek round-trip, straight to the run that is still going.
    expect(calls).toEqual(["/api/scan/stream"]);
    sse.close();
  });

  it("with NO anchor it still peeks first (today's cold-load behaviour is untouched)", async () => {
    const sse = sseStub();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.startsWith("/api/scan/stream")) {
          return { ok: true, status: 200, body: sse.body, headers: new Headers(), json: async () => null } as unknown as Response;
        }
        return { ok: false, status: 204, body: null, headers: new Headers(), json: async () => null } as unknown as Response;
      }),
    );

    renderHook(() => useReportScan("acme/app", false));

    await waitFor(() => expect(calls.length).toBeGreaterThan(1));
    expect(calls[0]).toContain("peek=1&recent=1");
    expect(calls[1]).toBe("/api/scan/stream");
    sse.close();
  });

  it("writes the anchor at scan start so a reload a moment later can rejoin", async () => {
    const sse = sseStub();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, body: sse.body, headers: new Headers(), json: async () => null }) as unknown as Response),
    );

    renderHook(() => useReportScan("acme/app", true));

    await waitFor(() =>
      expect(
        readScanAnchor(store(), scanAnchorSubject({ repo: "acme/app", fresh: true }), {
          now: Date.now(),
          ttlMs: scanClientTimeoutMs(),
        }),
      ).not.toBeNull(),
    );
    sse.close();
  });

  it("a `joined` frame sets resumed=true, and settling clears the anchor", async () => {
    const sse = sseStub();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, body: sse.body, headers: new Headers(), json: async () => null }) as unknown as Response),
    );
    const subject = scanAnchorSubject({ repo: "acme/app", fresh: true });

    const { result } = renderHook(() => useReportScan("acme/app", true));
    await waitFor(() => expect(result.current.state.status).toBe("loading"));
    expect(result.current.resumed).toBe(false);

    await sse.push("joined", { startedAt: 1, message: "Rejoined a scan already in progress" });
    await waitFor(() => expect(result.current.resumed).toBe(true));

    // Settling (here: an error frame) retires the anchor — the NEXT visit is a fresh scan, not a
    // rejoin of a run that no longer exists.
    await sse.push("error", { error: "Scan failed." });
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(readScanAnchor(store(), subject, { now: Date.now(), ttlMs: scanClientTimeoutMs() })).toBeNull();
    sse.close();
  });

  it("a progress frame whose MESSAGE mentions joining does not set resumed (the frame is the contract)", async () => {
    const sse = sseStub();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, body: sse.body, headers: new Headers(), json: async () => null }) as unknown as Response),
    );

    const { result } = renderHook(() => useReportScan("acme/app", true));
    await waitFor(() => expect(result.current.state.status).toBe("loading"));

    await sse.push("progress", { stage: "fetch", message: "Joining a scan already in progress…", pct: 5 });
    await waitFor(() => expect(result.current.progress.pct).toBe(5));
    expect(result.current.resumed).toBe(false);
    sse.close();
  });
});
