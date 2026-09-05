# Billing, Credits & Metering

Plans and checkout (Polar), the credit economy, quotas and rate limiting, and usage
metering.

Context-map group: **Billing, Credits & Metering** (`feature`).

| Doc | Covers | Freshness (audited 2026-07-28) |
| --- | --- | --- |
| [billing.md](billing.md) | Plan tiers, hybrid charge model, Polar checkout + webhook, refund clawback | CURRENT |
| [usage.md](usage.md) | Usage summary API and the usage page | STALE (see gaps) |

## Implementation roots

- `src/lib/plans.ts`: `PLAN_FEATURES`, `resolveScanCharge`/`decideScanCharge`
- `src/lib/polar.ts`, `src/app/api/billing/{checkout,webhook}`: Polar integration
- `src/lib/db/credits.ts`, `src/lib/entitlement.ts`, `src/lib/credit-estimate.ts`
- `src/lib/rate-limit.ts`, `src/lib/public-scan-quota.ts`
- `src/lib/db/usage.ts`, `src/app/api/usage`, `src/app/usage`

## Known gaps

- **Seat limits may not be enforced.** `PLAN_FEATURES` declares a `seats` cap per
  tier, but whether the membership-write path actually enforces it was not verified.
  Treat the cap as declarative until confirmed in `src/lib/db/members.ts`.
- **`usage.md` omits the whole cost-accounting layer**: `inputTokens`,
  `outputTokens`, `estimatedCostUsd`, `costBasis`, and `byRepo` (top-10 billable
  repos). It also says the daily series is bucketed in JS. That is now only the
  *fallback*: the primary path aggregates in SQL via `date_trunc`/`to_char`.
- **Undocumented:** Quotas & Rate Limiting has no doc of its own.
