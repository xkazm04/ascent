# Landing Page Prototypes — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

Note: the context map for this area is stale — `EditorialSteps.tsx`, `PricingCards.tsx`, and `shared/content.ts` no longer exist. The live set adds `IndexOrg.tsx`, `ScanModal.tsx` (+3 split files, uncommitted WIP), and `TrajectoryPlaceholder.tsx`; all were audited.

## 1. Dimension matrix's horizontal-scroll region is unreachable by keyboard
- **Severity**: High
- **Category**: a11y
- **File**: `src/components/landing/prototypes/index/DimensionMatrix.tsx:52`
- **Scenario**: The 9×3 weights table is forced to `min-w-[40rem]` inside a plain `overflow-x-auto` div. On any viewport narrower than ~640px the Team and Org columns overflow, and the scroll container has no `tabindex="0"`, no role, and no accessible name — a keyboard-only user cannot scroll it, so two of the three archetype lenses (the section's whole point: "three profiles") are unreadable. The table has no focusable descendants either, so there is no incidental scroll-into-view escape hatch.
- **Root cause**: The overflow wrapper was added for touch scrolling only; the WCAG 2.1.1 requirement that scrollable regions be keyboard-operable (focusable + named) was never considered. Contrast: the sibling IndexGallery solved narrow viewports by *collapsing* columns instead.
- **Impact**: Keyboard and switch users on laptops with narrow windows/zoom lose the Team/Org data entirely; axe/Lighthouse flags "scrollable region must have keyboard access" on the marketing homepage.
- **Fix sketch**: `<div className="mt-8 overflow-x-auto" tabIndex={0} role="region" aria-labelledby="dimensions-heading">` (give the SectionHeading title an id), plus a visible `focus-ring` on the wrapper. Alternatively adopt the IndexGallery pattern: below `md`, collapse to one lens with a lens switcher.

## 2. Register rank numbers silently reorder from "top-scored" to "most recent"
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/components/landing/prototypes/index/IndexGallery.tsx:37`
- **Scenario**: `const board = topAiNative.length > 0 ? topAiNative : recent;` — when the leaderboard query is empty the component falls back to recency order, but the UI is unchanged: rows still carry `01, 02, 03…` rank badges (line 81) under the "The register" heading, and the surrounding copy ("ranked editorial register of the most AI-native repos") still promises a ranking. Nothing in the code records *when* `topAiNative` can be empty while `recent` is not, nor tells the viewer the order changed. There is also no empty state: if both arrays are empty (gallery persisted but zero public scans) the section renders a full header, column labels, and CTA row around a zero-row list.
- **Root cause**: The fallback was a resilience convenience; the visual contract (rank column = score order) was never re-examined for the fallback branch.
- **Impact**: A recency-ordered list numbered 01–NN on the homepage misstates which repos are "most AI-native" — the exact credibility claim the marketing page is built on. The silent zero-row branch shows a broken-looking table.
- **Fix sketch**: When falling back, either drop the rank column (render `·`) and swap the kicker to "Latest scans", or keep only `topAiNative` and hide the section when it's empty. Add an explicit `board.length === 0` empty state ("No public scans yet — be the first") or early-return `null`.

## 3. Gated deep-link flashes the "Sign in to scan" wall at already-signed-in members
- **Severity**: Medium
- **Category**: missing-state
- **File**: `src/components/landing/prototypes/index/ScanModal.tsx:136` (WIP file — flag: depends on uncommitted user WIP)
- **Scenario**: `locked = gated && signedIn !== true` conflates `signedIn === null` (viewer fetch still in flight) with `false` (confirmed signed out). The comment at line 50 documents starting "locked" to avoid flashing the scan form at signed-out viewers, but the reverse flash is unhandled: a signed-in member arriving via `?scan=1` (dialog derives open immediately, line 61) sees the full "Sign in with GitHub to scan" panel — a real, clickable auth CTA — until `/api/auth/viewer` settles. Clicking it round-trips through OAuth needlessly.
- **Root cause**: Two distinct states (pending / signed out) share one render branch; only one direction of the flash trade-off was recorded.
- **Impact**: Signed-in users on gated deploys are told they must sign in; fast clickers get bounced through the auth flow. Erodes trust in the auth state everywhere else on the page.
- **Fix sketch**: Add a third branch: while `gated && signedIn === null`, render the OutputsCard plus a skeleton/disabled action area (`animate-pulse` button-shaped placeholder, `aria-busy`), and only commit to the sign-in panel once `signedIn === false`. The fail-open catch (line 87) already resolves the hang case.

## 4. Three deck sections re-inline the snap-pane contract DeckSection was extracted to own — with divergent alignment
- **Severity**: Medium
- **Category**: component-extraction
- **File**: `src/components/landing/prototypes/index/IndexOrg.tsx:53` (also `IndexGallery.tsx:40`, `DimensionMatrix.tsx:44`)
- **Scenario**: IndexOrg, IndexGallery, and DimensionMatrix each hand-roll `<section id=… className="flex min-h-screen snap-start flex-col justify-start pb-10 pt-14 lg:justify-center">` (identical string ×3), while IndexHero and IndexLevels use the shared `DeckSection` whose SECTION_CLASS is `…justify-center pb-10 pt-14` (`src/components/deck/DeckSection.tsx:10`). DeckSection's own comment says it "centralizes the snap-deck contract that … the Index landing deck re-typed per section" — yet 3 of 5 panes still re-type it, and with a *different* variant (top-aligned below `lg`).
- **Root cause**: The `justify-start lg:justify-center` behavior the tall sections need (avoids centered content overflowing the viewport top on mobile) has no DeckSection variant, so authors bypassed the primitive instead of extending it.
- **Impact**: Snapping through the deck on a tablet/mobile alternates between top-aligned and center-aligned panes (Levels centers, its neighbors top-align); future snap-contract changes (padding, snap-stop tuning) must be applied in four places and will drift.
- **Fix sketch**: Add `justify?: "center" | "startLgCenter"` (or a `tall` boolean) to DeckSection, migrate the three raw sections to `<DeckSection id="org" justify="startLgCenter">`, and decide deliberately whether IndexLevels should adopt the same mobile top-alignment.

## 5. ScoreGauge hardcodes "five levels" in its aria-label and undocumented calibration constants
- **Severity**: Low
- **Category**: magic-number
- **File**: `src/components/landing/prototypes/index/ScoreGauge.tsx:25`
- **Scenario**: The SVG's `aria-label` says "across five levels" as a literal string while every sibling derives the count (`LEVELS.length` in IndexHero copy, `n = LEVELS.length` three lines below in this very file). The sweep animation also rests on unexplained constants: `rotate: -210` (start angle of the calibration tick, line 51), `gap = circ * 0.018` (inter-segment gap ratio, line 21), and tick geometry `stroke - 3` / `stroke + 13` — none annotated with what they were tuned against, unlike the rest of this codebase's unusually well-commented constants.
- **Root cause**: Copy was written by hand where data-derived text was used everywhere else; the animation values were eyeballed during design iteration and the reasoning never recorded.
- **Impact**: If the rubric gains/loses a level, sighted users see the correct arc count while screen-reader users are told "five" — an a11y-only content drift that no type check catches. Future tuning of the sweep requires reverse-engineering intent (-210° ≈ starting seven-tenths around the dial; is that meaningful or arbitrary?).
- **Fix sketch**: `aria-label={\`The maturity index runs from 0 to 100 across ${LEVELS.length} levels.\`}`; name the constants (`const SWEEP_START_DEG = -210; // start just past L1 so the tick crosses every band once`) with one-line rationale each.
