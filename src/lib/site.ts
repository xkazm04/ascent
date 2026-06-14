// The site's public origin, resolved from one place. Absolute URLs for the sitemap, OG metadata,
// metadataBase, JSON-LD, emails, and webhooks all derive from this so they can't drift. Returns "" when
// no public domain is configured (local dev / a preview without a fixed host), which callers treat as
// "emit nothing absolute" rather than guessing.
export function publicBaseUrl(): string {
  return (process.env.ASCENT_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
}
