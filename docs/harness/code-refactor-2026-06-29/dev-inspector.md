# Code Refactor — Dev Inspector
> Total: 4 | Critical: 0 High: 0 Medium: 1 Low: 3

This is a small, well-factored context and it has clearly been cleaned recently: the
2026-06-23 findings are all resolved in the current tree (the `LocEntry.raw` write-only
field is gone, there is no blanket `/* eslint-disable */` on `devInspectorUi.tsx`, and the
redundant `data-devinspector` marker on `InspectorHud` was removed — now an explanatory
comment at `devInspectorUi.tsx:152`). The module is live, not dead: `DevInspector` is mounted
once behind a dev gate at `src/app/layout.tsx:83`, and every UI/helper export
(`buildChain`, `dedupeChain`, `pickDefaultIndex`, `isLibraryPath`, `HighlightBox`,
`SourceLabel`, `InspectorHud`, `NavHint`, `Z`, `LocEntry`) is referenced. The build side
(`scripts/dev-inspector/source-loc-loader.cjs` → `inject-source-loc.cjs`) stamps `data-loc`
only when `DEV_INSPECT=1`. The residual findings below are minor cleanups only.

Note: `tsconfig.json` has `noUncheckedIndexedAccess: true`, so the `chain[di] ?? chain[0]`
fallbacks in `DevInspector.tsx` are type-required (not dead) and are intentionally NOT flagged.

## 1. Duplicated "resolve target chain from event" block in the two mouse handlers
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/_dev-inspector/DevInspector.tsx:136-141, 156-159
- **Scenario**: Inside the armed-mode effect, both `onMove` (lines 134-148) and `onContextMenu` (lines 152-161) open with the same three-step sequence: `const chain = buildChain(e.target as Element | null);` → an empty-chain early return / guard (`if (chain.length === 0 || !chain[0])`) → `const di = pickDefaultIndex(chain);`. After that they diverge (`onMove` builds the `HoverState`; `onContextMenu` picks `e.altKey ? chain[0] : chain[di]` and copies).
- **Root cause**: The "turn a hovered/clicked DOM node into `{ chain, defaultIndex }`" operation is the core primitive of the inspector, but it was inlined independently in each handler rather than factored once.
- **Impact**: Two copies of the same target-resolution logic must be kept in sync (e.g., if the empty-chain guard or the `as Element | null` cast ever changes, both must change). Low risk today, but it is the most-likely-to-drift logic in the file.
- **Fix sketch**: Extract a local helper inside the effect (or a module function in `devLocate.ts`), e.g. `function resolveAt(target: EventTarget | null): { chain: LocEntry[]; di: number } | null` that runs `buildChain`, returns `null` when the chain is empty, and otherwise returns `{ chain, di: pickDefaultIndex(chain) }`. Both handlers then become `const r = resolveAt(e.target); if (!r) { ... }` and use `r.chain` / `r.di`. Behavior-preserving.

## 2. `parseLoc` and `splitLoc` are exported but only used inside their own module
- **Severity**: Low
- **Category**: dead-code
- **File**: src/app/_dev-inspector/devLocate.ts:40 (`parseLoc`); src/app/_dev-inspector/devInspectorUi.tsx:20 (`splitLoc`)
- **Scenario**: `parseLoc` is `export`ed but its only caller is `buildChain` in the same file (devLocate.ts:54). `splitLoc` is `export`ed but its only callers are `SourceLabel` (devInspectorUi.tsx:57) and `CrumbRow` (line 93), both in the same file. A repo-wide grep for `parseLoc`/`splitLoc` (excluding `node_modules` and prior harness docs) returns only these two source files — no external imports, and there are no test files in this context (`**/_dev-inspector/**/*.test.*` → none).
- **Root cause**: Pure helpers exported "just in case" / for symmetry with the genuinely-shared exports (`buildChain`, `isLibraryPath`), but nothing ever consumed them across module boundaries and no unit tests were added.
- **Impact**: Over-exposed surface — the `export` keyword implies an inter-module contract that does not exist, so a reader can't tell these are private implementation details. No bundle cost (dev-only module), purely clarity.
- **Fix sketch**: Drop the `export` on both (make them module-private `function parseLoc(...)` / `function splitLoc(...)`). If unit tests are intended for these pure functions, keep the export but add the test that justifies it; otherwise privatize. Behavior-preserving.

## 3. Inconsistent terminology for the `data-loc` stamping mechanism across docstrings
- **Severity**: Low
- **Category**: cleanup
- **File**: src/app/_dev-inspector/DevInspector.tsx:7-8; src/app/_dev-inspector/devLocate.ts:4-5
- **Scenario**: Three in-scope/adjacent descriptions name the same mechanism differently. `DevInspector.tsx:7-8` says the "**Turbopack loader** stamps host elements with `data-loc`"; `devLocate.ts:4-5` says the "`inject-source-loc` **Babel pass** stamps host elements"; the README (line 57-58) calls it a "gated **Turbopack loader** ... stamps host JSX". The actual implementation is a Turbopack loader (`source-loc-loader.cjs`) that invokes a Babel plugin (`inject-source-loc.cjs`), so each description is partially right but they don't agree.
- **Root cause**: Docstrings written at different times as the build wiring evolved; never reconciled to a single phrasing.
- **Impact**: Confusion for the next reader trying to locate the stamping code — "Babel pass" vs "Turbopack loader" sound like two different systems. Doc-only, no runtime effect.
- **Fix sketch**: Standardize on one phrasing in both files, e.g. "a Turbopack loader (`scripts/dev-inspector/source-loc-loader.cjs`) that runs the `inject-source-loc` Babel plugin stamps host elements with `data-loc` only when `DEV_INSPECT=1`." Pure comment edit.

## 4. Redundant `chain.length === 0` half of the empty-chain guard
- **Severity**: Low
- **Category**: cleanup
- **File**: src/app/_dev-inspector/DevInspector.tsx:137, 157
- **Scenario**: Both handlers guard with `if (chain.length === 0 || !chain[0])`. With `noUncheckedIndexedAccess` on, `!chain[0]` is the load-bearing check (it both detects emptiness and narrows `chain[0]` to a defined `LocEntry` for TS). When `chain` is empty, `chain[0]` is `undefined`, so `!chain[0]` is already `true` — the `chain.length === 0 ||` prefix can never change the outcome.
- **Root cause**: Belt-and-suspenders guard; the `length` check was likely written first and the `!chain[0]` narrowing added later (to satisfy `noUncheckedIndexedAccess`), leaving the now-subsumed `length` test in place.
- **Impact**: Negligible — a redundant sub-expression duplicated in two spots. Very minor reading overhead. (If consolidating per finding #1, this collapses naturally into the shared helper's single guard.)
- **Fix sketch**: Reduce each guard to `if (!chain[0]) { ... }` (or fold into the `resolveAt` helper from finding #1). Behavior- and type-preserving.
