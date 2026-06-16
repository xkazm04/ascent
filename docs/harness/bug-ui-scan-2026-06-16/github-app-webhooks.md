# GitHub App Installation & Webhooks — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)
> Lens split: bug-hunter 5 / ui-perfectionist 0
> Files read: 9

This is a hardened, security-conscious surface. Signature verification (`verifyWebhook`, constant-time HMAC), App-JWT confirmation of every destructive event, fail-closed owner binding, token-expiry skew, 401 self-heal, and a forget-on-failure dedup discipline are all present and correct. The findings below are the residual gaps that survived that defense — concurrency windows and unauthenticated-reachable pre-auth work, not missing primitives.

## 1. Replay dedup + signature have no time bound and the seen-set is process-local — a captured valid delivery replays forever against any other/cold instance
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: Webhook security / replay
- **File**: src/app/api/app/webhook/route.ts:74 (and :329, :337)
- **Scenario**: Ascent runs on serverless/multi-instance (Next 16 App Router, `maxDuration=300`). The replay defense is a per-process `Map` (`seenDeliveries`, line 74). An attacker who captures one validly-signed delivery (e.g. via a logged/proxied request, or a leaked webhook payload) re-sends it. Instance B — a different Lambda, a cold start, or simply the next autoscaled pod — has an empty map, so `deliveryAlreadySeen` returns false and the full scan/gate/regression-alert pipeline re-fires. There is also no timestamp/age check: `verifyWebhook` (app.ts:254) only validates the HMAC, which stays valid indefinitely, so the same capture is replayable for the life of the webhook secret.
- **Root cause**: Dedup state lives only in memory and is never shared (no DB/Redis row keyed on `x-github-delivery`), and the signature scheme has no freshness component. The code comments candidly call this "Process-local … collapses *same-instance* replays."
- **Impact**: Unbounded re-triggering of scans, gate Check Runs, sticky-comment churn, and regression alerts on a victim's repos — wasted LLM/API budget, comment/alert spam, and a foothold to force repeated installation-token mints. Replay protection that only works on the same warm instance is effectively absent in the target topology.
- **Fix sketch**: Persist processed `x-github-delivery` ids (with the existing TTL) in the DB/Supabase or a shared cache and check there before scheduling work; the in-memory map can stay as a fast first hop. Add an age check on a delivery timestamp (or reject deliveries whose `X-GitHub-Delivery` was first-seen-at outside a window) so a stale capture is refused even on a cold instance.

## 2. Token-cache repopulation race: a concurrent mint can re-cache a token for an installation that was just removed/suspended
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Concurrent-event race / token lifecycle
- **File**: src/lib/github/app.ts:171 (vs installations.ts:45 / app.ts:143)
- **Scenario**: An `installation.deleted`/`suspend` webhook runs `removeInstallation` → `invalidateInstallationToken(id)` (installations.ts:45), which does `tokenCache.delete(key)`. Concurrently, an in-flight `runPushRescan`/`runPrGate` for the same installation is already inside `getInstallationToken`, past the cache check, awaiting the mint POST. It returns and executes `tokenCache.set(key, …)` (app.ts:171) *after* the delete. The cache is now repopulated with a freshly-minted, still-valid (~1h) token for an installation Ascent just tore down.
- **Root cause**: `getInstallationToken` writes the cache unconditionally with no generation/invalidation check; `invalidateInstallationToken` is a blind `delete` with no "do not re-cache" marker. Delete-then-set ordering is unsynchronized across the two concurrent flows.
- **Impact**: Up to ~1h window where scans for a removed/suspended installation keep succeeding against a stale token — exactly the "self-heal" the design tries to guarantee is defeated for that window. Minor (GitHub revokes the underlying grant on uninstall so the token will start 401ing), but it undercuts the immediate-quiesce invariant `removeInstallation` is written to enforce.
- **Fix sketch**: Track an invalidation generation/epoch per key; capture it before the mint and only `set` if it's unchanged. Or have `invalidateInstallationToken` record a "tombstone until" timestamp that `getInstallationToken` honors before caching.

## 3. Webhook reads and HMACs the entire raw body before any size guard — unauthenticated CPU/memory amplification
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Validation gap at the trust boundary / DoS
- **File**: src/app/api/app/webhook/route.ts:327
- **Scenario**: `POST /api/app/webhook` is unauthenticated by definition (the signature *is* the auth). Line 327 does `await request.text()` to buffer the full body, then `verifyWebhook` HMACs all of it (app.ts:257, `createHmac(...).update(rawBody)`) — all *before* the 401. No `Content-Length` check or streaming size cap exists anywhere in the repo (grep for `content-length`/`maxBodySize` returns nothing). An attacker with no secret sends large bodies; each one is fully buffered into a string and hashed before rejection.
- **Root cause**: No body-size guard at the public ingress; the HMAC-then-reject ordering is unavoidable, so the cost must be bounded *before* the hash by capping the read.
- **Impact**: Unauthenticated memory/CPU amplification against the public webhook endpoint — cheaper for the attacker than for the server (full buffer + SHA-256 over multi-MB bodies per request). Magnitude depends on the platform's default request cap, which this code does not rely on or document.
- **Fix sketch**: Reject early on `Content-Length` over a small bound (GitHub deliveries are well under ~1–2 MB), and/or read with a capped stream and 413 on overflow, before computing the HMAC.

## 4. PR/push gate has a TOCTOU between `installationMatchesOwner` and the token mint, and re-confirms ownership via an unbounded GitHub call per delivery
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Concurrent-event race / unbounded external call
- **File**: src/app/api/app/webhook/route.ts:207 (and :309)
- **Scenario**: `runPrGate` (line 207) and `runPushRescan` (line 309) call `installationMatchesOwner` and then `getInstallationToken`. For an UNKNOWN owner, `installationMatchesOwner` resolves ownership via a live `getInstallation` call (line 133) — one App-API round trip *per deferred delivery*. A burst of deliveries (rapid pushes / synchronize storms, easy for a repo owner or via the replay gap in #1 to amplify) fans out into N concurrent `getInstallation` + N `getInstallationToken` App-JWT calls with no coalescing, risking GitHub secondary-rate-limit 403s that then make legitimate gates fail. Separately, between the ownership check passing and the token being used, a concurrent `removeInstallation` can land (see #2), so the check's result is stale by the time the token authenticates the scan.
- **Root cause**: Ownership confirmation and token mint are two unsynchronized awaits with no per-installation in-flight coalescing or short-lived negative/positive cache, and the unknown-owner path issues an external call on every delivery rather than persisting the confirmed mapping.
- **Impact**: Under load, self-inflicted GitHub rate-limiting that turns into "Maturity gate could not run" neutral checks (the line 259 fallback) for legitimate PRs; wasted App-API quota. The TOCTOU window is benign-leaning (stale token still 401-self-heals) but widens the #2 race.
- **Fix sketch**: Coalesce concurrent `getInstallationToken`/`getInstallation` calls per installation id with an in-flight promise map; cache a confirmed (installationId→owner) mapping briefly so the unknown-owner path doesn't hit GitHub on every delivery; persist the confirmed mapping (`upsertInstallation`) once confirmed so subsequent deliveries take the fast stored-id branch.

## 5. `check_run` re-run path acts on a fully attacker-supplied `head_sha` with no ownership re-confirmation beyond the shared check inside the gate
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: Validation gap / input trust
- **File**: src/app/api/app/webhook/route.ts:423
- **Scenario**: On a `check_run` rerequest, the handler pulls `headSha`, `prNumber`, and `baseRef` straight from `payload.check_run` / `payload.check_run.pull_requests[0]` (lines 423–427) and schedules `runPrGate`. These fields are wholly payload-controlled. A validly-signed-but-forged delivery (the #1 replay/forge surface) could name a `head_sha`/PR pairing that doesn't correspond to the installation's repo. The only thing standing between this and a scan is `installationMatchesOwner` inside `runPrGate` — which validates (installationId, owner) but does NOT validate that `headSha`/`prNumber` actually belong to `owner/repo`. `createCheckRun` then posts a check against an arbitrary `head_sha` on the repo the token covers.
- **Root cause**: PR/SHA fields from the webhook are trusted without cross-checking them against the repo via the GitHub API; ownership binding is at the installation/owner granularity only.
- **Impact**: Bounded by the token's scope (only the installation's own repos), so this is a low-severity integrity issue — at worst a Check Run posted against an unexpected SHA within an org that already trusts the App. Not a cross-tenant escape, but the `check_run`/`pull_request` paths trust more of the payload than the destructive paths do (which are GitHub-confirmed).
- **Fix sketch**: Before posting, confirm the PR/`head_sha` belongs to `owner/repo` via a lightweight GitHub read (or only trust the SHA GitHub returns for the PR number), mirroring the App-JWT-confirm discipline already applied to installation create/delete/suspend.
