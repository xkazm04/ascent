# 36 — Git-native improvement channel: lessons mirror, skill Trace, reflect-as-PR

size L · effort 6 / impact 7 / risk 4 · gate **contract** · lane **W1-D** (built THIRD, after #19 and #18) · wave 1

## Premise check (read before the write set)

Every `file:line` in the finding was re-verified against the current tree. Symbols, not lines, are cited.

| Premise | Verdict |
|---|---|
| The indexer only *counts* lessons | **holds** — `countLessons` (`src/lib/registry/index-walk.ts`) is a `^##\s+\S` match count; `indexRegistry` folds it into `counts.lessons` and `recordIndexResult` stores `OrgRegistry.lessonCount`. No lesson row is written. |
| No `OrgSkillLesson` model exists | **holds** — no lesson model anywhere in `prisma/schema.prisma`. |
| Registry-origin memory rows are read-only in the tab | **holds** — `MemoryCard.tsx` swaps archive for `OpenInRegistry` on `origin === "registry"`; `memory.md` §Registry-backed state states editing is not offered. |
| `openDraftPr` is called **only** from `migrate.ts` and `scaffold.ts` | **FALSE.** It is also the base of `src/lib/standard/pr.ts`, `src/lib/practices/apply.ts` (`openArtifactDraftPr`) and `src/lib/org/playbook-apply.ts`. The *true* claim is narrower: **no memory or skills caller exists**. Consequence: `proposeMemoryPr` must not invent a fifth PR layering — it copies `openMigrationPr`'s shape in the same directory (`src/lib/registry/`), because `practices/apply.ts` (the other candidate host) is W2-J2's file and its artifact vocabulary is practice-shaped. |
| `SkillGeneration` vs `skill-history.ts` is an unresolved ambiguity | **FALSE as a code gap.** `src/lib/db/skill-history.ts` *is* the accessor for the `SkillGeneration` model (`prisma.skillGeneration.upsert`) — one store, two names — and it logs **onboarding-`SKILL.md` generations per repo** (STD-6), which is not registry-skill version history at all. Nothing needs retiring; the doc bullet is simply wrong and is deleted with a sentence that says which store is which. |
| Memory reflect is DB-only | **holds** — `applyReflection` (`org-memory-lifecycle.ts`) is the only apply path; the route's `apply` branch writes and supersedes in one transaction. |
| `scan-feed.ts` is the one-door ingest (dedup, never throws) | **holds**, with a constraint the finding missed: the door is the **private** `writeScanMemory`, hard-wired to `kind: "episodic"`, `source: SCAN_PIPELINE_SOURCE` and `namespace = repoFullName`. A lesson is `procedural` in a skill-name namespace, so the door has to be *generalized* before it can take a second producer — and `src/lib/memory/scan-feed.ts` is **W1-B's file**, not this lane's. Handled as a handoff (below), not by forking a second writer. |
| `consolidation.ts` has no embeddings | **holds** — overlap is token-set (`overlapScore`); importing it is a read-only dependency this lane keeps. |
| `RegistryActivityKind` already has a `"lesson"` member | **holds, and it is dead** — the union in `src/lib/org/registry-view.ts` and the label map in `RegistryActivity.tsx` carry it, `registry-view.fixture.ts` shows one, and `activityOf` **never emits one**. This lane makes the existing kind real rather than adding one. |

**One decision the finding left open — how much git the Trace reads.** "Version timeline from git history" cannot mean
a blob read per commit per skill in the index pass: a 500-skill registry (the `MAX_INDEXED_FILES` ceiling) would cost
thousands of extra reads on every push. Pinned: **commits are read on demand, per skill, not in the index pass**, capped
at `TRACE_COMMITS = 30` and `TRACE_VERSION_READS = 6` blob reads (newest first), cached in one row keyed on the registry
head sha. Older entries carry `version: null` and render `—` — never the next-newest version carried backwards, which
would fabricate exactly the history this item exists to make trustworthy.

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/lib/registry/index-registry.ts` — the skills loop writes lesson rows (`indexSkillLessons`); the memory loop resolves `supersedes`; `IndexRegistryResult.counts.lessons` keeps its meaning (see the invariant below).
- `src/lib/registry/index-walk.ts` — `countLessons` gains a sibling `splitLessonEntries` so the count and the rows come from **one** scan of the file.
- `src/lib/registry/parse.ts` — `parseRegistryMemory` reads `supersedes:` (a list of repo-relative paths) into `MirrorMemoryInput.supersedes`.
- `src/lib/registry/read.ts` — `listPathCommits(token, owner, repo, path, ref, perPage)` over `GET /repos/{o}/{r}/commits?path=…`, capped, `AppApiError`-typed like its siblings.
- `src/lib/db/org-registry-mirror.ts` — `MirrorMemoryInput.supersedes?: string[]`; `upsertRegistryMemory` resolves those paths to sibling mirror rows and stamps `supersededBy`.
- `src/lib/db/org-registry-write.ts` — `archiveVanishedRegistryRows` also purges lesson rows for vanished `LESSONS.md` paths.
- `src/lib/org/registry-view.ts` — `activityOf` emits real `kind: "lesson"` entries from the newest lesson rows.
- `src/app/api/org/memory/reflect/route.ts` — the origin branch + the `proposePr` body (this lane owns this file per §2).
- `src/features/shared/skills/SkillsTab.tsx`, `SkillsTabChunks.tsx`, `SkillCard.tsx` — the Trace entry point.
- `docs/features/org-registry/README.md`, `docs/features/org-knowledge/skills.md` — the docs, and the Known gap deleted.

**Files to create**
- `src/lib/registry/lessons.ts` — pure parser + the `skill-lessons` source constant (no db import; client-safe).
- `src/lib/registry/trace.ts` — pure commit-list → `SkillTraceEntry[]` fold.
- `src/lib/registry/lesson-memory.ts` — lesson → memory-candidate mapping + per-skill cap (the insert itself goes through W1-B's door).
- `src/lib/registry/memory-pr.ts` — `proposeMemoryPr` + `buildMemoryNoteFile`.
- `src/lib/db/org-skill-lessons.ts` — lesson row reads/writes (barrel lines requested).
- `src/lib/db/org-skill-trace.ts` — trace cache read/write.
- `src/lib/db/org-registry-proposals.ts` — `OrgMemoryProposal` reads/writes (named `org-registry-*` deliberately: it maps to **this lane's** doc glob, not W1-B's `org-memory*.ts` one).
- `src/app/api/org/[slug]/registry/trace/route.ts` — `GET`, the on-demand Trace.
- `src/features/shared/skills/SkillTracePanel.tsx`, `SkillTraceTimeline.tsx`, `SkillLessonList.tsx`, `skillTrace.ts` (client fetch helper).
- Tests: `src/lib/registry/lessons.test.ts`, `trace.test.ts`, `memory-pr.test.ts`, `lesson-memory.test.ts`, `src/app/api/org/memory/reflect/route.test.ts`, `src/features/shared/skills/SkillTracePanel.test.tsx`.

**Prisma models/columns needed (landed by the wave-1 schema pass, not by this lane)**
```prisma
model OrgSkillLesson {                 // one row per `## ` entry in skills/<name>/LESSONS.md
  id           String   @id @default(uuid())
  registryId   String
  orgId        String                  // denormalized for the org-scoped read
  skillName    String                  // registry skill NAME (a registry-only skill has no OrgSkill id)
  registryPath String                  // "skills/<name>/LESSONS.md"
  versionUsed  String   @default("")   // heading slot 1, VERBATIM ("2.1.0", "0.1-1.0", "" = unparsed)
  learnedOn    DateTime?               // heading slot 2; NULL = the heading carried no readable date
  project      String   @default("")   // heading slot 3, verbatim; "" = absent
  headingRaw   String                  // the whole "## …" line, so a reader can see what was parsed
  body         String   @default("")   // the bullets under it, capped 8KB
  entryHash    String                  // contentDigest over headingRaw + "\n" + body — the idempotency key
  position     Int      @default(0)    // 0-based order in the file (the lane is append-only)
  memoryId     String?                 // the OrgMemory candidate this produced; NULL = not ingested
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([registryId, registryPath, entryHash])
  @@index([orgId, skillName])
  @@index([registryId, registryPath])
}

model OrgSkillTrace {                  // per-skill git timeline cache; one row per path, upserted
  id           String   @id @default(uuid())
  registryId   String
  orgId        String
  skillName    String
  registryPath String                  // "skills/<name>/SKILL.md"
  headSha      String                  // registry head this was built at — the cache key
  entriesJson  String   @default("[]") // TEXT JSON (no jsonb): [{sha, authoredAt, authorLogin, message, version|null}]
  truncated    Boolean  @default(false)// more than TRACE_COMMITS commits exist for the path
  builtAt      DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([registryId, registryPath])
  @@index([orgId, skillName])
}

model OrgMemoryProposal {              // a reflection that must land as a PR, and its state
  id              String   @id @default(uuid())
  orgId           String
  registryId      String?
  namespace       String?
  kind            String   @default("summary")
  slug            String                     // memory/<kind>/<slug>.md stem
  summaryContent  String
  memberIdsJson   String   @default("[]")    // TEXT JSON: OrgMemory ids it would supersede
  memberPathsJson String   @default("[]")    // TEXT JSON: their registryPaths — what the PR's frontmatter cites
  status          String   @default("proposed") // proposed | pr_open | merged | closed
  prUrl           String?
  prNumber        Int?
  createdBy       String?                    // GitHub login
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([orgId, slug])
  @@index([orgId, status])
}
```
No JSON columns beyond the two TEXT payloads; no `jsonb`. Nothing on an existing model changes shape.

**Director-owned lines requested at merge**
- `src/lib/db/index.ts`: export `listSkillLessons`, `replaceSkillLessons`, `purgeSkillLessons`, `getSkillTrace`, `putSkillTrace`, `createMemoryProposal`, `setMemoryProposalPr`, and the types `SkillLessonRow`, `SkillTraceRow`, `MemoryProposalRow`.
- `src/lib/db/wire-safe-dates.test.ts`: add `SkillLessonRow` (`learnedOn`, `createdAt` as `string`), `SkillTraceRow` (`builtAt`), `MemoryProposalRow` (`createdAt`).
- `context-map.json`: `filePaths` for the four new `src/lib/registry/*.ts`, the three new `src/lib/db/*.ts` and the new route, under *AI Registry Repo (Onboarding & Index)* / *Org Memory*.
- `scripts/docs/feature-doc-map.json`: no new glob needed — every new path already matches `src/lib/registry/**`, `src/lib/db/org-registry*.ts`, `src/features/shared/skills/**` or `src/app/api/org/[slug]/registry/**`.
- `docs/features/org-knowledge/memory.md` §Registry-backed state: the "editing is not offered" sentence gains the proposal path. **W1-B's doc** — requested, not taken (see handoffs).

**MUST NOT TOUCH** — `src/lib/mcp/**`, `src/app/api/mcp/**`, `src/lib/memory/recall.ts` (W2-K); `src/lib/memory/scan-feed.ts`, `src/lib/memory/memory-kinds.ts`/`src/lib/org/memory-kinds.ts`, `src/features/shared/memory/**`, `docs/features/org-knowledge/memory.md`, `src/lib/github/source.ts` (W1-B); `src/lib/db/org-memory.ts`, `org-memory-lifecycle.ts` (shared with W1-B's reads); `src/lib/practices/apply.ts` (W2-J2); `src/lib/standard/**` (W1-A/W1-H); `prisma/schema.prisma`, `prisma/init.sql`, `src/lib/db/index.ts`, `src/lib/db/wire-safe-dates.test.ts`, `context-map.json`, `scripts/docs/feature-doc-map.json` (Class B).

**Handoffs to other lanes**
- **W1-B (#14) — the one door.** W1-B is already adding a second producer to `scan-feed.ts`, so it lands the generalization this lane consumes, first commit of its build order, exact signature:
  `export async function writeMemoryCandidate(input: { orgId: string; namespace: string; content: string; kind: MemoryKind; source: string; confidence: number; tags: string[] }): Promise<{ id: string } | null>` — the existing `writeScanMemory` body with kind/source/confidence/tags parameterized, same `DEDUP_OVERLAP`/`DEDUP_WINDOW` prefilter scoped to `(orgId, namespace, source)`, same never-throws contract, and `writeScanMemory` reduced to a call into it (so scan-feed behaviour is byte-identical). **This lane's step 5 is its last commit and is gated on that merge**; if W1-B has not merged, the commit is held for the wave-1 integration branch and reported as such in the handoff. Nothing else in this spec depends on it.
- **W1-B — the Memory tab affordance.** `MemoryCard.tsx` renders, on `origin === "registry"` rows, a `Propose change (PR)` action beside `OpenInRegistry`, POSTing `{ org, proposePr: { summaryContent, memberIds, namespace } }` to the reflect route and rendering the returned `prUrl`. This lane ships the route, the body builder, the proposal row and the copy string; W1-B (or the Director at wave-1 integration) wires the button. Same for `MemoryReflectProposal.tsx`'s second button on a registry-origin proposal.
- **W1-B — `memory.md`.** The doc paragraph above. This lane's PR will trip the doc-sync hook via `src/app/api/org/memory/**`; the dismissal sentence names this handoff.
- **W2-K (#17)** — a `skill_lessons` MCP read is *not* built here; K may expose `listSkillLessons` if it wants one.
- **Schema pass** — the three models above.

## Goal

Turn `LESSONS.md` from a number on a dashboard into the org's improvement channel: every reflection becomes a
row, a version timeline read straight from git, and a memory candidate the agents actually recall — and a
reflection over registry-origin memory becomes a reviewable pull request instead of a dead end.
**Competitive angle:** no competitor pairs a versioned technique library with a per-version lessons trace and
git-reviewed memory; the closest (Sonar rules, Factory pillars) are vendor-authored and static.

**Known gap deleted from `docs/features/org-knowledge/skills.md` in the same PR** — §Known gaps bullet 2, "The
relationship between the `SkillGeneration` Prisma model and the onboarding-skill generation log referenced in a
comment … is unclear". Replaced by one sentence: `skill-history.ts` is that model's only accessor and logs
onboarding-`SKILL.md` generations per repo; **registry skill history is git**, surfaced as Trace. (Bullet 1 is
#19's, deleted earlier in this lane.)

## Behaviour

**Parsing (`src/lib/registry/lessons.ts`) — tolerant, and count-exact.**
`splitLessonEntries(text)` cuts on the same `^##\s+\S` regex `countLessons` uses and returns one entry per match, so
**`counts.lessons` and the row count for a file are equal by construction** — a divergence would make the two
surfaces contradict each other, which is the failure this whole item is about. `parseLessonHeading(line)` follows
the registry's own contract (`../ai-registry/docs/skills-lane.md` §LESSONS.md): `## <version used> - <YYYY-MM-DD>
- <project>`, separator `-` **or** an em dash, version optionally a range (`0.1-1.0`) or two-part. Honest nulls:
an unreadable date is `learnedOn: null` (never "today"), a missing version is `""` (never the skill's current
version), and `headingRaw` always carries what was actually there. A malformed heading still produces a row —
losing a lesson because its heading is odd is worse than an under-parsed row. One warning per *file*, not per
entry, appended to the pass's `warnings` like every other indexer complaint.

**Persistence.** `replaceSkillLessons(registryId, orgId, skillName, path, entries)` is a per-file
delete-not-in-set + upsert on `(registryId, registryPath, entryHash)`, so a re-index of the same head is a no-op,
an edited entry replaces itself, and a removed entry disappears. `memoryId` survives a re-index (the upsert never
clears it), so an already-ingested lesson is never re-ingested. `archiveVanishedRegistryRows` purges rows whose
`LESSONS.md` vanished — lessons are *mirror* rows, not history, and the git history remains the record.

**Trace.** `GET /api/org/[slug]/registry/trace?skill=<name>` → `{ skill, path, headSha, entries: SkillTraceEntry[],
truncated, lessons: SkillLessonRow[], cached }`. `requireOrgRead(slug)` via `guardRegistryRead`; no `[id]` segment,
so `id-routes-gated` is untouched. On a cache hit (`OrgSkillTrace.headSha === OrgRegistry.lastIndexSha`) it is one
DB read. On a miss it mints the installation token, calls `listPathCommits` (≤ `TRACE_COMMITS = 30`), reads the
blob at the newest ≤ `TRACE_VERSION_READS = 6` commits to resolve `version` from frontmatter, folds with
`buildTrace` and upserts the cache. GitHub failure degrades to `{ entries: [], error: "…" }` and the panel says
"history unavailable" — never an empty timeline presented as "no history".
```ts
// src/lib/registry/trace.ts (pure)
export interface SkillTraceEntry { sha: string; authoredAt: string; authorLogin: string | null; message: string; version: string | null }
export function buildTrace(commits: PathCommit[], versions: Map<string, string>): SkillTraceEntry[];
export function groupLessonsByVersion(entries: SkillTraceEntry[], lessons: SkillLessonRow[]): { version: string | null; entries: SkillTraceEntry[]; lessons: SkillLessonRow[] }[];
```
`groupLessonsByVersion` keys on the lesson's **own declared** `versionUsed`, never on commit proximity; a lesson
whose version matches no resolved commit lands in an explicit `unplaced` group labelled "version not in the last
30 commits". Wire-safe: every timestamp on the wire is a `string`.

**Lesson → memory candidate (`lesson-memory.ts`).** `lessonMemoryCandidates(skillName, lessons, cap)` →
`{ lessonId, namespace, content, kind: "procedural", source: SKILL_LESSON_SOURCE ("skill-lessons"), confidence: 0.6,
tags: [skillName, versionUsed || "unversioned"] }[]`. Namespace is the **skill name** (the finding's rule), which
keeps lessons out of every repo namespace and makes the dedup window per-skill. Confidence 0.6, deliberately below
scan-feed's 1.0: a lesson is a human's claim about a run, not an observed fact — the provenance band must say so.
`LESSON_MEMORY_CAP = 10` newest per skill per pass is the flood mitigation the finding asked for; the overlap
prefilter in the door is the second. Rows already carrying `memoryId` are skipped. Everything is best-effort:
`ingestSkillLessons` returns a tally and never throws, so a memory outage cannot fail an index pass.

**Reflect-as-PR.** `buildMemoryNoteFile(note)` (pure) emits `memory/<kind>/<slug>.md` with frontmatter
`kind`, `namespace`, `confidence`, `source: ascent:reflection`, and `supersedes:` — a list of **repo-relative
paths**, never DB uuids, because the registry is a tenant-free artifact and a uuid means nothing to a reviewer.
`proposeMemoryPr` mirrors `openMigrationPr`: branch `ascent/memory-<slug>`, one `openDraftPr` call, its 409
base-file guard surfaced as "won't overwrite". **Nothing in the customer's repo is deleted** — superseded notes
stay; the frontmatter is the link. At the next index pass `parseRegistryMemory` reads `supersedes` and
`upsertRegistryMemory` stamps `supersededBy` on those sibling mirror rows, so a *merged* PR is what retires the
old note. That round trip is the item's whole claim, and it is the only path by which a registry-origin row's
lifecycle changes.

**The reflect route branch.** `apply` is unchanged for hosted-origin members. If **any** member is
`origin === "registry"`, the DB apply is refused with `409 { error, code: "registry-origin" }` — the write would
be overwritten by the next index pass, so performing it would be a lie. The second, explicit body
`{ org, proposePr: { summaryContent, memberIds, namespace?, kind? } }` runs `guardRegistryWrite(slug, { minRole:
"member" })` (contents+PR write capability and an installation token; CODEOWNERS review is the real control, which
is why the floor is member and not admin), resolves the members' `registryPath`s, writes an `OrgMemoryProposal`
(`status: "proposed"`), opens the PR, stamps `status: "pr_open"` + `prUrl`/`prNumber`, and records
`recordAudit("org_memory.pr_proposed", { proposalId, slug, prUrl, memberIds })` — publication-shaped, so it is
audited. A member id from another tenant is rejected by the same org-scoped resolve `applyReflection` uses.

**Plan gates · self-hosted · privacy · retention.** The reflect route's existing `requireOrgAccess` +
`workspaceAllowsMemory` gate covers both branches unchanged; `selfHosted()` turns the plan half off as everywhere.
Trace and lessons ride the registry read gate (`requireOrgRead`) and the Skills tab's existing entitlement.
Privacy: a lesson's `project` slot and commit `authorLogin` are printed **as the registry already publishes them**
in a repo the org owns — no new person-level surface is created, nothing is aggregated across tenants, so
`CHAMPION_MIN_POP` does not arise. Retention: lesson and trace rows are mirror state and die with their registry
row; `OrgMemoryProposal` follows whatever `retention.ts` gains later (W1-F's file — untouched here).

**UI.** *Shared → Skills*: `SkillCard` gains a `Trace` disclosure (registry-origin rows only — a hosted skill has
no git history and must not be offered one); `SkillTracePanel` renders version groups with `Surface` + `Readout`
from `@/components/ui`, each group listing its commits (`sha` mono, relative date) and its lessons; a `null`
version renders `—` and an "unversioned" group is labelled, never merged into the newest. Tone follows the repo
`off|warn|ok` rule: zero lessons renders `—`, not `0`. *Shared → Registry*: `RegistryActivity` starts showing real
`lesson` entries. Every new file stays under the 200-LOC `src/features/**` cap — the timeline and the lesson list
are separate files from the first commit, not extracted later.

## Build order

1. **`lessons.ts` + `splitLessonEntries`** — pure parser, the count-exactness invariant, the source constant. Lands alone, changes no behaviour.
2. **Lesson rows in the index pass** — `org-skill-lessons.ts`, `replaceSkillLessons`, the skills-loop call, the vanish purge. `lessonCount` keeps its old value; now a ledger stands behind it.
3. **`listPathCommits` + `trace.ts` + the cache** — `org-skill-trace.ts`, `buildTrace`, `groupLessonsByVersion`. Pure fold tested off fixtures; no route yet.
4. **The Trace route** — `GET …/registry/trace`, cache-hit path, degrade path.
5. **Skills tab Trace panel** — `SkillTracePanel` + timeline + lesson list + `skillTrace.ts`; `RegistryActivity` lesson entries via `activityOf`.
6. **`supersedes` round trip** — `parse.ts` reads it, `upsertRegistryMemory` stamps `supersededBy`. Independent of the PR writer and landable before it.
7. **`memory-pr.ts` + the proposal row** — `buildMemoryNoteFile`, `proposeMemoryPr`, `org-registry-proposals.ts`.
8. **The reflect route branch** — origin refusal, `proposePr`, audit row.
9. **Lesson → memory ingest** (gated on W1-B's `writeMemoryCandidate`; held for integration if unmerged).
10. **Docs** — `org-registry/README.md` lessons/Trace sections, `skills.md` Trace section + the Known gap deleted.

## Tests

- `src/lib/registry/lessons.test.ts` (new) — **fail-before:** nothing parses a heading today. After: the three fixture entries in `FIXTURE_LESSONS` produce three rows with `versionUsed` `2.0.0 / 2.0.0 / 2.1.0` and their projects; an em-dash separator parses; a range version `0.1-1.0` survives verbatim; a heading with no date gives `learnedOn: null` **and still produces a row**; `splitLessonEntries(text).length === countLessons(text)` over every fixture (the invariant).
- `src/lib/registry/index-registry.test.ts` (extend) — **fail-before:** the pass writes no lesson row. After: three rows for the fixture skill, a second identical pass writes none (idempotent on `entryHash`), a `LESSONS.md` that vanished purges its rows, and `counts.lessons` still equals the row count.
- `src/lib/registry/trace.test.ts` (new) — versions resolve for the newest 6 commits and are `null` beyond; `groupLessonsByVersion` puts a lesson whose version matches no commit in `unplaced` (**fail-before:** a nearest-commit heuristic would silently attach it to the wrong version); `truncated` is set when the commit list hits the cap.
- `src/lib/registry/memory-pr.test.ts` (new) — `buildMemoryNoteFile` emits `supersedes:` as paths, never uuids; `proposeMemoryPr` maps `openDraftPr`'s 409 to "won't overwrite"; the branch name is stable across retries (PR reuse).
- `src/lib/registry/lesson-memory.test.ts` (new) — candidates are `procedural` / `skill-lessons` / confidence 0.6 / namespace = skill name; the per-skill cap holds at 10; a lesson with a `memoryId` is skipped (**fail-before:** without the skip, every pass re-ingests every lesson).
- `src/app/api/org/memory/reflect/route.test.ts` (new) — **fail-before:** applying a reflection whose members are registry-origin succeeds today and is silently reverted by the next index; after, it is a 409 `registry-origin`. Plus: `proposePr` opens the PR, writes the proposal row with `status: "pr_open"` and the audit row; a member id from another org is rejected; a hosted-only apply is byte-identical to today.
- `src/lib/registry/parse.test.ts` (extend) — `supersedes` parses as a path list; a note without it is unchanged.
- `src/features/shared/skills/SkillTracePanel.test.tsx` (new) — a null version renders `—`, an unavailable history renders "history unavailable" (not an empty timeline), and a hosted-origin skill offers no Trace.
- **Structural guards:** `wire-safe-dates` gains the three new row types (Director line); `id-routes-gated` unaffected (no `[id]` route added); doc-sync satisfied by `org-registry/README.md` + `skills.md`, with the `memory.md` paragraph declared as a W1-B handoff in the dismissal sentence.
- **UAT:** re-run **Sam** — "the lesson I wrote after last week's run is in the memory my agent recalls, and I can see which version of the skill taught it". **Tomáš** (DevEx half) for the Trace panel. No PDF change, so **Dana / M1** is not triggered.

## Gate + done criteria

`npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` (after the build) → LOC checks (300 `.tsx`
/ 200 `src/features/**`) → e2e (Skills + Registry tabs moved). **Done when:** an index pass over a registry with
lessons writes one row per `## ` heading and re-running it writes none; the Trace panel shows a version timeline
for a registry skill with `—` where a version could not be resolved; a lesson appears in Memory as a `procedural`
row sourced `skill-lessons` in the skill's namespace; applying a reflection over registry-origin rows is refused
and the PR path returns a draft PR whose note carries `supersedes:`; a merged such PR causes the next index pass
to stamp `supersededBy` on the old notes; the `SkillGeneration` Known gap is gone from `skills.md`.

## Out of scope (explicitly)

- **#19 Live invoke channel** and **#18 Standards conformance ledger** — same lane, built first; per-repo skill sync
  state in the Trace panel is #18's adoption pass, so the panel shows the lesson's own `project` slot and **no**
  fabricated per-repo column.
- **#14 `.ai/memory` mirror (W1-B)** — the `RepoMemoryMirror` model, `memory-read.ts`, the Memory tab and
  `memory-kinds.ts`. This lane consumes W1-B's door and writes none of it.
- **#17 Work-time registry over MCP (W2-K)** — no MCP tool, no `OrgMemoryCitation`, no `recall.ts` change. Recall
  gains no semantic/embedding layer here; `consolidation.ts` is imported read-only and unmodified.
- **#25 Org-brief for every lane (W2-G)** — lane lessons/declines flowing back out of the loop engine.
- **#20 Athena as registry curator (deferred)** — no agent-initiated PR proposals; every PR here is a human click.
- **#23 Agent behaviour ledger / OTLP (concept-doc)** and **#21 identity graph (deferred)** — no per-person
  attribution beyond the commit author git already publishes.
- **#31 Signed tenant history bundle** and **#6 signed attestation (deferred)** — the PR is reviewed, not signed.
- **#32 Retention compaction (W1-F)** — `src/lib/db/retention.ts` is untouched.
