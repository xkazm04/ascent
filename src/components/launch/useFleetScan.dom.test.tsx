// @vitest-environment jsdom
//
// The map's Scan button rides the shared transport (useScanStream) and roster (scanRunRosterModel):
// a queued remainder is followed until it drains, unmount aborts the stream, and a partial run's
// failures are retried by name through the ordinary scoped POST /api/org/scan.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QUEUE_FOLLOW_POLL_MS } from "@/components/shared/scan/queueFollow";
import { useFleetScan } from "./useFleetScan";
import type { Constellation } from "./fleetMapStars";

const enc = new TextEncoder();
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** A body whose frames are pushed by the test; it errors the way a browser does when the signal aborts. */
function liveBody() {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => { ctl = c; } });
  const fail = () => ctl.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
  return { body, fail, push: (s: string) => ctl.enqueue(enc.encode(s)) };
}
const doneBody = (frames: string[]) =>
  new ReadableStream<Uint8Array>({ start: (c) => { for (const f of frames) c.enqueue(enc.encode(f)); c.close(); } });

type Call = { url: string; init?: RequestInit };
let calls: Call[];
let scanFrames: string[];
let queuePending: number;
let live: ReturnType<typeof liveBody> | null;

beforeEach(() => {
  calls = [];
  scanFrames = [];
  queuePending = 0;
  live = null;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith("/api/org/scan/queue")) return Response.json({ pending: queuePending, repos: [] });
    if (url.startsWith("/api/app/repos")) return Response.json({ repos: [] });
    if (live) return { ok: true, status: 200, body: live.body, json: async () => null };
    return { ok: true, status: 200, body: doneBody(scanFrames), json: async () => null };
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function mount() {
  const installations = [{ id: 7, login: "acme" }];
  const setConstellations = vi.fn((u: Constellation[] | ((c: Constellation[]) => Constellation[])) => {
    if (typeof u === "function") u([{ id: 7, login: "acme", status: "done", repos: [] }]);
  });
  const hook = renderHook(() => useFleetScan(installations, setConstellations));
  return { ...hook, setConstellations };
}
const scanCalls = () => calls.filter((c) => c.url === "/api/org/scan");

describe("useFleetScan", () => {
  it("follows a queued remainder and, once drained, clears recentScan and pulls the org once", async () => {
    vi.useFakeTimers();
    scanFrames = [frame("queued", { runId: "r1", queued: 5, total: 5 })];
    const { result } = mount();
    await act(async () => { await result.current.scan("acme"); });
    expect(result.current.outcomes.acme?.kind).toBe("queued");
    expect(result.current.recentScan.current.has("acme")).toBe(true);
    expect(calls.some((c) => c.url.startsWith("/api/app/repos"))).toBe(false);

    queuePending = 0;
    await act(async () => { await vi.advanceTimersByTimeAsync(QUEUE_FOLLOW_POLL_MS); });
    const queue = calls.filter((c) => c.url.startsWith("/api/org/scan/queue"));
    expect(queue).toHaveLength(1);
    expect(queue[0]!.url).toBe("/api/org/scan/queue?org=acme&runId=r1");
    expect(result.current.recentScan.current.has("acme")).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(QUEUE_FOLLOW_POLL_MS * 3); });
    const pulls = calls.filter((c) => c.url.startsWith("/api/app/repos"));
    expect(pulls).toHaveLength(1);
    expect(pulls[0]!.url).toContain("org=acme");
    expect(result.current.outcomes.acme?.kind).not.toBe("queued");
  });

  it("aborts the stream on unmount and lands no state after it", async () => {
    live = liveBody();
    const { result, unmount, setConstellations } = mount();
    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = result.current.scan("acme"); });
    await act(async () => { await Promise.resolve(); });
    const signal = scanCalls()[0]!.init?.signal as AbortSignal | undefined;
    expect(signal).toBeInstanceOf(AbortSignal);
    // Wire the abort the way a browser does: the body errors once the request's signal aborts.
    signal!.addEventListener("abort", () => live!.fail());
    const before = setConstellations.mock.calls.length;
    unmount();
    expect(signal!.aborted).toBe(true);
    try { live.push(frame("repo", { repo: "acme/a", overall: 80 })); } catch { /* closed */ }
    await act(async () => { await pending; });
    expect(setConstellations.mock.calls.length).toBe(before);
  });

  it("retryFailed posts exactly the roster's failures", async () => {
    scanFrames = [frame("repo", { repo: "c", error: "boom", charged: true }), frame("repo", { repo: "d", overall: 60 })];
    const { result } = mount();
    await act(async () => { await result.current.scan("acme"); });
    expect(result.current.outcomes.acme?.kind).toBe("partial");
    scanFrames = [];
    await act(async () => { await result.current.retryFailed("acme"); });
    expect(scanCalls()).toHaveLength(2);
    expect(JSON.parse(String(scanCalls()[1]!.init?.body))).toEqual({ org: "acme", repos: ["c"] });
  });

  it("reports an in-band credit refusal with its own text, not the empty watchlist", async () => {
    scanFrames = [frame("error", { error: "Out of scan credits: 3 watched repos couldn't be scanned." })];
    const { result } = mount();
    await act(async () => { await result.current.scan("acme"); });
    expect(result.current.outcomes.acme?.message).toBe("Out of scan credits: 3 watched repos couldn't be scanned.");
    expect(result.current.scanError.acme).toBeUndefined();
  });
});
