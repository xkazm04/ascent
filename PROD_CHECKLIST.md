# Production Checklist: milestone of record

| | |
|---|---|
| **Milestone** | First market release |
| **Target date** | TBD (operator to set) |
| **Owner** | Michal Kazdan (michal.kazdan@nuda.dev) |
| **Last groomed** | 2026-08-04 (/mvp launch run) |

Groomed from the deferred-follow-ups parking lot into the launch milestone. Every item below is
marked one of: **done** (with evidence), **closing-this-run** (a 2026-08-04 launch decision or
in-flight change closes it), **cut** (with reason), or **open** (the true remainder).

**Tally: 12 done · 4 closing this run · 1 cut · 8 open** (6 carried, after folding §1/§2
duplicates into §7 · 2 new operator follow-ups).

## Launch decisions (2026-08-04) that resolve items below

- **Positioning.** Launch on what's shipped: guardbanded evidence-backed briefing + deterministic
  CI gate + org fleet intelligence. GOLDEN-TRIO T1/T2 = roadmap (see `docs/GOLDEN-TRIO.md`).
- **Monetization.** Current Polar tiers + drift guard; no repricing before launch.
- **i18n.** English-only v1. **Auth.** GitHub OAuth only, no passwords (deliberate).
- **Onboarding.** The sign-in-gated funnel is intentional B2B gating, not a defect.
- **Observability.** Sentry + LightTrack wired this run. **Smoke.** `@smoke` Playwright tag +
  post-deploy workflow. **Branch protection** on `master` lands at end of run.
- **Feedback.** Footer channel. **Legal.** `/privacy` + `/terms` added this run.
- **Analytics.** First-party (operator `/api/kpi` route + `landing_view` counter).

---

## 1. LLM engine & scan latency

- [x] **DONE: Production LLM provider set.** `LLM_PROVIDER`, `GEMINI_API_KEY`,
  `LLM_FALLBACK_PROVIDER` + AWS (Bedrock) creds/region are all present in the prod env files
  (`.env.production` / `.env.vercel`, var names verified 2026-08-04; values not inspected).
- [ ] **OPEN: Confirm Flash scans fit the request budget in prod.** Folded into §7 (post-deploy
  verification pass): verify wall time < ~250s on the slowest repos; `maxDuration` is 300
  (`src/app/api/scan/route.ts`, `stream/route.ts`). If it doesn't hold → revisit the cut §5.
- [x] **DONE: Budget env vars checked.** The total-budget default is provider-aware (90s hosted /
  15 min claude-cli); prod runs hosted Gemini with no override set, which is the intended
  configuration. `SCAN_CLIENT_TIMEOUT_MS` stays at the generous client backstop.

## 2. Auth gate (public-scan sign-in wall)

- [x] **DONE: Gate enforced in code.** Both scan routes return `401 auth_required` when
  `authGateEnabled()`; cache hits / permalinks / badge stay free; client shows `SignInNotice`.
- [x] **DONE: Auth model decided + configured.** GitHub OAuth only, no passwords (a deliberate
  2026-08-04 decision, not a gap). `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are
  present in both prod env files. The live OAuth round-trip is verification, tracked in §7.
- [ ] **OPEN: End-to-end sign-in test in the deployed environment.** → §7. Partially automated
  by the new post-deploy `@smoke` Playwright workflow (this run).
- [x] **DONE: `ASCENT_AUTH_BYPASS` absent from prod.** Not present in `.env.production` or
  `.env.vercel` (var-name scan 2026-08-04); additionally hard-disabled when `NODE_ENV=production`.

## 3. Email notifications (AWS SES)

- [x] **DONE: Pluggable `EmailSender`** (`src/lib/email/*`): SES impl + no-op fallback +
  never-throws dispatcher, wired into scan completion. Unconfigured = logs only, never blocks.
- [ ] **OPEN (operator): Provision SES.** Verify a sending identity, set `SES_FROM_EMAIL`
  (not yet in the prod env files), move out of the SES sandbox. Until then the no-op sender logs.
- [→] **CLOSING THIS RUN: `ASCENT_PUBLIC_URL` set.** Reconciled to the canonical prod host
  `https://ascent-red.vercel.app` in both gitignored env files (2026-08-04); email report links
  are absolute.

## 4. Deferred code follow-ups (from the gated-scan feature)

- [ ] **OPEN (optional): Scan idempotency fields.** `Scan.requestedByEmail` + `notifiedAt` still
  absent from `prisma/schema.prisma` (verified 2026-08-04). Remains optional: recipient is
  request-derived and cache hits never re-email, so there is no correctness gap today.
- [x] **DONE: Gate-aware landing copy.** `gated = authGateEnabled()` is threaded from
  `src/app/page.tsx:74` → `IndexLanding` → `IndexHero` → `ScanModal`. _(Stale references
  corrected: `buildPricing()` and `landing/prototypes/shared/content.ts` no longer exist; the
  landing was rebuilt as the Index scroll-snap deck, which has no pricing section.)_
- [x] **DONE: `context-map.json` refreshed.** Full regeneration 64a1212 (ship-loop M12), re-synced
  since (4853b1a8, 2efc6c32).

## 5. Async scan processing (backup architecture)

- **CUT: not adopting for launch.** Its own adoption trigger (Flash trending past ~250s) has not
  fired; synchronous Flash + persist/peek covers refresh. The design stays on the shelf at
  `docs/features/scanning/async-scan-aws.md` and reactivates only if §1's timing check fails.

## 6. Data & infra

- [→] **CLOSING THIS RUN: Migrations deploy on release.** `vercel.json` now sets
  `"buildCommand": "npm run db:deploy && npm run build"` (`db:deploy` = `prisma migrate deploy`),
  so every Vercel deploy applies committed migrations before building.
- [x] **DONE: `CRON_SECRET` set.** Present in both prod env files (var-name scan 2026-08-04);
  the cron routes fail closed without it.
- [x] **DONE: Public-scan quotas reviewed.** Launching on current defaults (signed-in weekly
  limit, prepaid credits on private paths) per the 2026-08-04 monetization decision (current
  Polar tiers + drift guard, no pre-launch tuning).

## 7. Verification owed (post-deploy pass on the real environment)

The true remainder: all four need the deployed app, not the repo. The new post-deploy `@smoke`
workflow (this run) automates the first two shapes; the rest is a one-time manual pass.

- [ ] **OPEN: Real GitHub OAuth round-trip.** Signed-out scan → sign in → return → scan runs.
- [ ] **OPEN: Real SES delivery** (blocked on §3 SES provisioning).
- [ ] **OPEN: 7-day recent-scan reuse in prod** (`x-ascent-cache: hit-db`, no new LLM call).
- [ ] **OPEN: Gemini Flash end-to-end timing** under real prod config (closes §1's timing item).

## 8. General hardening

- [→] **CLOSING THIS RUN: Observability.** Sentry (error rate) + LightTrack being wired now per
  the 2026-08-04 decision. Operator follow-up: set the Sentry DSN + `LIGHTTRACK_*` env in Vercel.
- [x] **DONE: Rate-limit / abuse review.** Per-IP + global rate limiting on the scan/import
  funnels (`src/lib/rate-limit.ts`), signed-in weekly cap, and a prepaid-credit entitlement gate
  on every private-scan path (`src/lib/scan-credit.ts`); see CHANGELOG "Security".
- [x] **DONE: Accessibility + responsive pass on notify/gated UI.** `NotifyToggle.dom.test.tsx`
  covers the notify control; f4fce312 ("accessibility the tests can prove") swept empty/gated
  states; earlier ship-loop M8 added the aria labeling.
- [→] **CLOSING THIS RUN: Legal + feedback + analytics + smoke + branch protection** (were never
  itemized here): `/privacy` + `/terms` pages, footer feedback channel, first-party analytics
  (`/api/kpi` + `landing_view`), `@smoke` post-deploy workflow, `master` branch protection at end
  of run.

## 9. New operator follow-ups (from 2026-08-04 grooming)

- [ ] **OPEN (operator): Vercel env:** Sentry DSN, `LIGHTTRACK_*`, `ASCENT_CONTACT_EMAIL`,
  `ASCENT_OPS_SECRET`. Plus pick the milestone target date above.
- [ ] **OPEN (operator): Search Console:** submit the sitemap for the canonical host.
