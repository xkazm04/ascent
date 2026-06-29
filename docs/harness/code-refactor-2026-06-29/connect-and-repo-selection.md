# Code Refactor — Connect & Repo Selection
> Total: 5 | Critical: 0 High: 0 Medium: 2 Low: 3

## 1. Triplicated `patch` / `patchOptimistic` / `patchRollback` wrappers collapse to one transform
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/connect/InstallationRepos.tsx:155-180 (with src/components/connect/watchState.ts:29,36)
- **Scenario**: Three component-level helpers each wrap `setView` with a byte-identical closure: `setView((v) => v.status === "done" ? { status: "done", repos: <fn>(v.repos, fullName, next) } : v)`. They differ only in the imported function name — `patchRepoState`, `applyWatchOptimistic`, `rollbackWatch` — and a param name (`next` vs `prev`).
- **Root cause**: In `watchState.ts`, `applyWatchOptimistic` and `rollbackWatch` are literal aliases of `patchRepoState` (`export const applyWatchOptimistic = patchRepoState;`). So all three wrappers call the *same* function through the *same* closure; the indirection is purely nominal. The split isn't even applied consistently: the bulk path (`watchAllFiltered`, `scheduleWatched`) uses plain `patch` for both optimistic apply *and* revert, while only the single-row path uses the optimistic/rollback names — proving the three are functionally interchangeable.
- **Impact**: ~10 redundant lines plus a 2-level indirection (impl → tested aliases → 3 wrappers) that readers must trace to discover the three are identical; invites drift if one wrapper is "fixed" without the others.
- **Fix sketch**: Keep a single `patch(fullName, next)` and call it everywhere. If the semantic call-site names are wanted for readability, make `patchOptimistic`/`patchRollback` one-line delegators to `patch` rather than re-declaring the full `setView` closure. The tested `watchState.ts` aliases can stay (they document intent and are unit-tested), but they no longer need three distinct component bodies.

## 2. Three useEffect blocks repeat the same AbortController cancellation scaffolding
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/connect/InstallationRepos.tsx:47-74, 76-94, 96-115
- **Scenario**: The repos fetch, credits fetch, and segments fetch are three effects that each open with `const controller = new AbortController(); let active = true;`, reset their slice of state, `fetch(url, { signal: controller.signal })`, guard `if (active) …` / `if (!active) return;` in the handlers, and close with `return () => { active = false; controller.abort(); };`. The inline comments themselves note "Same cancellation contract as the repo fetch" and "same contract as above".
- **Root cause**: A shared "cancellable, latest-wins, reset-on-org-change fetch" lifecycle was copy-pasted three times instead of being factored into one hook/helper.
- **Impact**: ~50 lines of near-identical lifecycle boilerplate in an already 460-line component; any change to the cancellation contract (e.g. tightening the late-resolution guard) must be made in three places consistently.
- **Fix sketch**: Extract a small `useCancellableFetch<T>(url, { onData, onError, deps })` (or a `runCancellable(signal, …)` helper) that owns the AbortController + `active` flag + cleanup, leaving each effect to supply only its URL, parse, and setState. Reduces three effects to three short call sites.

## 3. Repo-list container className duplicated between skeleton and live list (drift risk)
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/connect/RepoListSkeleton.tsx:8 and src/components/connect/InstallationRepos.tsx:450
- **Scenario**: The exact wrapper class string `divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40` is hard-coded in both the skeleton and the real list, and the row layout `flex flex-wrap items-center gap-x-4 gap-y-2 p-4` is mirrored between `RepoListSkeleton` (row) and `RepoRow` (outer `p-4` + inner flex). The skeleton's docstring states it deliberately "mirror[s] the real row layout."
- **Root cause**: The skeleton must visually match the loaded list, but the matching is enforced by duplicated literal class strings rather than a shared constant — so the "mirror" silently breaks if either side is restyled.
- **Impact**: Visual/structural drift between loading and loaded states the next time the list container or row spacing is tweaked; low maintenance cost but a recurring papercut.
- **Fix sketch**: Hoist the container and row layout strings into shared constants (e.g. in `installationRepoTypes.ts` or a tiny `repoListClasses.ts`) and reference them from both the skeleton and the live list/row.

## 4. `appConfigureUrl` imported via two different paths within one feature
- **Severity**: Low
- **Category**: naming
- **File**: src/app/connect/page.tsx:10 (`@/lib/github/app`) vs src/components/connect/InstallationRepos.tsx:7 (`@/lib/ui`)
- **Scenario**: The same function is pulled from two module paths inside the same Connect feature. `@/lib/github/app` only re-exports it: `export { appConfigureUrl } from "@/lib/ui";` (src/lib/github/app.ts:45); the real definition lives in `src/lib/ui.ts:41`.
- **Root cause**: A convenience re-export plus an organic second import; nothing forces a single canonical path, so two co-located files reference the helper differently.
- **Impact**: Minor confusion / "which import is canonical?" friction; a grep for the symbol's source returns a re-export hop. No functional cost.
- **Fix sketch**: Pick one canonical import path for the feature (the `@/lib/ui` definition is the simplest) and use it in both files; or keep the `github/app` re-export only if it carries semantic grouping value and standardize on it.

## 5. Watch POST payload shape `{ owner, name, fullName, url, private }` built in two places
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/connect/InstallationRepos.tsx:205 (single `toggleWatch`) and :264 (bulk `watchAllFiltered`)
- **Scenario**: Both watch requests construct the same per-repo object literal from an `AppRepo`: `{ owner: r.owner, name: r.name, fullName: r.fullName, url: r.url, private: r.private }` (the single call adds `org`/`watched` siblings; the bulk call maps it over `targets`).
- **Root cause**: The repo→watch-payload projection is inlined at each call site rather than expressed once.
- **Impact**: Small; but if the watch API gains/renames a field (e.g. `defaultBranch`), two literals must be updated in lockstep or the bulk and single paths diverge.
- **Fix sketch**: Add a one-liner `toWatchPayload(r: AppRepo)` (next to `watchState.ts`'s pure helpers) returning `{ owner, name, fullName, url, private }`, and use it in both call sites.
