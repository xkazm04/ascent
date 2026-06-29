# Code Refactor — App Shell, SEO & Error Pages
> Total: 5 | Critical: 0 High: 0 Medium: 3 Low: 2

## 1. Rubric counts + tagline copy hardcoded across shell files (drift risk)
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/manifest.ts:11,14; src/app/opengraph-image.tsx:24-26; src/app/org/[slug]/opengraph-image.tsx:98; src/components/Brand.tsx:120; src/app/layout.tsx:18,26
- **Scenario**: `layout.tsx` builds `SITE_DESCRIPTION` from the canonical rubric (`` `a ${LEVELS.length}-level maturity ladder across ${DIMENSIONS.length} dimensions…` ``) precisely so the share/search snippet can't drift. Yet `manifest.ts` ("a 5-level maturity ladder across 9 dimensions, with evidence and a roadmap."), the root `opengraph-image.tsx` ("5-level ladder across 9 dimensions"), and the org OG fallback tagline all re-hardcode "5-level" / "9 dimensions". The "the maturity index for AI-native engineering" tagline is independently hand-repeated in `layout.tsx` (title), `manifest.ts` (name), the root OG `alt`, and `Brand.tsx` SiteFooter.
- **Root cause**: The model-derived description was centralized in exactly one place (layout) but the sibling shell metadata files were never switched over; the brand tagline was never centralized at all.
- **Impact**: The exact drift the layout comment warns about ("it previously hardcoded '7 dimensions' while the model defines 9") is still live in manifest + OG. A future rubric change (add a level/dimension) silently leaves manifest.ts and the OG card stating the wrong counts — and an unfurl/PWA snippet is the worst place to be wrong.
- **Fix sketch**: Export `SITE_TAGLINE` and a `siteDescription()` (count-derived, from `lib/maturity/model`) from `src/lib/site.ts` alongside `publicBaseUrl()`. Import them in layout, manifest, and the OG routes' static copy. (next/og static strings can interpolate `LEVELS.length`/`DIMENSIONS.length` just like layout does.)

## 2. `BRAND_*` palette consts are exported-but-unused; OG routes re-hardcode the hex literals
- **Severity**: Medium
- **Category**: dead-code
- **File**: src/lib/og/og-brand.tsx:12-17 (consts); src/app/opengraph-image.tsx:20,23,38; src/app/org/[slug]/opengraph-image.tsx:50,61,65; src/app/launch/opengraph-image.tsx:27,41,66,69,72
- **Scenario**: `og-brand.tsx` exports six palette consts (`BRAND_ACCENT`, `BRAND_INK`, `BRAND_WHITE`, `BRAND_MUTED`, `BRAND_TEXT`, `BRAND_GRADIENT`) "previously hand-repeated in every OG route." A repo-wide grep shows every reference is *inside og-brand.tsx itself* — no OG route imports any of them. Instead the three in-scope OG routes still write raw `#3b9eff`, `#ffffff`, `#94a3b8`, `#64748b` literals, and `launch/opengraph-image.tsx:41` re-hardcodes the exact `BRAND_GRADIENT` string.
- **Root cause**: The consolidation introduced the palette consts and used them in `SHELL`/`Brand`/`FallbackOgCard`, but the per-route JSX that those helpers don't cover was never migrated, so the consts gained an `export` that nothing consumes and the literal duplication the consts were meant to kill survives.
- **Impact**: Misleading public API surface (six exports that look like the shared palette but are dead), and the palette is still de-facto duplicated as scattered hex literals across the OG routes — change the accent and you must hunt every file.
- **Fix sketch**: Either drop `export` from the six consts (they're module-internal), or — better — import and use them in the OG routes so the hardcoded `#3b9eff`/`#ffffff`/`#94a3b8`/gradient literals all reference the single source.

## 3. `error.tsx` and `not-found.tsx` hand-roll near-identical centered-notice markup
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/error.tsx:29-57; src/app/not-found.tsx:11-35
- **Scenario**: Both render the same centered-notice skeleton: `<main id="main" className="mx-auto flex … flex-1 flex-col items-center justify-center px-5 py-24 text-center">`, a mono uppercase eyebrow `<p className="font-mono text-sm uppercase tracking-[0.3em] …">`, an `<h1 className="mt-4 text-3xl font-semibold text-white">`, a `<p className="mt-3 max-w-md … text-slate-400">` body, and an action row `<div className="mt-8 flex flex-wrap items-center justify-center gap-3">`. The repo already has `EmptyState` (variant="page"), documented as "the canonical empty/notice state for the whole app" that "Every hand-rolled notice routes through here" — and it's server/client-safe (no hooks), so the client `error.tsx` could use it via the `children` slot for the reset button.
- **Root cause**: The shell's own notice screens predate / bypass the shared `EmptyState`; the eyebrow line (404 / Error) is the only piece `EmptyState` doesn't model, so they were left hand-rolled.
- **Impact**: ~25 lines of duplicated layout classes across two files; a tweak to the notice look (spacing, max width, action row) must be made in 2–3 places and will drift from `EmptyState`.
- **Fix sketch**: Add an optional `eyebrow?: string` to `EmptyState` (rendered as the mono uppercase `<p>` above the title), then route `not-found.tsx` and `error.tsx` through `<EmptyState variant="page" eyebrow=… title=… body=…>` (reset button passed as `children`). `global-error.tsx` stays separate by design (must be import-free + inline-styled).

## 4. Dead CSS rule `.reveal-pre`
- **Severity**: Low
- **Category**: dead-code
- **File**: src/app/globals.css:199-203
- **Scenario**: The `@media (prefers-reduced-motion: no-preference) { .reveal-pre { opacity: 0 } }` rule (commented "Stagger-reveal: sections start hidden…") is defined but never applied. A repo-wide grep for `reveal-pre` matches only this definition; all other "reveal" hits are the unrelated `deck/Reveal.tsx` component, `window.ts`, and comments.
- **Root cause**: Leftover from an earlier scroll-reveal approach that was superseded by the `Reveal.tsx` component (which manages its own entrance opacity), but the CSS hook was never removed.
- **Impact**: Dead rule in the global stylesheet; invites confusion ("which reveal system is canonical?") and a maintainer may waste time wiring a non-existent contract.
- **Fix sketch**: Delete the `.reveal-pre` block (and its enclosing `@media` wrapper, which holds nothing else).

## 5. `/org/vercel` demo slug repeated as a magic string
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/Brand.tsx:59; src/app/not-found.tsx:29 (also AboutHero, AboutCTA, IndexOrg outside scope)
- **Scenario**: The "org demo" link target `/org/vercel` is hardcoded in the shell's `Brand.tsx` header and `not-found.tsx`, and ~5 more times elsewhere. The chosen demo org ("vercel") is a product decision encoded as a bare string in many files.
- **Root cause**: No shared constant for the demo org slug / demo href; each call site inlined it.
- **Impact**: Switching the showcase org (or its URL shape) means a multi-file find-and-replace with easy-to-miss spots; minor but pure DRY debt.
- **Fix sketch**: Export `DEMO_ORG_SLUG = "vercel"` (or a `demoOrgHref` helper) from `src/lib/site.ts` and reference it from the shell files (and the others when touched).
