# Code Refactor — Scan Persistence & History
> Context group: Data & Persistence
> Total: 3 findings (Critical: 0, High: 0, Medium: 2, Low: 1)

This context is largely clean. The persist/read split is well-factored, every export is referenced by live callers (verified across `src/`), and the concurrency primitives have dedicated tests. The findings below are localized consolidation opportunities, not dead code — nothing here is genuinely unused. Two `HistoryPoint`/JSON-parse patterns are duplicated in ways that have already started to drift in detail and are worth folding into one helper each.

## 1. `HistoryPoint` row → DTO mapping is duplicated inside scans-read.ts
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/db/scans-read.ts:203-234 (the `toPoint` mapper + `baseSelect`) and src/lib/db/scans-read.ts:381-410 (`getScanComparison`'s inline list mapping)
- **Scenario**: `getRepositoryHistory` defines a named `toPoint(s) => HistoryPoint` mapper plus a `baseSelect` const (id, headSha, overallScore, level, levelName, confidence, engineProvider, engineModel, scannedAt) with `dimensions: { dimId, score }`. `getScanComparison` then re-selects the identical column set (lines 385-396) and re-implements the exact same field-for-field `HistoryPoint` construction inline (lines 399-410), including the same `scannedAt: s.scannedAt.toISOString()` conversion and the same `dimensions` pass-through.
- **Root cause**: `getScanComparison` was added after `getRepositoryHistory` and needed the same newest-first picker list, but built its own copy rather than reusing the existing mapper/select that sit a few hundred lines above it in the same file.
- **Impact**: Two copies of the `HistoryPoint` projection must be kept in lockstep. They have already partially diverged in shape (`toPoint` accepts an optional `dimensions?` and falls back to `[]`; the inline version assumes it is always present), so adding a field to `HistoryPoint` (or changing a conversion) is a two-edit change where one is easy to miss — a classic drift-prone duplication.
- **Fix sketch**: Promote `baseSelect` and `toPoint` to module-scope consts in scans-read.ts (they are currently locals of `getRepositoryHistory`). Have `getScanComparison` reuse the same `select: { ...baseSelect, dimensions: { select: { dimId: true, score: true } } }` and replace its inline `list.map((s) => ({ ... }))` (lines 399-410) with `list.map(toPoint)`. Behavior-preserving — the selected columns and produced shape are already identical. No external callers change; both functions keep their signatures.

## 2. `explore` JSON parsing re-implemented in scans-shared instead of reusing the array-of-strings parser
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/db/scans-shared.ts:194-200 (`toPersistedRec`) vs src/lib/db/scans-read.ts:598-606 (`parseStringArray`)
- **Scenario**: `toPersistedRec` hand-rolls a try/`JSON.parse`/`Array.isArray`/`filter((x): x is string => typeof x === "string")` block to decode the persisted `explore` column. `parseStringArray` in scans-read.ts is the same logic (parse → array guard → keep only strings), just with an empty-string short-circuit and the `catch` returning `[]`. The shared module also has the inverse asymmetry: scans-read calls `toPersistedRec` and separately calls `parseStringArray(r.explore)` on the same kind of column in `getScanReportByCommit` (line 704), so the codebase parses "stored string-array JSON" two different ways.
- **Root cause**: `toPersistedRec` lives in the lower-level shared module (scans-read imports *from* scans-shared, not the reverse), so when it needed to decode `explore` it couldn't import `parseStringArray` without inverting the dependency direction, and re-implemented it instead.
- **Impact**: Two implementations of the same "parse a persisted string[] JSON column" rule. They differ in edge handling (null/empty short-circuit, comment style) so a future hardening (e.g. capping array length, trimming) would have to be applied in both places or silently diverge. Low bug-risk today, but it is exactly the kind of split helper that accumulates inconsistency.
- **Fix sketch**: Move a single canonical `parseStringArray(s: string | null | undefined): string[]` into scans-shared.ts (the dependency sink both modules can import), export it, and have both `toPersistedRec` (replace the inline block) and scans-read.ts (drop its local copy, import the shared one) use it. Keep scans-read's other typed parsers (`parseJsonObject`, `parseNumberArray`, `parseDiscrepancies`) where they are — only the string-array case is shared across the module boundary. Behavior-preserving; the output for valid/empty/malformed input is identical.

## 3. Verbose `// (Body indentation kept as-is to keep the diff reviewable.)` scaffolding comment is now stale
- **Severity**: Low
- **Category**: cleanup
- **File**: src/lib/db/scans-persist.ts:62-70 (specifically the parenthetical on line 68 and the un-indented `withDb` body that follows)
- **Scenario**: `persistScanReport` wraps its whole body in `return withDb(async () => { ... })`, but the body is intentionally left at the original (one-level-shallower) indentation, with a trailing comment "(Body indentation kept as-is to keep the diff reviewable.)". That note documents a one-time review convenience of the PR that introduced `withDb`, not anything about the code's behavior.
- **Root cause**: A `withDb(...)` wrapper was added around an existing function body and the author skipped re-indenting to keep that PR's diff small, leaving a meta-comment about the diff in permanent source.
- **Impact**: Cosmetic. The mismatched indentation makes the function slightly harder to read (the body looks like it is outside the `withDb` closure), and the stale "diff reviewable" note is noise for anyone reading the file fresh. No behavioral effect.
- **Fix sketch**: Re-indent the `withDb` callback body one level and delete the parenthetical on line 68. Purely formatting — no logic moves. (Optional/low priority; safe to leave if minimizing churn.)
