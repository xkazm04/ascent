// The site's public origin, resolved from one place. Absolute URLs for the sitemap, OG metadata,
// metadataBase, JSON-LD, emails, and webhooks all derive from this so they can't drift. Returns "" when
// no public domain is configured (local dev / a preview without a fixed host), which callers treat as
// "emit nothing absolute" rather than guessing.

import { DIMENSIONS, LEVELS } from "@/lib/maturity/model";

export function publicBaseUrl(): string {
  // Explicit config wins. On Vercel, fall back to the project's STABLE production domain
  // (VERCEL_PROJECT_PRODUCTION_URL — not the per-deploy VERCEL_URL) so OG/canonical/metadataBase resolve
  // to the real host at build + runtime with no manual env. It has no scheme, so prefix https://.
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base =
    process.env.ASCENT_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || (vercelProd ? `https://${vercelProd}` : "");
  return base.replace(/\/+$/, "");
}

// ---- Brand copy, single-sourced so the shell (layout, manifest, OG cards, footer) can't drift ----
// The rubric counts are DERIVED from the canonical maturity model (currently 5 levels / 9 dimensions),
// so adding a level/dimension updates every share/search/PWA snippet at once — the layout already did
// this; manifest + the OG routes previously re-hardcoded "5-level" / "9 dimensions" and could go stale.

/** The brand tagline, lowercase-lead for the "Ascent — …" title/name/alt lockups. */
export const SITE_TAGLINE = "the maturity index for AI-native engineering";

/** Sentence-case lead for standalone use (footer headline, OG headline) — derived from SITE_TAGLINE. */
export const SITE_TAGLINE_TITLE = SITE_TAGLINE.charAt(0).toUpperCase() + SITE_TAGLINE.slice(1);

/** Rubric counts, derived from the model so copy can't drift from the engine. */
export const LEVEL_COUNT = LEVELS.length;
export const DIMENSION_COUNT = DIMENSIONS.length;

/** The canonical search/share description — count-derived so the snippet can never contradict the model. */
export function siteDescription(): string {
  return `Score how AI-native your engineering org is from a GitHub repo: a ${LEVEL_COUNT}-level maturity ladder across ${DIMENSION_COUNT} dimensions, with evidence and a roadmap to the next level.`;
}
