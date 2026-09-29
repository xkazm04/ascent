# Kit redesign process: how a session moves one module into the v2 world

Status: **v0, written before the two exercise routes (`/org/kiro?tab=overview`, `?tab=live`) were redesigned
with it.** Sections marked `EXERCISE:` are placeholders the exercises must replace with what actually
happened. A long-running session follows this file plus `KIT-V2-LANGUAGE.md` (what the look is) and
`.claude/kit/config.md` (gates, instruments, repo law). The campaign method itself is the registry's `kit`
skill; this file is the ascent-specific recipe under it.

## What "redesign" means here (and what it does not)

The palette layer is done and covers every route at once (`src/app/theme-prism.css`). The work per module is
**structural**: the same data, behaviour and honesty rules, recomposed into the v2 language: hairline Frames
instead of card stacks, statement/named type roles, eyebrow instead of mono caps, one dominant element,
levels with a way back, DimensionLine / EvidencePanel / Plate where the module shows dimensions, evidence or
levels. The layout **may change** in Prism. It must not change behaviour, data, tests' meaning, or the
Altimeter render.

Not a redesign: swapping colours, adding a class, wrapping a card in a bigger card, or a CSS-only skin.
Those are the kit-0 result the owner rejected as insufficient.

## The two-worlds rule (duality)

- **Altimeter** (no `data-theme`) is the shipped look. It must not regress: pair-check it (step 7).
- **Prism** (`data-theme="prism"`) is the v2 world. The server reads the theme once per route
  (`getTheme()` from `@/lib/theme/server`, cookie `ascent-theme`) and the module entry picks the composition.
- The switch is the header tab switcher; `?theme=prism|altimeter` also sets it. Duality is scaffolding: it makes
  static routes dynamic and is deleted when one theme is retired (see the last section).

## The layout-per-theme convention

```
src/features/<group>/<tab>/
  <Module>Tab.tsx          the ENTRY (server or client as today): reads `theme` and picks one composition
  <Module>.v1.tsx          the current composition, moved here unchanged (only if the entry had markup)
  <Module>.v2.tsx          the Prism composition, built from src/components/kit
  <module>Model.ts         data shaping shared by both (pure, tested); NEVER duplicated per theme
```

Rules: (1) the entry receives `theme: ThemeId` from a server parent (`await getTheme()`), never reads cookies
itself in a client file; (2) both compositions take the **same props** and call the **same** hooks/actions,
so behaviour cannot diverge; (3) shared sub-components are extracted **theme-agnostic** into
`src/components/kit` (if generic) or the module folder (if domain-specific), and keep their Altimeter classes as
the base; (4) a v2 composition never imports from `src/components/org/shared` in a way that reverses the
dependency rule in AGENTS.md; (5) every file under `src/features/**` stays at or under 200 lines, `.tsx`
elsewhere 300 (extract first, do not commit over the cap).

Where only CSS differs (radius, type role), do **not** fork markup: use the kit part and its `data-kit` hooks
(`src/app/kit.css`). Fork markup only when the **structure** differs (card grid becomes ruled rows, tabs
become levels, a table gains a dominant selected row).

## The recipe (one module = one batch item)

1. **Read the language.** `docs/design/KIT-V2-LANGUAGE.md` sections 1-3 and the veto-able decisions D1-D5. If the
   owner has ruled on any, follow the ruling (see `gates.md` in the kit vault).
2. **Audit the module.** List: hand-rolled look-alikes of kit parts (panel, stat, row, chip, toolbar, table, setting
   row), raw hex/rgba/inline styles (`rg -n "#[0-9a-fA-F]{3,8}\b|rgba?\(|style=\{\{" <module dir>`), mono caps labels,
   stock hue utilities (`text-emerald-*` etc.) that mean status vs dimension, and the module's levels (does it
   have an overview, an item and a detail that today are tabs or modals?). Write the defect list to the batch note.
3. **Extract shared components first, in Altimeter.** Behaviour-preserving, tests kept green, Altimeter pixel-identical
   (step 7 on the extraction commit alone). This is the step that makes the redesign cheap and keeps it reviewable:
   an extraction commit and a v2 commit are separate commits.
4. **Design the v2 composition.** Decide: the one dominant element; the section heads (eyebrow + statement +
   named); Frames not cards; which dimensions or levels the surface shows (DimensionLine/Plate); where a nested layer
   belongs (LevelNav + hash/query URL + `EscBack`); what carries an honesty tag. Layout may change; sketch it as a
   short paragraph in the batch note before coding so the gate can compare intent to result.
5. **Build `<Module>.v2.tsx`** from the kit only. A missing part is a kit batch (`coverage.mjs add-kit-part` without
   `--batch`, then `/kit grow`), never a local workaround. Token hygiene is the floor: no raw hex, no arbitrary text
   sizes, no mono caps. Status colours keep meaning (success/warn/danger); spectrum hues only name a dimension.
6. **Wire the entry.** Server parent reads `getTheme()`, passes `theme`; the entry renders v1 or v2.
7. **Altimeter pair-check.** `node scripts/kit/shoot.mjs --base <dev url> --themes altimeter --routes "<route>"
   --sizes 1440x900,1920x1080,1440x3200 --out <dir>` before and after; diff (PIL `ImageChops`, threshold 30);
   expected 0. A live surface may shift 1px of scroll from data height: compare the 1440x3200 full-page shot
   first and explain any residue.
8. **Prism shots.** Same command with `--themes prism`, all three sizes; zero console errors is the shooter's exit code.
9. **Computed-style check against kit roles.** Probe `getComputedStyle` on the `data-role` hooks (display, eyebrow,
   actions, frame) and compare with the spec table in KIT-V2-LANGUAGE.md section 1. A deviation is fixed in the part's
   CSS (never per-module) or written down as an owner-accepted override.
10. **Defect list.** Look at every shot: overflow, wrapping, dead space, crammed cells, rhythm breaks, dimensional
    hue used for status, a lone card in a ruled page, text under 13px, contrast below AA on the void.
11. **Gates.** `npm run typecheck`, `npx eslint <changed dirs>`, `npx vitest run <changed dirs>`, `npm run copy:check`
    for touched copy, LOC caps, and `npx next build` before any batch closes (memory: tsc does not catch a
    client/server boundary break).
12. **Doc-sync** in the same turn: the mapped `docs/features/<area>/*.md` (AGENTS.md map), and delete any "Known gap"
    the redesign closed.
13. **Owner gate.** One question per batch, shots inside it (the pair Altimeter | Prism per size, plus the family image).
    Record the owner's words verbatim in `gates.md`; a correction is also a Taste line in `.claude/kit/config.md`.
14. **Close.** `node ../ai-registry/skills/kit/scripts/coverage.mjs close-batch ...`, commit with pathspecs.

## Ledger and commands

```
LEDGER=.contest/Contest/Kit/coverage.json ; KIT=../ai-registry/skills/kit/scripts
node $KIT/coverage.mjs status --ledger $LEDGER
node $KIT/coverage.mjs open-batch  --ledger $LEDGER --id <batch> --modules a,b
node $KIT/coverage.mjs add-kit-part --ledger $LEDGER --name X --api "<signature>" [--batch <id>]
node $KIT/coverage.mjs gate        --ledger $LEDGER --id <batch>
node $KIT/coverage.mjs close-batch --ledger $LEDGER --id <batch> --verdict approved --text "<owner words>" --commits <sha>
node scripts/kit/shoot.mjs --base http://localhost:<dev> --themes altimeter,prism --routes "/org/kiro?tab=live" --out .contest/kit-shots/<batch>
```

Dev server: one `next dev` per checkout; if it says one exists, use the URL it prints. Port 3000 on this machine
is a different product (KandiDate). The data tape is the seeded local DB (org `kiro`).

## Commit ritual

Commit on the current branch with **pathspecs** (`git commit -m "..." -- <paths>`), never `git add <dir>`, never
stash, never reset in the shared tree, never push. Trailer: `Co-Authored-By: Claude Sonnet 5.5
<noreply@anthropic.com>`. Separate commits: kit part, extraction, v2 composition, docs.

## Pitfalls found (add yours)

- Only one `next dev` can hold a checkout; a second start exits. Reuse the running server's URL.
- A setup drawer covers routes in screenshots until dismissed; the shooter clicks "Skip setup".
- The theme is a cookie because the server must know it for per-theme layout; the old localStorage value is
  migrated once by the boot script, and `?theme=` reloads once (guarded so blocked cookies cannot loop).
- Reading cookies makes a route dynamic: previously static marketing routes render per request until the duality retires.
- React-compiler lint rules reject writing `document.*` or calling `setState` in an effect inside a component:
  put browser writes in `src/lib/theme/client.ts`-style helpers and pass initial state from the server.
- `.type-label` is a theme-wide eyebrow in Prism (kit.css, unlayered): do not add per-site caps or mono to fight it.
- Tailwind v4 utilities read `var(--color-*)`, so re-pointing tokens restyles everything; literal hex and inline
  styles are the measured remainder each module batch must migrate.
- A live tab shifts by ~1px of scroll when data height changes; compare the full-page shot.
- `EXERCISE:` pitfalls from the overview and live redesigns go here.

## Exercise log

- `EXERCISE:` overview (`/org/kiro?tab=overview`): what was extracted, what layout changed, deviations, owner verdict.
- `EXERCISE:` live (`/org/kiro?tab=live`): same.
- `EXERCISE:` what the two exercises changed in steps 1-14 above.

## Retiring the duality (when every module is approved)

1. `coverage.json`: every reachable module `approved`, the owner says so at a gate.
2. Make Prism the base: move `theme-prism.css` tokens into `@theme` in `globals.css`, delete the
   `html[data-theme="prism"]` scoping in `kit.css`, replace each `<Module>` entry with its v2 composition and delete `v1`.
3. Delete `ThemeSwitch`/`ThemeSlot`, `src/lib/theme/*`, the boot script and the layout cookie read (routes go static again).
4. Re-run the shooter on every route; record the Altimeter removal in `docs/features/design-system/README.md`.
