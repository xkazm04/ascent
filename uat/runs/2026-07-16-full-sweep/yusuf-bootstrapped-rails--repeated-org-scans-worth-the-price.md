# L1 (theoretical) — Yusuf (bootstrapped Rails eng lead) × "Repeated org scans: worth the price?"

cert_level: L1 · verdict: **L1-conditional** (structurally sound / completable, but with major findings)

---

## 1. Surface model (import-chain traced, file:line cited)

### Entry: `/org/[slug]` overview
- Route: `src/app/org/[slug]/page.tsx:37-134`. Reads `getOrgHeaderSummary`, `getOrgRollup`, `getOrgRepoHistories` (`page.tsx:7,50,65-68`), builds `buildTrajectories(rollup.repos, histories)` (`page.tsx:84-87`, defined `src/components/org/overview/repoTrajectory.ts:52-86`).
- Renders **`RepoCategoryRollup`** (`src/components/org/overview/RepoCategoryRollup.tsx`) — the "Fleet" card. Groups repos by Type/Stack/Level (`buildGroups`, lines 53-76), shows a masthead of repo count / avg / ▲▼→ counts / avg move (lines 230-255), and a per-row delta chip (`RollupRow`, lines 85-138) that renders `fmtDelta`/`deltaHex` (`src/components/ui/format.ts:11,41`).
  - `fmtDelta`/`deltaHex`/`toneFor` (`format.ts:33-43`) call `isWithinNoise` (`src/lib/maturity/noise.ts:19-21`, `SCORE_NOISE_BAND = 2`) — a |Δ| ≤ 2 renders muted slate with a "≈" glyph instead of a confident ▲/▼. **This is real, code-verified noise-awareness at the row level.**
  - Card title is hardcoded **"Fleet"** (`RepoCategoryRollup.tsx:208`, `SectionHeader title="Fleet"`), regardless of `trajectories.length`.
- Renders **`RepoDimensionHeatmap`** (`src/components/org/overview/RepoDimensionHeatmap.tsx`) when `heatmapRows.length > 0` (`page.tsx:131`).
- **No org-level `Trajectory`/forecast card on Overview** — the old page-level Trajectory card was removed in the redesign (confirmed: `Trajectory` component is imported only by `src/app/trends/page.tsx:5` and, functionally, replicated by `src/lib/org/briefing.ts`'s `forecastConfidenceNote`, not by `page.tsx`).

### `/org/[slug]/executive` ("Briefing" tab — IS in-nav)
- `src/components/org/shared/OrgNav.tsx:56-64` — "Overview" group has two tabs: `Overview` and `Briefing` (`href: ${base}/executive`). **This is the one reachable recurring-value surface with narrative text.**
- `src/app/org/[slug]/executive/page.tsx:24-44` calls `buildExecBriefing` (`src/lib/org/briefing.ts`), which is **pure deterministic assembly over stored data — no LLM call** (`grep` for `generateStructured|llm|prompt` in `briefing.ts` finds only import-time labels and the "Copy for LLM" markdown export, `briefing.ts:298-300`). So this journey's recurring surfaces are NOT an AI-generation surface — grounding-audit doesn't apply (the underlying maturity *scores* were LLM-produced by a prior scan, out of this journey's scope per the journey file).
- `forecastConfidenceNote(confidence)` (`briefing.ts:36-39`): `` `trend confidence ${confidence}%${confidence<50 ? " · noisy" : ""}` `` — same honest-noise framing as `Trajectory.tsx`.
- `valueRealizedLine(vr)` (`briefing.ts:44-51`): builds "N recommendations completed · fleet ±N pts · N repos leveled up", **returns `null` when nothing happened** (so a flat period doesn't print a fake "0·0·0" — good). But: `vr.pointsMoved = rollup.avgOverall - rollup.baseline.avgOverall` (`briefing.ts:262`) is **raw, unguarded by `isWithinNoise`** — unlike every other delta surface in the app (see Finding 2).

### `/trends?repo=owner/repo` (per-repo trajectory + R² confidence)
- `src/app/trends/page.tsx` — requires an explicit `?repo=` query string (no picker on the page itself, `page.tsx:54-60` shows a "No repository specified" notice if absent).
- Renders `Trajectory` (`src/components/org/overview/Trajectory.tsx:26-107`), fed by `forecastTrajectory` (`src/lib/maturity/forecast.ts:119-182`, OLS fit, `fitQuality`=R², `lowData` flag when <3 distinct days). UI: `trend confidence {confidence}%{confidence<50 ? " · noisy" : ""}` (`Trajectory.tsx:96-103`) — the exact "is this real or is the model breathing" answer Yusuf's voice asks for.
- **Reachable only via**: `src/components/report/ScoringTab.tsx:95` (a link from a repo's full report page) or `src/app/report/compare/page.tsx:125`. **No link from `/org/[slug]` Overview or Briefing to a specific repo's `/trends`.**

### `/usage` (credits-vs-allotment + $ legibility)
- `src/app/usage/page.tsx:18-160` — org-scoped, auth-gated via `canReadOrg` (line 62), computes `creditBalance`, `dailyBurn`, `runwayDays`, `lowBalance` (lines 138-142), passes to `UsageDashboard`.
- `AllotmentPanel` (`src/app/usage/AllotmentPanel.tsx:45-85`) is the exact right-sizing instrument Yusuf's "Idle-credit check" wants: `allotmentRead()` (lines 29-37) computes `pct` of the plan's `includedCredits` and a `fit: "under" | "ok" | "over"`. For Yusuf (≈6-8 scans/mo vs Pro's 100) this renders `fit = "under"` → *"You're using ~7% of your 100/mo allotment — a smaller tier may fit."* (`AllotmentPanel.tsx:62`). **This is a strength — the design explicitly names the downgrade path his references demand.**
- BUT the panel's caption directly beneath that computation reads: *"Unused credits roll over — they never expire, so a quiet month is not lost."* (`AllotmentPanel.tsx:80-82`). See Finding 4 — this line is **not accurate for the thing the panel is measuring.**
- **Reachability**: `src/app/org/[slug]/layout.tsx` (populated-org branch, lines 206-222) never renders `SiteFooter` (only the pre-dashboard `Frame`, lines 25-32, does — and `Frame` is only used for the no-DB/sign-in-wall/no-access/empty states). `OrgNav.tsx` (all 6 groups, lines 56-121) has **no tab for `/usage`**. `OrgHeader`'s `HeaderAccount` (`Brand.tsx:37-96`) has no `/usage` link either. **`/usage` is reachable ONLY by typing the URL** once inside a populated org dashboard.

### `/pricing` ($ legibility + rollover framing)
- `src/app/pricing/page.tsx:39-127` — `PRO_PRICE`/`TEAM_PRICE` derived from `planPriceLabel()` (`src/lib/plans.ts:88-93`) over `PLAN_FEATURES` (`plans.ts:32-81`: Free $0/5 credits/30d retention, **Pro $10/mo/100 credits/180d**, Team $20/mo/500 credits/365d, Enterprise custom/∞). Real numeric $ shown for Pro/Team (line 81-83) — Yusuf's "the actual subscription dollar amount being absent" pet peeve is **directly addressed**.
- Copy (`pricing/page.tsx:116-122`): *"Every plan's monthly scan allowance resets each month… Buy prepaid scan credits… which roll over and never expire."* — this correctly separates "allowance resets" from "purchased credits roll over" (see Finding 4 — `/usage`'s `AllotmentPanel` doesn't draw the same distinction).
- **Reachability**: same gap as `/usage` — no link from the org dashboard chrome. Only reachable from the marketing `SiteFooter`/`SiteHeader` (pre-auth pages) or `CreditsControl`'s "See plans →" link when `!buyEnabled && !grantsEnabled` (`CreditsControl.tsx:250-256`) — a conditional that won't render on a deployment with Polar or grants configured.

### Credits chip (in-header, always reachable)
- `CreditsControl` (`src/components/org/shared/CreditsControl.tsx`), rendered in `OrgHeader`'s `actions` cluster by `layout.tsx:184-193` — **always visible** on every org page. Shows `{balance} credits`, and on open, `"{freeScansLeft} free scans left this month"` when `coveredByAllowance` (lines 198-203). This is the one price-adjacent surface Yusuf sees on every visit with zero extra navigation.

### Cadence / alerts
- `AlertsControl` (`src/components/org/shared/AlertsControl.tsx`) — always visible in `OrgHeader` actions (`layout.tsx:183`). Configures a Slack-compatible webhook + regression thresholds (`overallDrop`/`dimensionDrop`) — POSTs `/api/org/alerts`. **No email option, no cadence selector** (weekly is fixed by the cron, not a per-org preference).
- Weekly digest cron: `src/app/api/cron/digest/route.ts` (Vercel Cron, fixed weekly). Gate: `digestHasSignal()` (`src/lib/alerts.ts:54-64`) — sends **only** on a level change, a regression, a real (`gainersBeyondNoise`) gain, low credits, or an overall move `!isWithinNoise`. A flat monolith week is silently skipped. This is the strongest single piece of evidence that the product's design intent matches Yusuf's "close the tab on a flat week" want.

---

## 2. Reachable-surface set for Yusuf (nav/entitlement resolved)

Auth: `ASCENT_AUTH_BYPASS=1` (`uat/env.md`) → every `/org/*` gate passes. Yusuf is on Pro (`monthlyPrice: 10`, `includedCredits: 100`, `retentionDays: 180`, `plans.ts:45-56`), owner of a 1-repo org.

Reachable **with in-app navigation** (OrgNav + OrgHeader):
`/org/<slug>` (Overview) · `/org/<slug>/executive` (Briefing) · Credits chip (always visible) · Alerts popover (always visible) · every other `OrgNav` tab (Repositories, Security, …).

**NOT reachable via any in-app control from inside the org dashboard** (URL-only): `/trends?repo=…`, `/usage`, `/pricing`. A first-time visitor following only what's clickable never lands on any of the three surfaces the journey file names as core evidence (`/trends`, `/usage`, `/pricing`) — he'd have to already know the URLs (plausible for a power-user co-founder who reads code, but it is a genuine, code-confirmed nav gap, not an assumption).

---

## 3. In-character walkthrough (Yusuf, thought experiment over the model above)

*It's Monday. I open `/org/<my-org>` out of habit.*

**Overview.** The masthead says "Fleet" — my org has one repo. `repos: 1`, `avg: <score>`, one ▲/▼/→ count, "avg move". It's technically correct but it's dressed for someone with a portfolio. My repo row shows the delta chip: if it's ±1-2 it renders muted with "≈" instead of a green/red arrow — good, that's the honest signal I want, and it took me under 10 seconds. *(Noise check: PASS at this surface.)*

**Briefing tab.** I click it (it's in the left rail, one click). It gives me a narrative: "Value this period: fleet +1 pts" if my repo wobbled +1 this week. Wait — is that a real move, or is that the exact ±1 the codebase's own comment (`noise.ts:5-8`) says two identical re-scans produce? Nothing here tells me. My eye goes straight to that line because it's labeled "Value this period" — the one line the app is telling me to trust — and it's not hedged the way the Overview row or the Trajectory card would hedge it. *(Recurring-value / Noise check: this is exactly the "did the codebase change or is the model just breathing" question I always ask, and on the ONE surface built to answer it in prose, nobody checked.)*

**Trying to find the trend confidence + $ price.** I remember Ascent has a trends page with an R² read. I don't see it linked from Overview or Briefing — I'd have to open my repo's full report and find the "Trends" link there, or already know `/trends?repo=me/monolith`. Then I want to know: is Pro actually sized for me? I look at the header — a "credits" chip shows a number (probably 0, since I've never bought a top-up) with no context until I click it, and then it tells me how many free scans are left this month, but not what my *allotment* was or what % I've used. To see the real "6 of 100" read and the $10/mo figure, I need `/usage` and `/pricing` — neither is in the nav, the header, or anywhere I'd naturally click from inside my dashboard. I'd have to type the URL. I know how to do that (I'm the eng lead) but that's a "hunt," not a "glance" — and the definition-of-done explicitly wants this legible without leaving the app's obvious paths.

**If I do type `/usage`.** The Allotment panel is genuinely good: "You're using ~7% of your 100/mo allotment — a smaller tier may fit." That is precisely the sentence my references say a credit-priced product needs to say out loud. But right under it: "Unused credits roll over — they never expire, so a quiet month is not lost." That's not true of the *allotment* this panel is measuring — the code (`entitlement.ts`, `plans.ts`) resets my month-to-date usage count every calendar month; only *purchased* top-up credits roll over, and I've never bought any. If I ever cross-check that claim against my invoice, I'm going to feel lied to by the exact panel that was trying to earn my trust. That is the single fastest way to turn "downgrade" into "churn" for me.

**If I do type `/pricing`.** This one's honest and gets it right: "monthly scan allowance resets each month… prepaid credits… roll over and never expire" — the correct distinction. So the TRUTH is in the codebase and even on one surface, but the `/usage` panel — the one I'd actually check on a Monday — contradicts it.

**Alerts.** I open the bell icon, set my Slack webhook, done in 30 seconds. On a flat week, I get nothing — no digest at all (`digestHasSignal`). That's *exactly* what "weekly beats monthly on signal, or admits it doesn't" should look like: cadence stays weekly, but noise doesn't cost me an open. I trust this part.

---

## 4. Scored acceptance criteria (Yusuf's own bar, applied identically)

| Criterion | Verdict | Why |
|---|---|---|
| Recurring-value check | **PARTIAL** | Briefing's `valueRealizedLine` correctly nulls when nothing happened, but its "fleet ±N pts" component is unguarded by the noise band — can print a fake "value this period" off a wobble on his exact 1-repo shape. |
| Noise check | **PARTIAL** | PASS at Overview row (`toneFor`/`isWithinNoise`), PASS at Trajectory/digest (`fitQuality`/`lowData`/`gainersBeyondNoise`) — **FAIL** at Briefing's headline value line (see above), the surface he's most likely to read as "the verdict." |
| Price-legibility check | **PARTIAL (content) / FAIL (reachability)** | The numbers exist and are correct (`/usage` allotment %, `/pricing` real $10/$20) but neither page is linked from anywhere inside the org dashboard he actually lives in. |
| Idle-credit check | **PARTIAL** | The right-size nudge ("a smaller tier may fit") exists and is well-targeted — but it's paired with a rollover claim that's inaccurate for the thing being measured (the monthly allowance, not the purchased-credit balance), on the one org he'd fact-check hardest. |
| Cadence check | **PASS** | `digestHasSignal` genuinely suppresses a flat week; a monolith that didn't move gets silence, not a restated number. |
| Time-saved bar (<5 min to decide) | **PASS structurally, at risk in practice** | The Overview glance is fast and honest. But answering the FULL job ("is Pro still worth it") requires finding `/usage`/`/pricing`, which isn't a click away — that's where the 5-minute budget leaks. |

**Senior-quality bar**: a staff engineer's flat-week read is "no material change, don't invent a trend" — the Overview row and the Trajectory/digest layer clear that. The Briefing's raw `pointsMoved` line does **not** clear it: it can assert a "+1 pt" move as if it were news, which is precisely the fabricated-signal failure the bar forbids, on the surface most likely to be read as the verdict.

---

## 5. Findings

```json
[
  {
    "id": "L1-yusuf-repeated-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "yusuf-bootstrapped-rails",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Briefing's \"Value this period\" line reports raw fleet-score delta with no noise gate, unlike every other delta surface in the app",
    "expected": "The one narrative surface that says \"this is what happened this period\" should apply the same ±2-point noise band (isWithinNoise / SCORE_NOISE_BAND) the Overview row, Trajectory card, and weekly digest already apply, so a scan-to-scan wobble never reads as \"value realized.\"",
    "got": "valueRealizedLine() (src/lib/org/briefing.ts:44-51) prints `fleet ${pointsMoved>0?\"+\":\"\"}${pointsMoved} pts` whenever pointsMoved !== 0 (line 48). pointsMoved = rollup.avgOverall - rollup.baseline.avgOverall (briefing.ts:262) — raw, no isWithinNoise() check. Contrast with format.ts:33-43 (Overview row), forecast.ts's fitQuality/lowData (Trajectory), and alerts.ts:54-64 digestHasSignal/gainersBeyondNoise (weekly digest) — all three explicitly gate on the noise band.",
    "evidence": ["src/lib/org/briefing.ts:44-51", "src/lib/org/briefing.ts:262", "src/lib/maturity/noise.ts:16-21", "src/components/ui/format.ts:33-43", "src/lib/alerts.ts:54-64"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Live-scan a stable repo twice with no code change, confirm the Briefing tab's \"Value this period\" line prints a ±1-2pt fabricated move; verify a fix guards pointsMoved with isWithinNoise before it reaches the sentence."
  },
  {
    "id": "L1-yusuf-repeated-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "yusuf-bootstrapped-rails",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "/usage and /pricing are not reachable from any control inside the populated org dashboard",
    "expected": "Since the journey's core job is \"map recurring value to recurring cost,\" the pages that show cost (/usage's allotment %, /pricing's $ figures) should be one click from the dashboard he actually lives in.",
    "got": "OrgNav (src/components/org/shared/OrgNav.tsx:56-121) — all 6 rail groups (Overview/Fleet/Intelligence/Plan/Library/Govern) — has no /usage or /pricing tab. OrgHeader's HeaderAccount (src/components/Brand.tsx:37-96) has none either. SiteFooter, which does link /usage (Brand.tsx:251-253), renders only in org/[slug]/layout.tsx's pre-dashboard `Frame` (lines 25-32) — never in the populated-org branch (lines 206-222) that every real visit reaches. CreditsControl's \"See plans →\" link to /pricing (CreditsControl.tsx:250-256) only renders when NEITHER Polar buying NOR manual grants are enabled — a condition many deployments won't satisfy.",
    "evidence": ["src/components/org/shared/OrgNav.tsx:56-121", "src/components/Brand.tsx:37-96", "src/app/org/[slug]/layout.tsx:25-32", "src/app/org/[slug]/layout.tsx:206-222", "src/components/org/shared/CreditsControl.tsx:250-256"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Drive the live dashboard as a fresh session and time how long it takes to find the credits-vs-allotment view and the $ price without typing a URL; confirm no path exists."
  },
  {
    "id": "L1-yusuf-repeated-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "yusuf-bootstrapped-rails",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "AllotmentPanel's rollover copy misdescribes the thing it's measuring — the monthly allotment resets, it doesn't roll over",
    "expected": "A right-sizing panel comparing burn to the monthly allotment should not claim that allotment rolls over, when the code's own entitlement model resets it every month and only purchased top-up credits (a separate balance, usually 0 for a low-usage org) roll over.",
    "got": "AllotmentPanel.tsx:80-82: \"Unused credits roll over — they never expire, so a quiet month is not lost.\" appears directly under a computation of monthlyBurn vs the plan's includedCredits (allotmentRead(), AllotmentPanel.tsx:29-37). But checkScanEntitlement (src/lib/entitlement.ts:44-68) resolves the monthly allowance via countMeteredScansThisMonth (src/lib/db/credits.ts:278) — a month-to-date COUNT, not a stored balance — while org.scanCredits (the thing that actually rolls over, getCreditState, src/lib/db/credits.ts:81-91) starts at 0 and is untouched while an org stays under its allowance. /pricing's own copy (src/app/pricing/page.tsx:116-122) correctly separates \"allowance resets each month\" from \"purchased credits roll over\" — the two surfaces disagree on the same concept.",
    "evidence": ["src/app/usage/AllotmentPanel.tsx:80-82", "src/app/usage/AllotmentPanel.tsx:29-37", "src/lib/entitlement.ts:44-68", "src/lib/db/credits.ts:278", "src/lib/db/credits.ts:81-91", "src/app/pricing/page.tsx:116-122"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "On a Pro org with balance=0 and low usage, load /usage live and confirm the rollover sentence renders next to the allotment % with no distinguishing caveat; check whether next month's allotment% resets to a fresh 0% baseline (proving no rollover) contradicting the copy."
  },
  {
    "id": "L1-yusuf-repeated-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "yusuf-bootstrapped-rails",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "\"Fleet\" framing is hardcoded across Overview/Briefing regardless of repo count",
    "expected": "Per Yusuf's explicit pet peeve, a 1-repo org's recurring surfaces shouldn't use fleet/portfolio language unconditionally.",
    "got": "SectionHeader title=\"Fleet\" (RepoCategoryRollup.tsx:208) and OrgHeader's \"Fleet maturity\" tooltip (Brand.tsx ~210) render the same regardless of trajectories.length/repoCount; valueRealizedLine's \"N repos leveled up\" phrasing (briefing.ts:49) and the Briefing's \"Fleet adoption: X% of scanned repos\" line (executive/page.tsx) use the same unconditional wording.",
    "evidence": ["src/components/org/overview/RepoCategoryRollup.tsx:208", "src/components/Brand.tsx:210", "src/lib/org/briefing.ts:49"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm live copy on a genuinely 1-repo seeded org; low severity on its own but compounds the trust findings above (feels built for someone else's company)."
  },
  {
    "id": "L1-yusuf-repeated-05",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "yusuf-bootstrapped-rails",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "Overview has no direct link into a repo's /trends (R² confidence) view",
    "expected": "The Overview delta chip is muted for noise, but doesn't offer a one-click path to the numeric R²/\"noisy\" read for the curious Character.",
    "got": "The only links to /trends?repo=… are from ScoringTab.tsx:95 (inside a repo's full report) and report/compare/page.tsx:125 — none from RepoCategoryRollup's per-row link (which points at the report permalink, not /trends).",
    "evidence": ["src/components/report/ScoringTab.tsx:95", "src/components/org/overview/RepoCategoryRollup.tsx:90-97"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Low priority — Briefing's forecastConfidenceNote already surfaces the same information on a reachable tab; only worth fixing if L2 shows Character actually wants deeper drill-down."
  }
]
```

### What passed (strengths worth protecting)
- `digestHasSignal` (`src/lib/alerts.ts:54-64`) genuinely suppresses the weekly digest on a flat period — the single strongest piece of evidence the product was built for exactly Yusuf's "don't cry wolf" requirement. **Do not regress this.**
- `AllotmentPanel`'s `fit: "under"` verdict (`AllotmentPanel.tsx:35`) computes and names the exact downgrade signal his references (credit-pricing rollover norm) demand — the mechanism is right, only the adjacent copy is wrong (Finding 3).
- Per-row noise muting on the Overview (`format.ts` → `isWithinNoise`) and the Trajectory/Briefing `fitQuality`/`lowData`/"noisy" framing (`forecast.ts`, `Trajectory.tsx:89-103`, `briefing.ts:36-39`) are honest, well-reasoned, and consistent with each other — just not consistent with Finding 1's Briefing value line.
- `/pricing` shows real, single-sourced $ amounts (`plans.ts` → `planPriceLabel`) that can't drift from what's charged.

---

## 6. Character voice — first-person reaction

"Okay, some of this is actually good. The Monday glance at Overview is fast — one repo, one score, one muted delta if nothing real happened. That's the 5-minute version of my old CI-skim, and I'll take it.

But the Briefing tab is where I'd actually make my renew/downgrade call, and it just told me 'fleet +1 pts' like that means something. I know what a ±1 wobble is — it's in your own code comment, for God's sake — and you didn't check it before putting it in the one sentence labeled 'Value this period.' That's the exact thing I said would turn me cold: a score that moves on an unchanged repo with nothing telling me it's the guardband breathing.

Then I go looking for the actual number — am I burning 6 credits or 60 out of my 100? — and there's no door to it from where I live. I have to already know `/usage` exists. Fine, I'm the eng lead, I'll type it. And when I get there, it tells me my idle credits 'roll over, never expire' right next to the exact number that's about to reset to zero next month. Pick one. If I catch that lie at renewal time, I'm not downgrading anymore — I'm gone, and I'm telling the other bootstrapped founder in my Slack group why.

The good news: the mechanism for the right call already exists — '~7% of your allotment, a smaller tier may fit' is precisely the sentence I want. And the digest actually shuts up on a flat week, which is rarer and more valuable than any of you seem to realize. Fix the noise-gate on the Briefing line, wire a link to /usage and /pricing from somewhere I'd actually click, and fix the rollover sentence to match what the code does — then this is a keep, maybe even a story I tell a peer. As shipped, I'd still open it Monday out of habit, but I wouldn't trust the number enough to act on it without going and checking myself — which defeats the whole point."

Would I adopt it? *Conditionally — I already run the scan, the question is whether I trust the recurring read enough to stop cross-checking it myself.* Does it fit my world? *The Overview does. The Briefing's headline number, as shipped, doesn't yet earn the trust it's asking for.* Would I tell a peer? *Only after the noise-gate and the rollover copy are fixed — right now I'd tell them "the scan's real, the trend line is honest, but don't trust the top-line 'value this period' sentence yet."*
