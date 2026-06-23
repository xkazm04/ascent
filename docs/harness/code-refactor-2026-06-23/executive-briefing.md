# Code Refactor — Executive Briefing
> Context group: Org Planning & Execution
> Total: 3 findings (Critical: 0, High: 2, Medium: 0, Low: 1)

The Executive Briefing context is, overall, in good shape: the data assembly (`buildExecBriefing`) and serializers (`briefingMarkdown`) are well-factored, single-sourced, and thoroughly tested; no `console.log`, commented-out code, or stale TODOs were found in any of the nine files. The cruft that does exist is concentrated in one place: the read-only share page (`/share/briefing/[token]`) was clearly built by copy-pasting render blocks out of the authenticated executive page rather than extracting shared components, so two near-identical UI blocks now live in both files — and the copies have already begun to drift. Plus one tiny dead export.

---

## 1. Dimension-row markup duplicated three times across the exec + share pages

- **Severity**: High
- **Category**: duplication
- **File**: `src/app/org/[slug]/executive/page.tsx:283-291` (the `DimRow` helper) and `src/app/share/briefing/[token]/page.tsx:102-108` + `:114-120` (two inline copies)
- **Scenario**: The "Strengths" and "Weakest dimensions" cards render one row per dimension as `<span class="w-24 shrink-0 text-slate-400">{dimId} · {label}</span>` + `<Meter className="flex-1" value={avg} color={scoreHex(avg)} />` + a right-aligned `<span class="w-7 text-right font-mono tabular-nums" style={{ color: scoreHex(avg) }}>{avg}</span>`. The executive page factors this into a local `DimRow` component and uses it three times (strengths, risks, the appended D9 security row). The share page reproduces the *exact same JSX* inline — once in its Strengths card (lines 102-108) and again, character-for-character, in its Weakest-dimensions card (lines 114-120) — because `DimRow` is a module-private function in `page.tsx` and isn't importable.
- **Root cause**: The share page (`/share/briefing/[token]`, EXEC-6) was added later as a session-less mirror of the briefing tab and was assembled by copying the executive page's render blocks. `DimRow` was never promoted to a shared component, so the share page couldn't reuse it and inlined the markup instead.
- **Impact**: Four copies of the same row layout (1 component + 3 call sites that all hard-code the same Tailwind widths/colors, and 2 fully-inlined duplicates). Any tweak to the dimension row — column width, score color rule, adding a delta, the `w-24`/`w-7` sizing — must be made in three files or the public share view silently diverges from the in-app view. It also bloats the share page and obscures that the two views are meant to be identical.
- **Fix sketch**: Extract a `DimRow` (or `BriefingDimRow`) component into `src/components/org/` (e.g. alongside `Meter`/`Tile` in `ui.tsx`, since it already lives in that kit's vocabulary), typed `{ dimId: string; label: string; avg: number }`. Replace the local function + 3 call sites in `executive/page.tsx`, and the 2 inline blocks in `share/briefing/[token]/page.tsx` (the strengths `.map` at 102-108 and the risks `.map` at 114-120), with imports of the shared component. Behavior-preserving: the markup is identical today, so the consolidated component reproduces it exactly.

## 2. "vs previous period" 3-column grid duplicated across the two pages — and already drifting

- **Severity**: High
- **Category**: duplication
- **File**: `src/app/org/[slug]/executive/page.tsx:164-200` and `src/app/share/briefing/[token]/page.tsx:76-96`
- **Scenario**: Both pages render the prior-period comparison as the same 3-cell grid built from `([["Overall", prior.overall, now, dOverall], ["Adoption", …], ["Rigor", …]] as const).map(...)`, each cell showing the current score (`scoreHex(now)`), a "from {prior}" label, and the signed delta. The two implementations are structurally identical but have **already diverged on the delta presentation**: the executive page colors and formats the delta via the shared helpers `deltaHex(delta)` + `fmtDelta(delta)` (imported from `@/components/org/ui`), whereas the share page hard-codes an inline ternary `delta > 0 ? "text-emerald-300" : delta < 0 ? "text-orange-300" : "text-slate-600"` and its own `{delta > 0 ? "+" : ""}{delta}` sign formatting. The executive page additionally renders a per-dimension breakdown block (lines 183-198) that the share page omits entirely.
- **Root cause**: Same copy-paste origin as finding #1 — the share grid was lifted from the executive grid, then locally edited (the author re-implemented delta coloring inline instead of importing `deltaHex`/`fmtDelta`, and dropped the per-dimension rows for the public view). Once copied, the two stopped tracking each other.
- **Impact**: This is the most significant finding: two copies of the same comparison grid that have *already drifted* on how a delta is colored and signed, so the public board link can present the same numbers with different visual semantics than the in-app view (e.g. the shared `text-emerald-300`/`text-orange-300` vs the canonical `deltaHex` ramp). Future changes to delta styling will land in one place and not the other, widening the gap.
- **Fix sketch**: Extract a `PriorPeriodGrid` component (props: `prior`, `maturity`, and an optional `showDimensions` flag for the per-dim breakdown the exec page wants but the share page doesn't) into `src/components/org/`. Have it use `deltaHex` + `fmtDelta` for the headline deltas in BOTH cases so the share view stops hand-rolling colors. Replace the grid in `executive/page.tsx:167-182` (keep its dim-breakdown via the flag) and the grid in `share/briefing/[token]/page.tsx:79-94`. Behavior-preserving for the executive page; for the share page this also corrects the drift by routing it through the canonical delta helpers (a deliberate, reviewable visual unification).

## 3. Unused exported `engineLabel` helper

- **Severity**: Low
- **Category**: dead-code
- **File**: `src/lib/org/briefing.ts:27-30`
- **Scenario**: `export function engineLabel(provider: string): string` maps an engine-provider id to a human label via the module-local `ENGINE_LABEL` record. A repo-wide search (`rg engineLabel src/`) shows its only reference is the adjacent `engineMixLabel` on line 34 (`mix.map((e) => `${engineLabel(e.provider)} …`)`) inside the same file. Nothing outside `briefing.ts` imports it; no dynamic/string-keyed lookup, re-export, or test references it.
- **Root cause**: Likely exported speculatively (the sibling `engineMixLabel`/`engineMixDegraded` are genuinely consumed by the page and markdown, so this one was exported by symmetry) but no external consumer ever materialized.
- **Impact**: Minor — a public API-surface entry that implies external use that doesn't exist, and a small invitation to import it from elsewhere rather than the intended `engineMixLabel`. No bundle/behavior cost beyond the noise.
- **Fix sketch**: Drop the `export` keyword so it becomes a module-private `function engineLabel(...)` (it stays in use by `engineMixLabel` on line 34). Fully behavior-preserving; no callers to update. (Leave `engineMixLabel` and `engineMixDegraded` exported — both are imported by `executive/page.tsx`.)

---

### Notes / explicitly NOT flagged (kept the bar high)
- `briefing.ts`'s three rendering paths — `briefingMarkdown` (markdown), `MoveRow`/`DimRow` (HTML/React), and `briefing-document.tsx`'s `MoveLine`/`DimLine` (`@react-pdf` primitives) — look superficially duplicative but target three different rendering media (plain text, DOM, PDF). Consolidating them would couple incompatible renderers; this is acceptable parallelism, not cruft.
- `BriefingGoal.pace` is consumed (markdown line 353, PDF line 172), so it is not dead despite not appearing in the HTML goal rows.
- The single `console.error` in `pdf/route.ts:55` is legitimate error logging inside a catch, not leftover debug output.
