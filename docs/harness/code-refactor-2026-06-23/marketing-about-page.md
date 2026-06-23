# Code Refactor — Marketing About Page
> Context group: Marketing Site & Design System
> Total: 4 findings (Critical: 0, High: 1, Medium: 2, Low: 1)

## 1. `Metric` component + `mono`/`clamp01` constants duplicated across the two Remotion compositions
- **Severity**: High
- **Category**: duplication
- **File**: src/components/about/champion/ChampionComposition.tsx:11-32 and src/components/about/risk/RadarComposition.tsx:12-33
- **Scenario**: Both Remotion compositions independently declare three identical building blocks: `const mono = "var(--font-mono), ui-monospace, monospace"`, `const clamp01 = (v: number) => Math.max(0, Math.min(1, v))`, and a `Metric({ label, value, color })` function component whose JSX/inline-styles are byte-for-byte the same (`fontSize: 60, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1` value div + a `#94a3b8 fontSize:30 uppercase` label div). The only difference is a one-line explanatory comment above the champion copy.
- **Root cause**: The two compositions (`champion/` and `risk/`) were authored as parallel siblings — each built in isolation as "a Remotion diagram for /about" — so the shared metric-overlay chrome and helpers were copy-pasted rather than factored out. There is no shared module under `src/components/about/` for composition primitives.
- **Impact**: Two copies that must be kept in visual sync (the metric tiles are deliberately uniform across both diagrams). Any tweak to the composition-space typography (these render in the 960×540 space then downscale, so the magic `60`/`30` sizes are load-bearing) has to be made twice; they will silently drift. Extra surface area in two files for zero behavioral reason.
- **Fix sketch**: Add `src/components/about/compositionShared.tsx` (client-free; Remotion components are plain React) exporting `MONO`, `clamp01`, and a `Metric` component. Replace the local definitions in both `ChampionComposition.tsx` and `RadarComposition.tsx` with imports. Behavior-preserving: the JSX and constants are identical, so the rendered output is unchanged. Update the two `fontFamily: mono` references to the imported `MONO`.

## 2. Two separate RGB color-interpolation helpers doing the same job
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/about/champion/ChampionComposition.tsx:13-21 (`WEAK`/`STRONG` + `mix`) and src/components/about/risk/RadarComposition.tsx:16-24 (`hexToRgb` + `lerpHex`)
- **Scenario**: `ChampionComposition` interpolates weak→strong link color via `mix(t)`, which lerps between two hardcoded RGB triples (`WEAK = [248,113,113]` ≈ `#f87171`, `STRONG = [59,158,255]` ≈ `#3b9eff`) and returns `rgb(r,g,b)`. `RadarComposition` does the identical operation with `lerpHex(a, b, t)` (parsing two `#rrggbb` strings via `hexToRgb`, lerping each channel, returning `rgb(...)`). Both are channel-wise linear interpolation between two colors producing an `rgb()` string.
- **Root cause**: Same parallel-sibling authoring as finding #1 — each composition grew its own color-mix helper. The champion variant pre-baked its two endpoints as arrays; the radar variant kept a generic hex-string signature.
- **Impact**: Two implementations of the same primitive to read, test, and maintain; the comments noting which hex each array equals (`// #f87171`, `// #3b9eff`) are a manual sync hazard. Lower than #1 because the two functions have different signatures, so consolidation requires a small call-site change rather than a drop-in.
- **Fix sketch**: Move the generic `lerpHex(a: string, b: string, t: number)` (and its `hexToRgb`) into the shared `compositionShared.tsx` from finding #1. In `ChampionComposition`, delete `WEAK`/`STRONG`/`mix` and call `lerpHex("#f87171", "#3b9eff", t)` at the single `mix(t)` use site (line 56). Net result is one color-lerp helper; output is unchanged (the array values are exactly those two hexes).

## 3. Inlined "diagram card / glow backdrop" chrome repeated across deck sections
- **Severity**: Medium
- **Category**: structure
- **File**: src/components/about/AboutFeature.tsx:47-54 (diagram card) and src/components/about/AboutCTA.tsx:16-22 (Surface backdrop)
- **Scenario**: The decorative chrome of a deck panel — an `aria-hidden` `strata` layer plus an `aria-hidden` radial-gradient glow over a `relative` content wrapper — is hand-inlined in `AboutFeature` (the right-hand diagram card) and again in `AboutCTA` (inside the closing `Surface`). The markup shape is the same; only the gradient geometry/opacity values differ (`opacity-40` + `70% 60% at 50% 0%` vs `opacity-50` + `50% 60% at 50% 0%`).
- **Root cause**: The same visual motif ("strata + accent glow behind content") was needed in several sections and was copied inline each time instead of being captured as one small presentational wrapper.
- **Impact**: The backdrop recipe is duplicated, so a change to the strata/glow treatment must be applied in multiple places and can drift; the repeated `aria-hidden`/`pointer-events-none`/`relative` boilerplate also clutters the editorial JSX. Kept at Medium because the per-section tuning values legitimately differ, so the extraction must be parameterized rather than a literal copy.
- **Fix sketch**: Add a small `GlowBackdrop` presentational component (e.g. in `src/components/about/`) that renders the `strata` layer + a radial-gradient layer from `glow`/`opacity`/`className` props and wraps `children` in the `relative` div. Replace the inlined blocks in `AboutFeature` and `AboutCTA`, passing each section's existing gradient string and opacity so the visuals are byte-identical. Behavior-preserving: pure markup relocation.

## 4. `AboutReveal.tsx` is a pass-through re-export shim
- **Severity**: Low
- **Category**: structure
- **File**: src/components/about/AboutReveal.tsx:1-3
- **Scenario**: The entire file is `export { Reveal as AboutReveal } from "@/components/deck/Reveal";`. Four sibling files (`AboutFeature`, `AboutCTA`, `AboutCost`, `AboutTransition`) import `AboutReveal` from `./AboutReveal` rather than importing `Reveal` from the canonical `@/components/deck/Reveal` (which the homepage `IndexVariant.tsx` already imports directly).
- **Root cause**: A compat alias left behind when the page-specific `AboutReveal` was generalized into the shared deck `Reveal` — the shim preserved the old import name to avoid touching call sites at the time.
- **Impact**: Minor indirection: one extra file and an alias that hides the fact that /about uses the same shared `Reveal` as the rest of the deck. Cosmetic only — the shim is correct and intentional, so this is opt-in cleanup, not a defect.
- **Fix sketch**: Optionally delete `AboutReveal.tsx` and change the four `import { AboutReveal } from "./AboutReveal"` sites to `import { Reveal } from "@/components/deck/Reveal"` (and rename the in-file usages `<AboutReveal>` → `<Reveal>`). Purely mechanical and behavior-preserving. Skip if the indirection is preferred as a stable local name.
