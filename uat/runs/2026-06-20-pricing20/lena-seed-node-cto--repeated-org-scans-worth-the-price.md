# L1 — Lena (seed-stage CTO) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the recurring board-ROI read is structurally strong (trajectory with R²/ETA + a copy/PDF/share briefing that is genuinely board-paste-ready), but two recurring-value defects bite every quarter: (1) the **subscription price is invisible** at her tier, so she can't close the ROI math the board asked for, and (2) the **"365-day history" she's billed for on Team is a marketing label**, not a wired retention floor — the trajectory looks back as far as data exists regardless of tier. Plus a trust gap: the move-vs-noise defense (R²/flat-floor) exists on the Trajectory card but is **not surfaced on the movers/period tiles** where the +N deltas actually live.

## Reachable surface set (tier-honest, Team / 500 credits)
Under `ASCENT_AUTH_BYPASS=1` on a populated `/org/<slug>` she's a synthetic owner, so the routes render. Judging Team entitlements honestly:
- **Reachable + tier-included:** `/org/[slug]` overview (Trajectory, movers/period), `/org/[slug]/executive` (briefing, **Download PDF**, **Copy briefing for LLM**, **Share** — owner-gated, she qualifies), `/trends`, `/usage` (credit burn), `/pricing`. Scheduled autoscans + alerts (Pro+, so included on Team). Segments + comparisons, playbooks (Team-only — included).
- **Reachable but NOT a Team feature (fold into price, not a freebie):** white-label branding on the executive tab (`canBrand = credit?.unlimited` → Enterprise only, executive/page.tsx:46). Custom retention (Enterprise).
- **Effectively unreachable value:** a *price* for Team. `/pricing` shows only "Prepaid — credits, 1 per private scan"; the subscription $ lives in Polar, not the app (brief §Pricing facts; plans.ts has no dollar amounts by design, plans.ts:4).

## Surface-model notes (recurring-value affordances → file:line; grounding-audit emphasis)
- **Trajectory needs repetition to exist, and surfaces its own confidence.** `forecastTrajectory` returns null below 2 distinct calendar days (`forecast.ts:87`, `:100`); `FLAT_PER_WEEK = 0.5` is the noise floor that collapses sub-0.5/wk drift to "flat" with no ETA (`forecast.ts:64`, `:131`, `:147`). R² is computed and rendered as "trend confidence N%" with a "· noisy" tag under 50% (`Trajectory.tsx:33`, `:96`). For Lena's weekly cadence a quarter yields ~12–13 points — **a genuinely fittable line**, and the R² stamp is exactly the board-credibility hook she wants. This is the strongest part of the surface for her.
- **The board artifact is real and re-pullable.** `buildExecBriefing` assembles maturity + benchmark + forecast headline + movers + **vs-previous-period** per-dimension deltas (`briefing.ts:89`, `:128`, `:167`); `forecastHeadline` emits the exact "On track to reach L4 … (≈ date)" sentence she's hunting for (`forecast.ts:283`). It serializes to markdown with a Standing/Trajectory/Movement/Recommended-next-move/Ask shape (`briefing.ts:205`), and the page exposes **Copy / Download PDF / Share** (`executive/page.tsx:57`, `:64`, `:65`). Same shape every quarter = the re-pullable panel her board bar demands.
- **Movers compute against the previous scan, with a level transition — but NOT against a named action.** `getOrgMovers` builds `dOverall/dAdoption/dRigor`, `levelFrom→levelTo`, `sinceDays` from baseline→now (`org-insights.ts:47`, `:70`). Provenance is **dimension-level at best** (adoption vs rigor split, and the briefing's per-dim deltas, `briefing.ts:139`), never tied to a specific team action/PR/playbook. So she gets "repo X +6, L2→L3" but not "because the team added CI to X." Good enough to *name a dimension*, short of "tie a gain to a program."
- **Retention label is not wired to history (load-bearing for her overpay question).** `PLAN_FEATURES.team.retentionDays = 365` (`plans.ts:51`) is consumed **only** by display — grep shows `retentionDays` referenced nowhere outside `plans.ts` (`plans.ts:19/31/41/51/61`). The trend/forecast query (`org-rollup.ts:220`, `:243`) and movers (`org-insights.ts:84`) apply **no tier retention floor**; the only real purge is enterprise env-driven `retentionMaxScans` (`retention.ts`, schema.prisma:38). Net for Lena: her trajectory can look back as far as data exists *on any tier* — which helps the read but means the "1-year history" she's paying Team for is **illusory differentiation**.
- **Re-scan noise defense is surfaced on Trajectory but not on the movers/period tiles.** The LLM is guardbanded ±25 to the deterministic signal (`LLM_GUARDBAND = 25`, `model.ts:23`) and blended 60/40, so re-scanning an unchanged repo under claude-cli can wobble within the band. The forecast's R²/flat-floor is the *only* "this move is real" defense and it lives on the Trajectory card (`Trajectory.tsx:96`) — but `PeriodSummary`/movers render raw `+N` deltas with **no confidence annotation**, so a +2 from model breathing reads identical to a +2 from real work. That's the trust gap that can put a fake gain in a board slide.

## Findings
```json
[
  {
    "id": "lena-l1-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "lena-seed-node-cto",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Subscription price is invisible at her tier — she cannot close the board's ROI math",
    "expected": "At Team she can see the recurring $ (or credit-pack price) so she can answer the board's 'what is it costing us and is it worth it' with a number.",
    "got": "/pricing shows only 'Prepaid — credits, 1 per private scan' for Pro/Team and 'Custom — contact us' for Enterprise; the actual subscription price lives in Polar, never in the app. plans.ts intentionally carries no dollar amounts.",
    "evidence": ["src/lib/plans.ts:4", "src/lib/plans.ts:24"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm /pricing renders no $ for Team and that /usage shows credits-only, no spend-in-dollars — so the cost↔value math is undecidable in-app.",
    "suggested_acceptance": "A paid-tier user can see a price (subscription or credit-pack $) somewhere reachable from /pricing or /usage without leaving the app."
  },
  {
    "id": "lena-l1-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "lena-seed-node-cto",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "'365-day history' is a billed label with no wired retention floor — tier differentiation is illusory",
    "expected": "The retention window each tier sells (30/180/365) actually gates how far back the trajectory can look — i.e. Team buys a longer fittable history than Pro.",
    "got": "retentionDays is defined in PLAN_FEATURES and shown on /pricing but consumed nowhere in the query layer; the trend/forecast and movers queries apply no per-tier retention floor. Real purge is enterprise env-driven retentionMaxScans only. Trajectory looks back as far as data exists on any tier.",
    "evidence": ["src/lib/plans.ts:51", "src/lib/plans.ts:19", "src/lib/db/org-rollup.ts:220", "src/lib/db/org-insights.ts:84", "prisma/schema.prisma:38"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "l2_priority": "With a populated org, confirm a >180-day-old scan still appears in the trajectory fit under a Team (and even Free) plan — proving retentionDays does not gate history.",
    "suggested_acceptance": "Trajectory/trend history older than the plan's retentionDays is excluded from the fit for non-enterprise tiers, OR the pricing label is removed."
  },
  {
    "id": "lena-l1-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "lena-seed-node-cto",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Movers/period tiles show raw +N deltas with no confidence — re-scan noise reads identical to real movement",
    "expected": "Where a per-cycle +N delta is shown, it carries a signal-vs-noise cue so she doesn't paste a guardband wobble into a board slide as a real gain.",
    "got": "LLM is guardbanded ±25 and blended 60/40, so an unchanged repo re-scanned under claude-cli can wobble. The R²/flat-floor defense is rendered only on the Trajectory card; getOrgMovers and PeriodSummary surface raw dOverall with no confidence annotation.",
    "evidence": ["src/lib/maturity/model.ts:23", "src/lib/db/org-insights.ts:47", "src/components/org/Trajectory.tsx:96"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Re-scan an unchanged repo twice under claude-cli; observe whether dOverall moves within the guardband and whether anything on the movers/period tiles flags it as noise vs the Trajectory card's R².",
    "suggested_acceptance": "A small period delta on an unchanged repo is annotated (or suppressed) as within-noise, not shown as a bare +N."
  },
  {
    "id": "lena-l1-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "lena-seed-node-cto",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "Movers name a dimension but not the team action that caused the gain — short of board-grade provenance",
    "expected": "The biggest mover ties to a specific cause she can cite ('repo X +6 because the team added CI / adopted the testing playbook'), per the CTO-ROI 'attribute the gain to a program' bar.",
    "got": "Movers carry dOverall + adoption/rigor split + levelFrom→levelTo; the briefing adds per-dimension deltas. That names a DIMENSION but never links to a commit/PR/playbook action, so she infers cause rather than reading it.",
    "evidence": ["src/lib/db/org-insights.ts:47", "src/lib/org/briefing.ts:139"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Check whether any surface links a mover to the underlying dimension-rec or repo change that drove it, or whether cause is left to inference.",
    "suggested_acceptance": "A top mover surfaces the dimension(s) and the open/closed recommendation that plausibly drove the change."
  },
  {
    "id": "lena-l1-05",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "lena-seed-node-cto",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "low" },
    "dimension": "completion",
    "title": "Stable Node fleet may flatline the trajectory into 'no level change projected' — repetition stops surfacing new",
    "expected": "Even on a mature/stable fleet, each cycle says something new — otherwise the recurring read decays into 'nothing changed'.",
    "got": "Below FLAT_PER_WEEK=0.5/wk drift the trajectory is 'flat' with eta=null → 'no level change projected within the year'. For a steady 12-repo Node fleet that's the likely steady state, leaving only movers/period to carry novelty.",
    "evidence": ["src/lib/maturity/forecast.ts:64", "src/lib/maturity/forecast.ts:147", "src/components/org/Trajectory.tsx:88"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "l2_priority": "On a low-velocity seeded fleet, confirm whether a flat trajectory + thin movers makes a 2nd-quarter read feel like 'nothing new' for her board line."
  },
  {
    "id": "lena-l1-06",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "lena-seed-node-cto",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — board-credible trajectory: slope + ETA + R² confidence, all re-pullable as a same-shape briefing",
    "expected": "A quarter of weekly points yields a defensible 'we moved L2→L3, on track to L4 by ~date' line with a stated confidence she can cite or hedge.",
    "got": "forecastHeadline emits exactly that sentence; Trajectory.tsx renders trend-confidence N% (· noisy <50%); the executive briefing assembles it + per-dimension period deltas into a Copy/PDF/Share artifact of the same shape every quarter. This is the core of her job, and it's present.",
    "evidence": ["src/lib/maturity/forecast.ts:283", "src/components/org/Trajectory.tsx:96", "src/lib/org/briefing.ts:167", "src/app/org/[slug]/executive/page.tsx:64"],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  },
  {
    "id": "lena-l1-07",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "lena-seed-node-cto",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "effort",
    "title": "48/500 credits is reachable on /usage, so overpay is visible — but with no $ she can only judge it half-way",
    "expected": "She can see her burn against the allotment AND the price, to decide Team is oversized for ~48 credits/mo.",
    "got": "/usage + UsageTrend show credit burn over time (IDOR-guarded), so 48/500 utilization is legible — she can see she's at ~10% of Team's allotment. But without the subscription $ (lena-l1-01) she can't complete the downgrade ROI calc.",
    "evidence": ["src/app/usage/page.tsx:1", "src/lib/plans.ts:51"],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  }
]
```

## Character feedback (first person — Lena)
Would I renew? Probably yes, but grumbling — and not on Team. The thing I actually came for is here: I open the executive tab, there's a line that says "on track to reach L4 in ~7 weeks, trend confidence 78%," and I can hit Copy or Download PDF and that's my board slide. That's the sentence I've been hand-writing badly for two hours every quarter. The R² is the part that makes it *defensible* — without it a rising arrow is just hope, and they put the confidence right on the card. Good.

But two things make me narrow my eyes. First: **I can't see the price.** I'm supposed to walk into a board meeting and answer "is this earning its keep?" and the app shows me credits — 48 of 500 — and zero dollars. I can see I'm barely using a tenth of Team's allotment, which already tells me I'm probably overpaying, but I can't finish the math because the subscription number isn't in here, it's off in some billing portal. That's the exact question I'm paying the tool to help me answer.

Second, and this one annoys me as a founder who reads the fine print: **I'm on Team partly for "1-year history," and that label does nothing.** The trajectory looks back as far as my data goes no matter what plan I'm on — I checked, retention isn't wired to the tiers at all except for the enterprise purge. So I'm being upsold on a window that isn't actually gated. Don't sell me a year of history as a Team perk if Pro would fit the same line.

Is each cycle telling me something new? The trajectory and the period-deltas do — but I worry about the movers. A "+2 this week" on a repo nobody touched looks exactly like a "+2" from the team actually shipping CI, and the only place you tell me "this might be noise" is the confidence on the Trajectory card, not on the tiles where the +numbers live. If I paste a guardband wobble into a board update as a real gain and a partner catches it, that's *my* credibility, not yours. And the move tells me a dimension moved, not *what we did* to move it — I still have to supply the "because we adopted the testing playbook" myself.

Would I tell a peer? Yes — "the quarterly line is real and re-pullable, just downgrade to Pro and don't trust the small movers without checking." That's a recommend with an asterisk, not a rave.

## Grounding score · time-saved · pricing verdict
- **Grounding (recurring-context sources reaching the read): 4 / 6.**
  Reaches: (1) **trajectory** needs real history + surfaces R²/flat-floor (`forecast.ts`, `Trajectory.tsx`); (2) **period/prior-period deltas** computed vs window start (`org-rollup.ts`, `briefing.ts`); (3) **movers** vs previous scan with dimension split (`org-insights.ts`); (4) **briefing** consolidates them into a re-pullable artifact (`briefing.ts`). Missing: (5) the **noise defense does not reach the movers/period tiles** where the deltas are shown (only the Trajectory card) — finding 03; (6) **tier retention does not reach the history query**, so the "how far back" source is ungated and the billed window is illusory — finding 02.
- **Per-cycle time-saved: ~105 minutes per quarter** (manual board-metric cobbling ~120 min → ~15 min to open the executive tab, read the trajectory headline + period deltas, and Copy/Download the briefing). ~7 hrs/year. The qualitative jump — a confidence-stamped, defensible line vs "we're getting faster" — is the larger win.
- **Verdict: DOWNGRADE (Team → Pro).** One line: at ~48 credits/mo she uses <10% of Team's 500 and the tier's headline differentiator she'd care about — 365-day history — isn't actually wired, so Pro's 100 credits + 180-day label (also unenforced) + the same org dashboard/briefing/scheduled-autoscans deliver her entire recurring job for less. She renews the *product*, downgrades the *tier* — and the invisible price (finding 01) is what stops her from doing that math cleanly today.

## l2_priority carry-forward (top first)
1. **Re-scan an unchanged repo twice under claude-cli** and watch whether `dOverall` moves within the ±25 guardband and whether *anything on the movers/period tiles* flags it as noise vs the Trajectory card's R² (finding 03 — the trust crux for a board slide).
2. **Confirm retention is ungated:** on a populated org, verify a >180-day-old scan still enters the trajectory fit under Team and Free, proving `retentionDays` doesn't gate history (finding 02 — the overpay/label crux).
3. **Confirm the price is undecidable in-app:** /pricing renders no $ for Team and /usage shows credits-only (finding 01).
4. **Low-velocity novelty check:** on a stable seeded fleet, does a 2nd-quarter read flatline into "no level change projected" + thin movers, i.e. "nothing new" (finding 05)?

References that set Lena's bar: [AI ROI for Boards (hoolahoop)](https://hoolahoop.io/articles/cto-coaching/ai-roi-for-boards/) · [CTO's Guide to AI Development Tool ROI (Augment Code)](https://www.augmentcode.com/tools/cto-s-guide-to-ai-development-tool-roi)
