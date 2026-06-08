# Feature Scout — GitHub App, Connect & Onboarding

> Total: 6
> Critical: 0 | High: 3 | Medium: 2 | Low: 1

## 1. Handle `installation_repositories` events so added/removed repos stay in sync
- **Severity**: High
- **Category**: automation
- **File**: src/app/api/app/webhook/route.ts:201 (next branch after the `installation` handler)
- **Gap**: The webhook only handles `installation` (created/deleted/suspend/unsuspend), `pull_request`, and `push` (route.ts:201-232). GitHub fires a separate `installation_repositories` event when a user edits *which* repos an installation can see (Add/Remove on the GitHub "Configure" page). A grep for `installation_repositories | added_repositories | repositories_added | repository_selection` across `src/` returns nothing — the event is never subscribed to or handled, and `docs/GITHUB_APP.md:34` only tells installers to subscribe to Installation/Pull request/Push. Today, removing a repo on GitHub silently leaves a watched/scheduled dead row whose installation token no longer covers it (so its scheduled rescan 401s forever), and adding a repo doesn't proactively refresh anything — the user must manually "Re-sync access" (connect/page.tsx:184-198).
- **User value**: Org admins who curate installation access get a self-healing watchlist: newly granted repos become immediately scannable and removed repos are quiesced (mirroring how `removeInstallation` already pauses schedules on uninstall, installations.ts:51-60), with no stale "X of N watched" counts.
- **Implementation sketch**: Add an `event === "installation_repositories"` branch that reads `payload.repositories_removed[]` and, when DB-configured, clears `watched`/`scanSchedule`/`nextScanAt` for those `full_name`s (reuse the `updateMany` pattern in installations.ts:55-60); optionally warm the repo list on `repositories_added`. Update the docs table at GITHUB_APP.md:34 to recommend subscribing to the event.
- **Effort**: M

## 2. Bulk "watch all" / "watch filtered" on the connect repo list
- **Severity**: High
- **Category**: functionality
- **File**: src/components/connect/InstallationRepos.tsx:131 (alongside `toggleWatch`)
- **Gap**: The connect panel only lets a user toggle watch one repo at a time — `toggleWatch` POSTs a single `/api/org/watch` per checkbox (InstallationRepos.tsx:131-149) and there is no select-all control (grep for `watchAll | selectAll | bulk` in `src/components/connect` returns nothing). The onboarding flow already proves the bulk pattern exists and is wanted — it has "Select top 10" / "Clear" and a one-shot batch import (OnboardingFlow.tsx:163-170, 198-212) — but a returning user who installs the App on a 200-repo org must click 200 checkboxes to set up their watchlist. The search/visibility/language filters (InstallationRepos.tsx:178-188) compute a `filtered` set that's the perfect target for a bulk action that doesn't yet exist.
- **User value**: Power users / org admins onboarding a large installation can watch (or unwatch) every repo matching the current filter in one action — e.g. "watch all TypeScript repos" or "watch all private repos" — turning a multi-minute clickfest into one click.
- **Implementation sketch**: Add a "Watch all (N filtered)" button near the filters (InstallationRepos.tsx:226-260) that fires the existing per-row `toggleWatch` across `filtered` (with optimistic patch + rollback already built in), or better, add a small `POST /api/org/watch/bulk` accepting an array so it's one round-trip; reuse `requireOrgAccess` + `setRepoWatch` from the existing watch route.
- **Effort**: M

## 3. Surface installation suspension state in the connect/onboarding UI
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/lib/auth.ts:51 (`UserInstallation`) → src/components/connect/InstallationRepos.tsx:62
- **Gap**: The backend already *knows* about suspension — the webhook handles `suspend`/`unsuspend` (route.ts:205-209) and `removeInstallation` quiesces autoscans — but the session's `UserInstallation` carries only `{ id, login }` (auth.ts:51-54) and `fetchUserInstallations` drops the `suspended_at` / `repository_selection` fields GitHub returns (auth.ts:447-457). So a user whose App is *suspended* still sees the installation listed on /connect and clicks "Scan" → `getInstallationToken` 401s and `listInstallationRepos` shows "No repositories accessible" (InstallationRepos.tsx:197-203) with no explanation. There's no UI affordance distinguishing "suspended", "selected repos only", or "all repos" states.
- **User value**: Users hit a clear "This installation is suspended — re-enable it on GitHub →" message instead of a confusing empty list, and can see at a glance whether an installation grants *all* repos or only a selected subset (prompting them to add more).
- **Implementation sketch**: Extend `fetchUserInstallations` (auth.ts:447) to keep `suspended_at` and `repository_selection`, widen `UserInstallation` (auth.ts:51), and render a suspended/limited badge + remediation link in `InstallationRepos`/`connect/page.tsx` (reuse the `appInstallUrl()` "manage on GitHub" link already at connect/page.tsx:221-225).
- **Effort**: M

## 4. Filter forks/archived repos consistently in the installation listing
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/github/app.ts:205 (`listInstallationRepos` mapping)
- **Gap**: `listInstallationRepos` maps every repo the installation returns with no fork/archived filter (app.ts:205-214), whereas the public listing (`listOrgRepos`, list.ts:53-54) and discovery (`fetchUserRepos`, discover.ts:91) both deliberately drop `fork` and `archived` repos because "that isn't where active work happens." The result is an inconsistent connect experience: a user who installs on an org full of forks/archived mirrors sees them cluttering the watch list (and `GhRepo` in app.ts:154-163 doesn't even request `fork`/`archived`, so the data to filter isn't fetched). Onboarding then preselects by prominence (OnboardingFlow.tsx:30-31) and can auto-pick an archived repo.
- **User value**: Cleaner, more relevant repo lists for everyone connecting via the App — the same hygiene already applied to public scans — so users don't waste their 10-repo onboarding cap or watchlist on dead mirrors.
- **Implementation sketch**: Add `fork` and `archived` to the `GhRepo` interface (app.ts:154) and to the mapped `AppRepo`, then filter them out (or expose an "include archived/forks" toggle in `InstallationRepos`); the per-page collect loop already in app.ts:178-191 needs no other change.
- **Effort**: S

## 5. Show usage/billing context for private (billable) scans during connect
- **Severity**: High
- **Category**: user_benefit
- **File**: src/components/connect/InstallationRepos.tsx:304 (the per-repo schedule selector) and src/app/connect/page.tsx:116
- **Gap**: `docs/GITHUB_APP.md:4-6` states private scans are "billable units" metered in `src/lib/db/usage.ts`, yet nothing in the connect or onboarding flow surfaces quota, count, or cost. A grep for `usage | billable | quota | plan | limit` in `InstallationRepos.tsx` returns nothing. A user can set every private repo to `daily` autoscan (InstallationRepos.tsx:304-316) — directly multiplying billable scans via the cron rescan loop — with zero visibility into how much that consumes or any remaining allowance. The onboarding flow auto-enables `watch: true, schedule: "weekly"` for up to 10 repos (OnboardingFlow.tsx:208-209) silently.
- **User value**: Org admins understand the cost implications of watching N private repos on a daily cadence *before* committing, preventing bill surprise and giving Ascent a natural in-product upsell surface ("you've used 80% of this month's private scans").
- **Implementation sketch**: Add a small usage summary header to `InstallationRepos` (e.g. "{used}/{quota} private scans this month") fed by a lightweight `GET /api/usage?org=` reading `src/lib/db/usage.ts`, and a confirmation hint when a private repo is set to `daily`; the connect page already gates on `isDbConfigured` so the data path exists.
- **Effort**: M

## 6. Inline "Open the App's Configure page" deep link for selected-repo installs
- **Severity**: Low
- **Category**: integration
- **File**: src/components/connect/InstallationRepos.tsx:201 (the empty-state) and connect/page.tsx:221
- **Gap**: When an installation grants access to only a few (or zero) repos, the empty state says "Adjust access on GitHub, then refresh" (InstallationRepos.tsx:201) and the header offers a generic "+ Add or manage repositories on GitHub →" that points at `appInstallUrl()` = `installations/new` (app.ts:33-36, connect/page.tsx:221-225) — the *install* page, not the per-installation **Configure** page (`/installations/{installation_id}`). Since the installation id is in hand (`inst.id`, passed into `InstallationRepos`), Ascent could deep-link the exact settings page where the user adds repos, instead of bouncing them through a generic install URL.
- **User value**: One-click path from "I don't see my repo" straight to the precise GitHub screen to grant it — removing the manual navigation step that's the most common onboarding dead-end for selected-repo installs.
- **Implementation sketch**: Add an `appConfigureUrl(installationId)` helper next to `appInstallUrl` in app.ts (returns `https://github.com/settings/installations/{id}` for user installs / `/organizations/{login}/settings/installations/{id}` for orgs), and use it in the InstallationRepos empty-state and the "Add or manage" link when `installationId` is known.
- **Effort**: S
