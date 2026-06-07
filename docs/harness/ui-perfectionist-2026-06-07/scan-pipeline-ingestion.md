# UI Perfectionist — Scan Pipeline & Ingestion

> Total: 8
> Severity: critical 0 · high 2 · medium 4 · low 2
> Scope: 5 files (Scan Pipeline & Ingestion)

## 1. "Eight scoring dimensions" heading contradicts the 9-dimension data it renders
- **Severity**: high
- **Category**: visual-consistency
- **File**: `src/app/page.tsx:127`
- **Scenario**: The "The instrument" section on the landing page renders one card per dimension from `DIMENSIONS`, directly under a heading that reads "Eight scoring dimensions".
- **Root cause**: The count "Eight" is a hardcoded string in the `<h2>`, while the grid below maps over `DIMENSIONS` from `src/lib/maturity/model.ts`, which now defines D1–D9 — nine entries (model.ts:68–157). The heading was never updated when the ninth dimension (D9 Supply Chain & Security) was added. The hero copy at `page.tsx:50` ("across 7 dimensions") and the metadata description in `layout.tsx:18` ("across 7 dimensions") cite yet a third number.
- **Impact**: A scanning/maturity product whose own landing page miscounts its scoring dimensions reads as untrustworthy on the very first screen — the headline says 8, the cards show 9, the subhead and page title say 7. This is a credibility hit, not a cosmetic one.
- **Fix sketch**: Derive the count from the data instead of writing a word: e.g. `{DIMENSIONS.length} scoring dimensions` (and a number-to-word helper if the spelled-out form is desired). Reconcile the "7 dimensions" copy at `page.tsx:50` and `layout.tsx:18` to the same source so all three never drift again.

## 2. Error state uses raw red-500/red-400 instead of the dedicated `--color-danger` token
- **Severity**: high
- **Category**: design-system
- **File**: `src/components/ScanForm.tsx:69`
- **Scenario**: When a user submits an unparseable repo reference, the form border turns red (`ScanForm.tsx:68–69`) and the inline validation message renders in red (`ScanForm.tsx:120`).
- **Root cause**: The error border is `border-red-500/70` and the message is `text-red-400`, both raw Tailwind palette literals. `globals.css:14–17` explicitly introduced `--color-danger` / `--color-danger-soft` tokens with a comment stating they exist to replace "raw red-500/300 literals" and that opacity modifiers like `border-danger/30` / `text-danger` are intended to work like any token. This component is the primary surface still bypassing that token.
- **Impact**: The app's most-seen error surface drifts from the centralized danger color. If the brand's danger hue is ever retuned in `globals.css`, the landing-page ScanForm silently keeps the old red — exactly the desync the token was created to prevent.
- **Fix sketch**: Replace `border-red-500/70` with `border-danger/70` and `text-red-400` with `text-danger-soft` (or `text-danger`), matching the token contract documented in `globals.css:14–17`.

## 3. Submit-button text color is the hardcoded hex the `text-on-accent` token was made to replace
- **Severity**: medium
- **Category**: design-system
- **File**: `src/components/ScanForm.tsx:92`
- **Scenario**: The "Scan" / "Scanning" button text on the hero form.
- **Root cause**: The button uses `text-[#04070e]` (arbitrary value). `globals.css:11–12` defines `--color-on-accent: #04070e` with a comment noting this exact hex "was previously hardcoded as #04070e across connect/onboarding/auth" and that the `text-on-accent` utility replaces it. The header's "Get started" button already uses the token (`Brand.tsx:81`), so ScanForm is the inconsistent one.
- **Impact**: Inconsistency within the same view — two accent buttons, one using the token and one using a raw hex. Any future tweak to on-accent foreground will skip this primary CTA.
- **Fix sketch**: Swap `text-[#04070e]` for `text-on-accent` to match `Brand.tsx:81` and `EmptyState.tsx:41`.

## 4. `#080d1a` "ink" canvas hex is hand-repeated instead of using the `--color-ink` token
- **Severity**: medium
- **Category**: design-system
- **File**: `src/app/page.tsx:40`
- **Scenario**: The hero background gradient fades into the page canvas; the sticky header also paints the same canvas color at 80% opacity.
- **Root cause**: `page.tsx:40` writes `via-[#080d1a]/35 to-[#080d1a]` and `Brand.tsx:37` writes `bg-[#080d1a]/80`, both raw hexes for the page background. `globals.css:10` defines `--color-ink: #080d1a` precisely for this canvas color, but it is unused; `globals.css:32` even re-hardcodes `#080d1a` again for `body`.
- **Impact**: The single most-repeated brand color is duplicated as a literal across the hero, header, and body, none routed through the token. Retuning the canvas means hunting four+ scattered hexes, risking a header/hero seam mismatch.
- **Fix sketch**: Use `to-ink`/`via-ink/35` and `bg-ink/80` via the existing token, and set `body { background-color: var(--color-ink); }` in `globals.css:32` so the canvas is single-sourced.

## 5. Example "Try:" chips fire navigation with zero visible feedback on the clicked chip
- **Severity**: medium
- **Category**: polish
- **File**: `src/components/ScanForm.tsx:133`
- **Scenario**: A user clicks one of the "Try:" example chips (e.g. `facebook/react`) to launch a scan.
- **Root cause**: The chip handler (`ScanForm.tsx:136–141`) sets `submitting` true and `router.push`es, but the chip's own markup shows no pressed/disabled/spinner state — only the (now-unmounting) Scan button reflects `submitting`. The `disabled` attribute and spinner live solely on the submit button (`ScanForm.tsx:89–115`); chips stay fully interactive and identical-looking after the click.
- **Impact**: On a slow network the user gets no acknowledgement that their tap registered, inviting double-taps and a "did it work?" moment on the primary conversion path. It also lets a user click a second chip mid-navigation.
- **Fix sketch**: When `submitting`, disable all chips (`disabled={submitting}` with `disabled:opacity-50 disabled:cursor-not-allowed`, mirroring the Scan button) and show a small inline spinner / pressed state on the clicked chip, reusing the existing `animate-spin` SVG markup already in the component.

## 6. `autoFocus` on the hero input forces the mobile keyboard open and scrolls past the hero
- **Severity**: medium
- **Category**: responsiveness
- **File**: `src/components/ScanForm.tsx:77`
- **Scenario**: A user lands on the homepage on a phone; the page auto-focuses the repo input (`page.tsx:53` passes `autoFocus`, applied at `ScanForm.tsx:77`).
- **Root cause**: `autoFocus` is unconditional. On mobile, focusing an input on load pops the soft keyboard and scrolls the viewport to the field, hiding the hero headline, subhead, and the "Free · No signup" reassurance line (`page.tsx:45–57`) before the user has read them.
- **Impact**: The first impression on mobile is a covered hero and an intrusive keyboard — the opposite of the calm landing the hero copy intends, and a known mobile-UX anti-pattern. It can also disorient screen-reader/keyboard users who are dropped mid-page.
- **Fix sketch**: Gate autoFocus to pointer-capable / larger viewports (e.g. only honor it above the `sm` breakpoint, or behind a `matchMedia('(min-width: 640px)')` check), so desktop keeps the convenience while mobile keeps the hero visible.

## 7. Hero overlay is the only `prefers-reduced-motion`/empty-aware surface missing the established notice pattern when the gallery is absent
- **Severity**: low
- **Category**: component-architecture
- **File**: `src/app/page.tsx:64`
- **Scenario**: When persistence is off or no public scans exist, `gallery` is null and the "Live discovery" rail is simply omitted (`page.tsx:64`), leaving the levels ladder to follow the hero directly.
- **Root cause**: The conditional `{gallery && <ScanGallery .../>}` has no fallback. The codebase has a canonical centered notice component, `EmptyState` (`src/components/EmptyState.tsx`), used for report/trends/usage empties, but the landing's discovery slot renders nothing — a silent gap rather than an intentional state.
- **Impact**: First-run / DB-less deployments show no acknowledgement that a live index will appear, missing a social-proof opportunity exactly where the page promises "recently scanned" discovery. Not broken, but an unused state.
- **Fix sketch**: Optionally render a lightweight `EmptyState` (icon + "Be the first to scan a public repo" + a chip-driven action) in place of the rail when `!gallery`, reusing `EmptyState.tsx` so the empty case stays on-pattern with the rest of the app.

## 8. Hero `<h1>` and section `<h2>`s lack the entrance polish the design system already ships
- **Severity**: low
- **Category**: polish
- **File**: `src/app/page.tsx:45`
- **Scenario**: Page load and scroll through the hero and the levels/how/dimensions/pricing sections.
- **Root cause**: `globals.css:63–130` defines a full, reduced-motion-guarded entrance vocabulary — `.animate-fade-up` and a `.reveal-pre` stagger-reveal explicitly designed so "sections start hidden, then fade-up when scrolled into view." None of the landing surfaces (hero `h1` at `page.tsx:45`, the four `<section>`s) apply these utilities, so the first screen renders flat while interior pages presumably use them.
- **Impact**: The brand's signature motion system is dormant on the highest-traffic page, making the landing feel less polished and less cohesive with the animated `/launch` and `/live` surfaces those same tokens were built for.
- **Fix sketch**: Apply `.animate-fade-up` to the hero stack and `.reveal-pre` + a scroll-trigger to each `<section>`, leveraging the existing `prefers-reduced-motion` guards in `globals.css:124–130` so reduced-motion users are unaffected. No new CSS needed.
