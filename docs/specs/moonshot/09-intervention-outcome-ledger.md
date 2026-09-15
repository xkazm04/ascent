# 09 — Intervention Outcome Ledger: measured lift per recommendation

size XL · effort 8 / impact 9 / risk 5 · gate **policy** · lane **W1-E** · wave **1**

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**

- `src/lib/db/improvement.ts` — `verifyMergedPrs()` only: after stamping `impactDim/impactOverall`,
  call `recordOutcome({ kind: "practice", … })`. No change to `computePrImpact`.
- `src/lib/org/skill-outcomes-load.ts` — `getOrgSkillOutcomes()` only: mirror `status: "measured"`
  outcomes into the ledger (fire-and-forget, idempotent).
- `src/lib/db/sandbox-scenario.ts` — `getSandboxScenario()` only: when `actualSince()` resolves a
  non-null `actual`, mirror it as `kind: "scenario"`.
- `src/components/report/roadmapPriority.tsx` — add `measuredPriorityScore` + `sortRoadmap`.
- `src/components/report/roadmapPieces.tsx` — render the basis clause under a roadmap row.
- `src/components/report/RecommendationTracker.tsx` — pass lifts through (296 LOC today; the
  addition is ≤6 lines — if it would cross 300, extract the row header first).
- `src/lib/report/llm-markdown.ts` — one `expectedLift` clause on each roadmap line.
- `src/app/api/recommendations/route.ts` — attach `expectedLift`, accept `?sort=measured`.
- `docs/features/reporting/report.md` — measured-outcome methodology section.

**Files to create**

- `src/lib/db/outcomes.ts` — `recordOutcome`, `listOrgOutcomes`, `backfillOutcomes`.
- `src/lib/outcomes/index.ts` — barrel (pure re-exports only; never re-export `db/outcomes.ts`).
- `src/lib/outcomes/aggregate.ts` + `aggregate.test.ts` — pure distributions + floors.
- `src/lib/outcomes/expected-lift.ts` + `expected-lift.test.ts` — pure basis-clause formatting.
- `src/lib/outcomes/reconcile-recs.ts` — the `kind: "recommendation"` writer (server, DB).
- `src/lib/outcomes/expected-lift-load.ts` — server read: org lifts keyed by `identityKey`.
- `src/components/report/ExpectedLiftBasis.tsx` — the render primitive.
- `src/components/report/roadmapPriority.measured.test.ts`.

**Prisma (landed by the wave-1 schema pass, not by this lane)** — model `InterventionOutcome`
(fields in *Behaviour*), `@@unique([orgId, kind, identityKey, beforeScanId, afterScanId])`,
`@@index([orgId, kind, dimId])`, `@@index([identityKey, dimId])`, `@@index([orgId, recordedAt])`;
matching `prisma/init.sql` DDL + PGlite reconcile; a `wire-safe-dates.test.ts` entry for
`InterventionOutcomeRow` (all four timestamps declared `string`).

**Director-owned lines requested at merge**

- `src/lib/db/index.ts`: export `recordOutcome`, `listOrgOutcomes`, `backfillOutcomes` from
  `./outcomes`.
- `context-map.json`: add `src/lib/outcomes/**` to the *Roadmap & Recommendation Tracking* context's
  `filePaths`.
- `scripts/docs/feature-doc-map.json`: add `src/lib/outcomes/**` and `src/lib/db/outcomes.ts` to the
  `reporting/report.md` entry's `sourceGlobs`.

**MUST NOT TOUCH**

- `src/lib/report/compare.ts` — **not one line.** `reconcileDoneRec` and `normalizeRecTitle` are
  imported read-only. W2-J1 extracts `diffScans`' set logic in wave 2.
- `src/lib/practices/apply.ts` and `src/lib/db/practice-adoption.ts` (W2-J2).
- `src/lib/db/scans-persist.ts`, `scans-read.ts`, `retention.ts`, `prisma/*`, `db/index.ts`,
  `context-map.json`, `feature-doc-map.json`.
- `src/lib/org/skill-outcomes.ts` (pure; W1-D's Skills surface reads it) — only its **loader** is
  edited.

**Handoffs to other lanes**

1. **W1-F (retention)** — purge/erase must cascade: `deleteMany` on `InterventionOutcome` where
   `beforeScanId` or `afterScanId` is a purged scan, and org-erase must delete by `orgId`. This lane
   ships the row shape and the two indexes; W1-F owns `retention.ts`.
2. **W1-D (registry/skills)** — the Skills tab should read `listOrgOutcomes({ kind: "skill" })`
   instead of recomputing, and delete `docs/features/org-knowledge/skills.md:265` ("the aggregation
   half … has no caller anywhere in `src/`") — this lane gives `aggregateOutcomes` its first caller.
   W1-D should also delete the **stale** gap at `skills.md:239`: `HistoryPoint` *does* carry
   `rubricVersion` (`src/lib/db/scans-read.ts:280-285`) and the loader *does* pass it
   (`skill-outcomes-load.ts:34-39`), so "every production pair currently reads instrument-unknown"
   is false today.
3. **W2-J2 (practice adoption)** — `PracticeAdoption` should read the same ledger for post-merge
   drift rather than re-deriving from `ImprovementPr`.
4. **W2-J1 (exemplar)** — both lanes edit `src/lib/report/llm-markdown.ts`; W1-E lands first (wave 1)
   and touches only the roadmap loop, so J1 rebases onto it.
5. **W2-G (loop lane)** — a `kind: "lane"` outcome for loop lanes is deliberately not defined here;
   G may add it later against the same writer.

## Goal

Turn "this practice moves D2" from a model label into a measured, cited expectation: one additive
fact table written by the four loops that *already* compute an honest before/after delta, a pure
aggregator with k-anonymity floors, and an `expectedLift` basis clause on every roadmap item that has
measured peers — with no number at all where there are none. Competitive angle: Factory, DX, Swarmia
and Sonar all recommend practices; none can cite "closed D2 by +11 across 37 comparable repos under
the same instrument", because none owns a rescan loop over a rubric-versioned corpus.

**Known gaps deleted:** `docs/features/org-knowledge/skills.md:265` (aggregation half has no caller —
via handoff 2). `docs/features/reporting/report.md` gains the methodology section and, at the end of
this lane, no longer describes the roadmap ordering as label-only (`report.md:246-247`).

## Premise check (verified against the tree, 2026-08-29)

Held: `verifyMergedPrs` stamps `impactDim/impactOverall` (`improvement.ts`, ~:514-556);
`getOrgSkillOutcomes` pairs scans with instrument-identity checks (`skill-outcomes-load.ts:48`);
`actualSince` computes projected-vs-actual (`sandbox-scenario.ts:~106-133`); `priorityScore` is
`IMPACT_RANK*10 − EFFORT_RANK` from LLM labels (`roadmapPriority.tsx:11-16`); `llm-markdown.ts`
emits the same labels (`:135-143`); `recommendationMatchKey` is pure (`rec-identity.ts`); no outcome
table exists in `prisma/schema.prisma`; floors are `COHORT_MIN = 5` / `GAP_MIN_REPOS = 3`
(`org-insights.ts:805,1141`) and `CHAMPION_MIN_POP = 3`.

**FALSE — redesigned.** The dossier calls `compare.ts:73 reconcileDoneRec` a "write hook". It is a
**pure, client-imported** function with no DB access; its only callers are a client component
(`recommendationRowUi.tsx:108`) and `diffScans` (`compare.ts:451`), which runs inside a page render
(`src/app/report/compare/page.tsx:113`) and `loop-runs-read.ts:180`. There is no write seam there,
and writing from a page render would be wrong. **Redesign:** the `recommendation` outcome is produced
by a new server reconciler, `src/lib/outcomes/reconcile-recs.ts`, driven off the durable
`RecommendationEvent` (`kind: "status"`, `toValue: "done"`) rows that already exist, and invoked from
the same tick that calls `verifyMergedPrs`. Same semantics (`reconcileDoneRec` is imported to classify
the pair), no page-render write, `compare.ts` untouched — which also removes this lane's only file
overlap with W2-J1.

## Behaviour

### Data model — `InterventionOutcome` (append-mostly, additive)

| field | type | notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `orgId` | `String` | tenant scope; denormalized like `ImprovementPr.orgId` |
| `repoFullName` | `String` | `owner/name` |
| `kind` | `String` | `practice \| skill \| recommendation \| scenario` |
| `identityKey` | `String` | `practice`→`practiceId`; `skill`→`skillId`; `recommendation`→`recommendationMatchKey(dimId,title)`; `scenario`→sorted `itemKeys` joined + hashed with `fnv1a` |
| `dimId` | `String?` | **honest null** = whole-scan outcome (scenario), not "0" |
| `beforeScanId` / `afterScanId` | `String` | the measured bookends |
| `interventionAt` | `DateTime` | merge / adoption / done-event / scenario-save instant |
| `overallDelta` | `Int` | `after.overallScore − before.overallScore` |
| `dimDelta` | `Int?` | null when `dimId` is null **or** the dim is absent on either side |
| `rubricVersion` / `engineProvider` | `String` | the instrument **both** sides agreed on |
| `gapDays` | `Int` | whole days `before.scannedAt → after.scannedAt` |
| `withinBound` | `Boolean` | reuses `skill-outcomes.ts`' pairing bound |
| `isPrivateRepo` | `Boolean` | copied from `Repository.isPrivate` at write time; the corpus filter |
| `sourceRowId` | `String?` | `ImprovementPr.id` / adoption id / `Recommendation.id` — provenance |
| `recordedAt` / `updatedAt` | `DateTime` | |

**The table holds measured facts only.** A row is written **only** when both bookends exist *and*
`rubricVersion` and `engineProvider` match on both sides. Unmeasured cases keep their existing named
statuses in the readers that compute them (`OutcomeStatus`) and produce **no row** — so the aggregate
can never be diluted by a fabricated zero (G4). `mockPrsEnabled()`'s simulated-merge ±0 branch
(`improvement.ts`) is **excluded**: it compares a scan against itself.

**Idempotency:** `@@unique([orgId, kind, identityKey, beforeScanId, afterScanId])`; `recordOutcome`
upserts on it. Re-running a read path that mirrors outcomes therefore writes nothing new.

**Wire type** `InterventionOutcomeRow` declares `interventionAt`, `recordedAt`, `updatedAt` as
`string` and is mapped by `toRow()` with `.toISOString()` (wire-safe-dates guard).

### Modules

```ts
// src/lib/db/outcomes.ts  (server)
export async function recordOutcome(input: OutcomeInput): Promise<void>;          // upsert, dbWriteSafe
export async function recordOutcomes(inputs: OutcomeInput[]): Promise<void>;      // bounded via mapPool
export async function listOrgOutcomes(
  orgSlug: string, opts?: { kind?: OutcomeKind; dimId?: string; limit?: number },
): Promise<InterventionOutcomeRow[]>;                                             // dbReadSafe → []
export async function backfillOutcomes(orgSlug: string): Promise<{ written: number }>;

// src/lib/outcomes/aggregate.ts  (pure — no Prisma, client-importable)
export const OUTCOME_MIN_SAMPLES = 3;   // matches GAP_MIN_REPOS' reasoning
export const OUTCOME_MIN_ORGS = 5;      // matches COHORT_MIN
export interface LiftDistribution {
  identityKey: string; dimId: string | null; n: number; orgs: number;
  medianDim: number | null; p25: number | null; p75: number | null;
  medianOverall: number; instrument: { rubricVersion: string; engineProvider: string };
}
export function aggregateLift(
  samples: OutcomeSample[],
  opts: { scope: "org" | "corpus" },
): Map<string, LiftDistribution>;        // key = `${identityKey}::${dimId ?? "-"}::${instrument}`

// src/lib/outcomes/expected-lift.ts  (pure)
export function expectedLiftClause(d: LiftDistribution | null | undefined): string | null;
export function measuredRank(d: LiftDistribution | null | undefined): number | null;

// src/lib/outcomes/reconcile-recs.ts  (server)
export async function reconcileRecommendationOutcomes(orgId: string): Promise<{ written: number }>;
```

`aggregateLift` **partitions by instrument** (`rubricVersion` + `engineProvider`) before computing
anything — never a median across a rubric bump — and drops any partition below the floor: org scope
`n < OUTCOME_MIN_SAMPLES`, corpus scope `orgs < OUTCOME_MIN_ORGS` **or** any `isPrivateRepo` sample.
Below the floor the key is **absent from the map**, not present with nulls, so a caller cannot render
a distribution it isn't allowed to see.

`expectedLiftClause` returns `null` for null/absent input — **G4**: no measured peers degrades to
absence, never to "+0". Format: `D2 +11 median (IQR +6…+15) across 37 measured closes · r10 · claude`.

### Read side

- `expected-lift-load.ts` builds the org's lift map once per request and keys it by
  `recommendationMatchKey(dimension, title)` — the same identity the sandbox and carry-forward use.
- `sortRoadmap(items, lifts, mode)` in `roadmapPriority.tsx`: `mode: "priority"` is today's
  `priorityScore`, unchanged and still the default; `mode: "measured"` orders by `measuredRank`
  (median dim lift) and **falls back to `priorityScore` for every item with no distribution**, so a
  measured sort never buries an unmeasured item behind a fabricated zero.
- `GET /api/recommendations?repo=&sort=measured` — auth unchanged (`canReadOrg(owner)` → org slug,
  else `PUBLIC_ORG`); adds `expectedLift: string | null` per item and `sort` to the response. No new
  `[id]` route, so `id-routes-gated` is untouched.
- `llm-markdown.ts`: one appended clause on the roadmap line —
  `` `   - _measured:_ ${clause}` `` — emitted only when the clause is non-null.

### UI

Report tab → *Gaps to explore* (`RoadmapSteps` and `RecommendationTracker`, both via
`roadmapPieces.tsx`). New `ExpectedLiftBasis` renders one line under `RoadmapMeta`, styled like the
existing chip row (`text-sm text-slate-400`, `Kicker` for the "measured" label from
`@/components/ui`); the signed delta reuses `src/components/report/deltas.tsx`. **No hand-picked
hex** — any score colour comes from `scoreHex`/`LEVEL_HEX` (`@/lib/ui`). A sort toggle sits in the
roadmap header, defaulting to `priority`; it renders only when at least one item has a clause.

### Gates, self-hosted, privacy, audit

- **No plan gate.** The ledger is an honesty surface, not a paid one; `selfHosted()` turns plan gates
  off anyway.
- **Corpus scope is designed here and NOT shipped here.** `aggregateLift({ scope: "corpus" })` exists
  and is tested, but this lane wires **only** the org-local caller. Cross-tenant aggregation needs the
  consent model, rubric-versioned snapshots and publication contract from concept-doc item **#2 (open
  benchmark corpus)**; until that lands, no code path reads outcomes across `orgId`. This is the
  single highest-risk surface of the item and it stays dark on purpose.
- **Privacy floors:** corpus scope excludes every `isPrivateRepo` sample and requires
  `OUTCOME_MIN_ORGS = 5` distinct orgs; org scope requires `OUTCOME_MIN_SAMPLES = 3` and never leaves
  the tenant. Corpus is disabled entirely under `selfHosted()`.
- **Audit:** no `AuditLog` row for org-local writes (derived measurement, no security/spend/publication
  effect). `backfillOutcomes` writes one `recordAudit` row (`action: "outcomes.backfill"`, meta =
  counts) because it is an operator action over historical data.

## Build order

1. **Schema pass dependency:** confirm `InterventionOutcome` + indexes + `init.sql` + PGlite reconcile
   + wire-safe-dates entry landed before starting. (Director.)
2. `src/lib/outcomes/aggregate.ts` + tests — pure, no callers yet. Gateable alone.
3. `src/lib/outcomes/expected-lift.ts` + tests — pure formatting; the G4 null case first.
4. `src/lib/db/outcomes.ts` (`recordOutcome`, `listOrgOutcomes`), request the barrel line.
5. Wire hook 1 (`improvement.ts` `verifyMergedPrs`) and hook 4 (`sandbox-scenario.ts`). Both already
   hold both scan ids at the write point.
6. Wire hook 2 (`skill-outcomes-load.ts`, `status === "measured"` only) and hook 3
   (`reconcile-recs.ts`, invoked from the same tick as `verifyMergedPrs`).
7. `backfillOutcomes`: replay `ImprovementPr` rows with a non-null `verifiedScanId` and every
   `SandboxScenario` with a resolvable `actual`. Idempotent by the unique key.
8. `expected-lift-load.ts` + `/api/recommendations` (`expectedLift`, `?sort=measured`).
9. `roadmapPriority.tsx` (`sortRoadmap`, `measuredPriorityScore`) → `roadmapPieces.tsx`
   (`ExpectedLiftBasis`) → `RecommendationTracker.tsx` wiring → `llm-markdown.ts` clause.
10. `docs/features/reporting/report.md` methodology section; handoff notes filed.

## Tests

**Unit (new)**

- `src/lib/outcomes/aggregate.test.ts` — **fail-before:** four distinct orgs at corpus scope must
  yield an *absent* key (today: nothing exists, so the guard is written before the caller); a private
  sample must not reach a corpus partition; two samples under different `rubricVersion` must produce
  two partitions, never one median; org scope with `n = 2` is absent.
- `src/lib/outcomes/expected-lift.test.ts` — **fail-before:** zero measured samples must return
  `null`, never `"+0"` (G4); the clause must carry `n` and the instrument in the same string, so a
  median cannot be rendered without its basis (the `meanDeltaLine` pattern).
- `src/components/report/roadmapPriority.measured.test.ts` — **fail-before:** `sortRoadmap(…,
  "measured")` on a list where no item has a distribution must return byte-identical order to
  `"priority"`; an item with a distribution must not displace an unmeasured high-impact item to the
  bottom (fallback ordering preserved).

**Unit (extended)**

- `src/lib/org/skill-outcomes-load.test.ts` — the recorder is called for `measured` outcomes only,
  and never for `instrument-mismatch` / `instrument-unknown`.
- `src/app/api/recommendations/route.test.ts` (create if absent) — `?sort=measured` with no ledger
  rows returns the priority order and `expectedLift: null` on every item.

**Structural guards**

- `src/lib/db/wire-safe-dates.test.ts` — `InterventionOutcomeRow` added (Director/schema pass); this
  lane's `toRow()` must satisfy it.
- `src/app/api/org/id-routes-gated.test.ts` — unaffected (no new `[id]` route).
- doc-sync — `docs/features/reporting/report.md` is in the same turn as every source edit.
- LOC — `RecommendationTracker.tsx` is 296/300; check before commit.

**e2e / UAT** — re-run **Sam (staff engineer)**'s roadmap journey: the roadmap must read identically
when nothing is measured, and the basis clause must never appear without its `n` and instrument. Not
Dana's (M1 does not bind: `briefing.ts` and the PDF are untouched).

## Gate + done criteria

`npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks (300 `.tsx` /
200 `src/features/**`; this lane writes nothing under `src/features/`) → e2e (report UI moved).
**Done:** the four loops write rows; `backfillOutcomes` is idempotent on a second run; every roadmap
item either carries a full basis clause or carries nothing; no code path reads `InterventionOutcome`
across `orgId`; the two handoff notes to W1-D and W1-F are filed in the builder handoff.

## Out of scope

- **#2 Open benchmark corpus** (concept-doc): consent, rubric-versioned snapshots, the public
  percentile API and federation. The corpus aggregate is a *later step* that consumes this table.
- **#34 Exemplar diff** (W2-J1) — peer/cohort signal comparison and the `compare.ts` set-logic
  extraction.
- **#33 Practice adoption ledger** (W2-J2) — post-merge drift and versioned house patterns.
- **#26 One improvement ledger** (W2-G) — loop lanes as programme evidence.
- **#19 Live invoke channel / #36 lessons mirror** (W1-D) — skill usage and dormancy signals.
- Deferred deck items this must not absorb: **#29 score-input ledger**, **#30 reproducibility
  certificate**, **#31 signed tenant history bundle**, **#6 signed maturity attestation**,
  **#24 billing account above the tenant**, **#37 data-bound deck diagrams**.
- Backlog **B6** (`scoreIntegrity` rendering) and **B14** (roadmap "first step" field): adjacent to the
  same rows, owned elsewhere, not touched here.
