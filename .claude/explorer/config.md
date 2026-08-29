---
product: "ascent"
stack: "The maturity index for AI-native engineering — Next.js 16.3.0-preview.5 + React 19 + TypeScript + Tailwind 4 + Prisma (embedded PGlite in dev), vitest for unit tests, Playwright for e2e"
vault: ["C:/Users/kazda/Documents/Obsidian/ascent"]
vault_subdir: Explorer
context_map: context-map.json
coverage_context_source: ".personas/contexts.txt"
active_runs_ledger: ""
---

# explorer overlay — ascent

Sibling overlays: `.claude/architect/config.md` (heavy structural scan), `.claude/perfect/config.md`,
`.claude/spark/config.md`, `.claude/ship-loop/config.md`. This one carries only what `/explorer`
needs; where they overlap (repo law, gates, smoke, baseline exclusions) the wording is kept aligned
with the architect overlay deliberately — the two skills sweep the same codebase and must not
disagree about its law.

**Division of labour:** `/explorer` is the daily 10-item wander that lands small fixes in-session;
`/architect` is the heavy structural pass that writes ADR-style decisions to a backlog. An item that
wants a new module boundary, a schema migration or a cross-area refactor is not an explorer item —
defer it and name `/architect` as the vehicle.

The vault is the per-project Obsidian folder at `C:/Users/kazda/Documents/Obsidian/ascent`, alongside
`Architect/`, `Perfect/`, `Spark/` and `Scan/`. `Explorer/` is this skill's namespace inside it;
`Lessons/` and `Patterns/` are shared with the other skills.

## Context sources
- `context-map.json` — the area taxonomy: **11 groups, 55 contexts**, repaired 2026-08-29. Keys are
  `filePaths`, `apiRoutes`, `description`. Phase 2a resolves hints against the full 55-context set.
  It is **hand-maintained** despite the vibeman `$schema`/`projectId` — there is no regenerate command,
  and git history shows contexts renamed and added in ordinary feature commits. Check it with
  `node scripts/context-map/check-map-drift.mjs` (`--list` to name the unmapped files); it fails on a
  dead path, a dead route, or unmapped source above a 10% budget. ~7% of source is deliberately
  unmapped: shared modules in `src/lib/db/` and `src/lib/org/` that a dozen contexts each draw from,
  where forcing a single owner would make the map less true, not more.
- `AGENTS.md` — the repo rules file (imported by `CLAUDE.md` via `@AGENTS.md`). Carries the 300-LOC
  `.tsx` cap, the 200-LOC `src/features/**` cap, the `src/features/<group>/<tab>/` mirror rule, the
  doc-sync map and the Stop hook.
- `src/components/ui/BRAND.md` — the design system ("The Index"): one azure accent on cold ink,
  hairline rules, mono tabular-nums metrics. Read this before any `ui` item.
- `docs/features/<area>/*.md` — the implemented-product docs surface, and the doc a user-visible
  change must update in the same turn.
- Coverage names: `.personas/contexts.txt` (this repo IS Personas-managed — a `.personas/` directory
  exists). The context map's names and that file agree here; anchor memory nodes to `contexts.txt`.

## Area menu
1. Repository Scanning & Scoring — `src/lib/scan.ts`, `src/lib/analyze/**`, `src/lib/scoring/**`, `src/lib/maturity/**`, `src/lib/llm/**`, `src/app/api/{scan,gate}/**`
2. Org Dashboard & Analytics — `src/app/org/**`, `src/components/org/**`, `src/features/{standing,admin}/**`, `src/lib/org/**`
3. Org Planning & Execution — `src/lib/scoring/orgsim.ts`, `src/features/inflight/live/**`, `src/features/bought/**`
4. Reporting & Visualization — `src/app/report/**`, `src/components/report/**`, `src/lib/report/**`, `src/features/standing/passports/**`
5. Org Knowledge & Skills — `src/lib/memory/**`, `src/lib/org/skill-*.ts`, `src/lib/db/org-{memory,skills,api-tokens}*.ts`, `src/features/shared/**`
6. Identity & GitHub Connectivity — `src/lib/{auth,access,authz}.ts`, `src/lib/github/**`, `src/lib/supabase/**`, `src/app/api/{auth,app}/**`
7. Data, Billing & Metering — `prisma/schema.prisma`, `src/lib/db/**`, `src/lib/{plans,polar,entitlement}.ts`, `src/lib/db/usage.ts`, `src/lib/rate-limit.ts`
8. Onboarding, Shell & Marketing — `src/components/onboarding/**`, `src/app/launch/**`, `src/lib/standard/**`, `src/app/connect/**`, `src/components/{landing,deck}/**`

Eight menu slots over eleven map groups: *Org Scanning & Fleet Rollups* resolves under 2,
*Billing, Credits & Metering* under 7, *Marketing Site & Design System* under 8. Free text
(option 1) still falls through to the resolver against all 52 contexts, so any group is reachable
by name.

## Category menu
The built-in eight only (`quality | dx | ui | perf | bug | i18n | a11y | sec`). Note that **`i18n`
is a near-empty lane here** — ascent ships a single English locale with no catalog and no
`tokenLabel()`-style indirection, so an `i18n` filter will legitimately come up short. Prefer `ui`
or `quality` unless you are deliberately probing for a localization seam.

## Gates
Run what the item touched, not the whole battery — this is the daily loop, not a milestone:

- Any `.ts`/`.tsx` edit: `npx tsc --noEmit`
- Any edit: `npm run lint` (flat config, `eslint`). Measured 2026-08-29: **0 errors, 36 warnings**,
  all `no-unused-vars`/unused-disable in files nobody is touching. That is the baseline — hold it.
  A new warning in a file YOU touched is a failure; check with `npx eslint <paths you edited>`
  rather than reading the repo total, which moves under you when a parallel session is committing.
- A file with a co-located test, or a `src/lib/**` module: `npx vitest run <path>`
- Before calling a multi-item run done, or after any edit that crosses `"use client"`:
  `npm run build`

Two gate traps this repo has actually hit:
- **`tsc` + vitest can both pass while `npm run build` fails** on a client/server boundary break
  (see the `build-not-in-gate` memory). Any item that moves code across the client/server line runs
  `npm run build` before it is called done. The fix pattern is a pure module + a `-load.ts` sibling.
- Re-run `npx tsc --noEmit` after any build that regenerates Prisma types (`prisma generate` runs on
  `postinstall` and `db:push`).

When any `.tsx` is touched, also run the AGENTS.md LOC checks (300 repo-wide, 200 under
`src/features/**`) — they are a gate here, not a style note. The repo is currently at **zero** files
over either cap; an explorer item must not be what breaks that.

## Repo law
Authority: `AGENTS.md` + `src/components/ui/BRAND.md`.

- **This is NOT the Next.js you know** — 16.3.0-preview.5. Read the relevant guide in
  `node_modules/next/dist/docs/` before writing Next-specific code; heed deprecation notices.
- **300 LOC per `.tsx`** repo-wide; **200 LOC per file under `src/features/**`** (`.ts` included,
  tests included). If a fix would push a file over, extract co-located siblings FIRST — never commit
  the over-limit file. Extraction is pure relocation; add `"use client"` to an extracted file that
  uses hooks or handlers, and **never** to one that doesn't (that drags a server panel across the
  boundary).
- **`src/features/<group>/<tab>/` mirrors the nav** (`ORG_NAV_GROUPS` / `ORG_TAB_IDS` in
  `src/lib/org/orgTabs.ts`). Nothing in a feature group imports from another group;
  `components/org/shared` is imported BY features, never the reverse.
- **Brand**: import primitives from `@/components/ui` (Surface, Kicker, Stat, SectionHeading,
  HairlineGrid, Dateline, Modal) and org chrome from `@/components/org/ui` (Tile, TILE_LEDGER,
  OrgTable, Meter). Level/score color ONLY via `LEVEL_HEX`/`scoreHex` from `@/lib/ui` — never a
  hand-picked hex. Motion degrades under `prefers-reduced-motion`. Check the catalog before calling
  a primitive missing: a hand-rolled duplicate of an existing one is the `ui` finding, not a reason
  to write a second.
- **Three safety conventions AGENTS.md states as law** — treat a violation as a `sec`/`bug` item,
  never "re-tidy" one into a different shape:
  - a dangerous env flag reads its `NODE_ENV === "production"` floor **inside its own definition**
    in `src/lib/env.ts`, never at the call site;
  - an `[id]` API route authorizes against the row's org (resolve-then-gate, or
    gate-then-constrain) — guarded by `src/app/api/org/id-routes-gated.test.ts`;
  - a db type that crosses to a client never declares a `Date` — guarded by
    `src/lib/db/wire-safe-dates.test.ts`.
- **Doc-sync (Stop-hook enforced)**: a user-visible change updates its mapped doc under
  `docs/features/<area>/` in the same turn — `scripts/docs/feature-doc-map.json` is the map. When an
  item closes a gap, DELETE the "Known gap" that described it. An internal-only item is dismissed
  with one sentence naming why. Budget for this: it is part of the item's effort, not overhead.
- **Shared-tree git hazards** (parallel sessions share this checkout): never `git stash`,
  `git reset --hard`, `git checkout --`, or `git add -A` / `.` / `-u`. Stage explicit pathspecs and
  verify `git diff --cached --stat` in the SAME invocation before committing; a cached stat listing
  files you did not add means another session pre-staged into the index — `git restore --staged` each
  one and re-verify.
- `docs/archive/**` is append-only — never edited to look current.

## Baseline exclusions
- `.claude/worktrees/**` — live agent checkouts of this same repo. A finding there is a duplicate of
  `src`, never its own item (this is why eslint ignores the tree).
- `docs/archive/**` (point-in-time records) and `docs/harness/**` (gitignored scan output).
- `src/generated/**`, the Prisma client output, `next-env.d.ts` — generated.
- The dormant custom OAuth path superseded by Supabase auth — known-dead, not a finding.
- **No lint-baseline MIGRATION exists here.** The 36 standing warnings are scattered unused-vars,
  not a declared migration, and there is no Tailwind-class or string-extraction backlog — so the
  skill's usual "don't surface the baseline" exclusion has nothing to bite on. Don't file the 36 as
  an item either; they are noise, not a wave.

## Smoke
- `npm run dev` boots against the embedded in-process PGlite DB (instrumentation-loaded; a CLI
  `DATABASE_URL` does NOT override it). Seed with `npm run db:local:seed` + `node scripts/seed-org.mjs`
  when empty. `LLM_PROVIDER=claude-cli` for live scans (~6 min median — never block an item on one).
- The dev port is volatile: probe candidate ports for an "Ascent" `<title>` rather than assuming 3000.
- Plan B without a browser: SSR `curl` of the touched route, grepping for the surface's markers — and
  say plainly that the interactive half was NOT visually verified.

## Skill improvement log

_(dated one-liners, appended by Lane 1 of the skill's reflection)_

- 2026-08-29 — **A path-scoped commit is not enough on this checkout.** A parallel `/scan-sweep`
  session ran `git add` broadly between my edit and my commit, and my BOM fix landed inside ITS
  commit (`4dd9fc1e`); my own `git commit -- <path>` then found nothing to commit and silently
  committed someone else's staged work instead. Edit and commit in the SAME invocation, and verify
  with `git log -1 --format=%h -- <path>` that the change landed in YOUR commit. Sibling hazard to
  the ones in `never-reset-hard-shared-tree`, but the inverse direction: not clobbering theirs,
  losing yours.
- 2026-08-29 — **Read the comments to pick the file.** `client.ts`, `retention.ts` and
  `scans-read.ts` carry finding-numbered annotations from prior scan-sweep/architect passes
  (`database-client-schema #1`, `data-retention 07-16 #2`), and every candidate formed against them
  died on verification. `kpi-metrics.ts` and the erasure UI carry none, and produced 9 of 10 items.
  Dense prior-finding comments are a "swept, move on" marker; their absence is where the yield is.
- 2026-08-29 — **Cross-read the UI against its resolver.** The best finding of the first sweep
  (the erasure dialog promising destruction where `resolveAuditDisposition` returns `"redact"`)
  was invisible in either file alone; both are internally consistent. Ask what the UI *claims* the
  server does, then read the server's default.
- 2026-08-29 — `context-map.json` was 266 commits stale (generated 2026-08-04). Regenerate it
  before relying on the area menu's file lists.
- 2026-08-29 (run 2, Org Knowledge & Skills) — **grep for the defect SHAPE before reading files.**
  Four of ten items came from one-line greps across the area (`role="status"` adjacent to error text;
  `useEffect` + its dep array; the prior-finding-annotation density check) rather than from reading
  files end to end. Read whole files only for what the greps flag.
- 2026-08-29 (run 2) — **the modal verb about a CONSUMER is this repo's richest tell.** Four findings
  were a rule a module states in careful prose and does not enforce one layer out, and each announced
  itself the same way: a doc comment saying what a *consumer* must do ("a consumer that shows the
  number must show this beside it", "the term is named for what it measures"). Every such sentence is
  a claim about code the module cannot see. Grep for that phrasing and then go check the consumer.
- 2026-08-29 (run 2) — **read the caller before changing a status code.** I made an idempotent DELETE
  404 on no-match "for symmetry with POST"; `SkillCard.unadopt` rolls its optimistic removal back on
  `!res.ok`, so that would have restored a chip for an adoption the DB does not have. Caught before
  the commit, but only because I happened to look.
- 2026-08-29 (run 2) — a full `npm test` can fail on work that is not yours: a concurrent session was
  mid-edit in `src/lib/standard/**`. Prove it with `git show --name-only` over your own commits rather
  than asserting it, and report the failures instead of chasing them.
