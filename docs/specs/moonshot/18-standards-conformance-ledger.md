# 18 — Standards conformance ledger: registry signals + registry-map as a fleet dimension

size XL · effort 8 / impact 9 / risk 5 · gate: contract · lane **W1-D** (built **second**, after #19,
before #36) · wave 1

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/lib/registry/index-walk.ts` — add the `signals` lane (`isSignalsFile`) to `SelectedArtifacts`
  + `selectArtifacts`; no change to the existing five lanes.
- `src/lib/registry/index-registry.ts` — two new call sites in `indexRegistry` (subjects, signals) +
  two fields on `IndexRegistryResult`; parsing lives in new siblings so this file stays orchestration
  (373 LOC today; the edit must not push it past ~400).
- `src/lib/registry/layout.ts` — `REGISTRY_DIRS.signals`, `REGISTRY_KNOWLEDGE_DIR`, `SIGNALS_SCHEMA
  = "rkb-signals/1"`, `REGISTRY_MAP_PATH = ".ai/registry-map.json"`, `REPO_CONSULTS_PATH`.
- `src/lib/db/org-registry-write.ts` — `recordIndexResult` stamps `subjectCount` /
  `signalContributors`; nothing else moves.
- `src/lib/org/registry-view.ts` — three additive `RegistryView` blocks (`conformance`,
  `governance`, `signals`), honest-empty when unread.
- `src/features/shared/registry/RegistryPanel.tsx` — mount the three new panels (161/200 LOC, so the
  panels are separate files).
- `docs/features/org-registry/README.md` — new section; deletes the known gap named below.

**Files to create**
- `src/lib/registry/subjects.ts` + `subjects.test.ts` — `readBundleSubjects(files, warnings)`.
- `src/lib/registry/signals.ts` + `signals.test.ts` — `aggregateSignals(files, warnings)`.
- `src/lib/registry/conformance-map.ts` + `conformance-map.test.ts` — pure parse of a
  `rkb-registry-map/1` document + `countConsults(jsonl)`.
- `src/lib/registry/conformance-read.ts` — App-token side-channel read of one repo's
  `.ai/registry-map.json` + `.ai/consults.jsonl` (never the scan's file budget).
- `src/lib/registry/conformance-sweep.ts` + `conformance-sweep.test.ts` — fleet orchestration.
- `src/lib/registry/signals-contribution.ts` + test — build + **scrub** the payload.
- `src/lib/registry/signals-pr.ts` — `openOrUpdateSignalsPr` (create **or update**; see premise 3).
- `src/lib/db/org-registry-subjects.ts`, `org-registry-conformance.ts`,
  `org-registry-signals.ts` (+ `org-registry-conformance.test.ts`).
- `src/app/api/org/[slug]/registry/conformance/route.ts` (+ `route.test.ts`).
- `src/app/api/org/[slug]/registry/signals/route.ts` (+ `route.test.ts`).
- `src/features/shared/registry/RegistryConformanceMap.tsx`, `RegistryWeakGovernance.tsx`,
  `RegistrySignalsReadout.tsx`, `conformanceModel.ts` + `conformanceModel.test.ts`.
  (`registryModel.ts` is 198/200 LOC — nothing may be added to it.)

**Prisma models/columns needed (landed by the wave-1 schema pass, not by this lane)**
- `OrgKnowledgeSubject` — `id`, `orgId`, `registryId`, `bundle`, `slug`, `category String?`,
  `subcategory String?`, `status String?`, `file String`, `techniqueCount Int @default(0)`,
  `useWhenJson String @default("[]")`, `lawsJson String @default("[]")`, `archived Boolean
  @default(false)`, `indexedAt DateTime`, `@@unique([registryId, bundle, slug])`,
  `@@index([orgId, bundle])`.
- `RepoConformanceMap` (one header per repo) — `id`, `orgId`, `repositoryId @unique`, `mapSha`,
  `schema`, `generatedAt DateTime`, `contexts Int`, `pairs Int`, `judged Int`, `deviations Int`,
  `weaklyGoverned Int`, `unmatched Int`, `domainsJson`, `bundleDigestsJson`, `consults30d Int?`,
  `warningsJson String @default("[]")`, `ingestedAt DateTime`.
- `RepoConformance` — `id`, `orgId`, `repositoryId`, `contextName`, `contextGroup String?`,
  `bundle`, `subjectSlug`, `state String`, `confidence String?`, `score Float?`,
  `evidence String?`, `evaluatedAt DateTime?`, `evaluatedAgainst String?`, `mapSha`,
  `ingestedAt DateTime`, `@@unique([repositoryId, contextName, subjectSlug])`,
  `@@index([orgId, subjectSlug, state])`.
- `RegistrySignal` — `id`, `orgId`, `registryId`, `contributor`, `app String?`, `bundle`,
  `subjectSlug`, `consults Int?`, `deviations Int?`, `citResolved Int?`, `citMoved Int?`,
  `citGone Int?`, `windowDays Int`, `generatedAt DateTime`,
  `@@unique([registryId, contributor, bundle, subjectSlug])`.
- `RegistrySignalContribution` (audit) — `id`, `orgId`, `registryId`, `contributor`, `prUrl String?`,
  `commitSha String?`, `payloadDigest`, `bundlesJson`, `subjects Int`, `deviations Int`,
  `actor String`, `createdAt DateTime`.
- `OrgRegistry` columns: `subjectCount Int @default(0)`, `signalContributors Int @default(0)`,
  `signalsContributor String?` (the org's chosen contributor id).
- All five client-facing row types go in `src/lib/db/wire-safe-dates.test.ts`; every timestamp is
  declared `string` on the wire type and `.toISOString()`d in `toRow()`.

**Director-owned lines requested at merge**
- `context-map.json`: add the new `src/lib/registry/*` and `src/lib/db/org-registry-*` modules,
  the two route dirs and the three panels to **AI Registry Repo (Onboarding & Index)** `filePaths`.
- `scripts/docs/feature-doc-map.json`: **no change needed** — `src/lib/registry/**`,
  `src/lib/db/org-registry*.ts`, `src/app/api/org/[slug]/registry/**` and
  `src/features/shared/registry/**` already map to `docs/features/org-registry/README.md`.
- `src/lib/db/index.ts`: **no line requested** — the `org-registry*` modules are deliberately not
  barrel-exported (see the header comment in `org-registry.ts`); the new ones follow that rule.

**MUST NOT TOUCH**: `prisma/schema.prisma`, `prisma/init.sql`, PGlite reconcile, `db/index.ts`,
`context-map.json`, `feature-doc-map.json`; `src/lib/mcp/**` and `src/lib/memory/recall.ts` (W2-K);
`src/lib/github/source.ts` and `scan-ingest.ts` (W1-B / W4-P); `src/lib/github/write.ts`
(`openDraftPr` is read-only to this lane); `src/lib/analyze/**`; `registryModel.ts` (at its cap).

**Handoffs to other lanes**
- → **W2-K (MCP)**: `get_governing_subject(context|path)` and `get_conformance(repo)` over
  `OrgKnowledgeSubject` / `RepoConformance`. This lane ships the rows and the read helpers
  (`listSubjectsForContext`, `listConformance`) and exposes **no** MCP tool.
- → **W1-B (fetch list)**: *optional, not requested for wave 1.* If scan-time freshness is later
  wanted, `.ai/registry-map.json` would need its own fetch slot **outside** `pickFilesToFetch`'s
  LLM budget; this lane instead reads it out-of-band (premise 4).
- → **W1-D itself**: this item is second in the lane. It rebases on #19's `aggregateUsage`/
  `OrgSkillUsageSample` edits, and leaves `index-registry.ts` in a shape #36 can add the lessons
  parse to (one guarded block per lane, parsing in a sibling module).

## Goal and the Known gap this deletes

Turn the two artifacts the ecosystem already produces and nobody reads — each managed repo's
`.ai/registry-map.json` (52 contexts × 180 judged subject pairs) and the registry's `signals/` lane —
into a fourth fleet instrument beside maturity, gate and adoption: **which of our own written
standards does each repo knowingly deviate from, and is the standard itself still true?** Competitive
angle: agent-readiness scorers grade repos against a vendor rubric; nobody grades a fleet against the
customer's *own* corpus with `file:line` evidence and feeds staleness back to the corpus.

Deletes from `docs/features/org-registry/README.md` § Known gaps: the `knowledge/` lane being read as
seven integers per bundle with no subject rows, and (partially) *"Fleet adoption is not measured"* —
the conformance half becomes measured; skill-sync adoption stays zero and its bullet stays, narrowed.

## Behaviour

### Data model and honest-null rules
- **`state`** is closed: `conformant | deviation | not-applicable | unjudged`. The generator's
  `unknown` stores as `unjudged` and renders **"—"**, never as conformant. A repo with no
  `.ai/registry-map.json` gets **no rows** and reads *"no map"* — a different fact from "no
  deviations", and every surface says so (G4).
- **Idempotency**: the sweep is keyed `@@unique([repositoryId, contextName, subjectSlug])` and
  upserts; a re-ingest of the same `mapSha` is a no-op except `ingestedAt`. Pairs absent from a newer
  map are deleted for that repo in the same transaction (a context that vanished is not a stale row).
- `consults30d` is `null` when `.ai/consults.jsonl` is absent — zero would claim "nobody consulted".
- `RegistrySignal` counts are `Int?`: a contributor may report `consults` without `citations`; a
  missing key is `null`, not `0` (the lane's own "unwitnessed ≠ current" rule).
- `evidence` is capped at 2000 chars, stored for the **org's own** UI, and **never** leaves the row
  (it is a `file:line` fact about one tree — see the signals scrub below).

### Modules (signatures)
```ts
// subjects.ts — index.json ONLY; never a walk of the ~1,000 markdown files.
export interface KnowledgeSubject { bundle: string; slug: string; category: string | null;
  subcategory: string | null; status: string | null; file: string; techniqueCount: number;
  useWhen: string[]; laws: string[] }
export function readBundleSubjects(files: {path: string; text: string|null}[], warnings: string[]): KnowledgeSubject[];

// signals.ts — signals/<contributor>.json, tolerant per file like aggregateUsage.
export interface SignalRow { contributor: string; app: string|null; bundle: string; subjectSlug: string;
  consults: number|null; deviations: number|null; citResolved: number|null; citMoved: number|null;
  citGone: number|null; windowDays: number; generatedAt: string }
export function aggregateSignals(files: {path: string; text: string|null}[], warnings: string[]):
  { rows: SignalRow[]; contributors: number };

// conformance-map.ts — pure.
export interface ConformancePair { contextName: string; contextGroup: string|null; bundle: string;
  subjectSlug: string; state: "conformant"|"deviation"|"not-applicable"|"unjudged";
  confidence: string|null; score: number|null; evidence: string|null;
  evaluatedAt: string|null; evaluatedAgainst: string|null }
export function parseConformanceMap(text: string): { ok: true; header: MapHeader; pairs: ConformancePair[] }
  | { ok: false; reason: string };
export function countConsults(jsonl: string, windowDays: number): { total: number; bySubject: Record<string, number> };

// conformance-read.ts — App-token side channel, 512KB cap, null on 404/parse failure.
export async function readRepoStandardsFiles(token: string, owner: string, repo: string, ref: string):
  Promise<{ map: string|null; consults: string|null; mapSha: string|null }>;

// conformance-sweep.ts
export async function sweepConformance(orgSlug: string, token: string,
  opts?: { repositoryIds?: string[] }): Promise<{ scanned: number; withMap: number; warnings: string[] }>;

// signals-contribution.ts
export function buildSignalsPayload(input: SignalsInput): { body: string; digest: string };
export function assertNoLeaks(body: string): { ok: true } | { ok: false; reason: string };
```

**Why the map is read out-of-band.** `pickFilesToFetch` spends a 50-file / 14,000-byte-per-file
budget on content that feeds the assessment prompt; the map is 113KB, so a scan fetch would truncate
it into unparseable JSON *and* burn a prompt slot. `conformance-read.ts` fetches it with
`githubAppFetch` (the audited client `registry/read.ts` already uses) under its own 512KB cap —
which is also why this item needs no `source.ts` edit and stays lane-disjoint.

### Routes
| Method · path | Auth | Notes |
|---|---|---|
| `GET /api/org/[slug]/registry/conformance` | `guardRegistryRead(slug)` (org access) | Returns the subject × repo matrix + weakly-governed list; no evidence bodies over 400 chars. |
| `POST /api/org/[slug]/registry/conformance` | `guardRegistryWrite(slug)` (org admin + installation token) | Runs `sweepConformance`; per-repo failures degrade to warnings, never a failed pass. |
| `POST /api/org/[slug]/registry/signals` | `guardRegistryWrite(slug)` + same-origin + typed confirm (`"contribute"`) | Publishes `signals/<contributor>.json` to the customer's registry. Writes `RegistrySignalContribution` **before** the GitHub call. |

Both new routes are `[slug]`-scoped, not `[id]`-scoped, so the resolve-then-gate rule applies to the
guard (`guardRegistryWrite` resolves the org and its token); every repo id in the sweep body is
constrained by `orgId` in the query so a foreign repo is simply not found.

### The signals writer, and its privacy floor
- Gated three ways, default **off**: the spine's lane role (`writesLane(declaration, "signals")`),
  `telemetrySink === "registry"`, and an explicit owner action.
- `contributor` = `signalsContributor` if set, else `ascent-<sha256(orgId+registryId).slice(0,12)>`
  — `[a-z0-9-]`, stable, not derived from a name.
- The payload comes from a **key-closed** builder (`schema`, `contributor`, `app: "ascent"`,
  `generatedAt`, `windowDays`, `stack`, `bundles.{consults,deviations,citations}`) and then through
  `assertNoLeaks`, which rejects path-, URL- and email-shaped values before any write: no repo names,
  no per-repo breakdown, no `file:line`, no citation pointers — counts only, summed fleet-wide.
- `stack` comes from `Repository.techStackJson`, majors only, omitted when unknown (premise 5).
- `openOrUpdateSignalsPr` creates the branch, PUTs the file with its existing sha when the path is
  already on base, and reuses an open PR. It does not call `openDraftPr` (premise 3).

### UI (Registry tab, `Shared` group)
- `RegistryConformanceMap.tsx` — subject (rows) × repo (columns) grid in `Tile`/`TILE_LEDGER`; cells
  are hairline swatches (deviation = azure accent at full weight, conformant = ledger rule,
  not-applicable = hollow, unjudged = "—"), counts mono `tabular-nums`. No hand-picked hex, and no
  `LEVEL_HEX` — this is not a score.
- `RegistryWeakGovernance.tsx` — `OrgTable` of contexts whose map says `governance: "weak"`,
  fleet-wide, with how many repos share that context: the registry's backlog, authored by evidence.
- `RegistrySignalsReadout.tsx` — per subject: consults, deviations, citation health
  (`resolved/moved/gone`); `contributors: 0` renders "no witness", never a green tick.
- `RegistryPanel.tsx` mounts all three under the instrument panel; each has an honest empty state
  (`Kicker` + one line) when nothing has been ingested.

### Self-hosted · plan gates · privacy floors · audit
- No new plan gate: conformance ingest is part of the registry the customer owns. `selfHosted()`
  already turns plan gates off; nothing here re-checks a tier.
- Public/aggregate surfaces are untouched, so `CHAMPION_MIN_POP` does not apply; the conformance map
  is org-internal behind `guardRegistryRead`. Nothing conformance-shaped reaches a public report.
- Publication is audit-shaped: `RegistrySignalContribution` records actor, digest and PR URL for
  every contribution, written before the outbound call so a failed PR still leaves the attempt.

## Build order

1. `layout.ts` constants + `index-walk.ts` `signals` lane and its unit test (fixture tree). Landable
   alone: `selectArtifacts` gains one key, nothing reads it yet.
2. `subjects.ts` + `org-registry-subjects.ts`; wire `readBundleSubjects` into `indexRegistry` and
   mirror rows (archive-vanished by `@@unique`). Registry tab still unchanged.
3. `signals.ts` + `org-registry-signals.ts`; wire `aggregateSignals` into `indexRegistry`;
   `recordIndexResult` stamps `subjectCount` / `signalContributors`.
4. `conformance-map.ts` (pure parse + `countConsults`) with fixtures copied from this repo's real
   `.ai/registry-map.json` header shape. No I/O yet — the highest-risk logic lands testable first.
5. `conformance-read.ts` + `conformance-sweep.ts` + `org-registry-conformance.ts`, and
   `POST/GET /api/org/[slug]/registry/conformance`.
6. `registry-view.ts` additive blocks + `conformanceModel.ts`; the three panels; `RegistryPanel`
   mounts them.
7. `signals-contribution.ts` (+ scrub) and `signals-pr.ts`; `POST .../registry/signals` with the
   three gates, typed confirm and the audit row.
8. `docs/features/org-registry/README.md`: the new section, and the known gap deleted.

## Tests

**Unit (vitest)**
- `src/lib/registry/index-walk.test.ts` *(new file — the lane has none today; if #19 created it,
  extend it)*: `isSignalsFile` accepts `signals/x.json`, rejects `signals/nested/x.json`,
  `signals/README.md`. **Fail-before**: without the lane, `selectArtifacts(...).signals` is `undefined`.
- `subjects.test.ts`: the real `knowledge/software-engineering/index.json` shape — `subjects` is a
  **map keyed by slug**, techniques are objects with `use_when` and `laws`; a malformed bundle warns
  and the others still land. **Fail-before**: a fixture with 151 subjects yields 0 rows today.
- `signals.test.ts`: a file with `consults` but no `citations` yields `null` citation counts, not 0;
  a non-`rkb-signals/1` schema warns and is skipped; two contributors do not collide.
- `conformance-map.test.ts`: `state: "unknown"` → `unjudged`; `governance: "weak"` surfaces;
  a truncated/invalid JSON returns `{ok:false}` and never throws; `countConsults` ignores malformed
  lines. **Fail-before**: no parser exists.
- `conformance-sweep.test.ts`: a repo whose read 404s degrades to a warning and the sweep continues;
  a second sweep at the same `mapSha` writes no new rows; a pair removed from the map is deleted.
- `signals-contribution.test.ts`: **the scrub is the guard** — payloads containing `src/lib/x.ts`,
  `https://…`, an `@`-address or a repo full name are rejected; a valid payload has exactly the
  closed key set; `contributor` matches `[a-z0-9-]+` and the filename stem.
- `src/app/api/org/[slug]/registry/{conformance,signals}/route.test.ts`: 403 for a non-member; 400
  without the typed confirm; the signals route refuses when `writesLane(d,"signals")` is false or
  `telemetrySink !== "registry"`; the audit row exists after a failed PR.
- `conformanceModel.test.ts`: "no map" renders as *no map*, `unjudged` renders as `—`, and a
  0-contributor signals block renders as *no witness*.

**Structural guards touched**
- `src/lib/db/wire-safe-dates.test.ts` — five new client-facing row types added (Director-owned edit
  at merge; the lane supplies the type names). `id-routes-gated.test.ts` — no entry: both new routes
  are `[slug]`-scoped. Doc-sync: the README is edited in the same turn. LOC: `RegistryPanel.tsx` and
  every new `src/features/**` file ≤ 200; `registryModel.ts` untouched.

**e2e / UAT**
- Re-run **Dana** (VP engineering) on the Registry tab: "which repos deviate from our own standards,
  and which standard is going stale" must be answerable in two clicks with no fabricated zero.
- **Tomáš** (buyer) journey unchanged — nothing here is public-surface.
- No briefing/PDF change, so M1 (Dana's briefing re-run) is not triggered.

## Gate + done criteria

`npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks. Done when: an
org with a mapped registry can sweep its fleet and see a subject × repo matrix built from real
`.ai/registry-map.json` files; a repo without a map reads *no map*; the weakly-governed list is
non-empty for this repo's own 9 weak contexts; and a signals contribution opens (or updates) one
PR whose payload passes `assertNoLeaks` and carries no path, name or pointer.

## Out of scope

- **#17 Work-time registry over MCP** (W2-K) — `get_governing_subject` / `get_conformance` tools and
  Athena grounding. This lane ships rows and read helpers only.
- **#19 Live invoke channel** and **#36 Lessons mirror / Trace** — same lane, separate items; this
  spec touches `index-registry.ts` only in its own two guarded blocks.
- **#16 Doctor per-check ledger** (W1-A) — a *different* conformance (the repo proving its own
  manifest's claims); `RepoConformance` never ingests doctor output.
- **#20 Athena as registry curator**, **#6 signed attestation**, **#29 score-input ledger**,
  **#31 signed history bundle**, **#37 data-bound deck diagrams** — all deferred; nothing here
  curates `knowledge/`, signs, or publishes beyond the counts-only signals file.
- Scan-pipeline ingestion of the map (a W1-B handoff) and any knowledge domain beyond what
  `knowledge/<domain>/index.json` states.

## Premises checked against the tree (2026-08-29)

1. **HELD** — `selectArtifacts` (`index-walk.ts:108-116`) has no `signals` lane; `readBundles`
   (`index-registry.ts:80-112`) keeps `meta` counts only; `registry-view.ts:87-89,188` is a count
   strip; `grep -rln 'registry-map|consults|registry-leads' src/` returns **nothing**.
2. **FALSE** — the dossier's `OrgKnowledgeSubject.title`: `knowledge/<domain>/index.json` has no
   title field. `subjects` is a map keyed by slug carrying `category/subcategory/status/file/
   techniques[]` (each technique with `use_when` + `laws`). Model drops `title`, gains those.
3. **FALSE** — "signals writer via `openDraftPr`": that call **throws 409 when the path already
   exists on base** (`github/write.ts:82-89`), so the second contribution always fails. Hence
   `signals-pr.ts` (`openOrUpdateSignalsPr`); `write.ts` stays untouched.
4. **FALSE** — "the scan reads `.ai/registry-map.json`": the scan truncates each file to 14,000
   bytes (`source.ts:65`) inside a 50-file LLM budget; this repo's map is 113KB. Ingest moved
   out-of-band into the registry lane; no `source.ts` handoff requested.
5. **FALSE** — signals `stack` "lifted from `.ai/manifest.yaml`": ascent's manifest has no `stack`
   block. Derived from `Repository.techStackJson`, omitted when unknown.
6. **HELD, load-bearing** — `policy.ts` already models per-lane roles (`writesLane(d, lane)`), so the
   signals writer's permission gate needs no new concept.
