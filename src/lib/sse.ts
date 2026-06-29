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
  const dataLines: string[] = [];
  for (const raw of block.split("\n")) {
    // Tolerate CRLF: strip a trailing \r that a proxy may have left on the line.
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    // Per the SSE spec, multiple `data:` lines are JOINED WITH "\n" (stripping a single leading
    // space after the colon). The old per-line trim()+bare-concat dropped those newlines and the
    // separator, silently corrupting multi-line / pretty-printed JSON payloads; join with newlines
    // so a payload split across `data:` lines still reassembles to valid JSON.
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  try {
    return { event, data: dataLines.length ? JSON.parse(dataLines.join("\n")) : null };
  } catch {
    return { event, data: null };
  }
}

/**
 * Read an SSE response body to completion, invoking `onMessage` for every "\n\n"-delimited
 * frame as it arrives. Empty keepalive frames (no event and no data) are skipped. Resolves
 * when the stream closes; pass an aborted signal's body to stop early.
 */
export async function readSSE(
  body: ReadableStream<Uint8Array>,
  onMessage: (msg: SSEMessage) => void,
): Promise<void> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const msg = parseSSE(block);
      if (msg.event || msg.data) onMessage(msg);
    }
  }
}
