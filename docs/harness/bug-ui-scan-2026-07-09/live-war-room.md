# Live War Room — bug-hunter + ui-perfectionist scan

> Context: Live War Room (group: Org Planning & Execution)
> Files scanned: 13
> Total: 7 findings (Critical: 0, High: 2, Medium: 3, Low: 2)

## 1. Share token has no revocation and a hardcoded 7-day life
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: missing-revocation
- **File**: src/lib/live-share.ts:25
- **Scenario**: An owner clicks "Share TV link", the URL is screenshotted / forwarded / left on a projector. The org later removes that owner, or the link simply escapes. There is no way to kill that one link.
- **Root cause**: The token is a stateless HMAC capability (`{org, exp}`), verified only by signature + `exp` (line 34–52). Nothing server-side records or can revoke an individual token, and the TTL is hardcoded to 7 days (`DEFAULT_TTL_MS`, line 9) — the route passes no ttl. The only kill switch is rotating the secret, which defaults to `AUTH_SECRET` (line 13) and would sign out every user.
- **Impact**: A single leaked link exposes private repo names + fleet scores unauthenticated for 7 days, un-revocably. Each re-mint spawns another live token (no listing/idempotency).
- **Fix sketch**: Store a per-token `jti` (or per-org `sharesRevokedBefore` epoch); check it in `verifyLiveShareToken`; add a revoke/rotate endpoint. Shorten default TTL and make it caller-settable.

## 2. Share-link mint is open in an auth-off deployment, reopening a read path the read-gate keeps closed
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: trust-boundary-inconsistency
- **File**: src/app/api/org/live-share/route.ts:24
- **Scenario**: A deployment has `DATABASE_URL` + `AUTH_SECRET` set but GitHub OAuth unconfigured and the Supabase gate off (a real "auth-off-with-secret" state). `requireOrgRole(org,"owner")` falls into authz.ts:206 `if (!isAuthConfigured()) return null` → open. Any anonymous same-origin caller POSTs `/api/org/live-share` for ANY org, gets a token, and reads that org's fleet via `/live/shared/[token]`.
- **Root cause**: `requireOrgRole` (mint) is open when auth is off, but the sibling read gate `requireOrgRead`/`canReadOrg` deliberately stays CLOSED in the same config (`openOrgDashboardsEnabled()` defaults false, added precisely so "a dropped AUTH_SECRET won't turn every org public"). The share route bypasses that hardening.
- **Impact**: Cross-tenant private-data disclosure through a mintable link in exactly the misconfig the read gate was hardened against.
- **Fix sketch**: Gate mint on `openOrgDashboardsEnabled()` (or an explicit owner membership) in the auth-off branch, matching `canReadOrg`; do not treat "OAuth unset" as "anyone may mint".

## 3. Classifier coerces null/empty numeric fields into a fake 0 score
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: src/components/org/liveWarRoomShared.ts:131
- **Scenario**: The server emits `{repo, overall: null}` (or `""`/`false`/`[]`) for a repo. `Number(null) === 0` is finite, so `classifyRepoEvent` returns `{kind:"scored", overall:0}` instead of rejecting it; the same happens for adoption/rigor via `finiteOrNull` (line 116, `Number(null)→0`).
- **Root cause**: The classifier — explicitly the consumers' single trust boundary against non-finite scores — uses `Number(x)`, which maps `null`/`""`/`false`/`[]` to a legitimate-looking 0 rather than "absent". The test suite only covers `"not-a-number"` and `Infinity`.
- **Impact**: A repo's real seeded standing is overwritten with 0; the headline tiles, leaderboard, and fleet averages silently sink. Same failure class the NaN-guard was built to prevent.
- **Fix sketch**: Require `typeof d.overall === "number"` (reject `== null`) before `Number.isFinite`; make `finiteOrNull` reject `null`/non-number inputs before coercion. Add null/""/false cases to the test.

## 4. No domain separation between share tokens and session cookies
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: crypto-key-reuse
- **File**: src/lib/live-share.ts:13
- **Scenario**: With `LIVE_SHARE_SECRET` unset (the documented default), share tokens are `HMAC-SHA256(AUTH_SECRET, base64url(json))` in `payload.sig` form — byte-identical construction to session cookies (`auth.ts` `signSession`/`hmac`). The two token types are mutually signature-valid; only the disjoint required-field checks (`org` here vs `login` in auth.ts) stop confusion.
- **Root cause**: The HMAC carries no purpose/`aud` tag and reuses the session key. Safety rests entirely on payloads never sharing required fields — a landmine for whoever later adds `org` to `Session`.
- **Impact**: Latent cross-protocol token confusion; a future session field change could make a session cookie a valid share token.
- **Fix sketch**: Prefix the signed payload with a domain tag (e.g. `"live-share.v1:"`) and/or default to a dedicated derived key rather than raw `AUTH_SECRET`.

## 5. Movers ticker is a high-frequency `aria-live="polite"` region
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/org/LiveWarRoomPanels.tsx:111
- **Scenario**: During a full-fleet scan, every landed repo prepends an `<li>` inside `<ul aria-live="polite">`. A 50-repo run queues ~50 row announcements ("acme/api ▲5 L3 62"), and the progress caption + celebrations are also polite regions announcing concurrently.
- **Root cause**: A rapidly-mutating list is marked as a live region wholesale; a screen reader falls minutes behind reading a backlog of transient ticker rows that carry no standalone meaning.
- **Impact**: Screen-reader users get an unusable flood during scans; the meaningful aggregate (headline tiles) is drowned out.
- **Fix sketch**: Drop `aria-live` from the ticker `<ul>` (it is a visual stream); expose a single polite summary ("N repos scored, top mover X") instead, and keep only one active polite region during a run.

## 6. Deadline countdown is off by a day for non-UTC users
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: timezone
- **File**: src/components/org/LiveWarRoomHeader.tsx:28
- **Scenario**: `daysUntil` does `Date.parse("YYYY-MM-DD")` (parsed as UTC midnight) minus local `Date.now()`, then `Math.ceil(/86_400_000)`. For a user in a negative UTC offset in the evening, the goal's "Xd to deadline" flips a day early / "past deadline" shows prematurely.
- **Root cause**: Mixing a UTC-parsed date-only string with a local-clock now.
- **Impact**: The rallying-goal countdown is off by one near midnight — minor but visible on the wall.
- **Fix sketch**: Parse the date in local time (split `YYYY-MM-DD` into `new Date(y, m-1, d)`) or compare both endpoints in the same zone.

## 7. Kiosk page's friendly fallback is bypassed if the rollup read throws
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: recovery-gap
- **File**: src/app/live/shared/[token]/page.tsx:34
- **Scenario**: The shared page carefully renders a friendly `Notice` for invalid token, no DB, and empty org, and wraps `getOrgRepoHistories` in `.catch(() => [])` — but `getOrgRollup(verified.org)` (line 34) is unguarded. A transient DB error throws and the unattended TV shows a raw Next error screen.
- **Root cause**: Inconsistent error handling on a page explicitly designed to run unattended on a kiosk.
- **Impact**: An unmanned wall breaks to a stack-trace/error page on a blip instead of degrading gracefully.
- **Fix sketch**: Wrap the rollup read in try/catch and render the "No data" (or a "temporarily unavailable") `Notice` on failure, matching the histories path.
