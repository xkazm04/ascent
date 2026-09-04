---
product: "ascent"
stack: "a product that scores how AI-native a repository/org is (Next.js 16.3.0-preview.5 + React 19 + TS + Tailwind 4 + Prisma with embedded PGlite in dev; vitest for unit tests)"
vault: ["C:/Users/kazda/Documents/Obsidian/ascent"]
vault_subdir: Perfect
base_branch: master
wave_size: 3
lot_caps: {}
pool_target: 10
round_shape: round
cooldown_rounds: 2
commit_format: "feat(<context>): <title>"
context_map: context-map.json
active_runs_ledger: ""
locale_count: 1
---

# perfect overlay - ascent

First run: create `C:/Users/kazda/Documents/Obsidian/ascent` (the user keeps per-project vaults there).
Builds fork from and land on `master` - if the session starts on a stray branch, note it and base the
wave on `master`. `round_shape: round`: propose for 1-3 contexts, gate, build that slate immediately
(the owner can say "hold" at the wave-plan gate); thin slates of 1-3 keep winning here.

Context-map keys in this repo: `filePaths`, `apiRoutes`, `description`. If a direction changes which
files a context owns, update `context-map.json` to match (Director, Class C).

## Gates
- always: `npx tsc --noEmit`, `npm test` (vitest; scope with a path when targeted), `npm run lint`
- when any `.tsx` touched: the AGENTS.md 300-LOC `.tsx` check
- slow: none
- wave-closing (once, after the last merge of a wave): `npm run build` (exit 0 - tsc and tests cannot
  prove the client/server boundary, see the build-not-in-gate memory) - `npx prisma generate` mandatory after
  any schema merge - re-diff `context-map.json` against the file tree and own what the wave added/deleted.
- builder: `npx tsc --noEmit`, `npm test` (targeted: `npx vitest run <path>` where possible),
  `npm run lint`, and the AGENTS.md 300-LOC check if you touched any `.tsx`; report what you COULD NOT
  verify honestly. Only the Director drives live flows, from the main checkout - the dev server + PGlite
  DB live there.

## Class B
- barrel exports such as `src/lib/db/index.ts`
- generated schema artifacts (regenerate from source at conflicts, never checkout a branch's version)

## Class C
- the git index
- `context-map.json`
- generated schema artifacts (Director regenerates once at quiescence)

## Repo law
Authority: `AGENTS.md` (300-LOC `.tsx` cap) + `src/components/ui/BRAND.md`.
- This is NOT the Next.js you know: it's 16.3.0-preview.5. Read the relevant guide in
  `node_modules/next/dist/docs/` before writing Next-specific code. Heed deprecation notices.
- Max 300 LOC per `.tsx` file (AGENTS.md). If an edit would push a file over, extract co-located
  sub-components FIRST - never commit an over-limit file.
- Read `src/components/ui/BRAND.md` before any UI. The identity is "The Index": one azure accent on cold
  ink, hairline rules, mono tabular-nums metrics. Import primitives from `@/components/ui` (Surface,
  Kicker, Stat, SectionHeading, HairlineGrid, Dateline, Modal) and org chrome from `@/components/org/ui`
  (Tile, TILE_LEDGER, OrgTable, Meter) - never hand-roll them or re-hardcode `border-slate-800` chrome.
  Level/score color ONLY via `LEVEL_HEX`/`scoreHex` (`@/lib/ui`) - never pick a hex by hand. Motion
  degrades under `prefers-reduced-motion`.
- Respect `context-map.json` scoping; read it before editing.
- Review conventions (Director): brand tokens + `@/components/ui` primitives, Tile/`TILE_LEDGER` for org
  stat rows, `LEVEL_HEX`/`scoreHex` from `@/lib/ui`, the 300-LOC `.tsx` cap, context-map scoping.
  **Brand check:** any UI diff must hold the Index identity - no hand-picked hexes, mono `tabular-nums`
  metrics, `Surface`/`Kicker` instead of re-hardcoded slate borders, motion gated behind
  `prefers-reduced-motion`. A diff that fights the brand system is a redo, not a merge.
- Doc-sync: user-visible changes update the mapped doc under `docs/` when one exists for that feature
  area.

## Context sources
- `context-map.json` for the queue. Coverage names: `.personas/contexts.txt` (the registered-name list,
  refreshed when the app rescans); fall back to the map name only when that file is absent.

## Smoke
- Visual pass every ~3 rounds, before proposing. The dev port is volatile - probe candidate ports for an
  "Ascent" `<title>` rather than assuming. `npm run dev` boots the embedded PGlite DB (seed via
  `scripts/seed-scans.mjs` + `seed-org.mjs` if empty).
- Plan B without a browser: SSR `curl` of the touched routes grepping for the new surface's markers; the
  interactive half stays owed in the `Perfect.md` cursor.

## Opportunity arcs
- Judged from context-map metadata, `docs/*`, and memory. Active arcs: individual/personal tier, org
  intelligence & fleet maturity, AI-delivery ROI credibility, signal-layer generalization beyond
  GitHub-native.

## Vetoes
- Features already planned elsewhere; "removed - don't re-suggest" notes; the simulated-spend
  disclosure constraint; the scan-dedup behavior.
- Dedupe against `docs/archive/2026-hackathon/BACKLOG.md` - don't re-pitch a backlog item verbatim.

## User taste
- Thin, evidence-honest slates; "near-polished, N small residuals" is a good verdict.
- Bugfixes stand alone (standalone re-presentation of a previously-bundled fix was accepted instantly).

### Migrated from the vault's config.md (rounds 1-10, 2026-07-22 .. 2026-08-03)
- **Round 8 (first data point): a full 5/5 slate accepted, zero rejections.** The slate was 4
  engine/architecture directions + 1 UI surfacing of an existing computation, and every one landed.
  Read: the engine-depth default is correct for this owner, and a security/operational-hardening
  direction on a public endpoint is an easy yes.
- **"Honesty" directions are the strongest currency in this product.** Three of five accepted
  directions were variants of *stop presenting more confidence than the data supports* (coverage
  count on a verdict, received-vs-stored on an integration, naming unsupported hosts). The repo's
  own recent commit titles say the same thing. Weight future slates toward it.
- The owner takes the recommended option at gates and asks for the larger scope (both builders, not
  one). Do not pre-shrink a wave out of caution — present the full plan with its risks named.

## Skill improvement log
### Migrated from the vault's config.md on 2026-09-04 (rounds 1-10; the per-builder worktree recipe in it is v1 and superseded by the one-branch wave)
### Round 10 (2026-08-03, session 7) — 10/10 accepted, 10/10 shipped

- **The loop's own instrument had rotted and no phase was checking it.** `context-map.json` — which
  every scout brief and builder scope is built from — had drifted to **30% of the tree owned by no
  context** after a concurrent session moved ~200 files. Phase 0 diffs the map against the *vault*
  (49/49, clean) and never against the *working tree*. **Add a Phase-0 step: diff the context map
  against the actual file tree and print the unowned count.** A map that lists dead paths silently
  narrows every brief in the round.
- **Corollary: the directory-majority heuristic needs a human pass.** Auto-assigning unowned files
  put a whole `about-org/` marketing surface in "App Shell", credits controls in "Fleet Alerts", and
  the new `SnapshotScopeNotice` in "Fleet Alerts" again. The mechanical sync is right ~95% of the
  time; budget one review pass over the assignment tally, which is where all the errors are visible.
- **Write the "report a negative" escape clause into every inference-based perf direction.** The
  backlog-ceiling direction was slated on a scout's *structural* reasoning (3-level nested `take`
  under `relationMode="prisma"` = textbook N+1). It was **wrong** — and because the acceptance
  criteria explicitly invited "if it doesn't reproduce, say so and scope down", the builder measured,
  disproved it, and found a *worse* real defect underneath (nested `take` applied post-fetch, so the
  whole scan history crosses the wire). 5× fewer rows. Without that clause the likely outcome is a
  builder quietly "optimizing" a query that was already fine.
- **Builder death is a solved problem now — keep the recipe.** Session limit killed a builder
  mid-direction with 6 new files + a schema change uncommitted. `wip`-commit inside its own worktree
  → re-brief a fresh builder to continue *from that commit*, explicitly told to judge the WIP on
  merits, not trust it. B2 then found three real defects in the inherited work including a **missing
  migration** (table on fresh installs only) and a restore that could clobber a live drag. The
  hand-off review was *more* thorough than a single builder's would have been.
- **Group directions by SHARED FILES, not by theme — fourth round of zero conflicts.** All three
  recommendation-lifecycle directions went to one builder *because they answer the same identity
  question*; two builders would have invented two identity schemes. The one cross-cutting perf
  direction was explicitly restricted to the half that couldn't collide with a sibling's
  mount-or-delete decision. Zero conflicts across 4 builders / 10 directions.
- **"Mount or delete — no third state" is a strong acceptance shape for orphan findings.** It forced
  a real argument per panel instead of a reflexive restore; the builder deleted the punch list on
  evidence (3 of its 4 inputs are queries the page no longer makes) and mounted the other two at zero
  query cost. Reuse this wording whenever the finding is "built but unreachable" — the fourth round
  running that this pattern produced the round's best finding.
- **Run `npm run build` as a wave-closing gate, not an optional extra.** Two builders independently
  flagged that `tsc` + tests cannot prove the client/server boundary, and one shipped a client
  component importing a type from a server module. It erased correctly — but only the build proved
  it. Add it to `config.md` gates below.

- 2026-07-22: skill adopted from kp edition; retargeted (master branch, vitest/tsc/eslint gates, Index brand system, no i18n/python phases).
- 2026-07-22 round 1: **verify scout negative-existence claims** ("file X doesn't exist") with a 1-line ls/glob before baking them into a direction — one direction premise was false and only the builder caught it.
- 2026-07-22 round 1: on Windows, `git merge-file` on a working-copy file needs **CRLF→LF normalization of all three inputs first** (autocrlf=true makes every line differ otherwise → whole-file conflict).
- 2026-07-22 round 1: add to builder briefs: **never embed control characters (e.g. literal NUL) in source string literals — use escapes** (git flags the file binary; one builder did this for a join-key separator).
- 2026-07-22 round 1: memory-based queue scores can be stale in an actively-developed repo — both round-1 contexts were healthier than scored; the scout phase corrected it, but expect thin slates and re-score aggressively.
- 2026-07-22 round 2: scout negative-existence claims failed AGAIN ("untested" path had tests) — builders caught it both times; keep the builder-brief instruction to verify premises before building, and have the Director spot-check "X is missing/untested" claims with one grep at challenge time.
- 2026-07-22 round 2: builders disclosing minimal out-of-scope wiring (types.ts one-liners) worked well — approve at review rather than forcing DECISION NEEDED round-trips for additive one-liners.

### Round 3 (2026-07-27)
- **INCIDENT: never `reset --hard` on the main tree.** Redoing cherry-picks to fix duplicated Co-Authored-By footers destroyed the concurrent ship-loop session's uncommitted WIP. Rules now: builders' commit messages already carry the footer — NEVER amend after cherry-pick without checking `git log -1 --format=%B` first; cosmetic message flaws never justify working-tree-altering commands; any `M` in `git status` is a hard blocker for reset/checkout/clean.
- Headless Playwright (repo's own install, absolute-path import) is a full substitute when the Chrome extension is down — it cleared the INTERACTIVE half of the visual pass (sandbox PATCH-200 roundtrip), not just SSR smoke. Reuse: scratchpad driver scripts against dev :3001.
- Visual-pass findings fed straight into the next scout's brief as live evidence (hydration mismatch, %40 permalink) — both root-caused in one scout pass and shipped as S bugfixes same round. The pass→scout→fix pipeline is worth keeping deliberate.
- Deferring a cross-builder UI touch (FoundationPrButton in S2-owned ReportHeader region) to a post-merge Director commit worked cleanly — cheaper than sequencing a whole builder.
- Main-tree lint sweeps stale `.claude/worktrees/agent-*` checkouts (12 phantom errors). Either clean those up or always filter lint output by path.

### Round 4 (2026-07-27, session 2)
- Sequencing a dependent builder onto post-dependency master (recreate the pre-made worktree) worked perfectly — P2 consumed the real projection, zero stub drift. Keep "prefer sequenced fork when the dependency merges before the slot frees".
- Narrow pre-authorization ("additive optional field + one setState only") let O2 ship cross-file needs without DECISION round-trips, at the cost of two small union conflicts at merge — good trade, keep it.
- Brand check earns its keep: caught a builder re-hardcoding BAND.some as a fresh hex (would have been the codebase's THIRD copy) — the fix was a one-line import at amend time.
- Both scouts again produced defect-first briefs with zero manufactured findings; the "near-polished, N residuals is a fine verdict" phrasing keeps working.
- Cherry-pick + amend on own picks caused a self-inflicted conflict on the NEXT pick (import block) — amend after ALL of a builder's picks land, or accept the union cost.

### Round 5 (2026-07-27, session 3)
- Engine-heavy contexts (llm, ci-gate) yielded the two strongest scout briefs yet — the "hardened edges vs core" framing found a scan-killing UI bug and a four-surface consistency drift no code-first pass had. Keep engine contexts high in the queue.
- The route-file export constraint (Next allows only HTTP-method exports) makes "extract to lib with injected hooks" the standard recipe for sharing webhook logic — G2's verbatim extraction preserved 39/39 behavior. Record as the pattern.
- Two builders in one file (openrouter.ts) with different regions merged clean, but the SECOND one left a comment describing the pre-sibling reality — reconcile comments at merge time, cheap Director commit.
- Cherry-pick sequencer left a dangling empty-duplicate state after a conflict-continue; `git cherry-pick --skip` clears it — check `git status` after every continue.

### Round 6 (2026-07-27, session 4)
- Strategic-orphan findings (a whole surface unreachable in prod) are the highest-value scout output yet — worth explicitly asking scouts "who can actually REACH this surface?" in every brief.
- Case-naive innerText checks produced two false alarms in the visual pass — drivers must lowercase both sides or use accessibility-name queries.
- A builder deviating from acceptance wording with a documented reason (promotion as sibling verdict, not same-detector) was RIGHT — keep acceptance criteria about outcomes, not implementation shape.
- Doc files shared across a builder's sequential commits conflict on every pick — instruct builders to touch shared docs ONCE in their final commit, or accept per-pick unions.

### Round 7 (2026-07-28, session 5)
- **Two never-slated contexts both came back "near-polished"** — and both still yielded a real
  direction, because the scouts were briefed on ENGINE depth (pipeline math, lifecycle, ceilings)
  rather than surfaces. The two best findings of the round were an ORPHANED computation (exported
  through barrels, rendered nowhere) and an ARCHITECTURAL CEILING (all fleet work inside one 300s
  invocation). Add both to every engine-context scout brief: "what is computed but never rendered?"
  and "what breaks at 10x the current scale?"
- Disjoint file sets by construction (chosen at wave-plan time) produced the first round with **zero
  merge conflicts at all** — not just zero integration fixes. When two contexts don't share files,
  parallel is strictly free; prefer pairing contexts that way when the queue allows.
- Both builders extended their briefs and DOCUMENTED why; both were right (suppress both gap lists
  below the population floor, not just the systemic one; exclude private repos from missing-marking
  because a `type=public` listing says nothing about them). Outcome-shaped acceptance criteria keep
  paying — the round-6 lesson generalizes.
- The one review catch was again a SEARCH-BEFORE-BUILDING miss: a local re-fork of a helper
  (`dimShort`) whose own doc comment says it exists to be the single place. Worth a line in the
  builder brief: "if you write a one-line cast-plus-fallback helper, grep lib/ui first."
- A builder ran `prisma generate` against the SHARED node_modules from its worktree schema (the
  junction resolves to the ancestor). It disclosed this clearly and it was harmless once the schema
  merged — but the Director must re-run `npx prisma generate` on master after any schema merge.
  Add to the merge checklist.

### Round 8 (2026-07-29, session 6)
- **The loop had a second memory it was never writing to.** Eight rounds of vault notes and the
  Personas coverage instrument read 0% — `.personas/` didn't exist so the skill's own gate said
  "skip silently", and the app's registered context names had been stale since May, so any entry
  would have anchored to nothing anyway. Wiring it took one session; NOT wiring it cost eight rounds
  of invisible work. **Emit outbox nodes every phase from now on** — Phase P after each gate,
  Phase B after each merge, Phase W to backfill.
- **`/perfect` loads the GLOBAL skill copy, not the project one.** `ascent/.claude/skills/perfect/`
  is a stale fork that never loads. Edit `~/.claude/skills/perfect/skill.md`. Verify which copy
  loaded before trusting any skill edit.
- **A concurrent session landed 80 files mid-wave** (`5cc09bc4`), moving master under both builders
  and adding four schema columns. Two consequences worth generalizing: (a) `npx prisma generate` on
  master after ANY schema merge is mandatory, not conditional — 15 stale-client tsc errors looked
  exactly like a broken build; (b) a builder running `prisma generate` in a worktree writes through
  the node_modules junction and clobbers the MAIN checkout's client. Both cost ~zero once
  understood, and both will recur.
- **Both builders deviated from their briefs and both were right — again** (third round running).
  Builder A rejected the partitioning key I specified (`techGroupsFor`) for the join table
  `techGroupScope` actually filters on, because mine diverges after `eraseOrgData`. Keep writing
  acceptance criteria as OUTCOMES and let builders pick the mechanism; the brief's suggested
  implementation should be labelled as a suggestion, not a spec.
- **Review caught a defect the gates never would: a literal NUL in `otlp.ts` on master.** Git had
  the file marked binary, so every diff to it was suppressed and invisible to review. It surfaced
  only because the stat line read `Bin 4831 -> 8465 bytes` and got investigated instead of skimmed.
  **Add to the review checklist: any `Bin` in a diff stat for a source file is a stop-and-look.**
  The sharper lesson: **this exact defect is logged at round 1 above** (2026-07-22, "one builder did
  this for a join-key separator") — the lesson was recorded and the INSTANCE was never remediated,
  so it kept suppressing diffs for six more rounds. Recording a lesson is not fixing it; when a
  round finds a defect class, grep for surviving instances in the same turn.
- Conflict discipline paid: 3 conflicts, all from the concurrent commit. Two were both-append seams
  with complete declarations on each side (safe union); the third was a single doc table ROW where a
  union would have silently duplicated it. Read every seam — the union shortcut is only safe when
  each side is self-contained.

### Round 9 (2026-07-29, session 6 continued)
- **Phase 0's context-map diff had silently stopped earning its keep.** Four contexts —
  8% of the product, including the two joint-highest never-slated ones — had no vault note
  and no queue slot for eight rounds. The step is already in the skill; it just never found
  anything before, so it stopped being run carefully. **Run the diff mechanically every
  Phase 0 and print the count**, don't eyeball it.
- **Scripted table edits are a live hazard in this vault.** A queue-renumber script split
  rows on the escaped `\|` INSIDE `[[slug\|Label]]` wikilinks and mangled 57 of them, adding
  a phantom column to every affected row. Caught on read-back and repaired. **Rule: mask
  `[[...]]` spans before splitting a markdown table on `|`, and re-read the table after any
  scripted edit.** A `perl -pi` on the same file also silently no-opped earlier in the
  session — prefer a script file that re-reads and verifies over a one-liner.
- **Three rounds running, the best finding has been the same shape: a finished feature that
  nothing reaches.** Round 7 an orphaned computation, round 8 a discarded confidence count,
  round 9 two complete verbs with no caller and no production engine. **Put "what is built,
  tested, and unreachable?" at the TOP of every scout brief** — it outperforms every other
  prompt line in this loop.
- **Briefing a scout with a premise can be worth more than briefing it with a question.** The
  Skills brief asserted that org API tokens probably lacked round 8's revocation and asked it
  to verify. It came back and said the opposite, with evidence — which killed a direction
  before it reached the user. Keep stating the Director's hypothesis explicitly AND keep
  telling the scout to correct it; a scout that only answers questions can't tell you you're
  wrong.
- **Leaving a choice open in a brief produced better engineering than specifying it.** "Fold
  at the read end OR emit at the write end — pick one and say why" got a build with a
  structural argument (one transaction cannot desync; two write paths can). Prefer
  outcome-plus-alternatives over outcome-plus-mechanism where both options are defensible.
- Builder-disclosed doc-sync gaps are cheap Director commits — but **verify the doc against
  the code before committing it**. One claim in the new `llm-providers.md` text was already
  stale (a constant had been renamed during the extraction) and was caught pre-commit.

### Round 11 (2026-09-04, skill v2.5.0) — 5/5 accepted, 5/5 shipped, one branch, zero conflicts
- **A regenerated context map is a Phase-0 event, not a diff.** The 2026-08-29 map (54 contexts, its own
  `summary` still saying 49) retired 5 contexts and added 10; 17% of the tree was unowned a week later, with
  49 unowned files under `src/lib/local` alone. Scouts must be pointed at whole directories when the map
  lags; the queue is provisional until the map is re-owned.
- **Campaign-era hypotheses go stale fast in this repo.** All six 2026-08-30 loop defects were already fixed
  by the 2026-08-31 UAT drain; briefing the scout with them as hypotheses-to-refute is what turned a
  "six defects" cursor into an honest one-direction slate. Keep stating the Director's hypothesis AND
  telling the scout to correct it.
- **A redo sent AFTER the builder's final report still lands** — `SendMessage` resumes the agent from its
  transcript; lot A closed the badge dual-read gap it had itself documented, with tests. Cheaper than a
  fresh builder and it keeps file ownership clean.
- **Do not switch branches when a foreign session is committing into the checkout** — three foreign
  commits landed mid-wave (registry-map, scan-sweep). Building on the current branch with `--only`
  commits was the right call; `master` here is polluted by autopilot bench fixtures anyway.
- **`--only` on a shared doc still sweeps a sibling's dirty lines** (lot B's doc commit carried lot A's
  section). Both builders diffed before touching and reported it — the protocol text works; keep the
  "touch shared docs once, in the final commit, after checking `git log -1 -- <doc>`" instruction.
