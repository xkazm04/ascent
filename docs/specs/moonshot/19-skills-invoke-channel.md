# 19 — Live invoke channel: per-skill/per-repo usage feeding dormancy and outcomes

size L · effort 6 / impact 8 / risk 4 · gate **contract** · lane **W1-D** (built FIRST, then #18, then #36) · wave 1

## Premise check (read before the write set)

Every `file:line` in the finding was re-verified against the current tree. Symbols, not lines, are cited.

| Premise | Verdict |
|---|---|
| `aggregateUsage` computes `bySkill`, only `{invokes30d, contributors}` reaches the DB | **holds** — `src/lib/registry/index-registry.ts` `aggregateUsage`; `recordIndexResult` (`src/lib/db/org-registry-write.ts`) spreads `result.usage` and nothing per-skill |
| `invoke` is dropped at the events route | **holds** — `isSkillEventType` (`src/lib/db/org-skills.ts`) returns `download|sync` only; the route's 400 string says so |
| `skillUsageMap` folds `download|sync`, `active` needs a `download` | **holds** — `skillUsage` in `src/lib/org/skill-usage.ts` |
| `OrgSkillEvent.source` is free text | **holds** — clipped to 200 chars in `recordSkillEvents`, never validated |
| Registry fleet block is hard zeros | **holds** — `getRegistryView` (`src/lib/org/registry-view.ts`) literal `reposPointing: 0, reposSynced30d: 0, adoption: {…0}` |
| The CLI reports `source: "cli:<state>"` | **holds** — `reportDrift` in `scripts/ascent-skills.mjs`. **Consequence the finding missed:** a naive enum would invalidate every event the shipped fleet emits. Handled below (prefix normalization + a `detail` column). |
| The finding's `OrgSkillUsageSample.repoFullName`, resolved contributor→repo | **FALSE as designed.** `../ai-registry/docs/usage-lane.md` forbids repository names, paths and per-project breakdown in `usage/<contributor>.json`, and `scripts/check-usage.mjs` in the registry *enforces* it on a public repo. A repo dimension can never be derived from that lane. Redesigned as two channels (below); the guess is removed entirely rather than bucketed as "unattributed". |
| `npx ascent` distributable exists | **FALSE** — `package.json` has no `bin`. The distributable today is the single file `scripts/ascent-skills.mjs`. This spec extends that file and does **not** create a package; the `npx ascent` packaging stays with the topology work in `docs/GOLDEN-USE-CASES.md`. |

**The two telemetry contracts, reconciled (the item's central decision).**
`docs/GOLDEN-USE-CASES.md` §Phase A specifies `telemetry/<repo>/<yyyy-mm>.jsonl`; the registry that
shipped reads `usage/<contributor>.json` (`isUsageFile` in `src/lib/registry/index-walk.ts`). They are
not the same contract and cannot be merged, because one is repo-dimensioned and the registry lane is
constitutionally repo-free. Pinned resolution — **one event contract, two sinks, one repo rule**:

- **The event** is `{ skill, version?, event: "invoke"|"download"|"sync", ts, session?, source, repo? }`,
  idempotent on `(session, skill, ts)`. This is the only shape any producer emits.
- **Sink A — the events API** (`POST /api/org/skills/events`, `telemetry:write`). Tenant-private, behind
  a token, lands in the org's own DB. **This is the only sink that may carry `repo`.**
- **Sink B — the registry `usage/` lane.** `report --to-registry` aggregates the same events into
  `usage/<contributor>.json` — counts only, no `repo`, no path, no login, matching the lane's gate.
- `telemetry/<repo>/<yyyy-mm>.jsonl` is **not built here.** It is repo-dimensioned data in a repo whose
  privacy the operator does not control; sink A already serves that need. The GOLDEN-USE-CASES line is
  amended to say so — a Director-owned doc line (below), not a builder edit.

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/lib/registry/index-registry.ts` — `RegistryUsage` gains `samples`; `aggregateUsage` keeps `lastUsed` and contributor per skill; the pass calls `recordUsageSamples`.
- `src/lib/db/org-registry-write.ts` — `IndexResultInput.usage` gains `samples`; new `recordUsageSamples` + `purgeUsageSamples`.
- `src/lib/org/skill-usage.ts` — `invoke` is a real use, ranked above `download`; `SkillUsageInput.samples`; the "invoke retired / active unreachable" header comment is rewritten.
- `src/lib/org/skill-usage-load.ts` — pass the sample rows through.
- `src/lib/db/org-skills.ts` — `SkillEventType += "invoke"`; `SkillEventInput` gains `session?`, `ts?`; `normalizeEventSource`; `recordSkillEvents` dedupes; `SkillUsageRows.samples`; `getOrgSkillUsageRows` reads samples.
- `src/app/api/org/skills/events/route.ts` — accept `invoke`, `session`, `ts`; validated `source`; error copy.
- `src/lib/org/registry-view.ts` — real `reposReporting`/`invokesBySkill`; the fleet block's zeros become honest nulls where still unmeasured (#18 lands the adoption half).
- `src/lib/org/skill-outcomes.ts` / `skill-outcomes-load.ts` — first-invoke as a pairing anchor when adoption is absent.
- `src/features/shared/skills/SkillCard.tsx`, `SkillDormancyBadge.tsx` — per-skill `invokes30d`.
- `src/features/shared/registry/RegistryInstrumentPanel.tsx`, `RegistryFleetSync.tsx` — reporting readouts.
- `scripts/ascent-skills.mjs` — `hooks install|remove|status`, `report`; `reportDrift` moves to `source:"cli"` + `detail`.
- `docs/features/org-knowledge/skills.md` — the doc, and the two Known gaps it deletes.

**Files to create**
- `src/lib/org/skill-event-source.ts` — the source enum + normalizer (pure; imported by client and server).
- `src/lib/registry/usage-samples.ts` — pure sample→`SkillEventStat` fold.
- `src/lib/db/org-skill-usage-samples.ts` — sample reads/writes (barrel line requested).
- `src/lib/org/skill-usage-samples.test.ts`, `src/lib/registry/usage-samples.test.ts`, `src/app/api/org/skills/events/route.test.ts`, `scripts/__tests__/ascent-skills-hooks.test.mjs`.

**Prisma models/columns needed (landed by the wave-1 schema pass, not by this lane)**
```prisma
model OrgSkillUsageSample {           // snapshot per index pass — upsert, never append
  id          String   @id @default(uuid())
  registryId  String
  orgId       String                  // denormalized for the org-scoped read
  contributor String                  // usage/<contributor>.json stem
  skillName   String                  // registry skill NAME (no OrgSkill id exists for a registry-only skill)
  invokes     Int      @default(0)
  windowDays  Int      @default(30)
  lastUsedAt  DateTime?               // from the file's optional `lastUsed`; NULL = not reported
  generatedAt DateTime                // the file's own `generatedAt` — staleness is the reader's problem
  updatedAt   DateTime @updatedAt
  @@unique([registryId, contributor, skillName])
  @@index([orgId, skillName])
}
```
plus on `OrgSkillEvent`: `type` comment → `download | sync | invoke`; `source String?` (now enum-valued,
`cli|hook|ci|web|registry|mcp`); **new** `detail String?` (the drift state the CLI used to smuggle into
`source`); **new** `sessionId String?`; **new** `dedupeKey String?` with `@@unique([skillId, dedupeKey])`.
No JSON columns, no `jsonb`. A migration re-points nothing: legacy `cli:diverged` rows keep their string
and are normalized on read (`normalizeEventSource`), so no destructive rewrite.

**Director-owned lines requested at merge**
- `src/lib/db/index.ts`: export `listOrgSkillUsageSamples`, `recordUsageSamples`, `purgeUsageSamples`, `type SkillUsageSampleRow`.
- `src/lib/db/wire-safe-dates.test.ts`: add `SkillUsageSampleRow` (its `lastUsedAt`/`generatedAt` are `string`).
- `context-map.json`: `filePaths` for `src/lib/registry/usage-samples.ts`, `src/lib/db/org-skill-usage-samples.ts`, `src/lib/org/skill-event-source.ts` under *Skills Registry & API Tokens*.
- `scripts/docs/feature-doc-map.json`: `src/lib/db/org-skill-usage-samples.ts` into the `org-knowledge/skills.md` globs (`src/lib/org/skill-*.ts` already matches the two new `src/lib/org` modules).
- `docs/GOLDEN-USE-CASES.md` Phase A: amend the `telemetry/<repo>/<yyyy-mm>.jsonl` line to the pinned two-sink contract above.

**MUST NOT TOUCH** — `src/lib/mcp/**`, `src/app/api/mcp/**`, `src/lib/memory/recall.ts` (W2-K); `prisma/schema.prisma`, `prisma/init.sql`, `src/lib/db/index.ts`, `src/lib/db/wire-safe-dates.test.ts`, `context-map.json`, `scripts/docs/feature-doc-map.json` (Class B); `src/lib/db/improvement.ts`, `src/lib/report/compare.ts` (W1-E); anything under `src/lib/standard/**`.

**Handoffs to other lanes**
- **W2-K (#17)** owns the MCP-side `invoke` **consumer**: an MCP `skill_invoke`/tool-result path calling `recordSkillEvents` with `source: "mcp"`. This lane ships the enum value, the route and the writer; K wires the door. K must use `SkillEventInput` with `session` + `ts` set from the MCP session so dedupe works across a retried tool call.
- **W1-D → itself**: #18 consumes `OrgSkillUsageSample` for the registry-map fleet dimension; #36 consumes `source: "registry"`. Same builder, later commits.
- **Schema pass**: the model + five columns above.

## Goal

Turn the registry's already-real `usage/` lane and a new hook-emitted `invoke` event into one contract with
two sinks, so per-skill invocations reach the dormancy verdict, the outcome pairing and the Registry tab
instead of dying in an uncommitted catalog entry. **Competitive angle:** counts-only, git-sinkable skill
telemetry the customer can keep entirely out of any SaaS — a posture DX/Jellyfish seat models cannot offer.

**Known gaps deleted from `docs/features/org-knowledge/skills.md` in the same PR**
1. §Usage telemetry — the whole "A third type, `invoke`, was retired on 2026-07-29 … `active` was unreachable" paragraph, replaced by the hook + report contract and the two sinks.
2. §Known gaps bullet 1 — "`OrgSkillEvent.source` is documented as `cli|hook|ci|web` but is never validated … the sync client's own source code was not part of the files examined." Both halves close here.

## Behaviour

**Data model / honest-null rules.** `OrgSkillUsageSample` is a *snapshot*, upserted on
`(registryId, contributor, skillName)` per index pass — never appended, so re-indexing the same head is a
no-op and cannot double-count. A contributor whose file vanishes has its rows purged in the same pass
(`purgeUsageSamples(registryId, seenContributors)`), mirroring `archiveVanishedRegistryRows`. `lastUsedAt`
is `NULL` when the file omitted `lastUsed`; a null recency **never** falls back to `generatedAt` for the
dormancy clock — a sample with no `lastUsed` contributes a count and no recency, and a skill whose only
evidence is such a sample stays `unused`, not `active`. Unknown ≠ 0 throughout: `recordIndexResult`'s
existing "omit rather than zero when the lane was not read" rule extends to samples.

`OrgSkillEvent` stays append-only. Idempotency: `dedupeKey = sha256(sessionId + " " + skillId + " " + ts)`
computed server-side in `recordSkillEvents`, written via `createMany({ skipDuplicates: true })`; events with
no `session` get `dedupeKey = null` and keep today's at-least-once behaviour. `ts` is accepted, parsed, and
**clamped** to `[now - 90d, now]` — a clock-skewed client cannot backdate a skill into dormancy or forward-date
one into permanent activity. `source` is validated against `cli|hook|ci|web|registry|mcp`; an unrecognized
value is normalized by prefix (`cli:diverged` → `cli`) with the remainder preserved in `detail`, and only a
value with no recognizable prefix is rejected (the row still lands with `source: null`, since dropping a real
invocation over a label is the worse error).

**Pure modules**
```ts
// src/lib/org/skill-event-source.ts
export type SkillEventSource = "cli" | "hook" | "ci" | "web" | "registry" | "mcp";
export function normalizeEventSource(raw: string | null | undefined): { source: SkillEventSource | null; detail: string | null };

// src/lib/registry/usage-samples.ts
export interface UsageSample { contributor: string; skillName: string; invokes: number; windowDays: number; lastUsed: string | null; generatedAt: string }
export function sampleEventStats(samples: UsageSample[], skills: { id: string; name: string }[]): SkillEventStat[]; // type "invoke"; drops samples with no lastUsed from the recency side

// src/lib/org/skill-usage.ts (edited)
export type SkillUsageVerdict = "new" | "active" | "dormant";       // unchanged
// lastUsedType union gains "invoke"; ranking invoke > download > sync; `sync` still never a real use
```
`aggregateUsage` keeps its tolerant contract (a malformed contribution degrades itself into a warning) and
gains `samples: UsageSample[]` beside `bySkill`. `sampleEventStats` matches on skill **name** — the registry
has no `OrgSkill` id — and silently ignores a sample naming a skill this org does not mirror.

**Routes.** `POST /api/org/skills/events` — unchanged auth (`authorizeOrgApi(request, body.org, { scope: "telemetry:write", mode: "write" })`,
token or session), unchanged 500-event cap, unchanged tenant filter (skill ids not owned by `org` are dropped),
unchanged best-effort semantics. New accepted fields per event: `type: "invoke"`, `session?: string`,
`ts?: string`. No `[id]` route is added, so `id-routes-gated` is untouched. Nothing destructive; no typed-confirm.

**Distributable (`scripts/ascent-skills.mjs`, still one file, still zero-dependency).**
- `hooks install` — writes a `PreToolUse` matcher on `Skill` into the **project's** `.claude/settings.json`
  with an `_ascent: true` marker, and generates `.ascent/skill-hook.mjs` (~30 lines, emitted from an embedded
  template so the hook never depends on where the CLI lives). The hook appends one line
  `{skill, event:"invoke", ts, session}` to `.ascent/skill-events.jsonl` and exits 0 unconditionally — it never
  blocks a tool call, never reads a prompt, never phones home. `hooks remove` deletes only entries carrying the
  marker. `hooks status` prints installed/absent plus the pending line count.
- `report` — drains `.ascent/skill-events.jsonl` by byte watermark (`.ascent/skill-events.offset`), dedupes on
  `(session, skill, ts)`, resolves names→ids from the manifest, batches ≤500 to sink A with `source: "hook"` and
  `repo: cfg.repo`. `--to-registry` instead writes/merges `usage/<contributor>.json` in the registry checkout
  — counts only, no repo, no path, contributor from `--contributor`/`ASCENT_CONTRIBUTOR` — and refuses to run
  if the aggregate would contain any `/`-shaped or `@`-shaped value. `--dry-run` prints and drains nothing.
- `reportDrift` moves from `source: "cli:<state>"` to `{ source: "cli", detail: r.state }`.

**UI.** *Shared → Registry* tab: `RegistryInstrumentPanel` gains `reporting` (contributors) and
`invokes 30d` split by sink, using the existing `Readout` + `Surface` from `@/components/ui` and the
`off|warn|ok` tone rule (`off` for a fact that does not exist yet — a zero with zero contributors renders
`—`, never `0`). `RegistryFleetSync` gains a `Reporting · n/N` `MeterRow` colored by `scoreHex`, beside the
existing pointing/synced meters, which stay zero until #18. *Shared → Skills* tab: `SkillCard` shows
`invokes30d` next to the use count; `SkillDormancyBadge` is unchanged in vocabulary — `active` simply
becomes reachable. Every file stays under the 200-LOC `src/features/**` cap (largest today: `SkillCard.tsx`
at 186 — the invoke chip is extracted into a co-located `SkillInvokeChip.tsx` rather than appended).

**Self-hosted · plan gates · privacy · audit.** Telemetry *ingest* is never plan-gated beyond the existing
`telemetry:write` scope — a gate that silences counts would make dormancy lie, which is the exact failure
this item exists to end. Read surfaces keep `planAllowsSkillsLibrary`; `selfHosted()` turns that off as
everywhere else. Privacy floors: the hook records **no** user, path, prompt or file content, so no per-person
surface is created and `CHAMPION_MIN_POP` does not arise; `repo` travels only on sink A. `report --to-registry`
publishes into a customer repo, so it is publication-shaped: the *server* side records nothing (the CLI runs on
the developer's machine), and the registry-side commit is the operator's own git action — the audit row is
requested only for the server-driven path, and there is none here. Retention: samples die with their registry
row; `OrgSkillEvent` follows whatever `src/lib/db/retention.ts` gains for org rows (out of scope here — it
covers no skill table today, and adding one is W1-F's file).

## Build order

1. **Pin the contract in code** — `src/lib/org/skill-event-source.ts` + tests. No behaviour change; landable alone.
2. **Un-retire `invoke`** — `SkillEventType`, `isSkillEventType`, `SkillEventInput` (`session`, `ts`), `recordSkillEvents` (normalize source, clamp ts, dedupeKey, `skipDuplicates`), route accepts the three new fields. Gateable: existing `org-skills-sync.test.ts` still green.
3. **Dormancy reads `invoke`** — `skillUsage` ranking and `lastUsedType`; rewrite the module header. `active` becomes reachable through sink A.
4. **Persist the samples** — `recordUsageSamples`/`purgeUsageSamples`, `aggregateUsage` keeps `samples`, the index pass writes them. `bySkill` stops dying in the uncommitted catalog entry.
5. **Fold samples into the verdict** — `sampleEventStats`, `SkillUsageRows.samples`, `getOrgSkillUsageRows`, `skillUsageMap`. Read-time fold, never synthetic ledger rows: idempotent and un-double-countable.
6. **Registry view + UI** — real `reposReporting` and per-skill invokes; instrument readouts; fleet meter; `SkillCard` chip.
7. **Distributable** — `hooks install|remove|status`, `.ascent/skill-hook.mjs` template, `report [--to-registry|--dry-run]`, `reportDrift` source fix.
8. **Outcomes anchor** — `skillOutcomesFor` accepts a `firstInvokeAt` anchor used only when no adoption exists for that (skill, repo); status vocabulary and the instrument-match rule are untouched.
9. **Doc** — rewrite §Usage telemetry, delete both Known gaps, document the hook contract, the two sinks, and the repo rule.

## Tests

- `src/lib/org/skill-usage.test.ts` (extend) — **fail-before:** a skill whose only event is `invoke` inside the window reads `dormant` today; after, `active` with `lastUsedType: "invoke"`. Also: an `invoke` older than the window with a newer `download` still ranks `invoke` for `lastUsedType` only when it is the later timestamp.
- `src/lib/org/skill-usage-samples.test.ts` (new) — a sample with `lastUsed` makes a skill `active`; a sample **without** `lastUsed` contributes a count and leaves the skill `unused` (**fail-before:** a naive `generatedAt` fallback would flip it to `active`); a sample naming an unknown skill is ignored.
- `src/lib/registry/usage-samples.test.ts` (new) + `src/lib/registry/usage.test.ts` (extend) — `aggregateUsage` returns per-contributor samples and keeps the existing tolerant-degradation assertions byte-for-byte.
- `src/app/api/org/skills/events/route.test.ts` (new) — **fail-before:** `type: "invoke"` returns 400 today; after, it is recorded. Plus: a duplicate `(session, skill, ts)` batch records once; `ts` two years ago is clamped; `source: "cli:diverged"` lands as `cli` + `detail: "diverged"`; a forged cross-org `skillId` is still dropped.
- `src/lib/db/org-skills-sync.test.ts` (extend) — tenant boundary unchanged with `invoke` in the union.
- `src/lib/org/skill-outcomes.test.ts` (extend) — first-invoke anchors a pair only when adoption is absent; the instrument-mismatch guard still refuses a delta.
- `scripts/__tests__/ascent-skills-hooks.test.mjs` (new, node:test like `scripts/docs/__tests__/`) — `hooks install` is idempotent and preserves foreign hooks; `hooks remove` removes only `_ascent`-marked entries; `report --to-registry` refuses a payload containing a `/`- or `@`-shaped value (the usage-lane gate, enforced client-side too).
- **Structural guards:** `wire-safe-dates` gains `SkillUsageSampleRow` (Director line); `id-routes-gated` unaffected (no `[id]` route added); doc-sync satisfied by `docs/features/org-knowledge/skills.md`.
- **UAT:** re-run **Sam** (report/skills surfaces) and the DevEx half of **Tomáš** — the journey to certify is "a skill I ran three times this week is not labelled dormant". No PDF change, so **Dana / M1** is not triggered.

## Gate + done criteria

`npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks (300 `.tsx` / 200
`src/features/**`) → e2e (Registry + Skills tabs moved). Done when: an `invoke` posted through sink A flips a
skill to `active`; a `usage/<contributor>.json` with `lastUsed` does the same through sink B; the Registry
instrument panel shows a non-zero `reporting` for a registry with contributions and `—` for one without;
`hooks install` + `report --dry-run` round-trips on this repo; both Known gaps are gone from `skills.md`.

## Out of scope (explicitly)

- **#17 Work-time registry over MCP (W2-K)** — the MCP `invoke` producer and `OrgMemoryCitation`. This lane ships only the enum value and the writer.
- **#18 Standards conformance ledger** and **#36 Lessons mirror / reflect-as-PR** — same lane, later; `reposPointing`/`reposSynced30d`/`adoption` stay zero until #18 lands the adoption pass, and this spec must not fabricate them.
- **#9 Intervention outcome ledger (W1-E)** — `InterventionOutcome` and the four write hooks. Only the first-invoke *anchor* inside `skill-outcomes.ts` is taken here.
- **#20 Athena as registry curator (deferred)** — no PR-proposing action.
- **#21 GitHub identity graph / scoped membership (deferred)** and **#23 Agent behaviour ledger / OTLP (concept-doc)** — no per-person attribution, no session-content sensor.
- **#32 Retention compaction (W1-F)** — no change to `src/lib/db/retention.ts`.
- The `npx ascent` package, the GitHub Action mirror, `--mine-transcripts`, and `telemetry/<repo>/<yyyy-mm>.jsonl` — topology work that stays in `docs/GOLDEN-USE-CASES.md`.
