# ADR-0001 — Hosted loop dispatch: substrate, gate mapping and API contract

- **Status:** Proposed — awaiting sign-off from the stakeholders named below
- **Date proposed:** 2026-09-14
- **Deciders (sign-off required before this reaches Accepted):** repository owner / operator (product +
  money), App Master ascent (author)
- **Serves:** team goal **Hosted loop dispatch**
- **Verified against:** the tree at `d1b1ac88` (branch `autopilot/design-hosted-dispatch-substrate-and-gate-plan`)

## Context — the constraint that forces a choice

The improvement loop is a **local-mode** capability. `startLoopRun` refuses on three gates before it
does anything (`src/lib/local/loop-engine.ts:162-190`):

1. `selfHosted()` — "The improvement loop only runs on a self-hosted deployment."
2. `autopilotEnabled()` / `ASCENT_AUTOPILOT=1` — spawning an auto-editing agent is a deliberate opt-in.
3. a **verified local pairing for every repo in the set** — `getRepoLocalPath` + `verifyLocalPath`,
   resolved up front so a broken pairing refuses the whole run rather than three lanes in.

Those gates are not arbitrary: a local lane creates a git worktree on the server's own filesystem and
spawns `claude -p` inside it. **On managed cloud none of the three can be satisfied**, and the surface
says so in two places:

- `src/features/inflight/live/cockpit/cockpitGate.ts:23` — `if (!o.selfHosted) return "hosted";` — a
  pure client-side read of deployment mode, which then renders the `hosted` setup card
  (`CockpitSetup.tsx:37-69`).
- `selfHostGuard()` (`src/lib/api/self-host.ts:11`) answers **404, never 403** — "the surface doesn't
  exist here, and a 403 would advertise that it could" — on all six `/api/org/local/*` routes
  (`autopilot`, `drive`, `pairing`, `projects`, `repo`, `rescan`) plus `/api/org/loop/lessons` and
  `/api/org/loop/[id]/pr`.

**One correction to the premise this work was framed on.** POST `/api/org/loop` no longer 404s
wholesale on cloud. PRIYA-L1-703 made the guard executor-conditional — `route.ts:169`,
`(remote ? null : selfHostGuard())` — and `/api/org/loop/propose` dropped the guard entirely. A cloud
owner can already arm `executor: "remote-agent"` today, and `startRemoteRun`
(`loop-engine.ts:302-342`) deliberately carries **no** `selfHosted()`, no `autopilotEnabled()`, no
pairing check, no worktree, no process: it writes a `LoopRun` in phase `curating` with one
`remote-agent` lane per repo and waits for someone else to claim. The work protocol on the other end
already exists too — claim / brief / report over MCP (`src/lib/mcp/work-tools.ts`), leases via
`attachRemoteClaim` (`src/lib/db/loop-runs-write.ts:111`), and `LoopRunLane.executor` /
`claimedBy` / `leaseUntil` columns in `prisma/schema.prisma:1812`.

So the real gap is **not** "the API 404s". It is:

- **Nobody dispatches.** A cloud run sits in `curating` forever unless a human points their own agent
  harness at it. Ascent Cloud runs no worker of its own.
- **The cockpit lies by omission.** `cockpitSetupState` decides from `selfHosted` alone, so a cloud
  owner who *could* arm a remote run is shown a self-hosting guide instead of a Run button. The card's
  own comment already concedes this ("Remote-agent runs do work here"), but the gate above it does not.
- **The cloud gates are undefined.** `ASCENT_AUTOPILOT` and "is this repo paired to a directory" have
  no tenancy meaning in a multi-tenant deployment, and `startRemoteRun`'s zero-gate posture is only
  safe while the claimant is the customer's own agent, spending the customer's own tokens.

## Decision

**Hosted dispatch is not a new engine. Ascent Cloud becomes the first-party client of the work
protocol it already ships, and the dispatch substrate is a durable DB-backed lane queue drained by a
cron-invoked worker route behind a small `LaneDispatcher` interface.**

Four parts:

### 1. Substrate — DB queue + cron drain, behind an interface

- The queue **is** `LoopRunLane`. `phase: "queued"`, `executor`, `claimedBy` and `leaseUntil` already
  model a lease; hosted lanes get `executor: "hosted-worker"` and are claimed through the same
  `attachRemoteClaim` path a remote agent uses. No new queue table.
- A new cron route `GET /api/cron/loop-dispatch` (Vercel Cron, `CRON_SECRET`, `maxDuration = 300`)
  drains due hosted lanes under a deadline-bounded `mapPoolUntilDeadline`, exactly as
  `/api/cron/athena` does — and it inherits that route's written hosting contract verbatim: *never
  overlaps itself* (at-most-once per period via `claimOrgAuditOnce`'s pattern), *never races a human*,
  *declared ceiling*, *degraded is not green (207, never a green 200)*.
- The route does **not** run the agent. It calls `dispatcher.dispatch(lane, brief)` on a
  `LaneDispatcher` interface (`src/lib/local/lane-dispatcher.ts`) whose first and only implementation
  posts the lane to the hosted agent runner and returns immediately. The interface is the seam that
  keeps alternative **C** below a swap rather than a rewrite.
- **A hosted lane is never a restart casualty by accident.** `markStaleRunsStopped`/`isLoopRunLive`
  must continue to ignore non-`local` lanes (the rule `startRemoteRun` already states); expiry of a
  hosted lane is decided by `leaseUntil`, not by whether this process happens to hold a registry entry.

### 2. Gate mapping — self-hosted checks → cloud tenancy

| Local gate | Why it exists | Cloud replacement | Where it lives |
| --- | --- | --- | --- |
| `selfHosted()` | the route touches the server's disk | **dropped for hosted lanes** — a hosted lane touches no disk. Kept, unchanged and forever, for `/api/org/local/*` | `route.ts` executor branch, as `remote-agent` already does |
| `ASCENT_AUTOPILOT=1` (deployment-wide env) | dispatching an auto-editing agent is a deliberate opt-in | **per-org opt-in row** `Org.hostedLoopEnabled` + a plan entitlement (`planAllows("hostedLoop", plan)`). An env var cannot express "org A opted in, org B did not" | `src/lib/plans.ts`, org settings |
| verified local pairing per repo | proves Ascent can reach the code and is allowed to edit it | **GitHub App installation + the repo's admission row**: `getRepoAdmission(...).mode === "agents-allowed"` (the recorded, overridable decision — `AdmissionMode`, `src/lib/org/admission.ts:34`), with the derived autonomy tier carried into the brief. `claimability` already encodes this test for claims; the dispatcher reuses it rather than re-deriving it | `src/lib/org/followups.ts`, `src/lib/db/org-admission.ts` |
| `requireOrgRole("owner")` | starting a run is a write with blast radius | **unchanged** — already tenancy-correct, already applied to `remote-agent` | `route.ts:180` |

Two gates are **added**, because hosted dispatch spends Ascent's money in the customer's repository
and the local path never had to answer for either:

- **Spend ceiling.** A hosted run debits org credits; a lane with no headroom is refused at arm time,
  not discovered mid-cycle. Lane cost is already recorded in micro-cents (`LoopRunLane.costMicros`)
  with the one-source rule — the ceiling reads that, and honest nulls stay honest.
- **Delivery is `pr` only.** `land` fast-forwards into a working copy; hosted has none, and a hosted
  agent must never write to a customer's default branch. The route rejects `delivery: "land"` for
  hosted lanes.

### 3. API contract

```
POST /api/org/loop      { org, action: "start", executor: "hosted", repos, batches?, delivery?: "pr" }
  → 202 { runId }                     run in phase `curating`, lanes executor="hosted-worker"
  → 400 unknown/invalid field · 402 no credit headroom · 403 not owner / repo not agents-allowed
  → 409 org has an active run · 409 hosted loop not enabled for this org
  (no 404: the surface exists on cloud. 404 keeps its meaning only where the surface truly does not.)

GET  /api/org/loop?org=…
  → 200 { …existing…, hosted: { enabled: boolean, reason: string | null } }
```

`hosted.enabled` is the server's answer to "can this org dispatch?", and `cockpitSetupState` reads it
instead of `selfHosted`. That is the change that retires the misleading `hosted` card: the gate stops
being a deployment-mode inference in the browser and becomes a tenancy fact from the server. The card
itself survives for the deployments where it is still true (self-host-only local lanes) and gains a
`hosted-not-enabled` sibling that names the actual next action.

**No new report endpoint.** The hosted worker reports through the existing MCP work tools with a token
scoped `followups:write` (`SKILL_TOKEN_SCOPES`, `src/lib/db/org-api-tokens.ts:27`), which means the
hosted path is audited, leased and rate-shaped by exactly the code an external agent already goes
through — and it can never reach `status: "done"` on its own, because the ruling stays with the
default-branch rescan.

### 4. What this decision does **not** do

It does not make Ascent execute agent code inside its own request path, it does not add a deploy
target, and it does not change the meaning of `selfHostGuard` on the filesystem surfaces. If a
question about hosted dispatch is answered by "and then the Next.js route runs the agent", it is the
wrong answer.

## Alternatives considered

**A. A long-running worker service (container fleet: ECS/Fly/Render) driving `startLoopRun` remotely.**
The honest shape for heavy multi-cycle work — a real process, no function cap, real concurrency.
*Lost because:* it is a second deploy target, a second secret store and a second on-call surface for a
product whose entire production story today is `vercel.json` + five crons, and it front-loads all of
that before a single hosted lane has ever run. The `LaneDispatcher` interface is placed exactly so
this becomes the second implementation once measured cycle times justify it — this ADR defers it, it
does not reject it.

**B. Drive the loop in-process from the Next.js route (lift the `selfHosted()` gate and let the
existing engine run on cloud).** The smallest diff — delete a guard.
*Lost because:* three independent facts make it wrong. The function cap is 300s (`maxDuration = 300`
on every long route) and a loop cycle is minutes-to-tens-of-minutes; the live registry is a
**per-process `globalThis` Map** (`loop-engine.ts:103-110`) so a serverless instance recycle silently
orphans the run — the exact 2026-08-26 bug that comment records, but with no operator watching; and
the engine's first act is `createLoopWorktree` on a filesystem that on cloud contains no checkout.
This alternative also has precedent against it in-tree: `org-watch.ts`'s module-global claim Map is
self-documented as "NOT a cross-instance distributed lock", and spec `10-two-speed-fleet-queue`
exists to replace it with a DB claim.

**C. A third-party queue (SQS / QStash / Inngest) as the dispatch substrate.**
Real retries, real backoff, real dead-lettering, none of it written here.
*Lost because:* it adds a vendor, a credential and a webhook ingress to buy a lease and a retry that
`LoopRunLane` + `leaseUntil` + the cron drain already give us, and it splits the queue's state from
the run rows the UI polls — two sources of truth for "what is this lane doing". Cost also lands on the
cloud bill for a capability with no revenue yet. Chosen against **for now**, and the `LaneDispatcher`
interface plus a lease-based (not delivery-based) claim model is what keeps the swap cheap if the
cron drain proves too coarse.

**D. Ship nothing hosted: keep cloud read-only and sell self-hosting for the loop.**
Defensible — it is what the product does today, and the `hosted` card already writes the
self-hosting guide.
*Lost because:* the deployment mode then decides the product's headline capability, and the two-tier
positioning (D28: cloud sells **operation**, not features) says the opposite. Ascent Cloud already
sells operation of scanning; a loop that only self-hosters can run makes the paid tier the weaker one.

**E. Hosted dispatch by making the customer bring their own agent (document `remote-agent`, ship a
reference worker, dispatch nothing).** A genuinely cheap option, and half-true already.
*Lost as the destination, kept as the fallback:* it leaves the goal's actual gap — nobody dispatches —
open, and it makes first-run value depend on the customer standing up a harness. It survives as the
degraded mode: if hosted dispatch is disabled for an org, the remote-agent door stays open and the
cockpit says so.

## Consequences

**Accepted:**
- Ascent Cloud starts paying for agent execution. Metering and a per-org ceiling are a *precondition*
  of the first hosted lane, not a follow-up — this is the one item in the breakdown that cannot slip.
- A hosted agent writes to customer repositories through the GitHub App. Blast radius is bounded to
  `pr` delivery on a non-default branch, gated on `agents-allowed` admission, and reversible by the
  admission row's `rulesetId` handle.
- Cron cadence sets the floor on dispatch latency (minutes). Acceptable for an improvement loop;
  unacceptable for anything interactive, which is a reason to keep the two paths separate.
- One more cron entry in `vercel.json` and one more `CRON_SECRET`-guarded route to keep green.

**Risks to watch:**
- A hosted lane whose worker dies mid-cycle is detected only at `leaseUntil` expiry. The expiry must be
  written before the first hosted lane runs, or a wedged lane blocks its org's one-active-run rule.
- `cockpitSetupState` moving from a client inference to a server fact is a behaviour change for
  self-hosted deployments too — the gate's own header warns that widening it for one dispatch path and
  not the other is "the failure mode this exists to make impossible". The change must keep loop and
  drive on one predicate.

## Task breakdown

Story points on the 1–8 scale. **T1 and T2 gate everything after them.**

| # | Task | Points | Notes |
| --- | --- | --- | --- |
| T1 | `Org.hostedLoopEnabled` + `planAllows("hostedLoop", …)` + the `hosted.enabled/reason` field on `GET /api/org/loop` | 3 | Pure additive; no dispatch yet. Unblocks T3. |
| T2 | Credit ceiling for hosted lanes: read `costMicros`, refuse at arm time with 402, record the debit | 5 | The money precondition. Honest nulls stay null. |
| T3 | `cockpitSetupState` reads `hosted.enabled` instead of `selfHosted`; new `hosted-not-enabled` card; loop and drive stay on one predicate | 3 | Retires the misleading card. Test: a cloud owner with the flag on sees Run. |
| T4 | `executor: "hosted"` on `POST /api/org/loop` → `startHostedRun` (a thin `startRemoteRun` with the gate table applied and `delivery: "pr"` forced) | 5 | Reuses `startRemoteRun`'s zero-worktree shape. |
| T5 | `LaneDispatcher` interface + the runner-posting implementation | 5 | The swap seam for alternative A/C. |
| T6 | `GET /api/cron/loop-dispatch` — drain, deadline, 207-on-degraded, at-most-once claim; `vercel.json` entry | 5 | Copy `/api/cron/athena`'s hosting contract, including its `maxDuration` pinning test. |
| T7 | Lease expiry + reaper for hosted lanes (`leaseUntil` past → lane back to `queued`, bounded reclaims) | 3 | Must land with T6, not after. |
| T8 | Hosted worker token provisioning: an org-scoped `followups:write` token issued per run, revoked at run end | 5 | No new report endpoint; the MCP work tools are the contract. |
| T9 | Docs: `SELF-HOSTING.md` / `DEPLOY.md` / `features/` note on which loop runs where; update this ADR's status | 2 | The `hosted` card's copy has drifted once already. |

Total ≈ 36 points. T1→T3 is the smallest slice that is worth shipping alone (a cloud owner can arm a
`remote-agent` run from the UI instead of being told to self-host); T4→T7 is the slice that makes
Ascent the dispatcher.

## Open question left to the deciders

Whether hosted execution runs the same `claude -p` harness Ascent ships locally, or a provider-neutral
runner chosen per org (the pluggable LLM layer's seven providers). This ADR is deliberately silent:
the `LaneDispatcher` interface makes it a later, cheaper decision, and answering it now would be
guessing at a cost model nobody has measured.
