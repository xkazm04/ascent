# UI Perfectionist Fix Wave 1 — Design-token & color-system unification

> 6 commits, 6 findings closed (2 High + 4 Medium/Low).
> Baseline preserved: tsc 0 → 0 errors · lint 0 errors/6 warnings → 0 errors/6 warnings · `next build` ✓ compiles.

Mental model: every colour routes through ONE canonical token/ramp. Raw literals (`text-red-400`,
`#04070e`) and parallel colour maps are latent drift sites — a future retune silently skips them.

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `8754399` | report-trends #1 — unify LEVEL_HEX vs LEVEL_CLASSES ramp | High | `src/lib/ui.ts` |
| 2 | `54f1989` | org-dashboard #3 — OrgScanButton tokens + reuse Meter | Medium | `src/components/org/OrgScanButton.tsx` |
| 3 | `c086e44` | onboarding #1 — error colors → danger token | High | `src/components/onboarding/OnboardingFlow.tsx` |
| 4 | `992af68` | onboarding #2 — cancel hover literals → token | Medium | `OnboardingFlow.tsx` |
| 5 | `ab1978a` | onboarding #8 — `#04070e` → `text-on-accent` | Low | `OnboardingFlow.tsx`, `connect/page.tsx` |
| 6 | `f6eebe9` | onboarding #9 — eyebrow letter-spacing | Low | `OnboardingFlow.tsx`, `connect/page.tsx` |

> Branch note: `vibeman/ui-perfectionist-wave2` carries this wave's `fix(...)` commits interleaved
> with a concurrent process's `feat(...)` commits. `lib/ui.ts` and `OnboardingFlow.tsx` were edited
> by that process mid-wave; each of my edits is exact-string and re-applied against current state,
> so nothing was clobbered. tsc/lint/build all pass with the combined tree.

## What was fixed

### One canonical color ramp
1. **`LEVEL_HEX` vs `LEVEL_CLASSES`** — pills/chips used Tailwind `-400` text classes (and `emerald` for L5) while the rings/charts/heatmap/badge use `LEVEL_HEX` `-500` hex (and `green` #22c55e for L5). A level pill and the score ring beside it rendered as two different greens. `LEVEL_CLASSES` is now locked to the same stop+hue as the documented-canonical `LEVEL_HEX` (and commented to stay in lockstep). Contrast holds — the floor, red-500 on the tinted pill bg, clears AA (~4.8:1); brighter levels exceed it.

### Token-or-literal discipline (raw literals the tokens were created to kill)
2. **OrgScanButton** dropped `text-[#04070e]` → `text-on-accent` and `text-red-400` → `text-danger`, and its hand-rolled progress bar now reuses the shared `<Meter value size="sm" />` instead of duplicating its track/fill/animation.
3. **Onboarding error colors** → `text-danger-soft` (form-level alerts) / `text-danger` (inline row error), matching the sibling connect surfaces instead of raw `text-red-400`.
4. **Cancel-button hover** → `hover:border-danger/50 hover:text-danger-soft` instead of `red-500`/`red-300` literals.
5. **`#04070e`** on the seeded-org CTAs → `text-on-accent` in both OnboardingFlow and connect/page.

### One value per typographic role
6. **Eyebrow letter-spacing** standardized on `tracking-[0.3em]` across connect + onboarding section eyebrows (was a mix of `tracking-[0.3em]` page-titles and `tracking-widest` sections for one role).

## Verification table

| Gate | Before (Phase B2) | After Wave 1 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `npm run lint` | 0 errors / 6 warnings | 0 errors / 6 warnings |
| `next build` | passes | ✓ compiles (2 pre-existing dev-only `throw` warnings) |

W1-5/W1-6 are code/type changes and were type-checked before commit; W1-1…W1-4 are pure `className`
string edits (type-inert), verified together by the wave-end tsc + lint + build.

## Cumulative status (across all waves so far)

| Wave | Theme | Closed |
|---|---|---|
| 2 | Scoring truth, CVD redundancy & public badge | 7 |
| 1 | Design-token & color-system unification | 6 |
| **Total** | | **13 / 45** |

Remaining: **32 findings** across Wave 3 (states, 7), Wave 4 (extraction/DRY, 7), Wave 5 (a11y ARIA/keyboard/contrast, 7), Wave 6 (responsive, 4), Wave 7 (polish, 7).

## Patterns established (catalogue items 6–9)

6. **One canonical color ramp** — when a design keeps parallel colour definitions (a hex map for SVG/inline-style and a Tailwind-class map for elements), lock them to the same stop *and* hue, or they silently drift (here: pills `-400`/emerald vs rings `-500`/green = two greens). Anchor the class map to the documented-canonical hex map and comment the dependency.
7. **Token-or-literal discipline** — the moment a design token is introduced (`--color-danger`, `--color-on-accent`), every raw literal it replaced (`text-red-400`, `#04070e`) becomes a latent drift site. Grep the literal across the whole codebase when adding the token and migrate all occurrences, or new/edited code re-introduces the divergence the token was meant to end.
8. **One value per typographic role** — a repeated role (eyebrow/kicker, caption, label) needs a single spacing/size/weight recipe. Ad-hoc per-component values for one role (`tracking-widest` vs `tracking-[0.3em]`) read as incoherence; standardize or extract a class/component.
9. **Reuse the primitive, don't re-inline it** — a hand-rolled bar/card/badge next to an existing shared primitive (`<Meter>`, `<Card>`) inevitably drifts in radius/height/animation. Route the call site through the primitive even when the inline version "looks the same" today.

## What remains

Five themed waves are open per `INDEX.md`. With the colour/token foundation now unified, **Wave 3
(states)** gives the biggest user-visible gain (empty/loading/error/done coverage), or **Wave 5
(accessibility)** for the most correctness-flavoured batch.
