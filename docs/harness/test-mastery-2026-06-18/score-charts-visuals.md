> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)

# Test Mastery — Score Charts & Visuals

This context is the entire visual vocabulary of a maturity report (radar, score ring, waterfall, posture quadrant, dimension lines/cards, PR signals) plus the pure helpers every chart and the rest of the app route through (`@/lib/ui` color/band/glyph mapping, `chartScale` geometry, `chartHover` nearest-point math). **There is not a single `.test.*` file in `src/components/report/`, and `src/lib/ui.ts` has no test either.** The good news, established while auditing: the waterfall's *math* (`contributions()` in `scoring/engine.ts`) IS covered by `engine.test.ts:198-260`, so the gaps below are the genuinely uncovered, high-blast-radius ones — not coverage chasing.

The framing throughout: ascent's Vitest has no jsdom/testing-library, so the leverage is in the **pure, exported functions** these charts depend on — `levelForScore`, `scoreHex`, `vScale`, `xScale`, `heatCell`, `freshness` — not React render tests. Each is LLM-batchable and asserts a real invariant.

---

## 1. Pin the score→level→color keystone (`levelForScore`/`scoreHex`) at every band boundary
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/lib/maturity/model.ts:175 (`levelForScore`); src/lib/ui.ts:105 (`scoreHex`), :80 (`scoreGlyph`)
- **Scenario**: Someone retunes a level band in `LEVELS` (e.g. moves L4 from `[65,84]` to `[60,84]`), fat-fingers an off-by-one (`s > l.band[0]` instead of `>=`), or changes the `Math.round` in `levelForScore`. A score of exactly 65 silently slips to L3/yellow instead of L4/lime. Every ring, radar vertex, waterfall segment, heatmap cell, axis bar and `LevelBadge` in the report now shows the wrong color **and** the gate/badge/PDF that also call `scoreHex`/`levelForScore` mis-label maturity — with no test to catch it.
- **Root cause**: `levelForScore` is the single keystone every visual in this context routes through, yet it is **tested nowhere**. There is no `src/lib/maturity/model.test.ts` and no `src/lib/ui.test.ts`. The only references in test files (`gate-comment.test.ts:5,12`) merely *call* it to build a fixture — they never assert its output. The boundaries (24/25, 44/45, 64/65, 84/85), the clamp (`<0`→L1, `>100`→L5), and the `.5` rounding seam (24.5→25→L2) are all unverified.
- **Impact**: The product's core claim is a trustworthy maturity grade. A silent band/color drift mis-grades every customer's repo and every CI gate simultaneously, undermining the rating's credibility — the highest business blast radius in this context.
- **Fix sketch**: Add `src/lib/maturity/model.test.ts`. For each adjacent pair, assert the exact handoff: `levelForScore(24).id==="L1"` and `levelForScore(25).id==="L2"`; same at 44/45, 64/65, 84/85. Assert clamp: `levelForScore(-10).id==="L1"`, `levelForScore(150).id==="L5"`. Assert rounding seam: `levelForScore(24.4).id==="L1"` vs `levelForScore(24.5).id==="L2"`. Add a property test: `scoreHex(s)` for every integer `s` in 0..100 returns exactly `LEVEL_HEX[levelForScore(s).id]` and `scoreGlyph(s)===LEVEL_GLYPH[levelForScore(s).id]` (locks the "color/level can never desync" contract the comment promises). Invariant: **the displayed color/glyph is always the rubric level's, and band boundaries are inclusive-low/inclusive-high with the documented edges.**

## 2. Lock `vScale`/`xScale` against the NaN-path corruption they were written to prevent
- **Severity**: High
- **Category**: error-branch
- **File**: src/components/report/chartScale.ts:22 (`vScale`), :38 (`xScale`)
- **Scenario**: A drifted/bad `/api/history` body or a sandbox passes a `NaN`, `Infinity`, or out-of-range score. The in-code comment (lines 24-27) is explicit: without the guard this produces a `NaN` y that "silently break[s] the whole `<path>`" — reading as a CSS glitch, not a data problem. Every line chart (`DimLine`, `TrendChart`, `Sparkline`) routes through `vScale`, so a regression here (e.g. dropping `Number.isFinite`, or losing the `Math.max(0,Math.min(100,…))` clamp) blanks **every** trend chart in the app. `xScale`'s single-point centering (`count<2 → left+width/2`) regressing would left-pin a one-scan chart's dot.
- **Root cause**: These are pure, two-line, fully-deterministic functions whose entire reason for existing is defensive NaN/clamp handling — the highest test-ROI shape there is — and they have zero tests. The guard is load-bearing but unverified, so a future "simplification" could delete it invisibly.
- **Impact**: Silent chart corruption on bad data is worse than a visible error: a user sees a plausible-but-wrong (or blank) trend and trusts it. Affects the whole reporting/visualization surface.
- **Fix sketch**: Add `src/components/report/chartScale.test.ts`. For `vScale(100,8,8)`: assert `yFor(0)` is the bottom inset and `yFor(100)` the top (monotonic decreasing), `yFor(50)` is the midpoint; assert `Number.isFinite(yFor(NaN))`, `yFor(Infinity)`, `yFor(-20)===yFor(0)`, `yFor(120)===yFor(100)` (clamped, never NaN, never outside `[top, height-bottom]`). For `xScale`: `xScale(1,0,320)(0)===160` (centered), `xScale(5,0,320)(0)===0` and `(4)===320` (spans full width), and `i` is evenly spaced. Invariant: **no input ever yields a non-finite or out-of-box coordinate.**

## 3. Guard the chart-band ramp against silent drift from the rubric it visually claims to match
- **Severity**: High
- **Category**: coverage-gap
- **File**: src/components/report/chartScale.ts:7 (`LEVEL_BANDS`), :16 (`BAND_EDGES`); consumed in src/components/report/DimLine.tsx:97-104
- **Scenario**: `LEVEL_BANDS`/`BAND_EDGES` hardcode the maturity strata (`85/65/45/25/0`) as a **separate copy** of the rubric's level boundaries (`LEVELS` bands `[85,100]/[65,84]/[45,64]/[25,44]/[0,24]`). `DimLine`'s shaded bands and the radar/ring colors are supposed to read "on one frame." If someone retunes a `LEVELS` band but not this array (or vice-versa), the shaded background says L4-starts-at-60 while the line's color (via `scoreHex`→`levelForScore`) still flips at 65 — the chart visually contradicts itself and nothing fails.
- **Root cause**: Two independent sources of truth for the same band edges, with no test asserting they agree. The duplication is deliberate (chart shading needs the edges as data), but the consistency contract is unguarded.
- **Impact**: A subtle, credibility-eroding visual lie (background band ≠ point color) on every dimension trend, surfacing only as user confusion — exactly the silent-desync class the `scoreHex` comment warns about, but across the module boundary the keystone test in finding #1 doesn't reach.
- **Fix sketch**: In `chartScale.test.ts`, assert `BAND_EDGES` equals the sorted unique boundaries derived from `LEVELS` (`[0,25,45,65,85,100]`) and that each `LEVEL_BANDS[i].min` is the lower edge of the corresponding rubric level — derive the expected values *from* `LEVELS` so the test breaks the moment the rubric and the chart ramp drift apart. Invariant: **the shaded chart bands are exactly the rubric's level boundaries, by construction, not by coincidence.**

## 4. Cover the time-formatting branches in `freshness`/`timeAgo` (drives the report's "re-test" control)
- **Severity**: Medium
- **Category**: edge-case
- **File**: src/lib/ui.ts:178 (`freshness`), :160 (`timeAgo`)
- **Scenario**: `freshness` powers the report's live "scanned 4m ago — re-test" ticker; `timeAgo` powers repo `pushedAt`. A regression in the second/minute/hour thresholds (`<45→"just now"`, `<60→Nm`, `<24→Nh`), a sign flip on a future timestamp (clock skew), or the `Number.isNaN` guard being dropped would make a just-finished scan read "unknown" or a stale scan read "today" — and a future-dated row could render `-3m ago`. `Math.max(0,…)` at line 182 is the only thing keeping future scans honest, and it's untested.
- **Root cause**: Pure date math with several thresholds and a NaN/clamp branch, exercised only indirectly through components that aren't render-tested here. No direct assertions on the boundaries or the bad-input/future-input branches.
- **Impact**: Freshness is the trust signal that tells users whether a number is current; a wrong "just now"/"today" makes a stale grade look live, and a negative delta looks broken.
- **Fix sketch**: Add cases to `src/lib/ui.test.ts` (created in #1). Drive `Date.now()` via `vi.useFakeTimers()`/`vi.setSystemTime`: assert `freshness(now-30s)==="just now"`, `now-5min==="5m ago"`, `now-3h==="3h ago"`, falls through to `timeAgo` past 24h; `freshness(undefined)`/`freshness("garbage")==="unknown"`; **future timestamp → "just now"** (never negative). For `timeAgo`: today/yesterday/`Nd`/`Nmo`/`Ny` band edges + NaN. Invariant: **monotonic, never-negative, NaN-safe relative time.**

## 5. Add regression tests for the two empty/unknown-input fallbacks that prevent vanished charts
- **Severity**: Low
- **Category**: error-branch
- **File**: src/components/report/RadarChart.tsx:22 (empty-dimensions guard); src/components/report/PostureQuadrant.tsx:62 (`QUAD_TINT[posture.id] ?? "#475569"`)
- **Scenario**: `RadarChart` is documented to receive `[]` from a direct caller like `RoadmapSandbox` (line 18-21); without the guard, `angleFor` divides by `n===0` and the whole polygon collapses to NaN — "reading as a CSS glitch, not a data problem." `PostureQuadrant` takes an untrusted `posture.id` and falls back to neutral slate when it's a drifted/unknown value so the "you are here" dot can't vanish (line 59-62). Both are deliberate defenses with no test; a refactor could drop either and a chart would silently disappear only for the rare bad-input case that QA never reproduces.
- **Root cause**: These DOM-coupled guards can't be unit-tested without jsdom, but the *decision logic* can be extracted/asserted. Today the behavior lives only inside the component with no executable spec.
- **Impact**: Edge-case disappearance of a chart for empty or schema-drifted reports — low frequency, but it's a silent blank where a "no data" message should be.
- **Fix sketch**: Lowest-cost option — a Playwright e2e that renders a report with an empty-dimension sandbox state and asserts the "No dimension data" fallback text is visible (RadarChart) and that an unknown posture still renders the marker. Cheaper alternative: extract the fallback decisions into pure helpers (`radarHasData(dims): boolean`, `quadTintFor(id): string` returning the `?? "#475569"`) and unit-test `quadTintFor("bogus")==="#475569"` and `radarHasData([])===false`. Invariant: **empty/unknown input degrades to a labeled fallback, never to a NaN-collapsed or invisible chart.**
