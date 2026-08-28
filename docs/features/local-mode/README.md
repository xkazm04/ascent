# Local mode (self-hosted)

_Status: **implemented** (2026-08-19, three phases in one wave): repo↔folder pairing, scan-from-disk
ingestion with instant follow-up close, and the war-room autopilot. Everything here exists only on a
**self-hosted** deployment (`selfHosted()`, `src/lib/env.ts`) — the routes answer 404 on managed
cloud, and the rail hides the Pairing tab there._

The premise: a self-hosted Ascent runs on the same machine as the code it scores, so the scan loop
does not have to lead against GitHub. A paired repo scans from disk; an `Ascent-Resolves:` trailer
closes its follow-up the moment it is **committed, before any push**; and the war room can dispatch a
local coding agent at the backlog and verify its work in the same breath.

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
trailers closed.

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
- **Model and effort are per RUN** (2026-08-28), picked in the cockpit and resolved at arm time
  against `CLAUDE_MODEL` / **`ASCENT_AGENT_EFFORT`** — deliberately not `CLAUDE_EFFORT`, which the
  Claude Code harness sets in the environment it hands child processes, so a self-hosted Ascent
  launched from inside a session would have inherited an effort nobody chose. The resolved pair is
  stored on the run (and on the drive, which hands it to every run it dispatches) and printed beside
  the lift, because two lifts from two setups are not comparable. `--effort` is appended only when a
  level was chosen. Details: [org-planning/live.md](../org-planning/live.md#per-run-model-and-effort-2026-08-28).
- **No-progress stop**: a cycle with zero commits and zero closed rows ends the run early (applied
  per lane by the engine, so in a multi-repo run one stalled repo no longer ends the pass).
- **One run per org**, enforced against the database, not a process `Map`. Phase, branch, log and
  outcome ids are durable; a `running` row left behind by a restart is reconciled to `stopped`
  (`markStaleRunsStopped`) rather than being trusted or resumed.

UI: `AutopilotBand` (+ `AutopilotBandParts`) in `src/features/inflight/live/` — picker, cycle
count, start/stop, live log; polls the job every 4s only while one runs, and refreshes the wall once
per finished run. Routes: `GET/POST /api/org/local/autopilot` (start/stop owner-gated — same blast
radius as pairing).

## Drive to green (`/api/org/local/drive`, 2026-08-26; reachable from the cockpit 2026-08-28)

| | |
| --- | --- |
| `POST { org, action:"start", repos?, maxRuns?, maxCycles?, concurrency? }` | start a drive over the watched, paired repos (or the given ones) — `202 { drive }` |
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

## Known gaps

- The agent's `--effort` is passed only when a level is chosen, and nothing probes whether the local
  `claude` build accepts the flag: on a build that rejects it the session fails with the CLI's own
  message rather than retrying without it.
- A run interrupted by a restart is **reconciled, not resumed**: the row is marked `stopped` and its
  in-flight lanes `error`. The branch and its commits survive; nothing picks the cycle back up.
- The dirty-tree sha-less scan can't dedup against itself — two identical dirty scans persist two
  rows (bounded by the content-key `dedupKey`, which catches byte-identical reports).
