# Bug Hunter — Scan Pipeline & Ingestion (ascent)

> Total: 7 findings (Critical: 0, High: 3, Medium: 2, Low: 2)
> Files read: 9
> Scope: app shell, /api/scan(+stream), lib/scan, github source/governance, cache

## 1. SSE stream has no `cancel()` handler — disconnect mid-scan leaks the heartbeat and runs to completion
- **Severity**: High
- **Category**: code_quality
- **File**: src/app/api/scan/stream/route.ts:37-58,127-134
- **Scenario**: A client opens the streaming scan, then navigates away (or the tab is closed) while the LLM `assess()` is in flight. The `ReadableStream` is constructed with only a `start()` method — there is **no `cancel(reason)`**. On disconnect the platform calls `cancel()` (not present), so the `start()` closure keeps running: the `setInterval` heartbeat keeps firing `controller.enqueue()` every 15 s on a torn-down controller, and the only thing that clears it is reaching the `finally` block — which only happens once `scanRepository` itself returns or throws. Abort *does* propagate through `request.signal` to the fetches, but mock fallback (`MockProvider.assess` ignores the signal) and the synchronous `assembleReport`/persist legs do not re-check between every step, so the function can keep burning duration + a heartbeat timer after the consumer is gone.
- **Root cause**: Stream cleanup is tied to `scanRepository` completing, not to the stream being cancelled. No `cancel()` method means client teardown has no direct hook to `clearInterval`/close.
- **Impact**: latent (timer leak, wasted function duration/LLM spend on abandoned scans) — silent failure
- **Fix sketch**: Add a `cancel()` method to the `ReadableStream` init that calls `clearInterval(heartbeat)`; hoist `heartbeat` so both `start` and `cancel` can clear it.

## 2. No in-flight de-duplication (singleflight) — cache stampede double-bills concurrent identical scans
- **Severity**: High
- **Category**: functionality
- **File**: src/app/api/scan/route.ts:46-86, src/app/api/scan/stream/route.ts:66-103, src/lib/scan-cache.ts:96-109
- **Scenario**: Two users (or one user double-clicking, or a "Try:" chip + the auto-peek path) request a scan of `facebook/react` at the same head SHA within the same warm instance before either finishes. Both call `lookupCachedScan`, both miss the empty cache (`cacheGet` returns null for the same `owner/repo@sha::llm` key), both run the full ingest + a full LLM `assess()`, both then `cacheSet` the same key. The cache is only populated *after* a scan completes — there is no "a scan for this key is already running, await it" map.
- **Root cause**: The cache is a result cache, not an in-flight promise cache. The read/compute/write window is wide (seconds), so concurrent requests for a cold key all compute.
- **Impact**: stale/wrong data is not the issue — wasted GitHub quota + duplicated LLM spend (real money) + duplicate persisted-scan dedup churn under load
- **Fix sketch**: Keep a `Map<key, Promise<ScanReport>>` of in-flight scans keyed by `cacheKey`; the first caller computes, concurrent callers `await` the same promise.

## 3. Transient partial ingestion (raw-host hiccup / file timeouts) is cached as authoritative for the full TTL
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/github/source.ts:407-449, src/app/api/scan/route.ts:85-86, src/lib/cache.ts:12,74-80
- **Scenario**: During a scan, raw.githubusercontent.com is briefly degraded (or several files hit the 8 s `TIMEOUT_FILE_MS`). `fetchRaw`/`fetchContents` swallow every error and return `null`, the worker silently skips the file, and the scan completes with fewer files and lower `coverage`. Because the LLM did *not* fail (`engine.provider !== "mock"`), the `degradedToMock` guard does not apply, so this low-coverage report is `cacheSet` under the canonical `owner/repo@sha::llm` key and served to every subsequent scanner of that commit for the full 15-minute TTL. The cache key is purely commit-pinned; it does not encode coverage or fetch completeness, so a healthy re-scan of the unchanged commit keeps getting the degraded snapshot.
- **Root cause**: Per-file fetch failures degrade silently (return `null`), and the cache key assumes "same commit ⇒ same report" while actual content fetched is non-deterministic under upstream flakiness. Only LLM degradation is guarded against caching; ingestion degradation is not.
- **Impact**: stale/wrong data + silent failure — a one-off network blip pins lower scores under the canonical key for 15 min
- **Fix sketch**: Treat low-coverage results like the mock-degrade case — skip `cacheSet` (or cache with a much shorter TTL) when `coverage` is below a floor or files were skipped due to fetch errors.

## 4. MockProvider degrade returns HTTP 200 + a full `result` — only an in-array warning distinguishes synthetic from real scores
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/scan.ts:225-242,269-273, src/app/api/scan/stream/route.ts:120
- **Scenario**: Gemini/Bedrock is rate-limited or times out for an entire scan. After primary + retry + fallback all fail, the pipeline degrades to `MockProvider`, sets `report.engine.provider = "mock"`, pushes a warning string into `report.warnings`, and returns the report as a normal `result` event with a 200 status. A consumer that renders the report without prominently surfacing `engine.provider === "mock"` / the warning shows the user a confident-looking maturity score and roadmap that is actually the deterministic floor — the user believes they got an AI-graded scan. The progress event `fallback: true` at pct 90 flashes by and is overwritten by the `done`/`result` frames.
- **Root cause**: "A scan always returns something" is implemented as a soft 200 with the failure mode encoded only in optional report fields, not as a first-class, unmissable status. Whether the user notices depends entirely on downstream UI honoring `engine.provider`/`warnings`.
- **Impact**: silent failure — user trusts synthetic data as a real assessment during an LLM outage
- **Fix sketch**: Make the degrade impossible to miss at the protocol level — e.g. emit a distinct `degraded` SSE event (or a top-level `report.degraded: true` boolean) that the client must render, rather than relying on string-matching a warnings array.

## 5. Reported/persisted `headSha` is the tree-object SHA, not the commit SHA, on the no-lookup (tokened/private) path
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/scan.ts:121-123, src/lib/github/source.ts:382
- **Scenario**: A private/installation scan (or any path where `lookupCachedScan` is skipped because a token is present, so `opts.headSha` is undefined) sets `snapshot.meta.headSha = treeRes.sha` — the **tree object's** SHA, not the commit SHA. The anonymous cache path overwrites this with the real commit SHA (`scan.ts:123`), but the tokened path does not. That tree SHA is then what `persistScanReport` records and what `getScanReportByCommit` would later be keyed against. A future `resolveHead` returns a *commit* SHA, which can never equal the stored tree SHA, so per-commit dedup/lookup for that repo silently never matches.
- **Root cause**: Two different SHA namespaces (commit vs tree) are conflated into one `headSha` field; only the anonymous branch corrects it.
- **Impact**: stale/wrong data — broken cross-instance dedup/freshness for tokened repos; commit identity in the report is wrong
- **Fix sketch**: Always stamp `meta.headSha` from a resolved *commit* SHA (resolve head once unconditionally, or derive the commit SHA rather than `treeRes.sha`), independent of whether the anonymous cache path ran.

## 6. `parseRepoUrl` host check is end-anchored only — `evilgithub.com` is accepted as a GitHub host
- **Severity**: Low
- **Category**: code_quality
- **File**: src/lib/github/source.ts:80 (and ScanForm.tsx:19)
- **Scenario**: `/github\.com$/i.test(url.hostname)` matches any hostname *ending* in `github.com`, e.g. `notgithub.com`, `evilgithub.com`, `foo.github.com.attacker.tld` is rejected (good) but `xgithub.com` passes. A URL like `https://evilgithub.com/owner/repo` is parsed as a valid `{owner, repo}`. There is no SSRF impact in practice because ingestion always targets the hardcoded `api.github.com` / `raw.githubusercontent.com` hosts with only the regex-sanitized `owner`/`repo` path segments — the attacker host is discarded after parsing — but the parser misclassifies non-GitHub URLs as GitHub repos.
- **Root cause**: Missing start-anchor / subdomain boundary on the host regex (`^(.*\.)?github\.com$` or exact match intended).
- **Impact**: UX (a clearly non-GitHub URL is accepted and silently treated as `owner/repo`) — defense-in-depth gap, not an exploit
- **Fix sketch**: Anchor both ends with a dot boundary: `/(^|\.)github\.com$/i.test(url.hostname)`.

## 7. `owner`/`repo` charset allows bare `.` / `..` — path-segment injection into the GitHub API URL
- **Severity**: Low
- **Category**: code_quality
- **File**: src/lib/github/source.ts:99-101, src/lib/github/source.ts:343,357,360
- **Scenario**: The sanitizer `^[A-Za-z0-9_.-]+$` accepts segments that are only dots. Via the URL branch, `..` is normalized away by `new URL()`, and the bare-string branch guards `!parts[0].includes(".")` — but only `parts[0]`, and only on that branch. A value like `owner/.` or `./repo` reaching `parseRepoUrl` from the API body (not the form) can produce `owner="."`, yielding `GET api.github.com/repos/./repo`, which normalizes to a different, attacker-chosen GitHub API path than intended. Constrained entirely to `api.github.com` (no external SSRF, no slashes allowed), so blast radius is "queries a different GitHub resource," not host escape.
- **Root cause**: A name charset that permits dot-only segments is treated as a sufficient validator for path safety; relative path semantics (`.`/`..`) are not excluded.
- **Impact**: security (minor) — request path confusion within GitHub's API; no external SSRF
- **Fix sketch**: Reject pure-dot segments and require at least one alphanumeric: e.g. `/^(?=.*[A-Za-z0-9])[A-Za-z0-9_.-]+$/` and explicitly disallow `.`/`..`.
