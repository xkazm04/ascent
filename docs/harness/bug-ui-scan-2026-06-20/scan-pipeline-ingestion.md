> Total: 5 findings (0 critical, 0 high, 2 medium, 3 low)

# Scan Pipeline & Ingestion — combined bug+ui scan

## 1. Client-supplied head sha/etag is written into the SHARED in-memory head-hint store
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption / trust-boundary
- **File**: src/lib/scan-cache.ts:90
- **Scenario**: A caller POSTs `/api/scan/stream` with an arbitrary `headSha`/`headEtag` body (stream/route.ts:128-132 builds `preResolved` from these unvalidated client fields). `lookupCachedScan` takes the `preResolved` branch and unconditionally runs `headHintSet(owner, repo, { etag, headSha })`, writing the attacker's values into the process-wide `hintStore` shared by every anonymous user on that warm instance. The next user who scans the same repo without `preResolved` reads the poisoned hint via `headHintGet` and sends the attacker's ETag as `If-None-Match` on their conditional head lookup.
- **Root cause**: The `preResolved` optimization is documented as "trusted only as an optimization … cannot poison the shared cache," but that reasoning only covers the per-request cache *key* (self-owned). It overlooks that the same branch also mutates the cross-request `hintStore`, which is shared state, not request-scoped. No format/sanity validation is applied to the client-supplied sha/etag before persisting them.
- **Impact**: Hint-store pollution → forced cache misses / extra (rate-limited) GitHub head calls for other anonymous users of that repo, and a window where a victim's conditional request carries an attacker-chosen ETag. Self-correcting on the next real 200 (GitHub returns the true sha+etag), so it is not a data-serving exploit, but it is a write across the trust boundary into shared memory that the "self-owned only" comment claims doesn't happen.
- **Fix sketch**: In the `preResolved` branch, do NOT call `headHintSet` with client-supplied values (only the route's own resolved 200/304 results should seed the hint). At minimum, validate `headSha` matches `/^[0-9a-f]{7,40}$/i` and treat `etag` as opaque-but-bounded before storing, and prefer keeping `preResolved` purely as a local cache-key input.

## 2. `parseSSE` concatenates multiple `data:` lines without a newline, corrupting multi-line payloads
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case / parsing
- **File**: src/lib/sse.ts:18
- **Scenario**: A frame containing two `data:` lines (valid per the SSE spec, e.g. `data: {"a":1}\ndata: "tail"}` or any producer that splits a JSON value across `data:` lines) is parsed by `dataStr += line.slice(5).trim()`, which joins the segments with no separator. The SSE spec requires multi-line `data:` to be rejoined with `\n`. The concatenation both drops the `\n` and `.trim()`s each segment, so a multi-line payload is silently mangled and `JSON.parse` then fails → the frame is dropped (`data: null`).
- **Root cause**: The parser assumes every frame carries exactly one single-line `data:` value (true for the current scan/org-scan/war-room producers) and hard-codes that assumption, so it is not spec-correct for the general SSE consumer this module advertises itself as ("shared by every consumer of the app's SSE endpoints").
- **Impact**: No live failure today (current servers emit single-line JSON), but a latent trap: any future SSE producer that emits a multi-line `data:` field will have its events silently swallowed by this shared primitive.
- **Fix sketch**: Collect `data:` segments into an array and join with `"\n"` (`dataLines.push(line.slice(5).replace(/^ /, ""))` then `dataLines.join("\n")`), stripping only a single leading space per the spec rather than full `.trim()`.

## 3. JSON scan route consumes a weekly quota slot for a provably-invalid URL
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / quota-accounting
- **File**: src/app/api/scan/route.ts:116
- **Scenario**: `GET/POST /api/scan?url=not-a-repo` (anonymous, non-mock). `parseRepoUrl` returns null, so the cache lookup block (line 59, guarded by `parsed`) is skipped, but the quota block at line 116 only checks `orgSlug === "public" && !token && !opts.mock` — all true for a null parse — so `consumePublicScanQuota` runs and records a hit. `scanRepository` then throws `INVALID_URL`; the catch calls `refundQuota()`. The stream route deliberately rejects an invalid URL BEFORE its quota block (stream/route.ts:46-51) to avoid exactly this; the JSON route has no such pre-check.
- **Root cause**: The JSON route validates the URL only deep inside `scanRepository`, so the "don't charge a typo" invariant relies entirely on the best-effort, fail-open refund. `refundPublicScanQuota` is explicitly fail-open ("a refund hiccup just leaves one slot consumed"), so a transient quota-store error on the refund leg burns a free weekly slot for a mere typo.
- **Impact**: Inconsistent behavior between the two scan entry points; a free-tier user can lose a weekly scan slot to a typo whenever the refund write fails, plus a wasted quota-store transaction per malformed request.
- **Fix sketch**: Mirror the stream route: in the JSON route's `runScan`, return `INVALID_URL` 400 when `parsed` is null BEFORE the rate-limit/quota block (the parse already happens at line 36).

## 4. Coalesced stream scans deliver no progress events to joined callers
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: missing-state / live-feedback
- **File**: src/app/api/scan/stream/route.ts:163
- **Scenario**: Two clients open `/api/scan/stream` for the same uncached commit (a peek-then-stream handoff, a StrictMode double-mount, or two tabs). `coalesceScan` runs the factory for only the FIRST caller, whose `onProgress` closure (`send`) belongs to the first stream. The second caller awaits the same promise, so its `scanRepository`'s `onProgress` is never invoked — its SSE stream emits the keepalive pings and then jumps straight to the final `result`, with no `progress` frames in between.
- **Root cause**: Coalescing shares one computation (correct for cost), but progress emission is bound to the originating run's callback, so joiners get a frozen/empty progress UI for the full scan duration (potentially tens of seconds) before the report appears.
- **Impact**: The live "Asking Gemini… / Composing…" progress UX silently degrades to a long blank wait for any second concurrent viewer of the same scan — looks like a stall.
- **Fix sketch**: Have the coalescer fan progress out to all current waiters (e.g. an EventEmitter / per-key subscriber list the run publishes to), or emit a synthetic "joining an in-progress scan…" progress frame to joined callers so the UI shows motion until the shared `result` arrives.

## 5. In-memory cache tier is not subject to the persisted-scan freshness gate
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: cache-staleness
- **File**: src/lib/scan-cache.ts:120
- **Scenario**: `lookupCachedScan` applies `isPersistedScanFresh()` (the `SCAN_MAX_CACHE_AGE_DAYS`, default 7d, "weekly refresh") only to the DB tier (line 128). The in-memory Tier-1 hit at line 120-121 returns `mem` immediately with no freshness check beyond `cache.ts`'s own 15-minute TTL. A persisted scan that crossed the max-age boundary is treated as a miss in the DB tier and re-scanned, but if that same commit's report still sits in the warm-instance map (or was just re-warmed by an earlier DB hit before crossing the boundary), the memory tier keeps serving it for up to its TTL.
- **Root cause**: The two tiers enforce different age semantics; the "stale LLM analysis / rubric drift doesn't live forever" intent documented for the durable gate isn't mirrored on the memory tier.
- **Impact**: Bounded and minor — the 15-minute TTL caps the divergence well under the 7-day window — but it is a real inconsistency between the documented freshness contract and the memory tier's behavior.
- **Fix sketch**: Either accept and document that the memory TTL is the only memory-tier freshness bound (current de-facto behavior), or stamp `scannedAt` on the memory entry and apply `isPersistedScanFresh` to the Tier-1 hit too for a uniform contract.
