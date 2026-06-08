# Feature Scout Fix Wave 4 — GitHub App sync

> 3 of 6 findings closed in 3 atomic commits (the clean, verifiable, low-collision backend ones).
> 3 deferred with cause (UI-collision with the live concurrent run, and one needing new infra).
> Baseline preserved: tsc 0 → 0 errors · eslint clean on changed files · `next build` green.

## Why only the backend three

Wave 4's remaining findings (APP-2 bulk-watch, APP-3 suspension state) live in
`InstallationRepos.tsx` / `connect` — exactly the files the **concurrent UI-Perfectionist
Pipeline-B run** was actively churning this whole session — so editing them would mean fighting that
agent over the same lines. And AUTH-2 needs genuinely new infrastructure (an org-access epoch — see
below), not a wire-up. So this wave ships the three findings that are pure backend, fully verifiable,
and don't touch the contested UI, and defers the rest to a focused session (ideally when the UI run
has finished).

## Commits (shipped)

| # | Commit | Finding | Sev | What |
|---|--------|---------|-----|------|
| 1 | `d430460` | APP-4 | Med | drop forks + archived from the installation listing |
| 2 | `973a1c1` | APP-1 | High | handle `installation_repositories` events to self-heal the watchlist |
| 3 | `1a824f6` | ORGS-6 | Med | fleet-level autoscan cadence (whole watched set / segment) |

## What was fixed

1. **APP-1** — The webhook handled `installation`/`pull_request`/`push` but not
   `installation_repositories` (fired when a user adds/removes repos from an installation's selected
   access). Removing a repo on GitHub left a dead watched+scheduled row whose scheduled rescan kept
   minting a token that no longer covers it and 401ing forever. New branch quiesces the removed repos
   (`unwatchReposForInstallation`: clears watch + pauses schedule for the named repos under the orgs
   the installation backs), mirroring `removeInstallation`'s uninstall behavior. **The App must
   subscribe to the "Repository" event** for GitHub to deliver these.
2. **APP-4** — `listInstallationRepos` mapped every repo, while `listOrgRepos` + `fetchUserRepos`
   deliberately drop forks/archived ("not where active work happens"). Request `fork`/`archived` on
   the GhRepo and filter them, so dead mirrors stop cluttering the connect list / burning watch budget.
3. **ORGS-6** — Cadence was one-repo-per-call. Added `setWatchedSchedule` (updateMany over the org's
   watched repos, reusing the read-side `segmentScope` fragment) and a bodiless-fullName shape on
   `POST /api/org/schedule`: `{ org, schedule, segmentId? }` sets the whole watched set (or a segment)
   in one write; `{ org, fullName, schedule }` stays the per-repo path.

## Deferred (with cause)

- **APP-2 — bulk "watch all/filtered"** (`InstallationRepos.tsx`). High value, but the button lives in
  the connect list the concurrent UI run is actively editing. The backend (`POST /api/org/watch/bulk`)
  is clean to add later; deferring avoids an edit war over shared UI. A bulk route with no caller would
  be dead weight, so it's deferred as a unit.
- **APP-3 — surface installation suspension state** (`auth.ts` `UserInstallation` + `InstallationRepos`).
  Needs `fetchUserInstallations` to keep `suspended_at`/`repository_selection` (an auth.ts change) AND a
  UI badge — again in the contested connect UI. Deferred to the same focused session as APP-2.
- **AUTH-2 — reflect org access loss in member sessions.** Architecturally the heaviest: `removeInstallation`
  bumps the session version only for the *owner login*, which the code itself documents is a no-op for
  ORG accounts (member sessions are keyed by the member's own login, and carry a baked-in `installations`
  array). A real fix needs new infrastructure — either persisting member logins per installation at login
  and bumping each, or an **org-access epoch** that `verifySessionVersion` compares each embedded
  installation against. That's a security-sensitive cross-tenant change deserving its own focused effort,
  not a bundle into a sync wave. Deferred, NOT wired half-way.

## Verification (before → after)

| Gate | Result |
|------|--------|
| `tsc --noEmit` | 0 → 0 errors |
| `eslint` (6 changed files) | 0 errors, 0 warnings |
| `next build` | ✅ all routes compiled |
| unit tests | none (Playwright e2e only); not run |

## Patterns established (catalogue additions, items 9–10)

9.  **Quiesce-on-access-loss** — when an external grant is revoked (repo de-selected, App uninstalled),
    clear the local rows that depend on it (watch/schedule) so background jobs stop using a credential
    that no longer works. The webhook is the natural hook.
10. **Bulk variant via an optional discriminator** — add a fleet-wide write by making the per-item key
    optional on the existing route (`fullName` present → one; absent → the whole watched set), reusing
    the read-side scope fragment, rather than a parallel endpoint.

## What remains

Wave-4 leftovers: **APP-2, APP-3, AUTH-2** (above). Other scan waves: 1 (usage→billing), 5 (scoring
depth), 6 (scan reach), 7 (export/alerts/compliance) + mediums/lows, per the INDEX.

## ⚠ Concurrency note

The parallel UI-Perfectionist run remained active on `vibeman/feature-scout-wave2` throughout. This
wave deliberately stayed OUT of the UI files it was editing (the reason 3 findings are deferred). All
of this wave's files are backend; combined-state gates (tsc/lint/next build) pass.
