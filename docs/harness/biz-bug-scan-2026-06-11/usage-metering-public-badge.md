# Usage Metering & Public Badge — business-visionary + bug-hunter scan (2026-06-11)
> Total: 4 findings (3 bug / 1 business)

Context: since the prior (06-08/06-09) scans, a real **prepaid scan-credit ledger** landed
(`src/lib/db/credits.ts`, `src/lib/entitlement.ts`, `/api/org/credits`). The `/api/scan`,
`/api/org/scan`, `/api/org/import`, and `/api/cron/rescan` paths now reserve/debit credits. This
new currency is the actual billing mechanism — but the `/usage` "billing" page and the metering
math have not caught up to it. The four findings below sit on that seam. Verified against current
source; the prior DEFERRED items (usage #5 mock-billable count, USE-6 range picker, PERS-2 Stripe)
are left untouched.

## 1. The billing page never shows the prepaid credit balance, low-balance warning, or top-up path
- **Type**: business
- **Severity**: High
- **Category**: monetization / retention
- **File**: src/app/usage/page.tsx:154-174 (Stat grid); data via src/lib/db/credits.ts:34 `getCreditState`; precedent src/app/org/[slug]/layout.tsx:100
- **Scenario**: The job-to-be-done for an org admin on `/usage` is "how am I doing against my plan, and am I about to be cut off?" The actual billing currency is now prepaid credits: a private scan debits one credit (`consumeScanCredit`), and a depleted org gets a hard `402 INSUFFICIENT_CREDITS` paywall (`entitlement.ts:36`). Yet `/usage` shows only scan *counts*, token sums, and an LLM-spend estimate — it never reads `getCreditState(org)`, so the page that exists to answer "what's my billing status" omits the one number that gates whether scans keep working. The org dashboard header already renders a credit chip (`layout.tsx:100`); the dedicated billing page does not.
- **Root cause / Opportunity**: The credit ledger shipped after the `/usage` page's last iteration, so the page still reflects the older "counts only" model. The data is one `getCreditState(org)` call (already used elsewhere, DB-less-safe). Surfacing balance + a runway/low-balance nudge converts the billing page from a passive report into a proactive top-up funnel.
- **Impact**: Today an admin discovers they're out of credits only when scans start failing with a 402 — the classic silent-runway churn moment. A "Credits remaining: N · ~M days at current burn" Stat plus an amber "Low balance — add credits" notice (and a CTA when `ASCENT_ALLOW_CREDIT_GRANTS`/the future Stripe flow is enabled) turns a churn surprise into a self-serve revenue moment, exactly where the buyer is already looking.
- **Fix sketch**: In `src/app/usage/page.tsx`, after loading `usage`, call `getCreditState(org)` (skip for `PUBLIC_ORG`, which is free — mirror `layout.tsx:100`). Add a "Credits remaining" Stat to the grid at lines 162-174 (show "Unlimited" when `state.unlimited`), and derive an optional runway from `usage.privateScans` over `periodDays` as a daily burn rate. When `!unlimited && balance` is below a small threshold (e.g. ≤ the period's burn), render an `EmptyState`/inline notice with a top-up CTA. No new deps; pure server-component read.
- **Effort**: 2/10 · **Impact score**: 8/10

## 2. Metered scan runs paid inference for free when the credit debit silently fails (`ok:false` ignored)
- **Type**: bug
- **Severity**: High
- **Category**: race-window / silent-failure (revenue leak)
- **File**: src/app/api/scan/route.ts:180-190; debit contract src/lib/db/credits.ts:93-127
- **Scenario**: A metered private scan does check-then-act: `checkScanEntitlement` up front (route.ts:117, allowed when `balance > 0`), then runs inference, then `consumeScanCredit` (route.ts:182). `consumeScanCredit` is correctly atomic — its conditional decrement (`updateMany WHERE scanCredits > 0`) returns `{ ok: false }` and debits nothing when the balance is already 0. But the route never reads `debit.ok`: it only pulls `debit.balance` for a response header (route.ts:189). So with `balance === 1` and two concurrent metered scans, both pass the up-front entitlement check, both run a full GitHub ingest + LLM completion, the first debit wins (balance→0, ok:true), and the second gets `ok:false` — its paid inference is delivered to the user with no charge. N concurrent scans on a 1-credit org yield N−1 free paid scans.
- **Root cause / Opportunity**: The atomic decrement was built to prevent a negative balance, but the caller treats it as fire-and-forget. The gap between the optimistic `checkScanEntitlement` read and the conditional debit is unguarded, and the one signal that closes it (`ok`) is discarded.
- **Impact**: Direct under-billing / revenue leak on the paid private-scan path; an org can also be driven repeatedly to exactly 0 and keep extracting free scans by firing concurrent requests. Silent — nothing logs the unbilled scan.
- **Fix sketch**: In `src/app/api/scan/route.ts` at the debit block (180-190), branch on `debit.ok`: when `debit && !debit.ok`, log a reconciliation warning (`[scan] metered scan ran but debit failed — unbilled`, with repo + scanId) so the leak is observable, and consider stamping a `x-ascent-unbilled: true` header. (Mirror the same `ok` check in `/api/org/scan` route.ts:119 and `/api/org/import` route.ts:163, which use the identical `.catch(() => null)` shape.) Pure logic change; compiles + builds. A vitest can cover `consumeScanCredit`'s `ok:false` path with a mocked prisma (same pattern as `entitlement.test.ts`); the concurrent race itself needs a live DB to reproduce, but the fix is review- and tsc-verifiable.
- **Effort**: 2/10 · **Impact score**: 7/10

## 3. `/usage` page allows `days=365` for the public org that `/api/usage` was hardened to cap at 90
- **Type**: bug
- **Severity**: Medium
- **Category**: unbounded-lookup / incomplete-fix
- **File**: src/app/usage/page.tsx:65 vs src/app/api/usage/route.ts:41
- **Scenario**: A prior pass hardened the JSON API so the *unauthenticated public* org can't force a 365-day, ~10-aggregate + `$queryRaw` full-window scan as a cheap DoS lever — `route.ts:41` caps it: `Math.min(orgLc === "public" ? 90 : 365, …)`. But the page renders the identical summary by calling `getUsageSummary(org, days)` *directly* (server component, `force-dynamic`), and its clamp at `page.tsx:65` is the old uniform `Math.min(365, Math.max(1, Number(daysParam) || 30))` — no public-org tightening. So `GET /usage?org=public&days=365` still runs the exact 365-day aggregate the API path now refuses, through a route that is anonymous whenever auth is unconfigured (the auth-off public funnel) and otherwise reachable by any signed-in viewer. The fix landed on one of two twin entry points.
- **Root cause / Opportunity**: The hardening was applied to `route.ts` only; the page computes the same heavy summary on its own and was never brought in line. Two entry points to one expensive query, clamped inconsistently.
- **Impact**: The DoS/cost lever the API closed remains open via the page URL — repeatable unauthenticated (auth-off) or low-friction (auth-on) heavy DB load on the shared `public` org.
- **Fix sketch**: In `src/app/usage/page.tsx:65`, mirror the API: `const cap = org.toLowerCase() === PUBLIC_ORG ? 90 : 365; const days = Math.min(cap, Math.max(1, Number(daysParam) || 30));`. Note `org` is resolved a few lines below the current clamp, so move the `days` computation after `org` is known (or recompute the cap there). `PUBLIC_ORG` is already imported. One-line-equivalent change; tsc + next build verify.
- **Effort**: 1/10 · **Impact score**: 5/10

## 4. "Top repositories · by metered scans" counts FREE public scans as metered volume
- **Type**: bug
- **Severity**: Medium
- **Category**: data-correctness / edge-case
- **File**: src/lib/db/usage.ts:114-121 (byRepo groupBy) and :145-149 (mapping); rendered src/app/usage/page.tsx:213-231 (header line 217)
- **Scenario**: The `byRepo` aggregate groups scans by `repoId` over `periodWhere` with **no `isPrivate` filter** (usage.ts:114-121), then the panel renders them under "Top repositories · by metered scans" with a per-repo token figure (page.tsx:217-226). But "metered/billable" is defined everywhere else on this page as private-only (`billable = usage.privateScans`, page intro "private scans are billable"). On `/usage?org=public` — fully reachable, all scans free — the panel lists public repos labeled as the top "metered" spenders, which is categorically wrong; on a mixed org it over-attributes billable volume to any repo that also accrued free public scans.
- **Root cause / Opportunity**: `byRepo` reuses the period filter but skips the private predicate that the sibling `privateScans`/`publicScans` counts apply, so its "metered" framing doesn't match its data.
- **Impact**: A finance/eng-lead reading the bill-attribution panel ("which repos drove the metered spend?") gets free public scans mixed into the answer — wrong attribution on the exact panel built to answer that question.
- **Fix sketch**: In `src/lib/db/usage.ts:114-121`, scope the `byRepo` groupBy `where` to private repos to match the "metered" label — `where: { ...periodWhere, repo: { orgId: org.id, isPrivate: true } }` (the same shape the `priv` count uses at :103). Alternatively keep all repos but relabel the panel to "by scan volume" and add a per-repo billable/free split. ~5-15 LOC; tsc + vitest (the existing `usage.test.ts` can assert byRepo excludes public scans).
- **Effort**: 2/10 · **Impact score**: 5/10
