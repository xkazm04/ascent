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
  // Per the SSE spec, consecutive `data:` lines in one frame are concatenated with a "\n" separator —
  // accumulate them and join, rather than fusing them with no separator (which would turn a payload
  // that ever spans multiple lines into invalid JSON and silently drop the frame). Each line has at
  // most one leading space stripped (the spec's optional single space after the colon); the final
  // assembled string is trimmed before parsing.
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
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
