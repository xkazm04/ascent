> Total: 5 findings (0 critical, 2 high, 2 medium, 1 low)

# App Shell, SEO & Error Pages — combined bug+ui scan

## 1. Sitemap advertises routes that robots.txt disallows from indexing
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: seo-correctness
- **File**: src/app/sitemap.ts:17-19 (vs src/app/robots.ts:17)
- **Scenario**: With a public base URL configured, `sitemap.xml` lists `/connect` (priority 0.6) and `/onboarding` (priority 0.5). But `robots.ts` disallows exactly `["/api/", "/connect", "/onboarding", "/launch"]`. A crawler fetches the sitemap, sees `/connect` + `/onboarding`, then is blocked by robots.txt from crawling them.
- **Root cause**: The two SEO contracts were edited independently (SHELL-5 added marketing routes to the sitemap; the robots disallow list treats `/connect` + `/onboarding` as private funnels). `seo.test.ts` pins the robots disallow set and pins the sitemap's *negative* cases (`/api/`, `/org`, `/launch`) plus a few positive controls, but never asserts the two lists are disjoint — so the contradiction passes CI.
- **Impact**: Google Search Console reports "Submitted URL blocked by robots.txt" warnings for every affected sitemap entry; wasted crawl budget and a noisy, lower-trust SEO signal. Either the routes should be crawlable (drop them from robots disallow) or removed from the sitemap — currently the app asserts both.
- **Fix sketch**: Decide intent per route. If `/connect`/`/onboarding` are indexable marketing entry points, remove them from `robots.ts` disallow; if they're private funnels, remove them from `sitemap.ts`. Add a test asserting `sitemap` paths and `robots` disallow paths are disjoint.

## 2. robots.txt omits the Sitemap/host line on Vercel default-domain deploys (base-URL resolver drift)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: seo-correctness
- **File**: src/app/robots.ts:5-7 (vs src/lib/site.ts:9-12)
- **Scenario**: On a Vercel production deploy with neither `ASCENT_PUBLIC_URL` nor `NEXT_PUBLIC_APP_URL` set (the documented zero-config path), `sitemap.ts` calls `publicBaseUrl()` which falls back to `https://${VERCEL_PROJECT_PRODUCTION_URL}` and emits a full `sitemap.xml` with absolute URLs. `robots.ts` uses its own local `baseUrl()` that reads ONLY `ASCENT_PUBLIC_URL`/`NEXT_PUBLIC_APP_URL` — so it returns `""` and omits the `Sitemap:`/`host` lines entirely.
- **Root cause**: `robots.ts` duplicates the base-URL logic instead of importing `publicBaseUrl()` from `lib/site.ts`, and the duplicate is missing the `VERCEL_PROJECT_PRODUCTION_URL` fallback. `seo.test.ts` "does not drift" tests only exercise the two explicit env vars, never the Vercel fallback, so the divergence is invisible to CI.
- **Impact**: A live sitemap exists but robots.txt never points crawlers to it, defeating sitemap auto-discovery on the most common (zero-config Vercel) deploy. The whole SHELL sitemap effort is silently inert in production.
- **Fix sketch**: Replace `robots.ts`'s local `baseUrl()` with `import { publicBaseUrl } from "@/lib/site"` so both resolvers share one source of truth; extend the drift test to cover `VERCEL_PROJECT_PRODUCTION_URL`.

## 3. Homepage (and marketing routes) share as a small Twitter card despite a 1200×630 OG image
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: seo/social
- **File**: src/app/layout.tsx:21-33 (and src/app/page.tsx — no `metadata`/`twitter`)
- **Scenario**: `opengraph-image.tsx` exists and renders a 1200×630 card; its own header comment states "Pages set `twitter: { card: "summary_large_image" }` in metadata … this is the fallback that keeps every link rich." But the root layout sets no `openGraph`/`twitter` block, and `page.tsx` sets no metadata at all. Only `/report/*`, `/org/*`, and `/launch` declare `twitter.card`. So sharing the homepage (or `/pricing`, `/about`, `/badge`, `/usage`) on X/Twitter yields the small `summary` card, not the large image.
- **Root cause**: The default OG image was added but the matching `twitter.card: "summary_large_image"` (and an `openGraph` block) was never set at the root layout where every page would inherit it — the comment's stated assumption ("pages set it") is false for the marketing surface.
- **Impact**: The most-shared route (the homepage) unfurls with a tiny thumbnail on X, undercutting the carefully-built OG card; inconsistent social presentation across the site.
- **Fix sketch**: Add to the root `layout.tsx` metadata: `openGraph: { title, description, type: "website" }` and `twitter: { card: "summary_large_image", title, description }`. Inherited by all pages; per-route metadata still overrides.

## 4. Global skip-link target (`#main`) is missing on several full-page routes
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: src/app/layout.tsx:76-81 (target absent in src/app/launch/page.tsx:42, src/app/connect/page.tsx:30)
- **Scenario**: The root layout renders a single "Skip to content" link pointing at `#main`. Pages such as `/launch` and `/connect` render `<main className="…">` with no `id="main"`, so activating the skip link does nothing (the browser can't find the anchor) — a keyboard/screen-reader user is left tabbing through the full header nav on those pages.
- **Root cause**: The skip-link is a global contract in `layout.tsx`, but the `id="main"` it depends on is hand-applied per page rather than guaranteed. Only ~9 routes carry it; the rest silently break the contract.
- **Impact**: WCAG 2.4.1 (Bypass Blocks) failure on the affected routes; the skip link is present but non-functional, which is worse than absent for assistive-tech users who rely on it.
- **Fix sketch**: Add `id="main"` to the `<main>` of every top-level route (`/launch`, `/connect`, `/onboarding`, `/usage`, `/badge`, `/trends`, …), or centralize a `<main id="main">` wrapper so individual pages can't forget it. A lint/test asserting each `app/**/page.tsx` `<main>` carries the id would prevent regressions.

## 5. /api/health discloses deployment configuration to unauthenticated callers
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: info-disclosure
- **File**: src/app/api/health/route.ts:21-31,41-49
- **Scenario**: `GET /api/health` is unauthenticated (and the route is itself disallowed in robots but reachable directly). Its body always includes `autoscan: { ready, cronSecret, githubApp, db }` — explicit booleans revealing whether `CRON_SECRET`, the GitHub App, and the database are configured for this deployment.
- **Root cause**: Operational readiness fields (intended for an internal monitor) are returned on the same public, unauthenticated liveness endpoint with no gating. The DB error string is correctly suppressed, but the config-presence booleans are not treated as sensitive.
- **Impact**: Low — leaks deployment posture (which integrations are wired) to anyone, aiding reconnaissance (e.g. an attacker learns the cron secret is unset, so the rescan path is open/fail-closed). Not a direct compromise.
- **Fix sketch**: Gate the `autoscan` block behind a header/secret check (reuse `CRON_SECRET` or a monitor token), or reduce the public body to `{ ready: boolean }` without the per-integration breakdown; keep the detailed shape server-logged.
