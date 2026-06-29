# Bug + UI Scan — Fix Summary (ascent, 2026-06-25)

> Branch: `vibeman/bug-ui-fixes-2026-06-25` (isolated git worktree off `master`@1223535, so the
> working-tree WIP refactor on `master` was never touched).
> **27 / 27 HIGH findings fixed** across 5 themed waves · **28 atomic commits** (1 fix-forward).
> Baseline preserved: **tsc 0 → 0 errors**, **vitest 2630 → 2646 passing** (+16 tests), **0 regressions**.
> Scan that produced these: `INDEX.md` (220 findings: 0C / 27H / 117M / 76L over 44 contexts).

## Waves

| Wave | Theme | Highs | Commits |
|---|---|---:|---|
| A | Billing & credit correctness | 5 | `5f508da` refund cumulative clawback · `5b7561c` plan-tier upgrade on paid order · `277a744` idempotent scan-credit debit · `bab18d1` no autoscan billing for BYOM/public · `aaa973f` credits chip honors allowance |
| B | Cross-tenant / authz / privacy | 5 | `39ef5e3` getScanComparison IDOR guard · `0b54512` BYOM fail-closed · `ff87161` admin-gate playbook archive · `d970cc3` roadmap list Supabase read gate · `55288ca` non-destructive suspend/resume |
| C | Cost-amplification / proxy / slug | 6 | `67c5322` throttle peek path · `8b28845`+`2b74f11` gate rate-limit (ingest paths only, cache-hit contract preserved) · `e1946c6` badge row cap vs spoofed Referer · `ccde562` normalize org slug in rollups · `8d84549` OAuth redirect from public origin · `7251fb1` scroll-snap no longer strands tall sections |
| D | Status-integrity (success-theater) | 5 | `ece650e` PDF engine-mix provenance · `9a326cd` rollout cap surfaced + neediest-first · `e7f9d01` send-test uses typed URL · `65a8441` onboarding skipped-repo state · `6445d98` audit `until` inclusive of final day |
| E | State / races / data correctness | 6 | `86632e1` DSQL read-surface self-heal · `9c9d7e1` GitHub fetch timeouts · `1a1201d` un-achieve a regressed goal · `d54de8a` track every simulated leg · `7a4a8f4` war-room abort-ownership guard · `2cfb501` per-axis tile averaging |

## Pattern catalogue (durable — grep for these shapes in future audits)

1. **Idempotency-key parity** — a retried/duplicated write (credit debit, refund clawback) must carry a deterministic `externalId` so the unique constraint collapses re-applies. The grant path had it; the debit/refund paths didn't. Audit every ledger write for a stable key.
2. **Cron-vs-manual gate divergence** — the scheduled path silently re-implements (and breaks) a gate the manual path gets right (billing waiver, auth, validation). When you find a manual gate, grep the cron/webhook twin.
3. **Slug/host normalization at exactly one layer** — auth normalized the org slug, the data layer didn't → authorize-but-empty. Centralize `normalizeOrgSlug`; never `findUnique({where:{slug}})` on a raw input.
4. **Fail-open on a privacy/security boundary** — `.catch(() => null)` then fall through to the default provider leaked private source. Security boundaries must fail **closed** with an actionable error.
5. **Gate only the expensive branch, not the whole route** — "rate-limit everything" broke a deliberate cheap-path contract. Throttle where the cost actually is (GitHub ingest on cache-miss/`?ref`), leave warm cache-hits free.
6. **Success-theater = client trusts a scalar, ignores the server's `skipped`/`changed`/`errors`** — bulk ops (rollout cap, schedule, bulk-tag, purge) report "done" off the requested count. Always reconcile against the server's actual outcome set.
7. **Silent truncation keeps the wrong slice** — a `slice(0,N)` over a score-desc list dropped the *neediest* items. If you cap, sort so the cap keeps what matters, and surface the dropped count.
8. **Date-only `until` = start-of-day** drops the final day. Resolve a bare day to end-of-day (or `< nextDay`); keep explicit timestamps verbatim.
9. **Abort/controller ref clobber** — a settling old run's `finally` nulls the shared ref the new run installed. Guard every cleanup with `if (ref.current === mine)`.
10. **Latched status never reverts** — "achieved/passed" is written once and never re-evaluated on regression → a false green. Make status transitions symmetric.
11. **Average over the denominator that carries the metric** — dividing an axis sum by *all* repos (incl. those missing the axis) understates it. Count only carriers.
12. **Reconnect/recovery wired to one caller** — `runWithReconnect` only protected `withDb` (1 caller) while the whole read surface used `getPrisma()` raw. When you add a resilience wrapper, grep for the bypass paths.
13. **Proxy-unaware origin/IP/host** — `url.origin`, raw `Host`, `clientIp()→"unknown"` all misbehave behind a TLS-terminating proxy (bad redirect, CSRF 403, one shared quota bucket). Route through the `publicOriginForRequest`/forwarded-header helpers.
14. **Unauthenticated + unthrottled before the gate** — `peek`/badge/mock paths that run GitHub-PAT or DB work before auth/rate-limit are denial-of-wallet vectors even when they look "free".

## Deliberate behavior changes (operator should know)

- **BYOM fail-closed** (`0b54512`): a BYOM-active org whose creds can't resolve now gets a hard scan error instead of a silent platform-provider scan.
- **Playbook archive → 403** (`ff87161`): a non-admin member can no longer archive/soft-delete an org playbook.
- **Suspend is non-destructive** (`55288ca`): a temporary installation suspension no longer wipes watch/schedule or signs users out; unsuspend resumes + catches up.
- **Plan-tier mapping is config-driven** (`5b7561c`): added env `POLAR_PLAN_PRODUCTS` (`productId=planId`), mirroring `POLAR_CREDIT_PACKS`. Unset = unchanged credit-only behavior; **set it in prod to actually upgrade tiers on a paid plan purchase.**

## Residuals / not done in this run

- **DSQL reactive reconnect on direct `getPrisma()` *writes*** (`86632e1` covers the read surface + `withDb` only). Write call-sites not routed through `withDb` (e.g. some `createGoal`/`updateGoal`) still won't self-heal on auth-expiry — a follow-up.
- **117 medium + 76 low findings** remain (see `INDEX.md`): chart keyboard a11y, design-system heading order, token/hex drift, optimistic-update-without-rollback cluster, members invite race, backlog idempotency, doc/score-accuracy mediums, etc. Recommended as the next batch (Wave F+).
- **Context-map drift**: several context `file_paths` point at deleted files (ScanGallery, RoadmapPanel, ReportTabBar/Skeleton, EditorialSteps, AboutReveal). Run `refresh_context` for those.

## Branch / merge notes

This branch was cut from `master`@1223535 (which itself includes a committed "in-progress UI/report
refactor"); the user's **uncommitted** WIP on `master` is untouched. A few findings live in files the
uncommitted WIP also edits (e.g. `api/scan/route.ts`) — reconcile on merge.
