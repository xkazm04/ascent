# Code Refactor — Scan Pipeline & Ingestion
> Context group: Repository Scanning & Scoring
> Total: 3 findings (Critical: 0, High: 2, Medium: 0, Low: 1)

## 1. Dead landing component `ScanGallery.tsx` (no importers)
- **Severity**: High
- **Category**: dead-code
- **File**: src/components/landing/ScanGallery.tsx:1-130
- **Scenario**: The entire file exports a `ScanGallery` server component (plus the local `RailCard`, `LeaderRow`, `levelClasses`, `levelGlyph` helpers) for the landing-page "recently scanned" rail + "most AI-native" leaderboard. Nothing renders it. The landing page (`src/app/page.tsx`) renders `IndexLanding`, and the live gallery is drawn by a separate, in-use component, `src/components/landing/prototypes/index/IndexGallery.tsx`. A repo-wide grep for `ScanGallery` / `<ScanGallery` / `RailCard` / `LeaderRow` finds only this file itself — every other hit is the unrelated *type* `PublicScanGallery` (from `@/lib/db`), not this component. There is no barrel/`index.ts` in `src/components/landing/` that could re-export it dynamically.
- **Root cause**: This is an earlier landing-page gallery implementation that was superseded by the `prototypes/` A/B landing system (`IndexLanding` → `IndexGallery`). When the new prototype gallery shipped, the old standalone component was left behind rather than deleted — a classic "replaced but not removed" artifact.
- **Impact**: ~130 lines of unreachable UI that still type-checks, lints, and ships in the module graph; it duplicates the leaderboard/level-glyph rendering concepts already owned by `IndexGallery`, so a maintainer editing gallery behavior can mistake it for live code and "fix" the wrong file, and it imports `LEVEL_CLASSES`/`LEVEL_GLYPH`/`scoreHex`/`timeAgo` purely to keep dead code compiling.
- **Fix sketch**: Delete `src/components/landing/ScanGallery.tsx` outright. No callers to update (zero importers). If any of its rail-card styling is still wanted, port it into `IndexGallery` deliberately rather than keeping the whole file alive. Behavior-preserving: removing an unrendered server component changes nothing at runtime.

## 2. Duplicated scan-route orchestration across the JSON and SSE routes
- **Severity**: High
- **Category**: duplication
- **File**: src/app/api/scan/route.ts:99-136,216-260 and src/app/api/scan/stream/route.ts:63-91,170-202
- **Scenario**: `route.ts` (sync JSON) and `stream/route.ts` (SSE) carry near-identical copies of three coupled blocks: (a) the weekly public-quota consume + the `refundQuota` closure (`consumePublicScanQuota` → set `quotaRemaining/quotaResetAt/quotaScope/quotaCharged`; refund via `refundPublicScanQuota(...chargedAt)`), (b) the `degradedToMock = report.engine.provider === "mock" && !mock` and `lowCoverage = report.confidence < 0.5` derivation, and (c) the guard that follows it — `if (lookup && !degradedToMock && !lowCoverage) cacheSet(...)` then the `isDbConfigured() && !degradedToMock && !lowCoverage` persist-with-partial-failure-warning block. The two routes' own tests acknowledge the split: `stream/route.test.ts:2-4` says *"The stream route carries its own copy of the degradedToMock guard, so it gets its own test to keep the two route copies from drifting."*
- **Root cause**: The SSE route was added after the JSON route by copy-adapting its body into a `ReadableStream.start()` (progress events, heartbeat, in-stream refund-on-cached-hit). The shared money/cache/persist invariants rode along as duplicated inline code instead of being lifted into `@/lib/scan` or a small shared helper. `scan.ts` already centralizes the *scan*; the *post-scan caching/persistence/quota policy* never got the same treatment.
- **Impact**: This is a live drift hazard on money-safety and cache-poisoning invariants. The two copies must stay byte-aligned (same low-coverage threshold, same "skip cache + skip persist on degrade" rule, same refund timing) or a fix applied to one route silently regresses the other — exactly the failure the duplicate tests exist to catch. Every future change to quota refund timing or the cache-poisoning guard must be made and re-tested twice.
- **Fix sketch**: Extract the post-scan policy into one helper in `@/lib/scan` (or a new `src/lib/scan-finalize.ts`), e.g. `finalizeScan(report, { lookup, orgSlug, mock, isDbConfigured })` returning `{ cacheable, persistable, degradedToMock, lowCoverage }` (and performing the `cacheSet` + `persistScanReport` with the shared partial-failure `console.warn`). Also lift the public-quota consume/refund into a shared `consumeScanQuota(req, { orgSlug, token, mock })` returning the header fields + a `refund()` thunk. Both routes then call the same helpers; the refund-on-cached-hit nuance unique to the stream stays in the stream (it just calls the shared `refund()`). Behavior-preserving when the extracted code is the exact union of the two current copies; the existing per-route tests then guard the single implementation.

## 3. Inner `runScan` shadows the module-level `runScan` in the JSON route
- **Severity**: Low
- **Category**: cleanup
- **File**: src/app/api/scan/route.ts:32-35,175-181
- **Scenario**: The file defines a top-level `async function runScan(url, opts)` (the request handler body, line 32) and then, inside it, a local `const runScan = (signal?) => scanRepository(...)` (line 175) with the same name. The inner arrow shadows the outer function within its scope.
- **Root cause**: The inner closure was named for what it does (run the actual scan) without noticing the enclosing handler already owns that identifier — an incremental edit that didn't account for the surrounding name.
- **Impact**: Cosmetic but genuinely confusing: a reader scanning for `runScan` sees two unrelated things, and the shadowing defeats any accidental recursive reference. No correctness impact (the inner binding is what's used at the call site on line 187-189). The sibling SSE route names its equivalent closure `runScan` too, but there it does **not** shadow (the handler is `POST`), so only the JSON route has the collision.
- **Fix sketch**: Rename the inner closure to something local and descriptive, e.g. `const doScan = (signal?) => scanRepository(...)`, and update its two references in the `coalesceScan(...)` / direct-call branch (route.ts:187-189). Purely a rename — behavior-preserving.

---

### Notes on candidates deliberately NOT flagged (quality bar: false positives are worse than misses)
- **`STATUS` map (route.ts:24-30)** — looks like it could be replaced by `GitHubError.status`, but that field is **optional** and is unset at several throw sites (e.g. the `INVALID_URL` throw in `scan.ts:120` passes no status). The map supplies the canonical code→HTTP mapping the error itself doesn't always carry, so removing it is **not** behavior-preserving. Kept.
- **Third `parseSSE` copy** — there are three SSE parsers (`src/lib/sse.ts`, `ReportClientStatus.tsx`, and the report-shell test). `sse.ts` (in scope) is genuinely used by FleetMap/LiveWarRoom/OrgScanButton/RepoRescanButton/SegmentActions and is **not** dead; the duplicate parser lives in `ReportClientStatus.tsx`, which is **out of scope** for this context. Not flagged here.
- **`scan-alerts.ts` `checkAndAlertRegression`** — confirmed live (imported by the GitHub App webhook and the cron rescan route). Not dead.
- **`ScanForm.normalizeRepo`** — exported but only consumed inside `ScanForm.tsx`; it is, however, genuinely used (3 call sites) and distinct from the server-side `parseRepoUrl`. Not dead.
