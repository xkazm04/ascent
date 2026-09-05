// Client-side Server-Sent Events helpers — a tiny parser + reader loop shared by every
// consumer of the app's SSE endpoints (the org bulk-scan stream powering OrgScanButton and
// the /org/[slug]/live war-room). Pure and browser-safe; no React, no server imports.

export interface SSEMessage {
  /** The `event:` name, or null for an unnamed/keepalive frame. */
  event: string | null;
  /** The parsed `data:` JSON payload, or null when absent/unparseable. */
  data: Record<string, unknown> | null;
}

/** Parse a single SSE frame ("event: …\ndata: …") into its name + JSON payload. */
export function parseSSE(block: string): SSEMessage {
  let event: string | null = null;
  // Per the SSE spec, consecutive `data:` lines in one frame are JOINED WITH "\n" (stripping a single
  // leading space after the colon), then the assembled string is trimmed before parsing. The old per-
  // line trim()+bare-concat dropped those newlines and the separator, silently corrupting multi-line /
  // pretty-printed JSON payloads; joining with newlines reassembles a split payload into valid JSON.
  const dataLines: string[] = [];
  for (const raw of block.split("\n")) {
    // Tolerate CRLF: strip a trailing \r that a proxy may have left on the line.
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  const dataStr = dataLines.length ? dataLines.join("\n").trim() : "";
  try {
    return { event, data: dataStr ? JSON.parse(dataStr) : null };
  } catch {
    return { event, data: null };
  }
}

/**
 * Read an SSE response body to completion, invoking `onMessage` for every "\n\n"-delimited
 * frame as it arrives. Empty keepalive frames (no event and no data) are skipped. Resolves
 * when the stream closes; pass an aborted signal's body to stop early.
 *
 * `onChunk` (optional) fires once per successful `reader.read()` — i.e. on every byte of progress,
 * before its frames are drained — so a caller can re-arm a stall watchdog without re-implementing the
 * reader/decoder/buffer loop (see src/components/onboarding/importScan.ts).
 */
export async function readSSE(
  body: ReadableStream<Uint8Array>,
  onMessage: (msg: SSEMessage) => void,
  onChunk?: () => void,
): Promise<void> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk?.();
    buf += dec.decode(value, { stream: true });
    let m: RegExpExecArray | null;
    while ((m = FRAME_BOUNDARY.exec(buf))) {
      const block = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      const msg = parseSSE(block);
      if (msg.event || msg.data) onMessage(msg);
    }
  }
}

/**
 * A frame ends at a BLANK LINE, which over the wire may be `\n\n` OR `\r\n\r\n`.
 *
 * This was `buf.indexOf("\n\n")`, which cannot see a CRLF boundary at all: `\r\n\r\n` contains no
 * `\n\n` substring, so against a proxy that normalises to CRLF the buffer grew forever and NOT ONE
 * frame was delivered — the stream simply appeared to hang. `parseSSE` already tolerated CRLF *within*
 * a frame (it strips a trailing `\r` per line), so the two halves of the parser disagreed about which
 * line endings the wire may use.
 *
 * `src/components/report/useReportScan.ts` had found this and carried its own `/\r?\n\r?\n/` loop; the
 * fix belongs here, where all six other consumers get it too. Declared once at module scope rather than
 * per call — a literal regex with no `/g` flag holds no `lastIndex` state, so it is safe to share.
 *
 * Architect ADR 2026-08-28-client-fetch-primitives.
 */
const FRAME_BOUNDARY = /\r?\n\r?\n/;
