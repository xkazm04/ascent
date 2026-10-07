// parseSSE's malformed-payload door (sse.ts:26-34).
//
// A frame whose `data:` is not JSON still degrades to `{ event, data: null }` — consumers validate data
// at their own trust boundary, so a null result frame becomes a clean error there. What is pinned here
// is that the malformed payload is no longer silent: it logs a console.warn that NAMES the event, so a
// broken stream can be told apart from a stream that sent nothing. A well-formed frame, and a frame with
// no data at all (a keepalive), are not damage and must not warn.
// sse.ts is client-safe: the door is a log only, never server telemetry.

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { parseSSE } from "./sse";

let warn: MockInstance;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => warn.mockRestore());

describe("parseSSE — malformed data reaches the log door", () => {
  it("a malformed JSON payload passes data:null and warns naming the event", () => {
    expect(parseSSE('event: result\ndata: {"score": 7')).toEqual({ event: "result", data: null });
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0]![0]);
    expect(msg).toContain("malformed data");
    expect(msg).toContain('"result"');
  });

  it("an unnamed frame with malformed data still degrades and warns (event null)", () => {
    expect(parseSSE("data: not-json")).toEqual({ event: null, data: null });
    expect(String(warn.mock.calls[0]![0])).toContain('"null"');
  });

  it("a valid frame parses and does NOT warn", () => {
    expect(parseSSE('event: progress\ndata: {"done":3}')).toEqual({ event: "progress", data: { done: 3 } });
    expect(warn).not.toHaveBeenCalled();
  });

  it("a frame with no data (keepalive / bare event) does NOT warn", () => {
    expect(parseSSE("event: ping")).toEqual({ event: "ping", data: null });
    expect(parseSSE(": comment only")).toEqual({ event: null, data: null });
    expect(warn).not.toHaveBeenCalled();
  });
});
