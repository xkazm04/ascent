# Bug-UI Fix Run — Cumulative Status (Waves 1–4)

> **21 findings closed in 13 atomic fix commits across 4 themed waves. 6 of the 7 criticals are now fixed.**
> Baseline held the whole run: `tsc` 0 → 0 errors · tests 465/465 → 480/480 (+15 new regression tests) · `prisma validate` ✓. Zero regressions across all four waves.

## Waves

| Wave | Theme | Closed | C/H/M | Commits |
|------|-------|-------:|-------|---------|
| 1 | Tenant Isolation & Auth | 6 | 1C / 3H / 2M | `7e8059d` `74db099` `2d94b78` `1e2820e` |
| 2 | Revenue Integrity | 5 | 1C / 3H / 1M | `263001d` `9a029be` `264870b` |
| 3 | Data Integrity & Concurrency | 5 | 1C / 2H / 2M | `bf0be60` `2d8c4ab` `9aa6e8a` |
| 4 | Destructive Ops | 5 | 3C / 2H | `07845ee` `4b1cd87` `f98ee1f` |
| **Total** | | **21** | **6C / 10H / 5M** | **13 fix commits** |

## Criticals — 6 of 7 closed

| # | Critical | Wave | Status |
|---|----------|------|--------|
| 1 | Cross-tenant owner takeover (Supabase-wall) | 1 | ✅ closed |
| 2 | Quota double-refund (free-scan bypass) | 2 | ✅ closed |
| 3 | Concurrent same-commit scan double-insert | 3 | ✅ closed |
| 4 | Practice "apply" overwrites real repo files | 4 | ✅ closed |
| 5 | Purge orphans RecommendationEvent forever | 4 | ✅ closed |
| 6 | DSQL cold-start dead client | 4 (Option A) | ✅ closed |
| 7 | **CI gate reads stochastic LLM cache** | **6 (pending)** | ⬜ open — in the Scoring & Gate wave |

## Verification (per wave)

| | W1 start | W1 | W2 | W3 | W4 |
|---|---|---|---|---|---|
| `tsc` errors | 0 | 0 | 0 | 0 | 0 |
| Tests | 465 | 470 | 477 | 479 | 480 |

## Pattern catalogue (13 durable patterns)

**Security / authz**
1. **Auth-config-branch-fails-open** — `if (!primaryAuth()) return null` blanket-allows when a *different* auth layer is the live gate; resolve a real principal per the enforced layer.
2. **Canonicalize-the-key-once** — gate/mutation/audit each normalizing an id differently → authorize one target, act on another. Normalize at the boundary, thread one value.
4. **Escape hatches need a prod fence** — any `*_BYPASS`/`*_SKIP` dev flag must be hard-disabled in production, not just defaulted off.
5. **Shared-public tenant: gate writes separately from reads** — a `public` tenant open for reads is not automatically safe to leave open for mutations of shared records.

**Money / concurrency**
3. **Invariant guard must be transactional** — `count()`-then-`write()` is a TOCTOU; put the check and the write in one transaction.
6. **Refund by value, not by recency** — undo the exact unit you did (by id/timestamp), idempotently; "undo the newest" lets two undos peel different live units.
7. **Reserve-then-refund for metered side effects** — make the atomic reservation precede the expensive side effect; refund on no-deliverable.
8. **Relative increments, never increment-then-absolute-clamp** — compute the clamped delta and apply one relative op; stamp the *applied* delta.

**Data integrity**
9. **A read-then-insert dedup needs a DB unique constraint, not just a lock** — the lock is the fast path, the constraint the cross-instance backstop (treat P2002 as "deduped").
10. **Never advance a "latest" pointer unconditionally** — guard by recency (`WHERE lastX < newX`); move co-dependent fields together so they can't tear.
11. **`findFirst` without a total `orderBy` is non-deterministic on a tie** — carry a deterministic tiebreaker (`…, id desc`).
12. **A delete cascade must be explicit when the ORM emits no FKs** — delete every level deepest-first; stopping one level short orphans grandchildren forever.
13. **Generative writes must refuse to clobber existing content by default** — create-only is the safe default; overwrite is an explicit opt-in.

## Open items (need a decision or a follow-up)

**Needs a product/infra decision:**
- Owner can mint free credits (credits #2, High) — needs a privilege tier above org-owner.
- Rate-limiter XFF spoof + in-memory reset (quotas #2/#3, High) — needs trusted-proxy config + a shared store (Redis).
- Webhook replay dedup (webhooks #1, High) — needs a persistent cross-instance delivery-id store.

**Follow-up (clear, just out of the safe wave scope):**
- Pinned report shows *current* contributors (scan-persist #2, High) — needs per-scan contributor history (schema + persist + read).
- Org rollup wide scan (db-schema #3, High) — a perf index / `orgId` denormalization.
- Practice reused-branch ignores requested base (practices #2, High).
- `@@unique([repoId, headSha])` **migration** — needs a one-time dedup of existing duplicate rows before `prisma migrate` (init.sql/fresh bootstrap already safe; app-level P2002 handling ships ahead of it).
- Sha-less dedup content-key; org-scan claim-lock; retention purge-audit self-erase; several Mediums.

## Remaining themed waves (per INDEX)

| Wave | Theme | Notable |
|------|-------|---------|
| 5 | Silent failure / success-theater (~8H) | audit-write dropped, mock-as-real, maturity→L1 |
| 6 | Scoring & gate correctness | **the 7th critical (CI gate)** + NaN-slips-floor |
| 7 | Date / timezone / window math | UTC-vs-local baselines, DST drift |
| 8 | File-gen + injection | badge `data:svg` XSS, PDF 500s, SKILL.md fence |
| 9 | GitHub API resilience | pagination, 403/429-as-not-found |
| 10 | Accessibility | `role=img` swallows links, chart SR fallbacks |
| 11 | UI states & consistency | layout shift, empty-state dead-ends, projection scaling |

**Clean handoff point:** the security + integrity core (W1–4) is done and committed on `vibeman/bug-ui-scan-fixes`. A future session resumes any of W5–11 by reading `INDEX.md` and the per-context reports.
