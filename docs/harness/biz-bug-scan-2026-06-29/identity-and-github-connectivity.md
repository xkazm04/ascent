# Biz+Bug Scan — Identity & GitHub Connectivity — ascent — 2026-06-29

> Combined business-visionary + bug-hunter scan over 3 contexts.
> Total: 15 findings — Critical: 1, High: 3, Medium: 11, Low: 0  (bug: 10, business: 5)

---

## GitHub Repo Data Access

### 1. Org discovery uses un-timed `fetch`, blocking the OAuth callback (login latency)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: latent-failure / recovery-gap
- **File**: src/lib/github/discover.ts:60
- **Scenario**: `ghUser()` (backing `fetchUserOrgs`/`fetchUserRepos`) calls bare `fetch(...)` with no timeout/abort — unlike the rest of the layer, which routes through `fetchWithTimeout` (host.ts:70). The callback `await`s `discoverOrgs(...)` *before* redirecting (callback/route.ts:115). If GitHub's `/user/orgs` or `/user/repos` hangs, every sign-in hangs until the platform function timeout.
- **Root cause / Rationale**: Discovery is "best-effort" and wrapped in `.catch`, but a *hang* is not an error the catch can intercept — it just stalls the redirect. Login is exactly when GitHub API pressure peaks.
- **Impact**: Degraded/timed-out sign-in for all users during a GitHub slowdown; the discovery nicety becomes a hard dependency of the login critical path.
- **Fix sketch**: Route `ghUser` through `fetchWithTimeout` (e.g. 8–10s) like source/governance/graphql; on timeout, degrade to "no suggestions" (already handled by the surrounding `.catch`).

### 2. CODEOWNERS truncated at 14 KB silently corrupts team attribution
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / boundary
- **File**: src/lib/github/source.ts:423 (`content.slice(0, MAX_FILE_BYTES)`), consumed at src/lib/github/codeowners.ts:62
- **Scenario**: `findCodeownersContent` reads the CODEOWNERS body out of the *snapshot's fetched files*, which `source.ts` truncates to `MAX_FILE_BYTES` (14 000 bytes). Large-monorepo CODEOWNERS files run many KB; `parseCodeowners` then only sees the first ~14 KB.
- **Root cause / Rationale**: The ingestion byte budget (sized for LLM prompts) is reused as the source for an *exact* structured parse. Teams defined past the cutoff vanish, and if the `*` catch-all line sits late in the file the repo's primary/default owner is mis-attributed.
- **Impact**: `RepoTeam` persistence + `getOrgTeamRollup` under-count or mis-assign team ownership — a quietly wrong org-structure view, on exactly the big orgs that buy team rollups.
- **Fix sketch**: Fetch CODEOWNERS in full (it's small relative to a repo and high-signal) via a dedicated un-truncated read, or raise/remove the cap for this one path before parsing.

### 3. GraphQL "prefer partial data" yields silently-incomplete PR sets feeding the score
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/github/graphql.ts:67
- **Scenario**: When GitHub returns `data` *and* `errors` (some PR nodes failed to resolve), the client keeps the partial data and only `console.warn`s. The maturity score (D7 review/PR signals) is then computed off a non-representative slice with no user-facing signal of the gap.
- **Root cause / Rationale**: The "don't fail the whole scan over one bad node" intent is right, but there's no surfaced flag distinguishing "complete" from "partial" — `totalCount` still reports the true repo-wide count, making "N analyzed of M" look healthy while N is silently degraded.
- **Impact**: Inconsistent/under-stated scores on transient GraphQL hiccups; "success theater" — the report looks authoritative.
- **Fix sketch**: Thread a `partial: boolean` out of `githubGraphql`/`fetchPullRequests` and have the scorer/report annotate "based on partial data" (and skip caching a partial result).

### 4. Built-but-unmonetized GitHub Enterprise Server support → Enterprise tier
- **Severity**: High
- **Lens**: business-visionary
- **Category**: monetization / differentiation
- **File**: src/lib/github/host.ts:21
- **Scenario**: `githubApiBase/GraphqlUrl/RawBase` already honor `GITHUB_API_URL/GRAPHQL_URL/RAW_URL`, so the whole I/O layer can point at a self-hosted GHES (discover.ts:18 was just fixed to comply). Enterprises with air-gapped/firewalled GitHub are precisely the buyers who can't use Snyk/Sonar SaaS against private GHES easily.
- **Root cause / Rationale**: The capability exists only as undocumented env vars — no UI, no plan gating, no go-to-market. It's a complete differentiator sitting on the floor.
- **Impact**: Misses the highest-ACV segment (self-hosted/regulated orgs); GHES + private-repo scanning is a natural "Enterprise" plan with a real moat.
- **Fix sketch**: Package GHES config as an Enterprise tier (settings UI for the three hosts + connectivity check), document it, and gate behind the paid plan; market "scan your private/self-hosted GitHub."

### 5. CODEOWNERS team attribution → premium "riskiest team" scorecards
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: differentiation / monetization
- **File**: src/lib/github/codeowners.ts:29
- **Scenario**: `parseCodeowners` already maps repos → owning teams (with default-owner + owned-path counts). Competitors score repos; almost none roll maturity/security *up to the team/org-chart* granularity an engineering VP actually manages by.
- **Root cause / Rationale**: The data is extracted and persisted but the user-facing value (team leaderboards, "which team owns the most at-risk repos", per-team trend) is the kind of org-level insight worth a premium org seat.
- **Impact**: Strong retention/expansion lever for org admins; a differentiated view vs Snyk/SonarCloud/CodeClimate.
- **Fix sketch**: Build a "By team" rollup (team maturity averages, regressions by team, default-owner coverage gaps) on the existing `getOrgTeamRollup`; gate the team dashboard behind the Team/Org plan.

---

## GitHub App Installation & Webhooks

### 1. `/api/app/repos` IDOR — auth guard keys off the DORMANT custom OAuth, not the active Supabase wall
- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: input-validation / cross-tenant-IDOR
- **File**: src/app/api/app/repos/route.ts:38
- **Scenario**: The guard is `if (isAuthConfigured() && !(await sessionHasInstallation(installationId))) return 403`. `isAuthConfigured()` (auth.ts:85) is true only when the **custom** GitHub OAuth env (`GITHUB_OAUTH_CLIENT_ID/SECRET` + `AUTH_SECRET`) is set. Per access.ts the production login wall is **Supabase**, with custom OAuth "dormant" — so `isAuthConfigured()` is **false**, the whole check short-circuits, and `requireViewer()` is never called. An unauthenticated caller can `GET /api/app/repos?org=<victim-org>` (or iterate `?installation_id=`), and `getInstallationIdForOwner` resolves any org's install id from the DB → the response includes the installation's **private** repo names/URLs/languages.
- **Root cause / Rationale**: authz.ts was hardened to gate on `authGateEnabled()` (Supabase) everywhere, but this token-minting route was missed and still uses the legacy `isAuthConfigured()` + `sessionHasInstallation()` (custom-session) pair, which is inert under the Supabase wall.
- **Impact**: Cross-tenant disclosure of private repository inventory for any installed org — a textbook IDOR on the exact endpoint that lists private rows.
- **Fix sketch**: Gate with the active wall: `const gate = await requireViewer(); if (gate) return gate;` then authorize the installation against the Supabase viewer's real org membership (the `viewerOrgRole`/installation-ownership path), not `sessionHasInstallation`.

### 2. Push rescan runs an unthrottled, LLM-billed full scan on every default-branch push
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: retry-storm / cost-DoS
- **File**: src/app/api/app/webhook/route.ts:319 (dispatched at :477)
- **Scenario**: `runPushRescan` calls `scanRepository(fullName, { token })` — a **real** (non-mock) scan with LLM spend — for every push where `onDefault && headMoved` on a watched repo. There is no debounce, coalescing, or rate limit. A busy monorepo (or a CI bot force-pushing main) fires N full scans for N pushes.
- **Root cause / Rationale**: Unlike the PR gate (which uses `mock: true`, free), the push path is the deterministic-LLM scan; delivery dedup only collapses identical delivery ids, not rapid *distinct* SHAs.
- **Impact**: Unbounded LLM/credit burn and GitHub API pressure driven by an attacker- or CI-controlled push cadence; a cost-amplification/DoS lever.
- **Fix sketch**: Debounce per-repo (e.g. coalesce pushes within a short window / only scan the latest head), or enqueue with a per-repo minimum interval; consider a mock/light pre-pass and only spend LLM on a meaningful diff.

### 3. Concurrent push rescans diff against a stale baseline → duplicate/misleading regression alerts
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/app/api/app/webhook/route.ts:318
- **Scenario**: Two near-simultaneous pushes (distinct SHAs, distinct delivery ids) both pass dedup and both run in `after()`. Each reads `prev = getScanReportByCommit(...)` = the *pre-both* report, scans its own SHA, persists (neither deduped), and calls `checkAndAlertRegression(prev, report, …)`. Both compare to the **same** old baseline; the intermediate scan is never used as a baseline.
- **Root cause / Rationale**: No per-repo serialization or "compare against immediately-prior persisted scan under a lock" — `prev` is captured before the concurrent writers commit.
- **Impact**: Duplicate or wrong-baseline regression alerts (alert fatigue, incorrect "regressed vs X"); non-deterministic "latest" report.
- **Fix sketch**: Serialize rescans per repo (advisory lock / queue), and resolve `prev` as the latest persisted scan *inside* the same critical section as the persist.

### 4. Webhook replay protection is process-local → ineffective across serverless instances
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption / replay
- **File**: src/app/api/app/webhook/route.ts:69
- **Scenario**: `seenDeliveries` is an in-memory `Map` per instance. On the stated prod (Vercel/serverless, multi-instance), a captured still-valid signed delivery re-sent to a *different* instance is not recognized as a duplicate and re-triggers the scan/gate/alert pipeline. The same locality means `forgetDelivery`'s retry-release is also per-instance.
- **Root cause / Rationale**: An instance-local cache can only collapse same-instance replays (the comment acknowledges this), but the deployment model defeats it.
- **Impact**: Replayed deliveries re-run (mock) gates and **real** push scans → cost burn + duplicate Check Runs/comments/alerts; not a signature bypass, but a resource/abuse vector.
- **Fix sketch**: Persist processed delivery ids (DB/Redis with TTL) keyed by `X-GitHub-Delivery`, or make the work idempotent on `(repo, headSha)` before spending.

### 5. The PR gate Check Run + sticky comment is an untapped growth + monetization surface
- **Severity**: High
- **Lens**: business-visionary
- **Category**: retention / monetization / virality
- **File**: src/app/api/app/webhook/route.ts:233 (`createCheckRun`) / :245 (`upsertStickyComment`); policy at :219
- **Scenario**: Every gated PR already renders an Ascent Check Run + comment in the customer's repo — a recurring, in-context impression seen by every contributor and reviewer. Gate policy is org-configurable (`getOrgGatePolicy`) but currently just shapes the verdict.
- **Root cause / Rationale**: This is the rare developer-tool with a built-in viral loop (PR comments market the product to every collaborator) and a natural paywall (custom org gate policies, required-check enforcement).
- **Impact**: Bottom-up adoption flywheel + a clean Team/Enterprise gate ("custom maturity policies, required gates, branded PR badge").
- **Fix sketch**: Add a subtle "powered by Ascent — see full report" CTA + shareable report link to the comment (growth), and gate custom/required policies behind the paid plan (monetization); track click-through as an activation metric.

---

## GitHub OAuth & Session

### 1. CSRF same-origin check reads raw `Host`, while the rest of auth uses `x-forwarded-host`
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / proxy-mismatch
- **File**: src/lib/auth.ts:385 (`isSameOrigin`)
- **Scenario**: `isSameOrigin` compares `new URL(origin).host` to `request.headers.get("host")`. Everywhere else the code deliberately prefers `x-forwarded-host` (publicOriginForRequest, auth.ts:205) precisely because behind a TLS-terminating proxy the raw `Host` can be the *internal* host. When `Host` is internal, the browser's `Origin` (external) won't match → `isSameOrigin` returns false.
- **Root cause / Rationale**: Inconsistent host resolution between the CSRF guard and the rest of the auth layer.
- **Impact**: On a proxy that rewrites `Host`, the CSRF-guarded POSTs (`/api/auth/logout`, `/api/auth/revoke-sessions`) 403 for *all* legitimate users — users can't sign out (a real, user-facing breakage and a security-feature outage).
- **Fix sketch**: Compare against the same external origin helper (validate `x-forwarded-host`/`x-forwarded-proto` first, fall back to `Host`); single-source it with `publicOriginForRequest`.

### 2. Proxy validates the Supabase JWT (`getUser`) on every non-static request
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: performance / cost
- **File**: src/proxy.ts:51
- **Scenario**: The proxy runs on a broad matcher (all navigations + API calls) and calls `supabase.auth.getUser()`, which makes a network round-trip to the Supabase auth server to validate the JWT — on every such request, including unauthenticated/public paths.
- **Root cause / Rationale**: `getUser()` is used purely to trigger cookie refresh, but it incurs a per-request auth-server hop (vs a local `getSession`/claims check) across the entire surface.
- **Impact**: Adds Supabase-round-trip latency to every page/API hit and load/cost on the auth server; degrades the whole app's TTFB and couples availability to Supabase latency.
- **Fix sketch**: Refresh via the cheaper local session path and reserve `getUser()` (server-side validation) for actually gated data sources (the gate already calls it); or scope the proxy matcher to authenticated areas.

### 3. Session cookie tail-drops installations to fit 3800 B → power users silently lose org access
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: boundary / silent-failure
- **File**: src/lib/auth.ts:592
- **Scenario**: `buildSession` drops installations from the tail until the signed cookie fits `MAX_SESSION_COOKIE_BYTES`. A user belonging to many GitHub orgs (long logins) keeps only a prefix; dropped orgs read as "public" (readableOrgForOwner:336) and are absent from `orgOptionsForSession`.
- **Root cause / Rationale**: All access state is carried in the cookie, whose size is hard-capped; trimming is "graceful degradation" but it silently removes *authorization*.
- **Impact**: Enterprise users (most orgs = most valuable) non-deterministically can't see/act on some of their orgs, with only a server log — a confusing, hard-to-report access bug.
- **Fix sketch**: Stop carrying the full installation list in the cookie — store a session id and resolve installations server-side (DB/cache), or at minimum surface a visible "some orgs hidden — re-sync" notice and make the kept set deterministic/user-pinnable.

### 4. Two live auth systems (custom HMAC cookie + Supabase) create a divergent trust model
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: architecture / latent-failure
- **File**: src/app/api/auth/callback/route.ts:142 (still mints `ascent_session`) vs src/lib/access.ts:35 (Supabase wall)
- **Scenario**: The "dormant" custom OAuth callback is fully wired and still mints a real signed session; authz.ts branches on both `authGateEnabled()` (Supabase) and `isAuthConfigured()`/`getSession()` (custom). Routes pick different doors — the concrete failure is the `/api/app/repos` IDOR above, where the custom-session check is inert under Supabase.
- **Root cause / Rationale**: A half-migrated auth model: the new wall was added without retiring or fully reconciling the old one, so each new endpoint can pick the wrong gate.
- **Impact**: Recurring authz drift (mis-gated routes), double-maintenance, and reviewer confusion; the IDOR is one instance, others are easy to introduce.
- **Fix sketch**: Pick one wall: either retire the custom OAuth routes/`getSession` or make every gate funnel through one `requireViewer`/`viewerOrgRole` resolver; add a lint/test asserting no route gates solely on `isAuthConfigured()`.

### 5. `read:user`-only scope + session security features → activation & Enterprise-trust levers
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: activation / monetization / differentiation
- **File**: src/lib/auth.ts:445 (scope) ; src/app/api/auth/revoke-sessions/route.ts (kill switch)
- **Scenario**: Discovery was narrowed to `read:user` for consent conversion, but that means `/user/orgs` returns only *public* memberships — private-org/enterprise members (the buyers) get few/no onboarding suggestions, so the seed-the-dashboard activation loop under-fires for them. Separately, "sign out everywhere" exists but has no device/session-management UI, and there's no SSO/SAML.
- **Root cause / Rationale**: Least-privilege consent is right by default, but there's no opt-in to recover discovery quality, and the security primitives aren't packaged as differentiated value.
- **Impact**: Weaker activation for the highest-value segment; a missed Enterprise security story (session/device management, SSO) vs Snyk/Sonar enterprise.
- **Fix sketch**: Add an in-app "Discover my orgs" opt-in that requests `read:org` on demand (recovering full `rankDiscoveredOrgs` output); package session/device management + SSO/SAML as an Enterprise security tier.
