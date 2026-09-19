# Ascent — Production-Readiness Plan

_Prepared 2026-06-08 from a full codebase scan (functional gaps · UI compatibility · code quality · monetization gating & auth · docs/licensing). Severities: **P0** = blocks production / leaks money or data / legal · **P1** = important for/just after launch · **P2** = polish._

## Verdict

Ascent is an unusually **finished** codebase — the core scan → score → report → org-dashboard → gate → badge flows are fully implemented with real SSE streaming, a production-grade Aurora-DSQL IAM-token/OCC-retry DB layer, strong empty/loading/error component coverage, disciplined `unknown`-narrowing at LLM/SSE boundaries, and **0 `tsc` errors / 0 eslint errors / 0 `any`/`@ts-ignore`/empty-catch**. It is far closer to deployable than a typical audit target.

What blocks production is **narrow but severe**, and clusters in four areas: (1) **cross-tenant IDORs** on scan + org APIs, (2) **no cost controls** on the anonymous LLM funnel, (3) **legal/billing** (no LICENSE, no working payments), and (4) **deploy-safety** (no committed migrations, an illusory test gate). None require a rewrite; all are file-scoped.

| Dimension | Readiness | Top blocker |
|---|---|---|
| Functional gaps | 🟠 Good, gaps narrow | No committed Prisma migrations; advertised PDF export unbuilt |
| UI compatibility | 🟢 Strong | Missing error/404/OG routes; tablist keyboard a11y; sub-AA contrast |
| Code quality & tests | 🟠 Clean code, weak gate | `vitest` undeclared (test gate illusory); authz/billing/webhook untested |
| Monetization & auth | 🔴 Blocking | Cross-tenant IDORs; unbounded LLM cost; billing is vaporware |
| Docs & licensing | 🟠 Strong docs, no license | **No LICENSE** (all-rights-reserved); `.env.example` omits ~13 vars |

---

## P0 — Release-gating blockers

### Legal
- **No LICENSE file**, no `package.json.license`, `"private": true`. Default copyright = all-rights-reserved; nobody may use/self-host/embed the Action legally. → Pick a license (for a commercial SaaS that also ships a GitHub Action + badge: a **source-available** BSL 1.1 / Elastic-2.0 / PolyForm for the platform, plus a permissive license scoped to `action.yml` + `scripts/maturity-gate.mjs`). Add `LICENSE`, set `package.json.license`, add a README badge.

### Security — cross-tenant IDORs (multi-tenant data/credential exposure)
- **`/api/scan` & `/api/scan/stream` mint a GitHub-App installation token from a caller-supplied `installationId` (or auto-resolve the owner's) with no ownership check** — `scan/route.ts:37` → `scan.ts:75` (`installationId ?? getInstallationIdForOwner(owner)`, no `sessionHasInstallation`). Anonymous caller can read any tenant's **private** repo. Fix: gate with `sessionHasInstallation` (mirror `/api/org/import:71-75`).
- **Org mutation routes gate on "signed-in" but not "owns org"** — `/api/org/goals`, `/segments`, `/initiatives` (+ `[id]` variants) take `org` from the body and write directly; any free signed-in user tampers any org. Fix: add `requireOrgAccess(body.org)` (pattern already in `/api/org/watch|scan|schedule`).
- **Org read routes with missing/weak auth** — `/api/org/backlog` & `/api/org/simulate` (**no auth at all** — verified), `/api/audit`, `/api/org/goals|initiatives` GET (signed-in but no ownership). Leak assignee logins, due dates, gaps, full audit trail. Fix: gate every org-scoped read with `canReadOrg(org)` (gold standard: `/api/usage/route.ts:52-73`).

### Cost control — unbounded anonymous LLM spend
- **No rate limit / concurrency cap / daily cap on `/api/scan`, `/api/scan/stream`, `/api/org/import`** (the only limiter in the repo is on `/api/badge`). Per-scan prompt is budgeted (32 files/180KB — good), but request *volume* isn't: one IP can fan out hundreds of concurrent fresh scans (cache-bust via `?fresh=1`) of distinct repos, each a real Gemini/Bedrock completion; `/api/org/import` amplifies 100 repos/call and accepts `mock:false`. **A single user can run the operator's inference bill arbitrarily high.** Fix: per-IP + global rate limit + concurrency cap on all three; force `mock` (or require a session) for anonymous `mock:false`.

### Deploy-safety
- **No committed Prisma migrations** — only `prisma/init.sql` + `db push`; docs that promise `prisma migrate deploy` are no-ops. A live Aurora-DSQL prod DB has no safe versioned migration path. Fix: baseline `prisma migrate`, commit `prisma/migrations/**`, switch deploy/CI to `migrate deploy`.
- **`vitest` is undeclared and unlocked** (missing from deps/devDeps/`package-lock.json`/`node_modules/.bin` — verified), yet CI runs `npx vitest run` → an unpinned floating runner, so the 26-file unit gate is illusory. Fix: add pinned `vitest` + `"test": "vitest run"`, regenerate lockfile.

### Monetization (only if launching the paid tier at GA — see Wave 2)
- **Billing is vaporware**: no Stripe/payment code, `Subscription` model never written/read, `Organization.plan` never enforced, **no paywall/quota before a metered private scan**. Metering counts scans but collects nothing. "PDF export" is sold (`page.tsx:259`) but unimplemented. Fix: see Wave 2.

---

## Phased rollout

**Wave 0 — Unblock a (free) public launch.** Legal + the IDORs + rate limiting + migrations + test gate. Nothing public ships until these are done.
**Wave 1 — Reliability & launch UX.** Error/404 boundaries, observability, OG/SEO, Vercel-plan/maxDuration, a11y (keyboard + contrast), `.env.example` completeness, CONTRIBUTING/SECURITY, doc-drift fixes.
**Wave 2 — Monetization (to actually charge).** Stripe + entitlement/quota gate before metered scans, `Subscription` wiring, spend caps, PDF export (build or drop), RBAC if SSO/seats are sold.
**Wave 3 — Quality & polish.** Tests for critical paths, `noUncheckedIndexedAccess`, God-module split, mobile/typography polish, per-page metadata, CHANGELOG/templates, dep upgrades, remove stray artifacts.

---

## Detailed activities by dimension

### 1. Functional gaps & deployment readiness
- **P0** Commit Prisma migrations; deploy via `migrate deploy` (see above).
- **P0/P1** Close org-API auth gaps (see Security IDORs).
- **P1** Add `global-error.tsx`, root `not-found.tsx`, and `org/[slug]/error.tsx` + `report/[owner]/[repo]/error.tsx` (today a server throw shows Next's raw screen).
- **P1** PDF export: build (print stylesheet + `window.print`, or server render) or remove the paid claim.
- **P1** `maxDuration` 120–300s on scan/cron/webhook exceeds Vercel Hobby's 60s cap — require/verify Vercel Pro and document it, or chunk cron fan-out.
- **P1** Wire/verify the scheduler: `vercel.json` crons exist and fail-closed on `CRON_SECRET` (good) but a deploy missing the secret silently never autoscans — surface cron-readiness in `/api/health` (currently DB-only).
- **P2** Document `OPENAI_*` (a fully-wired but hidden provider), `LLM_FALLBACK_PROVIDER`, `LLM_TIMEOUT_MS`, `RETENTION_*`, `LLM_*_COST_PER_MTOK`, `NEXT_PUBLIC_APP_URL` in `.env.example`.
- **P2** CI builds but never deploys and runs no e2e; add a deploy workflow (+ `migrate deploy`) and an e2e job (at least the auth-off seeded-org config). Add a `Dockerfile` if self-hosting is a real path.
- **P2** Homepage demo CTA hardcodes `/org/vercel` — ensure that org is seeded in prod (or gate the CTA on existence) so the primary demo link doesn't dead-end.

### 2. UI compatibility & UX quality
- **P1** Report tab switcher is `role="tablist"` with no arrow-key handling and no `aria-controls`/`id` tab↔panel wiring (`ReportView.tsx:408-445`) — add roving tabindex + aria, or drop the `tab` roles.
- **P1** Sub-AA contrast: `slate-600` (#475569) on the near-black canvas ≈ 3:1 (needs 4.5:1); ~24 info-bearing usages in `ReportView` alone — lift secondary text to `slate-400`.
- **P1** Report permalink fallback is a bare "Loading…" (`report/[owner]/[repo]/page.tsx:70`) — use `<ReportSkeleton/>` like `report/page.tsx`.
- **P1** Missing `opengraph-image.tsx` (a code comment *claims* one exists), `robots.ts`, `sitemap.ts`; `twitter:summary_large_image` set with no image → shares unfurl broken. Add them.
- **P2** Signed-in header has no mobile collapse (`Brand.tsx:42-86`) — add a disclosure/`flex-wrap` + truncate username.
- **P2** Typography-uplift wrap risks (now `text-sm`/`text-base`): `PrMetric` 6-up grid labels, report header pill row, score-waterfall fixed-width cells, contributor rows, `AxisBar`/`Tile` mono captions — shorten labels or keep `text-xs` for the densest mono captions; raise chart `fontSize` (8–11 → ≥12 in viewBox units) so quadrant/radar/trend labels stay legible on phones.
- **P2** Tailwind `animate-pulse`/`animate-spin` skeletons ignore `prefers-reduced-motion` (`ReportSkeleton.tsx`, `trends/loading.tsx`, `DimensionTrends.tsx`) — add `motion-safe:` or a reduced-motion CSS override.
- **P2** Add per-page `metadata`/`generateMetadata` (only 4/22 routes have it); add `themeColor` + icon set.
- **P2** Promote the report repo title to `<h1>` (currently no `<h1>` on report pages); route `compare`'s bespoke `Notice` through `EmptyState`; fix "Analyzing 7 dimensions" loading label (model has 9).

### 3. Code quality & testing
- **P0** Fix the `vitest` dependency/lockfile (see above).
- **P0** Add `authz.test.ts` — the tenant-isolation gate (auth on/off × PUBLIC_ORG × member/non-member × `ASCENT_OPEN_ORG_DASHBOARDS`) has **zero** tests despite being the IDOR-defining file.
- **P1** No observability: 0 Sentry/structured logging; 59 `console.*` calls are the only signal. Add an error sink + structured logs, and alert on the two silent-degrade paths — LLM→mock fallback (`scan.ts:245`) and `recordAudit` loss (`scans.ts:56`).
- **P1** Adopt `zod` (not currently a dep) for request/SSE/webhook payload validation — today 18 routes hand-cast `as {…}` with inconsistent field checks.
- **P1** Add tests for `usage.ts`/`plan.ts` (billing aggregation, incl. the fallback path) and `github/app.ts` `verifyWebhook` (valid/invalid/missing/replay).
- **P1** Type-check test files (currently `exclude`d) via `tsconfig.test.json`; enable `noUncheckedIndexedAccess` (off today despite heavy index access in LLM/SSE parsing).
- **P2** Split God-modules: `db/org.ts` (1,976 LOC, 29 exports), `db/scans.ts` (1,455), `ReportView.tsx` (1,264). Extract `mapPrismaError()` to DRY the repeated P2025/P2002 casts.
- **P2** Add `engines`/`.nvmrc` (Node 20); schedule Prisma 6→7 upgrade; track Next patch for the 2 moderate `postcss` advisories; convert release-gating `scripts/*.mjs` to typed `.mts`.

**Test coverage map (critical path → tested?):** scan/scoring/db-client/org-aggregate/auth-session/LLM-json/forecast = **Y**; **authz, usage/plan billing, github-app+webhook, sessions, gate/recommendations, LLM backends, SSE, 37/39 API routes, all components/pages = N.**

### 4. Monetization gating & auth/security
- **P0** Close the IDORs (Security section above) — corroborated by two independent audits.
- **P0** Rate-limit the LLM funnel (Cost-control section above).
- **P0 (to charge)** Integrate Stripe; map `Organization`/`Subscription` → customer/price; populate `Subscription.status`/`stripeId` (always inactive/null today); add a **pre-scan entitlement/quota gate** that reads subscription state; set `LLM_*_COST_PER_MTOK` + a per-org spend cap; build-or-remove "PDF export".
- **P1** SSO/SAML + RBAC are sold on the landing page but unimplemented (auth is GitHub-OAuth only; `Membership.role` is never read for any decision) — don't sell contractually until built; either wire `Membership` into `authz` or drop the unused models.
- **P2** Add `isSameOrigin` (CSRF defense-in-depth) to org-mutation routes when adding `requireOrgAccess`; rate-limit `/api/org/repos` (spends GitHub quota for any caller).
- **Verified-safe (keep):** session crypto + `SessionRevocation`, CSRF on logout, fail-closed cron, scoped non-logged installation tokens, per-scan ingestion budgets, audit logs (real & populated), Bedrock private inference, retention overrides, and the `ASCENT_OPEN_ORG_DASHBOARDS` flag (default-off, ignored when auth is configured). **Note:** rotate the GitHub PAT now sitting in the working-tree `.env` (gitignored, not leaked, but surfaced).

### 5. Documentation & licensing
- **P0** Add LICENSE (see Legal) + README license badge/section.
- **P1** `.env.example` omits ~13 live vars (an entire shipped **OpenAI** provider: `OPENAI_API_KEY/MODEL/BASE_URL`, plus `LLM_FALLBACK_PROVIDER`, `LLM_TIMEOUT_MS`, `LLM_*_COST_PER_MTOK`, `RETENTION_*`, `GOOGLE_API_KEY`, `NEXT_PUBLIC_APP_URL`) — add them; also add the `openai` row to `docs/features/llm-providers.md` and fix its `ProviderName` comment.
- **P1** Add `CONTRIBUTING.md` (setup, `lint`/`tsc`/`vitest`/e2e gates, PR bar) and `SECURITY.md` (vuln-disclosure — ironic gap for a tool that scores repos on having one).
- **P1** Fix dimension-count drift: `docs/README.md` says "7", `docs/ENTERPRISE.md` says "8", `docs/ARCHITECTURE.md` says "D1..D7" — code is **9** (D1–D9).
- **P2** README: add screenshots, a deploy section/"Deploy to Vercel" button, contributor on-ramp (README scores 8.5/10 for operators, ~5/10 for contributors).
- **P2** Add `CHANGELOG.md`, `CODE_OF_CONDUCT.md`, PR/issue templates; move internal `docs/harness/**`, `BACKLOG/PLAN/HACKATHON` under `docs/internal/`; delete the stray ~11 MB `Userskazdakiroverify_ideas.json` at repo root (gitignored, but clutters the tree).

---

## Strengths to preserve (don't regress these)
Production-grade DB layer (DSQL IAM token refresh + OCC full-jitter retry); fully real scan/SSE/scoring pipeline with a deterministic-mock provider as a first-class feature; per-scan ingestion budgets; strong empty/loading/error component system; accessible SVG fallbacks (sr-only tables, progressbar roles, custom-animation reduced-motion gating); session crypto + revocation + CSRF-on-logout + fail-closed cron; rich, file-referenced operator docs (`SETUP.md`, `ARCHITECTURE.md`, `docs/features/*`); 0 `tsc`/eslint errors and 0 `any`/`@ts-ignore`/empty-catch.
