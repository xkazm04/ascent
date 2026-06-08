# UI Perfectionist Scan — Ascent, 2026-06-08

> Design/visual audit of the user-facing surfaces of `ascent` (GitHub repo AI-maturity scanner).
> 6 parallel UI-Perfectionist subagent runs, one wave. 4 backend-only contexts excluded as N/A (no UI surface).
> Stack: Next.js 16 · React 19 · Tailwind v4 · TypeScript. TS baseline: 0 errors. Lint baseline: 0 errors / 6 warnings.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 6 UI contexts | 1 | 14 | 22 | 8 | **45** |
| Share | 2% | 31% | 49% | 18% | 100% |

Counts verified two ways: `> Total:` header sum = 45; `- **Severity**:` bullet count = 45. ✔

---

## Per-context breakdown

(Sorted by criticals desc, then by total)

| # | Context | Critical | High | Medium | Low | Total | Report |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | Usage Metering & Public Badge | 1 | 2 | 3 | 1 | 7 | `usage-metering-badge.md` |
| 2 | Org Dashboard & Views | 0 | 3 | 5 | 1 | 9 | `org-dashboard-views.md` |
| 3 | Report & Trends Visualization | 0 | 3 | 5 | 1 | 9 | `report-trends-visualization.md` |
| 4 | GitHub App, Connect & Onboarding | 0 | 3 | 4 | 2 | 9 | `github-app-connect-onboarding.md` |
| 5 | Scan Pipeline & Ingestion | 0 | 2 | 4 | 2 | 8 | `scan-pipeline-ingestion.md` |
| 6 | GitHub OAuth & Session | 0 | 1 | 1 | 1 | 3 | `github-oauth-session.md` |

**Excluded (backend-only — N/A for a UI scan):** LLM Provider Abstraction · Maturity Model & Scoring Engine · Organization Scanning/Watchlist/Rollups · Persistence Layer (Prisma). These contexts hold only `src/lib/**` / API routes / Prisma schema — no `.tsx` or visual output — so a UI-Perfectionist pass has no genuine surface to evaluate. Forcing a quota there would fabricate cosmetic findings, which both the quality bar and the agent's own rules forbid.

---

## The 1 Critical + 14 High findings — one-line summary

Grouped into the triage themes below; each links to its full entry in the per-context report.

### Scoring truth & color-blind (CVD) redundancy
- 🔴 **CRITICAL — Usage/Badge — Badge label half vanishes on dark READMEs.** `fill="#0f172a"` label with no border sits at ~1.04:1 on GitHub's `#0d1117` dark mode — the "Ascent" mark disappears on the most common README context. `badge/[owner]/[repo]/route.ts:169`
- **Scan Pipeline — Metadata advertises "7 dimensions" while model & page say 9.** The share/search snippet contradicts the live hero; rubric defines D1–D9. `layout.tsx:18`
- **Org Dashboard — D9 "Security" silently dropped from every fleet view.** `DIMS` frozen at D1–D8 drives the repo×dimension heatmap & averages; the highest-stakes axis is invisible fleet-wide. `org/ui.tsx:11`
- **Onboarding — Result score chips signal by hue alone (no `LEVEL_GLYPH`).** Violates the project's own CVD rule (ui.ts) on the highest-stakes "did my repo pass?" chips. `OnboardingFlow.tsx:742`, `InstallationRepos.tsx:282`
- **Usage/Badge — Public badge drops the mandated CVD glyph encoding.** Red/green pass-fail badge differs only by a small L-id for ~8% of male viewers. `badge/[owner]/[repo]/route.ts:285`
- **Report — Trend chart maturity bands conveyed by color alone.** No band labels, no `sr-only` data table (unlike the radar); the bands feature is invisible to most/SR users. `TrendChart.tsx:124-140`

### Design-token drift (raw literals bypassing tokens)
- **Onboarding — Error/danger colors bypass the `danger` token** (raw `text-red-400`) while sibling connect surfaces use it — two error visual languages in one funnel. `OnboardingFlow.tsx:478,724,746`
- **Report — Score color ramp diverges:** `LEVEL_HEX` (-500 shades, all charts/rings) vs `LEVEL_CLASSES` (-400 shades, headline pills) — same level renders as two different greens side by side. `lib/ui.ts:31-66`

### Accessibility — ARIA / keyboard
- **Scan Pipeline — No skip-link / keyboard bypass on the app shell.** Every keyboard visit tabs the full sticky header before the ScanForm input (WCAG 2.4.1). `layout.tsx:31`
- **Org Dashboard — `OrgNav` is a faux tab bar with no ARIA + a hidden-overflow scroll trap.** No `aria-current`; last 4–5 tabs unreachable on mobile. `OrgNav.tsx:23-40`

### Empty / loading / error / done states
- **Usage — New-org page shows a wall of zeros instead of an empty state.** No "scan your first repo" path on the metering/ROI surface. `usage/page.tsx:101`

### Responsive / mobile layout
- **Onboarding — Sticky select-bar `top-0` collides with the site header.** Bulk-select controls occluded exactly when scrolling a long repo list. `OnboardingFlow.tsx:341`
- **OAuth — Expired-session amber alert breaks the centered column on wide viewports.** No `max-w` cap; banner stretches past body/CTA on the sensitive "you were signed out" surface. `SignInNotice.tsx:17`

(All 22 Medium and 8 Low findings are detailed in the per-context reports.)

---

## Triage themes

11 finding-categories cluster into 7 actionable themes. Each is one wave — a shared mental model so fixes compound.

| Theme | Count | Why it's a wave, not just individual fixes |
|---|---:|---|
| Design-token & color-system unification | 6 | All route raw literals/duplicate ramps through one canonical token/ramp — one mental model, near-zero risk, de-risks the color work in the next wave. |
| Scoring truth, CVD redundancy & public badge | 7 | The product's *verdict* must be correct and legible to everyone, everywhere — fix hardcoded counts, restore D9, add CVD glyphs/labels, harden the public badge (incl. the 1 Critical). |
| Empty / loading / error / done states | 7 | A single "every surface needs idle/loading/empty/error/done" pass; the app already has `EmptyState` — these are the call-sites that skipped it. |
| Component extraction & DRY | 7 | Card/Tile/Meter/Shell/LevelBadge duplication across pages — extract the primitives once, route call-sites through them. |
| Accessibility: ARIA, keyboard, contrast | 7 | Non-color a11y: skip link, `aria-current`, `aria-invalid`/focus, `progressbar` roles, table `scope`, contrast floors. |
| Responsive & mobile layout | 4 | Sticky-offset, width-cap, and mobile-visibility bugs — viewport-driven, best fixed together against a phone profile. |
| Polish & microcopy | 7 | Transitions, affordance differentiation, number formatting, eyebrow/letter-spacing, tooltip reach — the long tail of finish. |

---

## Suggested next-phase split (7 waves)

Each wave is one focused session (single mental model). Recommended order balances impact and risk; the user drives.

**Wave 1 — Design-token & color-system unification** (6) — *mechanical, zero-risk warm-up*
`onb#1` red→danger · `onb#2` cancel-hover literals · `onb#8` `#04070e`→`text-on-accent` · `onb#9` eyebrow letter-spacing · `org#3` OrgScanButton tokens + reuse `Meter` · `report#1` unify `LEVEL_HEX`/`LEVEL_CLASSES` ramp

**Wave 2 — Scoring truth, CVD redundancy & public badge** (7) — *highest impact; contains the Critical* ⭐
`scan#1` metadata dim-count from model · `org#1` derive `DIMS` → restore D9 Security · `onb#3` `LEVEL_GLYPH` on score chips · `report#2` trend band labels + `sr-only` table · `usage#1` 🔴 badge legible on dark READMEs · `usage#3` badge CVD glyph · `usage#4` badge width math

**Wave 3 — Empty / loading / error / done states** (7)
`scan#6` hero chip live-vs-fallback + skeleton · `onb#6` "scan complete" success affordance · `oauth#2` state-aware body copy · `org#6` `InlineEmpty` for in-card empties · `org#8` disabled scan-button explanation · `usage#2` new-org empty state · `report#9` report history fetch loading/error state

**Wave 4 — Component extraction & DRY** (7)
`scan#5` `<Panel>` card primitive · `org#4` `Tile`/sub-card radius unify · `org#5` heatmap → `OrgTable` chrome + a11y · `org#7` `AiBar` color prop · `usage#5` `StatCard`/`MeterBar` extraction · `report#3` `<LevelBadge>` · `report#4` `ReportShell`

**Wave 5 — Accessibility: ARIA, keyboard, contrast** (7)
`scan#2` skip link · `scan#3` disabled-button contrast · `scan#7` middot microcopy → list semantics · `onb#7` error `aria-invalid`/focus · `org#2` `OrgNav` `aria-current` + overflow cue · `report#6` contributor bar `progressbar` role · `report#7` tiny SVG text contrast/size floor

**Wave 6 — Responsive & mobile layout** (4)
`scan#4` mobile prefix cue · `onb#4` sticky-bar header offset · `oauth#1` alert `max-w` cap · `org#9` mobile header stats

**Wave 7 — Polish & microcopy** (7)
`scan#8` error transition/reserved space · `onb#5` "manage repos" button affordance · `oauth#3` distinct expired-state icon · `usage#6` thousands grouping · `usage#7` chart hover beyond `title` · `report#5` DimensionTrends axis labels · `report#8` static-vs-interactive chip differentiation

---

## How this scan was run

- **Scanner:** `ui_perfectionist` (UI Perfectionist) role prompt from Vibeman's agent registry (`src/lib/prompts/registry/agents/ui-perfectionist.ts`).
- **Scope:** all 10 project contexts considered; the 6 with a UI surface were scanned, 4 backend-only contexts excluded as N/A.
- **Method:** 6 `general-purpose` subagents, one parallel wave, each read the shared design tokens (`globals.css`, `lib/ui.ts`) first, then its context's `.tsx`/visual files, read-only, and wrote one structured report. ~37 source files read across subagents (≈6 each); ~285k subagent tokens total.
- **Output format per finding:** Severity · Category · File:line · Scenario · Root cause · Impact · Fix sketch.
- **Verification:** findings counted two ways (header sum + severity-bullet count); both = 45.
- **Baseline (for regression check on fix waves):** `tsc --noEmit` = 0 errors; `npm run lint` = 0 errors / 6 pre-existing warnings.
