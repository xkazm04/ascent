# Bug Hunter Scan — ascent, 2026-06-08

> Reliability/security audit of all 10 contexts via the Vibeman Bug Hunter agent (`bug_hunter`).
> 10 parallel subagent runs, batched in waves of ≤8. Findings target: 5–8 per context ("Light").
> Read-only scan — no source modified. Per-context reports are the sibling `*.md` files.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 10 contexts | 9 | 22 | 25 | 12 | **68** |
| Share | 13% | 32% | 37% | 18% | 100% |

Counts verified two ways: 10 `> Total:` headers sum to 68; 68 `- **Severity**:` bullets across all files. (Four reports had a header/body sub-count drift on the High↔Medium boundary and one false "Critical" in the header — corrected to match their authoritative per-finding bullets. The true critical count is **9**, not the 10 the raw headers implied.)

---

## Per-context breakdown

(Sorted by criticals desc, then total. Group color from the Contexts module.)

| # | Context | Group | C | H | M | L | Total | Report |
|---|---|---|--:|--:|--:|--:|--:|---|
| 1 | GitHub App, Connect & Onboarding | 🔵 Identity & GitHub Connectivity | 2 | 2 | 3 | 0 | 7 | `github-app-connect-onboarding.md` |
| 2 | Persistence Layer (Prisma / Aurora DSQL) | 🟢 Reporting, Persistence & Metering | 2 | 3 | 2 | 0 | 7 | `persistence-layer-prisma.md` |
| 3 | Usage Metering & Public Badge | 🟢 Reporting, Persistence & Metering | 1 | 2 | 3 | 1 | 7 | `usage-metering-public-badge.md` |
| 4 | Maturity Model & Scoring Engine | 🟣 Repository Scanning & Scoring | 1 | 2 | 3 | 1 | 7 | `maturity-model-scoring-engine.md` |
| 5 | Organization Scanning, Watchlist & Rollups | 🟠 Organization Intelligence | 1 | 2 | 3 | 1 | 7 | `org-scanning-watchlist-rollups.md` |
| 6 | LLM Provider Abstraction | 🟣 Repository Scanning & Scoring | 1 | 3 | 2 | 1 | 7 | `llm-provider-abstraction.md` |
| 7 | Org Dashboard & Views | 🟠 Organization Intelligence | 1 | 1 | 2 | 2 | 6 | `org-dashboard-views.md` |
| 8 | Scan Pipeline & Ingestion | 🟣 Repository Scanning & Scoring | 0 | 3 | 2 | 2 | 7 | `scan-pipeline-ingestion.md` |
| 9 | Report & Trends Visualization | 🟢 Reporting, Persistence & Metering | 0 | 2 | 3 | 2 | 7 | `report-trends-visualization.md` |
| 10 | GitHub OAuth & Session | 🔵 Identity & GitHub Connectivity | 0 | 2 | 2 | 2 | 6 | `github-oauth-session.md` |

---

## All 9 critical findings — one-line summary

Grouped by theme for triage.

### A. Multi-tenant authorization / IDOR (no middleware — every handler must self-gate)
1. **GitHub App — `/api/app/repos` leaks any org's PRIVATE repo list** — mints an installation token and returns repos with only `isAppConfigured()`, no session/ownership check; cross-tenant IDOR. The repo even ships `requireOrgAccess` documented for exactly this handler. `github-app-connect-onboarding.md #1`
2. **GitHub App — `/api/app/setup` installation hijack** — trusts `installation_id` from the redirect; any signed-in user can rebind another org's stored installation. `github-app-connect-onboarding.md #2`
3. **Org Dashboard — `/org/[slug]` read-path IDOR** — no `requireOrgAccess` anywhere under `/org/[slug]`; any signed-in user reads another org's private repo names, scores, contributors. (Write path `/api/org/scan` is gated; the read pages were missed.) `org-dashboard-views.md #1`

### B. Unauthenticated privileged endpoints
4. **Cron rescan fail-open** — `/api/cron/rescan` auth is wrapped in `if (CRON_SECRET)`, so a missing/empty secret leaves the full-fleet, token-minting, LLM-spending rescan callable by anyone; no `?key=` fallback in `vercel.json`. `org-scanning-watchlist-rollups.md #1`

### C. Public data exposure
5. **Public badge leaks PRIVATE repo maturity** — the unauthenticated `/api/badge/[owner]/[repo]` calls `scanRepository` with no token, falling back to the server's `GITHUB_TOKEN` PAT; if that PAT has private access, anonymous callers get the maturity level of private repos (no `isPrivate` gate). `usage-metering-public-badge.md #1`

### D. Scoring false confidence
6. **Partial LLM coverage rolls up a misleadingly high score** — the 50% "usable assessment" gate counts *how many* dims the LLM scored, never *which*; a model that scores only the strong half (omitting rigor/security) produces a persisted, unwarned, inflated overall level. `maturity-model-scoring-engine.md #1`

### E. Persistence durability (Aurora DSQL IAM token expiry)
7. **DSQL reconnect path is dead code** — `withDb()` (the only path wiring reactive reconnect-on-auth-expiry) is exported but called by nothing; every helper uses `getPrisma()` directly. After idle past the ~15-min IAM token TTL, the first query 500s with no recovery and the scan goes unsaved. `persistence-layer-prisma.md #1`
8. **Proactive token refresh is fire-and-forget** — `getPrisma()` returns the current (stale) client synchronously and only fires a background refresh, so the in-flight caller keeps using the expired-token client. `persistence-layer-prisma.md #2`

### F. Resource lifecycle / event-loop stall
9. **Quadratic balanced-brace rescan stalls the scan** — `parseJsonLoose` rescans from every `{`/`[` to end-of-string on parse failure: O(N²) on truncated/adversarial model output, synchronously blocking the event loop with no AbortSignal escape. `llm-provider-abstraction.md #1`

---

## Triage themes

Clustered across all 68 findings (categories + scenario similarity).

| Theme | ~Count | Why it's a wave, not isolated fixes |
|---|--:|---|
| T1. Multi-tenant authz / IDOR | 5 | One mental model: there is **no Next middleware** (per `harness-learnings`), so every read + token-minting handler must call `requireOrgAccess`. Fix the pattern once, apply across `/api/app/*` + `/org/[slug]` + `/api/usage`. |
| T2. Unauth privileged endpoints & rate-limit bypass | 4 | Fail-open guards (`if (SECRET)`), spoofable `X-Forwarded-For`, no `AUTH_SECRET` floor — all "the guard exists but doesn't actually deny." |
| T3. Public data leak / badge caching | 3 | The public badge + 429/unknown CDN caching share the "what does an anonymous caller see and for how long" model. |
| T4. LLM cost / billing integrity | 6 | Orphaned-but-billing calls, failed-attempt token accounting, double-billed stampede, mock-billed-as-private — one "every token must be attributed to a real, completed, billable scan" model. |
| T5. Scoring correctness / false confidence | 7 | Coverage gate, weighted-mean divergence, detector-zero deflation, guardband double-count, level-path math — all in the scoring engine's blend/rollup. |
| T6. Persistence durability & DSQL token expiry | 7 | `withDb` dead code, fire-and-forget refresh, long-txn token outlive, swallowed-throw 200, pool storm, OCC dedup — the DB layer's resilience story. |
| T7. Cache/dedup correctness & staleness | 6 | Partial-ingestion cached authoritative, cross-instance dup rows, token cache across uninstall, peek wrong-repo — cache-key & invalidation discipline. |
| T8. Resource lifecycle / crashes | 4 | SSE no-cancel leak, claude-cli EPIPE crash, event-loop stall, connection storm — unmanaged lifecycles. |
| T9. Input-boundary validation | 7 | `/api/history` unvalidated, NaN/out-of-range chart geometry, posture.id, unbounded model strings, repo-url charset — untrusted JSON/param at trust boundaries. |
| T10. GitHub App / webhook sync integrity | 4 | Unknown-owner fail-open, removed-handler gap, GraphQL partial-data discard, pagination truncation — keeping the watched set faithful to GitHub state. |
| T11. Session / OAuth hardening | 5 | Cookie `Secure` behind proxy, fail-open revocation, no session rotation — auth lifecycle. |
| T12. Aggregate / statistical correctness | 5 | Single-sample benchmark/movers, fabricated heatmap 0, scoped-scan denominator, org truncation. |
| T13. UI error surfacing / robustness | 3 | OrgScanButton swallows failures, blank re-fetch page, CSV alignment. |

---

## Cross-reference vs prior harness runs (read before fixing)

`docs/harness/harness-learnings.md` records several prior Pipeline B/C runs (security_protector, feature-scout, UI-perfectionist). A few new findings overlap known facts or follow-ups — **re-read live source before fixing these, they may be partially addressed:**

- **T1 authz** — `harness-learnings` confirms the *convention* ("every mutating/token-minting `/api/org|app/*` MUST call `requireOrgAccess`; no middleware") and an explicit security_protector **open follow-up**: a comprehensive authz sweep of remaining endpoints was deferred. The Bug Hunter found concrete unswept handlers (`/api/app/repos`, `/api/app/setup`, `/org/[slug]` read pages) — this is the deferred sweep, now with targets. **High confidence these are real.**
- **OAuth cookie `Secure` (oauth #1)** — matches a documented anti-pattern *and* a security_protector follow-up noting #1 was "verified by source review only." Bug Hunter says the **initial** login/callback mint still derives `secure` from internal origin while the refresh path was fixed — likely a partial-fix gap. **Verify which paths were patched.**
- **headSha = tree sha vs commit sha (scan-pipeline #5)** — explicitly a **carried open follow-up** ("PR-ref headSha stamping still open"). Known; low priority.
- **repo-url host anchor / owner-repo charset (scan-pipeline #6,#7)** — the SSRF anti-pattern is documented; the scanner itself rated these **Low** (ingestion targets hardcoded hosts). Defense-in-depth only.
- **Degraded-mock persistence (scan-pipeline #4 / usage #5)** — a known open follow-up: "guard persistence of `engine.provider==='mock'` when LLM was requested." Bug Hunter re-surfaces the billing/scoring consequence.
- **Webhook replay dedupe is process-local** — `harness-learnings` notes this is in-memory only (cross-instance durability deferred). Relevant to T7/T10.

Net: the scan is largely **additive** — most findings (billing integrity, scoring coverage, DSQL token expiry, SSE/EPIPE lifecycle, chart input validation) are *new* and not in the learnings. The authz cluster is the **explicitly-deferred security sweep** the project already knew it owed.

---

## Suggested next-phase split (fix waves)

7–8 sessionable waves (~5–8 fixes each), criticals front-loaded, each sharing one mental model so fixes compound. Recommended order:

- **Wave 1 — Multi-tenant authz / IDOR** (T1): github-app #1✦, #2✦, org-dashboard #1✦, #2, usage #7. *Closes 3 of 9 criticals. Pattern: `requireOrgAccess` on every read/token-minting handler.*
- **Wave 2 — Unauth endpoints & data leak** (T2+T3): org-scanning #1✦, usage #1✦, usage #2, #3, #4, github-app #3. *Closes 2 criticals.*
- **Wave 3 — Persistence durability & DSQL token** (T6): persistence #1✦, #2✦, #3, #4, #5, #6, #7. *Closes 2 criticals. Self-contained in `lib/db`.*
- **Wave 4 — Scoring correctness** (T5): maturity #1✦, #2, #3, #4, #5, #7, scan-pipeline #4. *Closes 1 critical. Engine math + mock-degrade honesty.*
- **Wave 5 — Resource lifecycle & input boundaries** (T8+T9): llm #1✦, #4, #5, scan-pipeline #1, report-trends #1, #2, llm #6, #7. *Closes the last critical (event-loop stall).*
- **Wave 6 — LLM cost / billing integrity** (T4): llm #2, #3, scan-pipeline #2, org-scanning #4, usage #5, #6.
- **Wave 7 — Cache/dedup & GitHub App sync** (T7+T10): scan-pipeline #3, #5, org-scanning #2, github-app #4, #5, #6, #7, report-trends #4.
- **Wave 8 — Session/OAuth + aggregate/UI tail** (T11+T12+T13): oauth #1, #2, #3, #4, #6, org-dashboard #3, #4, #5, #6, org-scanning #5, #6, #7, report-trends #3, #5, #6, #7, scan-pipeline #6, #7.

All 9 criticals are closed by the end of Wave 5; Waves 6–8 are High→Low hardening.

---

## How this scan was run

- **Scanner**: Vibeman Bug Hunter prompt (`bug_hunter`, `src/lib/prompts/registry/agents/bug-hunter.ts`) — focus: latent failures, race conditions, edge cases, silent failures.
- **Date**: 2026-06-08. **Scope**: all 10 contexts (full coverage), full-stack TS (no Tauri split). **Target/context**: 5–8 findings each.
- **Method**: one `general-purpose` subagent per context (read-only), two waves (8 + 2). Orchestrator read only terse replies during scanning, not the reports.
- **Health baseline** (Phase B2): `tsc --noEmit` = 0 errors; `eslint` = 0 errors / 3 pre-existing warnings; tests = Playwright e2e only (no unit runner).
- **Files read by scan subagents**: ~112 total (in-scope context files + adjacent helpers the agents pulled to verify claims).
- **Verification**: counts cross-checked (header sum 68 = bullet count 68); 4 header sub-count drifts corrected against authoritative per-finding bullets.
