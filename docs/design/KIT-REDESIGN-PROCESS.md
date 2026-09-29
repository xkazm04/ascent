# Kit redesign process: how a session moves one module into the v2 world

Status: **v1, 2026-09-29.** Exercised on `/org/kiro?tab=overview` (76 tool calls, ~15 min wall) and
`/org/kiro?tab=live` (89 tool calls, ~21 min wall); their raw learnings are `kit-exercise-overview.md` and
`kit-exercise-live.md`. A long-running session follows this file plus `KIT-V2-LANGUAGE.md` (what the look is),
`KIT-HANDOFF.md` (where to start, open decisions) and `.claude/kit/config.md` (gates, instruments, repo law). The
campaign method itself is the registry's `kit` skill; this file is the ascent-specific recipe under it.

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

Rules: (1) the entry gets `theme: ThemeId` from `await getTheme()`: an entry that is already a server component awaits it
itself (Overview did); a client entry receives it from a server parent (Live: `LiveTab` passes it to `LiveCockpit`).
Never read cookies in a client file. Any test that imports a module entry must `vi.mock("@/lib/theme/server")`, or it
crashes on the first `cookies()` call; (2) both compositions take the **same props** and call the **same** hooks/actions,
so behaviour cannot diverge; (3) shared sub-components are extracted **theme-agnostic** into
`src/components/kit` (if generic) or the module folder (if domain-specific), and keep their Altimeter classes as
the base; (4) a v2 composition adds no NEW import from `src/components/org/shared` (AGENTS.md rule; see the conflict below);
(4b) ONE `use<Module>View` hook owns the module's state and BOTH compositions call it, so v1 and v2 cannot drift; (5) every file under `src/features/**` stays at or under 200 lines, `.tsx`
elsewhere 300 (extract first, do not commit over the cap).

Where a panel must move but keep its streaming boundary, pass it as a **slot prop** (a server element into a server
component): Overview put the masthead above "Fix first" this way and kept both Suspense boundaries.

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
   (step 7 on the extraction commit alone). **Before moving an entry file, `rg -l readFileSync src/features/<module>`:
   source-scan tests pin markup by reading the entry as text and fail on a split with no behaviour change (Overview:
   4 tests); rebind them to both compositions with `describe.each`.** Take the true baseline FIRST (see below). This is the step that makes the redesign cheap and keeps it reviewable:
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
   --sizes 1440x900,1920x1080,1440x3200 --out <after-dir>`, then
   `python scripts/kit/pairdiff.py <baseline-dir> <after-dir> [name-filter]` (changed px at threshold 30 plus the bbox
   of the change; exit 1 on any diff). Expected 0 on the extraction commit and on the final commit. The shooter pins
   scroll to 0 with an instant `scrollTo` (the Live page smooth-scrolls itself to ~384px on mount and a 1px race cost
   an hour), so a residue is real: read its bbox before explaining it.
8. **Prism shots.** Same command with `--themes prism`, all three sizes; zero console errors is the shooter's exit code.
9. **Computed-style check against kit roles.** Write `scripts/kit/roles/<module>.json` (role -> selector on the
   `data-role` hooks -> expected computed values from KIT-V2-LANGUAGE.md sections 1-2; `accept: [prop]` records an
   owner-accepted departure), then
   `node scripts/kit/roles-check.mjs --roles scripts/kit/roles/<module>.json --route "<route>" --theme prism --size 1440x900`
   at 1440 and 1920 (exit 1 on any un-accepted deviation). Prove it bites: run it with `--theme altimeter` and expect
   deviations (Overview: 16). A roles file is required per batch; it is the reviewable form of "hold the port to the
   design". Live: 12 roles / 20 properties, 0 deviations. Gap: it cannot yet probe a hash level (proposal below).
   For interactions write `drive-<module>.mjs` asserting on URL hash and DOM state, not on a picture
   (`scripts/kit/drive-live-v2.mjs`: 15 checks).
10. **Defect list.** Look at every shot: overflow, wrapping, dead space, crammed cells, rhythm breaks, dimensional
    hue used for status, a lone card in a ruled page, text under 13px, contrast below AA on the void.
11. **Gates.** `npm run typecheck`, `npx eslint <changed dirs>`, `npx vitest run <changed dirs>`, `npm run copy:check`
    for touched copy, LOC caps, and `npx next build` before any batch closes (memory: tsc does not catch a
    client/server boundary break).
12. **Doc-sync** in the same turn: the mapped `docs/features/<area>/*.md` (AGENTS.md map), and delete any "Known gap"
    the redesign closed.
13. **Owner gate.** One question per batch, shots inside it (the pair Altimeter | Prism per size, plus the family image).
    Record the owner's words verbatim in `gates.md`; a correction is also a Taste line in `.claude/kit/config.md`.
14. **Close.** `coverage.mjs close-batch ...`, commit with pathspecs.

### Approximate cost per step (two exercises)

Largest first: **3 extract** (Live: six extractions, each a pure move; it is what makes v2 a set of 100-190-line
stateless files) and **5 build v2**; then 4 design (the hard call is what becomes a level: only Live's matrix
qualified), instruments 7 and 9 (Overview built them, ~20% of its effort; Live reused them first time), test repair
(source-scan tests, `cookies()` mocks), 10-11 defects and gates, 12 docs. The Altimeter pair cost an hour in Live only
because of the scroll race and the missing baseline. Budget a module at ~15-25 min of agent wall time.

## True pre-extraction baseline (shared tree)

The dev server serves the working tree, so you cannot check out old code to shoot it, and a baseline taken after any
edit is not a baseline. Procedure: (1) **before the first edit of the batch**, run step 7's shooter with
`--themes altimeter,prism` into `.contest/kit-shots/<batch>/baseline`; (2) name that dir in the batch note; (3) every
later pair diffs against it, never against a previous batch's shots (Live had only the kit-1a shot, 29 px of an
animated dot included). Run the baseline twice: the shooter dismisses the setup drawer and pins scroll, so two runs
must be pixel-identical. A `scripts/kit/baseline.sh` rendering `HEAD` from a scratch worktree would remove the timing
dependency; it is not built (see `kit-registry-proposals.md`).

## Nested levels (overview, item, detail)

Learned on Live's outcome matrix (`#outcome`). (1) Hold the level in the URL hash with `useHashFlag`
(`useSyncExternalStore` on `hashchange`); close with `history.pushState` (no scroll) **plus a manual `hashchange`
dispatch**, because `pushState` fires none. (2) `LevelNav` back/prev/next: a hash-only `next/link` does not reliably
fire `hashchange`, so same-page levels use `LevelLink onClick` (buttons never scroll). (3) `EscBack` on the level.
(4) Move focus to the level heading on open and assert it in the drive script. (5) While the level is open it is the
only thing on the page. (6) The server cannot see a hash: a deep link renders the overview, then the level after
hydration; acceptable on operator surfaces, say so in the batch note. (7) The summary on the page and the level share
ONE data call (`useOutcomeMatrix` once in `OutcomeSectionV2`), never two.

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

**Second pass on a module** (`open-batch` refuses "already in-batch"): the ledger allows in-batch -> pending, so
`coverage.mjs mark --ledger $LEDGER --module <m> --status pending --note "second pass"` then `open-batch` again. Kit parts
built after their batch closed attach with `add-kit-part --batch <open batch>`; `--batch` on a proposed part marks it
built (a part still listed as KIT-GAP after it shipped, like Masthead, just lacks that call). An `open-batch --attach`
flag is proposed in `docs/design/kit-registry-proposals.md`; the registry is not edited from this repo.

Dev server: one `next dev` per checkout; if it says one exists, use the URL it prints. Port 3000 on this machine
is a different product (KandiDate). The data tape is the seeded local DB (org `kiro`).

## Commit ritual

Commit on the current branch with **pathspecs** (`git commit -m "..." -- <paths>`), never `git add <dir>`, never
stash, never reset in the shared tree, never push. Trailer: `Co-Authored-By: Claude Sonnet 5.5
<noreply@anthropic.com>`. Separate commits: kit part, extraction, v2 composition, docs. **`git commit -- <paths>` fails "pathspec did not
match" on untracked files: `git add <exact files>` first, then `git commit -- <same files>`; never `git add <dir>`.**
Before creating a file in `scripts/kit/` or `src/components/kit/`, run `git status --short scripts/kit src/components/kit`:
parallel sessions share these dirs and one exercise overwrote the other's `pairdiff.py` with a worse version. Write
TSX/TS with the file-writing tool, not a Bash heredoc: a heredoc containing an apostrophe failed with "unexpected EOF"
and ran nothing (it happened again while writing this file).

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
- `.type-caption` and the toolbar readout carry PROSE in many modules; D3 alone left mono caps on a v2 page until
  kit.css gained **D3b** (captions and readout sans in Prism; owner may veto). Grep `type-mono-sm` used for prose.
- v1 heuristics are not spec: v1 called a dimension "not judged" when its note was empty and drew a bar for one no
  scored repo carried; v2 uses `belowGreen.of === 0`. Re-derive states from data, do not copy the v1 test.
- A component that owns review state (`OutcomeSection`) must be split so the v2 summary and the level share one hook call.
- SVG/canvas text is out of reach of `.type-label`; it stays Altimeter-style until the graphic is redrawn.
- The fixed "Guided setup" drawer tab covers right-edge controls at 1280px (org shell chrome, both themes).
- **Dimension hue vs status meaning is not solved by the kit**: D1 red / D2 orange sit beside impact/effort and status
  chips on one row. Do not paper over it in a module; it is an open owner decision (`KIT-HANDOFF.md`).

## Exercise log (what actually happened)

- **Overview** (`741241f8` extract, `d72c2b21` kit, `eb01caec` v2, `cc1597ac` notes): extracted `heatmapModel`,
  `postureModel`, `useFleetRollup`; v2 = masthead statement, dimension lines grouped by SDLC phase, repo matrix with hue
  bars, ruled fleet groups. Altimeter 0 px; 15 roles, 0 deviations; owner verdict pending.
- **Live** (`8c130e67` extract, `ff2519c7` kit, `1fadf8a5` v2, `5b9c4cdc` notes): six extractions, masthead, sky without
  a card, ruled rail, outcome as two levels. Altimeter 0 px after the scroll pin; 12 roles, 0 deviations; drive 15/15;
  owner verdict pending.
- **What changed in the recipe:** step 3 gained the source-scan test grep and baseline-first; step 6 the `getTheme()`
  and test-mock rule; steps 7 and 9 named instruments with exact commands; sections added for baseline, nested levels,
  second-pass ledger and commit ritual; the AGENTS.md conflict below was recorded.

## The AGENTS.md import-rule conflict (proposal; AGENTS.md is not edited)

AGENTS.md: "Nothing in a feature group may be imported from `src/components/org/shared`". Overview imports `DIMS`,
`RepoDimensionModal`, `ScopeFilterBar`, `Meter` and `BillingReturnNotice` from there today, and v2 kept two (`DIMS`, the
modal) because the modal is the drill-in. Proposed wording: *"A feature group adds no new import from
`src/components/org/shared`; existing imports stay until the module's v2 batch, which moves the ones it needs into
`src/components/kit` (generic) or its own folder (domain) and records the move in the ledger."* Until the owner accepts
it, v2 compositions add none and migrate the ones they keep.

## Definition of done (per module)

- [ ] Baseline shots taken before the first edit; extraction is its own commit; Altimeter 0 px against the baseline
- [ ] `<Module>.v2` chosen by theme at the entry; v1 untouched; one `use*View` hook shared; tests bind both
- [ ] No raw hex/rgba/inline style/arbitrary text size/mono caps in v2 files; status colours mean status
- [ ] Levels where the module has overview/item/detail: LevelNav, Esc, focus, deep link (drive script passes)
- [ ] `scripts/kit/roles/<module>.json` 0 deviations at 1440 and 1920 (and it bites on Altimeter)
- [ ] Prism shots at 1280x800, 1920x1080, 1440x3200 viewed, 0 console errors, defect list written honestly
- [ ] Files under caps (features 200, tsx 300); typecheck, eslint, scoped vitest, `next build` exit code READ
- [ ] `copy:check` clean for touched copy (US spelling); docs/features updated; closed "Known gap"s deleted
- [ ] Ledger batch opened/closed, kit parts registered with `--batch`; owner verdict verbatim in `gates.md`

## Retiring the duality (when every module is approved)

1. `coverage.json`: every reachable module `approved`, the owner says so at a gate.
2. Make Prism the base: move `theme-prism.css` tokens into `@theme` in `globals.css`, delete the
   `html[data-theme="prism"]` scoping in `kit.css`, replace each `<Module>` entry with its v2 composition and delete `v1`.
3. Delete `ThemeSwitch`/`ThemeSlot`, `src/lib/theme/*`, the boot script and the layout cookie read (routes go static again).
4. Re-run the shooter on every route; record the Altimeter removal in `docs/features/design-system/README.md`.
