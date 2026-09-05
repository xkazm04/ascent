# 14 — `.ai/memory` comes home: per-repo agent memory indexed into Org Memory

size XL · effort 8 / impact 9 / risk 6 · gate **policy** · lane **W1-B** · wave **1**

## Premise check (read the code first)

Verified against the tree by symbol, not line. **Held:** the frontmatter schema and seed
(`buildMemorySeed`, `src/lib/standard/memory.ts`); the skill's "append a note after every track"
protocol (`src/lib/onboarding/skill.ts:315`); the scan only *counting* entries
(`aiStandard()` in `analyze/index.ts`, `idx.count(/^\.ai\/memory\/\d{4}-.*\.md$/)`);
`pickFilesToFetch` matching no `.ai/` path; `scan-feed.ts`'s never-throwing, idempotent door
(`writeScanMemory` dedups on exact content + `overlapScore ≥ 0.95` inside `(orgId, namespace, source)`);
and `SkillGeneration` (`schema.prisma:1393`) having no outcome link.

**One premise is under-specified and its naive form is unsafe.** "Fetch the bodies on the snapshot":
everything `pickFilesToFetch` returns lands in `RepoSnapshot.files`, which `buildScanScoreInput` turns
into the assessment prompt. Adding memory paths to the pick list *is* putting untrusted agent-written
prose into the scan prompt. The design below therefore **quarantines** memory picks out of `files`
inside `fetchSnapshot`, before any scorer sees the snapshot.

**New fact (matters to W1-A/#13):** `aiStandard()` already reads `idx.content(".ai/manifest.yaml")` for
its 4-point "declares capabilities + control placement" award, but the manifest is in **no** fetch step
— the content is always `""` and the award is **dead code today**. Adding it to the fetch list (this
lane's job, on W1-A's behalf) makes an existing deterministic award start firing on repos that already
qualify: a score movement with no rubric change. Flagged under handoffs.

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/lib/github/source.ts` — `pickFilesToFetch` (`.ai/manifest.yaml|.yml` + `.ai/guardrails.yaml|.yml`
  into `exactNames`; a new reserved memory step) **plus a ~10-line quarantine block in `fetchSnapshot`**
  and two module constants. *Wider than §2's "`pickFilesToFetch` only" — see handoff 1; the quarantine
  cannot live anywhere else without memory content reaching the prompt.*
- `src/lib/local/source.ts` — `memoryFiles: []` (local-source parity).
- `src/lib/types.ts` — `RepoSnapshot.memoryFiles?: FetchedFile[]`.
- `src/lib/scan.ts` — one fire-and-forget hook after Phase 1 (`void mirrorRepoMemory({...})`, ~6 lines).
- `src/lib/memory/scan-feed.ts` — extract the private `writeScanMemory` into an exported
  `ingestObservedMemory(orgId, namespace, source, content, tags)` door (byte-identical behaviour for the
  three existing callers), so a second source needs no second dedup implementation.
- `src/lib/org/memory-kinds.ts` — `REPO_MEMORY_SOURCE = "repo-memory"`, `isRepoMemorySource()`.
- `src/lib/db/org-memory.ts` — `MemoryListOpts.source?: string` (one `and.push`).
- `src/app/api/org/memory/route.ts` — pass `source` through from the query string.
- `src/lib/db/skill-history.ts` — `getSkillGenerationOutcomes(repoFullName, orgId)` join.
- `src/app/org/[slug]/memory/page.tsx` — load the two new reads, pass them down.
- `src/features/shared/memory/{MemoryPanel,MemoryFilterBar,MemoryCard,MemoryTab,MemoryTypes}.tsx|ts` —
  source filter, provenance badge case, dead-ends panel mount.
- `docs/features/org-knowledge/memory.md` — new "Repo-sourced memory (`.ai/memory` mirror)" section.

**Files to create**
- `src/lib/standard/memory-read.ts` — pure parser (explicitly carved out of W1-A's `standard/**` in §2).
- `src/lib/standard/memory-read.test.ts`
- `src/lib/db/repo-memory.ts` — `RepoMemoryMirror` reads/writes (`upsertMirrorEntries`, `listRepoDeadEnds`,
  `countMirrored`).
- `src/lib/memory/repo-memory-mirror.ts` — the orchestrator (gates → parse → upsert → ingest).
- `src/lib/memory/repo-memory-mirror.test.ts`
- `src/lib/memory/repo-memory-untrusted.test.ts` — the boundary guard.
- `src/features/shared/memory/RepoMemoryDeadEnds.tsx` (≤200 LOC, `"use client"`).
- `src/features/shared/memory/RepoMemoryDeadEnds.test.tsx`
- `src/lib/github/source-memory-pick.test.ts` — pick-list + quarantine guards.

**Prisma (landed by the wave-1 schema pass, not by this lane)**

```prisma
model RepoMemoryMirror {
  id           String   @id @default(uuid())
  orgId        String
  repoFullName String                       // "owner/repo" — also the OrgMemory namespace
  path         String                       // ".ai/memory/0007-pglite-drift.md"
  contentHash  String                       // sha256(path \0 body) — the idempotency key
  entryId      String?                      // frontmatter `id`; null when absent (honest null, never 0)
  rawKind      String?                      // open vocabulary as written
  mappedKind   String                       // episodic | semantic | procedural
  scope        String?
  entryDate    String?                      // frontmatter date, VERBATIM text (repo-authored, not a timestamp)
  supersedes   String?
  refsJson     String   @default("[]")      // TEXT, no jsonb (DSQL/PGlite)
  body         String                       // capped at 6000 chars by the parser
  headSha      String?
  superseded   Boolean  @default(false)
  orgMemoryId  String?                      // the OrgMemory row this fed; null = deduped or skipped
  skipReason   String?                      // "malformed" | "capped" | "deduped" | null
  firstSeenAt  DateTime @default(now())
  lastSeenAt   DateTime @updatedAt
  org Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  @@unique([orgId, repoFullName, path, contentHash])
  @@index([orgId, repoFullName])
  @@index([orgId, mappedKind])
}
```
Plus `Organization.repoMemoryMirror Boolean?` (null = default ON for org-owned repos; `false` = opt-out)
and the `repoMemoryMirror RepoMemoryMirror[]` back-relation. Wire-safe-dates entry for the exported
`RepoMemoryEntryRow` (its `firstSeenAt`/`lastSeenAt` are `string`).

**Director-owned lines requested at merge**
- `src/lib/db/index.ts`: re-export `./repo-memory` (`upsertMirrorEntries`, `listRepoDeadEnds`,
  `countMirrored`, type `RepoMemoryEntryRow`).
- `context-map.json`: add `src/lib/standard/memory-read.ts`, `src/lib/memory/repo-memory-mirror.ts`,
  `src/lib/db/repo-memory.ts`, `src/features/shared/memory/RepoMemoryDeadEnds.tsx` to the
  Org Memory / AI-Native Standard groups' `filePaths`.
- `scripts/docs/feature-doc-map.json`: `src/lib/memory/**` already maps to `memory.md`; add
  `src/lib/db/repo-memory.ts` to the same entry's `sourceGlobs`.

**MUST NOT TOUCH** — `src/lib/analyze/index.ts` (the count stays exactly as is; the mirror never feeds a
score), `src/lib/standard/manifest.ts` and the rest of `src/lib/standard/**` (W1-A), `src/lib/standard/pr.ts`
(W1-H), `prisma/schema.prisma` / `init.sql` / `wire-safe-dates.test.ts` (Class B), `src/lib/memory/recall.ts`
(W2-K), `src/lib/memory/consolidation-engine.ts` (W1-C), `src/lib/db/retention.ts` (W1-F),
`src/lib/scan-ingest.ts` and `src/lib/scan-finalize.ts` (W4-P / shared).

**Handoffs to other lanes**
1. **Director — write-set expansion.** §2 grants "`pickFilesToFetch` only" in `source.ts`. The
   `fetchSnapshot` quarantine, `types.ts` field and `scan.ts` hook are required by the untrusted rule
   and are requested explicitly. No wave-1 lane declares those regions; W4-P (#4) rewrites
   `source.ts`/`scan-ingest.ts` wholesale in wave 4 and must carry the quarantine into the extracted
   GitHub adapter — add it to W4-P's preconditions.
2. **W1-A (#13).** The manifest/guardrails fetch lines are delivered here; W1-A does not touch
   `source.ts`. Consequence W1-A owns: the 4-point D1 manifest award in `aiStandard()` stops being dead
   code, so its readout work should land in the same wave, and the Director (with W2-I, who owns the
   rubric bump) decides whether that warrants an r11 note. This lane changes no scoring code.
3. **W1-D (#36).** #36 plans a second memory ingest (`source: "skill-lessons"`). The door
   (`ingestObservedMemory`) and the vocabulary (`memory-kinds.ts`) are **this lane's files**: W1-D
   imports the door and adds its constant after W1-B merges, or the Director serializes the merges.
   Two dedup implementations in one store is the failure to avoid.
4. **W1-F (#32).** Add `RepoMemoryMirror` to the erase/purge paths in `retention.ts` (`onDelete: Cascade`
   covers org deletion; a repo removed from the org needs an explicit delete).
5. **W1-A / W1-D — one doc line each:** `ai-manifest-spec.md` notes that `.ai/memory` is now *read*;
   `skills.md` links the skill-outcome join.

## Goal

Every `.ai/memory` entry an agent writes in an adopted repo becomes searchable org-wide, with
provenance, superseding honoured and the content held permanently behind the untrusted boundary — and
the onboarding skill's `progress` notes finally close the loop from `SkillGeneration` to a verified
rescan delta. *Competitive angle:* the memory format is Ascent's own vendor-neutral spec, so the
fleet-wide "what agents learned / what failed" corpus compounds with adoption and cannot be copied
without shipping the standard first.

**Known gaps deleted:** `memory.md` carries *no* gap entry for this — the silence is the drift. This
lane adds the section, leaves the decay/reflection cron gap (`memory.md:449-453`, not this item's)
intact, and fixes the file's two stale paths (the memory components live under
`src/features/shared/memory/`, not `src/app/org/[slug]/memory/`).

## Behaviour

### Ingestion (fetch → quarantine)

`pickFilesToFetch` gains one final step, **after** the workflow step so it ranks last:

```ts
const MAX_MEMORY_FILES = 12;              // newest N entries
export const MEMORY_ENTRY_RE = /^\.ai\/memory\/(\d{4})-[^/]+\.md$/i;
```
Candidates: tree paths matching `MEMORY_ENTRY_RE` (README and unnumbered files excluded), sorted by the
numeric prefix **descending**, capped at `MAX_MEMORY_FILES`, added straight to the set as a reserved
quota (like workflows — not gated by `MAX_FILES`, still inside `MAX_TOTAL_BYTES`, reached last).
`fetchSnapshot` then partitions before returning: a fetched file matching `MEMORY_ENTRY_RE` moves to
`memoryFiles` and is **removed from `files`**. `coverage` is computed from the non-memory set, so the
mirror cannot move `estimateCoverage`.

### Parser — `src/lib/standard/memory-read.ts` (pure, dependency-free, client-safe)

Modelled on `src/lib/org/skill-frontmatter.ts` (a line parser, not a YAML dependency — the schema is
flat scalars plus one list).

```ts
export interface RepoMemoryEntry {
  path: string; entryId: string | null; rawKind: string | null; mappedKind: MemoryKind;
  scope: string | null; entryDate: string | null; supersedes: string | null;
  refs: string[]; body: string; contentHash: string;
}
export function parseRepoMemoryEntry(path: string, content: string): RepoMemoryEntry | null;
export function parseRepoMemoryEntries(files: { path: string; content: string }[]): {
  entries: RepoMemoryEntry[]; skipped: { path: string; reason: "malformed" | "empty" }[];
};
export function mapMemoryKind(rawKind: string | null): MemoryKind;   // open vocabulary → curated enum
export function supersededPaths(entries: RepoMemoryEntry[]): Set<string>;
```
- `mapMemoryKind`: `decision | reference` → `semantic`; `failed-approach | convention | gotcha` →
  `procedural`; `progress` → `episodic`; unrecognised → `semantic` (matching `normalizeMemoryKind`'s
  default). The raw value is preserved in `rawKind`, never lost.
- No frontmatter block, or a whitespace-only body ⇒ `null` (skipped and counted, never guessed).
- `entryDate` stays the **verbatim string**: repo-authored text, not a timestamp. Parsing it to a
  `Date` would invent precision and put a `Date` on a row type that crosses to a client.
- Body capped at 6000 chars; `contentHash` = first 32 hex of `sha256(path \0 body)` — deterministic,
  which is what makes the upsert idempotent.

### Mirror — `src/lib/memory/repo-memory-mirror.ts`

```ts
export async function mirrorRepoMemory(input: {
  orgSlug?: string; repoFullName: string; headSha?: string | null;
  memoryFiles: { path: string; content: string }[];
}): Promise<{ mirrored: number; deduped: number; skipped: number } | null>;
```
Same posture as `scan-feed.ts`: **never throws** and **idempotent**. Gates, in order, all fail-closed:
(1) `isDbConfigured()` + a non-empty `orgSlug` — an anonymous/public-funnel scan mirrors nothing;
(2) the repo must be a `Repository` row **in that org** — an org scanning a third party's public repo
does not ingest that repo's agent prose; (3) `Organization.repoMemoryMirror !== false` (null = on);
(4) `workspaceAllowsMemory` (`src/lib/db/personal.ts`), the same gate every memory write route uses —
`selfHosted()` already turns its plan half off; (5) per-repo cap of 12 entries per scan and 200 live
mirrored rows per `(org, repo)`, newest win, overflow recorded as `skipReason: "capped"` rather than
silently dropped.

Then: parse → `upsertMirrorEntries` (unique on `(orgId, repoFullName, path, contentHash)`, so an
unchanged entry only bumps `lastSeenAt`) → for each **new** row, `ingestObservedMemory(orgId,
repoFullName, REPO_MEMORY_SOURCE, body, [repoFullName, mappedKind, "repo-memory"])`, storing the
returned OrgMemory id (or leaving `orgMemoryId` null with `skipReason: "deduped"`).

Superseding: an entry whose `supersedes` names an existing mirrored `entryId` marks that row
`superseded = true` and archives its OrgMemory row (`archived: true`) — **never** a hard delete
(memory.md's supersede-not-edit contract).

Confidence is `0.6` (the "medium: probable, unverified" band), not `1.0`. A scan-pipeline observation
is a machine fact; an agent's note is a claim. Recording it at the high band would be dishonest.

### Untrusted content — the rule that makes this shippable

Mirrored bodies are **agent-written prose from a customer repository**: the textbook injection
carrier. Three positional guarantees, each with a test:
1. They never enter `RepoSnapshot.files`, so they never reach `buildScanScoreInput`/`buildAssessmentPrompt`.
2. They never reach `aiStandard()` — `analyze/index.ts` is untouched and its count reads the *tree*.
3. Once in `OrgMemory` they are subject to the existing boundary: `buildConsolidationPrompt` /
   `buildReflectionPrompt` wrap all foreign content in `UNTRUSTED_OPEN/CLOSE`
   (`src/lib/memory/untrusted-boundary.test.ts`), which this lane extends with a repo-memory-sourced
   candidate carrying a forged close marker.

### Skill-outcome join — `src/lib/db/skill-history.ts`

```ts
export interface SkillGenerationOutcome {
  generationId: string; generatedAt: string; trackIds: string[];
  progressNotes: { path: string; entryDate: string | null; trackIds: string[] }[];
  verifiedDelta: number | null;   // overall-score change from the first scan AFTER the newest note
  baselineScanAt: string | null;  // null when there is no post-note scan yet
}
export async function getSkillGenerationOutcomes(repoFullName: string, orgId: string): Promise<SkillGenerationOutcome[]>;
```
`progressNotes` are mirrored rows with `mappedKind === "episodic"` whose body mentions a track id from
that generation (exact token match on the id, no fuzzy matching). `verifiedDelta` is computed from the
existing scan read helpers in `src/lib/db/scans-read.ts` (**read-only import — no edit**) and is
`null`, rendered "—", whenever there is no scan after the note. **G4:** an unmeasured outcome degrades
to absence, never to `0`.

### UI — Memory tab (`?tab=memory`, `src/features/shared/memory/`)

- `MemoryFilterBar` gains a **Source** select (`All · Authored · From scans · From repos`) bound to the
  new `source` param — existing `selectClass`, no new primitive.
- `MemoryCard` provenance badge gets the `repo-memory` case (`auto · repo`, repo namespace) beside the
  existing `auto · scan`. Same tone tokens, no new colour.
- `RepoMemoryDeadEnds.tsx` — a panel above the list, rendered only when the org has ≥1 `procedural`
  mirrored row from a `failed-approach`: "Dead ends other repos already hit", grouped by repo, each row
  truncated with repo + entry date. Existing `Tile` chrome from `@/components/ui` (hairline
  `TILE_LEDGER`, no self-border — repo law) and `CopyForLlm`, as `MemoryCard` does.
- Mirrored bodies render as preformatted plain text on `MemoryCard`'s existing path — never
  `dangerouslySetInnerHTML`.

### Privacy, audit, self-hosted

- Nothing mirrored is public: no aggregate/public surface, so `CHAMPION_MIN_POP` does not apply. The
  dossier's "registry `memory/` candidates" half is **dropped** — it publishes customer prose across a
  tenant boundary and belongs with #18's consent-bearing signal writer.
- An admin toggling `repoMemoryMirror` writes an `AuditLog` row (`memory.mirror.toggled`, `{ enabled }`)
  via the existing org-settings helper. Per-entry mirroring writes none — `RepoMemoryMirror` *is* the ledger.
- Self-hosted: gates 3–5 collapse to on/uncapped via `selfHosted()`; behaviour otherwise identical.
- Retention: rows cascade with the org; the per-repo delete is handoff 4.

## Build order

1. **Fetch list + quarantine.** `exactNames` += `.ai/manifest.yaml`, `.ai/manifest.yml`,
   `.ai/guardrails.yaml`, `.ai/guardrails.yml` (W1-A's need); `MEMORY_ENTRY_RE` + reserved memory step;
   `RepoSnapshot.memoryFiles`; the `fetchSnapshot` partition; `local/source.ts` parity. Gateable alone —
   at this point the memory bodies are fetched and go nowhere.
2. **Parser.** `standard/memory-read.ts` + tests. Pure, no DB, no I/O.
3. **Taxonomy + door.** `REPO_MEMORY_SOURCE` in `memory-kinds.ts`; extract `ingestObservedMemory` out of
   `scan-feed.ts`'s private `writeScanMemory` with the three existing callers unchanged (a pure
   refactor — the existing `scan-feed.test.ts` must pass untouched).
4. **Persistence.** `db/repo-memory.ts` (`upsertMirrorEntries`, `listRepoDeadEnds`, `countMirrored`),
   against the schema the wave-1 pass already landed. Wire rows declare `string` timestamps.
5. **Mirror orchestrator.** `memory/repo-memory-mirror.ts` with the five gates, supersede handling and
   the cap; unit tests with a mocked prisma.
6. **Hook.** The `void mirrorRepoMemory({...})` line in `scan.ts` after Phase 1, wrapped so it cannot
   reject into the scan.
7. **Skill-outcome join.** `getSkillGenerationOutcomes` + tests, honest-null on `verifiedDelta`.
8. **UI.** Source filter (route + `org-memory.ts` opt + `MemoryFilterBar`), badge case,
   `RepoMemoryDeadEnds` panel + the outcome line, page loader wiring. LOC check under 200 per file.
9. **Docs.** `memory.md` section + the two stale-path corrections; the handoff notes for W1-A/W1-D/W1-F.

## Tests

**New**
- `src/lib/github/source-memory-pick.test.ts` — *fails before:* `pickFilesToFetch` returns no `.ai/`
  path at all today, so every assertion fails. Manifest + guardrails picked; newest 12 numbered entries
  picked, newest first; `README.md`/unnumbered never picked; memory picks consume no `MAX_FILES` slot
  (a 50-slot-saturated tree still yields them); and the partition — `.ai/memory/0002-x.md` lands in
  `memoryFiles` and **not** in `files`.
- `src/lib/standard/memory-read.test.ts` — happy path; open-vocabulary kind mapping; malformed/absent
  block → skipped with a reason; supersedes chain; the 6000-char cap; `contentHash` stable across two
  parses and divergent on a one-byte change.
- `src/lib/memory/repo-memory-mirror.test.ts` — each of the five gates blocks (no org / foreign repo /
  opt-out / plan / cap); a second identical scan mirrors 0 new rows; a superseding entry archives its
  predecessor without deleting it; a thrown prisma error returns `null` and does not propagate;
  `confidence` is `0.6`.
- `src/lib/memory/repo-memory-untrusted.test.ts` — *fails before:* the module does not exist. A body
  carrying a forged `UNTRUSTED_CLOSE` plus an instruction-shaped payload (a) is absent from a
  `RepoSnapshot.files`-derived prompt input entirely and (b) as a consolidation candidate sits inside
  exactly one boundary block.
- `src/features/shared/memory/RepoMemoryDeadEnds.test.tsx` — nothing rendered at zero rows; grouping by
  repo; body rendered as text, never HTML.

**Extended**
- `src/lib/memory/untrusted-boundary.test.ts` — add a `source: "repo-memory"` candidate to the existing
  consolidation/reflection cases.
- `src/lib/memory/scan-feed.test.ts` — must pass **unchanged** after step 3's extraction (that is the
  refactor's proof).
- `src/lib/github/source-subpath.test.ts` — sub-path scans still pick repo-wide `.ai/` files.
- `src/lib/db/org-memory.test.ts` — the `source` filter narrows and still composes `visibilityScope`.

**Structural guards** — `wire-safe-dates.test.ts` (Director-landed entry for `RepoMemoryEntryRow`),
doc-sync (`src/lib/memory/**` → `memory.md` in the same commit), LOC checks (new `src/features/**`
files ≤200). No `[id]` route is added, so `id-routes-gated.test.ts` is untouched.

**UAT** — **Sam** (staff engineer): scan a repo with `.ai/memory`, confirm its entries appear under
"From repos" with the repo namespace and a `medium` confidence badge, and that another repo's dead end
is visible without leaving the tab. **Dana** unaffected (no briefing/PDF change; M1 does not fire).

## Gate + done criteria

`npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks (300 `.tsx`,
200 `src/features/**`) → e2e for the Memory tab (UI moved). Done when: a re-scan of a repo with ≥2
`.ai/memory` entries produces mirrored `OrgMemory` rows with `source: "repo-memory"` visible in the
tab; a second identical scan adds none; the untrusted guard is green; and `docs/features/org-knowledge/
memory.md` documents the read path, the confidence band and the opt-out.

## Out of scope (explicitly)

- **#13 Manifest-as-scan-input** (W1-A) — fetch lines only; no manifest parsing, no `Scan.manifestJson`,
  no capability-conformance readout. **#15 Guidance arbiter** (W2-I) — the mirror feeds no score;
  `analyze/index.ts` and its memory *count* keep their exact current shape. **#36 Lessons mirror**
  (W1-D) — this lane ships the ingest door, not that source. **#26 One improvement ledger** (W2-G) —
  `getSkillGenerationOutcomes` is a read-side join; it writes no `ImprovementPr` or programme evidence.
  **#17 MCP registry** (W2-K) — mirrored memories are not exposed as an MCP tool here.
- **Deferred items this must not absorb:** #20 (no PR-proposing from mirrored memory), #23
  (`.ai/memory` is not a telemetry sensor), #29 (`memoryFiles` are **not** persisted as scan inputs),
  #31 (mirrored rows are not exportable state), #6/#12/#21/#24/#28/#37 (untouched).
- **Dropped from the dossier:** registry `memory/` candidates — publishing customer prose out of the
  tenant needs #18's consent-bearing signal writer.
