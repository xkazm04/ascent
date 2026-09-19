# L1 — Klaus (embedded firmware lead) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — this is a re-run against the current codebase (the prior L1 pass is `uat/runs/2026-06-20-pricing20/klaus-embedded-firmware--repeated-org-scans-worth-the-price.md`, since which the Overview was rebuilt from `PeriodSummary`/page-level `Trajectory` into `RepoCategoryRollup` + `buildTrajectories`, and pricing moved to a real monthly-subscription model). Two of the four prior majors are now resolved (price is visible; dedup/refund is intact and re-verified against the refactored `scan-credit.ts`). The other two persist in substance, just relocated: the fleet-level noise/trend-confidence guard still exists but now lives only on `/executive` (and per-repo `/trends`), not anywhere near the Overview's new "movers" surface (`RepoCategoryRollup`'s masthead + per-row deltas), and there is still no embedded/safety-critical archetype or "L1 may be the correct posture" framing in the maturity model.

## Reachable surface set (tier-honest, Pro)

Under `ASCENT_AUTH_BYPASS=1` on a populated `/org/<slug>` Klaus renders as a synthetic owner; judged at **Pro** entitlements (`src/lib/plans.ts:47-57`, `monthlyPrice: 10`, `includedCredits: 100`, `retentionDays: 180`, `seats: 3`):

- **Reachable + included at Pro:** `/org/[slug]` overview (`RepoCategoryRollup` fleet masthead + per-repo rows, `RepoDimensionHeatmap`), `/org/[slug]/executive` (fleet `Trajectory` card via `buildExecBriefing`), `/trends?repo=owner/repo` (per-repo trajectory), `/usage` (credit burn + low-balance notice), `/pricing`, scheduled autoscans (`ScheduleSelect.tsx`, gated only on `isAppConfigured()` — `src/app/org/[slug]/repositories/page.tsx:65`, not tier) + `AlertsControl.tsx`, `/api/cron/rescan`.
- **Reachable via bypass but NOT his tier (upsell, not free value):** Team-only segments/comparisons/playbooks, 365-day history; Enterprise unlimited/custom retention.
- **Cost of his cadence:** P private repos × monthly cadence = up to P credits/month against Pro's 100 included — but an unchanged repo dedups and refunds (see below), so a flat fleet's true burn tracks only the repos that actually changed.
- **Note on a surface Klaus's binding names but which no longer carries the org-wide "movers" job:** the org-level page-level `Trajectory` card that used to live on `/org/[slug]` is gone — `src/app/org/[slug]/page.tsx:1-9` no longer imports `Trajectory`; the Overview's forward-looking read moved to `/org/[slug]/executive` and per-repo `/trends`. This is a genuine reframe (confirmed against `git log`: `cae0fde refactor(org): organize components/org...`, `f566367 wip:... org-overview-refactor`), not a regression — but it means "the recurring value lives wherever the Overview currently is" (the journey's own discovery hint) now has to be traced across three pages instead of one.

## Surface-model notes (recurring-value affordances → file:line)

**Flat-trajectory-as-verdict — still intact, unchanged mechanics.**
`forecastTrajectory` returns `null` below 2 distinct calendar days (`src/lib/maturity/forecast.ts:87-101, 130`); `FLAT_PER_WEEK=0.5` classifies sub-noise drift as flat; `forecastHeadline` emits **"Holding around N (L-x) — no level change projected."** (referenced by `src/lib/org/briefing.ts:242`). On `/org/[slug]/executive`, the `Trajectory` Card renders that headline plus, co-located, **"trend confidence N% · noisy"** or an explicit **"trend confidence — low data (n=…)"** caveat (`src/app/org/[slug]/executive/page.tsx:153-166`, sourced from `forecastConfidenceNote`, `src/lib/org/briefing.ts:36-39`). The same mechanism is unit-level unchanged from the prior pass and still does exactly what Klaus wants: flatness is a stated verdict with its noise floor attached, not a blank.

**The per-repo `/trends` page now also carries this GPS** (new since the prior pass — `theo-pe-portfolio`'s earlier report noted this was org-only): `src/app/trends/page.tsx:104-109,154-157` fits `forecastTrajectory` over one repo's own history and renders `<Trajectory forecast={forecast}>` with the same confidence line. For Klaus this means he can point the trend read at a single slow-changing firmware repo directly, not just the fleet average.

**The Overview's new "movers" surface has NO noise guard — same substantive gap as the retired `PeriodSummary`, now on a different component.**
`RepoCategoryRollup` (`src/components/org/overview/RepoCategoryRollup.tsx`) is what a Klaus visiting `/org/[slug]` sees first. Its fleet masthead line — `"{repos} repos · avg N · ▲improving ▼slipping →holding · avg move ±N"` (`RepoCategoryRollup.tsx:230-255`) — and its per-repo row deltas (`RollupRow`, lines 108-134) both state score movement with **zero R²/trend-confidence/noise-band annotation**. The only noise handling present at this layer is `deltaCrossesEngine` muting (`repoTrajectory.ts:61`, `RepoCategoryRollup.tsx:120-127`) — which correctly mutes a mock→live engine-transition jump — but a **same-engine (claude-cli→claude-cli) guardband wobble on an unchanged repo still renders as a plain colored delta**, indistinguishable from a real move, exactly as in the prior L1 pass's finding against `PeriodSummary`. The fleet-level defense Klaus needs exists (on `/executive`), but it is not where his eyes land first, and not co-located with the number making the claim on Overview.

**Cost↔value machinery for a slow repo — confirmed intact after the refactor, re-traced through the new shared helper.**
Unchanged-commit dedup: `persistScanReport` keys on `headSha`, returns `deduped: true`, writes no new metered row (`src/lib/db/scans-persist.ts:203,215,445`). The refund/dedup logic that used to live ad hoc in three call sites is now centralized in `src/lib/scan-credit.ts` (`refundScanCredit`, `shouldRefundScan`) — the cron rescan calls `shouldRefundScan(report, persisted)` before refunding (`src/app/api/cron/rescan/route.ts:126,140`), and the public/scan-route dedup header is verified live in tests (`x-ascent-dedup: "hit"`, `src/app/api/scan/route.ts:283-289`, asserted in `src/app/api/scan/route.test.ts:227`). So a monthly autoscan of an unchanged repo is still free and doesn't spam a regression alert (`route.ts:142` only alerts `if (persisted && !persisted.deduped)`). This is the strongest fact for Klaus's price verdict and it survived the refactor.

**Price is now visible — the prior major is resolved.**
`src/lib/plans.ts:35-72` now carries a real `monthlyPrice` (`pro: 10`, `team: 20`, `free: 0`, `enterprise: null`) and `billing: "subscription"`; `planPriceLabel()` (`plans.ts:83-88`) derives the `/pricing` display so it can't drift from the same source the entitlement gate reads. `src/app/pricing/page.tsx:40-41,81-82` renders `$10 / month` and `$20 / month` directly on the plan cards. Klaus can now see the actual subscription line item he's renewing, not just his credit burn.

**The lens-fit problem is real and unmitigated — unchanged from the prior pass.**
`RepoArchetype` is still `"solo" | "team" | "org"` only (`src/lib/types.ts:22`, `ARCHETYPE_WEIGHTS` in `src/lib/maturity/model.ts:246`) — no embedded/safety-critical archetype. `LEVELS` (`model.ts:41-79`) still frames **L5 Autonomous** ("agents propose, test, document, and ship... humans supervising at the policy level") as the unqualified apex, with no per-level note that a lower band can be a legitimate permanent posture for certified/safety-critical code. Every cycle's roadmap still has no lens that would stop it recommending moves up a ladder his ISO 26262 / DO-178C domain shouldn't climb.

**Retention is still the quiet constraint.** Pro = 180 days (`plans.ts:53`). A monthly cadence yields ~6 points in-window; a repo that changes a few times a quarter yields only ~2-3 distinct score values to fit — barely above the forecast's 2-day floor. Unchanged from the prior pass.

## Findings (impact-scored)

```json
[
  {
    "id": "klaus-price-now-visible-strength",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "klaus-embedded-firmware",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "STRENGTH (resolves prior major): /pricing now shows the real Pro/Team subscription dollar amount, single-sourced from the entitlement model",
    "expected": "At a renewal decision I should see what Pro actually costs, not just my credit burn.",
    "got": "plans.ts now carries monthlyPrice (pro:10, team:20) and billing:'subscription'; planPriceLabel() derives the /pricing display from the same PLAN_FEATURES the gate reads, so it can't drift; pricing/page.tsx:81-82 renders '$10 / month'.",
    "evidence": ["src/lib/plans.ts:47-57", "src/lib/plans.ts:83-88", "src/app/pricing/page.tsx:40-41,81-82"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "resolved-verified",
    "ceiling": "This is a static, code-derived L1 confirmation that the price string renders correctly and matches the entitlement source; L2 must confirm it actually paints on a live /pricing load (no client error, no stale cache) before this counts as a live renewal-decision fact.",
    "l2_priority": "Load /pricing live and confirm the Pro/Team cards literally show '$10 / month' / '$20 / month' next to the feature list, not just 'Prepaid credits'."
  },
  {
    "id": "klaus-dedup-refund-strength",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "klaus-embedded-firmware",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH (re-confirmed after refactor): an unchanged-commit autoscan still dedups, refunds the credit, and suppresses the regression alert",
    "expected": "A monthly rescan of a repo that didn't change should not bill me and should not spam a 'regression' alert.",
    "got": "persistScanReport returns deduped:true with no new metered row (scans-persist.ts:203,215,445); the refund/dedup path is now centralized in scan-credit.ts (shouldRefundScan/refundScanCredit) and the cron route only alerts when !deduped (cron/rescan/route.ts:126,140,142); the public scan route's x-ascent-dedup:'hit' header is asserted in a live test.",
    "evidence": ["src/lib/db/scans-persist.ts:203,215,445", "src/lib/scan-credit.ts:34,54,59", "src/app/api/cron/rescan/route.ts:126,140,142", "src/app/api/scan/route.ts:283-289"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Confirm live: rescan an unchanged repo via /api/org/scan twice — second run returns dedup (x-ascent-dedup: hit) and the org's credit balance is unchanged."
  },
  {
    "id": "klaus-overview-movers-still-no-noise-guard",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "klaus-embedded-firmware",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The Overview's fleet masthead and per-repo rows state score movement with no noise/confidence guard — a guardband wobble on an unchanged repo reads identically to a real move",
    "expected": "Where a score move is stated on the page Klaus lands on first (Overview), the noise floor / trend-confidence should be co-located so he can tell signal from the model breathing on an unchanged repo.",
    "got": "RepoCategoryRollup's fleet masthead ('avg move ±N', RepoCategoryRollup.tsx:242-249) and RollupRow's per-repo delta (RepoCategoryRollup.tsx:118-133) render a plain colored delta with only ONE noise defense: deltaCrossesEngine muting for mock->live engine transitions (repoTrajectory.ts:61, RepoCategoryRollup.tsx:120-127). A same-engine (claude-cli -> claude-cli) delta on an unchanged repo gets no noise-band hint at all. The R²/trend-confidence guard exists, but only on /org/[slug]/executive's separate Trajectory card and per-repo /trends — neither of which is the surface stating 'avg move' on Overview.",
    "evidence": ["src/components/org/overview/RepoCategoryRollup.tsx:118-133", "src/components/org/overview/RepoCategoryRollup.tsx:230-255", "src/components/org/overview/repoTrajectory.ts:61", "src/lib/maturity/model.ts:29-35"],
    "code_check": "present-but-missed",
    "verdict": "uncertain",
    "l2_priority": "Re-scan an unchanged firmware-style repo twice under claude-cli; measure whether the per-row / masthead delta actually moves within the ±25 guardband, and confirm nothing near it flags 'within noise'. If it moves and nothing flags it, this is confirmed major.",
    "suggested_acceptance": "Either (a) surface the same trend-confidence signal Executive already computes fleet-wide next to the Overview masthead's 'avg move', or (b) give each RollupRow a per-repo noise hint when the repo has too little history / the delta falls inside the guardband, so the first page Klaus opens carries the same honesty the Executive page already has."
  },
  {
    "id": "klaus-lens-fit-embedded-unchanged",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "klaus-embedded-firmware",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "senior-quality",
    "title": "No embedded/safety-critical archetype; L5-Autonomous is still framed as the unqualified apex for code that legitimately can't ship autonomously",
    "expected": "For ISO 26262 / DO-178C firmware, 'L1 Manual / human-in-the-loop' should be presentable as the CORRECT permanent posture; the recurring roadmap should not nag toward autonomy.",
    "got": "RepoArchetype is still 'solo' | 'team' | 'org' only (types.ts:22, ARCHETYPE_WEIGHTS model.ts:246) — no embedded/safety-critical lens. LEVELS (model.ts:41-79) still presents L5 ('agents ship with humans supervising at the policy level') as the apex, with no per-level note that a lower band can be a defensible, permanent posture. Unchanged from the prior L1 pass.",
    "evidence": ["src/lib/types.ts:22", "src/lib/maturity/model.ts:41-79", "src/lib/maturity/model.ts:246"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Scan a real embedded C/C++ repo under claude-cli — does the roadmap recommend agentic auto-merge/autonomy, and does the level read frame a low, stable maturity score as a deficiency rather than a defensible posture?"
  },
  {
    "id": "klaus-trajectory-starved-by-velocity",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "klaus-embedded-firmware",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "Trajectory needs 2+ distinct calendar days; a repo that changes a few times a quarter starves the fit — unchanged, and now the fleet-level card lives one hop further from Overview",
    "expected": "The GPS should still read for a deliberately slow repo, and be easy to find.",
    "got": "forecastTrajectory returns null below 2 distinct days (forecast.ts:87,101); a monthly cadence gives no trajectory until cycle 2. Pro's 180-day window (plans.ts:53) gives a quarterly-changing repo only ~2-3 distinct score values. Additionally, since the Overview refactor, the fleet-wide Trajectory/confidence card no longer lives on /org/[slug] at all — Klaus must navigate to /executive (fleet-wide) or /trends?repo=... (per-repo) to see it.",
    "evidence": ["src/lib/maturity/forecast.ts:87,101", "src/lib/plans.ts:53", "src/app/org/[slug]/page.tsx:1-9 (no Trajectory import)", "src/app/org/[slug]/executive/page.tsx:153-166"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Seed an org with only 2 monthly scans; confirm live whether a first-time-cycle-N visitor to /org/[slug] would know to click through to /executive to find the trend-confidence read, or would conclude the feature doesn't exist."
  }
]
```

## Character feedback (Klaus, first person)

Same question as last time I looked at this: I set up monthly autoscans on repos that change three times a quarter — am I paying for a flatline? The billing answer hasn't moved, and it's still the right answer: an unchanged-commit rescan dedups, refunds the credit, and doesn't fire a fake regression alert. I traced it through the new shared `scan-credit.ts` helper this time instead of three separate call sites, and it still holds. Cost tracks new information. That I can keep.

The price question is fixed. Last time I could see my credit burn but not the subscription line item — now `/pricing` says `$10 / month` for Pro in plain numerals, sourced from the same table the gate reads. Good — that removes one thing I had to go ask finance about.

What's changed for the worse, or at least sideways: the page I land on first now shows me a "Fleet" masthead — repos, avg, how many climbed, slipped, held, and an "avg move" number — and none of it carries a noise flag. I like the masthead itself, it's a cleaner "what changed" read than the old movers list. But the one thing I actually asked for — is a move real or is the model breathing — still isn't there, on this specific card. I dug further and found the trend-confidence percentage does exist, faithfully, with the same "· noisy" flag as before — it's just moved to the Executive page, and separately to a per-repo Trends page. So the honesty is real, it's just not where the claim is made. If I only ever open the fleet Overview — which, on a repo that changes three times a year, is exactly the kind of habit I'd form — I'll never see the noise guard at all.

The lens still doesn't understand my world, unchanged. L5 Autonomous is still the summit; there's still no archetype for safety-critical firmware; nothing tells me L1-Manual-forever is a legitimate answer. Every cycle the roadmap is going to keep nagging me toward autonomy I'm certified not to have. That one hasn't moved an inch since I last looked.

Would I renew? Yes, unchanged verdict — the dedup-and-refund economics are the load-bearing fact and they held up under a real refactor, which is itself a good sign about how seriously this team treats that invariant. But I'm still exactly one bad noise-move away from downgrading to a manual quarterly check, and now the noise guard is a click further from the page I actually open.

## Scores & verdict

- **Grounding score: 5 / 6** recurring-context sources reach Klaus's read (up from 4/6 last pass — price is now a genuine "yes"):
  - Trajectory needs real history (`forecast.ts:87,101`) — renders at cycle 2+, flat-floor honest. ✅
  - Flatness framed as verdict, not blank (`forecast.ts`, `briefing.ts:242`, `executive/page.tsx:157`). ✅
  - Cost↔value: dedup + refund on unchanged commit, re-verified against the refactored helper. ✅
  - Retention/tier gating legible (`plans.ts:53` = 180d) — though still thin for his velocity. ✅
  - Subscription price now visible in-app (`plans.ts`, `/pricing`). ✅ (newly resolved)
  - Noise guard NOT co-located with the move stated on the page he actually opens first (Overview's masthead/rows). ❌ (unchanged gap, relocated surface)
- **Per-cycle time-saved (if it all worked): ~20-30 min/month** — the time to hand-confirm "nothing regressed, still stable, still safe" across the slow fleet in one glance with evidence, vs. ~60-80 min/month amortized for his full manual maturity check. Realized value is essentially unchanged from the prior pass: the price fix removes a small friction at renewal time but doesn't add time-saved per cycle; the relocated-but-intact noise guard means the upside still goes negative any cycle the Overview masthead shows an unflagged noise-move he has to debunk by hand (now requiring a click to Executive to even check).
- **Renew / downgrade / churn / upgrade: RENEW (conditionally, downgrade-watch)** — same verdict as the prior pass, on firmer footing for one reason (price is now legible) but not meaningfully improved on the reason that actually threatens churn (the noise guard he'd rely on daily still isn't on the page he opens daily).

## l2_priority carry-forward

1. **(sharpest, carried forward)** Re-scan an unchanged firmware-style repo twice under `claude-cli`: does the per-row/masthead delta on `/org/[slug]` actually move within the guardband, and does anything near it flag "within noise"? If it moves and nothing flags it → `klaus-overview-movers-still-no-noise-guard` confirmed major.
2. Confirm the unchanged-commit path live: second `/api/org/scan` returns dedup (`x-ascent-dedup: hit`) and the credit balance is unchanged.
3. Load `/pricing` live and confirm the `$10 / month` / `$20 / month` figures actually render (not just present in the source).
4. Scan a real embedded C/C++ repo: does the roadmap push agentic autonomy onto certified code and frame low, stable maturity as a deficiency? (lens-fit, unchanged).
5. Seed an org with only 2 monthly scans; confirm whether a Klaus-like first-time-cycle-N visitor to `/org/[slug]` would discover the trend-confidence read lives on `/executive`, or would conclude it doesn't exist.
