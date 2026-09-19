# L1 — Sofia (mobile EM) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the recurring machinery (trajectory, movers, noise-floor, retention) is structurally sound and cadence-fits her bi-weekly train, but her north-star dimension (D3 CI/CD & Delivery) is **web/JVM-CI-blind to her mobile pipeline**, so the per-train delivery read she's paying for is reading the wrong pipeline. Renew is at risk; the defect is fully visible in code. **PRICING: downgrade** (renew the dashboard value, but the D3 fidelity gap means she'd not pay *up*, and would consider Pro if her credit burn is low).

## Reachable surface set (tier-honest — Team plan, synthetic owner under ASCENT_AUTH_BYPASS=1)
- **Overview** `/org/[slug]` — fleet posture, **Trajectory** (`Trajectory.tsx` ← `forecast.ts`), **movers/period** (`PeriodSummary.tsx`). Reachable.
- **Executive** `/org/[slug]/executive` + **Briefing** share. Reachable.
- **Trends** `/trends` (rear-view history). Reachable.
- **Cadence machinery** — scheduled autoscans + alerts + digest: **reachable at Team** (Pro+; Team inherits). Schedule/alerts controls render.
- **Retention: 365 days** (Team, `plans.ts:51`) — the trajectory can look back a full year of trains (~26 cuts). Ample for a multi-train slope.
- **Credits: 500/mo** (Team, `plans.ts:50`). Her fleet ≈ 1 monorepo + ~20 supporting repos = ~21 private repos. At bi-weekly cadence (~2 scans/mo) that's ~21×2 = **~42 credits/train-month** against 500 — comfortably inside allotment (a non-issue; she could re-scan far more often).
- **Unreachable / by-tier:** nothing she needs is gated above her — Team already has segments/comparisons, playbooks, 365-day retention. The gap is *fidelity*, not entitlement.

## Surface-model notes (recurring-value affordances → file:line, grounding-audit emphasis)
- **Trajectory exists only with repeated scans** — `forecast.ts:87,100` returns null below 2 distinct calendar days; her bi-weekly cadence clears that by the 2nd train. OLS slope in score-pts/day, `perWeek` rounded (`forecast.ts:128`). **Cadence-fit: good** — a bi-weekly series gives a real slope and the slope renders at train granularity.
- **Noise floor is honest** — `FLAT_PER_WEEK=0.5` (`forecast.ts:64,131`): drift under ±0.5/wk is called `flat`, ETA suppressed (`forecast.ts:147`). So a re-scan that only wobbles within noise reads "holding," not invented motion. **Real-vs-noise defense exists.**
- **R² / "trend confidence" IS surfaced on the move** — `Trajectory.tsx:96` renders `trend confidence {confidence}%` and appends `· noisy` when `<50%`. This is the one place that tells her "this move is real vs the model breathing," and it's wired to the same card that shows the move. **Strength** — directly answers the journey's hardest trust question.
- **Movers say what changed, not just the current number** — `PeriodSummary.tsx:25-36`: cohort-matched period-over-period deltas + level changes ("climbed +3 to 61 from 58", "2 repos leveled up"), onboarding reported separately (`:32,68`). **Strength** — movers are genuinely a "since last train" read.
- **Guardband / blend** — LLM clamped ±25 to the signal and blended 60/40 (`model.ts:23,16`; `engine.ts:99-102`). Re-scanning an unchanged repo under `claude-cli` can wobble the LLM term within ±25; the deterministic D3 signal is stable, so a *delivery* move on an unchanged repo would be LLM breathing — and the forecast's flat-floor + R² is the only thing that flags it. It IS surfaced (above), so the defense holds at the trajectory level (but NOT on a single dimension card — see finding).
- **D3 detector is web/JVM-CI-centric** — `analyze/index.ts:272-329`. Matches GitHub Actions/GitLab/Circle/Jenkins, `gradle test`/`gradle build` (generic JVM, not Android release), `vercel|netlify|deploy|kubectl|aws|gcloud|fly`, ArgoCD/Flux, OPA, DB migrations. **Zero** fastlane, Xcode Cloud, Bitrise/Codemagic, `.ipa`/`.apk`/`.aab`, TestFlight/App Store/Play submission, or code-signing vocabulary (grep over `src/` confirms: no matches). The prompt (`scoring/prompt.ts`) inherits the same rubric text (`model.ts:96` D3 criteria) — also mobile-blind. **This is the core defect for her facet.**

## Findings
```json
[
  {
    "id": "sofia-d3-mobile-blind",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sofia-mobile-em",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "senior-quality",
    "title": "D3 CI/CD & Delivery is blind to mobile delivery — reads release trains as a generic JVM build",
    "expected": "The dimension she owns as her north star reads HER pipeline: fastlane lanes, Xcode Cloud/Gradle release matrices, code-signing, TestFlight/Play store submission, release-train automation.",
    "got": "D3's detector matches only web/JVM-CI proxies (GitHub Actions, gradle test/build, vercel|netlify|kubectl|aws|gcloud, ArgoCD/Flux, OPA, DB migrations). No fastlane / Xcode Cloud / Bitrise / .ipa|.apk|.aab / TestFlight / App Store / Play / code-signing vocabulary anywhere in the scoring path. The rubric text the LLM gets is the same web-centric list.",
    "evidence": [
      "src/lib/analyze/index.ts:272-329",
      "src/lib/scoring/prompt.ts:96-116",
      "src/lib/maturity/model.ts:96"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Scan a real mobile repo with a fastlane Fastfile + .github/workflows that signs and submits to TestFlight. Does D3's evidence list cite the release pipeline, or does it only credit `gradle build` and miss signing/store submission entirely? Does the claude-cli LLM auditor flag the detector miss in `discrepancies`, or inherit the web-centric blindness?",
    "suggested_acceptance": "D3 detector recognizes mobile delivery signals (fastlane/Fastfile, Xcode Cloud, .ipa/.apk/.aab artifacts, TestFlight/Play store submission, signing/match) and the D3 rubric criteria names them, so a release-train pipeline scores as real delivery automation."
  },
  {
    "id": "sofia-noise-not-on-dim-card",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sofia-mobile-em",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Real-vs-noise is surfaced on the org trajectory but NOT on a single dimension move",
    "expected": "When she looks at D3 specifically and sees it move +/-3 since last train, something tells her whether that move cleared the guardband/noise — at the place the dimension move is shown.",
    "got": "R²/'noisy' tag lives only on the org-level Trajectory card (Trajectory.tsx:96). A per-dimension or per-repo D3 delta in the movers/diff carries the number but no noise annotation, so a guardband-sized LLM wobble on an unchanged repo's D3 reads as real movement at the dimension level.",
    "evidence": [
      "src/components/org/Trajectory.tsx:96",
      "src/lib/scoring/engine.ts:99-102",
      "src/lib/maturity/forecast.ts:64"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Re-scan an unchanged mobile repo twice under claude-cli. Does the D3 dimension score move within ±25, and is that move flagged anywhere as noise, or does it read as a real per-train delivery change?"
  },
  {
    "id": "sofia-trajectory-cadence-fit-strength",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sofia-mobile-em",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — bi-weekly cadence yields a real trajectory with honest flat-floor + surfaced R²",
    "expected": "A trajectory that lines up with the release train and doesn't invent motion when nothing moved.",
    "got": "OLS over the score series renders a per-week slope at train granularity; FLAT_PER_WEEK=0.5 honestly calls a no-change train 'holding'; R²/'noisy' confidence is shown on the move. Exactly the cadence-fit + real-vs-noise defense her recurring read needs (at the org level).",
    "evidence": [
      "src/lib/maturity/forecast.ts:64",
      "src/lib/maturity/forecast.ts:128",
      "src/components/org/Trajectory.tsx:96"
    ],
    "code_check": "by-design",
    "verdict": "confirmed"
  },
  {
    "id": "sofia-movers-since-last-train-strength",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sofia-mobile-em",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "completion",
    "title": "STRENGTH — movers report cohort-matched 'since last period', not a restated current number",
    "expected": "The per-train banner tells her what changed since the last cut, not the current fleet average dressed up.",
    "got": "PeriodSummary uses cohort-matched period-over-period deltas + level changes, with onboarding reported separately so growth doesn't masquerade as improvement. A real 'this train vs last' read.",
    "evidence": [
      "src/components/org/PeriodSummary.tsx:25-36",
      "src/lib/db/org-rollup.ts"
    ],
    "code_check": "by-design",
    "verdict": "confirmed"
  },
  {
    "id": "sofia-team-price-invisible",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sofia-mobile-em",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "No subscription $ for Team — she can see credits/retention but not what she's renewing for",
    "expected": "At a quarterly spend review she can point her VP at the actual Team subscription price.",
    "got": "Team shows only 'Prepaid — credits, 1 per private scan'; the real price lives in Polar, not the app. She can reason about credit burn (~42/500) and retention (365d) but not state the $ she's defending. Lower impact for her than for a cold prospect — she's already paying — but it dents the renewal conversation.",
    "evidence": [
      "src/app/pricing/page.tsx",
      "src/lib/plans.ts:45-54"
    ],
    "code_check": "by-design",
    "verdict": "confirmed"
  }
]
```

## Character feedback (first person, in Sofia's voice)
Would I renew? The dashboard part, yes — the trajectory actually lines up with my train. Two cuts in and I get a real slope, and when nothing moved it says "holding" instead of inventing a wiggle, and there's a confidence number with a "noisy" tag right on the move so I can tell the repo changed from the model just breathing. That's the thing every other tool got wrong, and Ascent got it right. The movers banner tells me what changed since *last* train, not just today's average with a bow on it. Good.

But here's my problem, and it's the whole reason I bought this: **D3, CI/CD & Delivery, is the dimension I live in — and it can't see my pipeline.** I went looking for fastlane, Xcode Cloud, signing, TestFlight, store submission, anything that says "this tool understands a release train." It's not there. It's matching `gradle build` and `deploy` and `kubectl` and calling that my delivery maturity. That's a web backend's pipeline. A train *is* my deploy — merges to main aren't. So every cycle, the one number I most want to trust is built on signals that don't describe how I ship. The trajectory on top of it is honest math over a dishonest input.

Is each cycle telling me something new? At the fleet level, yes. At the D3 level — the level I care about — it's telling me something *wrong* consistently, which is worse than telling me nothing. Do I trust a move is real? On the org trajectory, yes, because of the R² tag. On a single D3 delta, no — there's no noise flag on the dimension move, so a guardband wobble on an unchanged repo would read to me as a delivery regression I'd waste a pre-cut hour chasing.

Does the cost pencil? My ~21 repos at bi-weekly is ~42 credits against 500 — I'm nowhere near the cap, retention's a full year, so the *credits* are fine. Can I see the price? No — Team shows "prepaid credits," and when my VP asks "what are we paying," I can't point at a number in the product. Annoying, not fatal; I'm already on the hook.

What's missing for MY recurring job: a D3 that reads fastlane/Xcode Cloud/store submission/signing so the delivery number is *mine*, and a noise flag on the dimension move so a per-train D3 change is trustworthy at a glance. Would I tell a peer? A web-backend EM, yes. A mobile peer — I'd warn them: "great trajectory engine, but it'll grade your release train like a Next.js app." That's a downgrade-not-churn for me: keep it for the fleet trend, don't pay up until D3 can see how I ship.

## Grounding score · time-saved · pricing verdict
- **Grounding (recurring-context sources that reach the read): 4 / 5.**
  1. Trajectory needs real history → **reaches** (forecast.ts, ≥2 days, cadence-fit). ✔
  2. Real-vs-noise on the move → **reaches at org level** (R²/noisy on Trajectory.tsx), **partial** (absent on the dimension card). ◐ → counted as reached for the org read.
  3. Movers/period deltas with provenance → **reaches** (cohort-matched PeriodSummary). ✔
  4. Retention/credits gating sized for her trend → **reaches** (365d + 500cr, Team). ✔
  5. **D3 reads HER delivery pipeline → does NOT reach** (mobile-CI-blind detector + rubric). ✘
  The recurring machinery is well-fed; the *content* of her north-star dimension is the thin context — "good machinery fed thin context," exactly the predicted defect, localized to D3.
- **Per-cycle time-saved (if it all worked): ~160 minutes/train (~2h40m)** — replaces ~3h of manual release-readiness review with a ~20-min re-pull. **Realized today: ~0 on the D3 portion**, because she'd have to rebuild the delivery read by hand; the fleet-trend portion (~45-60 min) does land.
- **Verdict: DOWNGRADE (renew the dashboard, don't pay up).** One-line reason: the trajectory/movers earn their keep, but the delivery dimension she's actually paying for can't see her release train, so she holds at Team for the fleet trend and won't expand until D3 is mobile-aware.

## l2_priority (carry-forward)
1. **Top:** Scan a real mobile repo (fastlane Fastfile + signing + TestFlight/Play submission in CI) under `LLM_PROVIDER=claude-cli`. Does D3's evidence cite the release pipeline, or only `gradle build`? Does the claude-cli auditor flag the detector's mobile blindness in `discrepancies`, or inherit it?
2. Re-scan an unchanged mobile repo twice under claude-cli — does the D3 dimension score move within ±25, and is that move flagged as noise anywhere a per-train reader would see it?
3. Confirm a bi-weekly (2-distinct-day) series renders a non-null trajectory with a legible R² and an honest flat-floor on a "nothing-changed" train.
