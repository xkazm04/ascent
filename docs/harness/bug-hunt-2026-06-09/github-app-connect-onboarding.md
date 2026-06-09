# Bug Hunter Scan — GitHub App, Connect & Onboarding (ascent)

> Total: 7 findings (Critical: 1 | High: 3 | Medium: 2 | Low: 1)

## 1. Forged-but-signed `installation.deleted` webhook tears down a victim org's access with no ownership check
- **Severity**: Critical
- **Category**: webhook-integrity
- **File**: src/app/api/app/webhook/route.ts:242
- **Scenario**: An attacker captures the shared webhook secret OR (more realistically) replays/crafts a delivery on an instance where `seenDeliveries` is cold (fresh deploy, second serverless instance, or a redelivery the in-memory map never saw). They POST `event=installation, action=deleted` (or `suspend`) naming a *victim's* `installation.id`. `verifyWebhook` passes for any validly-signed body, and the handler calls `removeInstallation(id)` immediately — no confirmation that the delivery's claimed installation actually corresponds to this account.
- **Root cause**: The `created`/`unsuspend` branch was hardened (it calls `getInstallation(id)` and stores the *GitHub-confirmed* account), but the destructive `deleted`/`suspend` branch trusts `payload.installation.id` blindly. Destructive actions are exactly the ones that need authority confirmation, and `removeInstallation` cascades: it unwatches every repo (`watched:false, scanSchedule:"off", nextScanAt:null`), nulls `githubInstallId`, and bumps session versions (revoking live sessions). A single forged/misrouted delivery silently disables an org's scanning and signs its users out.
- **Impact**: corrupted installation state + denial of service (watch/schedule wiped, private scans 401 forever until manual reinstall, live sessions revoked).
- **Fix sketch**: Before honoring a delete/suspend, verify the id belongs to a *known* stored installation and/or that `getInstallation(id)` (App-JWT authoritative) returns 404/suspended — i.e. confirm GitHub actually revoked it. At minimum, only `removeInstallation` for an id currently mapped to an org in the DB, and log+drop unknown ids. Consider per-installation webhook signing if available. Treat delete as "verify with GitHub, fail closed" symmetrically with create.

## 2. `fetchPullRequests` GraphQL has no pagination — every PR past `limit` (max 100) is silently dropped
- **Severity**: High
- **Category**: pagination
- **File**: src/lib/github/graphql.ts:81
- **Scenario**: A repo with 4,000 PRs is scanned. `PR_QUERY` requests `pullRequests(first:$num …)` with `num = min(100, limit)` and returns `pageInfo`-free; the function returns at most 100 nodes while `totalCount` reports 4,000. Review-coverage / merge-velocity / PR-size signals are computed from a non-representative most-recent slice, and the maturity score is wrong for exactly the large, mature repos where it matters most.
- **Root cause**: `listInstallationRepos` was explicitly fixed to walk every page (with a `total_count` guard and a `MAX_PAGES` bound), but the GraphQL PR path never got the same treatment — there is no `pageInfo{ hasNextPage endCursor }` in the query and no cursor loop. The 40/100 cap is presented as "the most recent PRs" but downstream scoring treats the slice as the repo's PR corpus. Unlike the REST path, this truncation is completely silent (no warn log, and `totalCount` vs `nodes.length` divergence is discarded).
- **Impact**: corrupted/biased scores (silent data loss) on high-volume repos; non-reproducible scoring as the 100-most-recent window shifts.
- **Fix sketch**: Either (a) add `pageInfo` + `after:$cursor` and loop until `hasNextPage` is false or a `MAX_PR` bound is hit, mirroring `listInstallationRepos`; or (b) if scoring intentionally samples recent PRs, make that explicit — pass through `totalCount`, document the window, and surface a "sampled N of M" signal so the score isn't presented as whole-repo truth.

## 3. `installation_repositories` handler ignores `added` repos and the `selection → all` flip; only `removed` is processed
- **Severity**: High
- **Category**: webhook-integrity
- **File**: src/app/api/app/webhook/route.ts:246
- **Scenario**: (a) A user switches an installation from "selected repos" to "All repositories" on GitHub's Configure page. GitHub sends `installation_repositories` with `repository_selection:"all"` and an *empty* `repositories_added` array (the "added" set isn't enumerated for an all-repos switch). The handler sees `removed.length === 0`, does nothing, and the new repos never become watchable until a manual re-sync. (b) Conversely, a user narrows from "all" to a small selected set: GitHub may send the *now-excluded* repos in `repositories_removed`, but if a large org sends them paginated/partial, repos that lost access stay `watched:true` and their scheduled rescan mints a token that no longer covers them and 401s forever.
- **Root cause**: The handler treats `installation_repositories` as a removal-only signal and assumes `repositories_removed` is always complete and authoritative. It never reconciles against the *actual* current access set (`listInstallationRepos`), so any access change GitHub doesn't itemize as an explicit "removed" row is invisible.
- **Impact**: stale watch state → wasted token mints + perpetual 401 rescans (the exact failure mode line 247-249 claims to prevent), and added repos silently unavailable (UX/activation gap).
- **Fix sketch**: On any `installation_repositories` event, re-list the installation's repos and reconcile DB watch state against the live set (drop watch for repos no longer present), rather than trusting only `repositories_removed`. Handle `repository_selection:"all"` explicitly. Make the same reconciliation reachable from the connect re-sync path.

## 4. Installation-token cache trusts the local clock against GitHub's `expires_at` — clock skew serves expired tokens
- **Severity**: Medium
- **Category**: token-expiry
- **File**: src/lib/github/app.ts:134
- **Scenario**: The host clock drifts ahead of GitHub's by >60s (common on under-provisioned VMs/containers without reliable NTP). `getInstallationToken` parses GitHub's `expires_at` into `expires` and serves the cached token while `expires > Date.now() + 60_000`. If `Date.now()` runs slow (host behind real time), the 60s buffer can elapse server-side while the cache still believes the token is fresh, so a request goes out with a token GitHub already considers expired → 401. The cache also keys only on `installationId`, so the next caller racing in before invalidation reuses the same dead token.
- **Root cause**: The 60s skew buffer is fixed and one-directional; it protects against the token expiring *during* a request but not against host-clock skew, and there is no reactive refresh on the `getInstallationToken` callers other than `listInstallationRepos`. `getInstallation`/`runPrGate`/`runPushRescan` mint once and don't retry on a 401-from-expiry the way the repo lister does.
- **Impact**: intermittent 401s on token-minting paths (PR gate / push rescan / repo list) under clock skew; UX = "Failed to list installation repositories" (502) with no self-heal.
- **Fix sketch**: Widen the buffer (e.g. 120-300s) and, more importantly, generalize the 401→`invalidateInstallationToken`→retry-once pattern from `listInstallationRepos` into a shared `withInstallationToken(fn)` wrapper used by `runPrGate`, `runPushRescan`, and `getInstallation` callers, so an expired/stale token self-heals everywhere, not just in the repo lister.

## 5. Delivery is marked "seen" before `after()` work runs — a transient scan failure is deduped on GitHub's redelivery
- **Severity**: Medium
- **Category**: race-window
- **File**: src/app/api/app/webhook/route.ts:215
- **Scenario**: A `pull_request` or `push` delivery passes signature + dedup, the route 200s, and the deferred `runPrGate`/`runPushRescan` runs in `after()`. The scan throws (transient: GitHub 5xx, token mint hiccup, DB blip). Those handlers swallow the error (`catch → console.error`) and never signal failure. If the operator or GitHub *redelivers* the same delivery to recover, `deliveryAlreadySeen` returns true and the redelivery is dropped — the only retry mechanism is defeated for precisely the deliveries whose real work failed.
- **Root cause**: Dedup records the delivery id at *receipt* (before the actual work), conflating "we acknowledged the HTTP request" with "we successfully processed the event." Combined with always-200 + swallowed `after()` errors, there is no path to reprocess a delivery whose side-effects failed.
- **Impact**: silent permanent loss of a PR gate / push rescan on any transient downstream failure; the PR shows no check, or a watched repo's regression alert never fires.
- **Fix sketch**: Mark a delivery as fully-seen only after the deferred work succeeds (or record receipt but allow redelivery to re-run if no successful completion was recorded). Alternatively, key dedup on `(delivery, succeeded)` and let GitHub's native redelivery retry failures. Don't treat HTTP 200 as proof of processing for fire-and-forget work.

## 6. `installationMatchesOwner` fails *open* for a known owner when the DB lookup throws
- **Severity**: Medium
- **Category**: silent-failure
- **File**: src/app/api/app/webhook/route.ts:84
- **Scenario**: A `pull_request`/`push` event arrives for a known owner, but `getInstallationIdForOwner(owner)` throws (DB unavailable/timeout). The `.catch(() => null)` turns the error into `null`, so `known` is falsy and control falls through to the *unknown-owner* branch, which calls `getInstallation(installationId)` and compares `info.account` to the payload owner. That comparison can succeed for a forged pairing where the attacker controls a real installation whose account login happens to match a casing/normalization of the claimed owner — but more concretely, the stored-mapping consistency check (payload id == stored id) is *skipped entirely* whenever the DB read fails, weakening the very mismatch defense the function exists to enforce.
- **Root cause**: `.catch(() => null)` collapses "no mapping exists" and "couldn't determine if a mapping exists" into the same value, so a transient DB error silently downgrades a strict (stored-id-must-match) check to the looser GitHub-confirmation path.
- **Impact**: auth/integrity check bypass under DB failure → a mismatched installation could be allowed to mint a token and scan/post to a repo it shouldn't.
- **Fix sketch**: Distinguish "no row" from "lookup failed." On a thrown DB error, fail closed (return false / skip) rather than proceeding to the unknown-owner path. Only treat a definitive `null`/absent row as "unknown owner."

## 7. `listOrgRepos` over-fetch math underflows for `count <= 0` and only ever reads page 1
- **Severity**: Low
- **Category**: pagination
- **File**: src/lib/github/list.ts:45
- **Scenario**: Called with `count` of 0 or negative (e.g. a misconfigured caller or a `0`-budget plan), `perPage = min(100, max(1, count*2))` clamps to 1, so a single repo is fetched and the "top N pushed" listing is effectively empty/degenerate. Separately, for any `count > 50` the function fetches only the first `per_page` page (no pagination loop), so the most-recently-pushed window is capped at 100 raw rows before fork/archive filtering — a quiet truncation for large orgs, inconsistent with `listInstallationRepos`'s full walk.
- **Root cause**: Single-page fetch with an over-fetch heuristic that assumes `count` is a sane positive bounded by ~50; no `max(1, count)` guard on the *input* and no pagination for larger requests.
- **Impact**: empty/short onboarding repo lists for edge `count` values; truncated public-org listings (UX, mild data-completeness).
- **Fix sketch**: Guard `count = Math.max(1, count)` up front; if larger lists are needed, paginate until `count` survivors are collected or a page bound is hit. At minimum document the 100-row pre-filter ceiling so callers don't assume completeness.
