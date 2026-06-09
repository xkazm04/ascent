# Bug Hunter Fix Wave 3 — Resilient rendering & empty-data UX

> 6 fix commits (+1 build-fix follow-up), 7 findings closed (report #3 closed as a bonus alongside #2).
> Baseline preserved: tsc 0 → 0 errors · tests 260/260 · eslint clean · **next build passes**.
> Branch: `vibeman/bug-hunt-2026-06-09` (off `master`).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `be9279a` + `2e8f6f6` | org-dash #1 | **Critical** | app/error.tsx (new) |
| 2 | `c9385a6` | org-dash #2 + #3 + #6 | High + 2 Medium | org/[slug]/page.tsx, repositories/page.tsx, practices/page.tsx, org/ui.tsx |
| 3 | `27c06a8` | report #1 | High | report/RadarChart.tsx |
| 4 | `de780d9` | report #2 + #3 | High + Medium | report/ReportView.tsx |
| 5 | `23160d4` | report #5 | Medium | api/history/route.ts |

## What was fixed (grouped by sub-pattern)

### Error boundary coverage
1. **Missing root-segment error boundary** (`be9279a` + build fix `2e8f6f6`, **Critical, rescoped**). The finding claimed NO error boundaries existed anywhere — but `org/[slug]/error.tsx`, `global-error.tsx`, and `not-found.tsx` all already exist (the subagent's glob silently missed `org/[slug]/error.tsx` because the literal `[slug]` directory name is a glob char-class). The one *genuine* gap: a throw in a nested **layout** (org/[slug]/layout.tsx) can't be caught by its own segment's error.tsx and fell through to the bare full-document global-error. Added `src/app/error.tsx`. The build-fix follow-up: an error.tsx must be a Client Component, so it can't import `Brand` (→ auth → server-only `next/headers`); made it self-contained — caught only by `next build`, not tsc.

### Empty-data rendering
2. **Blank panels → empty states** (`c9385a6`, High + 2×Medium). `org/[slug]/page.tsx` and `repositories/page.tsx` did `if (!rollup) return null`, painting a silent blank panel inside the org shell when this view's scoped query found nothing the layout's did; now render an `OrgEmpty` with a way to populate the data. Added a `postureLabel()` helper that humanizes an unmapped/legacy posture id instead of showing a raw slug or blank. Replaced the practices "0/0 · 0%" tile (a divide guarded to 0 but still rendered as 0% adoption) with a "not yet measured" state for unmeasured practices.

### Chart NaN / reconciliation
3. **RadarChart empty-dimensions guard** (`27c06a8`, High). `angleFor` divides by `n = dimensions.length`; an empty array makes every vertex `[NaN,NaN]` and collapses the polygon silently. Added a self-guard empty state — after the hooks, to satisfy Rules of Hooks.
4. **Scan reconciliation by instant, not ISO string** (`de780d9`, High + Medium). `currentStored` used an exact-string timestamp compare and `baselineScan` a lexicographic `<` — both break when the stored and live `scannedAt` serialize the same instant differently (ms precision, `+00:00` vs `Z`), double-counting the current scan into a phantom trend point and mis-ordering the delta baseline. Now compares parsed instants within a 1s tolerance (excluding the current scan from being its own baseline).
5. **CSV export resilient to a bad row** (`23160d4`, Medium). `historyToCsv` 500'd the entire export if any field's `String()` threw or a row's `dimensions` was null. Made `csvField` total (bad field → empty cell) and guarded `s.dimensions ?? []`.

## Verification table

| Gate | After Wave 2 | After Wave 3 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `vitest run` | 260 passed / 260 | 260 passed / 260 |
| `eslint` (changed) | clean | clean |
| `next build` | (not run) | **passes** (caught + fixed a client/server boundary bug) |

## Cumulative status (across all waves so far)

| Wave | Theme | Findings closed |
|---|---|---|
| 1 | Concurrency, dedup & billing integrity | 7 |
| 2 | Auth, webhook & session integrity | 7 |
| 3 | Resilient rendering & empty-data UX | 7 |
| | **Total** | **21 / 70 — all 3 Criticals closed** |

## Patterns established (catalogue items 9–12)

9. **Glob char-classes silently swallow literal `[bracket]` paths** — a scan that greps for `app/**/error.tsx` will MISS `app/[slug]/error.tsx` because `[slug]` is a glob character class. An "X doesn't exist anywhere" finding from a glob must be re-verified with a literal `ls`/Read before acting, or you'll re-implement something that already exists. (This wave's Critical was 75% already-built.)
10. **Error boundaries can't catch their own segment's layout** — a Next.js `error.tsx` renders inside its segment's layout, so a throw in *that* layout escapes it and needs a boundary in a PARENT segment. A root `app/error.tsx` is the catch-all below the root layout; `global-error.tsx` only covers the root layout itself.
11. **Client components can't transitively import server-only modules** — an `error.tsx`/`"use client"` file that imports a component which (several hops away) pulls in `next/headers`/`next/server` compiles under tsc but fails `next build`. Run the real build for any change to a client/server boundary; tsc and unit tests don't model it.
12. **Reconcile timestamps as instants, never as strings** — two independently-serialized ISO timestamps for the same instant can differ byte-for-byte (precision, offset form); both `===` and lexicographic `<` then lie. Compare `Date.parse(...)` within a tolerance.

## What remains

Open themes per the INDEX (49 of 70 still open): LLM provider resilience (Wave 4), Scoring/maturity math (Wave 5), SSE lifecycle & cache staleness (Wave 6), Public-surface input validation (Wave 7), Persistence & DSQL token lifecycle + residual polish (Wave 8). No Criticals remain — Waves 4–8 are High/Medium/Low reliability hardening.

### Already-existed / over-scoped catches this wave
- **org-dash #1**: 3 of 4 claimed-missing boundaries already existed; only the root-segment one was real.
- **org-dash #3**: the repositories posture site already had a `?? raw` guard (no blank); fix was a cosmetic humanization.
- **org-dash #6**: the divide-by-zero was already guarded (`p.total ? … : 0`); fix was the misleading 0/0 presentation.
