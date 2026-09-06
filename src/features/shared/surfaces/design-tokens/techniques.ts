// The drawer entries for the design-tokens scene: one per technique of the registry's `design-tokens`
// subject (authored against sha256:285d0bf6dac74e64, 2026-09-06). `mechanism` is the React/Tailwind
// mechanism the region demonstrates; `source` is the scene's own code; `inAscent` cites a real Ascent
// file read during the run; `deviation` names where Ascent or the scene falls short of the technique.

import type { SurfaceTechnique } from "../surfaceBody";
import * as S from "./sources";

export const techniques: readonly SurfaceTechnique[] = [
  {
    slug: "token-taxonomy",
    title: "Token taxonomy",
    mechanism:
      "tokens.ts holds the two layers in one file: a raw slate ramp nothing renders from, and eight color roles named `<axis>-<role>[-<variant>]`, each with a one-sentence definition and a binding per theme. " +
      "The ledger renders both layers side by side so the direction of flow is visible: primitives feed roles, roles feed the preview, nothing skips a layer. " +
      "The admission desk judges a candidate name in two passes: `judgeName()` refuses a value in the name (`gray-700-text`) and a call site in the name (`settings-page-header-border`) before the grammar, then three toggles stand for the three tests a token must pass. " +
      "The verdict defaults to 'use the nearest role'; 'earns a name' appears only when the grammar holds and all three tests pass.",
    source: S.SRC_TAXONOMY,
    inAscent: {
      file: "src/app/globals.css",
      note: "The `@theme` block binds color roles by intent (`--color-surface`, `--color-divider`, `--color-on-accent`) with the drift each one replaced recorded beside it, and the `type-*` utilities are typography recipes, not loose sizes.",
    },
    deviation:
      "Only color and type have role layers. Radius, spacing and elevation are raw Tailwind utilities at every call site, and text colour is the palette primitive (`text-slate-400`) consumed directly, the skipped-layer anti-pattern the brand guide itself prescribes.",
  },
  {
    slug: "theme-architecture",
    title: "Theme architecture",
    mechanism:
      "`resolveTheme(pref, platform)` is the three-state model in one line: an explicit choice wins in both directions, `system` follows the simulated platform toggle. " +
      "The resolved theme is stamped on the scene root as `data-theme` and its binding set is generated onto the same root by `scopeVars()`; the preview card references `var(--sx-<role>)` and never asks which theme it is in, which the 'components branching on theme: 0' readout states as a contract. " +
      "`completeness()` proves every role bound in every theme and recomputes each contract pair's contrast from the actual bindings with Ascent's own luminance math. " +
      "'Drop foreground-muted from light' removes one custom property from the light binding: the gate turns red and, in light, the preview's muted line silently inherits the foreground colour, the defect shown rather than described. " +
      "The nested pane binds the opposite theme on a child scope with the same markup, so nested scopes fall out of variables for free.",
    source: S.SRC_THEME,
    inAscent: {
      file: "src/lib/ui.ts",
      note: "`readableTextOn()` and `heatCell()` choose the foreground for a fill by WCAG contrast arithmetic (`rgbOf`, `relLuminance`), the computed on-colour clause; the scene's contrast column reuses those two helpers.",
    },
    deviation:
      "Ascent has one theme: a single `:root` binding with `html { color-scheme: dark }`, no light set, no `data-theme` scope, no system-preference state, so completeness is trivially true and nothing can rebind.",
  },
  {
    slug: "cross-language-token-parity",
    title: "Cross-language token parity",
    mechanism:
      "Two strategies sit side by side. The style-layer copy of every token is generated: `scopeVars()` writes `--sx-row-h` from `DENSITY[density]['row-h']`, and the preview's SVG reads the same number from the same object for its height, so the chart and the card cannot disagree. " +
      "The legacy hand-authored `LEGACY_MIRROR` is the acceptable floor, a gated mirror: `parityCheck()` enumerates both sets and reports a missing member, an unequal value, or a phantom that exists only in the mirror. " +
      "'Retune base to 300ms' moves the authority the way a motion retune does and the gate names the drift; 'phantom step' plants a member the design system never issued. " +
      "'Gate reads an empty file' is the honesty clause: with zero members on either side the gate reports a broken instrument, never parity. " +
      "The preview's rescan button waits on `transitionend`, not on a copied duration.",
    source: S.SRC_PARITY,
    inAscent: {
      file: "src/components/ui/format.ts",
      note: "`DIRECTION_TONE` keeps the tone triad as TS literals for inline styles and tests, paired with `--color-tone-*` in globals.css by a 'change BOTH together' comment; the two-runtime split is real and documented.",
    },
    deviation:
      "The pairing is strategy 4, hand-sync with a comment: no test compares `DIRECTION_TONE` or `BRAND_INK` (lib/site.ts) against globals.css, and og-brand.tsx exports a second `BRAND_INK` with a different value.",
  },
  {
    slug: "token-enforcement",
    title: "Token enforcement",
    mechanism:
      "`scan()` runs an allow-list-shaped rule family over a seeded fictional codebase sized by the volume knob: a px size, a hex, a raw radius or a between-steps duration is a finding, and every finding carries the equivalent it should have used. " +
      "The severity picker is the design decision made visible: `warn` passes the build with every finding counted and nothing enforced; `error` fails it; `ratchet` snapshots the open count at mount as the baseline and fails only on increase. " +
      "'Inline a raw value' is the deadline commit, and under `warn` it lands. " +
      "'Suppress one inline' is the loud escape hatch: the fixture's suppression names the rule and its reason, the count is a readout, and `suppressionPosture()` labels ten a policy and a hundred a dialect.",
    source: S.SRC_ENFORCEMENT,
    inAscent: {
      file: "src/components/ui/chip.ts",
      note: "`chipButtonClass` single-sources the chip and its comment records the `success` token expanding byte-identically to the old `emerald-500/300` classes, the lexical-invisibility case the technique names: adopter and violator read the same at the gate.",
    },
    deviation:
      "No raw-value rule exists: eslint.config.mjs carries one error-level gate with a do-not-add ratchet list, for the data-layer import boundary, not for tokens; 95 tsx files hold hex literals and the brand guide is enforced by review.",
  },
  {
    slug: "motion-tokens",
    title: "Motion tokens",
    mechanism:
      "`DURATION_MS` is a five-step ladder and `EASING` four roles named by choreography, not curve shape; `STEP_USE` states what each step is for so a change is placed by what is moving. " +
      "The picker asks which step three changes belong to and counts the answers on the ladder; the chip transitions on `var(--sx-duration-<step>) var(--sx-ease-move)` and never reads the preference. " +
      "Reduction is a token-layer decision: `ladderFor(true)` rebinds the travel steps to a 1ms epsilon (never zero, so `transitionend` still fires), keeps `instant` because a tint flip has no travel to remove, and flattens `expressive` to `move`; `motionVars()` writes that ladder onto the scope root. " +
      "The table's reduced column is the same function, so what the chip does and what the ladder says are one read. " +
      "`STAGGER_MS` sits in the same file: choreography constants scripts consume are vocabulary too.",
    source: S.SRC_MOTION,
    inAscent: {
      file: "src/app/globals.css",
      note: "One `@media (prefers-reduced-motion: reduce)` block collapses every `animate-*` utility and `.stagger-children`, with the rule 'never add a prefers-reduced-motion check at a call site' written beside it: token-layer honoring, one door.",
    },
    deviation:
      "There is no ladder: keyframes carry literals (`0.5s ease-out`, `0.9s`, `360ms cubic-bezier(…)`) per utility, and the reduce block sets `animation: none`, exact zero, so an awaited `animationend` never fires; only `.reveal-quiet` uses the 1ms epsilon.",
  },
  {
    slug: "density-and-scale-axes",
    title: "Density and scale axes",
    mechanism:
      "Density and text scale are two more rebindings at the same root as the theme: `DENSITY` binds `space-card`, `space-row` and `row-h` in px, `TYPE_BASE_PX` times the scale binds the three type recipes, and `scopeVars()` writes both slices. " +
      "`AXIS_OWNERSHIP` is the disjointness proof rendered as a matrix: each role has exactly one axis that may rebind it, so compact plus 1.3x composes without the axes fighting. " +
      "The preview reflows from both axes without knowing either exists. " +
      "The clip demo is the unit-discipline prerequisite: a 44px box clips two lines of body copy from 1.15x upward while the em-sized box grows; the verdict is arithmetic over the authority (`needed > FIXED_PX`), not a measurement, so it holds in jsdom and in a screenshot alike.",
    source: S.SRC_AXES,
    inAscent: {
      file: "src/app/globals.css",
      note: "The `@theme` type ramp was re-based one pixel over the framework defaults so 'a +1px step across the whole ramp lifts every surface at once': a text-scale rebinding executed once, by the author, with every consumer unaware.",
    },
    deviation: "No user axis exists: no density, no runtime text scale, no brightness, and no `data-*` stamp to hang one on; the +1px rebase is an authoring-time constant, not a preference.",
  },
];
