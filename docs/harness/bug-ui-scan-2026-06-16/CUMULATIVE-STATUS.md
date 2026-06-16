# Bug-UI Fix Run — Cumulative Status (Waves 1–6)

> **33 findings closed in 21 atomic fix commits across 6 themed waves. ALL 7 criticals are now fixed.**
> Baseline held the whole run: `tsc` 0 → 0 errors · tests 465/465 → 488/488 (+23 new regression tests) · `prisma validate` ✓. Zero regressions across all six waves.

## Waves

| Wave | Theme | Closed | C/H/M | Fix commits |
|------|-------|-------:|-------|------------:|
| 1 | Tenant Isolation & Auth | 6 | 1C / 3H / 2M | 4 |
| 2 | Revenue Integrity | 5 | 1C / 3H / 1M | 3 |
| 3 | Data Integrity & Concurrency | 5 | 1C / 2H / 2M | 3 |
| 4 | Destructive Ops | 5 | 3C / 2H | 3 |
| 5 | Silent Failure / Success-Theater | 6 | 6H | 4 |
| 6 | Scoring & Gate Correctness | 6 | 1C / 4H / 1M | 4 |
| **Total** | | **33** | **7C / 20H / 6M** | **21** |

## Criticals — 7 of 7 closed ✅

| # | Critical | Wave | Status |
|---|----------|------|--------|
| 1 | Cross-tenant owner takeover (Supabase-wall) | 1 | ✅ closed |
| 2 | Quota double-refund (free-scan bypass) | 2 | ✅ closed |
| 3 | Concurrent same-commit scan double-insert | 3 | ✅ closed |
| 4 | Practice "apply" overwrites real repo files | 4 | ✅ closed |
| 5 | Purge orphans RecommendationEvent forever | 4 | ✅ closed |
| 6 | DSQL cold-start dead client | 4 (Option A) | ✅ closed |
| 7 | CI gate reads stochastic LLM cache (flaky gate) | 6 | ✅ closed |

## Verification (cumulative)

| | start | W1 | W2 | W3 | W4 | W5 | W6 |
|---|---|---|---|---|---|---|---|
| `tsc` errors | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Tests | 465 | 470 | 477 | 479 | 480 | 482 | 488 |

## Pattern catalogue (17 durable patterns)

**Security / authz**
1. **Auth-config-branch-fails-open** — `if (!primaryAuth()) return null` blanket-allows when a *different* auth layer is the live gate; resolve a real principal per the enforced layer.
2. **Canonicalize-the-key-once** — gate/mutation/audit each normalizing an id differently → authorize one target, act on another.
4. **Escape hatches need a prod fence** — `*_BYPASS`/`*_SKIP` dev flags must be hard-disabled in production.
5. **Shared-public tenant: gate writes separately from reads.**

**Money / concurrency**
3. **Invariant guard must be transactional** — `count()`-then-`write()` is a TOCTOU.
6. **Refund by value, not by recency** — undo the exact unit you did, idempotently.
7. **Reserve-then-refund for metered side effects** — atomic reservation precedes the expensive side effect.
8. **Relative increments, never increment-then-absolute-clamp** — stamp the *applied* delta.

**Data integrity**
9. **A read-then-insert dedup needs a DB unique constraint, not just a lock** (treat P2002 as deduped).
10. **Never advance a "latest" pointer unconditionally** — guard by recency; move co-dependent fields together.
11. **`findFirst` without a total `orderBy` is non-deterministic on a tie** — carry a deterministic tiebreaker.
12. **A delete cascade must be explicit when the ORM emits no FKs** — deepest-first; don't orphan grandchildren.
13. **Generative writes must refuse to clobber existing content by default** — create-only; overwrite is opt-in.

**Reliability / correctness**
14. **A 2xx is not success — check the body's per-item outcome** (a `failed[]` list, an SSE `error` before clean close).
15. **Degrade visibly, account honestly** — a fallback must be recorded as a fallback, never relabeled as the intended path.
16. **A "serve whatever we have" fallback breaks a determinism contract** — read the key for the requested mode only; reads and writes use the same key.
17. **Trust boundaries must reject non-finite numbers explicitly** — `typeof NaN === "number"` and `NaN < x === false`; validate `Number.isFinite` and fail-closed in gates.

## Open items (need a decision or a follow-up)

**Needs a product / infra / semantics decision:**
- Owner can mint free credits (credits #2, High) — needs a privilege tier above org-owner.
- Rate-limiter XFF spoof + in-memory reset (quotas #2/#3, High) — needs trusted-proxy config + a shared store (Redis).
- Webhook replay dedup (webhooks #1, High) — needs a persistent cross-instance delivery-id store.
- **Dimension-vanishes-from-headline-mean (maturity #2, High)** — changes core scoring renormalization (shifts scores; pinned by engine tests; "documented as a feature"). A scoring-model call.

**Follow-up (clear, just out of safe-wave scope):**
- Pinned report shows *current* contributors (scan-persist #2, High) — needs per-scan contributor history.
- Org rollup wide scan (db-schema #3, High) — a perf index / `orgId` denormalization.
- Practice reused-branch ignores requested base (practices #2, High).
- `@@unique([repoId, headSha])` **migration** — needs a one-time dedup of existing duplicate rows first.
- Sha-less dedup content-key; org-scan claim-lock; retention purge-audit self-erase; gate-comment failingDims edge; several Mediums/Lows.

## Remaining themed waves (per INDEX) — all H/M/L, no criticals left

| Wave | Theme | Notable |
|------|-------|---------|
| 7 | Date / timezone / window math | UTC-vs-local baselines, DST drift |
| 8 | File-gen + injection | badge `data:svg` XSS, PDF render 500s, SKILL.md fence |
| 9 | GitHub API resilience | pagination, 403/429-as-not-found |
| 10 | Accessibility | `role=img` swallows links, chart SR fallbacks |
| 11 | UI states & consistency | layout shift, empty-state dead-ends, projection scaling |

**Clean handoff point:** the security + integrity + reliability + gate-correctness core (W1–6) is done and committed on `vibeman/bug-ui-scan-fixes`. A future session resumes W7–11 by reading `INDEX.md` and the per-context reports.
