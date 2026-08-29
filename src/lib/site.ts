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

/**
 * The brand "ink" — the page/shell background. TS twin of globals.css `--color-ink`: CSS @theme vars
 * can't be imported by the manifest/viewport code, so the PWA + status-bar consumers (viewport
 * themeColor, manifest background_color/theme_color) read this constant instead of re-hardcoding the
 * hex. If the ink ever changes, update BOTH this and `--color-ink` (plus body background) in
 * globals.css — global-error.tsx keeps its own documented literals to stay self-contained. Not to be
 * confused with og-brand's BRAND_INK (#04070e), the glyph ink ON the accent tile.
 */
export const BRAND_INK = "#080d1a";

/**
 * The product description, in the three voices the shell needs. ONE sentence shape, count-derived, so
 * the search snippet, the PWA install card and the social card cannot contradict each other or the
 * model — this file's header has claimed that single-sourcing since the counts were centralized, but
 * only the counts were: layout read `siteDescription()` while manifest.ts and the root OG route each
 * re-typed the sentence, in three different wordings, for the same slot.
 *
 * They differ only where the surface forces it, and each says why:
 *   - `siteDescription()`      meta description + JSON-LD. The full sentence; search snippets truncate
 *                              around 160 chars and this is written to survive that.
 *   - `siteDescriptionShort()` Web App Manifest. Shown in install prompts and app listings with a much
 *                              tighter budget, so it drops the trailing clause.
 *   - `siteDescriptionCard()`  the OG card body, which addresses the reader in the second person
 *                              ("any GitHub repo") because a social card is an invitation, not a
 *                              catalogue entry.
 */
export function siteDescription(): string {
  return `Score how AI-native your engineering org is from a GitHub repo: a ${LEVEL_COUNT}-level maturity ladder across ${DIMENSION_COUNT} dimensions, with evidence and a roadmap to the next level.`;
}

/** Install-prompt copy (manifest). The full sentence minus its trailing clause. */
export function siteDescriptionShort(): string {
  return `Score how AI-native your engineering org is from a GitHub repo. A ${LEVEL_COUNT}-level maturity ladder across ${DIMENSION_COUNT} dimensions, with evidence and a roadmap.`;
}

/** Social-card body (the root OG route). Second person — a card is an invitation. */
export function siteDescriptionCard(): string {
  return `Score any GitHub repo on a ${LEVEL_COUNT}-level ladder across ${DIMENSION_COUNT} dimensions, with evidence and a route to the next level.`;
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

/** Href for the demo org dashboard — compat alias for `demoOrgHref()`. */
export const DEMO_ORG_HREF = demoOrgHref();

/**
 * Public URL of this deployment's SOURCE REPOSITORY, or null when the operator hasn't named one.
 *
 * Ascent is AGPL-3.0, so a deployment's users are entitled to its source (§13) and the marketing
 * surfaces make an open-source claim a visitor should be able to check in one click. There is
 * deliberately **no default**: guessing a GitHub URL would ship a dead link on every fork and
 * self-hosted instance, and a broken "view the source" link damages the exact claim it is there to
 * support more than its absence does. Surfaces degrade to naming the in-repo path instead.
 *
 * A fork that has modified Ascent should point this at ITS OWN repository, not upstream — that is
 * what the licence actually asks for.
 */
export const SOURCE_REPO_URL: string | null =
  process.env.NEXT_PUBLIC_SOURCE_REPO_URL?.trim().replace(/\/+$/, "") || null;

/** Link to a path inside the source repository (e.g. `sourceRepoHref("docs/SELF-HOSTING.md")`), or
 *  null when no repository URL is configured. Assumes a GitHub-style `/blob/HEAD/<path>` layout. */
export function sourceRepoHref(path = ""): string | null {
  if (!SOURCE_REPO_URL) return null;
  const clean = path.replace(/^\/+/, "");
  return clean ? `${SOURCE_REPO_URL}/blob/HEAD/${clean}` : SOURCE_REPO_URL;
}

/**
 * Where a visitor reports a problem or asks a question — the public issue tracker of the repository
 * this deployment runs.
 *
 * Derived from {@link SOURCE_REPO_URL} so an operator who has named their own fork gets THEIR tracker,
 * on the footer of every page and — more importantly — in the "contact us" fallback of the privacy
 * policy and the terms, where the link is the operator's own contact channel and pointing it at a
 * stranger's repository is simply wrong. Those three surfaces each hardcoded the upstream URL, so a
 * fork's users filed the operator's privacy requests against upstream.
 *
 * Unlike SOURCE_REPO_URL this DOES fall back to upstream rather than to nothing, and the difference is
 * deliberate: a wrong "view the source" link makes a licence claim the deployment cannot honour, while
 * a feedback link to upstream is merely the second-best address — and no feedback channel at all is
 * worse than a slightly wrong one. An operator who cares sets NEXT_PUBLIC_SOURCE_REPO_URL.
 */
const UPSTREAM_ISSUES_URL = "https://github.com/xkazm04/ascent/issues";
export const FEEDBACK_URL: string = SOURCE_REPO_URL ? `${SOURCE_REPO_URL}/issues` : UPSTREAM_ISSUES_URL;

/**
 * Serialize a JSON-LD payload for inlining into a `<script type="application/ld+json">`.
 *
 * `JSON.stringify` alone is NOT safe inside an HTML script element: the HTML parser terminates the
 * block at the first literal `</script`, wherever it appears — including inside a JSON string — so a
 * value carrying that sequence closes the tag and everything after it is parsed as markup. Escaping
 * `<` as `<` keeps the JSON semantically identical (JSON.parse decodes the escape) while making
 * the sequence unrepresentable in the output. U+2028/U+2029 are escaped for the same reason: legal in
 * JSON, but line terminators to a JavaScript parser.
 *
 * The three call sites (the root layout's Organization+SoftwareApplication graph, the landing FAQ,
 * the /about-org FAQ) each carried a comment asserting their payload was static and therefore safe.
 * Two were; the root layout's interpolates `publicBaseUrl()` — an env-derived value — so the claim was
 * already false there, and the next contributor to add a dynamic field to any of them would have read
 * "safe to inline" and had no reason to check. One escaping door instead of three re-derived proofs.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

