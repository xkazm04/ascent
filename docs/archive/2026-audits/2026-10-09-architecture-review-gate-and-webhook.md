# Architecture review: the PR gate and the GitHub App webhook path

- **Date:** 2026-10-09
- **Base:** `f91571d2` (`master` tip; every `file:line` below was read at this commit)
- **Charter:** `codebase-architecture-review`, a headless builder run. This is a read-only review: it changes no code.
- **Status:** a point-in-time record (append-only, per AGENTS.md, "Docs that are not feature docs"). Line numbers
  will drift. Each finding also names a function or constant, so it can still be found after they do.

## The question

Which structural problems in the gate and webhook files will cost the most later? Which few (at most three)
are worth competing with product work now?

## Scope and evidence

**Read in full:** `src/lib/scoring/gate.ts` (1008 lines), `src/app/api/gate/[owner]/[repo]/route.ts` (423),
`src/app/api/app/webhook/route.ts` (837), `src/app/api/app/webhook/body-limit.ts`, `src/lib/push-rescan.ts`,
`src/lib/github/webhook-delivery.ts`, `src/lib/github/app.ts`, `src/lib/github/pr-gate.ts`,
`src/lib/scoring/gate-admission.ts`, `src/lib/db/webhook-deliveries.ts`, `action.yml`,
`scripts/maturity-gate.mjs`, `src/lib/scoring/gate-api.ts`.

**Read where the targets call out:** `src/lib/alerts.ts`, `src/lib/alert-door.ts`, `src/lib/scan-alerts.ts`,
`src/lib/mcp/handlers.ts`, `src/lib/org/governance.ts`, `src/lib/org/admission.ts`,
`src/app/api/org/gate-policy/route.ts`, `src/lib/db/installations.ts`, `src/lib/db/org-watch.ts`, and the
silent-catch guards.

**Settled constraints, taken as given:** the seven ADRs the brief names (PR gate fails closed; push rescan is a
queued job; App-path bounds follow platform limits; ambient token only for proven-public repos; private scan
stores no file text; a caught write failure is not a different answer; a failed read is not absence).

**Council reports:** all three were reachable and read:

- `2026-10-08-pr-maturity-gate-r1`;
- `2026-10-08-private-repo-scan-r1`;
- `2026-10-09-push-triggered-rescan-r1`.

They sit under `C:/Users/kazda/kiro/personas/.claude/master/ascent/headless/council/`. Where a finding
restates a council finding, the member id is given, and the claim was checked again in the code at `f91571d2`.

**Context map:** the targets fall into three contexts:

| Context | Targets |
|---|---|
| CI Gate & Status Checks | `gate.ts`, the gate route, `pr-gate.ts`, `action.yml`, `maturity-gate.mjs` |
| GitHub App Installation & Webhooks | the webhook route, `app.ts`, `webhook-deliveries.ts`, `push-rescan.ts` |
| GitHub Repo Data Access | `webhook-delivery.ts` |

**Not done:** nothing was run against GitHub, no app was started, and no test was written to prove a finding.
Every claim is a code reading.

## Summary

| # | Finding | Verdict | Builder alone? | Operator? |
|---|---|---|---|---|
| 1 | Failures that happen after the webhook has already answered 2xx reach no error door, and the path is outside every silent-catch guard | **do now** | yes | no |
| 2 | The effective gate policy is assembled separately on each surface; the MCP verdict and the fleet view skip the admission overlay | **do now** | yes, for route, check run and MCP | the fleet view's bar needs a decision |
| 3 | The regression-alert cooldown is stamped in process memory before a one-attempt send | **do now** | yes | no |
| 4 | Replay dedup is keyed on the unsigned `X-GitHub-Delivery` header, and skipped when the header is absent | later (ADR first) | yes, after the ADR | no |
| 5 | The Action's response contract is pinned for inputs but not outputs | later (first in line) | yes | no |
| 6 | Installation tokens are whole-installation scope, and one consumer of about 18 retries a 401 | later | yes | no |
| 7 | The delivery-claim store fails open, which makes the route's fail-closed branch dead code | later (ADR) | yes, after the ADR | no |
| 8 | One delivery claim spans several `after()` tasks with different release policies | later | yes | no |
| 9 | Nothing recovers a lost App delivery: GitHub does not redeliver on its own | later | no | **yes** |
| 10 | The gate route's warm-row fast path rests on a false premise | not worth it (fix the comment) | yes | no |
| 11 | `gate.ts` is 1008 lines | not worth it now | yes | no |

---

## Do now

### 1. Failures after the 2xx reach no error door, and no guard covers the path

**Evidence.**

- **No error door anywhere on the path.** `reportHandledError` appears 0 times in
  `src/app/api/app/webhook/route.ts`, `src/lib/github/pr-gate.ts`, `src/lib/github/webhook-delivery.ts` and
  `src/lib/db/webhook-deliveries.ts`. Only `src/lib/push-rescan.ts` reports (`reportFailure`, :184-187).
- **Every deferred failure in the route ends in a `console.warn` or `console.error`.** Most go through
  `abandonDelivery` (13 call sites). That helper logs and releases the claim, but reports nothing
  (`webhook-delivery.ts:80-83`).
- **Six bare catches turn a failure into a value with no log at all:**
  - `route.ts:397`: `resolveRepoJobRef(...).catch(() => null)`;
  - `:400`: `latestObservations(...).catch(() => [])`;
  - `:421`: `recordObservations(...).catch(() => null)`;
  - `:491`: `upsertLiveAiChange(...).catch(() => false)`;
  - `:501`: `listWatchedRepos(...).catch(() => [])`. A failed read here is shown as "no repos to probe";
  - `:503`: `enqueueProbeJob(...).catch(() => null)`.
- **The PR gate's own failure path only logs.** The outer catch (`pr-gate.ts:199-221`) and the fallback check
  write (`:217`) both log and stop there. That is the path behind the merge-blocking "could not run" check.
- **The push path's regression check settles a thrown check as "no regression"** (`scan-alerts.ts:238-241`;
  council push r1, robustness-3).
- **No guard covers any of this.** The silent-catch guards cover other spans:
  - `scan-silent-catch.guard.test.ts:28-33` names four contexts, none on this path;
  - the briefing guard covers the executive-briefing span;
  - the scan-queue guard covers the queue and cron files.

  The failed-read ADR already lists this exposure under "Open": code outside the guarded contexts "holds by
  convention only".

**Cost if left.** GitHub does not redeliver a failed delivery on its own (craft-3 in the pr-maturity-gate and
push councils; the App-path ADR states the same for a 2xx). Every `abandonDelivery` release therefore helps
only a person who clicks "Redeliver", and that person needs to know a delivery failed. Today the only trace is a
serverless log line. The failed-read ADR's own reasoning applies: "a log line on a serverless function is read
by no one".

Two concrete failures stay invisible:

- a token-mint failure that leaves a required check pending;
- a reconcile that never ran after an access change.

This also blocks findings 7 and 9: the claim policy and any redelivery sweep cannot be judged without a count
of how often the after-2xx work fails. The defect class this breeds is "silent loss on the one path with no
retry".

**Smallest change.**

1. Give `abandonDelivery` an optional `err` argument. When one is passed, it calls
   `reportHandledError(err, { message })` after the log. The catch-block call sites pass their error. The
   deterministic aborts (owner mismatch, unconfirmed revocation) pass none, so a forged or misrouted delivery
   does not page anyone. Item 4 of the caught-write-failure ADR draws the same 4xx-versus-ours line.
2. Report from `runPrGate`'s outer catch and from its fallback-check catch.
3. Replace the six bare catches with the house `degradedRead(...)` door (`src/lib/org/degraded-read.ts`).
4. Add the contexts "GitHub App Installation & Webhooks" and "CI Gate & Status Checks" to a silent-catch guard.
   The scan-queue guard already reuses the briefing matcher, so this is a list edit plus an allowlist.

**Files:**

- `src/lib/github/webhook-delivery.ts`;
- `src/app/api/app/webhook/route.ts`;
- `src/lib/github/pr-gate.ts`;
- `src/lib/scan-alerts.ts` (the `:238-241` catch);
- one guard test, probably `src/lib/scan-queue-silent-catch.guard.test.ts` or a sibling;
- their tests.

**Operator decision:** none. The failed-read and caught-write-failure ADRs already settle the rule; this applies
it where it does not yet reach.

### 2. The effective gate policy is assembled separately on each surface

**Evidence.** `gate.ts:7-19` states the contract: "ONE policy type and ONE merge". The fold is
`tighten(tighten(tighten(org ?? archetype, admission), manifest), params)`. The *merge* (`tightenGatePolicy`,
`gate.ts:968`) is single. The *resolution* is not: each surface repeats the IO and the fold inline, and they
have already diverged.

| Surface | Where | What it folds |
|---|---|---|
| Public API | `gate/[owner]/[repo]/route.ts:236-290` | org (tenancy-resolved) ?? the repo's archetype, then admission, then query params |
| App check run | `pr-gate.ts:122-139` | org (tenancy-resolved) ?? the repo's archetype, then admission |
| MCP `gate_verdict` | `mcp/handlers.ts:99-112` | org ?? `defaultGatePolicy("org")`. **No admission overlay**, and the default is always the `org` archetype |
| Fleet view | `org/governance.ts:128`, `:178-190` | org ?? `defaultGatePolicy("org")`, deliberately org-wide (`:121`). **No admission overlay** |

`admissionGateOverlay` (`org/admission.ts:150-173`) adds three bars:

- `requireProtectedBranch`, plus `minAiGovernedRate: 100`, for T0 and T1;
- `minAiGovernedRate: 90` for T2;
- `forbidPostures` for T0.

The fleet snapshot carries `protected`, `govReadable` and `aiGovernedRate`, and `evaluateGateLite` evaluates
all three. So a T0 or T1 repo with a readable, unprotected default branch fails the check run but passes in
the MCP verdict and the fleet view. `handlers.ts:99-100` promises the opposite: "an agent must never be told it
would pass a bar that CI then blocks".

**Cost if left.**

- **The manifest layer (#5) has to land on two to four surfaces.** The fold reserves a `manifest` slot for it
  (`gate.ts:12`, route `:261-262`). Every surface that is missed becomes a gate that disagrees with the
  merge-blocking one.
- **Each surface also repeats the read-failure rule.** It fails closed on the org and admission reads, but not
  on the ledger read: `loadCheckStates` swallows a failure to `null` with a `console.warn` only
  (`gate-admission.ts:84-87`).

The defect class is "two gates, two bars". The ADR on the fail-closed gate and the header of
`gate-admission.ts` (`:4-5`, "the public endpoint and the merge-blocking Check Run cannot drift into enforcing
different bars") both treat that class as the one to prevent.

**Smallest change.** Add one resolver to `gate-admission.ts`, the IO seam both gate surfaces already call:
`resolveEffectiveGatePolicy({ orgSlug | owner, repoFullName, archetype, explicit? })`. It returns
`{ policy, orgPolicy, admission, checkStates }` and carries the existing throw-on-read-failure contract.

- The gate route and `runPrGate` call it. The route keeps its documented no-org-policy branch, where params
  pad the archetype default (`route.ts:284-290`), as an `explicit` mode of the resolver.
- MCP `gate_verdict` calls it per repo.
- The fleet view is a separate choice; see the ADR candidates.

`logGateVerdict`'s `policySource` comes out of the same return value.

**Files:**

- `src/lib/scoring/gate-admission.ts`;
- `src/app/api/gate/[owner]/[repo]/route.ts`;
- `src/lib/github/pr-gate.ts`;
- `src/lib/mcp/handlers.ts`;
- tests: `route.admission.test.ts`, the pr-gate tests, the MCP handler tests.

**Operator decision:** none for the route, the check run and MCP. **The fleet view needs a decision.** It shows
"one org bar" on purpose (`governance.ts:1-4`, `:121`). Whether it should show each repo's *effective* bar is a
product choice, and is ADR candidate 3.

### 3. The regression-alert cooldown is in process memory, stamped before a one-attempt send

This is the push-triggered-rescan full round 1's only must-address (craft-1). It is checked here against
`f91571d2`.

**Evidence.**

- **The cooldown lives in process memory.** It is a `globalThis` Map (`alerts.ts:61-64`).
  `claimRegressionAlert` stamps `now` at the claim, before any send (`alerts.ts:73-84`).
- **A failed send keeps the stamp.** `alert-door.ts:140-142` takes the cooldown keys, and `:147-157` dispatches
  once (`dispatchAlert` has no retry loop). A failed send releases only the *window* claim (`:158-163`,
  `if (!delivered && claimId)`). The cooldown stamp stays, so the repo is muted for
  `DEFAULT_REGRESSION_COOLDOWN_MINUTES = 360` (`alerts.ts:49`).
- **Two drains, two maps.** The push drain (webhook invocation) and the cadence drain (cron) run in different
  instances, so each has its own Map: one can double-alert while the other suppresses.
- **The same mechanism serves more than the regression alert.** `scan-alerts.ts:169`, `:205`, `:228` and
  `:374` use it, as does `standard/conformance-alerts.ts:91` (the control-flip alerts).

**Cost if left.** "Posts a regression alert if maturity drops" is the push-rescan feature's stated outcome. One
Slack 5xx mutes a repo for six hours, and nothing retries. The control alerts share the defect. Every new alert
kind that picks `claim: { cooldown }` inherits it.

**Smallest change, in two steps that can ship apart.**

1. **Release on a failed send.** When `delivered` is false, un-stamp `claimedKeys`, mirroring the
   `releaseAuditClaim` branch beside it. This needs one exported `releaseRegressionAlert(keys)` in `alerts.ts`
   and three lines in `alert-door.ts`. It closes "stamped in front of a one-attempt send".
2. **Make the cooldown durable.** Move the cooldown to the shared store the door already has for windows:
   `claimOrgAuditOnce` / `releaseAuditClaim` (`alert-door.ts:128-139`, `db/scans-audit.ts:130`), keyed per
   repo. It closes the cross-drain split.

**Files:**

- `src/lib/alerts.ts`;
- `src/lib/alert-door.ts`;
- for step 2: `src/lib/db/scans-audit.ts` (a per-key variant), `src/lib/scan-alerts.ts`,
  `src/lib/standard/conformance-alerts.ts`;
- their tests.

**Operator decision:** none.

---

## Later

### 4. Replay dedup is keyed on the unsigned delivery header, and skipped without it

**Evidence.**

- **The HMAC covers only the body.** `verifyWebhook` signs `rawBody` alone (`app.ts:406-413`).
- **The dedup key is a header the signature does not cover.** It is `x-github-delivery` (`route.ts:664`).
- **Dedup runs only when that header is present** (`route.ts:665`, `if (delivery) { ... }`).

A captured, validly signed body can therefore be replayed without limit in two ways: with a fresh header value
each time, or with no header at all. The 24-hour claim horizon (`REPLAY_HORIZON_MS`, `route.ts:135`) does not
apply to either.

**Cost if left.** The PR-gate lane has no throttle. Each replayed `pull_request` or `check_run` delivery does
the following, all on the victim installation's rate budget:

- mints a token;
- runs two full mock scans (head and base, `pr-gate.ts:100`, `:164`);
- writes a check run.

The push lane is bounded by the 15-minute bucket (`push-rescan.ts:164-167`), but each new window buys another
metered scan. The precondition is a captured signed delivery (from a log, a proxy, or someone who can read the
App's delivery history), so this ranks below the three above.

**Smallest change.**

1. Refuse a signed request that carries no `x-github-delivery` (400). This is one branch, and a builder can do
   it alone today.
2. Key the claim on something the signature covers: `sha256(raw)`, alone or joined with the header.

The second step is a shape choice. Two genuine deliveries can have byte-identical bodies, for example two
Re-run clicks. That is ADR candidate 1.

**Files:** `src/app/api/app/webhook/route.ts`, `src/lib/db/webhook-deliveries.ts`, `route.test.ts`.

**Operator decision:** none expected. The App Master can take the ADR.

### 5. The Action's response contract is pinned for inputs but not for outputs

**Evidence.**

- **The input direction is pinned.** `gate-action-inputs.test.ts` traces the chain
  `describeGatePolicy` → `action.yml` input → CLI flag → query param → parsed policy.
- **Nothing pins the output direction:** route status and body → `maturity-gate.mjs` exit code and outputs →
  `action.yml` `outputs:`.
- **One output is written but never declared.** The script writes `skipped` (`maturity-gate.mjs:91`), but
  `action.yml:114-132` does not declare it, so a workflow cannot read it (pr-maturity-gate r1,
  robustness-3).
- **The route's 503 has two meanings:** `degraded` and `unmeasured` (`route.ts:350`). The script gives only
  `degraded` its own status. An `unmeasured` 503 falls through to `status: error` (`maturity-gate.mjs:181-185`),
  so a workflow cannot tell "you asked for a bar this endpoint cannot measure" from an outage.
- **`main()` is never executed by a test** (robustness-1). `gate-cli.test.ts` imports only the formatters.

**Cost if left.** The Action is the one surface other people's CI keys on. A change to a route status or body
field ships green and silently changes their exit codes.

**Smallest change.**

1. Extract a pure `interpretGateResponse(status, body)` in `maturity-gate.mjs` that returns
   `{ exitCode, status, outputs }`, and make `main()` a thin shell around it.
2. Table-test it against every status the route can return.
3. Add a test that `action.yml` declares every key `outcome()` writes.
4. Add an `unmeasured` status value.

**Files:** `scripts/maturity-gate.mjs`, `action.yml`, `src/lib/scoring/gate-cli.test.ts`.

**Operator decision:** none. Adding the output and the status value is additive to a published contract. Note
that the snippet's `<owner>/ascent@v1` has no `v1` tag in the checkout (value-snippet-placeholder), and that is
the operator's release question, not part of this change.

### 6. Installation tokens are whole-installation scope, and one consumer retries a 401

**Evidence.**

- **Tokens are minted with no scope.** `getInstallationToken` sends no `repositories` or `permissions` body,
  and the cache key is the installation id alone (`app.ts:213-239`, key at `:217`).
- **There are 18 call sites in 14 files outside `app.ts`.** They include:
  - `pr-gate.ts:86`, `scan-queue-worker.ts:101`, `registry/registry-push.ts:91` and `:99`, `scan.ts:162`;
  - `github/pr-route.ts:77`, `db/improvement.ts:296` and `:498`;
  - `api/org/gate-policy/route.ts:82`, `api/org/import/route.ts:211`.
- **Only the repo listing turns a 401 into a re-mint** (`app.ts:365-374`).

**Cost if left.**

- **Every consumer holds the widest token the installation can issue.** A gate scan of one repo holds a token
  that can write checks and PRs to every repo in the installation. Anything that leaks a token (a log, an error
  body, a prompt) has the maximum blast radius.
- **Revocation abandons work.** The settled skew margin covers expiry, but not an early revocation or rotation.
  On every other consumer, a 401 abandons the work.
- **Scope is expensive to add later.** It changes the cache key, so it touches every caller at once.

**Smallest change.** Add `withInstallationToken(id, fn, scope?)` in `app.ts`. It keys the cache on
`id + scope`, runs `fn`, and on an `AppApiError` 401 invalidates and retries once. It is additive. Migrate the
three long consumers first (`pr-gate`, the queue worker's `OrgContext`, `registry-push`), then the rest as they
are touched. The App-path ADR already says nothing forbids the 401 half. The scope half is ADR candidate 4.

**Files:**

- `src/lib/github/app.ts`;
- then the callers above (about 14 files);
- `src/lib/github/app.test.ts`.

**Operator decision:** none. Narrowing within the permissions the App already holds needs no App-settings
change.

### 7. The delivery-claim store fails open, and the route's fail-closed branch is dead

**Evidence.**

- **The store fails open.** `claimWebhookDelivery` catches every DB error and returns `true`
  (`db/webhook-deliveries.ts:44-47`).
- **So the route's handling of a thrown claim never runs.** That branch rolls back the in-memory record and
  answers 500 "so GitHub retries" (`route.ts:668-679`). Only a mocked throw reaches it (push r1, robustness-2
  and craft-2).
- **The comments describe a contract that is false twice over.** The `:651-652` and `:674-675` comments say
  GitHub retries on a 500, and the branch they describe is unreachable.

**Cost if left.** The runtime cost is low: during a DB blip a replay is processed instead of refused, which
matters only with finding 4. The structural cost is that two layers each own the policy and disagree. The next
editor will reason from the route's comment. Craft-9's reading, that fail-open is defensible because GitHub
does not redeliver, is a valid argument, but it should be written down once.

**Smallest change.** Choose one owner and one policy (ADR candidate 2):

- **keep fail-open:** delete the route's dead catch branch and state the policy at the claim;
- **switch to fail-closed:** make the claim throw and keep the route's branch.

**Files:** `src/lib/db/webhook-deliveries.ts`, `src/app/api/app/webhook/route.ts`, `route.test.ts`.

**Operator decision:** none expected.

### 8. One delivery claim spans several `after()` tasks with different release policies

**Evidence.** One claim (`route.ts:664-683`) covers every `after()` task a delivery schedules. The tasks
disagree on release:

| Delivery | Task | Release on failure? | Where |
|---|---|---|---|
| `push` | `runPushRescan` | yes, before a job row exists | `:776` |
| `push` | `onRegistryPush` | never, by design | `:777-785` |
| repo-control events | `enqueueControlProbe` | yes, on owner mismatch | `:323-325` |
| repo-control events | `recordControlAttribution` | never | `:796-810` |
| `pull_request` | `runPrGate` | yes | `:727-729` |
| `pull_request` | `reduceAiChangeEvent` | never | `:735-738` |

A release by one task re-runs all its siblings on redelivery. Each new event lane decides its failure policy
inline, in an 837-line route that holds seven handlers.

**Cost if left.** A redelivered push re-runs the registry pass. A redelivered control event can write a second
attribution observation (`recordObservations` carries `deliveryId`, but this review did not check whether that
dedups). The more lanes a delivery fans out to, the less a release means.

**Smallest change.** Turn the route into a declared table: `event → handlers[]`, where each handler names its
failure policy (`release | keep`). Move the handlers out to `src/lib/github/webhook/*`, which is pure
relocation: a route file may export only HTTP names, which is why `pr-gate.ts` and `push-rescan.ts` already
live outside the route. Worth doing when the next lane is added, not before.

**Files:** `src/app/api/app/webhook/route.ts`, new `src/lib/github/webhook/*`, `route.test.ts`.

**Operator decision:** none.

### 9. Nothing recovers a lost App delivery

**Evidence.**

- **The release net assumes a redelivery that never comes on its own.** Every `abandonDelivery` frees the claim
  for a redelivery. GitHub does not redeliver on its own (craft-3 and craft-13, across all three councils), and
  no sweep in the repo asks it to.
- **One residue is already accepted.** The fail-closed ADR accepts it: with no token minted, a required check
  stays pending (`pr-gate.ts:206`).

**Cost if left.** Today it cannot be sized, which is why finding 1 comes first. Once failures are counted, this
becomes a measured decision instead of a guess.

**Smallest change.** Three shapes (ADR candidate 5):

1. a cron sweep that lists the App's failed deliveries and asks GitHub to redeliver them;
2. enqueue-before-2xx for the PR gate, generalising the push-rescan ADR;
3. accept the loss and document it.

**Files:** depends on the shape.

**Operator decision: yes.** A sweep is a new cron on a deployment with a known cron-frequency limit. Option 2
moves the merge-blocking check onto the queue's latency. Both are the operator's to weigh.

---

## Not worth it now

### 10. The gate route's warm-row fast path rests on a false premise

The route probes the persisted tier first because "the GitHub App webhook has usually ALREADY scanned and
persisted this very sha" (`route.ts:123-129`). That premise is false at this head:

- **The check-run path persists nothing.** `runPrGate` calls `scanRepository`, which does not persist (persistence
  is the routes' `cacheAndPersistScan`).
- **The push rescan persists elsewhere.** Its row is under the org slug, with an LLM engine.
- **The probe reads elsewhere.** It reads `orgSlug "public"` with `useLLM = !mock`.

So every Action call is a cold ingest (pr-maturity-gate r1, economics-2). Making the premise true would have
the unauthenticated endpoint read org-scoped rows. That is the class of exposure the ambient-token ADR closes
for private repos, so it is not a cheap structural fix. **Correct the comment only.**

### 11. `gate.ts` is 1008 lines

It is pure and imports only types, the model, `gate-numeric` and `check-ids`. It holds a single evaluator
(`evaluateNormalized`, `:552`) behind two adapters, so the CI gate and the fleet view cannot fork the rules.
About 430 of its lines are comments. A table-driven structural guard in `gate.test.ts` pins the four-edit
contract for a new bar. Churn is moderate (5 commits in 30 days).

A themed split with `gate.ts` as a barrel (policy and sanitize, describe, evaluate, params and fold) would
change no call site across its 23 importers. It would not, however, remove any defect class this review found.
Finding 2 is the one that matters, and it lives *outside* this file. Revisit when the manifest layer lands.

---

## ADR candidates (not written)

1. **What identifies a webhook delivery for replay defense.** The options:
   - the unsigned `X-GitHub-Delivery` header (today);
   - a hash of the signed body;
   - both.

   Also: whether a missing header is refused. The trade: body-hash dedup can collapse two genuine
   identical-body deliveries within the horizon. (Finding 4.)
2. **Who owns the delivery-claim failure policy, and is it open or closed.** Fail-open processes during a DB
   blip and accepts duplicates. Fail-closed answers 500 and loses the event unless someone redelivers by hand.
   (Finding 7. It pairs with candidate 1 and should probably be one record.)
3. **Which bar the fleet view and the MCP verdict show:** the org's bar, or each repo's effective bar with the
   admission overlay. MCP's comment already promises parity with CI. The fleet view's "one org bar" is a
   deliberate product statement. (Finding 2.)
4. **Installation-token scope per consumer:** the whole installation (today), or narrowed to the repos and
   permissions each consumer needs, with the cache keyed on scope. (Finding 6.)
5. **How a lost App delivery is recovered:** a redelivery sweep, enqueue-before-2xx for the PR gate, or
   accepted loss. (Finding 9. Needs the operator.)

## Builder alone, or needs the operator

- **A builder can do these without a decision:**
  - findings 1, 3 and 5 in full;
  - finding 2 for the route, the check run and MCP;
  - finding 4's missing-header refusal;
  - finding 6's 401 wrapper;
  - finding 8 when a lane is next added;
  - finding 10's comment.
- **A builder can do these after the App Master records an ADR:** finding 4's signed key, finding 7, finding
  6's scope narrowing, and finding 2's fleet half.
- **These need the operator:** finding 9, and finding 2's fleet half if the App Master treats "what the
  dashboard's pass-rate means" as a product decision.

## Examined and found sound

- **The webhook front door, in order:**
  1. a bounded body read before the HMAC (`body-limit.ts`, 25 MB, `Content-Length` checked and the stream
     counted);
  2. signature verification with `timingSafeEqual` (`app.ts:406-413`);
  3. a JSON parse *before* the claim, so a 400 never consumes it (`route.ts:653-663`);
  4. a rollback of the optimistic in-memory record on a thrown claim (`:676`).
- **Destructive installation events are confirmed with GitHub before they act:**
  - `deleted` requires a 404 and `suspend` requires `suspendedAt` (`confirmRevocationWithGitHub`, `:207-224`);
  - `suspend` pauses without destroying, and `unsuspend` resumes (`:593-605`);
  - `created` and `unsuspend` store GitHub's account, not the payload's (`:572-577`).
- **The owner binding fails closed on a lookup error** (`installationMatchesOwner`, `:143-156`), and an unknown
  owner is confirmed with GitHub (App JWT) and then persisted.
- **The access reconcile is safe.**
  - It never trusts `repositories_removed` (`:702-713`).
  - It skips the destructive reconcile on a truncated listing (`:260-265`).
  - The `reconcile` listing depth is bounded by pages and by time (`app.ts:298-301`).
- **Control events re-read the truth** rather than trusting the payload. The attribution row copies the current
  state, so it cannot assert or mask a transition (`:371-384`).
- **The push rescan follows its settled ADR.** It enqueues once per aligned bucket and drains exactly that job.
  The money lives in the worker, the delivery is released only when no row exists, and the drain deadline is
  measured from the invocation (`push-rescan.ts:199-233`).
- **The token cache margin is derived from `LONGEST_TOKEN_CONSUMER_MS`** and pinned against every route's
  `maxDuration` (`app.ts:194-205`). A malformed expiry forces a re-mint (`:221-226`). The JWT backdate is kept
  separate.
- **The gate evaluator.**
  - There is one evaluator behind two adapters.
  - The split is principled: a non-finite score fails, and an honest null skips with a named reason
    (`gate.ts:534-551`).
  - A floor on a missing dimension fails closed (`:623-637`).
  - An incomplete report short-circuits to one honest failure (`:762-764`).
  - The fold is tighten-only (`:968-1008`).
- **The public endpoint.**
  - Every ingest is token-less (`noAmbientToken`, `route.ts:148`, `:197`).
  - It writes nothing but its own caches (`:82-87`).
  - The org-policy and admission reads fail closed with a 503 (`:236-281`).
  - A degraded report is never written to the cache (`:206`).
  - An explicit unmeasurable bar answers 503 rather than 200 (`:335-350`).
  - Rate limiting is applied only to the branches that ingest (`:88-111`).
- **The check-run path.** It never posts `neutral`, and the fallback is `failure` with a Re-run button
  (`pr-gate.ts:199-218`). The fork default-branch fallback is marked non-authoritative.
- **`action.yml` input handling.** Every input reaches bash through `env:`, never through `${{ }}` in `run:`
  (`action.yml:139-195`). `ref` resolves to the PR head in step env (`:153`).

## Drift noticed (recorded, not fixed: this run changes no code or feature doc)

- **`src/app/api/org/gate-policy/route.ts:73` says `runPrGate` "posts a neutral check when it can't
  evaluate".** Since the fail-closed ADR it posts `failure`.
- **`docs/features/scanning/gate.md:172` says the PR gate "releases the delivery for GitHub to redeliver".**
  GitHub does not redeliver on its own.
- **Several route comments say a 500 makes GitHub retry** (`route.ts:651-652`, `:674-675`), and so does the
  header at `:21-23`. GitHub does not redeliver on its own (finding 9), and the `:668-679` branch they describe
  is unreachable (finding 7).
- **The replay defense is not in the feature doc.** `docs/features/github/github-app.md` does not describe the
  24-hour delivery claim, the release-on-failure net, or the claim's fail-open policy.
- **The Action's runtime is out of date.** `action.yml:136-138` pins `actions/setup-node@v4` with Node 20, which
  pr-maturity-gate r1 (craft-1) reports as removed from GitHub runners on 2026-09-23. This is current practice,
  not structure, and is not ranked here.
