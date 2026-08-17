# Registry (`?tab=registry`)

_Status: **prototype round** (R1 of the plan in [`REGISTRY-AND-CARE-IMPL.md`](../../REGISTRY-AND-CARE-IMPL.md)).
The tab is wired into the real shell and reads a real (deliberately thin) read model; the data layer —
`OrgRegistry`, the indexer and the PR writers — is R2/R3 and does not exist yet._

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
| `src/components/org/library/registry/RegistryTab.tsx` | server tab (shell contract: `slug` + `sp`) |
| `src/components/org/library/registry/RegistryPanelSwitcher.tsx` | prototype A/B/C strip (`#v=blueprint`) |
| `src/components/org/library/registry/registryModel.ts` | the shared pure derivations (six steps, repo tree, pipeline edges, verdict line) |
| `src/app/org/[slug]/registry/page.tsx` | permanent redirect stub into `?tab=registry` |

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

## Prototype directions

Three, behind `RegistryPanelSwitcher`, all rendering the same `RegistryView`:

- **Ledger** — editorial single column; a `Dateline` masthead, ledger cells, and onboarding as a
  numbered contents page filling in. No diagrams.
- **Blueprint** — engineering drawing; the repo as a mono file map with counts and hashes, an
  instrument readout panel, and a wiring diagram (ascent → registry → fleet) that *is* the stepper.
- **Pipeline** — a left-to-right conveyor with a counter on every hand-off (index → catalog → sync →
  invoke, the last as a return leg); each stage lights when its own steps are satisfied.

`?demo=` renders the states the real loader cannot produce yet: `indexed`, `scaffold_pr_open`,
`migrating`, `error`, `hosted`, `no-permission`, `unmapped`.

## Known gaps

- **No persistence.** `getRegistryView` has no `OrgRegistry` table to read, so the real path always
  returns `status: "unmapped"` with only the counts that are cheap today (hosted Skills, hosted Memory,
  the fleet repo count). Practices report `0` — there is no cheap org-scoped shape count — rather than a
  guess.
- **No actions.** Every button (Create · Map · Stay hosted · Open migration PR · Re-index · Propose
  pointer PRs) logs its intent to the console. The writers and `POST /api/org/:slug/registry` land in R2.
- **No indexer, no adoption hashing, no `catalog.json` writer.** Fleet sync numbers are fixture-only.
- **Not yet in `scripts/docs/feature-doc-map.json`.** That map's test requires every `sourceGlob` to
  match a *tracked* file, so the entry (`src/lib/registry/**`,
  `src/components/org/library/registry/**`, `src/app/api/org/[slug]/registry/**`) is added by the commit
  that lands these files, not before.
