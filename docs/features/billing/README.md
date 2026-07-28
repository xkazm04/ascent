# Billing, Credits & Metering

Plans and checkout (Polar), the credit economy, quotas and rate limiting, usage
metering, and the public badge.

Context-map group: **Billing, Credits & Metering** (`feature`).

| Doc | Covers | Freshness (audited 2026-07-28) |
| --- | --- | --- |
| [billing.md](billing.md) | Plan tiers, hybrid charge model, Polar checkout + webhook, refund clawback | CURRENT |
| [usage.md](usage.md) | Usage summary API and the usage page | STALE — see gaps |
| [badge.md](badge.md) | Public SVG badge, cache/rate-limit, gate mode | STALE |

## Implementation roots

- `src/lib/plans.ts` — `PLAN_FEATURES`, `resolveScanCharge`/`decideScanCharge`
- `src/lib/polar.ts`, `src/app/api/billing/{checkout,webhook}` — Polar integration
- `src/lib/db/credits.ts`, `src/lib/entitlement.ts`, `src/lib/credit-estimate.ts`
- `src/lib/rate-limit.ts`, `src/lib/public-scan-quota.ts`
- `src/lib/db/usage.ts`, `src/app/api/usage`, `src/app/usage`
- `src/app/api/badge/[owner]/[repo]`, `src/lib/badge.ts`, `src/lib/db/badge-analytics.ts`

## Known gaps

- **Seat limits may not be enforced.** `PLAN_FEATURES` declares a `seats` cap per
  tier, but whether the membership-write path actually enforces it was not verified.
  Treat the cap as declarative until confirmed in `src/lib/db/members.ts`.
- **`usage.md` omits the whole cost-accounting layer**: `inputTokens`,
  `outputTokens`, `estimatedCostUsd`, `costBasis`, and `byRepo` (top-10 billable
  repos). It also says the daily series is bucketed in JS — that is now the
  *fallback*; the primary path aggregates in SQL via `date_trunc`/`to_char`.
- `badge.md` omits `recordBadgeImpression()` / `recordQuotaEvent()` analytics, the
  per-org gate-policy resolution via `getOrgGatePolicy()` when `policy_*` params
  are absent, and the negative-cache size cap (`BADGE_NEG_CACHE_MAX`).
- **Undocumented:** Quotas & Rate Limiting has no doc of its own.
