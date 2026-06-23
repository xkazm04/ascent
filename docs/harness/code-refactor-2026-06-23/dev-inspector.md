# Code Refactor — Dev Inspector
> Context group: Onboarding, Shell & AI Standard
> Total: 4 findings (Critical: 0, High: 0, Medium: 2, Low: 2)

This is a small, well-factored context: the component owns state/wiring (`DevInspector.tsx`), the chrome is pure presentation (`devInspectorUi.tsx`), and the DOM/path logic is pure helpers (`devLocate.ts`). Every exported symbol is referenced (`buildChain`, `dedupeChain`, `pickDefaultIndex`, `isLibraryPath`, `splitLoc`, `LocEntry`, `HighlightBox`, `InspectorHud`, `NavHint`, `SourceLabel`, `Z`, `DevInspector`), and the public entry point is mounted exactly once behind a dev gate (`src/app/layout.tsx:83`). No dead modules, no commented-out blocks, no stray `console.log`, no stale TODOs, no unused imports. The findings below are localized cleanups only.

## 1. `LocEntry.raw` is a write-only (dead) field
- **Severity**: Medium
- **Category**: dead-code
- **File**: src/app/_dev-inspector/devLocate.ts:11-12, 47, 56-57
- **Scenario**: The `raw` member of `LocEntry` (the unparsed `path:LINE:COL` attribute value) is declared on the interface (line 11-12), produced by `parseLoc` (`return { raw, ... }`, line 47), and spread into every entry inside `buildChain` (`out.push({ el, ...parsed })`, line 57). It is never read anywhere — confirmed by grepping `\.raw\b` across `src/app/_dev-inspector/` (no matches) and the wider repo (only the loader's unrelated `lastIndexOf` hit). The consumers (`DevInspector.tsx`, `devInspectorUi.tsx`) use `loc`, `path`, `line`, and `el`, never `raw`.
- **Root cause**: `parseLoc` originally surfaced the raw string for debugging/labelling; the UI later standardized on the trimmed `loc` (`path:line`, no column), leaving `raw` carried along but never consumed.
- **Impact**: Maintenance noise — readers must reason about a field that does nothing, and it implies a contract (raw value is meaningful downstream) that no longer exists. Harmless to behavior but a clean deletion target.
- **Fix sketch**: Drop the `raw` line from the `LocEntry` interface (devLocate.ts:11-12), remove `raw` from the `parseLoc` return object (line 47, so it returns `{ path, line, loc }`), and update the JSDoc on `parseLoc`'s return type if it references the raw value. `buildChain`'s `{ el, ...parsed }` spread needs no change. Behavior-preserving; no callers read the field.

## 2. Blanket `/* eslint-disable */` over a normal presentational file
- **Severity**: Medium
- **Category**: cleanup
- **File**: src/app/_dev-inspector/devInspectorUi.tsx:3
- **Scenario**: The whole file is opted out of linting with a top-of-file `/* eslint-disable */`. Unlike the build-time loader scripts (`scripts/dev-inspector/*.cjs`), which also disable lint but are CommonJS Babel-plugin code with legitimate reasons, this is ordinary TSX (React components, inline-style objects). A blanket disable silences every rule for the file's lifetime, including real future regressions (unused vars, exhaustive-deps if hooks are ever added, a11y rules on the interactive `<button>` in `CrumbRow`).
- **Root cause**: Likely copied alongside the sibling loader files (which share the same `/* eslint-disable */` header) during initial scaffolding of the `_dev-inspector` folder, then never narrowed once the file settled into plain component code.
- **Impact**: Lint blind spot on a file that contains an interactive control and several large inline-style literals; obscures whether the disable is load-bearing or vestigial. Low bug-risk today, but it removes a safety net.
- **Fix sketch**: Remove the line-3 `/* eslint-disable */`. If the linter then flags anything specific (e.g. inline-style or a particular rule), replace the blanket disable with targeted `// eslint-disable-next-line <rule>` comments at the exact offending lines, or a scoped `/* eslint-disable <rule> */` for just the rules that genuinely conflict with the inline-style chrome. Behavior is unaffected (lint comments don't change runtime).

## 3. Redundant `data-devinspector` marker on inner HUD nodes
- **Severity**: Low
- **Category**: cleanup
- **File**: src/app/_dev-inspector/devInspectorUi.tsx:154, 193 (with DevInspector.tsx:199)
- **Scenario**: The armed-mode portal wrapper already carries `data-devinspector` (`DevInspector.tsx:199`), and the `insideHud` guard tests `t.closest("[data-devinspector]")` (`DevInspector.tsx:131-132`). Because that wrapper is an ancestor of everything rendered inside it, the duplicate `data-devinspector` on the `InspectorHud` panel (devInspectorUi.tsx:154) and `NavHint` (line 193) is redundant for the hit-test in armed mode. (Note `NavHint` is also rendered in nav-mode under a wrapper that is NOT marked, so its attribute is the only marker there — keep that one.)
- **Root cause**: Defensive marking added per-component before the shared portal wrapper acquired the attribute; the wrapper-level marker later made the `InspectorHud` copy redundant.
- **Impact**: Minor — three places assert the same intent, so a future reader can't tell which marker the `insideHud` logic actually depends on. No runtime cost.
- **Fix sketch**: Optionally remove `data-devinspector` from `InspectorHud`'s panel (devInspectorUi.tsx:154) since its only render path (armed mode) is always inside the marked wrapper. Leave `NavHint`'s marker (line 193) intact — its nav-mode wrapper is unmarked, so it is the load-bearing one. Low priority; only do this if the redundancy is confirmed to bother no one (the safe default is to leave all three as belt-and-suspenders).

## 4. `splitLoc` and the loader share path-tail slicing (do NOT consolidate)
- **Severity**: Low
- **Category**: duplication
- **File**: src/app/_dev-inspector/devInspectorUi.tsx:22-27 (vs scripts/dev-inspector/source-loc-loader.cjs:34)
- **Scenario**: `splitLoc` derives a filename via `loc.lastIndexOf("/")`; the build loader independently does `resourcePath.slice(resourcePath.lastIndexOf("/") + 1)` to get a base name. Surface-level the slicing looks duplicable into a shared helper.
- **Root cause**: Both layers need a "last path segment" operation, arrived at independently.
- **Impact**: Negligible. Listed only for completeness so a future scan doesn't re-raise it.
- **Fix sketch**: **Leave as-is.** These live in different execution layers — one is a CommonJS build-time webpack/Turbopack loader (`.cjs`, runs in Node during compilation), the other is a runtime React/TS module shipped to the browser. They are one trivial line each, differ in intent (dir-split that returns both halves vs base-name extraction), and sharing code across the build/runtime boundary would add an awkward cross-layer import for no real benefit. Not actionable; no change recommended.
