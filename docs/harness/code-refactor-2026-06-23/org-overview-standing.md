# Code Refactor — Org Overview & Standing
> Context group: Org Dashboard & Analytics
> Total: 3 findings (Critical: 0, High: 1, Medium: 1, Low: 1)

This context is largely clean. The shared primitives module (`src/components/org/ui.tsx`)
is genuinely shared — every export I initially suspected of being dead (`DIMS`, `fmtHours`,
`OrgTable`, `SectionEmpty`, `POSTURE_LABEL`, `postureLabel`, and the re-exported
`deltaHex`/`signedDelta`/`fmtDelta`) is imported by sibling org tabs (delivery, contributors,
segments, tech-stacks, teams, portfolio, passports, …) — so nothing there is removable. The
extracted section components (`OrgStanding`, `OrgGapsSection`, `OrgLeverageMoves`, `Trajectory`,
`PeriodSummary`, `CollapsibleSection`) each have exactly one caller (the overview page) and carry
no dead locals. The one `console.error` (`error.tsx:19`) is a legitimate error-boundary log, not
debug cruft. The findings below are all about the same theme: the "direction tone" (up/down/flat →
arrow + color) and "pace" lookups are re-derived in several places instead of living in one helper.

## 1. Direction-tone (arrow + color) triad re-derived in every fleet view instead of one helper
- **Severity**: High
- **Category**: duplication
- **File**: src/components/org/Trajectory.tsx:10-14; src/app/org/[slug]/page.tsx:47-80 (esp. 48-49,65-72)
- **Scenario**: The rising/falling/flat → `{arrow, color}` mapping is open-coded in multiple
  in-scope and sibling files using the identical literal palette (`#84cc16` lime up · `#f97316`
  orange down · `#94a3b8` slate flat) and glyphs (`▲ / ▼ / →`). In scope: `Trajectory.tsx` declares
  a full `const DIR = { rising, falling, flat }` object (lines 10-14); `page.tsx`'s `MoversList`
  re-derives the same up/down half inline (`const color = tone === "up" ? "#84cc16" : "#f97316"`
  at line 48, plus the `▲/▼` arrow at line 49 and the level-pair logic at 65-72). The exact same
  triad recurs in obvious siblings: `src/app/portfolio/PortfolioTable.tsx:12-14` (a verbatim `DIR`
  clone) and `src/app/org/[slug]/executive/page.tsx:294,301` (`MoveRow`, an inline copy of
  `MoversList`'s row). There is **no** shared direction helper today — `@/lib/ui.ts` exports
  `scoreHex`/`LEVEL_*`/`IMPACT_CLASS` but nothing for this triad, and `deltaHex` only returns a
  color (no arrow/label), so each call site rebuilds the mapping by hand.
- **Root cause**: `Trajectory` introduced the named `DIR` object for its own use; later movers/portfolio
  surfaces needed "the same up/down look" and copied the literals inline rather than promoting `DIR`
  to a shared export. `deltaHex` covers the color-only case, so authors never felt the pull to
  extract the full arrow+color+label triad.
- **Impact**: Four+ copies of one palette decision. A rebrand of the up/down colors (or swapping the
  glyphs for accessibility) means hunting hex literals across `Trajectory`, `MoversList`,
  `PortfolioTable`, and `MoveRow`; they have already drifted slightly (`Trajectory` carries a `label`
  the row copies omit), which is exactly how silent inconsistencies start.
- **Fix sketch**: Add a single source of truth next to `deltaHex` in `src/components/ui/format.ts`
  (or `@/lib/ui.ts`): `export const DIRECTION_TONE = { rising: { arrow: "▲", color: "#84cc16", label: "rising" }, falling: { arrow: "▼", color: "#f97316", label: "falling" }, flat: { arrow: "→", color: "#94a3b8", label: "holding" } } as const;` plus a tiny `toneFor(delta: number): "rising"|"falling"|"flat"` helper. Then: in `Trajectory.tsx` replace the local `DIR` with the import; in `page.tsx` `MoversList`, derive `const { arrow, color } = DIRECTION_TONE[tone === "up" ? "rising" : "falling"]` instead of the inline ternaries at 48-49. The sibling `PortfolioTable.tsx`/`executive` `MoveRow` should follow the same import (out of strict scope, but they are the other half of the duplication). Behavior-preserving — the literals are identical.

## 2. `PACE_NOTE` pace-verdict map duplicates the canonical `PACE` lookup in goalView
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/org/[slug]/page.tsx:137-148
- **Scenario**: `OrgOverview` declares an inline `PACE_NOTE: Record<string, {label,color}>` for
  `reached / on-pace / behind / tracking` (lines 137-142) and a `goalNote()` reader (143-148) to
  stamp a goal's pace onto a headline tile. The colors are byte-for-byte the canonical pace palette
  already defined as `const PACE` in `src/components/org/plan/goalView.tsx:43-48` (`#34d399 / #84cc16
  / #f97316 / #94a3b8`), which is keyed on the typed `GoalPace` union and consumed by `PaceChip`. The
  page redefines the same concept with looser typing (`Record<string, …>` instead of
  `Record<GoalPace, …>`) and slightly different labels ("on track" vs "On pace").
- **Root cause**: The overview tile wanted a compact pace badge and re-stated the lookup locally rather
  than importing the existing `PACE` map; the divergent labels suggest a copy that was then hand-tweaked.
- **Impact**: Two pace palettes that can drift (a new pace state or color tweak must be made twice), and
  the page's `Record<string, …>` loses the `GoalPace` exhaustiveness check that `goalView` has. Already
  semi-drifted on labels.
- **Fix sketch**: Export the canonical map from `goalView.tsx` (e.g. `export const GOAL_PACE_TONE`) keyed
  on `GoalPace`, and have `goalNote()` read its `color` from there. If the overview genuinely wants the
  short labels ("on track"/"behind") rather than `goalView`'s ("On pace"/"Behind"), keep a tiny
  label-only override map but pull `color` from the shared source so the palette stays single-sourced.
  Re-type the local lookup as `Record<GoalPace, …>` to regain the union check.

## 3. `MoversList` (overview) and `MoveRow` (executive) are parallel reimplementations of one row
- **Severity**: Low
- **Category**: structure
- **File**: src/app/org/[slug]/page.tsx:47-80
- **Scenario**: The `MoversList`/row helper in the overview page (47-80) renders a mover line — truncated
  repo name, an optional `from→to` level pair shown only when it agrees with the score tone, and an
  arrowed signed delta. `src/app/org/[slug]/executive/page.tsx:293-306` (`MoveRow`) renders the same
  line with the same structure (same truncation classes, same `from !== to` level-pair guard, same
  arrow+color). They are two hand-maintained copies of one visual row living in two route files.
- **Root cause**: The executive briefing page was built after the overview and needed "the same movers
  row"; it was copied and lightly adapted (overview's version adds the tone-agreement nuance on the
  level pair; executive's is the simpler `from !== to`) rather than sharing a component.
- **Impact**: Low today (small, mostly-static markup) but it is the row-level companion to finding #1 —
  any change to how a mover is displayed (the level-pair rule, the color, accessibility of the arrow)
  has to be made in both files, and they have already diverged on the level-pair condition.
- **Fix sketch**: Promote the row to a shared server component, e.g. `MoverRow` in
  `src/components/org/` taking `{ name, scoreDelta, levelFrom, levelTo }`, encapsulating the
  tone→arrow/color (via the helper from finding #1) and the agree-with-tone level-pair guard. Have both
  `MoversList` (overview) and the executive page consume it. Pick the overview's stricter level-pair
  rule as the shared behavior (it is the more correct one). Behavior-preserving for the overview;
  tightens the executive copy's level-pair display to match.
