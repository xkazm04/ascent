# L1 report — Sasha (build-vs-buy DevEx lead) × "Repeated org scans worth the price?"

cert_level: L1 (theoretical, static, code-grounded) · date: 2026-07-16

---

## 1. Surface model (with citations)

### Reachability check
Sasha's surface binding: `/org/[slug]` (overview · Trajectory · movers/period), `/org/[slug]/executive`, `/trends`, `/usage`, `/pricing`, `/api/org/export`, `/api/history`, `/api/usage`.

- Auth: `ASCENT_AUTH_BYPASS=1` resolves every viewer to a synthetic "developer" owner (`src/lib/access.ts`, per `uat/env.md`). A populated `/org/<slug>` visit persists a real owner `Membership` (`src/app/org/[slug]/layout.tsx`, per env.md) — so Sasha's RBAC role for gate checks (`hasOrgRole`, `canReadOrg`) resolves as **owner**, the richest role. No plan-tier gate blocks any of her bound routes: `/org/[slug]`, `/executive`, `/trends`, `/usage`, `/pricing` are all reachable regardless of plan (only `BrandingSettings`/white-label on `/executive` is plan-gated — `planAllowsWhiteLabel`, `src/app/org/[slug]/executive/page.tsx:61` — and it's cosmetic, not something she needs).
- Export endpoints (`/api/org/export`, `/api/history`, `/api/org/repositories`) are gated only by `requireOrgRead`/`canReadOrg` (`src/app/api/org/export/route.ts:29`, `src/app/api/history/route.ts:64-75`) — **not** plan-tier-gated. So data portability, if present in the code, is reachable to her regardless of tier. This itself matters: no artificial lock-in gate exists on top of whatever coverage the exports have.

**Verdict: every surface in her binding is reachable.** The reachability gap in this journey is not nav/entitlement — it's *coverage* (what the exports actually contain), covered below.

### A. Fleet overview / trajectory / movers — `/org/[slug]`
- `src/app/org/[slug]/page.tsx:65-98` — fetches `getOrgRollup` + `getOrgRepoHistories`, derives `buildTrajectories` (`src/components/org/overview/repoTrajectory.ts:52-86`) and a repo×dimension heatmap.
- Per-repo trajectory rows render through `fmtDelta`/`deltaHex` (`src/components/org/overview/RepoCategoryRollup.tsx:114-132`), which route through `toneFor` → `isWithinNoise` (`src/components/ui/format.ts:4,33-42`, `src/lib/maturity/noise.ts:16-27`, `SCORE_NOISE_BAND = 2`). A delta ≤2 renders muted/`≈`, not a confident arrow. Cross-engine (mock→live) deltas are separately muted (`RepoCategoryRollup.tsx:118-127`, `deltaCrossesEngine`, `repoTrajectory.ts:39-41,61`).
- Heatmap: `src/components/org/overview/RepoDimensionHeatmap.tsx`.

### B. Executive briefing (trajectory headline + "Movement this period") — `/org/[slug]/executive`
- `src/app/org/[slug]/executive/page.tsx:38` → `buildExecBriefing` (`src/lib/org/briefing.ts`).
- Trajectory headline: forecast confidence surfaced via `forecastConfidenceNote` (`src/lib/org/briefing.ts:33-38`, consumed at `executive/page.tsx:159-161`), backed by real OLS regression with R² (`fitQuality`) and a `lowData`/flat-floor guard (`src/lib/maturity/forecast.ts:57-63,149-180`) — genuinely "more than a slope."
- **"Movement this period" list (topGainers/topRegressions)**: built from `getOrgMovers`'s `gainers`/`regressers`, partitioned purely on `dOverall > 0` / `< 0` with **no noise-band filter** (`src/lib/db/org-insights.ts:167-168`), passed straight through `moveRow`/`.slice(0,3)` (`src/lib/org/briefing.ts:283-284`) into `<MoveRow>` (`src/components/org/executive/briefingShared.tsx:50-89`). `MoveRow` takes a fixed `tone: "up"|"down"` and always renders a full-strength ▲/▼ arrow (lines 65-86) — it never calls `fmtDelta`/`toneFor`/`isWithinNoise`, unlike the Overview's `RepoCategoryRollup` rows.
- By contrast, the digest email (the between-login recurring surface, DoD bullet 1) **does** noise-filter symmetrically: `src/app/api/cron/digest/route.ts:33,147-178` filters `regressersBeyondNoise`/`gainersBeyondNoise` via `isWithinNoise` before rendering "Regressions:".
- Cross-org corpus percentile ("Corpus percentile" tile, `executive/page.tsx:102-108`): `getOrgBenchmark` (`src/lib/db/org-insights.ts:590-629`) genuinely queries **every other org's** most-recently-scored repos (`orgId: { not: org.id }`, capped at 5000, `CORPUS_MIN=5`/`COHORT_MIN=5` floors before showing a percentile at all) — a real cross-tenant asset she cannot reproduce from her own Git data alone.

### C. Data portability — `/api/org/export`, `/api/history`, `/api/org/repositories`
- `/api/org/export?kind=contributors|delivery|passports|teams` (`src/app/api/org/export/route.ts:26-108`) — CSV/JSON for contributor AI-share, branch-governance ("delivery"), passport (automation/production readiness), and CODEOWNERS-team rollups. **No `kind` covers the 9 maturity dimensions, the org-level overall/adoption/rigor trajectory, or the movers list.**
- `/api/org/repositories?format=csv` (`src/app/api/org/repositories/route.ts:23-45`) — one row per repo: `level, overall, adoption, rigor, posture, lastScan` (current snapshot only). No per-dimension (9-dim) breakdown, no deltas/movers, no forecast/ETA/confidence.
- `/api/history?repo=owner/repo&format=csv` (`src/app/api/history/route.ts:22-37,92-105`) — **per-repo** full dimension history (all 9 dims, every scan, engine+model provenance, SHA-256 integrity header) — the richest export, but scoped to one repo per call. To reconstruct an org-wide per-dimension trend export she'd have to loop this call once per repo (N calls for N repos) — no single bulk "all repos, all dimensions, all history" endpoint exists.
- **No export at all** for the trajectory forecast (ETA, `fitQuality`/R², `lowData` flag) or for the movers list — those numbers exist only in server-rendered HTML on `/executive`.

### D. Price legibility — `/pricing`
- `src/app/pricing/page.tsx:40-41,79-87` — `PRO_PRICE`/`TEAM_PRICE` derived from `planPriceLabel()` reading `PLAN_FEATURES` (`src/lib/plans.ts:32-81`, single source also read by the entitlement gate) — real `$10`/`$20` numbers, not "contact us," for the tiers she'd actually buy. Retention window is listed per tier ("180-day history" / "1-year history", `plans.ts:55,67`) though the Free tier's feature list omits its own "30-day history" line (`plans.ts:43`) — minor, not her tier.
- Enterprise stays "Custom"/mailto (`pricing/page.tsx:25-28`) — expected and acceptable per her own criteria (she'd expect Enterprise to be negotiated).

### E. Usage / credits — `/usage`
- `src/app/usage/page.tsx:133-142` — credit balance, burn rate, runway days computed server-side from real usage aggregates; scan allowance visible per plan tier.

---

## 2. In-character walkthrough (thought experiment over the model)

I open `/org/megacorp` the way I've opened it every cycle. Fleet overview first. The repos×time rollup and the per-repo trajectory column actually flag noise correctly — a repo that moved +1 shows muted with a tooltip explaining it's inside the noise band, and a mock→live transition gets called out too instead of dressed up as a real climb. That's the right instinct; whoever built `lib/maturity/noise.ts` clearly knows the failure mode ("two independent re-scans of the same commit moved 0 points overall, ±1/dim"). Good — that's the single thing that kills repeat-buy trust fastest, and here it's handled.

Then I go to `/executive` for the cycle's board-ready read. Trajectory headline: real R²-backed forecast with a flat-floor and low-data caveat, not a spreadsheet slope — fine, I'd have to write more than an afternoon's OLS to get the `lowData` guard right, so that's a legitimate line in the build column favoring buy. "Movement this period" — the actual movers list I'd screenshot for a stakeholder — shows three gainers and three regressions with full-strength arrows and no noise annotation at all. I already saw the noise band applied correctly one tab over. Did whoever wired the movers list just... not reuse it? A +1 repo sits in that list with the identical ▲ styling as a +8 repo. That's exactly the "is this real or wobble" question I came here to answer, and on the one surface I'd actually paste into a deck, the app doesn't answer it — even though the digest email one tab over (same underlying data) *does* filter this correctly. That's an inconsistency inside the product, not a missing capability — the fix is a five-minute reuse, but until it lands I can't trust the movers list at face value; I'd have to cross-reference `deltaWindow` myself or ignore small movers.

Corpus percentile tile — "vs 340 repos" or whatever the count reads. That's the one line item I structurally cannot build myself: I don't have visibility into any other org's scores. If that corpus number is real and non-trivial (the query genuinely excludes my own org and floors at 5+ peer orgs before showing a percentile, so it isn't a confidently-wrong 100th-percentile off a 2-org sample), that's the moat. Good — that's the grudging compliment line, if it holds live.

Now the ledger question: can I bulk-export this? `/api/org/export` gives me contributors, governance, passports, teams — useful, but none of it is the maturity score itself. `/api/org/repositories?format=csv` gets me current overall/adoption/rigor/posture per repo — a snapshot, not a trend, and not the 9-dimension breakdown I'd need to reproduce the dashboard in my warehouse. `/api/history?repo=X&format=csv` has the full per-dimension history with engine/model provenance — genuinely good, SHA-256 integrity header even — but it's one repo per call. For a 10,000-engineer fleet with hundreds or thousands of scanned repos, that's hundreds of HTTP round-trips to reconstruct one org-wide table, and there's no single bulk endpoint for it. And the trajectory/forecast numbers (ETA, fit confidence) and the movers list aren't exported anywhere at all — they exist only as rendered HTML on `/executive`. If I want those in my warehouse, I'm scraping a webpage, which is exactly "renting my own data back" with extra steps.

Pricing: real Pro ($10)/Team ($20) numbers, derived from the same source the gate reads — I can put an actual figure in the ledger instead of "contact us." That's table stakes done right, not a differentiator, but at least it's not a blocker.

---

## 3. Scored acceptance criteria — judged against the designed experience

- [~] **Recurring-value / moat check** — PARTIAL PASS. The cross-org corpus percentile (`getOrgBenchmark`, org-insights.ts:590) is a genuine structurally-non-reproducible asset, contingent on the corpus actually holding ≥5 peer orgs live (L2 must confirm this isn't usually null in practice). No calibration-loop-that-compounds is visibly exposed to her (the "discrepancy backlog" in org-insights.ts:881 is per-org, reproducible from her own scan data, not a moat).
- [ ] **Data portability** — FAIL as designed. Org-level scores/dimensions/movers/trajectory are NOT bulk-exportable in one call. `/api/org/export` covers adjacent tables (contributors/governance/passports/teams) but not maturity scores. `/api/org/repositories` exports current snapshot only, no dims, no trend. `/api/history` has the dims+history but is per-repo (N calls). Trajectory forecast + movers have no export at all.
- [ ] **Move-is-real trust at the point the move is shown** — FAIL on the Executive "Movement this period" list specifically (no noise-band filter/annotation, confirmed by code: `org-insights.ts:167-168` + `MoveRow`, `briefingShared.tsx:50-89`), despite the identical primitive being correctly wired into the Overview rows and the digest email. Inconsistent, not absent.
- [x] **Forecast is more than a slope** — PASS. Real OLS + R² (`fitQuality`) + `lowData`/flat-floor guard (`forecast.ts`).
- [x] **Price legibility** — PASS. Real Pro/Team $ figures from the single-sourced plan model.
- [~] **Per-cycle new decision** — PARTIAL. The trajectory + corpus percentile + movers *would* surface a new decision each cycle if the movers list's trust gap (above) is fixed; as designed, a low-velocity cycle's movers list can show noise dressed as signal, which is itself a wrong "new decision," not silence.

## Motivation (time-saved) applied to the designed experience
If the moat and portability items land as promised, the **~3-4 hr/cycle analyst-time saving** (re-pulling Git signals, re-scoring 9-dim rubric, re-fitting a trend) is plausible — the fleet rollup + trajectory + heatmap genuinely replace that manual assembly. But the *portability gap* caps the upside: if she can't bulk-export into her warehouse, she must keep re-deriving her own copy anyway for anything beyond viewing the dashboard, which erodes exactly the time saved. Estimated time-saved-if-it-all-worked: **~3.5 hr/cycle** (mid-point), contingent on fixing the movers-trust gap and portability gap before she'd credit the full number; as designed today I'd discount it to roughly half that because she'd still hand-verify movers and hand-assemble a warehouse copy.

## Senior-quality bar applied to the designed experience
A staff DevEx engineer on her team would accept: the forecast math (real R², flat-floor, low-data guard) and the cross-org percentile (real cross-tenant query with sample floors) as non-trivial to reproduce in a sprint. They would **reject** the Executive movers list as shipped — a staff engineer who saw a ±1 repo displayed with the same confident arrow as a ±8 repo, right next to a digest email that gets this correctly, would call it a QA gap, not a feature. And they would reject "no bulk org-level export of the metric that is the entire product" as something they'd build the export for themselves in an afternoon and then own — which is precisely her kill-line ("this is a thin wrapper; we own the data and build it ourselves") aimed at exactly the layer that's the actual differentiator (the scores), not the adjacent tables that already export fine.

---

## 4. Findings

```json
[
  {
    "id": "L1-sasha-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sasha-megacorp-buildvsbuy",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "No bulk org-level export of maturity scores/dimensions/trajectory/movers — the actual product, not the adjacent tables",
    "expected": "One API call returns every repo's overall/adoption/rigor + all 9 dimension scores + trend/trajectory + movers, bulk-exportable (CSV/JSON) — the number this product is FOR.",
    "got": "/api/org/export only covers contributors/governance('delivery')/passports/teams (src/app/api/org/export/route.ts:26). /api/org/repositories exports a current-snapshot overall/adoption/rigor/posture only, no 9-dim breakdown, no trend (src/app/api/org/repositories/route.ts:23-45). /api/history has full per-dimension history but is scoped to ONE repo per call (src/app/api/history/route.ts:39-41) — an org-wide reconstruction needs N calls. Trajectory forecast (ETA/R²) and the movers list have no export endpoint at all.",
    "evidence": ["src/app/api/org/export/route.ts:26-108", "src/app/api/org/repositories/route.ts:23-45", "src/app/api/history/route.ts:39-41"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Live-drive: does she actually hit the N-call ceiling on a real fleet size, and does the JSON /api/org/repositories response (non-CSV) include anything closer to full dims that the CSV branch trims? Confirm no undocumented org-wide dims/trajectory export exists."
  },
  {
    "id": "L1-sasha-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sasha-megacorp-buildvsbuy",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Executive \"Movement this period\" list shows a within-noise +1 move with the same confident arrow as a real +8 — the noise-band primitive exists and is used elsewhere but not here",
    "expected": "A move ≤ SCORE_NOISE_BAND (2 points) renders muted/annotated as noise, per the product's own stated contract (lib/maturity/noise.ts) and per how the Overview rows and the digest email already do it.",
    "got": "getOrgMovers partitions gainers/regressers purely on dOverall > 0 / < 0 with no noise filter (src/lib/db/org-insights.ts:167-168); MoveRow renders a fixed-tone, full-strength ▲/▼ regardless of magnitude, never calling fmtDelta/toneFor/isWithinNoise (src/components/org/executive/briefingShared.tsx:50-89). Contrast: RepoCategoryRollup rows correctly mute via fmtDelta→toneFor→isWithinNoise (src/components/org/overview/RepoCategoryRollup.tsx:114-132), and the digest email filters regressersBeyondNoise/gainersBeyondNoise symmetrically (src/app/api/cron/digest/route.ts:147-178).",
    "evidence": ["src/lib/db/org-insights.ts:167-168", "src/components/org/executive/briefingShared.tsx:50-89", "src/lib/org/briefing.ts:283-284", "src/lib/maturity/noise.ts:16-27"],
    "code_check": "present-but-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Live-drive a fleet with a genuinely noisy repo (re-scan same commit twice) and confirm it appears in the Executive movers list with an undifferentiated arrow — screenshot the discrepancy against the Overview row for the same repo."
  },
  {
    "id": "L1-sasha-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sasha-megacorp-buildvsbuy",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "Cross-org corpus percentile — the one real moat — has no sample-size disclosure in the UI",
    "expected": "When she stakes a build-vs-buy decision on the corpus percentile, she needs to know how many peer orgs it's built from (the code already computes and floors this: CORPUS_MIN=5/COHORT_MIN=5) to judge if it's statistically meaningful.",
    "got": "Executive tile shows only the percentile number and repo count (\"vs N repos\", src/app/org/[slug]/executive/page.tsx:102-108) — the underlying org-count floor and corpus size that make the number trustworthy (src/lib/db/org-insights.ts:570-579) aren't surfaced to the viewer, only enforced silently (null below floor).",
    "evidence": ["src/app/org/[slug]/executive/page.tsx:102-108", "src/lib/db/org-insights.ts:570-579,590-629"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Live-check whether the corpus is non-trivial on the seeded/live org (repo count, peer-org count) — a near-floor corpus would sharpen this from polish to a trust finding."
  },
  {
    "id": "L1-sasha-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sasha-megacorp-buildvsbuy",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Free tier's feature list omits its own retention window",
    "expected": "Each tier's feature bullets state its retention window, matching Pro (\"180-day history\") and Team (\"1-year history\").",
    "got": "Free tier's features array has no retention line (src/lib/plans.ts:43) though retentionDays: 30 is set (line 41) — not something Sasha personally hits (she's evaluating Team/Enterprise), so it's polish for her specifically.",
    "evidence": ["src/lib/plans.ts:41-43"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "n/a — out of scope for this Character's own tier."
  }
]
```

### Strengths worth protecting (positive findings)
- **Cross-org benchmark corpus is real, not decorative** — `getOrgBenchmark` genuinely excludes the caller's own org and floors percentile display below 5 peer orgs, avoiding a confidently-wrong rank (`src/lib/db/org-insights.ts:570-629`). This is the single thing that could flip her decision to "buy."
- **Forecast is real regression, not a slope** — OLS with R² (`fitQuality`), a `lowData` guard, and a flat-floor threshold (`src/lib/maturity/forecast.ts:57-63,149-180`) — she'd concede this is more than an afternoon's work.
- **The noise-band primitive is correctly designed and correctly used in two of three places** (Overview rows, digest email) — the product clearly understands the "is this real or wobble" problem; it just isn't consistently wired everywhere it needs to be.
- **No plan-tier gate blocks her bound surfaces or the export endpoints** — data portability's ceiling is a coverage gap, not an artificial lock-in wall.
- **Pricing numbers are single-sourced and real** for the tier she'd buy — no "contact us" wall on Pro/Team.

---

## Journey verdict: **L1-conditional**

The journey completes structurally — she can reach every surface, form an opinion, and reach a renew/downgrade/churn/upgrade verdict — but two **major** findings (no bulk org-level scores/trajectory export; movers-list noise inconsistency) sit directly on her top-two scored criteria (data portability, move-is-real trust) and would, as designed, tip her toward "build it myself" on the exact layer meant to be the moat. Still L2-eligible: nothing blocks her from finishing the job, but L2 must confirm whether the JSON export paths or corpus size make these gaps worse or better live.

---

## 5. Character voice reaction (Sasha, first-person)

Would I adopt it? Conditionally, and not yet at the price of "recurring." The corpus percentile is the real thing — I can't build that without your customer base, and the code actually floors the sample size instead of confidently telling some 2-org corpus they beat 100% of everyone, which is more discipline than most of these AI-native-maturity vendors show. The forecast is a genuine regression with an honest low-data caveat, not an OLS line I'd bang out in an afternoon and call a "GPS." Fine — those two are the build-vs-buy tiebreakers in your favor.

But then I go looking for the export, because the whole point of buying instead of building is that I don't have to re-derive your number every quarter — I pull it into my warehouse and move on. And the actual maturity score — the 9 dimensions, the trajectory, the movers — isn't bulk-exportable anywhere. You'll hand me contributor and governance CSVs all day, but not the metric I'm actually paying for. That's the tell. If I can't bulk-export the score, I'm renting my own data back, and per my own build bar that flips this to build.

And the movers list — the thing I'd screenshot for my VP — shows a +1 repo with the same confident green arrow as a +8. You clearly know better; your own digest email filters this correctly. So somebody built the noise-band logic once, used it in two places, and forgot the third — the one place a leader actually looks. I don't distrust the math; I distrust that the UI doesn't consistently apply the math you already wrote. Fix the export gap and wire the noise filter into the movers list, and I'd stop asking "what's the moat" and start asking "what's the SLA."

Does it fit my world? Half of it does — the corpus and the forecast speak my language (percentile, R², flat-floor). The other half — no bulk export of the score itself — is exactly the trap DX Core 4 warned me about, and exactly what got me burned before. What's missing for MY job: an API, not a dashboard, for the number I'm buying. Would I tell a peer? "Look at the corpus benchmark, ignore the movers list until they fix it, and don't sign anything until you see a real export of the score."
