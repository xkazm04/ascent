# Bug Hunter Scan — Closeout · ascent, 2026-06-09

> Full accounting of all 70 findings after 8 themed fix waves + a final Medium/Low cleanup.
> Final state: **tsc 0 · vitest 260/260 · eslint clean · next build passes** · 47 commits on `vibeman/bug-hunt-2026-06-09` (off `master`, nothing pushed).

## Disposition of all 70 findings

| Disposition | Count | Findings |
|---|---:|---|
| **Fixed with code** | **63** | All 3 Criticals, all 21 Highs, 28 Mediums, 11 Lows |
| Reviewed — not a bug / intended design | 1 | maturity #4 (glass-box `signed` re-centers on the displayed headline by design; test-pinned) |
| Reviewed — already mitigated in-tree | 2 | usage #7 (`clientIp` already fails closed), scan-pipeline #2 (already guarded by `finally`+`cancel()`) |
| Reviewed — deliberate tradeoff | 1 | scan-pipeline #8 (optimistic byte reservation prevents the overshoot race; under-read is bounded/safe-side) |
| Reviewed — benign | 1 | persistence #7 (`cacheDelete` is idempotent) |
| Reviewed — addressed by another fix | 1 | org-scan #7 (token TTL: the Wave-2 buffer widen to 180s + single-mint-per-org reuse covers it) |
| Reviewed — acceptable by design | 1 | gh-app #7 (org listing reads page 1 — the onboarding funnel intentionally samples top-N recent; the underflow is already guarded) |
| **Total** | **70** | |

> **Every Critical and High was fixed with code.** The 7 reviewed-without-code items are all Medium/Low and were each assessed against the real source (the host-first / already-existed discipline) rather than taken at face value.

## Final Medium/Low cleanup (this session, after Wave 8)

| Commit | Findings | Severity |
|---|---|---|
| `d109de0` | org-scan #4, org-scan #6 | Medium ×2 |
| `d9d3f53` | usage #4, usage #5, report #7, org-dash #5 | Low ×4 |

- **org-scan #4** (Med): a revoked installation's whole fleet was re-attempted every daily cron pass (6h failure backoff < 24h interval). Distinguish "no install" (public, tokenless OK) from "had an install but mint failed" (revoked) and skip the latter — the claim-before-work already advanced its schedule to the full cadence.
- **org-scan #6** (Med): an out-of-credits bulk scan over a non-empty watchlist ran the pool over zero items and reported a silent 0/0; emit an explicit "out of scan credits" error before opening the pool.
- **usage #4 / #5** (Low): window line no longer shows "→ unknown"; the public/private panel gets the empty-period guard the engine panel already had.
- **report #7** (Low): a flat trend line is annotated "Holding at N" so it isn't read as a gridline.
- **org-dash #5** (Low): the movers level pair shows only when its direction agrees with the score arrow (no contradictory "L4→L3" beside a green ▲).

## Artifacts in this directory
- `INDEX.md` — the triage index (70 findings, themes, wave plan).
- 10 per-context reports (`*.md`).
- `FIXES-WAVE-1.md`, `-2`, `-3`, `-4`, `-7`, `FIXES-WAVE-5-6-8.md`, and this `CLOSEOUT.md`.
- A 21-item pattern catalogue distributed across the wave docs.

## Verification held across the whole run
| Gate | Baseline (pre-scan) | Final |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `vitest run` | 257 / 257 | 260 / 260 (+3 coalescer tests) |
| `eslint` (changed) | clean | clean |
| `next build` | — | passes |
