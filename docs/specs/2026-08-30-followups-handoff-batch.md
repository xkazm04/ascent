# Follow-ups hand-off: one membership-scoped read, CAS-guarded batch write

_Wave-3 structural item 8 (`ai-registry/librarian/impact/2026-08-29-architecture-round.md`).
Registry techniques: `software-engineering/data-access/transactions-and-units-of-work`
(read-modify-write is a transaction; the CAS predicate carries the precondition; the verdict is
part of the write) and `software-engineering/data-access/batching-and-n-plus-one` (membership
reads: `fetch all by ids` as one keyed query, not N singles)._

## Current state

`src/app/api/org/followups/handoff/route.ts:48-68` (POST, up to 50 ids):

1. **Per-id ownership loop** (`:50-55`): one `getRecommendationOrgSlug(id)` query per id — N round
   trips for a membership question one `IN` query answers (the batching technique's textbook
   origin: only `fetch one by id` existed on the surface).
2. **Separate status read** (`:58`): a `findMany` on the raw client (`getPrisma()` — this route is
   on the eslint grandfather list for importing `@/lib/db/client`).
3. **Per-id unguarded writes** (`:61-68`): for each id read as `open`, `updateRecommendation(id,
   {status:"in_progress"})`. The route's idempotency rule ("done/dismissed are NOT reopened") is
   enforced only by the stale step-2 read: `updateRecommendation` itself re-reads the row and its
   internal CAS only detects writes racing *its own* window, so a row that moved `open → done`
   between step 2 and step 3 is silently **reopened** (`done → in_progress`, with a timeline event
   claiming `from: done`... actually claiming the transition) — exactly the lost-update /
   stale-read-feeds-a-write shape the transactions technique names ("any read whose result feeds a
   write belongs inside the same boundary as that write, or the write carries the predicate").

Total: up to 2N+1 queries (N ownership + 1 read + N read-modify-write calls, each of which is
itself 1 read + 1 tx), and a race window per id.

## Target shape

One repository function owns the whole unit of work; the route keeps only transport concerns
(validation, `requireOrgAccess`, response codes).

New in `src/lib/db/scans-recommendations.ts`:

```ts
export type HandoffOutcome =
  | { ok: true; marked: string[]; skipped: { id: string; status: string }[] }
  | { ok: false };            // some id missing or foreign → whole-request refusal

export async function handoffRecommendations(
  orgSlug: string, ids: string[], opts?: RecommendationActor,
): Promise<HandoffOutcome | null>   // null = DB unconfigured (matches updateRecommendation)
```

Semantics:

1. **One membership-scoped batch read**: `findMany({ where: { id: { in: ids } }, select: { id,
   status, scan.repo.orgId, scan.repo.org.slug } })` — ownership + current status in one round
   trip. Any requested id absent from the result, or owned by a different org (same trim/lowercase
   comparison as `getRecommendationOrgSlug` callers), returns `{ ok: false }` — the route 403s the
   whole request, preserving the no-enumeration property documented in the route header.
2. **Pre-split**: ids read as non-`open` go straight to `skipped` (with their status) — never
   touched, per the route's idempotency contract.
3. **The write set runs inside one `$transaction`**, with a **per-row CAS**: for each candidate,
   `updateMany({ where: { id, status: "open", scan: { repo: { orgId } } }, data: { status:
   "in_progress" } })`. The `WHERE` carries both guards the technique demands: the expected state
   (`status: "open"` — a row that moved concurrently loses loudly, count 0) and ownership
   (`orgId` from the verified read — immutable in practice, kept in the predicate so the write is
   self-authorizing, not authorized-by-earlier-read). `count === 0` → re-read the row's current
   status inside the tx and report it in `skipped` — the CAS verdict is consumed, never discarded.
4. **Timeline events + audit commit atomically with the status changes**, in the same transaction
   (the invariant `updateRecommendation` already pins): one `recommendationEvent` row per marked id
   (`kind: "status"`, `open → in_progress`, the hand-off note), and one `auditLog` row per marked
   id with the same `action: "recommendation.updated"` / `meta: { id, actor, changes }` shape
   `updateRecommendation` writes, so the audit viewer sees identical rows. `orgId` for audit
   tenant scope comes from the batch read's `scan.repo.orgId` chain.
5. No external side effects inside the boundary; errors propagate to the route (500), which then
   reports nothing as marked — never a half-claimed success.

Route (`src/app/api/org/followups/handoff/route.ts`): drop the `getPrisma`/`getRecommendationOrgSlug`/
`updateRecommendation` plumbing, call `handoffRecommendations`, map `{ ok: false }` → the existing
403 body, `{ ok: true }` → the existing `{ marked, skipped }` body. The route no longer imports
`@/lib/db/client`, so its entry in `eslint.config.mjs`'s grandfather list is removed (ratchet
tightens by one).

Convention notes (deliberate matches to the tree): no `withRetry` around the tx and default
isolation — the CAS predicates carry the preconditions, same as `updateRecommendation`; the
sequential per-row CAS inside one tx is bounded by `MAX_BATCH = 50`.

## Out of scope

- Changing the response wire shape, the 403 message, or `MAX_BATCH`.
- Touching `updateRecommendation` (the per-item PATCH path keeps its own CAS).
- The other grandfathered `@/lib/db/client` importers.

## Acceptance checks

- New tests in `src/lib/db/scans-recommendations.test.ts` (same mock harness):
  1. A foreign or unknown id → `{ ok: false }` and **no** transaction is opened.
  2. Open ids are CAS-updated with `status: "open"` + org scope in the `where`; event rows and
     audit rows land on the **same tx object** as the updates.
  3. A CAS returning `count: 0` puts the id in `skipped` with its re-read status and writes **no**
     event for it (the reopen race is closed).
  4. Ids read as non-open are skipped without any write.
  5. DB unconfigured → `null`.
- `npx tsc --noEmit` clean; scoped vitest run green; eslint clean with the route removed from the
  grandfather list.
