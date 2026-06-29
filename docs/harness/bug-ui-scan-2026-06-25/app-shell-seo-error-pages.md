# App Shell, SEO & Error Pages — Bug + UI Scan
> Context: App Shell, SEO & Error Pages (Onboarding, Shell & AI Standard)
> Total: 5 findings (0 critical, 0 high, 3 medium, 2 low)

## 1. Default OG card shows level chips L0–L4, but the rubric is L1–L5
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: visual-consistency (rubric drift)
- **File**: src/app/opengraph-image.tsx:30
- **Value**: impact 6 · effort 2 · risk 1
- **Scenario**: Anyone who shares the Ascent homepage on Slack/Twitter/LinkedIn unfurls a card whose footer renders five pills labelled `L0 L1 L2 L3 L4`. The actual maturity ladder (`src/lib/maturity/model.ts:25-67`) defines `L1`…`L5` — there is no `L0`, and `L5` (the top "AI-Native" level) is missing from the card. The headline copy on the same card correctly says "5-level ladder across 9 dimensions", so the chips visibly contradict the headline.
- **Root cause**: The chip array `["L0","L1","L2","L3","L4"]` is hardcoded instead of derived from `LEVELS`. This is exactly the drift class the codebase already fights elsewhere — `layout.tsx:27-29` and the `model.ts`-derived `SITE_DESCRIPTION` were explicitly rebuilt from the rubric "so the dimension/level counts can't drift" after a prior "7 dimensions" hardcode bug; this OG route was missed.
- **Impact**: Every public share/unfurl mislabels the product's core ladder (a non-existent L0, omitted L5), undermining the brand artifact's credibility on the most-seen surface.
- **Fix sketch**: Replace the literal with `LEVELS.map(l => l.id)` (import from `@/lib/maturity/model`, as `layout.tsx` already does). Makes the whole class impossible — the card can never disagree with the rubric again.

## 2. global-error boundary swallows the most catastrophic error with no logging
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/app/global-error.tsx:9-15
- **Value**: impact 6 · effort 2 · risk 1
- **Scenario**: When the root layout itself throws (the only thing `global-error.tsx` catches — a font load failure, a bad `metadataBase`, a throw in `RootLayout`), the user sees the "500" document, but nothing is ever logged client-side. The sibling `src/app/error.tsx:25-27` deliberately does `useEffect(() => console.error("[app] route error:", error), [error])`; `global-error.tsx` has no such effect, so the rarest and highest-severity failure (whole-app shell down) is the one error you have zero telemetry for.
- **Root cause**: The author treated `global-error` as pure presentational chrome and omitted the logging effect that `error.tsx` has. Error reporters (Sentry-style) and even a console breadcrumb hook into exactly this effect.
- **Impact**: Root-layout crashes are invisible in monitoring; you learn about them only from user complaints, and the `error.digest` (the only correlation handle) is shown to the user but never recorded.
- **Fix sketch**: Add `useEffect(() => console.error("[global-error]", error), [error])` (and mark `"use client"` already present). Mirrors `error.tsx` and gives the catastrophic path the same breadcrumb as ordinary route errors.

## 3. 404 page offers an "org demo" CTA that is broken in the supported no-DB mode
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/app/not-found.tsx:28-33
- **Value**: impact 5 · effort 2 · risk 2
- **Scenario**: The app explicitly supports a DB-disabled MVP deployment (`src/app/api/health/route.ts:6-7` "the MVP runs with no DB"). In that mode `SiteHeader` deliberately hides its org-demo link behind `dbOn` (`src/components/Brand.tsx:57`), but `not-found.tsx` renders the secondary button "See an org demo" → `/org/vercel` unconditionally. So on a no-DB deploy the same 404 page shows no "Org demo" in the header yet a prominent "See an org demo" CTA in the body that lands on an org dashboard with no data behind it.
- **Root cause**: Two surfaces independently decide whether the org demo is reachable; only the header consults `isDbConfigured()`. The 404 body wasn't given the same gate.
- **Impact**: A lost visitor on the error page is funnelled to a broken/empty destination in a supported configuration — error-page UX that compounds confusion instead of recovering it.
- **Fix sketch**: `not-found.tsx` is a server component, so call `isDbConfigured()` and conditionally render the org-demo action (matching `Brand.tsx`), or route the secondary CTA to an always-valid public page (e.g. `/pricing` or `/about`).

## 4. PWA manifest declares raster icons as `sizes:"any"`, which can fail installability checks
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/app/manifest.ts:19-22
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: SHELL-3's stated goal is an installable PWA shell (Add to Home Screen / desktop install). Both icons are PNGs declared with `sizes:"any"`. Per the manifest spec, `"any"` is meaningful for vector (SVG) icons; for raster PNGs Chromium's installability criteria and Lighthouse's PWA audit look for an explicit icon of at least 144px (ideally 192 and 512). A single `"any"` raster entry can be treated as "no suitably-sized icon", so `beforeinstallprompt` never fires and the install affordance silently doesn't appear — the exact capability this file exists to provide.
- **Root cause**: The comment ("declared honestly — these are single source PNGs, not a pre-rendered 192/512 set") accepts the tradeoff, but the spec semantics of `"any"` for raster make installability browser-dependent rather than honest.
- **Impact**: Installability — the only deliverable of SHELL-3 — may not trigger on Chrome/Edge; degrades silently with no error.
- **Fix sketch**: Ship pre-rendered 192×192 and 512×512 PNGs (plus a 512 maskable) with explicit `sizes`, or add an SVG icon for which `"any"` is valid. Even one explicit `sizes:"512x512"` raster entry satisfies the check.

## 5. Org OG card renders the slug at 60px with no length guard, risking overflow
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: edge-case
- **File**: src/app/org/[slug]/opengraph-image.tsx:64
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: The org name is drawn as `<div style={{ fontSize: 60, fontWeight: 700, ... }}>{slug}</div>` inside a flex column with `flex: 1`. A long org slug (the value comes straight from the route param) has no `overflow`, `whiteSpace`, or truncation; in `next/og`'s flex engine a long unbroken token can overflow the 1200×630 card or collide with the score block to its left, producing a clipped/broken share image for that org.
- **Root cause**: The card was laid out for short demo slugs ("vercel") and assumes the slug fits; there is no max-width/ellipsis discipline as exists for the header username (`Brand.tsx` uses `truncate max-w`).
- **Impact**: A cosmetically broken social card for orgs with long names — a tenant-visible polish defect, but rare and non-functional.
- **Fix sketch**: Cap the rendered slug (e.g. truncate beyond ~28 chars with `…`) or constrain the container width and step font size down for long names; the score column already has fixed geometry to budget against.
