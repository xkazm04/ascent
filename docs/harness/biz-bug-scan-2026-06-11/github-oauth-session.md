# GitHub OAuth & Session â€” business-visionary + bug-hunter scan (2026-06-11)
> Total: 4 findings (3 bug / 1 business)

Scope verified against current source. All prior github-oauth findings (bug-hunt 2026-06-08 #1-6 and
2026-06-09 #1-7) are confirmed FIXED in the present code (secure-cookie via `secureCookieForRequest`,
constant-time CSRF state, `error=denied`/`error=csrf` branches, URL-built `resynced=1`, error_description
surfaced, oversized-cookie guard). The deferred OAuth-posture items (#2 fail-open revocation, #3/#4 rotation,
#6) are left untouched. The four below are NEW, concretely traceable, and don't overlap the do-not-re-flag set.

## 1. `safeNext` rejects every redirect target containing a hyphen â€” post-login bounce to `/connect` for the majority of real org/repo names
- **Type**: bug
- **Severity**: High
- **Category**: edge-case / silent-failure
- **File**: src/lib/auth.ts:382
- **Scenario**: The control-char guard is `if (/[ -\s]/.test(next)) return fallback;`. By ES Annex B, a character class with `\s` as a range endpoint (`[ -\s]`) is **not** a range â€” it's parsed as the *union* `{ " ", "-", \s }`. So the class matches a literal hyphen `-`. Every post-login `next` whose path contains a hyphen is silently discarded and replaced by the `/connect` fallback. GitHub org and repo names use hyphens constantly (`acme-corp`, `next-forge`, `create-react-app`), and `encodeURIComponent` does **not** encode `-`, so the hyphen survives into the decoded `next` the login route reads. Verified at runtime: `/[ -\s]/.test("/org/acme-corp") === true`; `/[ -\s]/.test("/trends?repo=my-org%2Fmy-repo") === true`. Flow: `GitHubSignInButton` â†’ `/api/auth/login?next=%2Forg%2Facme-corp` â†’ `searchParams.get("next")` decodes to `/org/acme-corp` â†’ `safeNext` returns `/connect`. The user who signed in *from* the acme-corp dashboard (or an expired-session prompt on `/trends?repo=â€¦-â€¦`) lands on `/connect`, not where they were.
- **Root cause / Opportunity**: A regex authored as a range (`space`â†’`whitespace`) that JS silently reinterprets as a set including the range hyphen. It *also* under-matches: it does NOT catch sub-0x20 control chars (NUL/0x01/0x1F all test `false`) the comment claims to reject â€” those happen to be caught downstream by the `new URL()` parse, so the over-match (hyphen) is the live defect.
- **Impact**: The core auth happy-path â€” "sign in and come back to what I was looking at" â€” is broken for any hyphenated org slug or owner/repo (a large fraction of all GitHub names). Silent: no error, the user just ends up on the wrong page. Highest value-per-effort in this scan.
- **Fix sketch**: Replace the class with an explicit one that means what the comment says: `if (/[-\s]/.test(next)) return fallback;` (control chars 0x00â€“0x1F, DEL, plus all whitespace). This drops the false hyphen match and actually catches the low control chars. Add a vitest case asserting `safeNext("/org/acme-corp") === "/org/acme-corp"` and `safeNext("/ab") === "/connect"`.
- **Effort**: 1/10 Â· **Impact score**: 8/10

## 2. OAuth authorize + token-exchange `redirect_uri` is built from the internal request origin â€” sign-in fails behind a TLS-terminating proxy
- **Type**: bug
- **Severity**: High
- **Category**: edge-case / config-divergence
- **File**: src/lib/auth.ts:401 and :421 (origin from src/app/api/auth/login/route.ts:23,36 and callback/route.ts:46,82)
- **Scenario**: `buildAuthorizeUrl(origin, state)` and `exchangeCodeForToken(code, origin)` both build `redirect_uri: ${origin}/api/auth/callback`, where `origin = new URL(request.url).origin`. The codebase's OWN comments â€” login/route.ts:30-33 and callback/route.ts:132-135 â€” assert that behind a TLS-terminating proxy `url.origin` is the **internal `http://` origin** (`origin.startsWith("https")` is false), which is precisely why the *cookie* Secure flag was migrated to `secureCookieForRequest()` (x-forwarded-proto). That same wrong origin still feeds `redirect_uri`. So the authorize request sends `redirect_uri=http://â€¦/api/auth/callback` while GitHub has the public `https://â€¦/api/auth/callback` registered â†’ GitHub rejects with a redirect_uri mismatch and sign-in cannot complete. The cookie issue was hardened; the redirect_uri on the *same* origin value was left behind â€” the two paths drifted.
- **Root cause / Opportunity**: The Secure-flag fix conceded "internal origin behind a proxy" but only applied the x-forwarded-proto correction to the cookie, not to the OAuth URLs derived from the same `origin`. (Vercel â€” the apparent primary target â€” reconstructs `request.url` with the public https, so it likely doesn't bite there; self-hosted behind nginx/ALB/Cloudflare, the topology the comments call out, breaks entirely.)
- **Impact**: Complete sign-in failure for self-hosted/reverse-proxy deployments â€” the most severe outcome on this surface, just scoped to that topology.
- **Fix sketch**: Add a `publicOrigin()` helper in auth.ts that prefers `x-forwarded-proto` + `x-forwarded-host` (falling back to `request`-derived origin, and optionally an explicit `PUBLIC_URL`/`AUTH_BASE_URL` env), mirroring `secureCookieForRequest`'s proto read. Thread it into `buildAuthorizeUrl` and `exchangeCodeForToken` in place of `url.origin` at login/callback. The authorize `redirect_uri` and the exchange `redirect_uri` must stay byte-identical â€” derive both from the one helper. Unit-test the helper against synthetic headers (no live OAuth needed).
- **Effort**: 3/10 Â· **Impact score**: 8/10

## 3. `error=denied` and `error=csrf` have no copy entry â€” the cancelled-OAuth and CSRF-mismatch paths still render the generic "Something went wrong."
- **Type**: bug
- **Severity**: Medium
- **Category**: recovery-gap / producer-consumer drift
- **File**: src/app/connect/page.tsx:12-19 (consumer) vs src/app/api/auth/callback/route.ts:61,78 (producer)
- **Scenario**: The 2026-06-09 fix made the callback emit distinct, actionable codes: a user who clicks "Cancel" on GitHub's consent screen (or whose authorization expired / App was suspended) is redirected to `/connect?error=denied`, and a CSRF state mismatch to `/connect?error=csrf`. But the connect page's `ERROR_COPY` map only defines `not_configured`, `missing_installation`, `setup_failed`, `oauth`, `oauth_failed`, `revoke`. Neither `denied` nor `csrf` is present, so `ERROR_COPY[error] ?? "Something went wrong."` falls through to the generic banner. The fix produces the right code; the consumer never learned to read it â€” so the user-facing outcome (the exact "opaque, unactionable failure" the original finding set out to eliminate) is unchanged for the *most common* OAuth abort path (user mis-clicked / cancelled).
- **Root cause / Opportunity**: Producer (callback) and consumer (connect copy map) drifted â€” the new codes shipped without their copy entries. Concretely verifiable by reading both: the keys simply aren't there.
- **Impact**: A user who cancels sign-in or hits a CSRF failure gets "Something went wrong." with no "you cancelled â€” sign in again to continue" guidance, and CSRF failures are visually indistinguishable from generic errors. Defeats the recovery-UX intent of an already-shipped fix.
- **Fix sketch**: Add two entries to `ERROR_COPY` in connect/page.tsx, e.g. `denied: "Sign-in was cancelled on GitHub. Click sign in to try again."` and `csrf: "Your sign-in session expired or didn't match. Please start sign-in again."`. Zero new logic.
- **Effort**: 1/10 Â· **Impact score**: 5/10

## 4. First-login consent requests `read:org` for an optional onboarding nicety â€” broader scope depresses signup conversion
- **Type**: business
- **Severity**: Medium
- **Category**: growth / conversion (least-privilege bonus)
- **File**: src/lib/auth.ts:407 (`scope: "read:user read:org"`); consumed in callback/route.ts:108 `discoverOrgs`
- **Scenario**: The job-to-be-done at first sign-in is "let me scan my repo's maturity." But `buildAuthorizeUrl` requests `read:org` alongside `read:user`, so GitHub's consent screen shows the app asking to read the user's organization membership â€” a scarier, broader prompt that measurably increases OAuth-consent abandonment (a well-known conversion drag for developer tools). The only thing `read:org` buys is the best-effort onboarding suggestions in `discoverOrgs` (`suggestedOrgs` / `seededOrg`), and that code is already fully defensive: `fetchUserOrgs(token).catch(() => [])` and the watchlist seed is wrapped in try/catch. Seeding from the user's own repos (`fetchUserRepos`) only needs `read:user`. So the broadest scope on the most conversion-sensitive screen funds a feature that already degrades gracefully without it.
- **Root cause / Opportunity**: Scope was set for maximal onboarding richness, not for funnel conversion. Minimizing the first-touch scope is both a growth lever (higher sign-in completion) and a least-privilege security win.
- **Impact**: Higher OAuth completion on the publicâ†’connected funnel â€” the single conversion event the whole free-scan funnel drives toward. For an org-membership-discovery feature, it can be re-introduced later as an explicit, in-app opt-in ("Discover my orgs") that requests the extra scope only when the user asks for it.
- **Fix sketch**: Change `scope` in `buildAuthorizeUrl` to `"read:user"`. Discovery needs no other change (it already catches the now-narrower `/user/orgs` result, which without `read:org` returns only public memberships â€” fewer suggestions, never an error). Optionally add a later `?resync` path or a dedicated button that requests `read:user read:org` for users who *want* org discovery. Verifiable via tsc + build; the existing discovery catch-paths keep tests green.
- **Effort**: 1/10 Â· **Impact score**: 6/10
