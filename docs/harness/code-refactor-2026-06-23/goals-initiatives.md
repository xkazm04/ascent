# Code Refactor — Goals & Initiatives
> Context group: Org Planning & Execution
> Total: 4 findings (Critical: 0, High: 1, Medium: 2, Low: 1)

## 1. Dead `simulateOrgFix` single-fix wrapper (never called)
- **Severity**: High
- **Category**: dead-code
- **File**: src/lib/db/plan.ts:487-494 (+ barrel re-export src/lib/db/index.ts:207)
- **Scenario**: `simulateOrgFix(orgSlug, dimId, target, repoFullNames)` is a thin wrapper that just forwards to `simulateOrgFixes(orgSlug, [{ dimId, target }], repoFullNames)`. A repo-wide grep for `simulateOrgFix\b` (excluding the multi-fix `simulateOrgFixes`) returns exactly two hits: its own definition and the re-export in `src/lib/db/index.ts`. There is no caller anywhere — not in components, not in routes, not in tests.
- **Root cause**: It was the original single-dimension simulate entry point; when the multi-dimension `simulateOrgFixes` (SIM-2) landed, the API route `src/app/api/org/simulate/route.ts` was wired straight to the plural form (`simulateOrgFixes(body.org, fixes, repos)`), leaving the singular wrapper stranded but still exported.
- **Impact**: A public, exported, async DB-layer function with no callers — maintainers must keep reading and reasoning about it, it shows up in autocomplete/barrel as if it's a supported API, and it implies a single-fix code path that no longer exists. Pure dead weight in the most-read file of this context.
- **Fix sketch**: Delete the `simulateOrgFix` function (plan.ts:487-494) and remove `simulateOrgFix,` from the export list in `src/lib/db/index.ts:207`. Behavior-preserving: no caller exists, and the plural `simulateOrgFixes` already accepts the same scenario as a one-element array. No other callers to update.

## 2. Initiative status constants duplicated four ways
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/org/plan/InitiativesPanel.tsx:39-40; src/app/api/org/initiatives/[id]/route.ts:12; src/components/org/plan/goalView.tsx:95-100
- **Scenario**: The same `open | in_progress | done | dismissed` status set and its display labels are spelled out independently in at least three in-scope places: `InitiativesPanel.tsx` (`const STATUSES = [...]` + `STATUS_LABEL = { open: "Open", ... }`), the PATCH route (`const STATUSES = new Set([...])` used for validation), and `goalView.tsx` (`INIT_STATUS_LABEL = { open: "open", in_progress: "in progress", ... }`). The project already has a canonical source: `REC_STATUSES` in `src/lib/types.ts:25` and `STATUS_LABEL` in `src/components/org/backlogShared.ts:4` with byte-identical values — initiatives reuse the recommendation status vocabulary.
- **Root cause**: Initiatives were modeled on recommendations (same four statuses) but each surface (form dropdown, server validator, goal cross-render) declared its own literal copy instead of importing the shared constant.
- **Impact**: Four copies of one enum that must stay in lockstep — add or rename a status (e.g. "blocked") and the dropdown, the server's accept-list, and the label maps silently drift. This is exactly the "two copies already drifting" risk: `goalView.tsx` already lower-cases its labels while `InitiativesPanel` title-cases them, so they have *already* diverged.
- **Fix sketch**: Import `REC_STATUSES` (and `RecStatus`) from `@/lib/types` for both `InitiativesPanel.tsx`'s dropdown source and the route's validation set (`new Set(REC_STATUSES)`), and reuse `STATUS_LABEL` from `@/components/org/backlogShared` for `InitiativesPanel`'s labels. Leave `goalView.tsx`'s intentionally-lowercased `INIT_STATUS_LABEL` if the casing is deliberate, or derive it from the shared label map via `.toLowerCase()`. Each change is behavior-preserving (identical values today).

## 3. `GoalLaggard` interface defined twice, identically
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/db/plan.ts:176-183 and src/components/org/plan/goalView.tsx:10-15
- **Scenario**: `GoalLaggard` (`{ fullName: string; name: string; value: number; gap: number }`) is declared in full in both `plan.ts` (where `listGoals` produces it) and `goalView.tsx` (where `GoalCard` renders it via `GoalProgressView.laggards`). Both are standalone `interface` declarations with the same four fields; neither imports the other.
- **Root cause**: `goalView.tsx` defines its own serializable `GoalProgressView` to mirror `plan.ts`'s `GoalProgress` (the comment at goalView.tsx:17 even says "mirrors GoalProgress from src/lib/db/plan.ts"), and re-declared the nested `GoalLaggard` shape rather than importing it to keep the client component free of a DB-module import.
- **Impact**: Two type definitions for one wire shape that must stay structurally identical or the server payload silently stops matching what the UI renders. Low blast radius today, but it's a real "drift waiting to happen" — add a field to one laggard shape and the other won't know.
- **Fix sketch**: Pick one home for the shared shape (the view-layer `goalView.tsx` is the natural one since both `GoalProgress` and `GoalProgressView` already point at it) and import it in the other. E.g. `plan.ts` could `import type { GoalLaggard } from "@/components/org/plan/goalView"`, or extract `GoalLaggard` to a tiny shared type module both import. Behavior-preserving — the structural definition is unchanged, only de-duplicated.

## 4. Axis metric labels hand-duplicated in plan/page.tsx
- **Severity**: Low
- **Category**: duplication
- **File**: src/app/org/[slug]/plan/page.tsx:40-45
- **Scenario**: `metricOptions` hardcodes the literal axis labels `"Overall maturity"`, `"AI Adoption"`, and `"Engineering Rigor"` for the `overall`/`adoption`/`rigor` entries. These exact three strings are already produced by the exported `metricLabel()` helper in `src/lib/db/plan.ts:22-27`, which is the canonical "metric id → human label" function (and is unit-tested in plan.test.ts).
- **Root cause**: The page builds the `<select>` option list inline and typed the axis labels by hand instead of calling the helper that exists one import away.
- **Impact**: Cosmetic duplication of three label strings; if a label is ever reworded (e.g. "AI Adoption" → "Adoption"), `metricLabel()` and this dropdown drift apart, showing two names for the same metric in the same feature. Tiny, but free to remove.
- **Fix sketch**: Import `metricLabel` from `@/lib/db` and build the three axis entries from it, e.g. `["overall","adoption","rigor"].map((m) => ({ value: m, label: metricLabel(m) }))`, then keep the existing `...DIMENSIONS.map(...)` spread. Behavior-preserving — `metricLabel` returns the identical strings for these ids.
