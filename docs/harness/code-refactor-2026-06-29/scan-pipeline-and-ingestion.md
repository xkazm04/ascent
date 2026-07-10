# Code Refactor — Scan Pipeline & Ingestion
> Total: 5 | Critical: 0 High: 1 Medium: 4 Low: 0

## 1. SSE frame parsing is implemented three times, and the copies have diverged
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/sse.ts:13-51 · src/components/report/ReportClientStatus.tsx:24-43 · src/components/report/useReportScan.ts:188-229
- **Scenario**: There are three independent SSE consumers for the same wire format. `src/lib/sse.ts` exports `parseSSE` (frame → `{event, data}`) and `readSSE` (the reader/decoder/`\n\n`-split drain loop), used by the org/launch surfaces (OrgScanButton, LiveWarRoom, FleetMap, RepoRescanButton, SegmentActions, importScan). The `/api/scan/stream` consumer instead uses a SECOND, separately-maintained `parseSSE` exported from `ReportClientStatus.tsx` plus a hand-rolled drain loop inlined in `useReportScan.ts` (its own `getReader()`/`TextDecoder`/`FRAME` regex). `src/components/report/parseSSE.test.ts:5` even documents the split: "`parseSSE` here is NOT the same function as `src/lib/sse.ts` `parseSSE`."
- **Root cause**: The report shell grew its own SSE handling rather than reusing the library helper; nobody reconciled them afterward. The two parsers are now subtly different — `ReportClientStatus.parseSSE` joins multiple `data:` lines with `"\n"` and strips trailing `\r` (correct per spec), whereas `sse.ts:parseSSE` concatenates `data:` lines with bare `.trim()` (corrupts multi-line / pretty-printed JSON payloads). The drain loops likewise differ (`indexOf("\n\n")` vs a `\r?\n\r?\n` regex).
- **Impact**: Three places to fix any SSE bug; a correctness fix already landed in one copy but not the others, so the "shared" lib version is now the buggier one. New SSE consumers may pick the wrong/weaker parser. Extra bundle weight from duplicated logic.
- **Fix sketch**: Promote the more-correct `ReportClientStatus.parseSSE` semantics into `src/lib/sse.ts` (multi-line `data:` join + CRLF tolerance), then have `useReportScan.ts` consume `readSSE`/`parseSSE` from `@/lib/sse` and delete the local `parseSSE` + inline drain loop. Keep `parseSSE.test.ts` pointed at the single surviving implementation (merge any unique cases into `sse.test.ts`).

## 2. The pre-scan gate sequence is duplicated across /api/scan and /api/scan/stream
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/scan/route.ts:41-120 · src/app/api/scan/stream/route.ts:37-74
- **Scenario**: Both scan entry points run the same front-half pipeline before scanning: rate-limit (`rateLimitRequest(request, SCAN_RATE_LIMIT)` → `recordQuotaEvent("rate_limit","scan")` → `tooManyRequests`), `resolveScanAuth`, the private-scan login wall (`if (orgSlug !== "public" && authGateEnabled() && !(await getViewer())) → 401 "Sign in to run a private scan."`), and `consumeScanQuota(...)`. The rate-limit block (incl. its `// QUOTA #2 …` comment) and the auth-gate 401 block are byte-for-byte identical in both files.
- **Root cause**: The post-scan half (`consumeScanQuota`, `classifyScanResult`, `cacheAndPersistScan`) was already extracted into `src/lib/scan-finalize.ts`, but the symmetric pre-scan gate sequence was left inlined in both routes.
- **Impact**: A change to the rate-limit policy, the 401 copy, or the auth-gate condition must be made in two places and kept aligned, or one route silently drifts from the other (exactly the failure mode `scan-finalize.ts` was created to prevent). The route tests exist partly to catch this drift.
- **Fix sketch**: Add a `gateScanRequest(request, { mock })` (or similar) helper to `scan-finalize.ts` that returns `{ blocked?: Response, token, orgSlug, quota }` by running rate-limit → `resolveScanAuth` → auth-gate → `consumeScanQuota` in order; each route calls it and either returns `blocked` (JSON route) / sends it before opening the stream, or proceeds. Keeps each route's distinct surfacing (JSON vs SSE) but unifies the gate logic.

## 3. `scanRepository` is a ~300-line function mixing six distinct phases
- **Severity**: Medium
- **Category**: structure
- **File**: src/lib/scan.ts:116-412
- **Scenario**: `scanRepository` is one ~296-line function that does provider selection + progress decoration, token/auth resolution, parallel ingestion (PR/governance/activity), deterministic signal + stack/tech extraction, score-input assembly, the full LLM resilience plan (primary → retry → failover → mock degrade with a wall-clock budget controller, lines 235-329), report assembly + eval-log capture, and warnings assembly (lines 374-408).
- **Root cause**: The function accreted features (BYOM org provider, retry/failover, budget deadline, eval-log, passport, stack-fit caveats) over time without ever being decomposed; each addition was inlined.
- **Impact**: High cognitive load to read or modify; the resilience state machine (plan array, deadline `AbortController`, `attemptAssess`, captured-usage commit-on-success) is hard to test in isolation because it's tangled into the orchestrator; reviewers must hold the whole function in their head to verify any one phase.
- **Fix sketch**: Extract the self-contained sub-phases into named helpers in `src/lib/scan.ts` (or a sibling): `assessWithResilience(provider, scoreInput, signals, { byom, signal, emit }) → { assessment, usedProvider, capturedUsage, llmFailed }` for lines 234-329, and `buildScanWarnings(...) → string[]` for lines 374-408. `scanRepository` then reads as a linear sequence of phase calls.

## 4. Two near-identical TTL + capped-LRU Map caches hand-rolled in cache.ts
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/cache.ts:12-91 · src/lib/cache.ts:184-218
- **Scenario**: `cache.ts` defines two in-memory caches with the same shape: the scan-report cache (`store` + `cacheGet`/`cacheSet`/`cacheDelete`, `TTL_MS`/`MAX_ENTRIES`) and the head-hint cache (`hintStore` + `headHintGet`/`headHintSet`, `HINT_TTL_MS`/`HINT_MAX`). Both are `Map<string, {…, expires}>` with TTL-expiry-on-read, an evict-oldest-on-cap rule, and delete-then-set LRU recency — the same ~15-line pattern written twice.
- **Root cause**: The head-hint cache was added later as a second bespoke `Map` instead of reusing/generalizing the existing scan-cache machinery, so the eviction/TTL/recency logic was copied.
- **Impact**: Maintenance cost and a real consistency trap — the two copies have already drifted (`cacheGet` refreshes LRU recency on read; `headHintGet` does not, despite its comment claiming "the cap evicts the oldest hint LRU-style"). A fix to TTL/eviction behavior must be applied in both.
- **Fix sketch**: Introduce a small generic `TtlLruCache<V>(ttlMs, max)` with `get/set/delete` encapsulating the expiry + cap + recency logic, and back both `store` and `hintStore` with instances of it. The public functions (`cacheGet`, `headHintSet`, etc.) become thin key-building wrappers, removing the duplicated bodies.

## 5. "Serve the latest persisted public report" block duplicated within the JSON scan route
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/scan/route.ts:87-92 · src/app/api/scan/route.ts:186-193
- **Scenario**: The any-commit salvage logic appears twice in `runScan`: once in the `peek&latest` path (lines 87-92) and again in the error-fallback path (lines 186-193). Both do the same thing — `getScanReportByCommit(parsed.owner, parsed.repo, {}).catch(() => null)`, then `if (last && !last.repo.isPrivate) return NextResponse.json(last, { …stale headers })` — gated on the same "anonymous, parseable, public" conditions, with the same `!isPrivate` defense-in-depth comment repeated.
- **Root cause**: The error-fallback salvage was added by copying the peek&latest salvage; only the response headers differ (`x-ascent-stale` vs `+ x-ascent-fallback: "error"`).
- **Impact**: The private-report guard (`!last.repo.isPrivate`) — a security-relevant invariant on the shared public store — lives in two spots; a future tightening could be applied to one and missed in the other. Duplicated DB read + guard logic.
- **Fix sketch**: Extract `serveLatestPersisted(parsed, extraHeaders): Promise<NextResponse | null>` that performs the lookup + `!isPrivate` guard + JSON response, returning null when there's nothing safe to serve. Both call sites become a single `const salvaged = await serveLatestPersisted(...); if (salvaged) return salvaged;`, with each passing its own header set.
