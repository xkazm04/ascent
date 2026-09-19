---
product: "ascent"
stack: "The maturity index for AI-native engineering — Next.js 16.3.0-preview.5 + React 19 + TypeScript + Tailwind 4 + Prisma (embedded PGlite in dev), vitest for unit tests, Playwright for e2e"
vault: ["C:/Users/kazda/Documents/Obsidian/ascent"]
vault_subdir: Architect
context_map: context-map.json
coverage_context_source: ".personas/contexts.txt"
base_branch: master
worktree_root: .claude/worktrees
active_runs_ledger: ""
---

# architect overlay — ascent

Sibling overlays: `.claude/perfect/config.md` (build loop), `.claude/spark/config.md`,
`.claude/ship-loop/config.md`. This one carries only what `/architect` needs; where they overlap
(repo law, gates, smoke) the wording is kept aligned deliberately.

The vault is the per-project Obsidian folder at `C:/Users/kazda/Documents/Obsidian/ascent`, alongside
`Perfect/`, `Spark/` and `Scan/`. `Architect/` is this skill's namespace inside it.

## Context sources
- `context-map.json` — the authority for area scope and target file lists (11 groups, 52 contexts;
  keys are `filePaths`, `apiRoutes`, `description`). Generated 2026-08-04, revision `ecad2b58`.
- `AGENTS.md` — the repo rules file (imported by `CLAUDE.md` via `@AGENTS.md`). Carries the 300-LOC
  `.tsx` cap, the 200-LOC `src/features/**` cap, the `src/features/<group>/<tab>/` mirror rule, the
  doc-sync map and the Stop hook.
- `src/components/ui/BRAND.md` — the design system ("The Index"): one azure accent on cold ink,
  hairline rules, mono tabular-nums metrics.
- `docs/ARCHITECTURE.md` and `docs/features/<area>/` — the implemented-product docs surface.
- Coverage names: `.personas/contexts.txt` when present; fall back to the context-map name.

## Area menu
1. Repository Scanning & Scoring — `src/lib/scan.ts`, `src/lib/analyze/**`, `src/lib/scoring/**`, `src/lib/maturity/**`, `src/lib/llm/**`, `src/app/api/{scan,gate}/**`
2. Org Dashboard & Analytics — `src/app/org/**`, `src/components/org/**`, `src/features/{standing,admin,bought}/**`, `src/lib/org/**`
3. Reporting & Visualization — `src/app/report/**`, `src/components/report/**`, `src/lib/report/**`, `src/features/standing/passports/**`
4. Org Planning & Execution — `src/lib/scoring/orgsim.ts`, `src/features/inflight/live/**`, `src/features/bought/executive/**`
5. Org Knowledge & Skills — `src/lib/memory/**`, `src/lib/org/skill-*.ts`, `src/lib/db/org-{memory,skills,api-tokens}*.ts`, `src/features/shared/**`
6. Identity & GitHub Connectivity — `src/lib/{auth,access,authz}.ts`, `src/lib/github/**`, `src/lib/supabase/**`, `src/app/api/{auth,app}/**`
7. Data & Persistence — `prisma/schema.prisma`, `src/lib/db/**`, `src/lib/db/retention.ts`
8. Onboarding, Shell & AI Standard — `src/components/onboarding/**`, `src/app/launch/**`, `src/lib/standard/**`, `src/app/connect/**`

Free text (option 1) still falls through to the resolver against the full 52-context map.

## Gates
- `baseline:` `npx tsc --noEmit`, `npm run lint`, `npm test`
- `step:` `npx tsc --noEmit`, targeted `npx vitest run <path>`, `npm run lint`
- `final:` `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`
- `slow:` `npm run build` (background), `npm run test:e2e` (only when a rollout touches a
  Playwright-covered flow)

Two gate traps this repo has actually hit:
- **`tsc` + vitest can both pass while `npm run build` fails** on a client/server boundary break. Any
  rollout that moves code across `"use client"` runs `npm run build` before it is called shipped.
- Run `npx tsc --noEmit` again after any build that rewrites generated types (`prisma generate`).

When any `.tsx` is touched, also run the AGENTS.md LOC checks (300 repo-wide, 200 under
`src/features/**`) — they are a gate here, not a style note.

## Repo law
Authority: `AGENTS.md` + `src/components/ui/BRAND.md`.
- **This is NOT the Next.js you know** — 16.3.0-preview.5. Read the relevant guide in
  `node_modules/next/dist/docs/` before writing Next-specific code; heed deprecation notices.
- **300 LOC per `.tsx`** repo-wide; **200 LOC per file under `src/features/**`** (`.ts` included).
  If an edit would push a file over, extract co-located siblings FIRST — never commit an over-limit
  file. Extraction is pure relocation, not a redesign; add `"use client"` to an extracted file that
  uses hooks or handlers, and never to one that doesn't.
- **`src/features/<group>/<tab>/` mirrors the nav** (`ORG_NAV_GROUPS` / `ORG_TAB_IDS` in
  `src/lib/org/orgTabs.ts`). Nothing in a feature group imports from another group;
  `components/org/shared` is imported BY features, never the reverse.
- **Brand**: import primitives from `@/components/ui` (Surface, Kicker, Stat, SectionHeading,
  HairlineGrid, Dateline, Modal) and org chrome from `@/components/org/ui` (Tile, TILE_LEDGER,
  OrgTable, Meter). Level/score color ONLY via `LEVEL_HEX`/`scoreHex` from `@/lib/ui` — never a
  hand-picked hex. Motion degrades under `prefers-reduced-motion`.
- **Doc-sync (Stop-hook enforced)**: a user-visible change updates its mapped doc under
  `docs/features/<area>/` in the same turn — `scripts/docs/feature-doc-map.json` is the map. When you
  close a gap, DELETE the "Known gap" that described it. Internal-only changes are dismissed with one
  sentence.
- **Shared-tree git hazards** (parallel sessions share this checkout): never `git stash`,
  `git reset --hard`, `git checkout --`, or `git add -A/./-u`. Commit with pathspecs
  (`git commit -- <paths>`), and verify `git diff --cached --stat` before every commit.
- `docs/archive/**` is append-only — never edited to look current.

## Docs vehicles
- `AGENTS.md` — repo-wide conventions every session loads (the LOC caps and the features-tree rule
  already live here). A convention humans must obey in every session goes here.
- `docs/ARCHITECTURE.md` — module boundaries, engine internals, cross-cutting structure.
- `docs/features/<area>/*.md` — behavior of one implemented feature area (hook-enforced; not the place
  for a repo-wide convention).

## Lint vehicle
`eslint.config.mjs` is flat config composing `eslint-config-next` core-web-vitals + typescript, with a
`globalIgnores` for `.claude/worktrees/**`. **There is no custom-rule mechanism in this repo** — no
rules directory, no local plugin. A code-shape codification therefore defaults to `test-guard`
(cheaper here than standing up a plugin); propose a lint plugin only when the pattern is worth the new
dependency, and say so explicitly.

## Test guard vehicle
`vitest` (`npm test` / `npx vitest run <path>`); tests sit **beside** the code they guard
(`src/lib/db/branding.test.ts`, `src/features/standing/passports/passportBlockerAgg.test.ts`).
For a tree-walking structural invariant the established shape is a `scripts/` node checker with its own
dependency-free test harness — see `scripts/docs/check-doc-sync.mjs` +
`scripts/docs/__tests__/check-doc-sync.test.mjs` (231 assertions), wired as a Stop hook in
`.claude/settings.json`. Prefer that shape for cross-file invariants, and a co-located vitest test for
single-module ones.

## Smoke
- `npm run dev` boots the app against the embedded in-process PGlite DB (instrumentation-loaded; a CLI
  `DATABASE_URL` does NOT override it). Seed with `node scripts/seed-scans.mjs` + `seed-org.mjs` when
  empty. `LLM_PROVIDER=claude-cli` for live scans (~6 min median — do not block a rollout on one).
- The dev port is volatile: probe candidate ports for an "Ascent" `<title>` rather than assuming 3000.
- Plan B without a browser: SSR `curl` of the touched routes, grepping for the surface's markers — and
  say plainly that the interactive half was NOT visually verified.

## Baseline exclusions
- `.claude/worktrees/**` — live agent checkouts of this same repo; findings there are duplicates of
  `src`, never their own finding (this is why eslint ignores them).
- `docs/archive/**` and `docs/harness/**` — point-in-time records and gitignored scan output.
- `src/generated/**`, Prisma client output, `next-env.d.ts` — generated.
- The dormant custom OAuth path superseded by Supabase auth — known-dead, not a finding.
