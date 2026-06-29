# Business-Visionary + Bug-Hunter Scan — ascent — 2026-06-29

> Combined dual-lens scan (🚀 business-visionary + 🐛 bug-hunter), ~5 findings/context.
> 10 parallel subagent runs (one per context group), covering all 44 contexts + 20 new WIP files.
> Branch: `vibeman/biz-bug-scan-2026-06-29` (snapshot of current WIP; `master` untouched at `c8e04c3`).

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 44 contexts | 1 | 46 | 130 | 43 | **220** |
| Share | 0.5% | 21% | 59% | 20% | 100% |

**By lens:** 🐛 bug-hunter **130** · 🚀 business-visionary **90**
(counts verified two ways: 10 `> Total:` headers sum = 220; `- **Severity**:` bullets = 220 ✓)

---

## Two tracks (this is the key triage decision)

The combined scan produced two structurally different kinds of finding:

- **🐛 Bug track — 130 findings (1C / 9H / 120 M·L).** Genuine reliability, security, and
  data-integrity defects. These are *fixable* in the normal Pipeline-B wave sense — bounded,
  verifiable, mostly low-risk. **Recommended for the fix waves.**
- **🚀 Business track — 90 findings (37H / 52M / 1L).** Feature, monetization, growth, and
  differentiation opportunities (self-serve subscriptions, Enterprise tier, README badges,
  email digests, marketplaces, two-way SCM sync…). Most are **multi-task builds that hinge on
  product & pricing decisions** (what to gate, what a tier costs, whether to send email). These
  are a **prioritized backlog for you to choose from**, not auto-fix material.

---

## Per-group breakdown

(Sorted by criticals, then highs, then total.)

| Context group | C | H | M | L | bug | biz | Total |
|---|---:|---:|---:|---:|---:|---:|---:|
| Identity & GitHub Connectivity | 1 | 3 | 11 | 0 | 11 | 4 | 15 |
| Org Dashboard & Analytics | 0 | 6 | 16 | 8 | 18 | 12 | 30 |
| Org Planning & Execution | 0 | 6 | 16 | 8 | 16 | 14 | 30 |
| Repository Scanning & Scoring | 0 | 6 | 11 | 3 | 12 | 8 | 20 |
| Onboarding, Shell & AI Standard | 0 | 5 | 16 | 8 | 17 | 12 | 29 |
| Reporting & Visualization | 0 | 5 | 17 | 3 | 13 | 12 | 25 |
| Billing, Credits & Metering | 0 | 5 | 12 | 3 | 12 | 8 | 20 |
| Data & Persistence | 0 | 4 | 8 | 3 | 9 | 6 | 15 |
| Org Scanning & Fleet Rollups | 0 | 3 | 14 | 4 | 13 | 8 | 21 |
| Marketing Site & Design System | 0 | 3 | 9 | 3 | 9 | 6 | 15 |

Full per-finding detail: `docs/harness/biz-bug-scan-2026-06-29/<group-slug>.md`.

---

## 🐛 Bug track — the 1 Critical + 9 High (fix priorities)

### CRITICAL
1. **Cross-tenant IDOR — `/api/app/repos`** — the auth guard keys off the *dormant* custom-OAuth
   session + `isAuthConfigured()`, which is inert under the prod Supabase-only config, so
   `requireViewer()` is never called: any caller can list an installation's **private** repos via
   `?org=`. `src/app/api/app/repos/route.ts:38` *(identity)*

### HIGH — security
2. **CI RCE via `doctor.mjs --run`** — `execSync`s capability commands read verbatim from
   `.ai/manifest.yaml`; wired into CI on fork PRs (as the product recommends), a malicious PR gets
   arbitrary code execution with CI secrets (incl. the conformance token it then exfiltrates).
   `src/lib/standard/doctor.ts:80-86` *(onboarding)*
3. **`/api/gate` mock path is unauthenticated AND unthrottled** — the default `mock` gate runs full
   GitHub ingestion with no auth/rate-limit, and `?ref=<unique>` bypasses cache → anyone can drain
   the shared `GITHUB_TOKEN` quota + serverless compute (DoS / cost amplification).
   `src/app/api/gate/[owner]/[repo]/route.ts:36-45` *(repository-scanning)*
4. **Open-relay scan-completion email** — `/api/scan/stream` trusts a client-supplied recipient with
   no ownership/consent check → Ascent's verified SES domain sends branded mail to arbitrary
   addresses. `src/app/api/scan/stream/route.ts:81-83` *(repository-scanning)*
5. **Residual server-side SSRF on white-label logo URL** — DNS-rebinding via @react-pdf image fetch.
   `src/lib/db/branding.ts:34-36` *(org-dashboard)*

### HIGH — billing / quota integrity
6. **Partial/split refunds keep credits** — clawback idempotency is keyed on the order id, so only
   the first partial-refund event reverses; refunding in 2+ chunks keeps most granted credits + the
   scans they bought. `src/app/api/billing/webhook/route.ts:74-99` *(billing)*
7. **`clientIp` "unknown" fallback collapses the anonymous weekly quota** — one shared bucket key
   locks out the whole anonymous funnel (or lets it be exhausted). `src/lib/rate-limit.ts:17-26` +
   `src/lib/public-scan-quota.ts:94` *(billing)*
8. **Push rescan = unthrottled, LLM-billed full scan on every default-branch push** — no debounce/
   rate-limit; a busy repo or push storm runs unbounded paid scans. `src/app/api/app/webhook/route.ts:319→477` *(identity)*

### HIGH — reliability / data integrity
9. **Audit CSV export silently truncates at 10,000 rows** (newest-first → drops the *oldest*
   compliance evidence) and the `x-ascent-content-sha256` header then signs the incomplete file →
   false integrity confidence. `src/app/api/audit/route.ts:20,30-51` *(org-dashboard)*
10. **Read paths use raw `getPrisma()`/`dbReadSafe`, not `withDb`** — on Aurora DSQL a thawed
    instance past the ~15-min IAM-token TTL 500s on its first read; only the persist path is
    protected. `src/lib/db/scans-read.ts` (many) vs `scans-persist.ts:70` *(data)*

---

## 🐛 Bug track — Medium + Low tail (120 findings, by category)

| Category | Count | Representative examples |
|---|---:|---|
| edge-case | 29 | LevelBadge crash on drifted level; born-done recs miscount; completion% deflated by dismissed |
| silent-failure | 25 | PDF transient error → "never scanned"; catch-all `() => null`; reconciliation mis-buckets clawbacks |
| race-condition | 12 | DimensionTrends stale-repo paint; 409 retry loop; org-upsert race in import; war-room credit drain |
| latent-failure | 11 | digest cron serial loop + no fetch timeout stalls all later orgs; mock-gate funnel |
| input-validation | 10 | unbounded self-attested conformance score; `recordBadgeImpression` unbounded write on `Referer` |
| state-corruption | 6 | NaN score renders "NaN" while geometry clamps to 0; drifted level casts |
| performance | 6 | permalink 5 sequential awaits; uncached `/api/auth/viewer` per mount |
| accessibility | 3 | chart deep-links pointer-only; ScoreRing ignores prefers-reduced-motion |
| other | 18 | data-loss/exposure, recovery-gap, ux-degradation, stale-data, success-theater… |

**Cross-cutting bug theme — inconsistent slug canonicalization** (flagged by 3 groups): only
`getOrgId`/auth gates lowercase the slug; the org-* rollup family, the scan route, `usage.ts:92`,
and the dashboard `sourceLabel` query by raw slug → a mixed-case org passes auth but reads
empty/zeroed data. Single highest-leverage consistency fix.

---

## 🚀 Business track — the 37 High opportunities (backlog, grouped by theme)

**A. Monetization / packaging (needs pricing decisions) — ~14**
- No self-serve subscription/upgrade path; `/pricing` shows "Prepaid" (no price) for Pro/Team; no
  auto-recharge/low-balance top-up *(billing)*
- PDF/CSV exports gated by org-read, not plan tier — premium feature leaks free *(reporting)*
- Gate the planning suite / what-if simulator / glass-box attribution as a premium tier *(planning, repo-scan)*
- Configurable data retention as an enterprise lever; package roadmap+audit timeline as "governance" tier *(data, reporting)*
- GitHub Enterprise Server support (built) + BYOM/multi-provider (built) → Enterprise wedge *(identity, repo-scan)*
- White-label → full agency/reseller mode; brand kit as branded reports *(org-dashboard, marketing)*

**B. Growth / virality (badges, leaderboards, SEO) — ~9**
- Ship an embeddable README maturity badge (`/badge.svg`); downloadable share card; Remotion recap clip *(reporting)*
- Promote the public AI-native leaderboard to a standalone SEO destination; add it to `sitemap.ts`
  (it's missing — page exists but uncrawlable); public cross-org "AI-Native Maturity Index" *(marketing, onboarding, org-scan, planning)*
- PR-gate Check Run + sticky comment as a growth/monetization surface *(identity)*

**C. Retention / re-engagement (SES is already wired) — ~8**
- Scheduled exec email digest (referenced in code, unbuilt); recommendation-completion "+N pts" email;
  trend/score-move "Watch this repo" alerts; goal-pace digests; auto-email org invites *(planning, reporting, org-scan)*
- Email + MS Teams alert channels (today Slack-only) *(org-scan)*

**D. Differentiation / product depth — ~6**
- Activate the dormant supply-chain/SBOM scanner as a premium Security module *(org-dashboard)*
- Machine-readable LLM endpoint (`/llm.txt`) + "Open in Claude"; two-way GitHub Issues/Jira sync;
  cross-org playbook marketplace; bus-factor "Org Resilience" module; remediation-as-PR ROI loop *(reporting, planning, org-dashboard)*

(Plus 52 Medium + 1 Low business findings in the per-group reports — smaller polish/feature ideas.)

---

## Suggested fix-wave plan (bug track)

Each wave = one mental model, 5–7 fixes, atomic commits, tsc+vitest verified before the next.

| Wave | Theme | Findings | Risk |
|---|---|---|---|
| **1** | Security & access-control | IDOR, gate-DoS, CI-RCE, open-relay email, logo SSRF | review-sensitive |
| **2** | Billing / quota integrity | refund clawback, clientIp quota, push-rescan throttle, usage slug, reconciliation | sensitive (billing) |
| **3** | Slug canonicalization (cross-cutting) | org-* rollups + scan route + sourceLabel raw-slug reads | low |
| **4** | DB resilience (DSQL token-TTL) | read paths → `withDb`; `dbReadSafe` only catches unreachable | low-med |
| **5** | Silent failures & report data-integrity | audit CSV truncation, exec "100% confidence", PDF transient→404, LevelBadge crash, recs miscount | low |
| **6** | Race conditions & stale data | DimensionTrends abort, ReportView re-test, 409 retry, war-room credit drain, goal-delete | low |
| **7+** | Edge-case / input-validation tail | conformance score bound, badge-impression write, NaN render, a11y, perf | low |

**Business track** is handled separately — pick the items worth building (most need a pricing/product
call); a few are safe one-liners (e.g. add leaderboard to `sitemap.ts`).

---

## How this scan was run

- **Scanners:** `business_visionary` + `bug_hunter` (combined, dual-lens), from
  `vibeman/src/lib/prompts/registry/agents/{business-visionary,bug-hunter}.ts`.
- **Dispatch:** 10 `general-purpose` subagents, one per context group, read-only over live current
  files under `C:/Users/kazda/kiro/ascent` (the WIP snapshot), ~5 findings/context, 2 waves of ≤8.
- **Coverage:** all 44 contexts (460 filePaths, 7 stale skipped) + the 20 new WIP source files
  (email subsystem, leaderboard, auth viewer, report additions) folded into the nearest group.
- **Context rescan:** the `regenerate-group` API 404s on the running server, so freshness was
  achieved by scanning live files directly rather than regenerating stored descriptions.
- **Baseline:** tsc **0 errors**; vitest **2635 pass / 1 pre-existing env-fail** (`db/client.test.ts`
  dsql-signer — AWS creds, unrelated).
- **Verification:** finding counts confirmed two ways (header sum = bullet count = 220).
