# L1 — Sasha (build-vs-buy DevEx lead) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the recurring read completes and has exactly one genuinely non-reproducible asset (the cross-org corpus), but data-portability gaps and commodity-grade scoring provenance give Sasha a real build-vs-buy case; majors are pricing-legibility + partial export, not a structural block.

`PRICING: downgrade` (Team→Pro) — keep the corpus + forecast for a slice of the fleet at the smallest paid tier; don't pay Team/Enterprise for a dashboard she'd build over her own warehouse.

---

## Reachable surface set (tier-honest)

Under `ASCENT_AUTH_BYPASS=1` on a populated `/org/<slug>`, Sasha renders as synthetic owner and reaches the full `/org/*` set. Judged at **her realistic buy tier (Pro)**, because that's the smallest tier that buys the dashboard + trajectory + scheduled rescans, which is the whole recurring-value question:

- **Reachable + Pro-included:** Overview `/org/[slug]` (fleet number, Trajectory, movers/period, corpus standing), `/trends` + CSV export, `/usage` + CSV/JSON export, `/api/org/export` (contributors|delivery), `/api/history?format=csv`, scheduled autoscans + alerts, 180-day retention.
- **Reachable via bypass but NOT Pro (fold into upsell, not free value):** Segments + comparisons, Playbooks + planning (Team, 365-day history); custom retention + unlimited members (Enterprise). The bypass renders these; her *plan* wouldn't include them.
- **The 180-day retention cap is the live constraint on the recurring read:** the trajectory/forecast can only look back as far as retention allows (`src/lib/plans.ts:42` `retentionDays: 180`), so a slow-moving mature fleet gets a half-year OLS window at Pro — adequate, but the multi-year history she'd keep forever in her own warehouse is the build-side advantage.

---

## Surface-model notes (recurring-value affordances → file:line)

**The moat machinery, decomposed (her core job):**
- **9-dim weighted model + archetype lenses** — `src/lib/maturity/model.ts:68` (DIMENSIONS, weights), `:203` (ARCHETYPE_WEIGHTS org/team/solo), `:227` (`overallScoreFor` renormalized weighted mean). Sasha's read: this is a config table + a weighted mean. Defensible *taxonomy* (the 9 AI-native dimensions are a real point of view), but the math is reproducible in a sprint.
- **Guardband + blend provenance** — `src/lib/maturity/model.ts:16` `SCORE_BLEND = 0.6`, `:23` `LLM_GUARDBAND = 25`; applied at `src/lib/scoring/engine.ts:99-102` (guard LLM to ±25 of signal, then 60/40 blend, coverage-scaled at `:70-71`). Her read: "guardband ±25, 60/40 — that's two constants, not IP."
- **Forecast / trajectory GPS** — `src/lib/maturity/forecast.ts:82` `forecastTrajectory` (OLS over day-offset/score), `:87` needs ≥2 distinct calendar days (else null → repetition is *required* to render), `:64` `FLAT_PER_WEEK = 0.5` noise floor, `:123` R² as fit quality, `:131` flat/rising/falling. Her read: "an OLS slope + R² + a flat-floor — more than a bare slope, but an afternoon of work, not a moat."
- **Cross-org corpus benchmark** — `src/lib/db/org-insights.ts:556` `getOrgBenchmark` (percentile vs every repo Ascent has scored, `:549` `percentileOf`, `:542` COHORT_MIN/CORPUS_MIN gates), surfaced on overview + executive via `src/components/org/OrgStanding.tsx`. **This is the one asset Sasha structurally cannot reproduce** — she has only her own org's data; a same-language peer cohort across other orgs is the genuine non-reproducible value.
- **Calibration loop** — `src/lib/db/org-insights.ts:838` `getOrgDiscrepancies` aggregates the LLM auditor's suspected detector misses into a detector backlog. The compounding "model gets better over time" asset — also hard to reproduce, but it improves *Ascent's* IP, not Sasha's warehouse.

**Grounding the recurring read (is the move real):**
- **Trajectory surfaces confidence where the move is shown** — `src/components/org/Trajectory.tsx:34` `confidence = round(fitQuality*100)`, `:96` renders "trend confidence N%" + "· noisy" below 50%, with the flat-floor headline at `forecast.ts:291`. This is a real defense against re-scan noise — on the trajectory.
- **Movers/period deltas do NOT carry noise annotation** — `src/lib/db/org-insights.ts:47-62` `buildMove` computes raw `dOverall = now − prev` with provenance (level/posture from/to, sinceDays) but **no R²/guardband flag**. A repo re-scanned unchanged under `claude-cli` can wobble within the ±25 guardband (`engine.ts:99`) and show up as a "+3 gainer" with no signal that it's the model breathing. The forecast's flat-floor defends the *headline trajectory*; it does not defend the *per-repo mover list*.

**Data portability (her flip-the-decision job):**
- **Exports that exist:** `/api/org/export` (`src/app/api/org/export/route.ts:34`) — contributors|delivery, JSON+CSV, org-read-gated, segment-scoped, formula-injection-safe. `/api/history?format=csv` (`src/app/api/history/route.ts:104`) — per-repo scan history, all 9 dim columns, 200-cap. `/api/usage?format=csv|json` (`src/app/api/usage/route.ts:88`) — credit burn.
- **The gap:** there is **no bulk export of the org-level scores / movers / trajectory** — the recurring-value payload itself. `org/export` covers contributors + delivery/governance tables, not the fleet maturity scores+forecast; `/api/history` is per-repo (no fleet-level / movers / trajectory endpoint, no `?org=` form). And there is **no API-key / programmatic feed** — every export is session-gated, so a nightly warehouse pull means scripting an authenticated browser session. For a 10k-eng org wanting the data in her own warehouse, this is partial portability.

**Price legibility:** `/pricing` (`src/app/pricing/page.tsx:15-20`) shows Pro/Team as `"Prepaid"` / "credits — 1 per private scan" with **no subscription dollar amount**; Enterprise is "Custom — contact us." Only Free's $0 is a real number. Sasha cannot put a Pro/Team line item in a build-vs-buy ledger from the app.

---

## Findings

```json
[
  {
    "id": "sasha-portability-no-fleet-export",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sasha-megacorp-buildvsbuy",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "No bulk export of the org-level scores / movers / trajectory — the recurring-value payload itself isn't portable",
    "expected": "A buyer who wants her own warehouse can bulk-export every fleet maturity score, dimension, mover, and trajectory point (CSV/JSON, ideally a stable API/key) so buying doesn't mean renting her own numbers back.",
    "got": "Export exists only for contributors and delivery/governance tables (/api/org/export) and per-repo scan history (/api/history?format=csv). The fleet-level scores, movers, and the trajectory/forecast — the actual recurring read — have no bulk export and no ?org= history endpoint. Every export is session-gated; there is no API key for a programmatic warehouse pull.",
    "evidence": [
      "src/app/api/org/export/route.ts:40",
      "src/app/api/history/route.ts:58",
      "src/lib/db/org-insights.ts:70"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Attempt a full data-out: can you reconstruct the fleet maturity scores + trajectory in an external warehouse from only the documented exports? Confirm there is no fleet-scores/movers export and no API key path.",
    "suggested_acceptance": "An org-scoped export endpoint returns every repo's latest scores+dimensions+movers+trajectory points as CSV/JSON, and an API token allows an unattended nightly pull."
  },
  {
    "id": "sasha-movers-no-noise-annotation",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sasha-megacorp-buildvsbuy",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Per-repo movers show raw deltas with no 'is this real vs guardband noise' signal — only the headline trajectory is defended",
    "expected": "When a repo appears as a +N gainer cycle-over-cycle, the read flags whether that move is real signal or LLM wobble within the ±25 guardband on an unchanged repo — at the point the mover is shown.",
    "got": "buildMove computes raw dOverall = now − prev with no R²/flat-floor/guardband annotation. The trajectory headline surfaces 'trend confidence N% · noisy' (Trajectory.tsx), but the mover/period list does not — so a re-scan wobble of an unchanged repo can render as a real gainer/regresser with no caveat.",
    "evidence": [
      "src/lib/db/org-insights.ts:47",
      "src/lib/scoring/engine.ts:99",
      "src/components/org/Trajectory.tsx:96"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Re-scan an unchanged repo twice under claude-cli; does it appear in the movers list with a non-zero dOverall, and is that move flagged as within-guardband noise anywhere on the surface?",
    "suggested_acceptance": "A mover whose delta is within the guardband / below a per-repo noise floor is visually tagged 'within noise' or suppressed, so a cycle's mover list is real signal."
  },
  {
    "id": "sasha-price-undecidable-paid-tiers",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sasha-megacorp-buildvsbuy",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "No subscription $ for the tier she'd actually buy — a build-vs-buy ledger needs a number, and Pro/Team show only 'Prepaid'",
    "expected": "An actual numeric price for Pro/Team so the recurring buy can be set against the squad-quarter build cost in a ledger.",
    "got": "/pricing renders Pro/Team as 'Prepaid — credits, 1 per private scan' with no dollar amount; Enterprise is 'Custom — contact us'. Only Free ($0) is numeric. The real subscription price lives in Polar, not the app.",
    "evidence": [
      "src/app/pricing/page.tsx:15",
      "src/lib/plans.ts:5"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "From /pricing and the dashboard credit controls, can a numeric per-cycle cost for a P-repo fleet at Pro be derived without contacting sales?",
    "suggested_acceptance": "/pricing shows a per-credit and/or per-seat dollar figure for Pro/Team, or a 'P repos × C cycles = $X/mo' estimator, so the tier is decidable in-app."
  },
  {
    "id": "sasha-scoring-is-commodity",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sasha-megacorp-buildvsbuy",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "The headline scoring (weighted mean + ±25 guardband + 60/40 blend + OLS slope) is reproducible in-house — the moat rests almost entirely on the corpus",
    "expected": "The recurring scoring/forecast is non-trivial enough that a staff DevEx engineer couldn't reproduce its core in a sprint, justifying recurring spend over build.",
    "got": "overallScoreFor is a renormalized weighted mean; the blend is two constants (SCORE_BLEND 0.6, LLM_GUARDBAND 25); the forecast is OLS + R² + a 0.5/wk flat-floor. All reproducible in a squad-quarter. The genuinely non-reproducible asset is the cross-org corpus percentile (getOrgBenchmark) and the calibration backlog — narrow, but real.",
    "evidence": [
      "src/lib/maturity/model.ts:16",
      "src/lib/scoring/engine.ts:102",
      "src/lib/maturity/forecast.ts:82",
      "src/lib/db/org-insights.ts:556"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm the corpus benchmark renders with real cross-org data (not an empty/1-org corpus that nulls the percentile) — it's the load-bearing reason to buy vs build."
  },
  {
    "id": "sasha-strength-corpus-and-confidence",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sasha-megacorp-buildvsbuy",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH: the cross-org corpus percentile + an honest trajectory confidence are the two things she can't trivially build",
    "expected": "At least one recurring asset is structurally non-reproducible and the forecast is honest about its own reliability.",
    "got": "getOrgBenchmark ranks the org against every other repo Ascent has scored, with a same-language peer cohort and statistical-floor gates (CORPUS_MIN/COHORT_MIN) so a tiny corpus doesn't lie — Sasha cannot assemble this from her own org. The trajectory surfaces R² as 'trend confidence' with a '· noisy' tag below 50% and a flat-floor, so the GPS is more than a bare slope.",
    "evidence": [
      "src/lib/db/org-insights.ts:549",
      "src/lib/db/org-insights.ts:606",
      "src/components/org/Trajectory.tsx:96",
      "src/lib/maturity/forecast.ts:64"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Verify the corpus is populated enough (≥5 repos / ≥5 same-language peers) that the percentile renders rather than nulling out — an empty corpus removes the single best buy argument."
  }
]
```

---

## Character feedback (Sasha, first person)

Would I renew? Honestly — I'd **downgrade**, not churn. Let me decompose it, because that's my job.

The dashboard is clean, but I keep asking the same question: *what here can't my squad build?* The 9-dimension taxonomy is a genuine point of view — I'll grant it; naming "AI Process & Harness" and "Agentic Workflows" as distinct from CI/CD is opinionated and useful. But the *math* is a weighted mean over Git signals with two tuning constants — guardband ±25, 60/40 blend — and an OLS slope with an R². That's a sprint, maybe two. I've built this category twice; I'd own it and own the data.

Is each cycle telling me something new? The trajectory is the best part — it actually shows me **trend confidence** and tags itself "noisy" under 50%, which is more honesty than most vendors give me, and it won't even render without real history, so I know repetition is doing work. But the **movers list lies by omission**: it shows me "+3 on this repo" with no flag that +3 on an unchanged repo is just the LLM breathing inside its own guardband. The one place I most need "is this real," the per-repo mover, is exactly where the confidence read is missing. That's a trust hole on the recurring read.

Do I trust a move is real? On the headline, yes. On the repo I'd actually action, no — and that's the one that matters.

Does the cost pencil at my size? I **can't even see it.** Pro and Team say "Prepaid — credits," no dollar figure. I cannot put "Prepaid" into a build-vs-buy ledger against a squad-quarter. The one number I can compute is credits = P repos × C cycles, but the subscription price that gates it is invisible until I talk to sales — and "if I have to ask, I assume I can't put it in the model."

The thing that keeps me from churning outright: the **cross-org corpus**. Ranking my fleet against every other org Ascent has scored, with a same-language peer cohort and a real statistical floor so a tiny corpus doesn't lie to me — *that* I genuinely cannot build. I have my own org and nothing else. If that corpus is actually populated, it's the one line in the buy column I can defend to my CFO. Everything else, I'd own.

What's missing for MY recurring job: **bulk export of the fleet scores + trajectory, and an API key.** Right now I can export contributors and governance and per-repo history, but not the fleet maturity payload itself, and everything is session-gated — so to feed my warehouse nightly I'd have to script an authenticated browser. That's renting my own data back. For a 10k-engineer shop, that's the line item that flips buy→build faster than any pricing number.

Would I tell a peer? "Buy the smallest tier for the corpus benchmark and the honesty of the forecast; do NOT pay up for the dashboard — you'll reproduce that and keep your data. And budget for the day they add a real export, because until then you're locked to their UI."

---

## Grounding score + time-saved + verdict

**Grounding score: 4 / 6** recurring-context sources reach the read for Sasha's build-vs-buy job:
1. Trajectory needs real history (≥2 distinct days) → renders, repetition required — **reaches** (`forecast.ts:87`).
2. Move-is-real defense (R²/flat-floor) surfaced where move is shown → **partial: reaches the trajectory headline, NOT the movers list** (`Trajectory.tsx:96` vs `org-insights.ts:47`) — counted as a miss for her job.
3. Movers/period deltas compute vs previous scan with provenance → **reaches** (`org-insights.ts:47`, half-open baseline).
4. Tier-gated retention window (180d at Pro) is honored by the trajectory → **reaches** (`plans.ts:42`).
5. Cross-org corpus / non-reproducible asset → **reaches** (`org-insights.ts:556`, `OrgStanding.tsx`).
6. Data portability of the *recurring-value payload* (fleet scores/movers/trajectory) → **miss** (only contributors/delivery/per-repo history export; no fleet/API export).

**Per-cycle time-saved (number): ~3–4 hours/cycle** of analyst time — the consolidated fleet read + trajectory + movers replaces re-pulling Git signals, re-scoring the 9-dim rubric, and re-fitting a fleet trend in her warehouse each cycle. (Her *strategic* saving is the avoided ~1 squad-quarter build, but that only pays off on the non-reproducible core — the corpus — not the dashboard, so it doesn't count as a clean recurring saving.)

**PRICING verdict: downgrade (Team → Pro).** One-line reason: the only thing she can't build is the cross-org corpus benchmark (+ the honest forecast), and that renders at the smallest paid tier — she will not pay Team/Enterprise for a dashboard she'd reproduce in a squad-quarter and own the data for, especially with no bulk export and no visible price.

---

## l2_priority carry-forward

1. **Re-scan an unchanged repo twice under `claude-cli`** — does it surface in the movers list with a non-zero `dOverall`, and is that within-guardband wobble flagged as noise anywhere the mover is shown? (Confirms `sasha-movers-no-noise-annotation`.)
2. **Attempt a full data-out** — can the fleet maturity scores + trajectory be reconstructed in an external warehouse from only the documented exports, with no API key? (Confirms `sasha-portability-no-fleet-export`.)
3. **Confirm the corpus benchmark renders with real cross-org data** (≥5 repos / ≥5 same-language peers, not a nulled percentile) — it's the single load-bearing reason to buy vs build. (Confirms `sasha-strength-corpus-and-confidence`.)
4. **Derive a numeric per-cycle cost at Pro** from `/pricing` + the credit controls without contacting sales. (Confirms `sasha-price-undecidable-paid-tiers`.)
