> Total: 5 findings (2 critical, 2 high, 1 medium)
# Test Mastery — Quotas & Rate Limiting

The pure rolling-window math (`decideQuota`, `removeHit`, `removeNewestHit`, `parseHits`, the env-limit getters) is well covered — `public-scan-quota.test.ts` even pins the value-keyed double-refund fix. But every layer that touches a database, an HTTP header, or a transaction is untested: `rate-limit.ts` has **no test file**, `db/quota-events.ts` has **no test file**, and the transactional `consume`/`refund` integration (the part that can actually leak money) is exercised only in fail-open mode where it is a no-op. The risk lives exactly one layer above where the tests stop.

## 1. Test the rate limiter's enforce-and-trip behavior — it has no test file at all
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/lib/rate-limit.ts:32 (`hit`), :66 (`rateLimitRequest`)
- **Scenario**: A refactor of the sliding-window math — an off-by-one (`recent.length < limit` vs `<=`), forgetting to `push(now)` before comparing, sharing the per-IP and global keys, or pruning with the wrong cutoff — ships green. The per-instance LLM-spend backstop silently stops tripping; a single scripted client floods `/api/scan` (a GitHub ingest + LLM completion = real $) and the global ceiling never fires.
- **Root cause**: `rate-limit.ts` has no sibling `.test.ts`. The only call sites that touch it (`scan/route.test.ts`, `org/import/route.test.ts`) **mock it out entirely** (`rateLimitRequest: () => ({ ok: true })`), so the actual counting/window logic has zero coverage anywhere in the repo.
- **Impact**: The only cost-abuse backstop on the free, no-signup funnel can regress to a no-op with no failing test — unbounded LLM spend from one abuser.
- **Fix sketch**: Add `src/lib/rate-limit.test.ts`. With a fixed clock (`vi.useFakeTimers` / `vi.setSystemTime`) assert: (a) the `perIp+1`-th request in one window returns `ok:false`; (b) the `global+1`-th request across *distinct* IPs trips even when each IP is under its per-IP cap (proves the two windows are independent budgets, not a shared key); (c) requests resurface after `windowMs` elapses (window slides); (d) `retryAfterSec === ceil(windowMs/1000)` on a trip. Invariant: **the (limit+1)-th hit within `windowMs` is rejected and the limit-th is allowed, for both the per-IP and the global window independently.**

## 2. Test the IP trust boundary in `clientIp` — spoofing the bucket key defeats both guards
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/lib/rate-limit.ts:18 (`clientIp`)
- **Scenario**: Someone "simplifies" the XFF parsing to take the **left-most** hop (the documented anti-pattern this code deliberately avoids — comment lines 12-16). Every request then carries an attacker-chosen `X-Forwarded-For: <random>`, minting a fresh rate-limit bucket *and* a fresh weekly-quota bucket (`hashIp` keys off this same function) per request. Both the burst limiter and the weekly quota are bypassed in one change, with no failing test.
- **Root cause**: `clientIp` is the shared key-derivation for *both* guards in this context, yet it is never asserted. Its precedence (`x-real-ip` → right-most XFF hop → `"unknown"` shared bucket) is pure, header-only, trivially testable, and completely uncovered.
- **Impact**: A single regression in one 10-line function silently disables rate limiting **and** the public scan quota — the two controls this whole context exists to provide.
- **Fix sketch**: In `rate-limit.test.ts`, drive `clientIp` with crafted `Request` headers and assert: (a) `x-real-ip` wins over any XFF; (b) with only XFF, it returns the **right-most** (trusted-proxy-appended) hop, NOT the client-supplied left-most; (c) no identifying header → `"unknown"` (so unidentifiable callers share one bucket / fail closed, never per-spoofed-value). Invariant: **a client-controlled left-most XFF entry can never change the returned key.**

## 3. Test the transactional consume → deny → refund path against a real (in-memory) store
- **Severity**: High
- **Category**: success-theater
- **File**: src/lib/public-scan-quota.ts:157 (`consumePublicScanQuota`), :300 (`refundPublicScanQuota`)
- **Scenario**: The window *arithmetic* (`decideQuota`) is tested, but the DB-bound wrapper — read row → `decideQuota` → upsert window, then on failure refund the exact `chargedAt` slot — is not. A regression where consume forgets to persist the appended hit, returns a wrong `chargedAt`, or refund drops the wrong slot (e.g. reverts to `removeNewestHit` and peels a sibling's live slot) ships green because the existing suite only proves the helpers in isolation. The money-leaking integration is what's untested.
- **Root cause**: The two route tests that import these set `isDbConfigured: () => false`, so consume/refund take the **fail-open early return** (lines 163-165, 305) and never run the transaction body, the deny branch, the `recordQuotaEvent` call, or the upsert. The integration looks "covered" (the functions are imported) but every meaningful branch is skipped — classic success-theater.
- **Impact**: The free-tier metering-on-commit contract (charge on success, refund on dedup/abort/degrade-to-mock) can silently break — either over-charging legit users or, via a refund bug, letting one bucket refund more slots than it consumed and graze free scans indefinitely.
- **Fix sketch**: Test against a fake `db`/`tx` backed by an in-memory `Map<ipHash,string>` injected through `withDb` (mock `@/lib/db`'s `isDbConfigured`→true + `withDb`/`withRetry` to invoke the callback with the fake `tx`). Assert end-to-end: consume N times → the (N+1)-th returns `{enforced:true, allowed:false}` and the stored window is unchanged on denial; an allowed consume returns a numeric `chargedAt` that equals the appended hit; `refundPublicScanQuota(req, id, chargedAt)` removes **exactly that** timestamp and a second refund of the same `chargedAt` is a no-op (idempotent). Invariant: **consumed + refunded slots net to zero, and no refund ever removes a slot it didn't charge.**

## 4. Pin the DSQL-vs-Postgres isolation selection that makes the consume race-safe
- **Severity**: High
- **Category**: error-branch
- **File**: src/lib/public-scan-quota.ts:35 (`quotaTxOptions`)
- **Scenario**: The whole concurrency-safety argument (lines 27-39) rests on `quotaTxOptions` returning `Serializable` on vanilla Postgres and `undefined` on Aurora DSQL. If a refactor flips this — returns `undefined` everywhere, or passes an explicit isolation level to DSQL (which rejects it) — then on Postgres two concurrent consumers of the same bucket both read the same window and the last upsert silently wins (a lost update, no error, `withRetry` never fires), letting parallel clients overrun the weekly gate; on DSQL the transaction errors. No test guards this branch.
- **Root cause**: `quotaTxOptions` keys off `readDsqlConfig()` and is never asserted. It's a pure config-driven branch — the single line that decides whether the consume transaction is actually serialization-safe — and it has no coverage.
- **Impact**: A silent regression here removes the only thing preventing concurrent free-scan overrun on a Postgres deployment, with the comment still claiming safety.
- **Fix sketch**: Unit-test `quotaTxOptions` by mocking `readDsqlConfig`: when it returns a config (DSQL) assert the result is `undefined`; when it returns falsy (Postgres) assert `{ isolationLevel: Serializable }`. Invariant: **DSQL ⇒ no explicit isolation; Postgres ⇒ Serializable — never the reverse.**

## 5. Cover the abuse-observability counters in `quota-events.ts`
- **Severity**: Medium
- **Category**: coverage-gap
- **File**: src/lib/db/quota-events.ts:12 (`recordQuotaEvent`), :36 (`getQuotaEventTotals`)
- **Scenario**: `recordQuotaEvent` scope-normalizes (`(scope||"unknown").toLowerCase().slice(0,60)`) and upserts a `(kind,scope)` tally; `getQuotaEventTotals` partitions rows into `quotaDenies` vs `rateLimitTrips` and sums `total`. A regression — mis-bucketing a kind, dropping the normalization (so `"Anon"` and `"anon"` split into two rows), or a `total` that double-counts — silently corrupts the operator's only view of how often the guardrails fire, and the swallow-all `catch` means it never surfaces.
- **Root cause**: No test file. The module is best-effort and entirely silent on error, so a logic bug produces wrong-but-plausible numbers with zero signal.
- **Fix sketch**: Test `getQuotaEventTotals`' pure partition/sum against a stubbed `getPrisma().quotaEvent.findMany` returning mixed-kind rows — assert each row lands in the correct bucket and `total` equals the row-count sum; test `recordQuotaEvent`'s key normalization (`"ANON "`/`"anon"` collapse to one `(kind,scope)` upsert key, scope truncated to 60 chars) and that a thrown upsert is swallowed (resolves, never rejects). Invariant: **every event lands in exactly one bucket, scopes are case/length-canonicalized into a single tally, and a store failure never throws.**
