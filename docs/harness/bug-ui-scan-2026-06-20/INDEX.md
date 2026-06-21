# Combined Bug-Hunter + UI-Perfectionist Scan — ascent, 2026-06-20

> Combined reliability (🐛 Bug Hunter) + design/UX (🎨 UI Perfectionist) audit of every Vibeman context.
> 44 parallel subagent runs, batched in 6 waves of ≤8. Each subagent verified findings against the
> CURRENT source and deliberately did NOT re-report already-hardened paths from prior scans.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 44 contexts | 4 | 51 | 117 | 61 | **233** |
| Share | 1.7% | 21.9% | 50.2% | 26.2% | 100% |

Lens split: **158 bug-hunter**, **75 ui-perfectionist**. Counts verified two independent ways
(sum of per-file `> Total:` headers = 233; count of `**Severity**:` bullets = 233; zero per-file mismatch).

---

## All 4 critical findings

1. **Members & Access Control — Invite consumed by a GET on page load.** `src/app/invite/[token]/page.tsx:75` — a single-use, role-granting invite is redeemed as a side-effect of rendering the accept page (no POST / `isSameOrigin` / explicit confirm). Link prefetchers, email scanners, and chat unfurlers burn the invite; on a shared link, whoever opens it first silently captures the role. → **Wave 1**
2. **Org Import — `/api/org/import` never calls `requireOrgAccess`.** `src/app/api/org/import/route.ts:116` — unlike every sibling org mutation, the import route is ungated, so any signed-in viewer (or anyone, when auth is off) can pass `{org:"victim"}` to drain another tenant's prepaid scan credits and inject repos/scores into its watchlist & dashboard. (Confirms the long-standing "ungated `/api/org/*` mutation" follow-up — this is the one that was still live.) → **Wave 1**
3. **Usage Metering — `/usage` page cross-tenant IDOR.** `src/app/usage/page.tsx:77-132` — the page reads a raw `?org=` slug and queries it WITHOUT the `session.installations.some()` membership check that the sibling `/api/usage` route enforces. An authenticated user can read any org's scan volume, repo names, token/cost spend, credit balance and badge reach. → **Wave 1**
4. **Scan Persistence — degraded-mock & low-coverage scans are persisted and re-served cross-instance.** `src/lib/db/scans-persist.ts:57` (callers `scan/route.ts:213,233`, `scan/stream/route.ts:170,183`) — the in-memory `cacheSet` skip only protects RAM; the durable DB tier still stores a degraded-mock report (LLM requested, mock served) and `lookupCachedScan` re-serves it for ~7 days. Confirms the known-open "degraded-mock persistence guard". → **Wave 3**

---

## Per-context breakdown

Sorted by criticals desc, then total. Report file = `<slug>.md` in this directory.

| Context | Group | C | H | M | L | Total | Report (`<slug>.md`) |
|---|---|---:|---:|---:|---:|---:|---|
| Members & Access Control | Org Scanning & Fleet Rollups | 1 | 2 | 2 | 1 | 6 | members-access-control |
| Usage Metering & Public Badge | Billing, Credits & Metering | 1 | 1 | 1 | 3 | 6 | usage-metering-public-badge |
| Scan Persistence & History | Data & Persistence | 1 | 2 | 0 | 2 | 5 | scan-persistence-history |
| Org Import, Scan & Watchlist | Org Scanning & Fleet Rollups | 1 | 0 | 2 | 1 | 4 | org-import-scan-watchlist |
| Credits & Entitlements | Billing, Credits & Metering | 0 | 2 | 3 | 1 | 6 | credits-entitlements |
| Executive Briefing | Org Planning & Execution | 0 | 2 | 4 | 0 | 6 | executive-briefing |
| Fleet Rollups & Insights | Org Scanning & Fleet Rollups | 0 | 2 | 3 | 1 | 6 | fleet-rollups-insights |
| GitHub App Installation & Webhooks | Identity & GitHub Connectivity | 0 | 2 | 3 | 1 | 6 | github-app-installation-webhooks |
| Live War Room | Org Planning & Execution | 0 | 2 | 3 | 1 | 6 | live-war-room |
| Marketing About Page | Marketing Site & Design System | 0 | 2 | 2 | 2 | 6 | marketing-about-page |
| Org Overview & Standing | Org Dashboard & Analytics | 0 | 2 | 3 | 1 | 6 | org-overview-standing |
| Playbooks | Org Planning & Execution | 0 | 2 | 3 | 1 | 6 | playbooks |
| Quotas & Rate Limiting | Billing, Credits & Metering | 0 | 2 | 3 | 1 | 6 | quotas-rate-limiting |
| Connect & Repo Selection | Onboarding, Shell & AI Standard | 0 | 1 | 4 | 1 | 6 | connect-repo-selection |
| Design System: UI Primitives & Deck | Marketing Site & Design System | 0 | 1 | 3 | 2 | 6 | design-system-ui-primitives-deck |
| First-Run Onboarding Wizard | Onboarding, Shell & AI Standard | 0 | 1 | 4 | 1 | 6 | first-run-onboarding-wizard |
| Fleet Alerts & Digests | Org Scanning & Fleet Rollups | 0 | 1 | 4 | 1 | 6 | fleet-alerts-digests |
| GitHub Repo Data Access | Identity & GitHub Connectivity | 0 | 1 | 3 | 2 | 6 | github-repo-data-access |
| Goals & Initiatives | Org Planning & Execution | 0 | 1 | 3 | 2 | 6 | goals-initiatives |
| Landing Page Prototypes | Marketing Site & Design System | 0 | 1 | 4 | 1 | 6 | landing-page-prototypes |
| Launch Fleet Map | Onboarding, Shell & AI Standard | 0 | 1 | 3 | 2 | 6 | launch-fleet-map |
| Repositories & Segments | Org Dashboard & Analytics | 0 | 1 | 4 | 1 | 6 | repositories-segments |
| App Shell, SEO & Error Pages | Onboarding, Shell & AI Standard | 0 | 2 | 2 | 1 | 5 | app-shell-seo-error-pages |
| CI Gate & Status Checks | Repository Scanning & Scoring | 0 | 2 | 2 | 1 | 5 | ci-gate-status-checks |
| Database Client & Schema | Data & Persistence | 0 | 2 | 3 | 0 | 5 | database-client-schema |
| Repo Report Shell & Tabs | Reporting & Visualization | 0 | 2 | 2 | 1 | 5 | repo-report-shell-tabs |
| AI-Native Standard & Onboarding Skill | Onboarding, Shell & AI Standard | 0 | 1 | 3 | 1 | 5 | ai-native-standard-onboarding-skill |
| Backlog Management | Org Planning & Execution | 0 | 1 | 3 | 1 | 5 | backlog-management |
| Checkout & Plans (Polar) | Billing, Credits & Metering | 0 | 1 | 2 | 2 | 5 | checkout-plans-polar |
| GitHub OAuth & Session | Identity & GitHub Connectivity | 0 | 1 | 2 | 2 | 5 | github-oauth-session |
| Investment Simulator & Forecast | Org Planning & Execution | 0 | 1 | 2 | 2 | 5 | investment-simulator-forecast |
| LLM Provider Abstraction | Repository Scanning & Scoring | 0 | 1 | 3 | 1 | 5 | llm-provider-abstraction |
| Maturity Model & Scoring Engine | Repository Scanning & Scoring | 0 | 1 | 2 | 2 | 5 | maturity-model-scoring-engine |
| Practices, Governance & Adoption | Org Dashboard & Analytics | 0 | 1 | 3 | 1 | 5 | practices-governance-adoption |
| Roadmap & Recommendation Tracking | Reporting & Visualization | 0 | 1 | 2 | 2 | 5 | roadmap-recommendation-tracking |
| Security Posture & Audit Log | Org Dashboard & Analytics | 0 | 1 | 3 | 1 | 5 | security-posture-audit-log |
| PDF & LLM Export | Reporting & Visualization | 0 | 0 | 4 | 1 | 5 | pdf-llm-export |
| Scan Pipeline & Ingestion | Repository Scanning & Scoring | 0 | 0 | 2 | 3 | 5 | scan-pipeline-ingestion |
| Score Charts & Visuals | Reporting & Visualization | 0 | 0 | 3 | 2 | 5 | score-charts-visuals |
| Trends & Comparison | Reporting & Visualization | 0 | 0 | 3 | 2 | 5 | trends-comparison |
| Org Branding & White-label | Org Dashboard & Analytics | 0 | 1 | 1 | 2 | 4 | org-branding-white-label |
| People & Delivery Analytics | Org Dashboard & Analytics | 0 | 0 | 2 | 2 | 4 | people-delivery-analytics |
| Data Retention & Purge | Data & Persistence | 0 | 0 | 2 | 1 | 3 | data-retention-purge |
| Dev Inspector | Onboarding, Shell & AI Standard | 0 | 0 | 2 | 1 | 3 | dev-inspector |

---

## Triage themes

| # | Theme | Approx count | Why it's a wave (shared mental model) |
|---|---|---:|---|
| T1 | **Multi-tenant authz & capability leaks** | ~8 | The choke point is "gate on the resource actually used, require an explicit POST for capability grants." 3 of 4 criticals live here. |
| T2 | **Billing / credits / metering integrity** | ~12 | Money math: idempotent grants/refunds, paid-event durability, ledger-window correctness. |
| T3 | **Data integrity & persistence** | ~8 | What gets written & re-served: degraded-mock persistence (crit), tree-vs-commit headSha, dedup, purge bounding. |
| T4 | **Silent failure / success-theater** | ~30 | Optimistic UI that swallows a non-2xx (delete/toggle/promote) + fire-and-forget writes; same fix shape everywhere: check `res.ok`, roll back, surface. |
| T5 | **Scoring / aggregation correctness** | ~12 | Axis deflation, mismatched-week fleet sums, unit-mismatched cohort percentile, 2-point "100% confidence", gate-policy drift. |
| T6 | **Reliability / resilience (infra)** | ~10 | Unguarded auth call 500s the app, DSQL cold-start token, connection storm, synchronous webhook processing, GHES host override. |
| T7 | **Accessibility (a11y)** | ~28 | Focus management, focus rings, tab/aria semantics, SR-exposed phantom content, live regions. Largest single category. |
| T8 | **Reduced-motion safety** | ~6 | `MotionConfig reducedMotion="user"` only strips transforms; `width`/`left`/`cx` animations bypass it across marketing + matrix. |
| T9 | **SEO / metadata correctness** | ~4 | sitemap↔robots contradiction, base-URL resolver drift, twitter card. |
| T10 | **Observability / silent-config** | ~6 | Rate-limit trips uncounted on the riskiest routes, audit actor-attribution gap, dispatch-failure undercount. |
| T11 | **"Live" surfaces that aren't / resource burn** | ~5 | Shared war-room frozen snapshot, auto-relaunch credit burn, stale mover ring after manual scan. |

---

## Suggested fix-wave split

Each wave = one session, ~5–7 fixes, one mental model. Criticals + their sibling Highs first.

- **Wave 1 — Multi-tenant authz & capability leaks (T1).** invite GET-consume (crit), `/api/org/import` authz (crit), `/usage` IDOR (crit), members owner-mint last-owner guard, pending-invite-token leak in GET/bundle, playbook `repoFullName` validation, branding `logoUrl` SSRF. *(3 criticals.)*
- **Wave 2 — Billing / credits / metering integrity (T2).** Polar order paid-but-org-not-found → permanent credit loss, paid pack never `setOrgPlan`, refund non-idempotent (double refund), credit reconciliation drops rows past 200, allowance-vs-credit boundary race.
- **Wave 3 — Data integrity & persistence (T3).** degraded-mock persisted & re-served (crit), tree-vs-commit headSha stamping, pinned-permalink contributors-as-of-scan, retention purge unbounded SELECT + audit-failure swallow.
- **Wave 4 — Silent failure / success-theater (T4).** segment delete swallow-403, playbook remove swallow, repositories tag-toggle swallow, connect bulk-vs-per-row clobber, backlog refresh drops in-flight edits, roadmap concurrent PATCH lost-update, non-idempotent promote-to-initiative.
- **Wave 5 — Scoring / aggregation correctness (T5).** axis roll-up charges dropped dim at 0×full-weight, fleet activity sums mismatched weeks, cohort percentile unit mismatch, trajectory "100% confidence" on 2 points, governance `requireProtectedBranch` dashboard↔CI drift, GatePolicyEditor D9-floor downgrade.
- **Wave 6 — Reliability / resilience (T6).** proxy `getUser()` unguarded 500s, DSQL cold-start token + read-path recovery, no connection limit (storm), webhook synchronous processing + truncated-listing unwatch, GHES host override, claude-cli false availability.
- **Wave 7 — Accessibility & reduced-motion (T7+T8).** reduced-motion bypass (matrix/marketing/about), wizard focus + step announce, DeckNav focus ring, orphaned tabpanel/aria, ROI badge SR phantom, audit actor attribution (a11y of the viewer).
- **Wave 8 — UX / SEO / observability / "live" tail (T9+T10+T11 + Mediums).** sitemap↔robots, rate-limit observability on scan routes, alerts noise-gate (regressers), live-war-room frozen + credit burn, executive-briefing segment-scope drop on PDF/share, plus the Medium tail by context.

---

## How this scan was run

- **Scanners:** combined `bug_hunter` (🐛, `src/lib/prompts/registry/agents/bug-hunter.ts`) + `ui_perfectionist`
  (🎨, `…/ui-perfectionist.ts`) applied in a single per-context subagent, lens emphasis chosen by context nature.
- **Scope:** all 44 Vibeman contexts (full-stack TypeScript; ascent has no Rust/`src-tauri`). Depth: 4–7 findings/context (lean).
- **Method:** 1 `general-purpose` subagent per context, max 8 parallel (6 waves). Each read only its context's
  `filePaths` (from `_manifest.json`), verified liveness against current source, skipped already-hardened paths,
  and wrote `<slug>.md`. The orchestrator read only terse replies.
- **Baseline (Phase B2):** `tsc --noEmit` = **0 errors**; `vitest run` = **2394/2394 passing** (144 files).
- **Verification:** findings counted two ways (header sum 233 = bullet count 233, 0 mismatch).
- **Provenance files:** `_manifest.json` (context→files), `_parsed.json` (structured findings), `<slug>.md` (44 reports).
