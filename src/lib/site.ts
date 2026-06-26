// The slug of the seeded public demo org the marketing CTAs link into ("explore the live demo"). Kept
// here as a single source so the duplicated `/org/vercel` magic string can't drift between the CTAs
// (and so a deployment that seeds the demo under a different slug only edits one place).
export const DEMO_ORG = "vercel";

/** The marketing "explore the live demo" destination path. */
export function demoOrgHref(): string {
  return `/org/${DEMO_ORG}`;
}

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
