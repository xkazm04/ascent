# Scheduled fleet rescan — the two-speed queue

The fleet runs at **two speeds**, over one durable queue (`ScanJob`, `src/lib/db/scan-jobs.ts`):

| Lane | Route | Cadence | Cost | Writes |
| --- | --- | --- | --- | --- |
| `rescore` | `GET /api/cron/rescan` (`maxDuration = 300`) | daily (`0 6 * * *`) | one scan credit + an LLM run (~6 min) | a `Scan` row + its score |
| `probe` | `GET /api/cron/probe` (`maxDuration = 60`) | hourly (`15 * * * *`) | **free on every plan** — ~3 REST calls, under 2s | `ControlObservation` rows only |

Both are guarded by the shared `CRON_SECRET` (`src/lib/cron-auth.ts`, `requireCronAuth`) and require
the GitHub App + `DATABASE_URL`.

**Why two.** Re-scoring is expensive and paid, so it runs on cadence. But a repo's *controls* —
branch protection, required reviews, rulesets, visibility, whether the repo still exists — move
without a line of code changing, and reading them is free. Separating them means "which of my 900
repos changed posture this week?" is answerable continuously, while the score stays on a schedule.

**Why a queue.** The claim used to live in two incompatible places: the cron's `nextScanAt` lease
(cross-instance safe, but only expressible for a repo that is *due* and already has a `Repository`
row) and a module-global `Map` in `org-watch.ts`, self-documented as "NOT a cross-instance
distributed lock". On a serverless deploy that Map is per-instance, so two browser tabs could each
reserve a credit and each run real inference for the same repo. `claimJob` is a conditional
`updateMany`, so the DB serializes it for **any** repo. Both `claimRepoScan` and `releaseRepoScan`
are gone; nothing may reintroduce a process-local claim.

The second consequence is that **truncation is no longer a data-loss event**: a pass that hits its
wall-clock ceiling leaves its remainder as `queued` rows, and the next pass (or another instance
running concurrently) finishes exactly those.

## Auth

`requireCronAuth` accepts **only** an `Authorization: Bearer <secret>` header, compared in
constant time (`crypto.timingSafeEqual`). It fails **closed**: a missing/empty `CRON_SECRET`
returns 503 rather than silently running unauthed. This gate is shared with `/api/cron/purge`
and `/api/cron/digest`; those two used to hand-roll a stricter check precisely because the
shared helper was weaker; the helper now *is* the strict contract and both call it.

The `?key=<secret>` query param is **no longer a credential channel** (G8-48): query strings
land in access/CDN/proxy logs, browser history and `Referer` headers. Vercel Cron sends the
bearer, so nothing scheduled was affected. A deployment whose own manual/retry tooling still
sends `?key=` can set `CRON_ALLOW_QUERY_KEY=1` as a temporary deprecation hatch; every
accepted query-param auth logs a warning naming the fix.

## Flow — the rescore lane

`GET /api/cron/rescan` is a **seeder plus a worker**, in three phases:

1. **`reapExpiredLeases()`** returns any job whose 15-minute lease expired to `queued` (a serverless
   process kill runs no `finally`, so a worker that never came back must not strand its repo). Past
   `MAX_JOB_ATTEMPTS` (5) the row is settled `failed` instead — nothing retries forever.
2. **`enqueueDueRescans()`** seeds **everything** due (`listDueRescanCandidates`, which is
   `listDueRescans` without the 100-row cap): watched, `scanSchedule != "off"`, `nextScanAt <= now`,
   excluding personal-workspace orgs, round-robin across orgs so one large fleet can't starve the
   rest. The queue, not the invocation, now holds the backlog, so a 900-repo org seeds in one pass and
   drains across as many as it takes. Enqueue is idempotent on
   `idempotencyKey = "<orgId>|<repoFullName>|<lane>|<bucket>"` (bucket = the ISO date for a cadence
   job), so a second pass the same day, or two overlapping invocations, add nothing.
3. **`drainLane("rescore", …)`** (`src/lib/scan-queue-worker.ts`) claims and runs jobs with bounded
   concurrency (`SCAN_CONCURRENCY = 4`) until `fleetDeadlineAt(invokedAt, 300)`, which reserves
   `FLEET_FINALIZE_RESERVE_MS` (15s) so the handler can still return a body instead of being
   process-killed mid-scan.

Per job, `drainLane`:

1. **`claimJob` / `claimJobById`** — a conditional `updateMany` on `state: "queued"`, writing
   `claimed`, `claimedAt`, `claimedBy`, `leaseUntil = now + 15 min`, `attempts += 1`. Two workers
   cannot both win: the loser's update matches zero rows. A second guard then yields to any OLDER
   live claim on the same (org, repo, lane), which is what stops two separate runs — two tabs, two
   run ids, two legitimate rows — from scanning one repo twice.
2. **A broken installation token** (an install exists but the mint failed) skips the repo without
   reserving a credit or scanning, records the outcome, and settles with
   `advanceScheduleAfterFailure` (6h backoff) rather than a full cadence: a failed mint may be a
   transient GitHub blip, and a full-cadence skip would turn one bad minute into a month of stale
   scores for a monthly fleet.
3. **Reserves a scan credit** (`reserveScanCredit`, `src/lib/scan-credit.ts`) when the repo is
   metered — not the shared `public` org and not a BYOM org, since BYOM bills inference to the org's
   own account. The reservation is recorded **on the job row** (`creditCharged`) before any inference,
   so a crash leaves it attributable to a row rather than to a lost variable; `settleJob` is the only
   path that clears it. An exhausted balance settles the cadence via `advanceToFullCadence` so a
   credit-less org waits its normal cadence instead of re-qualifying every pass.
4. **Scans, persists, alerts** — `scanRepository` → `persistScanReport` → `checkAndAlertRegression`
   (skipped on a deduped commit), then `advanceToFullCadence` and `recordScanOutcome(ok: true)`.
   The cadence is settled from the repo's persisted **anchor** (`Repository.scanSlotAt`), not from
   `Date.now()`: `nextScanAt` doubles as the claim lease, so without the anchor every run's queue
   delay plus scan duration was added permanently and "daily"/"weekly" drifted later forever. A slot
   missed during an outage is **skipped forward** to the next future one, never scheduled in the past.
5. **On a throw** — refunds only a PRE-inference failure (see "Refund boundary" below), backs off 6h
   via `advanceScheduleAfterFailure`, and records the outcome so the dashboard can flag the repo as
   broken rather than "never scanned".

Jobs the deadline never reached were never claimed: they stay `queued`, neither failed nor backed
off, and the response reports the queue's own depth (`queueDepth()`, read after the drain) rather
than a number this invocation guessed at.

## Flow — the probe lane (free)

`GET /api/cron/probe` drains the `probe` lane at `PROBE_CONCURRENCY = 8` — higher than the scan lane
because the bound is GitHub's rate limit, not model throughput. Per job, `probeRepository`
(`src/lib/scan-probe.ts`):

1. reads `GET /repos/{owner}/{repo}` (visibility, archived, default branch). A **404 is an
   observation**: the repo was renamed, deleted, or put beyond the token, and `Repository.missingSince`
   is stamped from it. Any other failure leaves presence **unknown** and writes nothing to that column
   — a GitHub blip must never flag a live repo as gone. This closes the gap where
   `reconcileListedRepos` never runs for App-installed orgs, so a renamed private repo burned a rescan
   slot forever;
2. fans out `fetchBranchGovernance` and `fetchSecurityPosture` (the existing fetchers, called with no
   new parameter — the scan path is untouched);
3. maps all three through the pure samplers in `src/lib/scan-probe-controls.ts`, diffs against the
   current ledger, and appends what changed.

**No LLM call, no `Scan` row, no credit reserve, no `persistScanReport`.** A probe is not a scan and
never writes a score.

### The control ledger's row contract

`ControlObservation` (`src/lib/db/control-observations.ts`) is written by `recordObservations` and
frozen for the governance ledger that reads it:

- **one row per (repo, control) change**, plus **one heartbeat row per (repo, control) per 24h** so
  "still on" is provable. Without the heartbeat, silence is ambiguous between "unchanged" and "we
  stopped looking"; without the change-only rule, an hourly probe over 900 repos would write ~250k
  rows a day of "nothing happened";
- `transition = true` is **the alertable flag**: set when the observed `(state, value)` pair differs
  from the previous observation *and* there was a previous one. A first observation is a **baseline**,
  not a change, and a heartbeat is a re-assertion — neither is a transition;
- `state ∈ pass | fail | unmeasurable`, and **`unmeasurable` never means `fail`**. A denied or absent
  read (403/404 on the protection-bearing call, no token) is recorded as `unmeasurable` with a null
  value — the same discipline `fetchBranchGovernance` already enforces by returning `null` rather than
  `protected: false`. Inventing a failure from an unreadable control would report a repo that
  genuinely enforces protection as wide open;
- **value changes count**: a repo flipping public → private, or required approvals going 2 → 1, is a
  governance event even though the state stays `pass`. `prevValue` records what it superseded;
- `evidenceJson` is the **citable slice** (rule types, branch, actor), written at observation time and
  never re-derived.

Controls, kebab-case: `branch-protection`, `required-pull-request`, `required-approvals`,
`required-code-owner-review`, `required-status-checks`, `signed-commits`, `linear-history`,
`ruleset-count`, `org-security-policy`, `advisories`, `repo-visibility`, `repo-archived`,
`repo-present`.

### Webhook fan-in

Five GitHub events move a repo's controls without moving its code, and each enqueues a probe:
`branch_protection_rule`, `repository_ruleset`, `repository` (repo-scoped), and `member`, `team`
(owner-scoped — they fan out over the org's watched repos, capped at 200 per delivery).

**The payload is never trusted for control state.** A `branch_protection_rule.deleted` delivery names
*what to re-read*; only the probe's own re-read from GitHub produces an observation. A validly-signed
but replayed or misrouted delivery therefore cannot write a false governance record. The delivery id
is the idempotency bucket, so a redelivery enqueues nothing new. These branches write no membership or
RBAC row of their own.

## Flow — the interactive bulk scan

`POST /api/org/scan` mints a `runId`, enqueues one `rescore` job per selected repo **before** anything
is scanned, drains its own jobs inline until the deadline, and streams the same `progress` / `repo`
frames as before. What changed is the ending: instead of a `truncated` frame naming repos it had
dropped, it emits `queued { runId, queued, total }` — work still owed, which the background worker
finishes. `GET /api/org/scan/queue?org=&runId=` serves the poll behind "N queued — finishing in the
background" (gate the org, then constrain the query by it, so a foreign run id is simply not found).

`POST /api/org/import` keeps its own scan loop; only its claim moved onto the queue (`claimRepoWork`
→ `settleJob`).

## Sub-stage progress frames on `/api/org/scan`

`POST /api/org/scan` streams the fleet run to the Live tab over SSE. Since 2026-08-22 it emits
**two** kinds of `progress` frame, and the difference matters to every consumer:

```jsonc
{ "stage": "scan",    "repo": "acme/api", "index": 3, "total": 12 }            // repo BOUNDARY
{ "stage": "analyze", "repo": "acme/api", "index": 3, "total": 12, "pct": 62 } // SUB-progress
```

The sub-stages are the scanner's own, in order: `fetch → tree → files → analyze → score → compose`
(`SCAN_SUBSTAGES`, `src/lib/scan-stage.ts`). They are forwarded straight from `scanRepository`'s
`onProgress`. The scanner's terminal `done` stage is deliberately **dropped**: the per-repo `repo`
frame is the authoritative end of a repo, and two "finished" signals would be one too many.

**Why this exists.** The stream used to fall silent for the whole duration of a repo's scan — minutes
on a live LLM run — which reads as a hung wall.

**The consumer contract.** A sub-stage frame carries the **same `index`/`total`** as the `stage:"scan"`
boundary frame emitted just before it, because a sub-stage is not a unit of fleet progress. That is
only safe while every consumer **assigns `done = index` and never increments it**. The rule is folded
once, for all consumers, by the pure `foldProgressFrame` (`src/lib/scan-stage.ts`), so it has a place
to be tested instead of living implicitly in four call sites:

- a boundary frame sets `current` and **clears** `stage`;
- a sub-stage frame sets `stage` and leaves the counters where the boundary put them;
- a frame that omits or garbles `index`/`total` keeps the previous values — malformed frames are inert
  rather than destructive (this is also what lets a credit-truncated run *shrink* the denominator);
- an unknown `stage` string is treated as a boundary, never as sub-progress.

The credit/refund and per-repo `repo` frames below are unchanged. The same stage vocabulary drives the
`stage` column of a loop run's lane during its rescan — see
[org-planning/live.md](../org-planning/live.md#fleet-sse-sub-stages).

## Refund boundary (shared by `/api/cron/rescan`, `/api/org/scan`, `/api/org/import`)

All three fleet-scan routes reserve a credit, then run `scanRepository()` → `persistScanReport()`
inside one `try`. The catch used to refund unconditionally on the premise *"the scan threw, so
nothing was billed"*. That premise only holds **before `scanRepository` returns**:

- **Pre-inference failure** (GitHub error, provider error, the scan itself throwing): nothing
  billable was produced → **refund**.
- **Post-inference failure** (`persistScanReport` hitting a serialization conflict / transient
  write error, or any step after it): the inference already ran and cost real money → **keep the
  credit**. Refunding here would return a credit for work that was genuinely performed, and the
  retry would re-run and re-bill the same inference.

Since the queue landed there is **one** implementation of this: `runRescoreJob` in
`src/lib/scan-queue-worker.ts`, used by the cron and by `/api/org/scan` (the import keeps its own
loop, because it also meters the public-scan allowance below). The policy was moved, not rewritten —
three copies that could drift became one, and the held reservation is now recorded on the job row
(`ScanJob.creditCharged`) rather than in a local variable, so a process kill leaves it attributable.

It tracks the boundary with an `inferenceBilled` flag set immediately after `scanRepository`
returns, guarded by `report.engine.provider !== "mock"`:

- A **mock-degraded** scan bills no inference, so it leaves the flag false and still refunds.
- **BYOM / `public` / within-allowance** runs never reserved a credit (`reserved === false`), so
  `refundScanCredit` is a no-op on both paths, since a refund there would *mint* a credit.

**Second meter on `/api/org/import` (G7-17).** A run that opts into the public funnel
(`publicFunnel: true` on a non-mock, token-less request; see
[wizard.md](../onboarding/wizard.md)) is metered by the free **monthly public-scan allowance**
(`src/lib/public-scan-quota.ts`) rather than by credits: `metered` is false for it, so nothing is
reserved, and instead one allowance slot is consumed per repo and refunded through the *same*
`refundCredit()` verb. That is deliberate: one refund call has to give back whichever meter this run
actually charged, or a deduped/degraded public scan would silently burn a free slot. The flag is
honoured only when no installation token was minted, so it can never buy a free private scan.

The caller is never charged silently: `/api/org/scan` and `/api/org/import` add `charged: <bool>`
to the failing per-repo SSE `repo` event (alongside `error`), and the cron, which has no
human watching, appends `(credit kept, inference already ran)` to that repo's entry in `errors`.
The report itself is lost in this case (it was never persisted); the repo stays scannable and a
later scan re-produces it.

## Return shape

`GET /api/cron/rescan`:

```ts
{
  reaped: number,              // expired leases returned to the queue (or failed at max attempts)
  seeded: number,              // NEW jobs the seeder enqueued this pass (idempotent, so often 0)
  claimed: number,             // jobs this invocation won
  scanned: number,             // jobs that completed a real scan
  failed: number,
  skippedForCredits: number,   // credit reservation exhausted
  skippedAlreadyClaimed: number, // lost the claim race to another worker
  skippedNoToken: number,      // org's installation token could not be minted
  truncated: boolean,          // the wall-clock deadline stopped the drain early
  queueDepth: { queued: number, oldestAgeMs: number | null } | null,
  errors: string[],            // "<fullName>: <message>" per failed scan
}
```

`queueDepth` is read AFTER the drain and is the honest remainder — a supplier-driven drain cannot
know what is still queued without claiming it, and claiming a row it will not run would be worse than
not knowing. `oldestAgeMs` is `null`, never `0`, for an empty lane. A lane that stays deep across
passes is an oversubscribed schedule, and this body is the only place a cron run can say so.

`GET /api/cron/probe` returns the same shape narrowed to its lane:
`{ lane: "probe", claimed, done, failed, skipped, truncated, queueDepth, errors }`.

`POST /api/org/scan` (SSE) ends with `result { runId, scanned, total, skippedForCredits,
skippedInProgress, queued }`, preceded by `queued { runId, queued, total }` when the budget stopped
the drain. **The `truncated` frame and its `remaining`/`repos` payload are gone** — they described
work that had been dropped, and no work is dropped any more.

`GET /api/org/scan/queue?org=&runId=` returns
`{ runId, total, queued, running, done, failed, skipped, pending, repos: [{ repo, state }] }`. It
deliberately carries no ETA: nothing here can honestly say when the next cron pass runs.

## Cadences

`scanSchedule` is one of `off | daily | weekly | monthly`. `daily` and `weekly` advance by an
exact duration (+1d / +7d) from the moment the schedule is settled. `monthly` is **calendar**
arithmetic: the same day-of-month next month, clamped to the last day when the target month is
shorter (Jan 31 → Feb 28/29), so a monthly repo holds its slot instead of walking backwards
through the calendar (a flat 30-day step fires 12.2 times a year, one day earlier each month).

## Key files

| File | Role |
| --- | --- |
| `src/app/api/cron/rescan/route.ts` | The rescore lane's seeder + worker. |
| `src/app/api/cron/probe/route.ts` | The free control lane's worker (`maxDuration = 60`, hourly). |
| `src/lib/db/scan-jobs.ts` | The queue: `enqueueScanJob`, `enqueueDueRescans`, `enqueueProbeJob`, `claimJob`, `claimJobById`, `claimRepoWork`, `settleJob`, `reapExpiredLeases`, `queueDepth`, `listJobsForRun`. |
| `src/lib/scan-queue-worker.ts` | `drainLane` — the one implementation of the money loop, shared by the cron, the bulk scan and the import. |
| `src/lib/scan-probe.ts` · `src/lib/scan-probe-controls.ts` | The credit-free runner and its pure `Governance`/`SecurityPosture`/repo-meta → control samplers. |
| `src/lib/db/control-observations.ts` | `recordObservations`, `latestObservations`, `listObservationsSince` — the ledger's write side. |
| `src/lib/cron-auth.ts` | Shared `requireCronAuth` gate for all cron routes. |
| `src/lib/db/org-watch.ts` | `listDueRescans` / `listDueRescanCandidates`, `claimRescan`, `advanceToFullCadence`, `advanceScheduleAfterFailure`, `getRepoSchedule`, `setRepoMissing`, `recordScanOutcome`. |
| `src/lib/scan-credit.ts` | `reserveScanCredit`, `refundScanCredit`, `shouldRefundScan`: shared credit reserve/refund core also used by `/api/org/scan` and `/api/org/import`. |
| `src/lib/db/org-llm.ts` | `isByomActive`: BYOM detection to skip platform billing. |
| `src/lib/pool.ts` | `mapPoolUntilDeadline` (array fan-out), `drainUntilDeadline` (supplier fan-out, for the queue), `fleetDeadlineAt`, `SCAN_CONCURRENCY`, `PROBE_CONCURRENCY`. |
| `src/lib/scan-alerts.ts` | `checkAndAlertRegression` (see [alerts.md](./alerts.md)). |

## Known gaps

- **Cron schedules live in deploy config** (`vercel.json` / dashboard), not in code; this doc
  covers the handler's behavior once invoked, not the invocation cadence.
- **The rescore lane runs on the deployment's configured `LLM_PROVIDER`** (e.g. Bedrock/Gemini):
  `claude-cli` is local-only, so a rescan never uses it. **The probe lane is independent of
  `LLM_PROVIDER` entirely** — it runs no inference, so control freshness holds on a deployment with
  no model configured at all.

(The former gap about the bounded-concurrency worst-observed estimate is deleted: a pass that stops
early no longer loses the repos it did not reach. They stay `queued` and the next pass takes them, so
a mis-projection costs latency, not data.)

## Retention

Settled `ScanJob`s purge after 30 days; `ControlObservation`s follow the org's scan-retention window,
with the **newest row per (repo, control) always kept** so current posture is never erased into
"unknown". `eraseOrgData` deletes both. All of it lives in `src/lib/db/retention.ts` — see
[data/retention.md](../data/retention.md).
