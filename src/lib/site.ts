// The site's public origin, resolved from one place. Absolute URLs for the sitemap, OG metadata,
// metadataBase, JSON-LD, emails, and webhooks all derive from this so they can't drift. Returns "" when
// no public domain is configured (local dev / a preview without a fixed host), which callers treat as
// "emit nothing absolute" rather than guessing.
export function publicBaseUrl(): string {
  // Explicit config wins. On Vercel, fall back to the project's STABLE production domain
  // (VERCEL_PROJECT_PRODUCTION_URL — not the per-deploy VERCEL_URL) so OG/canonical/metadataBase resolve
  // to the real host at build + runtime with no manual env. It has no scheme, so prefix https://.
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base =
    process.env.ASCENT_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || (vercelProd ? `https://${vercelProd}` : "");
  return base.replace(/\/+$/, "");
}
