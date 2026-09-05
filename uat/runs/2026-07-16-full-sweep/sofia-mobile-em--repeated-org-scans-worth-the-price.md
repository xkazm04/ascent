# L1 (theoretical) — Sofia (mobile EM) × "Repeated org scans worth the price"

cert_level: L1 · date: 2026-07-16 · surface reachability: all of Sofia's bound surfaces resolve under
`ASCENT_AUTH_BYPASS=1` (`src/lib/access.ts`), so no gating blocks this walkthrough.

---

## 1. Surface model (import-chain-traced, file:line cited)

### 1.1 D3 — CI/CD & Delivery detector (the load-bearing signal for Sofia's whole journey)
- Deterministic detector: `src/lib/analyze/index.ts:328-409` (`d3`). Reads: `.github/workflows`
  (`:330`), other web-CI systems — GitLab/CircleCI/Azure/Jenkins/Travis/Bitbucket (`:331-333`),
  off-GitHub CI (Gerrit/bors/Buildkite/generic) (`:339-343`), test/lint/build keyword regexes
  tuned to `npm|pytest|go test|cargo test|gradle test|jest|vitest` etc. (`:361-372`), release
  tooling (`:374-380`), **`vercel|netlify|deploy|kubectl|aws|gcloud|fly deploy`** as "Automated
  deploy step" (`:381-382`), IaC (`:383-384`), and delivery-as-code (OPA, ArgoCD/Flux, feature
  flags, DB migrations) (`:391-407`).
  - **Zero terms for fastlane, Xcode Cloud, code signing, TestFlight/Play internal tracks, App
    Store Connect submission, or "release train."** Grepped the whole file (`Grep fastlane|xcode|
    gradle|signing` over `src`) — the only "gradle" hits are the generic `gradle test`/`gradle
    build` keyword matches in the test/build sub-signals, which credit *that a build tool ran*,
    not that a release actually shipped to a store.
- LLM prompt: `src/lib/scoring/prompt.ts:201-202` — "PROCESS SIGNALS ... behind D3/D6/D7/D8" only
  passes PR/governance data, no mobile-delivery-specific evidence block.
- **Stack-fit caveat exists and is honest, but is scoped away from Sofia's actual surfaces.**
  `src/lib/analyze/stack-fit.ts:23` defines `CAVEAT.mobile`: *"CI/CD & Delivery (D3) reads
  web/service pipelines, so a mobile release train (fastlane / Xcode Cloud / app-store submission,
  code signing) may not be fully credited."* Detected via language (`swift/objective-c/dart`,
  `:29`) or manifest evidence (`.xcodeproj`, `Podfile`, `AndroidManifest.xml`, `fastlane/`,
  `:61-72`). This is fed to the LLM prompt (`src/lib/scoring/prompt.ts:197`, "STACK-FIT CAVEAT ...
  calibrate the affected dimensions accordingly") and pushed into `report.warnings`
  (`src/lib/scan.ts:541`, `src/lib/scan.ts:869-874`).
  - **Where it IS shown:** the per-repo report page, `src/components/report/ReportView.tsx:179`
    (`<ReportWarnings warnings={report.warnings} />`).
  - **Where it is NOT shown** (Sofia's actual bound surfaces): `RepoDimensionModal`
    (`src/components/org/shared/RepoDimensionModal.tsx` — full file grepped for
    `stackFit|warnings|caveat`, zero matches; the D3 cell drill-in renders only
    `DimensionDetail` + "Next steps," `:120-153`), `RepoCategoryRollup`
    (`src/components/org/overview/RepoCategoryRollup.tsx`), the `/org/[slug]` Overview page
    (`src/app/org/[slug]/page.tsx`), and the `/org/[slug]/executive` briefing
    (`src/app/org/[slug]/executive/page.tsx` — no `stackFit`/`warnings` import at all).

### 1.2 Trajectory / cadence-fit
- OLS forecast engine: `src/lib/maturity/forecast.ts` — `forecastTrajectory()` (`:119-182`) fits
  a line over per-day-collapsed scores, reports `fitQuality` (R², `:153`), `lowData` flag for < 3
  distinct days (`:58-63, 178`), `trajectory: rising|falling|flat` with a `FLAT_PER_WEEK = 0.5`
  floor (`:72, 160-161`), and an ETA to the next level band (`:189-231`).
- Rendered with the honest low-data/noisy caveat in `Trajectory.tsx`
  (`src/components/org/overview/Trajectory.tsx:86-104`): `lowData` → "trend confidence — low data
  (n=…)"; else `confidence%` + `" · noisy"` when `<50%`.
- **This full card is mounted on `/trends` (single-repo)** (`src/app/trends/page.tsx:104-158`),
  not on `/org/[slug]` Overview. On `/org/[slug]/executive`, the org-wide forecast is
  text-only via `forecastHeadline` + `forecastConfidenceNote`
  (`src/app/org/[slug]/executive/page.tsx:153-169`, `src/lib/org/briefing.ts:36, 329` — the note
  string embeds "noisy" the same way). So the R²/noise readout for the ORG-WIDE number Sofia
  actually cares about ("is D3 trending down two trains running") does reach her, just as a line
  of text on `/executive`, not the full Trajectory card.
- Per-repo movers on Overview: `buildTrajectories()` in
  `src/components/org/overview/repoTrajectory.ts:52-86` computes `deltaWindow`/`deltaLast` per
  repo and flags `deltaCrossesEngine` (mock→live transition) so that delta is muted
  (`RepoCategoryRollup.tsx:118-133`). The delta color/arrow itself routes through
  `src/components/ui/format.ts` which calls `isWithinNoise()` (`src/lib/maturity/noise.ts:19-21`,
  `SCORE_NOISE_BAND = 2`) — so a repo-level ±1–2 move is muted to slate/"≈" the same way a
  guardband wobble should be. This is a real, load-bearing "real-vs-noise" primitive, shared
  across the digest (`src/lib/alerts.ts:63,268`) and the cron digest route
  (`src/app/api/cron/digest/route.ts:152-157`).

### 1.3 Cadence / schedule controls
- `POST /api/org/schedule` (`src/app/api/org/schedule/route.ts:1-57`): cadence is
  `off|daily|weekly|monthly` (`SCHEDULES` from `src/components/connect/installationRepoTypes`,
  `:14`). **No biweekly option** — Sofia's actual ~2-week train cadence sits between `weekly` and
  `monthly`. She'd set `weekly` and get more scans than her train needs, or manually re-scan
  before each cut.
- The weekly digest (`src/lib/alerts.ts:238-273`, cron `src/app/api/cron/digest/route.ts`) is
  fixed-cadence, not train-aligned; it uses `isWithinNoise` to gate movement (`:152-157`) so it
  won't cry wolf on a guardband wobble.

### 1.4 Price-legibility (Team tier)
- `src/lib/plans.ts:57-67` — Team: `includedCredits: 500`, `retentionDays: 365`,
  `monthlyPrice` (used by `planPriceLabel`, `:86-92`).
- `/pricing`: `src/app/pricing/page.tsx:39-41,81,86,118` — `TEAM_PRICE` is derived live from
  `planPriceLabel("team").amount` (not a hand-typed string, so it can't drift from the entitlement
  gate's source), rendered as `$X/mo` + `"500 scans / mo included"`.
- `/usage`: `AllotmentPanel` (`src/app/usage/AllotmentPanel.tsx:29-37,45-85`) — normalizes burn to
  a monthly rate, shows `"≈ N credits / mo at this pace · P% of your 500 / mo allotment"`, a
  90%-threshold meter, and an explicit "unused credits roll over, never expire" line (`:79-82`).
  Retention (365d) is not re-stated on `/usage` itself but is on `/pricing`'s Team feature list
  (`src/lib/plans.ts:67`, `"1-year history"`).

---

## 2. Reachability check

Sofia's bound surfaces (`/org/[slug]`, `/org/[slug]/executive`, `/trends`, `/usage`, `/pricing`,
schedule controls) are all authed-product routes gated by `src/lib/access.ts`'s bypass. Under
`ASCENT_AUTH_BYPASS=1` every gate passes as a synthetic owner viewer (`uat/env.md`), so **all of
Sofia's bound surfaces are reachable with no additional entitlement work** — this is not an
Enterprise-gated feature set. Team-tier price/credit rendering (`/pricing`, `/usage`) is
plan-derived, not auth-gated, so it's reachable regardless of which org "plan" field is seeded, as
long as the seeded org's `plan` is `"team"` (a seed-data concern for L2, not a structural gate).

No affordance in this journey sits outside her reachable set — the reachability check is clean.

---

## 3. In-character walkthrough (cognitive walkthrough + scored criteria)

I open `/org/mobile-fleet` the way I do every train — Tuesday before cut, coffee in hand, same
ritual as the last dozen times. First thing I check, before I even read the fleet number: can this
thing see my pipeline, or is it about to tell me my delivery score is L2 because it doesn't know
what fastlane is.

**Mobile-CI fidelity — this is where it loses me.** I click into a repo's D3 cell on the heatmap.
The drill-in shows me a score, an evaluation, "next steps" — generic CI hygiene stuff (lint, build,
release automation). Nowhere does it say "by the way, I can't see your fastlane lanes or your
signing pipeline, so treat this as a floor." I go read the code myself (well — I read the
detector): `d3()` in `analyze/index.ts` matches `.github/workflows`, GitLab/CircleCI/Jenkins,
generic `deploy`/`kubectl`/`vercel` keywords, DB migrations, feature flags. Not one string for
fastlane, Xcode Cloud, code signing, or store submission. This is *exactly* the "built for someone
else's pipeline" tool I've been burned by before — except this one at least admits it, quietly, in
a caveat string (`stack-fit.ts`) that never makes it to the surface I'm actually looking at. The
caveat reaches the LLM prompt (so the blended score gets *some* mercy) and it reaches the per-repo
report page — but not the org heatmap, not the dimension drill-in modal, not the executive
briefing. I would have to already distrust the number, go find the single-repo `/report` page, and
read the fine print to learn the tool knows its own blind spot. That's backwards — the honesty
should be load-bearing exactly where I'm making the go/no-go call, not buried one click away from
where I'd ever go looking.

**Cadence-fit — this one's solid.** The trajectory math (`forecastTrajectory`) is a real OLS fit
with R², a flat-floor that doesn't invent motion, and an honest `lowData` caveat instead of a fake
100%-confidence 2-point line. That's more rigor than most of the "AI velocity" dashboards I've been
pitched. My one gripe: the full Trajectory card with the R²/noisy readout lives on `/trends`
(single-repo) — my fleet-level trajectory on `/executive` is a text headline plus a confidence
note, not the same visual card. Functionally fine, but it means the org-wide read I actually care
about is the thinner rendering of the two.

**Real-vs-noise — also solid, and I didn't expect it.** Per-repo deltas on the Overview are muted
to "≈" when they're inside the ±2-point noise band, and a mock→live transition delta is visibly
flagged as not-a-real-move rather than dressed up in a confident arrow. That's the "is that the
repo or the model breathing" instinct I bring to every read, built into the product instead of left
for me to reverse-engineer.

**Price-legibility — clean.** `/pricing` shows an actual `$/mo` for Team, sourced from the same
`plans.ts` the entitlement gate reads (so it can't be a stale marketing number), and `/usage` turns
"credits burned" into "X% of your 500/mo, here's the pace, here's your top-up line" — with an
explicit "credits roll over" note that answers the question I'd otherwise have to ask support. I
can build my renew/downgrade case from this without touching a spreadsheet.

**Cadence controls — a minor annoyance, not a blocker.** Autoscan is `off|daily|weekly|monthly`;
there's no `biweekly` that actually matches my train. I'd pick `weekly` and either get an extra
scan I don't need every other week, or manually trigger the pre-cut scan myself. Livable, but it's
a small tax on "let this run itself so I don't have to remember."

**Time-saved, if the design promises hold:** the fleet read (Overview + executive + trends) would
genuinely replace the fastlane-run-history-pulling and flaky-test-dashboard part of my 3-hour
review — call it ~20 minutes to re-pull and read, matching my own stated bar, so ~160 min saved
*if* I trusted the D3 number. But I don't, yet — not until the tool tells me, right there on the
surface I'm reading, that it can't see my release train. Until then I'd still redo the D3 slice of
my review by hand (pull the fastlane dashboard myself), which eats most of the promised savings —
maybe 60–90 min saved instead of 160, because the CI/CD third of my review is the one I can't
outsource to this yet.

**Senior-quality bar:** a staff mobile lead reading `d3()`'s source would not accept "your delivery
posture is L2" from a detector with zero release-train vocabulary, even with the caveat existing
somewhere in the data model — a caveat that never renders where the score is presented fails the
bar exactly as hard as no caveat at all, because I never see it without going and reading source
code myself, which is not a thing a director-level user should have to do to trust a number.

---

## 4. Findings

```json
[
  {
    "id": "F1",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sofia-mobile-em",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "D3 (CI/CD & Delivery) detector has zero mobile-release-train vocabulary — no fastlane/Xcode Cloud/code-signing/store-submission signal",
    "expected": "A CI/CD & Delivery score for a mobile monorepo reflects release-train delivery (fastlane, Xcode Cloud/Gradle lanes, signing, store submission), per the DORA-for-mobile bar Sofia holds every tool to.",
    "got": "src/lib/analyze/index.ts:328-409 (`d3`) matches only web/service CI systems, generic build/test/lint keywords, and web-deploy tools (vercel/netlify/kubectl/gcloud); grep of the whole detector for fastlane|xcode|gradle|signing turns up nothing beyond generic `gradle test`/`gradle build` keyword hits.",
    "evidence": ["src/lib/analyze/index.ts:328-409", "src/lib/scoring/prompt.ts:201-202"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Live-scan a real Swift/Kotlin monorepo with a fastlane pipeline and confirm the D3 score/evaluation text still reads it as a generic/absent CI pipeline rather than crediting the release train."
  },
  {
    "id": "F2",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sofia-mobile-em",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The mobile stack-fit caveat exists but is invisible on every fleet-level surface Sofia actually uses",
    "expected": "The honest 'D3 reads web/service pipelines, may not fully credit a mobile release train' caveat (src/lib/analyze/stack-fit.ts:23) should be visible wherever Sofia reads the D3 score — the org heatmap drill-in, the executive briefing, the Overview rollup.",
    "got": "The caveat is computed, fed to the LLM prompt (src/lib/scoring/prompt.ts:197), and rendered on the single-repo /report page (src/components/report/ReportView.tsx:179 via ReportWarnings) — but RepoDimensionModal (the org heatmap's D3 drill-in), RepoCategoryRollup, the /org/[slug] Overview page, and the /org/[slug]/executive briefing never read `stackFit`/`warnings` at all (grepped each file, zero matches).",
    "evidence": [
      "src/lib/analyze/stack-fit.ts:21-25",
      "src/components/org/shared/RepoDimensionModal.tsx (full file, no stackFit/warnings reference)",
      "src/app/org/[slug]/executive/page.tsx (no stackFit/warnings import)",
      "src/components/report/ReportView.tsx:179"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm live that clicking a mobile repo's D3 cell in the heatmap, and opening /org/[slug]/executive for a mobile-heavy org, both omit the caveat a mobile EM would need to trust the number."
  },
  {
    "id": "F3",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sofia-mobile-em",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "effort",
    "title": "No biweekly autoscan cadence to match a release-train rhythm",
    "expected": "Sofia's release train is ~every 2 weeks; a cadence option that lines up would let the recurring scan run itself.",
    "got": "src/app/api/org/schedule/route.ts:14,31 validates only off|daily|weekly|monthly (SCHEDULES). She'd pick weekly (extra scans every other cycle) or manually trigger before cut.",
    "evidence": ["src/app/api/org/schedule/route.ts:1-57"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Not blocking — confirm weekly autoscan + a manual pre-cut re-scan is an acceptable workaround in practice."
  },
  {
    "id": "S1-strength",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sofia-mobile-em",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH: real-vs-noise is a genuine, shared primitive, not per-surface guesswork",
    "expected": "n/a (positive finding)",
    "got": "SCORE_NOISE_BAND (src/lib/maturity/noise.ts:16, ±2) plus forecastTrajectory's R²/lowData caveat (src/lib/maturity/forecast.ts:153,178) are threaded through the delta formatter (src/components/ui/format.ts), the Overview rollup deltas (RepoCategoryRollup.tsx:118-133), the digest gate (src/lib/alerts.ts:63,268), and the Trajectory card (Trajectory.tsx:86-104) — a repo-level ±1-2 move reads visibly muted everywhere, and a mock→live transition delta is explicitly flagged as not-real-movement.",
    "evidence": ["src/lib/maturity/noise.ts:16-21", "src/lib/maturity/forecast.ts:58-63,153,178", "src/components/org/overview/Trajectory.tsx:86-104"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "Noise is scored per delta/trend, not per detector — it doesn't compensate for a detector (D3) that is structurally blind to a whole class of evidence (mobile delivery); that's a separate gap (F1/F2)."
  },
  {
    "id": "S2-strength",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sofia-mobile-em",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH: price-legibility at Team is genuinely wired end to end",
    "expected": "n/a (positive finding)",
    "got": "/pricing's Team $/mo is derived live from planPriceLabel(\"team\") (src/app/pricing/page.tsx:41) reading the same plans.ts the entitlement gate uses, so copy can't drift from what's charged; /usage's AllotmentPanel turns burn into \"X% of your 500/mo\" with a top-up line and an explicit credit-rollover note (src/app/usage/AllotmentPanel.tsx:58-82).",
    "evidence": ["src/app/pricing/page.tsx:39-41,81,86", "src/app/usage/AllotmentPanel.tsx:29-85", "src/lib/plans.ts:57-67"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "Retention (365d) is stated on /pricing's feature list, not re-surfaced on /usage itself — a minor completeness gap, not scored as a finding here."
  }
]
```

---

## 5. Character voice — would I adopt it?

Okay, here's where I land. The bones are good — genuinely better than most of what's been pitched
to me. Someone here understands that a +1 isn't a trend and a 2-point wobble isn't a regression;
that's rarer than it should be. The pricing and usage math is honest and I could take it straight
into my VP Eng renewal conversation without redoing it in a spreadsheet.

But the CI/CD number — the one thing I open this dashboard *for* every train — is reading my
Gradle file and my `.github/workflows` folder and calling that my delivery pipeline. It isn't. My
delivery pipeline is fastlane lanes, code-signing certs that expire on their own schedule, and a
store review queue I don't control. Someone on this team clearly *knows* that — there's a caveat
sitting in the code that says almost word-for-word what I'd say to a vendor pitching me a generic
DORA dashboard. That's the frustrating part: the honesty exists, and I never see it. I'd have to go
read source code to find out the tool already knows it's reading the wrong pipeline. A senior mobile
lead doesn't get credit for a caveat buried where the user never looks.

So: not yet a renew-with-confidence, not a churn either. I'd keep the seat through this train — the
trajectory math and the noise handling are worth something even without D3 fixed — but I'd flag to
my VP that the delivery score specifically isn't credible for us, and I'd watch for whether that
caveat makes it onto the heatmap and the executive briefing before the next budget conversation.
"Okay, that'd save me the Tuesday-before-cut scramble" — but only once D3 (or at minimum, D3's own
caveat) actually knows what a release train is.
