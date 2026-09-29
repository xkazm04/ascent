# Kit exercise: `/org/kiro?tab=overview`

Status: written 2026-09-29 by the session that followed `KIT-REDESIGN-PROCESS.md` v0 on the Overview. It is input for
the process doc's `EXERCISE:` sections and for the owner's gate. Cost is counted in tool calls and rework, since
wall time was shared with a parallel exercise on `?tab=live`.

## What was done

| Step (process doc) | Result |
| --- | --- |
| 2 Audit | 22 files in `src/features/standing/overview/`. Look-alikes: the heatmap table (hand-rolled `<table>`, `Surface`), the fleet rollup card grid (`rounded-2xl` boxes), the posture pill bar, the standing strip (a `Panel` of mono badges), the dimension ledger (a bordered grid). Levels: none today (cells open a modal, that is the only nested layer). |
| 3 Extract (Altimeter, own commit `741241f8`) | `heatmapModel.ts` (sort, column mean, missing flag, `useHeatMatrix`), `postureModel.ts` (shares), `useFleetRollup.tsx` (mode, filters, groups, summary). v1 components now consume them. Pixel-identical at 1920x1080 and 1440x3200, 8 tests added. |
| 4-5 Design and build v2 | `OverviewTab.v2`, `OverviewLedger.v2` plus `StandingMasthead`, `DimensionLedger`/`DimensionLedgerRow`, `DimensionMatrix`, `PostureLine`, `FleetRollup`/`FleetGroup` (all `*.v2.tsx`, longest 121 lines). One new kit part (`Masthead`), one kit extension (`DimensionLine` `floor`, `detail`, `wide`). |
| 6 Wire | `OverviewTab.tsx` awaits `getTheme()` and picks `OverviewTabV1` or `OverviewTabV2`; shared inputs in `overviewInputs.ts`. `OverviewFleetPanel` takes `theme` and a `fixFirst` slot. |
| 7 Altimeter pair | 0 changed pixels at 1920x1080 and 1440x3200 after the extraction commit and again after the full change. |
| 8 Prism shots | 1280x800, 1920x1080, 1440x3200 in `.contest/kit-shots/after-ex-overview/`, 0 console errors. |
| 9 Style check | `scripts/kit/roles-check.mjs` with `scripts/kit/roles/overview.json` (15 roles, 26 properties): 0 deviations at 1440 and 1920. Run against the Altimeter theme it reports 16, so it does bite. |
| 11 Gates | `tsc` clean, eslint 0 errors (1 pre-existing warning), 143 vitest tests in the module pass, `next build` printed its route table with no error lines. |

## Where the recipe was wrong, unclear, missing or costly

1. **Step 9 had no instrument.** The doc says "probe `getComputedStyle` on the `data-role` hooks" and gives no command.
   Built `scripts/kit/roles-check.mjs` (roles file in, deviations out, `accept` array for owner-accepted departures) and
   `scripts/kit/pairdiff.py` (step 7's "PIL ImageChops" as a command). Both should be named in the recipe. About 20% of the effort.
2. **The language spec is incomplete where the app is densest.** D3 converts `.type-label` only, but `.type-caption`
   (mono metadata) and the toolbar readout carry plain prose everywhere ("Period · Last 90 days", movement bases,
   scope notes), so a v2 page still showed mono caps until `kit.css` gained **D3b** (captions and the readout become sans).
   Owner may veto it; it applies theme-wide. Likely more of the same in other modules: grep `type-mono-sm` used for
   prose, not figures.
3. **Source-scan tests break on an entry split.** `overviewEmpty.test.ts` and `OverviewFixFirst.dom.test.tsx` read
   `OverviewTab.tsx` as text to pin the Suspense structure. Moving markup to `.v1`/`.v2` failed four tests that had
   nothing to do with behaviour. Fix used: bind the scan to both compositions (`describe.each`). The recipe's "tests
   unchanged for v1" needs this exception, and step 3 should say **grep the tests for `readFileSync` of the entry file
   before moving it**.
4. **Pathspec commits fail on new files.** `git commit -- <paths>` errors "pathspec did not match" for untracked files.
   The ritual has to be `git add <exact files>` then `git commit -- <same files>`. Never `git add <dir>`.
5. **The server-parent rule was moot here.** The Overview entry is already a server component, so it awaits
   `getTheme()` itself; the recipe's "server parent passes theme" is only needed for client entries. Say so.
6. **A slot beats a reorder.** The masthead has to sit above "Fix first", but Fix first is a sibling Suspense boundary
   that streams independently of the data region. Passing it as a `fixFirst` prop (a server element into a server
   component) kept both boundaries and reordered the DOM. Worth naming as the pattern for "same panels, new order".
7. **A v1 heuristic is wrong and v2 must not copy it.** v1 decides a dimension is "not judged" when its one-line note is
   empty. A dimension with no scored repo can still get a "strongest of N" note, so v1 draws a bar for it. v2 uses
   `belowGreen.of === 0`. v1 left untouched (out of scope), listed below.
8. **The dependency rule and the code disagree.** AGENTS.md says nothing in a feature group may import from
   `src/components/org/shared`. The Overview imports `DIMS`, `RepoDimensionModal`, `ScopeFilterBar`, `Meter`,
   `BillingReturnNotice` from there today, and v2 had to keep two of them (`DIMS`, the modal) because the modal is
   the drill-in. Either the rule needs an "existing imports stay" clause or those move into `src/components/kit`.
9. **Ledger step is awkward.** `coverage.mjs open-batch` refused because `standing/overview` was already in-batch from
   `kit-0`. A module that goes through two passes needs a way to re-open or attach to a second batch.
10. **Bash heredocs of TSX failed twice** ("unexpected EOF while looking for matching `'`") and ran nothing. Use the
    file-writing tool for source files, python scripts for edits. Worth a line in Pitfalls.
11. **Estimated cost per step**, in rough order: design and build of v2 (the largest), instruments (step 9 and 7),
    extraction, test repair, docs. The extraction commit was cheap and made everything after it reviewable; keep it first.

## Extraction candidates found (not done)

- `trajectoryView` (`trajectoryRead.ts`) is stated once, but `OverviewTrajectoryCard` (v1) still has its own copy; a
  source-scan test pins the card's text.
- The **"movement basis" fragment** (arrow, value, `deltaLabel`, sr-only sentence) exists three times now:
  `OrgScoreBadges` (v1), `StandingMasthead.Movement` (v2) and, in spirit, the ledger row. It wants a kit
  `Movement` part before the Executive, Delivery and Adoption modules copy it a fourth time.
- **`Legend`/`StateSwatch`/`HeatVoid`** (the void and not-judged marks) live in `components/org/viz` and this module.
  Every v2 surface needs them; they belong in the kit as `VoidMark`.
- The **repo row** (`RepoCategoryRollupRow`) was reused as is inside a v2 group; it is still a mono path row with
  stack icons. It is the next thing to redesign, and it recurs in Repositories, Passports and Security.
- A kit **`FilterMenu`**: `FilterMenu.tsx` is generic and is duplicated in spirit by other tabs' filter chips.

## Proposals for the recipe and the kit

1. Name the two instruments in steps 7 and 9, put roles files under `scripts/kit/roles/<module>.json`, and require a
   roles file per batch (it is the reviewable form of "hold the port to the design").
2. Add to step 3: grep `readFileSync`/source-scan tests for the entry file, and update them to bind both compositions.
3. Add D3b to the language spec (or reject it) and list the mono-prose classes still unconverted.
4. Decide the hue-versus-meaning conflict before the next module (see the defect list): every module that draws
   dimensions will meet it.
5. Give `Masthead` a sibling for tabs that have no single standing (`Section`-level lead with figures) so modules
   without a headline number do not invent one.

## Defects I see in the Prism shots (honest)

1. **D1 AI Tooling is red and its bar is full (score 100).** Hue names the dimension, but red reads as danger; on a
   healthy fleet the first line on the page looks like an alarm, and D4 yellow / D3 amber look like warnings. This is
   open conflict 1 in `BRAND-PRISM.md`, now visible in the product. Not decided here.
2. **The masthead is modest.** `page` is 2.25rem (decision D1); at 1920 the statement occupies a third of the
   width and the right two thirds are empty above the figures. It is the dominant element but not a commanding one.
3. **The trajectory reads as a footnote.** When the fit cannot be presented it is one caption line between two large
   sections. When the fit can be presented, v2 still draws the v1 `Trajectory` card (a boxed `Surface`); not checked here
   because the seeded org has 7 days of history.
4. **Fix first is the one boxed object, and its impact track is an empty hairline plus dashes** on this data; it is
   v1's component with Prism CSS, not a v2 composition. Its mono `review queue` link and the ranked numeral ring are v1 idiom.
5. **The "Guided setup" drawer tab overlaps the right edge** at 1280 and clips the sparkline label. That is the app
   overlay, present in Altimeter too.
6. **The trend sparkline is tiny** (a thin green line, no axis, no floor), the weakest graphic on the page.
7. **The dimension lines' second row is dense**: status word, reading, movement and two links across one line at 13px;
   at 1280 it wraps unevenly.
8. **The repo rows in the fleet are still v1** (mono `owner/name`, stack icons, `LN` chip, right-aligned figures).
9. **Not checked:** keyboard and screen-reader behaviour of the matrix header sort and the cell buttons beyond the
   v1 tests that still pass; contrast of `text-warn` numbers on the void; mobile widths (390).

## Left for follow-up in v1 (not changed here)

- The "not judged" heuristic (item 7 above) still draws a bar for a dimension with no scored repo.
- The duplicated trajectory gate in `OverviewTrajectoryCard`.
