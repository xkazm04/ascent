# UI Perfectionist Fix Wave 2 — Notice / EmptyState consolidation

> 5 commits, 5 findings closed (4 high · 1 medium) + 1 enabling primitive refactor.
> Baseline preserved: tsc 0→0 errors · eslint 0 err/3 warn → 0 err/3 warn · `next build` passes.
> UB#6 (low) deferred to Wave 5 — see "What was deferred".

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| A | `e8eab44` | (enabling refactor) | — | `src/components/EmptyState.tsx` |
| B | `06c7a99` | OD#2 | high | `src/components/org/ui.tsx` |
| C | `4be1087` | OS#1, OS#2 | high, medium | `src/components/SignInNotice.tsx` |
| D | `7c09346` | RT#3 | high | `src/components/report/DimensionTrends.tsx` |
| E | `bef4cd7` | CO#3 | high | `src/components/connect/InstallationRepos.tsx` |

## What was fixed

The app had **six** different "nothing here / sign in here" treatments. Wave 2 makes `EmptyState` the single notice primitive and routes them all through it.

1. **EmptyState becomes the hub (A).** Added backward-compatible optional props: optional `icon`, a `variant` (`page` = full-height hero notice; `section` = compact dashed in-card), an `alert` slot (banner between title and body), and a `children` action slot (client buttons / the sign-in CTA). The `page` variant renders byte-identically to the old markup, so the three existing callers (usage, trends, report) are untouched.
2. **OrgEmpty + SectionEmpty collapse into it (B, OD#2).** Both now delegate to `EmptyState` (page / section) while keeping their own props, so the 2 `OrgEmpty` and 8 `SectionEmpty` call sites are unchanged. The three competing org empties are now one implementation.
3. **SignInNotice reuses it (C, OS#1/OS#2).** The hand-rolled scaffold (already drifted on icon size) and the one-off expired banner are gone — it renders `EmptyState` with the banner in `alert` and `GitHubSignInButton` in `children`.
4. **DimensionTrends states route through it (D, RT#3).** "No scans in range" → `EmptyState` page (whole-area empty); "couldn't load dimensions" → `EmptyState` section (inline, under the still-visible overall chart). Action buttons ride the `children` slot.
5. **Repo-picker empties + danger tokens (E, CO#3).** Empty + filtered-empty → `EmptyState` section; the load-error alert and per-row error switch raw `red-500/300/400` to the `--color-danger` tokens — preserving the error affordance while removing the raw hex.

## What was deferred

- **UB#6 (low)** — usage `Notice` "View usage docs" affordance + inline `Stat`/`Bar` extraction. Deferred to **Wave 5 (component extraction)**: the docs affordance would link to a docs route that does not exist (won't ship a link to a 404), and the `Stat`/`Bar` dedup is a component-extraction concern, not a notice-consolidation one.

## Verification (before / after)

| Gate | Before (baseline) | After Wave 2 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `eslint` | 0 errors, 3 warnings | 0 errors, 3 warnings (same 3; InstallationRepos lines shifted 170→171 from the new import) |
| `next build` | ✅ pass | ✅ pass (client↔server EmptyState imports resolved) |

## Cumulative status (across all waves so far)

| Wave | Theme | Closed | Cumulative |
|---|---|---:|---:|
| 1 | Design-token unification | 7 | 7 / 40 |
| 2 | Notice / EmptyState consolidation | 5 | 12 / 40 |

Remaining: **28 findings** across Waves 3–7 (Wave 5 now also carries the deferred UB#6).

## Patterns established (catalogue items 5–7)

5. **One notice primitive, two scales** — a single `EmptyState` with a `variant` (page/section) plus optional slots (`alert`, `children`) replaces N hand-rolled empties. Build the scales into the primitive rather than spawning sibling components.
6. **Delegate, don't migrate** — when consolidating a widely-used primitive (`SectionEmpty`: 8 call sites), keep its public API and re-implement its body as a call to the canonical component. Zero call-site churn, full consolidation, cleanly bisectable.
7. **Tokens for danger, EmptyState for empty** — an *error* state should stay visually distinct (a danger-tinted alert via `--color-danger`/`-soft`), not be flattened into a neutral `EmptyState`. Reserve `EmptyState` for genuine "nothing here" empties; don't lose the error affordance in the name of consolidation.

## What remains

- **Wave 3** — Chart & badge data-viz language (RT#1, RT#2, RT#6, RT#7, UB#1, UB#2, UB#5): score-color single-sourcing, chart band/scale consistency, the illegible README badge + flat-square geometry, provider-bar differentiation.
- **Waves 4–7** — cross-page funnel layout, tabular-row extraction (+ UB#6), landing cohesion, trends/a11y finishing. See `INDEX.md` → "Suggested next-phase split".
