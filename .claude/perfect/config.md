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
- (migrate the existing entries from `$VAULT/Perfect/config.md` on the first 2.3 run, then append here)
