// Server-side Server-Sent Events helpers — the encode/enqueue `send` closure and the standard
// response headers shared by every SSE route (/api/org/import, /api/org/scan, /api/scan/stream).
// The CLIENT-side counterpart (parse + read loop) lives in `src/lib/sse.ts`; this is the producer
// half. Keeping the wire-format (frame encoding, the swallowed-on-closed-controller `catch`, the
// proxy-buffering headers) in one place stops the three routes from drifting.

/**
 * The standard SSE response headers: the event-stream content type, the no-transform cache rule
 * (so a CDN/proxy doesn't buffer or rewrite the stream), and `x-accel-buffering: no` (disables
 * nginx/Vercel response buffering that would otherwise hold frames until the stream closes). A
 * route that needs more (e.g. `connection: keep-alive` or quota headers) spreads these in.
 */
export const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
};

/**
 * Build the typed `send(event, data)` closure for a ReadableStream controller: encodes one
 * `event:`/`data:` SSE frame and enqueues it, swallowing the enqueue error that fires once the
 * controller has closed (client disconnect / stream torn down). Identical semantics to the
 * hand-rolled closure each route used to inline.
 */
export function makeSseSend(
  controller: ReadableStreamDefaultController<Uint8Array>,
): (event: string, data: unknown) => void {
  const enc = new TextEncoder();
  return (event: string, data: unknown) => {
    try {
      controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    } catch {
      /* controller closed */
    }
  };
}
