# Code Refactor — Trends & Comparison
> Context group: Reporting & Visualization
> Total: 3 findings (Critical: 0, High: 1, Medium: 2, Low: 0)

This context is, on the whole, clean: no dead code (the two exports that looked unused — `Sparkline` in `TrendChart.tsx` and `parseScanReport` in `validate.ts` — are both consumed elsewhere: `DimensionCard.tsx` and `ReportClient.tsx`/`validate.test.ts` respectively), no stray `console.log`/`debug`, no commented-out blocks, no stale TODOs, and no unused imports in the scoped files. The duplication that does exist is the in-scope `DeltaTag` / caption / empty-state idioms being re-implemented inline instead of reused. The three findings below are all behavior-preserving consolidations against helpers that already live in this same context.

## 1. Inline delta chip re-implements the shared `DeltaTag` component
- **Severity**: High
- **Category**: duplication
- **File**: src/components/report/DimensionTrends.tsx:175-180
- **Scenario**: The per-dimension card draws its delta badge by hand:
  ```tsx
  {r.delta !== null && r.delta !== 0 && (
    <div className={`text-sm font-semibold ${r.delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
      {r.delta > 0 ? "▲+" : "▼"}
      {r.delta}
    </div>
  )}
  ```
  This is character-for-character the same arrow/color/format logic as the shared `DeltaTag` in `src/components/report/deltas.tsx:47-68` (`up ? "▲+" : "▼"`, `up ? "text-emerald-400" : "text-red-400"`, `text-sm font-semibold tabular-nums`). `DeltaTag` even has a `hideZero` option that exactly matches the `r.delta !== 0` guard here. The sibling compare view (`WhatChangedParts.tsx:138,175`) already routes its identical badges through `DeltaTag`.
- **Root cause**: The trends card was written (or copy-pasted from the older `DimensionCard.tsx:47-49`, which carries the same inline copy) before/independently of the shared `deltas.tsx` chips, so three places now hold the same red/green delta idiom.
- **Impact**: A change to the delta visual language (e.g. the `≈` within-noise treatment that `components/ui/format.ts:fmtDelta` already introduced, or `tabular-nums` alignment) has to be made in N hand-rolled copies and will silently miss this one — the trend card has already diverged from `DeltaTag` by omitting `tabular-nums`. Pure maintenance/consistency cost; no behavior bug today.
- **Fix sketch**: Import `DeltaTag` (already exported from `@/components/report/deltas`) into `DimensionTrends.tsx` and replace the inline `<div>` with `{r.delta !== null && <DeltaTag delta={r.delta} hideZero />}`. `hideZero` reproduces the current "render nothing at 0" behavior, and `r.delta !== null` preserves the "absent on one side → no badge" case. The only visible change is gaining `tabular-nums` (a strict improvement, and what the rest of the report already uses). No callers of `DimensionTrends` change.

## 2. `optionLabel` and `scanCaption` build the same scan caption — and have already drifted
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/report/ScanComparePicker.tsx:14-16 (and src/components/report/WhatChangedParts.tsx:11-14)
- **Scenario**: Both helpers turn one scan into the same `score · level · timeAgo · engine` label, on the *same* compare page (`report/compare/page.tsx` renders `ScanComparePicker` and `WhatChanged` side by side):
  - `ScanComparePicker.optionLabel`: `` `${s.overallScore} · ${s.level} · ${timeAgo(s.scannedAt)} · ${s.engineProvider}${isLatest ? " · latest" : ""}` ``
  - `WhatChangedParts.scanCaption`: `` `${scan.overallScore} · ${scan.level} · ${timeAgo(scan.scannedAt)} · ${scan.engineProvider}` ``
  They are identical except `optionLabel` appends `· latest` — i.e. the two copies have *already started to drift*.
- **Root cause**: The dropdown labels and the "what changed" headline captions were authored separately but happen to want the exact same human summary of a scan; no shared formatter was extracted, so each grew its own template literal.
- **Impact**: Live bug-source risk (the Critical-adjacent class of duplication): the picker and the diff headline are meant to describe the *same two scans* a user just selected, but they can silently disagree — if one is updated (say, to show confidence or drop the engine) the other won't, so the dropdown and the headline caption read differently for the same scan. Low blast radius (two call sites) keeps it Medium.
- **Fix sketch**: Promote a single `scanCaption(scan, { latest?: boolean })` to a shared spot both files already import from — `WhatChangedParts.scanCaption` is already exported; either import it into `ScanComparePicker` (adding an optional `latest` flag that appends `· latest`), or lift the base formatter into `@/lib/ui` next to `timeAgo`. Then `optionLabel(s, isLatest)` becomes `scanCaption(s, { latest: isLatest })`. Behavior-preserving; updates one call site in `ScanComparePicker.tsx`.

## 3. Compare page's `Notice` hand-rolls the empty state instead of reusing `EmptyState` (its trends sibling already does)
- **Severity**: Medium
- **Category**: structure
- **File**: src/app/report/compare/page.tsx:23-47
- **Scenario**: `report/compare/page.tsx` defines a local `Notice` that hand-builds the full page-variant empty state — `<div className="flex flex-col items-center py-24 text-center">`, a `text-4xl` icon, an `<h1>`, a body `<p>`, and two `<Link>` buttons (one accent-filled "Scan {repo}", one outline "← Home"). This is a verbatim reimplementation of what `EmptyState` (`src/components/EmptyState.tsx`, `variant="page"`) renders. The *sibling* `trends/page.tsx:26-40` `Notice` already routes through `EmptyState` for the same purpose. `EmptyState`'s own doc comment (lines 18-21) explicitly says every hand-rolled notice — naming "the repo-picker empties" — should route through it "so the empty/notice states stay visually consistent and a future tweak lands in one place."
- **Root cause**: The compare page predates (or was written in parallel with) the `EmptyState` consolidation that `trends/page.tsx` adopted, leaving one of the two paired pages still carrying the bespoke markup.
- **Impact**: The two paired pages a user toggles between ("Trends →" / "Compare →") can render visually inconsistent empty/notice states, and the wrapper-class/button-style copy here duplicates `EmptyState`'s and will drift from it (the accent button class string is already duplicated verbatim). Confusion + maintenance cost; not a behavior bug.
- **Fix sketch**: Replace the local `Notice` body with `EmptyState` exactly as `trends/page.tsx` does — `icon="🔀"`, `title`, `body`, and `actions={[ ...(repo ? [{ label: \`Scan ${repo}\`, href: \`/report?repo=${encodeURIComponent(repo)}\`, primary: true }] : []), { label: "← Home", href: "/" } ]}`. The `🔀` icon, the conditional scan CTA, and the home link all map onto `EmptyState`'s `icon`/`actions` props 1:1, so the rendered output is equivalent. All four call sites already pass `{ title, body, repo? }`, so the `Notice` signature is unchanged and no call sites move. (The unrelated `Notice` helpers in `live/shared/[token]` and `share/briefing/[token]` are a different, minimal kiosk shape — out of this context's scope, not folded in here.)
