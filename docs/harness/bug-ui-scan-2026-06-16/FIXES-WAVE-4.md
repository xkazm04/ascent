# Bug-UI Fix Wave 4 — Destructive Ops

> 3 atomic commits, 5 findings closed (3 critical, 2 high) — including the DSQL cold-start critical escalated from Wave 3 (resolved via the chosen Option A).
> Baseline preserved: `tsc` 0 → 0 errors · tests 479/479 → 480/480 (+1 orphan-deletion regression test).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|--------|-----------------|----------|-------|
| 1 | `07845ee` fix(github/write): refuse to overwrite a real base-branch file with a starter artifact | practices #1 | Critical | `github/write.ts`, `practices/apply/route.ts` |
| 2 | `4b1cd87` fix(db/retention): delete RecommendationEvent grandchildren + atomic per-batch deletes + DB-authoritative ranking | retention #1, #2, #3 | Critical + 2×High | `db/retention.ts` (+test) |
| 3 | `f98ee1f` fix(db/client): require DATABASE_URL seed in DSQL mode — fail fast | db-schema #1 | Critical | `db/client.ts` |

## What was fixed

1. **Practice "apply" overwrites real files (CRITICAL).** `openDraftPr` create-or-*updated* the target file on a branch cut from base, so a repo that already had a real `SECURITY.md`/`ci.yml`/`AGENTS.md` got it replaced by a TODO scaffold — merging the draft PR deleted the customer's content, fanned across 25-repo batches. It now checks the **base** branch and throws `AppApiError(409)` rather than clobber an existing file (a file on *our* generated branch from a prior run is still fine — idempotent re-seed). Fixed at the single chokepoint, so practices apply/apply-batch + playbooks apply are all protected.
2. **Purge orphans `RecommendationEvent` forever (CRITICAL).** `pruneRepoScans` deleted dimensions + recommendations + scan but never the `RecommendationEvent` grandchildren; with no FK cascade (`relationMode="prisma"`) they leaked permanently. Now resolved and deleted first, inside a per-batch transaction.
3. **Non-transactional purge graph (High).** The per-batch deletes ran as separate statements — a mid-batch timeout could leave a half-deleted graph. The whole sub-graph for a batch now commits in ONE transaction (grandchildren → children → parent), retried on conflict.
4. **Purge ranked by spoofable `scannedAt` (High).** "Newest N" trusted the report-supplied `scannedAt`, which a backdated/clock-skewed report could fake to delete a genuinely-newer *live* scan. Now ranks by DB-authoritative `createdAt`.
5. **DSQL cold-start dead client (CRITICAL — escalated from W3, resolved via Option A).** `getPrisma()` is synchronous and called directly in 125 sites, so in DSQL-only mode without `DATABASE_URL` the cold client had no datasource URL and 500'd the first query. Per your decision, `DATABASE_URL` is now **required** even in DSQL mode — the cold path fails fast with a clear, actionable message instead of serving a dead client. `withDb()` (awaits a mint first) is unaffected. Pairs with the W3 `dbHealthCheck` self-heal.

## Verification

| | Before wave | After wave |
|---|---|---|
| `tsc --noEmit` errors | 0 | 0 |
| Tests | 479/479 | 480/480 |
| New tests | — | +1 (purge orphan deletion + tx ordering) |

## Patterns established (catalogue items 12–13)

12. **A delete cascade must be explicit when the ORM emits no FKs.** Under `relationMode="prisma"` (or any no-FK setup) every level of a parent→child→grandchild graph must be deleted by hand, deepest first. A "delete the children" that stops one level short orphans the grandchildren silently and forever.
13. **Generative writes must refuse to clobber existing content by default.** A tool that seeds a *starter*/scaffold into a user's repo (or any store) must check for a pre-existing real artifact at the target and refuse, not blind-overwrite — the safe default is create-only; overwrite is an explicit opt-in.

## Deferred this wave (with rationale)

- **Practice reused-branch ignores requested base (practices #2, High).** A correctness edge (a reused `ascent/<id>` branch/PR may target a different base than requested) — narrow and *non-destructive*. Deferred to keep this wave focused on the destructive criticals + the decided cold-start fix. **→ follow-up.**
- **Purge audit entry self-erased + orphan-gate on global default (retention #4, #5, Medium).** Minor; a later run with a short `auditDays` could delete a prior purge's own audit row, and the org-less sweep is gated on the global default. **→ follow-up.**
