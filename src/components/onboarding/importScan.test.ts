// Tests for the SSE import parser / stall watchdog / abort handling in `runImportScan`
// (Test Mastery finding #2 + #3). Approach A: `runImportScan` already consumes a `ReadableStream`
// (`res.body`) over a globally-mockable `fetch` and takes an injectable `AbortController`, so the
// whole streaming contract is drivable WITHOUT touching the source — we feed hand-built SSE frames
// through a fake `fetch` and assert the folded callbacks / outcomes.
//
// This repo has no jsdom: tests run in Node, which provides `ReadableStream`, `Response`,
// `TextEncoder`, and `AbortController` natively.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runImportScan,
  IMPORT_WATCH_SCHEDULE,
  type ImportScanCallbacks,
} from "./importScan";

const enc = new TextEncoder();

/** Build a Response whose body streams the given chunks (each already a complete byte slice). */
function streamResponse(chunks: Uint8Array[], init?: ResponseInit): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return new Response(stream, { status: 200, ...init });
}

/** A frame encoder so tests read like the wire format. */
function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function makeCallbacks() {
  const onRepo = vi.fn();
  const onResult = vi.fn();
  const onError = vi.fn();
  const cb: ImportScanCallbacks = { onRepo, onResult, onError };
  return { cb, onRepo, onResult, onError };
}

const request = { org: "acme", repos: ["acme/a", "acme/b"] };

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("runImportScan — happy stream", () => {
  it("parses a well-formed multi-event stream in order with correct payloads and resolves ok", async () => {
    const body =
      frame("repo", { repo: "acme/a", level: "L3", overall: 72 }) +
      frame("repo", { repo: "acme/b", level: "L1", overall: 40, error: "no readme" }) +
      frame("result", { ok: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([enc.encode(body)])),
    );

    const { cb, onRepo, onResult, onError } = makeCallbacks();
    const result = await runImportScan(request, new AbortController(), cb);

    expect(result).toEqual({ ok: true });
    expect(onRepo).toHaveBeenCalledTimes(2);
    // Order + payload shape preserved.
    expect(onRepo).toHaveBeenNthCalledWith(1, {
      repo: "acme/a",
      level: "L3",
      overall: 72,
      error: undefined,
    });
    expect(onRepo).toHaveBeenNthCalledWith(2, {
      repo: "acme/b",
      level: "L1",
      overall: 40,
      error: "no readme",
    });
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("tolerates CRLF line endings (event:/data: with trailing \\r)", async () => {
    // Frames separate on the blank-line "\n\n"; the parser trims a trailing "\r" off each LINE.
    // On the wire that means lines end "\r\n" and the terminator is "\r\n\n" (the last two chars
    // being the "\n\n" the splitter scans for).
    const body =
      "event: repo\r\ndata: " +
      JSON.stringify({ repo: "acme/a", overall: 10 }) +
      "\r\n\n" +
      "event: result\r\ndata: {}\r\n\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([enc.encode(body)])),
    );

    const { cb, onRepo, onResult } = makeCallbacks();
    const result = await runImportScan(request, new AbortController(), cb);

    expect(result).toEqual({ ok: true });
    expect(onRepo).toHaveBeenCalledWith({
      repo: "acme/a",
      level: undefined,
      overall: 10,
      error: undefined,
    });
    expect(onResult).toHaveBeenCalledTimes(1);
  });
});

describe("runImportScan — chunk-boundary buffering", () => {
  it("parses an event split across two read() chunks exactly once (no drop/garble)", async () => {
    const full = frame("repo", { repo: "acme/a", overall: 55 }) + frame("result", { ok: true });
    // Split mid-event: cut in the middle of the first frame's data line.
    const cut = Math.floor(full.length / 3);
    const part1 = enc.encode(full.slice(0, cut));
    const part2 = enc.encode(full.slice(cut));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([part1, part2])),
    );

    const { cb, onRepo, onResult } = makeCallbacks();
    const result = await runImportScan(request, new AbortController(), cb);

    expect(result).toEqual({ ok: true });
    expect(onRepo).toHaveBeenCalledTimes(1);
    expect(onRepo).toHaveBeenCalledWith({
      repo: "acme/a",
      level: undefined,
      overall: 55,
      error: undefined,
    });
    expect(onResult).toHaveBeenCalledTimes(1);
  });
});

describe("runImportScan — malformed / partial trailing data", () => {
  it("does not throw and emits no bogus event for a malformed (unparseable JSON) frame", async () => {
    const body =
      "event: repo\ndata: {not valid json}\n\n" + frame("result", { ok: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([enc.encode(body)])),
    );

    const { cb, onRepo, onResult, onError } = makeCallbacks();
    const result = await runImportScan(request, new AbortController(), cb);

    expect(result).toEqual({ ok: true });
    expect(onRepo).not.toHaveBeenCalled(); // malformed frame swallowed
    expect(onError).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("ignores a partial trailing chunk with no terminating \\n\\n (never parsed)", async () => {
    const body =
      frame("repo", { repo: "acme/a", overall: 1 }) +
      "event: repo\ndata: {\"repo\":\"acme/b\""; // truncated, no blank-line terminator
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([enc.encode(body)])),
    );

    const { cb, onRepo } = makeCallbacks();
    const result = await runImportScan(request, new AbortController(), cb);

    expect(result).toEqual({ ok: true });
    // Only the complete first frame is emitted; the dangling partial is left buffered, not emitted.
    expect(onRepo).toHaveBeenCalledTimes(1);
    expect(onRepo).toHaveBeenCalledWith({
      repo: "acme/a",
      level: undefined,
      overall: 1,
      error: undefined,
    });
  });
});

describe("runImportScan — error / non-2xx outcomes", () => {
  it("invokes onError(message) on a mid-stream error event and still resolves ok", async () => {
    const body = frame("error", { error: "scanner exploded" }) + frame("result", { ok: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([enc.encode(body)])),
    );

    const { cb, onError, onResult } = makeCallbacks();
    const result = await runImportScan(request, new AbortController(), cb);

    expect(result).toEqual({ ok: true });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("scanner exploded");
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("surfaces the route's error body in `message` on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "out of credits" }), { status: 402 }),
      ),
    );

    const { cb, onRepo, onResult, onError } = makeCallbacks();
    const result = await runImportScan(request, new AbortController(), cb);

    expect(result).toEqual({ ok: false, aborted: false, stalled: false, message: "out of credits" });
    expect(onRepo).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("falls back to a status-coded message when the non-2xx body has no error field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const { cb } = makeCallbacks();
    const result = await runImportScan(request, new AbortController(), cb);
    expect(result).toEqual({
      ok: false,
      aborted: false,
      stalled: false,
      message: "Import failed (500).",
    });
  });
});

describe("runImportScan — abort & stall", () => {
  // A body that emits the given chunks then HANGS (never closes) — until the request's abort signal
  // fires, at which point it errors the stream. This mirrors the browser: aborting a fetch cancels
  // the in-flight body, so a pending reader.read() rejects rather than hanging forever.
  function hangingResponse(
    chunks: Uint8Array[],
    init?: RequestInit,
  ): Response {
    const signal = init?.signal;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(ch);
        const onAbort = () =>
          c.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
        // never close otherwise → the next read() stays pending until abort.
      },
    });
    return new Response(stream, { status: 200 });
  }

  it("returns { ok:false, aborted:true } when the controller is aborted mid-stream", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        hangingResponse([enc.encode(frame("repo", { repo: "acme/a", overall: 9 }))], init),
      ),
    );

    const { cb, onRepo } = makeCallbacks();
    const promise = runImportScan(request, controller, cb);
    // Let the first chunk be read & processed, then abort the in-flight stream.
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const result = await promise;

    expect(result).toEqual({ ok: false, aborted: true, stalled: false });
    expect(onRepo).toHaveBeenCalledTimes(1); // the one delivered frame was processed
  });

  it("aborts a stalled stream after STALL_MS and reports { aborted:true, stalled:true }", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        hangingResponse([enc.encode(frame("repo", { repo: "acme/a", overall: 3 }))], init),
      ),
    );

    const { cb } = makeCallbacks();
    const promise = runImportScan(request, controller, cb);

    // Flush microtasks up to the pending read(), then trip the stall watchdog (> STALL_MS=45_000).
    await vi.advanceTimersByTimeAsync(46_000);
    const result = await promise;

    expect(controller.signal.aborted).toBe(true);
    expect(result).toEqual({ ok: false, aborted: true, stalled: true });
  });
});

describe("runImportScan — request body (cost-disclosure contract, finding #3)", () => {
  it("sends watch:true with schedule === IMPORT_WATCH_SCHEDULE and defaults mock:true", async () => {
    const fetchSpy = vi.fn(
      async () => streamResponse([enc.encode(frame("result", { ok: true }))]),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { cb } = makeCallbacks();
    await runImportScan(
      { org: "acme", repos: ["acme/a"], installationId: "inst_1" },
      new AbortController(),
      cb,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/org/import");
    const sent = JSON.parse(init.body as string);
    expect(sent.watch).toBe(true);
    expect(sent.schedule).toBe(IMPORT_WATCH_SCHEDULE);
    expect(sent.mock).toBe(true); // defaulted to preview when caller omits it
    expect(sent.installationId).toBe("inst_1");
  });

  it("passes mock:false through verbatim when the caller spends real credits", async () => {
    const fetchSpy = vi.fn(
      async () => streamResponse([enc.encode(frame("result", { ok: true }))]),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { cb } = makeCallbacks();
    await runImportScan({ ...request, mock: false }, new AbortController(), cb);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).mock).toBe(false);
  });
});
