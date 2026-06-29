# Scan Pipeline & Ingestion — Bug + UI Scan
> Context: Scan Pipeline & Ingestion (Repository Scanning & Scoring)
> Total: 5 findings (0 critical, 1 high, 2 medium, 2 low)

Note: `src/components/landing/ScanGallery.tsx` is listed in the dispatch but does not exist on disk (context-map drift — consistent with the prior ascent context-map staleness notes). All other in-scope files were read in full, plus the supporting `scan-finalize.ts` and `sse-server.ts`. This context is exceptionally well-audited already (dense invariant comments, money/cache tests), so most surviving issues are subtle.

## 1. `peek` path is unauthenticated AND unthrottled — GitHub-PAT + DB amplification
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: edge-case / cost-abuse (DoS)
- **File**: src/app/api/scan/route.ts:74-96 (peek block) and 114-119 (rate-limit placement); reached via GET at 306-320
- **Value**: impact 7 · effort 3 · risk 3
- **Scenario**: An attacker loops `GET /api/scan?url=<distinct-repo>&peek=1&latest=1` with thousands of distinct, never-before-seen `owner/repo` values. Each request: `resolveScanAuth` → `lookupCachedScan` (which does `getHeadHint` DB read + a real, non-304 GitHub `resolveHead` against the operator's `GITHUB_TOKEN` because there's no cached ETag for a brand-new repo) → with `latest=1`, an additional `getScanReportByCommit` DB read — then returns 204. The peek block returns BEFORE both `authGateEnabled()` (line 101) and `rateLimitRequest()` (line 114), so none of this is rate-limited or sign-in-gated.
- **Root cause**: The design intentionally keeps "cheap hydration paths unthrottled" and places rate-limiting only on "the expensive path." But peek-with-fresh-repo is not actually cheap: it spends the operator's shared GitHub REST budget (1 real head per uncached repo) and 1-2 DB reads, with zero per-IP cap.
- **Impact**: Operator's server GitHub rate limit can be exhausted by an anonymous client (degrading every real scan and badge to neutral), plus unbounded DB read load — a no-cost-to-attacker amplification/DoS.
- **Fix sketch**: Apply a lightweight per-IP rate limit to the peek path too (cheaper budget than the full scan limiter, but non-zero), or only spend a real (non-conditional) GitHub head on the peek path when a prior ETag hint exists, returning 204 immediately otherwise.

## 2. Scan-completion email can be dispatched to an arbitrary, unverified recipient
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure / abuse vector (email amplification)
- **File**: src/app/api/scan/stream/route.ts:81-83 (notifyTo resolution), 197-201 (dispatch)
- **Value**: impact 5 · effort 3 · risk 3
- **Scenario**: `notifyTo = body.notify ? viewer?.email ?? (isValidEmail(body.email) ? body.email.trim() : undefined) : undefined`. The `body.email` branch is taken whenever `viewer?.email` is falsy — which includes `viewer === null`. In a deploy with the auth gate OFF (local/demo/self-host where `authGateEnabled()` is false), an unauthenticated POST with `notify:true` and `email:<victim>` makes Ascent send a real completion email to any address. Even in production (gate on, viewer required), a signed-in account with no email can direct the email to any unverified address.
- **Root cause**: The comment promises "custom address ONLY when the account has none," but the code enforces only "when `viewer.email` is falsy," conflating "account has no email" with "no viewer at all," and never verifies recipient ownership.
- **Impact**: Unsolicited email / spam amplification from the product's sending domain (SES reputation risk); arbitrary-recipient send.
- **Fix sketch**: Require a non-null signed-in viewer for any notify send, and only honor `body.email` when `viewer` exists with no `viewer.email`; ideally confirm via a verified-email flow rather than trusting a format-only `isValidEmail`.

## 3. "Email me when it's done" opt-in is silently dropped when a chip is clicked
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: state-corruption / broken-affordance
- **File**: src/components/ScanForm.tsx:240-268 (chip onClick) vs 110-140 (submit notify logic)
- **Value**: impact 5 · effort 3 · risk 2
- **Scenario**: A signed-in user toggles the NotifyToggle on, then clicks one of the "Top scored:" chips to scan that repo. The chip handler navigates with `router.push(\`/report?repo=${encodeURIComponent(ex)}\`)` — it never appends `&notify=1` and never writes `ascent:notify-email`. The user's explicit "email me" opt-in is silently discarded; they wait for an email that never arrives. Only the typed-input submit path honors notify.
- **Root cause**: Two divergent navigation paths (`submit()` vs the chip onClick) that should share the same notify-aware URL builder, but the chip path was written as a minimal `setValue + push`.
- **Impact**: Broken promise to the user (no notification); inconsistent behavior between two visually equivalent "start a scan" actions.
- **Fix sketch**: Extract the notify-QS + sessionStorage logic from `submit()` into a `buildReportHref(repo)` helper and call it from both the form submit and the chip onClick (or have the chip just `setValue(ex)` then call `submit()`).

## 4. `parseSSE` joins multi-line `data:` fields without the spec-required newline
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case / silent-failure
- **File**: src/lib/sse.ts:16-19 (`dataStr += line.slice(5).trim()`)
- **Value**: impact 3 · effort 2 · risk 2
- **Scenario**: The SSE spec says consecutive `data:` lines in one frame are concatenated with `\n`. Here they are concatenated with no separator and each line is `.trim()`-ed. Today's producer (`makeSseSend`) emits single-line `JSON.stringify` payloads, so it works — but if any payload ever contains a newline (e.g. a multi-line message field, or a future producer that pretty-prints/chunks data across lines), the lines fuse into invalid JSON, `JSON.parse` throws, `data` becomes `null`, and `readSSE` drops the frame as if it were a keepalive — a result/progress event vanishes silently.
- **Root cause**: A simplified parser that assumes one `data:` line per frame, encoded as a latent coupling to the current producer rather than to the wire format.
- **Impact**: Latent; a silently-dropped SSE frame (e.g. a `result`) would hang a consumer with no error.
- **Fix sketch**: Accumulate data lines into an array and `join("\n")`; only `.trim()` the final assembled string (and only strip a single leading space per line per the spec) before `JSON.parse`.

## 5. `cacheSet` does not refresh LRU recency on an existing key, and can evict on no-growth updates
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/lib/cache.ts:74-80
- **Value**: impact 2 · effort 2 · risk 1
- **Scenario**: `cacheSet` does `store.set(key, …)` directly. For an existing key a `Map` keeps the original insertion position, so re-caching a hot commit (e.g. a `fresh=1` re-test of an unchanged sha) does NOT move it to the MRU tail — it can be evicted before colder entries. Separately, the `store.size >= MAX_ENTRIES` check runs even when the key already exists (an overwrite that won't grow the map), so it can needlessly drop a valid cached scan. This is inconsistent with `headHintSet` (which correctly does delete-then-set) and with `cacheGet` (which refreshes recency).
- **Root cause**: LRU-refresh logic was applied to the read path and the hint store but not to `cacheSet`'s write path.
- **Impact**: Slightly higher cache churn / a marginally lower hit rate under pressure; no correctness loss.
- **Fix sketch**: Mirror `headHintSet`: `store.delete(key)` first, then evict-oldest only if still at capacity, then `store.set`.
