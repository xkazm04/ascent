# 10 — Two-speed fleet: durable scan queue + credit-free control probes

XL · effort 8 / impact 8 / risk 6 · gate: **contract** · lane **W3-L** · **wave 3** (runs alone)

## Premise check (verified against the tree, 2026-08-29)

**All premises held**; only line numbers drifted. Confirmed by symbol name: `maxDuration = 300` +
one `mapPoolUntilDeadline` pass over `listDueRescans()` in `cron/rescan/route.ts`;
`listDueRescans(limit = 100)`, `claimRescan`'s `nextScanAt` lease (`CLAIM_LEASE_MS = 15 min`), and
`claimRepoScan`/`releaseRepoScan` — a **module-global `Map`** self-documented as "NOT a
cross-instance distributed lock" — in `org-watch.ts`; `SCAN_CONCURRENCY = 4` in `pool.ts`; the
`truncated` SSE frame in `org/scan/route.ts` feeding the manual **"Continue (N left)"** button at
`OrgScanButton.tsx:96`; exactly five webhook events; **no `ScanJob` and no `ControlObservation`
anywhere in the tree**. `Repository.missingSince` exists but is written only by
`reconcileListedRepos`, which (BACKLOG group 04) never runs for App-installed orgs — so a
renamed/archived private repo burns a rescan slot forever; the probe lane closes that (step 4).

Two deviations from §1 of the orchestration plan, flagged for the Director: **`src/lib/scan-probe.ts`,
not `src/lib/scan/probe.ts`** (there is no `src/lib/scan/` directory — the convention is flat
`scan-*.ts` siblings of `scan.ts`), and **a second cron route `/api/cron/probe`** rather than a
query-string lane (the probe wants `maxDuration = 60` and an hourly cadence; cron auth is per-route).

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/app/api/cron/rescan/route.ts` — becomes a lane-aware worker over the queue.
- `src/app/api/org/scan/route.ts` — enqueues + drains + streams job state; `truncated` → `queued`.
- `src/app/api/org/import/route.ts` — the two `claimRepoScan`/`releaseRepoScan` call sites move to
  the DB claim (the billing cut-over; nothing else in that route changes).
- `src/lib/db/org-watch.ts` — **delete** `claimRepoScan` / `releaseRepoScan` / `scanClaims` /
  `SCAN_CLAIM_TTL_MS`; add `listDueRescanCandidates()` (the seeder's read, `limit` now optional).
  `claimRescan` / `advanceToFullCadence` / `advanceScheduleAfterFailure` keep their exact semantics.
- `src/lib/pool.ts` — add `PROBE_CONCURRENCY = 8` and `drainUntilDeadline` (a claim-loop sibling of
  `mapPoolUntilDeadline` pulling from a supplier instead of an array); the three existing exports are
  untouched (the import route still uses them).
- `src/app/api/app/webhook/route.ts` — five new event branches → `enqueueProbeJob`.
- `src/lib/db/org-rollup.ts` — `OrgRepoRow.freshness` (new field, all-`string` timestamps).
- `src/lib/db/retention.ts` — purge settled `ScanJob`s (30d) + expired `ControlObservation`s;
  `eraseOrgData` deletes both. (W1-F merged in wave 1; no concurrent owner.)
- `src/features/standing/repositories/{RepoLeaderboardRow,RepoLeaderboardParts}.tsx` — freshness cell.
- `src/components/org/shared/{useOrgScanButton.ts,OrgScanButton.tsx}` — "Continue (N left)" becomes
  "N queued" with a passive poll.
- `vercel.json` — the `/api/cron/probe` entry.
- `docs/features/fleet/rescan.md` — the queue, both lanes, the probe contract, the new return shapes;
  the superseded known gaps deleted.

**Files to create**
- `src/lib/db/scan-jobs.ts` — the queue; `src/lib/db/control-observations.ts` — the row contract
  W3-M consumes; `src/lib/scan-probe.ts` — the credit-free runner; `src/lib/scan-probe-controls.ts`
  — pure mappers; `src/lib/scan-queue-worker.ts` — the lane-agnostic drain loop both crons call.
  Signatures under *Modules*.
- `src/app/api/cron/probe/route.ts` (cron auth, `maxDuration = 60`) and
  `src/app/api/org/scan/queue/route.ts` (`GET`, one run's job states for the "N queued" poll).
- Tests (below).

**Prisma models/columns needed** (landed by the wave-3 schema pass, **not** by this lane):

```prisma
model ScanJob {
  id             String    @id @default(uuid())
  orgId          String
  repoId         String?   // null while the import funnel has not created the Repository row yet
  repoFullName   String    // "owner/name", always present — the identity the claim keys on
  lane           String    // "rescore" | "probe"
  reason         String    // "cadence" | "manual" | "import" | "continuation" | "webhook:<event>"
  state          String    @default("queued") // queued | claimed | done | failed | skipped
  priority       Int       @default(0)  // higher first; manual = 10, webhook = 5, cadence = 0
  runId          String?   // groups one interactive /api/org/scan batch
  idempotencyKey String    @unique      // "<orgId>|<repoFullName>|<lane>|<bucket>"
  notBefore      DateTime  @default(now())
  claimedAt      DateTime?
  claimedBy      String?   // invocation id — diagnostics only, never an authorization input
  leaseUntil     DateTime?
  attempts       Int       @default(0)
  creditCharged  Boolean   @default(false) // rescore only: an overflow credit is held BY THIS ROW
  resultJson     String?   // TEXT JSON (no jsonb — DSQL/PGlite)
  error          String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  settledAt      DateTime?
  org            Organization @relation(fields: [orgId], references: [id])

  @@index([lane, state, notBefore, priority])
  @@index([orgId, lane, state])
  @@index([runId])
  @@index([state, leaseUntil])
}

model ControlObservation {
  id           String    @id @default(uuid())
  orgId        String
  repoId       String
  control      String    // see the control vocabulary below
  state        String    // "on" | "off" | "unknown"  — never coerce unknown to off
  value        String?   // scalar rendering for non-boolean controls ("2" approvals, "4" rules)
  source       String    // "probe" | "scan" | "webhook"
  prevState    String?   // the state this row superseded; null on the first observation
  observedAt   DateTime  @default(now())
  transition   Boolean   @default(false) // true iff state != prevState (the row W3-M alerts on)
  jobId        String?   // ScanJob.id that produced it
  deliveryId   String?   // GitHub delivery id when source = "webhook"
  evidenceJson String?   // TEXT JSON: rule types, branch, actor login — the citable slice
  createdAt    DateTime  @default(now())
  org          Organization @relation(fields: [orgId], references: [id])

  @@index([repoId, control, observedAt])
  @@index([orgId, transition, observedAt])
}
```

**Director-owned lines requested at merge**
- `src/lib/db/index.ts`: `export * from "@/lib/db/scan-jobs";` and
  `export * from "@/lib/db/control-observations";`.
- `src/lib/db/wire-safe-dates.test.ts`: add `ScanJobRow` and `ControlObservationRow`.
- `scripts/docs/feature-doc-map.json`, `fleet` → `rescan.md` `sourceGlobs`: add
  `"src/lib/scan-probe*.ts"`, `"src/lib/scan-queue-worker.ts"`, `"src/lib/db/scan-jobs.ts"`,
  `"src/app/api/cron/probe/**"`.
- `context-map.json`, group *Org Scanning & Fleet Rollups* → context *Org Import, Scan & Watchlist*:
  add the six new `filePaths`.

**MUST NOT TOUCH**
Class B (requested above): `prisma/schema.prisma`, `prisma/init.sql`, the PGlite reconcile,
`src/lib/db/index.ts`, `context-map.json`, `scripts/docs/feature-doc-map.json`. Also:
`src/lib/{scan,scan-ingest}.ts` and `src/lib/github/source.ts` — the probe calls the existing
fetchers directly and adds **no** parameter to the scan path (W4-P rewrites `scan-ingest` wholesale
and needs a byte-comparable baseline); `src/lib/scan-credit.ts` — reused verbatim, never edited;
`src/lib/alerts.ts`, `src/lib/conformance/pack.ts`, `src/lib/db/audit-integrity.ts` — W3-M's;
anything that *writes* to a customer repo — W4-O's.

**Handoffs to other lanes**
- **→ W3-M (#1)**: this lane creates `ControlObservation` and is its only writer at merge; M owns the
  read side (normalizers, hash chain, `GovernanceEvent`, `AlertEvent.kind = "control"`, the timeline,
  the verify endpoint). The contract M builds on is frozen here: *one row per (repo, control) state
  **transition**, plus one heartbeat row per (repo, control) per 24h so "still on" is provable;
  `transition = true` marks the alertable ones; `state = "unknown"` is first-class and never means
  `off`; `evidenceJson` is the citable slice.* The five new webhook branches land here as
  **enqueue-only** — M extends the same branches to also write `GovernanceEvent`.

## Goal

Decouple fleet freshness from LLM spend and from the 300s / 100-repo serverless ceiling: a durable
`ScanJob` queue with DB-serialized claims replaces both the process-local dedup map and the
`nextScanAt` lock, and a free GitHub-API-only **probe lane** re-observes deterministic controls on
every relevant webhook. Competitive angle: Factory's org view rolls up whatever its last scan saw
and Scorecard's dataset is a batch — a fleet that observes controls continuously (free) and
re-scores on cadence (paid) makes "which of my 900 repos changed posture this week" answerable.

**Known gap deleted from `docs/features/fleet/rescan.md`** (§Known gaps): the
bounded-concurrency worst-observed-estimate gap — truncation stops being a data-loss event once the
remainder is a durable queued job — together with the `truncated`/`remaining` framing in §Return
shape. The other two gaps (cadence lives in deploy config; the deployment's `LLM_PROVIDER`) stay
true; the probe lane's independence from `LLM_PROVIDER` is added as new prose, not a gap deletion.

## Behaviour

### Data model

- **Idempotency.** `idempotencyKey = "<orgId>|<repoFullName>|<lane>|<bucket>"`; `bucket` is the
  GitHub delivery id for a webhook job, the `runId` for an interactive/import job, the ISO date of
  `notBefore` for a cadence job. `enqueue` upserts on that key and leaves an existing unsettled row
  alone, so a redelivered webhook, a double-clicked "Scan all" and two overlapping cron seeds cannot
  produce two jobs for the same work.
- **Claim.** `claimJob(lane, workerId)` is a conditional `updateMany` — the same DB-serialized
  mechanism as `claimRescan` — on `state = "queued" AND notBefore <= now`, writing `claimed`,
  `claimedAt`, `claimedBy`, `leaseUntil = now + 15 min`, `attempts += 1`, then re-reading the won
  row. Cross-instance safe; this replaces the module-global `Map`.
- **Lease reaping.** `reapExpiredLeases()` (head of every drain) returns rows past `leaseUntil` to
  `queued` while `attempts < 5`, else `failed`. A process kill self-heals; nothing retries forever.
- **Credit.** `creditCharged` is written before any inference and is the single record of the held
  credit; `settleJob` is the only refund path and reads it. The reserve/refund/`inferenceBilled`
  policy in `scan-credit.ts` is reused verbatim, not reimplemented. **Cut-over rule:** the
  process-local claim is deleted in the same commit that adds the DB claim — there is no release in
  which both exist (the dossier's named double-billing risk).
- **Honest nulls.** A probe that could not read (403/404 on the protection-bearing call, no token)
  writes `state = "unknown"`, never `off` — the rule `fetchBranchGovernance` already enforces by
  returning `null` on a denied read. `resultJson` is absent, not `{}`, when a job produced nothing.
- **Control vocabulary** (frozen for W3-M): `branch_protection`, `required_pull_request`,
  `required_approvals`, `required_code_owner_review`, `required_status_checks`, `signed_commits`,
  `linear_history`, `ruleset_count`, `org_security_policy`, `advisories`, `repo_visibility`,
  `repo_archived`, `repo_present` — a 1:1 projection of `Governance` + `SecurityPosture` + repo meta.
- **Wire types.** `ScanJobRow` / `ControlObservationRow` declare every timestamp as `string`;
  `toRow()` mappers `.toISOString()` server-side (wire-safe-dates guard).
- **Retention / erase.** Settled `ScanJob`s purge after 30 days; `ControlObservation`s follow the
  org's scan-retention window, with the newest row per (repo, control) always kept so current
  posture is never erased into "unknown". `eraseOrgData` deletes both via the `withRetry` batcher.

### Modules (signatures)

```ts
// src/lib/db/scan-jobs.ts
export type ScanLane = "rescore" | "probe";
export async function enqueueScanJob(j: EnqueueInput): Promise<{ id: string; created: boolean }>;
export async function enqueueDueRescans(limit?: number): Promise<number>;           // the seeder
export async function enqueueProbeJob(orgSlug: string, fullName: string, reason: string,
                                      deliveryId?: string): Promise<{ id: string; created: boolean }>;
export async function claimJob(lane: ScanLane, workerId: string): Promise<ScanJobRow | null>;
export async function settleJob(id: string, out: JobOutcome): Promise<void>;        // done|failed|skipped
export async function reapExpiredLeases(): Promise<number>;
export async function queueDepth(orgSlug?: string): Promise<Record<ScanLane, { queued: number; oldestAgeMs: number | null }>>;
export async function listJobsForRun(orgSlug: string, runId: string): Promise<ScanJobRow[]>;

// src/lib/db/control-observations.ts
export async function recordObservations(orgSlug: string, repoId: string,
                                         samples: ControlSample[], ctx: ObservationContext): Promise<{ written: number; transitions: number }>;
export async function latestObservations(repoId: string): Promise<ControlObservationRow[]>;
export async function listObservationsSince(orgSlug: string, since: string,
                                            opts?: { transitionsOnly?: boolean }): Promise<ControlObservationRow[]>;

// src/lib/scan-probe-controls.ts  (pure — no I/O, no DB)
export function governanceToSamples(g: Governance | null): ControlSample[];   // + postureToSamples,
export function repoMetaToSamples(m: RepoMeta | null): ControlSample[];       //   same shape
export function diffSamples(prev: ControlObservationRow[], next: ControlSample[],
                            heartbeatAfterMs: number, now: number): ControlSample[];
// src/lib/scan-probe.ts · src/lib/scan-queue-worker.ts
export async function probeRepository(input: ProbeInput): Promise<ProbeResult>;
export async function drainLane(lane: ScanLane, opts: DrainOptions): Promise<DrainSummary>;
```

`probeRepository` fans out `fetchBranchGovernance`, `fetchSecurityPosture` and one repo-metadata
`GET /repos/{o}/{r}` (visibility, archived, default branch; 404 → `repo_present: off`), maps each
through the pure samplers, diffs against `latestObservations`, writes the transitions plus any due
heartbeat, and refreshes `Repository.missingSince` from `repo_present`. **No LLM call, no `Scan`
row, no credit reserve, no `persistScanReport`** — a probe is not a scan and never writes a score.
Median cost ~3 REST calls and <2s, against ~6 min and one credit for a live scan.

### Routes

| Method · path | Auth | Behaviour |
|---|---|---|
| `GET /api/cron/rescan` | `requireCronAuth` (unchanged) | `reapExpiredLeases()` → `enqueueDueRescans()` → `drainLane("rescore")` until `fleetDeadlineAt(invokedAt, 300)`. The 100-per-pass cap is gone: the seeder enqueues everything due, the drain takes what fits. Returns `{ seeded, drained, done, failed, skippedForCredits, skippedNoToken, queueDepth, errors }`. |
| `GET /api/cron/probe` (new) | `requireCronAuth` | `maxDuration = 60`, `drainLane("probe", { concurrency: PROBE_CONCURRENCY })`. Hourly in `vercel.json`. |
| `POST /api/org/scan` | `requireOrgAccess` + `requireFleetOrg` (unchanged) | Mints a `runId`, enqueues one `rescore` job per selected repo, drains inline until the deadline, and streams the existing `progress`/`repo` frames plus a new `queued` frame `{ runId, queued, total }` in place of `truncated` — the remainder is a durable job the cron finishes. |
| `GET /api/org/scan/queue?org=&runId=` | `requireOrgAccess` | One run's job states, for the poll. The org is gated then passed into the query beside `runId` (gate-then-constrain), so a mismatched run is simply not found. |
| `POST /api/app/webhook` | GitHub signature + delivery dedup (unchanged) | Five new branches — `branch_protection_rule`, `repository_ruleset`, `repository`, `member`, `team` — each resolves installation → org and calls `enqueueProbeJob` in `after()`. **The payload is never trusted for control state**: it names *what to re-read*, and the probe re-reads it from GitHub (the discipline `installation_repositories` already follows). `member`/`team` enqueues probes for the org's watched repos, bounded by the delivery-id idempotency key. |

### UI

- **Repositories tab** (`RepoLeaderboardRow.tsx`): a two-line freshness cell in the existing
  `OrgTable` — `Scored <relative>` / `Controls <relative>`, mono `tabular-nums`, hairline-separated,
  `—` when null (never a fabricated "now"); a queued job gets a `Kicker`-styled "queued" tag. No new
  colour, no hand-picked hex, `scoreHex`/`LEVEL_HEX` untouched.
- **`OrgScanButton`**: "Continue (N left)" → "N queued — finishing in the background", polling
  `/api/org/scan/queue` inside the existing `role="status"` live region; the poll lives in
  `useOrgScanButton.ts` so the `.tsx` stays well under 300 LOC.

### Self-hosted · plan gates · privacy · audit

The probe lane is **free on every plan**, including Free and self-hosted (`selfHosted()` already
turns plan gates off); no new gate and no new env flag, so no escape-hatch floor is needed. No public
or aggregate surface is added, so `CHAMPION_MIN_POP` does not apply — `ControlObservation` is
org-scoped and read only through `requireOrgAccess`. Credit movement keeps its existing
`scan-credit` audit trail; new audit rows only for the operator-initiated `scan.queue.requeue` /
`scan.queue.cancel`, which are `requireOrgRole("admin")` and same-origin.

## Build order

1. **Queue core.** `scan-jobs.ts` + test: enqueue/idempotency, `claimJob`, `settleJob`,
   `reapExpiredLeases`. Nothing calls it yet — landable and gateable alone.
2. **Observation core.** `control-observations.ts` + `scan-probe-controls.ts` (pure) + tests, still
   uncalled. This is the contract W3-M reads; it lands before any writer so M can start on it.
3. **Probe runner.** `scan-probe.ts` over the existing fetchers; `missingSince` refresh.
4. **Probe worker.** `scan-queue-worker.ts` (`drainLane`), `PROBE_CONCURRENCY` +
   `drainUntilDeadline` in `pool.ts`, `/api/cron/probe`, the `vercel.json` entry. The probe lane is
   live end-to-end here and has touched no billing code.
5. **Webhook fan-in.** The five branches → `enqueueProbeJob`. Controls re-observe on change.
6. **The billing cut-over (one commit).** `/api/cron/rescan` becomes seeder + `drainLane("rescore")`;
   `/api/org/scan` and `/api/org/import` move to the DB claim; `claimRepoScan`/`releaseRepoScan` are
   deleted. Reserve/refund calls move with the code, unedited.
7. **Interactive queue.** `runId`, the `queued` frame, `/api/org/scan/queue`, `useOrgScanButton`.
8. **Freshness + retention.** `OrgRepoRow.freshness`, the Repositories cell, purge/erase,
   `docs/features/fleet/rescan.md`.

## Tests

**Unit (vitest)** — new: `src/lib/db/{scan-jobs,control-observations}.test.ts`,
`src/lib/{scan-probe,scan-probe-controls,scan-queue-worker}.test.ts`,
`src/app/api/cron/probe/route.test.ts`, `src/app/api/org/scan/queue/route.test.ts`. Extended:
`src/app/api/{cron/rescan,org/scan,org/import,app/webhook}/route.test.ts`, `src/lib/pool.test.ts`,
`src/lib/db/{org-watch,retention}.test.ts` (the deleted claim's tests are removed, not skipped),
`src/features/standing/repositories/RepoLeaderboardParts.test.tsx`.

**Fail-before each guard must reproduce**
- *Double-billing across instances*: two concurrent claims of one queued rescore job — one wins,
  exactly one `reserveScanCredit`. Fails against the module-global map with two simulated processes.
- *Idempotent enqueue*: a webhook delivery replayed twice yields one job. Fails today (no queue).
- *Unknown is not off*: a 403 on the branch read yields `state: "unknown"`, no `off` row, no
  transition. Fails against any mapper defaulting a denied read to `false`.
- *Heartbeat bound*: 100 identical probes over 25h write 2 rows per control, not 100.
- *Truncation is not loss*: a deadline-truncated `/api/org/scan` leaves the remainder `queued` and
  the next `drainLane` completes exactly those repos, with no repo scanned twice.
- *Lease self-heal*: a job whose worker died re-`queue`s after `leaseUntil`, and `fail`s (not loops)
  on the 5th attempt.
- *Payload is not trusted*: a `branch_protection_rule` delivery claiming `deleted` writes **no**
  observation by itself — only the probe's re-read does.

**Structural guards touched**: `src/lib/db/wire-safe-dates.test.ts` (two new row types — Director
lands the entries); `src/app/api/org/id-routes-gated.test.ts` (unchanged shape: the new
`/api/org/scan/queue` is query-gated, not an `[id]` route, and uses gate-then-constrain);
`scripts/docs/__tests__/check-doc-sync.test.mjs` (every new `sourceGlob` must match a tracked file).

**e2e / UAT**: re-run **Tomáš** (platform lead, fleet freshness — the journey this item exists for)
and **Sam** (a single-repo rescan must still complete inline and bill exactly once). Dana's briefing
journey is unaffected (no `briefing.ts` change) but is re-run if the Repositories cell moves any
shared `OrgTable` markup.

## Gate + done criteria

`npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks (300 `.tsx`,
200 under `src/features/**`) → e2e (UI moved). **Done** when: a 900-repo org seeds in one cron pass
and drains across passes with no `truncated` data loss; a `branch_protection_rule` delivery produces
a `ControlObservation` transition with **zero** credit movement; `claimRepoScan` no longer exists in
the tree; and `rescan.md` documents both lanes with the superseded gaps deleted.

## Out of scope

- **#1 Governance evidence ledger (W3-M)** — normalizers, `GovernanceEvent`, hash chain, as-of-merge
  pack, `AlertEvent.kind = "control"`, the governance timeline, the verify endpoint. This lane writes
  the observations and stops there. **#8 (W4-O)** — nothing is *written* to a customer repo.
  **#4 (W4-P)** — the probe is GitHub-only and touches no `RepoSource` seam. **#11 (W1-C)** — the
  probe runs no inference, so it emits no `UsageEvent`. **#16 (W1-A)** — `ConformanceReport` is a
  different ledger fed by the repo's own doctor; a probe never runs the doctor.
- Deferred deck items this must not absorb: **#21** *GitHub identity graph sync + scoped membership*
  (the `member`/`team` branches enqueue a probe and write **no** membership or RBAC row), **#28**
  *Durable scheduled drives* (this queue serves scans, not autopilot drives — `LoopRun` stays the
  autopilot's), **#29**, **#24**, **#31**, **#37**.
- A distributed rate limiter / Redis: the DB claim is the lock, and `src/lib/rate-limit.ts` stays
  process-local and out of this lane.
