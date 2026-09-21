---
product: "ascent"
stack: "Next 16 (canary/preview) · React 19 · TS · Tailwind v4 hand-rolled primitives · Prisma 6 + Postgres/Aurora DSQL · Supabase auth · vitest + playwright · no i18n"
vault: ["C:/Users/kazda/Documents/Obsidian/ascent", "C:/Users/mkdol/Documents/Obsidian/ascent"]
vault_subdir: Spark
context_map: context-map.json
base_branch: master
active_runs_ledger: ""
locale_count: 1
---

# Spark config — ascent repo overlay

Moved here from `$VAULT/Spark/config.md` on 2026-08-25 (the repo overlay is the home per
`spark` 1.1.0 § Project overlay; the vault copy is now a pointer stub).

## Gates

always:
- `npx eslint <touched paths>` — 0 errors (React Compiler rules are errors; lint is in the pre-push master gate)
- `npx tsc --noEmit` — output EMPTY (a syntax error anywhere, e.g. a truncated `.next/dev/types/validator.ts`, silences every semantic check)
- `npx vitest run` (scope with a path arg while iterating; **full run before merge**)

when a client/server boundary may have moved:
- `npm run build` — tsc + every unit test can pass while `next build` fails on a
  `"use client"` boundary break. Pure module + a `-load.ts` sibling is the fix pattern.

when the turn edited feature source with a user-visible effect:
- the Stop hook `node scripts/docs/check-doc-sync.mjs` must be satisfied: update the
  coupled `docs/features/*` doc in the SAME turn, or dismiss with one sentence naming
  why the change is internal-only. `scripts/docs/feature-doc-map.json` is the map.

when a Prisma migration landed:
- `npx prisma generate`, then re-run `npx tsc --noEmit`, then **restart any long-lived
  `next dev`** — a cached client/ensureDb misses new DDL and the miss reads as a code defect.
- **mirror every new column into `prisma/init.sql`** (both the `CREATE TABLE` body and the
  idempotent `ADD COLUMN IF NOT EXISTS` block), then `npx vitest run src/lib/db/init-sql.test.ts`.
  The migration is what an existing database runs; init.sql is what a FRESH one is built from, and
  a wave that updates only the first builds a database the app 500s on. Promoted to a gate on
  2026-09-21 after the guard caught it twice.

builder:
- `npx tsc --noEmit` and `npx vitest run <their paths>` before returning.

structure (hard, checked before every commit):
- ≤ **200 LOC** per file under `src/features/**` (ts *and* tsx, tests included)
- ≤ **300 LOC** per `.tsx` anywhere else
- remedy is co-located extraction, never a redesign; `"use client"` goes on extracted
  files that use hooks/handlers and **never** on ones that don't.

## Rituals

None. Ascent keeps no live-sessions ledger and no decision-capture command; do not
import another repo's. (Doc-sync is a Gate, not a ritual — the Stop hook owns it.)

## Repo law

Pasted verbatim into every builder brief:

- **Read `AGENTS.md` first.** Next 16 here is NOT the Next.js in your training data —
  read the relevant guide under `node_modules/next/dist/docs/` before writing code.
- **Reuse before building.** UI primitives live in `src/components/ui/` — read
  `src/components/ui/BRAND.md` before writing any markup. Org-shell chrome lives in
  `src/components/org/shell/`, cross-group pieces in `src/components/org/shared/`.
- **`src/features/<group>/<tab>/` mirrors the nav** (`ORG_NAV_GROUPS` / `ORG_TAB_IDS`
  in `src/lib/org/orgTabs.ts`). Nothing in a feature group may import from another
  group; `org/shared/` is imported BY features, never the reverse.
- **Prisma/DSQL**: JSON is stored as TEXT, there is no `jsonb`. Nearly every table is
  org-scoped — a new org-scoped table makes the **erase/retention path**
  (`src/lib/db/retention.ts`, `docs/features/data/retention.md`) a mandatory touched context.
- **LLM**: temperature is pinned to 0 globally for scan reproducibility. A per-use-case
  exemption is legitimate; widening it to scans is not. The keyless default returns
  `null` — every LLM surface must degrade honestly rather than fabricate.
- **Parallel-safety (paid for in blood, three times):** this checkout hosts parallel
  agent sessions. **Builders NEVER `git add`, `git stash`, `git commit`, or touch the
  index — the Director alone stages.** Even path-limited `add` races; the Director
  commits with pathspec (`git commit -- <paths>`) and verifies the staged set first.
  Never `git reset --hard`.
- **Never edit a guard test to make a pre-commit hook pass.** New files are committed
  before guard tests run; a guard that suddenly enumerates untracked files is a
  regression, not a fix. State the constraint and bounce it back.
- **Counter-propose, don't guess.** A builder refusal backed by `file:line` evidence
  is signal. **Measure before believing the brief**: a brief that asserts a third-party
  behaviour can be wrong, and a builder that measured one instead of trusting it saved a whole
  comparison on 2026-09-21.
- **A doc section written by a package goes stale inside the same session.** Before merging any
  doc, re-read every claim against the COMMITTED code, and hand the doc writer an explicit list of
  what changed after each section was drafted. Promoted from the improvement log on 2026-09-21
  (second occurrence): a confident "Known gap" that the code has since closed does more damage
  than no doc, because a reader trusts a stated gap more than silence.

## Wave defaults

- Wave = one AskUserQuestion call, up to 4 questions. Waves are uncapped; clarity terminates.
- Perspective checklist: functional scope ▸ data model & persistence ▸ API/command surface
  ▸ UX flow + async/empty/error states ▸ UI + shared-primitive reuse (BRAND.md,
  `@/components/ui`, `@/components/org/ui`) ▸ performance posture ▸ failure modes
  ▸ doc surfaces (`feature-doc-map.json`) ▸ out-of-scope.
- **No i18n**: strings are authored inline in English. Never ask a strings question.

## Question taste

- **2026-08-22 (live-flagship): optimizes for the flagship's CEILING over its reach** —
  picked the most distinctive metaphor (Observatory) over the most buildable (Flight
  Deck), self-hosted-only over a hosted fallback, bounded-parallel over sequential.
  Offer the bold option with its cost named; do not pre-narrow.
- 2026-08-22: put artifact/prototype links INSIDE the question text — the operator could
  not find a link given only in prose.
- Takes the powerful option when the risk is named; recommendations are evaluated, not
  rubber-stamped — always offer a real alternative.
- Rejected options are memorized.
- Prefers reusing existing machinery over new schema.
- **2026-08-25 (operator-companion): took the recommendation 12 times of 15, and BOTH
  overrides went toward the more powerful, more expensive option** — model-driven tool
  calling over a pre-assembled grounding blob, and a shared cross-product name over an
  unambiguous local one. Each was accepted with its cost already stated in the option text.
  Confirms the standing read: offer the bold option with its cost named; never pre-narrow.
- 2026-08-25: **zero "Other" answers across fifteen questions.** Keep writing the condition
  INTO the option text — an override then arrives with its mitigation already agreed, which
  is exactly what happened on the naming question.
- 2026-08-25: takes the FULL ladder when offered a cumulative scope question. Size the brief
  for it — this one came out at six work packages, not the method's nominal four.
- **2026-09-18 (theater-upgrade): gates the MINIMUM.** Asked which classes of change an unattended
  runner should stop and ask about, the operator answered with an "Other" doctrine — *"Contract,
  Dependency, Large footprints can be autoapproved"* — leaving **architecture moves alone** as the
  major class, because merging the runner's branch is itself the human gate. It was the most
  consequential answer of the session. **When a question offers a ladder of things to gate, make
  "only the narrowest rung" an explicit option**, and say what the later human checkpoint is; this
  operator will take it.
- 2026-09-18: took the recommendation on every question but that one, and chose "prototype before
  choosing" when offered a decision it could defer to built evidence. **Offer the prototype round as
  an option wherever a look-and-feel choice is genuinely undecidable on paper** — but scope it: three
  heroes behind ONE seam cost three parallel builders and produced a real pick.
- 2026-09-18: the artifact-with-screenshots pattern (2026-08-22's lesson) worked again for the
  prototype pick — the comparison page carried each option's own admitted weaknesses, the question
  carried the link, and the answer came back in one round.

- **2026-09-21 (local-model-lanes): 13 of 15 recommendations taken, both overrides toward MORE.**
  Override 1: the theater shows the arm ALWAYS, where the recommendation was "only on multi-arm
  runs" — this operator prefers one unconditional rule over conditional chrome. Override 2: drive
  the comparison against **ascent itself** rather than a safer paired side repo, with the blast
  radius named in the option text. The standing read holds: offer the bold option with its cost
  stated, and never pre-narrow.
- 2026-09-21: **zero "Other" answers across fifteen questions again.** The conditions written into
  the option text are what made both overrides arrive with their mitigations already agreed.

## Skill improvement log

- 2026-09-21 (local-model-lanes): **live-probe a spark's central premise before wave 1 when the
  machine can answer it in ten minutes.** The spark asked which harness would make a local model
  competent; running `claude -p` against Ollama during Phase 2 proved admission already worked and
  turned wave 1's architecture question from "which tool do we adopt" into "is the harness's prompt
  tax worth measuring" — a different question with a different, better answer. Two measured defects
  (a fabricated dollar cost, a silently truncated context) became work packages that speculation
  would never have produced.
- 2026-09-21 (local-model-lanes): **the liveness rule needs a third clause — trace a field through
  every REBUILD boundary, not just its type and its query.** Three separate places dropped the
  lane's arm between the database and the screen: the pulse type, the query's select, and a
  defensive CLIENT PARSER that rebuilds each field by hand. The brief named the first two; a builder
  found the third. Any field crossing a wire that something re-validates has one more place to
  vanish, and every test passes while it does.
- 2026-09-21 (local-model-lanes): **a package that refuses a cross-boundary change is doing its
  job, and the Director should then do it.** A builder declined to import the transport registry
  into a client component because it would have dragged `child_process` into the browser bundle,
  and left the evidence and the fix in a comment. The fix was fifteen minutes of Director work and
  removed a duplicated list. Budget for a short Director pass AFTER the fan-out for exactly this.
- 2026-09-21 (local-model-lanes): ten parallel packages against a committed wire contract, zero
  file collisions, one full-suite red (the init.sql mirror) caught by a guard rather than by review.
  The stubs-before-fan-out rule now has three sessions of evidence at 6, 8 and 10 packages.

- 2026-09-18 (theater-upgrade): **a builder killed by a 429 is not resumable by name** — `SendMessage`
  answers "no agent named …" and the transcript is gone. What survives is its work on disk and its
  last message, which (both times) named the exact item it still owed. Respawn a *finisher* pointed at
  the folder with that item as its scope, not a rebuild pointed at the original brief: both closed
  inside 20 minutes, gates and shots included.
- 2026-09-18 (theater-upgrade): **a package's doc section goes stale inside the same session** when
  the Director fixes a contract after the package lands. Five of eight sections here asserted
  something the merged code no longer did (an Int ceiling, a `revise` hold, missing settle seams, a
  stderr leak, dials the cockpit "does not send yet"). Re-read every claim against the committed code
  before merging the doc, or ask each package for a one-line "what changed after my section".
- 2026-09-18 (theater-upgrade): **run `node scripts/context-map/check-map-drift.mjs` before the final
  commit of any spark that adds a subsystem.** This one added 214 files; unmapped drift had reached
  18.6% (budget 10%) and an unmapped directory is one no sweep skill ever visits. Mapping them took
  one scripted pass and brought it to 11.6%.
- 2026-09-18 (theater-upgrade): **`vitest --repeat` is rejected by vitest 4.1.9** — two builders hit
  it independently. Tell builders to loop the run instead when they want repetition.
- 2026-09-18 (theater-upgrade): the **stubs-before-fan-out** rule (commit wire types + compilable
  stubs so no two packages share a file) held for EIGHT parallel packages, not the method's nominal
  four, and the prototype round's one registry seam let three heroes be built and two deleted with no
  change to the shell around them. Both patterns scale; keep them.
- 2026-09-06 (ui-surfaces-showcase): **`npm run lint` is part of the pre-push master gate (`npm run verify`)
  and the React Compiler rules (`react-hooks/refs|purity|set-state-in-effect|immutability`) are ERRORS** —
  the overlay's `## Gates` never listed lint, so 15 builders shipped 37 lint errors past tsc + vitest and the
  push to master was refused by the hook. Add `npx eslint <paths>` to every builder brief and to `always:`.
  Also: `git push . <branch>:master` runs that hook (lint, typecheck, coverage tests, build, ~10 min); run
  `npm run verify` once yourself BEFORE the push so a red gate is diagnosed with full output, not a 2-line tail.
- 2026-09-06 (ui-surfaces-showcase): `src/lib/scan-ingest.test.ts` "overlaps the siblings instead of trailing
  them" fails under `test:coverage` full-run load only (4/4 green alone, with and without coverage) — a
  timing test; verify against the file alone before treating it as yours.
- 2026-09-06 (ui-surfaces-showcase): **`npx tsc --noEmit` is HOLLOW while `.next/dev/types/validator.ts` is
  syntactically corrupt** — tsc skips all semantic diagnostics when any syntactic error exists, so "only the
  validator error" means nothing was checked. Sixteen builders and the Director passed this gate all session;
  ~200 `noUncheckedIndexedAccess` errors surfaced only after the dev server regenerated the file. The
  2026-09-05 line said "delete it, it regenerates" — make that the FIRST step of every tsc gate, and treat a tsc
  output that is not empty as red even when every line is in `.next/`.
- 2026-09-06 (ui-surfaces-showcase): **a parallel session committed 16 of its commits onto this spark's branch**
  because the main checkout sat on it. Working on a branch in the main checkout (the 2026-09-05 default) is
  only safe while no other session commits here; when one does, its commits ride to master with yours —
  say so in the merge. A worktree costs the node_modules junction problem; the branch costs this.
- 2026-09-06 (ui-surfaces-showcase): **the catalog bijection test imported all scene bodies in one 15s case**
  and timed out under full-suite load only; `it.each` per record keeps the budget per import and names the
  failing subject.
- 2026-09-06 (ui-surfaces-showcase): a builder misread AGENTS.md's "Nothing in a feature group may be imported
  from here" (about `org/shared/`, which features MAY import) as forbidding the import, and another imported
  a palette from a sibling feature GROUP (forbidden). State both directions explicitly in builder briefs; no
  lint catches the cross-group import today.
- 2026-09-05 (knowledge-base-rebuild): **the prototype round blocked on an unonboarded device.** The
  operator answered the pick gate with "onboard ascent on this device first". Before the go-gate,
  verify the operator can OBSERVE the surface: a dev server they can reach, an org with data, and the
  flags the switcher gates on (here `ASCENT_REGISTRY_PREVIEW`, which `next dev` does NOT hot-reload —
  a restart is required). The registry's `onboarding` skill + `npm run doctor` is the 10-minute path.
- 2026-09-05 (knowledge-base-rebuild): **curl is the wrong instrument for a client-rendered Suspense
  boundary** — the strip was in the RSC payload but not in the HTML, and grep said "not rendered".
  Verify UI in headless Chromium (`playwright` is a dev dep; `npx playwright install chromium`; run the
  script from the repo root so the package resolves).
- 2026-09-05 (knowledge-base-rebuild): **`scripts/seed-org.mjs` skips read as successes** until this
  run fixed it; a repo answers `skipped: in_progress` while another run's ScanJob claim (15-minute
  lease) is live — including claims a killed dev server left behind. `scripts/seed-fleet.mjs <org>`
  (synthetic, in-server, no GitHub) is the reliable way to get a populated org for UI work.
- 2026-09-05 (knowledge-base-rebuild): a **session-limit 429 killed the WP1 builder mid-package**;
  resuming from its in-place edits was safe precisely because builders never touch the index — keep
  that law, and re-run the scoped suites before trusting a builder's last message as its final state.
- 2026-09-05 (knowledge-base-rebuild): the operator's `next dev` (a cmd-launched process) had to be
  killed to load a new env file; a killed Turbopack server can leave `.next/dev/types/validator.ts`
  corrupted, which fails `tsc` on a file that is not ours — delete it, it regenerates.
- 2026-09-05 (knowledge-base-rebuild): worked on a branch in the main checkout instead of a worktree
  (clean tree, operator's dev server here, junction build lesson). No collision; keep it as the
  prototype-round default and use a worktree only when the tree is dirty.

- 2026-09-01 (weekly-digest, eval run): **the node_modules junction blocks `npm run build`** (the
  2026-08-22 line below, confirmed again): Turbopack fails with "Symlink [project]/node_modules is
  invalid". In a worktree you may not `npm install` into (a junction into another checkout), the
  build gate is blocked by construction — say so, run `next build --webpack` as the fallback, and
  lean on tsc + a jsdom render of the new server panel for the boundary evidence.
- 2026-09-01 (weekly-digest): **commit the wire types AND compilable stubs with final signatures
  before the fan-out.** WP1 (model) and WP2 (panel) then ran fully parallel with zero shared files;
  the stub bodies (`null` / `""`) let WP2's tsc pass against a module WP1 was still writing.
- 2026-09-01 (weekly-digest): **`Recommendation.createdAt` is the SCAN's date, not the gap's** —
  rows are recreated per scan with status carried by `(dimId,title)`. Any "opened since" read must
  be an identity diff against the last pre-window scan, with "no pre-window scan" reported as
  unmeasurable, never as 0. A creation event is the follow-up idea `followup-opened-event`.
- 2026-09-01 (weekly-digest): a Map of per-repo baselines built lazily from rows collapses "baseline
  empty" into "baseline absent"; seed it per measurable repo first. WP1's own test caught it.
- 2026-09-01 (weekly-digest): when a WP2-owned doc file needs a WP1 section, have WP2 leave a
  `<!-- WP1 doc section merges here -->` placeholder and WP1 write to scratch; the Director's merge
  is then one string replacement.

- 2026-08-25 (operator-companion): **partition DOC surfaces as explicitly as source
  directories.** Six code territories were carved carefully, then two parallel builders were
  handed the same feature doc and the same feature-doc-map. Caught mid-flight; the fix that
  worked is one owner per doc file, with the others emitting sections to a scratch file for
  the Director to merge.
- 2026-08-25 (operator-companion): **a source-reading guard must normalize line endings.**
  The constitution write-lock test matched a snippet containing a literal newline escape;
  autocrlf rewrites the file with CRLF on checkout, so it passed in the authoring worktree
  and failed on master and on any fresh clone. This class is invisible to every gate that
  runs where the code was written.
- 2026-08-25 (operator-companion): **a scout claiming a capability is ABSENT must show the
  repo-wide grep**, not the subsystem-scoped one. A scout reported that no provider supports
  tool calling; the Bedrock adapter had shipped a working toolConfig all along. An absence
  claim needs wider evidence than a presence claim.
- 2026-08-25 (operator-companion): **a red test file hides its own flakes.** Repairing three
  dead time-bomb fixtures exposed a one-in-ten flake underneath that nobody could see while
  the file was red. Stress-run a file you just repaired; one green is not evidence.
- 2026-08-25 (operator-companion): an acceptance criterion that asserts an ORDERING must name
  the mechanism that makes the ordering observable — "assert the turn has not started when
  POST returns" is unfalsifiable, because a stream's start() runs synchronously during
  construction.
- 2026-08-25 (operator-companion): restore package-lock.json IMMEDIATELY after the worktree
  npm install, not at merge time. Carrying it dirty through six packages is one careless
  staging mistake away from a junk commit.
- 2026-08-25 (operator-companion): **never embed backticks in a python string passed to
  `python -c` from bash** — bash performs command substitution first. One such string
  contained a `git add -A` example and bash RAN it, staging a parallel session's WIP. A mixed
  `git reset` recovered it with nothing lost, but the fix is to write files with the file
  tool, never through a shell-quoted heredoc-less string.

- 2026-08-22 (live-flagship): ask metaphor/shape questions BEFORE presentation questions
  (Q14 had to be re-asked as Q16 after the metaphor changed).
- 2026-08-22 (live-flagship): builder briefs must state "new files will be committed
  before guard tests run — never edit a guard to pass pre-commit" (WP4a widened the
  doc-sync test's enumeration; reverted).
- 2026-08-22 (live-flagship): when a WP creates a new org-scoped table, the erase/retention
  path is a mandatory touched context (caught by the builder's own question, not targeting).
- 2026-08-22 (live-flagship): a fresh worktree needs its own `npm install` (Turbopack
  rejects a node_modules junction) — do it in Phase 5 step 1 before launching builders.
- 2026-08-22 (live-flagship): parallel `/design` + `/prototype` experiments are a good
  wave-4 input for visual-metaphor sparks; the operator picked from the static canvas,
  so budget the prototype as comparison, not seed.
- 2026-08-22: ascent overlay scaffolded (the personas vault's gates don't apply here).
- 2026-08-25: overlay moved from the vault to `.claude/spark/config.md`; gates gained the
  `next build` boundary case, the prisma-generate/dev-restart case, and the structure caps.

- 2026-09-06 (knowledge-context-matrix): **the main checkout may be on ANOTHER session's branch** with
  dirty files (it was on `spark-ui-surfaces-showcase`, editing this very config). Merge from the spark
  worktree instead: `git checkout master && git merge --ff-only <branch>` there, then switch back — a
  branch can be checked out in only one worktree, and master was free. Rebase onto master first.
- 2026-09-06 (knowledge-context-matrix): **a fresh worktree checks out CRLF while the main checkout is
  LF**, and three master-green tests fail on it: `src/lib/scoring/gate-cli.test.ts` (SyntaxError),
  `src/features/bought/teams/TeamsHonesty.dom.test.tsx` (source-regex), `src/lib/local/pairing.test.ts`
  (timeout under full-run load only). The 2026-08-25 line-ending-guard class, two more instances; verify
  a full-run failure against the main checkout before treating it as yours.
- 2026-09-06 (knowledge-context-matrix): the overlay's `vault:` names the Wolf path only; on Fox the
  Obsidian root is `C:/Users/mkdol/Documents/Obsidian/ascent` (memory `fox-device-perfect-vault`) and
  `Spark/` was scaffolded there this run — the two vaults are not synced. Add the Fox path as a second
  candidate when this file is next committed cleanly (it was dirty under another session this run).
