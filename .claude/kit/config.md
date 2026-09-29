---
product: "ascent"
vault: ["C:/Users/kazda/kiro/ascent/.contest"]
vault_subdir: Kit
features_root: src/features
entry: ""                      # multi-entry app: the instrument reads the entry LIST from .claude/kit/kit.json
aliases: "@=src"
kit_path: ""                   # empty -> setup track not finished (S6 promotes the kit)
doctrine: ""
batch_builders: 5
contest_seats: "claude:claude-opus-5-5@xhigh,claude:claude-sonnet-5-5@max"
---

# kit overlay - ascent

**State on 2026-09-29: setup track IN PROGRESS (see `Kit.md` in the vault for the phase).** What exists: this overlay, `.claude/kit/kit.json`
(instrument config, verified: reachability walks 1,840 files from the app routes, divergence ranks
29 feature modules), the `kit` skill linked from the registry, and the brand foundation seed
`docs/design/BRAND-PRISM.md`. A session invoking `/kit init` starts at S0.

**The campaign's job:** redesign every route of the app so it reads as ONE product with the brand
the owner chose on 2026-09-29 (contest `landing-brand`, winner A/1 "Prism"), composed from a
composition kit rather than restyled module by module. The landing (`/?landing=prism`) is the
first ported surface and the visual reference; the kit contest (S5) must quote it as law.

## Gates

- `npm run typecheck`, `npm run lint`, `npx vitest run <path>` (scope it; the full suite is slow)
- `npm run build` is NOT in the gate but catches client/server boundary breaks tsc misses (memory:
  build-not-in-gate): run it before any promotion.
- `npm run copy:check` (English copy), `npm run check:contracts`
- LOC caps from AGENTS.md: `.tsx` <= 300 everywhere, every file under `src/features/**` <= 200.
  Extraction is pure relocation; a kit part that would push a file over the cap is split first.
- Doc-sync Stop hook: user-visible feature edits need `docs/features/<area>/` updated in the same
  turn (see AGENTS.md map). A redesign is user-visible: every batch updates its feature doc.

## Instruments

- Divergence: `node ../ai-registry/skills/kit/scripts/style-divergence.mjs --repo . --config .claude/kit/kit.json --out <vault>/Kit/inventory`
- Reachability: `node ../ai-registry/skills/kit/scripts/reachability.mjs --repo . --config .claude/kit/kit.json`
  (Next.js app: every `page|layout|loading|error|not-found.tsx` under `src/app` is an entry; the API
  routes are not, they render nothing.) Both scan `src/features/**` only. `src/components/**`
  (shell, shared, report, deck, landing, ui) is UI too and is measured as the system layer
  (`systemPrefix: components/`); a batch that touches `components/report` or `components/org` must
  add it to the ledger by hand at S0.
- **Integrated-page shooter (built 2026-09-29):** `node scripts/kit/shoot.mjs --base http://localhost:3002
  --themes altimeter,prism --sizes 1280x800,1920x1080,1440x3200 --routes "/org/kiro?tab=live" --out <dir>`.
  Real route in the real shell, per theme (stored via localStorage `ascent-theme`; `?theme=prism` also
  works), dismisses the setup drawer, exits 1 on page/console errors or an empty mount. It refuses
  port 3000 (**another product, KandiDate, lives there**). Only ONE `next dev` can run per checkout:
  if it says a server exists, use the URL it prints (3002 on 2026-09-29) instead of starting another.
  The data tape is the seeded local DB (org `kiro`: repos kp, systedo-case; `scripts/seed-org.mjs`):
  before/after pairs use the same DB, so a delta is code unless the DB moved.
- Visual pass and style-contract capture/check live in the contest skill:
  `.claude/skills/contest/scripts/visual-pass.py`, `style-contract.py`.

## Repo law

Pasted into every builder brief (source: AGENTS.md; re-read it, do not trust this digest's age):

- This is a Next.js with breaking changes: read the relevant guide in `node_modules/next/dist/docs/`
  before writing route code. Server pages stay server; add `"use client"` only where hooks/handlers
  live, never to a pure panel.
- Client structure mirrors the nav: `src/features/<group>/<tab>/`; `src/components/org/shared/`
  may not be imported from a feature group (the dependency only runs the other way).
- Wire types never declare `Date`; escape-hatch flags carry their production floor inside their
  own definition; `[id]` routes authorize against the row's org.
- Git: commit on the current branch, never push, never stash or reset in the shared tree, commit
  with pathspecs (`git commit -m ... -- <paths>`).
- Copy: English source copy passes `copy:check`; no em dashes (`scripts/check-em-dashes.mjs`).

## Visibility order

Provisional, from the nav and the landing's own promise; the owner confirms it at S1.

1. Public front door: `/` (landing, Prism), `/launch`, `/pricing`, `/leaderboard`, `/about`, `/about-org`
2. The reading itself: `/report`, `/report/[owner]/[repo]`, `/report/compare`, `/scorecard/[owner]`
3. Org dashboard, by nav group (`src/lib/org/orgTabs.ts` `ORG_NAV_GROUPS`): standing (overview,
   repositories, tech-stacks, passports, security, adoption, governance), shared (registry,
   practices, skills, memory), inflight (live, proposals, lessons), bought (executive, delivery,
   contributors, teams), admin (members, integrations, audit, settings)
4. Personal and operator: `/me`, `/org/developer`, `/usage`, `/trends`, `/portfolio`, `/onboarding`,
   `/theater/[slug]`
5. Legal and token pages last: `/privacy`, `/terms`, `/invite/[token]`, `/share/briefing/[token]`,
   `/live/shared/[token]`

## Taste

Carried in from the landing contest (owner words, 2026-09-29 and the contest ledger):

- Chose **A/1 Prism** over three other directions: a signature graphic that IS the scoring model
  (nine lines = nine dimensions, line width = weight). Take that as the test for every surface: the
  brand graphic should carry meaning from the data, never decorate it.
- From the contest overlay, still binding: **honesty over drama** (unknown shown as unknown, a stale
  feed looks stale, illustrative art labelled `Illustrative`/`Stylised`) and **practical before
  spectacular** (dense org tabs are working surfaces: levels, not one layer; body text
  comfortable; heavy content on its own surface).
- Open question for S2, do not decide alone: how much of the landing's poster-scale expression
  survives into dashboards. The landing scales on a fixed 16:10 frame (`--U`); dashboards cannot.

## Theme duality (the campaign's scaffolding)

Two looks coexist until every route is covered, then one is retired (that is "ready to migrate"):

- **altimeter** = the shipped look; the absence of `data-theme` on `<html>`.
- **prism** = `html[data-theme="prism"]`, defined in `src/app/theme-prism.css` (token re-points) and,
  for composed parts, in `src/app/kit.css` (`data-kit="<part>"` rules).
- Switch: header tab switcher `ThemeSwitch` (both SiteHeader and OrgHeader), stored in localStorage
  `ascent-theme`, restored pre-paint by `THEME_BOOT_SCRIPT` (`src/lib/theme/theme.ts`).
- Rule for every batch: the Altimeter render must not regress (pair it); the Prism render is what the
  owner gates. The token layer restyles ALL routes at once; batches migrate what tokens cannot reach
  (literal hex, inline styles, hand-rolled look-alikes) and recompose surfaces from the kit.
- Exit criteria to retire altimeter: coverage.json has every reachable module approved, and the owner
  says so at a gate.

## Skill improvement log

