> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

# GitHub App Installation & Webhooks — combined bug+ui scan

## 1. Truncated installation-repo listing is treated as authoritative and silently unwatches repos
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: data-loss / silent-failure
- **File**: src/app/api/app/webhook/route.ts:283
- **Scenario**: An org installs Ascent on > 5000 repos (or any number that exceeds `MAX_PAGES × PER_PAGE = 50 × 100`). The user clicks Add/Remove on the App's Configure page, firing `installation_repositories`. The deferred `reconcileInstallationRepos` calls `listInstallationRepos`, which caps at `MAX_PAGES=50` and, on overflow, only `console.warn`s and **returns the truncated list (it does not throw)**. That partial list is passed straight to `reconcileWatchedRepos` as the "live" set.
- **Root cause**: `reconcileWatchedRepos` documents the strict contract "CALLER MUST only pass a live set from a SUCCESSFUL listing … never call this with the result of a failed/throwing list" (installations.ts:119-121). A page-capped listing is neither a throw nor complete — it is a *silently truncated success*, which the contract does not anticipate. Every watched repo whose `fullName` sorts beyond page 50 is absent from the `live` Set and gets `staleIds`-unwatched.
- **Impact**: Watched repos on large installations are silently set `watched:false, scanSchedule:"off"` on any repo-access change event. Their scheduled rescans stop forever with no user-visible signal (only a server warn). Data-loss of watch/schedule state, proportional to fleet size.
- **Fix sketch**: Make `listInstallationRepos` signal truncation to callers (e.g. return `{ repos, truncated }` or throw a typed `TruncatedListingError`), and have `reconcileInstallationRepos` SKIP reconciliation when the listing was truncated (same "fail-safe, don't wipe" discipline already applied to the throwing path). Alternatively raise `MAX_PAGES` is insufficient — the gap is the missing truncation signal, not the bound.

## 2. Destructive/token-minting installation events run synchronously, risking GitHub's 10s timeout and duplicate processing
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: latent-failure / race-condition
- **File**: src/app/api/app/webhook/route.ts:347-386
- **Scenario**: An `installation` `created`/`deleted`/`suspend`/`unsuspend` delivery arrives. Unlike `pull_request`/`push`/`installation_repositories` (which all `after()`-defer their work to keep the 2xx fast), the `installation` branch executes its GitHub round-trip (`getInstallation`/`confirmRevocationWithGitHub`) AND its cascading DB writes (`removeInstallation` → `updateMany` repos + `updateMany` orgs + per-org `bumpSessionVersion`) **synchronously, before the response is sent**. Under a slow GitHub API or DB, this can exceed GitHub's ~10s webhook delivery timeout.
- **Root cause**: The file's own header states "GitHub expects a fast 2xx, so the scan work runs in `after()`", but only the scan/reconcile paths honor it; the installation lifecycle path does the heaviest authoritative-confirm + multi-table cascade inline. The delivery is marked `seen` at the top, so if GitHub times out and redelivers, the redelivery is correctly deduped IF the first attempt actually finished — but if the first attempt is still in-flight (TCP cut at GitHub's timeout, handler still running), GitHub's redelivery races the original and both run the full cascade concurrently.
- **Impact**: On large orgs or DB latency, install/uninstall events can time out at GitHub (showing as failed deliveries), and concurrent original+redelivery can double-run `removeInstallation`/session bumps. Worst case an uninstall and its redelivery interleave with a fast reinstall, corrupting the `githubInstallId` mapping.
- **Fix sketch**: Defer the installation lifecycle work to `after()` like the other branches (mark seen + 200 immediately, then confirm-with-GitHub and mutate in the deferred phase, releasing the delivery on failure via the existing `forgetDelivery` net).

## 3. Unauthenticated /api/app/setup mints an App JWT and writes an Organization row for any installation_id
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: security / trust-boundary
- **File**: src/app/api/app/setup/route.ts:12-29
- **Scenario**: The setup endpoint is a plain `GET` with no session/auth check. An attacker requests `/api/app/setup?installation_id=<any-valid-id>` (ids are small sequential integers, easily guessed/enumerated). The handler unconditionally calls `getInstallation(installationId)` — minting an App JWT and hitting GitHub — and then `upsertInstallation` to create/overwrite the `Organization` row for whatever account GitHub returns.
- **Root cause**: The route trusts the GitHub-post-install redirect contract (only GitHub sends a real `installation_id`) but enforces nothing — there is no signed `state`, no session, no rate limit. Confused-deputy: the caller drives Ascent's privileged App JWT and DB writes. The `account` is GitHub-authoritative so the *mapping value* can't be poisoned, but the *row* (and a fresh `Organization` with `plan:"private"`) is created for an installation the caller has no relationship with, and the differing redirect (`?org=<account>` vs `error=setup_failed`) is an oracle that confirms which installation ids are real.
- **Impact**: Unauthenticated resource creation (Organization rows) for arbitrary installations, an installation-id enumeration oracle, and unauthenticated consumption of App-JWT / GitHub API budget. Lower than IDOR because no private data is returned and the mapping value is authoritative.
- **Fix sketch**: Require a signed/verifiable handshake (GitHub's setup redirect can carry a `state` you mint and verify) or gate on an authenticated session, and/or rate-limit by IP. At minimum, only upsert when a session viewer already owns/controls the account `getInstallation` returns.

## 4. ?org= installation-id resolution can throw uncaught, returning a 500 instead of the route's graceful errors
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: error-handling / silent-failure
- **File**: src/app/api/app/repos/route.ts:26
- **Scenario**: A caller hits `/api/app/repos?org=acme`. `getInstallationIdForOwner(org)` runs OUTSIDE the route's `try/catch` (which only wraps the `listInstallationRepos` block at line 45). A transient DB error (DSQL cold-start, connection reset) inside `getInstallationIdForOwner` throws and is never caught.
- **Root cause**: The endpoint carefully returns shaped JSON for every other failure (503 not-configured, 404 no-installation, 403 no-access, 502 list-failed), but the `?org=` → installation-id lookup — itself a DB call — is not guarded. The `getRepoStates`/`getOrgMovers` calls later ARE either inside the try or `.catch`-guarded; this earlier lookup is not.
- **Impact**: Connect UI gets an opaque 500 (Next default error JSON) on a DB blip during org→install resolution, instead of a clean 404/502 the client can render. Inconsistent error contract; harder to diagnose.
- **Fix sketch**: Wrap the `getInstallationIdForOwner` call in a try/catch (or `.catch(() => undefined)` plus a 502) so a lookup failure maps to the existing 404/502 shape rather than an unhandled throw.

## 5. Same-id concurrent deliveries both pass the dedup gate (check-then-set is not atomic)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/app/api/app/webhook/route.ts:76-90
- **Scenario**: GitHub delivers an event, times out waiting for the 2xx, and redelivers the SAME `X-GitHub-Delivery` id while the first request is still being parsed. Both requests enter `deliveryAlreadySeen(id)`: request A reads `seenDeliveries.get(id)` (undefined), and before A executes `seenDeliveries.set(...)`, request B also reads undefined. Both return `false` (not-seen) and both proceed to schedule the scan/gate/rescan.
- **Root cause**: `deliveryAlreadySeen` is a read-then-write with an `await`-free body, but Node's event loop interleaves the two POST handlers at every `await` boundary upstream (`request.text()`, `verifyWebhook` is sync, but the two requests still arrive as separate macrotasks). The dedup is best-effort process-local and not a true compare-and-set; the design comment acknowledges "Process-local — it collapses same-instance replays" but assumes deliveries are serialized, which concurrent redelivery breaks.
- **Impact**: Duplicate PR gate runs / duplicate push rescans for a single logical event (double LLM/scan spend on non-mock push rescans, duplicate check-runs/comments are idempotent via sticky marker so lower there). Bounded to the rare concurrent-redelivery window.
- **Fix sketch**: This is inherent to in-memory dedup and is largely acceptable, but the window can be closed for push rescans (the costly path) by relying on the existing persist-dedup (`persisted.deduped`) which already guards the alert; ensure the scan itself is also short-circuited when the head commit was already scored. A durable shared dedup store (Redis SETNX on delivery id) is the complete fix and is already noted as an open team decision in prior scans.

## 6. created/unsuspend upsert mapping is not guarded against an out-of-order stale delivery
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: race-condition / state-corruption
- **File**: src/app/api/app/webhook/route.ts:351-357
- **Scenario**: A user uninstalls then immediately reinstalls the App (new installation id). GitHub can deliver the old `installation.deleted` and the new `installation.created` out of order, or a delayed `unsuspend` for a now-deleted installation arrives late. The `created`/`unsuspend` branch confirms `getInstallation(id)` and upserts — but `confirmRevocationWithGitHub` on the delete side and the create side share no ordering/versioning, so a late create can re-establish a mapping the delete just tore down (or vice-versa).
- **Root cause**: Installation events carry no monotonic sequence/version, and the handler treats each event as independently authoritative against GitHub's current state. The create path does re-confirm with GitHub (good), so a truly-stale create for a deleted installation will fail the confirm — but a create for a *re-issued* id that GitHub now reports active will succeed and could clobber a different org's row if logins were reassigned. Narrow but real.
- **Impact**: Rare mapping flip-flop on rapid uninstall/reinstall or delayed redelivery; self-heals on the next correctly-ordered event or token 401. Low likelihood and self-healing, hence Low.
- **Fix sketch**: Since the create path already re-confirms account from GitHub authoritatively, the residual risk is mainly ordering; recording an event/updated-at watermark per installation and ignoring deliveries older than the last applied would harden it. Acceptable to defer given the GitHub-confirm self-heal.
