# Code Refactor — Repo Report Shell & Tabs
> Total: 5 | Critical: 0 High: 1 Medium: 2 Low: 2

## 1. SSE consumption fragmented across four implementations; the "shared" lib copy is the inferior one
- **Severity**: High
- **Category**: duplication
- **File**: src/components/report/ReportClientStatus.tsx:24-43 (parseSSE) + src/components/report/useReportScan.ts:188-249 (reader loop + drainFrames + tail flush); cf. src/lib/sse.ts:13-51 and src/components/onboarding/importScan.ts:80-111
- **Scenario**: There are now **two `parseSSE` definitions** and **three reader/drain loops** for the same SSE wire format:
  - `src/lib/sse.ts` — `parseSSE` (concats `data:` lines with `.trim()`) + `readSSE` (splits on `indexOf("\n\n")`). Used by 5 org/launch components.
  - `ReportClientStatus.parseSSE` — joins multi-line `data:` with `\n` and strips CRLF; **strictly more correct** than the lib version (the lib copy corrupts pretty-printed multi-line JSON — the report test file explicitly documents this divergence at parseSSE.test.ts:5-8).
  - `useReportScan` inline drain — its own `reader.read()` loop + `FRAME = /\r?\n\r?\n/` splitter + trailing-frame flush; the most robust of the three.
  - `importScan.ts` — imports the lib `parseSSE` but hand-rolls yet another `indexOf("\n\n")` reader loop for its stall watchdog.
- **Root cause**: The framing/parse logic was re-derived per consumer instead of one parameterizable reader. The best implementation (CRLF tolerance, multi-line data, no-trailing-blank-line flush) ended up in a component (`ReportClientStatus`/`useReportScan`) rather than the shared `lib/sse.ts`, so other callers silently use the weaker parser.
- **Impact**: A wire-format fix must be applied in up to four places; the canonical `lib/sse.ts` quietly mis-parses multi-line frames; two parallel test suites (`parseSSE.test.ts`, `lib/sse.test.ts`) pin contradictory behaviors.
- **Fix sketch**: Promote the report variant's parser + drain loop into `lib/sse.ts` as the single source: make `parseSSE` join `data:` lines with `\n`, accept CRLF, and add a `readSSE` option (or a separate `drainSSE`) that flushes a trailing non-blank-terminated frame. Migrate `useReportScan` and `importScan` to it (keep importScan's `armStall()` via an `onChunk` callback), delete `ReportClientStatus.parseSSE`, and collapse the two test files. **Cross-reference**: this overlaps the Scan Pipeline context's already-flagged "2nd parseSSE / 3rd drain loop" finding — coordinate so it's fixed once, not double-counted.

## 2. Report permalink page re-implements the ReportShell scaffold inline and has already drifted
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/report/[owner]/[repo]/page.tsx:65-87 (cf. src/components/report/ReportShell.tsx:8-18)
- **Scenario**: `ReportShell` exists precisely to be "the one source of truth" for the report page frame — its own doc-comment says "Both pages hand-rolled this identical scaffold inline and could drift on width/padding." Yet the permalink page still hand-rolls `<SiteHeader /> … <main className="mx-auto w-full max-w-5xl px-5 py-10"> … <SiteFooter />` inline instead of using `ReportShell`. The two have **already drifted**: `ReportShell` uses `max-w-6xl` and carries `id="main"` (the skip-link target); the permalink's inline `<main>` uses `max-w-5xl` and omits `id="main"`.
- **Root cause**: `ReportShell` was extracted and adopted by `report/page.tsx` and `trends/page.tsx`, but the permalink route was never migrated — the exact drift the extraction was meant to prevent.
- **Impact**: Frame markup duplicated across routes; inconsistent content width between the live report and its permalink; the permalink loses the accessibility skip-link anchor. Future header/footer/width changes must be made twice.
- **Fix sketch**: Wrap the permalink's body in `<ReportShell>…</ReportShell>` (replacing the inline header/main/footer), accepting the `max-w-6xl`/`id="main"` normalization. The sibling `error.tsx` legitimately keeps its own chrome (a client error boundary can't render the async server `SiteHeader`), so leave it. Minor related cleanup: `trends/page.tsx:22-24` wraps `ReportShell` in a pointless local `Shell` pass-through — inline it.

## 3. ReportView embeds ~75 lines of pure trend/baseline reconciliation in the render body
- **Severity**: Medium
- **Category**: structure
- **File**: src/components/report/ReportView.tsx:84-160
- **Scenario**: `ReportView` computes `sameInstant`, `currentStored`, `baselineScan`, `trendPoints`, `prevPosture`, and `dimSeries` — dense, subtle, side-effect-free history-reconciliation logic (instant tolerance, phantom-duplicate avoidance, gap-not-zero series building) — entirely inline in the component function before the JSX.
- **Root cause**: The sibling module `reportTaxonomy.ts` already establishes the pattern ("Pure decision logic extracted (verbatim) from the report-shell React effects so it can be unit tested without a DOM"), but this equally-pure, equally-tricky block was left in the render path.
- **Impact**: ~75 lines of non-trivial logic can't be unit-tested without rendering React; `ReportView` is harder to scan (logic + layout interleaved); the reconciliation invariants the comments describe go unverified.
- **Fix sketch**: Extract to a pure helper (e.g. `reconcileTrend(report, history)` in `reportTaxonomy.ts` or a new `reportTrend.ts`) returning `{ trendPoints, dimSeries, overallDelta, prevPosture, prevDimScores }`; have `ReportView` call it. Add focused unit tests for the instant-tolerance and current-stored/append branches.

## 4. Duplicated "does the peeked report match the requested repo?" key comparison in useReportScan
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/report/useReportScan.ts:112-116 and 157-160
- **Scenario**: Twice in the same hook the code builds `gotKey = parsed.ok ? \`${parsed.report.repo.owner}/${parsed.report.repo.name}\`.toLowerCase() : ""` and compares it to `repoKey(repo)` — once for the fast-path peek, once for the quota-salvage peek.
- **Root cause**: `repoKey.ts` exports a normalizer for the *input* string but there's no companion that derives the canonical key *from a parsed report*, so the owner/name concat + lowercase + compare was inlined at both call sites.
- **Impact**: Minor — two copies of the same guard can drift (e.g. one gets a trim/normalization the other misses), and the report-side key isn't run through the same canonicalization as `repoKey`.
- **Fix sketch**: Add `reportKey(report)` (or `peekMatches(parsed, repo)`) to `repoKey.ts` and call it at both sites; cover it in `repoKey.test.ts`.

## 5. ReportCards.tsx filename describes neither of its exports
- **Severity**: Low
- **Category**: naming
- **File**: src/components/report/ReportCards.tsx:5-44
- **Scenario**: The file `ReportCards.tsx` exports `LevelLadder` (a horizontal level-progress strip — not a card) and `ListCard` (a strengths/risks list). There is no `ReportCards` symbol, and only `ScoringTab.tsx:12` imports from it.
- **Root cause**: A generic catch-all filename was used for two unrelated small components that later diverged from the "cards" framing.
- **Impact**: Low — the name misleads when navigating (a reader greps "LevelLadder" and lands in a file named for something else); the two components have no real cohesion to justify sharing a module.
- **Fix sketch**: Either rename the file to match its dominant export and split `LevelLadder` into `LevelLadder.tsx` (its single importer makes this cheap), or, if kept together, rename to something honest (e.g. `scoringCards.tsx`) and update the lone import in `ScoringTab.tsx`.
