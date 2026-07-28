# Scheduled fleet rescan

`GET /api/cron/rescan` (`src/app/api/cron/rescan/route.ts`) re-scores every watched repo whose
schedule is due, guarded by the shared `CRON_SECRET` (`src/lib/cron-auth.ts`,
`requireCronAuth`) and requiring the GitHub App + `DATABASE_URL`. A Vercel Cron endpoint,
`maxDuration = 300`.

## Auth

`requireCronAuth` accepts `Authorization: Bearer <secret>` or `?key=<secret>`. It fails
**closed**: a missing/empty `CRON_SECRET` returns 503 rather than silently running unauthed.
This gate is shared with `/api/cron/purge` and `/api/cron/digest` so the three cron handlers
can't drift apart.

## Flow

1. **`listDueRescans()`** finds every watched repo (`scanSchedule != "off"`, `nextScanAt <=
   now`, excluding personal-workspace orgs) and interleaves them across orgs so one large
   fleet doesn't starve the rest of the queue.
2. **Pre-resolve installation tokens once per distinct org**, up front, before any repo is
   scanned — not per repo. This also resolves BYOM status per org
   (`isByomActive`, `src/lib/db/org-llm.ts`) and tracks orgs whose install id exists but whose
   token mint failed (`brokenInstallOrgs`) separately from orgs with no install at all (a
   public org, which scans via the tokenless path).
3. Repos are processed with **bounded concurrency and a wall-clock deadline**
   (`mapPoolUntilDeadline`, `SCAN_CONCURRENCY = 4`, both in `src/lib/pool.ts`). The deadline
   (`fleetDeadlineAt(invokedAt, maxDuration)`) reserves `FLEET_FINALIZE_RESERVE_MS` (15s) at
   the end of the run so the handler can still return an honest partial-progress response
   instead of being process-killed mid-scan with no body.
4. Per repo:
   1. **`claimRescan(repoId, scanSchedule)`** — claim-before-work: atomically advances
      `nextScanAt` to a short lease window only while the repo is still due. If another
      overlapping cron run (or a manual `?key=` retry) already claimed it, this returns
      `false` and the repo is skipped (`skippedAlreadyClaimed`). Cross-instance safe (DB-level
      `updateMany` with a `WHERE ... nextScanAt <= now` guard).
   2. If the repo's org is in `brokenInstallOrgs`, skip without reserving a credit or
      scanning (`skippedNoToken`), and settle the schedule with
      **`advanceScheduleAfterFailure(repoId)`** — a 6h retry backoff — rather than a full
      cadence, since a failed token mint may be a transient GitHub API blip rather than a
      genuinely revoked install.
   3. **Reserve a scan credit** (`reserveScanCredit`, `src/lib/scan-credit.ts`) when the repo
      is metered — i.e. not the shared `public` org and not a BYOM org (BYOM bills inference
      to the org's own model, so the platform must not also charge a platform credit). If the
      reservation is exhausted (`reservation.skip`), skip (`skippedForCredits`) and settle the
      lease to the full cadence via **`advanceToFullCadence(repoId, scanSchedule)`** so a
      credit-less org waits its normal cadence instead of re-qualifying every pass.
   4. Otherwise: capture the prior persisted report (`getScanReportByCommit`), run
      `scanRepository()` with the pre-resolved token, `persistScanReport()`, refund the
      credit when `shouldRefundScan()` says the run was unbillable (degraded to mock, or
      `deduped` — unchanged commit), and alert on a regression
      (`checkAndAlertRegression`, see [alerts.md](./alerts.md)) when the scan wasn't deduped.
      On success: settle to the full cadence via `advanceToFullCadence` and record the outcome
      (`recordScanOutcome`, `ok: true`).
   5. On a thrown error: refund the credit, back off via `advanceScheduleAfterFailure`
      (6h retry, not a full cadence, so a persistently-broken repo doesn't starve the rest of
      the fleet from the front of the oldest-first queue), and record the outcome
      (`recordScanOutcome`, `ok: false`, with the error message) — this is what lets the
      dashboard flag a repo as broken rather than "never scanned"
      (`Repository.lastScanStatus` / `lastScanError` / `lastScanAttemptAt`).

Repos the deadline guard never issued (`remaining`) were never claimed, so their
`nextScanAt` is untouched — they're still due and picked up by the next cron pass, neither
failed nor backed off.

## Return shape

```ts
{
  due: number,                 // due.length — repos that qualified this pass
  scanned: number,             // repos that completed a real scan
  skippedForCredits: number,   // credit reservation exhausted
  skippedAlreadyClaimed: number, // lost the claim race to an overlapping run
  skippedNoToken: number,      // org's installation token could not be minted
  truncated: boolean,          // the wall-clock deadline stopped the run early
  remaining: number,           // items never issued, left for the next pass
  errors: string[],            // "<fullName>: <message>" per failed scan
}
```

## Key files

| File | Role |
| --- | --- |
| `src/app/api/cron/rescan/route.ts` | The route handler — orchestrates the flow above. |
| `src/lib/cron-auth.ts` | Shared `requireCronAuth` gate for all cron routes. |
| `src/lib/db/org-watch.ts` | `listDueRescans`, `claimRescan`, `advanceToFullCadence`, `advanceScheduleAfterFailure`, `recordScanOutcome`. |
| `src/lib/scan-credit.ts` | `reserveScanCredit`, `refundScanCredit`, `shouldRefundScan` — shared credit reserve/refund core also used by `/api/org/scan` and `/api/org/import`. |
| `src/lib/db/org-llm.ts` | `isByomActive` — BYOM detection to skip platform billing. |
| `src/lib/pool.ts` | `mapPoolUntilDeadline`, `fleetDeadlineAt`, `SCAN_CONCURRENCY` — bounded-concurrency, deadline-aware fan-out. |
| `src/lib/scan-alerts.ts` | `checkAndAlertRegression` (see [alerts.md](./alerts.md)). |

## Known gaps

- **Cron schedules live in deploy config** (`vercel.json` / dashboard), not in code; this doc
  covers the handler's behavior once invoked, not the invocation cadence.
- **Runs on the deployment's configured `LLM_PROVIDER`** (e.g. Bedrock/Gemini) —
  `claude-cli` is local-only, so a rescan never uses it.
- The bounded-concurrency deadline estimate is based on the *worst observed* per-item wall
  time so far; nothing is truncated before at least one item has completed, so a fleet whose
  very first repo is unusually slow can still be caught out on later items.
