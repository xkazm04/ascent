# UI Perfectionist Fix Wave 6 — Landing cohesion & correctness

> 2 commits, 4 findings closed (1 high · 2 medium · 1 low). SP#7 (low) skipped on purpose — see below.
> Baseline preserved: tsc 0→0 errors · eslint 0 err/3 warn → 0 err/3 warn · `next build` passes.

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `9d0578a` | SP#1, SP#8 | high, low | `src/app/page.tsx` |
| 2 | `e79b2c9` | SP#5, SP#6 | medium, medium | `src/components/ScanForm.tsx` |

## What was fixed

1. **Dimension-count contradiction (SP#1).** The first screen showed three different counts: the hero copy and the how-it-works step said "7 dimensions", the section heading said "Eight scoring dimensions", and the grid rendered **9** cards from `DIMENSIONS` (D1–D9). All three now derive from `DIMENSIONS.length`, so the heading and copy can never contradict the rendered cards again. (A credibility fix — three conflicting numbers on the landing page undercut trust in the product's rigor.)
2. **Hero entrance polish (SP#8).** The hero content now uses the design system's `animate-fade-up` entrance (reduced-motion safe via the `globals.css` media query). Scoped to the above-the-fold hero only — the below-fold section stagger would need scroll-reveal JS and is left as a future enhancement.
3. **Example-chip click feedback (SP#5).** Clicking a "Try:" chip fired navigation with no feedback on the clicked chip. The clicked chip now gets an accent highlight + a pulsing ellipsis while the other chips dim and disable.
4. **Mobile-safe autofocus (SP#6).** The bare `autoFocus` attribute popped the mobile keyboard and scrolled the page past the hero. Replaced with a `ref` + effect that focuses only on a pointer-fine, wide (≥640px) viewport.

## What was skipped (on purpose)

- **SP#7 (low)** — "the hero is missing the notice pattern when the gallery is absent." Adding a "no public scans yet" empty-state to the marketing landing page when persistence is off / there are no public scans would *clutter* the hero, not improve it. Silently omitting the empty Live-discovery rail (current behavior) is the correct UX. Flagged as an over-eager finding; no change.

## Verification (before / after)

| Gate | Before (baseline) | After Wave 6 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `eslint` | 0 errors, 3 warnings | 0 errors, 3 warnings (same pre-existing) |
| `next build` | ✅ pass | ✅ pass |

## Cumulative status (across all waves so far)

| Wave | Theme | Closed | Cumulative |
|---|---|---:|---:|
| 1 | Design-token unification | 7 | 7 / 40 |
| 2 | Notice / EmptyState consolidation | 5 | 12 / 40 |
| 3 | Chart & badge data-viz language | 7 | 19 / 40 |
| 4 | Cross-page funnel & dashboard layout | 4 | 23 / 40 |
| 5 | Tabular rows: extract + readable + focusable | 5 | 28 / 40 |
| 6 | Landing cohesion & correctness | 4 | 32 / 40 |

Remaining: **8** — Wave 7 (RT#4, RT#5, RT#8, CO#7), carried OD#4 + OD#7, deferred UB#6, skipped SP#7.

## Pattern established (catalogue item 15)

15. **Derive user-facing counts from the source array, never a hardcoded word** — a literal "Eight"/"7" next to a `.map(DIMENSIONS)` is a guaranteed future contradiction (it already drifted to 7 vs 8 vs 9). Render the count from `DIMENSIONS.length` so the copy and the content stay in lockstep.

## What remains

- **Wave 7** — Trends/report finishing & a11y (RT#4 /trends loading state, RT#5 descriptive per-chart aria labels, RT#8 responsive radar, CO#7 surfaced scan-progress %).
- **Carried** — OD#4, OD#7 (org-tab shell pass). **Deferred** — UB#6. **Skipped** — SP#7.
