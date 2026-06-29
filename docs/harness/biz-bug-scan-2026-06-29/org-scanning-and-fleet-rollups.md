# Biz+Bug Scan — Org Scanning & Fleet Rollups — ascent — 2026-06-29

> Combined business-visionary + bug-hunter scan over 4 contexts.
> Total: 21 findings — Critical: 0, High: 3, Medium: 14, Low: 4  (bug: 13, business: 8)

---

## Fleet Alerts & Digests

### 1. Weekly digest cron is a serial loop with no per-webhook timeout — one slow tenant starves the rest
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: latent-failure / timeout
- **File**: src/app/api/cron/digest/route.ts:57 (the `for (const org of orgs)` loop) + src/lib/alerts.ts:362 (`dispatchAlert` `fetch` with no timeout; the digest calls it at route.ts:121 passing **no** `signal`)
- **Scenario**: An operator with 60+ orgs runs the weekly digest. Org #12's Slack webhook hangs (Slack incident / a sink behind a black-holed firewall). `fetch` has no timeout and no AbortSignal, so that one `dispatchAlert` blocks the loop until the socket dies; meanwhile every org is processed strictly serially (rollup + movers + recs + benchmark + credit each round-trip the DB), so the run can hit `maxDuration = 300` and every org after the stall silently gets no digest — with only a per-org `try/catch` that never fires for a slow (not throwing) call.
- **Root cause / Rationale**: The fleet *scan* paths use `mapPool`, but the digest never adopted bounded concurrency, and `dispatchAlert` has no deadline. The retention channel fails closed-but-silent.
- **Impact**: Tenants past the timeout stop receiving the digest (the core retention loop) with no error surfaced — degraded retention + invisible breakage.
- **Fix sketch**: Wrap `fetch` in `AbortSignal.timeout(8000)` inside `dispatchAlert`; run the org loop through `mapPool(orgs, 4, …)`; emit a `timedOut`/`remaining` count in the JSON response so a truncated run is observable.

### 2. Alert config can't be saved without a webhook — global-sink orgs can never tune regression sensitivity
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: ux-degradation / dead-feature
- **File**: src/components/org/AlertsControl.tsx:176 (`disabled={busy !== null || !webhookUrl.trim()}`)
- **Scenario**: An org relies on the deployment's global `ALERT_WEBHOOK_URL` (no per-org webhook) and wants regressions to fire at, say, overall-drop 3 instead of 5. The Save button is disabled until a webhook URL is typed, so they can't persist a threshold-only change — even though the API (`route.ts:106` `hasThresholds` branch) fully supports it. Worse, `save()` always sends the current `webhookUrl` state, so the only way to "save thresholds" is to also set a webhook.
- **Root cause / Rationale**: The disabled-guard conflates "has a webhook" with "has something to save"; thresholds are a second, independent payload.
- **Impact**: A shipped, backend-supported feature (per-org sensitivity) is unreachable for any org on the global sink.
- **Fix sketch**: Enable Save when the webhook is non-empty **or** either threshold field changed; when the webhook field is untouched, omit `webhookUrl` from the POST body so it isn't cleared.

### 3. CRON_SECRET accepted as a `?key=` query param leaks the secret into access/proxy logs
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: input-validation / secret-exposure
- **File**: src/app/api/cron/digest/route.ts:43-44 (and the twin at src/app/api/cron/rescan/route.ts:39-40)
- **Scenario**: The manual-retry path authenticates via `?key=<CRON_SECRET>`. Any GET with the secret in the URL is recorded verbatim in Vercel/CDN/reverse-proxy access logs, browser history, and Referer headers — a durable copy of a credential that mints every org's GitHub token and pushes fleet data outbound.
- **Root cause / Rationale**: Convenience fallback for hand-firing cron; URLs are not a safe secret channel.
- **Impact**: Long-lived secret disclosure in logs; whoever reads logs can drive both cron endpoints.
- **Fix sketch**: Drop the `?key=` path and require the `Authorization: Bearer` header only (Vercel Cron already sends it); if a manual trigger is needed, keep it header-only.

### 4. Alerts are Slack-only — add Email + MS Teams channels (SES is already wired) to widen reach
- **Severity**: High
- **Lens**: business-visionary
- **Category**: market-fit / retention
- **File**: src/lib/alerts.ts:355 (`dispatchAlert` posts a Slack-shaped payload to one webhook) + src/lib/db/org-alerts.ts
- **Scenario**: A large share of target buyers (security/eng leaders) live in MS Teams or email, not Slack. Today the only sink is a Slack-compatible incoming webhook, so the regression/low-credit/digest pushes — the whole "live intelligence" retention loop — simply don't exist for them.
- **Root cause / Rationale**: The app already integrates AWS SES (email) and the message builders are pure/channel-agnostic (`AlertMessage` has a plain-text fallback), so adding channels is low-lift, high-leverage.
- **Impact**: Materially larger addressable market + a retention channel that reaches non-Slack orgs; competitive parity with Snyk/Sonar notification breadth.
- **Fix sketch**: Add an `email` and a `teams` (Teams uses a slightly different card schema but accepts `text`) sink behind the same `resolveAlertWebhook`-style routing; reuse the existing SES sender for an email digest to org owners/admins.

### 5. The weekly digest only fires if an org manually configures a webhook — default it on to start the habit loop
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: activation / retention
- **File**: src/app/api/cron/digest/route.ts:62-66 (`if (!isAlertConfigured(webhookUrl)) { skippedNoSink++; continue; }`)
- **Scenario**: The digest is described as "the habit loop org-analytics products live on," yet it is gated behind an admin pasting a Slack webhook — which most orgs never do. So the single most retentive surface defaults to *off* for nearly every tenant.
- **Root cause / Rationale**: Push is opt-in by sink configuration; there's no zero-config default channel.
- **Impact**: Weak activation/retention — leaders never form the "open the Monday digest" habit, so they churn back to "I forgot we had this."
- **Fix sketch**: Pair with finding #4: default the weekly digest to **email** the org's owners/admins (real emails come in via the invite flow), with a one-click unsubscribe; the webhook then becomes an upgrade, not a prerequisite.

---

## Members & Access Control

### 1. Two org-creation paths set `plan` inconsistently — owner-seed/invite create a plan-less org, breaking retention depth
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption / data-consistency
- **File**: src/lib/db/members.ts:86-90 (`organization.upsert … create: { slug, name }` — no `plan`) vs src/lib/db/org-watch.ts:31-36 (`create: { … plan: "private" }`)
- **Scenario**: A user signs into a brand-new org via the members/RBAC path (owner-seed in `ensureOwnerMembership`) before any watch write. The Organization row is created **without** a `plan`, so it gets whatever the Prisma column default is (or null). `getOrgRollup` then calls `retentionCutoff(org.plan, …)` (org-rollup.ts:273) to clamp trend history — a wrong/empty plan silently truncates (or over-extends) the visible maturity history. Whether the *watch* path or the *members* path wins the create race decides the org's effective plan.
- **Root cause / Rationale**: Three creators (`ensureOrg`, `ensureOwnerMembership`, plus `setMembershipRole`'s implicit reliance) don't agree on the default plan; only one sets it explicitly.
- **Impact**: Non-deterministic retention window / plan-gated behavior depending on first-touch path; hard-to-reproduce "my history is too short" reports.
- **Fix sketch**: Funnel all org creation through one helper that always sets `plan` to the canonical default (verify the schema `@default`); add a backfill for plan-null rows.

### 2. `acceptInvite` is not atomic — the "single-use" token check→grant→mark is a check-then-act race
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/lib/db/invites.ts:138-157 (findUnique → `status !== "pending"` guard → `setMembershipRole` → `invite.update({ status: "accepted" })`, no surrounding transaction)
- **Scenario**: A double-click (or a retried POST) on the accept button fires two concurrent `acceptInvite(token)` calls. Both read `status: "pending"` before either writes `accepted`, so both pass and both run `setMembershipRole`. The grant is idempotent and binding restricts the token to one identity, so the damage is bounded — but the code/comments advertise a "single-use" capability that isn't enforced atomically.
- **Root cause / Rationale**: The pending→accepted transition is a read-modify-write outside a transaction; the invariant relies on timing.
- **Impact**: Low today (same-identity idempotent grant); becomes real if a future change allows multi-use or relaxes pinning.
- **Fix sketch**: Make consumption a conditional `updateMany({ where: { token, status: "pending" }, data: { status: "accepted" } })` first and only grant when `count === 1`.

### 3. OrgSwitcher swallows a failed active-org switch with no feedback
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure / ux
- **File**: src/components/OrgSwitcher.tsx:48 (`if (!res.ok) return;` inside the try, menu already closed)
- **Scenario**: A viewer picks an org from the header switcher; `/api/org/active` returns 400 ("Unknown org" — e.g., their installation set changed) or the network blips. The menu closes, `busy` resets, and nothing else happens — the active org is unchanged but the UI gives no hint why the selection "didn't take."
- **Root cause / Rationale**: The non-ok and catch branches both no-op silently.
- **Impact**: Confusing dead-click; user repeats it or assumes the app is broken.
- **Fix sketch**: Surface a small inline toast/error on `!res.ok`/catch ("Couldn't switch org — try again"), and re-open or keep the menu so the action is retryable.

### 4. Invites generate a link but never EMAIL it — close the teammate-acquisition loop with SES
- **Severity**: High
- **Lens**: business-visionary
- **Category**: growth / activation
- **File**: src/app/api/org/invites/route.ts:48-61 (creates the invite, returns the token to the owner) + src/lib/db/invites.ts:27 (`createInvite`)
- **Scenario**: An owner invites `alice@co.com` (email-pinned). The system mints the token and shows the owner a link to **manually** copy/paste — but never sends Alice anything. For an email-pinned invite that's especially odd: the invitee is identified by email yet gets no email. Most owners won't reliably hand-deliver links, so the viral "add your team" loop stalls.
- **Root cause / Rationale**: SES is already integrated (alerts/digests), but the invite path has no send step.
- **Impact**: Slower seat expansion and team adoption — the cheapest growth lever (in-product invite emails) is left on the table.
- **Fix sketch**: On `createInvite` with an `email`, send a branded SES invite email containing the `/invite/[token]` link; keep the copyable link for login-pinned/no-email cases.

### 5. Monetize seats/roles — RBAC exists but billing is scan-credit-only
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/lib/db/members.ts (owner/admin/member/viewer model) + src/app/api/org/members/route.ts
- **Scenario**: B2B buyers expect per-seat or tiered member entitlements (e.g., "Free = 3 members, Team = unlimited + admin roles, viewer seats metered"). Today every role/seat is free; revenue depends entirely on scan-credit consumption, leaving standard expansion revenue (more people → more spend) unaddressed.
- **Root cause / Rationale**: A complete membership/role substrate already exists; pricing just doesn't read from it.
- **Impact**: Missed expansion-revenue + a clearer enterprise upgrade story (SSO/admin/audit as a seat-tier).
- **Fix sketch**: Add a plan-derived member/seat cap checked in `setMembershipRole`/invite creation; gate `admin` role and audit-export behind the paid tier.

---

## Fleet Rollups & Insights

### 1. Inconsistent org-slug canonicalization across the rollup family — a mixed-case URL silently returns empty fleet data
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / silent-failure
- **File**: src/lib/db/org-shared.ts:16-18 (`getOrgBySlug` queries `{ slug }` verbatim) — called raw by org-rollup.ts:187, org-insights.ts:560/566, org-teams.ts:326, org-signals.ts:24, org-contributors.ts:51; contrast org-rollup.ts:34-37 where `getOrgId` *does* `trim().toLowerCase()`
- **Scenario**: Org slugs are persisted lower-cased (install flow). A user hits `/org/MyOrg` (or an API caller passes `org: "MyOrg"`). Auth/role gates resolve via `getOrgId`/`requireOrgRole`, which normalize and succeed — but every aggregate (rollup, movers, benchmark, contributors, teams) queries by the raw `"MyOrg"` slug, finds no org, and returns null/empty. The Members tab works while the dashboard shows "no data," for the same URL.
- **Root cause / Rationale**: Only `getOrgId` canonicalizes; the rest of the family assumes callers pre-lowercased, an assumption nothing enforces.
- **Impact**: Confusing "empty dashboard" on any non-canonical slug; auth and data layers disagree on identity.
- **Fix sketch**: Normalize inside `getOrgBySlug` (`slug.trim().toLowerCase()`) so the one cached resolver is the single canonicalization point for the whole family.

### 2. Fleet commit-activity buckets by `floor(ms/WEEK_MS)`, not GitHub's Sunday-aligned weeks — cross-repo misalignment
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / clock-alignment
- **File**: src/lib/db/org-signals.ts:159-161 (`weekIndex`) + 193-199 (per-element bucketing from `lastWeek = weekIndex(scannedAt)`)
- **Scenario**: GitHub's `commit_activity` weeks are Sunday-aligned; this code discards those week timestamps and derives each series' anchor from `scannedAt` via `floor(ms / 7d)` — a 7-day bin anchored at the Unix epoch (a **Thursday**). Two repos whose scans fall on opposite sides of a Thursday-00:00-UTC boundary within the *same* GitHub week get `lastWeek` values differing by 1, so their weekly series are summed one bucket out of phase, distorting the fleet sparkline. The comment claims "absolute calendar week," but the math isn't a calendar (Sun–Sat) week.
- **Root cause / Rationale**: Re-deriving the week from `scannedAt` instead of using GitHub's per-week unix timestamps that the series already carries upstream.
- **Impact**: Mildly wrong fleet activity trend for heterogeneous-cadence fleets (the exact case the fix claimed to handle).
- **Fix sketch**: Persist and bucket by GitHub's `week` unix timestamp (Sunday boundary) per element, or floor to Sunday (`ms - ((dayOfWeek)·DAY)`) rather than to the epoch grid.

### 3. Benchmark corpus mixes other tenants' PRIVATE repo scores into stats shown to a different org
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: trust-boundary / privacy
- **File**: src/lib/db/org-insights.ts:565 (`where: { orgId: { not: org.id } }`) → 573-577 (corpus includes private repos' scores) → 640-648 (returns `corpusAvgOverall/Adoption/Rigor` + percentiles)
- **Scenario**: `getOrgBenchmark` builds its comparison corpus from **every repo in every other org**, private ones included, then shows a tenant aggregate means + a percentile rank. Only aggregates are exposed (not identities), but with a small/sparse corpus a tenant can approximately infer competitors' private maturity, and private scores are used without those orgs' consent.
- **Root cause / Rationale**: The corpus query doesn't filter on repo visibility or an opt-in flag.
- **Impact**: A trust/privacy liability for a security-positioned product; small-corpus inference of private competitor data.
- **Fix sketch**: Restrict the corpus to `isPrivate: false` (or orgs that opted into anonymized benchmarking); keep the `CORPUS_MIN`/`COHORT_MIN` floors as the small-sample guard.

### 4. Productize the cross-org benchmark as a public "AI-Native Maturity Index" — a true differentiator
- **Severity**: High
- **Lens**: business-visionary
- **Category**: differentiation / growth
- **File**: src/lib/db/org-insights.ts:557 (`getOrgBenchmark`) + the new src/app/leaderboard/page.tsx
- **Scenario**: Ascent already computes per-language cohort percentiles and a corpus average — data none of Snyk/SonarCloud/CodeClimate/OpenSSF Scorecard publish. Surfaced today only as a private dashboard number, it's a latent flagship: a public, periodically-published "State of AI-Native Engineering" index/report by language and sector.
- **Root cause / Rationale**: The expensive aggregation exists; only a public, shareable presentation (and the public-corpus fix in #3) is missing.
- **Impact**: Inbound PR, backlinks, and a category-defining differentiator that funnels into "scan your repo to see where you rank."
- **Fix sketch**: Build a public `/index` page from the public-only corpus (percentile bands by language), with embeddable "Top 1% AI-native" badges; quarterly report drop for distribution.

### 5. Push the recommendation backlog (owners + due dates) to GitHub Issues / Jira / Linear
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: retention / integration
- **File**: src/lib/db/org-insights.ts:278-303 (`BacklogItem` already carries `assigneeLogin`, `targetDate`, `dueBucket`, `projectedPoints`, `unlocks`) + `getOrgBacklog`
- **Scenario**: The org backlog is already modeled like a tracker (owner, due date, impact, projected points) but lives only in-app, so the work happens in Jira/Linear/GitHub and the loop is never closed back to Ascent. Teams won't switch trackers; they'll let Ascent's backlog rot.
- **Root cause / Rationale**: The data is tracker-shaped but there's no export/sync, so it competes with — instead of feeding — the team's real backlog.
- **Impact**: Stickier product (Ascent becomes the source for "what to fix next"), higher engagement on recommendations, an enterprise integration selling point.
- **Fix sketch**: One-click "create GitHub Issue" per backlog item (title + projected-points body + assignee), then reflect issue state back; follow with Jira/Linear connectors as a paid integration.

---

## Org Import, Scan & Watchlist

### 1. Import's explicit `repos[]` list is uncapped — one request can launch thousands of GitHub ingests/scans
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: resource-exhaustion / adversarial-input
- **File**: src/app/api/org/import/route.ts:152-166 (`if (body.repos?.length) { fullNames = body.repos.map(...) }` — no slice) vs the `count` cap at :79 (`Math.min(100, …)`) and the sibling watch route's `MAX_BULK = 500` (src/app/api/org/watch/route.ts:16,48)
- **Scenario**: A caller POSTs `{ org: "public", mock: true, repos: [ …5000 entries… ] }`. The `count` cap only governs the *listing* path; an explicit `repos[]` bypasses it entirely, and on the **mock/public funnel** (`metered = false`) there's no credit slice either. `mapPool` then fans out 5000 scans — and even mock scans fetch the real GitHub snapshot — within one 300s function, hammering GitHub and the box. Rate-limiting throttles request *frequency*, not the per-request fan-out.
- **Root cause / Rationale**: The `repos[]` branch was never given the batch cap its siblings have.
- **Impact**: DoS-shaped resource exhaustion / GitHub rate-limit burn from a single anonymous-capable request.
- **Fix sketch**: Slice `fullNames` to a hard `MAX_IMPORT` (e.g. 100) after validation, mirroring `watch`'s `MAX_BULK`, and emit a `notice` when truncated.

### 2. Import fans out org-creating upserts under `mapPool(4)` — the org-upsert race the watch route deliberately serializes
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/app/api/org/import/route.ts:193 (`mapPool(fullNames, SCAN_CONCURRENCY, …)`) → :215 `persistScanReport({ orgSlug })` / :221 `setRepoWatch` → src/lib/db/org-watch.ts:30-36 (`ensureOrg` upsert); the watch route notes the hazard at src/app/api/org/watch/route.ts:43-44 ("Writes are sequential so the lazy Organization upsert … can't race itself")
- **Scenario**: Importing a brand-new org, the first wave of 4 concurrent lanes each lazily upserts the same not-yet-existing Organization slug (via `persistScanReport` and/or `setRepoWatch`→`ensureOrg`). On SQLite/DSQL the concurrent insert of the same unique `slug` can throw on a loser lane. Because `setRepoWatch` runs **after** a successful, already-billed scan, that throw lands in the catch (:235), which **refunds a credit for a scan that actually succeeded** and reports the repo as "failed" + leaves it unwatched.
- **Root cause / Rationale**: The watch route serializes precisely to dodge this; the import route reintroduced it by running the same org-upserting writes concurrently.
- **Impact**: Spurious "scan failed" + wrongful refunds + missing watch flags on first import of a new org.
- **Fix sketch**: Upsert the Organization once, before the pool (e.g. `ensureOrg(org)` up front), so the lanes only ever touch an existing org; or wrap `ensureOrg` in an idempotent get-or-create that swallows the unique-violation and re-reads.

### 3. Scan route doesn't normalize `org`, so the access gate and the watched-repo lookup can disagree on casing
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / silent-failure
- **File**: src/app/api/org/scan/route.ts:28 (`const org = body.org;` — no trim/lowercase) → :35 `listWatchedRepos(org)` (org-watch.ts:271 queries `{ slug: orgSlug }` verbatim); contrast import/route.ts:65 which does `body.org?.trim().toLowerCase()`
- **Scenario**: An API client (or any non-canonical caller) POSTs `{ org: "MyOrg" }`. `requireOrgAccess` canonicalizes and grants access, but `listWatchedRepos("MyOrg")` queries the raw slug, finds the lower-cased org row's repos as **zero**, and the stream returns "No watched repositories. Toggle 'watch' on some repos first." — a misleading empty result for an org that has a full watchlist.
- **Root cause / Rationale**: Same canonicalization gap as the rollup family, here on a mutating path; the gate normalizes but the data read doesn't.
- **Impact**: Confusing "nothing to scan" for valid orgs; gate/data identity mismatch.
- **Fix sketch**: `const org = body.org?.trim().toLowerCase();` at the top, exactly like the import route (and normalize in `listWatchedRepos`).

### 4. Turn the "scan a whole org" funnel into a shareable org scorecard + badge (mirror the per-repo badge & leaderboard)
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: growth / virality
- **File**: src/app/api/org/import/route.ts (the no-install public-org funnel) + src/app/leaderboard/page.tsx / src/components/leaderboard/LeaderboardTable.tsx (the existing per-repo growth loop)
- **Scenario**: A user can already "scan a whole public org" without installing the App — a strong PLG entry — but the result is a private-ish dashboard, not a shareable artifact. The per-repo flow has a README badge and a public leaderboard; the org flow has neither, so the org scan doesn't propagate.
- **Root cause / Rationale**: The org rollup data (avg maturity, level, posture mix) is exactly what a public "org scorecard" page + SVG badge needs; it just isn't surfaced publicly.
- **Impact**: A viral loop on the highest-intent funnel (whole-org scans) — each shared org scorecard is an inbound advertisement.
- **Fix sketch**: Add a public `/org/<slug>/scorecard` (public repos only) with an embeddable "Org AI-maturity Lx" badge and an org leaderboard tab, reusing the existing badge/leaderboard machinery.

### 5. Sell scan throughput — fixed `SCAN_CONCURRENCY=4` + 300s ceiling makes large fleets slow
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/lib/pool.ts:37 (`SCAN_CONCURRENCY = 4`) + the `maxDuration = 300` on scan/import/rescan routes
- **Scenario**: An enterprise with 300 repos scans 4-at-a-time inside a 300s function; the cron drains only `limit=100` interleaved per pass (org-watch.ts:156). Fleet refreshes are slow and there's no way to pay for "scan my whole fleet faster."
- **Root cause / Rationale**: Throughput is a fixed constant, not a plan dimension, despite being a clear value axis for big customers.
- **Impact**: Missed enterprise upsell + a real "it's too slow for our fleet" objection.
- **Fix sketch**: Make concurrency/priority a plan-derived value (higher lanes, a priority rescan queue, or background workers beyond the 300s request budget) gated to paid tiers.

### 6. Leaderboard "as of" timestamp reads the freshest *recent* scan, not the freshest *ranked* row
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case / display
- **File**: src/app/leaderboard/page.tsx:30 (`const latest = gallery?.recent[0]?.scannedAt`)
- **Scenario**: The header's "Served live … as of {timeAgo(latest)}" uses `recent[0]` (the newest scan in the whole corpus), while the table renders `topAiNative` (top-20 by score). If the most recent scan isn't in the top-20 (common), the "as of" time describes data not shown — and if `recent` is empty but `topAiNative` isn't (different limits upstream), the freshness line vanishes despite a populated board.
- **Root cause / Rationale**: Two different slices of the gallery back the timestamp vs the table.
- **Impact**: Minor provenance/labeling mismatch on a public marketing surface.
- **Fix sketch**: Derive `latest` from `max(scannedAt)` over the rendered `rows`, or relabel it as "corpus last updated" to match what it actually measures.
