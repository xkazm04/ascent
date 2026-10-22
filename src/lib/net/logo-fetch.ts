// Server-side guarded fetch for the white-label briefing logo.
//
// The logo URL is owner-supplied, so fetching it is untrusted input end to end: an SSRF egress vector
// (the fetch runs inside the app network) and a render-safety concern (the bytes land in the board PDF
// and on the anonymous share page). `isSafePublicHttpsUrl` (lib/net/ssrf) only validates the LITERAL
// hostname, which a DNS-rebinding host defeats. So this:
//   1. checks the literal URL (https, non-private literal host);
//   2. resolves the host ONCE and refuses if ANY answer is private/internal;
//   3. connects to the first validated answer through pinnedHttpsGet, which never re-resolves (the
//      lookup->connect rebinding window is closed, not merely bounded), follows no redirect, and caps
//      the body at MAX_LOGO_BYTES while it streams;
//   4. sniffs the magic bytes and admits exactly the formats @react-pdf/image renders (PNG, JPEG,
//      SVG). The response's content-type is attacker-controlled and is not trusted for the mime.
// The result is a snapshot candidate (bytes + mime + sha256 + data URI): the branding save stores it,
// and the deliverables render the stored data URI, so nothing fetches the owner's host at render time.

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isPrivateOrInternalHost, isSafePublicHttpsUrl } from "@/lib/net/ssrf";
import { pinnedHttpsGet } from "@/lib/net/pinned-get";

/** 512 KB: the base64 data URI (~700 KB) still fits a TEXT row and an inline share-page <img>. */
export const MAX_LOGO_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 5_000;

/** The formats @react-pdf/image can render (its isValidFormat: jpg/jpeg/png/svg). */
export type LogoMime = "image/png" | "image/jpeg" | "image/svg+xml";

export type LogoRejectReason =
  | "unsafe-url"
  | "unresolvable"
  | "private-address"
  | "unreachable"
  | "http-status"
  | "too-large"
  | "not-an-image"
  | "unsupported-format";

export type SafeLogo = { ok: true; bytes: Buffer; mime: LogoMime; sha256: string; dataUri: string };
export type FetchSafeLogoResult = SafeLogo | { ok: false; reason: LogoRejectReason };

function startsWithBytes(bytes: Buffer, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

/**
 * Name a logo's format from its magic bytes. A renderable format answers its mime; a recognized image
 * format @react-pdf cannot render (GIF, WebP, BMP, ICO, TIFF, AVIF/HEIC) answers "unsupported";
 * anything else (HTML, JSON, arbitrary XML) answers null, "not an image".
 */
export function sniffLogoFormat(bytes: Buffer): LogoMime | "unsupported" | null {
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  const ascii = bytes.subarray(0, 12).toString("latin1");
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return "unsupported";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "unsupported";
  if (ascii.startsWith("BM")) return "unsupported";
  if (startsWithBytes(bytes, [0x00, 0x00, 0x01, 0x00])) return "unsupported"; // ICO
  if (startsWithBytes(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWithBytes(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return "unsupported"; // TIFF
  if (ascii.slice(4, 8) === "ftyp") return "unsupported"; // AVIF / HEIC
  // SVG: @react-pdf's own test is "starts with <?xml or <svg"; additionally require an <svg root early
  // in the document so an arbitrary XML payload is not called an image.
  const head = bytes.subarray(0, 2048).toString("utf8").replace(/^﻿/, "").trimStart();
  if ((head.startsWith("<svg") || head.startsWith("<?xml")) && /<svg[\s>/]/.test(head)) return "image/svg+xml";
  return null;
}

/**
 * The pure byte check of a fetched logo: size cap, then format. Exported so a save-time pre-check can
 * share the exact rule the fetch applies.
 */
export function checkLogoBytes(bytes: Buffer): { ok: true; mime: LogoMime } | { ok: false; reason: LogoRejectReason } {
  if (bytes.length > MAX_LOGO_BYTES) return { ok: false, reason: "too-large" };
  if (bytes.length === 0) return { ok: false, reason: "not-an-image" };
  const format = sniffLogoFormat(bytes);
  if (format === "unsupported") return { ok: false, reason: "unsupported-format" };
  if (format === null) return { ok: false, reason: "not-an-image" };
  return { ok: true, mime: format };
}

/** Fetch an owner-supplied logo under the full guard. Never throws; every refusal names its reason. */
export async function fetchSafeLogo(rawUrl: string): Promise<FetchSafeLogoResult> {
  if (!isSafePublicHttpsUrl(rawUrl)) return { ok: false, reason: "unsafe-url" };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "unsafe-url" };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 [..] brackets
  let pinned: { address: string; family: 4 | 6 };
  try {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length) return { ok: false, reason: "unresolvable" };
    if (addrs.some((a) => isPrivateOrInternalHost(a.address))) return { ok: false, reason: "private-address" };
    pinned = { address: addrs[0]!.address, family: addrs[0]!.family === 6 ? 6 : 4 };
  } catch {
    return { ok: false, reason: "unresolvable" };
  }

  const res = await pinnedHttpsGet(url, {
    ...pinned,
    maxBytes: MAX_LOGO_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
    accept: "image/png, image/jpeg, image/svg+xml",
  });
  if (!res.ok) {
    if (res.reason === "too-large" || res.reason === "http-status") return { ok: false, reason: res.reason };
    return { ok: false, reason: "unreachable" };
  }

  const checked = checkLogoBytes(res.bytes);
  if (!checked.ok) return checked;
  const sha256 = createHash("sha256").update(res.bytes).digest("hex");
  return {
    ok: true,
    bytes: res.bytes,
    mime: checked.mime,
    sha256,
    dataUri: `data:${checked.mime};base64,${res.bytes.toString("base64")}`,
  };
}

/** Thin wrapper kept for callers that only need the data URI: the URI, or null on any refusal. */
export async function resolveSafeLogoDataUri(rawUrl: string): Promise<string | null> {
  const logo = await fetchSafeLogo(rawUrl);
  return logo.ok ? logo.dataUri : null;
}
