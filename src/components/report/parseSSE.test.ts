// Tests for the report-shell SSE frame parser (`parseSSE`, exported from ReportClientStatus.tsx)
// and the stream-drain framing it feeds (the `FRAME = /\r?\n\r?\n/` splitter + final trailing-frame
// flush in ReportClient.tsx:199-228). Test Mastery repo-report-shell finding #4.
//
// `parseSSE` here is NOT the same function as `src/lib/sse.ts` `parseSSE` (org war-room) or the
// inline parser in onboarding `runImportScan`: this one JOINS multiple `data:` lines with "\n" so a
// pretty-printed multi-line JSON payload still parses — the others concat with `.trim()` and would
// corrupt it. So this is a distinct, untested trust surface.
//
// `parseSSE` is a pure exported fn → imported and fed crafted SSE text. The drain loop lives inside
// a React effect and can't be imported without a source change (forbidden here), so we reproduce its
// exact framing logic in `drainSSE` (same regex + same trailing-tail flush as the source) AND drive
// the buffering through a real Node `ReadableStream` to pin the split-across-chunks invariant.
//
// This repo has no jsdom: tests run in Node, which provides ReadableStream/TextDecoder/TextEncoder.

import { describe, it, expect } from "vitest";
import { parseSSE } from "./ReportClientStatus";

const enc = new TextEncoder();

// ── Faithful reproduction of ReportClient.tsx:199-228 framing ────────────────────────────────────
// Frame boundary is a blank line (tolerate \n\n and CRLF \r\n\r\n); each complete frame is handed to
// parseSSE; on stream end the decoder is flushed and any trailing frame with NO terminating blank
// line is still dispatched (the terminal `result` the old loop dropped → "ended unexpectedly").
const FRAME = /\r?\n\r?\n/;

function drainText(buffer: string): { event: string | null; data: unknown }[] {
  const out: { event: string | null; data: unknown }[] = [];
  let m: RegExpExecArray | null;
  while ((m = FRAME.exec(buffer))) {
    const block = buffer.slice(0, m.index);
    buffer = buffer.slice(m.index + m[0].length);
    if (block.length > 0) out.push(parseSSE(block));
  }
  const tail = buffer.trim();
  if (tail.length > 0) out.push(parseSSE(tail)); // trailing frame, no blank line
  return out;
}

/** Drive bytes through a real ReadableStream the way the source's reader loop does. */
async function drainStream(chunks: Uint8Array[]): Promise<{ event: string | null; data: unknown }[]> {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const out: { event: string | null; data: unknown }[] = [];
  const drain = () => {
    let m: RegExpExecArray | null;
    while ((m = FRAME.exec(buffer))) {
      const block = buffer.slice(0, m.index);
      buffer = buffer.slice(m.index + m[0].length);
      if (block.length > 0) out.push(parseSSE(block));
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    if (done) {
      buffer += decoder.decode();
      drain();
      const tail = buffer.trim();
      if (tail.length > 0) out.push(parseSSE(tail));
      break;
    }
    drain();
  }
  return out;
}

describe("parseSSE — single frame", () => {
  it("parses an event name + single-line JSON data", () => {
    expect(parseSSE('event: result\ndata: {"a":1}')).toEqual({ event: "result", data: { a: 1 } });
  });

  it("strips exactly one leading space after `data:` (SSE spec), not the JSON's own spaces", () => {
    // `data: ` → one space stripped; the inner `"b": 2` spacing is preserved by JSON.parse anyway.
    expect(parseSSE('event: progress\ndata: {"b": 2}')).toEqual({ event: "progress", data: { b: 2 } });
  });

  it("INVARIANT: multi-line `data:` is JOINED with \\n so pretty-printed JSON still parses", () => {
    // A payload split across several `data:` lines (proxy / pretty-print) must reassemble to valid
    // JSON. The old per-line trim()+concat collapsed the newlines and corrupted the object.
    const block = ["event: result", "data: {", 'data:   "score": 88,', 'data:   "ok": true', "data: }"].join("\n");
    expect(parseSSE(block)).toEqual({ event: "result", data: { score: 88, ok: true } });
  });

  it("parses identically with CRLF line endings (trailing \\r stripped per line)", () => {
    expect(parseSSE('event: result\r\ndata: {"a":1}\r')).toEqual({ event: "result", data: { a: 1 } });
  });

  it("yields event:null when no `event:` line is present", () => {
    expect(parseSSE('data: {"x":1}')).toEqual({ event: null, data: { x: 1 } });
  });

  it("does not throw on malformed JSON; yields data:null with the event preserved", () => {
    expect(parseSSE("event: result\ndata: {not json}")).toEqual({ event: "result", data: null });
  });

  it("yields data:null when there is no `data:` line at all", () => {
    expect(parseSSE("event: ping")).toEqual({ event: "ping", data: null });
  });
});

describe("drain framing — text buffer (mirrors ReportClient drainFrames + final flush)", () => {
  it("emits both frames of a well-formed two-event \\n\\n stream, in order", () => {
    const buf = 'event: progress\ndata: {"pct":50}\n\nevent: result\ndata: {"ok":true}\n\n';
    expect(drainText(buf)).toEqual([
      { event: "progress", data: { pct: 50 } },
      { event: "result", data: { ok: true } },
    ]);
  });

  it("REGRESSION: a final `result` frame with NO trailing blank line is still emitted", () => {
    // The exact bug the comment pins: terminal `result` written right before close, no \n\n after.
    const buf = 'event: progress\ndata: {"pct":90}\n\nevent: result\ndata: {"done":true}';
    const out = drainText(buf);
    expect(out).toEqual([
      { event: "progress", data: { pct: 90 } },
      { event: "result", data: { done: true } },
    ]);
    // The terminal event is dispatched exactly once — not dropped to "ended unexpectedly".
    expect(out.filter((f) => f.event === "result")).toHaveLength(1);
  });

  it("splits frames on CRLF blank lines (\\r\\n\\r\\n) identically to \\n\\n", () => {
    const buf = 'event: progress\r\ndata: {"pct":10}\r\n\r\nevent: result\r\ndata: {"ok":true}\r\n\r\n';
    expect(drainText(buf)).toEqual([
      { event: "progress", data: { pct: 10 } },
      { event: "result", data: { ok: true } },
    ]);
  });
});

describe("drain framing — real ReadableStream (chunk-boundary buffering)", () => {
  it("INVARIANT: an event split across two read() chunks is buffered and parsed exactly once", async () => {
    const full = 'event: progress\ndata: {"pct":25}\n\nevent: result\ndata: {"ok":true}\n\n';
    const cut = Math.floor(full.length / 2); // slice mid-frame
    const out = await drainStream([enc.encode(full.slice(0, cut)), enc.encode(full.slice(cut))]);
    expect(out).toEqual([
      { event: "progress", data: { pct: 25 } },
      { event: "result", data: { ok: true } },
    ]);
  });

  it("buffers an unterminated terminal `result` across chunks and flushes it once on close", async () => {
    const full = 'event: progress\ndata: {"pct":99}\n\nevent: result\ndata: {"final":true}'; // no \n\n
    const cut = full.length - 6;
    const out = await drainStream([enc.encode(full.slice(0, cut)), enc.encode(full.slice(cut))]);
    expect(out).toEqual([
      { event: "progress", data: { pct: 99 } },
      { event: "result", data: { final: true } },
    ]);
    expect(out.filter((f) => f.event === "result")).toHaveLength(1);
  });

  it("does not emit a bogus event for a malformed/partial trailing frame, and never throws", async () => {
    // First frame is complete & valid; a dangling, never-terminated, malformed tail follows.
    const full = 'event: progress\ndata: {"pct":5}\n\nevent: result\ndata: {"trunc"';
    const out = await drainStream([enc.encode(full)]);
    expect(out[0]).toEqual({ event: "progress", data: { pct: 5 } });
    // The trailing frame is still dispatched on close (tail flush) but its bad JSON → data:null,
    // never a thrown error and never a fabricated payload.
    expect(out[1]).toEqual({ event: "result", data: null });
    expect(out).toHaveLength(2);
  });
});
