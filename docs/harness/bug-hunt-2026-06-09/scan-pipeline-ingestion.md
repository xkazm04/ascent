# Bug Hunter Scan — Scan Pipeline & Ingestion (ascent)

> Total: 8 findings (Critical: 0 | High: 3 | Medium: 4 | Low: 1)

## 1. No in-flight de-duplication: concurrent scans of the same uncached commit each run a full LLM scan
- **Severity**: High
- **Category**: race-window
- **File**: src/app/api/scan/stream/route.ts:85 (and src/app/api/scan/route.ts:50)
- **Scenario**: If two users (or one user's double-mount / two browser tabs / a peek-miss followed immediately by the streaming scan) request `owner/repo@headSha` while no cache entry exists yet, then both miss `lookupCachedScan`, both run the entire `scanRepository` (GitHub ingest + governance + PR GraphQL + an LLM completion), and both `cacheSet` at the end. The cache is only populated *after* the expensive work finishes, so it never coalesces concurrent work.
- **Root cause**: The cache is a write-after-completion read-through with no "in-flight promise" map. The design assumes the first request finishes and warms the cache before the second arrives, but the LLM leg takes tens of seconds — exactly the window where duplicates pile up. React StrictMode double-mount and the documented peek→stream handoff make same-commit concurrency the common case, not the rare one.
- **Impact**: Duplicate LLM spend (real $) and duplicate GitHub rate-limit burn per commit; the global per-instance rate limiter is the only backstop, and it throttles *legitimate distinct* scans rather than collapsing the redundant ones. Also risks two near-simultaneous DB persists of the same commit racing the dedup path.
- **Fix sketch**: Keep an `inFlight = Map<cacheKey, Promise<ScanReport>>`. On a miss, register the promise before awaiting `scanRepository`; later callers for the same key `await` the existing promise instead of launching their own. Clear the entry in a `finally`.

## 2. SSE keepalive interval can outlive a synchronously-thrown start(), firing forever on a dead controller
- **Severity**: Medium
- **Category**: sse-lifecycle
- **File**: src/app/api/scan/stream/route.ts:62
- **Scenario**: `heartbeat` is created inside `start()` *before* the `try`. If anything between the `setInterval` call and entering the `try` body throws synchronously (or a future edit adds an `await` that rejects before the try), the `finally` that clears the interval is never reached, and `cancel()` only runs on client teardown — so a 15 s `setInterval` keeps calling `controller.enqueue` on a controller whose `start()` already rejected. Currently the only statements before `try` are the assignment itself, so the window is narrow, but the heartbeat is intentionally hoisted *outside* the try while its only cleanup paths are *inside* it (`finally`) or in `cancel()`.
- **Root cause**: The timer's lifetime is wider than the `try/finally` that owns its teardown. Cleanup is duplicated across `finally` and `cancel()` but there is no single guarantee that *creation implies cleanup*.
- **Impact**: Leaked interval / wasted CPU enqueuing onto a closed controller; on a long-lived warm instance, leaked timers accumulate (memory/CPU creep).
- **Fix sketch**: Create the interval as the first statement inside `try`, or wrap the whole body so a single `finally` always clears it. Guard the heartbeat callback to also `clearInterval(heartbeat)` itself the first time `enqueue` throws (the `catch` currently swallows the throw but lets the timer keep firing).

## 3. Heartbeat keeps firing after the terminal `result`/`error` frame until the controller closes
- **Severity**: Low
- **Category**: sse-lifecycle
- **File**: src/app/api/scan/stream/route.ts:134-145
- **Scenario**: After `send("result", report)` (or `send("error", …)`), control falls to `finally`, which clears the heartbeat and closes the controller. Between the result frame and the `clearInterval` there is no `await`, so in practice the gap is tiny — but the heartbeat is never stopped at the *logical* end of work (it relies on the synchronous fall-through to `finally`). If a future change inserts an `await` (e.g. an async post-result hook) between the result send and `finally`, a `: ping` comment could be enqueued *after* the `result` event, and a stricter SSE consumer that stops reading on `result` would have already torn down — enqueue then throws into the swallowing `catch`.
- **Root cause**: Terminal-frame emission and heartbeat shutdown are not co-located; the invariant "no frames after the terminal event" is enforced only by current statement ordering.
- **Impact**: Benign today; latent ordering bug if the post-result path grows an await. Minor wasted enqueue.
- **Fix sketch**: Clear `heartbeat` immediately after sending the terminal `result`/`error` frame (before any further await), in addition to the `finally`.

## 4. `parseRepoUrl` accepts a 2-segment path from a non-GitHub host, ingesting the wrong/non-existent repo
- **Severity**: Medium
- **Category**: edge-case
- **File**: src/lib/github/source.ts:79-95
- **Scenario**: If a user pastes `https://bitbucket.org/owner/repo` (or any `host/owner/repo` whose host the URL parser accepts but the GitHub-host check rejects), the GitHub-host branch is skipped, then the bare-`owner/repo` fallback splits the *full* string. For `bitbucket.org/owner/repo` (no scheme) `parts[0]="bitbucket.org"` contains `.` → correctly rejected. But for an input like `gitlab/owner` (a bare two-token value with no dot in token 0, e.g. `myhost/myrepo` typed without a TLD), the fallback yields `owner=myhost, repo=myrepo` and the scanner blindly hits `api.github.com/repos/myhost/myrepo`. The function name/intent is "GitHub repo", yet any dot-less `a/b` is accepted as a GitHub coordinate regardless of the user's actual intent.
- **Root cause**: The "not a github host" branch leaves a comment but doesn't `return null`; it falls through to a permissive bare parser whose only host guard is "first segment must not contain a dot." A non-GitHub URL that survives the dot check is silently reinterpreted as `owner/repo`.
- **Impact**: Wrong report (scans a same-named GitHub repo the user never asked for) or a confusing `NOT_FOUND` for a repo the user clearly addressed elsewhere. Note this differs from the client's `normalizeRepo`, so the two parsers disagree on edge inputs.
- **Fix sketch**: When a parseable URL has a non-GitHub host, `return null` instead of falling through. Only apply the bare `owner/repo` fallback when the input had *no* scheme and *no* host-looking first segment.

## 5. `coverage`-based cache skip uses a different field than the warning, so silently-degraded reports still get cached and served
- **Severity**: High
- **Category**: cache-staleness
- **File**: src/app/api/scan/stream/route.ts:116 (and src/app/api/scan/route.ts:110)
- **Scenario**: The routes skip caching when `report.confidence < 0.5`, intending to avoid pinning a transient low-coverage snapshot under the commit key. But `scan.ts` derives coverage from `snapshot.coverage` (an *ingestion* estimate computed by `estimateCoverage`), while the skip reads `report.confidence` (a separate post-scoring number). When per-file raw-host fetches transiently fail, `estimateCoverage` for a *small* repo still returns 0.95 (the `totalBlobs <= MAX_FILES` branch ignores how many files actually came back), and `confidence` can stay ≥ 0.5. So a scan that fetched 2 of 20 key files (raw host hiccup) is cached and served to every later scanner of that commit for the full 15-min TTL.
- **Root cause**: The "don't cache a degraded scan" guard keys off `report.confidence`, but the actual coverage degradation lives in `snapshot.coverage`, and for small repos `estimateCoverage` hard-codes 0.95 regardless of fetch failures (`totalBlobs <= MAX_FILES ? 0.95`). The two signals are not wired to the same threshold.
- **Impact**: Wrong report served from cache — a low-evidence scan caused by a transient raw-host blip becomes the cached truth for the commit, undermining the freshness/accuracy promise. The `confidence < 0.5` guard gives false confidence that this can't happen.
- **Fix sketch**: Gate the cache skip on `snapshot.coverage` (thread it onto the report) OR make `estimateCoverage` account for actual files-fetched vs files-picked even in the small-repo branch (e.g. drop below 0.5 when fetched ≪ picked). Surface a single coverage number both the warning and the cache guard read.

## 6. Stream route maps client-disconnect / timeout aborts to a generic "Unexpected error" SSE frame
- **Severity**: Medium
- **Category**: silent-failure
- **File**: src/app/api/scan/stream/route.ts:135-140
- **Scenario**: If the scan aborts via `request.signal` (the client's 180 s timeout fires, or a proxy resets the connection while the browser is still listening), `scanRepository` throws an `AbortError`. The catch only special-cases `GitHubError`; an `AbortError` falls into the `else` and emits `event: error` with `"Unexpected error while scanning the repository."`. The JSON route (route.ts:178) correctly distinguishes `AbortError` → 499; the stream route does not.
- **Root cause**: The stream's error handler has no `AbortError` branch. It assumes any non-`GitHubError` is a genuine failure, but an abort is an expected control-flow signal — and a *timeout* abort (vs. unmount) leaves a client still attached to receive the misleading frame.
- **Impact**: On a timeout the user sees "Unexpected error" instead of the accurate "scan timed out — try a smaller repo" the client is wired to show; on a benign mid-stream reset the connection that *is* still open gets a scary generic error. Muddies monitoring (real bugs and routine aborts share one message).
- **Fix sketch**: In the catch, if `err.name === "AbortError"` (or `signal.aborted`), skip sending an `error` frame entirely (the client is gone or will surface its own timeout copy) — just clear the heartbeat and close. Reserve the generic error frame for genuine, non-abort failures.

## 7. `fetchCommitActivity` 202-retry backoff ignores the abort signal during `setTimeout`, holding the connection open after disconnect
- **Severity**: Medium
- **Category**: race-window
- **File**: src/lib/github/governance.ts:111-122
- **Scenario**: If GitHub returns 202 (stats still computing) and the client disconnects during one of the `await new Promise(r => setTimeout(r, DELAYS_MS[attempt]))` sleeps (up to 3 s each, ~6.2 s total), the abort is only checked at the *top* of the loop. The in-progress sleep is not signal-aware, so the function keeps waiting out the backoff before noticing `signal.aborted` on the next iteration. Meanwhile `scanRepository` awaits `activityPromise` at compose time (scan.ts:283), so an abandoned scan still burns up to several seconds of function-duration budget on a sparkline nobody will see.
- **Root cause**: The sleep is a bare `setTimeout` Promise that doesn't reject on abort; only the loop guard and the `getJson` fetch honor the signal, leaving the backoff delay as a blind spot.
- **Impact**: Wasted function duration / slower teardown of aborted scans; on serverless this is billable wall-clock for work that's already orphaned.
- **Fix sketch**: Make the backoff abortable — race the `setTimeout` against the signal (`AbortSignal` `abort` event rejecting the sleep), or check `signal.aborted` and bail before sleeping, the way the file's loop already does at the top but not around the delay.

## 8. Optimistic byte-budget reservation can wedge the whole budget if many fetches fail concurrently, under-reading large repos
- **Severity**: Medium
- **Category**: edge-case
- **File**: src/lib/github/source.ts:407-444
- **Scenario**: Each of the 8 concurrent workers optimistically reserves the full `MAX_FILE_BYTES` (14 KB) *before* awaiting its fetch, and only reconciles after the fetch resolves. With `MAX_TOTAL_BYTES`=180 KB, up to 8 in-flight reservations (~112 KB) can be outstanding at once. If those fetches are slow and *later* ones see `totalBytes >= MAX_TOTAL_BYTES` from the inflated optimistic claims, they `return` early *before* the slow fetches reconcile their (much smaller) real sizes back down. On a repo of many tiny config files, the budget is transiently exhausted by optimistic claims and real high-signal files get skipped even though actual bytes used is far under budget.
- **Root cause**: The reservation is worst-case-pessimistic (always 14 KB) while the early-exit guard reads the *reserved* total, not the *reconciled* total. The check-then-act race was fixed for over-counting, but the fix can now *under*-fetch: optimistic reservations block admission of files that would have fit.
- **Impact**: Lower coverage / missed signal files on larger repos than necessary → weaker (but silently plausible) scores; interacts with finding #5 (a degraded-coverage scan can still be cached).
- **Fix sketch**: Reserve a smaller, size-aware amount (e.g. min(file.size, MAX_FILE_BYTES) when the tree provides `size`), or admit based on reconciled bytes by reconciling *before* deciding to skip later files. Alternatively gate admission on a count cap (already `MAX_FILES`) and only enforce the byte cap on reconciled totals.
