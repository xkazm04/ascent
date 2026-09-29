# Kit exercise: the Live cockpit (`/org/kiro?tab=live`)

Status: exercise 2 of 2 under `KIT-REDESIGN-PROCESS.md` (2026-09-29). This file is the learnings, written by the
session that followed the recipe; the recipe itself is unedited. Commits: extraction `8c130e67`, kit parts
`ff2519c7`, v2 composition `1fadf8a5`, docs `5fd7033c`.

## What was built

The default Live view (`?view=cockpit`; the Ledger, Desk and Wall views were out of scope). `LiveCockpit.tsx`
became the entry (theme from `LiveTab` -> v1 or v2). v2 = masthead statement, sky with no card, a ruled rail,
Frames with statement heads for the proposed batch and price list, and the outcome as **two levels** (run strip
on the page, the full matrix behind `#outcome` with breadcrumb, Back, Esc, focus move, deep link).

The layout sketch written before coding (step 4):

> One dominant object: the sky. Above it a masthead that answers "what state is the loop in" in two figures. The
> rail stops being a second card and becomes a ruled column. Sections below are Frames whose head says what the
> section is for. The 12-column outcome matrix stops competing with everything else: the page carries a run
> strip, the matrix is one level down.

## What each recipe step cost

| Step | Cost | Note |
| --- | --- | --- |
| 1 Read language | small | D1-D5 held; nothing to override |
| 2 Audit | medium | `rg` for raw values found only 5 hits in the top-level files; the look-alike audit is not in the `rg`, it is reading each file. The real inventory is "which file owns a boxed card / mono-caps label / stock table" |
| 3 Extract (own commit) | **the largest** | 5 extractions (`useLiveCockpitView`, `useOutcomeMatrix`, `usePriceList`, `headerStatus`, `CockpitBatchTable`, `OutcomeBody`). Each was a pure move; the win is that v2 is 100-190-line files with no state |
| 4 Design | medium | hardest decision: what becomes a level (only the matrix qualified) |
| 5-6 Build, wire | medium | see "nested-level state" below |
| 7 Altimeter pair | **wasted an hour** | see the shift below |
| 8-9 Shots, roles | small | `roles-check.mjs` from the overview exercise worked first time; 12 roles, 0 deviations at 1440 and 1920 |
| 10 Defects | medium | list below |
| 11-12 Gates, docs | medium | `LiveTabView`/`ledgerView` tests call `LiveTab` directly and crashed on `cookies()`: mock `@/lib/theme/server` |

## The unexplained 1px shift (kit-0 vs kit-1a, Live at 1920x1080): explained, not a regression

Cause: the **page scrolls itself on mount**. `scrollY` goes 0 -> ~384 over ~250ms, through
`html { scroll-behavior: smooth }`, and lands on **384 or 385** depending on the moment content height settles
(2436 -> 2775px). Header rows are identical in both shots; the content under it is shifted by that pixel. Three
runs of the same code produced 385, 385, 384; the 384 run matched the kit-0 image and the 385 run matched kit-1a
exactly (0 px diff). No Altimeter CSS changed. **Fix: the shooter pins scroll with an instant
`scrollTo({top:0,behavior:"instant"})`** (a plain `scrollTo(0,0)` still animates under smooth scroll and lost the
race: 155,108 px diff). After the fix two runs are pixel-identical and the v2 wiring left Altimeter at 0 px at 1440x900,
1920x1080 and 1440x3200. Open question for the product, not the kit: why does the Live tab open scrolled 384px
(below the tab head)? I did not find the caller.

## Wrong, missing or unclear in the recipe

1. **Step 7 needs the scroll pin and a clean baseline.** "Compare the 1440x3200 full-page shot first" is the right
   fallback but the doc should say the shooter pins scroll (now true) and that the *baseline must be taken from the
   extraction commit's parent, before any edit*, because the dev server serves the working tree and you cannot
   check out the old code in a shared tree. I had no true pre-extraction baseline and used the kit-1a full page (29 px
   from an animated dot); a `scripts/kit/baseline.sh` that renders `HEAD` into a scratch worktree would remove this.
2. **Shared scripts collide between parallel sessions.** I overwrote the other exercise's `scripts/kit/pairdiff.py`
   (bbox + filter) with a worse one because I did not run `git status` first; restored in `102ebfd9`. Add to the
   commit ritual: `git status --short scripts/kit src/components/kit` before creating a file there.
3. **Nested-level state is a recipe gap.** The doc says "LevelNav + hash URL + EscBack" but not how. Findings:
   - `LevelNav` links go through `next/link`; a hash-only Link does not reliably fire `hashchange`, so a level held
     in the hash needs plain anchors or handlers. Added `LevelLink.onClick` (a button never scrolls).
   - `useHashFlag` (new) is `useSyncExternalStore` on `hashchange`; closing uses `pushState` (no scroll) plus a
     manual `hashchange` dispatch because `pushState` fires none.
   - SSR cannot see a hash, so a deep link renders the overview first and the level after hydration. Acceptable for
     an operator surface; say so in the recipe.
   - Focus must move into the level heading on open; the drive script asserts it.
4. **"Both compositions take the same props" needs one more rule: the same hook call site.** The cockpit's state
   lives in `useLiveCockpitView` and BOTH compositions call it; if v2 had called `useCockpit` itself the two would
   drift on the first refactor.
5. **A test that renders the server entry directly breaks on the first `cookies()` call.** Recipe step 6 should say:
   mock `@/lib/theme/server` in any test that imports a module entry.
6. **The `EXERCISE:` placeholder in "Pitfalls" should list**: smooth-scroll pin; `OutcomeSection` owning review
   state means the v2 summary and the level must share ONE `useOutcomeMatrix` call (they do: it is called once in
   `OutcomeSectionV2`); a `Bash` heredoc containing an apostrophe fails in this harness, write such files with the
   editor tool.
7. **The kit-0 ledger cannot open a second batch for a module already in-batch** (`inflight/live` sat in `kit-0`),
   so this exercise's kit parts are recorded under `kit-0`. Either close `kit-0` at its gate or allow `open-batch
   --force`.

## Defects still visible in the Prism shots (honest list)

- **The masthead is ~300px tall** (statement, a figures row, then the controls on a third band at 1440): at
  1280x800 the sky starts below the fold's midpoint. The statement is right; the figures + controls could share a
  single row.
- **Right-edge collision at 1280 wide:** the fixed "Guided setup" tab covers the Wall button and the rail's
  "1 selected". Pre-existing chrome, but v2 puts controls at the edge where it bites. Needs a page right gutter
  or the tab moved (org shell, not this module).
- **The stack selector above the masthead** (`TechStackSelector`, from `LiveTab`) is still the Altimeter pill with
  mono text and floats over the eyebrow. Shared with the wall; needs a kit `Segmented` variant migration.
- **The outcome matrix (`OutcomeSheet` + cells) is untouched.** At level 2 it is a boxed mono table with
  overlapping cell footnotes ("not measured" over "0 commits" at ~168px columns); the overlap is **pre-existing in
  Altimeter** too (visible in the kit-1a full-page shot). It is the biggest remaining extraction/redesign target
  of this module.
- **Rail inspector**: "Shared ground" D9/D1/D2/D6 rows are grey bars, i.e. exactly `DimensionLine` and should carry
  their hue and weight; left as v1 because the rail's panels are shared.
- **Hue vs meaning (BRAND-PRISM conflict 1) is visible in the batch table:** `D1` is red and `D2` orange beside the
  amber I/E chips and the green `H`/`L` chips, which mean impact/effort. Spectrum hue and status chips share a
  palette on one row.
- Quadrant labels and axis text inside the sky are canvas-era mono caps; the `type-label` eyebrow rule does not
  reach SVG text.

## Extraction candidates (shared, not done here)

`OutcomeSheet*` (boxed table), `CockpitInspector` shared-ground list -> `DimensionLine`, `TechStackSelector` ->
`Segmented`, the fixed guided-setup drawer tab -> a layout-aware component, `CockpitRail` panels (drive, runner,
lane rail: ~10 files still on Altimeter cards).

## Proposals

- **Recipe:** add the baseline-from-parent script, the nested-level recipe (hash level, `EscBack`, focus,
  same-page Back), the shared-scripts `git status` rule, and "one `use*View` hook per module".
- **Kit:** `Masthead` (the other exercise) and `LevelNav` cover the head/chrome; a `RunStrip`-shaped generic
  `HairlineList` (rows with a column header, `aria-pressed`) would replace `OutcomeRunStrip`; a `DimensionMark`
  is built and a `DataTable` Prism head is in `kit.css`.
- **Instrument:** `roles-check.mjs` should accept `--hash` (levels) so level 2 is contract-checked; today only the
  overview level is.
