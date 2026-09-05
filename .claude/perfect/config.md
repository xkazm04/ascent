---
product: "ascent"
stack: "a product that scores how AI-native a repository/org is (Next.js 16.3.0-preview.5 + React 19 + TS + Tailwind 4 + Prisma with embedded PGlite in dev; vitest for unit tests)"
vault: ["C:/Users/mkdol/Documents/Obsidian/ascent", "C:/Users/kazda/Documents/Obsidian/ascent"]  # Fox, Wolf - first existing wins; each device keeps its own vault
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

First run: create the vault root for THIS device (Fox: `C:/Users/mkdol/Documents/Obsidian/ascent`, Wolf: `C:/Users/kazda/Documents/Obsidian/ascent`) - the user keeps per-project vaults there. The vaults are per-device and not synced; a session on one device does not see the other's loop state.
Builds fork from and land on `master` - if the session starts on a stray branch, note it and base the
wave on `master`. `round_shape: round`: propose for 1-3 contexts, gate, build that slate immediately
(the owner can say "hold" at the wave-plan gate); thin slates of 1-3 keep winning here.

Context-map keys in this repo: `filePaths`, `apiRoutes`, `description`. If a direction changes which
files a context owns, update `context-map.json` to match (Director, Class C).

## Gates
- always: `npx tsc --noEmit`, `npm test` (vitest; scope with a path when targeted), `npm run lint`
- when any `.tsx` touched: the AGENTS.md 300-LOC `.tsx` check
- slow: none
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

## Skill improvement log
- 2026-09-05 (Fox, round 1): the tsc gate was blind at dispatch - a stale generated Prisma client (572 errors) and two missing packages (`server-only`, `libsodium-wrappers`) made every builder report "errors outside my write set". Run `npx prisma generate` + `npm install` and drop stale `.next/dev/types` BEFORE dispatching builders; a green base gate is a Phase 0 ritual here.
- 2026-09-05: the registry-map `deviation` pairs were the whole slate (9/9 directions) and 8/9 were accepted - keep mining `.ai/registry-map.json` first; the three remaining deviations (Quotas & Rate Limiting, Repo Report Shell, Onboarding Wizard) are round 2.
- 2026-09-05: docs made Director-only for the wave worked (two audit lots would have collided on org-intelligence.md); keep that rule while lots share a doc.
- 2026-09-05 (round 2): a builder died at its FULL gate with a complete direction on disk. Salvage was cheap (Director ran the gate, fixed 3 lint errors, committed) - but the brief should say: targeted gates -> commit -> THEN the full gate, so death at the gate never strands a finished direction.
- 2026-09-05 (round 2): 9/9 accepted; the report-shell 402 dead end that round 1 created was the headline - "if your wave creates an overstatement, your wave corrects it" held. Remaining deviation pairs in the registry map: none; round 3 must score from headroom, not from the map.
- 2026-09-05 (round 3): 11/11 accepted with the map's deviations exhausted - scoring from scout residuals + docs Known gaps works; the biggest finding (a persisted false negative in D9 on a failed sensor read) came from asking the scout "is a FAILED read distinguishable from an empty one, per sensor".
- 2026-09-05 (round 3): a wave's own change opened a same-page divergence (badge vs header chip); the builder scoped it out, the Director landed it in-wave (309f65ec). If the wave creates it, the wave corrects it.
- 2026-09-05 (round 3): a builder refuted a direction's premise with a measurement (deployments already overlapped) - keep demanding measured deltas. A change to what the detectors SEE is the product owner's rubric call: asked at the gate, bumped r17.
- 2026-09-05 (round 3): `git switch <base>` aborted at landing because a sibling session had dirty files that differ between base and wave (src/lib/types.ts). Land with `git branch -f master HEAD` (ff) then switch - identical commits touch no files. Never `git checkout -f`.
- 2026-09-05 (round 4): a foreign session's dirty file (src/lib/types.ts) blocked one criterion mid-wave (the analyzer revertRate floor); the builder stopped correctly. Treat every dirty foreign file as a hard write-set wall in the brief AND pre-check each direction's write set against `git status` before dispatch - this one was avoidable at planning time.
- 2026-09-05 (round 4): never edit a template literal with sed; a dropped backtick shipped a broken test in a Director commit and cost a repair commit. Use the python replace-with-assert pattern for every code edit.
- 2026-09-05 (round 4): a sibling session bare-commits onto whatever branch is checked out (aef6a59b landed on the wave branch). Harmless for a ff-merge, but the wave branch is not private; review `git log master..HEAD` for foreign commits before merging.
- 2026-09-05 (round 5): pre-checking write sets against the foreign dirty set at PLANNING time deferred one direction cleanly (the narrative seam) and nothing blocked mid-wave - keep it. The deferred direction sits in the pool; build it the moment src/lib/llm is clean.
- 2026-09-05 (round 5): the honesty work in this repo lands on the durable artifacts (PDF, markdown) first and the HTML surfaces lag a cycle - "composer has exactly one caller" is the grep that finds it (benchmarkCaption, movementLine). Use it as a standing scout question on any context with several renderers of one model.
- 2026-09-05 (round 5): a public endpoint that never carries a token can advertise policy flags that can never fire there (the gate); ask scouts "which criteria are unconditionally inert on this surface" for every gate/policy context.
- 2026-09-05 (round 6): a test harness rewrote .git/config mid-wave (core.bare=true, a fake user.*), breaking plain git for one builder and mis-attributing one commit. Add to Phase 0 AND to the pre-merge check: `git config --local --get core.bare` must be false and `git log --format=%an base..HEAD` must show only real authors; a harness that shares the checkout is a write-set hazard for .git itself.
- 2026-09-05 (round 6): a builder's evidence-backed refusal of a one-line criterion (page.tsx owner->admin) was right - the criterion flattened two routes with two bars into one flag. When a builder refuses with a mechanism-level argument, the Director redesigns the criterion, not the builder.
- 2026-09-05 (round 6): "shipped but half-mounted" is this repo's dominant residual class (lift map: two transports, zero readers; firstStep on the fallback only; decline PATCH with no caller; unenforceable[] MCP-only). Scout prompt line: for every mechanism, name EVERY renderer/consumer and which ones actually receive it.
- 2026-09-05: `db/client.test.ts` fails on this device on an AWS-credential message ("Your session has expired") - environmental, ignore in the gate unless client.ts was touched.
