// Shared SSRF guard for caller-supplied outbound URLs. Two security-critical checks — the briefing
// logo-URL guard (branding.isSafeLogoUrl) and the alert-webhook validator (alerts.validateAlertWebhookUrl)
// — had each hand-rolled "parse a URL, require https, reject private/internal hosts" and DRIFTED: the
// branding copy additionally blocked CGNAT 100.64.0.0/10, IPv6 unique-local/link-local, multicast, and
// internal hostnames the webhook copy missed, leaving the webhook sink reachable at e.g.
// https://100.64.0.1 or https://[fd00::1]. This is the single, stricter union both now call.
//
// A hostname that RESOLVES to a private IP (DNS rebinding) is NOT caught here — defeating that needs a
// resolve-and-pin at the fetch site. This closes the realistic direct-IP / localhost / metadata vectors.

/**
 * True when `host` (an already-lower-cased hostname with any IPv6 brackets stripped) is a loopback,
 * private-range, CGNAT, link-local, unique-local, multicast/reserved IP literal, or a known
 * internal/special hostname (localhost, *.local, *.internal, cloud metadata). The inverse of "safe to
 * send caller data to". Pure — no I/O.
 */
export function isPrivateOrInternalHost(host: string): boolean {
  if (!host) return true; // an empty host is never safe to fetch
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "metadata.google.internal") return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true; // malformed octet → unsafe
    if (a === 0 || a === 10 || a === 127) return true; // this-host, private-A, loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // private-B
    if (a === 192 && b === 168) return true; // private-C
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (100.64.0.0/10)
    if (a >= 224) return true; // multicast / reserved
  }

  if (host === "::1" || host === "::") return true; // IPv6 loopback / unspecified
  if (host.startsWith("fc") || host.startsWith("fd")) return true; // IPv6 unique-local fc00::/7
  if (host.startsWith("fe80")) return true; // IPv6 link-local
  return false;
}

/**
 * True when `raw` parses as an https URL whose host is publicly reachable (not loopback / private /
 * CGNAT / link-local / unique-local / multicast / internal). Does NOT check inline credentials or
 * length — those are caller-specific wrapper concerns layered on top. Returns false on any parse error.
 */
export function isSafePublicHttpsUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 [..] brackets
  return !isPrivateOrInternalHost(host);
}
