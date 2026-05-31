# Usage metering

Usage metering is the billing/visibility view over how many scans an org has run. The
**billable unit is one computed (non-cached) `Scan` row** — re-scanning the same commit is
deduplicated and not double-counted (see [data-model.md](data-model.md)). The dashboard
splits public (free) vs private (billable) scans, breaks them down by LLM provider, and
charts a per-day trend. Requires `DATABASE_URL`.

## Aggregation (`src/lib/db/usage.ts`)

`getUsageSummary(org, periodDays)` → `UsageSummary`:

- `totalScans` (all-time), `periodScans` (last *N* days), `privateScans` / `publicScans`
  (period), `distinctRepos`.
- `byProvider` — count per `engineProvider`.
- `daily` — a **zero-filled** per-day series (stable x-axis even with gaps), bucketed to
  UTC day in JS (independent of DB time functions — portable to Aurora DSQL).
- `firstScanAt` / `lastScanAt`.

Provider grouping uses `scan.groupBy({ by: ["engineProvider"] })`; the daily series fetches
scan rows (`scannedAt`, `repo.isPrivate`) and buckets in JS.

## Page & API

| Surface | Behavior |
| --- | --- |
| `src/app/usage/page.tsx` | Auth-gated, org-scoped (`?org=` or active-org cookie). Stat cards (total, period, billable, distinct repos), public-vs-private + provider breakdowns, timeframe picker (`?days=`, default 30, max 365). |
| `GET /api/usage` | `?org=` (default `public`), `?days=`, `?format=json\|csv`. Returns `UsageSummary` JSON, or a CSV/JSON file download. `503` without DB. **IDOR guard:** when auth is on, a private org requires a session with an installation in it; public is readable by any signed-in user. |
| `src/components/usage/UsageTrend.tsx` | Stacked-bar chart (free under billable), dependency-free SVG, auto-scaled label cadence, CSV/JSON export buttons, legend + summary. |

## Key files

| File | Role |
| --- | --- |
| `src/lib/db/usage.ts` | `getUsageSummary()` — totals, provider mix, zero-filled daily series. |
| `src/app/usage/page.tsx` | Usage dashboard. |
| `src/app/api/usage/route.ts` | JSON/CSV usage API with the IDOR guard. |
| `src/components/usage/UsageTrend.tsx` | Stacked-bar trend + export. |

## Known gaps

- **No Stripe wiring yet** — a `Subscription` model exists but billing isn't connected;
  usage is reporting, not invoicing.
- **Single-org attribution** — multi-org installations don't yet attribute usage
  per-repo-owner.
