# Org Overview & Standing — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)
> Lens split: bug-hunter 2 / ui-perfectionist 3
> Files read: 14

## 1. Selected time range does not carry across org tabs (and the remembered period is ignored everywhere but Overview)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: time-range selection state
- **File**: src/app/org/[slug]/page.tsx:92 ; src/components/org/OrgNav.tsx:73-84 ; src/app/org/[slug]/security/page.tsx:25 ; src/app/org/[slug]/executive/page.tsx:27
- **Scenario**: On Overview the user picks "30 days". `TimeRangeSelector.navigate` writes the global `ascent_period` cookie AND pushes `?range=30d` (TimeRangeSelector.tsx:25-33). They then click "Security" or "Briefing" in OrgNav. OrgNav renders bare `href={base + "/security"}` with no query string, so the `?range=` param is dropped on navigation. The sibling page calls `resolveWindow(sp)` directly (security/page.tsx:25, executive/page.tsx:27) and never reads `PERIOD_COOKIE`. Result: the sibling silently falls back to the 90d default even though a 30d window is "remembered" and was just active.
- **Root cause**: The cookie-fallback that makes the period sticky exists ONLY in the Overview page (`page.tsx:92`, `parsePeriodCookie(cookieStore.get(PERIOD_COOKIE))`). The sibling tabs were never given the same fallback, and OrgNav links carry no query state, so neither channel (URL nor cookie) propagates the window across tabs.
- **Impact**: The period control behaves as a persistent, app-wide selector (it sits in a shared shell row and writes a year-long cookie) but only one of the tabs that consume a window honors it. A user comparing the same 30-day window across Overview → Security → Briefing gets three different implicit windows, and any cross-tab read silently mismatches the headline numbers. This is the single most user-visible correctness gap in the shell.
- **Fix sketch**: Centralize window resolution: have every windowed tab read the same cookie fallback (extract a `resolveOrgWindow(searchParams, cookies)` helper and call it in security/executive/etc.), OR have OrgNav preserve `range/from/to/segment` in its tab hrefs (append the current `useSearchParams()` query to each `t.href`). Preferably both — cookie for persistence, query for shareable links.

## 2. Two different "current maturity" numbers render side by side with no distinction
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: empty/standing rendering · numeric consistency
- **File**: src/app/org/[slug]/page.tsx:189-195 ; src/components/org/PeriodSummary.tsx:31-36,56-58
- **Scenario**: With a bounded window (e.g. 90d) the "Org maturity" tile shows `rollup.avgOverall` — the fleet-wide average including repos onboarded mid-period (page.tsx:189). Directly above it, PeriodSummary's sentence and "overall A → B" row show `cohortNow = baseline.avgOverall + deltas.overall` (PeriodSummary.tsx:31,57), the cohort-matched average that EXCLUDES mid-period onboards. When onboarded repos drag the fleet average, the banner can say "Fleet maturity climbed to 64" while the tile one row below reads 61 — both unlabeled as to which population they describe.
- **Root cause**: The code intentionally keeps cohort-matched deltas (the comment at PeriodSummary.tsx:27-29 explains why) but the UI surfaces the cohort number under the word "Fleet maturity" and the fleet number under "Org maturity" with no qualifier, so two legitimately-different aggregates read as a contradiction.
- **Impact**: Headline-number distrust on the org's most-glanced screen — the exact place where a single authoritative maturity number matters. Users will read it as a bug even though the math is correct.
- **Fix sketch**: Label the populations: make PeriodSummary's "to" read "across N matched repos" inline with the number, or have the tile and banner cite the same population. At minimum add a tooltip on the banner number clarifying it is the like-for-like cohort, distinct from the fleet tile.

## 3. Active-pill text color hardcodes `#04070e` instead of the `text-on-accent` token
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: design-token consistency / theming
- **File**: src/components/org/TimeRangeSelector.tsx:65 ; src/components/org/SegmentSelector.tsx:54,69,72,74
- **Scenario**: The two pill toggles that sit in the same shared control row both paint the active button as `bg-accent ... text-[#04070e]` (and SegmentSelector even hardcodes the dot/count color to `#04070e`). Every other accent-filled control in scope uses the semantic token: error.tsx:36 `text-on-accent`, EmptyState.tsx:71 `text-on-accent`. The shell's own `ui.tsx` Meter fill uses `bg-accent` with no hardcoded foreground.
- **Root cause**: A literal hex was inlined for "ink on accent" rather than the `--color-on-accent` token. If the accent (`#3b9eff`) is ever retoned, these two controls won't follow, and the contrast pairing silently drifts.
- **Impact**: Theme drift risk on the most prominent shell controls; `#04070e` is not even the canonical `ink` (`#080d1a`) or `on-accent`, so it is an orphaned magic value. Since ui.tsx + OrgNav set the pattern for the whole org section, this inconsistency propagates by copy-paste.
- **Fix sketch**: Replace `text-[#04070e]` with `text-on-accent` in both selectors (and the inline `style={{ backgroundColor: "#04070e" }}` / `text-[#04070e]/70` in SegmentSelector with the token or a `bg-on-accent` utility).

## 4. OrgNav lacks an accessible name; mobile fade can occlude the rightmost active tab
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility / responsive
- **File**: src/components/org/OrgNav.tsx:63,92-94
- **Scenario**: The page renders multiple `<nav>` landmarks (SiteHeader's nav + this OrgNav). This OrgNav's `<nav>` (line 63) has no `aria-label`, so a screen-reader landmark list shows two indistinguishable "navigation" regions. Separately, on mobile the 16-tab row scrolls horizontally with a right-edge gradient (`from-ink`, line 94); when the active tab is the last one (e.g. "Audit"), it lands under the fade and its `border-accent` underline/`text-white` is dimmed, with no scroll affordance for keyboard users.
- **Root cause**: The nav was built for desktop scannability (grouped labels) without a landmark name, and the overflow cue is purely decorative — there is no auto-scroll-into-view for the active tab, so the active item can render partially hidden on narrow viewports.
- **Impact**: A11y: ambiguous landmarks hurt AT navigation across the whole org section (this nav wraps every tab). UX: on phones the currently-selected section can be visually clipped, undermining "where am I" on the shared shell.
- **Fix sketch**: Add `aria-label="Org sections"` to the `<nav>`. Scroll the active tab into view on mount (a tiny client effect: `ref.scrollIntoView({ inline: "nearest" })` for the `aria-current` link), and/or reduce the fade width so the active underline is never fully covered.

## 5. Mobile overflow fade uses `from-ink` over a textured body background, leaving a flat seam
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: visual polish / responsive
- **File**: src/components/org/OrgNav.tsx:94 ; src/app/globals.css:31-36
- **Scenario**: The mobile right-edge cue fades `from-ink to-transparent`. `ink` is `#080d1a` (globals.css:10), but the body paints `#080d1a` PLUS a fixed `background-image` overlay (globals.css:33-36). The fade therefore blends to flat `#080d1a`, not to the actual textured surface beneath the tab row, so on mobile a subtly mismatched vertical strip appears at the right edge of the nav.
- **Root cause**: The gradient assumes a flat page background; the real background is layered (base color + fixed image), which the single-color `from-ink` can't match.
- **Impact**: Minor cosmetic seam on small screens at the shell level — low severity but it is in the always-present nav, so it is seen on every org page on mobile.
- **Fix sketch**: Either make the fade `from-[var(--color-ink)]/95` blended with a `backdrop-blur`/mask instead of an opaque color stop, or mask the scroll container (`mask-image: linear-gradient(...)`) so it reveals the true background rather than overpainting a flat color.
