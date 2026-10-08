# GitHub App

The GitHub App is how Ascent reaches **private and org-wide repos** without a personal
token, gates pull requests automatically, and re-scans on push. A user installs the App on
an org/account; Ascent stores the installation, mints short-lived installation tokens to
read repos and write checks/comments/PRs, and surfaces the org's repos on the
[onboarding](#install-entry-the-connect-page-is-retired-2026-08-29) wizard. The intended setup is documented in
[GITHUB_APP.md](./setup.md); this doc covers the implemented surface.

## Lifecycle

```
install on GitHub  →  /api/app/setup?installation_id=…&setup_action=install
  ↓ fetch account login, upsert installation, redirect
/onboarding?org=<login>&installation_id=<id>  →  the wizard opens on that org (watch / schedule set at import, or later on the Repositories tab)
  ↓ thereafter
/api/app/webhook  ⇐  GitHub events (installation / pull_request / push)
```

## Auth (`src/lib/github/app.ts`)

The App authenticates in two hops and caches the result:

1. **App JWT**: `createAppJwt()` signs a short-lived (10-min) RS256 JWT from
   `GITHUB_APP_PRIVATE_KEY` + `GITHUB_APP_ID` (issued 60s in the past for clock skew).
2. **Installation token**: `getInstallationToken(installationId)` exchanges the JWT for
   a ~1-hour installation access token (`POST /app/installations/{id}/access_tokens`),
   **cached in memory** per installation. On `401` (suspended/uninstalled),
   `invalidateInstallationToken()` drops the entry and re-mints (self-healing).

`githubAppFetch<T>(path, auth, init)` wraps calls with standard headers and throws
`AppApiError` (carrying the HTTP status) on non-2xx. `isAppConfigured()` gates the whole
feature on the env vars being present; `listInstallationReposResult(id, depth)` pages through
accessible repos and reports `truncated` when the walk stops at its bound before `total_count`
is exhausted. The `interactive` depth (the default, used by `GET /api/app/repos`) keeps the
50-page / 5000-repo cap. The `reconcile` depth (the webhook's watch reconcile) walks up to 500
pages / 50,000 repos and starts no new page once 180 s have elapsed, so the worst case is about
210 s inside the webhook's 300 s `maxDuration` and at most 500 requests against the installation
token's hourly rate limit (`listInstallationRepos` is the thin array wrapper);
`verifyWebhook(rawBody, signature)` does the HMAC-SHA256 check against
`GITHUB_APP_WEBHOOK_SECRET`.

`appInstallUrl()` builds the user-facing install link from `githubWebBase()` (`GITHUB_SERVER_URL`,
default `https://github.com`) and `GITHUB_APP_SLUG`. GitHub.com keeps `/apps/<slug>/installations/new`;
a GHES web host (hostname not `github.com`) uses `/github-apps/<slug>/installations/new` on that host.
Returns `null` when the slug is unset. JWT minting and `githubAppFetch` are unchanged — those already
talk to `githubApiBase()`.

### The server's own token never answers for a private repo (2026-10-08)

With the App configured, `GITHUB_TOKEN` only raises rate limits on public repos; a private repo is read
through an installation token or not at all. `resolveScanAuth` keeps the ambient token for an owner with
no stored installation (the anonymous public funnel needs it), and that includes an owner whose App was
just uninstalled, so an operator token that can read the repo would otherwise answer for it to an
anonymous caller.

The first line of defence is a visibility check. Before the ambient token touches anything on the scan
routes, `guardAmbientToken` (`src/lib/github/visibility.ts`) makes one conditional
`GET /repos/{owner}/{repo}` with it. A repo proven public keeps the token; a private repo, or one the
check cannot prove public (404, rate limit, error), runs the rest of the request with no credential. So
the peek's head headers and a `?ref=` resolve answer a private repo exactly like a missing one, as the
ingest does. The ETag is remembered, so a warm unchanged repo costs a free `304`. Details and the cost:
[the peek contract](../scanning/scan.md#the-peek-contract-and-how-a-private-repo-is-answered-2026-10-08).

The backstop stays. `runScanRepository` refuses, right after ingest and before the memory mirror,
any model call or any persist, when the ingest used the ambient token (no `opts.token`, no injected
`opts.source`) and the snapshot is private: it throws the same `NOT_FOUND` "Repository not found or is
private." a missing repo raises, so the two are indistinguishable. Installation-token callers (webhook,
queue worker, import), injected sources (local mode, the loop lane) and deployments without the App are
unchanged. The refusal is a non-delivery, so the routes refund the quota slot and no credit is reserved.

## Webhook (`src/app/api/app/webhook/route.ts`)

`POST /api/app/webhook` verifies the signature, then handles:

| Event | Action |
| --- | --- |
| `installation` (created / deleted / suspended) | Sync stored installations (`upsertInstallation` / `removeInstallation`). |
| `pull_request` (opened / synchronize / reopened / ready_for_review) | Run the PR maturity gate: score the PR head, diff vs base, post a Check Run + sticky comment (see [gate.md](../scanning/gate.md)). Falls back to the default branch when a fork head commit is unreachable. |
| `installation_repositories` (added / removed) | The user changed *which* repos an installation can see. Deliberately **no payload-trusting fast path**: a deferred `reconcileInstallationRepos` re-lists the installation's live repos from GitHub (at the `reconcile` depth, so installations past 5000 repos reconcile too) and unwatches only what GitHub confirms is gone. The same listing also **auto-watches newly granted repos** (`src/lib/db/install-grants.ts`): for an org that already has a non-empty watchlist, a live repo the org has no Repository row for is watched through the import path (watched, `weekly` cadence), on hosted and self-hosted alike. At most **20 per org per event**; the rest stay unwatched, are logged, and are listed in an `org.repos.auto_watched` audit row (Admin → Audit), and a later grant event can pick them up. A repo the org already has a row for is never re-watched, because a stored `watched: false` may be a person's explicit unwatch. No credit is reserved at watch time; the scan that follows pays like any other. A listing that still comes back `truncated` skips both the unwatch and the auto-watch rather than treating a partial list as the live set. |
| `check_run` (rerequested / requested_action `rescan`) | A "Re-run" click or GitHub's native rerequest — re-evaluate the gate for the PR the run is attached to, with no new push. |
| `push` (default branch moved) | Re-scan **watched repos on an autoscan cadence** (`runPushRescan`, gated on `isRepoAutoscanned`: watched AND `scanSchedule` not `off`, DB-gated, **throttled**, see below) and alert on regressions (see [alerts.md](../fleet/alerts.md)). The same push also reaches the **registry lane** (`onRegistryPush`, a second `after()`). A push to the org's mapped registry sets `webhookHealthy` and re-indexes it. A fleet repo's push that touches `.ai/registry-map.json` or `.ai/manifest.yaml` re-sweeps that repo (see [org-registry](../org-registry/README.md#when-a-pass-runs-and-the-one-door-it-goes-through-2026-09-23)). A failure there is logged and never releases the delivery. |
| `branch_protection_rule`, `repository_ruleset`, `repository` | Enqueue a **free control probe** of that repo (moonshot #10) **and** record a control *attribution* row (moonshot #1, below). A GitHub-confirmed `repository.deleted` (owner matches the installation) **unwatches that `fullName` only** — the same `reconcileWatchedRepos` drop used when a repo leaves the installation set. A forged owner mismatch does not unwatch. Archived stays watched. |
| `member`, `team` | Owner-level access moved: enqueue probes across the org's watched repos (capped at 200). Writes no membership or RBAC row — identity-graph modelling is a separate item. |
| `pull_request_review` (submitted, approved) | Record the approving review as `AiChange` evidence within seconds instead of at the next scan's cadence (moonshot #1, below). |
| `pull_request` (closed, merged) | Record the merge as `AiChange` evidence, alongside the gate arm above. |

### The payload is never trusted for control STATE

A `branch_protection_rule.deleted` delivery means **"re-read this repository"**, never "protection is
off". A validly-signed but replayed or misrouted delivery would otherwise write a false governance
record that outlives it; only the probe's own re-read from GitHub produces a control state.

There is also a mechanical reason, and it is the sharper one: the probe diffs against the *newest*
observation, so a payload-sourced `fail` row would become that newest observation, the probe's
confirming re-read seconds later would find nothing changed and write nothing, and the alert path —
which reads `transition: true` rows — would never fire. Payload-sourced state would **swallow the
alert it was meant to raise**.

What a delivery *does* carry that a probe can never recover afterwards is **who acted and when**.
`normalizeGovernanceEvent` (`src/lib/github/governance-events.ts`) extracts exactly those, and the
handler writes one **attribution row** per affected control whose `state` and `value` are copied
*unchanged* from the current observation. Because the pair does not move, the row is not a
transition, cannot mask the probe's, and asserts nothing about the control — it records
"GitHub told us `<login>` touched this control area at `<time>`". A control with no prior observation
gets no attribution row: there is nothing to attribute against, and inventing a baseline from a
payload is exactly what this design refuses.

### Live AI-change evidence

`pull_request_review` (approved) and `pull_request.closed` (merged) write `AiChange` rows with
`source: "webhook"` and `approvalObservedAt` (the *delivery's* arrival, distinct from the review's
own `approvedAt`). AI involvement is decided by `readAiInvolvement`, **imported** from
`src/lib/analyze/pulls.ts` rather than re-implemented — two detectors would let the conformance
pack's count and its own percentage disagree about who is in the population.

Two honest limits:

- **A webhook approval is never downgraded.** `approved` is only ever set to `true` on this path, and
  a later scan does not clear it. Observing an approval proves it happened; *not* observing one
  proves only that we did not see it, and a scan whose PR window has slid past the review would
  otherwise erase a true approval and turn a governed change into an audit finding.
- **The `trailer` detection channel does not work here.** It needs commit messages the payload does
  not carry, so a trailer-only AI PR is invisible to this path and is picked up at the next scan — a
  bounded under-count in the direction the pack already discloses (the population is a lower bound),
  never an over-count.
- A repository that has never been scanned has no `Repository` row, and this path does **not** create
  one: an `AiChange` with no scan behind it would enter the conformance population as evidence from a
  repository the product has never assessed.

### Which repos a push rescans (2026-10-08)

`runPushRescan` gates first on `isRepoAutoscanned(org, fullName)` (`org-watch.ts`): the repo must be
**watched AND its `scanSchedule` must not be `off`**, the same predicate the scheduled lane
(`listDueRescans`) uses. **"No autoscan" stops push rescans too.** A repo on `off` is a deterministic
no-op: no credit reserved, no installation token, no owner-confirm call, and the delivery is not
released. Onboarding enrolls repos `watched: true` with schedule `off` by default, so a one-time
import does not become a stream of metered push rescans. The UI says so beside every cadence control
and in the onboarding cost disclosure (`PUSH_RESCAN_DISCLOSURE`, `src/lib/org/repo-schedule.ts`): a repo
on any cadence is also rescanned on a default-branch push (throttled per repo), each push rescan is a
metered scan (monthly allowance first, then one prepaid credit; free on self-hosted), and the
onboarding estimate covers the cadence only, push rescans come on top.

### Push rescan throttle

A push rescan is a real, LLM-billed scan, so `runPushRescan` enforces a **per-repo minimum
interval** before calling `scanRepository`. The window state is the **prior persisted scan's
`scannedAt`** (the report the rescan already reads as its regression baseline), so the throttle
costs no extra query, needs no new infrastructure, and is **cross-instance** (a webhook fleet
shares one window per repo, unlike a process-local map). The check runs *inside* the
`serializePerRepo` critical section, so a burst's second run reads the first run's freshly
persisted timestamp instead of racing it.

| Setting | Default | Meaning |
| --- | --- | --- |
| `PUSH_RESCAN_MIN_INTERVAL_MINUTES` | `15` | Minimum minutes between push-triggered scans of the same repo. `0` disables the throttle (every default-branch push scans). |

### A push rescan pays for itself (2026-09-05)

"LLM-billed" was, until 2026-09-05, a description with no debit behind it: `runPushRescan` ran real
inference with no credit reservation, so a watched org at balance zero kept scanning free on every
push and the throttle was the only cost ceiling. It now mirrors the queue worker's money loop
(`reserveScanCredit` / `refundScanCredit` / `shouldRefundScan`, `src/lib/scan-credit.ts`):

- **Reserve before inference**, on a metered scan (`isMeteredScan`; self-hosted, DB-less and the
  public org are exempt and stay free). The ledger row carries actor `webhook:push` and the repo,
  so push-driven spend is separable from `queue:*` and interactive spend.
- **Out of credits → the push is skipped**, never served free. A webhook has nobody to 402, so the
  skip is recorded on the repository (`recordScanOutcome`, the worker's precedent: `lastScanStatus`
  / `lastScanError` = "insufficient credits", visible on the Repositories tab) and logged as
  `insufficient_credits`. The delivery is deliberately not released for redelivery (an empty wallet
  is not transient). The throttle is derived from the prior *persisted* scan, so a credits-skipped
  push opens no window: a topped-up org scans on its very next push.
- **Refunds** on degrade-to-mock, on a dedup (unchanged head), and on a failure *before* a real
  report exists; a failure after real inference keeps the credit, as in the worker.
- `maybeAlertLowCredits` fires on a push-funded crossing exactly as it does for `/api/scan`.

### A push rescan scans on the org's own engine (2026-10-08)

`runPushRescan` calls `scanRepository(fullName, { token, orgSlug })` with the installation's org, the
same call shape as the queue worker. Until 2026-10-08 it passed no `orgSlug`, so `getProviderForOrg`
never saw the org: a BYOM org's pushed private repos were assessed by the **platform** provider, and
the standing-decision read had no org. With the org, a BYOM org scans on its own engine (a BYOM
failure degrades to mock, never to the platform; the mock report is then discarded as below), and
the report is scored against the org's standing decisions like a manual scan. Metering
(`isMeteredScan`), the credit reservation and the throttle are unchanged. Because the org now reaches
the scan, the `.ai/memory` mirror's private-repo gate matters on this path too (see
[memory.md](../org-knowledge/memory.md#the-six-gates-all-fail-closed)).

### A degraded rescan is discarded, not persisted

The push rescan asks for a real LLM grade. When the provider is unavailable `scanRepository`
still returns a report: stamped `engine.provider = "mock"`, the deterministic **floor**
rather than a measurement. `runPushRescan` therefore **skips both the persist and the
regression alert** on such a report: storing it would make the floor the repo's current
public reading *and* the next run's baseline, and the alert would diff a real prior scan
against our own outage and tell the customer their repo regressed. During a provider outage
that would fire fleet-wide at once. This mirrors the `authoritative` gate the interactive
scan routes apply in `scan-finalize.ts`.

The delivery is deliberately **not** released for redelivery: an outage would degrade the
retry too, so releasing turns one outage into a scan storm. The repo is covered by the next
push past the throttle window, or by its scheduled autoscan.

### Every App API call is time-bounded

`githubAppFetch` routes through `host.ts`'s `fetchWithTimeout` at **30s**, covering the
response body as well as the headers. That budget applies to the whole App surface: token
minting, `getInstallation`, the paginated installation-repo listing, and every Check Run and
sticky-comment write. It matters most inside the webhook's `after()` work, where
`createCheckRun` retries three times and `upsertStickyComment` can walk many pages; without
a bound, one hung connection there costs the required merge status. A caller-supplied
`init.signal` is combined with the timeout rather than replaced.

15 minutes is longer than a median scan (~6 min), so bursts can't queue scans back-to-back, and it
caps push-driven spend at ≤4 scans/hour/repo.

A push inside the window is **dropped, not deferred** (the handler has no background worker; the
work runs in the request's `after()`, bounded by `maxDuration`). It is not usually lost: a scan
always reads the repo's *current* default-branch head, so the next push past the window covers every
commit coalesced in between, in one scan. If pushes stop inside the window, the trailing head is
picked up by the repo's **scheduled autoscan** (`/api/cron/rescan`) or a manual rescan, so a repo
with a cadence can sit up to one window behind until its next push. A repo on `off` is never push-scanned at all.

## Setup & repos routes

| Route | Method | Role |
| --- | --- | --- |
| `/api/app/setup` | `GET` | Post-install redirect: fetch the installation's account login, `upsertInstallation`, bounce to `/onboarding?org=…&installation_id=…`. |
| `/api/app/repos` | `GET` | List the installation's repos (`?org=` or `?installation_id=`), merged with the DB watch/schedule state. Body includes `truncated: true` when GitHub's listing hit the page cap (the `repos` array is incomplete; overflow is not visible to watch/scan). |

## Installations storage (`src/lib/db/installations.ts`)

Installations are stored on the `Organization` model (see [data-model.md](../data/data-model.md)):
`slug` (lowercased owner login), `name`, `githubInstallId`, `plan` ("private").

| Function | Behavior |
| --- | --- |
| `upsertInstallation({login, installationId})` | Upsert by slug; tolerates the setup-vs-webhook race (Prisma P2002 → update the winning row). |
| `removeInstallation(installationId)` | Clear `watched`/`scanSchedule`/`nextScanAt` on the org's repos and null `githubInstallId` (revoke). |
| `getInstallationIdForOwner(owner)` | Resolve lowercased slug → `githubInstallId`, or null if not installed. |

## Install entry (the `/connect` page is retired, 2026-08-29)

There is no longer a dedicated connect page. `src/app/connect/**` and `src/components/connect/**`
were deleted; `next.config.ts` redirects `/connect` → `/onboarding` (query string preserved, so a
GitHub App whose Setup URL still bounces to `/connect?org=…&installation_id=…` lands on the wizard
with its `?org=` preset). Its jobs moved:

| Was on `/connect` | Now |
| --- | --- |
| "Install on GitHub" entry (`appInstallUrl()`) | The wizard's access gate (`OnboardingGateStep`, `installUrl` prop from the page) when a signed-in viewer isn't a member of the target org. |
| `?error=` banners from `/api/app/setup`, both auth callbacks, `/api/auth/login`, `/api/auth/revoke-sessions` | `OnboardingErrorBanner` on `/onboarding` (`ONBOARDING_ERROR_COPY` covers every code those routes emit, including `auth_required`, `forbidden`, `auth_stack_retired` which used to fall through to "Something went wrong"). |
| Re-sync access / "Sign out everywhere else" (dormant custom-OAuth session) | `SessionControls` on `/onboarding`, rendered under the same `{session && …}` condition. |
| "Where your code goes" privacy disclosure | `ScanPrivacyNotice` (`src/components/onboarding/PrivacyNotice.tsx`) under the wizard's heading. |
| Per-repo **watch** toggles + **schedule** dropdown + balance chip / cost strip | The org dashboard's **Repositories** tab (`src/features/standing/repositories/`, `ScheduleSelect`); the wizard's autoscan opt-in sets the initial watch/schedule at import. The cadence vocabulary the routes validate lives in `src/lib/org/repo-schedule.ts` (moved from the deleted component folder). |
| Pre-org funnel checklist (`OnboardingChecklist`) | Deleted with the page — nothing else rendered it. |

The pre-onboarding dashboard links that pointed at `/connect` (org shell walls, `OrgFirstScanEmpty`,
`OrgScanButton`, the fleet-map empty state, the report conversion CTA, the header sign-in `next`,
`safeNext()`'s fallback, `/me` and `/launch` bounces) point at `/onboarding` or the Repositories tab.

## Governance signals (`src/lib/github/governance.ts`)

Read-only REST signals folded into the scan (token, not App JWT, required):

- `fetchBranchGovernance(owner, repo, branch, token)` → branch protection + rulesets:
  `requiresPullRequest`, `requiredApprovals`, `requiresCodeOwnerReview`,
  `requiresStatusChecks`, `requiresSignatures`, `linearHistory`, `ruleCount`.
- `fetchCommitActivity(owner, repo, token)` → 52 weeks of weekly commit totals (retries
  `202 still-computing` with bounded backoff).

## Report-back provisioning (`src/lib/github/actions-secrets.ts`)

Ascent can write **exactly two** GitHub Actions secrets into a customer repo, so the `.ai/`
foundation's CI job (`node .ai/doctor.mjs --json`) posts its conformance score to
`/api/report/conformance` instead of printing `reportSkipped`:

| Secret | Value |
|---|---|
| `ASCENT_CONFORMANCE_URL` | `<this deployment's origin>/api/report/conformance`, derived **server-side** (configured public origin, else the request's own) and never from the request body — a caller must not be able to point someone else's CI at a host of their choosing. A self-hosted install therefore provisions report-back to *itself*, with no configuration. |
| `ASCENT_CONFORMANCE_TOKEN` | a freshly minted org API token named `conformance report-back`, scoped `telemetry:write` (it can report a score and nothing else). |

Secrets are sealed with libsodium `crypto_box_seal` against the repo's own public key
(`node:crypto` has X25519 but neither XSalsa20 nor Poly1305, so there is no stdlib path). The module
loads libsodium lazily inside `encryptSecret`, through Node's CommonJS resolver — the package's
published ESM entry imports a file it does not ship — so nothing WASM-shaped enters the build graph.

Four properties make this defensible, and each is structural rather than a convention:

- **The name allowlist is in the TYPE.** `putRepoSecret`/`deleteRepoSecret` accept only
  `ConformanceSecretName`, a two-literal union, so no call site can write an arbitrary secret without
  changing that file — and `tsc` is what refuses.
- **Owner, not admin, plus a typed `owner/repo` confirmation, one repo at a time.** Writing a
  credential has a larger blast radius than a draft PR and is the one action here that takes effect
  with no review step after it. `POST`/`DELETE /api/report/foundation/secrets`.
- **The token is always MINTED, never re-read.** A reused token's raw value cannot be recovered (only
  its hash is stored), so `ensureOrgApiToken(..., { rotate: true })` retires every live token of that
  name and mints a new one — the value written into the repo is always one Ascent just produced.
- **Reversible.** `DELETE` removes both secrets *and* revokes the token, and revokes it even when the
  secret removal failed: a secret can be deleted by hand in GitHub, but a live bearer token nobody
  knows about cannot be noticed.

Three audit actions record it — `foundation.batch_opened`, `foundation.reportback_provisioned`,
`foundation.reportback_revoked` — and the raw token appears in **none** of them; only its `askl_`
display prefix does. The rollout state the Repositories tab renders is derived from those rows plus
the existing `Repository.aiConformance` column (`getFoundationRollout`), so this whole feature adds
no table and no column.

Requires the App's **`Secrets: write`** permission (see [setup.md](./setup.md)). Without it the write
returns a 403 that surfaces as "The installation lacks Secrets write access. Update the GitHub App's
permissions." and the two secrets can still be set by hand.

## Two write shapes: seed a starter, or merge a managed block

`src/lib/github/write.ts`'s `openDraftPr` **refuses to write a path that already exists on the base
branch**, and that refusal is load-bearing rather than a limitation: it seeds STARTER artifacts, so a
PR replacing a real `CODEOWNERS` / `SECURITY.md` / `ci.yml` with a scaffold would delete the
customer's content the moment it merged — fanned across a whole fleet from one click.
The writer preserves slash-separated base branches in the GitHub ref path when it reads their head.

Moonshot #8 needs the opposite shape — write INTO a file the customer already owns — so it got a
**sibling module**, `src/lib/github/admission-write.ts`, rather than a relaxation of that rule:

- `proposeManagedBlock` reads the file from the **base** branch, splices a managed block delimited by
  `# BEGIN ascent:ai-stance vN` / `# END ascent:ai-stance vN`, and touches **nothing outside the
  markers**. A stray `BEGIN` with no matching `END` is treated as no managed region at all — a
  half-written marker in a customer's file must never authorize deleting the rest of it.
- It is a **dry run by default**: without `confirm` it returns the unified diff and sends nothing.
  "Trust me, it only touches the markers" is not something a reviewer can verify from a button; the
  diff is.
- The splice is **idempotent**, so a recompile that changes nothing produces an empty diff and opens
  no PR — the property that keeps the product from training a team to ignore its pull requests.
- On a re-run the CONTENT is spliced from base while the blob sha comes from our own branch, so an
  edit the customer made outside the markers is carried forward rather than reverted.

The same module owns the branch-ruleset apply/revert — the one call in that lane that mutates
repository *configuration* rather than proposing a change. It requires an owner, a same-origin
request and a typed confirm, and the created id is stored so the same surface can reverse it (a 404
on revert counts as success: someone deleting it on GitHub directly is the end state that was asked
for, and failing would strand the id forever). See
[org-intelligence.md](../org-dashboard/org-intelligence.md).

## Key files

| File | Role |
| --- | --- |
| `src/lib/github/app.ts` | JWT + installation-token minting, `githubAppFetch`, `listInstallationRepos` / `listInstallationReposResult`, `verifyWebhook`. |
| `src/lib/github/write.ts` | `openDraftPr`: seed a starter artifact; refuses an existing base file by design. |
| `src/lib/github/admission-write.ts` | `proposeManagedBlock` (merge-append, dry-run first) + ruleset apply/revert. |
| `src/app/api/app/webhook/route.ts` | `installation` / `pull_request` / `push` handling. |
| `src/app/api/app/setup/route.ts` | Post-install redirect + upsert. |
| `src/app/api/app/repos/route.ts` | List repos for an installation (+ DB watch/schedule). Surfaces `listInstallationReposResult.truncated` on the wire. |
| `src/lib/db/installations.ts` | Installation persistence on `Organization`. |
| `src/lib/github/governance.ts` | Branch-protection + commit-activity signals. |
| `src/app/onboarding/page.tsx`, `src/components/onboarding/OnboardingGateStep.tsx` | Install entry (the wizard; the access gate carries the install link). |
| `src/lib/github/actions-secrets.ts` | Sealed-box Actions-secret writer (two allowlisted names). |
| `src/app/api/report/foundation/{pr-batch,secrets}/route.ts` | Fleet foundation install + report-back provisioning. |
| `src/lib/db/org-foundation.ts` | Audit-derived fleet rollout status (read-only). |

## Known gaps

- **Push auto-rescan is DB-gated**: `runPushRescan` only runs for repos marked
  `watched: true` with a `scanSchedule` other than `off`, and requires `DATABASE_URL`.
- **Sign-in is optional**: when OAuth env is unset, `/onboarding` is open; when set, the App path is
  scoped to the signed-in user's own installations (see [auth.md](./auth.md)).
- **Token cache is in-memory**: re-minted per serverless instance.
- **The App is GitHub-only, and so is every WRITE path.** Since moonshot #4 the scanner also reads
  GitLab (see [forges.md](./forges.md)), but PR gate comments, check runs and ruleset writes have no
  adapter on another forge and degrade to *absent* there rather than failing. A GitLab account is
  connected through `Installation` + `/api/org/forge/installation`, a separate table that sits beside
  `Organization.githubInstallId` — the GitHub install path in this document is untouched.
- (Closed 2026-08-30, moonshot #1.) ~~The event-subscription table omits `installation_repositories`
  and `check_run`~~: both are listed above, alongside the control-probe and AI-change event kinds.
- **No `code_scanning_alert` / `secret_scanning_alert` subscription:** both need new App permissions,
  so `known-vulnerabilities` stays a scan/probe-sourced control until they are requested.
- **Branch rulesets need the App's repository-administration write permission.** Without it the apply
  returns a 403 that surfaces as "The installation lacks contents/PR write access", which is the
  shared PR-write copy and is imprecise for this one route. The proposal path (a committed ruleset
  JSON + the `gh api` one-liner in the PR body) works with the permissions the App already has.
- **`member` / `team` deliveries write no identity graph:** they only trigger a re-observation of the
  org's controls. Modelling org membership and scoped roles is a separate, unstarted item.
- **Watch reconcile has a ceiling:** an installation whose listing cannot finish within the
  `reconcile` bound (more than 50,000 repos, or a GitHub slow enough that 180 s does not cover every
  page) still comes back `truncated`, and its access-change reconcile is skipped on every event, so
  repos removed from such an installation stay watched. The skip is logged with the bound that
  stopped the walk. There is no resumable listing across requests or a queued follow-up job.
- **A re-granted repo is not auto-watched again:** the install-grant auto-watch only watches names
  the org has no Repository row for, since the tree records no author for `watched: false`. A repo
  that was removed from the installation (and unwatched by the reconcile) and later granted back, or
  one that was scanned but never watched, keeps its row and stays unwatched until someone watches it
  on the Repositories tab.
