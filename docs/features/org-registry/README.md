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
| `src/features/shared/registry/RegistryKnowledgePointer.tsx` | the one line that points at the Knowledge base tab — the subject-level panels (conformance matrix, weak governance, signals readout) moved there on 2026-09-05 |
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
| `POST .../registry/conformance` (`{ repositoryIds?, repositoryId? }`) | admin | sweep the fleet, a list, or one repo — see the conformance ledger |
| `GET` / `POST .../registry/dispatch` | member / admin (brief) · owner + self-host + autopilot (local) | the hand-off ledger and the two dispatch modes — see below |

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

Absence is never zero. Since 2026-09-05 the Knowledge base tab renders every (subject × swept repo)
as one of **eleven** states — the four verdicts above plus seven classified absences (`candidate`,
`accepted`, `deferred`, `declined`, `out-of-scope`, `out-of-domain`, `no-map`), classified exactly as
the registry's own `build-fleet-map.mjs` does; see
[org-knowledge/knowledge-base.md](../org-knowledge/knowledge-base.md#the-cell-vocabulary). "Never
swept" stays its own fact: no `RepoConformanceMap` row at all, rendered as *"never run"*, not as a
clean fleet.

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

#### The sweep reads the foundation, not just the map (2026-09-05)

Per fleet repo the sweep (`conformance-sweep.ts`, reader `conformance-read.ts`) also fetches, through
the App token and under `MAX_STANDARDS_BYTES`: the repo's **root tree listing** (the presence probe for
`context-map.json` and for an `.ai/` directory at all — when there is none, no further requests are
spent); `.ai/manifest.yaml` (or `.yml`) for `knowledge.domains` and the `scope:` block
(`out_of_scope_categories`, `out_of_scope_subjects`), parsed by the same small line reader the
registry's own scripts use (`conformance-foundation.ts`, no YAML dependency); and
`.ai/directions/ledger.jsonl`, keeping the **latest decision per (bundle, subject)**. Each optional
lane degrades on its own (a failed read is a warning on the repo's row); a transport failure on the
map still keeps the previous conformance.

**One row per swept repo.** `RepoConformanceMap` is written for **every** repo the sweep visits. A
repo with no map gets a header row with `mapSha: null`, counts 0, `schema: ""`, `generatedAt` = sweep
time and the foundation facts (`hasContextMap`, `hasManifest`, domains, scope, directions);
`weaklyGovernedJson` now carries the weakly-governed contexts **by name**. Readers: `hasMap` is
exactly `mapSha !== null`; `RegistryView.conformance.repos` is filtered to mapped rows and
`reposWithoutMap` counts the rest; the Knowledge base view lists all swept repos and uses the mapped
ones as matrix columns. `POST .../registry/conformance` also accepts `{ repositoryId }` for a
one-repo sweep (gate-then-constrain: the id travels into the org-constrained query).

**Stage detection** (`repoStage`, `src/lib/registry/absence.ts`): `populate` (no `context-map.json`)
→ `map` (no registry map) → `conform` (any pair unjudged, or judged against a digest that is not the
subject's current `OrgKnowledgeSubject.digest`) → `current`. **Absence classification**
(`classifyAbsence`, same module) is a verbatim port of the registry's rule, first match wins:
`no-map` → `out-of-domain` → `out-of-scope` (keys `<bundle>/<subject>`, `<bundle>/<category>`,
`<bundle>/<category>/<subcategory>`) → `declined` → `deferred` → `accepted` → `candidate`.

**Index → sweep chaining.** `indexRegistry` chains `sweepConformance` after a successful pass when
its source carries a token; the sweep's warnings land on the registry row prefixed `sweep:`, and a
sweep failure is a warning, never an index failure. The indexer also mirrors each bundle's
`taxonomy.json` (`OrgRegistry.bundlesJson[].taxonomy`, normalized; missing → `[]` + warning) and each
subject's `digest`.

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
| `RepoConformanceMap` | one row per SWEPT repo — the map header when there is one (`mapSha` null otherwise) plus the foundation the sweep probed (`hasContextMap`, `hasManifest`, `scopeJson`, `directionsJson`, `weaklyGovernedJson`) |
| `RepoConformance` | one judged (context × subject) pair, with its evidence |
| `RegistrySignal` | the `signals/` lane as one contributor published it; every count nullable |
| `RegistrySignalContribution` | append-only audit of every contribution ascent attempted |
| `RegistryDispatch` | one hand-off of registry work for a fleet repo (populate / map / conform; brief or local run); Ascent writes only this ledger and the sweep closes it |

## Dispatching a registry stage to a repo (2026-09-05)

A fleet repo stands at one of four registry stages (`populate` → `map` → `conform` → `current`,
derived by the sweep — see `repoStage` in `src/lib/registry/absence.ts`). The Knowledge base tab
can **dispatch** the next stage to a coding agent Ascent does not watch. Ascent writes only its
own ledger (`RegistryDispatch`); the repo, its `.ai/registry-map.json` and the registry change
through the branch and PR the dispatch produces.

### Two modes

| Mode | Who runs it | Gate | What Ascent does |
| --- | --- | --- | --- |
| `brief` | an operator, in their own Claude session next to the checkout | org **admin** (no GitHub token — nothing reaches GitHub) | composes the brief, records a `handed_off` row, returns the brief text (`201 { dispatch, brief }`) |
| `local` | the local plane's agent, in an isolated worktree of the **paired** checkout | self-hosted (404 elsewhere) → org **owner** → `ASCENT_AUTOPILOT=1` (409 `autopilot-off`) → paired (409 `not-paired`) → installation token (owner floor) | records a `running` row, answers `202 { dispatch }` at once, runs detached: worktree on `ascent/registry-<stamp>-<repo>` → agent → commit the residue with an `Ascent-Dispatch: <id>` trailer → push → draft PR to the default branch → row `proposed` (branch, PR URL, model, cost, turns, duration, summary). No commits → `failed` ("the agent produced no commits"); any error → `failed` with the message. The worktree is always removed; a one-repo sweep follows. |

### The brief

`buildRegistryBrief` (`src/lib/registry/dispatch-brief.ts`) is pure and deterministic — same
input, byte-identical text — following the registry's `remediation-handoff` golden path: one
codebase per artifact, the dispatch id verbatim, a working-rules block, a per-stage "Do this"
block, and a return contract. Its SHA-256 (first 16 hex, `sha256:…`) is the row's `briefDigest`.

- `populate`: `/project-populate contexts` → `node ../ai-registry/scripts/build-registry-map.mjs --project <name>` → commit both.
- `map`: ensure `.ai/manifest.yaml` declares `knowledge.domains` → the map builder → commit `.ai/registry-map.json`.
- `conform`: one `/conform --subject <slug>` per named subject (1–12); verdicts are written in place into the map (`state`, `evidence` with `file:line`, `evaluatedAt`, `evaluatedAgainst`) → commit the map.

Working rules: read the repo's own `AGENTS.md`/`CLAUDE.md` first; branch first, never commit to the
default branch; smallest real change; the standard does not bend to the code — a deviation is
recorded, never silent; skip what does not apply and say why; never edit a guard test to pass.

### The return contract — how a dispatch closes

Commit on a branch and open a PR to the default branch. **Ascent detects completion by sweeping
the committed `.ai/registry-map.json`** (`sweepConformance`); nothing the agent or the runner
reports is consulted. After ingesting a repo, the sweep loads the repo's OPEN dispatches
(`handed_off` / `running` / `proposed`) and marks one `done` (with `mapShaAfter`, `endedAt`) when:

- the swept `mapSha` differs from the row's `mapShaBefore` (a null `mapShaBefore` means any map counts), and
- for `conform`, none of the subjects the brief named still has an `unjudged` pair in the fresh map.

Otherwise the row stays open. Ledger read/write failures are sweep warnings, never sweep failures.
A new dispatch for the same (repo, stage) marks the older open rows `superseded`.

The `Ascent-Dispatch: <id>` commit trailer makes the PR traceable to its row; the sweep does not
depend on it.

### Roles, in one line

Member reads the ledger; admin composes a brief; owner on a consenting self-hosted box runs it locally.

**Known gap.** The repo's default branch is not stored (`Repository` has no such column; the sweep
reads GitHub's implicit default). A brief names the branch the paired checkout's `origin/HEAD`
reports, else `main`.

### Route contract — `/api/org/:slug/registry/dispatch`

| Verb | Body / query | Gate | Response |
| --- | --- | --- | --- |
| `GET` | `?repositoryId=` (optional) | member (`guardRegistryRead`) | `200 { dispatches: RegistryDispatchRow[] }` — newest first, up to 100 |
| `POST` | `{ repositoryId, stage: "populate"\|"map"\|"conform", subjects?: string[], mode: "brief" }` | admin (`guardRegistryRole(slug, "admin")`, no token) | `201 { dispatch: RegistryDispatchRow, brief: string }` |
| `POST` | same with `mode: "local"` | `selfHostGuard` → `requireOrgRole(owner)` → `autopilotEnabled()` → paired → `guardRegistryWrite(slug, { minRole: "owner" })` | `202 { dispatch: RegistryDispatchRow }` (status `running`) |

Errors (all `{ error, code }`; local refusals carry the machine token in `error` plus a `message`):

| Status | When |
| --- | --- |
| 400 `invalid-input` | bad `stage` / `mode`, missing `repositoryId`, `conform` with 0 or > 12 subjects |
| 404 | managed cloud for `mode: local` (`selfHostGuard`); `not-found` for an unknown org or a repo outside the org |
| 409 `not-mapped` | the org has no registry mapped |
| 409 `invalid-input` | `conform` for a repo with no map ("dispatch the map stage first") |
| 409 `{ error: "autopilot-off" }` | local mode without `ASCENT_AUTOPILOT=1` |
| 409 `{ error: "not-paired" }` | local mode for an unpaired repo |
| 403 `not-permitted` / 503 `persistence-off` | from the shared registry gates |

`subjects` are trimmed, de-duplicated, kept in order, and ignored for `populate` / `map`.

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
