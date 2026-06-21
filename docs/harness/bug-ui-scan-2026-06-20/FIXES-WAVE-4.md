# Fix Wave 4 — Silent-failure / success-theater (ascent, bug-ui-scan-2026-06-20)

> 7 findings closed in 5 atomic commits. One mental model: optimistic UI / writes that swallowed
> failures (or lost updates), now check the result, roll back, and surface — plus a backend
> optimistic-lock for the concurrent-PATCH lost-update.
> Baseline preserved: tsc 0; tests 2395 → 2396 (+1 regression test); `next build` green. 0 regressions.
> Branch: `vibeman/bug-ui-scan-2026-06-20-fixes`.

## Commits

| Commit | Finding | Sev | What changed |
|---|---|---|---|
| segments | repositories-segments #1, #3 | High+Med | `removeSegment` snapshots + restores + surfaces on a failed (admin-gated) DELETE; per-repo tag `toggle` was `.catch(()=>{})` fire-and-forget → now inspects the response and undoes exactly this toggle (functional updaters, no concurrent-toggle clobber) + shows the error. |
| playbooks | playbooks #1 | High | `remove` snapshots + restores + surfaces; a non-admin's swallowed 403 no longer shows a playbook "deleted" that survives in the DB. |
| connect | connect-repo-selection #1 | High | `bulkBusy` threaded into `RepoRow`; the per-row watch checkbox + schedule select are disabled during a bulk op, so the bulk partial-failure revert can't clobber a concurrent single-row change. |
| roadmap | roadmap-recommendation-tracking #1, #4 | High+Low | `updateRecommendation` now does a conditional `updateMany` keyed on the read pre-image (optimistic lock); `count===0` → tagged `REC_CONFLICT` → route returns **409**. `RecommendationTracker` reconciles status from the returned row and shows a "changed elsewhere" message on 409. |
| backlog | backlog-management #1 (+ roadmap #1 client) | High | Monotonic refresh token so only the latest post-edit re-read is applied (a slower older snapshot can't clobber a newer edit); refetch the authoritative state on a 409 conflict. |

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `vitest run` | 2395 | **2396** (+1 REC_CONFLICT regression test) |
| `next build` | green | green |
| Regressions | — | none |

Tests touched: `scans-recommendations.test.ts` mock updated for the `updateMany`/`findUniqueOrThrow`
optimistic-lock shape + a new conflict (count===0 → REC_CONFLICT, no event/audit) regression test.

## Patterns added to the catalogue

14. **Optimistic UI must inspect the response and roll back on failure.** `await fetch(...)` with no
    `res.ok` check (or `.catch(()=>{})`) shows a state the server never saved; on a permission-gated
    action it reads as data-loss/resurrection. (segments #1/#3, playbooks #1)
15. **Undo the specific optimistic change with functional updaters, not a whole-list snapshot restore.**
    A snapshot restore clobbers a concurrent change to another row. (segments #3 toggle)
16. **Disable the controls that a bulk op's revert can overwrite while it's in flight.** A bulk
    partial-failure revert writing absolute values races any concurrent per-row edit. (connect #1)
17. **A read-then-write needs an optimistic lock.** Condition the update on the read pre-image
    (`updateMany where:{...preimage}` → count===0 → 409), or two concurrent edits lose an update and
    leave a self-contradicting audit/timeline. (roadmap #1)
18. **Reconcile optimistic UI from the server's returned row.** Discarding the response hides a
    normalization or a concurrent change until reload. (roadmap #4)
19. **Sequence-guard a refresh that wholesale-replaces state.** Without a monotonic token, a slower
    older response clobbers a newer one. (backlog #1)

## Deferred from these contexts (Medium/Low — later waves)

- repositories-segments #2 (bulk Add reports selected not `changed`), #4 (OrgTable caption a11y),
  #5 (stale `?segment=` dead state), #6 (select-all indeterminate).
- connect #2 (per-row failure indication on bulk revert), #3 (bulk msg aria-live), #4 (segment toggle
  stale snapshot), #5 (watch/schedule per-control in-flight guard), #6 (schedule sentinel).
- backlog #2 (shared pr/promote error channel), #3 (non-idempotent promote-to-initiative — needs
  server dedupe or a promotion link), #4 (row error aria-live), #5 (undated due affordance).
- playbooks #3 (mark-applied busy guard), #4 (stale adoption/lift), #5 (create() non-JSON error), #6 (a11y).
- roadmap #2 (load-error vs empty), #3 (note duplicated across multi-field events), #5 (sandbox a11y).
