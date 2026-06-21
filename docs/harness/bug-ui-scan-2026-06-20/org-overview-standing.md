> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

# Org Overview & Standing — combined bug+ui scan

## 1. "No regressions" chip shows even when nothing was compared
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: success-theater / no-data mislabel
- **File**: src/components/org/OrgStanding.tsx:40
- **Scenario**: A fleet whose repos each have only one scan in the selected window (a brand-new period, or every repo scanned just once) yields `getOrgMovers → { comparedRepos: 0, regressers: [] }`. The page computes `regressionCount = movers?.regressers.length ?? 0` (page.tsx:153) → `0`, and OrgStanding renders the reassuring grey **"no regressions"** chip.
- **Root cause**: The card treats `regressionCount === 0` as "we compared and found nothing wrong", but zero is indistinguishable from "there was nothing to compare" (`comparedRepos === 0`). The repo was hardened elsewhere against exactly this ("don't declare a low-success fleet healthy"), but this surface still asserts a clean bill of health on no comparison data.
- **Impact**: A leader reads "no regressions" as a positive signal when in truth no period-over-period comparison existed — false confidence on the headline standing card.
- **Fix sketch**: Pass `movers?.comparedRepos ?? 0` into OrgStanding and render a neutral "not enough history to compare" state (like the benchmark's `InlineEmpty`) when it is 0, reserving the "no regressions" chip for `comparedRepos > 0`.

## 2. Trajectory reports "trend confidence 100%" on a 2-point fit
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: misleading confidence / scoring edge case
- **File**: src/components/org/Trajectory.tsx:33 (confidence) ← src/lib/maturity/forecast.ts:123
- **Scenario**: An org with scans on exactly two distinct days produces a forecast. OLS over two points ALWAYS fits perfectly, so `fitQuality` (R²) is `1` → the card shows **"trend confidence 100%"** with no caveat, and projects an ETA / promotion off a single segment.
- **Root cause**: `forecastTrajectory` admits any series with `≥ 2 distinct days` and reports raw R². With n=2 the line is mathematically perfect regardless of noise, so the confidence indicator (whose whole job is "how trustworthy is the straight line") is maximally high precisely when the data is weakest. The card's only hedge — `confidence < 50 ? " · noisy"` — never triggers in this case.
- **Impact**: The forward-looking GPS presents a two-day blip as a rock-solid, high-confidence trajectory with a promotion/demotion ETA, encouraging action on essentially no trend.
- **Fix sketch**: Cap/penalize confidence by sample count (e.g. surface a "low data (n=2)" caveat when `forecast.points < 3`, or down-weight R² for tiny n) in the Trajectory card, or have `forecast` flag `lowData`.

## 3. Trajectory of a past custom range is labeled as if it's "Now"
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: stale data / time-window mislabel
- **File**: src/components/org/Trajectory.tsx:55-65, src/app/org/[slug]/page.tsx:216
- **Scenario**: Select a custom range that ends in the past (e.g. `from=2025-01-01&to=2025-03-01`). The rollup's trend/forecast is window-bounded (org-rollup.ts:225-249), so `forecast.current` is the latest scan *within that historical window* and `forecast.eta.date` is anchored at that window's last scan timestamp (forecast.ts:180). The card still labels the anchor **"Now"** and projects **"In 90d"** forward from a date months ago.
- **Root cause**: The forecast is deterministic and never reads the clock, but the UI hard-codes present-tense framing ("Now", "In {horizon}d") regardless of whether the window ends in the past.
- **Impact**: A historical view reads as a live forecast; the projected promotion "ETA" is already in the past, misrepresenting where the fleet stands today.
- **Fix sketch**: When `period.end` is in the past, relabel "Now" → the window's as-of date (and suppress or annotate the forward ETA), or only render Trajectory for windows whose end is the present.

## 4. Posture-distribution bars share one accent color regardless of posture quality
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: data viz / signal clarity
- **File**: src/app/org/[slug]/page.tsx:242
- **Scenario**: The "Posture distribution" rows render `<Meter value={(n/maxPosture)*100} />` with no `color`, so every posture (AI-Native … Getting Started) draws the same accent fill. The sibling "Dimension averages" bars right next to it (page.tsx:256) ARE score-colored via `scoreHex(d.avg)`.
- **Root cause**: The bar length encodes *count*, but nothing encodes posture *quality*; the panel relies solely on the left-hand text label to convey whether a bucket is good or bad, and is visually inconsistent with the adjacent colored meters.
- **Impact**: At a glance the posture mix looks uniform — a fleet that's mostly "Fast & Ungoverned" looks identical in tone to one that's mostly "AI-Native". Weaker scannability than the rest of the dashboard.
- **Fix sketch**: Map each `POSTURE_ORDER` entry to a tone (e.g. ai-native→green, ungoverned→orange, manual→yellow, early→red) and pass it as the Meter `color`, mirroring the dimension-averages treatment.

## 5. Collapsible section state can desync from the persisted cookie via the OS-level <details> toggle
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: state persistence / UX consistency
- **File**: src/components/org/CollapsibleSection.tsx:33-36
- **Scenario**: `<details open={defaultOpen}>` sets the initial open state from the cookie, but `open` is not a controlled prop after mount. The cookie is rewritten on `onToggle`. If two overview sections share intent or the cookie write is blocked (3rd-party-cookie / privacy modes that still allow reads but the page is sandboxed), the visual state and persisted state diverge — and React's `defaultOpen` won't re-assert because nothing re-renders the segment without a navigation.
- **Root cause**: Open/closed is owned by the DOM `<details>` element, while persistence is a side-effect cookie. There's no reconciliation if the write fails or the user expands then the cookie is cleared; next SSR reads a stale/missing cookie and flips the section unexpectedly.
- **Impact**: Sections re-expand/collapse unexpectedly across visits when cookie writes are unreliable; minor but breaks the "remember my layout" promise (OVR-4).
- **Fix sketch**: Best-effort is acceptable, but wrap the `document.cookie` write in a try/catch and no-op gracefully; optionally read-back to confirm and fall back to in-memory only — so a blocked write doesn't silently promise persistence it can't deliver.

## 6. Movers section hidden entirely when comparison exists but all repos held
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: missing empty/affordance state
- **File**: src/app/org/[slug]/page.tsx:278
- **Scenario**: With `movers.comparedRepos > 0` but every repo's `dOverall === 0` (a stable period — no gainers, no regressers), the guard `(movers.gainers.length > 0 || movers.regressers.length > 0)` is false, so the whole "Movers & regressions" section vanishes. The period-summary banner says the fleet "held", but the user gets no confirmation in the movers area — it just disappears.
- **Root cause**: The section is gated on *having movement* rather than on *having a comparison*; "we compared N repos and nothing moved" is a meaningful (positive) result that is rendered as absence.
- **Impact**: The dashboard reads as if the movers feature is missing/broken during a flat period rather than affirmatively reporting stability — minor scannability/trust gap.
- **Fix sketch**: Render the section whenever `movers.comparedRepos > 0` and let the existing `InlineEmpty` ("None this period.") inside each MoversList carry the empty state, so a flat period shows two reassuring empty columns instead of nothing.
