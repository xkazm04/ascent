# Ambiguity+UI Scan — Fix Waves 1–25 Summary (2026-07-16/17)

> **ALL 220 findings worked: 219 fixed, 1 refuted** (66 High in waves 1–11; 154 Med/Low in waves 12–25)
> — 220 commits on `vibeman/ambiguity-ui-fixes-2026-07-16` (worktree off master `67f60d4`; user WIP untouched).
> Diff: 384 files, +11,378/−1,655.
> Final gates: tsc 0 errors · vitest 3498 → **3827** passing (+329 new regression tests, 0 regressions) · next build ✓.
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

## Med/Low waves (12–25) — 154/154 worked

| Wave | Domain | Findings | Notes |
|---|---|---:|---|
| 12 | Repository Scanning & Scoring | 14 | GET /api/scan restricted to peek/mock; quota-slot refund for coalesce joiners; archetype corroboration |
| 13 | Identity & GitHub | 8 | CODEOWNERS precedence; deep-link intent on ParsedRepo; `listOrgRepos` → `{repos, truncated}`; webhook claim rollback |
| 14 | Onboarding/Shell A | 11 | timing-safe health bearer + prod no-secret close; StaticNav single-source; skill route `?tracks`/`?max` validation |
| 15 | Onboarding/Shell B | 11 | fleet-map error-state healing + a11y rings; success tokens; onboarding resetRun + aria |
| 16 | Org Scanning & Fleet | 14 | 6h mint-failure backoff; invalid schedule 400; honest `result.scanned`; OrgSwitcher ARIA menu |
| 17 | Org Dashboard A | 10 | logo save-time probe; demo-data chips; filter-scoped CSV; segments 400 validation |
| 18 | Org Dashboard B | 11 | practice apply content-drift 409 fingerprint; export stack scope; masthead zero-match skip |
| 19 | Org Planning A | 10 | all-mock caveat on 4 surfaces; local end-of-day deadlines; wake-lock re-acquire; scenario scope capture |
| 20 | Org Planning B | 11 | backlog segment/stack scope; goals optimistic-concurrency 409 retry; playbook delete audit |
| 21 | Reporting A | 10 | PDF no-store; CopyForLlm failure fallback; compare unhonored-ids notice; stale-report error kind |
| 22 | Reporting B | 7 | POSTURE_META-derived labels; client-safe PR thresholds; ALL_TABS single-source |
| 23 | Billing & Metering | 15 | quota-route rate limit; **revived dead `weekly_quota`→`monthly_quota` salvage path**; downgrade guard; badge CJK width |
| 24 | Data & Persistence | 11 | purge 503 on DB-unset; budget=0 means unlimited; `dbReadSafe` degradation; init.sql column-parity test |
| 25 | Marketing & Design System | 11 | --header-h token; DeckSection justify variant; en-US-pinned shortDate; footer single-source |

Additional env vars from the Med/Low waves: `RATE_LIMIT_QUOTA_PEEK_*`, `RETENTION_ALLOW_NO_DB`, `RETENTION_TIME_BUDGET_MS=0` semantics.
Known flaky tests (pre-existing, pass on re-run/isolation): pdf report-document "boundary scores"; auth.test.ts 5s timeout under full-suite load; db/client.test.ts dsql-signer (env-only on worktrees).

## What remains

- Nothing from the scan: all 220 findings closed or refuted. One tracked follow-up: content-key half of sha-less scan dedup needs a schema index (deferred, no-migration rule).
- Context-map drift: ~10 contexts have stale file paths — refresh the Vibeman context map before the next scan.
