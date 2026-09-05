# L1 report — Tania (scaleup cost-cutter) × "Repeated org scans worth the price"

cert_level: L1 (theoretical, static, code-grounded) · no browser
date: 2026-07-16

---

## 1. Surface model (import-chain traced, file:line cited)

### `/usage` — the metering/billing view
- `src/app/usage/page.tsx:1-160` — server component. Gates: `resolveSignInState()` (18-48), `canReadOrg(org)` (62-69), `isDbConfigured()` (71-78). Reads `getUsageSummary`, `getCreditState`, `getBadgeReach`, `getCreditReconciliation`, `getQuotaEventTotals` (5, 96-104).
- Renders `UsageDashboard` (`src/app/usage/usageDashboard.tsx:8-216`): scan-volume trend (`UsageTrend`, 62-64), totals (`Stat` tiles: total/period/billable/repos, 67-72), cost+tokens (74-105), `AllotmentPanel` (burn vs plan allotment, 110), credit reconciliation (112-136), public-vs-private split (138-156), by-engine split (157-172), top repos by scan volume (175-193), `BadgeReachPanel` (README-badge impressions, 195), `AbuseLimitsPanel` (197).
- **Every metric on this page is machine-counted**: scan counts, tokens, cost, credits, badge fetches. Grepped the whole page (`usageDashboard.tsx`, `usagePanels.tsx`, `usageAllTimePanels.tsx`) — no field for "who last opened this," "active users this period," or any session/login telemetry.
- Confirmed by a repo-wide search: no `page_view`/session-open persistence exists anywhere (`ToolSearch`-style `Grep` for `lastActive|dashboardOpen|last_login|lastSeenAt`, 41 hits, all either GitHub-commit `lastActiveAt` for *contributors* (`src/lib/db/org-contributors.ts:21,62,84,107` — repo commit activity, not app usage) or unrelated docs/fixtures). `src/app/org/[slug]/layout.tsx:154-161` seeds an owner `Membership` on first visit (`ensureOwnerMembership`) but never stamps or updates a "last visited" timestamp on repeat visits.
- Audit trail (`src/lib/db/scans-audit.ts:1-80`, viewer `src/components/org/audit/AuditLogViewer.tsx:18-31`) records `scan.created`, `recommendation.updated`, member/plan/alert changes — **no `dashboard.viewed` or session-open event type exists** in the recognized action list.

### `/org/[slug]` overview — fleet + movement
- `src/app/org/[slug]/page.tsx:37-134`. Reads `getOrgRollup` + `getOrgRepoHistories` (65-68), builds `buildTrajectories` (84-87, `src/components/org/overview/repoTrajectory.ts:52-86`), renders `RepoCategoryRollup` (125) and `RepoDimensionHeatmap` (131) — replaces the old page-level Movers list/Trajectory card per the journey's discovery hint, confirmed in code.
- Noise-aware movement: `src/lib/maturity/noise.ts:1-24` defines `SCORE_NOISE_BAND = 2`, `isWithinNoise`, `classifyDelta`; `src/components/ui/format.ts:33-34,42` (`toneFor`, delta arrow) render `≈` for within-noise deltas vs `▲`/`▼` for real moves — a repo's own delta is visibly flagged real-vs-noise, not just colored.
- `movedRepos`/`avgRealMove` (`repoTrajectory.ts:162-172`) explicitly exclude null-delta and mock↔live engine-transition deltas from the "improving/slipping" denominator (`deltaCrossesEngine`, line 41,61,79).

### `/org/[slug]/executive` — the renewal-justification surface
- `src/app/org/[slug]/executive/page.tsx:24-259`. Calls `buildExecBriefing` (38, `src/lib/org/briefing.ts:154-295`), which assembles `valueRealized: { recsEngaged, recsActioned, pointsMoved, reposPromoted }` (259-264) from `getOrgRecsActioned` (`src/lib/db/org-rollup.ts:674-696` — explicitly commented `// (TANIA)` at line 672, counting `RecommendationEvent` status-change rows joined org→repo→scan→recommendation, scoped by window/segment/stack).
- `valueRealizedLine()` (`briefing.ts:44-51`) renders "N recommendations completed · fleet +X pts · Y repos leveled up" — a single line, only shown when `parts.length` (never a fake "0·0·0"). Rendered on-page at `executive/page.tsx:111-116` and in the "Copy briefing for LLM" markdown (`briefing.ts:315-316`).
- Trend confidence: `forecastConfidenceNote()` (`briefing.ts:36-39`) surfaces "trend confidence NN% · noisy" under the Trajectory card (`executive/page.tsx:153-169`) — the org-level analog of the repo-level noise band.
- `priorPeriod` block (`briefing.ts:203-226`, rendered 171-176) gives an explicit vs-previous-period comparison.
- Reachable via the persistent org rail: `src/components/org/shared/OrgNav.tsx:60-63` — "Briefing" tab under the "Overview" group, always visible (not gated to a plan tier in the nav def).

### `/pricing` — cost legibility
- `src/app/pricing/page.tsx:1-40`. `PRO_PRICE = planPriceLabel("pro").amount` (40) and the Team equivalent are derived from `src/lib/plans.ts:57-60` (`team: { includedCredits: 500, … }`, `planPriceLabel` at 88) — the same source `plans.ts` the entitlement/credit gate reads (comment at page.tsx:1-6 confirms this was fixed from a previously hardcoded, driftable string). Real numeric Pro/Team $ now render, not "Contact us."
- `AllotmentPanel` on `/usage` (`usageDashboard.tsx:110`) renders burn vs the plan's included-credit allotment (500 for Team) — the other half of the cost↔value pair.

### `/trends` — per-repo only
- `src/app/trends/page.tsx:31-` reads `getRepositoryHistory` for a single `?repo=` — confirmed **not** an org-wide surface; the journey's hint that org-level "what changed" moved to the heatmap/per-repo trajectories (above) is accurate in code.

### `/api/recommendations/[id]` — the actioning surface
- Backs the `recommendation.updated` audit action and the `RecommendationEvent` rows `getOrgRecsActioned` counts. PATCH writes `toValue`, which the exec briefing's `recsActioned` filters on `toValue === "done"` (`org-rollup.ts:693`).

### Reachability for Tania
- Team-tier owner under `ASCENT_AUTH_BYPASS=1` + seeded local profile (`env.md`). `/usage` and `/pricing` sit in the always-visible global header (`src/components/Brand.tsx:150,251`); `/org/[slug]/executive` sits in the always-visible org rail (`OrgNav.tsx:60-63`, no plan-tier filter in `def`). All five bound surfaces are in her **actually-reachable set** — no nav/entitlement gap found.

---

## 2. In-character walkthrough (thought experiment over the model above)

I open `/org/tania-fleet/executive` first — this is where the renewal case for a scaleup EM should live, and it does. The **"Value this period"** line reads something like "3 recommendations completed · fleet +6 pts · 2 repos leveled up." That is *exactly* the sentence I told the CFO I needed — not a static "Done: N" backlog count, not a diff I have to reconstruct by clicking through repos. `getOrgRecsActioned` even counts `RecommendationEvent` rows attributed to a person's action, joined against the actual window — that's a real, defensible number, not a vanity total. Good — criterion 2, met.

I check whether the +6 pts is real or noise. The Trajectory card shows "trend confidence NN% · noisy" when the R² is weak, and dropping down to the fleet overview, each repo's own delta renders `≈` instead of an arrow when it's inside the ±2-point guardband. That's the "is the model breathing or did the repo actually change" distinction I look for. Criterion 3 — met, and better instrumented than most tools I've cut for exactly this failure.

Now the part that decides renew-or-cut: **did a human actually open this thing.** I go to `/usage` expecting a last-active-by-person read. I get scan counts, tokens, cost, credits, badge-README impressions, abuse counters. Every single number here is something a cron or a GitHub webhook produced. There is nothing that answers "did anyone on my team log in and look at this in the last six weeks" — the specific 30-day-cold-streak signal my own renewal research (and my last two culls) says is the actual decisive one, independent of everything else. I check the audit log too, hoping a `dashboard.viewed`-type entry exists — it doesn't; the recognized action set is scan/rec/member/plan/alert events only. So "someone opened it" is genuinely not answerable in-app. That is precisely my #1 pet peeve: a usage page that proves the cron is alive but not the team.

Here's the nuance, though: `recsActioned` is *itself* a weak proxy for human engagement — someone had to open a rec and mark it done, so it's not purely mechanical. It's not nothing. But it conflates two different questions I keep separate on purpose: did anyone *look* (login/open, the churn tell), and did anyone *act* (this metric). A team that still opens the dashboard every Monday but has no open recommendations this quarter would look "cold" by this proxy even though they're clearly still using it; and a team that batch-actioned three old recs in a five-minute sweep looks "engaged" even if nobody's opened the dashboard since. I can't fully trust `recsActioned` as a substitute for the login signal — I'd note that as a gap in my memo, not paper over it.

Cost↔value: `/pricing` now shows a real Team $ figure (derived from the same `plans.ts` the credit gate reads, so it can't drift), and `/usage`'s `AllotmentPanel` shows burn vs the 500-credit Team allotment. I can form a $/actioned-move number, but I have to hold three tabs open to do it — pricing for the $, usage for the burn, executive for the actioned count. Not the single line I was promised, but each number is real and I can paste all three into the CFO sheet in a few minutes.

Verdict I'd actually write, on the code as it stands: "Recs actioned + fleet points moved this quarter are real and defensible — that's a partial keep signal. But I still can't prove a human opened this dashboard since the last renewal, which is the number that decides a cull. Flagging that as a gap, not a blocker — keeping for now on the actioned-value evidence, revisit if that engagement question isn't answered by next cycle."

## 3. Findings

```json
[
  {
    "id": "L1-TANIA-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "tania-scaleup-costcut",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "No human-engagement / last-active-by-a-person signal anywhere in the app",
    "expected": "A last-active-by-a-person or dashboard-open trend on /usage or the org overview, distinct from scan volume — Tania's #1 scored criterion and the decisive renewal signal per her cited churn research.",
    "got": "src/app/usage/usageDashboard.tsx renders only machine-counted metrics (scans, tokens, cost, credits, badge impressions, abuse counters). The audit trail (src/lib/db/scans-audit.ts, AuditLogViewer.tsx:18-31) has no session/dashboard-view action type. src/app/org/[slug]/layout.tsx:154-161 seeds an owner Membership on first visit but never stamps repeat-visit recency.",
    "evidence": ["src/app/usage/usageDashboard.tsx:1-216", "src/components/org/audit/AuditLogViewer.tsx:18-31", "src/lib/db/scans-audit.ts:1-80", "src/app/org/[slug]/layout.tsx:154-161"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm live that no page-view/session telemetry exists anywhere in the running app (e.g. via network/DB inspection during a real /usage visit), and gauge whether Tania would still write 'renew' using recsActioned alone as a proxy, or whether the missing engagement number actually tips her to 'cut'."
  },
  {
    "id": "L1-TANIA-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "tania-scaleup-costcut",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "Cost↔value at Team tier is real but scattered across three screens instead of one line",
    "expected": "One screen where credit burn, the plan's $ price, and this period's actioned value sit together so a $/actioned-move number is legible without cross-referencing.",
    "got": "Team's $ price lives on /pricing (src/app/pricing/page.tsx:40, src/lib/plans.ts:57-60,88), burn-vs-500-allotment lives on /usage (usageDashboard.tsx:110, AllotmentPanel), and recsActioned/pointsMoved lives on /org/[slug]/executive (briefing.ts:259-264). All three are real and grounded, none are co-located.",
    "evidence": ["src/app/pricing/page.tsx:1-40", "src/app/usage/usageDashboard.tsx:107-110", "src/lib/org/briefing.ts:259-264"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Time the live 3-screen assembly against her ~10min bar to see if it's still comfortably under, or if it eats into the time-saved budget enough to matter."
  }
]
```

**Strength (positive finding, worth protecting):** `valueRealizedLine` + `getOrgRecsActioned` (`src/lib/org/briefing.ts:44-51`, `src/lib/db/org-rollup.ts:670-696`, explicitly commented `// TANIA`) is a well-grounded, purpose-built answer to her #2 criterion — a real per-window count of actioned recommendations and fleet points moved, distinct from a static backlog tile, shown only when there's something to show (never a fake "0·0·0"). The repo-level noise band (`src/lib/maturity/noise.ts`) and its `≈` rendering (`src/components/ui/format.ts:33-34,42`) plus the exec-level `forecastConfidenceNote` genuinely solve her "is this real or the model breathing" trust requirement. `/pricing`'s derivation from the same `plans.ts` the entitlement gate reads (no drift between marketing copy and what's charged) is exactly the renewal-legibility fix her character file calls out as previously missing.

## 4. Character voice — first-person reaction

"Okay, credit where it's due: somebody built the actioned-value line I actually asked for. 'N recommendations completed, fleet +X pts, Y repos leveled up' — that's a sentence, not a spreadsheet I have to build myself, and it's counting *actions*, not restating a backlog. The noise band is the other thing I look for and don't usually get — a `≈` instead of a green arrow on a +1 is exactly the honesty that makes me trust a tool more, not less. Pricing finally shows me a real Team number too, so I'm not stuck reconstructing $/month from a Polar invoice.

But I still can't answer my actual first question — did a human on my team open this dashboard since March, or did I just watch a cron count its own scans for six weeks. That's not a nice-to-have for me, that's the renewal signal, and it's the one thing I came here specifically to check. I can build a case out of actioned recs and points moved, and honestly it's a *better* case than I've gotten from the last two tools I cut — so I wouldn't cut Ascent on this evidence. But I'd write 'partial answer' in my memo, not 'proven,' and if next cycle still can't tell me whether a person logged in, that's the item that gets it re-flagged. Close, not done — for MY job specifically, the login/engagement number is the one piece I still can't get without emailing someone and asking."

---
**Verdict: L1-conditional** — the journey completes (she can reach a renew/downgrade/cut call from `/executive` + `/usage` + `/pricing`), but a major finding (no human-engagement/last-active signal) means the call is built on a proxy, not the primary signal she declared. Still L2-eligible.
