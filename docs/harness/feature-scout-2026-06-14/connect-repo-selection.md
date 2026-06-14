# Feature Scout — Connect & Repo Selection (ascent, 2026-06-14)
> Total: 5
> Severity: 1C / 2H / 2M / 0L

## 1. Bulk watch + bulk schedule on the filtered repo set
- **Severity**: Critical
- **Category**: functionality
- **File**: src/components/connect/InstallationRepos.tsx:116 (toggleWatch / changeSchedule, both per-repo only); src/components/connect/RepoFilterBar.tsx:31 (filter bar has no select-all)
- **Scenario**: A fleet owner installs the App on an org with 80 repos and wants to watch them all (or all `TypeScript` repos, or all private ones) and put them on a weekly cadence — the core "watch the whole org" intent of this page.
- **Gap**: Every watch toggle and schedule change fires one POST (`/api/org/watch`, `/api/org/schedule` with `fullName`). There is no "select all", no checkbox-per-row multi-select, and no "apply to filtered set" — confirmed by grep (`select all|bulk|watch all` → no matches anywhere under `src/components/connect`). Critically, the backend already supports the bulk path: `/api/org/schedule` accepts a body **without** `fullName` and calls `setWatchedSchedule(org, schedule, segmentId?)` (src/app/api/org/schedule/route.ts:44, src/lib/db/org-watch.ts:81) to set cadence across the whole watched set in one write — but the connect UI never sends that shape. So the only way to watch 80 repos today is 80 clicks.
- **Impact**: Every org admin / platform team — the primary buyer. Turns the headline onboarding action from "click 80 checkboxes one at a time, each a network round-trip" into one gesture; removes the single biggest friction point before a fleet dashboard has any data in it.
- **Fix sketch**: Add a "Watch all (N filtered)" + "Set schedule for watched →" control to `RepoFilterBar`/`InstallationRepos`. For watch, add a small `POST /api/org/watch/bulk` (or accept `repos[]` in the existing route) backed by a `prisma.repository` transaction; for schedule, just send the already-supported no-`fullName` body to `/api/org/schedule`. Wire optimistic patch across the filtered rows. ~0.5–1 day.

## 2. Per-repo scan health is hidden on the selection screen
- **Severity**: High
- **Category**: user_benefit
- **File**: src/lib/db/org-rollup.ts:23 (getRepoStates omits status); src/components/connect/RepoRow.tsx:39 (row meta shows only language/stars/updated); src/components/connect/installationRepoTypes.ts:1 (RepoState lacks status fields)
- **Scenario**: A user watched 30 repos weeks ago. Token access was narrowed on GitHub, or a repo was deleted/renamed, so its autoscans silently fail. They come back to /connect to manage their list and have no idea anything is wrong.
- **Gap**: The DB tracks `lastScanStatus` / `lastScanError` / `lastScanAttemptAt` (src/lib/db/org-watch.ts:226 `recordScanOutcome`) and the **org dashboard** row type (`OrgRepoRow`, org-rollup.ts:56-59) surfaces them as a "needs attention" affordance. But `getRepoStates` — the function feeding `/api/app/repos` and therefore this page — deliberately returns only `watched/scanSchedule/level/overall` (org-rollup.ts:38-44). So the connect screen, where the user actually toggles watch/schedule, cannot show "⚠ last scan failed: token revoked". Confirmed by grep: `lastScanError`/`lastScanStatus` appear in org-rollup's `OrgRepoRow` path but not in `getRepoStates`/`RepoState`/connect types.
- **Impact**: Anyone relying on autoscan (every paying org). Closes the gap where "scanning is broken" looks identical to "never scanned" at the exact place the user manages it — preventing weeks of a dead watchlist while credits/cron silently no-op on a broken repo.
- **Fix sketch**: Add `lastScanStatus`/`lastScanError`/`lastScanAt` to the `RepoState` select in `getRepoStates` and to `installationRepoTypes.RepoState`; render a small "⚠ scan failed — fix access" pill in `RepoRow` linking to the Configure page. ~3–4 hrs.

## 3. No "scan selected now" from the selection screen
- **Severity**: High
- **Category**: feature
- **File**: src/components/connect/InstallationRepos.tsx:255 (RepoFilterBar usage — no batch action); src/components/connect/RepoRow.tsx:71 (per-row "Scan" link only); src/app/api/org/import/route.ts:1 (existing bulk-scan SSE accepting `repos[]`)
- **Scenario**: User just watched 12 repos and wants results now, not on the next weekly cron. Today they must leave /connect, go to `/org/<slug>`, and click "Scan all watched" — which scans the *entire* watchlist, not the 12 they just picked.
- **Gap**: The connect page offers only the single-repo `Scan` link per row (RepoRow.tsx:71 → `/report?repo=`). Batch scanning lives entirely on the org dashboard (`OrgScanButton`, "Scan all watched"/"stale only", src/components/org/OrgScanButton.tsx:94). There is no way to scan *the set you just selected* in place. The capability exists: `/api/org/import` is an SSE bulk scanner that already accepts an explicit `repos[]` list, mints the installation token, and watches+schedules them (route.ts:52-67, 141-146). It is wired into onboarding but not connect.
- **Impact**: New users in the activation moment (just connected, want their first fleet view to light up) and admins doing a one-off audit of a subset. Collapses a 3-page detour into one "Scan N selected" button, shortening time-to-first-value and reusing an already-hardened endpoint.
- **Fix sketch**: Reuse the `OrgScanButton` SSE consumer pattern; add a "Scan selected (N)" action in `InstallationRepos` that POSTs the selected `fullName[]` to `/api/org/import` with `mock:false, watch:true, installationId`. Depends on multi-select from finding #1. ~0.5 day.

## 4. Push-triggered auto-rescan is invisible at the watch decision
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/components/connect/RepoRow.tsx:56 (schedule dropdown is the only cadence signal); src/app/api/app/webhook/route.ts:276 (push → rescan watched repo); src/components/connect/installationRepoTypes.ts:22 (SCHEDULES = off|daily|weekly|monthly only)
- **Scenario**: A user sets a repo's schedule to "no autoscan", assuming that means Ascent won't scan it. In fact, *watching* a repo already enrolls it in push-triggered rescans on the default branch (webhook.ts:276-282 `isRepoWatched` → rescan + regression alert), independent of the schedule dropdown.
- **Gap**: The connect UI presents `watch` and a cadence dropdown as the complete model of when scanning happens, but never communicates that watch alone triggers a scan on every default-branch push. Grep confirms no copy or control about push/event-driven scanning anywhere under `src/components/connect`. This both surprises users ("why did it scan when I said off?") and hides a genuinely valuable feature (CI-like maturity-on-every-merge).
- **Impact**: Every watcher — both an expectations/cost-clarity fix (push scans also draw credits) and a discoverability win for a flagship capability. Reduces "unexpected scan" support confusion and surfaces a reason to watch.
- **Fix sketch**: Add a one-line hint near the schedule control ("Watched repos also rescan on each push to the default branch") and optionally a small "on push" badge in `RepoRow`. Consider folding into the credit-estimate strip so push scans aren't an invisible spend. ~2–3 hrs (copy + optional badge).

## 5. Segments can't be assigned at selection time
- **Severity**: Medium
- **Category**: feature
- **File**: src/components/connect/RepoRow.tsx:22 (row has watch + schedule, no segment control); src/components/org/RepoSegmentsPanel.tsx:1 (segment tagging lives only on the org dashboard); src/lib/db/org-watch.ts:81 (setWatchedSchedule already takes a segmentId)
- **Scenario**: While picking 60 repos, a platform lead wants to slot them into "platform", "mobile", "legacy" as they go, then later rescan/compare per segment. Today they finish selection on /connect, then re-walk the entire list again in a separate `RepoSegmentsPanel` on the dashboard to tag them.
- **Gap**: Segment tagging (`/api/org/segments/<id>/repos`) and segment-scoped scheduling exist (RepoSegmentsPanel.tsx:82-97; `setWatchedSchedule(..., segmentId)` org-watch.ts:91 reuses `segmentScope`), but the connect rows expose no segment affordance — confirmed by grep (`segment` matches only under `src/components/org`, never `connect`). The natural moment to organize a fleet is when you're choosing it; instead the work is duplicated across two screens.
- **Impact**: Mid/large orgs that use segments for rollups and segment-vs-segment comparison. Eliminates a full second pass over the repo list and makes segment-scoped bulk scheduling (finding #1) reachable in one flow.
- **Fix sketch**: Add a compact segment chip-picker to `RepoRow` (reuse the toggle + optimistic `POST /api/org/segments/:id/repos` from `RepoSegmentsPanel`), fed by the org's segment list loaded alongside repos. Pairs with the bulk-schedule's existing `segmentId` param. ~0.5 day.
