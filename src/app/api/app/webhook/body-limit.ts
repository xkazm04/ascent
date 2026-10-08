// The webhook route is unauthenticated until verifyWebhook runs, and verifyWebhook needs the WHOLE
// body (the HMAC covers it). So the body is read before anything proves who sent it, which makes the
// read itself the attack surface: an unbounded `request.text()` buffers whatever a stranger streams
// (the route is excluded from src/proxy.ts, so no proxy body cap applies either), then decodes and
// HMACs it on a route with a 300 s maxDuration.
//
// GitHub caps a webhook payload at 25 MB and does not deliver anything larger, so nothing over that
// cap can be a genuine delivery. Refuse it before the signature check.

/** GitHub's documented webhook payload cap (25 MB). A larger body is never a real delivery. */
export const WEBHOOK_BODY_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Read a request body as text, or return `null` when it exceeds `maxBytes`.
 *
 * Two checks, because Content-Length is the caller's claim and may be missing (a chunked upload) or
 * wrong: an over-cap Content-Length is refused before a byte is read, and the actual read counts bytes
 * as they arrive and cancels the stream the moment the total passes the cap.
 *
 * The decode is the one `request.text()` performs (UTF-8, replacement on invalid sequences, a leading
 * BOM stripped), so verifyWebhook sees exactly the string it saw before this bound existed.
 */
export async function readBoundedText(request: Request, maxBytes = WEBHOOK_BODY_MAX_BYTES): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) return null;
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}
