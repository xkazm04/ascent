# Bug-UI Fix Run — Final Cumulative Status (Waves 1–11, COMPLETE)

> **52 findings closed in 31 atomic fix commits across all 11 themed waves. ALL 7 criticals fixed.**
> Baseline held the whole run: `tsc` 0 → 0 errors · tests 465/465 → 509/509 (+44 new regression tests) · `prisma validate` ✓. Zero regressions across all eleven waves.

## Waves

| Wave | Theme | Closed | C/H/M | Fix commits |
|------|-------|-------:|-------|------------:|
| 1 | Tenant Isolation & Auth | 6 | 1C / 3H / 2M | 4 |
| 2 | Revenue Integrity | 5 | 1C / 3H / 1M | 3 |
| 3 | Data Integrity & Concurrency | 5 | 1C / 2H / 2M | 3 |
| 4 | Destructive Ops | 5 | 3C / 2H | 3 |
| 5 | Silent Failure / Success-Theater | 6 | 6H | 4 |
| 6 | Scoring & Gate Correctness | 6 | 1C / 4H / 1M | 4 |
| 7 | Date / Timezone / Window Math | 3 | 2H / 1M | 2 |
| 8 | File-Gen + Injection | 8 | 7H / 1M | 3 |
| 9 | GitHub API Resilience | 3 | 2H / 1M | 2 |
| 10 | Accessibility | 3 | 2H / 1M | 2 |
| 11 | UI States & Consistency | 2 | 1H / 1M | 1 |
| **Total** | | **52** | **7C / 34H / 11M** | **31** |

(+11 `docs(harness)` wave-summary commits + 1 scan-INDEX commit = ~43 commits total on the branch.)

## Criticals — 7 of 7 closed ✅

| # | Critical | Wave |
|---|----------|------|
| 1 | Cross-tenant owner takeover (Supabase-wall) | 1 |
| 2 | Quota double-refund (free-scan bypass) | 2 |
| 3 | Concurrent same-commit scan double-insert | 3 |
| 4 | Practice "apply" overwrites real repo files | 4 |
| 5 | Purge orphans RecommendationEvent forever | 4 |
| 6 | DSQL cold-start dead client (Option A) | 4 |
| 7 | CI gate reads stochastic LLM cache (flaky gate) | 6 |

## Verification (cumulative)

`tsc` stayed at **0 errors** every wave. Tests grew **465 → 509** (+44 regression tests pinning the fixes):
W1 470 · W2 477 · W3 479 · W4 480 · W5 482 · W6 488 · W7 495 · W8 502 · W9 509 · W10 509 · W11 509.

## Pattern catalogue (24 durable patterns)

**Security / authz**
1. Auth-config-branch-fails-open · 2. Canonicalize-the-key-once · 4. Escape hatches need a prod fence · 5. Shared-public tenant: gate writes separately from reads.

**Money / concurrency**
3. Invariant guard must be transactional · 6. Refund by value, not by recency · 7. Reserve-then-refund for metered side effects · 8. Relative increments, never increment-then-absolute-clamp.

**Data integrity**
9. Read-then-insert dedup needs a DB unique constraint, not just a lock · 10. Never advance a "latest" pointer unconditionally — guard by recency · 11. `findFirst` without a total `orderBy` is non-deterministic on a tie · 12. A delete cascade must be explicit when the ORM emits no FKs · 13. Generative writes must refuse to clobber existing content by default.

**Reliability / correctness**
14. A 2xx is not success — check the body's per-item outcome · 15. Degrade visibly, account honestly · 16. A "serve whatever we have" fallback breaks a determinism contract · 17. Trust boundaries must reject non-finite numbers (fail-closed in gates) · 18. Pick one date reference frame and apply it everywhere (half-open intervals) · 21. Filter inside the pagination loop, not after a single fetch · 22. Don't collapse every upstream failure to one status.

**Injection / output**
19. A "data: image" allowlist must exclude `svg+xml` · 20. A fixed-length fence/delimiter is a collision waiting to happen.

**UI / a11y**
23. `role="img"` is a leaf — never on a container with interactive/structured children · 24. A "share" bar must divide by the whole, not the max.

## Open items (logged for the team — decisions / follow-ups, NOT silent skips)

**Needs a product / infra / scoring-semantics decision:**
- Owner can mint free credits (credits #2, H) — needs a privilege tier above org-owner.
- Rate-limiter XFF spoof + in-memory reset (quotas #2/#3, H) — trusted-proxy config + a shared store (Redis).
- Webhook replay dedup (webhooks #1, H) — a persistent cross-instance delivery-id store.
- Dimension-vanishes-from-headline-mean (maturity #2, H) — changes core scoring renormalization.
- Governance/commit-activity vanish on rate-limit (github-repo-data #3, H) — changes the scoring-signal pipeline.
- `daysUntil` UTC vs local window frame (fleet-rollups #5, M) — needs a canonical org timezone.

**Follow-up (clear, just out of safe-wave scope):**
- `@@unique([repoId, headSha])` **migration** — one-time dedup of existing duplicate rows first (init.sql/fresh bootstrap is safe; app-level P2002 handling already ships).
- Pinned report shows current contributors (scan-persist #2, H) — per-scan contributor history.
- Org rollup wide scan (db-schema #3, H) — a perf index / `orgId` denormalization.
- `getOrgMovers` silent baseline degrade (fleet-rollups #3, H) — a movers-semantics call.
- PR GraphQL pagination short-circuit (github-repo-data #4, M); forecast over windowed trend (fleet-rollups #4, M); practice reused-branch base (practices #2, H).
- Diffuse a11y polish (aria-live, focus management, colorblind redundancy, table scope) + UI polish (layout shift, projection scaling, empty-state coverage).

## Already-mitigated catches (Phase 4.1d payoff)

Several reported findings were already handled by prior hardening and needed no change: `recordAudit` already logs loudly on failure (security #1); the bedrock provider already trusts the explicit selection (llm); `connect` bulk-watch already rolls back failures; PostureQuadrant/RadarChart already carry `role="img"` + SR descriptions; the connect filter bar is never dropped. Catching these avoided re-implementing work and is documented in the relevant wave summaries.

## Artifacts

- `INDEX.md` — the full triage (191 findings, 38 per-context reports, themes, wave plan).
- `FIXES-WAVE-1.md … FIXES-WAVE-11.md` — per-wave commit tables, narratives, verification, deferrals.
- 38 `<context-slug>.md` — the raw per-context scan reports.

**Branch:** `vibeman/bug-ui-scan-fixes` (master holds W1–7 already-merged + the team's `dbReadSafe` commit; W8–11 sit ahead on the branch). The run is complete and review-ready.
