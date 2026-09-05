---
product: "ascent"
stack: "Next 16 (canary/preview) · React 19 · TS · Tailwind v4 hand-rolled primitives · Prisma 6 + Postgres/Aurora DSQL · Supabase auth · vitest + playwright · no i18n"
vault: ["C:/Users/kazda/Documents/Obsidian/ascent"]
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
- `npx tsc --noEmit`
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
  is signal.

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

## Skill improvement log

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
