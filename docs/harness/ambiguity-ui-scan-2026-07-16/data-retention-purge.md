# Data Retention & Purge — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

## 1. Time budget (250s) and route maxDuration (300s) are two magic numbers in two files with an unstated, plan-dependent contract
- **Severity**: High
- **Category**: undocumented-assumption
- **File**: `src/lib/db/retention.ts:41` (and `src/app/api/cron/purge/route.ts:15`)
- **Scenario**: `RETENTION_DEFAULT_TIME_BUDGET_MS = 250_000` exists solely to undercut the route's `maxDuration = 300`, but the two constants live in different files with no shared derivation and no cross-referencing invariant. Worse, the module's whole "stop cleanly before the platform kills us" guarantee assumes the platform actually honors 300s: on Vercel Hobby (or a changed plan/config) the effective function cap can be far lower (e.g. 60s), in which case the 250s budget never trips and every large run is hard-killed mid-delete — exactly the failure mode the budget was built to prevent, now silently reintroduced by a deployment detail.
- **Root cause**: The safety margin is a hardcoded absolute (250s) rather than derived from the route's declared `maxDuration` (or an env contract documenting "budget must be < platform cap"), and the plan-dependence of `maxDuration` is nowhere recorded.
- **Impact**: Editing `maxDuration` (or deploying on a plan that caps it) silently invalidates the budget; runs die with no summary, no 207, no `(budget):` error, and tail orgs starve again with zero alerting.
- **Fix sketch**: Export `PURGE_MAX_DURATION_S` from one place and compute the default budget from it (e.g. `maxDuration * 1000 - 50_000`), or at minimum add a comment in the route next to `maxDuration = 300` stating the coupling and the plan-cap caveat, plus a startup warn when `RETENTION_TIME_BUDGET_MS >= maxDuration * 1000`.

## 2. Destructive per-org overrides have no floor, no dry-run, and no confirmation path — `retentionMaxScans = 1` irreversibly wipes a repo's history
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/lib/db/retention.ts:81-90`
- **Scenario**: `resolveRetention` accepts any non-negative override. A fat-fingered `retentionMaxScans = 1` (meant `100`) or `retentionAuditDays = 1` on an org row causes the next cron tick to permanently delete nearly all scan history and audit trail for that org, batched and committed transaction-by-transaction — unrecoverable by the time anyone notices. The module carefully clamps `batchSize` (line 63-66) but applies zero sanity bounds to the two values that actually destroy data, and there is no dry-run/`report-only` mode to preview what a new policy would delete.
- **Root cause**: The opt-in design ("0 = keep everything") protects the unconfigured case thoroughly (tests pin it), but the configured case assumes the operator's number is always right; that trade-off (no floor, no preview) is not recorded anywhere.
- **Impact**: For an audit/compliance product, a single mistyped integer silently destroys the compliance evidence the product exists to keep; the only trace is the job's own `retention.purged` entry — which is itself subject to the same (mistyped) audit window.
- **Fix sketch**: Add a documented floor (e.g. warn or refuse `maxScansPerRepo < 5` / `auditDays < 7` without an explicit `force` flag), and/or a `dryRun` option on `purgeExpiredData` surfaced via `?dryRun=1` on the cron route that returns would-delete counts without deleting.

## 3. `rotateForTick` "bounded reach within `length` ticks" claim silently assumes exactly one tick per day and a stable org count
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/lib/db/retention.ts:262-269` (seeded at `:305`)
- **Scenario**: The rotation offset is `floor(startedAt / DAY_MS)` — the epoch-day index. The doc-comment promises "every org reaches the front within `length` ticks", but the offset only advances once per calendar day: if the cron is ever scheduled more often than daily (the route itself says only "a daily Vercel Cron" in a comment; `vercel.json` is the real source of truth), all ticks within a day retry the identical prefix and the bound becomes `length` *days*, not ticks. Separately, the modulo is over `orgs.length`: any org created/deleted between ticks changes `n`, so `offset % n` jumps discontinuously and the round-robin bound no longer holds (an unlucky tail org can be skipped repeatedly during org churn).
- **Root cause**: The fairness proof is stated against an idealized fixed-cadence, fixed-population fleet; neither precondition is written down or checked.
- **Impact**: In a growing fleet (the scenario the guard targets), the "bounded worst-case reach" is actually probabilistic again — the exact weakness the comment says the rotation was introduced to eliminate — and retention for tail orgs can lag far beyond `n` days.
- **Fix sketch**: Document both preconditions at `rotateForTick`; derive the offset from a run counter or hours-index matching the real cron cadence, or rotate by `offset % max(n, KNOWN_FLOOR)` keyed to org `createdAt` buckets; simplest durable fix is a persisted cursor (one row), acknowledged in the comment as the rejected alternative without recording why.

## 4. DB-unconfigured returns a green 200 `{skipped}` — retention can be silently disabled in production forever
- **Severity**: Medium
- **Category**: trade-off-undocumented
- **File**: `src/app/api/cron/purge/route.ts:45-47`
- **Scenario**: The route goes to great lengths to make degraded runs non-2xx (207 on `errors`/`stoppedEarly`, 500 on throw) because "Vercel Cron and uptime monitors only watch the HTTP status". Yet `!isDbConfigured()` returns a plain 200 `{ skipped: "Database required." }`. A production deploy that loses/renames `DATABASE_URL` keeps returning green 200s daily while every retention window — the compliance obligation — silently stops being enforced.
- **Root cause**: The skip path predates the "degraded must not be green" invariant added lower in the same handler; the trade-off (200 keeps intentionally DB-less deployments quiet vs. masking a broken prod env) is not recorded.
- **Impact**: Monitors never page; unbounded growth and retention non-compliance resume invisibly, defeating the route's own stated alerting invariant.
- **Fix sketch**: Return 503 (matching the `CRON_SECRET`-unset branch, which already fails closed for the same "misconfigured deploy" reason), or gate the 200-skip behind an explicit `RETENTION_ALLOW_NO_DB=1` for genuinely DB-less deployments and document it.

## 5. `RETENTION_TIME_BUDGET_MS=0` is silently swallowed by `||`, contradicting the module-wide "0 = disabled/unlimited" convention
- **Severity**: Low
- **Category**: magic-number
- **File**: `src/lib/db/retention.ts:283-284`
- **Scenario**: Everywhere else in this module `0` is a documented sentinel ("0 = unlimited / keep everything", parsed by `parseNonNegInt` which deliberately accepts 0). But the budget resolution uses `parseNonNegInt(env) || RETENTION_DEFAULT_TIME_BUDGET_MS`, so an operator who sets `RETENTION_TIME_BUDGET_MS=0` expecting "no budget / run to completion" (the natural reading given the module's own convention) silently gets the 250s default instead. Nothing documents that 0 is invalid here, and there's no way at all to express "unlimited budget".
- **Root cause**: `||` (falsy-coalescing) was used where the rest of the module uses `??` with explicit 0-handling; the divergent 0-semantics were never written down.
- **Impact**: Confusing, untestable-by-operator behavior: one env var in the family treats 0 as "ignored" while its siblings treat 0 as a meaningful sentinel; a self-hosted deployment without a platform kill-timer cannot disable the budget.
- **Fix sketch**: Use `??` and treat `0` as "no budget" (`overBudget` returns false when `timeBudgetMs === 0`), or explicitly document at line 38 that 0/unset both mean the 250s default and why unlimited is refused.
