# L1 report — Lena (seed-stage CTO) × "Repeated org scans worth the price"

cert_level: L1 (theoretical, static, code-grounded) · date: 2026-07-16

---

## 1. Surface model (import-chain-traced, file:line cited)

### Reachability check
Lena is on the **bypass auth path** (`ASCENT_AUTH_BYPASS=1`, `src/lib/access.ts`) as a synthetic owner `Membership`, so every `/org/[slug]/*` route in her surface binding is nav-reachable with no plan gate blocking navigation itself. Her binding (`uat/characters/lena-seed-node-cto.md:4`) is `/org/[slug]` (overview), `/org/[slug]/executive`, `/trends`, `/usage`, `/pricing`, cadence controls. All five resolve to real routes below; none is hidden behind an entitlement she lacks (Team unlocks white-label + segments, which she isn't asking for here). **Reachable set confirmed = the full binding.**

### A. `/org/[slug]` — Overview (repos×time)
- `src/app/org/[slug]/page.tsx:1-134` — server component. Fetches `getOrgRollup` + `getOrgRepoHistories` (line 65-68), derives `buildTrajectories` (`src/components/org/overview/repoTrajectory.ts:52-86`) and a heatmap projection (line 92-98).
- Renders `RepoCategoryRollup` (`src/components/org/overview/RepoCategoryRollup.tsx`) — the replacement for the old org-wide "Movers" list + `Trajectory` card the journey file flags as reframed. Per-repo `deltaWindow`/`deltaLast` (repoTrajectory.ts:36-38), muted to "≈" via `fmtDelta`/`toneFor` when `isWithinNoise` (`src/components/ui/format.ts:33-44`, band = ±2, `src/lib/maturity/noise.ts:16`), and separately muted when `deltaCrossesEngine` (repoTrajectory.ts:39-41, RepoCategoryRollup.tsx:118-133) — a mock→live engine transition is never dressed as a real move.
- `RepoDimensionHeatmap` (`src/components/org/overview/RepoDimensionHeatmap.tsx`) — per-repo × per-dimension current scores, sortable; **no delta/trend column** — it's a snapshot, not a "what changed" view.
- **No org-level slope/R²/ETA card on this page** — the old page-level `Trajectory` card was removed here (confirmed absent from imports at page.tsx:1-13; `Trajectory.tsx` still exists but is now imported only by `/trends`, single-repo — `src/app/trends/page.tsx:5`).

### B. `/org/[slug]/executive` — the trajectory + provenance surface
- `src/app/org/[slug]/executive/page.tsx:38` calls `buildExecBriefing` (`src/lib/org/briefing.ts:154-295`).
- **Trajectory card** (page.tsx:153-169): `briefing.forecastHeadline` from `forecastHeadline()` (`src/lib/maturity/forecast.ts:332-345`) — produces exactly Lena's target sentence shape: *"On track to reach L4 · Managed in ~8 weeks (≈ 2026-09-10)."* Confidence: `forecastConfidenceNote(briefing.forecastConfidence)` (briefing.ts:36-39, exec page:159-161) → `"trend confidence 62%"` or `"· noisy"` under 50%. `forecastConfidence` is explicitly **suppressed** (set null) when the fit is `lowData` (briefing.ts:243-248) rather than showing a fake 100% from a 2-point OLS fit (forecast.ts:58-62) — an honest-ceiling design choice.
- **Movement** (page.tsx:214-226, `briefing.ts:283-284,145-151`): top 3 gainers/regressers via `MoveRow` (`src/components/org/executive/briefingShared.tsx:50-89`) — repo name, level-from→to, signed overall delta, muted noise/engine coloring inherited from `deltaHex`/`fmtDelta`. **Does not show which dimension drove that repo's move** — no per-repo dimension breakdown in this list.
- **Fleet-wide dimension provenance** (page.tsx:171-176, `briefingShared.tsx:107-152` `PriorPeriodGrid` with `showDimensions`): the top-6 fleet dimension deltas vs the prior equal-length window, sorted by |delta| (briefing.ts:214-224) — this is where "what moved and why" is answerable at the fleet level (e.g. "D7 Governance +5 drove this quarter").
- **"The move to make next"** (page.tsx:180, `src/components/org/executive/OrgLeverageMoves.tsx:22-76`): ties a recommendation to `dimShort(rec.dimId)` (line 37/53) + an engine-true `gainPhrase` (line 12-16, "≈ +N pts on M repos"). Explicitly labeled `"current state · not period-scoped"` (line 29) — this is prescriptive (what to fix next), **not** a diagnostic tie of *this period's actual movement* to a cause.
- **Copy-for-LLM** (page.tsx:85, `briefing.ts:302-385`): serializes the whole briefing to markdown ending in an explicit "Ask" — Lena's "paste into the deck" affordance is real, not aspirational.

### C. `/usage` — cost↔value legibility
- `src/app/usage/page.tsx:1-160` → `UsageDashboard` (`src/app/usage/usageDashboard.tsx`).
- Credits balance + burn: `Stat label="Credits"` (usageDashboard.tsx:77-91), sourced from `getCreditState` (page.tsx:100).
- **Right-sizing** (usageDashboard.tsx:110, `src/app/usage/AllotmentPanel.tsx:29-37`): `allotmentRead()` computes `monthlyBurn` normalized to 30d and `pct` of `includedCredits`; `fit: "under" | "ok" | "over"` — `"under"` fires at `pct < 25`. This is a direct, coded answer to Lena's Right-sizing criterion: at her stated 48/500 (~9.6%) cadence, `fit = "under"` and the panel literally renders *"You're using ~10% of your 500/mo allotment — a smaller tier may fit."* (AllotmentPanel.tsx:62).
- **Subscription price is NOT shown on `/usage`** — the page shows credits/burn/estimated LLM cost (usageDashboard.tsx:92-105, computed from token rates) but never the plan's `monthlyPrice`. The only in-app link out is `CreditsControl`'s "See plans →" → `/pricing` (`src/components/org/shared/CreditsControl.tsx:250-257`), and that link renders **only when `!buyEnabled && !grantsEnabled`** — i.e. it disappears in the dev/bypass config where `ASCENT_ALLOW_CREDIT_GRANTS=1` is set (env.md:35), which is exactly Lena's L1/L2 seed state.

### D. `/pricing` — the actual $ figure
- `src/app/pricing/page.tsx:40-41,79-83` — `planPriceLabel("team").amount` reads `PLAN_FEATURES.team.monthlyPrice` (`src/lib/plans.ts:57-68`) = **$20/mo**, 500 included credits, 365-day retention — all derived from the one `plans.ts` source the entitlement gate also reads (comment at plans.ts:1-5), so the price can't drift from what's charged. This is a public, unauthenticated route — always reachable regardless of her org state.
- Retention is not just a label: `retentionCutoff()` (`src/lib/plans.ts:189-`) is a real read-floor consumed by `src/lib/db/org-rollup.ts` (grep confirms), so Team's 365-day window is a genuine query bound, not decorative copy.

### E. Cadence / alerts
- `src/components/org/AlertsControl.tsx` (context-map.json:358-374) + `src/lib/alerts.ts:1-121`: `detectRegression()` fires on level demotion, ungoverned-posture slide, `overallDrop ≥ 5`, or `dimensionDrop ≥ 15` — thresholds set explicitly **above** the noise band (alerts.ts:40-42 comment cites the measured ±0-1 wobble). `digestHasSignal()` (alerts.ts:54-64) gates the periodic digest so a flat week stays silent rather than crying wolf — directly protects Lena's "recurring value" criterion (a chore that pesters with nothing new erodes trust).
- Scan cadence itself: `src/components/org/repositories/ScheduleSelect.tsx` (under `/org/[slug]/repositories`, outside her named binding but reachable from Overview).

---

## 2. In-character walkthrough (thought experiment over the model above)

**Scored acceptance criteria, walked identically each run:**

1. **Recurring-value check** — PASS, well-grounded. The repos×time Overview (`RepoCategoryRollup`) surfaces real per-repo movement this cycle, not a re-render — `deltaWindow` is null-safe (no fake 0 on a single scan) and noise-muted. The executive Movement + "vs previous period" sections add fleet-level "what's different since last quarter." I'd open Executive first (it's built for exactly my question), Overview second to drill into which repos.
2. **Trajectory is board-credible** — PASS, strong match. `forecastHeadline` + `forecastConfidence` on the executive page produces almost verbatim the sentence I'm hunting for ("on track to L4 in ~8 weeks"), with the noisy-fit hedge surfaced right under it, and the honest suppression of a fake 100% confidence on thin data is exactly the kind of self-aware design that earns trust from someone who's been burned by vanity metrics before.
3. **Move is trustworthy** — PASS. The noise band (±2) is a real, tested, shared primitive (`noise.ts`) wired into the actual delta-rendering helpers (`fmtDelta`/`deltaHex`/`toneFor`) used by both the Overview rows and the Executive movers — so a scan-to-scan wobble literally can't paint itself green/orange in front of me. The mock→live engine-transition mute is a second, independent honesty layer I wasn't expecting and which directly defuses my #1 pet peeve.
4. **Provenance** — CONDITIONAL. Fleet-level: strong — `PriorPeriodGrid`'s per-dimension breakdown lets me say "Governance (D7) is what moved us" in a board update. Repo-level: weak — the "Movement this period" mover rows (gainers/regressers) show only the repo's overall delta and level change, no dimension attribution; "The move to make next" ties a dimension to a *prescribed* future action, not to *this period's actual mover*. If a partner asks "why did acme-api jump 8 points," I have to click through to that repo's own report to answer — workable, but not the one-paste answer the rest of the page trained me to expect.
5. **Price-legibility check** — CONDITIONAL. The number exists and can't drift (`plans.ts` single-sources `/pricing` and the entitlement gate) — but it's not co-located with my credits/burn view. `/usage` shows my 48-ish/500 burn and computes the exact "you're at ~10%, a smaller tier may fit" line I want, then stops short of the dollar figure that turns that into a renewal decision. I'd have to open a second tab (`/pricing`) and manually match "Team" to my burn — doable in under a minute, but it's a second hop, and in my actual dev/bypass state the one in-app link that would have carried me there (`CreditsControl`'s "See plans →") is coded to be **hidden** whenever manual credit grants are enabled — which is my own seed config.
6. **Right-sizing** — PASS, direct hit. `allotmentRead()`'s `"under"` fit at <25% utilization is precisely my 48/500 situation, and the rendered copy is a one-line reason I could paste almost as-is: "using ~10% of your 500/mo allotment — a smaller tier may fit."

**Motivation (time-saved):** Designed experience plausibly delivers close to the promised ~105 min/quarter saved. Executive tab is a genuine copy-paste (`briefingMarkdown` + PDF + share link) for the trajectory + movement narrative — that's the ~10-15 min "open, read, copy" she describes. The one tax against the number: right-sizing requires a second surface (`/pricing`) not linked from where the burn number lives, adding a couple of minutes she didn't budget for — not enough to erase the savings, but not the frictionless one-stop she was promised either.

**Senior-quality bar:** The trajectory card, on paper, is the artifact a senior CTO would actually build by hand — stated confidence, honest suppression of overconfident fits, an ETA with a date. It would clear the "would I paste this into a board deck without hedging" test. The one place it would NOT clear a rigorous partner's follow-up ("so what specifically drove that gain?") is the repo-level mover list — a senior CTO pressed on provenance for a *specific* repo's move would need one more click than the design implies is necessary.

---

## 3. Findings

```
[
  {
    "id": "L1-LENA-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "lena-seed-node-cto",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Repo-level movers (Executive → Movement this period) carry no dimension attribution",
    "expected": "The biggest mover names the dimension/action that drove it, per her Provenance criterion.",
    "got": "MoveRow (briefingShared.tsx:50-89) renders only name, level-from→to, and overall delta; per-repo dimension deltas aren't surfaced there. Fleet-level dimension attribution exists (PriorPeriodGrid, briefingShared.tsx:107-152) but isn't tied to the specific repo movers listed above it.",
    "evidence": ["src/components/org/executive/briefingShared.tsx:50-89", "src/lib/org/briefing.ts:145-151"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm live whether a Character can answer 'why did repo X move +8' from the executive page alone, or must open that repo's own trend page — and time the extra hop."
  },
  {
    "id": "L1-LENA-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "lena-seed-node-cto",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "The one in-app link from usage/burn to the subscription price is hidden in exactly the seeded L2 dev/bypass config",
    "expected": "From /usage (where credits + burn live), a visible path to the $ figure needed to close the Price-legibility / Right-sizing loop.",
    "got": "CreditsControl's 'See plans →' link to /pricing only renders when !buyEnabled && !grantsEnabled (CreditsControl.tsx:250-257); env.md pins ASCENT_ALLOW_CREDIT_GRANTS=1 for local dev, which sets grantsEnabled=true and suppresses exactly this link. /usage itself has no other link to /pricing.",
    "evidence": ["src/components/org/shared/CreditsControl.tsx:250-257", "uat/env.md:35"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Drive /usage live under the pinned env.md config and confirm no path to /pricing exists from the credits chip; note whether AllotmentPanel or the credits Stat could carry the $ figure directly instead of relying on the popover link."
  },
  {
    "id": "L1-LENA-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "lena-seed-node-cto",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Overview's org-level trajectory card was removed with no fleet-level R²/ETA replacement on that page",
    "expected": "Journey hint flags this reframe explicitly as worth confirming; Lena's own criterion #2 wants slope+R²+ETA available where she looks first.",
    "got": "Old page-level org-wide Trajectory card is gone from /org/[slug] (page.tsx:1-134 imports repoTrajectory.buildTrajectories, not the forecast module); the fleet forecast with R²/ETA now lives only on /executive. Not a real gap for THIS character (her binding names /executive explicitly and she'd land there for exactly this reason), but a first-look Overview visitor gets no trajectory hint to point them to it.",
    "evidence": ["src/app/org/[slug]/page.tsx:1-13", "src/lib/org/briefing.ts:242-248"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "Overview intentionally moved from an org-wide single trajectory to a repos×time model (per journey discovery hints); the fleet forecast survives, just relocated to Executive — acceptable for Lena since her surface binding already includes /executive.",
    "l2_priority": "n/a — accepted design tradeoff for this Character; worth checking for a Character whose binding is Overview-only."
  }
]
```

## 4. Lena's voice — first-person reaction

"Okay, this is closer to the slide I actually want than I expected. The trajectory line on the Executive tab — 'on track to L4 in ~8 weeks, trend confidence 62%' — that's the sentence. Not a rising arrow with no spine under it; an actual fit with a number I can hedge or defend. And the fact that it *suppresses* the confidence number when there's only two data points instead of showing me a smug fake 100% — that's the kind of thing that makes me trust the rest of the page more, not less. Same with the noise band on the movers: a repo that wobbled ±1 shows me a muted '≈+1', not a confident green triangle. I've been burned by exactly that kind of false-positive 'improvement' before, so seeing the product name its own uncertainty instead of hiding it is the tell that somebody building this has actually sat in a board meeting.

Two things keep it from being a full 'this is my Q-update, done' though. First — when a partner asks me 'why did acme-api jump 8 points,' the Movement list just tells me *that* it jumped, not *why*. I have the fleet-wide 'Governance moved +5' story from the comparison grid, which covers most of what I need, but I can't point at one specific repo's mover and name its cause without one more click into that repo's own report. Workable, but it's the one seam in an otherwise tight artifact.

Second — the right-sizing math is *right there*: 'you're using ~10% of your 500/mo allotment, a smaller tier may fit' is almost exactly the sentence I'd put in a Slack message to my co-founder about downgrading. But it stops one hop short — no dollar figure next to it. I have to go open Pricing separately and do the $20-Team vs $10-Pro math myself. And in my own dev setup that one link that would've bridged the two pages is actually coded to disappear. Minor, but it's the kind of thing that, if it ships that way, makes me wonder what else is one tab away instead of on the page I'm already looking at.

Would I adopt it? Yes — on the numbers alone this beats my two-hour spreadsheet cobble by a mile, and I'd trust the trajectory line enough to paste it. Would I tell a peer? 'The exec tab is basically your board slide, pre-built — go look at that first, skip the overview.' That's a real recommendation, not a hedge."
