# Feature Scout — App Shell, SEO & Error Pages (ascent, 2026-06-14)
> Total: 5
> Severity: 0C / 2H / 2M / 1L

## 1. Per-repo OG card renders the score, not just the repo name
- **Severity**: High
- **Category**: user_benefit
- **File**: src/app/report/[owner]/[repo]/opengraph-image.tsx:30 (static body, no score)
- **Scenario**: A dev runs a scan, gets "L3 Optimizing — 72/100", and pastes the `/report/{owner}/{repo}` link into Slack/X/GitHub PR to brag or rally the team. The unfurl card is the single most-viewed surface of the whole product.
- **Gap**: `generateMetadata` (page.tsx:38) already fetches the real report and bakes the score + level into the `<title>`/`twitter` text — but the co-located OG **image** is purely static: it renders only `owner/repo` and generic boilerplate ("a 5-level ladder across 9 dimensions"). Confirmed via grep: the image file never calls `getScanReportByCommit`/`cacheGet`/`scanRepository` — `grep score|level|getScanReport` in the OG file returns only comments. Every shared card looks identical regardless of whether the repo is L1 or L5, throwing away the viral "look at our number" moment.
- **Impact**: Massive top-of-funnel leverage. A card showing a big "72 / L3 Optimizing" ring + the 9-dimension mini-bars is shareable proof; a card that says nothing is wallpaper. Same audience as the badge, but at link-preview scale (every PR comment, every tweet).
- **Fix sketch**: Reuse the page's lookup: in the OG handler call `getScanReportByCommit(owner, name, {headSha, orgSlug})` (already imported in the sibling page) with a try/catch that falls back to today's static card on miss, so unfurls never break. Render overall score, `LEVEL_GLYPH`+level name (from `@/lib/ui`), and a row of dimension scores. ~half a day; the data path and color tokens already exist.

## 2. Org / fleet pages have no shareable metadata or OG image
- **Severity**: High
- **Category**: feature
- **File**: src/app/org/[slug]/page.tsx (no generateMetadata); src/app/org/* (no opengraph-image)
- **Scenario**: A platform lead shares their org leaderboard (`/org/acme`) or the "Fleet Command" war-room (`/org/acme/live`) with their VP or in a company channel — "here's where all 40 repos stand." This is the headline ORG-layer value prop.
- **Gap**: Confirmed: `grep generateMetadata|export const metadata` across `src/app/org` returns nothing, and `find src/app/org -name opengraph-image*` finds none. Org links inherit only the generic site title/description and the generic homepage OG card. There's no "Acme — fleet maturity" title and no card showing the rollup (avg score, posture mix, # AI-Native repos) — even though `getOrgRollup(slug)` already returns exactly that data (used by live/page.tsx:13).
- **Impact**: The org layer is the monetized tier (credits/quota/billing). Its primary growth loop is an exec forwarding a fleet link; today that forward unfurls as a blank generic card and a wrong-looking title. Closing this turns every internal share into an ad for the org product.
- **Fix sketch**: Add `generateMetadata` to `org/[slug]/page.tsx` (title `"{org} — fleet maturity · Ascent"`, description from rollup avg/# repos) and an `org/[slug]/opengraph-image.tsx` that reads `getOrgRollup(slug)` and draws avg score + posture distribution (mirror the report OG layout). Gate private orgs to a neutral card like the badge route does. ~1 day.

## 3. No Web App Manifest / installable PWA shell
- **Severity**: Medium
- **Category**: functionality
- **File**: src/app/layout.tsx:16 (metadata has only `icons`+`themeColor`); no app/manifest.ts
- **Scenario**: A power user who checks fleet maturity daily wants Ascent pinned as an app (home-screen/desktop icon, standalone window, no browser chrome). On mobile the browser offers "Add to Home Screen" with a proper name + icon.
- **Gap**: Confirmed: `grep manifest|webmanifest|appleWebApp` across `src` finds only the *scanner's* analysis of target-repo manifests — no `app/manifest.ts`, no `manifest` key in the layout metadata, no `apple-touch-icon`/`appleWebApp`. `themeColor` is set (layout.tsx:25) but there's no manifest to make the app installable, and no maskable icon. The dark theme + single brand color is ideal PWA material.
- **Impact**: Cheap retention/stickiness for the daily-monitoring persona (the org tier). Installed PWAs get an icon on the device and a friction-free re-entry point; also improves Lighthouse "Installable" + perceived polish for a "maturity" product judged partly on its own polish.
- **Fix sketch**: Add `src/app/manifest.ts` (`MetadataRoute.Manifest`) with name/short_name "Ascent", `theme_color`/`background_color` `#080d1a`, `display: "standalone"`, and 192/512 + maskable icons derived from the existing `/brand/logo-mark-nobg.png`. Add `appleWebApp` to layout metadata. No service worker needed for installability. ~2-3 hours.

## 4. No structured data (JSON-LD) for rich search results
- **Severity**: Medium
- **Category**: feature
- **File**: src/app/page.tsx:214 (pricing/levels/how sections, no schema); src/app/layout.tsx
- **Scenario**: Someone Googles "AI engineering maturity" or a repo name; Ascent's homepage and report permalinks compete for the click. Rich results (org logo, sitelinks, FAQ accordions, software-application rating) win the click.
- **Gap**: Confirmed: `grep application/ld\+json|schema.org|@context` across `src` returns nothing. The homepage already has well-structured `#levels`, `#how`, `#pricing` sections (page.tsx) and a canonical 9-dimension rubric, but emits no `Organization`, `SoftwareApplication`, `FAQPage`, or `BreadcrumbList` JSON-LD. Report pages have rich titles but no `Dataset`/`Rating` schema. Also no `metadataBase` is set anywhere (`grep metadataBase` empty), which weakens absolute-URL resolution for OG/canonical.
- **Impact**: Pure organic-acquisition upside for a discovery-driven product. Structured data is the difference between a plain blue link and a rich card; the content to mark up already exists, so this is near-free SEO.
- **Fix sketch**: Add an inline `<script type="application/ld+json">` in `layout.tsx` (Organization + SoftwareApplication) and a `FAQPage` block on the homepage built from the existing levels/method copy. Set `metadataBase: new URL(ASCENT_PUBLIC_URL)` in layout metadata. ~half a day.

## 5. Sitemap omits the badge + connect entry routes (and is hand-maintained)
- **Severity**: Low
- **Category**: feature
- **File**: src/app/sitemap.ts:13 (hardcoded 4-route list)
- **Scenario**: A repo owner searches "ascent maturity badge" hoping to find the badge generator; crawlers should index every public marketing/tool route.
- **Gap**: Confirmed: `sitemap.ts` lists only `/`, `/report`, `/trends`, `/usage`. The public **`/badge`** generator (a real indexable tool page with its own metadata, badge/page.tsx:4) and other top-of-funnel pages are absent, and the list is a hand-maintained array that will silently drift as routes are added (the org-demo and badge links in `Brand.tsx`/footer already point at routes not in the sitemap). Note `/connect`/`/onboarding`/`/launch` are intentionally disallowed in robots.ts — correctly excluded — so this is specifically about the *public tool/marketing* routes.
- **Impact**: Minor but real discoverability loss for the badge tool (a viral surface) and ongoing maintenance drift risk. Low effort.
- **Fix sketch**: Add `/badge` (and any other public marketing route) to the `routes` array in `sitemap.ts`; optionally derive the list from a single shared `PUBLIC_ROUTES` constant also consumed by the footer nav so they can't diverge. ~1 hour.
