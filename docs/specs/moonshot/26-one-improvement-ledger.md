# 26 — One improvement ledger: loop lanes become Bought/programme/conformance evidence

size L · effort 6 / impact 8 / risk 4 · gate **contract** · lane **W2-G** (built THIRD, after #27
then #25, by the same builder) · wave 2

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**

- `src/lib/db/org-impact.ts` — `ImpactRow` gains `source`/`basis`/`laneId`; `buildImpactLedger`
  folds the union; `getOrgImpactLedger` reads lanes as well.
- `src/lib/db/org-program.ts` — `ProgramNow`/`ProgramStatusView` gain `pointsInReview`;
  `getOrgProgramStatus` fills it from the union.
- `src/lib/org/briefing.ts` — `ExecBriefing.loopProof` + `briefingLoopProofLine()`; the markdown
  renderer prints it; the briefing's window read of compacted history uses **W1-F's (#32) helper**,
  not a second read of its own.
- `src/lib/db/loop-runs-read.ts` — `listLaneImpactInputs(orgId, window)`: the lane-side rows the
  union folds (one query for the org, not one per run).
- `src/lib/local/loop-lane.ts` — record `dominantDimId` for the lane's batch on the lane row
  (already the builder's file from #27/#25; one added field write, no flow change).
- `src/lib/pdf/briefing-document.tsx` — one `<Text>` proof line, omitted when null (**M1 applies**).
- `src/app/share/briefing/[token]/page.tsx` — renders the loop line through the shared banner.
- `src/features/bought/executive/BriefingProofBanner.tsx` — second line, same null-is-absence rule.
- `src/features/bought/executive/ImpactLedger.tsx` — source column + in-review tile (extract into a
  sibling if it passes 200 LOC; it is at 177 today).
- `src/features/bought/executive/ExecutiveTab.tsx` — passes the union ledger through unchanged.
- `src/features/inflight/live/cockpit/CockpitInspector.tsx`, `.../loopClient.ts`,
  `.../loopTypes.ts` — the "Open PR from lane" action, its confirm, and its result state.
- `docs/features/org-planning/plan.md` and `docs/features/org-planning/live.md` (doc-sync; live.md
  line 166 "Never a push." must be corrected to "never a push *unless an owner asks*").

**Files to create**

- `src/lib/db/improvement-events.ts` — the pure union fold + its reads.
- `src/lib/db/improvement-events.test.ts`
- `src/lib/local/loop-pr.ts` — push the lane branch from the paired clone and open the PR.
- `src/lib/local/loop-pr.test.ts`
- `src/app/api/org/loop/[id]/pr/route.ts` + `route.test.ts`

**Prisma columns needed (landed by the wave-2 schema pass, NOT by this lane)**

- `ImprovementPr.source String @default("practice")` — `practice | loop`.
- `ImprovementPr.loopLaneId String?` + `@@index([orgId, loopLaneId])`.
- `LoopRunLane.dimId String?` — the lane batch's dominant dimension (honest null when the batch was
  empty or spanned no dimension).
- `LoopRunLane.prNumber Int?`, `LoopRunLane.prUrl String?` — the lane's PR, so the cockpit renders
  it without a join.
- **No change to `@@unique([orgId, repoFullName, practiceId])`.** Loop rows take the synthetic
  `practiceId = "loop:<laneId>"`, which is unique by construction and idempotent under retry.

**Director-owned lines requested at merge**

- `src/lib/db/index.ts`: re-export `foldImprovementEvents`, `getImprovementEvents`,
  `recordLoopPr` from `@/lib/db/improvement-events`.
- `scripts/docs/feature-doc-map.json`: add `src/lib/db/improvement-events.ts`,
  `src/lib/db/org-impact.ts`, `src/lib/db/org-program.ts` to the `org-planning/plan.md` globs, and
  `src/lib/local/loop-pr.ts` to the `org-planning/live.md` globs.
- `context-map.json`: `filePaths` for `src/lib/db/improvement-events.ts` and
  `src/lib/local/loop-pr.ts` under the Executive Briefing / Local Autopilot contexts.
- `src/lib/db/wire-safe-dates.test.ts`: add `ImprovementEvent` to the guarded list.

**MUST NOT TOUCH**

`prisma/schema.prisma` · `prisma/init.sql` · `src/lib/db/index.ts` · `context-map.json` ·
`scripts/docs/feature-doc-map.json` · `src/lib/db/improvement.ts` (W1-E landed its outcome hook;
this lane only *reads* its rows and reuses `refreshOps` untouched) · `src/lib/github/write.ts`
(the PR opener for an already-pushed branch lives in `src/lib/local/loop-pr.ts` instead) ·
`src/lib/mcp/**` (W2-K) · `src/lib/practices/apply.ts` (W2-J2) · `src/lib/conformance/pack.ts`
(W3-M) · `src/lib/db/scans-read.ts`/`scan-digest.ts` (W1-F).

**Handoffs to other lanes**

- **W1-F (#32)**: this lane calls F's compacted-history read helper from `briefing.ts`. F ships it,
  G consumes it; G defines no second helper and F does not edit `briefing.ts`.
- **W3-M (#1)**: no code handoff — the loop PR reaches the conformance population through the normal
  `AiChange` ingest (`scans-persist.ts`); noted so M builds no second ingest for loop PRs.
- **W4-N (#3)**: `loop-pr.ts` is the only writer of `LoopRunLane.prNumber/prUrl`; N's lease columns
  stay unused here.

## Goal

Make the local loop's verified movement count as evidence everywhere the practice-PR loop already
counts — one read model behind the Impact Ledger, the programme strip and the briefing's proof
block — and give a lane branch an owner-gated path to a real reviewed PR, so agent-authored changes
enter `AiChange` and the conformance population with a named human approver.
_Competitive angle_: it closes agent run → human-reviewed PR → independent rescan → signed evidence
pack, which incumbents cannot show because they report PRs merged, not verified maturity points.

**Known gaps deleted in the same PR**

- `docs/features/org-planning/live.md` §Known gaps — the "the branch is left behind on purpose.
  Never a push." absolute at line 166 becomes the owner-gated PR step, and the gap list gains no
  replacement claim it does not honour.
- `docs/features/org-planning/plan.md` §Known gaps — no line is deleted; the doc gains the union's
  two bases and the in-review number (it currently documents no loop feed at all).

## Behaviour

### Premise check against the tree (all verified 2026-08-29)

Every premise in the finding **held**, with three corrections the design absorbs:

1. `openDraftPr` (`src/lib/github/write.ts:71`) creates a branch off base and PUTs **one file** via
   the Contents API — it cannot open a PR for a branch that already carries local commits, so "call
   `openDraftPr`" is not implementable as written. `loop-pr.ts` pushes with `runGit` and POSTs
   `/pulls` through `githubAppFetch`, reusing an open PR for the same head as `openDraftPr` does.
2. `ImprovementPr` is uniquely keyed `(orgId, repoFullName, practiceId)` and `dimId` is NOT
   nullable, so a loop row needs both a synthetic practice id and a dimension. Hence
   `practiceId = "loop:<laneId>"` and `dimId = lane.dimId` (dominant dim of the batch).
3. `refreshOps`/`verifyMergedPrs` (`src/lib/db/improvement.ts:455,514`) are practice-agnostic —
   they poll every `state:"open"` row for the org. A loop row therefore gets merge detection and
   post-merge verification **with no edit to that file**.

### Data model — the union read

`src/lib/db/improvement-events.ts`:

```ts
export type ImprovementSource = "practice-pr" | "loop";
/** merged = measured on the default branch after a merge. branch = measured on the lane's branch. */
export type ImprovementBasis = "merged" | "branch";

export interface ImprovementEvent {
  /** Dedupe key: `${repoFullName}#${afterScanId ?? "pr:" + prNumber}`. */
  key: string;
  source: ImprovementSource;
  basis: ImprovementBasis;
  repoFullName: string;
  label: string;                 // practice label, or "Loop lane · cycle N"
  dimId: string | null;          // null only when a loop lane had no dominant dimension
  dimPoints: number | null;      // null = not measurable (no baseline), never 0
  overall: number | null;        // per row only, never summed across repos
  at: string;                    // ISO — mergedAt (PR) or endedAt (lane)
  prNumber: number | null;
  prUrl: string | null;
  laneId: string | null;
  runId: string | null;
  verified: boolean;
}

export function foldImprovementEvents(
  prs: ImpactPrInput[],
  lanes: LaneImpactInput[],
): ImprovementEvent[];

export async function getImprovementEvents(
  orgSlug: string,
  window?: { start: Date | null; end: Date | null },
): Promise<ImprovementEvent[]>;

export async function recordLoopPr(input: {
  orgId: string; laneId: string; runId: string; repoFullName: string;
  dimId: string | null; prNumber: number; prUrl: string;
  beforeScanId: string | null; openedBy: string | null;
}): Promise<boolean>;
```

Rules, each unit-tested:

- **Dedupe** on `key`, then on `laneId`: once a lane's PR has merged and verified, the merged-basis
  event wins and the lane's branch-basis event is dropped — the finding's "could break", closed at
  the fold rather than at each consumer.
- **A lane contributes only with BOTH ends** scored; one end ⇒ `awaitingRescan`, never 0.
- **Honest null survives**: `dimPoints: null` = unmeasurable everywhere (org-impact rule 2); sign
  preserved (rule 3); overall never summed (rule 4). A lane's `dimId` is the dominant dimension of
  its dispatched batch, null when there isn't one (such a lane joins no `byDim` bucket).

### The two bases — and why `pointsBought` still means bought

A lane's after-scan is a scan **of the lane branch**, taken from the worktree with
`scopeCaveat: "Scanned from the loop worktree…"` (`loop-lane.ts:rescanWorktree`). That is real,
verified movement — and it is **not yet bought**, because nothing has landed on the default branch.
So, deliberately diverging from the finding's wording:

- `ImpactLedger.dimPoints` and `ProgramNow.pointsBought` stay **merged-basis only**. Counting
  branch work as bought would be the exact fabrication G4 forbids.
- The union adds `ImpactLedger.inReviewPoints: number | null` and
  `ProgramStatusView.pointsInReview: number | null`, rendered beside the bought number and labelled
  "on branches, not merged".
- The undercount the finding describes is fixed by the *route*, not by the arithmetic: once a lane
  becomes a PR and that PR merges, `verifyMergedPrs` stamps a merged-basis row against the lane's
  own `beforeScanId`, and the points move from in-review to bought with no re-measurement.

### Route

`POST /api/org/loop/[id]/pr` — `[id]` is the **run** id (same meaning as the existing
`GET /api/org/loop/[id]`); the lane is named in the body.

- Gates in order: `selfHostGuard()` → `requireSameOrigin(request)` → `dbGuard()` →
  `requireOrgRole(org, "owner")` → gate-then-constrain: `getLoopRun(id)` must have
  `orgId === await orgIdForSlug(org)`, then the lane is looked up as `{ id: laneId, runId: id }`
  → 404 on any mismatch. Pushing commits into a customer repo is owner-shaped, exactly like `start`.
- Body: `{ org, laneId, confirm }` where `confirm` must equal the lane's `repoFullName` — a typed
  confirm, because this is the first loop action that leaves the machine.
- 409s: lane has no branch, lane has 0 commits, lane not `done`, the repo has no `localPath`
  pairing, no installation token for the owner.
- Response: `{ prNumber, prUrl, reused }`.
- Audit: `recordAudit("loop.pr.opened", { runId, laneId, repoFullName, branch, prNumber, reused },
  { orgId, actorId })` — publication-shaped, so it is audited on success and on refusal-after-push.

`src/lib/local/loop-pr.ts`:

```ts
export async function openPrForLane(input: {
  orgSlug: string; lane: LoopLaneRecord; pairedPath: string; actor: string | null;
}): Promise<{ prNumber: number; prUrl: string; reused: boolean }>;
```

Steps: `runGit(pairedPath, ["push", "--set-upstream", "origin", branch])` (never `--force`; a
rejected non-fast-forward surfaces as a 409 with git's own message) → resolve the installation
token via `getInstallationIdForOwner` + `getInstallationToken` → `POST /repos/:o/:r/pulls`
(`draft: true`, body = the lane's closed follow-up ids and commit count) → on 422 reuse the open PR
for `owner:branch` → `recordLoopPr(...)`. Never throws past the route; every failure is a typed
`AppApiError` the route maps.

### UI

Cockpit lane inspector (`src/features/inflight/live/cockpit/CockpitInspector.tsx`): a
`Button variant="secondary"` **Open PR from lane**, visible only when `phase === "done"`,
`branch != null`, `commits > 0` and no `prUrl` yet; it opens a `Dialog` typed-confirm on the repo
name, then shows the PR link inline. Once `prUrl` is set the button is replaced by a link. All
`@/components/ui` primitives, `TILE_LEDGER` chrome, `LEVEL_HEX`/`scoreHex` untouched.

Impact Ledger (`ImpactLedger.tsx`): a `source` column rendering a `Kicker`-sized tag
("Practice" / "Loop"), and one extra tile "In review (on branches)" that renders an em dash when
`inReviewPoints` is null. The ledger's four refusals in its header comment stay verbatim.

Briefing: `briefingLoopProofLine(b.loopProof)` returns null unless at least one loop lane has both
ends, so the line is absent rather than "0 · 0" — same contract as `briefingProofLine`. Printed by
the exec banner, the PDF, the share page and the markdown from **one** function.

### Self-hosted, plan gates, privacy

The loop is self-hosted-only (`selfHostGuard` 404s on cloud), so the loop half of the union is
empty on managed cloud and every surface degrades to today's behaviour. No new plan gate
(`selfHosted()` turns them off anyway); no cross-org aggregate, so `CHAMPION_MIN_POP` does not
apply; loop rows are erased with their `LoopRun` and the union caches nothing.

## Build order

1. `improvement-events.ts` — types + `foldImprovementEvents` + tests. Pure, no DB. Landable alone.
2. `listLaneImpactInputs` in `loop-runs-read.ts` (org-scoped, window-filtered, one scan-score query
   for the whole set — the same batching `listLoopRuns` already uses).
3. `getImprovementEvents` + repoint `buildImpactLedger`/`getOrgImpactLedger` onto the union; add
   `source`/`basis`/`inReviewPoints`. Ledger tests extended first (fail-before).
4. `ProgramNow.pointsInReview` in `org-program.ts` + the strip's second number.
5. `briefing.ts`: `loopProof` + `briefingLoopProofLine`; markdown, banner, share page, PDF.
   **Re-run Dana's journey (M1) before this step is called done.**
6. `loop-pr.ts` + `recordLoopPr`; `LoopRunLane.dimId` written by `loop-lane.ts` at dispatch.
7. `POST /api/org/loop/[id]/pr` + route tests (gate, tenancy, confirm, 409 matrix, audit row).
8. Cockpit button + `loopClient`/`loopTypes`.
9. Docs: `live.md` (the push step, the corrected absolute), `plan.md` (union, two bases, in-review).

## Tests

- **New** `src/lib/db/improvement-events.test.ts` — fold: dedupe by lane when merged + branch rows
  coexist; one-ended lane counted as awaiting, never 0; null `dimPoints` never coerced; sign kept;
  `overall` never summed. **Fail-before**: with the fold absent, a lane with both ends contributes
  nothing to the event list.
- **Extend** `src/lib/db/org-impact.test.ts` — `inReviewPoints` is null (not 0) with no loop lane;
  bought total excludes branch-basis rows. **Fail-before**: today's builder has no `basis`, so the
  "branch points are not bought" assertion cannot compile against it.
- **Extend** `src/lib/db/org-program.test.ts` — `pointsInReview` null-vs-0 mirrors line 133–134's
  existing `pointsBought` pair.
- **Extend** `src/lib/org/briefing.test.ts` — `briefingLoopProofLine` returns null with no
  two-ended lane; prints signed lift and lane count otherwise.
- **New** `src/lib/local/loop-pr.test.ts` — push failure → 409 carrying git's stderr; 422 on create
  reuses the open PR; `recordLoopPr` writes `source:"loop"`, `loopLaneId`, and
  `baselineScanId = lane.beforeScanId`.
- **New** `src/app/api/org/loop/[id]/pr/route.test.ts` — cloud 404; non-owner 403; cross-origin 403;
  a lane belonging to another org's run 404s (gate-then-constrain); wrong `confirm` 400; audit row
  written.
- **Conformance population** — asserted in `loop-pr.test.ts` (the recorded row carries the fields
  `AiChange` ingest needs); `src/lib/conformance/pack.ts` and its test belong to W3-M.
- **Structural guards touched**: `src/app/api/org/id-routes-gated.test.ts` (auto-discovers the new
  `[id]` route — it must contain a listed gate); `src/lib/db/wire-safe-dates.test.ts`
  (`ImprovementEvent.at` is a `string`); the doc-sync Stop hook.
- **Cockpit DOM**: a sibling of `CockpitOutcome.dom.test.tsx` for the button's visibility matrix
  (each file ≤200 LOC).
- **UAT**: **Dana (M1)** — mandatory, the briefing PDF changes. Sam's cockpit journey re-run for the
  new lane action. Tomáš only if pack copy changes (it should not).

## Gate + done criteria

`npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks (300 `.tsx`,
200 under `src/features/**` — `ImpactLedger.tsx` at 177 and `CockpitInspector.tsx` are the two to
watch) → e2e for the cockpit + briefing surfaces. Done when: a loop lane with both ends appears in
the Impact Ledger tagged `Loop / branch`; opening its PR and merging it moves those points from
in-review to bought without re-measurement; the briefing (page, PDF, share, markdown) prints one
loop proof line or none at all; and the merged loop PR appears in the `AiChange` population with an
approver after the next default-branch scan.

## Out of scope

- **#28 Durable scheduled drives bound to the programme's cadence** (deferred) — this lane adds no
  scheduler and no automatic PR opening; every push is one owner click.
- **#22 Developer-held credential lane** (concept-doc) — the push uses the operator's own git
  credentials on the paired clone and the App installation token for the PR. No user-to-server
  token work here.
- **#6 Signed maturity attestation** / **#31 Signed tenant history bundle** (deferred) — the union
  is a read model, not a signed artifact.
- **#1 Governance evidence ledger** (W3-M) — feeds the existing `AiChange` path only: no
  `GovernanceEvent`, no hash chain, no pack row. **#9** (W1-E) — outcomes stay W1-E's table.
  **#3** (W4-N) — no leases, no executor column use, no MCP tool.
- **#29 Score-input ledger** / **#30 Reproducibility certificate** (deferred) — the branch-basis
  caveat is stated in prose, not measured as a noise band.
