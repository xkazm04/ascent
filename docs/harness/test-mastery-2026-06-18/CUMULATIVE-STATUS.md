# Test Mastery — ascent — Cumulative Status (criticals + highs)

> Scan: `test_mastery` over 38 contexts (2026-06-18) → **192 findings (60C / 76H / 40M / 16L)**.
> Fix run: ALL 60 criticals + 76 Highs + 9 latent bugs + **40/40 Mediums + 16/16 Lows** closed — **192/192 findings, 0 open**, 0 regressions.
> Suite **509 → 2298 (+1789)**, tsc 0. Branch: `vibeman/test-mastery-auth-idor` (off `master`).
> See `FIXES-WAVE-1..8.md` (criticals), `FIXES-HIGHS.md`, `FIXES-LATENT-BUGS.md`, `FIXES-MEDIUMS-LOWS.md`.
> **Theme G done:** a calibrated v8 coverage gate now ratchets `src/lib/db`, `src/components/launch`, `src/components/onboarding` in CI (`npm run test:coverage`, per-dir floors calibrated 2026-06-19). The `@vitest/coverage-v8` lock entry rides with the in-progress dependency WIP commit.

## Headline

| | Start | After criticals | After highs |
|---|---:|---:|---:|
| Critical findings open | 60 | **0** | 0 |
| High findings open | 76 | 76 | **0** |
| Tests passing | 509 | 1155 | **1727 (+1218)** |
| Test files | 57 | 93 | **114** |
| tsc source errors | 0 | 0 | **0** |
| `next build` | compiles | compiles | **compiles** |

- **45 atomic fix commits** + 8 wave-summary docs + 1 scan-docs commit + this file ≈ **62 commits** ahead of `master`.
- **Production source changed only in Wave 5 + one Wave-7 extract** — four behavior-preserving extractions out of `"use client"` components (`mergeStars`, `canRunReal`, `watchState`, `repoKey`); every other wave was purely additive tests.
- **Pre-existing `dev-inspector` working-tree changes were never touched.**

## Per-wave ledger

| Wave | Theme | Commits | Criticals | Suite after |
|---|---|---:|---:|---:|
| 1 | Cross-tenant auth & IDOR | 7 | 11 | 592 |
| 2 | Money: charge / refund / reserve / dedup | 6 | 9 | 664 |
| 3 | Destructive writes & audit atomicity | 6 | 7 | 723 |
| 4 | Score / verdict integrity math | 7 | 8 | 833 |
| 5 | Frontend integrity (extraction + SSE) | 4 | 4 | 866 |
| 6 | Server-side tail (auth/IDOR/secrets) | 7 | 7 | 996 |
| 7 | Orchestration & trust-boundary parse | 7 | 9 | 1111 |
| 8 | The long tail | 5 | 5 | 1155 |
| **Total** | | **49** | **60** | **1155** |

## The latent bugs — NOW ALL FIXED (see FIXES-LATENT-BUGS.md)

> These 8 (a 9th, `/api/history` CSV formula-injection, was surfaced in the High tier) were originally **pinned as KNOWN current behavior**. They have since **all been fixed** in a dedicated 10-commit `fix(...)` pass — each fix flipped its KNOWN test to enforce the corrected behavior. The list below is retained for provenance.


These are real defects the tests **pin as current behavior** (labeled KNOWN) rather than fix — so the suite documents them and a future fix is a deliberate, test-visible change. None were introduced by this run.

1. **gate `minDimension:0` always-pass** (`gate.ts`) — a `0` floor passes any dimension; `policyFromParams` requires `>0` but `sanitizeGatePolicy` doesn't.
2. **briefing strength/risk overlap** (`briefing.ts`) — on a sparse fleet the same dimension is shown as both a top strength and a top risk.
3. **orgsim axisScore absent-dim deflation** (`model.ts`) — absent dimensions charged at 0 full-weight (not renormalized), deflating the axis and flipping posture for partially-scanned repos.
4. **`parseRepoUrl` host-suffix gap** (`source.ts`) — `/github\.com$/` lacks a left boundary, so `notgithub.com` matches.
5. **`/api/health` no-try/catch tripwire** (`health/route.ts`) — relies on `dbHealthCheck` never throwing; a raw rejection would leak.
6. **scan-alerts audit-suppresses-alert** (`scan-alerts.ts:71`) — `recordAudit` isn't `.catch`-wrapped, so an audit failure silently drops a real regression alert.
7. **movers/rollup baseline asymmetry** (`org-insights.ts` vs `org-rollup.ts`) — `<= start` inclusive vs strict `lt: start` can show contradictory fleet movement.
8. **manifest command-quote truncation** (`manifest.ts`/`doctor.ts`) — a command containing a `"` JSON-escapes on write but the doctor regex stops at the first quote (no real command has quotes today).

**DONE:** all fixed in a separate `fix(...)` pass — see `FIXES-LATENT-BUGS.md`. Each was a small, well-scoped fix backed by its now-flipped test.

## 42-item pattern catalogue

Accumulated across the 8 waves (see each `FIXES-WAVE-N.md` for the per-wave additions). The highest-leverage, reusable across any audit:

- **Gate-then-fetch org-threading** (#1) — capture the org arg passed to the data fetch, assert it `===` the gated org.
- **Reject-path "dependency-not-called"** (#2) — a gate that 403s but still ran the read/write is still a leak.
- **fakePrisma where-clause capture** (#3) — assert the org filter is in the query, pinning the tenant boundary.
- **Same-tx atomicity** (#13) — assert every write lands on the `$transaction` `tx`, never the top-level client.
- **Body-smuggle rejection** (#32) — a body-supplied foreign org id must be ignored; the gate keys on the resource's true owner.
- **Forge-and-expiry matrix** (#33) — the full rejection set for an HMAC/signed token.
- **Pin-known-bug-with-control** (#23) — pin the buggy numbers labeled KNOWN plus a control showing the correct path.
- **Round-trip via the shipped parser** (#41) — feed the real serializer output to the actual shipped parser, not a hand-copy.
- **Only-after-event accounting** (#38) / **idempotent state-stamp** (#39) / **scope-narrowing query** (#40) / **blip-vs-genuine-zero** (#42).

## What remains (out of scope for this run)

- **Nothing remains — all 192 findings are closed.** Highs, the 9 latent bugs, 40/40 Mediums, and 16/16 Lows are all done (see `FIXES-HIGHS.md`, `FIXES-LATENT-BUGS.md`, `FIXES-MEDIUMS-LOWS.md`).
- **Theme G (the coverage gate) — DONE.** `@vitest/coverage-v8` + a `test:coverage` script + per-directory calibrated thresholds in `vitest.config.js` (db 60/52/62/64, launch 38/33/26/36, onboarding 15/11/6/16) + a CI "Coverage gate" step. Verified: passes at the floors (2298 green), a breached floor fails CI. The durable backstop is now in place; raise a floor as real coverage climbs.
- **The 9 latent bugs** — DONE (fixed in a 10-commit `fix(...)` pass; see `FIXES-LATENT-BUGS.md`).

## How to resume

Read `INDEX.md` (triage + the original 6→8 wave plan) and this file. The 8 latent bugs and the Highs are the natural next targets. Every fix in this run is one atomic commit with a `Refs:` line back to its per-context report, so `git log` recovers the why.
