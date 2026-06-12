# Business-Visionary + Bug-Hunter Combined Scan — Closeout · ascent, 2026-06-12

> Full accounting of all 40 findings (39 distinct; SPI#1 ≡ RTV#2) scanned 2026-06-11 and resolved
> 2026-06-12 in 7 themed waves.
> Final state: **tsc 0 · vitest 450/450 (54 files) · eslint clean · next build passes** ·
> 40 commits on `vibeman/biz-bug-2026-06-11` (off `master`, nothing pushed): 1 WIP/INDEX checkpoint + 39 fix/feat commits.

## Disposition of all 40 findings

| Disposition | Count | Notes |
|---|---:|---|
| **Fixed/implemented with code** | **38 distinct** (39 findings) | All 23 Highs, all 17 Mediums except the one reassessed |
| Reassessed — not a bug, hardened anyway | 1 | OAUTH#1: `safeNext`'s "broken `[ -\s]` range" is actually raw control bytes `[\x00-\x1F\x7F\s]` that *render* misleadingly; runtime behavior was already correct. Normalized to escape-spelled regex + pinned with regression tests so it can't be misread a third time. |

## Wave summary

| Wave | Theme | Fixes | Commits | Tests after |
|---|---|---:|---|---:|
| 1 | Credit & quota metering integrity | 7 | `351d178` `0e87df2` `976d9f8` `ede23b3` `b49de7a` `fcb2f5b` `89b7248` | 321 |
| 2 | LLM provider reliability | 4 | `d9043f1` `43a2d8a` `f198563` `b6c5a3e` | 341 |
| 3 | Aggregates & history correctness | 6 | `52c7e5b` `dd134f6` `6be8f76` `d1c9236` `a770dd5` `45efd30` | 386 |
| 4 | Auth, webhook & token robustness | 6 | `1c4670b` `7a42019` `d3e204c` `f07795f` `caeb816` `362147f` | 408 |
| 5 | UI truth & error surfacing | 4 | `726693b` `3e60731` `92e10ef` `2d1c3d1` | 416 |
| 6 | Billing visibility & freemium honesty | 6 | `ad4b8f1` `299e9c2` `fa968f1` `25eda60` `9473112` `eeaf7ba` | 437 |
| 7 | Retention & growth features | 6 | `8a5433b` `0d071f7` `5031464` `7698a48` `571457f` `459b033` | 450 |

## Verification held across the whole run

| Gate | Baseline (pre-scan) | Final |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `vitest run` | 309/309 (42 files) | **450/450 (54 files)** — +141 tests pinning the fixed behaviors |
| `eslint --quiet` | clean | clean |
| `next build` | — | passes (pre-existing optional `@aws-sdk/dsql-signer` warnings only) |

## Deploy notes (operator actions required to activate some fixes)

- **`Organization.alertWebhookUrl`** (Wave 7, OSW#3) is an additive-nullable schema column — run
  `prisma migrate deploy` / `db push` on DB-backed deploys. init.sql + the parity test are aligned.
- Per-org alert routing resolves org → `ALERT_WEBHOOK_URL` env → no-op; configure via
  `POST /api/org/alerts` (admin-gated).
- LLM cost panel now prices from the built-in per-model table; `LLM_INPUT/OUTPUT_COST_PER_MTOK`
  env rates remain as the override.
- The metered-scan debit-failure path emits `x-ascent-unbilled: true` (soft signal; monitoring hook,
  not enforcement).
- Anonymous public-funnel imports now scan token-less (`noAmbientToken`) **except** on auth-off
  local/demo deploys, which keep the env token per the documented open-by-design posture.

## Artifacts in this directory
- `INDEX.md` — triage index (40 findings, 7 themes, wave plan)
- 10 per-context reports (`*.md`)
- This `CLOSEOUT.md`

## How the fixes were run
One subagent per wave (sequential, single working tree, atomic commit per fix), each re-verifying
every finding against current source before editing (the scan predated Waves 1-6 landing, and the
credits/quota flow changed mid-run). Wave-end gates: full tsc + vitest + eslint; final wave added
`next build`. One session-limit interruption mid-Wave-3 was resumed losslessly from the per-fix
commit granularity.
