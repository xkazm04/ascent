# Bug Hunter Fix Wave 2 — Unauthenticated endpoints & data leaks

> 5 commits, 6 findings closed (2 Critical + 2 High + 2 Medium).
> Baseline preserved: tsc 0→0 errors, eslint clean, `next build` green.
> Branch: `vibeman/bug-hunt-wave1-authz` (continued from Wave 1).

Shared model: a privileged/public endpoint must **fail closed** and must **never disclose private data or trust attacker-controlled input**.

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `a779c80` | org-scanning #1 (+ digest/purge, same class) | Critical | `cron/{rescan,digest,purge}/route.ts` |
| 2 | `3c80d44` | usage-metering #1 | Critical | `lib/scan.ts`, `api/badge/[owner]/[repo]/route.ts` |
| 3 | `fdb9a6c` | usage-metering #2 | High | `api/badge/[owner]/[repo]/route.ts` |
| 4 | `31bb3f3` | usage-metering #3, #4 | Medium ×2 | `api/badge/[owner]/[repo]/route.ts` |
| 5 | `654215e` | github-app #3 | High | `api/app/webhook/route.ts` |

## What was fixed

1. **Cron fail-open (org-scanning #1, Critical)** — the auth gate was `if (CRON_SECRET) { check }`, so a missing/empty secret skipped the check and returned 200. A grep during the fix found the **identical pattern in all three cron routes**, so all were fixed fail-closed (503 when the secret is absent): `rescan` (mints every org's token + LLM spend), `purge` (**deletes** data under the retention policy), `digest` (pushes fleet data to the external alert sink).

2. **Public badge leaks private repo maturity (usage #1, Critical)** — `/api/badge` ran a token-less scan, but `scanRepository` fell back to `process.env.GITHUB_TOKEN`, silently using the operator's PAT to ingest private repos and render their level to anonymous callers. Added `ScanOptions.noAmbientToken` (suppresses the env-PAT fallback) and a `report.repo.isPrivate` refusal gate that also closes the **shared-cache** path (a private report left by an authenticated scan). Private repos now render a neutral "private" badge.

3. **Rate-limit XFF bypass (usage #2, High)** — `clientIp()` keyed on the client-settable left-most `X-Forwarded-For`, so a fresh value per request minted a new bucket and the limiter never tripped. Now prefers `x-real-ip`, else the right-most (trusted-proxy) XFF hop, else a single shared "unknown" bucket (fail closed).

4. **Badge cache by outcome (usage #3 + #4, Medium ×2)** — one blanket `public, s-maxage=600` cached 429/"unknown" transient states for 10 min across all README viewers, and advertised query-customized bodies as path-cacheable (cross-consumer poisoning). Now: long shared cache only for an un-customized resolved level/gate; `private` for any customized variant; 30s for neutral unknown/private; `no-store` for 429 / transient.

5. **Webhook unknown-owner fail-open (github-app #3, High)** — `installationMatchesOwner` returned true for any owner with no stored mapping, so a forged/replayed signed delivery could drive a token mint. Now confirms an unknown owner against GitHub (`getInstallation(id)`, App-JWT authoritative) and fails closed if it can't; the `installation created/unsuspend` handler also derives the stored login from `getInstallation(id)` instead of trusting the payload.

## Verification

| Check | Baseline | After Wave 2 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `eslint` (changed files) | (3 pre-existing warnings, untouched) | clean |
| `next build` | pass | pass |

Each fix committed atomically after its own `tsc` pass.

## Cumulative status (waves 1–2)

- **10 findings closed** in 8 commits (Wave 1: 4; Wave 2: 6); 1 finding re-analyzed & deferred (github-app #2).
- **Criticals: 4 of 9 closed** (github-app #1, org-dashboard #1, org-scanning #1, usage #1) + 1 reassessed to Medium (github-app #2). **4 criticals remain**: persistence #1, persistence #2, maturity #1, llm #1 (Waves 3–5).
- Remaining per INDEX: Wave 3 (persistence/DSQL — 2 criticals), Wave 4 (scoring — 1 critical), Wave 5 (lifecycle — 1 critical: llm #1), Waves 6–8 (billing, cache/sync, session/UI tail).

## Patterns established (catalogue items 4–6)

4. **Opt-in auth is fail-open.** `if (secret) { check }` silently disables on a missing env var. Privileged endpoints must `if (!secret) refuse()` first, then check unconditionally. Grep siblings — fail-open patterns travel in families (3 cron routes here).
5. **`mock: true` ≠ token-less.** Forcing the mock *LLM provider* doesn't stop *GitHub ingestion* or the ambient-PAT fallback. A public surface must be token-less by construction AND refuse to render private data even from a shared cache.
6. **Client-settable headers are not identity.** Left-most XFF, payload-claimed installation owner — both attacker-controlled. Key rate limits on a trusted hop; confirm webhook identity against the authoritative source before acting.

## What remains / follow-ups (→ harness-learnings.md)

- **Webhook out-of-order install/uninstall** (github-app #3 secondary): a `deleted` arriving before a late `created` can leave a stale "installed" mapping. Needs per-id last-action-timestamp tracking — deferred (lower likelihood; redelivery ordering is rare).
- **Cron behavior change**: all three cron routes now require `CRON_SECRET` to be set (503 otherwise). Vercel injects the Bearer header only when the secret is configured, so production must set `CRON_SECRET` — previously a missing secret "worked" (unauthenticated). Intended posture.
