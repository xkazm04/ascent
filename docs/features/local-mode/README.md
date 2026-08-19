# Local mode (self-hosted)

_Status: **implemented** (2026-08-19, three phases in one wave): repo↔folder pairing, scan-from-disk
ingestion with instant follow-up close, and the war-room autopilot. Everything here exists only on a
**self-hosted** deployment (`selfHosted()`, `src/lib/env.ts`) — the routes answer 404 on managed
cloud, and the rail hides the Pairing tab there._

The premise: a self-hosted Ascent runs on the same machine as the code it scores, so the scan loop
does not have to lead against GitHub. A paired repo scans from disk; an `Ascent-Resolves:` trailer
closes its follow-up the moment it is **committed, before any push**; and the war room can dispatch a
local coding agent at the backlog and verify its work in the same breath.

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

`POST /api/org/local/rescan { org, fullName }` runs one paired repo end-to-end (member-gated — a
scan reads, only pairing decides what may be read). No credit ceremony: behind `selfHostGuard`,
`isMeteredScan()` is false by construction. The Follow-ups ledger shows a **"Rescan N paired repos
locally"** button (`LocalRescanButton`) that runs them sequentially and reports how many rows the
trailers closed.

## Autopilot (`?tab=live`, self-hosted + paired + `ASCENT_AUTOPILOT=1`)

The war room's dispatch loop (`src/lib/local/autopilot.ts`): per cycle, pick the repo's top open
follow-ups (batch of 5, biggest projected gain first) → mark them in-progress (the ledger's hand-off
claim — `scans-persist` only resolves claimed rows) → spawn one headless `claude -p` session in an
**isolated worktree** with the batch's fix prompt (`buildFixPrompt` + autopilot context) → count the
commits → rescan the worktree from disk → repeat while progress lands, up to `maxCycles` (≤5).

Guardrails, each load-bearing:

- **Worktree isolation**: `git worktree add -b ascent/autopilot-<stamp> <tmp> HEAD` — the operator's
  checkout, branch and uncommitted work are never touched. The **branch is the deliverable** (review
  and merge it); the temp worktree dir is removed after the run.
- **Never pushes.** The loop proposes; the human merges.
- **Consent**: `ASCENT_AUTOPILOT=1` is checked in the agent runner AND the route (a disabled
  deployment gets an honest 409 naming the fix). The session runs `--permission-mode acceptEdits` —
  not `--dangerously-skip-permissions` — with a 20-min default ceiling
  (`ASCENT_AUTOPILOT_TIMEOUT_MS`).
- **No-progress stop**: a cycle with zero commits and zero closed rows ends the run early.
- **One job per org**, in-memory (`Map`): a self-hosted deployment is one long-lived process, and
  the durable output — commits, persisted scans, closed rows — survives a restart; the ticker log
  does not need to.

UI: `AutopilotBand` (+ `AutopilotBandParts`) in `src/features/inflight/live/` — picker, cycle
count, start/stop, live log; polls the job every 4s only while one runs, and refreshes the wall once
per finished run. Routes: `GET/POST /api/org/local/autopilot` (start/stop owner-gated — same blast
radius as pairing).

## Known gaps

- Autopilot works **one repo per run**; a fleet-wide conveyor (queue of paired repos) is the obvious
  next step once single-repo runs prove out.
- The agent model rides `CLAUDE_MODEL` (default `sonnet`); no per-run model picker yet.
- Job state does not survive a server restart mid-run (the worktree branch and any commits do; the
  run just stops advancing). Durable job rows would fix resume.
- The dirty-tree sha-less scan can't dedup against itself — two identical dirty scans persist two
  rows (bounded by the content-key `dedupKey`, which catches byte-identical reports).
