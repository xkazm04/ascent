# App Shell, SEO & Error Pages — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)
> Lens split: bug-hunter 2 / ui-perfectionist 3
> Files read: 13

## 1. /api/health leaks raw DB error strings to unauthenticated callers
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: Information disclosure / health endpoint
- **File**: src/app/api/health/route.ts:35
- **Scenario**: When the DB is configured but unreachable, the route returns `{ status, db, autoscan, ...result }`. `result` (from `dbHealthCheck()`, src/lib/db/client.ts:419/425) carries an `error` field that is the raw upstream message via `errorInfo(err).message` — e.g. a Postgres/DSQL driver string that can include the connection host, user, SSL mode, or auth-failure text. `/api/health` has no auth gate (`runtime = "nodejs"`, `force-dynamic`, plain `GET()`), so any visitor hitting `/api/health` during an outage sees internal infrastructure detail.
- **Root cause**: The spread `...result` was meant to surface the `reconnected` boolean for monitors, but it also re-exports the diagnostic `error` string unfiltered to a public endpoint.
- **Impact**: Recon surface for attackers during an incident; exposes infra topology/credentials-adjacent text. Health endpoints are routinely scraped, so this leaks on the worst day (an outage).
- **Fix sketch**: Don't spread `result`. Return only the boolean flags publicly: `{ status, db, autoscan, reconnected: result.reconnected }`. Log `result.error` server-side (console.error) instead of returning it, or gate the verbose body behind a header check on `CRON_SECRET`.

## 2. robots disallows /connect and /onboarding while sitemap advertises them
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: SEO route generation / crawl-directive conflict
- **File**: src/app/sitemap.ts:16,19 (vs src/app/robots.ts:17)
- **Scenario**: `robots.ts` line 17 disallows `["/api/", "/connect", "/onboarding", "/launch"]`. But `sitemap.ts` lines 16 and 19 list `/connect` (priority 0.6) and `/onboarding` (priority 0.5) as indexable URLs. A sitemap is a positive "please crawl these" signal; robots is a negative "do not crawl" signal for the same two paths. The SHELL-5 comment in sitemap.ts (lines 8-9) explicitly calls these "public, indexable marketing routes" — directly contradicting the robots rule.
- **Root cause**: The two SEO generators derive their path lists independently and drifted; one author treated connect/onboarding as funnel-private (robots), another as marketing-public (sitemap).
- **Impact**: Google Search Console flags "Submitted URL blocked by robots.txt" warnings; the funnel entry points get neither indexed (blocked) nor cleanly excluded. Mixed signals waste crawl budget and look broken in SEO tooling.
- **Fix sketch**: Pick one intent. If these are indexable funnels, drop `/connect` and `/onboarding` from `robots.ts` disallow. If they're private, remove them from `sitemap.ts`. Best: derive both lists from one shared constant so they can't diverge (the same pattern the codebase already uses for `publicBaseUrl()`).

## 3. error.tsx drops all brand chrome — visually inconsistent with not-found
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: Error-page visual quality / chrome consistency
- **File**: src/app/error.tsx:29-58
- **Scenario**: The root `error.tsx` renders a bare centered `<main>` with no `SiteHeader`/`SiteFooter`, while the sibling `not-found.tsx` (lines 9-37) wraps its content in `<SiteHeader/>` … `<SiteFooter/>`. Two App Router boundaries a user can hit from the same page render with completely different framing — one has the logo/nav/footer, the other is a floating card on the gradient. A user who hits a runtime error loses the logo, the "back to home" affordance in the header, and footer links.
- **Root cause**: The header comment (lines 10-13) correctly notes `error.tsx` must be a Client Component and can't import the server `SiteHeader` (which pulls `next/headers`). But the fix stopped at "no chrome" instead of providing a client-safe brand mark. The standalone `Logo` in Brand.tsx is itself client-safe (just `next/image` + `next/link`) yet isn't reused here.
- **Impact**: Jarring, off-brand error experience; the most stressful screen a user sees is the least branded. Inconsistent with the deliberate chrome work in not-found.tsx.
- **Fix sketch**: Import the lightweight `Logo` from `@/components/Brand` (no server deps) and render a minimal branded header bar at the top of `error.tsx`, plus a slim footer line, so both boundaries share a recognizable frame.

## 4. EmptyState page variant title is an unconditional <h1> — duplicate/again-missing landmark
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: Accessibility / heading semantics
- **File**: src/components/EmptyState.tsx:48,58-59
- **Scenario**: For `variant="page"` the title always renders as `<h1>` (line 59). The doc comment (lines 14-21) says this component backs SignInNotice, OrgEmpty, the trends empty/error states, and repo-picker empties — several of which render *inside* a page that already owns an `<h1>` (e.g. an org dashboard with a heading plus an inline empty state). That yields two `<h1>`s on one page. Conversely, when `title` is omitted (`title != null` guard, line 58), a page-variant empty renders with no heading landmark at all.
- **Root cause**: Heading level is hardcoded to the page/section variant rather than being caller-controlled, and there's no way to demote the page empty's title to `<h2>` when it's nested under an existing page heading.
- **Impact**: Screen-reader document outline breaks (multiple top-level headings, or a sectioned empty with no heading). Minor but it's the canonical app-wide notice component, so the defect multiplies.
- **Fix sketch**: Add an optional `as?: "h1" | "h2"` (or `headingLevel`) prop defaulting to `h1` for page / `div` for section, and have nested callers pass `h2`. Keeps the hero case correct while fixing nested usages.

## 5. opengraph-image uses a literal "5-level"/"9 dimensions" string instead of the rubric — drift risk the rest of the shell avoids
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: SEO/OG content consistency
- **File**: src/app/opengraph-image.tsx:55-56,61
- **Scenario**: layout.tsx goes to deliberate lengths to derive its copy from the canonical rubric — `SITE_DESCRIPTION` interpolates `LEVELS.length` and `DIMENSIONS.length` (lines 17, 25-28) precisely so the snippet "can never drift from the model." The OG image, which is the *visual* share card every unfurl shows, instead hardcodes "5-level ladder across 9 dimensions" (line 56) and a fixed `["L0".."L4"]` pill row (line 61). If the rubric ever changes level/dimension count, the text metadata updates automatically but the picture every social link displays silently lies.
- **Root cause**: The OG renderer wasn't wired to `LEVELS`/`DIMENSIONS` like the rest of the shell; the counts and the L0–L4 strip are inline literals.
- **Impact**: Future maturity-model change produces a share card that contradicts the page and the metadata — exactly the drift class the layout author engineered against. Cosmetic today, embarrassing on the day the rubric changes.
- **Fix sketch**: Import `LEVELS`/`DIMENSIONS` from `@/lib/maturity/model` and build the count text and the pill row from them (map `LEVELS` to the `L#` labels), mirroring layout.tsx's approach.
