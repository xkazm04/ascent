# Code Refactor — Database Client & Schema
> Context group: Data & Persistence
> Total: 3 findings (Critical: 0, High: 1, Medium: 1, Low: 1)

This context is in good shape. The Prisma client (`client.ts`) is dense but cohesive — every block (DSQL config, error classification, OCC retry, token minting, the token-aware singleton) earns its place and is covered by an unusually thorough test. The schema↔init.sql mirror is actively guarded by `init-sql.test.ts`, and the env-gated `connection_limit` knob plus the two budget helpers (`applyConnectionBudget` for a built `URL`, `withConnectionBudget` for a raw string) are complementary, not duplicated. The findings below are the only genuine cruft I could confirm with repo-wide grep.

## 1. `index.ts` re-exports a non-db module (`@/lib/maturity/forecast`) that no caller reaches through the barrel
- **Severity**: High
- **Category**: dead-code
- **File**: src/lib/db/index.ts:269-277
- **Scenario**: The `@/lib/db` barrel ends with a block re-exporting `forecastTrajectory`, `forecastHeadline`, `humanizeDays` and the types `Forecast`, `LevelEta`, `Trajectory`, `SeriesPoint` from `@/lib/maturity/forecast`. This is a forecasting/maturity module, not persistence — it does not belong in the db data-API barrel. More concretely, it is dead surface: every actual consumer of those symbols imports them **directly** from `@/lib/maturity/forecast` (confirmed in `src/app/trends/page.tsx`, `src/app/api/cron/digest/route.ts`, `src/lib/org/portfolio.ts`, `src/lib/org/briefing.ts`, plus the `@/components/org/*` views). A repo-wide grep finds **zero** imports of any forecast symbol via `@/lib/db`.
- **Root cause**: A convenience re-export added so one early call site (likely an org rollup that already pulled several `@/lib/db` symbols) could grab `forecastHeadline` from the same line. The call sites later settled on importing forecast directly, but the barrel line was never removed, so it ossified into a cross-domain dependency: importing the db barrel now transitively pulls in the maturity/forecast module.
- **Impact**: Misleads maintainers about the db barrel's responsibility boundary (it looks like forecasting is part of persistence), couples two unrelated domains, and bloats the import graph of every one of the ~40 files that import `@/lib/db` with a module none of them need from it. It also invites future drift (someone "fixing" a forecast export here while the real definitions live elsewhere).
- **Fix sketch**: Delete the entire `export { … } from "@/lib/maturity/forecast";` block (lines 269-277) from `src/lib/db/index.ts`. No caller updates are needed — every consumer already imports from `@/lib/maturity/forecast` directly. Behavior-preserving (the symbols remain exported from their true home). Verify with `rg 'forecast(Trajectory|Headline)|humanizeDays' src | rg '@/lib/db'` returning nothing after the edit.

## 2. `__ascentPglite` is stashed on `globalThis` but never read
- **Severity**: Medium
- **Category**: dead-code
- **File**: src/lib/db/pglite-boot.ts:13,35
- **Scenario**: `bootPglite()` declares `g` as `{ __ascentPgliteAdapter?: unknown; __ascentPglite?: unknown }` and, after constructing the embedded PGlite instance, writes both `g.__ascentPgliteAdapter = new PrismaPGlite(pglite)` (line 34) and `g.__ascentPglite = pglite` (line 35). The consumer (`src/lib/db/client.ts`, `newClient`) only ever reads `g.__ascentPgliteAdapter`. A repo-wide grep shows `__ascentPglite` (the bare PGlite handle) is **written here and read nowhere** — in `src`, `docs`, or `scripts`.
- **Root cause**: The raw PGlite handle was likely stashed for a planned teardown/HMR-reuse or test-introspection path (`__ascentPgliteAdapter` is documented as "survives HMR"), but that path was never built — only the adapter is needed at runtime.
- **Impact**: Low-risk but genuinely confusing: a reader sees two global handles and has to grep to learn only one is live. It also keeps a strong reference to the underlying WASM Postgres on `globalThis` for no consumer, and widens the global-state surface that the `client.ts` `g` cast must stay in sync with.
- **Fix sketch**: Drop the unused field. Remove `__ascentPglite?: unknown` from the local `g` type (line 13) and delete the assignment on line 35. Keep only `g.__ascentPgliteAdapter`. Behavior-preserving — nothing reads the removed handle. (If a future teardown genuinely needs the raw instance, the adapter still wraps it; reintroduce intentionally then.)

## 3. Stale magic-number in the `getPrisma()` cold-start comment ("125 sites")
- **Severity**: Low
- **Category**: cleanup
- **File**: src/lib/db/client.ts:416
- **Scenario**: The cold-start guard comment reads "Direct getPrisma() callers (125 sites) hit this; withDb() awaits a mint first and is safe." The hard-coded "125 sites" is a count that drifts the moment any call site is added or removed — and it already has: `getPrisma()` currently appears 165 times across 34 files in `src`.
- **Root cause**: A point-in-time count was baked into prose during the DSQL cold-start hardening and never maintained, the way embedded counts always go stale.
- **Impact**: Cosmetic, but actively misleading — a maintainer reasoning about blast radius from this number would undercount. The comment's *point* (sync `getPrisma()` callers depend on the seed-URL guard; `withDb()` does not) stands on its own without a number.
- **Fix sketch**: Drop the parenthetical count, e.g. change "Direct getPrisma() callers (125 sites) hit this" to "Direct getPrisma() callers hit this". Comment-only; no behavior change.
