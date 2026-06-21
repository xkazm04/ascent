> Total: 6 findings (1 critical, 1 high, 1 medium, 3 low)

# Usage Metering & Public Badge — combined bug+ui scan

## 1. /usage page leaks any org's usage via `?org=` (IDOR the API guards but the page does not)
- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: authorization / multi-tenant data leak
- **File**: src/app/usage/page.tsx:77-132
- **Scenario**: Auth is configured and a user is signed in. They open `/usage?org=competitor-org`. `org = orgParam || getActiveOrg(session)` takes the raw query slug. The only org guard on the page is `if (!isAuthConfigured() && org !== PUBLIC_ORG)` (line 87), which is FALSE when auth is configured, so the slug flows straight into `getUsageSummary(org, days)` (and `getBadgeReach(org)`, `getCreditState(org)`, `getCreditReconciliation(org)`). The page renders the other tenant's scan volume, per-repo names + token spend (`byRepo`), estimated cost, credit balance/runway, and badge-reach hosts.
- **Root cause**: The sibling API route `/api/usage` explicitly enforces `session.installations.some((i) => i.login.toLowerCase() === orgLc)` and 403s otherwise (route.ts:71-76). The page — which "computes the same summary directly" per its own comment — omits that exact membership check. The page assumed the only sensitive split was auth-on vs auth-off, but with auth ON the per-org membership check is still required.
- **Impact**: Cross-tenant data disclosure (security): an authenticated user enumerates org slugs and reads any org's billable volume, repository inventory, token/cost spend, and credit balance — direct competitive/financial intelligence leak.
- **Fix sketch**: After resolving `org`, when `org.toLowerCase() !== PUBLIC_ORG`, require a session whose `installations` include it (mirror route.ts:67-76): if `!session || !session.installations.some((i) => i.login.toLowerCase() === org.toLowerCase())`, render an access notice (or fall back to the active/public org) instead of querying the requested org.

## 2. Trend chart total can disagree with the headline billable/period stats (future-dated or skewed scans dropped only from the series)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: metering correctness / consistency
- **File**: src/lib/db/usage.ts:266-305 (and buildDailySeries:319-334)
- **Scenario**: The period counts (`periodScans`, `privateScans`, `publicScans`) use `scannedAt: { gte: since }` with NO upper bound (usage.ts:106, 112-113), so a scan whose `scannedAt` is at/after today's UTC day (clock skew, backfill, a row dated slightly ahead) is COUNTED. But the daily series axis ends at today's UTC day (`emptyDailySeries`), so `fetchDailySeries`/`buildDailySeries` does `idx.get(row.day)` → `undefined` for that future day and silently drops it (lines 286-288, 327-328). The `UsageTrend` header sums `daily` ("N billable · M free", UsageTrend.tsx:14-15) while the `Stat` tiles read the COUNT (`billable = usage.privateScans`, page.tsx:158). The two numbers diverge with no explanation.
- **Root cause**: The window is half-open below (`>= since`) but unbounded above, yet the chart axis is bounded above at "today". Counts and the series therefore use different effective windows for any scan dated ahead of the anchor day.
- **Impact**: UX/trust on a billing page — the trend total and the "Billable (private)" stat show different figures for the same period, undermining confidence in the metering numbers (and under-reporting on the chart).
- **Fix sketch**: Add an upper bound to the period predicate and the series query so both share the same window — e.g. `scannedAt: { gte: since, lt: new Date(todayUtcMs + 86_400_000) }` for the counts, and the matching `s."scannedAt" < <tomorrowUtc>` in the raw query / JS fallback. Then any in-window scan is both counted and bucketed.

## 3. Per-day trend bars are inaccessible — tooltip-only data with no SR/keyboard alternative
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/usage/UsageTrend.tsx:65-91
- **Scenario**: Each day is a `<div class="cursor-help" title="2026-06-12: 3 billable, 2 free">` containing two bare colored `<div>`s. The per-day values exist ONLY in the native `title` tooltip, which is unavailable to screen readers and to keyboard/touch users (no focus, no hover). There is no `role`, no `aria-label`, and no off-screen data table. The chart conveys the page's primary metric (computed scans per day) entirely visually.
- **Root cause**: The chart was built as a dependency-free decorative SVG-style stack; the data was never exposed in an accessible form (unlike the page's other panels which render readable text + numbers).
- **Impact**: WCAG 1.1.1 / 4.1.2 failure — SR and keyboard-only users get no usage timeline at all on the metering page.
- **Fix sketch**: Give each bar `tabIndex={0}` + `role="img"` + `aria-label={`${d.date}: ${d.billable} billable, ${d.free} free`}`, or add a visually-hidden `<table>` summarizing the daily series alongside the bars (the CSV already has the shape).

## 4. BadgeGenerator accepts repo names the badge endpoint rejects (snippet always renders "unknown")
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: validation parity / UX
- **File**: src/components/badge/BadgeGenerator.tsx:18-21
- **Scenario**: The generator validates owner/repo with `/^[A-Za-z0-9_.-]+$/` only. A user types `owner/.git` or `owner/a..b` — the generator treats it as valid, shows a "live preview" `<img>`, and emits a copy-paste snippet. The badge route's `validName` additionally rejects a leading dot and any `..` (route.ts:37-42), so the endpoint returns the neutral "unknown" badge. The user copies a snippet that permanently renders "unknown" with no hint why.
- **Root cause**: The client parser is a strict-subset of the server grammar; the leading-dot / consecutive-dot rules the server enforces were not mirrored client-side.
- **Impact**: Minor UX — a confidently-generated badge snippet that never resolves; user-facing only, no security impact (server still rejects).
- **Fix sketch**: Mirror the server's extra rules in `parseRepo` (reject `startsWith(".")` and `includes("..")` for both segments) and surface the same "Enter a valid repository" message, so the preview/snippet only appear for names the endpoint will actually resolve.

## 5. Mock-engine score badge can present a `score/100` headline with no "demo" qualifier on the number itself
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: data honesty / consistency
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:319-351
- **Scenario**: A repo with only a deterministic (mock) cached report is badged with `?metric=score`. The endpoint marks the LABEL `"Ascent · demo"` (line 325) but the VALUE renders `${glyph} ${report.overallScore}/100` (line 348) — a precise numeric "63/100" headline. README consumers (and camo/CDN scrapers) frequently crop or restyle badges to the value side; the credible-looking number then circulates detached from the small "· demo" label, presenting the deterministic floor as a real AI score.
- **Root cause**: The "· demo" honesty marker is attached only to the label, not carried into the numeric value, even though the value is the part that reads as an authoritative metric.
- **Impact**: Minor data-honesty/branding risk — a deterministic-floor number can be mistaken for a real LLM score once separated from the label.
- **Fix sketch**: For mock reports in score mode, either suppress the precise number (show the level glyph/band, as the level badge already does) or append the qualifier to the value (e.g. `63/100 demo`), so the honesty marker travels with the figure that gets quoted.

## 6. Empty/refund reconciliation note can show a misleading equality when grants are involved
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: copy/consistency
- **File**: src/app/usage/page.tsx:268-273
- **Scenario**: The reconciliation footnote renders when `billable !== recon.debited - recon.refunded`. With unlimited-plan scans or grants, `debited - refunded` legitimately differs from `billable`, and the note explains it. But `Math.max(0, recon.debited - recon.refunded)` clamps a negative net (more refunds than debits, e.g. a refunded-then-not-rebilled batch) to `0`, so the sentence reads "X billable scans vs 0 net credits debited" even when the ledger net is negative — hiding the sign and the actual discrepancy from a finance reader reconciling the period.
- **Root cause**: The clamp was added to avoid showing a negative count in prose, but it erases a real (negative) reconciliation state instead of conveying it.
- **Impact**: Minor — a finance user reconciling credits sees "0" where the true net debited is negative, obscuring an over-refund situation.
- **Fix sketch**: Drop the `Math.max(0, …)` and render the signed value (or branch the copy for the negative case, e.g. "net refunds exceeded debits by N"), so the note reflects the actual ledger direction.
