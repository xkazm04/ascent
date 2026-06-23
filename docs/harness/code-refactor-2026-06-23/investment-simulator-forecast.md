# Code Refactor — Investment Simulator & Forecast
> Context group: Org Planning & Execution
> Total: 4 findings (Critical: 0, High: 1, Medium: 2, Low: 1)

This context is largely clean. The pure cores (`orgsim.ts`, `forecast.ts`) are well-factored, fully exercised by their tests, and every export is consumed — `recomputeRepo`/`simulateFleet`/`rankFleetInvestments` via `src/lib/db/plan.ts`, and `forecastTrajectory`/`projectGoal`/`forecastHeadline`/`humanizeDays` across rollups, briefings, trends, and goal views. No dead code, no debug logging, no commented-out blocks, no stale TODOs. The findings below are all about copies of small helpers/types that the component layer re-implements instead of importing from their established homes — the kind of drift the codebase already pays for once (see Finding #1's diverged field set in Finding #4).

## 1. `humanizeDays` is re-implemented verbatim in the Simulator instead of imported from `forecast.ts`
- **Severity**: High
- **Category**: duplication
- **File**: src/components/org/plan/Simulator.tsx:46-52 (duplicate of src/lib/maturity/forecast.ts:284-289)
- **Scenario**: `Simulator.tsx` defines a private `humanizeDays(days)` whose body is byte-for-byte identical to the exported `humanizeDays` in `forecast.ts` — same thresholds (`<= 1`, `< 14`, `< 60`), same `~Math.round(days/7)`/`/30` math, same string format. The component's own comment on line 46 admits it: *"matches forecast.humanizeDays."*
- **Root cause**: The function is in scope #1's `forecast.ts` and is already imported by siblings (`Trajectory.tsx`, `goalView.tsx`, `portfolio.ts`, `db/index.ts`), but a private copy was pasted into the Simulator rather than added to its import list — most likely to avoid pulling a `@/lib/maturity/forecast` import into a `"use client"` component, though the function is pure and client-safe (the other client components import it fine).
- **Impact**: Two definitions of the same "~N days / weeks / months" formatter. If the canonical one is tuned (e.g. a "~1 week" band or different rounding) the Simulator's goal-impact "(… sooner)" copy silently drifts out of agreement with every other trajectory surface — exactly the user-visible inconsistency the comment was written to prevent. ~7 lines of needless duplication.
- **Fix sketch**: Delete `Simulator.tsx:46-52` and add `humanizeDays` to the existing `import { … } from "@/lib/maturity/forecast"` set (the file already imports `FleetProjection`/`InvestmentRank` from `@/lib/scoring/orgsim`, so a forecast import is a natural sibling). The single call site at line 399 is unchanged. Behavior-preserving — the implementations are identical.

## 2. Dead exported type `SimMetric`
- **Severity**: Medium
- **Category**: dead-code
- **File**: src/lib/scoring/orgsim.ts:21-22
- **Scenario**: `export type SimMetric = DimensionId | "overall" | "adoption" | "rigor";` is declared and exported but never referenced. A repo-wide grep for `SimMetric` returns only this declaration line plus doc/harness markdown — no import, no re-export, no use in `plan.ts`, `route.ts`, `Simulator.tsx`, or the tests. The simulator's actual metric concept lives on `SimFix.dimId` / the `GoalImpact.metric` string instead.
- **Root cause**: Almost certainly a leftover from an earlier API shape (a scenario that targeted "a single dimension, or one of the two axes / the overall" — per its doc comment) that was superseded by the `fixes: SimFix[]` design. The type outlived the design it was written for.
- **Impact**: A maintainer reading `orgsim.ts` sees an exported public type and reasonably assumes it's part of the module's contract, then wastes time hunting for where axes-vs-dimensions branching happens — there is none. Minor confusion + a phantom public surface that constrains future renames.
- **Fix sketch**: Delete lines 21-22 (the doc comment and the `export type SimMetric` line). No callers to update — confirmed zero references across `src/`. Purely behavior-preserving (type-only, unused).

## 3. Client-side `GoalImpact` interface duplicates the server `GoalImpact` and has already drifted
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/org/plan/Simulator.tsx:20-32 (mirror of src/lib/db/plan.ts:517-533)
- **Scenario**: `Simulator.tsx` hand-declares an `interface GoalImpact` describing the exact JSON the `/api/org/simulate` route returns (which is produced from `plan.ts`'s `GoalImpact`). The component comment on line 20 states it *"mirrors GoalImpact in src/lib/db/plan.ts."* The two copies have already diverged: the server type carries a `metric: string` field (plan.ts:520) that the client copy omits — i.e. the "kept in sync by hand" contract is already broken.
- **Root cause**: `plan.ts` is a server/Prisma module, so the author re-typed the response shape locally rather than importing the type, to keep server code out of the client bundle. But a TypeScript `import type` is erased at compile time and pulls in no runtime code, so the barrier is illusory here.
- **Impact**: The client's view of the API contract can silently fall out of step with the server's — as it already has on `metric`. A future field added/renamed server-side compiles clean on the client against the stale local copy, surfacing only as a runtime `undefined`. ~13 lines of shadow contract.
- **Fix sketch**: Replace the local `interface GoalImpact` (lines 20-32) with `import type { GoalImpact } from "@/lib/db/plan";` (type-only — no runtime/server code reaches the client). The state hook `useState<GoalImpact[]>` and all field reads in the goal-impact JSX (lines 386-408) keep compiling, now against the single source of truth. If a deliberately narrower client view is preferred, derive it with `Pick<GoalImpact, …>` rather than retyping. Behavior-preserving.

## 4. Local `signed` helper duplicates the shared, tested `signedDelta`
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/org/plan/Simulator.tsx:44
- **Scenario**: `const signed = (n) => (n > 0 ? `+${n}` : `${n}`);` is byte-identical to the shared `signedDelta` exported from `src/components/ui/format.ts:14` (and re-exported through `@/components/ui` *and* `@/components/org/ui`, with its own unit test in `format.test.ts`). The same one-liner is also copy-pasted into `report/compare.ts:173` and `gate-comment.ts:25`, so this is at least the fourth instance of one formatter.
- **Root cause**: A trivial formatter that predates (or simply ignores) the shared `format.ts` brand-formatters module; each surface re-typed it inline rather than reaching for the common util.
- **Impact**: Low — the logic is unlikely to change. Mostly a consistency/discoverability cost: the project has a canonical, tested delta formatter that this component bypasses, so the "shared formatter" pattern is undermined and each copy is an independent thing to audit.
- **Fix sketch**: Delete line 44 and add `signedDelta` to the existing `import { Card, Meter, SectionHeader } from "@/components/org/ui"` line (the barrel already re-exports it — sibling `PeriodSummary.tsx` imports `signedDelta` from exactly this path). Then either alias `signedDelta as signed` to leave the ~6 call sites untouched, or rename the calls. Behavior-preserving — the functions are identical. (The two other copies in `compare.ts`/`gate-comment.ts` are outside this context's scope but are the same fix.)
