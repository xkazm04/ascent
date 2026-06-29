# Org Import, Scan & Watchlist — Bug + UI Scan
> Context: Org Import, Scan & Watchlist (Org Scanning & Fleet Rollups)
> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. Cron rescan charges credits the manual scan path waives (BYOM + public org)
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure
- **File**: src/app/api/cron/rescan/route.ts:106 (vs src/app/api/org/scan/route.ts:56-57,122)
- **Value**: impact 8 · effort 3 · risk 4
- **Scenario**: An org is on a metered (non-unlimited) plan but uses BYOM (its own Bedrock — inference billed to its AWS). A user clicks "Scan all watched": `scan/route.ts` computes `byom = isByomActive(org)` and `metered = org !== "public" && !byom`, so it skips `reserveScanCredit` entirely — correct, the scan is free. The *scheduled* autoscan of the same repos runs through `cron/rescan/route.ts`, which calls `reserveScanCredit(r.orgSlug, r.fullName)` unconditionally — no BYOM check, no `public` check. `consumeScanCredit` only knows about unlimited plans + monthly allowance (confirmed in src/lib/db/credits.ts:180-235), so for a BYOM/metered org it debits a platform credit per autoscan, and once the platform balance hits 0 it returns `skip` → every scheduled scan is silently dropped (`skippedForCredits++`, return). The shared `public` org (created with `plan:"private"`, org-watch.ts:34) is likewise metered here but free in the route, so public scheduled repos never autoscan.
- **Root cause**: The metered predicate (`!byom && org !== "public"`) lives only in the route; the cron path reimplements the reserve→scan→refund loop but omits that predicate. `reserveScanCredit` is a pure ledger primitive and was never meant to be the policy gate.
- **Impact**: Money error — BYOM customers are charged platform credits they explicitly shouldn't pay; worse, a 0-balance BYOM/public org has its entire continuous-tracking flow silently disabled (the feature's whole point) with only an internal `skippedForCredits` counter to show for it.
- **Fix sketch**: Resolve `byom` once per cron run (like the route does, e.g. memoized per org alongside `tokenByOrg`) and gate the reservation: `const metered = r.orgSlug !== "public" && !byomByOrg.get(r.orgSlug); if (metered) { ...reserve... }`. Better: extract the `metered` decision into one shared helper (`isMeteredScan` already exists in entitlement.ts) and have all three fleet paths call it.

## 2. Org-import runs setRepoWatch concurrently, racing the lazy org upsert and refunding a real scan
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/app/api/org/import/route.ts:193-244 (setRepoWatch 221, refund 237) · src/lib/db/org-watch.ts:30-66
- **Value**: impact 6 · effort 4 · risk 4
- **Scenario**: A first-ever import of a brand-new org runs `mapPool(fullNames, SCAN_CONCURRENCY=4, …)`. Inside each lane, after a successful billable scan + `persistScanReport`, the lane calls `setRepoWatch` → `ensureOrg` → `organization.upsert({ where:{slug} })`. The org row doesn't exist yet, so the first ~4 concurrent lanes all find-then-insert the same slug and one (or more) loses to a unique-constraint violation (P2002). The sibling route deliberately avoids exactly this: `watch/route.ts:43-44` says "Writes are sequential so the lazy Organization upsert inside setRepoWatch can't race itself." Because `setRepoWatch` sits *inside* the per-repo `try`, the P2002 is caught (line 235), `refundCredit()` runs, and the repo is emitted as `{ error }` — even though its real-inference scan already ran and was persisted.
- **Root cause**: The import path parallelized the scan loop (correct for scans) but the loop also performs the lazy org-creating write that the codebase elsewhere keeps serial.
- **Impact**: On a fresh org's first import: a genuinely billable, persisted scan is reported as a failure and its credit refunded (revenue leak), and the dashboard shows a scored repo flagged "error" (state inconsistency). Bounded to the narrow first-creation window, but it hits the most common path (a new customer's first import).
- **Fix sketch**: Create the org once before the pool (`await ensureOrg(org)` / a single `setRepoWatch` warm-up), or move the watchlist/schedule writes out of the scan `try` so a watchlist failure can't refund/falsely-fail a successful scan, or run them after the pool in a serial pass.

## 3. Import `repos[]` has no length cap — unbounded GitHub ingests per request
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/app/api/org/import/route.ts:79,152-171 (vs src/app/api/org/watch/route.ts:17,48)
- **Value**: impact 5 · effort 1 · risk 2
- **Scenario**: The `Math.min(100, …)` cap at line 79 applies only to `count` (the `listOrgRepos` discovery path). When the caller supplies an explicit `repos[]`, every entry becomes a `fullNames` row with no length limit; the metered slice (lines 181-185) caps only metered, non-unlimited orgs. So on the anonymous mock/public funnel (or an unlimited plan), a single POST with `repos: [...1000 entries...]` drives 1000 `scanRepository` calls — each a real GitHub snapshot fetch even in mock mode (per the route's own header comment) — at concurrency 4 until the 300s ceiling. The request rate-limit caps *requests*, not the fan-out *within* one request.
- **Root cause**: The bulk fan-out trusts client-supplied list length; the sibling `watch` route already learned this lesson with `MAX_BULK = 500` + `.slice(0, MAX_BULK)`.
- **Impact**: An anonymous caller can amplify one allowed request into hundreds of GitHub ingests (rate-limit/IP-reputation burn, function-time exhaustion). No crash, but a cheap resource-amplification surface on a deliberately-anonymous endpoint.
- **Fix sketch**: After building/validating `fullNames`, `fullNames = fullNames.slice(0, MAX_BULK)` (reuse the watch route's 500, or the 100 already used for `count`) and surface the truncation like the credit cap does.

## 4. claimRescan advances to full cadence before scanning — a cron timeout loses claimed repos
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: recovery-gap
- **File**: src/app/api/cron/rescan/route.ts:28,84,135-148 · src/lib/db/org-watch.ts:192-215
- **Value**: impact 5 · effort 4 · risk 4
- **Scenario**: Each lane calls `claimRescan(repoId, schedule)`, which sets `nextScanAt = now + cadence` *before* the scan runs (correct, to block double-scan). The retry-soon backoff (`advanceScheduleAfterFailure`, 6h) is applied only in the `catch` block — i.e. only when `scanRepository` *throws*. But the route declares `maxDuration = 300`; with `listDueRescans` returning up to 100 repos at concurrency 4 and slow LLM latency, the function can hit its wall-clock ceiling mid-pool. Repos already claimed but not yet scanned have had `nextScanAt` pushed a *full cadence* out, yet were never scanned and never entered the catch — so they silently wait a whole cadence (a month, for `monthly`) before becoming due again.
- **Root cause**: Claim-before-work optimizes for double-scan safety but conflates "claimed" with "successfully rescheduled for next cadence"; the process-death/timeout path between claim and scan is unhandled.
- **Impact**: Silent gaps in continuous tracking on large or slow fleets — affected repos miss an entire cadence with no error surfaced (the run returns normally for the repos it *did* finish).
- **Fix sketch**: Claim with a short lease (advance `nextScanAt` only a few minutes), then advance to the full cadence on success; or cap `listDueRescans`/lanes to a count that comfortably fits the budget; or record an in-progress marker cleared on completion so a timed-out claim re-qualifies on the next pass.

## 5. Long org scan has no live region — progress and partial outcome are silent to screen readers
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: a11y
- **File**: src/components/org/OrgScanButton.tsx:106-130
- **Value**: impact 4 · effort 2 · risk 1
- **Scenario**: "Scan all watched" is a long-running (potentially minutes) operation. The progress meter + `current` repo text (106-111) and the terminal "{n} repos failed" / "{n} repos skipped — out of scan credits" messages (120-129) render as plain elements with no `role="status"`/`aria-live`. A keyboard/AT user who triggers the scan and tabs away gets no announcement that it progressed, finished, partially failed, or was capped for credits — the exact partial-outcome states this component was built to make visible. The button label updates ("Scanning {done}/{total}…") but is only announced if focus stays on it.
- **Root cause**: Status surfaced visually only; no assertive/polite live region for the async lifecycle.
- **Impact**: AT users can't tell a long fleet scan succeeded vs. silently scanned fewer repos (out of credits) — the "truncated paid run must not read as success" intent (component docstring) is lost for them.
- **Fix sketch**: Wrap the progress + outcome block in a container with `role="status" aria-live="polite"` (and `aria-atomic`), so each state change (progress, failed, skipped, error) is announced; keep the meter `aria-hidden` and let the text carry the announcement.
