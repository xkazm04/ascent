# GitHub App Installation & Webhooks — bug-hunter + ui-perfectionist scan

> Context: GitHub App Installation & Webhooks (group: Identity & GitHub Connectivity)
> Files scanned: 8
> Total: 7 findings (Critical: 0, High: 2, Medium: 4, Low: 1)

## 1. Setup-route authorization is wired to the DORMANT auth system, so it never engages in prod
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: broken-authorization
- **File**: src/app/api/app/setup/route.ts:32
- **Scenario**: Production runs the Supabase login wall (`authGateEnabled()`), with custom OAuth dormant — i.e. `GITHUB_OAUTH_CLIENT_ID/SECRET`/`AUTH_SECRET` unset, so `isAuthConfigured()` returns false (confirmed src/lib/auth.ts:85). The setup route's entire authz block gates on `authOn = isAuthConfigured()` and `getSession()` (the custom-OAuth session). Under Supabase, `authOn` is false, so the `!session → auth_required` redirect and the owner/org-admin check are dead code. An anonymous caller hits `/api/app/setup?installation_id=N`, and every id gets a live `getInstallation` round-trip + an `upsertInstallation` that seeds a `plan:"private"` org row.
- **Root cause**: Same false assumption the repos route was explicitly hardened against (see repos/route.ts:30-37 comment): "auth configured" was keyed to the inert custom-OAuth predicate, not the active Supabase gate. The setup route never got the same fix.
- **Impact**: Unauthenticated installation-id enumeration (which ids belong to this App), attacker-influenced `private`-plan org-row seeding for accounts they don't control, and unthrottled GitHub-API/DB amplification. Reachable in the real prod auth config.
- **Fix sketch**: Gate on `authGateEnabled()` and require a Supabase viewer with standing on the resolved account (mirror `requireOrgRead`/`isOrgAdminViaInstallation`), instead of `isAuthConfigured()`/`getSession()`. Keep the App-only/DB-less bypass explicit.

## 2. installationMatchesOwner=false early-returns without releasing the delivery → transient failure permanently drops the gate/rescan
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: missing-retry
- **File**: src/app/api/app/webhook/route.ts:225
- **Scenario**: A `pull_request` (or `push`, route.ts:342) event fires. Inside the deferred `runPrGate`, `installationMatchesOwner` returns false because its own DB lookup threw or its GitHub confirm hiccuped (both fail-closed to `false`, route.ts:118-127,159-165). The caller does a bare `return` — inside the `try`, so the `catch` (which calls `forgetDelivery`) never runs. The delivery stays claimed in both the in-memory Map and the DB claim.
- **Root cause**: `installationMatchesOwner` collapses "forged mismatch" (want: drop) and "transient error" (want: retry) into one `false`, and the caller treats all as drop — unlike the lifecycle handlers, which release on unconfirmed/transient (route.ts:405,417,432).
- **Impact**: A transient DB/GitHub blip during the owner-match check means GitHub's redelivery is deduped and the PR gate / push rescan is silently lost forever. For a required check this blocks merge with no status and no neutral fallback (token was never minted, so finding #3's neutral path can't fire either).
- **Fix sketch**: Call `forgetDelivery(ref.deliveryId)` before the `return` on the `installationMatchesOwner`-false path in both `runPrGate` and `runPushRescan` — a redelivery of a genuine forgery just fails the check again harmlessly.

## 3. Swallowed check-run/comment write errors keep the delivery deduped with no retry or neutral fallback
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/app/api/app/webhook/route.ts:256
- **Scenario**: The gate scores fine, then `createCheckRun` (route.ts:256-266) transiently 5xx's. It is `.catch()`-logged and swallowed, so `runPrGate` returns normally — the outer `catch` (which posts the neutral check and releases the delivery) never fires. The delivery stays deduped.
- **Root cause**: Best-effort `.catch(log)` on the terminal write assumes a failed check-run post is non-critical; but it is the whole deliverable, and success/failure here decides retryability.
- **Impact**: On a transient GitHub write failure the PR ends with no Check Run at all (required-check merge block), no neutral "could not run" fallback, and no redelivery retry — a silent hole with only a log line.
- **Fix sketch**: If `createCheckRun` rejects, rethrow (or set a flag) so the outer `catch` posts the neutral check and calls `forgetDelivery`, making the redelivery re-attempt.

## 4. App-JWT `iat` is backdated only 60s while the token cache assumes minutes of clock drift
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: clock-skew
- **File**: src/lib/github/app.ts:68
- **Scenario**: `createAppJwt` sets `iat: now - 60`. On an under-provisioned host without reliable NTP whose clock runs >60s AHEAD of GitHub, GitHub rejects the App JWT with "'iat' is in the future," so `getInstallation`, token mints, and `isOrgAdminViaInstallation` all 401.
- **Root cause**: Asymmetric skew assumptions in the same file: `TOKEN_EXPIRY_SKEW_MS` was widened to 180s (app.ts:144) explicitly citing hosts that "drift minutes," but the JWT `iat` guard was left at 60s — so on exactly those hosts the App can't even mint a token, making the 180s widening moot.
- **Impact**: All GitHub App auth breaks on a clock-skewed host — no scans, no gates, no installation sync — with an opaque 401.
- **Fix sketch**: Backdate `iat` by the same skew budget used elsewhere (e.g. `now - 180`) and keep `exp` within GitHub's 10-min max.

## 5. Replay-dedup TTL (10 min) is far shorter than the replay window it defends
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: replay-protection
- **File**: src/app/api/app/webhook/route.ts:75
- **Scenario**: An attacker captures one still-validly-signed GitHub delivery (HMAC never expires). Both dedup layers expire the id after 10 min (`DELIVERY_TTL_MS`, and the DB claim's `DEFAULT_TTL_MS`, webhook-deliveries.ts:13). Re-sending the identical request >10 min later re-claims and fully reprocesses it.
- **Root cause**: The header comment frames dedup as "replay defense," but a time-bounded claim only collapses near-simultaneous duplicates; it is not replay protection against a captured request beyond the TTL.
- **Impact**: A replayed `push` delivery re-runs a scan + regression alert (double alert / double spend); a replayed gate re-posts checks. Bounded, but it is exactly the abuse the dedup claims to stop.
- **Fix sketch**: Persist processed delivery ids for GitHub's full redelivery horizon (hours/days) rather than 10 min, or additionally bound acceptance by the event timestamp so a stale replay is rejected outright.

## 6. Push rescan reads the prior report before persisting, so back-to-back pushes diff against a stale baseline
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/app/api/app/webhook/route.ts:344
- **Scenario**: Two default-branch pushes (commits C1 then C2) land within seconds → two deferred `runPushRescan` runs. Both read `prev` (getScanReportByCommit, route.ts:344) before either persists, so both see baseline R0. Run-1 persists R1 and alerts R0→R1; run-2 persists R2 but still alerts R0→R2 instead of R1→R2.
- **Root cause**: Read-then-write with no serialization on the (owner,repo) rescan; `prev` is captured outside any claim covering the persist.
- **Impact**: A regression introduced by C1 and reverted by C2 can be missed, or a two-step regression mis-attributed — wrong/duplicated regression alerts on active repos.
- **Fix sketch**: Re-read the latest persisted report immediately before diffing (post-persist), or serialize rescans per repo (advisory lock / claim keyed on owner+repo) so each diff sees the immediately-prior scan.

## 7. Installation token cache grows unbounded (no size cap or sweep)
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: unbounded-growth
- **File**: src/lib/github/app.ts:137
- **Scenario**: `tokenCache` gains one entry per installation id and is only ever overwritten on re-mint or dropped on explicit `invalidateInstallationToken`. A long-lived multi-tenant App serving many thousands of installations accumulates entries indefinitely.
- **Root cause**: Unlike the deliberately bounded `seenDeliveries` (DELIVERY_MAX + eviction), the token cache has no LRU/TTL eviction — the "valid ~1h" comment implies staleness but nothing reaps expired rows.
- **Impact**: Slow memory growth on a large, long-running instance; also keeps stale (revoked) tokens resident until their id is re-touched. Minor.
- **Fix sketch**: Bound the map (LRU cap) and/or opportunistically drop entries whose `expires` is past on access, mirroring the delivery-map eviction.
