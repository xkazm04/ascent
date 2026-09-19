// Server-side guarded fetch for the white-label briefing logo.
//
// @react-pdf/renderer fetches `<Image src={logoUrl}>` SERVER-SIDE, from inside the app network, at every
// PDF render — so an owner-supplied logo URL is an SSRF egress vector, not just a render-safety concern.
// `isSafeLogoUrl` (lib/net/ssrf) only validates the LITERAL hostname at WRITE time, which a DNS-rebinding
// host defeats (public at validation, private at fetch). This resolves the logo to image BYTES ourselves
// under a strict guard and hands @react-pdf a `data:` URI, so @react-pdf never makes a network request —
// closing the @react-pdf egress entirely. On anything unsafe/failed it returns null and the caller renders
// the brand name/colour without a logo rather than failing the download.

import { lookup } from "node:dns/promises";
import { isPrivateOrInternalHost, isSafePublicHttpsUrl } from "@/lib/net/ssrf";

const MAX_LOGO_BYTES = 2_000_000; // a logo, not an arbitrary payload
const FETCH_TIMEOUT_MS = 5_000;

/**
 * Fetch an owner-supplied logo URL safely and return it as a `data:` URI, or null when it is unsafe,
 * unreachable, not an image, too large, or a redirect. Order: (1) https + non-private LITERAL host
 * (shared guard); (2) resolve the host and reject if ANY resolved address is private/internal — this
 * catches the rebinding class a literal-only check misses; (3) fetch with a timeout, no redirect
 * following, an image-only content-type, and a size cap. The residual lookup→connect window is bounded
 * by those caps and by the bytes only ever landing in a PDF logo slot (never echoed back to a caller).
 */
export async function resolveSafeLogoDataUri(rawUrl: string): Promise<string | null> {
  if (!isSafePublicHttpsUrl(rawUrl)) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 [..] brackets
  try {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateOrInternalHost(a.address))) return null;
  } catch {
    return null; // unresolvable host → not safe to fetch
  }

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "manual", // a 3xx could bounce to a host we never re-validated → reject below via !res.ok
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "image/*" },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null; // non-2xx, or the 3xx surfaced by redirect:"manual"

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) return null;
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_LOGO_BYTES) return null;

  let bytes: ArrayBuffer;
  try {
    bytes = await res.arrayBuffer();
  } catch {
    return null;
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_BYTES) return null;

  return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
}
