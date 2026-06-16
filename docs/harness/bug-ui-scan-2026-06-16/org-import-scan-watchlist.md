# Org Import, Scan & Watchlist — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 3, Low: 0)
> Lens split: bug-hunter 4 / ui-perfectionist 1
> Files read: 13

## 1. `/api/org/scan` has no claim/lock — concurrent "Scan all" runs double-scan and double-bill
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: idempotency / billing race
- **File**: src/app/api/org/scan/route.ts:111
- **Scenario**: A fleet owner double-clicks "Scan all watched" (or two members trigger it at once). Both POSTs pass `requireOrgAccess`, both call `listWatchedRepos`, and both enter `mapPool` over the same watched set with no per-repo ownership claim.
- **Root cause**: Unlike `/api/cron/rescan`, which atomically claims each due repo via `claimRescan(repoId, schedule)` before any billable work (org-watch.ts:194) precisely to stop "two overlapping runs double-scan + double-bill the same repo", the manual scan route has no equivalent guard (grep for `claimRescan|withRepoLock` in this file → none). `consumeScanCredit` only prevents a *negative balance*; it does not prevent two runs from each reserving a credit for the same repo. The persist-time `deduped` refund only saves the second run *if* the first has already persisted its row — under concurrency both scans typically read the same commit and run full LLM inference before either persists.
- **Impact**: The org is charged up to 2 credits per repo and pays for redundant LLM inference on every overlapping manual scan; the war-room shows duplicate, racing per-repo events. Same wall-clock cost the cron path was explicitly hardened against.
- **Fix sketch**: Reserve credit *then* claim the repo for the run (e.g. a short-lived `scanInProgress`/`lastScanStartedAt` conditional `updateMany`, or reuse `claimRescan`-style ownership keyed by repoId), skipping repos already claimed by an in-flight run; release on completion.

## 2. `/api/org/scan` lacks the cron's broken-install short-circuit — revoked install burns a reserve/refund cycle per private repo
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: error handling / wasted work + alert noise
- **File**: src/app/api/org/scan/route.ts:97
- **Scenario**: An org's GitHub App install is revoked/suspended but rows are still watched. A member hits "Scan all watched". `getInstallationToken(...).catch(() => undefined)` yields `undefined`, and the run proceeds token-less.
- **Root cause**: The cron route classifies orgs whose install id exists but whose token mint *failed* into `brokenInstallOrgs` and short-circuits each such repo BEFORE reserving a credit or scanning (rescan/route.ts:57–67, 95–99). The manual scan route does no such classification: with `token === undefined`, every watched **private** repo still reserves a credit (consumeScanCredit), then `scanRepository` 404s, then the catch refunds and records an error — once per private repo, every time the button is pressed.
- **Impact**: Each manual scan of a revoked-install org runs N reserve→404→refund cycles, fires N `maybeAlertLowCredits` near-misses on the low-water mark as credits dip and bounce, marks every repo `lastScanStatus=error`, and emits N `repo.error` events — a misleading "everything failed" war-room when the real cause is one revoked install. The cron treats this exact case as a single skip.
- **Fix sketch**: When `installationId` exists but the token mint returns `undefined`, surface a single stream-level `error`/`notice` ("installation token unavailable — reconnect the GitHub App") and skip the private repos instead of attempting each, mirroring `brokenInstallOrgs`.

## 3. `mapPool` aborts the whole batch on the first `fn` rejection and orphans in-flight work
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: bounded-concurrency partial-failure handling
- **File**: src/lib/pool.ts:32
- **Scenario**: If any `fn` invocation rejects, `Promise.all([...workers])` rejects on the first failure while the other lanes keep running (cursor already advanced). Their later resolutions/rejections are abandoned; if they reject too they become unhandled rejections.
- **Root cause**: `worker()` does `results[i] = await fn(...)` with no try/catch, and `Promise.all` is fail-fast. The module's own contract ("`fn` OWNS its errors … a thrown `fn` rejects the whole pool") is *documented but unenforced* — nothing guarantees callers stay non-throwing. In the in-scope callers a stray un-`catch`ed line inside the lane body (the credit-reservation block before the `try`, or an `await` that bypasses the per-repo `try/catch`) would silently abort the remaining repos and, in cron, leave already-`claimRescan`-claimed/credit-reserved repos with no refund and `nextScanAt` pushed a full cadence out.
- **Impact**: A single unexpected throw turns a fleet run into a partial, silent batch abort with leaked credit reservations and unhandled-rejection log noise — exactly the "partial failure swallowed" class this pool was meant to avoid.
- **Fix sketch**: Wrap the `await fn(...)` in the worker in try/catch and store a settled result (`{ok}`/`{error}`) so one bad item can never reject the pool — make the never-throw guarantee structural rather than a comment, or use `Promise.allSettled` semantics internally.

## 4. Credit refunded after `persistScanReport` throws, even though billable inference already ran
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: billing correctness
- **File**: src/app/api/org/scan/route.ts:160
- **Scenario**: `scanRepository` completes a real (non-mock) LLM scan, then `persistScanReport` throws (DSQL serialization conflict that exhausts `withRetry`, transient write failure). The lane's catch (also rescan/route.ts:145, import/route.ts:225) runs `refundCredit()` on the assumption "scan threw — no inference to bill".
- **Root cause**: The catch can't distinguish "the LLM scan itself failed (nothing billable)" from "the LLM ran and produced a report, but the DB write failed afterward". Both refund. The comment's premise ("no inference to bill") is false for a post-inference persist failure.
- **Impact**: Revenue leak — the org keeps its credit while real inference cost was incurred, and the scored row is also lost (no dashboard update), so a retry will run + bill inference *again*. Affects all three fleet paths.
- **Fix sketch**: Only refund when the failure is pre-inference (or when the engine degraded to mock / deduped). Distinguish a persist failure from a scan failure — e.g. catch around `persistScanReport` separately and keep the credit (or move to a dead-letter) when inference succeeded but the write failed.

## 5. OrgScanButton scan progress/errors are invisible to screen readers (no live region / aria-busy)
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility / consistency
- **File**: src/components/org/OrgScanButton.tsx:106
- **Scenario**: A screen-reader user starts a fleet scan. The button label flips to `Scanning N/M…`, a `Meter` and a per-repo `current` line render, and on completion a "N repos failed" / "N skipped — out of credits" / error line appears — none of it announced.
- **Root cause**: The progress block (lines 106–130) and the final status lines have no `aria-live`/`role="status"`, and neither button sets `aria-busy` while `p.running`. Sibling components in the same directory establish the opposite convention — `LiveWarRoomHeader.tsx:159/226` and `LiveWarRoomPanels.tsx:50` wrap the identical kind of progress text in `aria-live="polite"`, and `BacklogItemRow.tsx:103` / `MembersPanel.tsx:179` use `aria-busy`. So this is an inconsistency, not just an omission. The `Meter` is also a bare `<div>` with no `role="progressbar"`/`aria-valuenow`.
- **Impact**: Assistive-tech users get no feedback that a long (up to 300s) scan is running, progressing, or that it ended in failure/credit-exhaustion — the partial-failure messaging the rest of the file works hard to surface is silently dropped for them.
- **Fix sketch**: Wrap the progress + result lines in a `role="status" aria-live="polite"` region (matching LiveWarRoomHeader), add `aria-busy={p.running}` to both buttons, and give `Meter` `role="progressbar"` + `aria-valuenow/min/max` (or `aria-hidden` if the text status already conveys it).
