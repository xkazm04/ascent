import { describe, it, expect } from "vitest";
import { parseSSE, readSSE } from "./sse";
import type { SSEMessage } from "./sse";

/** Build a ReadableStream<Uint8Array> that emits each string as one chunk, in order. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
      else controller.close();
    },
  });
}

/** Drive readSSE over the given chunks and collect every delivered message. */
async function drain(chunks: string[]): Promise<SSEMessage[]> {
  const out: SSEMessage[] = [];
  await readSSE(streamOf(chunks), (m) => out.push(m));
  return out;
}

describe("parseSSE — single frame", () => {
  it("parses an event name and JSON data payload", () => {
    expect(parseSSE('event: progress\ndata: {"done":3,"total":10}')).toEqual({
      event: "progress",
      data: { done: 3, total: 10 },
    });
  });

  it("returns null event for a data-only (unnamed) frame", () => {
    expect(parseSSE('data: {"ok":true}')).toEqual({ event: null, data: { ok: true } });
  });

  it("returns null data when there is no data line", () => {
    expect(parseSSE("event: ping")).toEqual({ event: "ping", data: null });
  });

  it("concatenates multi-line data: fields before JSON.parse", () => {
    // The terminal stream chunks a payload across several data: lines.
    const block = 'event: result\ndata: {"a":1,\ndata: "b":2}';
    expect(parseSSE(block)).toEqual({ event: "result", data: { a: 1, b: 2 } });
  });

  it("joins multi-line data: fields with the spec-required newline (preserves an embedded \\n)", () => {
    // A producer splits a payload whose string value itself contains a newline across two data: lines.
    // The spec joins consecutive data: lines with "\n", so the embedded newline must be reconstructed
    // verbatim inside the JSON string — the previous no-separator concat fused the lines into invalid
    // JSON ('"line one""line two"') and silently dropped the frame as data:null. (scan-pipeline #4)
    const block = 'event: result\ndata: {"msg":"line one\ndata: line two"}';
    expect(parseSSE(block)).toEqual({ event: "result", data: { msg: "line one\nline two" } });
  });

  it("does not throw on malformed JSON — yields data:null but keeps the event", () => {
    expect(parseSSE("event: oops\ndata: {not json")).toEqual({ event: "oops", data: null });
  });

  it("treats a wholly empty/keepalive block as null/null", () => {
    expect(parseSSE("")).toEqual({ event: null, data: null });
    expect(parseSSE("\n")).toEqual({ event: null, data: null });
  });

  it("trims surrounding whitespace from event and data", () => {
    expect(parseSSE("event:  named  \ndata:  42  ")).toEqual({ event: "named", data: 42 });
  });

  it("ignores comment/unknown lines (e.g. SSE `:` heartbeats)", () => {
    expect(parseSSE(': heartbeat\ndata: {"x":1}')).toEqual({ event: null, data: { x: 1 } });
  });

  it("handles CRLF line endings (trailing \\r is trimmed off event + data)", () => {
    expect(parseSSE('event: progress\r\ndata: {"done":1}\r')).toEqual({
      event: "progress",
      data: { done: 1 },
    });
  });
});

describe("readSSE — stream drain", () => {
  it("yields every \\n\\n-delimited frame, in order", async () => {
    const out = await drain([
      'event: a\ndata: {"n":1}\n\n',
      'event: b\ndata: {"n":2}\n\n',
      'event: c\ndata: {"n":3}\n\n',
    ]);
    expect(out).toEqual([
      { event: "a", data: { n: 1 } },
      { event: "b", data: { n: 2 } },
      { event: "c", data: { n: 3 } },
    ]);
  });

  it("buffers a frame split across chunk boundaries", async () => {
    // The "\n\n" terminator and the JSON are split across three arriving chunks.
    const out = await drain(['event: split\nda', 'ta: {"v":7}', "\n\n"]);
    expect(out).toEqual([{ event: "split", data: { v: 7 } }]);
  });

  it("emits multiple frames that arrive coalesced in one chunk", async () => {
    const out = await drain(['event: x\ndata: 1\n\nevent: y\ndata: 2\n\n']);
    expect(out).toEqual([
      { event: "x", data: 1 },
      { event: "y", data: 2 },
    ]);
  });

  it("delivers the terminal frame even when arriving with trailing content", async () => {
    const out = await drain(['event: done\ndata: {"final":true}\n\n']);
    expect(out).toEqual([{ event: "done", data: { final: true } }]);
  });

  it("holds an incomplete trailing frame (never terminated) and does not deliver it", async () => {
    const out = await drain([
      'event: keep\ndata: {"k":1}\n\n',
      'event: partial\ndata: {"k":2}', // no terminating \n\n before stream close
    ]);
    expect(out).toEqual([{ event: "keep", data: { k: 1 } }]);
  });

  it("skips empty keepalive frames (no event, no data)", async () => {
    const out = await drain([": comment\n\n", "\n\n", 'event: real\ndata: 9\n\n']);
    expect(out).toEqual([{ event: "real", data: 9 }]);
  });

  it("delivers a malformed-JSON frame as data:null without throwing", async () => {
    const out = await drain(['event: bad\ndata: {oops\n\nevent: ok\ndata: 1\n\n']);
    expect(out).toEqual([
      { event: "bad", data: null },
      { event: "ok", data: 1 },
    ]);
  });

  it("resolves with zero messages on an empty stream", async () => {
    expect(await drain([])).toEqual([]);
  });
});
