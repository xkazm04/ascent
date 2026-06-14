# Feature Scout Fix — Mediums Wave G · CI-gate + metering hygiene (complete: 4/4 actionable)

> Trust + tech-debt: richer gate detail, one rate limiter, ledger reconciliation, and quota
> observability. 1 additive migration. Baseline preserved: `tsc` 0; **vitest 457/457**; eslint 0;
> `next build` ✓ (EXIT 0).

## Commits

| Finding | Commit | What shipped |
|---|---|---|
| QUOTA #5 — dedup badge limiter | `8512cec` | The badge route's bespoke in-memory limiter (`hits`/`rateLimited`/`clientIp`) is replaced by the shared `rateLimitRequest` + a new `BADGE_RATE_LIMIT` config, preserving the "render a 'rate limited' SVG, not a 429 body" behavior. |
| USE #4 — ledger reconciliation | `0a94f15` | `getCreditReconciliation(org, days)` (debited / refunded / granted / net, windowed server-side) + a "Reconciliation" panel on /usage for non-public orgs. |
| CIGATE #4 — per-dimension gate detail | `db72a01` | A failing PR gate comment now appends a "Where the score falls short" table — each dimension below its floor (re-derived from `report.dimensions` + policy) with score → required + its top gap. |
| QUOTA #6 — quota/rate-limit observability | `44022d3` | A `QuotaEvent` counter table (migration) + `recordQuotaEvent`, bumped fire-and-forget on the weekly-quota denial + the badge rate-limit trip; an "Abuse & limits" panel on the public /usage view. |

## Already done (verified, not re-built)

- **CIGATE #5 — gate status-badge.** The badge route already has a `?gate=1` mode (added with GATE-1)
  that renders a green "✓ pass" / red "✗ fail" shield. The finding (scanned pre-GATE-1) is satisfied.

## What was fixed

- **QUOTA #5 — one limiter.** Two copies of the sliding-window limiter had drifted; the badge route now
  uses the shared one (env-overridable, with a per-instance global ceiling it lacked before).
- **USE #4 — does billed line up with debited?** /usage now reconciles metered private scans against
  the ledger for the period — debits, refunds (failed/deduped scans return their credit), grants, net —
  with a note explaining any gap (unlimited-plan scans, grants, window-edge rows).
- **CIGATE #4 — actionable gate.** A failing Check Run / sticky comment carries the per-dimension table
  a reviewer needs (which dims, how far below, the top gap) without opening the full report.
- **QUOTA #6 — guardrail visibility.** Quota denials + rate-limit trips were invisible; a small counter
  table + a public /usage panel show how often the free funnel pushes back (and whether a limit needs
  tuning). Best-effort writes only at the two DB-aware deny sites; the pure burst limiter stays DB-free.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | 457/457 (54 files; +1 init-sql parity case for `QuotaEvent`) |
| `init-sql.test.ts` parity | 29/29 (new `QuotaEvent` model + table mirrored) |
| eslint (changed) | 0 errors |
| `next build` | ✓ EXIT 0 |

## Patterns reinforced

- **Consolidate drifted copies** (QUOTA #5): a second hand-rolled limiter is a liability; route it
  through the shared primitive with a named config.
- **Window in the data layer to keep the page pure** (USE #4): `getCreditReconciliation` does the
  date math server-side so the /usage server component doesn't call `Date.now()` in render (the
  `react-hooks/purity` rule flags that).
- **Re-derive structured detail, don't parse messages** (CIGATE #4): the per-dimension table comes from
  `report.dimensions` + the policy floors, not from scraping the failure strings.
- **Instrument deny sites, not hot paths** (QUOTA #6): record fire-and-forget only when a guardrail
  fires (rare), at DB-aware sites; leave the intentionally-DB-free in-memory limiter alone and say so.

## What remains (from the INDEX)

Medium waves F (exec/sharing/exports), H (live-ops polish) + the 4 lows. Stripe (CRED-1/CRED-3) +
notifications/email stay excluded.
