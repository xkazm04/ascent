# Code Refactor — Roadmap & Recommendation Tracking
> Context group: Reporting & Visualization
> Total: 4 findings (Critical: 0, High: 0, Medium: 2, Low: 2)

This context is largely clean and well-documented — the API routes, the DB mutation layer, and the
extracted pure `recommendationRowState` helpers all carry their reasoning inline and have no obvious
cruft. The findings below are the few genuine, behavior-preserving cleanups worth doing; none is a
live bug.

## 1. Dead export: `updateRecommendationStatus` (no callers)
- **Severity**: Medium
- **Category**: dead-code
- **File**: src/lib/db/scans-recommendations.ts:161-168 (plus re-exports src/lib/db/scans.ts:38 and src/lib/db/index.ts:24)
- **Scenario**: `updateRecommendationStatus(id, status, opts)` is a back-compat wrapper that just calls `updateRecommendation(id, { status }, opts)`. It is defined, re-exported through both barrels (`scans.ts` and the `@/lib/db` index), and even listed in `docs/features/data-model.md`, yet it is never *called* anywhere. The PATCH route (`src/app/api/recommendations/[id]/route.ts:107`) and every other consumer use `updateRecommendation` directly.
- **Root cause**: A status-only convenience wrapper that predates the generalized `updateRecommendation(patch)` API. When the patch-shaped function landed, the route was switched to it and the old wrapper was left behind (kept "for back-compat" but with no remaining caller).
- **Impact**: Maintenance/confusion — a wrapper + two barrel re-export lines + a doc-table entry that imply a public API surface nobody uses; readers must verify it has no callers before touching `updateRecommendation`.
- **Fix sketch**: Delete the `updateRecommendationStatus` function (scans-recommendations.ts:161-168) and remove its name from the two re-export blocks (scans.ts:38, index.ts:24). Update the `docs/features/data-model.md` row to drop the `(+ updateRecommendationStatus)` note. Confirmed safe: a repo-wide grep finds only the definition, the two re-exports, and the doc — no import/call site, no test, no dynamic/string-keyed lookup.

## 2. Impact/effort chip markup re-inlined despite a shared `RoadmapMeta` renderer
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/report/RoadmapPanel.tsx:7-14 (RoadmapMeta) vs RoadmapPanel.tsx:139-145 (RoadmapSteps) and src/components/report/RoadmapSandboxParts.tsx:271-278 (RoadmapSimulators)
- **Scenario**: The same "impact: X / effort: Y" pill pair is hand-written in three places, each rebuilding the identical `className={`...border... ${IMPACT_CLASS[item.impact]}`}` / `${EFFORT_CLASS[item.effort]}` spans. `RoadmapMeta` (used by `RecommendationTracker`) already *is* the canonical renderer for exactly this pair, but `RoadmapSteps` and `RoadmapSimulators` re-inline it instead of reusing it. The copies have already drifted cosmetically (RoadmapMeta/Steps use `px-2 py-0.5` + a `:` after the label; the Sandbox copy uses `px-1.5 py-0.5` and no colon).
- **Root cause**: The chip pair was originally written inline in each list before `RoadmapMeta` was extracted; the extraction was wired into the tracker but the two roadmap lists were never migrated to it.
- **Impact**: A label/color/spacing change to the impact-effort chips has to be made in three spots and is easy to miss one (the drift already shows this); extra duplicated JSX to read and maintain.
- **Fix sketch**: Make `RoadmapMeta` accept an optional size/label variant (e.g. a `compact?: boolean` that switches `px-2`↔`px-1.5` and the `:`), then replace the inline span pair in `RoadmapSteps` (RoadmapPanel.tsx:139-145, keeping the sibling `lifts …` and `PayoffChip` spans) and in `RoadmapSimulators` (RoadmapSandboxParts.tsx:271-278, `compact`) with `<RoadmapMeta item={item} />`. `RoadmapMeta` already takes `Pick<LlmRoadmapItem, "impact" | "effort">`, which both `item`s satisfy. (Note: `OrgLeverageMoves.tsx:54` shares the same pattern but is out of this context's scope.)

## 3. Value imports used only in `typeof` type positions (RoadmapSandboxParts)
- **Severity**: Low
- **Category**: cleanup
- **File**: src/components/report/RoadmapSandboxParts.tsx:9
- **Scenario**: `import { cheapestPathToNextLevel, projectSandbox } from "@/lib/scoring/engine";` is a value import, but both symbols are referenced only inside `ReturnType<typeof projectSandbox>` / `ReturnType<typeof cheapestPathToNextLevel>` (lines 173-174, 242) — pure type positions. TypeScript erases `typeof` type queries, so no runtime binding is needed in this `"use client"` component.
- **Root cause**: The prop types were declared with `ReturnType<typeof …>` (a convenient way to mirror the engine's return shapes) using a plain value import rather than `import type`.
- **Impact**: Pulls the scoring-engine module into this client component's import graph for no runtime reason — minor bundle/eval cost and a misleading "this component uses the engine at runtime" signal. (The sibling `RoadmapSandbox.tsx` legitimately imports both as values.)
- **Fix sketch**: Change line 9 to `import type { cheapestPathToNextLevel, projectSandbox } from "@/lib/scoring/engine";`. The `import { DIMENSION_BY_ID, LEVEL_BY_ID, LEVELS }` on line 8 stays a value import (genuinely used at runtime). Behavior-preserving; verified both names appear only in `typeof` positions in this file.

## 4. File named `RoadmapPanel.tsx` exports no `RoadmapPanel`
- **Severity**: Low
- **Category**: structure
- **File**: src/components/report/RoadmapPanel.tsx:1-160
- **Scenario**: The module is a grab-bag of report roadmap pieces — `RoadmapMeta`, `ExploreList`, `TrustLadder`, `PayoffChip`, `NextLevelPath`, `RoadmapSteps` — but there is no `RoadmapPanel` component, so the filename names an export that doesn't exist. Imports read `from "@/components/report/RoadmapPanel"` to get e.g. `ExploreList`/`TrustLadder`, which is mildly misleading when locating code.
- **Root cause**: The file likely once held a `RoadmapPanel` wrapper that was split/renamed into these smaller exports while the filename stuck.
- **Impact**: Discoverability/confusion only — a reader looking for the roadmap panel finds a shared-primitives file; not a correctness issue.
- **Fix sketch**: Low priority and touches two importers, so optional. If done: rename the file to something matching its contents (e.g. `roadmapPieces.tsx` / `RoadmapBits.tsx`) and update the two import sites (`ReportView.tsx:15`, `RecommendationTracker.tsx:5`). Purely a rename — no logic change. Leave as-is if the cross-file churn isn't worth it.
