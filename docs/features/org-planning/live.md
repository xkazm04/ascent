# The Live tab: the loop cockpit

**Status (2026-08-22): server side SHIPPED, cockpit UI in flight.** The durable, bounded-parallel
**loop engine** — `LoopRun`/`LoopRunLane`, `/api/org/loop`, `src/lib/local/loop-engine.ts` — is
implemented and tested. The Live tab (`?tab=live`) is being rebuilt around it as an *Observatory*
cockpit; the prior war-room wall is kept behind `?view=wall`. The UI section below is a marked
placeholder until that lands.

The **local** loop on this page is self-hosted only (`selfHosted()`, `src/lib/env.ts`): it reads the
server's filesystem and spawns `claude -p`, so `POST /api/org/loop` with the default
`executor: "local"` answers **404** on managed cloud (`selfHostGuard`).

Since **moonshot #3** that is no longer the whole story. A run may also declare
`executor: "remote-agent"` — see [Remote runs](#remote-runs-the-agent-neutral-work-protocol) — and
such a run takes NEITHER guard, because Ascent starts no process, opens no worktree and touches no
filesystem for it. The work happens in whatever agent the org already uses, which claims its rows
over the [MCP work tools](../org-knowledge/skills.md#the-work-protocol-claim--brief--report). The
status read (`GET /api/org/loop`) is therefore served on cloud too, with `enabled: false` still
telling the truth about the local loop.

## The loop

```
select ──▶ curate ──▶ run ──▶ rescan ──▶ outcome
  │          │         │        │           │
  │          │         │        │           └─ per-lane before/after diff + closed follow-ups
  │          │         │        └─ scan the WORKTREE from disk; the rescan ADJUDICATES the claims
  │          │         └─ N lanes, bounded parallelism. Each lane is one of three KINDS:
  │          │            backlog → worktree → local `claude -p` → LANE commits → rescan
  │          │            foundation / practice → worktree → generated files + commit → rescan
  │          └─ GET /api/org/loop/propose: the batch AND the kind each lane would get, editable
  └─ repos picked in the cockpit (the Observatory's adoption × rigor field)
```

It is the [local-mode autopilot](../local-mode/README.md#autopilot-tab=live-self-hosted--paired--ascent_autopilot=1)
widened on two axes: **arity** (a selected *set* of repos, worked as lanes) and **durability** (the
database is the source of truth, not a process `Map`). The autopilot is now a thin shim over this
engine.

## The model

Two tables, added by `prisma/migrations/20260822120000_add_loop_run` and mirrored into
`prisma/init.sql` (which is how the embedded PGlite dev database gets them — `init-sql.test.ts`
fails if a model is in `schema.prisma` and not in the mirror).

### `LoopRun` — one improvement pass over a selected set

| Field | Notes |
| --- | --- |
| `id` / `orgId` / `createdBy` | `createdBy` is the GitHub login that armed the run (audit trail on the row). |
| `phase` | `curating \| running \| done \| stopped \| error`. A LOCAL `start` writes `running` directly. A REMOTE run is the one thing that writes `curating`: `startRemoteRun` arms the lanes and nothing is in flight until an agent claims into one, at which point the run flips to `running`. |
| `reposJson` | The run's selected set, TEXT not `jsonb` (the schema's DSQL contract). **Two encodings, both read forever** (`parseTargets`): the original JSON `string[]` of `owner/name`, and the widened `[{repo, kind, practiceId}]` that carries each repo's armed [lane kind](#lane-kinds-foundation-and-practice-lanes-2026-08-28). A legacy row parses as all-`backlog`, which is what those runs were. Widened rather than given a column deliberately — see that section. |
| `concurrency` | Lanes in flight at once. Clamped 1…`LOOP_CONCURRENCY_CAP` (4); default 2. |
| `maxCycles` | Clamped 1…`LOOP_MAX_CYCLES_CAP` (5); default 3. |
| `cycle` | The cycle being worked (`0` = none started). |
| `curated` | True when the operator approved the batches by hand. |
| `batchSize` | Follow-ups (or craft rungs) one lane dispatches per cycle. Nullable, **NULL = 5** — the value that used to be hard-coded. Capped at `BATCH_SIZE_CAP` (12). §[Throughput](#throughput-batch-session-ceiling-and-the-reservation-2026-08-31). |
| `agentTimeoutMs` | Per-session agent ceiling. Nullable, **NULL = `ASCENT_AUTOPILOT_TIMEOUT_MS`** (20 min). Bounded 60 s…90 min. |
| `verifyMode` | `on \| off` — the A/B degradation guard. Nullable, and **NULL means `on`**: the guard is the default posture, and `off` is an operator's explicit refusal to run repo-authored verification commands. §[The A/B degradation guard](#the-ab-degradation-guard-2026-08-31). |
| `verifyTimeoutMs` | Budget for ONE run of the repository's own check. Nullable, **NULL = 10 min**; bounded 30 s…30 min. |
| `delivery` | `branch \| land \| pr` — **how this run's work reached the operator** (§[Delivery](#delivery-what-happens-to-a-lanes-branch-2026-08-31)). Nullable, and **NULL means `branch`**: every run written before the column committed to a throwaway lane branch and left it, which is exactly what `branch` is. `normalizeDelivery` parses it; an unknown value is `null`, never a guess. |
| `startedAt` / `endedAt` / `error` / `createdAt` | `endedAt` set on every terminal transition. |

Index: `@@index([orgId, createdAt])` — the run-history page's only query shape.

### `LoopRunLane` — one repo, one cycle

The unit of parallelism, of retry, and of the cockpit's row.

| Field | Notes |
| --- | --- |
| `runId` / `repoFullName` / `cycle` | The lane's identity. `upsertLane` is get-or-create on this triple, so a retry re-enters the same row. |
| `phase` | `queued \| dispatching \| rescanning \| done \| error`. |
| `branch` | `ascent/loop-<stamp>-<repo>` — **the deliverable**. Survives the run; only the temp worktree dir is removed. |
| `batchIdsJson` / `closedIdsJson` | JSON `string[]` of `Recommendation` ids dispatched / **closed by the rescan**. `closedIdsJson` is `persistScanReport`'s `closedFollowUpIds` — the ids `decideInProgress` ruled `done` after the movement witness — **not** the commit-trailer set. See *The claim and the verdict* below. |
| `commits` | `git rev-list --count <before>..HEAD` in the worktree. |
| `beforeScanId` / `afterScanId` | The two ends of the lane's diff (see [Outcome](#outcome-what-the-lane-moved)). |
| `stage` | Live rescan sub-stage (`fetch \| tree \| files \| analyze \| score \| compose`), `null` between phases. |
| `log` | Newline-joined, **bounded to `LANE_LOG_LINES` = 200**, newest last, each line stamped `HH:MM:SS`. Appended read-modify-write; safe because a lane is single-writer by construction. |
| `error` / `startedAt` / `endedAt` | A failed lane is lane data, never a run failure. |
| `verifyVerdict` | `verified \| rejected \| baseline-red \| skipped`. **NULL is not `skipped`** — it is a lane written before the guard existed, whose verification state is unknown, and rendering it as "skipped" would be a claim about a run nobody made (`asVerifyVerdict` floors an unreadable value to null). A `rejected` lane is **never landed and never PR'd**. |
| `verifyCommand` / `verifyNote` | The command that was run and the first meaningful failure lines, so "why was this rejected" survives the throwaway worktree it happened in. These three columns are also the ONLY store behind the red-baseline surface and the brief's lead item — §[A red baseline is SURFACED](#a-red-baseline-is-surfaced-and-becomes-the-loops-own-top-priority-work-2026-08-31) adds no parallel state. |

Index: `@@index([runId])`.

**No cascade, by convention.** `relationMode = "prisma"` emits no `ON DELETE`, so every delete graph
is the application's job: lanes are deleted before their run (see
[retention.md](../data/retention.md#on-demand-erasure-dsr--right-to-erasure), which erases both with
the org's data).

**JSON-in-TEXT.** `reposJson`, `batchIdsJson`, `closedIdsJson` are TEXT columns holding JSON arrays,
like `areasJson`/`warningsJson` elsewhere in the schema. Decoding lives in one place
(`toRunRecord`/`toLaneRecord`, `src/lib/db/loop-runs-types.ts`) and **degrades to `[]` rather than
throwing** — a malformed column must not crash a React tree three layers up.

Store layout: `src/lib/db/loop-runs.ts` is a barrel over `-types` (shapes, constants, row→record),
`-read` and `-write`. `src/lib/db/loop-tenancy.ts` holds the one org-slug → org-id resolution the
routes use for their tenancy re-check, in its own module so the check is visible in an import list.

## API

All four are `runtime = "nodejs"`, `dynamic = "force-dynamic"`, and behind `selfHostGuard()` — on
managed cloud they 404 rather than 403, because a 403 would advertise a surface that does not exist
there. The `public` funnel org is refused everywhere.

### `GET /api/org/loop?org=<slug>`

Member-gated (`requireOrgAccess`). Reconciles stale runs first (see
[stale-run reconciliation](#stale-run-reconciliation)), then answers:

```jsonc
{ "enabled": true,               // autopilotEnabled(): ASCENT_AUTOPILOT=1 + the claude CLI
  "active": { /* LoopRunRecord */ } | null,
  "runs":  [ /* LoopRunSummary × ≤20, newest first */ ] }
```

`LoopRunSummary` carries a `lift`: the summed overall-score movement across the lanes that have
**both** ends. `null` when none do — "not measurable yet" is not the same number as zero movement.
The whole page's lift is folded from one extra query, not one per run.

Errors: `400` missing/`public` `org`; `404` on cloud; whatever `requireOrgAccess` returns.

### `POST /api/org/loop`

`selfHostGuard` → `dbGuard` → `requireOrgRole(org, "owner")`. Owner, not member: arming a run spawns
editing agents inside paired working copies — the same blast radius as pairing itself.

| Action | Body | Answers |
| --- | --- | --- |
| `start` | `{ action, org, repos[], batches?, concurrency?, maxCycles?, curated?, model?, effort?, delivery?, batchSize?, agentTimeoutMs?, verifyMode?, verifyTimeoutMs? }` | `{ run }` |
| `stop` | `{ action, org, id }` | `{ ok, run }` — `200` when stopped, `409` when not |
| `retry` | `{ action, org, laneId }` | `{ ok }` — `200`/`409` |
| `review` | `{ action, org, laneId, cover, verdict }` | `{ ok, deliverables }` — the quick-approval gate; `verdict` is `approved \| dismissed`, `cover` is the row's first `covers` id (else its headline). Sits with `stop`/`retry` **before** the `ASCENT_AUTOPILOT` check: ruling on a past run must work after the loop is switched off. Same owner gate + tenancy re-check as the other writes. |

- `400`: missing `org`/`action`, empty `repos`, `maxCycles` outside 1–5, `concurrency` outside 1–4,
  missing `id`/`laneId`, or any of `batchSize` / `agentTimeoutMs` / `verifyMode` / `verifyTimeoutMs`
  **sent** and out of band. Those four are validated by normalizers that **never guess**
  (`src/lib/local/run-limits.ts`): an unrecognised value is `null` = "unchosen", and a caller who
  *sent* one gets a 400 naming the band rather than a run quietly configured with a number nobody
  asked for. **Omitting** a field is the supported way to say "use the deployment default", and that
  path records `null`.
- `403`: the `public` org.
- `409`: `ASCENT_AUTOPILOT` is not set (the message names the fix), or **any** throw out of
  `startLoopRun` — a broken pairing, an already-active run, no database.
- `404`: the named run/lane does not exist **or belongs to another org**. `stop` and `retry` name a
  row by id after the caller was authorized for a *slug*, so the row's `orgId` is re-checked against
  `orgIdForSlug(org)`. Without that, an owner of org A could stop org B's run by guessing an id.
- `batches` is `{ "owner/repo": ["recId", …] }`, defensively narrowed on the wire, and applies to
  **cycle 1 only**.

### `GET /api/org/loop/<id>?org=<slug>`

Member-gated; `org` is **required** even though the id alone would resolve the run — an id-only route
would either authorize nothing, or have to trust the row it is about to disclose. Returns
`LoopRunDetail`: `{ run, lanes[], outcomes[] }`. `404` when the run is missing or is another org's.

### `GET /api/org/loop/propose?org=<slug>&repos=a/b,c/d`

Member-gated. The curation step's data: the batch each repo's lane *would* get if a run started now.

```jsonc
{ "proposals": [ {
  "repo": "acme/api",
  "items": [ /* FollowUpItem × ≤5 — always [] on a foundation lane */ ],
  "projectedPoints": 14,
  "kind": "backlog",          // backlog | foundation | practice
  "practiceId": null,          // set only on a practice lane
  "reason": "Works this repo's open follow-ups with a local agent."
} ] }
```

It calls the **same `openBatch`** the engine calls, and the **same `proposeLaneKind`**. That identity
is the point: a curation screen built on a second, "equivalent" query would eventually propose a
batch (or a lane kind) the engine then declines to work. It is a `GET` because it writes nothing — no `LoopRun` row exists until `start`, so the panel
can be opened and closed freely. `400` on a missing `org` or empty `repos`. The static `propose`
segment resolves ahead of the sibling `[id]` route, so the two never collide.

## The engine

`src/lib/local/loop-engine.ts` arms a run and returns its row **immediately**; the loop itself runs
detached and the cockpit polls `GET /api/org/loop`.

- **A lane** (`loop-lane.ts`) is one repo for one cycle: pick the batch → claim the rows
  (`status: in_progress`, so the rescan's trailer/restatement feedback applies to them —
  `scans-persist` only resolves *claimed* rows) → `git rev-parse HEAD` → one headless `claude -p`
  session in the worktree with `buildFixPrompt` + an autopilot context block → **the lane commits
  what the session left** (below) → count commits → rescan the worktree from disk → record what the
  rescan **adjudicated** closed (never what the trailers claimed — see *The claim and the verdict*).
  `runLane` **never throws**: every outcome, including a failed agent or a failed
  rescan, is lane data.
- **Bounded parallelism**: `mapPool(activeTargets, run.concurrency, …)` — default 2, hard cap 4.
  Four local `claude -p` sessions already saturate a developer box.
- **A worktree per repo per RUN** (not per cycle): `git worktree add -b <branch> <tmp> HEAD` off the
  paired path. Cycles build on each other's commits like a human working a branch, and one branch is
  one reviewable deliverable. Branch names are folded to a safe single ref segment:
  `ascent/loop-<stamp>-<repo>`; the [autopilot shim](../local-mode/README.md) overrides `branchFor`
  to keep its historical `ascent/autopilot-<stamp>`. Teardown removes only the temp dir (`--force`);
  **the branch is left behind on purpose**. What happens to it next is the run's `delivery` mode
  (§[Delivery](#delivery-what-happens-to-a-lanes-branch-2026-08-31)): `branch` (the default) leaves
  it, `land` fast-forwards it into the paired checkout's current branch, `pr` pushes it and opens a
  draft PR. Outside `pr` — and outside the one owner-click PR action of §*From lane branch to
  reviewed PR* — **nothing pushes**: not the drive, not a schedule, not the lane itself.
- **Curated cycle 1, auto afterwards.** Cycle 1 uses `input.batches[repo]` when given; every later
  cycle auto-picks the **top 5 open follow-ups by projected points** (`BATCH_SIZE`). A curated batch
  *names* its rows, so the pick spans the repo's whole open list (`limit: 500`) and then filters —
  filtering a top-5 slice would silently drop a curated id ranked 7th.
- **Per-lane early stop.** A cycle that produced neither a commit nor a closed row drops that repo
  out of the next cycle. This is the autopilot's no-progress rule applied *per lane* instead of per
  run, so one stalled repo no longer ends the whole fleet's pass.
- **A lane with zero commits does not rescan.** See [Durability](#durability-the-lane-commits-and-a-lane-that-did-not-contributes-nothing).

### Durability: the lane commits, and a lane that did not contributes nothing

Both halves of this come from the 2026-08-29 L2 certification
([`uat/runs/2026-08-29-loop-l2`](../../../uat/runs/2026-08-29-loop-l2/loop-to-l5-l2.md)), where a real
`claude -p` session worked for 5m46s and the loop kept none of it.

**The lane commits the agent's work** (`lane-commit.ts`). `runClaudeAgent` spawns with
`--permission-mode acceptEdits`, which auto-accepts *edits* and **not Bash** — and headless `-p` has
nobody to answer the permission prompt `git commit` raises instead. So the brief's old instruction
("commit directly to it, one commit per resolved item") asked for the one action the flags make
impossible, and `removeLoopWorktree --force` then deleted the only copy. The fix keeps the narrow
permission and moves the commit to the lane, which is what `lane-install.ts` has always done for the
deterministic kinds. Widening `--allowedTools` was the alternative and was **declined**: worktree
isolation is the blast-radius bound and an unattended agent that may execute git is a materially
wider grant.

- The brief (`buildFixPrompt`, `commitPolicy: "lane"`) now tells the session **not** to run git, and
  asks it to end with `RESOLVED: <id>` / `SKIPPED: <id>` lines — the one fact only the session knows.
  The human paste-into-my-terminal prompt is unchanged (`commitPolicy: "agent"`, the default), where
  writing your own trailers is the whole contract.
- The lane stages the worktree diff **by path** (never `add -A`; `-z` porcelain, so a quoted path
  cannot be mis-staged) and writes one `Ascent-Resolves:` trailer per claimed id. Named RESOLVED ids
  win; naming only SKIPPED ones trails the rest; **naming nothing trails nothing**. An id
  the lane never armed is ignored, and a trailer line inside the agent's own prose is stripped — a
  session cannot enlarge its own batch. The trailer is still a **claim**: a row closes only when the
  next scan says its dimension moved.
- **A session that ended in ERROR never titles the commit.** `runAgent` returning `ok: false` (a
  timeout, a crash, a non-zero exit) means `summary` is the runner's failure text, not an account of
  the work — and `laneCommitSubject` used to read a subject line off it. A campaign branch carried
  **1605 insertions across 15 files** under `fix: Agent session exceeded 20 min and was stopped`
  (`PRIYA-L2-C7`, 2026-08-30). The lane now passes `sessionFailed` and the subject falls back to
  `chore: partial work from an interrupted lane session`, with a paragraph in the body saying the
  changes are the session's unreviewed residue. **The error is not dropped** — it still rides
  verbatim in the `Agent summary:` block, where a reader looking for it finds it and `git log
  --oneline` does not lead with it.
- If the agent *did* commit (a future mode with a wider grant), the lane commits only the residue.
- If the lane's own commit fails, the lane names the uncommitted change count and the branch the work
  is **not** on before the worktree is deleted.

### The claim and the verdict are two different numbers

A user reading the cockpit sees a per-item panel and a per-lane counter, and until 2026-08-31 both
said **"closed by the rescan"** for work nothing had verified. The mechanism, in one line: the lane
wrote the `Ascent-Resolves:` trailers *from the agent's own `RESOLVED:` lines*, the rescan parsed
those same trailers back out of the commit messages, and the lane handed that set on as the verdict.
The agent was its own verifier. Live, that produced **46** rows labelled "closed by the rescan" on an
org whose backlog ledger — which applies the real gate — reported `done: 0`.

Three rules now hold, and they are the vocabulary the whole loop answers to:

1. **A lane's `closedIds` is the ADJUDICATED set.** `rescanWorktree` returns
   `persistScanReport`'s `closedFollowUpIds`: the in-progress rows `decideInProgress` ruled `done`
   after the restatement read, the dimension's own movement, and `attributeDelta` over the two
   engines (a mock end, or a move inside the ±noise band, closes nothing). The commit trailers come
   back separately as `claimedIds` and are never folded into a count.
2. **Every outcome row carries `verified`, read from its own `verifiedAt` stamp.**
   `LaneItemOutcome.verifiedAt` is written by `recordLaneOutcomes` at the moment the rescan's
   adjudicated set (rule 1) named the id, and `listRunOutcomes` reads the column. `verified` is
   `true` only for a `resolved` row with a stamp; **null is never verified**, on any path.
   *This replaced a read-time join and had to.* `verified` was first derived by joining the lane's
   `closedIdsJson` — exact for new rows, but every lane written before rule 1 stored the raw
   commit-trailer set there, which is the agent's own claim. The tautology re-entered through the
   join: a recertification sweep of the only corpus that exists found **36 of 36** historical rows
   returning `verified: true` and not one rendering the new label. A stamp is per-row, so an A/B
   run's two arms — which arm the same batch — cannot verify each other's claims by construction.
   A row from a payload without the field reads as unverified.
   **There is no backfill, and that is the fix, not a shortfall.** Every pre-column row has a null
   stamp and now reads *"claimed resolved — awaiting the rescan"*, which is what those rows are:
   nothing adjudicated them, and no migration can invent an adjudication that never happened. The
   next rescan is what earns them a stamp.
3. **The panel says which one it means.** A verified close reads *"closed by the rescan"* in the
   accent tone; an unverified one reads *"claimed resolved — awaiting the rescan"* in a muted italic,
   with a title explaining that the item is still open. The lane counters and the run band say
   *"closed by the rescan"* because, after rule 1, that is now what they count.

**Silence claims nothing.** The lane used to trail *every armed id* when the session named none, on
the reading that "the rescan decides anyway" — which rule 1 shows was not true. A live session killed
by the 20-minute timeout, having written **zero** item verdicts, had all five of its armed ids
stamped as resolved trailers in its name. A session that said nothing has made no claim, so the
commit now carries no trailer and says so in its body. Nothing is lost: a gap still closes on the
rescan's own *no-longer-raised **and** the dimension moved* rule, which needs no trailer. A **craft**
rung, which closes on its trailer alone, simply stays in progress — the honest reading of a session
that never said it built anything.

**A lane that committed nothing rescans nothing.** The loop scans a *worktree* that is about to be
deleted, so that scan describes the repository only for what the lane committed. In the L2 run it did
not: the cockpit printed `▲+24 · ATTRIBUTABLE LIFT` three lines above `0 commits`, and the after-scan
became the repo's **latest** reading, so the fleet's greenness and debt credited it with a standard
that existed nowhere on disk. `runLane` now skips the rescan entirely at zero commits (nothing is
persisted, so nothing is adopted; the claims are released, since a rescan was the only thing that
would ever adjudicate them) — and it also stops paying for an assessment of a directory about to be
removed. The read side refuses the same pair independently; see the `undelivered` verdict below.
- **Stop semantics.** `stopLoopRun` sets a cooperative flag on the in-memory `LiveRun`; lanes check
  it *between* phases, never mid-agent-session. An in-flight lane finishes its agent session, skips
  its rescan, and the run winds down to `stopped`. Stopping a run this process does not own (already
  finished, or a restart casualty) reconciles the row instead of no-opping.
- **The wind-down is narrated.** A cooperative stop takes as long as the in-flight session does, and
  a live capture measured **19 min 43 s** of unchanged `RUNNING` after the operator pressed Stop
  (`PRIYA-L2-C6`, 2026-08-30) — the button had already sprung back, because it was disabled on the
  *fetch* rather than on the request. `loopRunStopRequested(id)` now reads the pending flag out of
  the process-wide registry, and `GET /api/org/loop` carries it as `stopping` beside `stopHorizonMs`
  (the run's own `agentTimeoutMs`, resolved against `ASCENT_AUTOPILOT_TIMEOUT_MS` **server-side** —
  a browser cannot know that number). The header then holds *"Stopping…"* and prints
  *"Stopping — in-flight lanes finish their current session first, up to 20 min."* until the run
  settles. A `null` horizon prints the sentence **without** a bound rather than inventing one.
  The flag itself stays in the registry: it is the signal a running driver reads, a run this process
  is not driving is a restart casualty `markStaleRunsStopped` settles, and a `LoopRun.stopRequested`
  column would persist a fact that has no meaning across a restart. (`stoppingCaption` is pure and
  tested; `CockpitHeader.dom.test.tsx` pins the label and the caption.)
- **Lane error + retry.** A worktree that cannot be created is a lane error, not a run error. `retry`
  re-runs one lane on a **fresh worktree and a fresh branch off HEAD** — by the time anyone retries,
  the run has ended and its worktree is gone, and re-creating a worktree on the old branch would
  either fail or silently re-target whatever that branch now points at. A lane still `dispatching` or
  `rescanning` is refused (never double-dispatch).

### Stale-run reconciliation

The engine's live state (`Map<runId, LiveRun>`) holds only what cannot be serialized: the stop flag
and the worktree handles. So a `running` row that *this* process has no registry entry for is, by
construction, a restart casualty — a lie, not a resumable job. `markStaleRunsStopped(org)` marks such
runs `stopped` with `"Interrupted — the server restarted while this run was in flight."` and flips
their non-terminal lanes to `error`.

It runs at **three** moments: at **boot**, from `register()` in `src/instrumentation.ts` via
`sweepInterruptedWork()` (so a crashed run stops reading as `running`, and its lanes' backlog claims
are released, whether or not anybody opens the tab); on `GET /api/org/loop` (so the cockpit never
renders a job nobody is driving); and inside `startLoopRun`, *before* the one-run-per-org check —
otherwise a single crash would bar the org from ever starting another run.

The `isLive(id)` predicate is what separates the three. The two request-path callers pass
`isLoopRunLive`, because without it a poll during a run stops the run it is rendering (2026-08-26).
The boot sweep passes nothing, and that default — "nothing is live" — is true there and only there.

**The predicate only answers for runs this process could be driving** (since 2026-08-31; UAT
`PRIYA-L1-701`). The whole inference is *no live handle ⇒ the process that owned it is gone*, and
that holds only while a live handle is something the run would HAVE. A **remote** run never gets one:
`startRemoteRun` creates no registry entry by design — its work is done by an agent in someone else's
harness, reached over MCP — so `isLive` is false for it by *construction*, not by death. With `GET
/api/org/loop` firing the sweep on every read, reading the cockpit would have stopped a healthy
remote run and taken its lanes' claims down with it. The sweep now excludes any stale run holding a
lane whose `executor` is not this process's (`remote-agent`, `human`), asked as *any* such lane
rather than *all* of them, because the sweep's only verb is stopping the whole run. A local run was
never at risk **because of its registry entry** — a live local run survived six reads over ~24 s in
the L2 capture — which is the isolation, not the excuse. *The remote consequence stays a
**hypothesis**: the missing predicate was fact, but the remote path was not reproducible on this
host, so the exclusion is pinned by unit tests rather than by a reproduction.*

**A release clears the claim, not only the status.** The rows a dead run's lanes marked
`in_progress` go back to `open` **and** have `claimActor`, `claimExecutor` and `leaseUntil` cleared;
the lanes it errors out have their `claimedBy`/`leaseUntil` cleared too. Leaving those standing made
a released row read as open-and-still-held: the worklist rendered a holder nobody could reach, and
the claim path's compare-and-set over `(status, leaseUntil)` had a lease to reason about for a claim
that no longer existed.

**The boot sweep also reconciles the filesystem** (L2-C-02). `removeLoopWorktree` runs in the lane's
`finally`, which a `taskkill /F` never reaches, so every hard kill stranded a ~15 MB temp checkout in
`%TEMP%` forever — the L2 run left 3, and the operator's machine was already carrying 4 more from
three days earlier. `sweepInterruptedWork` now reads the in-flight lanes **before**
`markStaleRunsStopped` (afterwards a lane this process interrupted is indistinguishable from one that
errored last week), then removes their worktrees from the paired working copy.

It is driven **from the branch**, not from a directory listing: a branch name is unique to one lane
of one run, so `git worktree list --porcelain` can be *asked* which checkout belongs to a run the
sweep just stopped. A live run's worktree can never match, because a live run is not in the set. The
`%TEMP%` + `ascent-loop-*` shape is a **second** condition checked before anything is deleted, so an
operator whose own checkout happens to sit on a matching branch is untouched. `git worktree prune`
afterwards clears the administrative files for directories somebody already removed by hand. The
branch itself is left behind, exactly as `removeLoopWorktree` leaves it — it is the deliverable.

### Outcome: what the lane moved

`getLoopRunDetail` resolves each lane to its `before`/`after` scan pair and diffs them with the same
`diffScans`/`getScanComparison` the report's compare view uses — so a lane's "what moved" and the
repo's own comparison page can never tell two different stories about the same pair. `beforeScanId`
is captured at dispatch time using the *exact* ordering `scans-read` uses (`scannedAt`, then
`createdAt`, then `id`): `scannedAt` is not unique, and a bare desc sort would bracket the lane
against a different "latest" scan than the comparison view later reads. A lane with no recorded
`before` has nothing to diff against and reports `diff: null` rather than inventing a baseline.

### Outcome: what the lane DELIVERED — headlines (wave 2, 2026-08-30)

A lane's cell used to print raw evidence: two 90-character recommendation titles, then
`D9 -42: Token permissions [posture/high]: 0/10 — 0/1 workflows…; removed SAST…` uncapped. It now
prints **one short line per deliverable** — "Hardened CI/CD security", "Added permissions scope to 3
workflows" — several rows per repo, grouped by kind then dimension (`outcomeDeliverables.ts`).

```ts
type LaneDeliverableKind = "closed" | "installed" | "hardened" | "regressed" | "noted";
interface LaneDeliverable {
  headline: string;            // ≤ 8 words, verb-first past tense
  dimId: DimensionId | null;
  kind: LaneDeliverableKind;
  covers: string[];            // follow-up ids / signal names this covers
  evidence: string | null;     // one line for the expanded view
  retired?: true;              // the rescan stopped raising it; no agent clause covers it
}
```

**`closed` vs `retired` (2026-08-30).** `closed` used to mean two very different things: a gap the
**agent** actually closed, and a row the **rescan** simply stopped raising. One run printed ten
"closed" rows off a single commit — nine were phantom D4 rows being retired after the
coverage-guarantee fix, work nobody did — which overstates the loop on the sheet and in any ledger
built on it. A row the rescan retired with no agent `RESOLVED` clause behind it now carries
`retired: true`; `closed` keeps its original meaning, agent-claimed work. A retired row **never**
takes the dimension's movement template (*"Hardened CI/CD security"*) — the rescan dropping a row is
not the loop hardening a dimension — and its evidence line leads with `RETIRED_NOTE`
(*"No longer raised by the rescan; not claimed by the agent."*) followed by the follow-up's title.

It is a **flag, not a sixth `LaneDeliverableKind`**, and that is a deliberate one-representation
choice: the sheet's `KIND_META` is an exhaustive `Record<LaneDeliverableKind, …>` in
`src/features/inflight/live/outcome/outcomeDeliverables.ts`, which this change does not own, so a new
member would be a compile break there while an unread flag degrades to exactly today's rendering —
which is why the distinction is also carried in the **evidence line**, where it is visible today. It
is asserted **only when the lane's own `RESOLVED:` lines are on file**: a read-side backfill always
passes `agentClaims: []` (the agent summary is not persisted), and "unknown" is never evidence of
"not claimed" — the same posture `parsePlatformSignals` and `getLatestUnmeasurableDims` take. **Known
gap:** that leaves historical backfilled rows classified as `closed`. Threading the lane's persisted
`report.items` into the backfill's `agentClaims` (one line in `laneOutcome`, `loop-runs-read.ts`)
would let those classify too.

**The totality guarantee (2026-08-30).** `deriveLaneDeliverables` is **total** for a lane that did
something: **if the lane committed or closed anything, it returns at least one deliverable.** Run
`94477208` recorded `commits: 1`, `closedFollowUpIds: 16` and `deliverables: []` on both repos — the
sheet rendered a project header with no rows under it, so the loop did work and reported nothing. A
ledger that can silently say "nothing happened" about a lane that committed is worse than one that
says something imprecise, because nobody can tell the two apart. The fallback chain, in order:

1. the agent's `RESOLVED` clauses;
2. the `recsMovedToDone` titles and the closed follow-up ids — **now emitted even when the id
   resolves to no recommendation title** (a `continue` there was the whole of the `94477208` bug);
3. the deterministic lane's install;
4. the dimension the commits moved — as `noted`, *"Committed N changes on &lt;dimension&gt;"*;
5. the bare count — `noted`, *"Committed N changes"*.

**A row names WHICH follow-up, and a placeholder never repeats.** Run `17681528` recorded sixteen
deliverables per lane off a single commit, every one of them reading *"Closed a follow-up"* — sixteen
indistinguishable rows are noise wearing the costume of work, and worse than the empty list they
replaced. The ids were known and the titles were sitting in `before.recommendations[]` all along; the
derivation reached for the placeholder only because the recommendation carried no `dimId`. So:

- the **title is the headline** whenever one can be looked up, in either place that carries one — the
  pair's own `recommendations[]` or `diff.recsMovedToDone[]`. A dimension template is used only where
  it is earned: a known dimension *and* not a retirement;
- a title-derived headline is the **scan's** own sentence, so two ids that produced the identical one
  merge into a single row **keeping both in `covers`** — routed through the same merge an
  agent-written clause goes through, rather than around it;
- ids whose title cannot be resolved at all collapse into **ONE counted row** carrying every one of
  them in `covers` — *"Retired 9 follow-ups no longer raised"* (or *"Closed N follow-ups"* when the
  claims are not on file), never N identical rows. **Repeated identical headlines are a bug, not a
  list**, and a single counted row is the right shape for a mass retirement.

Rungs 4–5 are `noted`, never `hardened`: naming the dimension the commits landed on is an
observation, with no direction, no delta, and the evidence line dropped unless the verdict was
attributable — the verdict gate below is not routed around. A lane that did **nothing** still derives
nothing; totality is not a licence to invent a row.

**Left for the UI owner** (`outcomeDeliverables.ts` is outside this change's write set): `KIND_META`
has no label for a `retired` row (it renders as *"Closed"*, with the honest headline beside it) and
`DELIVERABLE_KIND_ORDER` has no separate slot for one. A `retired` badge — or a `retired` branch on
the `closed` label plus its own order slot — is a one-line follow-up there. Unknown kinds already
degrade safely: `parseDeliverables` floors any unrecognised `kind` to `noted`, and
`DELIVERABLE_KIND_ORDER.indexOf` returns `-1`, which sorts such a row first rather than dropping it.

`deriveLaneDeliverables` (`src/lib/local/lane-deliverables.ts`, pure) builds the list from four
sources, in order: the agent's own `RESOLVED: <id> - <what changed>` lines (the clause **is** the
headline, tidied to ≤ 8 words — the lane brief now demands that shape and shows an example); the
rescan-confirmed closes with no clause (a per-dimension template, e.g. D9 → *Hardened CI/CD
security*, D8 → *Added agent-readable docs*; each confirmed id keeps **its own row**, the evidence
line telling same-dimension closes apart); a foundation/practice lane's install; and the
**attributable** dimension movements not already covered by a close (`hardened` up / `regressed`
down, the humanised movement line as evidence). **No cap, one row per gap** (wave 2b): every
RESOLVED claim keeps its own deliverable, and only a TRUE duplicate merges — the same covered id
claimed twice, a repeated movement/install headline, or (wave 3) **the same sentence the agent itself
wrote for two different ids**. That last one is the fix for a run that printed *"Added gating evidence
to agent review"* twice: the agent described one piece of work and attributed it to two covered ids,
so it is one deliverable — merged into a single row that **carries both ids in `covers`**, because the
sheet keys rows by the first cover and a dropped id would take its gap off the review surface. Merging
by headline applies **only** to a clause the agent wrote. Two gaps that merely fall back to the same
per-dimension *template* stay two rows: the template is Ascent's sentence, not the session's, and a
shared one is a coincidence of how the scan filed them. The verdict gate is `attributeDelivered`
over the same pair the ledger renders — an undelivered, mock, within-noise or unmeasured lane gets
its closes and its install as headlines and **no** movement line.

Optional polish: `src/lib/local/lane-summary.ts` resolves a text runner tagged `legKind:
"lane_summary"` (temperature 0, `LANE_SUMMARY_TEMPERATURE` overrides, spends in the `local` usage
lane) and asks it to **rewrite each headline in place** — same count in, same count out, merged by
index; it never condenses, because the owner reviews each gap individually. The answer is validated
against the list it was given (every index exactly once, a different count rejected whole, ≤ 8
words) and any failure, timeout (≤ 20 s) or null runner keeps the deterministic list. It never
blocks the lane.

### Gap states and the review gate (wave 2b, 2026-08-30)

The outcome surface is the **sheet** ([below](#the-outcome-sheet-one-row-per-gap-one-column-per-run));
there is no variant switcher and no baseline any more. The repo is named **once**, on a group-header
row, and beneath it sits **one first-class sheet row per individual gap/deliverable** — never a list
nested inside one cell.

Each row carries a **state**, derived in the pure fold `buildGapRows`
(`src/features/inflight/live/outcome/outcomeGapRows.ts`) and rendered as a subtle tinted block
(`bg-success/10` / `bg-warn/10` / `bg-accent/5`, never a loud chip):

| state | when | tint |
| --- | --- | --- |
| `committed` | lane `commits > 0` AND (verdict attributable, the claim id in `closedIds`, or the lane's own deterministic install) | success |
| `uncommitted` | the agent claimed RESOLVED but the lane recorded no commits — the lost-deliverable case | warn |
| `proposed` | a batch item the run armed but did not resolve (`batchIds` minus closed claims — synthesized as a row titled from the follow-up itself, so **all** gaps get rows), or a `noted` deliverable | accent |

**Quick approval** (`OutcomeSheetCell.tsx`): an owner rules on each (gap × run) cell with one click — ✓ / ✕,
keyboard-operable, `aria-label`ed. An approved row keeps its tint and gains a ✓; a dismissed row
drops to a strikethrough-free `text-slate-600` mute. The ruling persists as a widened
`review?: "approved" | "dismissed"` field on the `deliverablesJson` entries (the `parseTargets`
JSON-in-TEXT technique; old rows parse as no-review). A ruling on a row that was never persisted —
a backfilled derivation, or a synthesized `proposed` row — is stored as a **review marker**
(`isReviewMarker`, loop-runs-types.ts): a `noted` entry keyed by its own single cover, which the
read side carries alongside the backfill and the client fold attaches to the row it keys; no
surface renders a marker as a row. The write is `reviewDeliverable` (loop-runs-write.ts); the
client is `reviewLoopDeliverable` (`cockpit/loopClient.ts`), and `OutcomeSection` refetches the
run's detail on success so the ruling renders from the store. This is the human gate the loop
needs: **the loop proposes, the human disposes.**

Tests: `outcomeGapRows.test.ts` (a unit test per state, the synthesis, the marker attach),
`outcomeSheetModel.test.ts` (one row per gap across runs, blanks elsewhere),
`lane-deliverables.test.ts` (no cap, per-gap dedupe), `lane-summary.test.ts` (rewrite-in-place,
count mismatch rejected), `loop-runs.test.ts` (the widened review parse + the marker shape),
`route.test.ts` (the `review` action's gates).

Persistence: `LoopRunLane.deliverablesJson` (nullable TEXT, `prisma/schema.prisma` + `prisma/init.sql`;
PGlite self-repairs the column on boot). `runLane` writes it at lane end; `laneOutcome` **backfills on
read** for a row without one — the same derivation from the persisted closed ids and diff — so runs
that predate the column render headlines too.

**Movement prose answers to the number's rule.** `laneOutcome` and the outcome matrix emit
`diff.movements` only for an attributable pair; a refused verdict shows its word (*uncommitted*,
*within noise*, *not measured*) and nothing else. The lines themselves are humanised by
`buildAttribution` (`src/lib/report/compare.ts`): signal **names** only, a `changed` / `gained` /
`lost` verb, three names then `(+n)` — `D9 −42 · changed token permissions; lost SAST, dependency
updates (+1)`, `D2 +12 · changed found 18 test files; gained coverage tracking configured`. The raw
evidence lines stay on `ScanDiff.movementDetail` for the expanded and report views.

### Is this lift real? The attribution rule

**A subtraction is not an attribution.** Two of the three ways an Ascent score moves have nothing to
do with the repository, and until 2026-08-28 the loop reported all three as lift:

1. **The engine changed.** `scanRepository` falls to a deterministic mock floor when every real LLM
   attempt fails, and that report persists like any other (it was a *silent success* —
   `src/lib/scan.ts`). A mock score and a model-blended score are two different rulers.
2. **The model wobbled.** Measured live 2026-08-10 (UAT `L2-NEW-01`): a 193-second model call moved
   the overall score by roughly ±2 points, using ≤24% of its guardband. So a 2-point "lift" on an
   unchanged repository is an ordinary outcome of scanning twice.
3. The repository actually changed — the only one worth reporting.

[`src/lib/maturity/attribution.ts`](../../../src/lib/maturity/attribution.ts) is the single rule that
decides between them, and everything that claims a lift consults it: the outcome ledger, the run
totals, the history strip's per-run lift (`listLoopRuns`), and the follow-up resolve rule
(`decideInProgress`). One rule, so those four can never tell four stories about the same pair.

| Verdict | When | What the surface shows |
| --- | --- | --- |
| `attributable` | both ends from a real engine **and** `abs(delta) > SCORE_NOISE_BAND` | the signed delta |
| `mock-scan` | either end has `engineProvider = "mock"` | *not attributable: mock scan* — or *the model failed and this scan fell to the deterministic floor* when `engineDegraded` |
| `within-noise` | real pair, movement inside the band (including zero) | *within noise (±2)* |
| `unmeasured` | one end missing (first-ever scan, lane never rescanned) | *not measured* |
| `undelivered` | a real pair, and the lane that produced it committed **nothing** | *not attributable: nothing was committed, so what this measured no longer exists* |

`undelivered` is the one verdict that is not a fact about the *measurement* — the measurement was
fine. It is a fact about the lane: the loop scans a worktree it then deletes, so a pair with no
commits behind it describes a state that no longer exists. `attributeDelivered` takes the lane's
commit count for exactly this and is what `laneAttribution` and `listLoopRuns` call. `runLane`
already refuses to produce such a pair (above), but the rows written before that gate existed are
still in the database and this ledger renders them, so the refusal lives on both sides.

`SCORE_NOISE_BAND` is **2**, from that UAT measurement, and the band is **exclusive** — a movement of
exactly 2 is noise. The rule is **symmetric**: a small regression is refused on the same grounds,
because reporting one would be the same error with the sign flipped and would have the loop chasing
noise it created. It is also applied per *dimension* in `decideInProgress`, where the band is
conservative (the per-dimension `LLM_GUARDBAND` is 6, doubled on a widened dim); tightening that
needs a per-dimension measurement, not a guessed constant.

Two consequences worth stating plainly:

- **The run's headline lift sums only the attributable lanes.** A run that moved four repos by one
  point each reads `—`, not `+4`. `runAttribution` returns the excluded counts beside the number, so
  "no lift, three noise lanes", "no lift, three mock lanes" and "no lift, one uncommitted" stay
  distinguishable — they call for opposite next moves. The lane is still **rendered**, labeled: a
  lost deliverable that the ledger says nothing about is the failure this rule exists to end.
- **A follow-up never closes on an unattributable movement.** The 2026-08-26 rule already refused to
  let a trailer close a row the rescan still restated; this refuses the other half — a claimed row
  whose dimension "moved" only within the band, or across a mock rescan, stays in progress with a
  note saying which.

Callers that genuinely have no provenance (a legacy row, a fixture) may omit the engines and get the
pre-attribution strict-movement rule. The rule tightens where evidence exists and nowhere else; it
never invents a verdict from absent data.

## Gates

Each is checked at the route **and** in the engine, and each is load-bearing:

| Gate | Why |
| --- | --- |
| `selfHosted()` / `selfHostGuard()` | These APIs read the server's filesystem and spawn processes. |
| A verified local pairing for **every** repo in the set | Resolved and re-verified up front: a half-armed run that discovers a broken pairing three lanes in has already spent agent sessions on the others. |
| `autopilotEnabled()` (`ASCENT_AUTOPILOT=1` + the `claude` CLI) | Spawning an auto-editing agent is a deliberate opt-in even on your own box. |
| `requireOrgRole(org, "owner")` for every write | Same blast radius as pairing. Reads are `requireOrgAccess` (member). |
| Tenancy re-check (`orgIdForSlug`) on `stop`/`retry`/detail | An id names a row; authorization named a slug. |

## Fleet SSE sub-stages

`POST /api/org/scan` (the wall's and the cockpit's scan stream) now emits **two** kinds of `progress`
frame. See [rescan.md](../fleet/rescan.md#sub-stage-progress-frames-on-apiorgscan) for the full
contract; the short version:

```jsonc
{ "stage": "scan",     "repo": "acme/api", "index": 3, "total": 12 }            // repo boundary
{ "stage": "analyze",  "repo": "acme/api", "index": 3, "total": 12, "pct": 62 } // sub-progress
```

Both carry the **same** `index`/`total`, on purpose: a sub-stage is not a unit of fleet progress.
**Consumers assign `done = index`; they never increment it.** That rule is folded once, for every
consumer, in the pure `foldProgressFrame` (`src/lib/scan-stage.ts`) so it has a place to be tested
instead of living implicitly in four call sites. The scanner's terminal `done` stage is dropped — the
`repo` frame is the authoritative end of a repo, and two "finished" signals would be one too many.

The same stage vocabulary drives a lane's `stage` column during its rescan, so a long scan reads as
something happening rather than a stuck "rescanning" pill.

## Wall mode (`?view=wall`)

The prior **Fleet Command war room** is kept, unchanged, behind `?view=wall`. It is the rally
surface, not a control surface: the tab seeds every repo's latest standing from the org rollup
(`getOrgRollup`, optionally scoped to a tech stack via `TechStackSelector`), then `LiveWarRoom`
subscribes to the `/api/org/scan` SSE stream and animates as results land —

- **Headline strip** (`LiveWarRoomStat`): fleet score, adoption, rigor, with campaign deltas "since
  kickoff" when a goal exists.
- **Goal banner** (`LiveWarRoomGoalBanner`): the first not-yet-achieved goal, its target meter, pace
  and deadline countdown; its `createdAt` is the campaign baseline.
- **Fleet timetable** (`LiveWarRoomTimetable`, `buildFleetTimetable`): the repos × scan-days grid of
  overall score — the main wall's centerpiece.
- **Leaderboard**, **movers ticker**, **posture mix**, **needs-attention strip** (watched repos whose
  last scan attempt errored), and **celebration bursts** on AI-Native crossings.
- **Ship-loop band** (`LiveWarRoomOps`): triage / in-flight PRs / landed impact, SSR-seeded from
  `listOpsState`.

Unchanged by the cockpit rebuild: **TV mode** (`LiveWarRoomTv`, rotating stages, wake lock,
`document.documentElement.requestFullscreen()`), **kiosk** framing, the aria-live announcer
(`warRoomAnnounce.ts`), and the read-only **share view** at the separate unauthenticated
`/live/shared/[token]` route (`src/lib/live-share.ts`). The legacy `/org/[slug]/live` route is a
permanent `redirect()` to `?tab=live`.

## The cockpit UI (`?tab=live`)

`LiveTab.tsx` (server) keeps every load it had (stack scope, goals, rollup, repo histories, ops
snapshot, pairings) and adds, **only when `selfHosted()`**, `getActiveLoopRun(slug)` +
`listLoopRuns(slug, 20)` straight from the db layer. The default render is `<LiveCockpit>`
(`src/features/inflight/live/cockpit/`); `?view=wall` renders the previous tree byte-for-byte
(autopilot band + stack selector + `LiveWarRoom`). Both are `key`-remounted on a stack change.

`LiveCockpit` props: `slug, seeds (ObservatorySeed[] = toLiveRepoSeeds(rollup.repos) + scannedAt),
histories, pairedRepos, activeRun, runs, loopEnabled, selfHosted, isOwner, wallHref` — `wallHref`
rebuilds the current query string with `view=wall` so scope params survive the toggle.

Layout: header (`Kicker` "Observatory", LIVE dot while a run is live, `N lanes · cycle c/m`, **Wall**
link, **Stop**) · the Observatory field (dominant) with the fleet list as a collapsible section below
it · a right rail whose mode is **derived from the run lifecycle**, not a tab bar: `inspect` (no run)
⇄ `run` (active run) ⇄ `drive` (a drive pulling) ⇄ `outcome` (a finished run, a finished drive, or a
history pick) · the run-history strip. One primary CTA at a time: **Run (N repos)** / **Drive to
green** / **Stop after in-flight** / **Stop drive** / **Replay run**.

The rail's choice is one ordered list in `CockpitRail.tsx`, and the order is the doctrine: a **live
drive outranks everything**, because while it pulls, "is debt falling and how much rope is left" is
the only question and its own runs come and go underneath it. `LiveCockpit.tsx` is layout only; the
state machine is `useCockpit.ts`, which composes `useLoopRun` + `useDrive` and owns the mode.

### The Observatory (sky chart)

`src/features/inflight/live/observatory/`. Every scanned repo is a body at (adoption, rigor) in a
0–100 field, fill = level colour (`LEVEL_HEX`), radius constant unless a `volumes` map is passed,
carrying a **trail** of its last three observations. The trail needs adoption/rigor per history
point — `RepoTrajectoryPoint` (`src/lib/db/org-rollup.ts`) now selects `adoptionScore`/`rigorScore`
for that reason. The **AI-Native frontier** is an L, not a diagonal: `postureFor` needs *both* axes
≥ `POSTURE_THRESHOLD` (50), and a test pins `OBSERVATORY_THRESHOLD === POSTURE_THRESHOLD`. Quadrant
captions (Compounding / Adoption-heavy / Rigor-heavy / Laggards) are muted mono SVG text. Never-scanned
repos appear in the list but are **not plotted** (no invented coordinates). Above 40 bodies the field
clusters per quadrant cell (count + members; click to expand; the lasso selects a cluster's members).

The SVG is `aria-hidden`; **`ObservatoryList` is the accessible twin** — every body is an
`aria-pressed` button with roving tabindex, arrow/Home/End navigation, and the same `selected` set.

Motion: bodies of lanes in `dispatching` or `rescanning` pulse with the existing `.live-dot`; the
outcome **drift** (≤ 900 ms ease-out along a bowed path, fill tween, one `.burst-ring` on a frontier
crossing) is the only new tween and renders its end state under `prefers-reduced-motion`. No idle loops.

### Lasso selection and the curated batch

Drag on empty field = rectangle lasso (the meaningful regions are the 50/50 rectangles; the hit-test
takes any polygon); shift extends; click toggles a body. Selection is cockpit state, seeded from the
last run's repos. The **Inspector** shows the selection as chips, the **shared-dimension bars** (per
dimension, how many selected repos have an open follow-up; ≥ half → the org-wide call line "D2 open in
7 of 12"), and the **proposed batch per repo** from `GET /api/org/loop/propose` — each row a title,
`ImpactEffort`/`Points` chips and a prune checkbox; a dimension-focus select narrows every repo's
proposals to one dimension. Concurrency (1–4, default 2) and cycles (1–5) use the `Field` kit.
**Unpaired repos are skipped, not blocking:** flagged "not paired · skipped" and dropped from the
batch; the CTA counts paired repos only and disables at zero.

### Run: lanes with stage travel

`useLoopRun` polls `GET /api/org/loop` **and** the active run's `[id]` detail on one 3-second tick
while the run is `running` (visibility-gated; the status route returns the run row only, the lanes
come from detail). `CockpitRunPanel` renders one `LaneRail` per lane: repo, cycle, a rail of stops
`queued → dispatching → fetch / tree / files / analyze / score / compose → done` with a marker that
travels between stops (CSS transition, `motion-reduce:transition-none`) and a heartbeat on the active
stop; commits and closed ids are mono counters beside the rail (there is no `commits` stop — commits
accumulate during `dispatching`, a stop would park the marker at a state the engine never enters);
the agent log is a collapsible detail; `error` lanes offer **Retry**; `done` lanes stamp the lift.

### The outcome sheet: one row per gap, one column per run

**The rail has no outcome panel (wave-2, 2026-08-30).** A settled run's outcome is a full-width
**sheet** under the observatory grid (`outcome/OutcomeSheet.tsx`), and it is the *only* outcome
surface: the variant strip, the baseline ledger (`CockpitOutcome`, `CockpitOutcomeLedger`) and the
run-history strip (`CockpitHistory`) were deleted, not hidden. The rail keeps the inspector with the
selection intact — the run you just watched is usually the scope you want to iterate on — while the
run still drifts the field and is still `setOutcome`'d (`useCockpit`; a `mode` of `"outcome"` renders
the rail exactly as `"inspect"`).

**The shape is a spreadsheet, because the question is a spreadsheet question:** *when did this gap get
done, and by which run?*

| axis | what it is |
| --- | --- |
| columns | one per run, chronological, latest emphasised, a live run marked. The header is a button: clicking a run opens it and drifts the field (this absorbed the history strip). |
| rows | a **project header row** (`th scope="colgroup"`: the repo named once, its lane's PR link or the guarded *open a PR* action, its cumulative attributable lift, `bg-surface/60`), then **one row per gap** (`th scope="row"`) — the project name never repeated. |
| cells | that run's state for that gap: the tinted block (`committed` `bg-success/10` / `uncommitted` `bg-warn/10` / `proposed` `bg-accent/5`), a kind marker, the run's own headline, the dimension short label, and the owner's ✓/✕. **A blank cell is normal** and is the point. |

A gap is identified **across runs** by its review key (`gapKey`, outcomeGapRows.ts: the first covered
follow-up id, else `kind|dimId|headline`), so a gap worked in run 3 and revisited in run 7 is **one
row** with content in those two columns and blanks between — which is what makes the timing readable
at a glance. The pure fold is `buildSheetProjects` (`outcome/outcomeSheetModel.ts`), over the same
`buildOutcomeMatrix` the numbers come from; the row label is the *latest* run's wording while every
earlier run keeps its own wording in its own cell.

It is a real `<table>` with a frozen (`sticky left-0`) label column, so a screen reader reads a cell as
repo → gap → run → state. There is **no "details" toggle** — it made a mess of a sheet this wide.

**Dynamic column width (drag or keyboard).** Every column, the frozen label column included, carries a
handle on its right edge (`ColumnResizer.tsx`): pointer events with `setPointerCapture` so a drag that
leaves the 6px strip still tracks, `cursor-col-resize`, clamped 6rem–40rem, and ←/→ (Shift for a
coarse step) when the handle is focused — it is a `role="separator"` with `aria-orientation="vertical"`
and an `aria-label`, so widths are never mouse-only. A drag is direct manipulation, so nothing
transitions during it.

**Width is disclosure, which is why the drag is worth having:** a narrow cell shows the marker and a
truncated headline; past `REVEAL_DIM_PX` it adds the dimension label, past `REVEAL_EVIDENCE_PX` the
evidence line. Everything rides in the cell's `title` at every width. Widths live in component state
and persist per org in `localStorage` (`useColumnWidths.ts`) **inside try/catch on both read and
write**, and are loaded in an effect rather than in the state initializer — a private window, a
blocked store or a corrupted value degrades to the defaults instead of throwing, and the server's HTML
and the client's first paint cannot disagree.

**What the deletion cost, honestly.** The old rail ledger printed per-lane before → after,
per-dimension deltas, the engine/`scoreIntegrity` provenance line and the ¢/point economics; the sheet
prints deliverables, verdicts and commits/gaps instead. The standing cost picture is `PriceListPanel`,
and the agent's per-item account (`CockpitVerdicts`) moved under the sheet for the run on screen. The
**Replay run** button went with the ledger; `replayRun` is still on `useCockpit` for the surface that
re-offers it.

A cell prints a coloured delta only when [the attribution rule](#is-this-lift-real-the-attribution-rule)
allows it; otherwise the verdict word sits where the delta would ("uncommitted", "within noise",
"mock scan", "not measured"), and the movement prose is withheld with it. Drift ends come from the
run's own detail, not a client snapshot: `driftFor` overlays each lane's `outcome.before` /
`outcome.after` scan onto the seed set and lays out both sides, so opening an old column drifts a run
you never watched and the picture cannot disagree with the sheet. `router.refresh()` fires on settle to
re-seed the server render.

### Drive to green, from the cockpit (`CockpitDrivePanel`, `useDrive`)

The inspector's second CTA. It starts a drive over the **same selection** the Run button would work
(paired repos only) with the same `Lanes at once` / `Cycles` dials plus a **Drive runs** dial capped
at `DRIVE_MAX_RUNS_CAP`. The gate is not widened for it: `cockpitGate.ts` is ONE predicate
(`selfHosted → repos → owner → autopilot → paired`) serving both, because a drive is a sequence of
runs with exactly the loop's blast radius.

Pruning and dimension focus deliberately do **not** travel with a drive: it re-scores the fleet and
picks a fresh batch before every run, so a batch curated against the first measurement would be a
lie by the second.

While it pulls, the panel shows run counter vs cap, debt now against the debt the drive started
with, `greenCount/inScope`, the in-flight run's own `cycle c/m · n/m lanes done` (from `useLoopRun`'s
poll, not a second one), and each finished run's debt before → after. **Progress is `null`, not 0,
until a run has been measured** — a fresh drive has burned nothing *and* achieved nothing, and 0%
claims the second when only the first is known. Debt inverts the house delta convention (falling is
the win), so the colour takes the size of the drop while the text prints the signed change with
`signedDelta` — no ▲/▼ glyph contradicting the colour beside it.

**Stop** is cooperative and belongs to the drive while one is live: stopping only the in-flight run
would let the drive dispatch the next one, so the header's Stop is re-pointed at `stopDrive` for the
duration.

On termination a `DriveVerdict` banner sits **above** the outcome sheet — the two answer
different questions ("why did the drive stop" vs "what did the last run do"), and `dry` and
`ceiling` are worded apart on purpose because they call for opposite next moves. A drive that never
dispatched a run (already green) renders the banner alone, with its own way back.

`useDrive` polls `GET /api/org/local/drive?org=` every 12 s, and **only** while a drive is live, the
tab is foregrounded, and the gate is clear — on managed cloud, where the route 404s by design, it
makes no request at all. It adopts a drive started elsewhere (curl, another tab) on its mount tick,
and hands the terminal status up exactly once.

### Per-run model and effort (2026-08-28)

The agent was pinned to the deployment's `CLAUDE_MODEL` (default `sonnet`) with no per-run choice —
so the most expensive variable in the system was the one an operator could not vary without a
redeploy, and the outcome ledger compared lifts across runs whose configuration it did not record.

Two selects sit with the other dials in the inspector (`CockpitRunControls`, state in `useRunDials`):
**Agent model** (`AGENT_MODELS` — haiku · sonnet · opus) and **Effort** (`AGENT_EFFORTS` — low ·
medium · high), both defaulting to *Deployment default*. They ride `POST {action:"start"}` on the
loop route and on the drive route, and a drive hands the same pair to **every** run it dispatches, so
a multi-run drive stays one experiment. A resume inherits it for the same reason.

| Concern | Where |
| --- | --- |
| The closed lists + normalizers + the ledger label | `src/lib/local/agent-options.ts` (dependency-free, so the picker and the route validator cannot drift) |
| Env resolution + the `--effort` argv | `src/lib/local/agent.ts` (`resolveAgentConfig`, `runClaudeAgent`) |
| Persistence | `LoopRun.model/effort`, `LoopDrive.model/effort` (migration `20260828170000_add_run_agent_config`) |

Three decisions worth stating:

- **The values are RESOLVED at arm time and the resolved values are persisted.** A row storing the
  raw pick would read `null` for every default run — "whatever `CLAUDE_MODEL` was that day", which is
  exactly the fact the ledger needs and the only one an env var cannot recover afterwards. Later
  cycles and a lane retry read the configuration off the **row**, so a changed env cannot split one
  run across two setups.
- **The model list is closed, and not because the CLI cares.** `--model` and `--effort` reach a
  re-parsing shell on Windows (`shell: true`), so both are normalized against the same list the picker
  offers; an unrecognised value falls back to the deployment default rather than 400-ing, because a
  run must not die because a stale tab sent a retired name. An operator who needs a pinned model id
  sets `CLAUDE_MODEL` and picks *Deployment default* — a pinned id is a deployment decision.
- **The effort env var is `ASCENT_AGENT_EFFORT`, not `CLAUDE_EFFORT`.** The Claude Code harness sets
  `CLAUDE_EFFORT` itself in the environment it gives child processes (found the hard way: a test
  asserting "no effort chosen" failed against the ambient env of the session writing it). A
  self-hosted Ascent started from inside a Claude Code session would have inherited an effort level
  nobody chose, on every run, invisibly. `CLAUDE_MODEL` carries no such collision and keeps its name.
- **`null` effort is not a level.** The flag is then not appended at all, so the argv is byte-for-byte
  what it always was.

The configuration is rendered where lifts are compared: beside the timestamp on the outcome header,
and under every row of the run-history strip. A run recorded before the columns existed prints
**nothing** — "default" would be a claim about a run nobody can check.

Tests: `agent-options.test.ts` (the closed lists, including the shell-injection shapes, and the
unknown-renders-nothing label), `agent.test.ts` (`resolveAgentConfig` precedence),
`loop-engine.test.ts` (the parameter threading start → row → agent invocation, and that a mid-run env
change cannot reach a later cycle), `OutcomeSheet.dom.test.tsx` (the run column header shows it).

### Lane kinds: foundation and practice lanes (2026-08-28)

Until this, the loop's batch source was the **scan backlog only**, and its only tool was an agent
session. Installing the generated `.ai/` standard, or a Practice Library starter, lived behind a
*different* door: a GitHub-App draft PR (`POST /api/report/foundation/pr`, `POST /api/practices/apply`),
which the local loop never opened and which — for the foundation — was reachable only from the
per-repo report header. Priya's L2 walk measured that as a **7-hop detour**. UC1's loop is
"scan → gaps → apply practice / `.ai/` foundation → rescan", so a loop that could only do the middle
step was not the journey.

A lane now has a **kind**:

| kind | what the lane does | agent session? |
| --- | --- | --- |
| `backlog` | the original lane: dispatch the repo's open follow-ups to a local `claude -p` | yes |
| `foundation` | write the generated `.ai/` tree into the worktree and commit it | **no** |
| `practice` | write one Practice Library starter into the worktree and commit it | **no** |

**The rule** (`src/lib/local/lane-kind.ts`, `proposeLaneKind`), in order:

1. the repo has no `.ai/manifest.{yaml,yml}` → `foundation`;
2. else the **highest-impact** open follow-up sits on a dimension the library has a starter for, that
   starter's file is missing, AND the loop has **never dispatched that practice into this repo
   before** → `practice` for it;
3. else `backlog`, which stays the default and does everything else.

Only the *top* item is considered in (2). Letting any item in the batch pull the lane would make a
template drop the default answer rather than the shortest path to the biggest gap. The cap and the
impact-first ordering of `openBatch` are untouched.

**A practice is proposed AT MOST ONCE per repo — a removed starter is a decision, not an omission.**
The file test alone reads a *removal* as an absence. Measured on `systedo-case`: run 1 installed the
18-line "agent in the loop" starter (`.github/workflows/ai-review.yml`); a later lane's agent
consolidated it into a 122-line `.github/workflows/agent-review.yml` — plus a rubric,
`required-checks.json` and `CODEOWNERS` — and deleted the thin starter; the next run saw the starter
missing and reinstalled it; the next agent deleted it again. In git: `95347818` → `f419243b` →
`bd7590e1`, the same starter installed twice with the deletion between. Every run burned on that loop
and never reached a backlog or a craft lane.

So the loop's **own history** is the second gate, which is this codebase's standing-decision doctrine
applied to lanes: the scoring prompt already calls a standing decision *"context you were missing, not
a reason to re-raise"*, and a practice a human or an agent removed is exactly that.
`listDispatchedPractices(org, repo)` (`src/lib/db/loop-runs-read.ts`) returns the practice ids already
dispatched into a repo, and **"dispatched" is: a cycle-1 lane with a non-null `startedAt`, in a run
whose `targets` name that practice for that repo.** Cycle 1 because a lane kind is a cycle-1 fact
(`laneKindOf`); `startedAt` because `runLane` stamps it in the same write that leaves `queued` for
`dispatching`, immediately before the install — so a lane that never got a worktree
(`recordLaneSetupFailure` writes `phase: "error"` with no `startedAt`) does *not* burn the practice's
one shot, while a lane that ran and then errored does. Reading `phase: "done"` would be worse: a lane
that installed the starter and then failed its rescan would re-propose the install forever.

When the practice for the top item's dimension has already been dispatched, the rule **falls through
to the ordinary ordering** — backlog, or craft when the batch is all craft. `PRACTICES` is 1:1 with
the scored dimensions, so "every practice for that dimension" is that one starter.

**The skip is explained, not silent.** `proposeLaneKind` returns `skippedPracticeId`, and the engine
turns it into a `loop-lesson` candidate (`recordPracticeSkipLesson`, `src/lib/db/loop-lessons.ts`) so
an operator looking at a backlog lane on a repo with an obvious starter-shaped gap can see why. It
lands `pending` in the same review queue every agent lesson does — the loop still never writes
`OrgMemory` directly — and it is **idempotent**: a skip is a standing fact, not an event, so an
event-shaped write would refill the queue with the same sentence on every run.

**One rule, two callers.** `/propose` renders it and the engine re-runs it at arm time — the same
identity argument as `openBatch`. Both pass the history read, which is why it is a **required** third
parameter rather than an optional one: a caller that could omit it would be a second, more permissive
rule. It is lazy for the same reason `loadItems` is, and read even later — only once a practice-shaped
gap has survived both the dimension lookup and the file test, so a foundation lane, an all-craft
batch, and a repo that already carries the starter all answer with no database round trip. The rule is
re-read rather than trusted from the wire, because the operator may have installed the standard by
hand between opening the panel and pressing Run.

**Execution** (`lane-install.ts`, `install-files.ts`). Both kinds go through the *same generators* the
cloud doors use — `buildFoundation` and `buildPracticeArtifact` — and differ only in **delivery**: a
write into the worktree instead of a contents-API commit. The generation step was factored out of the
PR plumbing for exactly this (`src/lib/practices/artifact.ts` now owns the house-pattern lookup that
`applyPracticeToRepo` kept private), and `lane-install.test.ts` drives *both* doors off one report and
asserts the bytes are identical.

The **collision policy is copied from `openDraftPr`, not relaxed**: the spine (`.ai/manifest.yaml`)
already present means *already installed* — nothing is written at all; any later file already present
is the repo's own and is skipped and reported. A worktree install that quietly rewrote a repo's real
`AGENTS.md` would be strictly worse than the PR path's refusal — changing files that already exist is
what the agent lane is for.

After the commit, a foundation/practice lane runs the **identical rescan + attribution** an agent lane
runs. The install is a claim, not a verdict: a practice lane carries its follow-up's
`Ascent-Resolves:` trailer, and that row closes only if the next scan says the dimension moved.

**Cycle 1 only.** Once the standard (or the starter) is in, the repo's next cycle is ordinary backlog
work with the new floor in place — so one run reads "install → rescan → work the gaps". Same shape the
curated batch already has. A **curated batch wins over a practice lane**: the operator naming rows is
an explicit instruction, and installing a starter for a gap they just pruned would override it. A
foundation lane has no rows to curate, so `/propose` returns `items: []` for it.

**Recording it.** The armed kinds ride on `LoopRun.reposJson`, whose JSON-in-TEXT encoding was widened
to accept `[{repo, kind, practiceId}]` alongside the legacy `string[]`. A column would have meant
regenerating the Prisma client into a `node_modules` this worktree *shares with the operator's own
checkout*; the widening is durable, reversible, backward-compatible in both directions, and is the
technique `runsJson` / `measurementJson` already use. `laneKindOf` reads it back for the ledger.

**Cloud parity: unchanged, and local-only for now.** Every branch of the rule reads a filesystem path,
and the routes are behind `selfHostGuard()`. On the managed cloud path practices and the foundation
keep going out as GitHub-App draft PRs exactly as before — a hosted equivalent needs the sandboxed
executor the "no hosted dispatch" gap below already names.

**UI: one tag per lane, no new panel.** `laneKindTag` renders `.ai/ foundation` / `practice starter`
beside the repo name in the curation panel (with the reason under it) and on the outcome-ledger row.
The agent lane is deliberately untagged — a badge on every row would say nothing.

Tests: `lane-kind.test.ts` (the rule, against real directories), `lane-kind.dispatched.test.ts` (the
once-per-repo gate: a missing starter with no prior lane still leads, the same repo after a prior
practice lane does not, an all-craft batch still yields craft, a present starter still yields backlog,
and neither the foundation nor the file-present path reaches the history read), `lane-install.test.ts` (real git
fixture: files written, one commit, the trailer, the skip policy, and the byte-identity case),
`loop-engine.test.ts` (install instead of agent, the kind on the row, cycle 2 back to backlog, a dry
install ending cleanly, a curated batch winning), `propose/route.test.ts` (the wiring),
`loop-runs.test.ts` (both `reposJson` encodings), `CockpitLaneKind.dom.test.tsx` (both tags).

### Run history

**The sheet's columns are the history** (wave-2): the last runs are its chronological columns — age,
repo count, gaps, lift, phase and the agent configuration the lift was produced under — and clicking a
column header fetches that run's detail and drifts the field. The separate `CockpitHistory` strip that
used to do this was deleted rather than kept beside it.

### Setup states (`CockpitSetup`)

`hosted` (field still rendered read-only; explains loops run where the code is, links to self-hosting
via `NEXT_PUBLIC_SOURCE_REPO_URL` or `docs/SETUP.md`) · `no-repos` (→ repositories tab) · `not-owner`
· `autopilot-off` (shows the route's 409 fix) · `unpaired` (three steps: pair a checkout via
`?tab=pairing` → pick repos → run).

Tests: `cockpit/laneStages.test.ts`, `cockpitDimensions.test.ts`, `cockpitDrift.test.ts`,
`cockpitGate.test.ts` (one gate, two callers), `driveModel.test.ts` (the on-screen arithmetic and
the three verdicts), `useLoopRun.dom.test.tsx`, `useDrive.dom.test.tsx` (gating + poll discipline +
settle-once), `outcomeSheetModel.test.ts` + `OutcomeSheet.dom.test.tsx` (the cross-run row axis, the
blank cells, the resize separators), `CockpitDrivePanel.dom.test.tsx` (the control's
states), `LiveTabView.dom.test.tsx` (wall mode and the kiosk render no cockpit),
`observatory/*.test.ts(x)`.

### End-to-end proof (2026-08-28)

Everything above was unit- and DOM-tested and **nothing drove it end to end**: no e2e spec and no UAT
journey mentioned the cockpit, the loop, the drive, the lane kinds or the attribution rendering. Two
artifacts close that, and they close different halves of it.

**`e2e/loop/cockpit-loop.spec.ts`** (config `playwright.loop.config.ts`, `npm run test:e2e:loop`) —
five tests, ~50 s, no model spend. It boots its own `next dev` on its own port against a **throwaway
PGlite dir** and its own declared `ASCENT_LOCAL_ORG`, creates a **real git repository** in the OS temp
dir, maps and pairs it through `/api/org/local/projects`, scans it from disk, then drives the cockpit
in a browser: select on the observatory → read the proposal → set cycles/model/effort → **Run** → read
the outcome ledger → back to the inspector with the selection intact. What runs for real is the whole
loop *except the agent*: a real `git worktree`, a real foundation lane that writes the generated `.ai/`
tree and commits it, a real rescan of that worktree, the real attribution rule, and the real branch
left behind (asserted from the repository, not from the screen — including that `main` is untouched).

Two scoping decisions make it fast and repeatable, and both are deliberate:

- **The fixture repo has no `.ai/manifest.yaml`**, so rule 1 gives it a `foundation` lane — a
  deterministic install with no `claude -p` session — and `Cycles` is pinned to **1** so cycle 2 never
  falls back to the agent lane. A separate test then **merges the lane's branch** and asserts the same
  rule stops proposing a foundation, which is the operator's half of the loop and proves the rule
  reads the paired working copy rather than the branch.
- **The engine is the deterministic mock**, so both ends of every pair are mock scans and the spec
  asserts the *refusal*: `not attributable: mock scan`, `excluded: 1 mock scan`, a muted delta, and the
  provenance line `engine mock` + `D2/D3/D4 not measurable locally`. A coloured delta there would be
  the bug.

Not covered by it, and named rather than implied: an agent lane, an **attributable** lift (needs a real
engine on both ends), and a live drive killed and resumed. It also is **not in CI** —
`.github/workflows/ci.yml` runs no Playwright at all and `smoke.yml` runs only `--grep @smoke`; wiring
e2e into PR CI is backlog item 11 and owns that decision.

**`uat/journeys/loop-to-l5.md`** — the same journey as a Character walk (Priya, platform lead), with
the L1 seam table this branch is graded against, the L2 confirmations only a live run can settle
(a real agent lane, an attributable lift, a killed-and-resumed drive, the observed→carried platform
fold, two full iterations, the blocked states), and an honest **L2 not yet run** status.

> One thing the e2e work found and fixed: `src/instrumentation.ts` is compiled for the **edge** runtime
> too, and webpack does no dead-code elimination in dev — so the boot sweep's `await import(…)` dragged
> `db/client → @prisma/adapter-pg → pg → require('fs')` into a compilation with no `fs`, failing the
> whole `/instrumentation` compile and answering **500 on every route** under `next dev --webpack`
> (the only dev mode a junctioned worktree can run; Turbopack refuses the symlink). Both node-only
> dynamic imports now sit behind a `process.env.NEXT_RUNTIME === "nodejs"` **condition** rather than
> only behind the early return — webpack folds a statically-false condition at parse time and never
> walks the branch.

## Key files

| Concern | File |
| --- | --- |
| Store (barrel) | `src/lib/db/loop-runs.ts` → `-types.ts` / `-read.ts` / `-write.ts` |
| Tenancy re-check | `src/lib/db/loop-tenancy.ts` |
| Driver | `src/lib/local/loop-engine.ts` |
| One lane | `src/lib/local/loop-lane.ts` |
| Worktree isolation | `src/lib/local/loop-worktree.ts` |
| Worktree dependency links | `src/lib/local/worktree-deps.ts` |
| Single-repo shim | `src/lib/local/autopilot.ts` |
| Routes | `src/app/api/org/loop/{route,propose/route,[id]/route}.ts` |
| Drive engine + wire shapes | `src/lib/local/drive.ts`, `src/lib/local/drive-types.ts` |
| Drive persistence | `src/lib/db/drives.ts` (`LoopDrive` rows, the stale-drive sweep) |
| Boot sweep | `src/lib/local/boot-sweep.ts`, called from `src/instrumentation.ts` |
| Drive route | `src/app/api/org/local/drive/route.ts` |
| Drive UI | `cockpit/{CockpitDrivePanel,CockpitDriveResume,driveModel,driveClient,driveTypes,useDrive}.ts(x)` |
| Agent model/effort | `src/lib/local/agent-options.ts`, `agent.ts`, `cockpit/{CockpitRunControls,useRunDials}.ts(x)` |
| Lane kinds — the rule | `src/lib/local/lane-kind.ts` |
| Lane kinds — the install | `src/lib/local/lane-install.ts`, `src/lib/local/install-files.ts` |
| Shared practice generation | `src/lib/practices/artifact.ts` (used by `practices/apply.ts` and the lane) |
| Shared foundation generation | `src/lib/standard/index.ts` `buildFoundation` (used by `standard/pr.ts` and the lane) |
| Platform fold carry | `src/lib/analyze/platform-carry.ts` (+ `platform-signals.ts`) |
| SSE sub-stage fold | `src/lib/scan-stage.ts` |
| Tab + wall | `src/features/inflight/live/**` |
| Cockpit | `src/features/inflight/live/cockpit/**` |
| Observatory | `src/features/inflight/live/observatory/**` |
| Schema | `prisma/schema.prisma`, `prisma/migrations/20260822120000_add_loop_run`, `prisma/init.sql` |

Tests: `loop-runs.test.ts` (row→record parsing, log bound), `loop-engine.test.ts` (happy path,
failure isolation, per-lane early stop, bounded parallelism, stop, the gates),
`autopilot.equivalence.test.ts` (the shim's shipped job contract and branch prefix),
`scan-stage.test.ts` + `route.stages.test.ts` (the sub-stage contract).

## The loop verifies; the agent proposes (2026-08-26)

Three changes made the loop safe to leave alone, all in service of one rule: **the agent's word
never decides continuation or closure.**

- **The trailer is a hint, not a verdict** (`src/lib/org/followups.ts` `decideInProgress`). In the
  loop the *agent* writes `Ascent-Resolves:`, so an unconditional close was the loop certifying its
  own homework. A trailer now closes a row only when the rescan agrees — a row still restated stays
  open with the note *"claimed resolved by commit trailer, but scan … still raises it"*.
- **"Not restated" needs movement.** Restatement is title-only and titles are not stable across
  scans, so a merely *reworded* gap produced the same signal a fixed one did. When the dimension's
  score is known on both scans it must have **risen**; a gap that vanished while its number stood
  still is kept open — *"no longer raised by scan …, but the dimension did not move (61 → 61)"*. An
  unpaired keep is copied forward as `in_progress` explicitly so it cannot silently drop out of the
  ledger. Unknown movement (first scan, dropped dimension) falls back to the title rule rather than
  inventing a measurement.
- **The batch is picked by practice gap, not by projected points** (`loop-lane.ts` `openBatch`):
  impact first, points as the tiebreak. A loop that chases the biggest number chases whatever the
  detector prices highest — the shortest path to the score, not to the practice.
- **The agent's brief says what counts** (`loop-lane.ts`): understand the codebase, then implement
  the change that most raises the level of trust; *do the work, never the detector* — a config for a
  tool the project does not use, a stub file, or a tool's name in a workflow comment is not a fix
  and the rescan scores practices that operate; and in each commit body, state how a reviewer would
  tell the practice is real (what runs, when, what happens on failure).

## Drive to green (`src/lib/local/drive.ts`, `POST /api/org/local/drive`)

One run is at most `LOOP_MAX_CYCLES_CAP` cycles by design — the right shape for a session of work
and the wrong shape for a *target*. A **drive** is a sequence of runs, each re-measured against the
fleet's own green predicate (`src/lib/maturity/green.ts`) from the rescans the lanes persisted, with
three honest ways to stop and no fourth:

| Phase | Means |
| --- | --- |
| `green` | every repo in scope cleared the band |
| `dry` | a whole run did not lower the debt — re-asking a stalled agent will not un-stall it, and the ceiling is not spent proving that again |
| `ceiling` | the operator's rope (`maxRuns`, default 3, cap `DRIVE_MAX_RUNS_CAP` = 8) ran out |

The measurement is the verifier: a run's own `progressed` flag never earns another run. The policy
is the pure `nextDriveStep` (tested in isolation); `startDrive` is single-flight per org and defaults
its scope to every watched, paired repo. `GET ?org=` lists drives with their latest measurement and
per-run debt before/after. Both the runs it starts and the drive itself are durable rows — see
*Surviving a restart* below for what a restart does and, deliberately, does not do.

The wire shapes and the caps live in `src/lib/local/drive-types.ts` (re-exported by `drive.ts`, the
same split as `loop-runs-types.ts` ⇄ `loop-engine.ts`) so the cockpit can import them in the browser
without dragging the engine's db/`selfHosted()` imports into the bundle. Since 2026-08-28 the route
is no longer curl-only: the cockpit reaches it — see *Drive to green, from the cockpit* above.

### Surviving a restart (2026-08-28)

A drive used to live only in a `Map` on `globalThis`. Its RUNS were durable, so what happened
survived; the drive itself did not, and neither did the fact that one had ever existed — a `GET`
after a restart reported **nothing at all**, which is the one answer that is never true. Three
changes close that:

**1. The drive is a row.** `LoopDrive` (`prisma/schema.prisma`, migration
`20260828120000_add_loop_drive`, store `src/lib/db/drives.ts`) holds the scope, the rope, the
per-run debt ledger, the latest measurement and the resume chain. The registry in `drive.ts` still
exists — a live task and a cooperative stop flag cannot be serialized — but every transition is
mirrored onto the row, whole-row rather than by patch (a drive changes state a handful of times per
hour, so there is nothing to gain from patch granularity and a half-written status to lose).
`listDrives` reads the DB and overlays the live registry, which is the fresher copy while pulling.

**2. A boot-time sweep, in `register()`.** `src/instrumentation.ts` — Next's startup hook, the same
door the embedded PGlite boots from — calls `sweepInterruptedWork()` (`src/lib/local/boot-sweep.ts`)
after the PGlite boot and before the first request. A fresh process is driving nothing, so it is the
one caller entitled to omit the `isLive` predicate that every request path must pass. It marks stale
`running` loop runs `stopped` (which is what **releases their lanes' backlog claims**, the zombie-claim
bug of 2026-08-26) and stale `running` drives `interrupted` — runs first, so a drive is never marked
interrupted while its last run still looks alive. Self-hosted only, and that guard is load-bearing:
on a managed deployment "this process started nothing" is a claim about one instance among many.
It is idempotent per process and silent unless it actually reconciled something.

**3. Interrupted is offered back, never auto-resumed.** `interrupted` is a terminal phase nobody
chose. A drive spends agent sessions inside real working copies, so a server that re-armed one by
itself on boot would be spending the operator's money on the strength of a process having crashed.
The cockpit shows `CockpitDriveResume` as a banner **above** the inspector (a standing offer, not a
mode — the operator is equally entitled to ignore it and select a different scope) with one
**Resume drive** button. Resuming starts a NEW drive that inherits the scope, the bounds and
`runsBefore` — **the run budget belongs to the chain, not to a segment of it**, so a crash can never
re-grant rope the operator did not give. The interrupted drive stays interrupted as the record of
what that segment did, and `resumedFrom` links the two. `resumeParams` (`drive-types.ts`) is the one
pure predicate both the route and the button consult, so the affordance appears exactly when
`POST {action:"resume"}` would accept it.

### Platform signals, carried into a worktree rescan (2026-08-28)

D2/D3/D4 are credited partly for tooling that is **installed rather than committed** — the review, CI
and coverage Apps posting check suites on the scored commit, and default-branch Actions health
(`src/lib/analyze/platform-signals.ts`). A loop rescan reads a worktree with `noAmbientToken`, so it
could observe none of it and scored those three dimensions at their file-scan floor.

That was not a rounding difference. `green` demands L5 on **every** dimension, so three dimensions
that could only ever read low were three dimensions the loop could drive at forever — and a
drive-to-green would run to `ceiling` for a reason the operator could not see anywhere on screen.

| Reading | When | What the loop does |
| --- | --- | --- |
| `observed` | the scan held a token and read GitHub | records the fold: points **and** evidence, per dimension (`applyPlatformSignals`) |
| `carried` | a worktree rescan, and an earlier observed scan exists | replays that record verbatim, stamping every line with `platform signals from scan <id>, <age>`; past `PLATFORM_FOLD_STALE_DAYS` (14) it also says `stale` |
| `unavailable` | a worktree rescan with nothing to replay | the three dimensions are **excluded** from the green verdict, and the cockpit says `D2/D3/D4 not measurable locally` |

The record rides the scan row (`Scan.platformSignalsJson`, migration
`20260828160000_add_scan_platform_signals`) and is read back onto `ComparableScan`, so both halves of
a bracketed pair carry it. Three consequences worth stating plainly:

- **A stale fold still applies.** A three-week-old App inventory is the best evidence anyone has about
  a repo's installed tooling; dropping it would swap a stated uncertainty for a silent understatement.
  The threshold is a disclosure, not a gate.
- **Excluded is not passed.** `repoGreenness` reports `unmeasurable` alongside `gaps`, a repo whose
  *every* dimension was excluded is **not** green (the unscanned rule again), and `DriveMeasurement`
  carries `notMeasurable` so the drive panel and the terminal verdict both name what the light stands
  on. A green light over six dimensions is a different claim from one over nine.
- **Unknown is not `unavailable`.** A legacy row has no record; reading that as "unavailable" would
  quietly drop three dimensions out of every historical verdict, so it excludes nothing.

### The loop does not arm what it cannot verify (2026-08-30)

The exclusion above kept an unobservable dimension out of the green *verdict*. It did not keep it out
of the *backlog*, and that gap manufactured an infinite one.

The assessment guarantees a roadmap entry for every dimension below `FOLLOW_UP_BELOW` (65). On a
worktree scan with nothing to carry, D4's deterministic signal sits at its floor **whatever the repo
actually has** — so every scan minted a fresh D4 follow-up, `openBatch` armed it, the agent added
another review workflow, the next scan was just as blind, and the row re-opened. Measured over four
campaign runs on two real repos: eight lanes, every one on D4, both overalls flat. It also meant
`openBatch` *always* found a gap, so the craft ladder — which engages only once a repo has no open gap
left — was unreachable behind a measurement artifact.

The rule now: **a dimension the scan could not observe does not owe a follow-up.** One helper decides
it, `dimensionObservability(record, dimId)` (`src/lib/analyze/platform-carry.ts`), with the same three
readings as the table above — `observed`, `carried`, `unobservable` — and `unobservable` only when the
fold was unavailable *and* nothing was carried. Three consumers read it and no one re-derives it:

| Where | What it does |
| --- | --- |
| `buildDimensionFollowUps` (`src/lib/scoring/recommendations.ts`) | synthesises no **coverage** entry for an unobservable dimension. A gap the *model* raised from file evidence it could actually see still passes through — real judgment outranks our uncertainty. |
| `assembleReport` (`src/lib/scoring/engine.ts`) | records the list on `scoreIntegrity.unmeasuredDims`, so the report header's integrity chip says `D2, D3, D4 not measured` instead of the reader guessing. Absent, never empty, on an observed scan. |
| `openBatch` (`src/lib/local/loop-lane.ts`) | drops items on those dimensions from the batch, reading the **latest** scan's record (`getLatestUnmeasurableDims`) — the best evidence of what the next cycle will be able to measure. A failed read is an empty set: refusing to arm work on a guess would be the opposite mistake. |

When that empties the gap batch the **craft fallback takes over**, which is the intended behaviour and
half the point of the fix. Craft rungs themselves are not filtered: they close on evidence of the rung
being built, not on a dimension score moving.

**No score changes.** D4 keeps whatever number it computes; what changed is what becomes *work*.
Unmeasured is not the same as bad, and it must not be turned into a task.

**Folding is not a lift** (`attributeDimension`, `src/lib/maturity/attribution.ts`). A dimension whose
fold credit *differs* between the two ends of a pair moved because one scan could see GitHub and the
other could not, so it reports `unmeasured` and the ledger renders it muted. Carrying the fold forward
is what makes the ordinary pair comparable again — the same points land on both ends, and the residue
is real work, still reported as a lift. The refusal is per **dimension**, not per pair: the fold moves
three of nine, and refusing the whole pair would throw away six dimensions of honest measurement to
protect three.

The same carry runs on `POST /api/org/local/rescan`, so a manual local rescan cannot silently retire
the fold from a repo's latest reading either.

**D9 is carried as inputs, not points (wave 2, 2026-08-30).** The security battery *replaces* the D9
signal after the fold, so points cannot be replayed onto it. An observed record therefore also stores
`securityInputs` — branch protection, the installed-App inventory and the org security policy /
advisories (`CarriedSecurityInputs`) — and a worktree rescan re-runs the battery over its own files
with that reading, every affected check saying `GitHub-side reading carried from scan <id>`. With
nothing to carry the battery runs blind and a check whose 0 only GitHub could refute (SAST,
dependency updates, security policy) is **excluded from the denominator** rather than scored 0
(branch protection already goes n/a). `foldIsComparable("D9")` reads `securityObservability` on both
ends and refuses a GitHub-or-legacy end against a blind worktree end as `unmeasured` — the exact
pairing that had printed `D9 −42` for a repository that had not changed. See
[scan.md](../scanning/scan.md#ingest-from-a-worktree-srcliblocalsourcets).

Tests: `platform-carry.test.ts` (fresh / stale / absent, the round-trip, the D9 inputs),
`green.test.ts` (exclusion, and that it is not a blanket pass), `attribution.test.ts` (folding is not
a lift; D9 comparability), `security/checks.test.ts` (carried vs blind battery).

### Claims are released when nothing adjudicated them (2026-08-26)

A lane CLAIMS its batch (`open → in_progress`) before the agent runs, so the rescan's feedback can
attach to those rows. A claim nobody adjudicates is a **zombie**: still `in_progress`, so
`openBatch` never re-dispatches it, and the movement-gated resolve rule keeps it open. Drive #1
died 35 seconds in and left ten of eleven backlog rows claimed — the next drive found *"no open
follow-ups"* on a fleet with 350 points of debt. Now every path where the rescan never ran releases
the claim back to `open` with a ledger event saying why: a lane failure, a stop before the rescan, a
rescan that threw, and — in `markStaleRunsStopped` — the interrupted lanes of a run a dead process
left behind. Only a lane whose rescan actually ran leaves its claims, because from that point the
scan feedback owns them. The accepted trade: work that exists unverified on the branch may be
re-dispatched; a duplicate attempt is recoverable and a zombie claim is not.

### Two liveness bugs the drive exposed (2026-08-26)

The first drive's only run died 35 seconds into cycle 1 — on the poll that was watching it.
Two causes, both now fixed:

- **The stale-run reconcile consulted no liveness.** `markStaleRunsStopped` marked *every*
  `running` row stopped, and `GET /api/org/loop` calls it on every request — so any page load or
  poll during a run stopped the run it was rendering. It now takes an `isLive(id)` predicate
  (defaulting to "nothing is live", which is right only for the boot sweep); the engine and the
  loop route pass `isLoopRunLive`.
- **The engine's `live` registry was per module instance, not per process.** Next bundles each
  API route into its own server chunk, so a module-level `Map` is instantiated once *per chunk*: a
  run started by the drive route was invisible to the loop route. Both registries (`live`, and
  the drive's) now hang off `globalThis`, the same pattern `pglite-boot` uses for its adapter.

## Delivery: what happens to a lane's branch (2026-08-31)

The loop committed each lane to a throwaway `ascent/loop-<stamp>-<slug>` branch and **left it there
forever** — `removeLoopWorktree` drops the temp worktree and deliberately keeps the branch — and
nothing merged it. A 21-run campaign measured the consequence: every run's worktree is cut from the
same unchanged `HEAD`, so the loop rediscovered and rewrote the same fix run after run, and the
repositories did not improve until the campaign harness started fast-forwarding the branches itself
(`scripts/loop-campaign.mjs --land`, a harness-only workaround for a product-level gap).

So delivery is now a **dial on the run**, recorded on `LoopRun.delivery` and on `LoopDrive.delivery`
(a drive inherits one mode for its whole chain, and it survives a resume — see `resumeParams`).

| Mode | What it does |
| --- | --- |
| **`branch`** — *"Leave on a branch"* | **The default, and byte-identical to the loop before delivery existed.** Each lane commits to its own branch and stops. `deliverLane` returns on the first line without reading a thing: the guarantee is that the code path is *empty*, not merely harmless (`loop-delivery.test.ts` asserts every injected seam un-called). |
| **`land`** — *"Land in my current branch"* | After a lane's cycle succeeds, `git merge --ff-only <branch>` in the **paired checkout**, into whatever branch it is standing on. |
| **`pr`** — *"Open a PR"* | Reuses `openPrForLane` — the *same* path §*From lane branch to reviewed PR* drives — so there is exactly one PR implementation. Everything that path does still happens: the real branch is pushed with git (never `--force`), `/pulls` is POSTed, a 422 reuses the already-open PR, and the `ImprovementPr` ledger row plus the lane's `prNumber`/`prUrl` are written. The only thing it skips is the typed repo-name confirmation, because the operator gave that consent when they armed the run — an unattended loop cannot be asked. |

### Why `--ff-only` is mandatory

The lane's branch was cut from that very `HEAD` moments earlier, so **a clean lane IS a
fast-forward**. If it is not, landing would mean resolving somebody's tree for them. `land` therefore
refuses, and the refusal is the honest signal that two runs collided.

A refusal **is not a run failure**: the lane's work is committed and safe on its branch, exactly where
`branch` mode would have left it, and the run carries on. The four refusal cases
(`src/lib/local/loop-land.ts`, all pinned against a real git repo in `loop-land.test.ts`):

- **diverged** — the checkout's branch has commits the lane branch does not;
- **uncommitted** — the merge would overwrite a file the operator has uncommitted changes in. Checked
  *before* the merge is issued, by intersecting `git status --porcelain` with
  `git diff --name-only HEAD..<branch>`, so the reason can name the file and git is never asked to
  touch a tree someone is mid-edit in. **A dirty file the lane does not touch is not a stop sign** —
  only a collision is;
- **detached** — the checkout is on a detached `HEAD`, so "my current branch" has no answer;
- **already** — the branch is already contained. A no-op, which is what a second land looks like; the
  whole operation is idempotent by construction.

**What landing never does**, in order of how bad it would be: never `checkout`/`switch` (the
operator's branch is theirs, and a loop that moves it is a loop nobody can leave running), never
`reset`, never `stash` (a dirty file is a stop sign, not an obstacle to clear), and never a remote —
no fetch, no push, no upstream. Landing is a purely local merge, and `loop-land.test.ts` asserts the
absent verbs directly.

### Gates, honesty and the record

- **Owner-gated, exactly like starting a run.** `POST /api/org/loop {action:"start"}` already takes
  `requireOrgRole(org, "owner")` for every write; `delivery` rides on that same start call, so a
  non-owner can no more land a branch than they can arm the run that produced it. The drive route's
  `start` is gated identically.
- **`pr` is honestly unavailable, never silently downgraded.** Both routes refuse `delivery: "pr"`
  with a 409 naming the reason when `isAppConfigured()` is false, and the status read answers
  `prAvailable` so the cockpit dial can **disable** the option with its reason on the option itself.
  A run armed for pull requests that quietly left branches behind would leave the operator believing
  their work was in review — the one failure this mode exists to prevent.
- **Every land attempt is logged on the lane** (`appendLaneLog`) with its outcome, branch and shas.
- **A refusal also records a lesson** (`recordLandRefusalLesson`), so the operator learns *why*
  without reading a diff. Keyed on the **cause**, not the branch: a refusal is a standing fact about
  that checkout and will be true again next run, so keying on the branch name would have refilled the
  review queue with one row per run — precisely what the 21-run campaign would have produced. Like
  every loop lesson it lands `pending` and is never written into Org Memory directly.
- **The ledger says how a run was delivered.** The outcome sheet's run column header prints `landed`
  or `PR` beside the agent configuration. `branch` prints nothing: it is the default and every
  historical row is one, so a tag on every column would say nothing (`deliveryTag`, the same rule
  `laneKindTag` and `laneExecutorTag` follow).
- **A remote run has no delivery.** `startRemoteRun` records `null`: Ascent opens no worktree and owns
  no checkout for a lane some other harness works, so there is nothing local to land into.

### Where the dial lives

`CockpitRunControls` / `useRunDials`, beside model and effort, and remembered the same way — the run
and the drive read the **same** dials, which is the property that matters: they are two ways of arming
one experiment. Labelled for what each mode does to the operator's machine rather than for its
internal name, with a standing one-line hint under the picker (not a modal — a sentence you can read
*before* you commit to the choice beats a dialog you dismiss after).

## From lane branch to reviewed PR (2026-08-30, moonshot #26)

A lane's branch was the deliverable and also the end of the road: agent-authored work never reached a
reviewer, an `AiChange` row, or the conformance population, because it never left the operator's
machine. `POST /api/org/loop/[id]/pr` is the one door out, and it is **one owner click** — no
scheduler calls it, the drive does not call it, and a lane never calls it for itself.

- **Gates, in order:** `selfHostGuard()` → `requireSameOrigin()` → `dbGuard()` →
  `requireOrgRole(org, "owner")`. `[id]` is the RUN id; the lane is named in the body and looked up as
  `{ id: laneId, runId: id }`, so a lane from another org's run is simply not found (404).
- **A typed confirmation.** The body's `confirm` must equal the lane's `repoFullName`. Every other
  loop control is reversible on the operator's own disk; this one writes to a remote everyone sees.
- **Refusals:** the lane must be `done`, have a branch, have landed at least one commit, and the repo
  must still be paired — otherwise 409 with the reason. A lane with **no dominant dimension** is also
  refused: `ImprovementPr.dimId` is not nullable and there is no honest value to invent, so the
  operator is told to open the PR by hand rather than have real work filed under a fabricated one.
- **Never `--force`.** `src/lib/local/loop-pr.ts` pushes the branch from the paired clone with
  `git push --set-upstream`; a rejected non-fast-forward surfaces as a 409 carrying **git's own
  message**, because a non-fast-forward, a missing remote and a bad credential need three different
  human responses and only git knows which happened.
- **Idempotent.** A 422 on create means a PR for that head already exists; the open one is returned
  with `reused: true` — the same handling `openDraftPr` uses. (`openDraftPr` itself cannot be reused
  here: it creates a branch off base and PUTs one file through the Contents API, so it has no way to
  open a PR for a branch that already carries local commits.)
- **Audited both ways.** `loop.pr.opened` on success and `loop.pr.refused` on failure — by the time
  most refusals fire the branch is already on the remote, and "we pushed and then could not open the
  PR" is a state an operator must find in the audit log rather than discover on GitHub.

The PR is recorded as an `ImprovementPr` with `source: "loop"`, `loopLaneId`, the synthetic
`practiceId = "loop:<laneId>"` (unique by construction, so a retry is idempotent and the uniqueness
rule protecting practice PRs is not widened) and `baselineScanId = lane.beforeScanId`. That baseline
is the mechanism: `refreshOps` / `verifyMergedPrs` are practice-agnostic and poll every open row, so a
loop PR gets merge detection and post-merge verification with **no edit to `improvement.ts`**, and the
post-merge scan is compared against the very baseline the branch measurement used.

## One improvement ledger — two bases (2026-08-30, moonshot #26)

`src/lib/db/improvement-events.ts` folds practice PRs and loop lanes into one read model behind the
Impact Ledger, the programme strip and the briefing's proof block.

- **`merged`** — measured on the default branch after a merge. This is what a buyer means by bought.
- **`branch`** — measured on a lane's own branch, from the worktree it scanned. Real, independently
  verified movement, and **not bought**, because nothing has landed.

`ImpactLedger.dimPoints` and `ProgramNow.pointsBought` stay **merged-basis only**. Branch movement is
reported beside them as `inReviewPoints` / `pointsInReview`, labelled "on branches, not merged".
Folding it in would tell a buyer they own something sitting on a branch nobody has reviewed. The
undercount that creates is fixed by the *route* above, not by the arithmetic: when the lane's PR
merges, the points move from in-review to bought with no re-measurement.

**The dedupe lives in the fold**, not in each consumer: a lane that became a PR that merged produces
both a branch row and a merged row for the same work, and the merged one wins. A one-ended lane, or
one that committed nothing (it scanned a worktree the run then deleted — L2-B-01), is `null`, never 0.

**The briefing** gains `loopProof` and `briefingLoopProofLine()`, printed by the exec banner, the PDF,
the share page and the markdown from ONE function — as a second line, never merged into the practice
one, and carrying the words "on branches, not merged". Null unless a lane has both ends, so the line
is absent rather than "0 · 0".

## The lane brief — the org's own standard in, structured verdicts out (2026-08-30, moonshot #25)

A lane's prompt used to be `buildFixPrompt(batch, …)` plus one fixed paragraph: Ascent's words about
the org's backlog, and nothing of the organization's own standard. Every remediation vendor applies
generic best practice; the differentiator is that Ascent holds the org's *versioned* standard and can
hand the relevant slice of it to the agent — then learn only from what a rescan verified.

**What goes in** (`src/lib/org/lane-brief.ts`, pure; `src/lib/db/lane-brief-read.ts`, the reads):
active playbooks for the batch's dimensions **named with their version**; the house pattern
`minePracticeShapes` mined from the org's own repositories, **with its exemplar count** (a pattern
from one repo is a habit, from six a house style); procedural Org Memory recalled through the same
`candidateOrgMemories` → `recallMemories` pair Athena's gate uses; registry skills whose category maps
into the batch's dimensions; and the last scan's own evidence and gaps for those dimensions.

**A section the org does not have is stated in words**, never left as an empty heading: "No playbook
in this organization covers D3", "No house pattern has been mined for D6 — you are setting the
precedent, not matching one." An agent handed a bare heading reads it as "there is no standard";
one told so explicitly can say so back. Truncation is per section, marked in the text
(`… (n more, trimmed)`) and recorded in provenance, so a trimmed brief never reads as a complete one.
Two calls on the same input are byte-identical — a brief that reshuffles would make an A/B comparison
of two lanes a comparison of two prompts. Memory text passes through the shared untrusted-content
neutralizer first.

`LoopRunLane.briefJson` stores the **provenance, not the prose**: which playbook and version, which
practice, which memory and skill ids, what was omitted and why, and the byte sizes. The prose is
rebuilt deterministically from the same inputs. The curation panel shows the same summary line before
you spend a session — which is mostly valuable for what it says is *missing*.

**What comes back**: `.ascent/lane-report.json`, versioned `"v": 1` (the same shape a remote agent
will POST when #3 lands, so that lane extends this contract rather than forking one). The parser
(`src/lib/local/lane-report.ts`) never throws: a missing file, `"{"`, a megabyte blob and an array
where an object belongs all return `parsed: false` or drop the entry. **The batch is the report's
authorization boundary** — an id the lane never dispatched is dropped, because an agent cannot
adjudicate rows it was not given. The file is added to the worktree's `.git/info/exclude` so it never
lands on the deliverable branch.

**Per-item verdicts** (`LaneItemOutcome`, `src/lib/db/lane-outcomes.ts`). One row per dispatched id,
in this precedence: the rescan closed it → `resolved` (**the verifier outranks the claim, always**);
else the agent's own verdict with its own words as the reason; else `absent`, because "nobody
accounted for this id" is a fact worth recording. `skipped` and `needs_human` park the item for a
bounded window (3 cycles, capped at 14 days) so the next cycle asks a different question instead of
spending another session being told the same thing.

**A deferral is not a decision on the row.** `Recommendation.status` has four values and none of them
means "declined by an agent for now", so nothing on the backlog row changes: the deferral is advisory
to `openBatch` alone, every other surface still shows the item open, and a **curated** batch that
names a deferred id dispatches it anyway (a human's pick outranks a machine's deferral, and the lane
log says so). Each verdict also writes a `RecommendationEvent { kind: "lane_verdict" }`, so the item's
own timeline explains itself.

**Adoption is earned.** When the rescan closes a row on a dimension the lane's brief carried a
playbook for, that playbook is stamped `PlaybookApplication{ appliedBy: "loop" }`. Both halves are
required: a close under a playbook the agent never saw is a coincidence, and a claim without a
verified close is not evidence.

**Lessons are candidates, never memory.** `report.lessons` become `OrgMemoryCandidate` rows with
`status: "pending"`, `source: "loop-lesson"`. **The loop never writes `OrgMemory`** — the companion,
the brief above and every consolidation pass read memory as truth, so an unattended process editing
it would let one bad session teach the whole organization something nobody agreed to. The cockpit's
lesson inbox says so in as many words, and `keep` promotes through the same `createOrgMemory` door a
person's own write uses (which is where the duplicate check lives). `discard` is **soft**: a proposal
that was rejected is worth as much on the record as one that was kept.

**Routes.** `GET /api/org/loop/propose` now carries `brief` per proposal, built by the same assembly
the engine runs. `GET/POST /api/org/loop/lessons` is the inbox — `selfHostGuard` → `requireOrgAccess`
for the read; `requireSameOrigin` → `selfHostGuard` → `requireOrgRole(org, "member")` for the write,
with the authorized org passed *into* the update beside the candidate id so another org's candidate is
simply not found (404). No `[id]` segment, so `id-routes-gated.test.ts` is unaffected by design.

## The capability rule, and the substitution check (2026-08-30, wave 3)

The lane agent runs `claude -p --permission-mode acceptEdits`: it can read and write files in one
worktree and **nothing else** — no shell, no network. Some gaps simply cannot be closed under that
grant, and the loop's measured failure mode was not that the agent gave up. It was that the agent did
something *adjacent* and called the item RESOLVED. From a real `lane-outcomes` row, verdict
`resolved`:

> The nine floating refs are still tags: resolving a tag to a commit SHA requires asking GitHub what
> it points at right now, this session has neither network nor shell, and inventing a SHA breaks the
> workflow rather than pinning it — so instead the burn-down stopped being a maintainer chore with no
> owner (`.github/workflows/pin-actions.yml` runs `security:actions --resolve` weekly…)

The workflow is genuinely useful; the nine actions are still unpinned. So the rescan re-raised the
gap, the next cycle armed the same item again, and the dimension churned — across three campaign runs
both repos churned D4 (agentic review, action pinning) with 40+ "closed" follow-ups and no sustained
score movement. This is the single biggest reason the gap backlog did not drain. Two changes:

**1. The capability rule, in the brief** (`buildFixPrompt`, `src/lib/org/followups.ts`, appended for
`commitPolicy: "lane"` only — the human's paste-into-my-own-terminal agent *has* a shell and a
network, and telling it otherwise would suppress work it can do). It states the grant plainly, names
the shapes of work that need more than it (resolving a tag to a SHA, querying an API, fetching a
digest, generating a lockfile or a baseline, reading CI history), and gives the exact line to emit
instead: `SKIPPED: <id> - needs <capability>: <one line>`. Automating the chore is valuable work and
the agent may still do it — but the ITEM is skipped, because the gap it names is still open and the
next scan will prove that. **RESOLVED means the gap this item names is closed by this change**: not a
plan to do it later, not a scheduled job that will do it, not documentation saying it should be done.
The rule ends with the pin-to-SHA case above as a worked example, verbatim, because a rule carrying
the actual failure is the one that gets applied. It is stated in exactly one place; `loop-lane.ts`
builds its AUTOPILOT CONTEXT around this prompt and deliberately does not repeat it.

**2. The substitution check** (`admitsIncapacity` / `INCAPACITY_PHRASES`, `lane-outcomes.ts`). The
rule above is an instruction, and the previous one ("if you cannot write that sentence honestly, the
item is SKIPPED") did not land — so the claim is no longer simply trusted. When the agent claims
`resolved` and **its own reason text admits it lacked a capability the item needed**, the verdict is
recorded as `needs_human`, which parks the item through the ordinary `DEFERRING` path so the next
cycle works something else instead of re-arming an impossible one.

`INCAPACITY_PHRASES` is an exported constant and is **a heuristic over the agent's own words** — not a
re-read of the diff, not a judgement about the change. It is deliberately narrow: each phrase names a
capability the session provably lacks (*"no shell"*, *"neither network"*, *"cannot run"*, *"would need
to fetch"*, *"requires asking GitHub"*) or the one forbidden act (*"inventing a"*). A vaguer list
would downgrade honest resolves. False negatives are cheap — the rescan re-raises the gap next cycle
anyway; a false positive parks work that was genuinely done, for three cycles.

Two boundaries hold it in place, both unit-tested (`src/lib/db/lane-outcomes.test.ts`, pinned on the
real sentence quoted above and on a set of genuine resolves that must stay untouched):

- **It never overrides the rescan.** An id in `closedIds` is `resolved` whatever its reason says. The
  verifier outranks the claim in both directions, and that invariant is older and stronger than this
  heuristic — an agent can write a muddled reason about work that demonstrably landed.
- **It is advisory to `openBatch` alone**, exactly like every other deferral. Nothing on the
  `Recommendation` row changes; the item is still open on every other surface, a curated batch that
  names it dispatches it anyway, and the downgrade is explained on the item's own timeline
  (`RecommendationEvent`) rather than silently. The outcome row's `reason` stays the agent's own
  words — only the timeline note says a downgrade happened.

## Remediation economics — cents per verified maturity point (2026-08-30, moonshot #27)

Every lane already had an independent verifier (the worktree rescan plus the movement-gated close
rule) and a before/after scan pair. What it did not have was the other half of the arithmetic: the
agent's cost, tokens, turns and model were read past and dropped at the process boundary, so the loop
could say what moved and never what it cost.

**The envelope is parsed whole.** `src/lib/local/agent-envelope.ts` is a pure parser over
`claude -p --output-format json`: `total_cost_usd`, `usage`, `num_turns`, `duration_ms`, `session_id`
and the model. `agent.ts` stays a spawn wrapper and calls it; `{ok, summary}` keep their exact
meanings, so every existing caller is unchanged. Honest nulls throughout — a field the envelope omits
is `null`, never 0, and a **reported** `total_cost_usd: 0` stays a real 0, because "the CLI said zero"
and "the CLI said nothing" are different facts. A **failed** session still records its cost: a failure
that burned two dollars is the most important row in the ledger.

**One declared cost source per lane.** `LoopRunLane.costSource` is stamped `"envelope"` and nothing
else. `AgentSession` rows are the OTLP export of Claude Code sessions a *developer* ran — a different
population reaching the box by a different path — so they are never added to a lane's cost, never
averaged with it and never used to fill a null. `agentSessionId` is stored so the two can be **joined
for inspection**, never summed. A structural guard
(`src/lib/local/lane-economics.test.ts` → "the one-source rule, structurally") asserts no read path
under `src/lib/local/**` or in `loop-runs-read.ts` reaches for an `AgentSession` cost field.

**Micro-cents, not cents.** `costMicros` is `round(total_cost_usd * 100 * 1e6)`, so a 0.4¢ session is
not rounded to zero. Every display divides.

**The fold** (`src/lib/local/lane-economics.ts`, pure — no DB, no React):

- a **verified point** is a positive `DimensionDiff.delta` on a lane whose `before` *and* `after`
  scans both exist. `diffScans` already refuses to invent a delta when either end is missing, and the
  fold never widens that: no pair means `verifiedPoints: null`, which is not the same as `0`;
- a lane's cost is attributed to the dimensions it moved **in proportion to their positive deltas**.
  Negative deltas are not netted off — a model that broke D5 while fixing D3 gets no discount;
- a lane that **spent and moved nothing measurable** does not disappear into the working lanes'
  denominator. It lands in `unproductiveMicros` and is shown on its own line;
- a `(model, dimension)` cell is `totalMicros / totalPoints`, and **`n` ships with every price**.
  There are deliberately no intervals, variance figures or confidence marks — per-model noise bands
  are deck item #30 and are deferred.

**Reads.** `getLoopRunDetail` returns `economics: LaneEconomics[]` (one per outcome, same order);
`listLoopRuns` sums `costMicros` per run, `null` when no lane recorded one; `getOrgPriceList(orgSlug)`
folds the org's most recent 200 priced lanes through the *same* `getScanComparison` → `diffScans`
path the ledger uses, and rides on `GET /api/org/loop` as `prices` (no new route, so no new `[id]`
gate surface). The list is org-scoped and derived at read time — it stores nothing, and there is no
cross-tenant "what does a D3 point cost" figure.

**A/B model policy.** `POST /api/org/loop { action: "start", modelPolicy: "ab", models: [a, b] }` fans
the same curated batch out to **two lanes per repo per cycle** — two worktrees, two branches, two
models, one `abPairKey`. Each arm rescans its own worktree, so the same guardbanded scorer adjudicates
both and neither arm grades the other. Exactly two distinct models, each matching the same
`/^[A-Za-z0-9][A-Za-z0-9._:-]*$/` token rule `agent.ts` enforces before a spawn (`shell: true`
re-parses argv on Windows) — anything else is a 400 and never a spawn. Because both arms run in one
cycle, an `ab` run has twice the lanes in flight, and a request past `LOOP_CONCURRENCY_CAP` is refused
with that reason rather than quietly exceeding the budget. A retried lane re-runs **its own** arm.

**The drive spends on evidence.** `pickDriveModel(prices, dimIds)` is consulted beside
`nextDriveStep` (never inside it — that function is a pure three-branch *termination* policy and a
model choice is not a termination reason). It returns `null` — meaning "keep the configured model" —
unless two models are measured at `n >= 3` on **every** dimension the step is aiming at.

**UI** (`?tab=live`): a cost chip on each `LaneRail` (`sonnet · 4 turns · 48.00¢`, or the literal
`cost unknown`, in the counters' own muted type — a cost is not a verdict, so it gets no colour); a
per-cell figure on the **outcome sheet's project-header row**, one per (run × repo); and
`PriceListPanel` under the run-history strip, which prints `n=` beside every cell and an explicit
"a price needs a lane with both scan ends and a recorded cost" where a zeroed table would otherwise be.

*This paragraph used to promise a `spent · ¢/point` line on each outcome row and was **wrong for two
waves** (UAT `PRIYA-L1-704`).* The spec's named home, `CockpitOutcomeLedger.tsx`, was deleted by the
wave-2 refactor and its replacement rendered attribution, commits, gaps and `agentConfig` — no cost
figure of any kind. `grep -rn "\.economics" src/features src/app` returned **zero hits** while the
payload carried `microsPerVerifiedPoint` on every detail read, so the only ¢/point on the page was
the org-wide average — the figure that *hid* a lane spending **$10.19 for 0 verified points**.

What the cell may say is decided once, in `outcomeEconomics.ts`, and the rules are the fold's own:

| Case | Reads |
| --- | --- |
| priced and measured | `1.50¢/pt` |
| **spent, measured, nothing moved** | `$10.19 · 0 pts`, in the warning tone — spend beside a zero, never "not measured" and never averaged into anyone's rate (**G18**) |
| spend known, rate not divisible | `3.00¢ · not measured`, with the missing half named in the title |
| no cost reported | `cost not reported` — a blank cell would read as free |
| no lane economics on the payload | nothing at all, never a zero |

A cell can hold more than one lane (an A/B run works one repo twice in one cycle), so the rate is
withheld unless **every** lane in it is both priced and measured: dividing a numerator that omits a
lane's spend gives a number that is confidently wrong.

**Meter.** Each lane also posts to the unified LLM meter (`meter()`, lane `local`) with the
caller-owned idempotency key `loop-lane:<laneId>` and the envelope's own cost (converted from
micro-cents to the meter's USD micros), rather than letting the meter re-price it from tokens: for a
subscription-auth CLI session the envelope is authoritative. A meter that throws is logged to the lane
and never fails it.

## The craft lane — the loop no longer ends at green (2026-08-30, r12)

**The loop used to die at green.** `openBatch` reads the repo's open follow-ups; the moment the last
gap closed it returned `[]`, the lane logged "nothing to dispatch" and closed, the run early-stopped,
and a repository that had done everything the rubric asks was handed silence. The owner's requirement
is that the work never ends — after the score is maxed there is always a further path in design,
architecture, code quality, performance and robustness — so the loop needed somewhere to go.

The material was already there and unreachable. Since `r10` the assessment produces **craft entries**
(`kind: "craft"` on `Recommendation`: what would make an already-green dimension *exemplary*), and
every consumer filtered them out. `r12` makes them dispatchable. See
[maturity-model.md §4d](../scanning/maturity-model.md#4d-the-craft-ladder--craft-becomes-dispatchable-work-r12-2026-08-30)
for the scan-side half (the axis, the ladder block, the ledger, the resolve rule).

**`openBatch`'s fallback.** Gaps always outrank craft. The gap path is untouched and returns a
byte-identical batch whenever the repo has a single open gap; craft was originally reached only
through the `gaps.length === 0` check and never mixed in. *(That single door is what starved the
ladder — see [the green reservation](#the-green-reservation--gaps-no-longer-take-the-whole-lane-at-green-2026-08-30)
below, which adds a second one. Gaps still outrank craft and still win the top slots.)* The craft
batch is ranked by **axis coverage first** —
the axis with the fewest *built* rungs leads (`getCraftLedger` → `axesByCoverage`) — then by the
model's impact, with an axis-less rung sorting last. A repo that has shipped four performance rungs
and nothing on robustness gains more from its first robustness rung than its fifth performance one.
Deferrals apply exactly as they do to gaps. Deterministic throughout, so the curation panel and the
engine cannot disagree.

**The lane kind.** `LoopLaneKind` gains `"craft"` (`parseTargets`' JSON-in-TEXT widening already
tolerates it — an old row still parses as `backlog`). `proposeLaneKind` proposes it when the repo has
a foundation and the batch in hand is *all* craft, which is its way of saying "no open gaps left"; a
practice starter cannot outrank it, because there is no gap for a starter to answer. **A craft lane
is an agent lane**, not a deterministic install: `runLane` now names `foundation`/`practice`
explicitly rather than testing `kind !== "backlog"`, which would have routed craft into the file
installer.

**No human gate, deliberately.** A craft lane arms automatically exactly as a backlog lane does. The
review that matters happens *after* the work — the Storyboard's ✓/✕ ledger is a record of what was
built, not a pre-approval queue — and a gate in front of unbounded work would simply stop the work.
If one is ever wanted, `proposeLaneKind` is where it goes back in; the comment there says so.

**The brief.** `buildFixPrompt` detects an all-craft batch and switches voice: the batch is framed as
rungs above the band with nothing owed, the instruction is to *raise the ceiling* rather than close a
gap, and three rules keep a rung reviewable — leave a named **artefact**, one rung not a redesign,
and never lower an existing bar or move a threshold to make a new one pass. It still ends with the
same `RESOLVED: <id> - <what changed>` lines (≤ 8 words, verb-first, past tense) the lane parser
reads, so the outcome ledger is unchanged. The heading carries **no** maturity points: a craft rung
has none by construction.

**Craft never becomes debt.** The ledger only ever increases; the debt figure the drive stops on is
derived from dimension scores and is untouched. Every debt/finding query filters `kind: "gap"` at its
`where` — `getOrgBacklog`, `getOrgRecommendations`, the nav badge, the personal backlog and the
improvement-PR triage — so craft cannot inflate a badge that would then never clear. (Before r12
`getOrgBacklog` filtered on `status` alone, so craft rows *could* already reach a batch, unordered
and mixed with gaps. That is now deliberate and ordered.)

**`laneKindTag` has no craft tag yet** — `src/features/inflight/live/cockpit/loopTypes.ts` was outside
this change's write set, so a craft lane currently renders untagged (the function returns `null` for
any kind it does not name, so nothing breaks). Adding `craft → "craft ladder"` there is a one-line
follow-up.

## The green reservation — gaps no longer take the whole lane at green (2026-08-30)

**The ladder was built, working, and starved.** r12's craft fallback engages only when a repo has
**zero** open gap items, and twelve campaign runs on two green repositories show that state never
arrives: each rescan's model-judged roadmap raises one or two fresh gaps, so `openBatch` always found
something and the batch was perpetually a one- or two-item `backlog` lane. `GET /api/org/loop/propose`
between those runs returned `kind: craft` with five well-formed rungs per repo — the ladder simply
never got a turn. (`kp` overall 81, `systedo-case` 88; every dimension at or above `FOLLOW_UP_BELOW`
after the unobservable-dimension fix.)

**The rule.** When a repo is **green**, the batch becomes a MIX instead of gaps-only:

- gaps still come first and still win the **top** slots, but are capped at `GAP_SLOTS_AT_GREEN` = **2**
  of `BATCH_SIZE` (5);
- the remaining slots are filled from the craft ladder, ranked exactly as craft already is —
  least-covered axis first (`getCraftLedger` → `axesByCoverage`), then the model's impact;
- a **non-green** repo is unchanged, gaps-only and byte-identical to before. *A repo with a real hole
  gets no craft budget at all* — that ordering is the doctrine, not a tuning knob.

Two slots, not one and not four: one would let a single fresh roadmap entry crowd out nothing while
still reading as a gap lane; four would leave the ladder a token slot and reproduce the starvation
more slowly. The cap is a **reservation, not a ceiling** — a green repo whose ladder is empty, or
whose ladder can fill only one of the three reserved slots, tops the batch back up with gaps rather
than shrinking it. An empty ladder must never cost the lane slots it could be working.

**Green, here, is `FOLLOW_UP_BELOW`.** `isReservationGreen` (`src/lib/local/lane-reservation.ts`)
delegates to **`repoGreenness`** (`src/lib/maturity/green.ts`) rather than re-deriving anything: that
predicate owns the three rules this must not restate — an unscanned repo is never green, a dimension
the reading could not measure is held out of the verdict in *both* directions rather than counted as
failed, and a repo whose whole dimension set was excluded is not green either (vacuous green is the
one verdict a loop must never report). Only the **threshold** differs, and on purpose:
`repoGreenness().green` asks the stricter **L5** question a *drive* terminates on, while the
reservation asks the `FOLLOW_UP_BELOW` (L4 floor) question the roadmap-coverage guarantee, the
overview ledger and the drill-in copy already call "where green starts". Gating craft on L5 would
starve the ladder on exactly the repositories it was built for. A *contested* dimension that is
numerically above the floor still counts here — that is the L5 question's business, and a rung on a
contested dimension is a rung, not a claim the dimension arrived.

**The read.** `getLatestRepoDimScores` (`src/lib/db/org-insights-green.ts`) — one org-scoped lookup of
the repo's latest scan's dimension scores, lazily imported by `openBatch` for the same reason
`getLatestUnmeasurableDims` is. **Every degradation answers `[]`, which reads as "unscanned", which is
not green**: a missing database, org, repo or dimension set lands the lane on the untouched gaps-only
path. The reservation spends a lane's slots on optional work, so an absence of evidence must never be
enough to open it.

**A curated read does not reserve.** `runLane` asks for the whole open list (limit 500) so a named id
ranked 7th survives the `curated.includes(...)` filter; capping gaps at two there would silently drop
most of what the operator picked. The option is explicit — `openBatch(..., { reserveCraft: false })` —
and the uncurated cycle and the `propose` route both take the reserved batch, so the curation panel
and the engine still compute the same thing.

**What a mixed batch is called.** Still a **`backlog`** lane. No new `LoopLaneKind` member is minted:
the kind is what a lane *does*, and a mixed lane does exactly what a backlog lane does — one agent
session over one batch — so `laneKindTag`, `parseTargets` and every persisted row keep reading
`backlog`, which is what those rows already are. What changes is the batch, and the batch is what the
**reason** is for: `proposeLaneKind` returns a backlog proposal whose reason says
*"Every measured dimension is above the band, so this lane works N open gap(s) first and spends its
remaining M slot(s) on the craft ladder."* An **all-craft** batch is still a `craft` lane, unchanged.

Tests: `lane-reservation.test.ts` (the predicate — the campaign shape green, one dimension below the
band not green, unmeasurable held out, vacuous green refused, unscanned refused; and the mix — the
cap, gaps-only with no rungs, the top-up, the limit) and `loop-lane.reservation.test.ts` (the wiring —
the mixed batch, the non-green repo unchanged, an unreadable read unchanged, the curated read
unreserved, the all-craft fall-through). `loop-lane.craft.test.ts` is untouched and still passes: every
case there is a non-green repo.

## Remote runs: the agent-neutral work protocol

`POST /api/org/loop { action: "start", executor: "remote-agent", org, repos[], batches? }` arms a run
Ascent does not drive. `startRemoteRun` (`src/lib/local/loop-engine.ts`) creates the `LoopRun` in
phase **`curating`** with one `LoopRunLane` per repo (`executor: "remote-agent"`, `phase: "queued"`,
`batchIdsJson` = the proposed batch), records a `loop.remote_run_started` audit row, and returns. No
worktree, no process, no pairing read, no `selfHosted()` / `ASCENT_AUTOPILOT` check — those guards
exist because a local run spawns an editing agent inside a paired working copy, and this one spawns
nothing.

What moves it: `claim_followups` over the MCP door. The first successful claim against one of the
run's repos calls `attachRemoteClaim`, which stamps `claimedBy` + `leaseUntil` on that repo's lane,
moves it `queued → dispatching`, and flips the run `curating → running`. `report_attempt` records the
agent's account; the lane reaches `done` when the repo's next scan lands, exactly as a local lane
does. **The rescan is still the only thing that closes a follow-up.**

| Lane column | Meaning |
| --- | --- |
| `executor` | `local` (default — every row written before #3) or `remote-agent`. |
| `claimedBy` | The claimant's opaque actor id, `agent:<token name>`. Null = nobody has claimed into this lane yet. |
| `leaseUntil` | When that claim lapses. Null = no lease held, which is **not** "expired". |

**A remote lane carries no cost envelope.** #27's figures are parsed out of a `claude -p` session
envelope Ascent spawned, and there is no such session here, so `costMicros` stays **null** — unknown,
never zero. The cockpit renders "cost unknown" beside an `agent` chip, the claimant and a lease
countdown; a zero there would be averaged downstream as a free session, which is a claim nobody made.
The run panel also hides "Stop after in-flight" for a remote run: that button is a cooperative signal
to a process this deployment is driving, and there is none.

## Known gaps

- **The A/B model policy has no picker.** `modelPolicy: "ab"` is accepted, validated and driven end
  to end by `POST /api/org/loop`, but the cockpit's run controls still offer only one model — arming
  an A/B run today means calling the route. The dials live in `CockpitRunControls`/`useRunDials`,
  outside the write set of the change that added the policy.
- **Retry builds a fresh worktree and branch.** Deliberate (the original worktree is gone by then),
  but it means a retried lane's commits land on a different branch from its siblings' — two branches
  to review for one repo.
- **The agent's `--effort` flag is passed only when a level is chosen.** A `claude` build that does
  not know the flag is therefore unaffected, but there is also no probe: if a build rejects it, the
  session fails with the CLI's own message rather than falling back to no-effort.
- **One commit per lane cycle, not per resolved item.** The lane commits the session's whole residue
  in a single commit carrying every claimed trailer. Per-item commits would need the agent to
  delimit its own work item by item, which nothing currently asks it to do.
- **The lane's commit runs the repo's hooks and needs a git identity.** It is an ordinary
  `git commit` in the worktree, so a `commit-msg`/`pre-commit` hook or a missing `user.email` fails
  it — and that falls back to the lost-work log rather than to a retry.
- **A `backlog` lane can still be proposed with an empty batch** (L2-E-01) — *narrowed by r12*. A repo
  that is merely out of *gaps* now proposes a `craft` lane, so the common case is covered; the gap
  that remains is a repo with neither an open gap nor an unbuilt craft rung (a scan that produced no
  craft entries at all). The curation panel still offers an agent lane there instead of saying there
  is nothing left to work, and the run early-stops. The proposal has no guard either way.
- **The `Resume drive` button is live before hydration** (L2-C-01). It is server-rendered and
  enabled, so a click landing before React attaches its handler is swallowed with no request and no
  error. Generic Next.js behaviour, unusually expensive on this particular control.
- **`agent.ts` does not strip `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT` from the spawn env** (L2-F-02).
  It strips `ANTHROPIC_API_KEY`; a self-hosted Ascent started from inside a Claude Code session hands
  the harness's own markers to every agent it spawns, and a nested `claude` that inherits them
  produces nothing, silently.

---

## Throughput: batch, session ceiling and the reservation (2026-08-31)

A 21-run campaign across two real repositories (`kp`, `systedo-case`) produced **34 commits** and
moved `kp`'s overall **83 → 82** while `systedo-case` went **84 → 88**. The loop was not failing. It
was being *timid*: every change item-shaped, nothing spanning files, nothing deleted, no
restructuring, no de-duplication, no performance work. After twenty runs on small and medium
codebases the expectation was *"well structured, deduplicated, blazingly fast code"*.

Three of the causes were numbers nobody could reach. All three are now **per-run parameters**,
recorded on `LoopRun`, and every default is the value the loop already used — so a run armed without
touching them is byte-identical to every run before they existed.

| Dial | Default | Cap | Why it exists |
| --- | --- | --- | --- |
| `batchSize` | **5** (unchanged) | **12** | De-duplication is not reachable from a batch that cannot see two duplicates at once. The cap is an argument, not a round number: every item is *claimed* before dispatch, so a batch is a lock held over other workers' queue, the brief grows with it, and past roughly a dozen items a session starts skipping the tail silently. |
| `agentTimeoutMs` | **20 min** (`ASCENT_AUTOPILOT_TIMEOUT_MS`) | **90 min**, floor 60 s | A campaign lane literally committed `Agent session exceeded 20 min and was stopped` — a structural change killed by the clock and then discarded with the worktree. Capped because the timeout is the **only** thing that ends a wedged headless session, which otherwise holds a lane, a worktree and a batch of claimed rows indefinitely. |
| `verifyMode` / `verifyTimeoutMs` | **`on`** / **10 min** | 30 min | See §[The A/B degradation guard](#the-ab-degradation-guard-2026-08-31). |

Validation lives in `src/lib/local/run-limits.ts`, which is **dependency-free** for the same reason
`agent-options.ts` and `delivery-options.ts` are: the cockpit's pickers and the route's validators
have to agree, and the way that stops being true is two lists. Every normalizer **refuses rather than
clamps** — see the `400` note under `POST /api/org/loop`.

### The craft reservation is a proportion, not a count

`GAP_SLOTS_AT_GREEN = 2` was tuned against a fixed batch of five. With a variable batch it is two
different reservations wearing one number: on a batch of ten it would hand **eight** slots to the
craft ladder on a repo that still has ten open gaps ranked above them.

`gapSlotsAtGreen(limit)` (`src/lib/local/lane-reservation.ts`) is `round(limit × 2/5)`, bounded so any
batch of two or more keeps **at least one gap slot** (gaps outrank craft — a green repo with a fresh
roadmap entry must still get to work it) and **at least one craft slot** (the ladder never getting a
turn is the whole reason the reservation exists). A batch of **one** is the only size that cannot hold
both, and it resolves for gaps.

| batch | gaps | craft |
| --- | --- | --- |
| 1 | 1 | 0 |
| 2 | 1 | 1 |
| **5** | **2** | **3** *(unchanged)* |
| 10 | 4 | 6 |
| 12 | 5 | 7 |

### Permission to make a larger change

`buildFixPrompt` (`src/lib/org/followups.ts`) read, to an agent, as an instruction to be small: *"the
smallest change that closes the gap"*, *"small and reversible"*, *"one rung, not a redesign"*. An
agent told to be small is small. So the brief now carries an explicit **structural invitation**:

- On a **craft lane** (a green repo working the ladder) it is unreserved — restructuring,
  de-duplication and performance work are in scope; the change **may span many files, may move code,
  and may delete code, and is expected to when that is what raises the ceiling**; judge by the ceiling
  raised, not by the diff size.
- On a **gap lane** the same permission applies where the gap's *real cause* is structural, with the
  existing precedence intact: `RESOLVED` still means **this** item's gap is closed by **this** change,
  and a restructure that leaves it open is `SKIPPED` with the reason.

Every honesty rule survives untouched — the capability rule, `RESOLVED` meaning the named gap is
closed, and no substitution. **A restructure is a bigger change, never a looser claim.** "Small and
reversible" remains the default *shape*; what is withdrawn is the implication that small is the only
shape permitted.

And the invitation only makes sense with a net under it, which is the next section.

## The A/B degradation guard (2026-08-31)

**Within a cycle, prove the change did not degrade the repository, and reverse it if it did.**

An agent that knows a regression will be caught and reversed is the one that takes the larger swing;
an agent that believes a mistake ships is *correct* to make the smallest change it can. The guard is
what makes §*Permission to make a larger change* honest rather than reckless.

`A` is the pristine worktree before the session; `B` is the same worktree after the agent's edits and
**before the commit** — before, because the whole point is that a rejected cycle leaves no commit and
no branch to explain away.

### Resolving the repository's OWN command

Nothing is invented. `resolveVerifyCommand` (`src/lib/local/lane-verify.ts`, pure and table-tested)
consults, in this fixed order, reusing readers that already exist:

1. **`.ai/manifest.yaml`** via `readManifestYaml` (`src/lib/standard/read.ts`). Capabilities wired at
   `controls.ciHardPass` (else `prePush`), deduped, in declared order, at most three, joined with
   `&&`. This is the most authoritative source because it is the only one **machine-declared** rather
   than inferred from prose. A command the reader **redacted** (a secret-shaped run) or one carrying a
   `<placeholder>` is refused rather than executed — neither is a command anybody declared.
2. **The guidance files** — `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md` — via `parseCommands`
   (`src/lib/analyze/guidance-graph.ts`), the **same extraction the scorer's `commands_agree` facet
   runs**. Key preference `test → typecheck → build → lint`; `dev` (a server that never exits),
   `install` (proves nothing about the change) and `format` (rewrites rather than judges) are never
   used.
3. **`package.json` scripts**, composite names first: `check:ci`, `verify`, `check`, `ci`, `test`
   (`test` becomes `npm test`, everything else `npm run <name>`). Last, because a script that exists
   is weaker evidence than a command the repository asked for in words.
4. **Nothing** → the guard is `skipped` and says so. Never a silent pass: *"we could not check"* and
   *"we checked and it was fine"* are different facts.

A broken declaration **falls through** to the next source rather than failing the resolution — a
malformed manifest is not evidence that no check exists.

### The four verdicts

| Verdict | When | What the lane does |
| --- | --- | --- |
| **`verified`** | passed before, passes after | Proceeds: commit, rescan, deliver, as always. |
| **`rejected`** | **passed before, failed (or timed out) after** | `git reset --hard HEAD` + `git clean -fd` **in the throwaway worktree only**; **no commit**, **no rescan**, claims released, a lesson candidate and a `noted` deliverable recorded, and the lane ends honestly with **no claim**. |
| **`baseline-red`** | already failing before the session | **No blame, no rejection.** The repository arrived broken; the lane proceeds exactly as it would have without a guard, and the note says so. A guard that punished an agent for arriving at a broken repository would be unusable on precisely the repositories that need it most. |
| **`skipped`** | nothing resolvable, or `verifyMode: "off"` | Proceeds, and the row records `skipped` **with its reason**. Never `null` — null is what a lane written *before* the guard carries, and "we did not check" must not be able to masquerade as "there was nothing to check". |

The baseline is measured **once per worktree** (cycle 1) and cached for that worktree's later cycles:
cycle 2's `HEAD` already carries cycle 1's commits, so re-measuring would answer a different question.
The cache is keyed by worktree directory and forgotten by `loop-engine.ts` when the worktree is
removed.

**A timeout is a failure on both sides**, deliberately. On the baseline it means the repository's own
gate does not finish inside the budget → `baseline-red`, honest, and it stops the guard silently
costing every lane ten minutes for nothing. On the result run it means the session left the repository
unable to get through its own checks → a degradation.

### A worktree has to be RUNNABLE first (2026-08-31)

**The guard's first live run returned `baseline-red` for both repositories, on the pristine tree,
before the agent had touched anything.** It resolved each repo's own command correctly
(`npm run test:unit`) and then measured a failure that was not about either repository: a
`git worktree` contains **tracked files only**, dependencies are gitignored, so the lane checkout has
no `node_modules` and `npm run test:unit` there cannot *start*. A red baseline is never compared
against, so the guard protected nothing — and *every* JavaScript/TypeScript repository would have
reported `baseline-red` forever, which are exactly the repositories the guard was built for. The same
holds for Python (`.venv`), Go (`vendor/`) and Ruby (`vendor/bundle`).

`createLoopWorktree` therefore **links** the paired checkout's dependency caches into every worktree
it makes (`src/lib/local/worktree-deps.ts`).

| | |
| --- | --- |
| **What is linked** | `node_modules`, `.venv`, `venv`, `vendor` — dependency **caches** only. Each is derived state a package manager rebuilds from a lockfile, conventionally gitignored, and large enough that copying it per lane would dominate the run. Build *output* (`.next`, `dist`, `build`, `target`) is deliberately absent: a lane is expected to regenerate it, and a link would let one lane's build stomp on another's. Source, config, `.git` and `.env*` are never linked. |
| **How** | A **junction** on Windows (`fs.symlink(target, path, "junction")` — no elevation, no Developer Mode), an ordinary directory symlink elsewhere. **Never a copy**: a copied `node_modules` is minutes and gigabytes per lane, per arm, per cycle; a link is one syscall. |
| **When** | Only if the name is a real directory in the source checkout, is **not already present** in the worktree (a committed Go `vendor/` is tracked content and is left alone), and the worktree's own git says it is **ignored** (`git check-ignore -q -- "<name>/"` — the trailing slash is load-bearing, because a `node_modules/` pattern is directory-only and git cannot tell that a not-yet-existing path is a directory). |
| **Best-effort** | A permission error, a filesystem without symlinks, a target that vanished — each is a **note on the lane** and the next name. A lane that links nothing still runs; it verifies as `baseline-red` or `skipped` exactly as it did before. The notes are drained onto the lane log once (`takeDepNotes`), by the first cycle to open the worktree. |

**It is a link, so writes reach the operator's real directory.** That is acceptable for a dependency
cache — a package manager's install directory is one `npm ci` from repaired — and unacceptable for
anything else, which is the whole reason the list above is caches only.

**Cleanup: the links come out FIRST, and the order is a safety property.** Measured on Windows:
`git worktree remove --force` **follows a junction** and deletes the *target* — the operator's real
`node_modules`, not the link. So `removeLoopWorktree` (and `removeStrandedWorktrees`, which matters
more: a hard-killed lane never reached its `finally`, so a stranded worktree is precisely the one that
still holds its links) calls `unlinkDependencyDirs` before it asks git for anything. That helper
removes a path **only** when the path's own `lstat` says it is a link, and calls `fs.rm` **without
`recursive`**, so there is no code path by which it can walk into the target.

**The scan is unaffected — verified, not assumed.** `LocalFsSource` lists a worktree with
`git ls-files -c -o --exclude-standard`, which drops ignored paths; with `node_modules/` in
`.gitignore` a junction is invisible to that listing, while a plain `git ls-files -o` walks straight
into it. "Ignored" is therefore exactly the property that keeps a linked cache out of the file census,
which is why it is a **precondition of linking** rather than a hope: a repository that does not ignore
its own dependency directory gets no link and a note saying why, instead of a silently inflated tree
and a score that moved for a reason that was not a change. `git clean -fd` (the rejection discard)
does not touch an ignored path either, so a rejected cycle leaves the link and the target alone.

**And `baseline-red` means something again.** With the caches linked, a red baseline is a real claim:
*this repository's own checks were already failing*. It is not the only reason a command can be red —
a repo whose command needs an install step the loop cannot provide still cannot start — so
`looksUnrunnable` (`lane-verify.ts`) splits the note in two: *"could not START … a fact about this
checkout rather than about the repository"* versus *"already failed on this repository before the
session started"*. **Same four verdicts**; a fifth would be a new column, a new cockpit word and a new
thing for a reader to learn, for a distinction that belongs in a sentence. Either way: not comparable,
and the agent is not blamed.

### A red baseline is SURFACED, and becomes the loop's own top-priority work (2026-08-31)

**The failure this closes.** The in-cycle guard reported `baseline-red` for `xkazm04/systedo-case`:
its own `npm run test:unit` fails before an agent touches anything — measured directly at 294 s,
exit 1, one failing file, `test-unit/fault-injection-llm.test.mjs`. **That test was written by this
loop**, in an earlier campaign whose deliverable read *"Added fault-injection suites for LLM and Ads
seams"*. It had been failing ever since and nothing reported it. And because the guard refuses to
blame an agent for a repository that arrived broken, the consequence compounds: the guard is
**effectively disabled on that repository for as long as the condition holds**, so the loop can never
again prove it did not break something there — and it keeps committing into a repository whose own
checks fail. `baseline-red` was written to a lane log nobody reads.

Two things changed, and the second is the valuable one.

**1. It is surfaced where an operator already looks.** A red baseline rides the **weekly fleet
digest's standing-concerns block** — the same channel `detectStandingRegressions` uses, chosen for the
same reason ([alerts.md](../fleet/alerts.md#standing-regressions-a-decline-that-stopped-moving)): that
block is the one surface in the product shaped for a **state** rather than an event, and a repository
red since before the window looks flat to every movement-shaped input the digest has. No new panel and
no second heading — the heading already says *observed, cause not attributed*, and each line names its
own subject. Red baselines are listed **first**: a guard that cannot run outranks a score that fell.

`getRedBaselines(org, { limit })` (`src/lib/db/loop-baselines.ts`) folds the `verifyVerdict` column
into one row per repository — nothing new is stored, and there is no parallel state. The wording is an
OBSERVATION, produced by `redBaselineObservation` (`src/lib/local/lane-baseline.ts`):

> `npm run test:unit` — this repository's own check — has failed before the session on every loop lane
> since 2026-08-28 (3 lanes). With no green baseline the degradation guard cannot compare anything, so
> nothing the loop commits here is verified.

Two facts, a date, and the consequence. No cause, no actor, no blame — a line quoted out of the
message still cannot read as an attribution. Its `evidence` lines are the repository's own captured
output, bounded and neutralized. **One red lane is enough**, unlike a standing regression's three-scan
threshold: a score needs persistence to be told from noise, a failing check has no noise band, and
waiting three lanes buys three more lanes of unverifiable commits. The **most recent** lane decides in
both directions — a repository since repaired raises nothing.

On the **outcome sheet** it is one word, `baseline red`, on the repo's project-header row beside that
run's verdict, the guard's full note on hover (`OutcomeSheetRow.tsx`). It is the only one of the four
verdicts the sheet shows: `verified` on every healthy row would be a badge meaning "normal", and
`rejected` cannot reach the sheet at all. Unlike the lane rail's `unverified` it **is** coloured —
this is not the neutral fact *"we did not check"*, it is *"we could not check, and every number in
this column was produced with the net off"*.

**2. The next lane's brief LEADS with the repair.** If the loop's own checks cannot run, making them
run again is the most valuable thing the loop can do there, so `buildFixPrompt` prints a
`# TOP PRIORITY` block **above the batch's own heading** (`RedBaselineBrief`, `src/lib/org/followups.ts`).
A priority stated after five follow-ups is not a priority. It names the command, quotes what the guard
captured — bounded to 4 lines / 400 chars and run through `neutralize`, which is also what makes it
safe to fence — and states that restoring the check outranks every armed item this cycle. **The armed
batch still rides along**; what changes is the priority, not the scope. It forbids the cheap pass in as
many words: no `.skip`, no removed assertion, no relaxed threshold. *A weakened check is worse than a
red baseline, because a red baseline at least tells the truth about itself.*

`leadWithRedBaseline` decides it from **this cycle's own measurement**, with the history supplying only
the count: a repository measured green today gets no lead however red its history is; a repository red
today leads at `attempt = 1 + consecutive red lanes behind it`. With the guard off, the last thing
actually measured stands in, and the count does not grow.

**The non-convergence guard.** `attempt > 1` means a previous lane already led with this same repair
and the command is still failing, and both surfaces say so: the brief prints *"THIS IS ATTEMPT 3 …
the repair is not converging"* and asks the session to name the blocker rather than repeat what the
last two tried; the lesson records it for the operator. **An operator seeing "attempt 3" learns
something a silent retry never tells them.**

**The lesson, and the row that is deliberately NOT written.** `recordRedBaselineLesson`
(`src/lib/db/loop-lessons.ts`) files it through the same pending-candidate queue every agent lesson
uses — but **one row per repository, refreshed** as the attempt count climbs, keyed on a prefix
carrying neither the command, the date nor the count. A red baseline is a standing fact that stays
true lane after lane, so the event-shaped write `recordLoopLessons` does would have filed twenty-one
identical candidates in the campaign that exposed this. A `kept` or `discarded` row is left alone: a
human has ruled on it, and resurrecting their rejection is the noise the idempotence exists to prevent.

**No `Recommendation` row is created, and that is a decision rather than an omission.** A failing test
is not a scan finding. The recommendations table is the SCAN's ledger — every row is scored,
prioritised, projected in points, claimable over MCP and adjudicated by the next scan against the gap
it named. A synthetic *"fix your test suite"* row would be none of those things: no dimension owns it,
no rescan can close it, and its projected gain would be a fabrication. It would also corrupt the one
artefact the loop must not author, since the loop's whole contract is that a row closes only when the
scan says it did. The brief and the lesson are the right carriers — one reaches the agent, the other
reaches the operator, and neither claims to be a measurement.

### A rejected lane is never delivered

The verdict is persisted on `LoopRunLane.verifyVerdict`, and **both** delivery doors check it
explicitly and first:

- `deliverLane` (`src/lib/local/loop-delivery.ts`) refuses `land` and `pr` on a `rejected` lane
  whatever mode the run asked for, logging the reason on the lane.
- `POST /api/org/loop/<id>/pr` — the one-click door a **human** presses — returns `409` for the same
  reason. A verdict that only bound the automatic path would be no verdict at all: a human clicking
  "open a PR" is exactly how a reversed cycle would otherwise reach a remote everyone can see.

In practice a rejected lane also has `commits === 0`, which would turn it away anyway — but "in
practice" is not the standard for the one code path that merges into a working copy or pushes to a
remote.

### Bounds, consent and the record

- **It runs repo-authored code.** Plainly: `npm test` in a checkout runs whatever that repository's
  test script says. This loop **already** spawns an editing agent in that checkout, so the guard adds
  no capability that was not already there — and it is gated identically: self-hosted only,
  `ASCENT_AUTOPILOT=1`, `requireOrgRole(org, "owner")` to arm, `shell: true` in the **throwaway
  worktree** with `ANTHROPIC_API_KEY` stripped and `CI=1` set (so a watch-mode runner is one-shot).
- **The disable is obvious.** `verifyMode: "off"` on the run; in the cockpit it is a labelled picker
  (*"Do not run this repository's checks"*) whose standing hint says what is lost — lanes recorded
  UNVERIFIED and a regression free to reach whatever delivery mode was chosen.
- **The reversal is worktree-only.** `reset --hard` and `clean -fd` are the two most destructive
  commands in this codebase and they run in exactly one place: a temp checkout `createLoopWorktree`
  made minutes earlier, which `removeLoopWorktree` deletes anyway. `landLaneBranch` — the module that
  *does* touch the operator's checkout — still never resets, stashes or switches anything. The one
  place the worktree reaches *out* is the dependency **links** above, and their teardown is bounded
  the same way: only an `lstat`-confirmed link is removed, non-recursively, and always before git is
  asked to remove the worktree.
- **The lane row shows it.** One word beside the cost counters (`verified`, `rejected`,
  `baseline red`, `unverified`), the full note on hover, and only `rejected` is coloured: `unverified`
  is a fact, not a fault. A lane written before the guard renders **nothing**.
- **A rejection leaves a lesson**, through the same pending-candidate queue every agent lesson uses,
  keyed on the standing fact (this repo, this command) rather than the branch.
- **The brief only promises the net when it is real.** `buildFixPrompt`'s safety-net paragraph is
  printed **only** when a command resolved *and* passed on the pristine tree. Telling an agent its
  mistakes will be caught when they will not is the one lie that would make the invitation dangerous.

Tests: `lane-verify.test.ts` (the resolution chain, the redaction/placeholder refusals, "declares
nothing → null"), `lane-guard.test.ts` (the four verdicts, the baseline cache, both timeout paths, the
discard's exact two git commands and their cwd), `lane-baseline.test.ts` (the consecutive-red walk —
a verdict-less lane is skipped rather than breaking it, `skipped` does break it; the observation's
wording, its date and its absence of any cause; the failure lines bounded on BOTH axes and neutralized
in both senses; the lead's four cases — red, green, unmeasured-with-history, unmeasured-without — and
the attempt counter climbing and resetting), `followups.test.ts` (the lead is FIRST, above the batch's
heading; it quotes the failure inside exactly two fence lines; "attempt N / not converging" appears
only past 1; a green baseline prints the safety net and no lead, a red one prints the lead and no
net), `loop-lane.guard.test.ts` (a rejected lane commits nothing, rescans nothing, releases its claims
and persists `rejected`; baseline-red is not blamed; the brief leads on red and does not on green or
skipped; the attempt count reaches the prompt, the lane log and the lesson; and **every recommendation
id the lane touches is one it armed** — no synthetic row); `outcomeMatrix.baseline.test.ts` +
`OutcomeSheet.dom.test.tsx` (the cell carries the command and note, a later green cycle clears it, and
the sheet renders exactly one word with the note on hover);
`loop-delivery.test.ts` and `[id]/pr/route.test.ts` (a rejected lane is not landed and not PR'd, and
the other three verdicts are not blocked), `run-limits.test.ts` (the normalizers never guess; the
defaults are today's values), `lane-reservation.test.ts` (the proportion at 1, 2, 5, 10, 12) and
`worktree-deps.test.ts` — real git, real filesystem — (a worktree next to a checkout with a
`node_modules` gets a working link and can read through it; a checkout without one is untouched and
says nothing; a directory the repo does not ignore is refused with a reason; a link that cannot be
made is a note, not a throw; **`removeLoopWorktree` and the stranded sweep both leave the target's
contents intact, asserted by name**; and the census — `git ls-files -c -o --exclude-standard` and a
real `LocalFsSource` snapshot — never sees the linked tree).
