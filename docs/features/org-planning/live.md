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
  │          │         └─ N lanes, bounded parallelism. Each lane is one of three KINDS:
  │          │            backlog → worktree → local `claude -p` → rescan
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
| `phase` | `curating \| running \| done \| stopped \| error`. `start` writes `running` directly. |
| `reposJson` | The run's selected set, TEXT not `jsonb` (the schema's DSQL contract). **Two encodings, both read forever** (`parseTargets`): the original JSON `string[]` of `owner/name`, and the widened `[{repo, kind, practiceId}]` that carries each repo's armed [lane kind](#lane-kinds-foundation-and-practice-lanes-2026-08-28). A legacy row parses as all-`backlog`, which is what those runs were. Widened rather than given a column deliberately — see that section. |
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

It runs at **three** moments: at **boot**, from `register()` in `src/instrumentation.ts` via
`sweepInterruptedWork()` (so a crashed run stops reading as `running`, and its lanes' backlog claims
are released, whether or not anybody opens the tab); on `GET /api/org/loop` (so the cockpit never
renders a job nobody is driving); and inside `startLoopRun`, *before* the one-run-per-org check —
otherwise a single crash would bar the org from ever starting another run.

The `isLive(id)` predicate is what separates the three. The two request-path callers pass
`isLoopRunLive`, because without it a poll during a run stops the run it is rendering (2026-08-26).
The boot sweep passes nothing, and that default — "nothing is live" — is true there and only there.

### Outcome: what the lane moved

`getLoopRunDetail` resolves each lane to its `before`/`after` scan pair and diffs them with the same
`diffScans`/`getScanComparison` the report's compare view uses — so a lane's "what moved" and the
repo's own comparison page can never tell two different stories about the same pair. `beforeScanId`
is captured at dispatch time using the *exact* ordering `scans-read` uses (`scannedAt`, then
`createdAt`, then `id`): `scannedAt` is not unique, and a bare desc sort would bracket the lane
against a different "latest" scan than the comparison view later reads. A lane with no recorded
`before` has nothing to diff against and reports `diff: null` rather than inventing a baseline.

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

`SCORE_NOISE_BAND` is **2**, from that UAT measurement, and the band is **exclusive** — a movement of
exactly 2 is noise. The rule is **symmetric**: a small regression is refused on the same grounds,
because reporting one would be the same error with the sign flipped and would have the loop chasing
noise it created. It is also applied per *dimension* in `decideInProgress`, where the band is
conservative (the per-dimension `LLM_GUARDBAND` is 6, doubled on a widened dim); tightening that
needs a per-dimension measurement, not a guessed constant.

Two consequences worth stating plainly:

- **The run's headline lift sums only the attributable lanes.** A run that moved four repos by one
  point each reads `—`, not `+4`. `runAttribution` returns the excluded counts beside the number, so
  "no lift, three noise lanes" and "no lift, three mock lanes" stay distinguishable — they call for
  opposite next moves.
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

### The outcome ledger (per-dimension delta + attribution)

When the run settles, the rail switches to `CockpitOutcome`: totals (**attributable** lift, repos
improved / flat / regressed, and what was excluded) and a hairline ledger per repo — before → after
overall (`fmtDelta`), dimensions moved (`DIMENSION_SHORT` + delta in `deltaHex`), closed gaps, the
`diffScans` attribution one-liners, follow-ups closed by the `Ascent-Resolves` trailer, commits and
branch, plus the row's **engine and score-integrity** line.

A row prints a coloured delta only when [the attribution rule](#is-this-lift-real-the-attribution-rule)
allows it; otherwise the two numbers stay muted and the verdict sits where the delta would ("not
attributable: mock scan", "within noise (±2)"). Per-dimension deltas inherit the row's verdict — if
the pair cannot be attributed, colouring one dimension green would restate the claim the line above
just declined to make. The improved/flat/regressed tally counts attributable movements only, so it
can never contradict the headline it sits beside. The provenance line names the engine (and marks it
`(degraded)` when the model failed), then chips whatever `scoreIntegrity` recorded — `D9 renormalized
out`, `widened D1, D2`, `audit capped`, `blend 50%` — each carrying its explanation as a tooltip and
as sr-only text. **Replay run** re-runs the
field drift. Drift ends come from the run's own detail, not a client snapshot: `driftFor` overlays
each lane's `outcome.before` / `outcome.after` scan onto the seed set and lays out both sides, so a
history pick drifts a run you never watched and the picture cannot disagree with the ledger; a run
with no measured pair disables Replay. `router.refresh()` fires on settle to re-seed the server
render.

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

On termination a `DriveVerdict` banner sits **above** the ordinary outcome ledger — the two answer
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
change cannot reach a later cycle), `CockpitOutcome.dom.test.tsx` (the ledger shows it).

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
2. else the **highest-impact** open follow-up sits on a dimension the library has a starter for AND
   that starter's file is missing → `practice` for it;
3. else `backlog`, which stays the default and does everything else.

Only the *top* item is considered in (2). Letting any item in the batch pull the lane would make a
template drop the default answer rather than the shortest path to the biggest gap. The cap and the
impact-first ordering of `openBatch` are untouched.

**One rule, two callers.** `/propose` renders it and the engine re-runs it at arm time — the same
identity argument as `openBatch`. It is re-read rather than trusted from the wire, because the
operator may have installed the standard by hand between opening the panel and pressing Run.

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

Tests: `lane-kind.test.ts` (the rule, against real directories), `lane-install.test.ts` (real git
fixture: files written, one commit, the trailer, the skip policy, and the byte-identity case),
`loop-engine.test.ts` (install instead of agent, the kind on the row, cycle 2 back to backlog, a dry
install ending cleanly, a curated batch winning), `propose/route.test.ts` (the wiring),
`loop-runs.test.ts` (both `reposJson` encodings), `CockpitLaneKind.dom.test.tsx` (both tags).

### Run history

`CockpitHistory` lists the last 20 runs (age, repo count, lift, phase, and the agent configuration the
lift was produced under); selecting one fetches its detail and shows the outcome rail for it.

### Setup states (`CockpitSetup`)

`hosted` (field still rendered read-only; explains loops run where the code is, links to self-hosting
via `NEXT_PUBLIC_SOURCE_REPO_URL` or `docs/SETUP.md`) · `no-repos` (→ repositories tab) · `not-owner`
· `autopilot-off` (shows the route's 409 fix) · `unpaired` (three steps: pair a checkout via
`?tab=pairing` → pick repos → run).

Tests: `cockpit/laneStages.test.ts`, `cockpitDimensions.test.ts`, `cockpitDrift.test.ts`,
`cockpitGate.test.ts` (one gate, two callers), `driveModel.test.ts` (the on-screen arithmetic and
the three verdicts), `useLoopRun.dom.test.tsx`, `useDrive.dom.test.tsx` (gating + poll discipline +
settle-once), `CockpitOutcome.dom.test.tsx`, `CockpitDrivePanel.dom.test.tsx` (the control's
states), `LiveTabView.dom.test.tsx` (wall mode and the kiosk render no cockpit),
`observatory/*.test.ts(x)`.

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

**Folding is not a lift** (`attributeDimension`, `src/lib/maturity/attribution.ts`). A dimension whose
fold credit *differs* between the two ends of a pair moved because one scan could see GitHub and the
other could not, so it reports `unmeasured` and the ledger renders it muted. Carrying the fold forward
is what makes the ordinary pair comparable again — the same points land on both ends, and the residue
is real work, still reported as a lift. The refusal is per **dimension**, not per pair: the fold moves
three of nine, and refusing the whole pair would throw away six dimensions of honest measurement to
protect three.

The same carry runs on `POST /api/org/local/rescan`, so a manual local rescan cannot silently retire
the fold from a repo's latest reading either.

Tests: `platform-carry.test.ts` (fresh / stale / absent, and the round-trip), `green.test.ts`
(exclusion, and that it is not a blanket pass), `attribution.test.ts` (folding is not a lift).

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

## Known gaps

- **No hosted dispatch.** The loop is self-hosted only: it reads the server's filesystem and spawns
  processes. Cloud orgs get an empty state on the cockpit and a 404 from every loop route. A hosted
  path would need a sandboxed executor and a very different consent model.
- **`curating` is reserved, unused.** The phase exists on the model for a run parked while a human
  edits its batches, but curation is currently a pure read (`/propose`) and `start` writes `running`
  directly. No row is ever written in `curating` today.
- **Retry builds a fresh worktree and branch.** Deliberate (the original worktree is gone by then),
  but it means a retried lane's commits land on a different branch from its siblings' — two branches
  to review for one repo.
- **The agent's `--effort` flag is passed only when a level is chosen.** A `claude` build that does
  not know the flag is therefore unaffected, but there is also no probe: if a build rejects it, the
  session fails with the CLI's own message rather than falling back to no-effort.
