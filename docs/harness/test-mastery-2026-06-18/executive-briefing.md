> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)

# Test Mastery — Executive Briefing

Context idx 22 (`executive-briefing`). The exec view assembles fleet maturity, benchmark, movement and goals into a board-ready narrative with three downstream consumers that MUST agree: the page (`executive/page.tsx`), the "Copy for LLM" markdown (`briefingMarkdown`), and the streamed PDF (`/api/org/briefing/pdf` → `BriefingDocument`). Today the **only** test is `briefing.test.ts`, which exercises a single fully-populated `briefingMarkdown` fixture. The data-assembly core (`buildExecBriefing`), the auth-gated PDF route, and the PDF document are all entirely untested.

Files read (~9): `src/lib/org/briefing.ts`, `src/lib/org/briefing.test.ts`, `src/app/api/org/briefing/pdf/route.ts`, `src/lib/pdf/briefing-document.tsx`, `src/app/org/[slug]/executive/page.tsx`, `src/lib/authz.ts`, `src/lib/maturity/forecast.ts`, `src/lib/window.ts`, `src/lib/db/org-rollup.ts` (shape only).

## 1. Test `buildExecBriefing` — the entire briefing data-assembly is unverified
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/lib/org/briefing.ts:89
- **Scenario**: A refactor to the `priorWindow` math, the `slice`/`sort` selection of strengths/risks, the `null`-rollup short-circuit, or the `Promise.all` fan-in silently changes what leadership reads — wrong period delta, wrong "vs previous period" numbers, a stale/empty briefing rendered as real, or a thrown error from one of five DB calls bubbling to a 500 — and no test catches it. This is the single function that feeds *all three* surfaces (page, LLM brief, PDF), so one regression here is wrong everywhere at once.
- **Root cause**: `buildExecBriefing` has zero tests (`grep` for it across `*.test.ts*` returns nothing). It's `async` over `@/lib/db`, so it was likely skipped as "needs mocking", but its outputs are pure given the five upstream results — it's mockable by stubbing `getOrgRollup`/`getOrgBenchmark`/`getOrgMovers`/`listGoals`. The existing test only covers `briefingMarkdown` (a pure serializer fed a hand-built object), which never exercises the assembly logic.
- **Impact**: The executive/board artifact (and the LLM "next actions" prompt derived from it) can ship silently-wrong fleet maturity, movement, and benchmark numbers — the highest-trust, lowest-scrutiny output in the product. A leader acts on fabricated movement.
- **Fix sketch**: `vi.mock("@/lib/db")` and drive `buildExecBriefing` with stubbed rollup/benchmark/movers/goals. Assert invariants: (a) returns **null** when `rollup` is null OR `rollup.scannedCount === 0`; (b) `periodDelta === rollup.avgOverall - rollup.baseline.avgOverall` when a baseline exists and **null** when `rollup.baseline` is null; (c) `priorPeriod` is null for an all-time window (no `window.start`) and non-null with correct `dOverall = rollup.avgOverall - priorRollup.avgOverall` when the prior window has scans; (d) `priorPeriod.dims` is sorted by `Math.abs(delta)` desc and capped at 6; (e) `coverage = {scanned: rollup.scannedCount, total: rollup.repoCount}`.

## 2. Assert strengths and risks are disjoint — sparse fleets list a dimension as both
- **Severity**: High
- **Category**: edge-case
- **File**: src/lib/org/briefing.ts:172
- **Scenario**: `strengths = dimSorted.slice(0,3)` and `risks = dimSorted.slice(-3).reverse()`. When a freshly-scanned org has **fewer than 6 dimensions** with averages (partial coverage, or a rollup that only populated some of the 9 D-dimensions), the head-3 and tail-3 windows **overlap**: the same dimension is rendered as both a top Strength and a Weakest dimension in the same board deck (and the same is true in the PDF, which mirrors this). No test pins the disjointness invariant or the small-N behavior.
- **Root cause**: The fixture in `briefing.test.ts` supplies a single-element `strengths`/`risks` it built by hand — it never runs the real `slice(0,3)`/`slice(-3)` selection against a realistic 4–5-dimension `dimAverages`, so the overlap is invisible to the suite.
- **Impact**: A self-contradictory executive briefing ("Testing is your top strength" and "Testing is your weakest dimension") destroys credibility of the leadership-facing artifact and any LLM advice that ingests it.
- **Fix sketch**: In the finding-1 harness, feed `dimAverages` of length 5 and assert `new Set(strengths.map(d=>d.dimId))` and `new Set(risks.map(d=>d.dimId))` are **disjoint** (or that the code is changed to dedupe). Also feed length 3 and assert the briefing doesn't repeat the same dim across both lists.

## 3. Test the PDF route's auth gate and render-failure degradation
- **Severity**: High
- **Category**: coverage-gap
- **File**: src/app/api/org/briefing/pdf/route.ts:19
- **Scenario**: The route is the downloadable board artifact and is the one place in this context with a real auth boundary (`requireOrgRead(org)`) and a deliberately-hardened failure ladder. Untested, any of these silently breaks: (a) the `requireOrgRead` gate is removed/reordered → a non-member downloads another tenant's executive briefing (cross-tenant IDOR on the highest-value export); (b) the branded→unbranded `render(...).catch(...)` fallback regresses so a bad `logoUrl` 500s the download instead of degrading; (c) the `safe()` filename sanitizer (`replace(/[^A-Za-z0-9._-]/g,"-")`) stops stripping CR/LF or `"` from a crafted org slug → header injection / broken `Content-Disposition`; (d) the 404-when-no-scans and 503-when-no-DB branches flip.
- **Root cause**: No `route.test.ts` exists for this route (confirmed). The comments at lines 39–53 document each guard as intentional EXEC-5 hardening, but none is regression-protected — exactly the "hardening with no test" pattern that rots.
- **Impact**: A money/leadership export that can leak across tenants or 500 on a benign branding logo, with no alarm. The filename-sanitizer gap is a header-injection vector.
- **Fix sketch**: Add `route.test.ts` mocking `@/lib/authz`, `@/lib/org/briefing`, `@/lib/pdf/briefing-document`, `@/lib/db`. Assert: returns the `requireOrgRead` denial Response verbatim when it's non-null (auth runs **before** any data read); 400 on missing `?org`; 404 when `buildExecBriefing` resolves null; 503 when `!isDbConfigured()`; on a logo that makes the branded render reject, the **unbranded** render is attempted and a 200 PDF still streams; when both renders reject, a clean 500 JSON (not a raw stack); and that a slug like `a"\r\nb/c` yields a `Content-Disposition` filename containing none of `" \r \n /`.

## 4. Cover `briefingMarkdown`'s null/empty branches — only the all-populated path is tested
- **Severity**: Medium
- **Category**: success-theater
- **File**: src/lib/org/briefing.ts:194
- **Scenario**: Every conditional in the serializer — `if (b.benchmark?.percentile != null)`, the cohort guard, `if (b.forecastHeadline)`, `if (b.priorPeriod)`, the `dims.filter(delta !== 0)`, `if (b.goals.length)`, `if (topGainers.length || topRegressions.length)` — guards against rendering garbage (e.g. `undefined`, `null`, or an empty section) into the LLM payload. The test fixture has every field populated, so a regression that prints `benchmark: 0th percentile vs 0 repos`, an empty `## Goals`, or `null` into the brief sails through green.
- **Root cause**: The one near-miss is the explicit "omits period-delta suffix" case; all other branches are tested only in their *present* state. A single maximal fixture gives false confidence that the serializer is "covered."
- **Impact**: The "Copy for LLM" brief (a product contract — pasted straight into Claude Code) can emit malformed/empty sections, producing garbage AI recommendations from a trusted-looking briefing.
- **Fix sketch**: Add cases for a minimal `ExecBriefing` (`benchmark: null`, `priorPeriod: null`, `forecastHeadline: null`, `goals: []`, empty movers). Assert the output contains **no** `## Goals`, `## vs previous period`, `## Movement this period`, or `Trajectory:`/`Benchmark:` lines, and contains no literal `null`/`undefined`/`NaN`. Also assert the trailing `## Ask` block is always present regardless of how sparse the data is.

## 5. Make `buildExecBriefing`'s generated dates deterministic and pin them
- **Severity**: Low
- **Category**: determinism
- **File**: src/lib/org/briefing.ts:99
- **Scenario**: `priorWindow` end uses `(window.end ?? new Date())` and `generatedOn` uses `new Date().toISOString().slice(0,10)`. Both read the wall clock, so the prior-window span and the briefing date are non-deterministic. A test written around them would be flaky at a UTC day-boundary, and the prior-window length can drift by a day across the run.
- **Root cause**: Unlike `forecast.ts` and `window.ts` (which inject `now`/`nowMs` precisely so they stay unit-testable), `buildExecBriefing` reads `Date.now()`/`new Date()` directly, making it harder to test and subtly nondeterministic.
- **Impact**: Minor — flaky tests near midnight and a one-day drift in the "vs previous period" window length; not a correctness emergency, but it blocks clean testing of findings 1–2.
- **Fix sketch**: Either thread an optional `now: Date = new Date()` param into `buildExecBriefing` (mirroring `resolveWindow`), or in the finding-1 tests use `vi.setSystemTime(new Date("2026-06-18T12:00:00Z"))` and assert `generatedOn === "2026-06-18"` and that `priorWindow` length exactly equals the current window length.
