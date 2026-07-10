# Code Refactor — Trends & Comparison
> Total: 5 | Critical: 0 High: 0 Medium: 2 Low: 3

## 1. Level-band + gridline SVG rendering duplicated across TrendChart and DimLine
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/report/TrendChart.tsx:152-172 and src/components/report/DimLine.tsx:97-104
- **Scenario**: Both charts independently render the shaded maturity bands and the horizontal gridlines. The per-band geometry is identical in both: `const top = y(i === 0 ? 100 : LEVEL_BANDS[i - 1]!.min); const bottom = y(band.min);` then `<rect ... height={Math.max(0, bottom - top)} fill={band.color} />`, followed by a `BAND_EDGES.map(...)` of `<line>` gridlines.
- **Root cause**: The scale plumbing (`vScale`/`xScale`/`LEVEL_BANDS`/`BAND_EDGES`) was correctly extracted into `chartScale.ts`, but the *rendering* of bands/gridlines from those constants was left copy-pasted in each chart. The subtle `i === 0 ? 100 : LEVEL_BANDS[i-1].min` "top of band" calculation is exactly the kind of logic that drifts when edited in one place only.
- **Impact**: Two copies of the same fiddly geometry to keep in sync; a band-styling or boundary change must be made twice, and the two charts can silently diverge (DimLine already drops the L-id labels and uses dashed interior lines, so the divergence has started).
- **Fix sketch**: Add small pure presentational helpers to `chartScale`/a new `chartBands.tsx` — e.g. `<LevelBands yFor x width withLabels?/>` and `<BandGridlines yFor x width interiorOnly? dashed? withLabels?/>` — parameterized by the existing scale closures and the `left`/`width` insets. Replace both inline `LEVEL_BANDS.map`/`BAND_EDGES.map` blocks with the shared component. (Sparkline only draws a single reference line, so it stays as-is.)

## 2. `Notice` page helper duplicated near-verbatim across the trends and compare pages
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/trends/page.tsx:26-40 and src/app/report/compare/page.tsx:24-38
- **Scenario**: Each page defines a local `function Notice({ title, body, repo })` that wraps `<EmptyState>` with an identical `actions` array (`Scan <repo>` primary when `repo` is set, plus `← Home`). The two definitions are character-for-character identical except for the emoji icon (`📈` vs `🔀`).
- **Root cause**: Copy-paste between the two sibling pages in the same feature; the only intended variation (the icon) was never factored out into a prop.
- **Impact**: ~13 lines duplicated across two files; the `actions` shape (label text, `encodeURIComponent`, primary flag, Home link) must be edited in both to stay consistent. The surrounding guard sequences (auth → `SignInNotice`, missing/invalid repo → `Notice`, no DB → `Notice`) are also structurally parallel and could ride along.
- **Fix sketch**: Extract a single `RepoNotice({ icon, title, body, repo })` (e.g. into `src/components/report/` or beside `EmptyState`) owning the shared `actions` builder; both pages call it passing their icon. Optionally fold the repeated repo-resolution/guard preamble into a shared helper.

## 3. One-off local date formatters duplicate each other and an inline format elsewhere
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/report/TrendChart.tsx:96-100 (`shortDate`) and src/components/report/chartHover.tsx:73-83 (`shortDateTime`)
- **Scenario**: `TrendChart` defines a private `shortDate(iso)` and `chartHover` defines a private `shortDateTime(iso)`. Both share the same skeleton (`new Date(iso)` → `Number.isNaN(d.getTime())` guard → `toLocale*` with `month:"short", day:"numeric"`). `shortDate`'s exact format string is also re-inlined twice in `QuotaNotice.tsx:30,88` (there without the NaN guard).
- **Root cause**: Each chart grew its own date helper instead of a shared formatter living next to the existing `timeAgo`/`freshness` time utilities in `lib/ui.ts`.
- **Impact**: Three places format scan dates with the same locale options; the unguarded `QuotaNotice` copies can render `"Invalid Date"`. Minor, but the formatting story is scattered.
- **Fix sketch**: Add `shortDate`/`shortDateTime` (NaN-guarded) to `lib/ui.ts` alongside `timeAgo`, then have `TrendChart`, `chartHover`, and `QuotaNotice` import them. Removes two private helpers and an unguarded inline duplicate.

## 4. Repeated count-chip markup in the WhatChanged headline
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/report/WhatChanged.tsx:56-80
- **Scenario**: Five conditional `<span>` "count chips" (signals detected/lost, gaps closed/opened, recommendations done) repeat the same `rounded-full border border-<tone>-500/40 bg-<tone>-500/10 px-2.5 py-1 font-semibold text-<tone>-300` structure plus a singular/plural ternary, differing only by tone token and label words.
- **Root cause**: Inline JSX grown chip-by-chip rather than a parameterized component.
- **Impact**: Five near-identical blocks in one file; a styling tweak to the chip shape must be applied five times, and the pluralization ternary is re-implemented each time.
- **Fix sketch**: Introduce a local `CountChip({ tone, count, singular, plural })` (tone → a small class map for emerald/red/amber/accent) and render the five chips as `count > 0 && <CountChip .../>`. Collapses ~25 lines to ~5 plus one helper.

## 5. Shared `scanCaption` helper buried in `WhatChangedParts.tsx`
- **Severity**: Low
- **Category**: structure
- **File**: src/components/report/WhatChangedParts.tsx:17-22 (consumed by src/components/report/ScanComparePicker.tsx:12,59,86 and WhatChanged.tsx)
- **Scenario**: `scanCaption` — the shared "score · level · when · engine" label — lives in `WhatChangedParts.tsx`, a file whose stated purpose is "presentational sub-components for the What changed panel". It is imported by `ScanComparePicker` (the dropdown picker), which is otherwise unrelated to the "what changed" parts.
- **Root cause**: A cross-cutting caption helper was parked in a panel-specific "parts" module; its own doc comment even notes it is shared with the picker, yet it stays co-located with one consumer.
- **Impact**: Mild import confusion / coupling — the picker pulls from a "WhatChangedParts" file to render an option label, obscuring that the caption is a feature-wide primitive. Low risk, but it muddies module boundaries.
- **Fix sketch**: Move `scanCaption` to a neutral location (e.g. `lib/ui.ts` next to `timeAgo`, or a small `report/scanCaption.ts`) and update the two importers. Leaves `WhatChangedParts.tsx` holding only actual JSX parts.
