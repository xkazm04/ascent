# Production Checklist

Deferred prod-readiness follow-ups, parked here so core-product work isn't blocked. Revisit before a
real public launch. Each item: **what / why / how**. Checkboxes track status; `[~]` = partially done.

_Last updated: 2026-06-26._

---

## 1. LLM engine & scan latency

- [ ] **Set the production LLM provider.** `LLM_PROVIDER=gemini` + `GEMINI_API_KEY`; `LLM_FALLBACK_PROVIDER=bedrock` (+ Bedrock creds/region). Gemini already defaults to a **Flash** model (`gemini-3-flash-preview`, override via `GEMINI_MODEL`). _Why:_ claude-cli scans run 4.5–11 min and can't fit a Vercel function; Flash is the bet that keeps scans synchronous. See `.env.example` LLM block.
- [ ] **Confirm Flash scans fit the budget.** Re-run `node scripts/scan-timing.mjs` (or `npm run bench -- --live`) against the slowest repos (e.g. `kp`, `personas`) and verify wall time < ~250s. _Why:_ `maxDuration` is now **300** (`src/app/api/scan/route.ts`, `stream/route.ts`); a scan + the in-request email must fit. If it doesn't fit → adopt §5.
- [ ] **Check `LLM_TOTAL_BUDGET_MS` / `LLM_TIMEOUT_MS`** for the chosen provider (defaults: 90s budget). Fine for Flash; raise only if needed. _(Note: `SCAN_CLIENT_TIMEOUT_MS=720_000` in `src/components/report/scanEstimate.ts` is a generous client backstop, calibrated for slow scans — lower it if Flash is consistently fast.)_

## 2. Auth gate (public-scan sign-in wall) — DONE in code, verify in prod

- [x] Public scans gated behind sign-in in production (`authGateEnabled()` → both scan routes return `401 auth_required`; cache hits / permalinks / badge stay free). Client shows `SignInNotice` on 401.
- [ ] **Configure Supabase GitHub OAuth in the dashboard** (provider enable + redirect URLs) — the gate only enforces when `supabaseAuthConfigured()` is true. See the `supabase-auth-gate` note.
- [ ] **End-to-end sign-in test in a deployed (non-bypass) environment.** Local verification used the dev auth-bypass viewer + an isolated server, not a real Supabase OAuth round-trip. Confirm: signed-out scan → sign-in → returns and scans.
- [ ] Ensure `ASCENT_AUTH_BYPASS` is **unset** in prod (it's hard-disabled when `NODE_ENV=production`, but don't rely on that alone).

## 3. Email notifications (AWS SES) — plug in later

- [x] Pluggable `EmailSender` built (`src/lib/email/*`): SES impl + no-op fallback + never-throws dispatcher. Wired into scan completion (in-request, after persist, skipped on cache hit / degraded / low-coverage). Unconfigured = logs only, never blocks a scan.
- [ ] **Provision SES:** verify a sending domain/identity, set `SES_FROM_EMAIL` (+ AWS creds/region), and **move out of the SES sandbox**. `EMAIL_PROVIDER=auto` then sends for real.
- [ ] Set `ASCENT_PUBLIC_URL` (or `NEXT_PUBLIC_APP_URL`) so the email's report link is absolute (else it falls back to a relative path).

## 4. Deferred code follow-ups (from the gated-scan feature)

- [ ] **Phase 2 — Scan idempotency fields.** Add `Scan.requestedByEmail` + `notifiedAt` (schema + migration + `prisma/init.sql` parity, enforced by `init-sql.test.ts`) to guard against double-emailing across instances. _Optional:_ recipient is request-derived today and cache-hits never re-email, so no correctness gap.
- [ ] **Phase 6 — Gate-aware landing copy.** Thread `gated = authGateEnabled()` from `src/app/page.tsx` into `buildPricing()` (`landing/prototypes/shared/content.ts`) + `IndexHero` so "X free scans a week — no signup" reads correctly once the sign-in gate is on. _Non-functional copy only._
- [ ] **Refresh `context-map.json`** (Vibeman) — stale from this work + the in-progress refactor (new files: `src/lib/email/*`, `components/scan/NotifyToggle.tsx`, `api/auth/viewer/route.ts`, `report/useReportScan.ts`, `report/ReportRescanBanner.tsx`, `report/scanEstimate.ts`).

## 5. Async scan processing (backup architecture)

- [ ] **Adopt only if:** a Flash scan trends past the request budget (~250s), **or** you need a guaranteed "survive tab close" + email even when the browser closes mid-scan. _Why deferred:_ synchronous Flash is simpler and the persist+peek already covers browser **refresh**.
- [ ] Design is documented: **`docs/concepts/async-scan-aws.md`** (Vercel → SQS → Lambda worker → persist → SES; Fargate-Spot fallback for >15-min scans; ~$0 on AWS free tiers). Reuses `scanRepository` / `cacheAndPersistScan` / `src/lib/email` verbatim.

## 6. Data & infra

- [ ] **Deploy DB migrations on release** (`npm run db:deploy`). _(The local `techStackJson` PGlite drift is local-only — prod applies migrations; just confirm the deploy step runs.)_
- [ ] **Set `CRON_SECRET`** so the Vercel cron routes (`/api/cron/rescan|purge|digest`, see `vercel.json`) are protected.
- [ ] **Review public-scan quotas** for prod: with the gate on, the anon per-IP tier is dormant; the signed-in weekly limit meters (`PUBLIC_SCAN_WEEKLY_LIMIT_SIGNED_IN`, default 20). Tune to taste.

## 7. Verification owed (prod-like environment)

This session's verification ran locally only — against the **dev auth-bypass viewer**, the **no-op email
sender**, and an isolated mock server. The following still need a real, deployed (or prod-config) pass:

- [ ] **Real Supabase OAuth round-trip.** Signed-out scan → GitHub sign-in → return → scan runs. (Gate logic verified via bypass + an isolated server returning `401 auth_required`, not a live OAuth flow.)
- [ ] **Real SES delivery.** Opt into notify → an actual email arrives with a working absolute permalink. (Verified only as the `[email] (noop) would send …` log.)
- [ ] **7-day recent-scan reuse.** Scan a repo, scan it again within the window → response header `x-ascent-cache: hit-db`, "Loaded from a saved scan", **no** new LLM call. (Relies on existing cache/persist infra, unchanged this session.)
- [ ] **Gemini Flash end-to-end timing** under real prod config (cross-ref §1) — confirms the synchronous path holds before relying on it.

## 8. General hardening (revisit when core product is ready)

- [ ] Observability for the scan path (error rate, p50/p95 latency, degrade-to-mock rate, email send failures).
- [ ] Rate-limit / abuse review beyond the sign-in gate (per-account scan caps, GitHub API budget under load).
- [ ] Accessibility + responsive pass on the new notify UI (`NotifyToggle`) and the gated empty/sign-in states.
- [ ] (Add items here as they surface.)
