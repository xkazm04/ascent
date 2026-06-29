# Code Refactor — Design System: UI Primitives & Deck
> Total: 5 | Critical: 0 High: 2 Medium: 1 Low: 2

## 1. `toneFor` is dead — exported from format.ts and re-exported twice, zero call sites
- **Severity**: High
- **Category**: dead-code
- **File**: src/components/ui/format.ts:29 (def); src/components/ui/index.ts:14 (re-export); src/components/org/ui.tsx:11 (re-export)
- **Scenario**: `toneFor(delta)` classifies a numeric delta into a `DIRECTION_TONE` key. It is defined in `format.ts`, re-exported through the `ui` barrel (`index.ts`), and re-exported AGAIN through the org barrel (`org/ui.tsx`).
- **Root cause**: A repo-wide grep for `toneFor` returns ONLY the definition and the two barrel re-exports — there is no `toneFor(` call anywhere in `src` (including tests and dynamic usage). Consumers that need direction tone read `DIRECTION_TONE[...]` directly with their own up/down keys (e.g. `org/[slug]/page.tsx`, `executive/page.tsx`, `Trajectory.tsx`, `PortfolioTable.tsx`), bypassing `toneFor`. It was built as a convenience classifier that nothing adopted.
- **Impact**: A dead function carried through two public barrels: it reads as live API, invites new callers to a never-exercised path, and `format.test.ts` covers `deltaHex/signedDelta/fmtDelta` but not `toneFor`, so it is untested dead weight.
- **Fix sketch**: Delete `toneFor` from `format.ts`, then drop it from the `export { … toneFor }` lists in `ui/index.ts:14` and `org/ui.tsx:11`. No call sites to migrate.

## 2. The canonical `Stat` atom is re-implemented inline across the app
- **Severity**: High
- **Category**: duplication
- **File**: src/components/ui/Stat.tsx (canonical) vs src/app/usage/page.tsx:36-44, src/components/org/BacklogSummary.tsx:3-11, src/components/launch/FleetMapChrome.tsx:3-9, src/components/org/LiveWarRoomStat.tsx:48-55, src/components/about/AboutHero.tsx:13-23 (+ inline 65-71)
- **Scenario**: `components/ui/Stat.tsx` is the declared "one source of truth" for the mono-label + `tabular-nums` value block (and `org/ui.tsx`'s `Tile` correctly composes it). Yet at least five surfaces hand-roll their own version:
  - `app/usage/page.tsx` declares `function Stat(...)` whose value line `mt-1 font-mono text-3xl font-bold tabular-nums text-white` (line 40) is a character-for-character copy of `Stat.tsx:25`.
  - `org/BacklogSummary.tsx` declares another local `function Stat` (text-2xl variant).
  - `launch/FleetMapChrome.tsx` exports yet another `function Stat` (text-base variant).
  - `org/LiveWarRoomStat.tsx:53` inlines the same value-line class (`…text-3xl font-bold tabular-nums sm:text-4xl`).
  - `about/AboutHero.tsx` declares `function StatNum` and inlines the value line twice (17, 69).
- **Root cause**: The atom landed after these call sites, and each surface re-grew the same label+value markup instead of importing `Stat`. A brand restyle of the number block now has to be applied in 6 places.
- **Impact**: Drift risk and bundle/maintenance cost — exactly the "rogue copy" failure the atom was created to end. The five DOM copies diverge only in font-size/extra classes, all expressible via `Stat`'s `className`.
- **Fix sketch**: Replace the DOM-side local `Stat`/`StatNum` definitions with `import { Stat } from "@/components/ui"`, passing size overrides through `className`. NOTE: `lib/pdf/security-document.tsx:39` and `lib/pdf/briefing-document.tsx:55` also define `function Stat`, but those render `@react-pdf` `View`/`Text` primitives (not DOM) and legitimately cannot reuse the DOM atom — leave them out of the consolidation.

## 3. The `HairlineGrid` atom's class string is copied inline in deck-sibling files
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/ui/HairlineGrid.tsx:7 (canonical) vs src/components/about/AboutHero.tsx:65, src/components/about/RoiSimulator.tsx:98
- **Scenario**: `HairlineGrid` encapsulates the editorial hairline-cell bed: `grid gap-px overflow-hidden rounded-2xl border border-divider bg-divider`. `AboutHero.tsx:65` reproduces that string verbatim (`mt-10 … grid-cols-3 gap-px overflow-hidden rounded-2xl border border-divider bg-divider`), and `RoiSimulator.tsx:98` reproduces a near-identical variant (`rounded-xl` instead of `rounded-2xl`).
- **Root cause**: Both files predate or ignore the atom and hand-build the hairline grid, with children already setting their own `bg-ink`/`bg-surface` — i.e. they match `HairlineGrid`'s contract exactly.
- **Impact**: The hairline-rule signature is now maintained in three places; a divider-color or radius rebrand has to be hunted across literals — the duplication `HairlineGrid` exists to prevent.
- **Fix sketch**: In `AboutHero.tsx` replace the wrapper `div` with `<HairlineGrid className="mt-10 max-w-md grid-cols-3">`. For `RoiSimulator.tsx`, either reuse `<HairlineGrid>` (accepting `rounded-2xl`) or add a `radius` prop to `HairlineGrid` mirroring `Surface`'s, then switch the call site.

## 4. Barrel re-exports `StatProps` and `KickerTone` types with no consumer
- **Severity**: Low
- **Category**: dead-code
- **File**: src/components/ui/index.ts:5 (`KickerTone`), :8 (`StatProps`)
- **Scenario**: The `ui` barrel publicly re-exports `type { StatProps }` and `type { KickerTone }`. Repo-wide grep shows `StatProps` only in `Stat.tsx` (self) and the barrel; `KickerTone` only in `Kicker.tsx`, the barrel, and `SectionHeading.tsx` — and `SectionHeading` imports it directly from `./Kicker`, not via the barrel.
- **Root cause**: Types were surfaced as public API speculatively; nothing imports either name through `@/components/ui`.
- **Impact**: Minor — phantom public surface that suggests external consumers exist when none do. (Caveat: barrels sometimes export types deliberately as a stable public API, so this is low-confidence-of-intent rather than clearly accidental.)
- **Fix sketch**: If a pure-internal barrel is desired, drop the two `export type` lines from `index.ts`; otherwise leave with the understanding they are forward-looking API. The component exports (`Stat`, `Kicker`) stay regardless.

## 5. Format helpers are surfaced through two barrels, duplicating the public surface
- **Severity**: Low
- **Category**: structure
- **File**: src/components/org/ui.tsx:11 (re-exports from src/components/ui/format.ts via the ui barrel)
- **Scenario**: `format.ts`'s five helpers are exported by `ui/index.ts:14` and then re-exported wholesale by `org/ui.tsx:11` (`export { deltaHex, signedDelta, fmtDelta, DIRECTION_TONE, toneFor } from "@/components/ui"`). So the same "single source of truth" is reachable via two import paths, and org code consistently imports from `@/components/org/ui` while a few sites (e.g. `lib/scoring/gate-comment.ts`) import from `@/components/ui` — two conventions for one helper set.
- **Root cause**: An ergonomic re-export barrel grown so org files have one import; it now also drags the dead `toneFor` (finding #1) along, widening its dead surface.
- **Impact**: Low — mild "where is the canonical import?" confusion and a second place that must be edited when the helper list changes. Not harmful, but it dilutes the one-treatment promise the design system advertises.
- **Fix sketch**: Keep the convenience re-export if desired, but at minimum prune `toneFor` from it (per #1). Optionally document `@/components/org/ui` as the org-facing entry point and `@/components/ui` as the source, so the dual path is intentional rather than incidental.
