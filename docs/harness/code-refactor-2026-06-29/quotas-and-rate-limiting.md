# Code Refactor — Quotas & Rate Limiting
> Total: 5 | Critical: 0 High: 1 Medium: 3 Low: 1

## 1. Short-date formatter (`month: "short", day: "numeric"`) duplicated 3× across 2 files
- **Severity**: High
- **Category**: duplication
- **File**: src/components/report/QuotaNotice.tsx:30, src/components/report/QuotaNotice.tsx:88, src/components/report/TrendChart.tsx:99
- **Scenario**: The exact expression `new Date(x).toLocaleDateString(undefined, { month: "short", day: "numeric" })` is hand-written in three places. `formatResetAt` (QuotaNotice.tsx:28-31) wraps it as `` `on ${...}` ``; `QuotaStaleNotice` (QuotaNotice.tsx:86-89) inlines the identical call again as `` ` from ${...}` `` instead of reusing `formatResetAt`; and `TrendChart.tsx:99` repeats the same options a third time. This is the inline-date-formatter overlap previously noted in the Trends wave.
- **Root cause**: No shared "short month/day" date helper exists, so each site re-specifies the same `Intl` options. The intra-file case is the most egregious — `QuotaStaleNotice` lives in the same module as `formatResetAt` yet duplicates its core.
- **Impact**: Locale/format drift risk: changing how dates render (e.g. adding the year, or switching to a fixed locale) requires editing three disconnected sites; one will inevitably be missed, producing inconsistent dates between the report banner, the stale-notice, and the trend chart.
- **Fix sketch**: Add a single `formatShortDate(ms: number): string` (e.g. in a shared `src/lib/format` or alongside `formatResetAt`). Have `formatResetAt` return `` `on ${formatShortDate(resetAt)}` ``, `QuotaStaleNotice` build `` ` from ${formatShortDate(scannedMs)}` ``, and `TrendChart` call `formatShortDate(d.getTime())`. One options object, three call sites.

## 2. 429-JSON-Response construction duplicated between `tooManyRequests` and `weeklyQuotaExceeded`
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/rate-limit.ts:83-94, src/lib/public-scan-quota.ts:360-380
- **Scenario**: Both helpers build the same 429 skeleton: `new Response(JSON.stringify({...}), { status: 429, headers: { "content-type": "application/json; charset=utf-8", "retry-after": String(sec), ... } })`. `weeklyQuotaExceeded` just adds extra `x-ascent-quota-*` headers and a richer body; the status + content-type + retry-after boilerplate is identical.
- **Root cause**: The two quota modules each grew their own 429 builder independently; the shared "JSON error with Retry-After" shape was never extracted.
- **Impact**: The canonical 429 contract (content-type string, retry-after stringification) is encoded twice; a change to the error envelope must be mirrored in both files. Low bundle cost but a real maintenance/consistency hazard for the public funnel's rejection responses.
- **Fix sketch**: Extract a small `json429(body: unknown, retryAfterSec: number, extraHeaders?: Record<string,string>): Response` (a neutral location both modules can import, e.g. a tiny `src/lib/http.ts`). Have `tooManyRequests` call it with no extras and `weeklyQuotaExceeded` pass the `x-ascent-quota-*` headers as `extraHeaders`.

## 3. `removeNewestHit` and its refund fallback branch are effectively unreachable in production
- **Severity**: Medium
- **Category**: dead-code
- **File**: src/lib/public-scan-quota.ts:291-296 (function), src/lib/public-scan-quota.ts:344 (fallback branch)
- **Scenario**: `refundPublicScanQuota` chooses `typeof chargedAt === "number" ? removeHit(prior, chargedAt) : removeNewestHit(prior)`. The only production caller is `consumeScanQuota` (src/lib/scan-finalize.ts:70-75), which calls `refundPublicScanQuota(req, identity, charged.chargedAt)` only when a slot was actually charged — i.e. when `consumePublicScanQuota` returned `enforced && allowed`, in which case it always sets `chargedAt: now` (a number, public-scan-quota.ts:233). Therefore `chargedAt` is always numeric at the refund site, the `removeHit` branch always wins, and `removeNewestHit` is never invoked outside its own unit tests (public-scan-quota.test.ts).
- **Root cause**: `removeNewestHit` is the legacy "drop the newest hit" refund kept as a defensive fallback for callers that don't thread `chargedAt`. After every caller was migrated to value-keyed refunds, the fallback (and its exported function) became dead weight whose only remaining references are the dead branch + dedicated tests.
- **Impact**: An exported function plus a `describe("removeNewestHit")` test block are maintained for a code path no caller can trigger, implying a second supported refund mode that doesn't really exist. Misleads readers about how refunds work and invites accidental reuse of the racy "drop newest" behavior the value-keyed path was introduced to fix.
- **Fix sketch**: Make `chargedAt` a required `number` parameter on `refundPublicScanQuota`, drop the `: removeNewestHit(prior)` fallback, and delete `removeNewestHit` + its test block. (Keep `removeHit` — it is the live path.) If a defensive fallback is still desired, document it as such; do not leave it presented as an equal alternative.

## 4. `QuotaScope` ("anon" | "user") canonical alias lives in a UI component but is hand-redeclared as a literal union in ~5 server/lib sites
- **Severity**: Medium
- **Category**: structure
- **File**: src/components/report/QuotaNotice.tsx:12 (canonical), src/lib/public-scan-quota.ts:92 & :258, src/lib/scan-finalize.ts:20, src/app/api/scan/route.ts:101, src/components/QuotaMeter.tsx:16
- **Scenario**: The scope concept is given a named alias `export type QuotaScope = "anon" | "user"` — but only inside the client component `QuotaNotice.tsx`. Every server-side and lib usage re-spells the literal union `"anon" | "user"` inline instead: `bucketContext`'s return and `QuotaPeek.scope` (public-scan-quota.ts), `ScanQuotaResult.quotaScope` (scan-finalize.ts), `quotaScope` in the scan route, and `Quota.scope` in QuotaMeter.
- **Root cause**: A shared domain type was defined in the wrong layer (a presentational component) and never given a home the server code could import, so the lib side just kept retyping the literal.
- **Impact**: A single union is the source of truth for the `x-ascent-quota-scope` header / `/api/quota` contract yet is encoded in six places; adding a third scope (e.g. `"team"`) means finding and editing five inline copies plus the alias. The alias's placement in a `"use client"` component also discourages server modules from importing it.
- **Fix sketch**: Move `QuotaScope` to the server-side source of truth (e.g. export it from `src/lib/public-scan-quota.ts`, where the scopes are actually derived), have `QuotaPeek.scope`, `bucketContext`, `ScanQuotaResult.quotaScope`, and the route var reference it, and re-export it from `QuotaNotice` (or import it there) for the UI.

## 5. `Quota` interface in QuotaMeter re-declares the `/api/quota` (`QuotaPeek`) contract by hand
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/QuotaMeter.tsx:11-17, src/lib/public-scan-quota.ts:251-259
- **Scenario**: `QuotaMeter` defines `interface Quota { enforced; remaining: number; limit: number; resetAt: number | null; scope: "anon" | "user" }`, which is field-for-field identical to `QuotaPeek` — the exact object `GET /api/quota` returns (the route serializes `peekPublicScanQuota`'s `QuotaPeek`). The component then casts the fetch result `as Quota`.
- **Root cause**: The client re-typed the API response locally instead of importing the producer's type. `QuotaPeek` lives in `public-scan-quota.ts` (which imports `node:crypto`), but a `import type { QuotaPeek }` is erased at build time and pulls no runtime/node code into the client bundle.
- **Impact**: The API response shape is defined twice; a field change on `QuotaPeek` (server) won't be caught at the consumer, and the local `as Quota` cast silently masks the drift. Minor today (small interface, one consumer) but exactly the kind of contract that breaks quietly.
- **Fix sketch**: `import type { QuotaPeek } from "@/lib/public-scan-quota"` in QuotaMeter and use it (or a shared `QuotaPeek`/`QuotaScope` from the consolidated location in finding 4), deleting the local `Quota` interface. Keep the type import `type`-only so no node code leaks into the client chunk.
