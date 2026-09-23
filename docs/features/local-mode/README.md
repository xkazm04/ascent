# Local mode (self-hosted)

_Status: **implemented** (2026-08-19, three phases in one wave): repo↔folder pairing, scan-from-disk
ingestion with instant follow-up close, and the war-room autopilot. Pairing, local rescan, drive, and
the local-spawn writes exist only on a **self-hosted** deployment (`selfHosted()`, `src/lib/env.ts`)
— those routes answer 404 on managed cloud, and the rail hides the Pairing tab there. The autopilot
status read (`GET /api/org/local/autopilot`) is the exception: it is served on cloud the same way
`GET /api/org/loop` is, with `enabled: false`._

The premise: a self-hosted Ascent runs on the same machine as the code it scores, so the scan loop
does not have to lead against GitHub. A paired repo scans from disk; an `Ascent-Resolves:` trailer
closes its follow-up the moment it is **committed, before any push**; and the war room can dispatch a
local coding agent at the backlog and verify its work in the same breath. (A trailer is a **claim**;
what closes the row is the rescan agreeing — see
[the loop's claim-vs-verdict rule](../org-planning/live.md#the-claim-and-the-verdict-are-two-different-numbers).)

## The declared org (`ASCENT_LOCAL_ORG`, 2026-08-26)

Ascent's tenancy is org-shaped — a `Repository` hangs off an `Organization`, every gate is
`(role × slug)`, and both pairing routes take an `org`. That is right for a GitHub organization
fleet and wrong for the case local mode actually serves: **an operator whose projects are public
repos on their personal account**, which has no GitHub organization behind it. There is nothing to
import and no installation to key off, so the routes worked but the operator had no legal value to
pass them.

So local mode may **declare** one. `ASCENT_LOCAL_ORG` names a slug that exists because the operator
said so (`1`/`true` → the default slug `local`; any other value is used as the slug;
`ASCENT_LOCAL_ORG_NAME` sets the display name). The row is created on demand by `ensureLocalOrg()`
(`src/lib/local/org.ts`), so flipping the flag on a running server takes effect at the next request.

**`kind` stays `"org"`, deliberately.** `kind: "personal"` is not "an org for one person" — per
`schema.prisma` it means the org holds watch-*pointer* rows only and a public repo's scan series
stays in the shared `public` org, because a personal dashboard is a *lens* over that corpus. This
org is the opposite: it owns its repos and its scans, it is the scope a loop runs over, and its
dimension scores must be its own. Marking it personal would route every scan into the public corpus
and leave the org rendering a lens over data it does not control.

## Project mapping, headless (`/api/org/local/projects`, 2026-08-26)

The two primitives (`/api/org/local/repo`, `/api/org/local/pairing`) both work and both are
POST-only, so nothing could **read** the current mapping back, and adding a project took two round
trips that could half-succeed — in scope, unpaired — with no way to observe which state you were in.
An agent asked to keep a fleet green has to be able to ask *"what is mapped right now?"* before it
can decide anything.

| | |
| --- | --- |
| `GET ?org=<slug>` | the org and every project with its pairing state |
| `POST { projects: [{ url, path? }] }` | add to scope, and pair when a path is given |
| `POST { url, path? }` | the single-project shorthand |
| `DELETE { fullName, drop?: true }` | unpair; `drop` also leaves scan scope |

The `GET` also carries **greenness** (`src/lib/maturity/green.ts`): the target band, each in-scope
repo's per-dimension gaps and point debt, the dimensions that reading could not measure at all
(`repos[].unmeasurable` — see the platform fold below), and whether the fleet as a whole has arrived. It rides the
same read on purpose — "what is mapped" and "where does it stand" are one question for anything
driving a loop, and asking them separately invites acting on a scope that has moved since the
standing was measured. Scope is what is **watched**: an unwatched row still appears (it keeps its
history and its pairing state is worth seeing) but cannot hold the fleet back from green.

Same guards as the routes it composes, outermost first: self-host 404 → the local-org flag → DB →
**owner**. An explicit `org` is accepted only when it *is* the declared one, so this door can never
be pointed at a real tenant (403).

**Partial success is reported, never swallowed.** Scope lands first and unconditionally; a path that
fails verification leaves the project **in scope and unpaired** with the verifier's own sentence
attached, and the batch answers **207**. Rolling back the scope write would discard a good half over
a fixable typo; a bare `ok: false` would hide which half survived. `DELETE` unpairs but does not
delete scan history — that history is the org's record of what it learned, and a mapping call must
not be able to erase it.

## Pairing (Admin → Pairing)

- `Repository.localPath` (nullable; cloud never writes it) maps a fleet repo to an absolute path on
  the **server's** filesystem. Under Docker that is an in-container path — mount your code.
- Verification (`src/lib/local/pairing.ts`) is cheapest-first and one-failure-at-a-time: absolute
  path → exists → `git rev-parse --is-inside-work-tree` (accepts worktree/submodule layouts, rejects
  bare) → has commits. **Origin match is a warning, never a block** — a local-only repo or renamed
  mirror is still honestly scannable.
- All git goes through `src/lib/local/git.ts`: `execFile` (never a shell — paths are operator
  strings), per-call timeout + output cap, `GIT_TERMINAL_PROMPT=0`.
- Routes (`/api/org/local/pairing`, `/api/org/local/repo`) are **owner**-gated with the role check
  before any filesystem probe (no "does folder X exist?" oracle), and 404 on managed cloud
  (`selfHostGuard`, `src/lib/api/self-host.ts`). Adding a public repo to scope reuses `setRepoWatch`.
- Tab id `pairing` lives in the Admin group of the catalog (and in `MIGRATED_ORG_TAB_IDS` — it was
  born as a `?tab=` panel and has no legacy route). Rail visibility keys on **`selfHostedExplicit()`**
  (`ASCENT_SELF_HOSTED=1` set by the operator), NOT on the implicit no-billing `selfHosted()` default:
  a dev deployment that merely lacks a Polar token must not grow a server-filesystem control in its
  Admin group. Feature behavior (gates, routes, the tab's own guard) stays on `selfHosted()`, so a
  deliberate deep link on an implicit self-host still works. A cloud deep link gets an explanation,
  not a 404.

## The registry, paired locally (2026-09-16)

Pairing's **first** step is the org's REGISTRY, not a fleet repo, and it needs no GitHub App — which is
the point: a self-hosted install usually has none, and until this every registry read went through an
installation token, so Skills / Practices / Memory / Knowledge sat behind a wall the operator could not
open. The checkout is normally the same one the operator edits and links skills from, so reading GitHub
would also mean lagging them by a push.

- `OrgRegistry.localPath` (nullable, migration `20260916120000_add_registry_local_path`) is the pairing.
  `localRegistryDir(row)` returns it only when `selfHosted()`, so the column is inert on cloud.
- `POST /api/org/:slug/registry/local` — **owner**-gated, 404 off self-host, path from the body (or, with
  none, `registry.local` in the app's own `.ai/manifest.yaml`). `{ verifyOnly: true }` checks,
  `{ path: null }` unpairs, re-pairing the same path IS the local re-index. Verification adds one rule to
  `verifyLocalPath`'s: at least one registry lane (`skills/ practices/ memory/ knowledge/`) at HEAD.
- `localSource(dir)` (`src/lib/registry/local-source.ts`) is a `RegistrySource` over `git ls-tree` /
  `git cat-file` at the **committed** tree of the checkout's branch — an uncommitted edit in a sibling
  session is not indexed as if it had been adopted, the same "merging is adopting" rule the hosted path
  keeps.
- **Local first, everywhere a registry is read.** `resolveRegistrySource` (`src/lib/registry/api.ts`)
  returns `{ kind: "local", dir }` for a paired registry and mints nothing; only an unpaired one falls
  through to `guardRegistryWrite`. Index, skill trace (`git log` over the skill's path) and the fleet
  conformance sweep all take it, and a local dispatch ends at a committed branch in the paired checkout
  instead of a pull request.
- The fleet sweep reads each repo's PAIRED WORKING TREE (`conformance-read-local.ts`) — deliberately not
  HEAD, because `.ai/consults.jsonl` is gitignored in consuming repos. `mapSha` is git's own blob id, so
  a repo swept locally and later through GitHub does not re-ingest an unchanged map. An **unpaired** repo
  is skipped and counted in one warning; its standing verdicts are never cleared.
- **No webhook, so a render is the trigger.** `refreshLocalRegistryIfStale` (called from
  `getRegistryView` and `getRegistrySync`) compares the checkout's HEAD to `lastIndexSha` and starts one
  background pass when they differ — one in flight per registry, at most one probe per 30s.
- GitHub becomes the optional second step (`RegistryGithubStep`): pull requests (scaffold, migration,
  dispatch, signals) and a registry that is not on this machine. Measured 2026-09-16 on org `kiro` with
  no App configured at all: pair + index 8s (33 skills, 8 practices, 6 notes, 219 lessons, 9 bundles),
  fleet sweep 462 pairs from paired checkouts.

## Scan from disk (`src/lib/local/source.ts`)

`LocalFsSource` implements the same `RepoSource` seam as `GitHubPublicSource`, so everything
downstream — analyzers, scoring, persistence, the trailer close in `engine.ts` — is unchanged:

- Tree: `git ls-files -c -o --exclude-standard` (the repo's own ignore rules define "the repo").
- Commits: `git log` with NUL/RS separators — **local, unpushed commits included**, which is what
  makes the resolve→rescan loop immediate.
- Contents: read from disk under the SAME byte budgets as the GitHub source (drift here would move
  calibrated scores between ingestion paths).
- **Identity:** clean tree → HEAD's sha (permalinks + `(repoId, headSha)` dedup behave like a GitHub
  scan of that commit); dirty tree → **sha-less** (the `dedupKey` persist path) — never HEAD's sha
  over content that isn't HEAD.
- GitHub-side enrichments (PR stats, governance, security posture) are absent, like a token-less
  scan, and the report says so via `scopeCaveat` — a local scan can honestly score a few points
  apart from a cloud scan of the same commit.
- **The platform fold is carried, or its absence is declared (2026-08-28).** D2/D3/D4 are credited
  partly for tooling that is *installed rather than committed* (review/CI/coverage Apps posting check
  suites, default-branch Actions health), which no filesystem scan can see. Both local scan doors —
  `/api/org/local/rescan` and the loop's own rescan — replay the last scan that DID observe it
  (`src/lib/analyze/platform-carry.ts`), stamping every borrowed evidence line with
  `platform signals from scan <id>, <age>` and marking it `stale` past 14 days. When there is nothing
  to replay the scan records `unavailable`, and those three dimensions are **excluded from the green
  verdict** rather than scored at a floor the repository cannot raise. Full rationale, and why
  "folding is not a lift", in [org-planning/live.md](../org-planning/live.md#platform-signals-carried-into-a-worktree-rescan).

`POST /api/org/local/rescan { org, fullName }` runs one paired repo end-to-end (member-gated — a
scan reads, only pairing decides what may be read). No credit ceremony: behind `selfHostGuard`,
`isMeteredScan()` is false by construction. The Follow-ups ledger shows a **"Rescan N paired repos
locally"** button (`LocalRescanButton`) that runs them sequentially and reports how many rows the
rescan closed.

## Autopilot (`?tab=live`, self-hosted + paired + `ASCENT_AUTOPILOT=1`)

`npm run doctor` reports whether this machine meets the prerequisites (the flag, a `claude`
CLI on PATH, and `cliProviderAllowed()` — i.e. non-production or self-hosted) as its
"Autopilot" row, alongside the rest of the env → capability matrix.

**Since 2026-08-22 the autopilot is a thin SHIM** (`src/lib/local/autopilot.ts`) over the durable
**loop engine** — the same mechanics with the arity widened to a selected *set* of repos worked as
bounded-parallel lanes, and the state moved out of a process `Map` into `LoopRun`/`LoopRunLane`.
`startAutopilot` arms a one-repo, one-lane run and projects it back into the `AutopilotJob` shape
`/api/org/local/autopilot` has always answered with; the accessors are `async` now (the one signature
change) because the truth lives in the database. Two things are preserved deliberately: the job shape
is byte-for-byte the same, and the branch stays `ascent/autopilot-<stamp>` rather than the engine's
`ascent/loop-<stamp>-<repo>`, so an operator's "review the autopilot branch" habit does not break
because the plumbing moved. Full engine, model, API and gate documentation:
[org-planning/live.md](../org-planning/live.md).

The dispatch loop itself (now `src/lib/local/loop-lane.ts`): per cycle, pick the repo's top open
follow-ups (batch of 5, biggest projected gain first) → mark them in-progress (the ledger's hand-off
claim — `scans-persist` only resolves claimed rows) → spawn one headless `claude -p` session in an
**isolated worktree** with the batch's fix prompt (`buildFixPrompt` + autopilot context) → count the
commits → rescan the worktree from disk → repeat while progress lands, up to `maxCycles` (≤5).

**Not every lane spends an agent session (2026-08-28).** A lane has a **kind**, decided per repo at
arm time from the paired working copy (`src/lib/local/lane-kind.ts`): a repo with no `.ai/` standard
gets a `foundation` lane, one whose biggest open gap has a Practice Library starter it is missing gets
a `practice` lane, and everything else gets the agent lane above. The first two are deterministic file
writes + a commit — using the *same generators* the cloud draft-PR doors use — followed by the
identical rescan and attribution. This is what makes UC1's "scan → gaps → apply practice / `.ai/`
foundation → rescan" a single local loop instead of a detour through a GitHub-App PR door. It is
**local mode only**: the rule reads a filesystem, so cloud orgs keep the draft-PR path unchanged.
Full rule, execution and parity notes:
[org-planning/live.md § Lane kinds](../org-planning/live.md#lane-kinds-foundation-and-practice-lanes-2026-08-28).

Guardrails, each load-bearing:

- **Worktree isolation**: `git worktree add -b ascent/autopilot-<stamp> <tmp> HEAD` — the operator's
  checkout, branch and uncommitted work are never touched. The **branch is the deliverable** (review
  and merge it); the temp worktree dir is removed after the run.
- **Never pushes.** The loop proposes; the human merges.
- **Consent**: `ASCENT_AUTOPILOT=1` is checked in the agent runner AND the route (a disabled
  deployment gets an honest 409 naming the fix). The session runs `--permission-mode acceptEdits` —
  not `--dangerously-skip-permissions` — with a 20-min default ceiling
  (`ASCENT_AUTOPILOT_TIMEOUT_MS`).
- **Model and effort were per RUN** (2026-08-28; the model half is superseded by
  [arms](../org-planning/live.md#arms-transport--model-and-the-n-arm-comparison-2026-09-21) as of
  2026-09-21, the effort half is unchanged), picked in the cockpit and resolved at arm time
  against `CLAUDE_MODEL` / **`ASCENT_AGENT_EFFORT`** — deliberately not `CLAUDE_EFFORT`, which the
  Claude Code harness sets in the environment it hands child processes, so a self-hosted Ascent
  launched from inside a session would have inherited an effort nobody chose. The resolved pair is
  stored on the run (and on the drive, which hands it to every run it dispatches) and printed beside
  the lift, because two lifts from two setups are not comparable. `--effort` is appended only when a
  level was chosen. Details:
  [org-planning/live.md](../org-planning/live.md#per-run-model-and-effort-2026-08-28-superseded-by-arms-2026-09-21).
- **A stop reaches the process, not just the lane** (2026-09-04, `src/lib/local/kill-tree.ts`). The
  session is spawned through a shell (`claude.cmd` on Windows needs it), so `child.kill()` signals the
  shell and the real `claude` process — a grandchild — survives it; measured on this host, it did.
  Stopping a run (or hitting the lane's deadline) now aborts the watchdog's `AbortSignal`, and the
  runner kills the process **tree**: `taskkill /PID <pid> /T /F` on win32, a `SIGTERM`-then-`SIGKILL`
  to the negative (process-group) pid on POSIX, where the child is spawned `detached`. The lane's own
  error line then reports what the kill achieved — `agent process terminated (pid N)`, or `agent
  process termination unconfirmed`, which means a session **may still be running on the host** and is
  never rounded up to success. The kill is an addition to the watchdog, not a replacement: settling
  the wait is still what frees the lane.
- **No-progress stop**: a cycle with zero commits and zero closed rows ends the run early (applied
  per lane by the engine, so in a multi-repo run one stalled repo no longer ends the pass).
- **One run per org**, enforced against the database, not a process `Map`. Phase, branch, log and
  outcome ids are durable; a `running` row left behind by a restart is reconciled to `stopped`
  (`markStaleRunsStopped`, on the band's GET the same way `GET /api/org/loop` does it) rather than
  being trusted or resumed.

UI: `AutopilotBand` (+ `AutopilotBandParts`) in `src/features/inflight/live/` — picker, cycle
count, start/stop, live log; polls the job every 4s only while one runs, and refreshes the wall once
per finished run. Routes: `GET/POST /api/org/local/autopilot`. GET is member-gated and served on
managed cloud (`{ enabled: false, job }`, `job` null unless a remote single-repo run exists) so a
cloud org is not 404'd out of its own rows. POST start/stop stay owner-gated and self-hosted — same
blast radius as pairing; a start without `ASCENT_AUTOPILOT=1` is an honest 409, never a local spawn
on cloud.

## Drive to green (`/api/org/local/drive`, 2026-08-26; reachable from the cockpit 2026-08-28)

| | |
| --- | --- |
| `POST { org, action:"start", repos?, maxRuns?, maxCycles?, concurrency?, model?, effort?, delivery?, dials?, mode?, spendCeilingUsd? }` | start a drive over the watched, paired repos (or the given ones) — `202 { drive }`. `dials` (batch size, session ceiling, guard, verify timeout, rescan cadence, model policy, `arms` / `armPolicy`, `planMode`) now reach every run the drive dispatches; before 2026-09-18 they were dropped. They are parsed by the same function as `POST /api/org/loop`'s flat body (`src/lib/local/run-spec.ts`), so an input gets one verdict at either door; a split arm implies `planMode: "on"`, and a top-level `arms` / `armPolicy` / `planMode` is a 400 saying they belong in `dials` (2026-09-23). `mode: "continuous"` arms the standing runner (below) |
| `POST { org, action:"stop", id }` | cooperative stop: the current run finishes its phase, then the drive ends |
| `GET ?org=<slug>` | every drive for the org with its phase, per-run debt before/after, and the latest measurement |

Same guards as `/api/org/loop`: self-host 404, DB, `PUBLIC_ORG` 403, **owner**, and 409 when
`ASCENT_AUTOPILOT` is off. A drive stops on `green`, `dry` (a run did not lower the debt) or
`ceiling`; the policy and its reasoning are in `docs/features/org-planning/live.md`.

The three verbs are also what the Loop Cockpit drives: the **Drive to green** CTA in the inspector
starts one over the selection, `CockpitDrivePanel` renders its progress and Stop, and a terminal
verdict lands above the run's outcome ledger. The gate is not widened for it — the cockpit's
`cockpitGate.ts` is one predicate serving both Run and Drive. It remains fully usable headlessly:
`useDrive` adopts a drive started by curl on its next mount tick.

## The standing runner (`mode: "continuous"`, 2026-09-18)

| | |
| --- | --- |
| `POST { org, action:"start", mode:"continuous", repos?, maxCycles?, concurrency?, model?, effort?, spendCeilingUsd?, dials? }` | arm the standing runner. It has no run cap, never stops on green or dry, and pauses on breakers. `202 { drive }` |
| `POST { org, action:"resume-repo", repo }` | lift one repo's pause (`repo-failures`, `branch-conflict`, `dry-backoff`) on the live runner |
| `POST { org, action:"stop", id }` | stop it. A waiting runner notices within a minute |
| `POST /api/org/local/runner/merge { org, repo }` | merge `ascent/runner` into the repo's base: `fast-forward` (base not checked out), `merged` (checked out and clean), or `commands` (diverged or dirty, nothing touched) |

The runner accumulates verified work on each paired repo's `ascent/runner` branch, which is never
checked out. It merges the base in before every run (a merge, never a rebase), and it never touches
your working branch. Merging the runner branch is yours to do, through the merge route or the commands
it returns (the merge route works with the loop switched off). A restart re-attaches a live runner on
its same row, but only while `ASCENT_AUTOPILOT` is on. The daily spend ceiling defaults to $100
(`spendCeilingUsd`; `0`/`null` = none; stored as BIGINT micro-cents); the session-limit breaker is
always on. The runner forces `delivery: "runner"` and the guard on — the route refuses a continuous
drive with another delivery or `verifyMode: "off"`. The details are in *The standing runner* in
`docs/features/org-planning/live.md`.

**A broken pairing pauses every repo it names (2026-09-23).** `startLoopRun` checks every repo's
pairing before it arms anything and refuses once, naming each unpaired or broken repo with its
reason (it used to stop at the first). A runner step whose start is refused that way pauses **every**
repo the refusal names (`repo-failures`, resumable per repo) and keeps working the rest. The refusal
text and the runner's reading of it (`pairingRefusal` / `reposNamedIn`) live together in
`src/lib/local/pairing-health.ts`, so the two cannot drift.

## Proving it end to end

`e2e/loop/cockpit-loop.spec.ts` (`npm run test:e2e:loop`) drives this whole page against a live
server: its own `next dev`, its own throwaway PGlite dir, its own declared `ASCENT_LOCAL_ORG`, and a
**real git repository** it creates in the OS temp dir — mapped and paired through
`/api/org/local/projects`, scanned from disk, then improved by a real foundation lane in a real
worktree and rescanned. Nothing it does can reach the operator's own `.pglite` data or their org.
It runs no agent session (the fixture has no `.ai/` standard, so the lane is a deterministic install,
and cycles are pinned to 1), and because its engine is the mock it asserts the ledger's **refusal** to
call the movement a lift. The Character-level journey is `uat/journeys/loop-to-l5.md`; its L2 half —
a real agent lane, an attributable lift, a killed-and-resumed drive — has **not** been run.

## The `.ascent/lane-report.json` contract (2026-08-30)

Every backlog lane's prompt now ends with a report contract, and the agent is asked to write one file
into its worktree before it exits:

```json
{ "v": 1,
  "items": [{ "recommendationId": "<id>", "verdict": "resolved|skipped|needs_human", "reason": "<one sentence>", "files": ["<path>"] }],
  "lessons": ["<one durable thing this repository taught you>"] }
```

- **`"v": 1` is deliberate.** This is the same shape a remote agent will POST when the agent-neutral
  work protocol lands, so that lane extends the contract rather than forking a second one.
- **Skips are asked for as first-class answers.** A skip with a reason stops the item being
  re-dispatched next cycle; an unexplained attempt does not. The verdict is the agent's *account*, not
  the ruling — a row still closes only when the rescan stops raising the gap and the dimension moved.
- **The report is excluded from ordinary staging.** Its pattern is added to the effective
  `info/exclude` path resolved by Git (shared by linked worktrees), not to a
  `.gitignore` (which would itself be a change to the repository, landing in every branch the lane
  produces). The contract also tells the session not to commit it; the exclude is the second belt.
- **The parser never throws.** No file, `"{"`, a megabyte blob, an id outside the dispatched batch —
  each degrades to `parsed: false` or a dropped entry. A missing report is recorded as *unknown*, which
  is not the same fact as "nothing was skipped".

## What a session costs (2026-08-30)

The whole `claude -p --output-format json` envelope is now parsed, not just its `.result`: cost,
input/output/cache-read tokens, turns, wall time, session id and model land on the lane row the moment
the session returns — before the commit, before the rescan, so a lane that dies later still carries
what it spent, and a *failed* session keeps its cost.

**One declared source per lane, always.** `costSource` is stamped `"envelope"` — the CLI's own
`total_cost_usd` for that session — and nothing is ever added to it. The `AgentSession` rows an OTLP
exporter writes are Claude Code sessions a **developer** ran: a different population by a different
path, and summing the two would double-count the same tokens behind a better-looking figure. The
lane's `agentSessionId` exists so the two can be joined for inspection, never added.

Costs are stored in **micro-cents** so a sub-cent session is not rounded away, and every field is
`null` when the CLI reported nothing — never `0`, which would be averaged downstream as a free
session. The lane log says `cost unknown` in that case, and the cockpit does the same.

## The transport registry (`src/lib/local/transport`, 2026-09-21)

Until this, the loop had exactly one thing to spawn — one headless `claude -p` session — so a squeeze
on the Claude quota stopped the whole theater. That single door is now a **registry**:
`runAgentVia(transport, opts)` selects a transport profile, builds its argv and its spawn
environment, and spawns. Two transports ship: `claude` (the Claude Code CLI) and `pi`
(`@earendil-works/pi-coding-agent`).

**Nothing changes when nobody asks for a new transport.** `runAgentVia("claude", opts)` with no
endpoint is not "equivalent" to the old path — it *is* the old path: the same function body, the
same argument vector, the same stripped environment, the same sentences. The argv is pinned against a
literal array copied from `agent.ts` as it stood before the registry existed (`transport/run.test.ts`,
`transport/claude.test.ts`), because that is the regression every lane in the fleet would otherwise
discover on our behalf. The selection is an exhaustive `switch`, not a lookup table, so a third
transport is a compile error here rather than a runtime fallthrough onto `claude` — which would run a
lane on the wrong arm and record it under the right name.

Which transport a lane runs is a property of the run's **arm** — see
[Arms](../org-planning/live.md#arms-transport--model-and-the-n-arm-comparison-2026-09-21) for the arm
model, the per-lane columns, the void phase and the comparison contract. This section covers the
operator's side: the registry's dated capability matrix, the probe, and what a local arm needs
installed.

### The capability matrix is data, with a date and a method

`transport/profile.ts` holds one row per transport (`claude.ts` and `pi-profile.ts` supply them).
Each capability cell carries **the date it was checked, the tool version, how, and the exact
invocation that was smoked** — because the unit of verification is the whole invocation, not the
flag: a flag's acceptance is position-dependent in a tool that routes headless mode through a
subcommand. A cell nothing has confirmed reads `null` (unverified), never silently true.

The tools wrapped here ship weekly, rename binaries and change default models. An adapter that
hardcodes "this tool supports that flag" writes documentation that starts rotting at commit time,
with the rot arriving at runtime as an argument error that reads exactly like a model failure.

**Claude — every cell `live-run`, 2026-09-21, `claude` 2.1.278:**

| Capability | Value | How it was proven |
| --- | --- | --- |
| `streamJson` | `true` | the stream was **received**, not merely accepted: one JSON object per line (`system/init`, `assistant`, `result`). `--verbose` is required alongside `stream-json` under `-p` |
| `editStance` | `--permission-mode acceptEdits` | the `init` line reported `"permissionMode":"acceptEdits"` — the stance was *adopted*, a stronger claim than "the flag parsed" |
| `planStance` | `--permission-mode plan --allowedTools Read,Grep,Glob` | same proof, other stance. The allowlist is one argv token with no spaces, because `shell: true` re-parses argv on Windows |
| `resume` | `true` | proven as **continuity**: session A (`--session-id <uuid>`) was asked to reply `OK`; a second run with `--resume <that uuid>` was asked what word it had just replied with and answered `OK` under the same `session_id` |
| `promptOnStdin` | `true` | every invocation wrote the prompt to stdin and closed it — a lane brief contains flag-shaped text, so it never enters argv |

**Pi — every cell `live-run`, 2026-09-21, `pi` 0.86.1**, against Ollama 0.32.15 / qwen3.8:27b Q4_K_M
over the OpenAI-compatible route, in a scratch git repo:

| Capability | Value | How it was proven |
| --- | --- | --- |
| `streamJson` | `true` | the stream was received: `session` / `turn_start` / `message_start` / `message_update` / `tool_execution_*` / `message_end` / `turn_end` / `agent_end` / `agent_settled`, one JSON object per line. Pi's flag is `--mode json`, and unlike Claude it needs no `--verbose` |
| `editStance` | `-t read,bash,edit,write` | the session's own system message listed exactly those four tools, and the session then really read, edited, wrote and ran `ls -1` — four `tool_execution_end`s with `isError: false`, and the files changed on disk |
| `planStance` | `-t read` | the system message carried **only** `read`; the session answered from the file and `git status --porcelain` hashed identically before and after |
| `resume` | `true` | continuity again: session A wrote `ALPHA` into a file, session B resumed by id, was told to use no tools, and answered `ALPHA` |
| `promptOnStdin` | `true` | every invocation piped the prompt and closed stdin |

Every Claude smoke ran with the stripped environment (below), because a nested `claude` that inherits
the Claude Code markers produces nothing, silently — a smoke under the ambient environment would have
verified a process nobody will ever launch.

**Pi has no `--permission-mode`.** The tool allowlist *is* the stance, and it is passed explicitly
rather than relying on Pi's default of "all tools" — a default a later Pi could widen without this
repo noticing. Note also that Pi's `--session-id <uuid>` **creates** a session with that id while
`--session <uuid>` **resumes** one; Pi's `--resume` is an interactive picker that would hang a
headless session on a TUI.

**A recorded deviation, not an equivalence:** Claude plans with `Read,Grep,Glob`; Pi has no grep or
glob tool, so searching goes through `bash`, which is not read-only. `-t read` is strictly read-only
but a *weaker planning surface* than Claude's. If Pi plans measurably worse in a comparison, this is
the first confound to check — a tool-surface difference, not a model difference.

### Pi's envelope differs from Claude's in four ways that would each be a silent wrong number

1. **There is no `result` field and no terminal envelope object.** Claude ends with one
   `{"type":"result", result, total_cost_usd, num_turns, duration_ms, usage}` line carrying the whole
   session's accounting. Pi ends with `agent_end` + `agent_settled` and carries none of it; the answer
   is the **text blocks of the last assistant `message_end`**. An adapter looking for `.result` would
   report every successful Pi session as "exited without a JSON envelope".
2. **Pi exits 0 on a total failure.** Pointed at a dead endpoint it retried three times
   (`auto_retry_start` ×3), emitted assistant messages with `stopReason: "error"` and
   `errorMessage: "Connection error."`, closed with `auto_retry_end {"success": false}` — and exited
   0. `ok` is read from the stream, never from the exit code. The opposite shape also exists: an
   unknown provider exits **1** with an empty stdout and one sentence on stderr, which is why stderr
   is still parsed.
3. **The documented "cumulative" usage is not cumulative on this path.** Pi's `docs/json.md` calls the
   top-level `usage` on `message_update` "the latest cumulative provider-reported usage". Measured on
   openai-completions it is the *current message's own* usage: 1 715 in / 72 out on the first
   assistant message, then 1 807 / 60 on the second — not 3 522 / 132. Reading only the last value
   would throw a whole turn away, so `pi-normalize.ts` **sums the per-message usage from each
   assistant `message_end`** and ignores `message_update` usage entirely.
4. **Cost is not a number here.** Pi reports `cost: {input: 0, output: 0, total: 0}` — but that zero
   is the price list in `models.json`, a configured constant rather than a measurement. It is
   discarded: `costMicros` is **null** and the lane writes `costSource: "none"`. Tokens, turns and
   duration *are* recorded. Pi also reports no session duration at all, so `runPiAgent` measures the
   wall clock itself.

Fixtures: `src/lib/local/__fixtures__/pi-0.86.1-edit.jsonl` and `…-connect-error.jsonl` — two real
sessions, trimmed, paths scrubbed. The failure one exists because an envelope that documents a
success shape does not document its failure shape.

### The local endpoint is an env block on the spawn

A local Claude arm differs from a hosted one in its **environment and nothing else**: same binary,
same flags, different socket. That is what makes a bake-off a measurement of the *model* rather than
of two different invocations.

Always stripped, on every spawn, local or not (only ever extended, never weakened):
`ANTHROPIC_API_KEY`, `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`. The last two are the markers a Claude
Code session sets in the environment of everything it starts; a nested `claude` that inherits them
produces nothing, silently.

Added when — and only when — the arm carries an endpoint (`claudeSpawnEnv`):

| Variable | Value | Why it is load-bearing |
| --- | --- | --- |
| `ANTHROPIC_BASE_URL` | the endpoint root | where to talk |
| `ANTHROPIC_AUTH_TOKEN` | `endpoint.token ?? "ollama"` | local servers ignore the value but reject its absence, and that failure reads like a model failure |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` / `_HAIKU_MODEL` / `_OPUS_MODEL` | the endpoint's model | **all three**: Claude Code routes some background work to a Haiku id regardless of `--model`, and an unpinned one asks the local server for a model it has never heard of — surfacing mid-session as an error from a call the operator never made |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS` | the declared window | a client that does not recognise a model id assumes the largest profile it knows; declaring the real number is how the substitute stops being blamed for the client's assumption |
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` | `1` | beta headers a local server does not implement are answered with an error, not ignored |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `1` | no background calls to an endpoint that is not Anthropic's |
| `API_TIMEOUT_MS` | this session's own ceiling | left at its hosted default the client gives up on a merely-slow local answer, and the stop is then attributed to the wrong ceiling |

**It is an env block on the spawn, never a process-wide write.** The same server must be able to run
a Claude lane and a local lane in the same minute; a global would make "which endpoint did this lane
use?" a question about scheduling order. A test asserts the local keys never appear in `process.env`,
and `CLAUDE_LOCAL_ENV_KEYS` / `CLAUDE_STRIPPED_ENV_KEYS` are exported so no adapter can quietly grow
a tenth variable nobody researched.

**Pi resolves an endpoint differently**, because Pi takes neither a base URL on argv nor one in the
environment: an endpoint is a *provider entry* in `~/.pi/agent/models.json`. Ascent therefore never
writes the operator's file — `runPiAgent` generates a config directory per session, writes a
`models.json` naming the provider `ascent-local`, and points Pi's documented `PI_CODING_AGENT_DIR`
override at it, removing it on settle. Two lanes armed at two endpoints cannot fight over one file.
**With no endpoint armed, Pi uses the operator's own `~/.pi/agent/models.json`** — which is the path
in use today, since nothing in the lane wiring resolves a `LocalEndpoint` yet (see Known gaps).

## The preflight probe (2026-09-21)

Before a lane is armed with a transport, `probeTransport(transport, endpoint?)`
(`transport/probe.ts`) asks six questions and **refuses the arm on any miss**. It blocks rather than
warns because the two failures it was built for both produce a *result* rather than an error, so a
warning in an unattended overnight drive buys a confidently wrong verdict about a model — the most
expensive answer available here.

| Check | Evidence it reads | Refuses when |
| --- | --- | --- |
| `binary` | `<bin> --version`, spawned through the same door and environment a lane session uses | the binary does not answer |
| `auth` | `claude auth status` (hosted arm) or the endpoint's token (local arm) | not logged in / no token |
| `endpoint` | `GET /api/version` on the server root | the server does not answer |
| `model` | `GET /api/tags`, matched on the server's own model id | the model is not pulled |
| `context` | `GET /api/ps` — the **loaded** context of the resident model | below `MIN_CONTEXT_TOKENS` (65 536) |
| `server-version` | `GET /api/version` | below `MIN_SERVER_VERSION` (0.33.0) |

**Why `/api/ps` and not `/api/show`.** Both `/api/show` and `/api/tags` report a `context_length`,
and both report the model's *architectural maximum* — on the development machine `qwen2.5:7b` answers
32 768 there whatever the server is actually serving. `/api/ps` answers for the **loaded instance**,
which is the number the run is handed. When the model is not resident the probe makes it resident
with a **zero-token load call** — `POST /api/generate {"model": …}` with no prompt, which returns
`{"done_reason":"load"}` and generates nothing — then reads `/api/ps` again. If even that yields no
loaded context the check **fails**: a number that answers a different question is worse than no
number.

**Zero tokens.** Every step is a version print, an HTTP read, or the load call that generates
nothing. No completion request is made on any path, so `zeroToken` is `true` by construction and a
test asserts the argv list and the URL list to hold it there.

**The refusal is a sentence with a remedy.** `probeRefusal(result)` returns one sentence naming the
failed check, what was observed, what is required, and what to do — or `null`.

**Measured on the development machine, 2026-09-21: the probe REFUSED to arm.** That is the feature
working, not a defect. It refused twice:

> Refusing to arm the claude arm: its context check failed (observed 32768 tokens, required at least
> 65536 tokens). Restart the inference server with OLLAMA_CONTEXT_LENGTH=65536 (and unload the model
> so it reloads at that size) — at 32768 tokens the tool definitions are truncated and the model
> appears unable to call tools at all.

and on `server-version`, the machine running Ollama **0.32.15 < 0.33.0**: below that release the
client's "tokens left" countdown sits at the front of every prompt and invalidates the key-value
cache, so each turn re-prefills the whole context and the arm merely *looks* slow. A harness artifact
wearing the costume of a model verdict is refused rather than noted.

`serializeProbe` / `parseProbe` round-trip the result into the run's `probeJson`, so a result carries
what it ran under; a row that is not a probe reads back as `null`, never as a fabricated pass.

### The probe route

`POST /api/org/local/probe` → `{ probe, refusal }`. Body: `{ org, transport, endpoint? }`.
**Self-hosted only** (404 on managed cloud — a local transport is not a thing a hosted deployment
has), 403 for the public funnel org, **owner** thereafter: the same gate its neighbours under
`/api/org/local/` carry, because the probe spawns a subprocess with the deployment's own environment.
It arms nothing and writes nothing, and a failing probe is a **200 carrying the refusal sentence**,
not an error, so the cockpit can render the remedy.

Deliberately **not** gated on `ASCENT_AUTOPILOT`: the operator who has not enabled it yet is exactly
the one who needs to know whether the machine is ready.

## Setting up a local arm (operator)

`ASCENT_AUTOPILOT=1` is still the consent gate for any lane that spawns a local coding agent —
unchanged by transports. Beyond it, a local arm needs the inference server configured so that a model
failure is a model failure and not a harness artifact. Each line exists because of a specific failure
measured on the development machine on 2026-09-21:

| Setting | Why |
| --- | --- |
| a model serving **65 536** tokens | the server's default is 4096 under 24 GB of VRAM (32 768 at 24–48 GB), which truncates the tool definitions and makes the model look incapable of calling tools at all. This is what the probe's `context` check enforces (`MIN_CONTEXT_TOKENS`). `OLLAMA_CONTEXT_LENGTH=65536` is the documented lever; where the desktop app manages the server it may not reach it — see **Baking the context into the model** below |
| Ollama **≥ 0.33.0** | below it the client's token-countdown message sits at the front of every prompt and breaks the key-value cache every request, so each turn re-prefills the whole context and the arm merely looks slow (`MIN_SERVER_VERSION`) |
| `OLLAMA_KV_CACHE_TYPE=q8_0` | quantizes the KV cache so a 64k context fits alongside a 27B at Q4 on 24 GB |
| `OLLAMA_FLASH_ATTENTION=1` | same reason: it is what makes that context fit at all |

### Baking the context into the model (2026-09-21)

`OLLAMA_CONTEXT_LENGTH` is the documented lever and it is the first thing to try. On the development
machine it did **not** reach the server: the desktop app manages the server process and its own
settings store won that argument, so a user-scope variable and a full restart left the loaded context
at 32 768 while `OLLAMA_KV_CACHE_TYPE` and `OLLAMA_FLASH_ATTENTION` both took effect (VRAM dropped
2 GB). The fix that worked, and that is better anyway:

```
printf 'FROM qwen3.8:27b\nPARAMETER num_ctx 65536\n' > Modelfile
ollama create qwen3.8:27b-64k -f Modelfile
```

A model parameter beats the server default, and the window becomes a property of **the model an arm
names** rather than an invisible server variable — so a run records the context it actually got,
which is the same reason the model itself is never read from the environment.

Verify with `GET /api/ps`, which reports the *loaded* context. `/api/show` reports the model's
architectural maximum, which answers a different question and is why the probe refuses to accept it.

### The context ladder, measured — 64k costs 3.3× the throughput on 24 GB

The floor is 65 536 because harness vendors require it and because a truncated tool-definition block
reads as model incapacity. On a 24 GB card that floor is **not free**, and the cost is large enough
that it belongs beside the floor rather than in a footnote.

Measured 2026-09-21, RTX 4090 / 64 GB RAM, qwen3.8:27b Q4_K_M, `q8_0` KV cache, flash attention on.
Identical ~15.6k-token prompt, **unique per trial** (an identical prompt is served from the key/value
cache and reported prefill at 31 000 tok/s, which is not a measurement), arms **alternated** rather
than run in blocks, n=3 per arm for the two ends:

| Loaded context | Spilled to system RAM | Median generation |
| --- | --- | --- |
| 32 768 | 2.5 GB | **27.8 tok/s** |
| 40 960 | 4.0 GB | 14.5 tok/s (n=1) |
| 65 536 | 8.4 GB | **8.4 tok/s** |

The cliff is immediately after 32 768: the card cannot hold more KV cache, and every additional
gigabyte of spill is paid on every generated token.

**The floor was not lowered to make that number better, and the reasoning is the point.** A real lane
reads many files; the trivial four-turn smoke on this machine already accumulated 50 272 input tokens,
so a 32 768 window would overflow a genuine session — and an overflowed session fails in ways that
read as model incapacity, which is precisely what the floor exists to prevent. The honest statement is
therefore: **this hardware can run local lanes at roughly a third of its unconstrained speed**, and
that tradeoff *is* the delegation question rather than an obstacle to it. A card that can hold a 64k
KV cache resident would not pay it.

The earlier figures in this doc (11.5 tok/s at 64k, 545 tok/s prefill, 22.4 GB resident) came from a
single f16-KV trial before the q8_0 cache and the alternating method; the table above supersedes them.
The per-transport timing bands derived from any of these are **chosen**, not measured — see
[per-arm timing](../org-planning/live.md#arms-transport--model-and-the-n-arm-comparison-2026-09-21).

**A first observed consequence, and its correction (2026-09-22)**: a local execute lane reported
`agent-quiet` while legitimately working (observed on the first real split-arm lane, 2026-09-21). This
was first read as the local band's 5-minute quiet window being chosen too low. It was not: the lane
phase never read the band at all and applied the 90 s build default (`PHASE_QUIET_MS`) to every arm.
The pulse fold now passes the executing arm's own `quietMs` into `deriveLanePhase`, so a local lane is
labelled quiet only after its band's window. Whether 5 minutes is itself right is still unmeasured.

For a **Pi** arm, install the binary and give it a provider:

```
npm install -g @earendil-works/pi-coding-agent     # 0.86.1 here
```

```jsonc
// ~/.pi/agent/models.json — the operator's own file, used when no endpoint is armed
{ "providers": { "ollama": {
  "baseUrl": "http://localhost:11434/v1", "api": "openai-completions", "apiKey": "ollama",
  "compat": { "supportsDeveloperRole": false, "supportsReasoningEffort": false },
  "models": [{ "id": "qwen3.8:27b", "contextWindow": 65536, "maxTokens": 16384,
               "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 } }] } } }
```

**`contextWindow` is load-bearing on both sides and only one of them is this file.** The 65 536 above
is what the *client* declares; the *server* side is `OLLAMA_CONTEXT_LENGTH`, which is the operator's
to set and which the probe is what enforces. Ascent never edits this file.

Two timings worth knowing before reading a first run: **Pi's own startup is ~5.9 s** per session
before a token is generated (13.9 s wall minus 8.0 s of model time on the fixture run), and **a cold
model load cost 23 s** where every warm session was 4–8 s. The first lane of a drive is therefore not
representative of the rest, and that must not be read as a transport difference.

## What a local execute lane actually did (measured 2026-09-21)

Four real lanes were driven against a paired repo (`xkazm04/kp`, one curated backlog item, Claude
planning on the seat). **No lane reached a commit.** The reason is the same on both transports and it
is not the model's capability — which is why it is written down here in full rather than summarised
as "local is too slow".

| arm | what happened |
| --- | --- |
| `claude:sonnet > claude:qwen3.8:27b-64k` | plan ok; execute went silent after a tool result, `api_retry` twice, no further output |
| `claude:sonnet > pi:qwen3.8:27b-64k` (first) | `Pi error: 404 page not found` in 1 s — the adapter was handed the server root instead of the OpenAI-compatible `/v1` prefix |
| `claude:sonnet > pi:qwen3.8:27b-64k` (fixed) | **6 real turns, 13 929 in / 430 out, 25 min**, then `Pi error: Request timed out.` |

### The binding constraint is the CLIENT'S SILENCE BUDGET, not the model

Both failures are the same shape, and the standard names it: a client that streams enforces a budget
on how long a response may produce no bytes, and a candidate that pauses longer than that budget *is
not slow to such a client — it is failed*, after the request was already accepted.

- **Pi**: `DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000` in the installed 0.86.1 bundle. Five minutes of
  silence ends the request. There is no documented flag for it and no field for it in
  `~/.pi/agent/models.json`; `DEFAULT_REQUEST_TIMEOUT` is `0` (unbounded), so the idle budget is the
  one that bites.
- **Claude Code**: `API_TIMEOUT_MS` is the lever and Ascent now sets it to
  {@link LOCAL_REQUEST_TIMEOUT_MS} (10 min) rather than to the session band — but the observed
  failure there was a request that *errored* and retried, not one that merely ran long.

A 27B at 4-bit on 24 GB spends minutes per turn: ~35 s prefilling a 14k-token context at ~400 tok/s,
then a reasoning phase that emits nothing to the client. That silence is what trips the budget.
Reasoning cannot be turned off from either side — `MAX_THINKING_TOKENS=0` does not reach Ollama's
Anthropic-compatible endpoint, and `think` is not a Modelfile parameter.

### What this does and does not mean

**It does not mean a 27B cannot drive an agent loop.** In a scratch repo the same model ran
Glob → Read → Read → Write and produced a correct answer, and in the lane above it sustained six
genuine tool-using turns. The work happens; the client gives up waiting for it.

**It does mean this combination is not viable end to end today**, and the lever is one of:
- more VRAM, so a 64k context does not spill 8.4 GB and generation runs at ~28 tok/s instead of ~8;
- a harness whose silence budget is configurable (neither of the two here exposes one usefully);
- smaller per-turn contexts, which the floor forbids for the reason the floor exists.

**The economics, if the timeouts were solved**: ~4 minutes per turn at the observed rate, so a lane
needing 20–40 turns is 1.5–3 hours. That is plausible for unattended overnight work and not for
anything a person waits on — which is the delegation question answered in the shape it was asked.

### The surrounding machinery behaved correctly throughout

Worth recording, because it is what makes the above trustworthy: every failed lane armed its
degradation guard, logged the failure with its turn count and duration, verified the worktree was
unchanged, committed nothing, and **refused to rescan** — with the reason written out, that scanning a
worktree nothing landed in would credit the repo with work that does not exist. Four broken runs
produced four honest no-ops and not one plausible number.

## A 9B executor that fits: the first local wave to reach commits (2026-09-22)

The constraint above is the model's size on this card, so the next wave changed the executor, not the
harness. `MiMo-V2.6-Distill-Qwen-9B` at Q8 (Ollama `mimo-9b:q8-64k`, `num_ctx 65536`) is **17 GB and
100% on the GPU at the 64k floor**. Through Pi it ran five analyst-picked items on this repo, each in
a worktree off `master`, with the item's targeted tests before and after, then `npm run typecheck`
and a reviewer's pass over the diff. The lanes were script-driven rather than started through
`/api/org/loop`, because hand-picked items are not follow-up rows.

| Item | Difficulty | Pi time | Tests after | Typecheck | Outcome |
| --- | --- | --- | --- | --- | --- |
| `/v1` suffix on the local agent URL | easy | 48 s | green | clean | landed with one cosmetic fix |
| unmeasured repos as laggards | easy | 30 s | green | clean | landed as written |
| a lane's quiet window is its arm's | medium | 168 s | green | failed | landed after fixes (see below) |
| gate URL floors for D1..D8 | medium | 168 s | green | failed | landed after fixes, including a semantic bug |
| D6 credit from non-GitHub CI | stretch | about 22 min, killed | - | - | not landed |

What it showed:

- **No lane came near Pi's 300 s idle budget.** A resident executor removes the failure the 27B lanes
  died of.
- **Green targeted tests were not a verdict.** All four finished lanes were green on tests they had
  just added. Two of them failed typecheck, and one emitted the URL key `D2` where the parser reads
  `min_d2`, with a new test asserting the wrong key. A round-trip test that the lane did not write is
  what caught it. So a lane gate should run `npm run typecheck` by default, and a lane that adds the
  tests grading it deserves the same suspicion the void rule applies to one that edits them.
- **The stretch lane failed on line endings.** It wrote its test, then spent 220 tool calls trying to
  make exact-match edits land in an 850-line file with CRLF endings. The reviewer's own scripted edits
  hit the same mismatch in these worktrees. On a Windows checkout, a small executor needs normalised
  line endings or a line-range edit, or its failure reads as incapacity.
- **Delegation boundary for this executor:** bounded one-file changes land nearly untouched, and
  two-file changes need a reviewer.

Not measured: there was no hosted arm on the same items, so there is no
`claudeTokensPerVerifiedPoint`, and no rescan ran. This is a single-arm wave, not an arms verdict.

## Known gaps

- The agent's `--effort` is passed only when a level is chosen, and nothing probes whether the local
  `claude` build accepts the flag: on a build that rejects it the session fails with the CLI's own
  message rather than retrying without it.
- A run interrupted by a restart is **reconciled, not resumed**: the row is marked `stopped` and its
  in-flight lanes `error`. The branch and its commits survive; nothing picks the cycle back up.
- A locally paired registry cannot open pull requests, so migration, scaffold, signals contribution and
  a dispatch's PR stay behind the optional GitHub App; the steps say so rather than failing on click.
- The dirty-tree sha-less scan can't dedup against itself — two identical dirty scans persist two
  rows (bounded by the content-key `dedupKey`, which catches byte-identical reports).
- **Nothing resolves a `LocalEndpoint` yet** (2026-09-21). `TransportRunOptions.endpoint` is the
  committed shape and both spawn doors honour it (`claudeSpawnEnv` writes the env block,
  `runPiAgent` generates the provider file), but neither `loop-lane.ts` nor `lane-plan.ts` passes
  one and no environment variable resolves one. So a local arm today means arming `pi` against the
  operator's own `~/.pi/agent/models.json`; a `claude` arm with no endpoint is the hosted seat.
- **No comparison run has completed** (2026-09-21). The probe, the arms, the per-transport bands,
  the integrity guard and the metric contract are implemented and tested; the verdict on whether a
  local model can carry a lane does not exist. Nothing on these pages claims one.
- **The Pi capability row is dated to one version on one machine** (0.86.1, 2026-09-21). Nothing
  re-verifies it; a Pi release that renames a flag surfaces as an argument error inside a lane, which
  is exactly the failure shape the dated matrix is meant to make legible rather than to prevent.
