# Bug Hunter — GitHub App, Connect & Onboarding (ascent)

> Total: 7 findings (Critical: 2, High: 2, Medium: 3, Low: 0)
> Files read: 13
> Scope: /api/app/(setup|repos|webhook), github/app+list+graphql, installations db, connect/onboarding UI

## 1. `/api/app/repos` mints an installation token and leaks any org's PRIVATE repo list with no session check
- **Severity**: Critical
- **Category**: functionality
- **File**: src/app/api/app/repos/route.ts:11-39
- **Scenario**: Auth is configured. An attacker (signed in to any account, or even unauthenticated if they can guess/learn an `installation_id` — they are sequential small integers, or learnable from a public org slug via `?org=<login>`) calls `GET /api/app/repos?org=acme-corp`. The handler resolves the stored installation via `getInstallationIdForOwner`, calls `listInstallationRepos(installationId)` which mints a real installation token (`getInstallationToken`) and returns the full list of the victim org's repositories — **including private ones** (`private: true` rows) with names, languages, stars, and push times.
- **Root cause**: The sibling route `/api/org/import` correctly gates token minting behind `sessionOwnsOrg`/`sessionHasInstallation`, and `src/lib/authz.ts:25-29` explicitly documents "Call at the top of every mutating /api/org/* **(and token-minting /api/app/\*)** handler." This route never calls `requireOrgAccess`/`sessionOwnsOrg` — it only checks `isAppConfigured()`. The `installation_id`/`org` query params are fully attacker-controlled and there is no ownership binding.
- **Impact**: security breach — cross-tenant private repository enumeration (IDOR). Private repo names alone are sensitive disclosure for many orgs.
- **Fix sketch**: At the top of `GET`, after resolving `org`/`installationId`, call `const denied = await requireOrgAccess(orgLogin)` (and/or `sessionHasInstallation(installationId)`) and return it if non-null — making "token mint without ownership" structurally impossible, matching the import route.

## 2. `/api/app/setup` lets any signed-in user overwrite another org's stored installation id (installation hijack)
- **Severity**: Critical
- **Category**: functionality
- **File**: src/app/api/app/setup/route.ts:12-33; src/lib/db/installations.ts:9-37
- **Scenario**: The Setup URL handler trusts the `installation_id` query param unconditionally. It calls `getInstallation(installationId)` (App-JWT authenticated — works for *any* installation of this App, not just the caller's), gets `info.account`, then `upsertInstallation({ login: info.account, installationId })`. Because `upsertInstallation` keys on `slug = login.toLowerCase()` and **overwrites** `githubInstallId` on update, an attacker who installs the App on their own org and then hits `/api/app/setup?installation_id=<VICTIM_INSTALL_ID>` (any other customer's id) rebinds the victim org's `Organization.githubInstallId` — or, conversely, points their own org slug at a foreign installation. No check that the caller actually performed this install or owns `info.account`.
- **Root cause**: GitHub's Setup URL redirect carries no proof the visitor is the installer; the handler treats the `installation_id` param as authoritative and writes to a globally-keyed org row without binding it to the authenticated session (`getSession().installations`).
- **Impact**: security breach / data corruption — an attacker can repoint a victim org's installation mapping (denial of service on their scans) or attach a foreign install id under a slug they control to drive token mints for repos they don't own.
- **Fix sketch**: Require a session and verify the resolved `info.account` is in `session.installations` (or that the GitHub user is an admin of that account) before `upsertInstallation`; never persist an installation id the caller can't prove they own.

## 3. Webhook acts on payloads for unknown owners — a forged-but-signed or first-seen delivery can drive token mint/scan; `installationMatchesOwner` is fail-open
- **Severity**: High
- **Category**: functionality
- **File**: src/app/api/app/webhook/route.ts:78-91,114-182,206-215
- **Scenario**: HMAC verification (line 187) is correct and present — good. But the secondary guard `installationMatchesOwner` (line 82) returns `true` whenever **no mapping exists** for the owner ("Unknown owners are allowed"). The `installation` event handler at line 206-215 then calls `upsertInstallation` for *any* `created`/`unsuspend` payload with no owner-binding at all. Two consequences: (a) anyone who learns the webhook secret (it is the single shared `GITHUB_APP_WEBHOOK_SECRET`, and a leak is plausible) can POST a hand-crafted `installation`/`pull_request` payload naming an arbitrary `installation.id` + `owner`, and since the owner is "unknown" the gate passes, a token is minted (`getInstallationToken`) and a scan/check-run runs against a repo the App happens to cover. (b) Out-of-order delivery: an `installation deleted` arriving *before* a late `installation created` (GitHub does not guarantee ordering) leaves the org re-bound as installed after it was uninstalled.
- **Root cause**: `installationMatchesOwner` is explicitly fail-open ("defense-in-depth, not the primary gate"), and the primary gate is *only* the shared-secret HMAC. There is no per-delivery confirmation against GitHub (e.g. re-fetch `/app/installations/{id}` to confirm the account login) before minting tokens for a previously-unseen owner, and no ordering/sequence guard on install vs uninstall.
- **Impact**: security breach (if secret leaks) + silent state corruption (out-of-order install/uninstall leaves a stale "installed" mapping → scheduled scans 401 forever or run against wrong account).
- **Fix sketch**: For token-minting events with an *unknown* owner, confirm via `getInstallation(id)` that `account` matches the payload `owner` before acting; for install/uninstall, ignore an event whose action contradicts a more recent `installation` event (track last-seen action timestamp per id).

## 4. `installation_repositories` removed-handler ignores the `removed` action and never handles full-access switch — repos stay watched after access is revoked
- **Severity**: High
- **Category**: functionality
- **File**: src/app/api/app/webhook/route.ts:216-226
- **Scenario**: The handler only acts on `payload.repositories_removed[]`. But GitHub also fires `installation_repositories` with `action: "removed"` carrying repos, and — critically — when a user flips an installation from `selected` repos to **all** repos and back, or removes the *last* selected repo, the per-repo `repositories_removed` array may be empty while `repository_selection` changes. More concretely: when a user switches `repository_selection` from `all` to `selected`, repos that silently lost access are NOT enumerated in `repositories_removed`. Those repos remain `watched: true` with an active schedule; their next scheduled rescan mints a token that no longer covers them and 401s indefinitely — exactly the failure mode `unwatchReposForInstallation` was written to prevent, but it never fires for the selection-narrowing case.
- **Root cause**: The handler assumes the only access-loss signal is a non-empty `repositories_removed` array; it ignores `repository_selection` transitions and doesn't reconcile the stored watch-set against the installation's current accessible repos.
- **Impact**: silent failure — orphaned watched repos burn token mints + GitHub API quota on permanent 401s; "X of N watched" counter overstates.
- **Fix sketch**: On any `installation_repositories` event, re-list `listInstallationRepos(id)` and unwatch any stored watched repo not in the fresh set (reconcile), rather than trusting the delta array alone.

## 5. Installation token cache survives across uninstall/reinstall by id — a deleted-then-reissued installation can serve a stale token; cache also never purged on `removeInstallation`
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/github/app.ts:117-152,122-124; src/lib/db/installations.ts:39-80
- **Scenario**: `tokenCache` is keyed solely by installation id with a time-based expiry. The expiry handling itself is sound (NaN guard + 60s skew margin, line 134-139). The gap is invalidation: when `removeInstallation` runs (uninstall/suspend webhook), it clears the DB mapping and unwatches repos but never calls `invalidateInstallationToken(id)`. A scan already in flight (`after()` work, or a concurrent `/api/org/import` lane) that grabbed the cached token before removal keeps using a still-valid (~up to 1h) token against an installation the user just uninstalled — operating past the user's revocation intent until the token naturally expires. `listInstallationRepos` self-heals a *401* but a suspended-but-not-yet-revoked token returns 200s.
- **Root cause**: Token lifecycle is decoupled from installation lifecycle; removal mutates the DB but not the in-process token cache.
- **Impact**: silent failure / weak revocation — work continues against an uninstalled installation for up to the token TTL; surprising for a user who just removed access.
- **Fix sketch**: Call `invalidateInstallationToken(id)` inside `removeInstallation` and on the `installation` deleted/suspend webhook branch so the cached token is dropped the moment access is revoked.

## 6. GraphQL client discards partial data when `errors` is present — a single PR-node error fails the whole scan
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/github/graphql.ts:62-65
- **Scenario**: GitHub GraphQL routinely returns **both** `data` (populated) **and** `errors` (e.g. a single field on one PR node is `null` due to a transient `RATE_LIMITED`/`SOMETHING_WENT_WRONG`, or a deleted author). The client throws on `json.errors?.length` *before* checking `data`, so a fully-usable page of PRs is thrown away because one node had a non-fatal error. `fetchPullRequests` callers then see PR ingestion fail for the whole repo. Also, the abort path: `AbortSignal.any` (line 49) aborts on either timeout or client disconnect, but the resulting `AbortError` surfaces as a generic throw — distinguishable rate-limit (`type: RATE_LIMITED` in errors) is collapsed into a string join with no backoff.
- **Root cause**: Treats GraphQL `errors` as all-or-nothing fatal, contrary to GraphQL's partial-success contract (data + errors can coexist).
- **Impact**: silent failure — repos with one bad PR node get zero PR signal, depressing maturity scores incorrectly.
- **Fix sketch**: If `json.data` is present, log `errors` and return the partial data; only throw when `data` is absent (or all errors are top-level/auth class).

## 7. Repos pagination can silently truncate at MAX_PAGES and the short-page stop trusts an unreliable `total_count`
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/github/app.ts:173-205,183-191
- **Scenario**: For an installation with >5000 repos, the `MAX_PAGES = 50` bound stops paging and silently returns the first 5000 — the connect list, the "X of N watched" counter, and any all-repo reconcile are wrong, with no signal to the caller that the list was truncated (the comment acknowledges the old "drop past #100" bug but the new cap reintroduces a silent ceiling). Separately, the loop condition `raw.length < total` plus `total = data.total_count` can terminate one page early on a busy installation if `total_count` shrinks between page fetches (repos removed mid-pagination), dropping the final page; the short-page `break` mitigates only when the last page is partial.
- **Root cause**: Silent truncation at a hard page bound, plus a loop guard that trusts a cross-request-mutable `total_count`.
- **Impact**: silent failure — incomplete repo listings for very large orgs; downstream watch/reconcile logic operates on a partial set.
- **Fix sketch**: Drive pagination solely by the short-page stop (drop the `raw.length < total` guard as the primary condition) and surface a `truncated: true` flag when `MAX_PAGES` is hit so callers/UI can warn instead of silently undercounting.
