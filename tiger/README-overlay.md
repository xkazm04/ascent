# ascent - `tiger/` overlay (the project specifics that left the generic `/tiger` 2.1.0 body)

Target repo: `C:\Users\kazda\kiro\ascent`. Overlay location per the canonical skill: the repo-root
`tiger/` vault. This file is written to be MERGED into ascent's existing vault, not to replace it.

## What ascent's `tiger/` already contains (checked 2026-08-22)

- `README.md` (2026-07-28) - home note: what's here, run-it, no jobs / use-case table, no
  expected-kills, no discovery / recipe / fixtures / price-basis sections (the recipe and price
  caveat live in `models.md`).
- `MOC.md` (updated 2026-06-20) - links one engine note (`scan-assess`), the three lenses,
  `models`, `_roster`, two sessions (`2026-06-20-tiger-l1`, `2026-06-20-tiger-benchmark`), `backlog`.
- `engine/scan-assess.md` - the single call site; rich note, dials 9/7/9, grounding 4/5 in +
  OUT closed; frontmatter has NO `use_case` key yet.
- NO `engine/_expected/` folder.
- `characters/_roster.md` - 10 Characters reused from `uat/characters/` with AI-surface angles
  and lens coverage; NO `use_case` column. The UC2 / UC3 judges the 2.0 skill named (Priya,
  Marcus, Anika, Priyanka) are NOT in this roster but DO exist in `uat/characters/`
  (`priya-platform-lead.md`, `marcus-engineering-manager.md`, `anika-jvm-platform.md`,
  `priyanka-indie-solo.md`).
- `lenses/{engine-quality,business-value,model-optimization}.md`, `models.md` (price snapshot
  2026-06-12 from `src/lib/llm/config.ts:39-55`; benchmark results 2026-06-20), `backlog.md`
  (P2-6 / P2-7 open; P0-1..3, P1-4..6, P2-8 closed), `sessions/2026-06-20-*`, `.gitignore`.
- `docs/GOLDEN-USE-CASES.md` (2026-08-17) is the source of the three jobs below.

So: the vault predates the v2.0 use-case frame. Everything below is ADDITIVE - new sections,
new notes, one new frontmatter key. Nothing existing is rewritten.

## How to merge

1. Append sections A, B, C, D, E below to `tiger/README.md` (after "What's here", before "Run it").
2. Apply `characters/_roster-overlay.md` (sibling file) to `characters/_roster.md`: add the
   `use_case` column and four rows.
3. Copy `engine/_expected/tailored-adopt.md` and `engine/_expected/mentor.md` (sibling files)
   into `tiger/engine/_expected/`.
4. Add `use_case: UC1` to the frontmatter of `engine/scan-assess.md` (it also informs UC3 - the
   developer's repo gaps are read from the scan - but its primary job is UC1).
5. Add to `MOC.md` under "The engine": the two `_expected` links and a "Jobs" line pointing at
   `[[README#Jobs / use cases]]`.
6. Stamp `MOC.md` `updated:` and mention the merge in the next `sessions/<date>.md`.

---

## A. Jobs / use cases (the value frame every lens judges against)

Source: `docs/GOLDEN-USE-CASES.md` (2026-08-17). Every `engine/*` note and every finding carries
one of these ids (or `cross` for shared plumbing); the backlog is grouped by them first.

| use_case | Job (who, the loop) | What Lens B's grounding audit asks for this job | Judges (>=2) |
|---|---|---|---|
| **UC1** | Standardize a codebase for the AI development process - a few quick iterations move a repo L1 -> L5. Repo owner / platform lead. scan -> gaps-to-explore -> apply practice / `.ai/` foundation -> rescan | Do the *detected* signals, the prior scan (memory grounding) and the org's exemplars reach the prompt? Is the output structural and repo-specific, never generic? | [[sam-staff-engineer]] (staff eng), [[mariam-fintech-audit]] (audit), [[tomas-prospective-buyer]] (buyer) |
| **UC2** | Share and improve AI-development techniques across an org's codebases - knowledge *and skills* tracked and shared. DevEx / platform lead, skill authors. observe -> propose -> adopt -> track -> improve -> redistribute | Does the fleet's skill registry, the exemplar's real commands, and Org Memory reach the prompt? Is frontmatter preserved by construction? Is the tailored output honest about what it could not ground? | [[priya-platform-lead]] (platform lead), [[marcus-engineering-manager]] (eng manager), [[anika-jvm-platform]] (JVM platform) |
| **UC3** | Individual care - help each developer use LLM dev tools to raise *their* productivity, privately. reflect on real usage -> interview -> profile -> moves -> re-measure | Does the developer's own journal + the repo's gaps + the org's skills reach the prompt? Does *nothing* leave the machine the developer did not choose? Is the advice senior-mentor grade, not generic hygiene? | [[priyanka-indie-solo]] (indie / solo IC), Sam-as-IC ([[sam-staff-engineer]] wearing the IC hat), [[elena-cto-founder]] (CTO founder) |

Why these three, in this order: UC1 is what the scanner already does and what the market has
commoditized; UC2 is where a fleet product is structurally advantaged; UC3 is the reach engine.
UC3 feeds UC2 (adoption + outcome signal), UC2 feeds UC1 (the practices that lift a repo travel
as skills), UC1 grounds UC3 (a developer's sessions are read against the gaps of the repos they
touch).

Current state per job (2026-08-17 ground truth): UC1 mature - the whole scan pipeline
(`src/lib/scan.ts`, `analyze/**`, rubric r7, D1-D9, L1-L5), practice apply + PRs, the `.ai/`
foundation PR, gate API, passport. UC2 has the schema half (OrgSkill library, versioned push,
`scripts/ascent-skills.mjs` drift, frontmatter contract, Org Memory) but the `invoke` event was
retired 2026-07-29 and no LLM lane exists yet (Phase E below is the expected call site). UC3 has
`Organization.kind = personal`, `/me`, anti-surveillance floors (`champions.ts`,
`CHAMPION_MIN_POP=3`) and no LLM lane yet (the mentor is the expected call site).

## B. Use-case hard checks

- **UC3 - privacy (enforced under Lens A, never waived by a good output):** no developer
  transcript content in prompts, logs or telemetry unless the developer chose it. Telemetry
  carries counts and shapes only (`skill, version, repo, event, ts`); per-person attribution is
  off by default; `share` is explicit; hook events carry no prompt content. Any prompt, capture
  or eval log that carries transcript text without an explicit choice is a `use_case: UC3`,
  `type: trust` finding at the top of the backlog.
- **UC2 - frontmatter preserved by construction:** a tailored / generalized skill keeps
  `category / memory / version` verbatim; a tailoring prompt that can rewrite them is a
  `use_case: UC2` finding regardless of how good the body reads.

## C. Expected kills (call sites the jobs imply; the code does not have them yet)

- [[_expected/tailored-adopt]] - UC2 (Phase E) - rewrite a generic skill's assumptions into
  *this* repo's real commands, paths and domain (or generalize a repo skill for the registry);
  delivered as a PR to the target repo (`POST /api/org/skills/:name/tailor?repo=`), never a
  silent file write. The second LLM call site in the product. Bar written in the note.
- [[_expected/mentor]] - UC3 - the `/mentor` skill's reflection (`intake` / `retro` / `weekly` /
  `moves`): grounding = the developer's journal + the repo report via MCP + the registry's
  `catalog.json`; senior bar = a good staff-engineer mentor. Bar written in the note.

When either lands in code, `/tiger scan` graduates the note into `engine/` and the first run
diffs against the bar instead of starting cold.

## D. Discovery (what counts as a call site here)

- Today exactly one call site: `src/lib/scan.ts:206` (`attemptAssess -> provider.assess`),
  prompt `src/lib/scoring/prompt.ts:63` (`buildAssessmentPrompt`), contract
  `src/lib/llm/schema.ts` -> `validateAssessment` (`src/lib/llm/provider.ts:101`). Providers:
  claude-cli (dev), gemini (MVP / public), bedrock (enterprise), openai, mock (floor).
- Grep set for new sites: the provider abstraction `assess(` in `src/lib/llm/**`, plus the
  generic list (`@anthropic-ai`, `@google/genai`, `@aws-sdk/client-bedrock`, `openai`). Exclude
  `**/*.test.ts`, fixtures, the mock provider.
- Expected next: the UC2-E tailor route and the UC3 mentor skill (above).

## E. Model-invocation recipe, fixtures, price basis (Lens C)

- Recipe: in this sandbox the only live engine is `claude-cli` (shells out to a local `claude`
  binary; 30-130 s per call); the harness cannot vary the thinking budget
  (`LLM_THINKING_BUDGET` env exists, Bedrock-wired, opt-in). gpt-4o-mini / gemini-3-flash /
  gpt-4o rows need keys - not run as of 2026-06-20; the public tier (`gemini-3-flash`) is still
  UNVERIFIED and predicted ~ haiku - run it live before trusting the public tier.
- Fixtures: `sessions/2026-06-20-tiger-benchmark/input/{fixture.json,system.txt,user.txt}` -
  the fixed repo snapshot with a planted detector miss (D2) the discrepancy audit must catch;
  blind candidates under `blind/`, outputs under `out/`.
- Price basis: `src/lib/llm/config.ts:39-55` (`MODEL_PRICES`, USD per MTok; negotiated
  `LLM_*_COST_PER_MTOK` envs override) -> snapshot 2026-06-12 in [[models]]. Per-scan list-price
  cost measured 2026-06-20: haiku ~$0.011 . sonnet ~$0.032 . opus ~$0.054.
- Backlog / drain homes: `tiger/backlog.md` (the deliverable); ship-loop's golden ledger tags
  every item `UC1|UC2|UC3|hyg`, so Tiger's `use_case` ids line up with it by construction.

---

## F. One-line additions for `MOC.md`

```
## Jobs (the value frame)
- [[README#Jobs / use cases]] - UC1 standardize . UC2 share & improve skills . UC3 individual care; judges per job in [[_roster]].
## The engine (memorized LLM call sites - "the kills")
- [[scan-assess]] - (unchanged) - `use_case: UC1`
- [[_expected/tailored-adopt]] - UC2 (Phase E) - expected, not built; bar written ahead of the code.
- [[_expected/mentor]] - UC3 - expected, not built; bar written ahead of the code.
```

## G. Frontmatter addition for `engine/scan-assess.md`

```
use_case: UC1        # primary; also read by UC3 (repo gaps) - findings about that path tag UC3
```
