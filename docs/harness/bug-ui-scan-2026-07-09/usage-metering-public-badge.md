# Usage Metering & Public Badge — bug-hunter + ui-perfectionist scan

> Context: Usage Metering & Public Badge (group: Billing, Credits & Metering)
> Files scanned: 9
> Total: 7 findings (Critical: 0, High: 0, Medium: 5, Low: 2)

This context has clearly been through prior hardening (SSRF/XSS/rate-limit/negative-cache/IDOR
notes are all already addressed in-source), so there are no Criticals or Highs to confirm — the
remaining findings are correctness edges, a page/API inconsistency, and UI polish.

## 1. Fractional `days` param silently drops the newest day from the chart and CSV
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / silent-failure
- **File**: src/app/usage/page.tsx:38 (and src/app/api/usage/route.ts:28, src/lib/db/usage.ts:315)
- **Scenario**: Anyone opens `/usage?days=1.5` (or `/api/usage?org=public&days=1.5&format=csv`). `Math.min(…, Math.max(1, Number(daysParam) || 30))` never floors the value, so `periodDays = 1.5` flows into `getUsageSummary`.
- **Root cause**: `periodDays` is assumed to be an integer. `emptyDailySeries` steps the axis by non-integer offsets (i = 0.5), so it emits only the day for `2026-07-08` while `since` = `2026-07-08 12:00Z`. Today's scans (`2026-07-09`) are counted by the `scan.count` headline queries (they use the same `since`) but their `dayKey` misses the axis `idx`, so they are dropped from `daily`.
- **Impact**: The trend chart and the finance-reconciliation CSV (`toCsv` iterates `summary.daily`) under-report the newest day while the "Last Nd" stat tile counts it — the chart/export disagree with the headline. Anyone hand-editing the URL, and any bookmark with a stray decimal.
- **Fix sketch**: Floor at the boundary: `Math.max(1, Math.floor(Number(daysParam)) || 30)` in both page.tsx:38 and route.ts:28, so `since`, the axis, and the counts share one integer window.

## 2. Public usage page walls anonymous viewers even though the public org is meant to be open
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: authz-inconsistency
- **File**: src/app/usage/page.tsx:24
- **Scenario**: GitHub OAuth is configured (`isAuthConfigured()` true) but no session. An anonymous visitor opens `/usage` intending to see the shared public usage.
- **Root cause**: The blanket `if (isAuthConfigured() && !session)` sign-in wall runs *before* the org is resolved, so it can't special-case `public` the way `canReadOrg` does. But `canReadOrg("public")` returns `true` unconditionally (authz.ts:108) and the sibling `GET /api/usage?org=public` serves anonymous reads via `requireOrgRead`.
- **Impact**: The page contradicts both its own API and its own copy — the access Notice at lines 47–51 literally offers to "view the shared public usage," yet an anonymous viewer can never reach it under OAuth. Feature made unreachable; page is stricter than the API for the same data.
- **Fix sketch**: Resolve `org` first, then gate: only wall when the resolved org isn't `PUBLIC_ORG` — or drop the pre-check entirely and rely on the `canReadOrg(org)` gate already present at line 45, which handles public correctly.

## 3. BadgeGenerator's live preview inflates the Badge-reach analytics with the app's own host
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: data-integrity
- **File**: src/components/badge/BadgeGenerator.tsx:46 (with src/app/api/badge/[owner]/[repo]/route.ts:343)
- **Scenario**: A user types `facebook/react` in the generator with the default Badge=`level`, Style=`flat`. `badgeUrl` builds an empty query string, so the preview `<img>` requests the *canonical* `/api/badge/facebook/react` (no params).
- **Root cause**: `recordBadgeImpression` fires precisely on the non-customized (`!customized`) path, and the generator's default level/flat preview *is* that path. The origin can't distinguish a genuine README embed from the app's own preview image; the referer is the app's own `/badge` page.
- **Impact**: Every default preview mints a real "origin impression" for whatever repo the user types, attributed to the app's own host — polluting `totalImpressions`, `topRepos`, and `topHosts` on the /usage Badge-reach panel (a billing-adjacent metric) with self-traffic.
- **Fix sketch**: Add a preview-only opt-out the tally ignores (e.g. append `&preview=1`, which makes the request `customized` so it is not counted, or skip the tally when `refererHost` equals the request's own origin host).

## 4. "Copied!" is shown even when the clipboard write fails
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: error-state / success-theater
- **File**: src/components/badge/BadgeGenerator.tsx:72
- **Scenario**: User on an insecure-context origin, or one that denies clipboard permission, clicks Copy. `navigator.clipboard?.writeText(snippet)` is neither awaited nor `.catch`-ed; the code unconditionally sets `copied = true`.
- **Root cause**: The success feedback assumes the async write succeeded. When `clipboard` is undefined (optional-chaining short-circuits to `undefined`) or the promise rejects, the button still flips to "Copied!".
- **Impact**: The user believes the embed snippet is on their clipboard, pastes nothing into their README, and is confused — the exact moment this growth-loop feature must be reliable.
- **Fix sketch**: `navigator.clipboard?.writeText(snippet).then(() => setCopied(true)).catch(() => {/* show a "select & copy manually" fallback */})`; only signal success in the resolved branch, and handle the no-clipboard case explicitly.

## 5. A single unpriced model blanks the entire period's cost estimate
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: degraded-correctness
- **File**: src/lib/db/usage.ts:242
- **Scenario**: An org runs 100 scans on a priced model plus one scan on a model absent from `MODEL_PRICES` (a self-hosted / newly-added model). `estimateLlmCostFromTable` hits `if (!price) return null`, so the whole fold returns null.
- **Root cause**: The all-or-nothing rule is correct for the *billing* half-bill trap it cites, but it is over-applied to the *display* estimate: it treats "one unknown model" as "no estimate at all," discarding the priceable majority.
- **Impact**: The /usage "Est. cost" tile silently shows "—" and the footer says "no built-in rate matches" for an org whose spend is 99% priceable — the cost view vanishes exactly when the fleet is mixed.
- **Fix sketch**: Return the priced subset plus a flag (e.g. `{ cost, unpriced: n }`), and have the UI render `$X` with a "excludes N scans on unpriced models" footnote instead of hiding the whole figure.

## 6. Free-only bars have square tops while billable-topped bars are rounded
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: visual-consistency
- **File**: src/components/usage/UsageTrend.tsx:76
- **Scenario**: A day with only public (free) scans renders just the free `<div>`, which has no `rounded-t-sm`; a day with any billable scans caps the column with a rounded top. Adjacent bars in the same chart end with mismatched corners.
- **Root cause**: `rounded-t-sm` lives only on the billable segment (line 77). The topmost visible segment should carry the rounding regardless of which series it is.
- **Impact**: Inconsistent bar caps across the trend — the kind of pixel mismatch that reads as unpolished on the lead chart of the billing page.
- **Fix sketch**: Apply `rounded-t-sm` to whichever segment is topmost — e.g. add it to the free `<div>` when `d.billable === 0`, or wrap both in a `rounded-t-sm overflow-hidden` column.

## 7. The "free/public" slate is a hardcoded hex, not a token, repeated across files
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: design-system-adherence
- **File**: src/components/usage/UsageTrend.tsx:10
- **Scenario**: `FREE = "#94a3b8"` sits beside `BILLABLE = "var(--color-accent)"` — one series uses a token, the other a raw hex. The same `#94a3b8` is duplicated in usageDashboard.tsx:151 for the "Public (free)" bar.
- **Root cause**: No shared token for the "free/public" series color, so the value is copy-pasted and can drift between the two panels that must agree.
- **Impact**: A future theme tweak to the free-series color must be found and changed in multiple raw-hex sites; risk of the trend chart and the Public/private bar disagreeing.
- **Fix sketch**: Introduce a `--color-usage-free` (or reuse an existing slate token) and reference it in both UsageTrend and usageDashboard so the billable/free pair is fully tokenized.
