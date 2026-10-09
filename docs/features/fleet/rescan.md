# Scheduled fleet rescan — the two-speed queue

The fleet runs at **two speeds**, over one durable queue (`ScanJob`, `src/lib/db/scan-jobs.ts`):

| Lane | Route | Cadence | Cost | Writes |
| --- | --- | --- | --- | --- |
| `rescore` | `GET /api/cron/rescan` (`maxDuration = 300`) | daily (`0 6 * * *`) | one scan credit + an LLM run (~6 min) | a `Scan` row + its score |
| `probe` | `GET /api/cron/probe` (`maxDuration = 60`) | hourly (`15 * * * *`) | **free on every plan** — ~3 REST calls, under 2s | `ControlObservation` rows only |

Both are guarded by the shared `CRON_SECRET` (`src/lib/cron-auth.ts`, `requireCronAuth`) and require
the GitHub App + `DATABASE_URL`.

A third trigger has no cron of its own but runs **on the same queue**: the **push rescan**
(`POST /api/app/webhook`, a default-branch push to a repo that is watched **and** on an autoscan
cadence, i.e. `scanSchedule` is not `off`: the same predicate the scheduled lane uses,
`isRepoAutoscanned` in `org-watch.ts`). **"No autoscan" stops push rescans too**; there is no
automatic scan of any kind on a repo set to it. Since 2026-10-08 a push enqueues a `rescore` job with
reason `webhook:push` and drains exactly that job; see
[the push rescan](#flow--the-push-rescan-a-rescore-job-since-2026-10-08) below. It is metered (one
credit reserved before inference, skipped at zero balance), see
[github-app.md](../github/github-app.md#a-push-rescan-pays-for-itself-2026-09-05).

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

`GET /api/cron/rescan` is a **seeder plus a worker**, in three phases — preceded since 2026-08-31
(MC-B14) by one unrelated piece of scheduled work:

0. **`sealAllPendingDays()`** — the control ledger's daily integrity pass. It seals every closed UTC
   day that holds observations and has no root yet, for every org that holds ledger rows at all,
   capped at `SEAL_PASS_CAP` (14) days per org per pass. It runs **before** the `isAppConfigured()`
   check, because a deployment without the GitHub App still holds a ledger written by scans and its
   evidence must not stop being sealed; it is best-effort and can never fail the rescan pass. It lives
   here rather than in `/api/audit/verify` — where it used to be a side effect of the READ — because
   an org nobody verified accumulated unsealed days until retention aged the rows out, leaving no
   root behind to prove they existed. See
   [`data/retention.md`](../data/retention.md#the-control-ledger-and-the-seal-that-must-beat-the-purge)
   for the ordering against the 04:00 purge, and
   [`org-dashboard/org-intelligence.md`](../org-dashboard/org-intelligence.md) for what the seal buys.
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

## Flow — the push rescan (a rescore job, since 2026-10-08)

Until 2026-10-08 the webhook ran its own copy of the money loop inline in `after()`: reserve, scan,
persist, refund, behind a process-local per-repo lock and a throttle derived from the last
*persisted* scan. A 300 s kill kept the credit and left no row; a degraded or failed rescan never
closed the throttle, so every push in an outage bought a scan; and two instances could each buy
inference for the same burst. The push is now a queue job (`src/lib/push-rescan.ts`):

1. **`isRepoAutoscanned`**, then **`installationMatchesOwner`** (a `false` releases the delivery).
2. **`enqueueScanJob`** on the `rescore` lane, reason `webhook:push`, priority `JOB_PRIORITY.webhook`,
   bucket `push:<floor(now / w)>` where `w = PUSH_RESCAN_MIN_INTERVAL_MINUTES` (default 15). That is
   **one job per repo per aligned window**. A bucket whose row exists, settled or not, buys nothing
   more, so the window closes on **any** outcome: done, failed, degraded or skipped. With the interval
   at `0` the bucket is the delivery id. An enqueue that returns no row (or throws) is reported and
   releases the delivery so GitHub's redelivery can retry; once a row exists, the row is the durable
   record and the delivery is kept.
3. **`drainLane("rescore", { jobs: [that job], concurrency: 1, deadlineAt: fleetDeadlineAt(invokedAt, 300) })`**
   inside `after()`, with `invokedAt` taken at the top of the request.

What the queue buys:

- **A kill is not a loss.** A process killed mid-scan leaves the row `claimed`; `reapExpiredLeases`
  returns it to `queued` after its 15-minute lease, and the next rescore drain retries it. The
  `creditCharged` stamp is carried, so the retry does not reserve a second credit.
- **One scan per repo across instances.** `claimJobById`'s peer check yields to an older live claim
  on the same repo, so a push job whose repo is already being scanned (by a cadence job, a bulk scan
  or a push job from another instance) is requeued behind that lease instead of buying a second
  scan. The **06:00 rescore drain** (`/api/cron/rescan`) picks the yielded job up; it scans the
  repo's then-current head.
- **Every outcome is recorded**: the job row settles `done` / `failed` / `skipped` with its error,
  and `Repository.lastScanStatus` carries the scan outcome.

`runRescoreJob` treats `reason === "webhook:push"` as a push job (`PUSH_JOB_REASON`). Every other
reason runs exactly as in "Flow — the rescore lane" above. For a push job:

- **No cadence movement**, on any branch: never `advanceToFullCadence`, never
  `advanceScheduleAfterFailure`. A push is not a slot on the repo's schedule.
- **Failure backoff (6 h, `FAILED_RESCAN_BACKOFF_MS`).** After the claim and before any reserve, the
  worker reads `lastScanStatus` / `lastScanError` / `lastScanAttemptAt` (`getLastScanAttempt`). A
  failed attempt younger than 6 h settles the job `skipped` ("failure backoff") with **no reserve and
  no outcome write**, since a write would refresh `lastScanAttemptAt` and extend the backoff forever.
  The credit-skip copy (`CREDIT_SKIP_ERROR`, "insufficient credits") is exempt, so a topped-up org
  scans on its first push in a later window. A failed backoff read is reported and fails toward
  scanning; the window bucket still caps the spend.
- **Metering is the push path's**: `isMeteredScan(slug, false)`, which does **not** exempt a BYOM org
  (the cadence rule does). The ledger actor is `queue:webhook:push`.
- **A credit skip** records the "insufficient credits" outcome on the repository and settles
  `skipped`.
- **A degrade to mock** is not persisted and sends no regression alert. The credit is refunded, the
  job settles `skipped`, and a failed outcome ("LLM unavailable: not persisted") is recorded, so the
  failure backoff covers the outage instead of every push in it.
- Success, a thrown scan, the pre-inference refund rule and the `creditCharged` carry are the
  worker's ordinary paths.

## Flow — the probe lane (free)

`GET /api/cron/probe` is a **seeder plus a worker**, same shape as the rescore lane, at
`PROBE_CONCURRENCY = 8` — higher than the scan lane because the bound is GitHub's rate limit, not
model throughput. Two phases:

1. **`enqueueDueProbes()`** seeds every watched repo that is not in a personal workspace
   (`listDueProbeCandidates`). There is no `nextScanAt` predicate: a probe is free, and this seed is
   how App-installed orgs ever refresh `Repository.missingSince` — `reconcileListedRepos` never runs
   for them because they never call `listOrgRepos`, and `enqueueProbeJob` is otherwise webhook-only.
   The queue, not the invocation, holds the backlog. Enqueue is idempotent on
   `idempotencyKey = "<orgId>|<repoFullName>|probe|<bucket>"` (bucket = the ISO date), so the hourly
   cron re-seeds nothing the same UTC day, and two overlapping invocations add nothing.
2. **`drainLane("probe", …)`** claims and runs jobs until `fleetDeadlineAt(invokedAt, 60)`.

Per job, `probeRepository` (`src/lib/scan-probe.ts`):

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
The poll is bounded (`src/components/org/shared/queueFollow.ts`): 15 s apart, at most 120 reads or
30 minutes of real time, paused while the tab is hidden (one immediate read on return). The rescore
drain is a daily pass, and on a deployment without the GitHub App it never drains, so an unbounded
follow would run for as long as the tab stayed open. At the ceiling the button keeps its last count
and reads "N queued — last count; this page stopped checking, reload to check." — never "finished".

`POST /api/org/import` now has the same shape (2026-09-24): it enqueues one `rescore` job per repo
under its run id **before** anything is scanned, drains its own jobs until the deadline, and leaves
the rest `queued`. The run ends with the same `queued { runId, queued, total }` frame and a `queued`
count on `result`, and the wizard's reattach poll (`GET /api/org/scan/queue`) now has real rows to
follow. Before, a row was written only when a repo was claimed, so an import killed at 300s left no
trace of the repos it never started. The drain body stays the import's own (it meters the public-scan
allowance and attributes debits to the signed-in importer). After a successful overflow reserve it
stamps `creditCharged` on that row (`markJobCredit`) **before** inference, and settles `skipped` /
`failed` / `done` honestly: `creditRefunded` on a pre-inference refund, left standing on billed
inference. A process kill at the 300s ceiling never runs `finally`; `reapExpiredLeases` returns the
row to `queued` without clearing `creditCharged`, and the next `runRescoreJob` carries that credit
instead of reserving again. One imported repo reserves one credit, whichever process finishes it.

The background worker runs the queued tail without the request that created it, so an import row
carries that request's scan policy on its `reason` (`import:<token>[+mock][+funnel]`,
`src/lib/scan-import-policy.ts`), and `runRescoreJob` honors it:

- **Credential.** `install` scans with the org's installation token, `ambient` with the env token (the
  auth-off seeding path), and `none` sets `noAmbientToken`. Without it, a token-less anonymous import's
  tail would fall back to the operator PAT. Only an `install` row can be skipped as `no_token`.
- **Mock.** A preview import's tail stays a free mock scan and reserves no credit.
- **Public funnel.** That allowance is metered per request, so the worker cannot finish such a row. The
  import settles its own unreached funnel tail `skipped` and sends a `time_budget` notice; a funnel row
  the worker still finds is settled `skipped` without a scan or a charge.

A queued tail is also enrolled in the watchlist and schedule the caller asked for when the drain stops,
because the worker does not know that choice. A bare `import` reason (a row written before the
encoding) keeps the worker's default path.

**Three skip reasons, kept apart (2026-09-06).** The worker emits `insufficient_credits`, `no_token`
and `in_progress`. The `result` frame used to carry only the first and the third, and the client
overwrites its running skip count with the authoritative `skippedForCredits` — so an org whose
GitHub App install was revoked or suspended skipped *every* repo and the run settled on a clean
N/N with no failures, no skips and no error: a completed scan that produced nothing. `skippedNoToken`
now rides the frame and gets its own counter and its own line ("GitHub App access unavailable.
Reconnect the installation on Connect"), because *buy credits* and *reconnect the App* are not the
same instruction. `skippedInProgress` stays deliberately unrendered — a claim collision means
another worker has that repo right now, which needs nothing from the user.

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

Since the queue landed the cron and `/api/org/scan` share **one** implementation (`runRescoreJob` in
`src/lib/scan-queue-worker.ts`). The import drains its own jobs with its own body (public-scan
allowance, below) but stamps the same `ScanJob.creditCharged` after reserve, so a 300s kill + reap
cannot double-debit an import either, and its unreached tail runs through `runRescoreJob`. The held reservation is recorded on the job row rather than in a local variable.

**And the retry now READS it back (2026-09-06).** Being attributable was only half the point: the
row was written and never consulted, so the sequence this queue exists to survive — reserve, start
inference, get process-killed at the 300s ceiling, `reapExpiredLeases` requeues (clearing state and
lease, deliberately *not* `creditCharged`, since `settleJob` is the only clearer and clears it only
on a refund) — ended with the next worker reserving a **second** credit for the same job, up to
`MAX_JOB_ATTEMPTS` = 5 times for one repo. `runRescoreJob` now carries the credit the row already
holds instead of buying another, and `charged` starts from the row so the refund boundary is
unchanged. **Not atomic, stated rather than hidden:** a kill landing between `reserveScanCredit` and
`markJobCredit` still leaves the row saying `false` and that attempt does re-reserve — the window
narrows from the whole inference to one DB write, which is as far as it goes without one transaction
across two stores.

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

**The shared `public` org takes no autoscan cadence and no bulk scan (operator decision 2026-10-07).**
`public` has no owner, so a scan nobody asked for has nobody to charge: an import there is charged to the
signing-in user's own public-scan allowance, and everything that would spend *without* a requester is
closed. While an auth stack is live (`!authGateEnabled() && !isAuthConfigured()` is false - exactly where
the import route's other public rules bind):

- **the seeder skips it.** `/api/cron/rescan` passes `excludeOrgSlugs: ["public"]` through
  `enqueueDueRescans` to `listDueRescanCandidates`, which applies it in the query's `where`. Public rows
  that already carry a schedule stop seeding with no migration.
- **`POST /api/org/schedule`** answers 403 for any cadence but `off` on `public` (`off` still succeeds,
  so an existing schedule can be cleared).
- **`POST /api/org/import`** into `public`, real or mock, defaults the schedule to `off`; an explicit
  other cadence is a 400 and nothing calls `setRepoSchedule`. `watch` keeps its meaning.
- **`POST /api/org/scan`** answers 403 for `public` before the watchlist is read or anything is enqueued
  (no rate limiter or metering was added: the refusal replaces both). Rescan one repository from its
  report page instead, which consumes the viewer's own allowance.

An auth-off (local, demo, seeding) deployment and every tenant org keep today's behaviour.

The caller is never charged silently: `/api/org/scan` and `/api/org/import` add `charged: <bool>`
to the failing per-repo SSE `repo` event (alongside `error`), and the cron, which has no
human watching, appends `(credit kept, inference already ran)` to that repo's entry in `errors`.
The report itself is lost in this case (it was never persisted); the repo stays scannable and a
later scan re-produces it.

## Return shape

`GET /api/cron/rescan`:

```ts
{
  // The control ledger's sealing pass. null when it threw (best-effort, never fatal).
  // `backlogRemaining` is closed unsealed days BEYOND what the next pass can take, summed
  // across orgs — a persistently non-zero value on a short retention horizon is the condition
  // under which a day can be purged before it is ever sealed.
  ledgerSeal: { orgs: number, daysSealed: number, backlogRemaining: number } | null,
  reaped: number | null,       // expired leases returned to the queue (or failed at max attempts); null = the step failed
  seeded: number | null,       // NEW jobs the seeder enqueued this pass (idempotent, so often 0); null = the step failed
  claimed: number,             // jobs this invocation won
  scanned: number,             // jobs that completed a real scan
  failed: number,
  skippedForCredits: number,   // credit reservation exhausted
  skippedAlreadyClaimed: number, // lost the claim race to another worker
  skippedNoToken: number,      // org's installation token could not be minted
  truncated: boolean,          // the wall-clock deadline stopped the drain early
  queueDepth: { queued: number, oldestAgeMs: number | null } | null,
  errors: string[],            // "<fullName>: <message>" per failed scan, plus one named entry per failed step
}
```

**A failed step answers `null` for its field and a named entry in `errors`** (e.g.
`cron/rescan reapExpiredLeases failed`), never a `0` that would read as "nothing was due". The pass
still answers 200: one failed step does not fail the rest. `queueDepth()` throws on a failed count
(it no longer answers `0`), and the cron routes catch it, answer `queueDepth: null` and name the
failure. Every such step also reaches the degraded-read door (`console.warn` plus
`reportHandledError`). See [the ADR](../../adr/2026-10-07-failed-read-is-not-absence.md).

`queueDepth` is read AFTER the drain and is the honest remainder — a supplier-driven drain cannot
know what is still queued without claiming it, and claiming a row it will not run would be worse than
not knowing. `oldestAgeMs` is `null`, never `0`, for an empty lane. A lane that stays deep across
passes is an oversubscribed schedule, and this body is the only place a cron run can say so.

**And it is no longer the only place a HUMAN can see it (2026-08-31, UAT `VICTOR-L1-07`).** The depth
reached only these two JSON bodies, so a director budgeting a weekly paid cadence could learn how deep
his backlog was only by counting per-row "queued" tags — *"I'd see 400 per-row 'queued' tags before I
saw the number 400."* The **Repositories** tab now opens with one line above the leaderboard:
*"Scan queue: 400 rescans waiting, oldest queued 3h ago."*

It reads through `orgQueueDepth(slug)`, a deliberate sibling of `queueDepth()` rather than a reuse of
it. `queueDepth` returns a fully-zeroed record without a database (and now throws on a failed count) —
right for a cron body that names the failure beside a null, and wrong for a dashboard, where a
reader cannot tell "nothing is waiting" from "the queue table could not be read". `orgQueueDepth`
returns **null** in all three of those cases and the line says
*"Scan queue depth is unavailable — this deployment's job queue could not be read."* An empty queue
that WAS read still gets its own sentence, because on a page about cadence "nothing waiting" is a
measurement worth stating.

`GET /api/cron/probe` returns the same shape narrowed to its lane:
`{ lane: "probe", seeded, claimed, done, failed, skipped, truncated, queueDepth, errors }`.

`POST /api/org/scan` (SSE) ends with `result { runId, scanned, total, skippedForCredits,
skippedInProgress, queued }`, preceded by `queued { runId, queued, total }` when the budget stopped
the drain. **The `truncated` frame and its `remaining`/`repos` payload are gone** — they described
work that had been dropped, and no work is dropped any more.

**A failed remainder read is not an empty remainder.** If reading the run's rows fails after the drain,
both `POST /api/org/scan` and `POST /api/org/import` still send `queued { runId, queued: null, total }`
(and `result.queued: null`), so the client follows the run through the queue poll instead of settling it
as finished. The failure reaches the degraded-read door. A repo whose enqueue fails (throws or answers
null) gets its own `repo { error }` frame and counts as handled, so `done` still reaches `total`. On
import, a claim that throws is a `repo { error }` frame; only a claim that answers null (a lost race)
is `skipped: "in_progress"`.

`GET /api/org/scan/queue?org=&runId=` returns
`{ runId, total, queued, running, done, failed, skipped, pending, repos: [{ repo, state }] }`. It
deliberately carries no ETA: nothing here can honestly say when the next cron pass runs.

A failed read answers **503** `{ error }` (after `console.error` plus `reportHandledError`), never 200 with
zero counts, since both followers (`useOrgScanButton`, `useImportReattach`) read `total: 0, pending: 0` as
finished. A non-OK poll is no evidence: the scan button keeps its last count and the wizard shows
"unavailable". Hitting the poll ceiling is no evidence either: the wizard shows "stopped" and the
button flags its count as no longer updating (see the bound above). `listJobsForRun` is class A and throws on a failed org lookup or run read.

## Who can be watched (`POST /api/org/watch`, since 2026-09-24)

A watched repo is a standing credit draw: the rescore lane reserves the org's credits for it on
its cadence and folds its score into the org's rollup. The watch route used to accept any
`{ owner, name, fullName }`, so a member could point the org's scan budget at a stranger's
repository. A watch (`watched: true`, single or bulk) now passes one predicate,
`watchScopeFor(org)` in `src/lib/org/watch-scope.ts`:

- **Hosted** (`selfHosted()` false): the repo must be in the org's own namespace (owner equals
  the org slug, case-insensitive) or on the org's GitHub App installation listing. The owner
  check needs no read; the listing is read once per request, only for a name outside the
  namespace, and fails closed (no installation, or a listing GitHub would not serve, admits
  only the org's own namespace). A refused single watch is a 400; a refused bulk entry is
  reported in `failed[]` and the rest are still watched.
- **Self-hosted**: free-form, because the operator owns every installation and the bill, and an
  org named for its team watching another account's repos is the normal self-host shape.
- **Both modes** check the handle shape: a GitHub login, a repo name, and a `fullName` that is
  exactly `owner/name`.
- **Un-watching is never refused.** An in-scope unwatch records the explicit-unwatch row as
  before. Any other unwatch only clears a row the org already has (`clearRepoWatch`), so an
  unwatch cannot create a `Repository` row: that row is the org's tenancy fact for the
  customer-repo write door.

Install-granted auto-watch (`watchGrantedRepo` in `src/lib/db/install-grants.ts`) does not ask
the predicate: every name it watches comes from the installation listing, so it is in scope by
construction.

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
| `src/app/api/cron/probe/route.ts` | The free control lane's seeder + worker (`maxDuration = 60`, hourly). |
| `src/lib/db/scan-jobs.ts` | The queue: `enqueueScanJob`, `enqueueDueRescans`, `enqueueDueProbes`, `enqueueProbeJob`, `claimJob`, `claimJobById`, `claimRepoWork`, `markJobCredit`, `settleJob`, `reapExpiredLeases` (requeues without clearing `creditCharged`), `queueDepth`, `orgQueueDepth` (the null-honest read the Repositories tab renders), `listJobsForRun`. |
| `src/lib/scan-queue-worker.ts` | `drainLane`: the money loop for the cron and the bulk scan. Import drains its own jobs with its own body but stamps `creditCharged` the same way, so a reaped import row is carried, not re-reserved; the import's queued tail runs here under the policy on its `reason`. |
| `src/lib/scan-probe.ts` · `src/lib/scan-probe-controls.ts` | The credit-free runner and its pure `Governance`/`SecurityPosture`/repo-meta → control samplers. |
| `src/lib/db/control-observations.ts` | `recordObservations`, `latestObservations`, `listObservationsSince` — the ledger's write side. |
| `src/lib/cron-auth.ts` | Shared `requireCronAuth` gate for all cron routes. |
| `src/lib/db/org-watch.ts` | `listDueRescans` / `listDueRescanCandidates` / `listDueProbeCandidates`, `claimRescan`, `advanceToFullCadence`, `advanceScheduleAfterFailure`, `getRepoSchedule`, `setRepoMissing`, `recordScanOutcome`, and the push job's failure backoff (`getLastScanAttempt`, `inFailureBackoff`, `FAILED_RESCAN_BACKOFF_MS`, `CREDIT_SKIP_ERROR`). |
| `src/lib/scan-credit.ts` | `reserveScanCredit`, `refundScanCredit`, `shouldRefundScan`: shared credit reserve/refund core also used by `/api/org/scan` and `/api/org/import`. |
| `src/lib/db/org-llm.ts` | `isByomActive`: BYOM detection to skip platform billing. |
| `src/lib/pool.ts` | `mapPoolUntilDeadline` (array fan-out), `drainUntilDeadline` (supplier fan-out, for the queue), `fleetDeadlineAt`, `SCAN_CONCURRENCY`, `PROBE_CONCURRENCY`. |
| `src/lib/scan-alerts.ts` | `checkAndAlertRegression` (see [alerts.md](./alerts.md)). |
| `src/lib/push-rescan.ts` | The push rescan's enqueue-and-drain: `pushRescanBucket` (the aligned window), `pushRescanMinIntervalMs`, `enqueueAndDrainPushRescan`. Called by `src/app/api/app/webhook/route.ts`. |
| `src/lib/scan-import-policy.ts` | `importJobReason` / `decodeImportReason`: the import request's credential, mock and public-funnel facts, carried on the job's `reason` for the worker. |

## Known gaps

- **Three metering decisions still key on the org SLUG, not the org row.** `/api/org/scan`,
  `/api/org/import` and `runRescoreJob` each decide `metered` with `slug !== "public"`. UAT MC-B20
  moved the sibling decision — the LLM ledger's "do not meter this org" — onto `Organization.kind`
  precisely because a slug is a spelling and the question is a property of the org. Converting these
  three is a money change gated on every writer stamping the funnel row, which is not yet true: of
  the six writers that can materialize an Organization, `ensureOrgId` stamps and repairs it, the
  watch path stamps it as of 2026-09-06, and `plan.ts` / `installations.ts` / `org-memory.ts` /
  `org-skills.ts` still create rows unstamped.
- **A push job and a cadence job meter a BYOM org differently.** A `webhook:push` job uses
  `isMeteredScan`, which charges a BYOM org; a cadence or manual job exempts it (`isByomActive`). The
  move onto the queue kept each path's charge as it was; which rule is right is a pricing decision.
- **Cron schedules live in deploy config** (`vercel.json` / dashboard), not in code; this doc
  covers the handler's behavior once invoked, not the invocation cadence.
- **The rescore lane runs on the deployment's configured `LLM_PROVIDER`** (e.g. Bedrock/Gemini):
  `claude-cli` is local-only, so a rescan never uses it. **The probe lane is independent of
  `LLM_PROVIDER` entirely** — it runs no inference, so control freshness holds on a deployment with
  no model configured at all.
- **The onboarding wizard does not yet follow an import's queued tail live.** When the stream's
  `result` arrives, the wizard resolves every repo it never got a `repo` frame for to "not scanned",
  although those repos are queued and the worker will scan them. A refresh re-attaches through the
  queue poll and shows them finishing; the live stream does not. `claimRepoWork` in
  `src/lib/db/scan-jobs.ts` has no product caller left since the import enqueues first.

(The former gap about the bounded-concurrency worst-observed estimate is deleted: a pass that stops
early no longer loses the repos it did not reach. They stay `queued` and the next pass takes them, so
a mis-projection costs latency, not data.)

## Retention

Settled `ScanJob`s purge after 30 days; `ControlObservation`s follow the org's scan-retention window,
with the **newest row per (repo, control) always kept** so current posture is never erased into
"unknown". `eraseOrgData` deletes both. All of it lives in `src/lib/db/retention.ts` — see
[data/retention.md](../data/retention.md).
