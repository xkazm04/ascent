# Code Refactor — Connect & Repo Selection
> Context group: Onboarding, Shell & AI Standard
> Total: 4 findings (Critical: 0, High: 1, Medium: 1, Low: 2)

## 1. `SCHEDULES` constant exists but the cadence list is hard-coded a second time in InstallationRepos
- **Severity**: High
- **Category**: duplication
- **File**: src/components/connect/InstallationRepos.tsx:416 (vs src/components/connect/installationRepoTypes.ts:22 and src/components/connect/RepoRow.tsx:6,76)
- **Scenario**: `installationRepoTypes.ts` exports `export const SCHEDULES = ["off", "daily", "weekly", "monthly"]` precisely so the cadence options have one source of truth. `RepoRow.tsx` does the right thing — it imports `SCHEDULES` and maps over it for the per-row schedule `<select>`. But the "Schedule watched" bulk `<select>` in `InstallationRepos.tsx:416` re-types the literal array `["off", "daily", "weekly", "monthly"]` inline instead of reusing the constant it already has in scope (the file already imports from `./installationRepoTypes` on line 11).
- **Root cause**: The bulk-schedule control (Phase 9 bulk actions) was added after `SCHEDULES` was extracted, and the literal was pasted rather than wired to the existing constant. The two copies now sit in sibling components and have already begun to diverge in *form* (constant vs literal) even though the values still match.
- **Impact**: A genuine bug-source: adding/removing/renaming a cadence (e.g. "biweekly") updates `RepoRow` and the `credit-estimate` map (which is keyed off `SCHEDULES`, see credit-estimate.test.ts) but silently leaves the bulk picker offering the old set — the per-row and bulk controls would disagree. Pure duplication with no behavioral upside.
- **Fix sketch**: In `InstallationRepos.tsx`, add `SCHEDULES` to the existing `./installationRepoTypes` import and replace the inline `["off", "daily", "weekly", "monthly"].map(...)` on line 416 with `SCHEDULES.map(...)`. Behavior-preserving (identical values/order). The wider repo has 4+ more independent copies of this literal (`org/SegmentActions.tsx`, `org/ScheduleSelect.tsx`, `api/org/import/route.ts`, `api/org/schedule/route.ts`) — out of this context's scope, but worth a follow-up to centralize.

## 2. `applyWatchOptimistic` and `rollbackWatch` are pure aliases of `patchRepoState`
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/connect/watchState.ts:16-38 (callers: src/components/connect/InstallationRepos.tsx:155-180)
- **Scenario**: `watchState.ts` exports three functions where two are one-line passthroughs: `applyWatchOptimistic(repos, fullName, next)` is `return patchRepoState(repos, fullName, next)` and `rollbackWatch(repos, fullName, prev)` is `return patchRepoState(repos, fullName, prev)`. They are identical to `patchRepoState` in signature and body (the docstrings even say "Identical transform to `patchRepoState`"). The component's three wrappers `patch`/`patchOptimistic`/`patchRollback` (InstallationRepos.tsx:155-180) are likewise the same `setView` orchestration, each just calling one of the three identical transforms.
- **Root cause**: The intent was naming-for-the-call-site (a "rollback" reads clearer than `patch` at the failure branch). But the extraction produced two real exports — plus their own test blocks in `watchState.test.ts` — that carry no distinct logic, only a distinct name.
- **Impact**: Three exported symbols + two dedicated `describe` blocks to maintain for one transform; a reader must confirm all three bodies are actually identical before trusting any one. Low bug-risk (they genuinely match today) but ongoing confusion and test bloat.
- **Fix sketch**: Behavior-preserving option — keep the *semantic* names but make them explicit thin aliases (`export const applyWatchOptimistic = patchRepoState;` / `export const rollbackWatch = patchRepoState;`) so it's obvious there is one transform, and the existing tests still pass. Or collapse to a single `patchRepoState` and rename the call sites' local helpers (`patchOptimistic`→`patch`, drop `patchRollback`), trimming the redundant `applyWatchOptimistic`/`rollbackWatch` `describe` blocks. Either is safe; the alias form is the lower-risk change.

## 3. `appConfigureUrl` is imported via two different paths across the context
- **Severity**: Low
- **Category**: cleanup
- **File**: src/app/connect/page.tsx:10 (`@/lib/github/app`) vs src/components/connect/InstallationRepos.tsx:7 (`@/lib/ui`)
- **Scenario**: The same function `appConfigureUrl` is pulled from `@/lib/github/app` in `page.tsx` and from `@/lib/ui` in `InstallationRepos.tsx`. `@/lib/github/app` only re-exports it from `@/lib/ui` (app.ts:45), so both resolve to the identical implementation — but the import sites disagree on the canonical path.
- **Root cause**: `appConfigureUrl` was moved to the client-safe `@/lib/ui` and re-exported from `@/lib/github/app` for server callers (documented in both modules). The server page kept the `github/app` path; the client component imports the source module directly. Both are "correct," just inconsistent.
- **Impact**: Cosmetic only — minor reader friction and a slightly muddier "where does this live" answer. No behavior or bundle difference (the re-export is type/tree-shake transparent).
- **Fix sketch**: Pick one convention for client components — since `InstallationRepos.tsx` is a client component and `@/lib/ui` is the env-free client-safe home, leaving it on `@/lib/ui` is fine; the cleanup is to keep the server `page.tsx` on `@/lib/github/app` (its documented server entry) and simply note the convention. No code change is strictly required; flag only if standardizing imports.

## 4. `installRouting` declares `InstallEntry`/`InstallView` but annotates its internal array with the inline shape
- **Severity**: Low
- **Category**: cleanup
- **File**: src/app/connect/installRouting.ts:15-23,36
- **Scenario**: The module exports `InstallEntry { login; id? }` and `InstallView { installs: InstallEntry[]; pendingInstall }`, and the function return type is `InstallView`. But the internal accumulator on line 36 is annotated with the inline structural literal `const installs: { login: string; id?: string }[] = ...` rather than `InstallEntry[]` — a re-statement of the type that was just named one screen above.
- **Root cause**: The function body was extracted "verbatim" from `page.tsx` (per the module header comment), carrying the original inline annotation, while the named interfaces were added around it during extraction. The two never got reconciled.
- **Impact**: Trivial — a duplicated type literal that must be kept in sync by hand with `InstallEntry`; purely a readability/consistency nit.
- **Fix sketch**: Change the line-36 annotation to `const installs: InstallEntry[] = (session?.installations ?? []).map(...)`. Behavior-preserving (structurally identical type); also makes the `push` on line 45 type-check against the named interface.
