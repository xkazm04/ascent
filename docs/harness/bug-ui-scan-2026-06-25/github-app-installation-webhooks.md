# GitHub App Installation & Webhooks — Bug + UI Scan
> Context: GitHub App Installation & Webhooks (Identity & GitHub Connectivity)
> Total: 5 findings (0 critical, 1 high, 2 medium, 2 low)

## 1. `installation.suspend` tears down watch/schedule like a permanent uninstall; `unsuspend` never restores it
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: state-corruption
- **File**: src/app/api/app/webhook/route.ts:344-382 ; src/lib/db/installations.ts:40-86
- **Value**: impact 7 · effort 4 · risk 3
- **Scenario**: GitHub suspends an org's installation (billing lapse, admin "Suspend" toggle — a *reversible* state). The webhook fires `installation` action=`suspend`; `runInstallationLifecycle` confirms via `confirmRevocationWithGitHub` (true, `suspendedAt != null`) and calls the SAME `removeInstallation(id)` used for a permanent delete. That sets every repo `watched:false, scanSchedule:"off", nextScanAt:null`, nulls `githubInstallId`, and bumps session version (signs the org's users out). When the admin later un-suspends, action=`unsuspend` only re-runs `upsertInstallation` (restores `githubInstallId`) — it does NOT re-watch anything. Confirmed: the only writers of `watched:true` are explicit user actions (`setRepoWatch`, org import); no inverse exists.
- **Root cause**: suspend (recoverable pause) and delete (permanent revocation) are collapsed onto one destructive cascade, but only delete has a matching re-onboarding flow.
- **Impact**: silent, unrecoverable loss of the user's entire auto-rescan configuration (watch list + schedules) on a temporary suspension; after unsuspend, scheduled rescans silently never fire again until the user manually re-selects every repo — a broken core flow with no signal.
- **Fix sketch**: on `suspend`, PAUSE without destroying — keep `watched:true` and `githubInstallId`, only clear `nextScanAt`/pause schedules (or add a `suspended` flag that `listDueRescans` honors). On `unsuspend`, resume schedules. Reserve `removeInstallation`'s full teardown for the genuine `deleted` case.

## 2. `/api/app/setup` is unauthenticated and mints an org row + a GitHub API round-trip for any valid installation id
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/app/api/app/setup/route.ts:12-34 ; src/lib/db/installations.ts:20-23
- **Value**: impact 5 · effort 4 · risk 3
- **Scenario**: `GET /api/app/setup?installation_id=N` has no session check and no rate limit (only `isAppConfigured`). Each call mints an App JWT and hits `GET /app/installations/N`; for any id that belongs to THIS app it then `upsertInstallation` → creates an `organization` row (`plan: "private"`) for the resolved account. An attacker iterating sequential installation ids discovers which belong to the app and seeds org rows for accounts they don't control, while amplifying unauthenticated GitHub API + DB writes.
- **Root cause**: the route trusts the browser-redirect contract (a signed-in user arriving from GitHub) but enforces none of it; `getInstallation` authenticates the *installation*, not the *caller*.
- **Impact**: unauthenticated org-row pollution (with an elevated-sounding `private` plan), installation enumeration, and a GitHub-API/DB amplification vector with no throttle.
- **Fix sketch**: require an authenticated session (when `isAuthConfigured()`) before upserting, and/or rate-limit the endpoint per IP; gate `upsertInstallation` so the caller's session login must match the resolved account (or be an org admin via `isOrgAdminViaInstallation`).

## 3. Process-local replay-dedup degrades to near-nothing under multi-instance / serverless deploys
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/app/api/app/webhook/route.ts:63-96, 390-403
- **Value**: impact 5 · effort 5 · risk 4
- **Scenario**: `seenDeliveries` (and the `forgetDelivery` retry net) is an in-process `Map`. The code presents it as "Replay defense" against a captured, still-validly-signed delivery being re-sent. On a horizontally scaled or serverless Next.js deployment (the realistic target), each instance/invocation has its own empty map, so a replayed signed webhook routed to a different instance is NOT deduped → it re-mints tokens and re-triggers scans/gates. Symmetrically, `forgetDelivery`-on-failure can't release a slot held by a different instance.
- **Root cause**: a security/idempotency control implemented as per-process memory, with no shared store.
- **Impact**: the documented replay protection is partially illusory in production; duplicate gate/scan work and token mints on replay; redelivery dedup unreliable across instances.
- **Fix sketch**: back dedup with a shared TTL store (the existing DB or a cache) keyed on `X-GitHub-Delivery`, marked "seen" only after successful processing; keep the in-memory map as a fast first-level filter.

## 4. `getInstallation` dereferences `account.login` with no null guard
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/lib/github/app.ts:113-126
- **Value**: impact 3 · effort 2 · risk 2
- **Scenario**: `return { account: data.account.login, type: data.account.type, ... }`. GitHub can return an installation whose `account` is `null` (account deleted, or certain enterprise/transfer states). That throws a `TypeError`, NOT an `AppApiError`. Callers' `catch` blocks (`confirmRevocationWithGitHub`, `installationMatchesOwner`, `runInstallationLifecycle`) all treat any non-404 as "fail closed" — so a genuine `deleted`/`suspend` arriving with a null-account body would be refused, and the `created` upsert silently skipped, on a data shape rather than a real error.
- **Root cause**: optimistic shape assumption on an external payload that has documented null cases.
- **Impact**: a real revocation/install could be silently dropped (teardown never runs, or mapping never recorded), masquerading as a transient failure.
- **Fix sketch**: guard `data.account?.login`; if absent, throw a typed error (or treat `deleted` as confirmed when `account` is null), so callers branch deterministically instead of swallowing a TypeError.

## 5. `runPushRescan` does a GitHub owner-confirm before the cheap watched check, and never persists a confirmed unknown-owner mapping
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/app/api/app/webhook/route.ts:311-316, 127-142
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: For a push from an org that has the app but was never recorded in the DB, `installationMatchesOwner` (called first, line 315) takes the unknown-owner branch and does a `getInstallation` round-trip to confirm, returns true, and only then `isRepoWatched` (line 316) returns false and bails. So every default-branch push to an unrecorded org triggers a GitHub API call that always dead-ends. The confirmed (owner→installation) pairing is also never persisted, so the system never transitions that owner from the weaker live-confirm path to the stronger stored-mapping path.
- **Root cause**: the expensive authoritative check runs before the cheap local short-circuit, and successful confirmations aren't cached.
- **Impact**: avoidable GitHub-API amplification per push for unrecorded orgs (rate-limit burn) and indefinite reliance on the weaker auth path.
- **Fix sketch**: short-circuit on the cheap `isRepoWatched` (DB) check first for the push path; and have the unknown-owner confirm branch `upsertInstallation` the confirmed pair so subsequent events use the stored-mapping check.
