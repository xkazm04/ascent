# Bug-Hunter + UI-Perfectionist Scan — ascent, 2026-07-09

> Combined two-lens audit (bug-hunter + ui-perfectionist) over all 44 contexts.
> 44 parallel subagent runs, batched in 6 waves of ≤8.
> Baseline at scan time: **tsc 0 errors · vitest 3046 passing (198 files)**.
> Branch: `vibeman/bug-ui-scan-2026-07-09` (uncommitted WIP carried in-tree, master ref clean).

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 44 contexts | 0¹ | 37 | 146 | 119 | **302** |
| Share | 0% | 12.3% | 48.3% | 39.4% | 100% |

By lens: **bug-hunter 209** · **ui-perfectionist 93**.

Counts verified three ways (declared `> Total:` headers, `- **Severity**:` bullets, `## N.` headings) — all agree at 302, and all 44 files are internally consistent.

> ¹ **Orchestrator re-triage:** no individual agent assigned a Critical, because each saw only its own context. Three Highs are Critical-class when read together — all three are *unauthenticated disclosure of private repo data*, which meets the brief's own Critical bar ("security hole"). They are listed as **C1–C3** below and treated as Criticals for wave planning. The per-context reports retain their original severities; this INDEX is the reconciled view.

---

## Elevated to Critical (orchestrator judgment)

> **STATUS: all 5 fixed in Wave 1.** See [FIXES-WAVE-1.md](FIXES-WAVE-1.md).
> C4 and C5 were **not found by the per-context scan** — they surfaced while fixing C1, whose comment
> cited `resolveScanAuth` as the correct template to mirror. It was itself broken, and worse.
> Confirmed against `.env.production`: `GITHUB_OAUTH_CLIENT_ID`/`_SECRET` are absent, so
> `isAuthConfigured()` is permanently `false` in production and every `!isAuthConfigured() || …` guard
> evaluates to "allow".

| # | Finding | File | Why Critical | Fixed |
|---|---|---|---|---|
| **C1** | `/api/practices/generate` guard is `!isAuthConfigured() \|\| sessionOwnsOrg(...)`. `isAuthConfigured()` is **false** in prod, so `!false` short-circuits the entire check. | `src/app/api/practices/generate/route.ts:31` | **Any** caller makes the server mint the org's GitHub **installation token** and returns private-repo metadata. No viewer check executes. | `91daa10` |
| **C2** | Public gate endpoint calls `scanRepository` **without** `noAmbientToken`, ingesting via the operator PAT. | `src/app/api/gate/[owner]/[repo]/route.ts:68` | Anonymous callers enumerate **private** repos' full gate verdicts using the operator's credentials. The badge + import routes explicitly guard this; the gate route was missed. | `857a574` |
| **C3** | `/api/app/setup` gates authorization on the dormant `isAuthConfigured()`/`getSession()` stack, so its owner guard is dead code in prod. | `src/app/api/app/setup/route.ts:32` | Unauthenticated installation-id enumeration + `private`-org seeding. Same bug class the repos route was hardened against. | `1bec4d6` |
| **C4** | *(missed by the scan)* `resolveScanAuth` mints the token **before** `/api/scan:52` checks for a viewer — and that check requires **any signed-in user, not membership**. Caller-supplied `installationId` honored unconditionally. | `src/lib/scan.ts:119-126` | **Any authenticated account** could `POST {repo:"victim-org/private-repo"}` and receive a full maturity report on a private repo. The most severe finding of the run. | `c83a4ed` |
| **C5** | *(missed by the scan)* `org/import` — both `ownsOrg` and the ambient-PAT escape hatch keyed on the dormant predicate; `requireOrgAccess` leaves `PUBLIC_ORG` open to any signed-in viewer. | `src/app/api/org/import/route.ts:100,106,130` | A signed-in caller posts `{org:"public", repos:["victim/secret"], installationId:<victim>}` → mints the victim's token or rides the operator PAT. The confused deputy its own comment at `:120` describes. | `fd4954f` |

**Lesson for future scans:** a per-context agent cannot see a cross-context predicate. The three scanned
Criticals were each reported as an isolated route bug; the shared root cause — and its two worst
instances, in a *library* rather than a route — only became visible when fixing them.

---

## Per-context breakdown

Sorted by Highs desc, then total.

| # | Context | H | M | L | Total | Report |
|---|---|---:|---:|---:|---:|---|
| 1 | CI Gate & Status Checks | 3 | 3 | 1 | 7 | [ci-gate-status-checks.md](ci-gate-status-checks.md) |
| 2 | Checkout & Plans (Polar) | 2 | 4 | 1 | 7 | [checkout-plans-polar.md](checkout-plans-polar.md) |
| 3 | GitHub App Installation & Webhooks | 2 | 4 | 1 | 7 | [github-app-installation-webhooks.md](github-app-installation-webhooks.md) |
| 4 | GitHub OAuth & Session | 2 | 3 | 2 | 7 | [github-oauth-session.md](github-oauth-session.md) |
| 5 | Live War Room | 2 | 3 | 2 | 7 | [live-war-room.md](live-war-room.md) |
| 6 | Maturity Model & Scoring Engine | 2 | 4 | 1 | 7 | [maturity-model-scoring-engine.md](maturity-model-scoring-engine.md) |
| 7 | Members & Access Control | 2 | 4 | 1 | 7 | [members-access-control.md](members-access-control.md) |
| 8 | Practices, Governance & Adoption | 2 | 2 | 3 | 7 | [practices-governance-adoption.md](practices-governance-adoption.md) |
| 9 | Security Posture & Audit Log | 2 | 3 | 2 | 7 | [security-posture-audit-log.md](security-posture-audit-log.md) |
| 10 | Data Retention & Purge | 2 | 2 | 2 | 6 | [data-retention-purge.md](data-retention-purge.md) |
| 11 | Org Import, Scan & Watchlist | 1 | 6 | 1 | 8 | [org-import-scan-watchlist.md](org-import-scan-watchlist.md) |
| 12 | Playbooks | 1 | 3 | 4 | 8 | [playbooks.md](playbooks.md) |
| 13 | AI-Native Standard & Onboarding Skill | 1 | 3 | 3 | 7 | [ai-native-standard-onboarding-skill.md](ai-native-standard-onboarding-skill.md) |
| 14 | Backlog Management | 1 | 2 | 4 | 7 | [backlog-management.md](backlog-management.md) |
| 15 | Connect & Repo Selection | 1 | 5 | 1 | 7 | [connect-repo-selection.md](connect-repo-selection.md) |
| 16 | Executive Briefing | 1 | 3 | 3 | 7 | [executive-briefing.md](executive-briefing.md) |
| 17 | Fleet Alerts & Digests | 1 | 4 | 2 | 7 | [fleet-alerts-digests.md](fleet-alerts-digests.md) |
| 18 | GitHub Repo Data Access | 1 | 5 | 1 | 7 | [github-repo-data-access.md](github-repo-data-access.md) |
| 19 | Investment Simulator & Forecast | 1 | 3 | 3 | 7 | [investment-simulator-forecast.md](investment-simulator-forecast.md) |
| 20 | Launch Fleet Map | 1 | 3 | 3 | 7 | [launch-fleet-map.md](launch-fleet-map.md) |
| 21 | PDF & LLM Export | 1 | 2 | 4 | 7 | [pdf-llm-export.md](pdf-llm-export.md) |
| 22 | Scan Pipeline & Ingestion | 1 | 2 | 4 | 7 | [scan-pipeline-ingestion.md](scan-pipeline-ingestion.md) |
| 23 | Score Charts & Visuals | 1 | 3 | 3 | 7 | [score-charts-visuals.md](score-charts-visuals.md) |
| 24 | People & Delivery Analytics | 1 | 3 | 2 | 6 | [people-delivery-analytics.md](people-delivery-analytics.md) |
| 25 | Roadmap & Recommendation Tracking | 1 | 1 | 4 | 6 | [roadmap-recommendation-tracking.md](roadmap-recommendation-tracking.md) |
| 26 | Trends & Comparison | 1 | 2 | 3 | 6 | [trends-comparison.md](trends-comparison.md) |
| 27 | App Shell, SEO & Error Pages | 0 | 3 | 4 | 7 | [app-shell-seo-error-pages.md](app-shell-seo-error-pages.md) |
| 28 | Credits & Entitlements | 0 | 3 | 4 | 7 | [credits-entitlements.md](credits-entitlements.md) |
| 29 | Database Client & Schema | 0 | 6 | 1 | 7 | [database-client-schema.md](database-client-schema.md) |
| 30 | Design System: UI Primitives & Deck | 0 | 4 | 3 | 7 | [design-system-ui-primitives-deck.md](design-system-ui-primitives-deck.md) |
| 31 | First-Run Onboarding Wizard | 0 | 5 | 2 | 7 | [first-run-onboarding-wizard.md](first-run-onboarding-wizard.md) |
| 32 | Fleet Rollups & Insights | 0 | 4 | 3 | 7 | [fleet-rollups-insights.md](fleet-rollups-insights.md) |
| 33 | Goals & Initiatives | 0 | 3 | 4 | 7 | [goals-initiatives.md](goals-initiatives.md) |
| 34 | LLM Provider Abstraction | 0 | 6 | 1 | 7 | [llm-provider-abstraction.md](llm-provider-abstraction.md) |
| 35 | Marketing About Page | 0 | 2 | 5 | 7 | [marketing-about-page.md](marketing-about-page.md) |
| 36 | Org Overview & Standing | 0 | 4 | 3 | 7 | [org-overview-standing.md](org-overview-standing.md) |
| 37 | Quotas & Rate Limiting | 0 | 2 | 5 | 7 | [quotas-rate-limiting.md](quotas-rate-limiting.md) |
| 38 | Repo Report Shell & Tabs | 0 | 6 | 1 | 7 | [repo-report-shell-tabs.md](repo-report-shell-tabs.md) |
| 39 | Repositories & Segments | 0 | 4 | 3 | 7 | [repositories-segments.md](repositories-segments.md) |
| 40 | Scan Persistence & History | 0 | 3 | 4 | 7 | [scan-persistence-history.md](scan-persistence-history.md) |
| 41 | Usage Metering & Public Badge | 0 | 5 | 2 | 7 | [usage-metering-public-badge.md](usage-metering-public-badge.md) |
| 42 | Landing Page Prototypes | 0 | 1 | 5 | 6 | [landing-page-prototypes.md](landing-page-prototypes.md) |
| 43 | Org Branding & White-label | 0 | 2 | 4 | 6 | [org-branding-white-label.md](org-branding-white-label.md) |
| 44 | Dev Inspector | 0 | 1 | 4 | 5 | [dev-inspector.md](dev-inspector.md) |

---

## All 37 High findings, grouped by theme

### A. Dual-auth: the dormant-predicate cluster (15 findings — the defining theme)

The app runs **two auth stacks**. `authGateEnabled()` / `getViewer()` / `canReadOrg` is the **ACTIVE** Supabase wall. `isAuthConfigured()` / `getSession()` is a **DORMANT** legacy custom-OAuth system, inert in production (no `ascent_session` cookie is ever minted).

`src/lib/authz.ts`'s guards are all **active-path-correct**. The rot is entirely at the **call sites**. This is why it's fixable: the correct primitives already exist.

**Verified fix primitive:** `resolveViewerLogin()` at `src/lib/access.ts:89-94` tries the dormant `getSession()`, then falls through to `(await getViewer())?.login` — a JWT-validated Supabase identity. It **is safe** and is the canonical fix for the null-actor cluster. (Two scan agents disagreed on this; settled by direct read.)
⚠️ **Constraint:** it must be awaited in a route/render body, **never inside a `ReadableStream start()`** — cookie-scoped reads return null there.

#### A1 — Authorization actually bypassed (**Critical**)
1. **C1 · Practices** — `generate` mints the org installation token for anyone. `api/practices/generate/route.ts:31`
2. **C3 · GitHub App** — setup-route authorization never engages in prod. `api/app/setup/route.ts:32`

#### A2 — Feature lockouts: the owner can't reach their own private data (6)
3. **GitHub OAuth** — `readableOrgForOwner` derives org access from the dormant session → always `"public"`. `lib/auth.ts:336` *(root cause of #4–#6)*
4. **Trends & Comparison** — private-repo trends/compare silently render "No scans recorded yet."
5. **PDF & LLM Export** — Private-tier PDF export permanently 404s for private repos.
6. **Members & Access Control** — **the invite accept *page* is dead in prod**; no invited teammate can ever accept. `invite/[token]/page.tsx:63`
7. **GitHub OAuth** — `getActiveOrg`/`orgOptionsForSession` → dead org switcher + broken active-org POST.
8. **Repo Report Shell** *(M)* — an owner can't view their own private repo's report permalink.

#### A3 — Null-actor audit rows: privilege changes are un-attributable (7)
9. **Security Posture** — audit actor from dormant `getSession()` → null actor on gate-policy / alerts / invites. `lib/db/scans-audit.ts`
10. **Members & Access Control** — **role grants, removals, invites un-attributable.** `api/org/members/route.ts:62`, `api/org/invites/route.ts:64`
11. **Playbooks** — `createdBy` / `appliedBy` + every audit entry anonymous.
12. **Roadmap & Recommendations** — every human edit stamped `actor: null` → renders "system". `api/recommendations/[id]/route.ts:53`
13. **Backlog Management** — same route, timeline + audit rows.
14. **Fleet Alerts** — alert-config audit entries unattributable.
15. **CI Gate** — gate-policy change audit → null actor.

> An audit log that cannot identify who did what is not an audit log. A2 and A3 share one root cause and one fix.

---

### B. Unauthenticated private-repo exposure via ambient credentials (3)

16. **C2 · CI Gate** — public gate endpoint ingests with the operator PAT. `api/gate/[owner]/[repo]/route.ts:68`
17. **Live War Room** — `/live/shared` token has **no revocation** and a hardcoded 7-day TTL; killable only by rotating a secret that defaults to `AUTH_SECRET` (signs out every user).
18. **Live War Room** — share-link mint is open in an auth-off deployment, reopening a read path the read-gate keeps closed.

> Contrast: `executive-briefing`'s share tokens **are** revocable, HMAC-SHA256, timing-safe, expiry-on-read. Same feature, two implementations, one safe. Port the safe one.

---

### C. Honesty flags computed, then never read — "success theater" (6)

The codebase repeatedly *computes* a degradation signal and then drops it before any consumer sees it. 30 findings carry the `silent-failure` category overall.

19. **GitHub Repo Data Access** — GraphQL `partial` flag is **orphaned**; nothing in the repo reads it. `lib/github/graphql.ts`
20. **Maturity Model** — consequence of #19: a truncated PR slice is **scored and cached as authoritative**, silently understating D6/D7/D8 on large repos. `lib/analyze/pulls.ts:291`
21. **CI Gate** — a degraded / mock-fallback scan returns a confident `200 PASS`; the JSON omits `warnings`/`engine`/`confidence`, so **CI merges on a fabricated score**.
22. **Security Posture** — page discards the supply-chain `degraded` flag → a GitHub-auth failure renders as a **clean** supply chain.
23. **Data Retention** — deferred trailing sweeps set `stoppedEarly` but push no error → the purge run reports a green `200`.
24. **AI-Native Standard** — `maintain.mjs check` is a silent no-op in its documented pre-push placement (diffs an empty post-commit worktree).

> Nuance worth preserving: `scan.ts`'s mock fallback **is** honestly surfaced in the web UI (`report.warnings` → `ReportNotices`), and degraded scans skip cache+persist. The failure is specifically at machine-readable consumers — the **gate JSON** and the **cached PR slice**.

---

### D. Money & billing correctness (3 High + 4 Medium)

25. **Checkout** — **plan tiers are never revoked** on subscription cancellation or refund. A cancelled/charged-back Pro/Team org keeps entitlements forever. `api/billing/webhook/route.ts:97`
26. **Checkout** — the **paid tier-upgrade funnel is unreachable**: `/pricing`'s Pro/Team CTA dead-ends at `/onboarding`; the only live checkout link sells credit packs. Revenue never captured.
27. **Org Import/Scan** — **no per-repo lock** → two tabs / two members double-scan and **double-charge**. (Cron's `claimRescan` already does this atomically — the correct pattern exists, unapplied.)
- *(M)* Credits — refund clawback key-format migration can **double-claw** a customer's credits.
- *(M)* Onboarding — cost preview and entitlement check disagree on the free monthly allowance.
- *(M)* Import route omits the BYOM exemption that scan/cron have → double-billing.
- *(M)* **WIP:** new OpenRouter `vendor/model` ids never match `MODEL_PRICES` → nulls the whole org's `/usage` cost estimate.

---

### E. Concurrency, races & missing locks (2 High + several M)

28. **GitHub App** — `installationMatchesOwner=false` early-returns without releasing the delivery → a transient blip **permanently drops** a PR gate / push rescan.
29. **Investment Simulator** — uncapped `fixes[]` is an attacker-controlled loop bound × fleet size → **unauthenticated event-loop stall**.
- *(M)* Goals/Initiatives — blind last-write-wins (no `updatedAt`/version column).
- *(M)* Quotas — rate limiter records the hit **before** the cap check → once tripped, it self-saturates.
- *(M)* Connect — watch-toggle race: a superseded POST's `finally` clears `watchPending` early.

---

### F. Recovery gaps & stuck states (3)

30. **CI Gate** — `createCheckRun` is a single un-retried POST; the caller swallows the throw → a **required check stays permanently pending**, blocking every PR.
31. **Launch Fleet Map** — `hydrating = loaded < orgs` never clears when any org errors → live region announces "charting 2/3…" forever.
32. **Data Retention** — the wall-clock budget is polled only *between* orgs → one large org (the exact case the budget protects) is hard-killed mid-delete.

---

### G. Cache & staleness correctness (1)

33. **Scan Pipeline** — the scan cache key **omits provider, model, and rubric version** → after any model change, every unchanged repo serves the **old score as current** for up to 7 days, with no bulk-invalidation lever. `lib/cache.ts:51`

---

### H. Aggregation scope & denominator mismatches (1)

34. **People & Delivery** — allocated AI-spend is distributed across the **whole org** but joined against **filtered** PR signals → any filtered delivery view inflates idle/ungoverned/annual $ figures by `(org total)/(subset)`, driving wrong budget calls.

---

### I. UI: crashes, stuck states, overflow (2)

35. **Score Charts** — stale hover index + non-null assertion → toggling the range while hovering **white-screens the Trends section** with a TypeError. `DimLine.tsx:71` *(sibling `RadarChart` guards this exact pattern)*
36. **Connect & Repo Selection** — long repo names never truncate (`truncate` without `min-w-0`) → badges pushed off-screen on the core repo-selection screen.

---

### J. LLM trust boundary (1)

37. **Maturity Model** — repo file content is injected verbatim into the scoring prompt with **no untrusted-data boundary**. A README can instruct the model to return a perfect score — and this score gates merges and is sold to customers.

---

## Triage themes (the wave map)

| Theme | Findings | Why this is a wave, not scattered fixes |
|---|---:|---|
| **T1. Dormant-auth: authorization bypass** | 3 (C1–C3) | One mental model, one predicate swap. Security-critical; must land first and alone. |
| **T2. Dormant-auth: null-actor attribution** | 7 | All become `resolveViewerLogin()`. Mechanical once verified — and it *is* verified. |
| **T3. Dormant-auth: feature lockouts** | 6 | All descend from `readableOrgForOwner`. Fix the helper, then its 5 callers. |
| **T4. Honesty flags nobody reads** | 6 | `partial` + `degraded` + `stoppedEarly` share a shape: compute a truth, drop it before the consumer. |
| **T5. Money: revocation, funnel, double-charge** | 3H + 4M | Revenue-affecting. Needs product sign-off on #26 (pricing funnel) before code. |
| **T6. Share-token lifecycle** | 3 | Port `briefing-share`'s revocable design onto `live-share`. |
| **T7. Recovery gaps & stuck states** | 3 | Retry/release/interrupt — one reliability model. |
| **T8. Concurrency & locks** | 2H + 3M | `claimRescan` is the in-repo template. |
| **T9. Cache & scoring correctness** | 2 (G, H) | Cache key + aggregation scope; both silently wrong numbers. |
| **T10. UI crash + overflow** | 2 | Quick, high-visibility. |
| **T11. Prompt injection** | 1 | Needs a design decision (delimiting vs. structured input), not a one-liner. |
| **T12. Accessibility** | ~12 M/L | Tabs semantics, aria-live flooding, skip-link no-op, chart SR-invisibility, contrast. |
| **T13. Destructive actions w/o confirmation** | ~7 M/L | Several open **real PRs in customer repos** on one click. |
| **T14. Design-system drift** | ~10 M/L | Hardcoded hex vs. tokens; would break a white-label re-skin. |
| **T15. SSR / public front door** | 2 M | `Reveal` ships `opacity:0` → `/about` + landing blank without JS. |

---

## Wave status (updated 2026-07-09)

| Wave | Theme | Status | Commit(s) |
|---|---|---|---|
| 1 | Critical auth bypass | **DONE** — 5 Criticals (2 the scan could not find) | `74f0fe5`…`fa3aa9a` |
| 2 | Dormant-auth null-actor | **DONE** — 19 routes (INDEX said 7) | `b656d3f`, `c655a90` |
| 3 | Dormant-auth lockouts | **DONE** — 6; org switcher deferred (needs a data-path change) | `355628d`, `9c5a637` |
| 4 | Honesty flags | **DONE** — 6 | `ec1ccbd` |
| 5 | Money correctness | **DONE** — 5; pricing funnel is a product decision | `6716d7c` |
| 6+7 | Share tokens, recovery, cache, bounds | **DONE** — ~10 | `0c706f4` |
| 8 | UI crash, overflow, destructive confirm | **DONE** — 3 primary + ~8 secondary | `9121a4c` |
| 9-0 | DOM test environment (the prerequisite) | **DONE** | `6459b2d` |
| 9a | Dormant-auth: the PAGE gates + `/launch` unreachable | **DONE** — 8 | `5479b17` |
| 9b | SSR: `/about` + landing rendered blank without JS | **DONE** — 4 | `e81ddd5` |
| 9c | Dead code (verified 4 ways before deletion) | **DONE** — 8 | `e81ddd5` |
| 9d | Accessibility: skip-link, live-region flooding | **DONE** — ~6 | `e81ddd5` |
| 9e | Backend correctness + metering + destructive-confirms + token drift | **DONE** — ~55 | `1aab892`…`1d5ba4e` |
| 9f | Bug-hunter Mediums: LLM, ops/alerts, billing, org, report surfaces | **DONE** — ~40 | `7a603d8`…`d3e5d6e` |
| 9g | Remaining Med/Low tail (a11y, per-context polish, WIP-blocked items) | **OPEN** — ~145 | — |

Cumulative: tsc **0 → 0**, vitest **3046 → 3334 passing**, `next build` clean, **0 regressions**, 39 commits.
Summaries: [Wave 1](FIXES-WAVE-1.md) · [Waves 2–3](FIXES-WAVE-2-3.md) · [Waves 4–7](FIXES-WAVE-4-7.md) · [Wave 9](FIXES-WAVE-9.md).

> **RESOLVED (`6459b2d`):** the repo now HAS a DOM test environment. A component test opts in with a line-1
> `// @vitest-environment jsdom` docblock; the default stays `node`. UI findings are now pinnable.

---

## Original suggested wave plan

Each wave = one mental model, 5–7 fixes, verified against baseline (tsc 0 · vitest 3046) before the next.

| Wave | Theme | Findings | Notes |
|---|---|---:|---|
| **1** | **Critical auth bypass (T1)** | 3 | C1, C2, C3. Land alone, verify hard. |
| **2** | Dormant-auth null-actor (T2) | 7 | Swap to `resolveViewerLogin()`; watch the SSE constraint. |
| **3** | Dormant-auth lockouts (T3) | 6 | Fix `readableOrgForOwner` → cascade to 5 callers. **Incl. the dead invite page.** |
| **4** | Honesty flags (T4) | 6 | Thread `partial`/`degraded` to gate JSON + skip caching partial slices. |
| **5** | Money correctness (T5) | 3–7 | Plan revocation + double-charge lock. **Funnel needs your product call.** |
| **6** | Share tokens + recovery gaps (T6+T7) | 6 | Revocation, retry, interrupt. |
| **7** | Cache key, aggregation scope, concurrency (T8+T9) | 5 | Silently-wrong-number class. |
| **8** | UI crash, overflow, destructive confirms (T10+T13) | 7 | High user-visible payoff. |
| **9+** | A11y, design-system drift, SSR (T12+T14+T15) | ~24 | The Medium/Low tail. |

---

## Context-map drift (7 contexts have stale file lists)

The scan incidentally verified the Vibeman context map against the tree. These files are **referenced by a context but absent**:

| Context | Stale reference | Reality |
|---|---|---|
| Landing Page Prototypes | `PricingCards.tsx`, `EditorialSteps.tsx`, `shared/content.ts` | deleted |
| Marketing About Page | `AboutReveal.tsx` | shared reveal is `deck/Reveal.tsx` |
| Repositories & Segments | `segments/[id]/bulk/route.ts` | actual: `segments/[id]/repos/bulk/route.ts` |
| Roadmap & Recommendation | `RoadmapPanel.tsx` | deleted |
| Repo Report Shell & Tabs | `ReportTabBar.tsx`, `ReportSkeleton.tsx` | deleted (tabs migrated to `SideNav`) |
| Scan Pipeline & Ingestion | `ScanGallery.tsx` | actual: `IndexGallery.tsx` |

Additionally **dead code** (present but unreferenced): `OrgStanding`, `OrgGapsSection`, `PeriodSummary`, `CollapsibleSection` (org-overview), `PlaybooksPanel` (playbooks).

→ Recommend `refresh_context` on these 7 after the fix waves.

---

## Notable verified-clean results

Recorded so a future scan doesn't re-flag them:

- **`authz.ts` guards** — all active-path-correct; role hierarchy, escalation guards, invite token entropy + single-use all sound.
- **IDOR** — clean across `segments/[id]`, `goals/[id]`, `initiatives/[id]`, `playbooks/[id]`, `recommendations/[id]`. Every one re-scopes to the caller's org.
- **`executive-briefing` share tokens** — HMAC-SHA256, timing-safe compare, expiry enforced on read, minting gated on the active wall.
- **Scoring math** — weights sum to 1 and match the docs; level bands contiguous; missing dimensions correctly dropped from **both** numerator and denominator (no silent-zero deflation).
- **`chartScale.ts`** — NaN-guards and clamps throughout; the `d="M NaN"` chart-blanking class is genuinely prevented.
- **LLM degradation honesty** — mock fallback **is** labeled to the web UI; degraded scans skip cache + persist.
- **`scan.ts`** — SSRF host guard and SSE multiline framing both verified clean.
- **`org/export`** — `requireOrgRead` + `csvField` CSV-injection neutralization both sound.
- **`org-branding`** — owner-gated, strict `#rrggbb` regex, SSRF/DNS-rebind handled by `resolveSafeLogoDataUri`.
- **`dev-inspector`** — double-gated (`NODE_ENV` + `DEV_INSPECT`), tree-shaken in prod. No leak.
- **`DimensionTrends` race** — previously deferred; **now actually fixed** (AbortController + unmount abort).
- **`prisma/schema.prisma` vs `init.sql`** — mechanically verified across all 37 models; **no drift**. The uncommitted `OrgMemory`/`OrgDecision` additions are clean.
- **Reduced-motion** — honored across the About page, war-room celebrations, and `globals.css:426`.

---

## How this scan was run

- **Scanners**: `bug-hunter` + `ui-perfectionist` (Vibeman prompt registry, `src/lib/prompts/registry/agents/`), applied **combined** per context.
- **Date**: 2026-07-09.
- **Scope**: all 44 contexts / 460 file refs, full-stack. Working tree scanned **as-is**, including uncommitted WIP.
- **Method**: 44 isolated `general-purpose` subagents, ≤8 parallel, each reading a shared brief (`_SCAN-BRIEF.md`), writing one report, replying with ≤150-word stats. The orchestrator never read a report during scanning.
- **Target**: 7 findings/context (range 6–8). Agents were instructed **not to pad** — several returned 5–6 and documented what they verified as clean instead.
- **Files read**: ~560 across all subagents (many re-read shared helpers to confirm).
- **Verification**: findings counted 3 independent ways (declared totals, severity bullets, `## N.` headings) → all agree at 302; per-file consistency checked for all 44.
- **Orchestrator re-triage**: 3 Highs elevated to Critical on cross-context evidence (see above). One inter-agent contradiction (`resolveViewerLogin`) resolved by direct source read at `access.ts:89-94`.
