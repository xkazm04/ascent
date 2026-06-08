# Bug Hunter Fix Wave 1 — Multi-tenant authorization / IDOR

> 3 commits, 4 findings closed (3 Critical + 1 High + 1 Low), 1 finding re-analyzed & deferred.
> Baseline preserved: tsc 0→0 errors, eslint clean, `next build` green. No unit runner (Playwright e2e only).
> Branch: `vibeman/bug-hunt-wave1-authz` (off `master`).

The shared mental model for the wave: **there is no Next middleware, so every read + token-minting handler must self-gate** (`harness-learnings.md`). Reading live source reshaped the wave materially — see "Re-analysis" below.

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `bb732d7` | org-dashboard #1 | Critical | `src/app/org/[slug]/layout.tsx` |
| 2 | `4e17b4b` | github-app #1 | Critical | `src/app/api/app/repos/route.ts`, `src/app/connect/page.tsx` |
| 3 | `4bf143f` | org-dashboard #2, usage-metering #7 | High, Low | `src/lib/authz.ts`, `src/app/org/[slug]/layout.tsx`, `src/app/api/usage/route.ts`, `src/app/usage/page.tsx` |

## What was fixed

1. **Org dashboard read IDOR (org-dashboard #1, Critical)** — `/org/[slug]` only checked authentication, never tenant ownership, so any signed-in user could read another org's private fleet (repo names, scores, contributor PII) by visiting the slug. Added a `sessionOwnsOrg`-based gate in the layout (which wraps *every* org sub-page — including `audit`, `backlog`, `live`, `plan`, `segments`, `teams`, beyond the 5 the report listed). Safe by construction: the write path that creates a dashboard's data (`/api/org/watch|scan`) already calls `requireOrgAccess`, so any org holding data is one a legit viewer already owns.

2. **`/api/app/repos` IDOR (github-app #1, Critical)** — the endpoint minted an installation token and returned the org's full repo list (private rows included) behind only `isAppConfigured()`. Gated on the **effective installation id** via `sessionHasInstallation` (not the `?org=` param — which a caller could pair with a victim's `?installation_id=`). Because a freshly-installed org isn't in the session until a re-sync, the connect page now detects a query-carried org not in the session and shows a one-click **"Re-sync to load repositories"** prompt instead of a panel that would 403.

3. **Auth-off + DB-on exposure (org-dashboard #2 High, usage #7 Low)** — the "auth-off = open" convention turned a `DATABASE_URL`-on / OAuth-off deployment (realistic partial config, or a dropped `AUTH_SECRET`) into open multi-tenant data. Added a read-side `canReadOrg(org)` gate in `authz.ts`: `PUBLIC_ORG` always readable; a private org needs a session that owns it when auth is on; **no** non-public org served when auth is off. Applied on the dashboard layout, the `/api/usage` route, and the `/usage` page. The public funnel still works without auth. (The auth-*on* usage IDOR was already closed by a prior run; this added the auth-*off* case.)

## Re-analysis — github-app #2 (`/api/app/setup`), reported Critical → actually ~Medium (deferred)

The report described an "installation hijack: rebind a victim org's installation id." Reading the live code: `/api/app/setup` derives `login` from `getInstallation(installation_id)` (GitHub-authoritative via the App JWT) and `upsertInstallation` writes that exact `(login, id)` pair (`installations.ts:14-22`). So a forged/guessed `installation_id` produces a **truthful** mapping — it cannot point a victim's slug at a wrong id, nor a wrong slug at a foreign id. The real residual is **unauthenticated enumeration** (which orgs have installed the App; sequential ids are an oracle) plus **`Organization`-row write-amplification**. Severity ≈ Medium, not Critical.

A correct fix must *verify the visitor performed the install*, which a code-only change can't do: the setup URL is GitHub's redirect with no proof of the installer, and Ascent never persists the user's GitHub token. The proper fix is to enable **GitHub-App "Request user authorization (OAuth) during installation"** so the redirect carries a `code` we exchange to confirm the installer via `GET /user/installations` — a GitHub-App config + flow change. **Deferred** (user decision) to a focused session; recorded as an open follow-up.

## Verification

| Check | Baseline | After Wave 1 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `eslint` (changed files) | (3 pre-existing warnings, untouched files) | clean |
| `next build` | pass | pass |
| Unit tests | none wired (Playwright e2e) | unchanged |

Each fix was committed atomically after its own `tsc` pass.

## Cumulative status (waves 1–1)

- 4 findings closed in 3 atomic commits; 1 finding re-analyzed and deferred with cause.
- 3 of the scan's 9 criticals closed (the wave's 4th "critical", github-app #2, was a misrated finding → Medium, deferred).
- Remaining per INDEX: Waves 2–8 (unauth endpoints/leaks, persistence/DSQL, scoring, lifecycle, billing, cache/sync, session/UI tail). 6 criticals remain across Waves 2–5.

## Patterns established (catalogue items 1–3)

1. **No-middleware tenancy: read paths must self-gate too.** The codebase gates *mutations* (`requireOrgAccess`) but read surfaces (`/org/[slug]`, `/api/app/repos`) were trusting the slug/installation param. Mirror the write-path gate on every read of per-tenant data. The cheapest place is the shared layout/handler entry, before any data fetch.
2. **"Auth off = open" must stay scoped to the *public* tenant.** A convenience convention for local/demo becomes a multi-tenant breach under partial prod config. Decouple "is this multi-tenant data" from "is auth turned on": when a DB is present but auth isn't, serve only the shared public tenant.
3. **Gate on the value actually used, not a friendlier sibling param.** `/api/app/repos` takes both `?org=` and `?installation_id=`; authorizing the org while *using* the installation id is bypassable. Authorize the effective resource.

## What remains (open follow-ups → harness-learnings.md)

- **github-app #2** proper fix: GitHub-App OAuth-during-install (deferred).
- **Auth-off convention change is now live** for org dashboard + usage — local/demo can only view `/org/public` and public usage without OAuth configured. Documented as intended posture.
- **Broader org-API authz sweep** (carried from a prior security_protector run, reinforced by the build's route list): `/api/org/{goals,initiatives,segments,simulate,backlog,active}` and the extra `/org/[slug]/{audit,backlog,live,plan,segments,teams}` sub-pages — the read sub-pages are now covered by the layout gate, but the mutating APIs should be audited for `requireOrgAccess`.
