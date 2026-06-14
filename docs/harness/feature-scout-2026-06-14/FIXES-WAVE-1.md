# Feature Scout Fix Wave 1 — Close the action loop

> 5 commits, 5 of 6 planned findings closed (STD-1 deferred — see below).
> Branch: `vibeman/feature-scout-wave1` (off `master`).
> Baseline preserved: `tsc` 0 errors → 0; **vitest 450/450 → 450/450**; eslint clean; `next build` ✓.

One mental model for the whole wave: **ascent already ships the primitives that turn an insight into
action (`openDraftPr` + `buildArtifact`, `createInitiative`, `reportPermalink`); five surfaces
computed value and then dead-ended instead of calling them.** Each fix is a wire-up, not new
infrastructure — so the wave is uniformly low-risk and high-leverage.

## Commits

| # | Commit | Finding | Sev | Files |
|---|---|---|---|---|
| 1 | `3ba3eed` | MAP-1 — fleet-map stars link to their report | Critical | `ConstellationField.tsx`, `globals.css` |
| 2 | `87339e0` | SIM-1 — commit a simulation as a tracked Initiative | Critical | `Simulator.tsx` |
| 3 | `a0c627d` | PRAC-1 — fleet rollout: apply a practice to all gap repos | Critical | `api/practices/apply-batch/route.ts` (new), `PracticeApply.tsx` |
| 4 | `4320344` | PLAY-1 — one-click playbook rollout via a draft PR | Critical | `api/org/playbooks/[id]/apply/route.ts` (new), `PlaybookCard.tsx`, `db/playbooks.ts`, `db/index.ts` |
| 5 | `dbcae23` | BKLG-1 — open a draft PR from a backlog item | Critical | `BacklogItemRow.tsx` |

## What was fixed

1. **MAP-1 — Map stars are navigable.** Every hydrated repo star on `/launch` is now wrapped in an
   SVG `<a href={reportPermalink(fullName)}>` (transparent halo widens the hit/focus target; cursor,
   hover-brighten, keyboard focus ring). The map's "a star is a repo" metaphor finally resolves down
   to the repo report instead of only bouncing up to the org dashboard.
2. **SIM-1 — Simulation → Initiative.** The what-if simulator's `FleetProjection` gained a "Track as
   initiative" button that POSTs the exact `{ dimId, targetScore, repos }` shape it already holds to
   the existing `/api/org/initiatives`, auto-titles it, and `router.refresh()`es so it appears in the
   Initiatives panel on the same page. When scope = "all scanned", the concrete projected repos are used.
3. **PRAC-1 — Fleet rollout for practices.** New `POST /api/practices/apply-batch { repos[], practiceId }`
   fans `buildArtifact` + `openDraftPr` over a repo set with bounded concurrency (`mapPool` /
   `SCAN_CONCURRENCY`), reusing the single-apply gate + per-repo audit. All repos must share one org
   (one tenant gate), capped at 25/click, one bad repo never aborts the rest. `PracticeApply` gained a
   "Roll out to the fleet" checklist (default all gap repos) + per-repo PR result rows.
4. **PLAY-1 — Playbook rollout.** New `POST /api/org/playbooks/[id]/apply { repo }` seeds the playbook
   (title/summary/steps as a checklist) as `docs/playbooks/<slug>.md` via `openDraftPr`, gated like
   practices/apply (org-owned write, repo must belong to the org), then records the adoption mark so
   lift analytics light up and audits `playbook.pr_opened`. Added `getPlaybook(id)` to the db layer;
   `PlaybookCard` gained "Open draft PR →" beside the renamed "Mark applied".
5. **BKLG-1 — Act on a backlog item.** Each backlog row gained an "Open draft PR →" action that maps
   the item's `dimId` to its dimension practice (the 1:1 `PRACTICES` map) and reuses
   `/api/practices/apply` to seed the starter into the item's repo, then flips an `open` item to
   `in_progress` (recorded in its history) and shows the PR link inline.

## Verification (before → after)

| Gate | Baseline | After Wave 1 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `vitest run` | 450/450 (54 files) | 450/450 (54 files) |
| eslint (changed) | clean | clean |
| `next build` | ✓ | ✓ |

No tests were added — every fix reuses already-tested primitives (`openDraftPr`, `buildArtifact`,
`createInitiative`, `applyPlaybook`) over their existing routes/db helpers; the two new routes are
thin compositions of tested functions. Adding route-level tests for `apply-batch` + `playbooks/apply`
is a reasonable follow-up.

## Deferred

- **STD-1** (Critical, the 6th planned item) — deferred to a focused session. It needs a persistence
  migration (risky to run blind in this DB-less repo) + multi-surface report/rollup rendering — a
  different shape and risk profile from the wave's wire-ups. Full low-risk plan in
  `docs/harness/followups-2026-06-14.md`.

## Patterns established (catalogue)

1. **Dead-end → action via an existing primitive.** When a surface computes a decision-grade result
   (projection, ranked gap, authored standard, repo node) but offers no way to act, the fix is almost
   never new infrastructure — grep for an existing write primitive (`openDraftPr`, `createInitiative`,
   `reportPermalink`) that already takes the shape you hold, and wire a button to it.
2. **Batch = single-apply + `mapPool` + one shared tenant gate.** To turn an O(repos)-clicks action
   into one action: require all items share one org, gate once, mint the token once, then
   `mapPool(items, SCAN_CONCURRENCY, worker)` where the worker owns its errors and returns a per-item
   result row. Cap the batch; never let one failure abort the pool.
3. **Reuse the route, not just the function, when the gate matters.** BKLG-1 called the existing
   `/api/practices/apply` from a new surface rather than re-implementing the open-PR flow — inheriting
   its App-installed + signed-in + `requireOrgAccess` + audit guarantees for free.
4. **Optimistic surface refresh after a cross-panel write.** After creating an entity that another
   panel on the same page lists (sim → Initiatives panel), `router.refresh()` so the new row appears
   without a manual reload (matches the org-view optimistic-with-rollback convention).

## What remains (from the INDEX)

Waves 2–8 + optional tail are unstarted: expose dormant backends (MEM-1/ALRT-1/SEG-1/CONN-1),
notifications/email (GOAL-1/SEC-4/EXEC-1/…), monetization (CRED-1/QUOTA-1/…), planning completeness,
live ops, audit/compliance + CI gate, growth/SEO + onboarding, and the 49 mediums / 4 lows.
