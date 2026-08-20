# Usage metering

Usage metering is the billing/visibility view over how many scans an org has run. The
**billable unit is one computed (non-cached) `Scan` row**: re-scanning the same commit is
deduplicated and not double-counted (see [data-model.md](../data/data-model.md)). The dashboard
splits billable vs free scans, breaks them down by LLM provider, and charts a per-day trend.
Requires `DATABASE_URL`.

## What counts as billable

`isBillableScan()` (exported from `src/lib/db/usage.ts`) is the **single** definition, and
every metered aggregate goes through it: the headline tile, the trend series (both its SQL
and JS-fallback paths) and the top-repos attribution. A scan is billable only when **all
three** hold:

1. the repo is **private** (public scans are free by policy);
2. `engineProvider !== "mock"`: a keyless/degraded run performed no inference (the same
   exclusion `countMeteredScansThisMonth` in `credits.ts` applies to the allowance);
3. `engineByom !== true`: a BYOM scan ran in the org's own provider account, which the org
   already pays directly. `null` (rows predating the column) means the platform account, so
   it stays billable.

Anything else in the period is **free**. Three forms of the predicate exist and must stay in
lockstep: `isBillableScan()` (JS; also the daily series' fallback path), `billableScanWhere()`
(the Prisma `where`), and the `billable` expression inside the daily-series raw SQL, where
`IS NOT TRUE` mirrors `!== true` over a NULL `engineByom`.

> UI wording caveat: the dashboard's split bar still labels the free half "Public (free)"; it
> now also includes private mock/BYOM scans. The value is correct ("not billed"), the label is
> narrower than the number.

## Aggregation (`src/lib/db/usage.ts`)

`getUsageSummary(org, periodDays)` → `UsageSummary`:

- `totalScans` (all-time), `periodScans` (last *N* days), `privateScans` / `publicScans`
  (period), `distinctRepos`.
  - `privateScans` is the **billable** count per the predicate above (the name is wire
    compatibility, not "every private scan"); `publicScans` is the derived free remainder,
    so `privateScans + publicScans === periodScans` and the tiles equal the chart's stacked
    totals by construction.
- `byProvider`: count per `engineProvider`.
- `daily`: a **zero-filled** per-day series (stable x-axis even with gaps), aggregated per
  UTC day in SQL (`date_trunc`, portable to Aurora DSQL) with a JS row-bucketing fallback.
- `firstScanAt` / `lastScanAt` (all-time).

**Window:** the period counts and the daily series share one half-open UTC window,
`[since, tomorrow-UTC)`. The upper bound is load-bearing: without it a future-dated /
clock-skewed row was counted in the headline tile but silently dropped from the chart (its
day key isn't on the axis), so the billing page disagreed with itself.

## Page & API

| Surface | Behavior |
| --- | --- |
| `src/app/usage/page.tsx` | Auth-gated, org-scoped (`?org=` or active-org cookie). Stat cards (total, period, billable, distinct repos), public-vs-private + provider breakdowns, timeframe picker (`?days=`, default 30, max 365). |
| `GET /api/usage` | `?org=` (default `public`), `?days=`, `?format=json\|csv`. Returns `UsageSummary` JSON, or a CSV/JSON file download. `503` without DB. **IDOR guard:** when auth is on, a private org requires a session with an installation in it; public is readable by any signed-in user. |
| `src/components/usage/UsageTrend.tsx` | Stacked-bar chart (free under billable), dependency-free SVG, auto-scaled label cadence, CSV/JSON export buttons, legend + summary. |

## Rate limits & the spend ceiling (`src/lib/rate-limit.ts`)

Every public, unauthenticated endpoint that can cost money (`/api/scan`, `/api/scan/stream`,
`/api/org/import`, `/api/gate/*`, `/api/badge/*`, `/api/quota`, `/api/plan-enquiry`) is charged
against a sliding window with **two halves**:

- **Per-IP burst**: always in-process. A burst is seconds long and normally pinned to one
  instance, so a per-instance cap is a real cap and the check stays synchronous.
- **Global spend ceiling**: the budget itself. In-process it is really `instances × limit`,
  which *rises with autoscaling*. It can be backed by a **shared store** so a whole fleet charges
  one budget (`rateLimitRequestShared()`, `src/lib/rate-limit-store.ts`).

| Env var | Default | Meaning |
| --- | --- | --- |
| `ASCENT_RATE_LIMIT_STORE` | `memory` | `memory` (per-instance, no infrastructure) or `upstash` (fleet-wide global ceiling). |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | — | Required for `upstash`. Spoken over `fetch` against the REST `/pipeline` endpoint: **no npm client dependency**. If either is missing the store falls back to `memory` rather than failing requests. |
| `ASCENT_RATE_LIMIT_SHARED_FAIL_OPEN` | unset (fail **closed**) | When the shared store is unreachable, `1` degrades to the in-memory ceiling (availability) instead of returning 429 (safety). |
| `RATE_LIMIT_{SCAN,PEEK,QUOTA_PEEK,ORG_IMPORT,GATE,BADGE,CONTACT}_{PER_IP,GLOBAL}` | see source | Per-endpoint overrides; window is 60s. |

### What a 429 tells the caller

A refusal names the layer that refused, because the three cases need opposite responses. Routes that
pass the whole `RateLimitResult` to `tooManyRequests()` (today: the ingest guard) get:

| `scope` | body `code` | Headers | What the caller should do |
| --- | --- | --- | --- |
| `ip` | `rate_limited` | `retry-after`, `x-ascent-ratelimit-scope: ip`, `x-ascent-ratelimit-limit`, `x-ascent-ratelimit-window` | Slow down — this is *your* budget, and the limit + window are stated. |
| `global` | `rate_limited` | `retry-after`, `x-ascent-ratelimit-scope: global` | Nothing, directly: the service-wide budget is exhausted by aggregate traffic. **The ceiling and the remaining headroom are deliberately withheld** — publishing them hands an attacker the size of the instance budget and a live "how close am I" meter. |
| `unavailable` | `rate_limit_unavailable` | `retry-after` (the store breaker's re-probe delay), `x-ascent-ratelimit-scope: unavailable` | Retry shortly. **No limit was evaluated** (`evaluated: false`): the shared store was unreachable and the request was refused fail-closed, so no budget was consumed or exceeded — and there is no draining window to estimate from, which is why Retry-After is the breaker delay rather than a full window. |

Routes that still pass only `rl.retryAfterSec` keep the previous bare body (`error` + `code:
"rate_limited"` + `retry-after`); switching one is a one-argument change at its call site.

### Where a limit's number comes from

Every `RateLimitConfig` declares a required `basis`:

- **`derived`** — computed from a stated client cadence, with the multiplication written above the
  entry so it can be re-run when the client changes. Only `INGEST_RATE_LIMIT`
  (`src/lib/integrations/ingest-guard.ts`) qualifies: 13 pushes/min/machine × 200 seats behind one
  egress IP ≈ 2,600/min → `perIp` 3,000.
- **`inherited`** — chosen, or matched to a previous bespoke limit, and never computed. Every budget
  in `src/lib/rate-limit.ts` is inherited today (`BADGE_RATE_LIMIT` most explicitly: it was matched
  to the badge route's old 60/min/IP). Their comments now state what call pattern each number
  *clears*, which is a headroom check, not a derivation. An operator tuning under load should move
  these before a derived one — and promoting one to `derived` means measuring the client and
  rewriting the number, not reverse-engineering arithmetic that lands on the value already there.

### Reclaiming limiter memory

The in-process window map is swept on a **declared cadence with a bounded budget**: at most one sweep
per 10s (1s once over 10,000 keys), inspecting at most 256 entries (4,096 under pressure) and
resuming where the last sweep stopped, so no request pays an O(n) scan — the previous
"scan everything, on every request, while the map is over 10,000 keys" turned the limiter's own
memory pressure into request latency exactly during an attack. Only **fully-aged** keys are evicted
(a key whose window still holds hits would have its limit reset by eviction, which is an attack).
`rateLimiterStats()` exposes keys, peak keys, sweeps, entries scanned, evictions and completed passes.

`CONTACT_RATE_LIMIT` (3/min/IP, 30/min global) is the tightest budget here and the only one guarding a
non-inference cost: `POST /api/plan-enquiry` (the `/pricing` Custom-plan form) writes a row and sends
mail through the operator's provider on every accepted call, so an unthrottled loop is both a spam cannon
aimed at one inbox and a way to burn a metered send quota. A human submits it once.

**Unreachable store → fail closed, by design.** Turning the shared store on is a statement that
the fleet needs *one* hard ceiling; degrading silently would restore the exact
`instances × limit` hole the operator paid to close, on endpoints that spend inference money per
request. A denied free scan is recoverable in a minute; a denial-of-wallet is not. The per-IP
burst cap is in-memory and unaffected, so failing open (`ASCENT_RATE_LIMIT_SHARED_FAIL_OPEN=1`)
is a bounded, not unlimited, degradation. The driver keeps a 1.5s timeout and a 3s breaker so an
outage never stalls the request path.

**Adoption status:** the shared path is implemented and tested but the route handlers still call
the synchronous `rateLimitRequest()`; switching a route is a one-word `await` at its call site.
Until a route adopts `rateLimitRequestShared()`, its global ceiling remains per-instance.

## Key files

| File | Role |
| --- | --- |
| `src/lib/db/usage.ts` | `getUsageSummary()`: totals, provider mix, zero-filled daily series. |
| `src/lib/rate-limit.ts` | Sliding-window limiter: sync per-IP burst + sync/shared global ceiling. |
| `src/lib/rate-limit-store.ts` | Shared-store adapter: in-memory default, fetch-based Upstash REST driver. |
| `src/app/usage/page.tsx` | Usage dashboard. |
| `src/app/api/usage/route.ts` | JSON/CSV usage API with the IDOR guard. |
| `src/components/usage/UsageTrend.tsx` | Stacked-bar trend + export. |

## Known gaps

- **Usage is reporting, not invoicing**: billing runs through Polar (see
  [billing.md](billing.md)), which is wired end-to-end (plans, checkout, webhook
  fulfilment, refunds); this page only surfaces scan counts/trends and doesn't
  itself drive invoicing.
- **Single-org attribution**: multi-org installations don't yet attribute usage
  per-repo-owner.
