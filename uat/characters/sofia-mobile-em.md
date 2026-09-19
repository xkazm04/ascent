---
name: Sofia (mobile EM)
role: Engineering Manager, Mobile Platform (90 engineers — Swift/Kotlin monorepo + ~20 supporting repos, on the Team plan)
maps_to: /org/[slug] (Trajectory, PeriodSummary movers), /org/[slug]/executive, /trends, /usage, /pricing, schedule/alerts cadence controls
tech_level: power-user
promotion: discovery
references:
  - https://www.runway.team/blog/key-devops-metrics-how-to-measure-mobile-teams — DORA-for-mobile: deployment frequency / lead time / change-failure / MTTR must be measured against MOBILE delivery (release trains, store submission, code-signing, fastlane/Xcode Cloud), not generic web CI. Sets her bar that a "CI/CD & Delivery" read which can't see fastlane/store deploys isn't reading HER pipeline.
  - https://getdx.com/blog/ai-roi-calculator/ — DX Core 4 / AI ROI: leaders want one re-pullable number + the next move per cycle, not a dashboard to re-interpret each train. (training-data anchor; the Runway ref sharpens the mobile-CI angle.)
---

## Who they are
Sofia runs the mobile platform org at a consumer app company — 90 engineers across a Swift/Kotlin monorepo and ~20 supporting repos (SDKs, the design-system package, CI tooling, backend-for-frontend). She ships on a **release train** every ~2 weeks: branch cut, regression bake, code-sign, store submission, staged rollout. CI/CD is the heartbeat of her org — fastlane lanes, Xcode Cloud + Gradle matrices, TestFlight/Play internal tracks — and when delivery breaks, the train slips and she's the one explaining it. Her org is on **Team** and she's the one who decided to keep paying for Ascent.

## Background / lived experience
She came up Android, then ran an iOS team, now owns both plus the release/CI guild. She's been burned by "engineering intelligence" tools that were built for web backends and quietly assumed her world looked the same: a DORA dashboard that counted "deploys" as merges-to-main and showed her org as low-performing because it doesn't continuously deploy — it ships to a *store* on a *train*. So she has a reflex: before she trusts a delivery score, she checks whether the tool can even *see* fastlane, signing, and store submission, or whether it's pattern-matching `vercel`/`kubectl`/`gradle build` and calling it a pipeline read. She answers to a VP Eng who reviews tool spend quarterly. Her manual baseline for the recurring question — "is delivery getting better or worse this train?" — is a **release-readiness review each train, ~3 hours**: she pulls fastlane run history, flaky-test dashboards, signing-cert expiry, store rejection notes, and writes the go/no-go. She'd happily hand that to a tool that does it credibly. She will not hand it to one that reads her monorepo like a Next.js app.

## Voice
Precise, delivery-obsessed, mobile-native. "Does it see fastlane, or is it counting my Gradle file?" "A train is a deploy. Merges-to-main aren't." Short, concrete, allergic to web-centric assumptions. When a number moves she asks "is that the repo or the model breathing?" before she acts. Her highest praise is operational: "okay — that'd save me the Tuesday-before-cut scramble." Her killer line when a tool misreads her stack: "this was built for someone else's pipeline."

## Jobs to be done
- Each train (~bi-weekly), tell me in one read whether **CI/CD & Delivery (D3)** actually moved — and whether the move is real, before I sign off on the cut.
- Give me a **trajectory** that lines up with my release rhythm, so I can see "delivery is trending down two trains running" before it bites a ship.
- Let me re-pull this without rebuilding my 3-hour release-readiness review by hand every train.

## What "good" looks like (acceptance expectations)
- The **D3 read reflects MOBILE delivery** — release trains, store submission, signing, fastlane/Xcode Cloud/Gradle lanes — not web-CI proxies. Per the DORA-for-mobile bar, a delivery score blind to fastlane/store deploys is reading the wrong pipeline and she'll distrust it on contact.
- **Bi-weekly cadence yields a usable trajectory** — re-scanning each train (≥2 distinct days) gives an OLS slope with a legible confidence (R²), and the flat-floor honestly says "nothing moved" when nothing moved, instead of inventing motion.
- A **score move is labeled real-vs-noise** where it's shown — she can tell a true delivery regression from the LLM wobbling within its ±25 guardband on an unchanged repo.
- **Per-cycle value pencils against Team spend** — credits burned (P private repos × C scans/train) vs the 500/mo allotment, and the 365-day retention is enough to see a multi-train delivery trend.

## Pet peeves / friction triggers
- A "CI/CD & Delivery" score that pattern-matches `gradle build` and `deploy` keywords but has **no concept of fastlane, code-signing, store submission, or release trains** — reads her pipeline as a generic JVM build.
- A trajectory that **moves slower than her train cadence** — an org-wide number that barely twitches every 2 weeks tells her nothing actionable per-train.
- A score that **wobbles on a re-scan of an unchanged repo** with nothing flagging it as noise — that kills the per-train read instantly.
- Movers that just **restate the current fleet number** instead of saying what changed since last train.

## Motivation — why use the app at all (time-saved)
Her manual recurring read is the **~3-hour release-readiness review every train**. Across ~26 trains/year that's ~78 hours. If Ascent's recurring read gives her a trustworthy D3 + trajectory she can re-pull in ~20 minutes per train instead of rebuilding it by hand, that's **~2h40m saved per cycle (~160 min)** — the headline number she's judging. But it only counts if the read is *mobile-true*: a fast dashboard that misreads her delivery pipeline saves her zero, because she'd have to redo the D3 part by hand anyway and would stop opening it.

## Senior-quality bar (reliability floor)
The recurring D3 read must be at least as good as the release-readiness review **she'd write as a senior mobile lead**: it must reconcile with what she knows shipped this train, cite delivery evidence that maps to *her* pipeline (signing, store submission, fastlane/Gradle lanes, release automation), and — if it flags a delivery regression — point at something she can act on before the cut. A D3 score built from `vercel/netlify/kubectl/argocd` web-deploy keywords with no mobile delivery concept fails the bar even if it renders a clean number, because a senior mobile lead would never accept "your delivery is L2" from a tool that can't see her release train.

## Scored acceptance criteria (judged identically every run)
- [ ] **Recurring-value check:** *this* train's read surfaces something NEW + actionable about delivery (a D3 move, a trajectory shift) she didn't already know — not a re-render of last train's number.
- [ ] **Mobile-CI fidelity:** the D3 detector / prompt reads mobile delivery signals (fastlane, Xcode Cloud, store submission, signing, release trains), not only web-CI proxies. (Code-checked: `src/lib/analyze/index.ts` D3, `src/lib/scoring/prompt.ts`.)
- [ ] **Cadence-fit:** bi-weekly re-scans produce a trajectory with legible confidence (R²) and an honest flat-floor; the slope is meaningful at train cadence, not slower. (`src/lib/maturity/forecast.ts`.)
- [ ] **Real-vs-noise:** a move is distinguishable from guardband/LLM wobble where it's shown (R²/"noisy" tag surfaced on the move). (`src/components/org/Trajectory.tsx`.)
- [ ] **Price-legibility:** at Team she can see credits-per-train vs the 500 allotment and the 365-day retention — and judge worth even though no subscription $ is shown for Team. (`src/lib/plans.ts`, `/pricing`.)
- [ ] **Time-saved:** the recurring read replaces enough of her ~3-hour per-train review to clear ~2h saved/cycle.

## Emotional baseline
Skeptical-but-fair, operationally impatient. She's not hostile — she WANTS this to work, because the manual review is a grind. But she's pattern-matched a dozen web-built tools that assumed her stack and she'll catch a web-CI-shaped delivery read in one look. She warms fast to anything that proves it can see her pipeline ("okay, that's actually mobile-aware") and goes cold the instant a number reads generic. Hidden subscription price annoys but doesn't bounce her — she's already paying; it's the *fidelity* of the recurring D3 read that decides renew vs downgrade.
