# Registry (`?tab=registry`)

_Status: **R2 landed, tab wired** (plan in [`REGISTRY-AND-CARE-IMPL.md`](../../REGISTRY-AND-CARE-IMPL.md)). The tab
is wired into the real shell; the data layer — `OrgRegistry`, the mirror columns, the indexer, the
scaffold/migration PR writers and the API — is real, and the tab's buttons call it (`useRegistryMutation`
— one call path, inline failures, `router.refresh()` on success). Reference registry: [github.com/xkazm04/ai-registry](https://github.com/xkazm04/ai-registry)._

## What it is

The **registry** is a repository the customer owns (`<org>/ai-registry` by default) that becomes the
source of truth for the three Library artifacts — Skills, Practices and Org Memory. Ascent onboards it,
indexes it, and reports how the fleet syncs against it. Developers change it with plain `git`; ascent is
never in the write path (it opens pull requests, it does not push).

The tab is the **first item in the `Shared` nav group**, because Practices · Skills · Memory all read
their source of truth from it once it is mapped.

## Surfaces

| Path | Role |
| --- | --- |
| `src/lib/org/registry-view.ts` | `RegistryView` type + `getRegistryView(slug)` — real data only |
| `src/lib/org/registry-view.fixture.ts` | fixture views selected by the preview switcher (dev only) |
| `src/features/shared/registry/RegistryTab.tsx` | server tab — takes `slug` only; it reads nothing from the URL |
| `src/features/shared/registry/RegistryPanel.tsx` | the tab's one render — the unmapped invitation and the identified drawing |
| `src/features/shared/registry/RegistryInstrumentPanel.tsx` | the mono readout column (repo, shas, webhook, sink, counts) |
| `src/features/shared/registry/registryModel.ts` | the shared pure derivations (six steps, repo tree, verdict line) |
| `src/features/shared/registry/RegistryPreviewShell.tsx` | the fixture-state switcher, gated by `registryPreviewEnabled()` |
| `src/features/shared/registry/RegistrySetup.tsx` (+ `RegistryMapPanel`, `RegistryRepoPicker`, `useRegistryRepoOptions`) | step 1: create the repo, or pick/type the one to map |
| `src/app/org/[slug]/registry/page.tsx` | permanent redirect stub into `?tab=registry` |
| `src/lib/registry/layout.ts` | v1 file layout constants + the deterministic `buildScaffoldFiles(org)` |
| `src/lib/registry/policy.ts` | `.ascent/registry.yaml` parse + serialize (small YAML subset) |
| `src/lib/registry/catalog.ts` | the `catalog.json` envelope (build / parse) + the content digest's FORMAT (`sha256-n1:<16 hex>`, legacy detection, `digestVerdict`) |
| `src/lib/registry/scaffold.ts` | `openScaffoldPr` (branch `ascent/registry-scaffold`) + `createRegistryRepo` |
| `src/lib/registry/index-registry.ts` (+ `index-walk.ts`, `read.ts`, `parse.ts`) | the indexer |
| `src/lib/registry/migrate.ts` | hosted rows to registry layout, one draft PR per artifact type |
| `src/lib/registry/capabilities.ts` | `getRegistryCapabilities` — what the UI may render |
| `src/lib/registry/api.ts` | the shared route guards + the typed error shape |
| `src/lib/db/org-registry{,-write,-mirror,-hosted}.ts` | persistence (no GitHub) |
| `src/app/api/org/[slug]/registry/{,index,migrate}/route.ts` | the API |
| `prisma/migrations/20260818120000_add_org_registry/` | `OrgRegistry`, `OrgPracticeShape`, the mirror columns, `Repository.role` |

## The two states

- **Unmapped — the onboarding stepper.** Six resumable steps, each reading its own evidence rather than
  a stored cursor: *choose* (create · map an existing repo · stay hosted), *permissions*
  (`contents:write`), *scaffold* (one PR adds the v1 layout), *migrate* (one PR per artifact type),
  *point the fleet* (`.ai/manifest.yaml → skills.registry`), *verify* (first `catalog.json`, first sync,
  first invoke). The **artifact ledger is not rendered here**: its three Stat cards read
  "n in the registry / +m hosted only", which against an unmapped org is three zeroes and a migrate
  action whose only answer is "map a registry first".
- **Indexed — the registry dashboard.** Repo header (canonical, mode, sink, indexed sha, webhook
  health, Re-index), the three-artifact ledger (in-registry vs hosted-only + migration state), fleet
  sync (`in_sync | stale | diverged | local_only`), activity feed, developer how-to.

"Stay hosted" is a first-class answer, not a dimmed decoy: an org with a handful of artifacts and one
repo genuinely does not need a registry yet, and step 1's own blurb says so. It carries **no button and
no paragraph of its own** — staying hosted is precisely what is already happening, so a control would
be a no-op dressed as a decision and a restatement would be the third place the same fact is written.

### Mapping an existing repo

"Map an existing repo" opens `RegistryMapPanel`: a **picker** of the repositories the installation can
already see, above the `owner/repo` field. The list is read lazily from `GET /api/app/repos?org=<slug>`
when the panel opens — never on the server as part of `getRegistryView`, because the tab renders on
every visit and almost none of those renders open the picker. Rows are ranked layout-first then most
recently pushed, filterable, and capped at 40 shown with the remainder counted out loud. A failed or
empty listing is not a dead end: the field below is the fallback and the picker says so. Picking a row
and typing the name write the same state, so there is one validation (`isFullName`) and one POST.

## The one render

`RegistryPanel` is a single component with two shapes over the same `RegistryView` — the consolidated
result of the prototype round (the Ledger and Blueprint directions were fused; Pipeline and the A/B/C
switcher were cut).

- **Not identified** (`unmapped`, including the no-permission case) — the editorial invitation: a
  `Dateline` masthead, the honest verdict line, and the numbered contents page ("Contents · setting up
  the registry") with step 1's answers inline. Nothing is drawn and nothing is counted, because there
  is no machine yet to draw and no registry yet to count against.
- **Identified** (`scaffold_pr_open` · `indexed` · `migrating` · `error` · hosted mirror) — the drawing
  on top: the repo as a mono file map with counts and hashes, the artifact counts beneath it, and the
  instrument readout column beside both. Below the drawing the SAME contents page carries only what is
  still open ("Contents · wiring the registry" — migrate → point the fleet → verify; satisfied entries
  drop out, a `skipped` entry stays because it states why the step will never run), then fleet sync,
  telemetry, activity and the developer how-to.

### The preview switcher (development only)

`RegistryPreviewShell` renders the states a young org cannot produce — `indexed`, `scaffold_pr_open`,
`migrating`, `error`, `hosted`, `no-permission`, `unmapped` — in REACT STATE (never a search param, so
a preview can't be bookmarked or pasted into Slack as if it were someone's registry). It is offered
only when **both** hold: `registryPreviewEnabled()` (`ASCENT_REGISTRY_PREVIEW=1`, and hard-off when
`NODE_ENV=production`, the `authBypassEnabled` idiom) **and** the real status is `unmapped`. Every
action inside a preview is swallowed by `useRegistryMutation` — nothing is POSTed, and nothing is
echoed either: the shell's own `preview · <state>` stamp already says the panel is inert.

## The data layer

`OrgRegistry` holds one row per mapped registry repo — `status`
(`unmapped` -> `scaffolding` -> `scaffold_pr_open` -> `indexed`, with `error` reachable from any state
and the previous index still readable), `mode`, `telemetrySink`, `lastIndexSha`, `catalogSha`,
denormalized counts, index warnings and the per-type migration state. `OrgSkill` / `OrgMemory` /
`OrgPracticeShape` gained `origin (hosted|registry)`, `registryId`, `registryPath`, `registryHash`
(`OrgSkill` also `registryVersion`), and `Repository.role` distinguishes `fleet` from `registry`.
Everything is additive and nullable/defaulted, so an existing row reads as hosted and an existing repo
as fleet.

Mirror rows are keyed on `(registryId, registryPath)` — the path is the identity, not the name — and a
vanished path is **soft-archived**, never deleted. A registry file whose name collides with an existing
hosted row **adopts** that row rather than duplicating it.

## Capabilities — why a button disappears

`RegistryView.capabilities = { appConfigured, installed, canWrite, canCreateRepo, reason, installUrl }`.
The UI renders a GitHub action **only** when its flag is true; `reason` names the first unmet
precondition (`persistence-off` / `app-not-configured` / `not-installed` / `insufficient-role` /
`token-not-mintable`). `canWrite` is resolved at the `admin` floor — the same floor the mutating routes
enforce, so a rendered button and its route agree by construction. `canCreateRepo` additionally requires
`administration: write` **and** an Organization account (an installation token cannot create a repo on a
user account). Every probe fails closed.

## API

| Route | Role floor | Behavior |
| --- | --- | --- |
| `GET /api/org/:slug/registry` | read | `{ view: RegistryView }` (`?demo=` selects a fixture) |
| `POST /api/org/:slug/registry` | admin | map `fullName`, or `create: true` to create `<org>/ai-registry`; then open the scaffold PR |
| `POST .../registry/index` | member | re-read HEAD and rebuild the mirror rows |
| `POST .../registry/migrate?type=skills,practices,memory` | admin | export the still-hosted rows of one type as one draft PR; a type with zero rows is a **no-op**, never an empty PR |

Every failure is `{ error, code }` with a real status — `persistence-off` (503), `invalid-input` (400),
`not-permitted` (403), `not-mapped` (409), `github-error` (502) — never a bare 500.

## The indexer

Reads the tree at HEAD through the installation token, then per artifact:

- **`skills/<name>/SKILL.md`** — the shared `parseSkillFrontmatter`. A missing or invalid block still
  indexes under the directory name, with a warning; `version` is read (the drift key the catalog
  compares on) and `category` is normalized to the closed set. `LESSONS.md` is counted by its `## `
  headings and linked from the catalog entry.
- **`practices/<slug>/PRACTICE.md`** — `id`, `dimension` (validated `D1`-`D10`), `applies-when`, title;
  `starter/**` paths are attached to the catalog entry but never mirrored into a row.
- **`memory/<kind>/<slug>.md`** — `kind` (frontmatter, else the directory) mapped onto `OrgMemory.kind`,
  `confidence` clamped to 0-1; `_index.md` and `_`-prefixed files are ignored.

An empty document, a body-less note, an oversized blob or a failed mirror write **skips that file with a
recorded warning**; the pass commits everything else and never throws. A total failure (no access,
deleted repo, rate limit) returns a typed error and leaves the previous index readable.

`catalog.json` is an **envelope object**, not a bare array — `{schema, schemaVersion, generatedAt,
generatedBy, registry, skills[], practices[], memory[], counts}` with `contentHash` as
`sha256-n1:<first 16 hex>`. The scaffold seeds the same envelope, empty, with `generatedAt: null` so
re-running it is a byte-identical no-op.

### The content digest (schemaVersion 1.1.0)

`contentHash` is the ONLY thing a fleet repo needs to answer "am I in sync, stale, or diverged?", so it
is produced in exactly **one** place — `contentDigest` in `src/lib/registry/parse.ts` — and consumed by
all three surfaces that publish one: the catalog entries, the mirror rows' `contentHash` column, and
the skill sync manifest (`GET /api/org/skills/manifest`). Those last two used to hash different, capped
spans, so the digest a CLI compared against the catalog was never comparable with it.

- **Span:** the artifact's **full text**, uncapped, frontmatter included.
- **Normalization:** CRLF/CR folded to LF, and **nothing else**. Raw-byte hashing made a checkout that
  rewrites line endings report every artifact permanently diverged; trimming whitespace or folding
  unicode would go too far the other way and hide a real divergence silently.
- **Version tag:** `n1` = normalization revision 1. Every stored digest changed when this landed, so an
  untagged (pre-1.1.0) digest stays identifiable: `digestVerdict(stored, fresh)` returns
  `"reformatted"`, not `"changed"`, and a consumer recomputes instead of reporting an edit. On the
  hosted side, `pushOrgSkill` recognizes a legacy key, re-keys the row in place and returns
  `unchanged` — no version bump, no fleet-wide "everything diverged" event.
- **Accepted trade-offs:** a frontmatter-only edit (e.g. a tag) reads as a content change, and two
  bodies differing only past the 50KB storage cap read as different. Both are loud false positives,
  chosen over the silent false "in sync" the capped/stripped spans produced.

## The conformance ledger (2026-08-30)

The registry's fourth instrument, beside maturity, gate and adoption: **which of the org's own
written standards does each repo knowingly deviate from, and is the standard itself still true?**
Nothing here grades a repo against a vendor rubric — the corpus being measured against is the
customer's own.

### Two artifacts nobody was reading

| Artifact | Where it lives | What ascent takes from it |
| --- | --- | --- |
| `.ai/registry-map.json` | each MANAGED repo | the generated join between that repo's contexts and the registry's subjects, with a `/conform`-written verdict per pair |
| `knowledge/<domain>/index.json` | the registry | one row per SUBJECT, not just the seven `meta` integers per bundle |
| `signals/<contributor>.json` | the registry | per subject: consults, deviations, citation health — counts only |

The map is read **out of band**, with the App token under its own 512KB cap
(`src/lib/registry/conformance-read.ts`), never through the scan's file budget. That budget truncates
every file at 14,000 bytes inside a 50-file allowance because what it fetches feeds an assessment
prompt; this repo's own map is 113KB, so a scan fetch would deliver unparseable JSON *and* spend a
prompt slot a source file should have had.

### The verdict vocabulary, and the three absences

`state` is closed: `conformant | deviation | not-applicable | unjudged`. The generator writes
`unknown` for a pair nobody has evaluated; that stores as `unjudged` and renders **"—"**. It must
never fall through to `conformant`, because "nobody looked" and "this follows the standard" are
opposite facts and only one of them is an achievement.

Three different absences reach the UI and each reads differently:

| Absence | What it means | How it renders |
| --- | --- | --- |
| never swept | no sweep has run for this org | *"No sweep has run yet"* — not a clean fleet |
| no map | the repo was visited and has no `.ai/registry-map.json` | counted beside the mapped repos |
| unjudged | the pair exists, nobody has judged it | `—` |

`consults30d` is `null` when `.ai/consults.jsonl` is absent — the lane was never written, which is not
"nobody consulted". Every `RegistrySignal` count is nullable for the same reason: a contributor may
report consults without ever running a citation check, and a `0` there is an argument for deleting
good knowledge, made out of silence.

### The sweep

`POST /api/org/:slug/registry/conformance` (admin) reads each repo in the org and ingests what it
finds; `GET` returns the matrix. Pairs upsert on `(repositoryId, contextName, subjectSlug)` and pairs
absent from a newer map are deleted for that repo, so a re-sweep at the same `mapSha` is a no-op and a
vanished context leaves no stale row.

One repo never fails the fleet, and the two failure shapes are kept apart:

- **no map** — the repo has stopped claiming those verdicts, so its rows are cleared.
- **unreadable** (a 404 on a file that should be there, a truncated document, a revoked permission) —
  a warning, and **the previous conformance is kept**. Deleting a repo's standing deviation backlog
  because GitHub timed out is the worst outcome available here.

The matrix folds a subject's several contexts **worst-wins**: one evidenced deviation makes the cell a
deviation even where four sibling contexts conform. `evidence` (the repo's own `file:line` text) is
stored for the org's own UI, capped at 2,000 characters, truncated to 400 on the wire — and it **never
leaves the deployment**.

### Contributing signals back

`POST /api/org/:slug/registry/signals` publishes `signals/<contributor>.json` into the customer's
registry as a **pull request** — a CODEOWNER merging it is the act of accepting the contribution. It
is off by default and gated four ways: same-origin, the admin write guard, the registry's own spine
declaring ascent a `writer` of the `signals` lane **and** `telemetry: registry` (both re-read live, so
a revoked declaration cannot be published against a cached yes), and a typed confirm (`contribute`).

`contributor` is the org's configured id if it set one, else `ascent-<12 hex of sha256(orgId:registryId)>`
— stable, opaque, and not derived from anyone's name. A configured id containing a `/` or `@` is
**refused rather than slugified**, since slugifying `acme/dev` would publish an org name.

The payload is built key-closed (`schema`, `contributor`, `app`, `generatedAt`, `windowDays`, optional
`stack`, `bundles.*.subjects.*`) and then re-checked by `assertNoLeaks`, which **refuses** a payload
carrying anything path-, URL-, address- or repo-shaped. It does not scrub: a scrub publishes whatever
it missed. A key nobody measured is omitted rather than zeroed.

`RegistrySignalContribution` records actor, payload digest, bundle list and counts, written **before**
the GitHub call — an attempt to publish is the auditable act, and recording only successes would hide
exactly the cases anyone would later want to look at. `openOrUpdateSignalsPr` is a sibling of
`openDraftPr` rather than a change to it: that helper refuses when the path already exists on base,
which is right for seeding a starter artifact and would 409 every contribution after the first for a
file ascent is the sole author of.

### Data model

| Model | Purpose |
| --- | --- |
| `OrgKnowledgeSubject` | one subject per bundle, from the generated index; soft-archived when it leaves the corpus, because a conformance row may still cite it |
| `RepoConformanceMap` | one repo's map header — the counts and provenance it asserts about itself |
| `RepoConformance` | one judged (context × subject) pair, with its evidence |
| `RegistrySignal` | the `signals/` lane as one contributor published it; every count nullable |
| `RegistrySignalContribution` | append-only audit of every contribution ascent attempted |

## The improvement channel (2026-08-30)

`LESSONS.md` used to be a number on a dashboard. It is now a ledger, a version timeline read straight
from git, and — for memory — a pull request instead of a dead end.

### Lessons as rows

Each index pass splits every `skills/<name>/LESSONS.md` into one `OrgSkillLesson` per `## ` heading.
`splitLessonEntries` cuts on the **same regex** `countLessons` uses, so the row count and
`counts.lessons` are equal by construction — two surfaces disagreeing about how many lessons a skill
has is the failure this closes.

The heading contract is `## <version used> - <YYYY-MM-DD> - <project>`, separator `-` or an em dash,
version optionally a range (`0.1-1.0`). Parsing is tolerant and every gap is honest:

| Slot | When it does not parse |
| --- | --- |
| version | `""` — **never** the skill's current version, which would attribute a lesson to a method that did not produce it |
| date | `learnedOn: null` — never "today" |
| project | `""` |

The date is found by SHAPE rather than by position, so a heading that omitted its version does not
shift a project name into a date field. A heading that matches nothing **still produces a row**, with
`headingRaw` carrying what the parser was given: losing somebody's written reflection because its
heading is odd is the worse failure. One warning per FILE, never per entry.

Rows upsert on `(registryId, registryPath, entryHash)` — re-indexing the same head writes nothing, an
edited entry replaces itself, a removed entry disappears — and `memoryId` is deliberately absent from
the update, so a lesson already ingested as memory is never re-ingested. A `LESSONS.md` that vanished
has its rows purged: these are mirror rows and git remains the record.

### Trace: the version timeline

`GET /api/org/:slug/registry/trace?skill=<name>` returns the commits over `skills/<name>/SKILL.md`
with their versions, plus that skill's lessons grouped by version. It is **on demand, per skill, and
cached per registry head** — building it in the index pass would cost a blob read per commit per
skill on every push, thousands of reads at the 500-skill ceiling. A cache hit is one database read.

- `TRACE_COMMITS = 30` commits, `TRACE_VERSION_READS = 6` blob reads (newest first).
- Everything older carries `version: null` and renders `—`. The neighbouring version is **never**
  carried backwards; that would look like more history and be a fabrication.
- A lesson hangs on the version **it declares**, never on commit proximity. One whose version matches
  no resolved commit lands in an explicit *"version not in the last 30 commits"* group — a
  nearest-commit heuristic would misfile every lesson whose run lagged its release, which is the
  common case, and the result would look authoritative.
- A GitHub failure returns `error` and the panel says *"history unavailable"*, or serves the stale
  cache labelled stale. An empty timeline would be a claim about the skill rather than the request.

The Skills tab shows Trace on **registry-origin rows only** — a hosted skill has no git history, and
offering it one would be a promise the data cannot keep — and the disclosure fetches on open, not on
mount. `RegistryActivity` now emits real `lesson` entries; that kind had been in the union, the label
map and the fixtures since the tab shipped, emitted by nothing.

### Reflect-as-PR

A memory note in the registry is a mirror of a file the customer owns, so consolidating one in
ascent's table would be reverted by the next index pass. `POST /api/org/memory/reflect` therefore
**refuses** an `apply` whose members are registry-origin (`409 registry-origin`) and offers
`proposePr` instead:

1. the rollup is written as `memory/<kind>/<slug>.md`, frontmatter `kind`, `namespace`, `confidence`,
   `source: ascent:reflection` and `supersedes:` — a list of **repo-relative paths**, never DB uuids,
   because a uuid in a reviewer's diff is a token they cannot open;
2. an `OrgMemoryProposal` row is written **before** the GitHub call and survives a failed PR;
3. a draft PR opens on `ascent/memory-<slug>` (a stable branch, so a retry updates its own PR);
4. a CODEOWNER merging it is what makes the supersession real: the next index pass reads
   `supersedes:` and stamps `supersededBy` on the sibling mirror rows.

Nothing is deleted, in the repo or in the database — the old notes stay in git and the frontmatter is
the link. The role floor is **member**, not admin: nothing lands in the registry without a review, and
requiring admin to *propose* would lock out the people who write the memory.

## Known gaps

- **Fleet SYNC adoption is not measured.** `fleet.reposPointing`, `reposSynced30d` and the adoption
  breakdown are reported as **zero**, not estimated (R5) — the pass that hashes each repo's
  `.claude/skills` against the catalog does not exist yet. *(Narrowed 2026-08-30: `telemetry.invokes30d`
  is now real, from the registry's `usage/` lane and this org's own events API, and CONFORMANCE
  adoption is measured — see the conformance ledger above.)*
- **Which contexts are weakly governed is not stored.** Each repo's map states `governance` per
  context and the ingest keeps only the COUNT (`RepoConformanceMap.weaklyGoverned`), so the panel
  ranks repos rather than listing contexts. It is genuinely not derivable: classifying by match
  confidence would put 18 of this repo's 52 contexts in the wrong bucket, which is why the field is
  read rather than inferred. Closing it needs one column (`weaklyGovernedJson`).
- **Nothing consumes `OrgKnowledgeSubject` as a row vocabulary yet.** The subjects are mirrored and
  readable (`listSubjectsForContext`), but the matrix's rows come from the pairs the maps assert, so a
  subject no repo matched is invisible there.
- **Lessons do not reach Memory yet.** The mapping (`lesson-memory.ts`: the skill as namespace,
  `procedural`, confidence 0.6, ten newest per pass) is written and tested, but the insert goes
  through the one ingest door in `src/lib/memory/scan-feed.ts` and that door's generalized form
  (`writeMemoryCandidate`) is not in this build. `ingestSkillLessons` reports `held: true` rather
  than writing through a second door, which would mean two dedup windows for one table.
- **`catalog.json` is built but not committed back.** `indexRegistry` returns the catalog it would
  write; the policy-gated writer (`catalogWrites: bot | pr`) is not implemented.
- **No push-webhook wiring.** Indexing runs from `POST .../registry/index` only.
- **`RegistryView.candidates` is still empty from the server loader.** The picker gets its rows from
  `/api/app/repos` on the client instead, so the field is now only populated by the fixtures. That
  listing does not probe file layout, so a real row can never carry `hasLayout` — the picker falls back
  to flagging a name match on `<owner>/ai-registry`.
- **Unmapping / switching canonical** has no endpoint.
- (Closed 2026-08-18.) ~~Not yet in `scripts/docs/feature-doc-map.json`.~~ The `org-registry` area is
  registered, so an edit under `src/lib/registry/**`, `src/app/api/org/[slug]/registry/**`,
  `src/lib/org/registry-{view,sync}.ts`, `src/lib/db/org-registry*.ts` or
  `src/features/shared/registry/**` now nags for this doc.
