# Kit handoff: running the full-coverage redesign

Written 2026-09-29 after the two exercise routes. For the owner starting long-running sessions, and for any session
that resumes. Nothing here is decided by the sessions: the open decisions below are the owner's.

## Read first (in this order, ~15 min)

1. `.claude/kit/config.md`: overlay, gates, instruments, repo law, theme-duality rules, Taste.
2. `docs/design/KIT-REDESIGN-PROCESS.md`: the per-module recipe, definition of done, commands, pitfalls.
3. `docs/design/KIT-V2-LANGUAGE.md`: what the look IS (type roles, shape, composition, D1-D5).
4. `docs/design/BRAND-PRISM.md`: identity and the open conflicts.
5. `docs/design/kit-exercise-overview.md`, `kit-exercise-live.md`: two worked examples with honest defect lists.
6. Shots: `.contest/kit-shots/after-ex-overview/`, `after-ex-live/` (Altimeter and Prism, three sizes). `/kit` specimen page.
7. The ledger and vault: `.contest/Contest/Kit/` (`Kit.md`, `coverage.json`, `gates.md`).

## How to start a session

Preconditions: `git status` (foreign WIP in the tree is not yours; commit by pathspec only); one dev server for the
checkout (`npx next dev -p <port>`; if it reports an existing server, use the URL it prints; **port 3000 is a
different product**); the seeded local DB has org `kiro` (`scripts/seed-org.mjs`).

Paste this to the session:

```
/kit batch next
Follow docs/design/KIT-REDESIGN-PROCESS.md exactly (recipe steps 1-14 and its definition of done). Read
docs/design/KIT-HANDOFF.md first. Take the next modules from the coverage ledger
(.contest/Contest/Kit/coverage.json), at most 3 per batch, one feature group. For each module: baseline shots
before any edit, extraction commit, Module.v2 chosen by theme at the entry, roles file, drive script where it has
levels, Prism shots at 1280x800 / 1920x1080 / 1440x3200, honest defect list. Altimeter must stay 0 px. Do not decide
the open owner decisions in KIT-HANDOFF.md: build to the recommendation, mark it, and list it in the gate. Commit by
pathspec, never push. Stop at the owner gate with the shot paths and one decision list.
```

**Batch size:** 2-3 modules per batch, parallel builders only on disjoint files (`batch_builders: 5` is a ceiling, not a
target). Exercise cost was ~15-25 min of agent wall time per module. A module over ~3,000 LOC (governance, practices,
passports, repositories, delivery) is a batch of one, split into two passes (entry and top level, then rows and detail).
After each batch the owner gates by looking; the next batch does not start on a standing approval.

## Coverage ledger

Location: `.contest/Contest/Kit/coverage.json` (git-ignored vault; write only through `coverage.mjs`).

```
KIT=../ai-registry/skills/kit/scripts ; L=.contest/Contest/Kit/coverage.json
node $KIT/coverage.mjs status --ledger $L --next 12
node $KIT/coverage.mjs open-batch --ledger $L --id <batch> --modules a,b
node $KIT/coverage.mjs gate --ledger $L --id <batch>
node $KIT/coverage.mjs close-batch --ledger $L --id <batch> --verdict approved --text "<owner words>" --commits <sha>
```

State at handoff: 29 modules; `standing/overview` and `inflight/live` are in batch `kit-0` (second pass done, gate
pending); `kit-1a` (kit v2 foundation) is open with no modules; 27 pending. To re-open a module for a second pass:
`mark --module <m> --status pending`, then `open-batch`. Re-derive divergence and reachability at every resume
(`reach`/`div` commands in `.claude/kit/config.md`); numbers are not memory.

## The module queue (top 12 pending, ledger order)

The ledger orders by measured divergence (raw style occurrences per 100 LOC) joined to reachability (all reachable).
Order below is the ledger's; the owner's visibility order in `config.md` may reorder it at a gate.

| # | Module | Score | Debt | LOC | Why it is high (measured) |
| --- | --- | --- | --- | --- | --- |
| 2 | standing/governance | 8.53 | 254 | 2,973 | 193 palette-text, 52 raw radius, 46 raw colour, 13 inline styles; 24 commits/30d (most churn) |
| 3 | shared/practices | 6.87 | 225 | 3,270 | 137 palette-text, 43 radius, 41 colour; also the largest doc-mapped surface |
| 4 | standing/passports | 6.20 | 179 | 2,893 | 27 native titles, 21 inline styles, 150 palette-text; 26 commits/30d |
| 5 | standing/repositories | 6.06 | 174 | 2,865 | repo rows recur here, Passports and Security: redesign the shared repo row once |
| 6 | bought/delivery | 4.78 | 161 | 3,369 | 44 raw colour, 20 inline styles, 26 native titles; largest by LOC |
| 7 | admin/settings | 7.37 | 142 | 1,926 | 38 radius; the SettingRow kit part is unexercised so far, natural first user |
| 8 | shared/memory | 5.46 | 141 | 2,587 | 111 palette-text, 35 radius |
| 9 | bought/executive | 4.60 | 110 | 2,386 | 11 inline styles; executive-facing, high visibility |
| 10 | shared/registry | 5.92 | 103 | 1,743 | 97 palette-text; onboarding surface |
| 11 | shared/skills | 7.02 | 97 | 1,382 | 26 radius, 18 native titles |
| 12 | admin/integrations | 7.19 | 88 | 1,223 | 17 raw colour |
| 14 | shared/knowledge | 5.52 | 77 | 1,387 | overview-only tab; small, a fast confidence batch |

Not in the ledger yet and outside `src/features`: the `src/components/**` layers (report, org shell, deck, landing,
ui), the public routes (`/pricing`, `/report/**`, `/launch`, `/about*`), the header and sign-in chrome. Add them at a
batch by hand (`coverage.mjs` inventory) before a session claims full coverage. Suggested first batch after the
follow-ups below: `admin/settings` + `standing/repositories` (exercises `SettingRow`, `KeyValue`, `ChipRow`, and the
repo row), then `standing/governance`.

## Open owner decisions (recommendation from the exercises; none applied as final)

| Decision | Recommendation | Blocked on it |
| --- | --- | --- |
| **Hue vs meaning: DECIDED 2026-09-30 by the Director on the owner's delegation** (BRAND-PRISM conflict 1); ruling below. Evidence: on Overview D1 AI Tooling is red with a full bar at score 100, so a healthy page opens with an alarm; on Live, D1 red / D2 orange sit beside amber impact chips and green H/L chips on one row | **Ruling:** hue = dimension only. Where a row shows both a dimension and a status, status travels by glyph + word or by lightness, never by hue; a dimension is never drawn in a status hue at full saturation on a healthy value. Built in kit batch 3: `DimensionLine` shortfall hatch and a desaturated healthy bar, `Masthead` figure `tone` (glyph + sr word, value stays paper), matrix hue bars only in the sorted column and on hover | Every module that draws dimensions (Overview, Live, Passports, Repositories, Security, Adoption); owner must rule before those batches |
| **D1 fixed-frame unit stays landing-only**, dashboards use fixed rem roles | Accept; but the masthead at 2.25rem is modest at 1920 (right two thirds empty) so allow a `page` role of ~3rem above 1600px | Masthead scale; every page title |
| **D2 system fonts in Prism** (Segoe/SF/Cascadia instead of Geist) | Accept for Prism; two-line undo. Measure per-OS render before retiring Altimeter | Font truth; anything measuring text width |
| **D3 `.type-label` becomes a sentence-case eyebrow theme-wide; D3b captions and the toolbar readout become sans** | Accept both; grep for mono used as prose in each batch | Every label and caption |
| **D4 no radius above 4px; D5 sections are hairline Frames, cards the exception** | Accept; owner to eyeball a dense table module (Passports) before ruling on D5 for tables | Dense modules |
| **Poster scale vs dashboards** | Keep poster type on public pages and the landing; dashboards use roles only | Public route redesign |
| **Warm paper vs cool slate** | Already Prism-only; check `globals.contrast.test.ts` before moving any token when Altimeter retires | Retirement |
| **Import rule** (AGENTS.md vs code) | Adopt the wording in `KIT-REDESIGN-PROCESS.md` | Cleanliness only |

### Hue-versus-meaning ruling (decided 2026-09-30)

Decided by the Director on the owner's delegation; the owner may still overturn it at a gate. The rule and where
it is built:

1. **Hue names a dimension and nothing else.** Status colours (warn, danger, success, tone) never stand in for a
   dimension, and a dimension hue never stands in for a status.
2. **A row that shows both** carries status on a non-hue channel: a glyph and a word (`MastheadFigure.tone`,
   the `▾` below-floor mark in `DimensionMatrix.v2`) or lightness. The number itself stays paper.
3. **Never a dimension in a status hue at full saturation on a healthy value.** Prism desaturates a bar at 85% or
   more (`data-high`, `filter: saturate(0.75)`), and a shortfall to the floor is a hatched span in the dimension's
   own hue (`dimension-shortfall`), a pattern rather than an alarm colour.
4. **Density of hue:** matrix cells draw the hue bar only in the sorted column and under the pointer.

Follow-through owed by later batches: Live (impact and H/L chips beside D1/D2 lines), Passports, Repositories,
Security and Adoption still pair status hues with dimension hues in places; migrate each as it is redesigned.

## First follow-ups: known defects of the two exercised routes

From the exercises' own shot review (`kit-exercise-*.md`); do these as batch `kit-2` before new modules:

1. **D1-red alarm** on Overview's first dimension line (decision above).
2. **Masthead scale/space:** Overview statement modest at 1920; Live masthead ~300px tall, sky starts low at 1280x800:
   put figures and controls on one row.
3. **"Fix first" and the fleet repo rows are still v1 markup** with Prism CSS (mono path rows, stack icons, ranked ring):
   redesign as kit rows; the repo row recurs in three other modules.
4. **Live outcome matrix cells overlap** ("not measured" over "0 commits" at ~168px columns), pre-existing in Altimeter;
   boxed mono table is the largest remaining Live target.
5. **Rail "Shared ground" bars are grey:** should be `DimensionLine`s with hue and weight.
6. **Guided setup drawer tab covers right-edge controls at 1280px** (Wall button, "1 selected"): move the tab or add a
   page gutter; org shell, both themes.
7. **Canvas/SVG mono labels** in the sky and axes: `type-label` cannot reach them; redraw or restyle the graphic.
8. **Overview trend sparkline is tiny** (no axis, no floor); trajectory reads as a footnote; the presentable-fit chart
   was not checked (seeded org has 7 days of history).
9. **Live tab opens scrolled ~384px** (smooth scroll on mount, caller not found): a product question.
10. **Stack selector** above the Live masthead is still an Altimeter pill: migrate to `Segmented`.
11. Not verified anywhere: keyboard/screen-reader on the new controls, `text-warn` contrast on the void, 390px widths.
12. Extraction candidates: a kit `Movement` part (delta arrow + sr text, copied three times), `VoidMark`
    (`HeatVoid`/`StateSwatch`), `FilterMenu`, `HairlineList`, the duplicated trajectory gate in
    `OverviewTrajectoryCard`, and the v1 "not judged" heuristic.

Standing gate debt outside this campaign: `copy:check` fails with 4 UK-spelling errors in `src/components/landing/prism/*`
("colour", "prioritised"), and `scripts/check-em-dashes.mjs` fails repo-wide (~400 hits).

## Retiring the duality (when coverage is complete)

Exit criteria: every reachable module `approved` in `coverage.json`, the `src/components/**` layers and public routes
added to the ledger and approved, the owner's ruling on the decisions above recorded in `gates.md`, and the owner says
"retire Altimeter" at a gate. Then, in this order, one commit each:

1. Move `src/app/theme-prism.css` tokens into `@theme` in `globals.css`; delete the `html[data-theme="prism"]` scoping
   in `kit.css` and the Altimeter branches of each kit part's base classes.
2. Replace each `<Module>` entry with its v2 composition; delete every `*.v1.tsx`, the shared `use*View` stays.
3. Delete `ThemeSwitch`, `ThemeSlot`, `src/lib/theme/*` (cookie read, boot script, client helpers), the `data-theme`
   attribute in `layout.tsx` and the `ascent-theme` cookie handling in `scripts/kit/shoot.mjs` and `roles-check.mjs`.
4. **Undo the dynamic-route side effect:** the root layout reads a cookie, so previously static routes (`/pricing`,
   `/privacy`, `/terms`, ...) render per request; removing the read returns them to static. Verify the `next build`
   route table shows them static again.
5. Re-shoot every route, run `npm run verify`, update `docs/features/design-system/README.md`, and delete the two
   `kit-exercise-*.md` files or move them to `docs/archive/` (append-only, dated).
