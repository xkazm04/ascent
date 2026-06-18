> Total: 6 findings (3 critical, 2 high, 1 medium)
# Test Mastery — GitHub OAuth & Session

This context is the login wall and the per-tenant read gate for the whole app. Yet the **only** test file in scope (`src/lib/auth.test.ts`) exercises five *pure* helpers — `buildSession`, `encodeSession`, `decodeSession`, `publicOriginForRequest`, `safeNext`. A repo-wide grep confirms **zero** tests reference `isSameOrigin`, `readableOrgForOwner`, `getSessionState`, `verifySessionVersion`, `authBypassEnabled`/`authGateEnabled`, `requireViewer`/`getViewer`, `revokeOtherSessions`, `getActiveOrg`, or `orgOptionsForSession`. The risk lives exactly one layer above where the tests stop: the authorization decisions, the CSRF guard, the revocation enforcement, and the production-only bypass lock are all untested. Findings are ranked by business blast radius.

## 1. Pin the cross-tenant read gate `readableOrgForOwner` to a failing-case matrix
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/lib/auth.ts:332-336
- **Scenario**: A future edit flips the boolean (returns `ownerLc` when the viewer has NO installation, or drops the `.toLowerCase()` on either side), and every report/usage/history reader that calls `readableOrgForOwner(owner)` now serves another tenant's private scan data to an unauthorized viewer. Nothing fails — the app still renders, just with the wrong org's numbers.
- **Root cause**: This is the single function that converts an owner param into the org slug a viewer may read, and it has no test at all. The case-insensitive membership match (`i.login.toLowerCase() === ownerLc`) and the "fall back to public" default are exactly the kind of one-character invariant that silently inverts.
- **Impact**: Cross-tenant data exposure of private-repo maturity scans — a privacy/security breach and a contractual (tenant-isolation) failure for the enterprise customers this product targets.
- **Fix sketch**: Unit-test `readableOrgForOwner` with a mocked `getSession`. Assert the invariant in BOTH directions: (a) viewer WITH a matching installation (incl. case-mismatched casing `Acme` vs `acme`) ⇒ returns the lowercased owner org; (b) viewer WITHOUT a matching installation ⇒ returns exactly `"public"`, never `ownerLc`; (c) `session === null` ⇒ `"public"`. The load-bearing assertion is that a non-member NEVER receives the private org slug.

## 2. Test the CSRF guard `isSameOrigin` for the cross-site REJECT path, not just accept
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/lib/auth.ts:381-392
- **Scenario**: `isSameOrigin` is the sole gate on POST `/api/auth/logout` and `/api/auth/revoke-sessions`. A refactor weakens it (e.g. trusts a missing Origin, or compares `new URL(origin).hostname` against the `host` header which includes the port, so `evil.com` slips through), and any third-party page can drive-by force-logout a victim or force-revoke all their other sessions via an embedded form/`<img>`.
- **Root cause**: The function has no test. Its two branches are subtle: when `Origin` is present it parses and host-compares (must REJECT a foreign origin and a malformed origin); when absent it falls back to `sec-fetch-site === "same-origin"` (must REJECT `cross-site`/`same-site`/absent). The reject paths are precisely what protect against CSRF and are the easiest to regress unnoticed.
- **Impact**: Drive-by CSRF logout / session-revocation of authenticated users — account-availability attack and a trust/security incident.
- **Fix sketch**: Table-test `isSameOrigin(new Request(url, { headers }))`: accept {same `origin` host; no origin + `sec-fetch-site: same-origin`}; REJECT {`origin: https://evil.com`; origin host with mismatched port; un-parseable origin → `catch` returns false; no origin + `sec-fetch-site: cross-site`; no origin + no fetch-metadata}. Invariant: returns `true` ONLY for a provably same-origin request.

## 3. Cover the revocation + fail-open state machine in `getSessionState`/`verifySessionVersion`
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/lib/auth.ts:217-229, 253-299
- **Scenario**: The "logout is real / a stolen cookie dies" guarantee lives entirely in the verdict branching: `revoked` ⇒ expired; past short `exp` + DB authority + not-`valid` ⇒ expired; `unknown` (DB blip) ⇒ allowed within access TTL only; refresh only when affirmed. A regression that treats `unknown` like `valid`, or refreshes an unaffirmed token, would let a revoked/stolen cookie live for the full 7-day inactivity horizon instead of lapsing at the 60-minute access TTL — defeating server-side revocation. The app behaves normally; the security property is just gone.
- **Root cause**: The whole `SessionStatus` resolution is untested. `verifySessionVersion` (`stored > sv ⇒ revoked`, DB-unconfigured ⇒ `unknown`, throw ⇒ `unknown`) and the `getSessionState` time-window branches are the most security-load-bearing logic in the module, yet only `decodeSession`'s horizon math is tested.
- **Impact**: Logout / "sign out everywhere" / uninstall stop actually killing sessions — a stolen or post-logout cookie remains usable far past its intended ceiling. Direct account-takeover persistence risk.
- **Fix sketch**: With mocked `next/headers` cookies + `getSessionVersion`/`isDbConfigured`, assert: (a) `stored > token.sv` ⇒ status `expired`, session null; (b) token past `exp` + DB on + version lookup throws (`unknown`) ⇒ `expired` (does NOT extend); (c) token past `exp` + `valid` ⇒ re-minted with fresh `exp`/`rexp` and `status:active`; (d) stateless (no DB) ⇒ governed by `rexp` alone; (e) read-only cookie store throws on `set` ⇒ `status:active` + `needsRefresh:true`, NOT logged out. Invariant: an unaffirmed token never survives past its short `exp` when a DB authority exists.

## 4. Lock the production bypass kill-switch (`authBypassEnabled`/`authGateEnabled`)
- **Severity**: High
- **Category**: coverage-gap
- **File**: src/lib/access.ts:27-46
- **Scenario**: The code comment is explicit: "a single stray `ASCENT_AUTH_BYPASS` env var must never be able to drop the entire login wall on a real deployment." A refactor (or a copy into `src/proxy.ts`'s inlined `gateInactive`) drops the `NODE_ENV === "production"` short-circuit, and setting `ASCENT_AUTH_BYPASS=1` in prod now opens the gate for everyone as the synthetic `DEV_VIEWER`. No test catches it.
- **Root cause**: The production hard-disable invariant — the security reason this flag exists — is asserted only in a comment. `authBypassEnabled`, `authGateEnabled`, and `requireViewer`'s 401-vs-null branch are untested. The same logic is *duplicated* in `proxy.ts` (`gateInactive`) with no test tying the two copies together, so they can drift.
- **Impact**: A single misconfigured/leaked env var silently disables the entire auth wall in production — full unauthenticated access to every gated surface.
- **Fix sketch**: Unit-test by stubbing `process.env`: assert `authBypassEnabled()` is `false` when `NODE_ENV==="production"` regardless of `ASCENT_AUTH_BYPASS` value, `true` only for `"1"`/`"true"` in non-prod; assert `authGateEnabled()` true only when Supabase configured AND bypass off; assert `requireViewer()` returns a 401 `NextResponse` when gate enabled + no viewer, and `null` when gate disabled. Add a parity test asserting `proxy.gateInactive()` and `authGateEnabled()` agree across the env matrix so the two copies can't diverge.

## 5. Add a forgery-rejection test to `decodeSession` (HMAC tamper), not just round-trip
- **Severity**: High
- **Category**: success-theater
- **File**: src/lib/auth.ts:118-140 (tested by src/lib/auth.test.ts:39-102)
- **Scenario**: The session cookie's integrity rests entirely on `decodeSession` rejecting any payload whose HMAC doesn't verify. Today's tests only round-trip a *self-signed* cookie and check `exp`/`rexp` horizons — they never assert that a tampered payload or a wrong/forged signature is rejected. A regression that, say, parses the payload before (or instead of) the `timingSafeEqual` check, or accepts a length-mismatched signature, would let an attacker forge an arbitrary `login`/`installations` session. The green suite would not notice.
- **Root cause**: `encodeSession round-trips through decodeSession` is a happy-path assertion that proves encode and decode are mutually consistent, not that decode is a trust boundary. The negative cases (the whole point of an HMAC) are missing.
- **Impact**: Session forgery = full account/tenant impersonation if the verification path ever weakens. This is the one check standing between a cookie and identity.
- **Fix sketch**: Add cases: (a) flip one char of the base64url payload, keep the old sig ⇒ `decodeSession` returns `null`; (b) replace the sig with garbage / a sig of a different payload ⇒ `null`; (c) a payload signed with a DIFFERENT `AUTH_SECRET` ⇒ `null`; (d) a value with no `"."` separator ⇒ `null`; (e) valid HMAC but JSON missing `login` or non-numeric `exp` ⇒ `null`. Invariant: only a payload bearing a valid HMAC under the current `AUTH_SECRET` decodes.

## 6. Cover `getActiveOrg`/`orgOptionsForSession` so a tampered ACTIVE_ORG cookie can't widen access
- **Severity**: Medium
- **Category**: edge-case
- **File**: src/lib/auth.ts:344-373
- **Scenario**: `getActiveOrg` validates the `ascent_active_org` cookie against the session's selectable options "so a stale or hand-set cookie can never select an org the viewer can't access." A regression that returns `raw` before the `options.find(...)` membership check (or matches case-sensitively and then trusts the raw value) lets a user hand-set the cookie to an org they don't belong to and have it accepted as their active tenant. `orgOptionsForSession`'s de-dup + always-append-`public`-last contract is also untested.
- **Root cause**: Both functions are untested. The security-relevant line is the `options.find((o) => o.toLowerCase() === raw.toLowerCase())` gate — a stale/tampered cookie must fall through to the first installation or `"public"`, never to an arbitrary value.
- **Impact**: A tampered cookie could mis-scope the active workspace to an org the viewer can't access (defense-in-depth erosion alongside finding 1).
- **Fix sketch**: With mocked cookies + session: assert `getActiveOrg` (a) returns the canonical-cased option when the cookie matches a member org case-insensitively; (b) returns the first installation (not the raw value) when the cookie names a NON-member org; (c) returns `"public"` for a null session. For `orgOptionsForSession`: assert case-insensitive de-dup preserves original casing and `"public"` is always present and last. Invariant: `getActiveOrg`'s result is always an element of `orgOptionsForSession(session)`.
