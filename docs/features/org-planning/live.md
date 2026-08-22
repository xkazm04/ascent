# The Live tab: the loop cockpit

**Status (2026-08-22): server side SHIPPED, cockpit UI in flight.** The durable, bounded-parallel
**loop engine** — `LoopRun`/`LoopRunLane`, `/api/org/loop`, `src/lib/local/loop-engine.ts` — is
implemented and tested. The Live tab (`?tab=live`) is being rebuilt around it as an *Observatory*
cockpit; the prior war-room wall is kept behind `?view=wall`. The UI section below is a marked
placeholder until that lands.

Everything on this page is **self-hosted only** (`selfHosted()`, `src/lib/env.ts`). On managed cloud
the loop routes answer **404** (`selfHostGuard`) and the cockpit renders an empty state — see
[Known gaps](#known-gaps).

## The loop

```
select ──▶ curate ──▶ run ──▶ rescan ──▶ outcome
  │          │         │        │           │
  │          │         │        │           └─ per-lane before/after diff + closed follow-ups
  │          │         │        └─ scan the WORKTREE from disk; `Ascent-Resolves:` trailers close rows
  │          │         └─ N lanes, bounded parallelism: worktree → local `claude -p` → rescan
  │          └─ GET /api/org/loop/propose: the exact batch each lane would get, editable
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
| `phase` | `curating \| running \| done \| stopped \| error`. `start` writes `running` directly. |
| `reposJson` | JSON `string[]` of `owner/name` — the run's selected set. TEXT, not `jsonb` (the schema's DSQL contract). |
| `concurrency` | Lanes in flight at once. Clamped 1…`LOOP_CONCURRENCY_CAP` (4); default 2. |
| `maxCycles` | Clamped 1…`LOOP_MAX_CYCLES_CAP` (5); default 3. |
| `cycle` | The cycle being worked (`0` = none started). |
| `curated` | True when the operator approved the batches by hand. |
| `startedAt` / `endedAt` / `error` / `createdAt` | `endedAt` set on every terminal transition. |

Index: `@@index([orgId, createdAt])` — the run-history page's only query shape.

### `LoopRunLane` — one repo, one cycle

The unit of parallelism, of retry, and of the cockpit's row.

| Field | Notes |
| --- | --- |
| `runId` / `repoFullName` / `cycle` | The lane's identity. `upsertLane` is get-or-create on this triple, so a retry re-enters the same row. |
| `phase` | `queued \| dispatching \| rescanning \| done \| error`. |
| `branch` | `ascent/loop-<stamp>-<repo>` — **the deliverable**. Survives the run; only the temp worktree dir is removed. |
| `batchIdsJson` / `closedIdsJson` | JSON `string[]` of `Recommendation` ids dispatched / closed by trailer. |
| `commits` | `git rev-list --count <before>..HEAD` in the worktree. |
| `beforeScanId` / `afterScanId` | The two ends of the lane's diff (see [Outcome](#outcome-what-the-lane-moved)). |
| `stage` | Live rescan sub-stage (`fetch \| tree \| files \| analyze \| score \| compose`), `null` between phases. |
| `log` | Newline-joined, **bounded to `LANE_LOG_LINES` = 200**, newest last, each line stamped `HH:MM:SS`. Appended read-modify-write; safe because a lane is single-writer by construction. |
| `error` / `startedAt` / `endedAt` | A failed lane is lane data, never a run failure. |

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
| `start` | `{ action, org, repos[], batches?, concurrency?, maxCycles?, curated? }` | `{ run }` |
| `stop` | `{ action, org, id }` | `{ ok, run }` — `200` when stopped, `409` when not |
| `retry` | `{ action, org, laneId }` | `{ ok }` — `200`/`409` |

- `400`: missing `org`/`action`, empty `repos`, `maxCycles` outside 1–5, `concurrency` outside 1–4,
  missing `id`/`laneId`.
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
{ "proposals": [ { "repo": "acme/api", "items": [ /* FollowUpItem × ≤5 */ ], "projectedPoints": 14 } ] }
```

It calls the **same `openBatch`** the engine calls. That identity is the point: a curation screen
built on a second, "equivalent" query would eventually propose a batch the engine then declines to
work. It is a `GET` because it writes nothing — no `LoopRun` row exists until `start`, so the panel
can be opened and closed freely. `400` on a missing `org` or empty `repos`. The static `propose`
segment resolves ahead of the sibling `[id]` route, so the two never collide.

## The engine

`src/lib/local/loop-engine.ts` arms a run and returns its row **immediately**; the loop itself runs
detached and the cockpit polls `GET /api/org/loop`.

- **A lane** (`loop-lane.ts`) is one repo for one cycle: pick the batch → claim the rows
  (`status: in_progress`, so the rescan's trailer/restatement feedback applies to them —
  `scans-persist` only resolves *claimed* rows) → `git rev-parse HEAD` → one headless `claude -p`
  session in the worktree with `buildFixPrompt` + an autopilot context block → count commits →
  rescan the worktree from disk → record what the trailers closed. `runLane` **never throws**: every
  outcome, including a failed agent or a failed rescan, is lane data.
- **Bounded parallelism**: `mapPool(activeTargets, run.concurrency, …)` — default 2, hard cap 4.
  Four local `claude -p` sessions already saturate a developer box.
- **A worktree per repo per RUN** (not per cycle): `git worktree add -b <branch> <tmp> HEAD` off the
  paired path. Cycles build on each other's commits like a human working a branch, and one branch is
  one reviewable deliverable. Branch names are folded to a safe single ref segment:
  `ascent/loop-<stamp>-<repo>`; the [autopilot shim](../local-mode/README.md) overrides `branchFor`
  to keep its historical `ascent/autopilot-<stamp>`. Teardown removes only the temp dir (`--force`);
  **the branch is left behind on purpose**. Never a push.
- **Curated cycle 1, auto afterwards.** Cycle 1 uses `input.batches[repo]` when given; every later
  cycle auto-picks the **top 5 open follow-ups by projected points** (`BATCH_SIZE`). A curated batch
  *names* its rows, so the pick spans the repo's whole open list (`limit: 500`) and then filters —
  filtering a top-5 slice would silently drop a curated id ranked 7th.
- **Per-lane early stop.** A cycle that produced neither a commit nor a closed row drops that repo
  out of the next cycle. This is the autopilot's no-progress rule applied *per lane* instead of per
  run, so one stalled repo no longer ends the whole fleet's pass.
- **Stop semantics.** `stopLoopRun` sets a cooperative flag on the in-memory `LiveRun`; lanes check
  it *between* phases, never mid-agent-session. An in-flight lane finishes its agent session, skips
  its rescan, and the run winds down to `stopped`. Stopping a run this process does not own (already
  finished, or a restart casualty) reconciles the row instead of no-opping.
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

It runs at **two** moments: on `GET /api/org/loop` (so the cockpit never renders a job nobody is
driving) and inside `startLoopRun`, *before* the one-run-per-org check — otherwise a single crash
would bar the org from ever starting another run. There is deliberately **no boot hook**; see
[Known gaps](#known-gaps).

### Outcome: what the lane moved

`getLoopRunDetail` resolves each lane to its `before`/`after` scan pair and diffs them with the same
`diffScans`/`getScanComparison` the report's compare view uses — so a lane's "what moved" and the
repo's own comparison page can never tell two different stories about the same pair. `beforeScanId`
is captured at dispatch time using the *exact* ordering `scans-read` uses (`scannedAt`, then
`createdAt`, then `id`): `scannedAt` is not unique, and a bare desc sort would bracket the lane
against a different "latest" scan than the comparison view later reads. A lane with no recorded
`before` has nothing to diff against and reports `diff: null` rather than inventing a baseline.

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
⇄ `run` (active run) ⇄ `outcome` (a finished run or a history pick) · the run-history strip. One
primary CTA at a time: **Run (N repos)** / **Stop after in-flight** / **Replay run**.

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

### The outcome ledger (per-dimension delta + attribution)

When the run settles, the rail switches to `CockpitOutcome`: totals (lift, repos improved / flat /
regressed) and a hairline ledger per repo — before → after overall (`fmtDelta`), dimensions moved
(`DIMENSION_SHORT` + delta in `deltaHex`), closed gaps, the `diffScans` attribution one-liners,
follow-ups closed by the `Ascent-Resolves` trailer, commits and branch. **Replay run** re-runs the
field drift. Drift ends come from the run's own detail, not a client snapshot: `driftFor` overlays
each lane's `outcome.before` / `outcome.after` scan onto the seed set and lays out both sides, so a
history pick drifts a run you never watched and the picture cannot disagree with the ledger; a run
with no measured pair disables Replay. `router.refresh()` fires on settle to re-seed the server
render.

### Run history

`CockpitHistory` lists the last 20 runs (age, repo count, lift, phase); selecting one fetches its
detail and shows the outcome rail for it.

### Setup states (`CockpitSetup`)

`hosted` (field still rendered read-only; explains loops run where the code is, links to self-hosting
via `NEXT_PUBLIC_SOURCE_REPO_URL` or `docs/SETUP.md`) · `no-repos` (→ repositories tab) · `not-owner`
· `autopilot-off` (shows the route's 409 fix) · `unpaired` (three steps: pair a checkout via
`?tab=pairing` → pick repos → run).

Tests: `cockpit/laneStages.test.ts`, `cockpitDimensions.test.ts`, `cockpitDrift.test.ts`,
`useLoopRun.dom.test.tsx`, `CockpitOutcome.dom.test.tsx`, `LiveTabView.dom.test.tsx` (wall mode and
the kiosk render no cockpit), `observatory/*.test.ts(x)`.

## Key files

| Concern | File |
| --- | --- |
| Store (barrel) | `src/lib/db/loop-runs.ts` → `-types.ts` / `-read.ts` / `-write.ts` |
| Tenancy re-check | `src/lib/db/loop-tenancy.ts` |
| Driver | `src/lib/local/loop-engine.ts` |
| One lane | `src/lib/local/loop-lane.ts` |
| Worktree isolation | `src/lib/local/loop-worktree.ts` |
| Single-repo shim | `src/lib/local/autopilot.ts` |
| Routes | `src/app/api/org/loop/{route,propose/route,[id]/route}.ts` |
| SSE sub-stage fold | `src/lib/scan-stage.ts` |
| Tab + wall | `src/features/inflight/live/**` |
| Cockpit | `src/features/inflight/live/cockpit/**` |
| Observatory | `src/features/inflight/live/observatory/**` |
| Schema | `prisma/schema.prisma`, `prisma/migrations/20260822120000_add_loop_run`, `prisma/init.sql` |

Tests: `loop-runs.test.ts` (row→record parsing, log bound), `loop-engine.test.ts` (happy path,
failure isolation, per-lane early stop, bounded parallelism, stop, the gates),
`autopilot.equivalence.test.ts` (the shim's shipped job contract and branch prefix),
`scan-stage.test.ts` + `route.stages.test.ts` (the sub-stage contract).

## Known gaps

- **No hosted dispatch.** The loop is self-hosted only: it reads the server's filesystem and spawns
  processes. Cloud orgs get an empty state on the cockpit and a 404 from every loop route. A hosted
  path would need a sandboxed executor and a very different consent model.
- **No boot-time stale-run sweep.** `markStaleRunsStopped` runs on the first `GET /api/org/loop` and
  inside `startLoopRun`, not from an instrumentation hook. A crashed run therefore reads as `running`
  in the database until someone opens the tab. Nothing acts on that row in the meantime, but a direct
  DB reader (or a future digest) would see a lie.
- **`curating` is reserved, unused.** The phase exists on the model for a run parked while a human
  edits its batches, but curation is currently a pure read (`/propose`) and `start` writes `running`
  directly. No row is ever written in `curating` today.
- **Retry builds a fresh worktree and branch.** Deliberate (the original worktree is gone by then),
  but it means a retried lane's commits land on a different branch from its siblings' — two branches
  to review for one repo.
- **The agent model rides `CLAUDE_MODEL`** (default `sonnet`); no per-run model picker.
