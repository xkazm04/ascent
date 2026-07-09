# Trends & Comparison — bug-hunter + ui-perfectionist scan

> Context: Trends & Comparison (group: Reporting & Visualization)
> Files scanned: 14
> Total: 6 findings (Critical: 0, High: 1, Medium: 2, Low: 3)

## 1. Private-repo trends/compare are unreachable — org resolved via the DORMANT session
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: dead-code-authz
- **File**: src/app/trends/page.tsx:88
- **Scenario**: A Supabase-authenticated user who owns private org `acme` opens `/trends?repo=acme/private-repo` (or `/report/compare?repo=acme/private-repo`). The page calls `readableOrgForOwner(parsed.owner)` (also compare/page.tsx:86, api/history route.ts:71). That helper (auth.ts:336) resolves the org from `getSession()` — the **legacy custom-OAuth cookie**, which is null under the active Supabase wall (`authGateEnabled()`; every `authz.ts` gate calls this path "dormant under the Supabase wall"). So it returns `"public"`. `getRepositoryHistory` then hits scans-read.ts:250 (`orgSlug === PUBLIC && repo.isPrivate → return null`) and the page renders "No scans recorded yet."
- **Root cause**: Org resolution is built on the dormant `getSession()`/installations instead of the active viewer (`getViewer`/`canReadOrg`). The pages never pass `?org`, and the only Supabase-aware path (canReadOrg, route.ts:71 orgHint) is never exercised by them or by DimensionTrends' client fetch (DimensionTrends.tsx:51, also org-less).
- **Impact**: The entire Trends & Comparison feature is silently broken for every private repo under the production auth model — exactly the paid/private-org users. No data loss; feature is dead-ended.
- **Fix sketch**: Replace `readableOrgForOwner` here with a viewer-aware resolver (resolve the owner's org via `getViewer()` + membership, mirroring `canReadOrg`/`viewerOrgRole`), or have the pages pass the resolved `?org` slug so the route's `canReadOrg` branch runs.

## 2. `/api/history` sign-in gate is dead-code authz under the Supabase wall
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: dead-code-authz
- **File**: src/app/api/history/route.ts:60
- **Scenario**: The gate is `if (isAuthConfigured() && !(await getSession()))`. `isAuthConfigured()` (auth.ts:85) is true only when the **legacy** `GITHUB_OAUTH_CLIENT_ID/SECRET` + `AUTH_SECRET` are set. Under the active Supabase wall those are unset, so the condition is false and the 401 never fires. An anonymous caller reaches the handler.
- **Root cause**: Gating on the dormant predicate (`isAuthConfigured`/`getSession`) instead of the active one (`authGateEnabled()` / `requireViewer`). The in-code comment claims it "keeps the API and page in lockstep and blocks anonymous enumeration of owner/repo slugs" — both claims are false in production.
- **Impact**: No private leak (org-scoping + scans-read.ts:250 hold), but the intended sign-in wall is absent: anyone can read and enumerate any repo's **public** scan history and probe which slugs have public scans. Misleading security posture.
- **Fix sketch**: Gate on `authGateEnabled() && !(await getViewer())`, matching the RBAC helpers in `authz.ts`; drop or align the stale comment.

## 3. Trend skeletons render 6 cards but 9 dimensions load — layout shift
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: loading-state
- **File**: src/app/trends/loading.tsx:12
- **Scenario**: The route skeleton renders 6 placeholder cards (`[0,1,2,3,4,5]`), and DimensionTrends' in-component shimmer does the same (DimensionTrends.tsx:219). But the loaded grid maps `DIMENSIONS` = **9** dimensions (D1–D9; DimensionTrends.tsx:123). On `lg:grid-cols-3` the skeleton is 2 rows, the loaded state is 3 rows.
- **Root cause**: Hardcoded `[0..5]` placeholder count that was never reconciled with the model's dimension count (also stale in PRODUCTION_READINESS.md: "model has 9").
- **Impact**: A full extra card row pops in after load (CLS/jank) on the trends page every visit.
- **Fix sketch**: Render `DIMENSIONS.length` (9) placeholders in both skeletons, ideally sharing one `Array.from({length: DIMENSIONS.length})` source.

## 4. DimensionTrends stale-repo race — the deferred item is now fixed; only a latent residual remains
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/components/report/DimensionTrends.tsx:29
- **Scenario**: The prior audit deferred a race ("loadDimensions has no abort/active guard, so a slow response for repo A can paint under repo B"). The **current** working tree closes the reachable version: `loadDimensions` threads an `AbortController` (abortRef, :37), aborts the prior in-flight load, re-checks `controller.signal.aborted` after JSON parse (:56), and aborts on unmount (:67). I could not reproduce an out-of-order paint. Residual: `full`/`dimState` are set only by the mount-time `useState` initializers (:29–32) and never reset when the `history` prop changes identity, so `if (dimState !== "idle") return` (:72) would keep repo A's cards under repo B's header **if** the component were re-rendered with a new repo without remounting.
- **Root cause**: State keyed to mount, not to `history.repo.fullName`.
- **Impact**: None today — the sole caller (trends/page.tsx, a `force-dynamic` server component) remounts on navigation, so the residual is unreachable. Latent trap for any future client parent that swaps the prop.
- **Fix sketch**: Add `key={history.repo.fullName}` at the call site, or reset `full`/`dimState` in an effect on repo change, to make the guard future-proof.

## 5. ScanComparePicker doesn't enforce chronological before→after ordering
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: visual-consistency
- **File**: src/components/report/ScanComparePicker.tsx:60
- **Scenario**: Self-compare IS prevented (each select disables the opposite side's current scan, :60/:87; the page also shows a "Same scan selected" note, WhatChanged.tsx:46). But nothing enforces that "Baseline (before)" is chronologically older than "Compared (after)": a user can set Baseline = newest and Compared = an older scan, producing an all-red "What changed" panel that reads as a regression while they are really looking backward in time.
- **Root cause**: `compare.ts` documents reversed order as valid ("deltas simply read as regressions"), so the UI never constrains or annotates direction, but the labels imply forward chronology.
- **Impact**: Occasional confusion — a legitimate "improved" history can render as a wall of losses. Minor.
- **Fix sketch**: Order the two selections chronologically after each change (or show an inline "you're comparing newer → older" hint when `before.scannedAt > after.scannedAt`).

## 6. History ETag only signs the newest scan — an in-place fix to an older scan serves a stale 304 forever
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: stale-cache
- **File**: src/app/api/history/route.ts:115
- **Scenario**: The weak ETag folds `(mode, count, newest.id-scannedAt-overallScore)`. The comment notes this was added because a corrected **newest** row previously left the ETag unchanged. But the same in-place correction on a **non-newest** scan (e.g. re-scanning an older pinned commit, which upserts that existing row) changes neither the count nor the newest signature, so a client holding the ETag gets `304` indefinitely and never sees the corrected older point.
- **Root cause**: The signature covers only the newest row, contradicting the "any row can be corrected in place" reality the newest-row fix already acknowledged.
- **Impact**: A re-scan/correction of a historical scan is invisible on `/trends` charts (and pollers) until an unrelated new scan bumps the count. Narrow but real.
- **Fix sketch**: Fold a cheap digest of all returned points (e.g. hash of `id-scannedAt-overallScore` across `scans`, or `max(updatedAt)`) into the validator instead of the newest row alone.
