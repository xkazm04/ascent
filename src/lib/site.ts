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

// ── Curated demo org ─────────────────────────────────────────────────────────
// The one org showcased across the marketing surface — the header "Org demo" link, the landing's
// org-preview deep links (IndexOrg), the /about CTAs, the onboarding "just show me" path, and the 404
// fallback. Centralized + env-overridable (NEXT_PUBLIC_DEMO_ORG, a NEXT_PUBLIC_ var so it inlines into
// client bundles too) so every example points at ONE real, seeded org instead of a slug hardcoded in a
// dozen places. Defaults to "vercel", which the seed scripts (scripts/seed-fleet.mjs / seed-org.mjs)
// populate — point it at any org you've actually scanned. The deployment is responsible for that org
// existing (a curated demo trades the always-present public-org fallback for a consistent, branded one).

/** Slug of the curated demo org (lower-cased, the canonical org-row casing). */
export const DEMO_ORG_SLUG = (process.env.NEXT_PUBLIC_DEMO_ORG || "vercel").trim().toLowerCase();

/** Display name for the demo org — the slug title-cased (e.g. "vercel" → "Vercel"), so visible copy
 *  stays correct when the slug is reconfigured instead of hardcoding one org's name. */
export const DEMO_ORG_NAME = DEMO_ORG_SLUG.charAt(0).toUpperCase() + DEMO_ORG_SLUG.slice(1);

/** Build a link into the demo org dashboard, optionally to a sub-tab: `demoOrgHref("executive")`. */
export function demoOrgHref(subPath = ""): string {
  const sub = subPath.replace(/^\/+/, "");
  return sub ? `/org/${DEMO_ORG_SLUG}/${sub}` : `/org/${DEMO_ORG_SLUG}`;
}
