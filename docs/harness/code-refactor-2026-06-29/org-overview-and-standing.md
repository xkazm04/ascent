# Code Refactor — Org Overview & Standing
> Total: 5 | Critical: 0 High: 0 Medium: 4 Low: 1

> Scope note: the shell architecture is clean — the layout (`src/app/org/[slug]/layout.tsx`)
> already centralizes the full "resolve org → DB-config guard → auth gate → `canReadOrg` →
> rollup-empty" preamble for every sub-page, and the only places that re-call `canReadOrg`
> (`page.tsx` `generateMetadata` and `opengraph-image.tsx`) genuinely run *outside* the layout
> render, so they are NOT redundant. No dead exports were found: every symbol in `ui.tsx`
> (`OrgTable`, `MeterRow`, `ExportCsvLink`, `SectionEmpty`, `fmtHours`, `DIMS`, `POSTURE_LABEL`,
> the `DIRECTION_TONE`/`toneFor`/delta re-exports, etc.) is referenced by ≥1 other org tab.
> The findings below are duplication/structure, not dead code.

## 1. Overview page hand-rolls the scope-filter selector group instead of `ScopeFilterBar`
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/org/[slug]/page.tsx:176-180 (vs src/components/org/ScopeFilterBar.tsx)
- **Scenario**: The overview renders the segment + tech-stack selectors inline:
  ```tsx
  <div className="flex flex-wrap items-center gap-2">
    <SegmentSelector segments={segments} active={segmentId} />
    <TechStackSelector groups={techGroups} active={activeStack?.key ?? null} />
    <TimeRangeSelector range={period.key} from={period.from} to={period.to} />
  </div>
  ```
- **Root cause**: `ScopeFilterBar` was extracted precisely to kill this inline `SegmentSelector +
  TechStackSelector` pair ("hand-rolled inline across ~10 tabs with drifting wrappers and guards").
  Sibling tabs (delivery, contributors, …) consume it; the flagship overview tab still hand-rolls
  it — and even imports both selectors directly instead of the bar.
- **Impact**: The one component built to be the single render-side source for fleet scope filters
  is bypassed on the most-viewed tab, so any future change to the filter group's markup/guards has
  to be applied in two shapes. Re-introduces exactly the drift `ScopeFilterBar` was meant to end.
- **Fix sketch**: Replace the inner two selectors with
  `<ScopeFilterBar segments={segments} segmentId={segmentId} techGroups={techGroups} activeStack={activeStack} gate={false}><TimeRangeSelector range={period.key} from={period.from} to={period.to} /></ScopeFilterBar>`
  (the `children` slot is the documented home for the trailing `TimeRangeSelector`). Verify the
  empty-segments case stays identical: the overview currently renders `SegmentSelector`
  unconditionally, whereas `ScopeFilterBar` guards it on `segments.length > 0` — confirm
  `SegmentSelector` already self-hides on an empty list before switching.

## 2. Posture/dimension rows in the overview re-implement the `MeterRow` composition inline
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/org/[slug]/page.tsx:245-254 and 261-269 (vs `MeterRow` in src/components/org/ui.tsx:185-233)
- **Scenario**: The "Posture distribution" and "Dimension averages" cards each hand-build a
  `label + <Meter> + numeric readout` flex row, e.g. the dimension row:
  ```tsx
  <div key={d.dimId} className="flex items-center gap-3 text-sm">
    <span className="w-20 shrink-0 text-slate-400">{DIMENSION_SHORT[...] ?? d.dimId}</span>
    <Meter className="flex-1" value={d.avg} color={scoreHex(d.avg)} />
    <span className="w-7 text-right font-mono tabular-nums" style={{ color: scoreHex(d.avg) }}>{d.avg}</span>
  </div>
  ```
- **Root cause**: `MeterRow` (`layout="labelled"`) is the component created specifically to
  consolidate the "Meter plus a numeric/percent readout" row — its own doc comment lists the sites
  it absorbed (contributors' `AiBar`, teams' `MetricBar`, adoption's `DeliveryRow`). The overview's
  own two such rows were never migrated, so the same composition lives in a fourth shape.
- **Impact**: Two more bespoke meter rows to keep visually in sync with the shared one; the
  dimension row's wrapper (`flex items-center gap-3 text-sm`) is already an exact `MeterRow
  labelled` match, so the duplication is gratuitous.
- **Fix sketch**: Render each row via `<MeterRow layout="labelled" label={...} value={...}
  display={...} meterClassName="flex-1" labelClassName="..." valueClassName="..." valueColor={...} />`.
  The dimension row drops in cleanly; the posture row wrapper is `text-base` (MeterRow hardcodes
  `text-sm`), so either accept the minor size shift or add a small wrapper-class/size override to
  `MeterRow` so both rows can route through it.

## 3. `postureLabel()` safe-fallback helper is bypassed by inline `POSTURE_LABEL[x] ?? x` elsewhere
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/org/ui.tsx:13-29 (helper) — bypassed at src/app/org/[slug]/segments/page.tsx:17, tech-stacks/page.tsx:68/95/96, teams/page.tsx:41
- **Scenario**: `ui.tsx` exports both the raw `POSTURE_LABEL` map and a `postureLabel(posture)`
  helper that adds a humanized fallback for unknown/legacy ids. The overview page uses the helper
  correctly, but sibling tabs re-implement a weaker inline fallback: `POSTURE_LABEL[x] ?? x`
  (raw slug fallback), and `segments/page.tsx` even defines a local
  `const postureText = (posture) => POSTURE_LABEL[posture] ?? posture;` — a near-clone of the
  exported helper.
- **Root cause**: The canonical helper post-dates the inline call sites and they were never
  converted, so the fallback rule is duplicated (and diverges — inline sites show a raw `ai-native`
  slug where `postureLabel` would show `AI-Native`/"Ai Native").
- **Impact**: Inconsistent posture labels across tabs and a redundant private `postureText`; any
  change to the fallback rule must be chased across ≥4 files.
- **Fix sketch**: Replace the inline `POSTURE_LABEL[x] ?? x` / `postureText` usages with
  `postureLabel(x)` and drop the local `postureText`. If a few hot table cells truly want the raw
  map without the humanization cost, keep `POSTURE_LABEL` exported but route everything else through
  `postureLabel`.

## 4. `DIMENSION_SHORT[x as keyof typeof DIMENSION_SHORT] ?? x` lookup duplicated; no helper
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/org/[slug]/page.tsx:263 and src/components/org/OrgLeverageMoves.tsx:36,52 (also repeated in tech-stacks/page.tsx:126, segments/page.tsx:159, api/org/playbooks/[id]/apply/route.ts:63)
- **Scenario**: Wherever a dimension id arrives as a plain `string` (not a typed `DimensionId`),
  the same cast-plus-fallback is spelled out: `DIMENSION_SHORT[d.dimId as keyof typeof
  DIMENSION_SHORT] ?? d.dimId`. It appears 3× inside this context's files and 5+ times repo-wide.
- **Root cause**: `DIMENSION_SHORT` (in `@/lib/ui`) is a typed `Record<DimensionId, string>`, so
  every caller holding a `string` has to launder it with an identical cast + `??` fallback — there
  is no `dimShort(dimId: string)` helper, so the boilerplate is copied each time.
- **Impact**: Repetitive, error-prone cast that's easy to get subtly wrong (one site casts
  `as DimensionId` instead); a single fallback policy is smeared across files.
- **Fix sketch**: Add `export const dimShort = (id: string) => DIMENSION_SHORT[id as keyof typeof
  DIMENSION_SHORT] ?? id;` next to `DIMENSION_SHORT` in `@/lib/ui` (or re-export from
  `components/org/ui.tsx`), then replace the inline expressions with `dimShort(d.dimId)` /
  `dimShort(rec.dimId)`.

## 5. `MoversList` left inline in the overview page while its three siblings were extracted
- **Severity**: Low
- **Category**: structure
- **File**: src/app/org/[slug]/page.tsx:49-81
- **Scenario**: `OrgStanding`, `OrgGapsSection`, and `OrgLeverageMoves` were each pulled out to
  their own files "to keep that page under the 300-LOC component limit" (per their header comments),
  but the ~32-line `MoversList` chart component is still defined inline in `page.tsx`, which now
  sits at 299 lines — right at that stated limit.
- **Root cause**: Partial application of the extraction pass; one presentational component was left
  behind, so the page is both at its self-imposed ceiling and inconsistent with the established
  "one overview sub-component per file" pattern.
- **Impact**: No headroom to edit the page without re-crossing the limit; a reader has to scroll
  past a chart component before reaching the page's actual data-fetch/compose logic. (Note: no
  enforced `max-lines` ESLint rule was found — this is a convention referenced in the code, not a
  hard gate, hence Low.)
- **Fix sketch**: Move `MoversList` to `src/components/org/OrgMovers.tsx` (mirroring its three
  siblings) and import it; the local-only `RepoMove` type import can move with it.
