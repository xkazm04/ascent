# scan-sweep — ascent overlay

Project-specific configuration for the shared `/scan-sweep` skill. The skill itself lives in the
registry (`.claude/skills/scan-sweep` is a symlink); nothing repo-specific belongs in it.

| Key | Value |
| --- | --- |
| `contextMap` | `context-map.json` — **v2 grouped** (`groups[].contexts[]`, 52 contexts). `coverage.mjs` flattens both shapes as of skill 2.7.1. |
| `memoryOutbox` | `.personas/memory-outbox.jsonl` |
| `backlogDigest` | *(none — `.personas/backlog-digest.json` does not exist here)* |
| `gates` | see below |
| `depth` | skill default (12 loop / 20 `--one`) |
| `neverSweep` | none |

## Gates

Run each in its own invocation and `&&`-chain them ahead of the commit — never pipe a gate through
`tail`, which swallows its exit code (AGENTS.md and the skill's §7.2 both say so; both have been
defeated here before).

```bash
npx tsc --noEmit                       # whole-tree: see the concurrency note below
npx vitest run <path>                  # scope to the files you touched; npx vitest run for all 586
npx eslint <paths> --max-warnings=0
```

Plus the two LOC rules from `AGENTS.md`, which are gates even though nothing runs them for you:
**300 LOC** per `.tsx` outside `src/features/**`, **200 LOC** for every `.ts`/`.tsx` under
`src/features/**`. The PowerShell one-liners are in `AGENTS.md`; run them before committing a file
you grew.

## This checkout is shared with other live sessions

Several agents work in `C:\Users\kazda\kiro\ascent` at once. Two consequences the skill's §7 parallel
rules only half-cover:

- **Stage by explicit path and re-read `git status --porcelain` right before every commit.** An `M`
  you do not recognise is another session's in-flight file. (2026-08-29: `src/lib/db/index.ts` sat
  dirty through a whole round and correctly stayed out of nine commits.)
- **A red whole-tree `tsc` may not be yours.** Get the failing paths and compare them against the
  files you touched before treating it as your failure — or your gate.

The same hazard reaches the **registry** through the skill symlinks: a reflection-lane edit to
`skills/scan-sweep/**` lands in a second shared tree. Commit it immediately with a pathspec commit;
a parallel run has already swept an in-flight version bump into its own commit here.

## Skill improvement log

- **2026-09-04 — NEVER `git stash` here; commit instead, even if that means carrying another
  session's work.** The overlay above already forbade stash and a round used it anyway (path-limited,
  `--keep-index`), then lost its own edit restoring a backup over the stashed file — recovered only
  because the stash held exactly one path. The operator's rule, stated after: **prefer committing and
  combining another session's progress over stashing.** A commit is recoverable by anyone and visible
  in the log; a stash is invisible to the other sessions sharing this checkout, and `pop` can conflict
  with work they have since done. If a fix needs a clean tree to prove a fail-before, take a copy of
  the file with `cp`, edit in place, and restore from the copy — no git state changes at all. That
  worked five times in the same session; the one stash was the only step that lost work.
- **2026-09-04 — the eslint gate cannot pass on every file in this repo.** `npx eslint <paths>
  --max-warnings=0` is the overlay's declared gate, but `src/app/api/cron/digest/route.test.ts` and
  `src/lib/db/invites.ts` carry pre-existing unused-var warnings. Do not reinterpret the gate silently:
  assert **0 errors** on the files you touched, confirm a warning is pre-existing with
  `git show HEAD:<file> | npx eslint --stdin --stdin-filename <file>`, and say so in the report.
- **2026-09-04 — the generated `.ai/registry-map.json` misses `authorization` for the
  Members & Access Control context** (it joins `status-vocabulary` + `data-access`). Two of five fixes
  in that round came from reading `security/identity-and-access/authorization` anyway. When a context
  is obviously governed by a subject the map does not list, resolve it through
  `knowledge/<domain>/index.json` and say in the header that you went outside the map.

- **2026-08-29 (moonshot round)** — `--develop --ideas-only` over ALL 54 contexts with `feature-scout` +
  `moonshot-architect` (operator-defined; not in `references/lenses.md`), L/XL only. Method that worked:
  one fresh scout subagent per **context group** (11 in parallel, ~200k tokens each) with a shared brief
  (`BRIEF.md`: product docs to read first, never-re-propose list, finding form), 3-5 findings per group
  → 45 findings → 37 deck items after merging cross-group duplicates → in-terminal triage 4 per screen.
  Two hazards: (1) **subagent `.output` transcript files are EMPTY for most completed agents** — the
  result exists only in the completion notification, so persist each result to the scratchpad the
  moment it arrives or it is lost when context compacts; (2) the outbox is now 719 lines (30 of 45
  findings emitted per the 30-per-pass cap; the 15 skipped are all deferred/concept-doc items and are
  fully recorded in `docs/BACKLOG.md`'s round table). The decision record lives in BACKLOG.md, not only
  in the outbox, because the outbox is not being drained.

- **2026-08-29** — `.personas/memory-outbox.jsonl` has not been drained since 2026-08-10 and stands
  at ~369 lines, well past the 200-line / 30-finding ingest cap. Rounds keep appending because losing
  the record is worse than exceeding a cap nothing is currently reading — but until Personas ingests
  and deletes the file, **assume this round's findings are not reaching the triage deck** and say so
  in the report. Check `wc -l` at the start of a round.
- **2026-08-29** — the dev-seed surface (`src/app/api/dev/*`) spans four routes; the "Dev Inspector"
  context declares three. When sweeping a context whose files share a symbol, grep the symbol across
  `src/` and not just across the declared paths — the undeclared sibling is where the unfixed copy of
  the defect was.
- **2026-08-29** — the shell context (App Shell, SEO & Error Pages) has FOUR Sentry emit sites and
  no outbound scrubber. Before proposing any new telemetry capture here, read the backlogged
  registry-conformance finding first: the sequencing (inventory, then beforeSend, then close the
  client-boundary gap) is the finding, and adding a capture site alone makes it worse.
- **2026-08-29** — before committing an edit to `src/lib/x.ts`, run `src/lib/x.test.ts`. Gating on the
  CONSUMERS of a changed module (which is what the blast-radius instinct produces) missed 9 failures
  in the sibling suite of the very file edited: `practice-artifact.test.ts` pins each language command
  tuple with `toEqual`, twice.
- **2026-08-29** — this repo GENERATES code that runs in customer CI (`src/lib/standard/*`,
  `practice-artifact.ts` workflows). No gate here can see it, and the suite stays green regardless.
  When touching a generator, ask what the emitted artifact would do elsewhere, and pin the generated
  value against this repo's own equivalent declaration (`CI_NODE_VERSION` vs `package.json` engines
  is the worked example).
- **2026-08-29** — commit with `git commit -m "..." -- <paths>` and never `git add` at all. The
  `git add -- <paths> && git commit` shape looks scoped but the commit takes the whole INDEX, and a
  sibling session staging between the two commands lands in your commit. It happened twice in one
  sweep here; the second time it swallowed another session's new script, its test and a 444-line
  `context-map.json` edit. Recover with `git reset --soft HEAD~1` then a pathspec commit — their
  files return to the index untouched — but only if you read the diffstat before moving on.
- **2026-08-29** — run the AGENTS.md LOC check on any file you GREW, in the same breath as the
  commit, not at the end of the round. Two added test cases took a `.tsx` from 291 to 307 and the
  round-closing gate found it after the commit had landed.
