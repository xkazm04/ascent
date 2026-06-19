# Ascent — brand & visual identity

**Ascent** measures how AI-native an engineering org is and charts its climb to the next level. The
visual identity is **"The Index"**: an editorial, instrument-grade reading of a repository — calm,
authoritative, and unmistakably about *elevation*.

Import everything from `@/components/ui`. Reach for a primitive before hand-rolling chrome.

## Principles

1. **Editorial, not decorative.** Hairline rules, generous rhythm, a mono dateline voice. Restraint reads as authority.
2. **One azure on cold ink.** A single accent (`--color-accent` `#3b9eff`) over the ink canvas. Color is earned, never sprinkled.
3. **The climb is the story.** The red→green level ramp (`LEVEL_HEX`, L1 `#ef4444` → L5 `#22c55e`) and the ascending motif (strata, the index ring, the trajectory) carry meaning — use them for levels/scores, nothing else.
4. **Numbers are typeset.** Every metric is `font-mono … tabular-nums`. Labels are mono, uppercase, wide-tracked.
5. **Motion is a beat, gated.** Entrances and draw-ons only; everything degrades under `prefers-reduced-motion`. No always-on loops.

## Tokens (`globals.css` `@theme`)

| Token | Value | Use |
|---|---|---|
| `--color-accent` / `bg-accent` `text-accent` | `#3b9eff` | the one accent |
| `--color-accent-soft` | `#7bbcff` | hover / brighter accent |
| `--color-ink` | `#080d1a` | page canvas |
| `--color-surface` → `bg-surface/40` | `#0f172a` | panel base (translucent so the canvas shows through) |
| `--color-surface-strong` → `bg-surface-strong/40` | `#020617` | deeper panel (charts) |
| `--color-divider` → `border-divider` | `#1e293b` | **the** hairline — card borders + rules |
| `--color-on-accent` | `#04070e` | text on `bg-accent` |
| `--color-danger` / `--color-warn` | `#ef4444` / `#f97316` | error / warning |
| `LEVEL_HEX` (`@/lib/ui`) | red→green | level/score color, only |

`.strata` (altimeter rule-lines), `.focus-ring`, `.animate-fade-up/-meter` remain the shared motion/texture utilities.

## Primitives (`@/components/ui`)

- **`Kicker`** — mono uppercase eyebrow. `tone="accent"` (section eyebrow) | `"muted"` (metadata/table head). Replaces hand-rolled `font-mono uppercase tracking-widest` labels.
- **`Surface`** — the panel: `rounded-{xl|2xl} border border-divider bg-surface/40`. Caller sets padding. Pass `id` for a scroll-anchored panel.
- **`Stat`** — mono label + `tabular-nums` value + optional `delta`/`goal`. Compose inside a `Surface` for a tile.
- **`SectionHeading`** — `kicker` + `title` + `intro` + `right`. `size="page"` (editorial top, text-2xl/3xl) | `"lg"` (dashboard section) | `"sm"` (in-card).
- **`HairlineGrid`** — a `gap-px` grid over `bg-divider`; children set `bg-ink` so gaps read as hairlines. The editorial cluster (levels, pricing, ledgers).
- **`Dateline`** — masthead metadata row + hairline under-rule. The "publication" header.
- **`deltaHex` / `fmtDelta` / `signedDelta`** — period-over-period delta color + arrowed text (lime up · orange down · slate flat).

## Conventions

- New UI uses the primitives; don't re-hardcode `border-slate-800 bg-slate-900/40` or mono-label strings — use `Surface` / `Kicker`.
- Level/score color comes from `LEVEL_HEX` / `scoreHex` (`@/lib/ui`); never pick a hex by hand.
- Charts are dependency-free SVG **or** Recharts styled to these tokens (divider grid, mono axes, ramp fills) — see the landing's `TrajectoryChart` and the report charts.
