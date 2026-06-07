# UI Perfectionist Fix Wave 1 — Design-token unification

> 5 commits, 7 findings closed (1 high · 5 medium · 1 low).
> Baseline preserved: tsc 0→0 errors · eslint 0 err/3 warn → 0 err/3 warn · `next build` passes.

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `95a00c5` | SP#2, SP#3 | high, medium | `src/components/ScanForm.tsx` |
| 2 | `f36f195` | SP#4 | medium | `src/app/page.tsx`, `src/components/Brand.tsx` |
| 3 | `41e8000` | OD#5 | medium | `src/app/org/[slug]/contributors/page.tsx` |
| 4 | `011fd93` | UB#3, UB#4 | medium, medium | `src/app/usage/page.tsx`, `src/components/usage/UsageTrend.tsx` |
| 5 | `21bd066` | OS#3 | low | `src/components/SignInNotice.tsx` |

## What was fixed (grouped by sub-pattern)

1. **Raw `red-*` / hex → danger & on-accent tokens (ScanForm).** The hero form encoded its error state as `border-red-500/70` + `text-red-400` and the submit button as the literal `text-[#04070e]`. These now use `border-danger/70`, `text-danger`, and `text-on-accent` — the exact tokens `globals.css` documents as the replacements for those literals.
2. **Repeated `#080d1a` → `--color-ink` (hero + header).** The hero gradient (`via-[#080d1a]/35 to-[#080d1a]`) and the sticky header (`bg-[#080d1a]/80`) both hand-repeated the canvas color. Now `via-ink/35 to-ink` and `bg-ink/80`, single-sourcing the canvas color.
3. **Threshold colors → warn/accent tokens (contributors tab).** The solo-maintainer tile, concentration meter, and bus-factor cell hard-coded `#f97316`/`#3b9eff`. Because these flow into inline `style` (Tile/Meter `color` prop), they now pass `var(--color-warn)` / `var(--color-accent)`; the no-warning tile passes `undefined` to inherit the component default.
4. **Usage accent token + one free-series color.** `#3b9eff` → `var(--color-accent)` across the usage bars and `UsageTrend`'s `BILLABLE`. The "free (public)" series had drifted across **three** greys (`#475569` legend/bars, `#94a3b8` summary text, `#64748b` page bar) — collapsed to one `FREE = #94a3b8`, deliberately the readable value so no contrast regression while gaining consistency.
5. **Canonical notice-icon size (SignInNotice).** `text-4xl` → `text-5xl` to match `EmptyState`, the canonical notice scaffold (whose docstring explicitly records icon-size drift as a past bug).

## Verification (before / after)

| Gate | Before (baseline) | After Wave 1 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `eslint` | 0 errors, 3 warnings | 0 errors, 3 warnings (same 3, pre-existing) |
| `next build` | n/a | ✅ pass (all routes compiled, Tailwind tokens resolved) |

No new lint warnings; the 3 remaining are pre-existing (`InstallationRepos.tsx` ×2 useMemo-deps, `vitest.config.js` anonymous-default — out of scope here).

## Cumulative status (across all waves so far)

| Wave | Theme | Closed | Cumulative |
|---|---|---:|---:|
| 1 | Design-token unification | 7 | 7 / 40 |

Remaining: **33 findings** across Waves 2–7.

## Patterns established (catalogue items 1–4)

1. **Token-over-hex** — Tailwind v4 `@theme` tokens (`--color-danger`, `--color-accent`, `--color-accent-soft`, `--color-ink`, `--color-on-accent`, `--color-warn`) auto-generate full utility families (`bg-`, `text-`, `border-`, `from-`/`via-`/`to-`) plus `/opacity` modifiers. Never hand-write the equivalent raw literal (`red-500`, `#04070e`, `#080d1a`, `#3b9eff`, `#f97316`) — grep these hexes to find token-bypass sites.
2. **Inline-style needs the CSS var, not the class** — a component whose `color` prop lands in `style={{}}` (Tile, Meter, SVG `fill`/`backgroundColor`) cannot consume a Tailwind color *class*. Pass `var(--color-*)` so it still references the token. This is the bridge between the token system and dependency-free inline SVG charts.
3. **One series, one color** — a data series (free vs billable, etc.) must use a single color across its legend swatch, its bars/marks, and its count text. When the same value is used as text, pick a shade that clears AA contrast so the text use can't justify spawning a third shade.
4. **Canonical-size adherence** — shared scaffolds define the scale (notice icon = `text-5xl` per `EmptyState`). A one-off that re-creates the scaffold must match the canonical scale, not drift. (This wave fixed the icon size; the deeper fix — reusing `EmptyState` itself — is Wave 2.)

## What remains

- **Wave 2** — Notice / EmptyState consolidation (the structural follow-on to pattern #4): OS#1, OS#2, RT#3, OD#2, CO#3, UB#6.
- **Waves 3–7** — chart/badge data-viz language, cross-page funnel layout, tabular-row extraction, landing cohesion, trends/a11y finishing. See `INDEX.md` → "Suggested next-phase split".
