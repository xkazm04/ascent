# Kit v2 language: the Prism structure, printed into the kit

Status: **draft for the owner's gate (kit-1a), 2026-09-29.** Owner verdict on kit-0: *the palette is
fine, but the landing structurally changes how components and typography work; the whole design
identity should be printed into the new kit.* This file is that print. It is measured, not
remembered: every number below was read with `getComputedStyle` from the ported landing
(`/?landing=prism`, `src/components/landing/prism/prism.css`) at 1440x900 (`--U` = 14.4px) and
1920x1080 (`--U` = 17.28px). Re-measure with a `getComputedStyle` probe (`.contest/stage/measure.mjs`
was the one used, git-ignored) before trusting a number older than the landing's last edit. Sibling
docs: `BRAND-PRISM.md` (palette and mark), `KIT-REDESIGN-PROCESS.md` (how a session applies this to a module).

**Marker convention:** `[VETO]` = a decision the owner may want to overturn; the reasoning is given so
the veto is cheap.

## 0. What is structurally different (why colour was not enough)

| | Altimeter (shipped app) | Prism (landing) |
| --- | --- | --- |
| Containers | boxed cards: rounded-2xl, 1px border, translucent fill, everywhere | **no card boxes**: hairline rules, plates, and space; one boxed object per surface (the evidence panel) |
| Labels | mono, UPPERCASE, 0.22em tracking (`type-label`) | **sentence-case sans**, 14px, 0.02em tracking, with a 28x3 spectral tick |
| Headings | 600-700 weight, ~25-37px | **weight contrast**: 300 for the statement, 600 for the named thing, -0.03..-0.04em tracking |
| Figures | mono 600 | display **300**, tight tracking |
| Mono | labels, stats, headers, chips | **only evidence**: file paths, ids (`D3`), weights, code, honesty tags |
| Colour | one azure accent | paper primary; hue **names a dimension**, never decorates |
| Controls | rounded-md/lg, filled accent | 3px radius; paper block + spectrum underline (primary), hairline ghost |
| Layers | tabs replace content | **levels**: overview, item scene, evidence; each with breadcrumb, Back, Esc, prev/next, a hash URL |
| Scale | fluid px per component | one fixed 16:10 frame unit `--U = min(1vw,1.6vh)` |

## 1. Type roles (measured)

Families (landing tokens `--disp` / `--text` / `--mono`): Segoe UI Variable Display / SF Pro Display for
display; Segoe UI Variable Text / SF Pro Text for text; Cascadia Mono / SF Mono / Consolas for mono.

| Role | Landing (1440 / 1920) | In `--U` | Weight | Tracking | Line height | Colour |
| --- | --- | --- | --- | --- | --- | --- |
| Statement, hero h1 | 62.2 / 75.2px | 4.32U | 300, the named word 600 | -0.035em | 0.98 | paper `#f2eee6` |
| Statement, section h2 | 51.5 / 62.2px | 3.58U | 300, named 600 | -0.03em | 1.0 | paper |
| Named object, scene h3 (a level or dimension name) | 77.2 / 93.3px | 5.36U | 600 | -0.04em | 0.95 | the item's hue |
| Tagline | 24.3 / 29.4px | 1.69U | 400 display | 0 | 1.2 | paper |
| Lede | 17.4 / 21.1px | `max(17px, 1.22U)` | 400 text | 0 | 1.55 | `#d6d4d0`, max 34em |
| Body / desc | 17.4 / 21.1px | `max(17px, 1.22U)` | 400 | 0 | 1.55 | `#d0cec9` |
| Eyebrow | 14 / 16.4px | `max(14px, 0.95U)` | 400 text, **sentence case** | +0.02em | 1.55 | mute `#a6abbd` |
| Fine / note | 15px | fixed | 400 | 0 | 1.55 | dim `#7d8296` |
| Control label | 17.4px (button), 14 / 15.6px (segmented) | `1.22U` / `0.9U` | 600 / 400 | +0.005em | | |
| Mono id / weight | 13-15px | fixed | 400 | 0 | | hue or mute |
| Honesty tag | 12px mono, UPPERCASE, +0.06em | fixed | 400 | | | on amber `#f2c14e` |

Floors (the landing's own rules): body 17px; nothing below 12px (the tag is the only 12px item).

### Decision D1: the fixed-frame unit does NOT cross into dashboards `[VETO]`

`--U` scales the whole composition with the viewport so a poster holds from 1280x800 to 2560x1440. A
dashboard reflows instead (columns, tables, scroll containers), and a viewport-relative type size inside a
240px rail or a 597px panel is wrong at every width but one. **Dashboards use the same roles at fixed rem
steps taken from the 1440 column** (`U` = 14.4px):

| Role token | Dashboard size | From | Use |
| --- | --- | --- | --- |
| `page` statement | 2.25rem / 1.05, 300, -0.03em | h2 at 1440 scaled to a 1160px working column | the one page title per route |
| `section` statement | 1.5rem / 1.15, 300, named 600, -0.02em | h2 | a section head |
| `figure` | 1.75rem / 1, 300, tabular, -0.03em | `.meta b` (2.6U, light) | stat figures |
| `named` | 1.25rem / 1.2, 600, -0.01em | plate label 1.2U, tagline | an item's name in a row or scene |
| `body` | 1.0625rem (17px) / 1.55 | body | prose, lede |
| `row` | 0.9375rem (15px) / 1.4 | linelist 17px, `.note` 15px | dense rows and table cells `[VETO]`: the landing has no dense surface, so 15px is a working-surface concession, not a measurement |
| `eyebrow` | 0.875rem (14px), +0.02em, sentence case | eyebrow | every label above a section |
| `caption` | 0.8125rem (13px) mute | ray-label id, plate span | metadata |

Poster sizes (`hero` 4.3U+, `scene` 5.4U) stay poster-only: public pages and the landing.

### Decision D2: the Prism theme adopts the landing's font stacks `[VETO]`

The identity's typography is a weight contrast (300 vs 600) drawn from system display faces. Geist Sans has a
weight axis and can do 300, but its shapes are not the landing's. `theme-prism.css` re-points `--font-sans`
and `--font-mono` to the landing stacks so the whole theme reads as one type family. Cost: text renders per OS
(Segoe on Windows, SF on Mac). Undo: delete the two lines; every role falls back to Geist with the same weights.

### Decision D3: mono is for evidence only; `type-label` loses its caps in Prism `[VETO]`

In Prism, `.type-label` (mono, uppercase, tracked) renders as the **eyebrow** (sans, sentence case, +0.02em).
This is a theme-wide rule in `kit.css` (unlayered, so it beats per-site `tracking-[..]` utilities) so every
existing label converts without touching modules. Mono survives for: file paths, dimension ids, numeric
weights, code, honesty tags, keyboard hints. Table heads become 13px sans `caption` (mute), not mono caps.

## 2. Shape and structure (measured)

- Radius: controls 3px (`.btn`, `.seg`, `.back`), tags 2px, the evidence panel 4px, the eyebrow tick 2px.
  Nothing larger than 4px on a working surface. **Decision D4 `[VETO]`:** the shipped 16-24px card radius
  (`rounded-2xl`) is retired in Prism.
- Hairline: `rgba(242,238,230,0.13)` (`--hair`), 1px. Strong hairline for ghost controls: 0.32 alpha.
- Containers: `Frame` = a hairline-ruled band (border-top 1px, no fill, no radius, generous padding). Boxed
  (`Panel`) is for **focus objects only**: the evidence panel, a selected item, the accent band, modal-like
  drawers. Lists are rows separated by a bottom hairline (`.linelist button`: 14px block padding, 1px bottom
  rule), not stacked cards. **Decision D5 `[VETO]`:** in a v2 composition a dashboard section is a Frame
  (rule + space) and a card is the exception. Dense tables keep a frame (top and bottom hairline) so scroll
  containment stays visible.
- Primary action: paper fill `#f2eee6`, text `#07080c`, 600, 13px x 20px padding, 3px radius, with a 4px
  spectrum underline that grows to 6px with a soft glow on hover and lifts 1px.
- Ghost action: transparent, 1px paper-32% border, paper text, 12px x 18px; hover = paper border + 6% fill.
- Segmented: 1px hairline frame, 3px radius, active = paper block with dark text 600, others mute.
- Dimension bar: 4px (list) hue block, 2px radius, `box-shadow: 0 0 12px <hue>` **only for the dimension it
  names** (never a resting decoration on many rows at once).
- Evidence panel: `#08090f` at 86%, 1px border in the dimension hue at 45%, 4px radius, glow in the same hue
  at 15%; body = title (mono, 17px), a "Read with" line, a `pre` (`#04050a`, 2px hue left border, 14.5px mono,
  line numbers `#565b6e`), a `dl` (auto/1fr grid, 8px x 18px gap, 16px, `dt` mute), a guardband sentence
  separated by a hairline, and prev/next.
- Honesty tag: `Illustrative` on invented figures/evidence, `Stylised` on drawn art. Amber `#f2c14e` fill is
  the one non-spectral saturated chip. **Rule: any figure the page did not measure carries a tag.**

## 3. Composition patterns

1. **Section head** = eyebrow (tick) + statement (300 with a 600 named phrase) + lede (max 34em), 4U below.
2. **One dominant element per surface.** A hover/selection promotes an item's name to the stage headline
   (landing: hovering a beam replaces the h1 with the dimension name in its hue). In a dashboard: the
   selected row or the one live object takes the largest type on the surface; siblings drop to `row`.
3. **Levels, not tabs.** A three-level model (overview, scene, evidence) with: breadcrumb (`Ascent / D3 /
   evidence 2`), a Back button (3px, hairline), prev/next, Esc = up one level, focus moved into the new level,
   `inert` on the level below, and a **hash URL per level** so browser Back works. `LevelNav` + `useEscBack`
   implement the chrome.
4. **The labelled spectral line** (`DimensionLine`): id (mono, hue) + name + weight or score as a bar whose
   **width is the value**, hue = `--spec-n`. Colour never appears without naming a dimension.
5. **Plates**: a labelled strip per level showing evidence found (bright) and missing (a dark absorption
   line). Used wherever a reading has levels.
6. **Refraction as the only brand animation**: one line in, nine lines out. Reused as the entry beat of a
   scene, never as a loop on a working surface.

## 4. Motion

Ease `cubic-bezier(.2, .7, .1, 1)` everywhere. Durations: hover/press 0.25s; content swap 0.35s (opacity +
transform); scene open 0.6-0.9s; the hero intro 2.7s, always skippable and handing control back within 4s.
`prefers-reduced-motion`: durations collapse to 0.001ms, scene/stage swaps become a 0.2s linear opacity fade,
strokes render drawn. Dashboards: only the 0.25s and 0.35s beats; no entrance choreography on data.

## 5. What crosses into working surfaces, and what stays poster-only

| Crosses (kit v2) | Stays poster-only (landing, public pages) |
| --- | --- |
| type roles at rem steps; eyebrow with tick; statement/named weight contrast | `--U` fixed frame, 4U+ display type |
| 3px/2px/4px shape; hairline containers; Frame-not-card | canvas prism/beam engine, intro, particle dust |
| paper primary + spectrum underline, ghost, segmented | full-viewport scenes, scroll-snap, film-frame grading |
| DimensionLine, EvidencePanel, Plate, HonestyTag | per-dimension line-art scenes, the brand construction sheet |
| Levels with breadcrumb / Back / Esc / hash URL | the beam glow as a resting decoration |
| honesty labels | |

## 6. Kit v2 inventory (`src/components/kit`)

Type: `Display`, `Eyebrow`, `Lede`, `Caption`, `MonoPath`. Structure: `Frame`, `SectionHead`, `SpectralRule`,
`LevelNav` (+ `useEscBack`), `DimensionLine`, `EvidencePanel`, `Plate`, `HonestyTag`, `PrimaryAction`,
`GhostAction`. Upgraded in Prism (CSS): `Panel`, `Section`, `StatTile`, `Segmented`, `ListRow`, `DataTable`,
`Chip`, `Toolbar`. Where markup must differ per theme a module ships `<Module>.v2.tsx`, chosen at its entry by
`getTheme()` (see KIT-REDESIGN-PROCESS.md).
