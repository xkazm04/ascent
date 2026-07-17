# Ambiguity+UI Scan — Fix Waves 1–11 Summary (2026-07-16/17)

> 65 of 66 High findings fixed, 1 refuted, across 11 themed waves — 65 atomic commits
> on `vibeman/ambiguity-ui-fixes-2026-07-16` (worktree off master `67f60d4`; user WIP untouched).
> Gates: tsc 0 errors · vitest 3498 → 3647 passing (+149 new regression tests, 0 regressions) · next build ✓ (see final verification note).
> Scan INDEX + 44 per-context reports live in the main checkout: `docs/harness/ambiguity-ui-scan-2026-07-16/` (untracked).

## Waves

| Wave | Theme | Findings | Commits |
|---|---|---:|---|
| 1 | Gate & verdict integrity | 6/6 | `4d7a0d0..a7574eb` — tighten-only gate params, fail-closed evaluators, neutral fork-PR check, disclosed badge policy, MATURITY_MODEL doc realignment, reviewedRate sample floor |
| 2 | Tenancy & privacy fail-opens | 6/6 | `6f044be..44f1234` — scoped briefing/export fail closed, 4th private-repo guard, CHAMPION_MIN_POP in LLM brief, PAT gated on caller standing, retention clamp on baseline/movers |
| 3 | Money & billing | 5/5 | `3953569..a1604cf` — post-checkout notice, refund denominator (netAmount, $0-gross skip), allowanceRemaining self-heal, BYOM on import, honest credit-unknown onboarding |
| 4 | Silent fallbacks → fail loud | 6/6 | `f78ec4a..80d8a32` — unknown LLM_PROVIDER throws, digest no-misroute, governance null on unreadable rulesets, typed GitHubError taxonomy, notify-email honesty, zero-event scan outcome |
| 5 | Dormant-auth sweep | 4/4 | `502fcc2..321d872` — dual-stack /api/auth/session, rendered OAuth failure, live selfLogin (self-demotion guard revived), invite never downgrades |
| 6 | API contract & validation | 6/7 +1 pinned | `64ca4d6..395df58` — goal status whitelist, achieved-goal confirm, playbook title parity, note contract, conformance headSha ledger, installs on `free`; backlog dedupe already fixed upstream (pinned with tests) |
| 7 | Broken/dead UX surfaces | 3/4 +1 refuted | `fe6e860..4253934` — DownloadButton for PDF exports, war-room leaderboard on wall/kiosk, persisted roadmap keeps prioritization; **ExportCsvLink backslash-URL refuted (scanner misread — code was already correct)** |
| 8 | Stale-view & invalidation | 6/6 | `4d252ec..95691ad` — stale-badge simulator ranking, single-fix track policy, pruned bulk selection, working Swap comparison, @sha-pinned cold scan, verified clipboard |
| 9 | A11y & interaction reach | 8/8 | `60f5035..172339b` — FilterMenu keyboard model, RadarChart touch+keyboard, PostureQuadrant tokens/contrast, focusable scroll region, aria-hidden Remotion, DeckNav safe-area + section padding, canonical CTA styles |
| 10 | Honest disclosures | 7/7 | `9732a6b..a1371bb` — MAX_FILES-derived privacy copy, labeled bulk scopes, supply-chain in security PDF, uncapped supply-chain map, white-label on share page, clearable accent, anchored devLocate |
| 11 | Ops contracts | 7/7 | `230284b..53142ff` — coupled purge budget, retention floor+dryRun+RETENTION_FORCE, documented 2× connection peak, ASCENT_TRUSTED_PROXY_HOPS trust model, doctor writes `verified` back, install-id rename reconciliation, period-scoped Teams rollup |

## Behavior changes needing sign-off (aggregated)

1. **Gate**: query params can only TIGHTEN a persisted org policy; fork-PR required checks conclude `neutral`; generator badges pin explicit `min_level`.
2. **Fail-closed scope**: stale `?stack=`/`?segment=` ids now 400/404 instead of whole-org data (stale bookmarks/automation break loudly).
3. **Free-tier numbers**: period deltas/movers/Teams rollups now respect the retention floor and the period selector — visible number changes.
4. **Billing**: refund fraction uses `netAmount` with $0-gross skip; BYOM imports stop drawing platform credits; typo'd `LLM_PROVIDER` hard-fails instead of silently using Gemini/mock.
5. **Auth surfaces**: sign-in failures land on `/connect` with a visible banner; invite acceptance never downgrades; new installs persist plan `free` (was non-canonical `private`, resolved to free anyway).
6. **Adopter-side**: emitted doctor.mjs now writes `verified` back into the adopting repo's manifest.yaml.
7. **New env vars**: `ASCENT_TRUSTED_PROXY_HOPS` (proxy trust model), `RETENTION_FORCE` (override retention floors). No schema migrations.

## What remains (per INDEX)

- 118 Medium + 36 Low findings, clustered along the same themes (INDEX "Suggested next-phase split", wave 9+).
- Context-map drift: ~10 contexts have stale file paths — refresh the Vibeman context map before the next scan.
