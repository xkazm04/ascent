# GitHub App

The GitHub App is how Ascent reaches **private and org-wide repos** without a personal
token, gates pull requests automatically, and re-scans on push. A user installs the App on
an org/account; Ascent stores the installation, mints short-lived installation tokens to
read repos and write checks/comments/PRs, and surfaces the org's repos on the
[connect](#connect-ui) page. The intended setup is documented in
[GITHUB_APP.md](./setup.md); this doc covers the implemented surface.

## Lifecycle

```
install on GitHub  →  /api/app/setup?installation_id=…&setup_action=install
  ↓ fetch account login, upsert installation, redirect
/connect?org=<login>&installation_id=<id>  →  user picks watch / schedule per repo
  ↓ thereafter
/api/app/webhook  ⇐  GitHub events (installation / pull_request / push)
```

## Auth (`src/lib/github/app.ts`)

The App authenticates in two hops and caches the result:

1. **App JWT**: `createAppJwt()` signs a short-lived (10-min) RS256 JWT from
   `GITHUB_APP_PRIVATE_KEY` + `GITHUB_APP_ID` (issued 60s in the past for clock skew).
2. **Installation token**: `getInstallationToken(installationId)` exchanges the JWT for
   a ~1-hour installation access token (`POST /app/installations/{id}/access_tokens`),
   **cached in memory** per installation. On `401` (suspended/uninstalled),
   `invalidateInstallationToken()` drops the entry and re-mints (self-healing).

`githubAppFetch<T>(path, auth, init)` wraps calls with standard headers and throws
`AppApiError` (carrying the HTTP status) on non-2xx. `isAppConfigured()` gates the whole
feature on the env vars being present; `listInstallationRepos(id)` pages through all
accessible repos; `verifyWebhook(rawBody, signature)` does the HMAC-SHA256 check against
`GITHUB_APP_WEBHOOK_SECRET`.

## Webhook (`src/app/api/app/webhook/route.ts`)

`POST /api/app/webhook` verifies the signature, then handles:

| Event | Action |
| --- | --- |
| `installation` (created / deleted / suspended) | Sync stored installations (`upsertInstallation` / `removeInstallation`). |
| `pull_request` (opened / synchronize / reopened / ready_for_review) | Run the PR maturity gate: score the PR head, diff vs base, post a Check Run + sticky comment (see [gate.md](../scanning/gate.md)). Falls back to the default branch when a fork head commit is unreachable. |
| `push` (default branch moved) | Re-scan **watched** repos (`runPushRescan`, DB-gated, **throttled**, see below) and alert on regressions (see [alerts.md](../fleet/alerts.md)). |

### Push rescan throttle

A push rescan is a real, LLM-billed scan, so `runPushRescan` enforces a **per-repo minimum
interval** before calling `scanRepository`. The window state is the **prior persisted scan's
`scannedAt`** (the report the rescan already reads as its regression baseline), so the throttle
costs no extra query, needs no new infrastructure, and is **cross-instance** (a webhook fleet
shares one window per repo, unlike a process-local map). The check runs *inside* the
`serializePerRepo` critical section, so a burst's second run reads the first run's freshly
persisted timestamp instead of racing it.

| Setting | Default | Meaning |
| --- | --- | --- |
| `PUSH_RESCAN_MIN_INTERVAL_MINUTES` | `15` | Minimum minutes between push-triggered scans of the same repo. `0` disables the throttle (every default-branch push scans). |

### A degraded rescan is discarded, not persisted

The push rescan asks for a real LLM grade. When the provider is unavailable `scanRepository`
still returns a report: stamped `engine.provider = "mock"`, the deterministic **floor**
rather than a measurement. `runPushRescan` therefore **skips both the persist and the
regression alert** on such a report: storing it would make the floor the repo's current
public reading *and* the next run's baseline, and the alert would diff a real prior scan
against our own outage and tell the customer their repo regressed. During a provider outage
that would fire fleet-wide at once. This mirrors the `authoritative` gate the interactive
scan routes apply in `scan-finalize.ts`.

The delivery is deliberately **not** released for redelivery: an outage would degrade the
retry too, so releasing turns one outage into a scan storm. The repo is covered by the next
push past the throttle window, or by its scheduled autoscan.

### Every App API call is time-bounded

`githubAppFetch` routes through `host.ts`'s `fetchWithTimeout` at **30s**, covering the
response body as well as the headers. That budget applies to the whole App surface: token
minting, `getInstallation`, the paginated installation-repo listing, and every Check Run and
sticky-comment write. It matters most inside the webhook's `after()` work, where
`createCheckRun` retries three times and `upsertStickyComment` can walk many pages; without
a bound, one hung connection there costs the required merge status. A caller-supplied
`init.signal` is combined with the timeout rather than replaced.

15 minutes is longer than a median scan (~6 min), so bursts can't queue scans back-to-back, and it
caps push-driven spend at ≤4 scans/hour/repo.

A push inside the window is **dropped, not deferred** (the handler has no background worker; the
work runs in the request's `after()`, bounded by `maxDuration`). It is not usually lost: a scan
always reads the repo's *current* default-branch head, so the next push past the window covers every
commit coalesced in between, in one scan. If pushes stop inside the window, the trailing head is
picked up by the repo's **scheduled autoscan** (`/api/cron/rescan`) or a manual rescan, so a watched
repo with `scanSchedule: off` can sit up to one window behind until its next push.

## Setup & repos routes

| Route | Method | Role |
| --- | --- | --- |
| `/api/app/setup` | `GET` | Post-install redirect: fetch the installation's account login, `upsertInstallation`, bounce to `/connect`. |
| `/api/app/repos` | `GET` | List the installation's repos (`?org=` or `?installation_id=`), merged with the DB watch/schedule state. |

## Installations storage (`src/lib/db/installations.ts`)

Installations are stored on the `Organization` model (see [data-model.md](../data/data-model.md)):
`slug` (lowercased owner login), `name`, `githubInstallId`, `plan` ("private").

| Function | Behavior |
| --- | --- |
| `upsertInstallation({login, installationId})` | Upsert by slug; tolerates the setup-vs-webhook race (Prisma P2002 → update the winning row). |
| `removeInstallation(installationId)` | Clear `watched`/`scanSchedule`/`nextScanAt` on the org's repos and null `githubInstallId` (revoke). |
| `getInstallationIdForOwner(owner)` | Resolve lowercased slug → `githubInstallId`, or null if not installed. |

## Connect UI

`src/app/connect/page.tsx` checks App config + (optional) sign-in, merges installations
from the session and from `?org=&installation_id=` (a just-installed org), and renders an
`InstallationRepos` per installation. `src/components/connect/InstallationRepos.tsx` is a
filterable repo list (search, public/private filter, "watched only", language filter) with
per-repo **watch** checkboxes and an **autoscan schedule** dropdown (daily/weekly/monthly/
off), plus a Scan button to `/report?repo=`. Mutations call `/api/org/watch` and
`/api/org/schedule` optimistically (rollback on error).

**Credit visibility at the commitment point.** This is the one screen where a user can flip *every*
private repo to a recurring billable autoscan, so the list header carries a **balance chip**
(`InstallationRepos.BalanceChip.tsx`) inline with "N of M watched" and the dashboard link: the
prepaid balance the org dashboard's `CreditsControl` shows, in the same visual language (mono chip,
emerald `Credits · Unlimited`, amber `⚠ paused` when both the balance *and* the monthly free
allowance are spent), but display-only: no popover, no top-up, and no fetch of its own (it reuses the
balance `useInstallationRepos` already reads from `/api/org/credits`). When no balance can be read
(anonymous viewer, DB-less deploy, or no access), the chip renders **nothing** rather than a zero.
Below it, `CreditCostStrip` totals what the current watch/schedule choices cost per month.

## Governance signals (`src/lib/github/governance.ts`)

Read-only REST signals folded into the scan (token, not App JWT, required):

- `fetchBranchGovernance(owner, repo, branch, token)` → branch protection + rulesets:
  `requiresPullRequest`, `requiredApprovals`, `requiresCodeOwnerReview`,
  `requiresStatusChecks`, `requiresSignatures`, `linearHistory`, `ruleCount`.
- `fetchCommitActivity(owner, repo, token)` → 52 weeks of weekly commit totals (retries
  `202 still-computing` with bounded backoff).

## Key files

| File | Role |
| --- | --- |
| `src/lib/github/app.ts` | JWT + installation-token minting, `githubAppFetch`, `listInstallationRepos`, `verifyWebhook`. |
| `src/app/api/app/webhook/route.ts` | `installation` / `pull_request` / `push` handling. |
| `src/app/api/app/setup/route.ts` | Post-install redirect + upsert. |
| `src/app/api/app/repos/route.ts` | List repos for an installation (+ DB watch/schedule). |
| `src/lib/db/installations.ts` | Installation persistence on `Organization`. |
| `src/lib/github/governance.ts` | Branch-protection + commit-activity signals. |
| `src/app/connect/page.tsx`, `src/components/connect/InstallationRepos.tsx` | Connect UI. |
| `src/components/connect/InstallationRepos.BalanceChip.tsx` | Prepaid-balance chip in the repo-list header (hidden when unreadable). |

## Known gaps

- **Push auto-rescan is DB-gated**: `runPushRescan` only runs for repos marked
  `watched: true` and requires `DATABASE_URL`.
- **Sign-in is optional**: when OAuth env is unset, `/connect` is open; when set, it's
  scoped to the signed-in user's own installations (see [auth.md](./auth.md)).
- **Token cache is in-memory**: re-minted per serverless instance.
