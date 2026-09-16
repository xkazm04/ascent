---
name: registry-onboarding
description: Walk the registry onboarding process that the org dashboard's Registry tab shows (src/features/shared/registry/RegistryPanel.tsx) from the terminal, against a LOCAL ai-registry checkout - validate each of its six steps with the registry's own instruments, and connect this machine's local repositories to the registry's committed projects.json (declared checkouts, manifest pointers, linked skills, installed knowledge rules, registry maps). Check mode changes nothing; connect mode repairs what it can prove. Use when onboarding a repo or machine to the registry, after a registry regenerate (rules/index drift), when a repo points at the registry but no fleet pass sees it, or to check the tab's steps against reality. Invoke with /registry-onboarding [check|connect] [--project <slug>].
allowed-tools: Read, Edit, Bash, Glob, Grep
---

# Registry onboarding — the terminal counterpart of the Registry tab

The Registry tab renders onboarding as a six-entry contents page (`registrySteps()` in
`src/features/shared/registry/registryModel.ts`). That page reads the **hosted** shape: a GitHub App,
a scaffold PR, `reposPointing` counted from scans. On a developer machine the same process runs
through a local checkout of the registry and its dependency-free scripts. This skill is that path,
step for step, so the two never describe different processes.

**If you change the steps in `registryModel.ts`, change the table below in the same turn** (and the
reverse). The step ids are the join.

## Inputs

- **Registry**: `registry.local` in this repo's `.ai/manifest.yaml` (default `../ai-registry`).
  All registry commands run with that directory as cwd.
- **Machine identity**: `<registry>/.machine.local.json` — `machine`, `root`, `contributor`,
  optional `overrides`. Gitignored; the only file holding absolute paths.
- **Fleet declaration**: `<registry>/projects.json` — committed, schema 2, per project a
  `checkouts` map `machine -> path relative to that machine's root`. Resolved only through
  `scripts/lib/projects.mjs`; never build a checkout path by hand.
- `SKILL_DIR` = this skill's directory (`.claude/skills/registry-onboarding`).

## Modes

- `check` (default): run every probe read-only, print the step table, change nothing.
- `connect`: run `check`, then apply the repairs listed per step. Repairs that write into
  **another** project's tree are limited to the registry-managed, gitignored namespace
  (`.claude/skills/<lane-name>` links, `.claude/rules/ai-registry-*.md` copies, the managed
  `.gitignore` block). Anything else in another repo — a manifest edit, a commit — is reported,
  not done.
- `--project <slug>` scopes steps 5–6 to one project.

## The six steps, mapped

| # | Tab step (`id`) | Hosted evidence (tab) | Local evidence (this skill) |
|---|---|---|---|
| 1 | Choose the registry (`choose`) | `view.registry` mapped | registry checkout exists, `registry.yaml` + `projects.json` present, git clean enough to trust |
| 2 | Grant contents:write (`permissions`) | App holds `contents:write` | machine identity resolves: `.machine.local.json` has `machine` + `root`; `loadFleet().problems` empty |
| 3 | Scaffold the layout (`scaffold`) | scaffold PR merged → `indexed` | registry lanes present and generated artifacts current: `build-knowledge-rules.mjs --check` |
| 4 | Move Skills, Practices, Memory (`migrate`) | `moved/total` per artifact | every name in a project's manifest `skills:` exists in the lane; no project-owned dir shadows a lane name |
| 5 | Point the fleet (`point`) | `reposPointing/reposTotal` | **local repos ↔ projects.json** (`fleet-connect.mjs`), then links + rules (`link-registry.mjs --check`) |
| 6 | Verify the loop (`verify`) | catalog written, synced, invokes | `check-projects.mjs` clean, `link-registry.mjs --check` exits 0, `build-registry-map.mjs --check` not stale, `/consult` log reaching the signals lane |

### 1 · choose

```sh
test -f <registry>/registry.yaml && test -f <registry>/projects.json
git -C <registry> status --short | head
```

Uncommitted edits in the registry are normal (sibling sessions). Report them; never stash or reset.

### 2 · permissions (machine identity)

```sh
cd <registry> && node -e "import('./scripts/lib/projects.mjs').then(m=>{const f=m.loadFleet('.');console.log(f.machine,f.problems)})"
```

`machine: null` or a `root` problem blocks every later step. **connect**: never invent the file — ask
for the machine name (must be a key of `projects.json` `machines`) and root, then write it.

### 3 · scaffold (generated artifacts)

```sh
cd <registry> && node scripts/build-knowledge-rules.mjs --check
```

Stale generated rules are a registry-side commit (`build-knowledge-rules.mjs`, then commit in the
registry) — report it; do not regenerate a shared registry unasked.

### 4 · migrate (declared skills exist)

Covered by `link-registry.mjs --check`: `declares "<name>", which the lane does not carry` and
`is a REAL directory (a project-owned copy)` are this step's failures. A real directory under
`.claude/skills/` that is NOT declared (here: `prototype/`) is a project-owned skill and is correct.
**connect**: report only — deleting or renaming a project-owned copy is the owner's call.

### 5 · point — connect local repositories to projects.json

This is the step the tab cannot see from GitHub, and the one that silently breaks: a repo that is
not declared for this machine is skipped by every fleet script without a word.

```sh
node $SKILL_DIR/scripts/fleet-connect.mjs            # from this repo; add --registry <dir> elsewhere
cd <registry> && node scripts/check-projects.mjs
cd <registry> && node scripts/link-registry.mjs --check [--project <slug>]
```

`fleet-connect` row states and their repair:

| State | Meaning | connect repair |
|---|---|---|
| `connected` | declared for this machine, present, manifest points here | none |
| `undeclared` | local repo's manifest points here; not in `projects.json` | **ask the owner** — pointing at the registry does not make a repo a fleet member. Only for the slugs they confirm: `fleet-connect.mjs --write <slug,...>`, then `check-projects.mjs`. A declined repo stays `undeclared` in every report; that is expected, not a finding to re-raise |
| `missing` | declared for this machine, no checkout | report; clone it or remove the machine key (owner's call) |
| `unpointed` | declared + present, manifest lacks a `registry.local` resolving here | report the manifest edit for that project's owner |

Then `link-registry.mjs` failures:

- `rule … is a copy that drifted` — the registry regenerated rules after the copy was installed.
  **connect**: `node scripts/link-registry.mjs [--project <slug>]` rewrites the managed copies
  (rules are copies, not links, because the harness does not load a symlinked rule).
- `… is absent / should be a link` — **connect**: same command creates the link (junction on Windows).
- A newly declared project from the table above is linked with `--project <slug>`.

- `.ai/manifest.yaml has no \`skills:\` block - nothing declared, nothing linked` — the project is
  skipped **entirely**, knowledge rules included, even though it declares `knowledge.domains`.
  The repair is a `skills:` block in that project's manifest (an empty one is enough) — report it for
  the owner; it is a manifest edit.

Never run `link-registry.mjs` with an unknown flag: it has only `--check`, `--project`, `--help`.

### 6 · verify

```sh
cd <registry> && node scripts/check-projects.mjs
cd <registry> && node scripts/link-registry.mjs --check
cd <registry> && node scripts/build-registry-map.mjs --check --project <slug>
```

A stale map is repaired with `node scripts/build-registry-map.mjs --project <slug>` (writes
`<project>/.ai/registry-map.json`, which is **committed in that project** — commit it there only
for this repo; report it for others). Stale verdicts inside the map are `/conform --stale` work, not
onboarding. `no context-map.json - nothing to join against` means the project has never been
populated: that is `/project-populate` in that project, not a registry fault.

## Validation record

- **2026-09-16, machine Wolf** (first run, `connect`): 13/13 declared checkouts connected; 21
  drifted rule copies across 13 projects rewritten; ascent's stale registry map rebuilt. Two local
  repos pointing at the registry were auto-declared and then REVERTED on the owner's word — they do
  not belong in the fleet. That is why `--write` now takes explicit slugs and `undeclared` is a
  question, never a repair.

## Output

End with the step table filled in — `done | active | blocked | pending` per step, the evidence line,
and for `connect` the exact repairs applied and the ones left for an owner. Same vocabulary as the
tab's `STATE_READ`, so the terminal and the tab read alike.

## How the tab's how-to maps to reality

- `sync` / `hooks` in the tab (`src/lib/org/registry-howto.ts`) run `scripts/ascent-skills.mjs` — a
  single zero-dependency file a repo copies in from ascent (no npm package, no `npx ascent` bin).
  `sync` pulls the org's skills through the ascent API with an `askl_` token; it is the hosted path.
- The local, single-owner path is `link-registry.mjs` (links + rules for every declared project) or,
  for a repo outside that fleet, `install-registry.mjs --project <path> --harness claude`.
- `pointer` is `registry.remote: github:<owner>/<repo>` under `registry:` in `.ai/manifest.yaml`
  (the key this repo's own manifest carries; `registry.local` is the checkout path).
- The tab's `point` counts repos from scans; the local path counts `projects.json` rows for this
  machine. A repo can be one without the other.

## Commit discipline

- In **this** repo: commit on the current branch with a pathspec (`git commit -- <paths>`); never push.
- In the **registry**: a `projects.json` edit is a committed declaration. Leave it staged-free and
  report it unless the user asked for a registry commit.
- Never `reset --hard`, never stash — sibling sessions share these trees.
