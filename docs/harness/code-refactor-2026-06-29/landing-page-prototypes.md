# Code Refactor — Landing Page Prototypes
> Total: 5 | Critical: 0 High: 0 Medium: 2 Low: 3

_Scope note: every component in scope is live. `src/app/page.tsx` (the index route) renders `IndexLanding` → `IndexVariant`, which mounts IndexHero / IndexOrg / IndexGallery / IndexLevels / DimensionMatrix / PricingCards. `ScoreGauge` and `shared/useCountUp` are additionally reused by `src/components/about/AboutHero.tsx`. Nothing in scope is dead at the file/component level — no whole variant is unrouted. (`EditorialSteps.tsx` listed in scope does not exist on disk.) The shared SVG ring `ScoreGauge` vs report `ScoreRing` was checked for duplication and is **not** a real dup — one draws 5 equal level arcs as a calibration scale, the other draws a single score-length arc; only ~4 lines of donut geometry overlap, not worth consolidating._

## 1. Deck-section wrapper className duplicated across 8 components
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/landing/prototypes/index/IndexGallery.tsx:40, DimensionMatrix.tsx:41, IndexLevels.tsx:15, PricingCards.tsx:13, IndexOrg.tsx:52 (+ src/components/about/AboutTransition.tsx:11, AboutFeature.tsx:28, AboutCost.tsx:25)
- **Scenario**: Eight `<section>`s carry the byte-identical class string `flex min-h-screen snap-start flex-col justify-center pb-10 pt-14` (the full-viewport scroll-snap deck pane). Five are in this context; three more in the sibling `about/` deck.
- **Root cause**: The snap-deck pane layout was copy-pasted into each section rather than centralized, even though a shared `@/components/deck` namespace already exists (DeckNav, Reveal, useSnapDeck) and is the natural home.
- **Impact**: Any tweak to deck pane spacing/snap behaviour (e.g. `pt-14` → `pt-16`) must be hand-edited in 8 places; easy to drift one pane out of alignment with the rest of the deck.
- **Fix sketch**: Export a `DECK_PANE` class constant (or a thin `<DeckSection id className>` wrapper) from `@/components/deck`, and replace the literal in all 8 sections. A wrapper also lets `id`/`snap-start` be enforced consistently.

## 2. Stale "prototypes / variant / A-B" framing for the single production landing
- **Severity**: Medium
- **Category**: naming
- **File**: src/components/landing/prototypes/ (directory name); index/IndexVariant.tsx:17; types.ts:1-3; IndexLanding.tsx:3; matrixData.ts:1; levelRamp.ts:2
- **Scenario**: The code lives under `landing/prototypes/`, the root component is named `IndexVariant`, and comments describe "landing-page prototype **variants**", payload "passed into every **variant**", and "as we **A/B between directions**". In reality there is exactly one variant, there is no variant gallery/switcher, and `IndexLanding.tsx` itself opens with `// Production landing`. `page.tsx` imports only `IndexLanding`.
- **Root cause**: The folder began as an experimental A/B gallery of competing landing directions; all but "The Index" were dropped and it was promoted to production, but the exploratory naming/comments were never retired.
- **Impact**: Misleads maintainers into thinking these are throwaway experiments (the kind that can be deleted) when they are the live homepage; the "be careful, a variant may be intentionally kept" ambiguity this scan was warned about is self-inflicted by the naming.
- **Fix sketch**: Rename the directory to `landing/index/` (or `landing/home/`), rename `IndexVariant` → `IndexLanding` body (or fold it into IndexLanding), and update the "variant/A-B/prototype" comments in types.ts, matrixData.ts, levelRamp.ts to describe a single production landing. Pure rename + comment edit; no behaviour change.

## 3. `MatrixRow.base` is computed and unit-tested but never rendered
- **Severity**: Low
- **Category**: dead-code
- **File**: src/components/landing/prototypes/shared/matrixData.ts:16,36 (and test assertion matrixData.test.ts:20)
- **Scenario**: `MatrixRow` declares `base: number` and `buildMatrixRows()` populates it (`base: d.weight`). The only consumer, `DimensionMatrix.tsx`, renders `id`, `name`, `axis`, `description`, and the `solo`/`team`/`org` cells — it never reads `r.base`. The field's sole reference outside its own definition is a test assertion that re-checks the value it was just set to.
- **Root cause**: Leftover from an earlier matrix design that displayed the base (org-default) weight column; the column was removed but the data field and its guarding test were left behind.
- **Impact**: Dead computed surface kept alive only by its own test — readers assume `base` is displayed somewhere, and the test pins a field with no product consumer.
- **Fix sketch**: Drop `base` from the `MatrixRow` interface and from the `buildMatrixRows` mapping, and remove the `expect(r.base)...` line in matrixData.test.ts. Or, if the base column is genuinely wanted, surface it in DimensionMatrix.

## 4. "Ghost button" outline-link className repeated 3× (IndexHero + IndexGallery)
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/landing/prototypes/index/IndexHero.tsx:60; IndexGallery.tsx:105,111
- **Scenario**: Three `<Link>`s share the identical outline-button class string `focus-ring inline-flex items-center gap-2 rounded-md border border-slate-700 px-… py-… font-mono text-xs uppercase tracking-widest text-slate-300 transition hover:border-accent hover:text-white` (only the `px`/`py` padding differs: `px-4 py-2` in the hero, `px-3 py-1.5` in the gallery CTAs).
- **Root cause**: The same secondary-CTA visual was hand-copied into each call site instead of being a shared element.
- **Impact**: Three places to update on any hover/border/typography change to the secondary CTA; risk of the three drifting apart visually.
- **Fix sketch**: Extract a small `<GhostLink href size?>` (or a `GHOST_LINK` class constant with a `size` modifier for the padding) and reuse it at all three sites; candidates for the same brand-kit `@/components/ui` barrel that already exports Kicker/Dateline/SectionHeading.

## 5. `PricingTier` interface exported but only used internally
- **Severity**: Low
- **Category**: dead-code
- **File**: src/components/landing/prototypes/shared/content.ts:4
- **Scenario**: `export interface PricingTier` is referenced only inside content.ts (the `buildPricing` return type and the `PRICING_PAID` literal). No other module imports it — `PricingCards.tsx` imports `buildPricing` only and reads tier fields via inference.
- **Root cause**: Exported by default alongside `buildPricing`, but no external consumer ever needed the named type.
- **Impact**: Minor — an exported name that suggests a cross-module contract that doesn't exist, slightly widening the module's public surface.
- **Fix sketch**: Drop the `export` keyword (keep the interface for internal typing). Trivial; verify with tsc that nothing breaks.
