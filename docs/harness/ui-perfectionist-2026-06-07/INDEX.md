# UI Perfectionist Scan — ascent, 2026-06-07

> Design-quality audit of every UI-bearing context: visual consistency, component architecture,
> responsiveness, polish, and design-system token discipline.
> 6 parallel subagent runs, one wave of ≤8. Frontend-only scope (no API/db backend except the SVG badge).

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 6 contexts | 0 | 14 | 19 | 7 | **40** |
| Share | 0% | 35% | 47.5% | 17.5% | 100% |

No criticals: nothing is outright broken. The weight is in **high/medium consistency & design-system drift** — the app works but speaks several visual dialects. Categories: visual-consistency 15 · design-system 10 · polish 8 · component-architecture 5 · responsiveness 2.

---

## Per-context breakdown

(Sorted by total desc, then highs)

| # | Context | Critical | High | Medium | Low | Total | Report |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | Report & Trends Visualization | 0 | 3 | 4 | 1 | 8 | `report-trends-visualization.md` |
| 2 | Org Dashboard & Views | 0 | 3 | 4 | 1 | 8 | `org-dashboard-views.md` |
| 3 | Scan Pipeline & Ingestion (landing) | 0 | 2 | 4 | 2 | 8 | `scan-pipeline-ingestion.md` |
| 4 | GitHub App, Connect & Onboarding | 0 | 3 | 3 | 1 | 7 | `connect-onboarding.md` |
| 5 | Usage Metering & Public Badge | 0 | 2 | 3 | 1 | 6 | `usage-badge.md` |
| 6 | GitHub OAuth & Session (SignInNotice) | 0 | 1 | 1 | 1 | 3 | `oauth-session.md` |

---

## All 14 high-severity findings — one-line summary

(0 criticals, so highs are the triage priority. Grouped into themes. `report#` = finding number within that context's report.)

### A. Design-system / token bypass (raw hex where a token exists)
1. **Scan/Landing #2** — error state uses raw `red-500/400` instead of the dedicated `--color-danger` token. `ScanForm.tsx:69`
2. **Connect #3** — repo-picker error/empty states use raw `red-*` + hand-rolled cards instead of tokens/`EmptyState`. `InstallationRepos.tsx:192`

### B. Notice / EmptyState fragmentation (canonical component not reused)
3. **OAuth #1** — `SignInNotice` hand-rolls the EmptyState scaffold (byte-identical classes) — a 4th un-unified, already-drifted variant. `SignInNotice.tsx:8`
4. **Report & Trends #3** — DimensionTrends empty-range + error states bypass canonical `EmptyState` (3 "nothing here" styles on one page). `DimensionTrends.tsx:230`
5. **Org #2** — three competing empty-state treatments across shell vs. tabs vs. canonical component. `org/ui.tsx:137`

### C. Chart & badge data-viz language (score-color + scale + legibility)
6. **Report & Trends #1** — per-dimension small-multiples drop the level bands + numeric axis the overall chart shows (two reading frames). `DimensionTrends.tsx:71`
7. **Report & Trends #2** — overall maturity line is always accent-blue while every other line is score-colored (an L1-red repo shows a confident blue trajectory). `TrendChart.tsx:145`
8. **Usage/Badge #1** — public README badge paints white text on light L3/L4/L5 brand fills → highest-maturity badges illegible (~1.7–2.2:1); `ui.ts` itself warns about this. `route.ts:153`
9. **Usage/Badge #2** — badge value text baseline is hardcoded for h=28 and clips in the 20px `flat-square` style. `route.ts:135`

### D. Component extraction / readability (duplicated structure, unreadable cells)
10. **Org #1** — four near-identical hand-rolled data tables across Repositories/Contributors/Delivery (drifting `min-w`) that should be one shared `OrgTable`. `repositories/page.tsx:37`
11. **Org #6** — heatmap numerals (`text-[#04070e]`) go unreadable on low-opacity low-score cells — a contrast regression on exactly the weakness cells users look for. `repositories/page.tsx:110`

### E. Cross-page funnel consistency (the two halves of first-run feel disjointed)
12. **Connect #1** — no progress/step indicator on `/connect` while `/onboarding` has a full checklist + bar; the funnel's first step has no "step 1 of N". `connect/page.tsx:38`
13. **Connect #2** — connect vs. onboarding headers diverge in type scale + entrance despite sharing the same shell. `connect/page.tsx:41`

### F. Content correctness (credibility)
14. **Scan/Landing #1** — "Eight scoring dimensions" heading sits over **9** rendered dimension cards while hero copy/title say "7" — three conflicting counts on the first screen. `page.tsx:127`

---

## Triage themes

| Theme | Approx count | Why this is a wave, not just individual fixes |
|---|---:|---|
| T1 — Design-token unification (hex → tokens/`scoreHex`) | 7 | One mental model: sweep raw hex/`red-*`/sizes to `globals.css` tokens + `lib/ui.ts` helpers. Fixes compound — same token map reused across files. |
| T2 — Notice / EmptyState consolidation | 6 | Every hand-rolled notice routes through one `EmptyState`; killing the variants once stops future drift. |
| T3 — Chart & badge data-viz language | 7 | Charts + badge must speak one visual language (score ramp, band edges, legible text). Shared scale/color rule touched repeatedly. |
| T4 — Cross-page funnel & dashboard layout | 6 | Make connect↔onboarding and the org tabs feel like one product: headers, progress, grid/rhythm, control placement. |
| T5 — Tabular rows: extract + readable + focusable | 5 | Org tables/heatmap + connect repo rows: one row/table treatment that's hoverable, focusable, and high-contrast. |
| T6 — Landing page cohesion & correctness | 5 | All in `page.tsx`/`ScanForm.tsx`: dimension-count copy, chip feedback, mobile autofocus, hero polish. Warm single-file context. |
| T7 — Trends/report finishing touches & a11y | 4 | Loading state, descriptive aria labels, responsive radar, surfaced progress %. |

---

## Suggested next-phase split (7 waves)

Each wave is one focused session (≤7 fixes, one mental model). Order chosen so the **foundation themes (tokens, EmptyState) land first** — later waves then reuse the unified tokens/components instead of fighting them.

**Wave 1 — Design-token unification (7):** SP#2 (high), SP#3, SP#4, OD#5, UB#3, UB#4, OS#3
→ Replace raw hex / `red-*` / off-scale sizes with `--color-danger`, `--color-accent`, `--color-ink`, `text-on-accent`, `scoreHex`/`deltaHex`, canonical icon size.

**Wave 2 — Notice / EmptyState consolidation (6):** OS#1 (high), OS#2, RT#3 (high), OD#2 (high), CO#3 (high), UB#6
→ Every hand-rolled notice/empty/error → canonical `EmptyState` with `actions[]`; fold the expired-session banner + repo-picker states in.

**Wave 3 — Chart & badge data-viz language (7):** RT#1 (high), RT#2 (high), RT#6, RT#7, UB#1 (high), UB#2 (high), UB#5
→ Single-source score-color across all lines, route every chart through `chartScale.ts` bands, fix badge contrast + flat-square geometry, differentiate provider bars.

**Wave 4 — Cross-page funnel & dashboard layout (6):** CO#1 (high), CO#2 (high), CO#6, OD#3, OD#4, OD#7
→ Add a connect progress indicator, align connect/onboarding headers, standardize panel radius/scale, tile-grid columns, segment-control placement, section rhythm.

**Wave 5 — Tabular rows: extract + readable + focusable (5):** OD#1 (high), OD#6 (high), OD#8, CO#5, CO#4
→ Extract a shared `OrgTable`, fix heatmap numeral contrast, add row hover + focus-visible rings, declutter the repo-row CTA.

**Wave 6 — Landing page cohesion & correctness (5):** SP#1 (high), SP#5, SP#6, SP#7, SP#8
→ Fix the dimension-count contradiction, add chip click feedback, drop mobile autofocus, reuse the notice pattern for the empty gallery, add heading entrance polish.

**Wave 7 — Trends/report finishing touches & a11y (4):** RT#4, RT#5, RT#8, CO#7
→ Add `/trends` loading state, descriptive per-chart aria labels, responsive radar, surfaced scan-progress %.

---

## How this scan was run

- **Scanner**: `ui-perfectionist` (Vibeman prompt registry, `src/lib/prompts/registry/agents/ui-perfectionist.ts`, scanType `ui_perfectionist`).
- **Date**: 2026-06-07. **Pipeline**: B (Scan + Triage + Implementation).
- **Scope**: 6 UI-bearing contexts of the `ascent` project (`C:\Users\kazda\kiro\ascent`); frontend files only (`.tsx` components/pages, `globals.css`, `lib/ui.ts`, plus the SVG badge route as a visual artifact). The 4 pure-backend contexts (LLM Provider, Maturity/Scoring, Org Scanning, Persistence) were excluded — no UI surface.
- **Method**: one `general-purpose` subagent per context, given the UI Perfectionist role + the project's existing design conventions (`EmptyState`, `lib/ui.ts`, `chartScale.ts`, Tailwind v4 tokens). Each read its files in full, wrote one report, replied with terse stats. Orchestrator read only the replies during scanning.
- **Files read by scanners**: ~31 in-scope files + shared design-system references (`ui.ts`, `EmptyState.tsx`, `globals.css`, `chartScale.ts`, `model.ts`, etc.).
- **Health baseline (pre-fix)**: `tsc --noEmit` = 0 errors · `eslint` = 0 errors / 3 pre-existing warnings (`InstallationRepos.tsx` ×2, `vitest.config.js` ×1). Tests are Playwright e2e (need a live server — not run as a scan baseline).
- **Verification**: findings counted two ways — `> Total:` headers sum = 40; `- **Severity**:` bullets = 40. Match.
- **Note**: this context group previously had Pipeline-C security/reporting/data passes (see `harness-learnings.md`) but **never a UI-design pass** — this is a fresh dimension.
