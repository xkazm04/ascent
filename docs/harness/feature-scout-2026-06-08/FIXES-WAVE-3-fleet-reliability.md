# Feature Scout Fix Wave 3 — Fleet reliability (incl. the 1 Critical)

> 5 findings closed in 5 atomic commits. Theme: the bulk-scan + cron loop that breaks at enterprise scale.
> Baseline preserved: tsc 0 → 0 errors · eslint clean on changed files · `next build` green · `prisma generate` clean.

## Why this wave

The scan's single **Critical** (ORGS-1) and the cluster of fleet-scale reliability gaps all live in the
same loop: list-due → scan → persist → advance. This wave makes that loop fair, concurrent, resilient,
scoped, and observable.

## Commits

| # | Commit | Finding | Severity | What |
|---|--------|---------|----------|------|
| 1 | `1651b9b` | LLM-2 | High | retry + provider failover before the mock degrade |
| 2 | `93905f0` | ORGS-2 | High | bounded-concurrency bulk scans (mapPool) |
| 3 | `574c6cd` | ORGS-1 | **Critical** | cron fairness + always-advance-on-failure + concurrency |
| 4 | `49efcce` | ORGD-3 | Medium | scoped scans (stale-only / explicit repo set) |
| 5 | `72ccbe1` | ORGS-3 | High | persist + surface per-repo scan failures |

## What was fixed

1. **LLM-2** — A single transient blip (rate limit / timeout / one-off unusable reply) used to drop a
   paid scan straight to the deterministic floor. Now the LLM call follows an ordered plan: primary →
   one bounded retry (500ms) → a configured `LLM_FALLBACK_PROVIDER` (e.g. bedrock → gemini) → only then
   mock. The provider that actually scored becomes the report's engine; aborts still propagate. Added
   `providerByName()` to the llm factory.
2. **ORGS-2** — `org/scan` + `org/import` ran `for ... await scanRepository(...)` (one repo at a time),
   so a 40-repo run serialized into minutes and risked the 300s ceiling. New `mapPool` helper runs both
   at `SCAN_CONCURRENCY` (4) lanes; each lane emits its own per-repo SSE events as it resolves.
3. **ORGS-1 (Critical)** — `listDueRescans(50)` ordered globally by `nextScanAt` and the cron scanned
   sequentially, advancing only on success: the most-overdue org monopolized every run (back of the
   fleet starved), real scans blew the budget before the cap, and a broken repo stayed permanently due
   at the front, re-failing every run. Fix: `listDueRescans` now round-robins across orgs over a wider
   candidate set; the cron pre-resolves one token per org and scans with bounded concurrency; and it
   **always** advances `nextScanAt` — full cadence on success, a 6h backoff
   (`advanceScheduleAfterFailure`) on failure — so one broken repo can never block the queue.
4. **ORGD-3** — "Scan all watched" was the only mode, burning token budget on fresh repos. `POST
   /api/org/scan` now accepts `repos:[...]` (explicit set) and `staleOnlyDays:N` (skip repos scanned
   within N days; never-scanned always included), via `listWatchedRepos` now selecting `lastScanAt`. A
   "Stale only" (>14d) button sits beside "Scan all watched".
5. **ORGS-3** — Scan failures were only `console.warn`'d, so "broken for weeks" looked identical to
   "never scanned". Added `lastScanStatus` / `lastScanError` / `lastScanAttemptAt` to `Repository`
   (schema.prisma + init.sql), a `recordScanOutcome` helper the three scan paths call on success
   (clears the error) and failure, exposure on `OrgRepoRow`/`getOrgRollup`, and a "⚠ scan failed"
   affordance (hover = the error) on the repositories leaderboard.

## Verification (before → after)

| Gate | Result |
|------|--------|
| `tsc --noEmit` | 0 → 0 errors |
| `eslint` (10 changed files) | 0 errors, 0 warnings |
| `prisma generate` | clean (client types updated for the 3 new Repository columns) |
| `next build` | ✅ all routes compiled |
| unit tests | none (Playwright e2e only); not run |
| DB migration | **NOT run** — no live DB here. Columns are additive + nullable; deploy applies them via `prisma migrate deploy` / `db push`. |

## Patterns established (catalogue additions, items 5–8)

5. **Bounded-concurrency fan-out (`mapPool`)** — replace `for ... await` over a fleet with a small
   worker pool (4 lanes); wall-clock becomes ~ceil(n/lanes)×slowest, not the sum, while capping
   GitHub/LLM pressure. Counters mutated in lanes are race-free (single-threaded JS between awaits).
6. **Always advance a queue cursor, even on failure** — a "process oldest-first, advance only on
   success" queue lets one permanently-broken item block everything. Advance with a backoff on failure
   so it leaves the front and retries later.
7. **Fair round-robin over a grouped queue** — when a global oldest-first order lets one tenant
   monopolize a capped batch, group by tenant and round-robin to spread work fleet-wide.
8. **Ordered resilience plan over single-shot** — model "primary → retry → failover → degrade" as an
   explicit ordered list of attempts (first success wins), not nested try/catch; the actor that
   succeeded becomes the recorded source.

## What remains

Waves 1 (usage→billing), 4 (GitHub App sync), 5 (scoring depth), 6 (scan reach), 7 (export/alerts/
compliance) per the INDEX, plus mediums/lows. Wave-3 leftovers explicitly deferred: a per-row "Rescan"
control on the leaderboard (the `repos:[fullName]` API path is ready), and wiring `recordScanOutcome`
into the public-funnel (unwatched) import path.

## ⚠ Concurrency note (continued)

The parallel UI-Perfectionist Pipeline-B run kept committing to the same branch throughout this wave
(its own wave-3 of 7 findings: report/onboarding/scan-hero fixes). My 5 commits and its commits remain
interleaved on `vibeman/feature-scout-wave2`; the combined state passes tsc + lint + next build. No
history surgery (the other agent is still active). `prisma generate` regenerates the shared client in
`node_modules` — done once here; if the other agent runs a build at that instant it could see a
transient blip, but none was observed.
