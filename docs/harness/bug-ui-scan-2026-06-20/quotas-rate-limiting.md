> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

# Quotas & Rate Limiting — combined bug+ui scan

## 1. A single abusive IP drains the GLOBAL rate-limit budget for everyone
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: rate-limiting / denial-of-service amplification
- **File**: src/lib/rate-limit.ts:66 (rateLimitRequest) → src/lib/rate-limit.ts:32 (hit)
- **Scenario**: One IP floods `/api/scan` at 1000 req/min. After its per-IP allowance (20) is exhausted, every *further* request still increments the global window because `rateLimitRequest` calls `hit(global)` unconditionally on every call, and `hit()` pushes the timestamp into the window *before* checking `ok`. Within seconds the global ceiling (120/min) is full of one abuser's already-rejected requests, so every *other* legitimate caller gets a 429 on the global window.
- **Root cause**: The limiter counts a request against the global budget even when that same request is (or will be) rejected on the per-IP budget. A request that is denied should not consume shared global headroom — otherwise the per-IP limit, meant to contain one abuser, instead becomes the lever that lets one abuser starve the global pool.
- **Impact**: Global DoS amplification — a single IP (no spoofing needed) can deny the public scan funnel to all users on that instance while spending almost nothing. The per-IP cap is supposed to prevent exactly this.
- **Fix sketch**: Check the per-IP window first; only record/charge the global window when the per-IP check passes (or use a non-mutating `peek` for the global check and only commit both counts when both pass). I.e. don't let an over-per-IP request consume global capacity.

## 2. Rate-limit trips on /api/scan, /api/scan/stream and /api/org/import are never recorded (QUOTA-6 observability blind on the highest-risk routes)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent failure / observability gap
- **File**: src/app/api/scan/route.ts:108, src/app/api/scan/stream/route.ts:37, src/app/api/org/import/route.ts:51
- **Scenario**: The QUOTA-6 abuse-observability counter (`recordQuotaEvent("rate_limit", …)`, surfaced on the public `/usage` view so an operator can see how often guardrails fire) is invoked ONLY by the badge route (src/app/api/badge/[owner]/[repo]/route.ts:293). The three scan/import routes all do `const rl = rateLimitRequest(...); if (!rl.ok) return tooManyRequests(...)` and return WITHOUT recording the trip. `quota-events.ts` even documents the counter as "Per-minute rate-limit trips, by limiter name (badge, …)".
- **Root cause**: The instrumentation was added to the badge route only and never threaded into the scan/import limiter call sites — the routes most likely to be hammered by a cost-abuse flood are exactly the ones with no signal.
- **Impact**: An operator watching `/usage` sees rate-limit abuse against the expensive LLM scan + bulk-import endpoints as zero, while only crawler badge traffic shows up. Limits can't be tuned and an attack on the costly paths is invisible. (No correctness break — purely a blind spot, but on the routes that burn real $.)
- **Fix sketch**: On each `!rl.ok` branch in the three routes, add `void recordQuotaEvent("rate_limit", "<scan|org-import>").catch(() => {})` before returning `tooManyRequests`, matching the badge route.

## 3. refundPublicScanQuota silently falls back to "drop newest" when chargedAt is undefined
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: refund correctness / quota under-count
- **File**: src/lib/public-scan-quota.ts:320 (removeNewestHit fallback)
- **Scenario**: `refundPublicScanQuota` takes `chargedAt?` and uses `removeHit(prior, chargedAt)` only when `typeof chargedAt === "number"`; otherwise it uses `removeNewestHit(prior)`. The module header (lines 296–298) explicitly warns this fallback is the CRITICAL double-refund race: two concurrent refunds on a shared/coalesced scan each peel a different sibling's newest slot. All *current* callers thread `quota.chargedAt` through, so it's safe today — but if `consumePublicScanQuota` fails open (store error → `chargedAt: null`) and a caller still calls refund, or any future/edge caller omits it, the unsafe path silently activates with no error.
- **Root cause**: The dangerous legacy behavior is retained as a default rather than being made unreachable. A value-keyed refund whose key is missing should be a no-op (nothing was provably charged), not a guess at "the newest".
- **Impact**: Latent reintroduction of the previously-fixed double-refund → quota under-count → free-scan bypass, with zero signal when it happens.
- **Fix sketch**: When `chargedAt` is not a finite number, treat the refund as a no-op (return) instead of `removeNewestHit`; or require `chargedAt` in the signature so a caller can't accidentally hit the unsafe path. Keep `removeNewestHit` only for explicit legacy migration if still needed.

## 4. Rate limit is enforced AFTER consuming credits/quota only conceptually — but peek+latest DB salvage path is unthrottled
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: rate-limiting / cost-control gap
- **File**: src/app/api/scan/route.ts:72-94 (peek/latest block runs before rateLimitRequest at line 107)
- **Scenario**: `GET /api/scan?peek=1&latest=1` performs `getScanReportByCommit(...)` (a DB read) at line 88 and returns, all BEFORE the `rateLimitRequest` call at line 107. A script can hammer the `peek&latest` salvage endpoint with thousands of distinct `owner/repo` values per second; each is an unthrottled DB round-trip. The comment justifies skipping the limiter for "cheap hydration paths", but a per-request DB query against an attacker-chosen key is not free at scale.
- **Root cause**: "Cheap path → skip the limiter" lumps a DB-backed lookup in with the genuinely free in-memory cache check. The DB read is cheap per call but unbounded in aggregate with no per-IP cap.
- **Impact**: Cost/load abuse vector on the database via the public, unauthenticated peek endpoint; no 429 ever returned, and (per finding #2) no observability either.
- **Fix sketch**: Apply a lightweight rate limit (a generous per-IP window, separate namespace) before the `peek&latest` DB read, or only allow the DB salvage read after a cache miss that already passed a cheap limiter. In-memory cache probes can stay unthrottled.

## 5. Weekly "limit resets on <date>" overstates the reset — a rolling window frees one slot at a time, not the whole allowance
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: messaging accuracy / UX
- **File**: src/lib/public-scan-quota.ts:113 (resetAt = recent[0] + WEEK_MS) → src/components/report/QuotaNotice.tsx:139 / src/components/QuotaMeter.tsx:47
- **Scenario**: When denied, `resetAt` is `oldest-in-window-hit + WEEK_MS`, i.e. when ONE slot frees. The UI then says "the limit resets {date}" (QuotaBanner/QuotaStaleNotice) and "resets {date}" (QuotaMeter), implying the full allowance returns on that date. In reality only a single scan unlocks then; the next slot frees later. A user who used 3 scans across 3 days will be told it "resets" on the day the *first* one ages out, get exactly one scan, and be blocked again.
- **Root cause**: Rolling-window semantics (per-slot expiry) are presented with fixed-window language ("the limit resets").
- **Impact**: Mild expectation mismatch — user expects a fresh full allowance, gets one scan. Not a correctness bug; the math is right, the words aren't.
- **Fix sketch**: Reword to "your next free scan unlocks {date}" (singular) rather than "the limit resets", or surface the count that frees on that date. Keep the date computation as-is.

## 6. QuotaMeter fetch failure / inactive gate is indistinguishable, and a slow /api/quota leaves no skeleton
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: loading/error state
- **File**: src/components/QuotaMeter.tsx:18-49
- **Scenario**: `QuotaMeter` fetches `/api/quota`, and on any failure (`.catch(() => {})`) or non-ok response it silently renders nothing — identical to the legitimate "gate inactive" case (`!q.enforced`). If `/api/quota` is slow or transiently errors (the route is `force-dynamic` + `no-store`, so it hits getViewer + a DB peek on every load), the user sees no meter and no indication one was expected; a flake looks the same as "no quota configured".
- **Root cause**: A single null state collapses three distinct conditions (loading, fetch error, gate-off) into "render nothing", so a real failure to show remaining allowance is invisible.
- **Impact**: A visitor near their limit may never see the "X of N free scans left" warning if the meter call flaked, then hit an unexpected 429 wall. Minor, but defeats the meter's stated purpose ("so a visitor sees their real remaining allowance BEFORE committing a scan").
- **Fix sketch**: Distinguish states — keep silent on `!enforced`, but on fetch error optionally retry once / log; consider a tiny inline skeleton or deferred render so a slow-but-successful response still appears. At minimum, don't swallow the error without a one-shot retry.
