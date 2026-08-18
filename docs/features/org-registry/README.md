# Registry (`?tab=registry`)

_Status: **R2 landed** (plan in [`REGISTRY-AND-CARE-IMPL.md`](../../REGISTRY-AND-CARE-IMPL.md)). The tab
is wired into the real shell; the data layer — `OrgRegistry`, the mirror columns, the indexer, the
scaffold/migration PR writers and the API — is real. The tab's buttons are not connected to those
endpoints yet. Reference registry: [github.com/xkazm04/ai-registry](https://github.com/xkazm04/ai-registry)._

## What it is

The **registry** is a repository the customer owns (`<org>/ai-registry` by default) that becomes the
source of truth for the three Library artifacts — Skills, Practices and Org Memory. Ascent onboards it,
indexes it, and reports how the fleet syncs against it. Developers change it with plain `git`; ascent is
never in the write path (it opens pull requests, it does not push).

The tab is the **first item in the `Chosen` nav group**, because Plan · Practices · Skills · Memory all
read their source of truth from it once it is mapped.

## Surfaces

| Path | Role |
| --- | --- |
| `src/lib/org/registry-view.ts` | `RegistryView` type + `getRegistryView(slug, { demo })` |
| `src/lib/org/registry-view.fixture.ts` | fixture views selected by `?demo=<state>` |
| `src/features/shared/registry/RegistryTab.tsx` | server tab (shell contract: `slug` + `sp`) |
| `src/features/shared/registry/RegistryPanel.tsx` | the tab's one render — the unmapped invitation and the identified drawing |
| `src/features/shared/registry/RegistryInstrumentPanel.tsx` | the mono readout column (repo, shas, webhook, sink, counts) |
| `src/features/shared/registry/registryModel.ts` | the shared pure derivations (six steps, repo tree, verdict line) |
| `src/app/org/[slug]/registry/page.tsx` | permanent redirect stub into `?tab=registry` |
| `src/lib/registry/layout.ts` | v1 file layout constants + the deterministic `buildScaffoldFiles(org)` |
| `src/lib/registry/policy.ts` | `.ascent/registry.yaml` parse + serialize (small YAML subset) |
| `src/lib/registry/catalog.ts` | the `catalog.json` envelope (build / parse / `sha256:<16 hex>` short hash) |
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
  first invoke).
- **Indexed — the registry dashboard.** Repo header (canonical, mode, sink, indexed sha, webhook
  health, Re-index), the three-artifact ledger (in-registry vs hosted-only + migration state), fleet
  sync (`in_sync | stale | diverged | local_only`), activity feed, developer how-to.

"Stay hosted" is a first-class answer, not a dimmed decoy: an org with a handful of artifacts and one
repo genuinely does not need a registry yet, and the copy says so.

## The one render

`RegistryPanel` is a single component with two shapes over the same `RegistryView` — the consolidated
result of the prototype round (the Ledger and Blueprint directions were fused; Pipeline and the A/B/C
switcher were cut).

- **Not identified** (`unmapped`, including the no-permission case) — the editorial invitation: a
  `Dateline` masthead, the honest verdict line, the three artifacts as they sit in ascent's tables
  today, and the numbered contents page ("Contents · setting up the registry") with step 1's three
  answers inline. Nothing is drawn, because there is no machine yet to draw.
- **Identified** (`scaffold_pr_open` · `indexed` · `migrating` · `error` · hosted mirror) — the drawing
  on top: the repo as a mono file map with counts and hashes, the artifact counts beneath it, and the
  instrument readout column beside both. Below the drawing the SAME contents page carries only what is
  still open ("Contents · wiring the registry" — migrate → point the fleet → verify; satisfied entries
  drop out, a `skipped` entry stays because it states why the step will never run), then fleet sync,
  telemetry, activity and the developer how-to.

`?demo=` still renders the states a young org cannot produce: `indexed`, `scaffold_pr_open`,
`migrating`, `error`, `hosted`, `no-permission`, `unmapped`.

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
`sha256:<first 16 hex>` — matching the reference registry. The scaffold seeds the same envelope, empty,
with `generatedAt: null` so re-running it is a byte-identical no-op.

## Known gaps

- **The tab's buttons are not wired to the API yet.** The endpoints and the capability flags exist; the
  client still logs its intent. Connecting them is the next UI pass.
- **Fleet adoption is not measured.** `fleet.reposPointing`, `reposSynced30d`, the adoption breakdown
  and `telemetry.invokes30d` are reported as **zero**, not estimated (R4/R5).
- **`catalog.json` is built but not committed back.** `indexRegistry` returns the catalog it would
  write; the policy-gated writer (`catalogWrites: bot | pr`) is not implemented.
- **No push-webhook wiring.** Indexing runs from `POST .../registry/index` only.
- **`RegistryView.candidates` is empty** — the installed-repo list for the "map an existing repo" picker
  is not read yet.
- **Unmapping / switching canonical** has no endpoint.
- (Closed 2026-08-18.) ~~Not yet in `scripts/docs/feature-doc-map.json`.~~ The `org-registry` area is
  registered, so an edit under `src/lib/registry/**`, `src/app/api/org/[slug]/registry/**`,
  `src/lib/org/registry-{view,sync}.ts`, `src/lib/db/org-registry*.ts` or
  `src/features/shared/registry/**` now nags for this doc.
