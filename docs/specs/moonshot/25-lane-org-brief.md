# 25 — Org-brief for every lane: playbooks/house pattern/memory in; lessons and declines out

size XL · effort 8 / impact 9 / risk 5 · gate **contract** · lane **W2-G** · wave **2**
_Built SECOND in W2-G: after #27 (remediation economics) and before #26 (one improvement ledger),
by the same builder. #27 lands `LoopRunLane.model/costCents` and the cost record in `runLane`; this
spec's `runLane` edits sit on top of that diff, and #26 later reads the outcome rows this adds._

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/lib/local/loop-lane.ts` — `runLane` (brief assembly + prompt addendum + report parse +
  write-back), `openBatch` (decline-aware filter), `LaneDeps` (+ `loadBrief`, `readReport`).
- `src/app/api/org/loop/propose/route.ts` — the proposal carries a brief PREVIEW per repo.
- `src/lib/db/playbooks.ts` — one new export `stampPlaybookApplications()` (the verified-close
  stamp). `applyPlaybook` itself is unchanged.
- `src/features/inflight/live/cockpit/CockpitOutcome.tsx`, `CockpitInspector.tsx`,
  `LiveCockpit.tsx`, `loopTypes.ts`, `loopClient.ts`, `index.ts` — provenance chip, per-item
  verdict ledger, lessons review. `LiveCockpit.tsx` is at 195 LOC; extract before adding.
- `docs/features/org-planning/live.md`, `docs/features/local-mode/README.md`,
  `docs/features/org-followups/README.md` (deletes a Known gap — see Goal).

**Files to create**
- `src/lib/org/lane-brief.ts` — pure assembly + render (no Prisma import).
- `src/lib/db/lane-brief-read.ts` — the four reads the brief needs (`-load.ts` sibling pattern, so
  `next build` never drags Prisma into a client chunk — `build-not-in-gate`).
- `src/lib/local/lane-report.ts` — `.ascent/lane-report.json` reader + never-throw parser.
- `src/lib/db/lane-outcomes.ts` — `LaneItemOutcome` writes/reads + the decline window.
- `src/lib/db/loop-lessons.ts` — `OrgMemoryCandidate` writes/reads (candidates only; **never**
  `createOrgMemory`).
- `src/app/api/org/loop/lessons/route.ts` — GET list · POST `{ action: "keep" | "discard" }`.
- `src/features/inflight/live/cockpit/CockpitLessons.tsx`, `CockpitVerdicts.tsx`.
- Tests (paths detailed under Tests): `lane-brief.test.ts`, `lane-report.test.ts`,
  `loop-lane.brief.test.ts`, `lane-outcomes.test.ts`, `loop/lessons/route.test.ts`,
  `CockpitLessons.dom.test.tsx`.

**Prisma models/columns needed (landed by the wave-2 schema pass, NOT by this lane)**
- `LoopRunLane.briefJson String @default("{}")` — the brief's PROVENANCE (which playbook+version,
  which mined practice + exemplar count, which memory ids, which skills, byte sizes), not its prose.
- `LoopRunLane.reportJson String @default("{}")` — the parsed `.ascent/lane-report.json`, verbatim
  after validation, so a verdict is auditable against what the agent actually wrote.
- `model LaneItemOutcome { id String @id @default(uuid()) · orgId · runId · laneId ·
  repoFullName · recommendationId (all String) · cycle Int · verdict String ·
  reason String @default("") · filesJson String @default("[]") · deferUntil DateTime? ·
  createdAt DateTime @default(now()) · @@unique([laneId, recommendationId]) ·
  @@index([orgId, recommendationId]) · @@index([runId]) }` — `verdict` ∈
  `resolved | skipped | needs_human | attempted | absent`.
- `model OrgMemoryCandidate { id String @id @default(uuid()) · orgId String · namespace String? ·
  content String · kind String @default("procedural") · source String · laneId String? ·
  status String @default("pending") · promotedMemoryId String? · reviewedBy String? ·
  reviewedAt DateTime? · createdAt DateTime @default(now()) · @@index([orgId, status]) }` —
  `status` ∈ `pending | kept | discarded`. Generic by design: #36's `skill-lessons` channel can
  reuse it; this spec does not depend on that.
- `LaneItemOutcome` and `OrgMemoryCandidate` are standalone under `relationMode = "prisma"`
  (denormalized `orgId`, no DB FKs) — same posture as `PlaybookApplication` / `ImprovementPr`.

**Director-owned lines requested at merge**
- `src/lib/db/index.ts`: re-export `lane-brief-read.ts`, `lane-outcomes.ts`, `loop-lessons.ts`.
- `src/lib/db/wire-safe-dates.test.ts`: add `LaneOutcomeRow`, `LoopLessonRow`, `LaneBriefProvenance`.
- `context-map.json`: add the three new `src/lib/{org,db,local}` modules to the Playbooks / Local
  Autopilot & Loop Engine entries (`docs/features/org-planning/README.md` entry points are already
  noted as stale in the BACKLOG group-06 defect list — not fixed here).
- `scripts/docs/feature-doc-map.json`: `src/lib/org/lane-brief.ts` + `src/lib/db/lane-*.ts` →
  `docs/features/org-planning/live.md`; `src/app/api/org/loop/**` is already mapped.

**MUST NOT TOUCH** — `prisma/schema.prisma`, `prisma/init.sql`, `src/lib/db/index.ts`,
`context-map.json`, `feature-doc-map.json`, `wire-safe-dates.test.ts` (all Class B) ·
`src/lib/mcp/**` (W2-K) · `src/lib/org/practice-mining.ts` and `src/lib/practices/apply.ts`
(W2-J2 — **read-only import** here) · `src/lib/memory/recall.ts` and `src/lib/db/org-memory.ts`
(W2-K / W1-B — read-only import) · `src/features/shared/memory/**` (W1-B) ·
`src/lib/db/scans-read.ts` (W1-F) · lease/executor columns on `LoopRunLane` (#3, W4-N).

**Handoffs to other lanes**
- **W2-J2 (#33):** if `minePracticeShapes` gains a `HousePatternVersion`, the brief should stamp the
  version it quoted (`briefJson.housePattern.version`). Field is reserved, left null by this lane.
- **W1-B (#14) / memory docs:** a paragraph in `docs/features/org-knowledge/memory.md` naming
  `source: "loop-lesson"` and the candidate inbox. Requested, not written here (memory.md is B's).
- **W2-J2:** one paragraph in `docs/features/org-dashboard/practices.md` noting the mined house
  pattern now has a second consumer (the lane brief) beside `resolveHousePattern`.
- **W4-N (#3):** the `.ascent/lane-report.json` schema in `lane-report.ts` is the same report shape
  a remote agent will POST over MCP. Version it (`"v": 1`) so N extends rather than forks it.
- **#26 (same builder, next):** `LaneItemOutcome` rows are the per-item proof #26's improvement
  ledger reads; do not duplicate them.

## Goal and the Known gap this deletes

Wire the org's own standard INTO every lane the loop dispatches (active playbook for the batch's
dimensions, the mined house pattern, procedural Org Memory, matching registry skills, and the
dimension's stored scan evidence) and wire the lane's structured result BACK (per-item verdicts that
stop blind re-dispatch, a `PlaybookApplication` stamp on verified closes, lessons as reviewable
memory candidates). Competitive angle: Factory's remediation applies generic best practice; Ascent's
applies the org's own versioned standard and then learns only from what a rescan verified.

Deletes from `docs/features/org-followups/README.md` → Known gaps:
> **The prompt is Ascent's words, not the repo's.** … Grounding it in the dimension's stored
> evidence is the obvious next step.

Adds to `docs/features/org-planning/live.md` (brief provenance, verdict ledger, lessons inbox) and
`docs/features/local-mode/README.md` (the `.ascent/lane-report.json` contract).

## Premise check against the current tree

Verified 2026-08-29. The dossier's structural premises hold: `loop-lane.ts:193-196` is still
`buildFixPrompt(batch, …)` plus one fixed AUTOPILOT CONTEXT string; `grep` for playbook/skills/memory
in `src/lib/local` returns nothing; `runLane` keeps only `firstLine(result.summary)` (`:197`) and no
per-id outcome; `buildFixPrompt` still asks for "resolved / skipped / needs a human, per id"
(`followups.ts:159`); `applyPlaybook` (`playbooks.ts:163-182`) is called only from the playbooks
route; `minedStarter` has one consumer, `resolveHousePattern` (`practices/apply.ts:67-81`).
Two premises are **FALSE** and the design is redrawn around them:

1. **`recallOrgMemory` does not exist.** The recall path is `candidateOrgMemories(org, opts, viewer)`
   (`src/lib/db/org-memory.ts:378`) feeding the pure `recallMemories` (`src/lib/memory/recall.ts:245`),
   exactly as `src/app/api/athena/gate.ts:152-161` does it. The brief uses that pair; there is no
   new recall function.
2. **No category→dimension map exists.** `SKILL_CATEGORIES` (`src/lib/org/skill-categories.ts:7`) is
   a flat seven-value enum with no dimension link. This spec defines `SKILL_CATEGORY_DIMS` locally in
   `lane-brief.ts` rather than editing the shared taxonomy module (not in this lane's write set).

Also corrected: `Recommendation.status` has no `declined` value (`REC_STATUSES` =
`open | in_progress | done | dismissed`, `src/lib/types.ts:35`), so a skip verdict must NOT be
written as a status. It becomes a `LaneItemOutcome` row plus a `RecommendationEvent`.

## Behaviour

### Data model and honest-null rules
- `briefJson` stores **provenance, not prose**: `{ v: 1, bytes, sections: [{ kind, dimIds[], count,
  bytes, refs[] }], omitted: [{ kind, why }] }`. `refs` are ids (playbookId+version, practiceId,
  memory ids, skill ids). A section the org simply does not have is recorded in `omitted` with
  `why: "none"` — the brief text then says so in words ("no playbook for D5 in this org"). **Never a
  silent empty section, never a fabricated standard.**
- `reportJson` is `{ v: 1, parsed: boolean, raw?: string(≤8KB), items: […], lessons: […] }`.
  `parsed: false` with the raw excerpt is the honest state when the agent wrote nothing or wrote
  garbage — it is not "zero items skipped".
- Idempotency: `LaneItemOutcome` is `@@unique([laneId, recommendationId])` — a retried parse upserts.
  `stampPlaybookApplications` rides `applyPlaybook`'s existing per-(playbook,repo) upsert.
- Wire types (`LaneOutcomeRow`, `LoopLessonRow`, `LaneBriefProvenance`) declare `createdAt`,
  `deferUntil`, `reviewedAt` as **`string`** and the mappers `.toISOString()` server-side.
- Retention/erase: both new tables are org-scoped by denormalized `orgId`; the erase graph in
  `src/lib/db/retention.ts` needs `laneItemOutcome.deleteMany` + `orgMemoryCandidate.deleteMany`
  added to the org-erase path — **requested from the Director** (W1-F owns `retention.ts`).

### Pure modules
```ts
// src/lib/org/lane-brief.ts  (pure; no Prisma, no fetch)
export interface LaneBriefInput {
  org: string; repo: string; dimIds: string[];
  playbooks: { id: string; title: string; dimId: string; version: number; summary: string; steps: string[] }[];
  housePattern: { practiceId: string; label: string; dimId: string; lines: string[]; exemplars: string[] }[];
  memories: { id: string; kind: string; content: string; source: string | null }[];
  skills: { id: string; name: string; category: string; summary: string }[];
  evidence: { dimId: string; name: string; score: number; evidence: string[]; gaps: string[] }[];
}
export const BRIEF_MAX_BYTES = 12_000;
export const SECTION_MAX_BYTES: Record<BriefSectionKind, number>; // 4k/3k/2.5k/1k/2k
export const SKILL_CATEGORY_DIMS: Record<SkillCategory, string[]>; // ci-cd→D3,D6 · testing→D6 · security→D9 · ai-native→D1,D2 · docs→D1 · workflow→D5 · other→[]
export function buildLaneBrief(input: LaneBriefInput): { text: string; provenance: LaneBriefProvenance };
```
Deterministic ordering (dimId, then agreement/recall score, then id) so two runs on the same data
produce byte-identical briefs. Truncation is per section, marked in-text (`… (n more, trimmed)`) and
recorded in provenance — a trimmed brief must never read as a complete standard. Memory and lesson
text passes through the untrusted-content neutralizer from `src/lib/memory/consolidation.ts` first.

```ts
// src/lib/db/lane-brief-read.ts   (the four reads; each degrades to [] on failure, never throws)
export async function loadLaneBriefInput(org: string, repo: string, dimIds: string[]): Promise<LaneBriefInput>;
//   playbooks    listPlaybooks(org) → active, dimId ∈ dimIds
//   housePattern getOrgPracticeShapes(org) → minePracticeShapes → offerable, dimId ∈ dimIds, repo ∈ gapRepos
//   memories     candidateOrgMemories(org, { namespace: repo, limit: 60 }, null) → recallMemories(kind procedural first)
//   skills       listOrgSkills(org) → category maps into dimIds
//   evidence     latest scan's ScanDimension rows for dimIds (own prisma read; scans-read.ts is W1-F's)

// src/lib/local/lane-report.ts    (never throws; returns parsed:false rather than raising)
export const LANE_REPORT_PATH = ".ascent/lane-report.json";
export function parseLaneReport(raw: string | null, batchIds: readonly string[]): LaneReport;
export async function readLaneReport(dir: string, batchIds: readonly string[]): Promise<LaneReport>;
```
`parseLaneReport` drops ids not in `batchIds` (an agent cannot adjudicate rows it was not given),
coerces unknown verdicts to `attempted`, caps `reason` at 400 chars and `files` at 20, caps
`lessons` at 5 × 600 chars.

### `runLane` changes (after #27's cost recording)
1. After the batch is picked and claimed: `loadLaneBriefInput` → `buildLaneBrief` →
   `updateLane(laneId, { briefJson })`; prompt = `buildFixPrompt(batch, …)` + AUTOPILOT CONTEXT +
   `\n\nYOUR ORGANIZATION'S STANDARD:\n` + brief.text + the REPORT CONTRACT addendum (write
   `.ascent/lane-report.json`, do not commit it — it is added to `.git/info/exclude` in the
   worktree so a stray `git add -A` cannot land it in the deliverable branch).
2. After the agent returns, before the rescan: `readLaneReport(worktree.dir, batchIds)` →
   `updateLane(laneId, { reportJson })`. A missing file is `parsed:false`; the lane continues.
3. After the rescan adjudicates: `recordLaneOutcomes()` writes one `LaneItemOutcome` per batch id —
   `resolved` when the id is in `closedIds` (the rescan's verdict wins over the agent's claim, the
   `decideInProgress` rule is untouched), otherwise the agent's verdict, otherwise `absent`.
   `skipped` and `needs_human` get `deferUntil = now + LANE_DEFER_CYCLES` (default 3 cycles, capped
   at 14 days); each also writes a `RecommendationEvent { kind: "lane_verdict", toValue: verdict,
   note: reason }` so the existing item timeline explains itself.
4. Write-back on verified close only: `stampPlaybookApplications(org, repo, closedIds, briefProv)` —
   for each closed row whose `dimId` has a playbook **that was in this lane's brief**, call
   `applyPlaybook(org, playbookId, repo, "loop")`. A close under a playbook the agent never saw is
   not adoption evidence.
5. Lessons: `recordLoopLessons(org, repo, laneId, report.lessons)` writes `OrgMemoryCandidate` rows
   with `source: "loop-lesson"`, `kind: "procedural"`, `namespace: repo`, `status: "pending"`.
   **The loop never writes `OrgMemory`.** Promotion is a human action through the existing
   `POST /api/org/memory` one-door ingest (which runs the duplicate/consolidation check).

### `openBatch` (decline-aware)
After the existing rank/slice, filter out ids whose latest `LaneItemOutcome` has
`deferUntil > now` — `getActiveDeferrals(org, repo)`, one indexed read. A curated batch that NAMES a
deferred id keeps it (an explicit human pick outranks a machine deferral) and the lane log says the
deferral was overridden. Deferrals are advisory to `openBatch` only: nothing changes on the
`Recommendation` row, so every other surface still shows the item as open.

### Routes
- `GET /api/org/loop/propose?org&repos` (edit) — each `LoopProposal` gains
  `brief: { text: string; provenance: LaneBriefProvenance }`, built from the same
  `loadLaneBriefInput`/`buildLaneBrief` the engine calls, so the preview and the dispatch can never
  diverge. Auth unchanged: `selfHostGuard()` → `requireOrgAccess(org)`.
- `GET /api/org/loop/lessons?org[&status=pending]` — `selfHostGuard()` → `requireOrgAccess(org)`;
  returns `LoopLessonRow[]`.
- `POST /api/org/loop/lessons` `{ org, id, action: "keep" | "discard", namespace? }` —
  `selfHostGuard()` → `requireOrgRole(org, "member")`, same-origin check (it mutates and, on
  `keep`, writes into Org Memory). **Gate-then-constrain**: the org is gated first and passed into
  the update beside the candidate id, so a candidate from another org is simply not found → 404. No
  `[id]` segment, so `id-routes-gated.test.ts` is unaffected. `keep` calls the existing memory
  create path with `source: "loop-lesson"` and stamps `promotedMemoryId`; `discard` sets
  `status: "discarded"` (soft — never a delete).

### UI (cockpit, `src/features/inflight/live/**`)
- **Inspector / batch** — a `Kicker` + `Tile`/`TILE_LEDGER` provenance strip above the proposed
  batch: "Brief: 2 playbooks · house pattern from 3 exemplars · 4 memories · 1 skill · 8.1 KB", with
  omitted sections stated in words. Score color only via `scoreHex`/`LEVEL_HEX` (`@/lib/ui`).
- **Outcome** — `CockpitVerdicts.tsx`: per-item verdict rows with reason and deferral window
  (`needs_human` is the only `danger`-toned chip). `CockpitLessons.tsx`: pending lessons with
  Keep / Discard, labelled "candidate — not in memory until you keep it".
- LOC: `LiveCockpit.tsx` is at 195/200 — extract its rail switch into a co-located file BEFORE
  adding the lessons mode. Every new `src/features/**` file stays ≤200 LOC.

### Self-hosted · plan gates · privacy · audit
The loop is self-hosted-only (`selfHostGuard`) and `selfHosted()` turns plan gates off, so the brief
reads playbooks/memory/skills without an entitlement check — but it calls the same readers, so a
future hosted executor inherits their gates rather than bypassing them. No cross-org aggregate is
produced, so `CHAMPION_MIN_POP` does not apply. The brief never leaves the org: it goes to a local
`claude -p` session on the operator's own machine and is never written into the customer repo
(`.ascent/lane-report.json` is git-excluded in the worktree). The playbook stamp is auditable as
`appliedBy: "loop"` plus the `RecommendationEvent` rows; lesson promotion rides the memory route's
existing audit.

## Build order

1. `lane-brief.ts` (pure) + `lane-brief.test.ts`: assembly, section caps, deterministic order,
   the "no playbook for D5" honest-absence lines. No wiring yet.
2. `lane-brief-read.ts`: the four reads, each degrading to `[]`; `SKILL_CATEGORY_DIMS` applied.
   Ship with `briefJson` written by `runLane` and nothing else changed — a lane now records what it
   would have said. Gateable, zero behaviour change to the prompt.
3. Prompt wiring: brief text + report-contract addendum into `runLane`'s prompt; `git.ts`-driven
   `.git/info/exclude` entry for `.ascent/lane-report.json`.
4. `lane-report.ts` parser + `reportJson` persistence (still no consumer). Fuzz the parser.
5. `lane-outcomes.ts` + `recordLaneOutcomes` in `runLane`; `RecommendationEvent` notes.
6. `openBatch` deferral filter + the curated-override rule.
7. `stampPlaybookApplications` in `playbooks.ts` + the verified-close call in `runLane`.
8. `loop-lessons.ts` + `/api/org/loop/lessons` + candidate writes from `runLane`.
9. Cockpit: `LiveCockpit.tsx` extraction, then provenance strip, `CockpitVerdicts`, `CockpitLessons`.
10. Docs: `live.md`, `local-mode/README.md`, and the Known-gap deletion in
    `org-followups/README.md`.

## Tests

**Unit (vitest)**
- `src/lib/org/lane-brief.test.ts` — fail-before: with two playbooks and a mined pattern, the
  current tree has no function at all; the guard asserts the brief names the playbook version, marks
  a missing section as absent in words, respects `SECTION_MAX_BYTES`, and is byte-identical across
  two calls on the same input.
- `src/lib/local/lane-report.test.ts` — fail-before: `parseLaneReport` on `null`, on `"{"`, on a
  report naming an id outside the batch, and on a 1 MB blob must all return without throwing;
  today no parser exists and `runLane` discards the summary entirely.
- `src/lib/local/loop-lane.brief.test.ts` (sibling of the existing `loop-lane.release.test.ts`,
  which must keep passing untouched) — fail-before: with a stubbed `runAgent` writing a report that
  marks id `r2` `skipped`, today no outcome row exists and `openBatch` re-picks `r2` next cycle;
  after, `r2` carries `deferUntil` and is filtered. Second guard: a closed row under a briefed
  playbook stamps `PlaybookApplication`; a closed row under a playbook NOT in the brief does not.
- `src/lib/db/lane-outcomes.test.ts` — upsert idempotency on `(laneId, recommendationId)`; the
  deferral read is org+repo scoped (cross-tenant guard).
- `src/app/api/org/loop/lessons/route.test.ts` — fail-before: `keep` on another org's candidate must
  404 (gate-then-constrain); `discard` must not delete the row.
- `src/features/inflight/live/cockpit/CockpitLessons.dom.test.tsx` — the candidate is labelled as
  not-yet-memory; Keep posts once and the row leaves the pending list.

**Structural guards touched**
- `wire-safe-dates.test.ts` — three new wire types (Director lands the entries).
- `id-routes-gated.test.ts` — unaffected by design (no new `[id]` segment); state this in the PR.
- doc-sync — `live.md`, `local-mode/README.md`, `org-followups/README.md` in the same turn.
- LOC checks — `src/features/**` ≤200 (the `LiveCockpit.tsx` extraction is step 9's first commit).

**e2e / UAT**
Re-run **Sam (staff engineer)**: curate a batch in the cockpit → confirm the brief preview names his
org's playbook → run a lane → read the per-item verdicts and keep one lesson. Dana's briefing
journey (M1) is not touched by this lane (no `briefing.ts` edit here — that is #26).

## Gate + done criteria

`npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks →
e2e (cockpit UI moved). Done when: a lane run on a seeded org writes a `briefJson` whose
provenance matches the org's actual playbooks; a `skipped` verdict survives into the next cycle as a
non-dispatch; a verified close stamps `PlaybookApplication{appliedBy:"loop"}`; and a lesson exists
as a **candidate** with no `OrgMemory` row until a human keeps it. Instrument (recorded in the PR,
not built as a dashboard): close rate of briefed vs unbriefed lanes on the same dimension.

## Out of scope

- **#3 Agent-neutral work protocol** (W4-N) — claims, leases, `LoopRunLane.executor/claimedBy/
  leaseUntil`, and any MCP write path. The report shape is versioned FOR N; it is not exposed here.
- **#27 Remediation economics** and **#26 One improvement ledger** — same lane, separate specs; no
  cost fields, no `ImprovementPr` writes, no `briefing.ts` proof line in this diff.
- **#33 Practice adoption ledger** (W2-J2) — `HousePatternVersion`, post-merge drift, and any edit
  to `practice-mining.ts` / `practices/apply.ts`. This lane only reads the mined pattern.
- **#17 Work-time registry over MCP** (W2-K) — `OrgMemoryCitation` and skill `invoke` events. The
  brief names skills as text; it records no invocation.
- **#36 Lessons mirror / reflect-as-PR** (W1-D) — `OrgSkillLesson`, the Skills Trace, and
  `proposeMemoryPr`. `OrgMemoryCandidate` is shaped so #36 *could* reuse it; wiring that is #36's.
- **Deferred deck items this must not absorb:** #20 (Athena as registry curator — no PR-proposing
  agent here), #28 (durable scheduled drives — deferrals are per-item, never a schedule), #29
  (score-input ledger), #30 (reproducibility certificate), #31 (signed history bundle).
- No hosted dispatch: the "no hosted dispatch" Known gap in `live.md` stays, and stays true.
