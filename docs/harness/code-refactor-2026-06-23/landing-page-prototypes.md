# Code Refactor — Landing Page Prototypes
> Context group: Marketing Site & Design System
> Total: 5 findings (Critical: 0, High: 1, Medium: 3, Low: 1)

The context is, for production code, in good shape: `IndexLanding` is the live homepage (`src/app/page.tsx:79`), every section component is wired through `IndexVariant`, and the shared `content.ts` / `levelRamp.ts` helpers are genuinely consumed. The cruft that remains is a consistent cluster of **orphaned helpers left over from the now-deleted "Flight Deck" prototype**. The surviving "Index" treatment renders the dimension matrix as plain `bg-accent` bars (`DimensionMatrix.tsx` → `CellBar`), so the old heat-cell tinting/contrast helpers, the `levelHex` fallback wrapper, and two `MatrixRow` fields are no longer read by anything except their own unit test. None of these are reachable dynamically (no string-keyed lookups, no barrel re-exports — there is no `index.ts` in `prototypes/`), and removing them is behavior-preserving.

---

## 1. Dead heat-cell helpers `weightTint` / `weightText` kept alive only by their test
- **Severity**: High
- **Category**: dead-code
- **File**: src/components/landing/prototypes/shared/matrixData.ts:58-70
- **Scenario**: `weightTint(w, min, max)` and `weightText(w)` compute an azure alpha-tint and a contrast-aware numeral color for a "tinted matrix cell". No component imports either function. The only references in the entire repo are in `matrixData.test.ts:7-8,43-47`, which exist solely to test these two functions. The surviving consumer, `DimensionMatrix.tsx`, abandoned the tinted-cell treatment in favor of a horizontal `bg-accent` bar (`CellBar`, lines 16-37) and never calls them.
- **Root cause**: These helpers powered the older "Flight Deck" prototype's heat-cell grid (the function comment even says "mirrors heatCell's logic"). When the Index direction migrated to the bar-gauge treatment and the Flight Deck variant was deleted, the helpers were orphaned but not removed — and their test kept them from showing up as unused in lint/tsc.
- **Impact**: ~13 lines of production code plus a test block that asserts behavior nothing depends on. It misleads maintainers into thinking a tinted-cell rendering path is live, and any future change to `DimensionMatrix` invites "should I keep these in sync?" confusion. Pure maintenance/confusion cost; no runtime cost (tree-shaken from the client bundle since nothing imports them).
- **Fix sketch**: Delete `weightTint` (lines 58-63) and `weightText` (lines 65-70) from `matrixData.ts`. Remove the corresponding imports (`weightText`, `weightTint`) and the `it("weightTint scales alpha…")` block (lines 43-48) from `matrixData.test.ts`. `MAX_WEIGHT` stays — it is still used by both `DimensionMatrix.CellBar` and the remaining tests.

## 2. `MatrixRow.short` field is written but never read (drags in an otherwise-unneeded import)
- **Severity**: Medium
- **Category**: dead-code
- **File**: src/components/landing/prototypes/shared/matrixData.ts:13,39 (+ import at line 7)
- **Scenario**: `MatrixRow` declares `short: string` (line 13) and `buildMatrixRows` populates it via `short: DIMENSION_SHORT[d.id]` (line 39). Nothing ever reads `row.short`: `DimensionMatrix.tsx` renders `r.id`, `r.name`, `r.axis`, `r.description`, and `r[c.key]`, but never `r.short`, and `matrixData.test.ts` asserts `id/name/axis/base/solo/team/org` but not `short`. The field is the only reason this module imports `DIMENSION_SHORT` from `@/lib/ui` (line 7).
- **Root cause**: `buildMatrixRows` was built as a superset row model for multiple prototype variants; the surviving Index matrix uses the full `name`, so the abbreviated `short` label was never wired up and became vestigial after the other variants were dropped.
- **Impact**: A dead field on a shared interface plus an unnecessary cross-module import, both of which suggest a "short label" rendering path that does not exist. Low runtime cost; real confusion cost on a shared data shape.
- **Fix sketch**: Remove `short: string;` (line 13), the `short: DIMENSION_SHORT[d.id],` assignment (line 39), and the now-unused `import { DIMENSION_SHORT } from "@/lib/ui";` (line 7). `DIMENSION_SHORT` remains heavily used across `src/components/report/*` and `src/app/org/*`, so deleting this one import is safe and local. No callers read `.short`, so no consumer updates are needed.

## 3. Unused export `levelHex` (dead wrapper around `LEVEL_HEX`)
- **Severity**: Medium
- **Category**: dead-code
- **File**: src/components/landing/prototypes/shared/levelRamp.ts:15-17
- **Scenario**: `levelHex(id)` is a thin wrapper that returns `LEVEL_HEX[id] ?? LEVEL_HEX.L1`. A repo-wide grep finds it defined here and referenced nowhere else (not in components, not in tests). Every prototype that needs a level color imports `LEVEL_HEX` from `@/lib/ui` directly (`ScoreGauge.tsx:10`, `TrajectoryChart.tsx:10`, `IndexLevels.tsx:8`) and applies its own `?? "#3b9eff"` fallback inline (`TrajectoryChart.tsx:35`), bypassing this helper entirely.
- **Root cause**: A convenience accessor added when the ramp module was first carved out, then sidestepped once components settled on importing `LEVEL_HEX` directly. The export kept it from being flagged as unused.
- **Impact**: A dead public-looking export on a shared module; invites future callers to adopt a redundant indirection (and a different fallback color than the inline `#3b9eff` the charts actually use). Cosmetic but on a shared surface.
- **Fix sketch**: Delete `levelHex` (lines 15-17). The `LevelId` type import at line 6 is still required by `RAMP_STOPS`/the module's typing — keep it. `RAMP_STOPS` and `bandMid` are both live (`TrajectoryChart.tsx:11,27,88`), so leave them.

## 4. Unused exported type `ArchetypeKey`
- **Severity**: Low
- **Category**: dead-code
- **File**: src/components/landing/prototypes/shared/matrixData.ts:28
- **Scenario**: `export type ArchetypeKey = (typeof ARCHETYPE_COLUMNS)[number]["key"];` is exported but never referenced by name anywhere in the repo. `DimensionMatrix.tsx` indexes rows with `r[c.key]` where `c` is inferred from `ARCHETYPE_COLUMNS` (`as const`), so the indexing already type-checks structurally without ever naming `ArchetypeKey`.
- **Root cause**: A named alias created for readability/potential reuse that no caller ended up needing.
- **Impact**: Trivial — a single unused type export. Minor surface clutter on a shared module.
- **Fix sketch**: Delete line 28. No consumer updates needed. (If a maintainer prefers to keep the type for documentation, it is harmless; this is a low-priority tidy.)

## 5. Stale "migrated from Flight Deck prototype" comments reference a deleted sibling
- **Severity**: Low
- **Category**: cleanup
- **File**: src/components/landing/prototypes/index/DimensionMatrix.tsx:3-6; index/PricingCards.tsx:3-5; index/TrajectoryChart.tsx:3-6; shared/content.ts:3 ("Lifted verbatim from the original src/app/page.tsx")
- **Scenario**: Several header comments describe the code as "migrated from the Flight Deck prototype (the strongest levels chart)" / "the migrated Flight Deck card layout" and contrast it against treatments that no longer exist in the tree. There is no remaining `FlightDeck`/`flight-deck` file (grep is clean) and only one variant (`IndexVariant`) ships, so the migration framing is now stale narrative rather than orientation.
- **Root cause**: Comments written during an A/B prototype phase when multiple variants coexisted; the losing variants were deleted but their references in the surviving files' headers were left behind.
- **Impact**: Purely cosmetic, but it sends a maintainer hunting for a "Flight Deck" variant and an A/B harness that no longer exist, and implies decorative-vs-real-data tradeoffs that are no longer in play. No code risk.
- **Fix sketch**: Trim the comparative/migration clauses to describe what the component *is* now (e.g. "Dimensions section: a bar-gauge matrix of the 9 dimensions × 3 archetype lenses, real `ARCHETYPE_WEIGHTS`"). Behavior-preserving; comment-only. Lowest priority — bundle into one of the deletions above rather than as standalone churn.
