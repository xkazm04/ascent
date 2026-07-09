# Org Import, Scan & Watchlist — bug-hunter + ui-perfectionist scan

> Context: Org Import, Scan & Watchlist (group: Org Scanning & Fleet Rollups)
> Files scanned: 16
> Total: 8 findings (Critical: 0, High: 1, Medium: 6, Low: 1)

## 1. Manual scan + import have no per-repo lock — concurrent runs double-scan and double-charge
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/app/api/org/scan/route.ts:118
- **Scenario**: An owner clicks "Scan all" in two tabs (or a second member scans while a first still runs, or a scan overlaps an import) for an org with ample credits. Both requests call `listWatchedRepos` → `mapPool` over the same repos with no ownership claim.
- **Root cause**: The cron path guards each repo with `claimRescan` (atomic lease), but `/api/org/scan` and `/api/org/import` (route.ts:208) have NO equivalent claim. The per-credit `reserveScanCredit` only bounds total spend against the balance — it does not stop the *same repo* being scanned by two runs. If the balance is ample, each run debits a credit and runs `scanRepository` (real LLM tokens) for every repo.
- **Impact**: Money loss — duplicate credit debits + duplicate LLM token burn across a whole org. The commit-dedup refund only helps if one persist lands before the other's `scanRepository` starts; under true concurrency both bill.
- **Fix sketch**: Add a `claimRescan`-style short-lease claim (or a per-(org,repo) advisory lock) before reserving/scanning in both manual routes; skip a repo already claimed by an in-flight run.

## 2. /api/org/active gates on the DORMANT custom-OAuth session — org switch breaks under the Supabase wall
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: dormant-auth
- **File**: src/app/api/org/active/route.ts:42
- **Scenario**: On a Supabase-auth deployment (`authGateEnabled()` true, custom OAuth unconfigured), a signed-in user picks their real org "acme" in the header switcher. The route validates `requested` against `orgOptionsForSession(await getSession())`.
- **Root cause**: `getSession()` reads the dormant custom-OAuth cookie; with `isAuthConfigured()` false it returns null, so `orgOptionsForSession(null)` yields only `["public"]`. The active viewer (`getViewer()`) and their real orgs are never consulted — authorization is resolved off the dead auth layer.
- **Impact**: Every real org is rejected as "Unknown org" (400); the active-tenant cookie can only ever be set to "public", so the whole app's tenant context can't be switched or persisted under the active auth mode.
- **Fix sketch**: Resolve selectable orgs from the active path (`getViewer()` + `canReadOrg`/membership) when `authGateEnabled()`, mirroring the sibling routes' `requireOrgAccess`.

## 3. Reserve-before-scan has no durable compensation — a mid-scan timeout charges for nothing
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: missing-rollback
- **File**: src/app/api/cron/rescan/route.ts:122
- **Scenario**: The cron (or a bulk manual run) reserves a credit at route.ts:123, then `scanRepository` runs at :141. The 300s `maxDuration` is hit (or the serverless instance is OOM-killed / redeployed) mid-scan.
- **Root cause**: The refund is only reachable through the `catch` block (:159-161). A process *kill* is not a thrown error — it bypasses `catch` entirely, so the already-committed `consumeScanCredit` debit is never compensated. The design assumes "a failed scan always reaches our refund," which is false for process termination.
- **Impact**: Money loss to the customer — a credit is durably debited with no persisted scan result, unattended, on every timeout/crash. Same shape in scan/import (route.ts:127, :216).
- **Fix sketch**: Persist scan attempts as pending-and-refundable (reconcile on next run), or move the debit to *after* `persistScanReport` succeeds using the atomic gate as the only pre-check.

## 4. Autoscan cadence anchors on run time, not the scheduled slot — schedule drifts later every cycle
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: clock-timezone
- **File**: src/lib/db/org-watch.ts:11
- **Scenario**: A "weekly" repo is scanned; `advanceToFullCadence` → `nextScanFor("weekly")` sets `nextScanAt = new Date(Date.now() + 7*86_400_000)` — anchored to when the cron *caught* it, not the intended slot.
- **Root cause**: Cadence is computed relative to `Date.now()` at settle time. Since a repo only becomes due after `nextScanAt`, and the daily cron catches it some hours late, each cycle adds that catch-latency + scan duration — cumulative forward drift. `monthly` is also a flat 30 days, not a calendar month.
- **Impact**: A "weekly" scan creeps to arbitrary later times/days over months; SLAs and digest timing become unpredictable. Degraded correctness, no data loss.
- **Fix sketch**: Anchor the next slot to the prior `nextScanAt` (`prev + cadence`) rather than `now`, catching up missed slots to the next future boundary; consider calendar-month arithmetic for `monthly`.

## 5. Cron secret accepted as a URL query param — leaks into access logs
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: security
- **File**: src/app/api/cron/rescan/route.ts:41
- **Scenario**: The route accepts auth via `?key=<CRON_SECRET>` in addition to the `Authorization: Bearer` header (:42), and compares with `!==`.
- **Root cause**: Query strings are routinely persisted verbatim in Vercel/CDN/proxy access logs (CWE-598: secret in URL). The `key` path puts the long-lived shared secret into plaintext log storage; `!==` is also non-constant-time.
- **Impact**: Security — anyone with log access recovers the cron secret and can trigger token-minting, credit-spending fleet scans. (Fail-closed on an unset secret at :34-39 is correctly handled.)
- **Fix sketch**: Drop the `key` query param (Bearer header only, as Vercel Cron sends), or hash it; compare with a constant-time `timingSafeEqual`.

## 6. Import route omits the BYOM exemption — BYOM orgs are double-charged on a real import
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: billing-inconsistency
- **File**: src/app/api/org/import/route.ts:135
- **Scenario**: An org running on its own Bedrock (BYOM) triggers a real (`mock:false`) import. `metered = !mock && org !== "public"` — with no BYOM check.
- **Root cause**: `/api/org/scan` (route.ts:60-61) and `/api/cron/rescan` (:120) both resolve `isByomActive` and set `metered = ... && !byom`; import never imports or consults it. Inference is billed to the org's AWS account AND platform credits are debited.
- **Impact**: Money loss to the customer — double billing on the import path only; silent inconsistency across the three fleet entry points.
- **Fix sketch**: Add `const byom = await isByomActive(org).catch(() => false);` and fold `&& !byom` into `metered`, matching scan/cron.

## 7. "Scan all watched" spends a whole org's credits with no confirmation
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-confirmation
- **File**: src/components/org/OrgScanButton.tsx:90
- **Scenario**: The primary button `onClick={() => run()}` fires immediately, debiting up to `watchedCount` credits + LLM tokens on a single click; a mis-click on a large fleet is irreversible spend.
- **Root cause**: The costliest action in the context has no confirm step, unlike the per-repo `RepoRescanButton` whose title at least states "draws 1 credit." The button label shows the count but never asks the user to confirm the spend.
- **Impact**: UX / money — an accidental click bulk-spends real credits with no undo; felt by org owners.
- **Fix sketch**: Gate `run()` behind a confirm dialog for fleets above a small threshold, surfacing the credit cost (`Scan N repos? This draws up to N credits.`).

## 8. ScheduleSelect error text uses a hardcoded color instead of the semantic token
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: design-token
- **File**: src/components/org/ScheduleSelect.tsx:79
- **Scenario**: On a failed schedule save the inline error renders with `text-red-400`, while the sibling controls in the same leaderboard use semantic tokens — `RepoRescanButton` uses `text-danger`/`text-warn` and `OrgScanButton` uses `text-danger`.
- **Root cause**: A raw Tailwind palette value bypasses the design system's danger token, so error text won't track theme/token changes and reads slightly differently from adjacent errors.
- **Impact**: Minor visual inconsistency across otherwise-identical leaderboard controls.
- **Fix sketch**: Replace `text-red-400` with `text-danger` to match the sibling components.
