# App Shell, SEO & Error Pages — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. EmptyState's CTA links lack the shared `.focus-ring` token and drift from the canonical button style
- **Severity**: High
- **Category**: a11y
- **File**: `src/components/EmptyState.tsx:72-84`
- **Scenario**: `EmptyState` is documented as "the canonical empty/notice state for the whole app" — every hand-rolled notice routes through it. Yet its action `<Link>`s (both the primary accent button and the outline button) are the only shell CTAs WITHOUT the `focus-ring` class. Every sibling surface applies it: `RouteError.tsx:57,63`, `not-found.tsx:58,68`, all of `Brand.tsx`. The layout even styles the skip link with `focus-ring`. Keyboard users tabbing to an empty state's CTA get only the browser default outline, not the brand's 2px accent `focus-visible` ring. The buttons also use a different scale (`rounded-xl px-5 py-2.5 text-base`) than the identical-role CTAs in RouteError/not-found (`rounded-md px-4 py-2`), so "Scan a repo" on a 404 and "Scan {repo}" in a trends empty render at visibly different radii/sizes.
- **Root cause**: The component predates (or missed) the shared focus token sweep; its button classes were written inline rather than reusing the CTA class pair used by RouteError/not-found.
- **Impact**: Inconsistent, sub-brand keyboard focus affordance on the app's most-reused notice component (sign-in, org empty, trends, repo picker all inherit it); two competing button geometries for the same semantic action across adjacent pages.
- **Fix sketch**: Add `focus-ring` to both branches of the action `<Link>` className in EmptyState, and align (or extract — e.g. `CTA_PRIMARY` / `CTA_OUTLINE` string constants in `@/lib/ui`) the button classes shared by EmptyState, RouteError, and not-found so the primary/outline pair is defined once.

## 2. not-found.tsx's StaticHeader hand-copies SiteHeader's markup — nav drift is silent
- **Severity**: Medium
- **Category**: component-extraction
- **File**: `src/app/not-found.tsx:17-38`
- **Scenario**: `StaticHeader` duplicates SiteHeader's exact chrome (same sticky/border/backdrop classes, same three nav links with the same responsive classes) with the stated goal of "mirrors SiteHeader's static nav". The reason for the fork is sound and documented (SiteHeader awaits `getSession()`/DB and could cascade a 404 into the 500 document), but the mirror is enforced only by hand: adding/renaming a marketing nav item in `Brand.tsx:147-155` will not touch the 404, and nothing (test or shared constant) detects the divergence.
- **Root cause**: The static/dynamic split was implemented by copy-paste instead of extracting the session-free parts (the shell classes + static nav-link list) into a shared leaf module that both headers consume. Note the extraction target must NOT live in `Brand.tsx`'s import graph position — the whole point is avoiding its `@/lib/auth`/`@/lib/db` imports — but a pure presentational module (e.g. `src/components/StaticNav.tsx` exporting `MARKETING_NAV: {href,label}[]` + the header shell classnames) has no such dependency.
- **Fix sketch**: Extract `MARKETING_NAV` and the header wrapper classes to a dependency-free module; render it in both SiteHeader and StaticHeader. Alternatively add a unit test asserting the 404 header's links equal SiteHeader's static link set.

## 3. /api/health: CRON_SECRET comparison is not timing-safe, and "no secret ⇒ full topology" also fires on a misconfigured prod deploy
- **Severity**: Medium
- **Category**: edge-case-gap
- **File**: `src/app/api/health/route.ts:33-37`
- **Scenario**: Two related gaps. (a) `request.headers.get("authorization") === \`Bearer ${secret}\`` is a variable-time string comparison of a bearer secret on an unauthenticated public endpoint. (b) The documented rule "when no CRON_SECRET is configured (local/dev/demo) there is nothing to protect, so details stay open" conflates *intentionally secretless* deploys with *misconfigured production* ones: the route's own header comment says a deploy missing CRON_SECRET "silently never autoscans" — exactly that broken prod deploy is the one that exposes `dbMode` + the full autoscan readiness map (which secrets are present) to any anonymous caller.
- **Root cause**: The internal-caller check reuses the cron credential ad hoc; the open-when-unset fallback was reasoned from dev/demo only, and the trade-off for a prod deploy that merely forgot the env var was not recorded.
- **Impact**: (a) is low-exploitability in practice (HTTP jitter dwarfs the comparison) but trivially cheap to fix; (b) hands deployment topology and secret-presence flags to anonymous probes on precisely the deploments already flagged as misconfigured.
- **Fix sketch**: Compare with `crypto.timingSafeEqual` over equal-length buffers (length-check first). For (b), gate the open fallback on a non-production signal (`process.env.NODE_ENV !== "production"` or `!process.env.VERCEL_ENV`), or always require the bearer and let dev pass a local secret; at minimum, record the accepted trade-off next to the check.

## 4. Brand ink/accent hexes are re-hardcoded across six shell surfaces with no single TS source
- **Severity**: Medium
- **Category**: magic-number
- **File**: `src/app/layout.tsx:36` (also `src/app/manifest.ts:20-21`, `src/app/globals.css:10,107`, `src/app/global-error.tsx:32,45,81-82`)
- **Scenario**: `#080d1a` (ink) appears in globals.css `@theme --color-ink`, the body background, `layout.tsx` `viewport.themeColor`, and twice in `manifest.ts` (`background_color`, `theme_color`); `#3b9eff` / `#04070e` similarly recur in `::selection`, global-error inline styles, and the OG brand constants. `lib/site.ts` exists precisely to single-source shell *copy* ("so the shell … can't drift") and even derives rubric counts, but the brand *palette* has no equivalent TS constant — CSS `@theme` vars can't be imported by manifest/viewport/OG code.
- **Root cause**: The design-token sweep centralized colors for Tailwind utilities only; the TS-side consumers (viewport, manifest, ImageResponse, global-error) were each hardcoded. global-error's copies are deliberate/self-contained (documented), but the manifest/viewport ones are not, and no comment binds them to `--color-ink`.
- **Impact**: A brand-color change updates Tailwind surfaces but silently leaves the Android/iOS status-bar color, PWA splash, and install chrome on the old ink — a visible mismatch that no type check or test catches.
- **Fix sketch**: Export `BRAND_INK`/`BRAND_ACCENT`/`BRAND_ON_ACCENT` from `lib/site.ts` (or reuse `@/lib/og/og-brand`'s constants, which already exist for OG) and consume them in `viewport.themeColor` and `manifest.ts`; leave globals.css/global-error as the two documented literal sites and note the pairing in a comment beside `--color-ink`.

## 5. Deck connector CSS hardcodes the final-section ids (`#pricing`, `#cta`) of specific pages
- **Severity**: Low
- **Category**: undocumented-assumption
- **File**: `src/app/globals.css:98-103`
- **Scenario**: The snap-deck section connector (hairline + glowing node "threading" sections) is hidden on the deck's last section by enumerating literal section ids — `section#pricing` and `section#cta` — in the global stylesheet. The comment says "Hidden on each deck's final section" but the mechanism is two page-specific ids: reorder the /about deck, rename a section, add a section after `#pricing`, or build a third snap-deck page, and either a dangling connector points past the last section into the footer or a mid-deck section loses its connector.
- **Root cause**: Global CSS encodes per-page structure (which section is last on which deck) instead of a structural selector, and the coupling to `AboutLanding`'s section order is not recorded at either end.
- **Impact**: Silent visual regression on any deck restructure — nothing fails; the connector just points at nothing (or disappears mid-deck).
- **Fix sketch**: Replace the id list with `.snap-deck section[id]:last-of-type::after/::before { display: none; }` (the sections are siblings within the deck), or have the deck component tag its final section with a `data-deck-last` attribute the CSS targets — either removes the id coupling entirely.
