# Code Refactor — Backlog Management
> Context group: Org Planning & Execution
> Total: 3 findings (Critical: 0, High: 1, Medium: 0, Low: 2)

The Backlog Management context is small and well-factored: the shared shaping helpers already live in `backlogShared.ts`, all exports are referenced, there is no dead code, no `console.log`/`debugger`/commented-out blocks, no stale TODOs, and no unused imports inside the six in-scope files. The findings below are the only worthwhile cleanups; two are minor.

## 1. STATUS_LABEL / STATUS_ACCENT duplicated verbatim in a sibling tracker
- **Severity**: High
- **Category**: duplication
- **File**: src/components/org/backlogShared.ts:4-16 (canonical) vs src/components/report/RecommendationTracker.tsx:9-20 (duplicate)
- **Scenario**: `backlogShared.ts` exports `STATUS_LABEL` (the `open/in_progress/done/dismissed` → human-label map) and `STATUS_ACCENT` (the same four statuses → hex-color map). `RecommendationTracker.tsx` re-declares both as private module constants with byte-identical keys and values (same four labels, same four hex codes `#64748b / #eab308 / #22c55e / #475569`). Both files render the identical status `<select>` dropdown and color the row accent by status from these maps. (A third, partial copy of the label map exists at `src/components/org/plan/InitiativesPanel.tsx:40`, and a divergent lower-cased variant `INIT_STATUS_LABEL` at `src/components/org/plan/goalView.tsx:95` — context for how this constant tends to get re-typed rather than imported.)
- **Root cause**: `backlogShared.ts` was extracted to de-dupe the backlog components (BacklogItemRow/Panel/Summary), but the older report-side tracker that inspired the same status UI predates the shared module and was never pointed at it. Each new status-rendering surface re-typed the map from scratch.
- **Impact**: Two (really three+) independent copies of the same status taxonomy that must be hand-kept in sync. The maps are exactly the kind that drift: rename a label, recolor a status, or add a fifth status, and the report tracker silently keeps the stale values. This is a live drift hazard, not a cosmetic one. It also costs a few duplicated lines in the bundle.
- **Fix sketch**: Delete `STATUS_LABEL` and `STATUS_ACCENT` from `RecommendationTracker.tsx:9-20` and instead `import { STATUS_LABEL, STATUS_ACCENT } from "@/components/org/backlogShared"`. Behavior is preserved because the values are identical; the tracker already imports `RecStatus` from `@/lib/types`, and `STATUS_LABEL` there is `Record<RecStatus, string>` (compatible). Note the shared `STATUS_ACCENT` is typed `Record<string, string>` — indexing it with a `RecStatus` still type-checks, so no signature change is required. (Optional, separate follow-ups outside this scope: repoint `InitiativesPanel.tsx:40` at the shared `STATUS_LABEL`.) Verified `STATUS_LABEL`/`STATUS_ACCENT` have no other consumers that would break.

## 2. IMPACT_RANK and the byPoints sort live inside the render body
- **Severity**: Low
- **Category**: structure
- **File**: src/components/org/BacklogPanel.tsx:81-89
- **Scenario**: `IMPACT_RANK` (a constant `{ high: 3, medium: 2, low: 1 }`) is declared inside the `BacklogPanel` component body, and `byPoints` (a full `flatMap`+`sort` over every owner group's items) is computed unconditionally on every render — even when the active view is `"owner"` or `"due"` and `byPoints` is never read.
- **Root cause**: The `points` view was added incrementally; the ranking constant and its sort were written inline next to where they are consumed rather than hoisted or guarded behind the `view === "points"` branch.
- **Impact**: Minor: the constant object is re-allocated each render, and the cross-repo sort runs on every keystroke/edit regardless of the selected view. No correctness issue (the sort is pure), just wasted work and a slightly tangled render body. Same private-constant pattern as `RoadmapPanel.tsx:69` and `lib/onboarding/tracks.ts:288` — there is no shared exported `IMPACT_RANK`, so cross-file consolidation is out of scope here.
- **Fix sketch**: Hoist `IMPACT_RANK` to module scope (above the component). Compute `byPoints` lazily — either `useMemo(() => …, [backlog])`, or only build it inside the `view === "points"` branch of the `groups` expression — so it is not recomputed when another view is active. Behavior-preserving: the sort comparator and output ordering are unchanged.

## 3. Component files are named for the context but export differently named symbols
- **Severity**: Low
- **Category**: structure
- **File**: src/components/org/BacklogItemRow.tsx:9 (exports `ItemRow`), src/components/org/BacklogSummary.tsx:14,27 (exports `SummaryStrip`, `OwnerHeader`)
- **Scenario**: The file `BacklogItemRow.tsx` exports a component named `ItemRow` (not `BacklogItemRow`), and `BacklogSummary.tsx` exports `SummaryStrip` and `OwnerHeader` (no `BacklogSummary` symbol exists). The import sites (`BacklogPanel.tsx:6-7`) use the symbol names, so it works, but the file-name↔export-name mismatch makes the pieces harder to grep and reason about.
- **Root cause**: Files were named after the feature/context while the exported components kept shorter local names; nobody reconciled the two.
- **Impact**: Cosmetic only — searching for `BacklogItemRow` finds the file but not a usable export; the `BacklogSummary` file actually contains two unrelated-by-name exports. Slightly raises the bar for navigation. No functional cost.
- **Fix sketch**: Optional rename for consistency — e.g. rename the export `ItemRow` → `BacklogItemRow` (and update the single importer `BacklogPanel.tsx:7`). For `BacklogSummary.tsx`, either accept it as a multi-export module or split/rename. Each is a single-call-site rename (every export here is imported exactly once, by `BacklogPanel`), so it is mechanical and behavior-preserving. Lowest priority of the three.
