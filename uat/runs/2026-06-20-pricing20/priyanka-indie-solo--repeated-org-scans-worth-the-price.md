# L1 — Priyanka (indie solo) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional · PRICING: downgrade (stay Free; would not convert).** The recurring read for N=1 *does* exist and is honest about its own confidence (the R²/flat-floor is a genuine strength), but two majors block the upgrade: Free's advertised "30-day history" retention is **never enforced in code** (a phantom tier boundary), and the only tier that would help her (Pro) shows **no dollar price at all** — so she literally cannot do the cost↔value math the journey asks for. At N=1 the value also lives on `/trends` (per-repo), not the team-shaped `/org` fleet dashboard she'd never use.

## Reachable surface set (tier-honest)

Priyanka is **Free**, one person, one private repo + a couple public repos. Under the journey's bypass she *could* render `/org/*`, but her plan wouldn't include it, so I judge the surfaces her tier actually buys:

- **REACHABLE & owned (Free):**
  - `/report?repo=…` — single public-repo scan (free, unmetered) — `src/lib/entitlement.ts:15-17` (public scans never metered).
  - `/trends?repo=owner/repo` — her real N=1 recurring read: the **same `Trajectory`** the fleet uses, fit over one repo's history — `src/app/trends/page.tsx:115-165`. Gated on session only, **not** plan — Free reaches it.
  - `/api/history?repo=…&format=csv` — CSV export of her scan history — `src/app/api/history/route.ts:104-113`.
  - `/pricing` — the plan grid — `src/app/pricing/page.tsx:30-90`.
- **UNREACHABLE by tier (the upsell, folded into the price verdict, NOT free):**
  - `/org/[slug]` fleet dashboard, `PeriodSummary`, movers, posture — "Org fleet dashboard" is a **Pro** feature (`src/lib/plans.ts:43`). Team-shaped; for N=1 the "fleet trend" is just her one repo's line anyway.
  - Scheduled autoscans + alerts + digest — **Pro+** (`src/lib/plans.ts:43`). Free has no cadence automation: her "cadence" is her remembering to click scan.
  - >30-day trajectory lookback — *advertised* as a Free cap (`plans.ts:31`), but see grounding finding GA-1: not enforced.

## Surface-model notes (recurring-value affordances → file:line; grounding audit)

The N=1 recurring machinery, walked:

- **Trajectory at N=1 renders, and is honest.** `/trends` fits `forecastTrajectory` over her *single* repo's history — `src/app/trends/page.tsx:115-117`. Needs **≥2 distinct calendar days** or returns null — `src/lib/maturity/forecast.ts:87,100`. With one scan, the page shows "Only a baseline scan so far" — `trends/page.tsx:155-159` — and renders no trajectory. So cycle 1 gives her nothing forward-looking (correct, but it's a slow start for a monthly cadence). **Strength:** the fit surfaces R² as "trend confidence NN%" and appends "· noisy" under 50% — `src/components/org/Trajectory.tsx:93-97` — and the `FLAT_PER_WEEK=0.5` floor calls a sub-0.5/wk drift "holding · no level change" rather than inventing a slope — `forecast.ts:64,131`, `Trajectory.tsx:88-90`. This is exactly the honesty her senior bar demands at low N.
- **The flat-floor is the noise defense, and it IS surfaced where the move is shown.** Re-scanning her unchanged repo under `claude-cli` can wobble within the LLM's ±25 guardband; the forecast's flat read + confidence% is the only thing telling her "this is the model breathing." It is co-located with the move in `Trajectory.tsx`. **Gap:** the per-dimension trend rows (`DimensionTrends`) and the raw score deltas do **not** carry the same confidence chrome — only the headline trajectory does. A dimension that "moved" 3 points cycle-over-cycle shows the move without a noise caveat.
- **`retentionDays` is dead metadata (the sharpest grounding defect).** `plans.ts` declares Free `retentionDays: 30` (`plans.ts:31`) and `/pricing`/feature lists advertise "30-day history". But a repo-wide grep shows **no query reads `retentionDays`** — not the org trend (`src/lib/db/org-rollup.ts:220-227`, no date floor from plan), not the per-repo history (`src/lib/db/scans-read.ts:138`, clamps `limit` to 1–200 but applies no retention cutoff), not `/api/history`. So either she sees *all* her history regardless of tier (the cap is phantom and the pricing claim is false), or the cap is meant to bite and silently doesn't. For the journey's core question — "how far back can my trajectory even look at my tier" — the code's answer is "the limit you were sold doesn't exist." That's a trust hit on the exact axis she's judging.
- **Movers/period are unreachable for her AND restate-prone.** `PeriodSummary` lives on `/org` (Pro), and its no-change branch literally renders "Fleet maturity held at {n}" — `src/components/org/PeriodSummary.tsx:35` — i.e. restates the number. For a stable, mature, single repo (her likely steady state), even if she paid for the org view, the recurring summary flatlines into "nothing new" — the journey's stated low-velocity failure mode.
- **Price legibility fails for her decision tier.** `/pricing` shows Free = "$0" honestly, but Pro/Team show only `"Prepaid"` / "credits — 1 per private scan" with **no subscription dollar amount** — `src/app/pricing/page.tsx:15-20`. The real price lives in Polar, not the app (`plans.ts:3-5`). She cannot see what Pro costs, so the cost↔value math the journey demands is undecidable from inside the product.

## Findings

```json
[
  {
    "id": "PRIY-L1-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "priyanka-indie-solo",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Advertised Free '30-day history' retention is never enforced in code — phantom tier boundary",
    "expected": "The retention cap she's sold (Free=30 days, plans.ts:31) actually bounds how far her trajectory/history can look back, so the tier boundary is real and the trajectory's lookback is predictable.",
    "got": "retentionDays is declared in plans.ts and shown on /pricing but read by NO query: org trend (org-rollup.ts:220-227) and per-repo history (scans-read.ts:138) apply only a row-count limit, no plan-derived date floor. The cap is phantom — she either silently gets unlimited lookback (claim is false) or the boundary she's judging doesn't exist.",
    "evidence": [
      "src/lib/plans.ts:31",
      "src/app/pricing/page.tsx:43-66",
      "src/lib/db/org-rollup.ts:220-227",
      "src/lib/db/scans-read.ts:138",
      "src/app/api/history/route.ts:96-99"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "On Free, scan a repo with history older than 30 days; confirm whether /trends actually clips the trajectory at 30 days or shows it all — and whether /pricing's '30-day history' is therefore false.",
    "suggested_acceptance": "Either enforce retentionDays as a date floor in the history/trend queries, or remove the per-tier 'N-day history' claims from /pricing so the boundary is honest."
  },
  {
    "id": "PRIY-L1-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "priyanka-indie-solo",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "No dollar price for Pro — the only tier that would help her is undecidable from inside the product",
    "expected": "Before deciding renew/upgrade she can see an actual number for what Pro costs.",
    "got": "/pricing shows Pro/Team as 'Prepaid — credits, 1 per private scan' with no subscription $; the real price lives in Polar, not the app. She cannot do the cost↔value math the journey requires, and opaque credits are her stated instant turn-off.",
    "evidence": [
      "src/app/pricing/page.tsx:15-20",
      "src/lib/plans.ts:3-5"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "From /pricing as a Free user, confirm no dollar figure for Pro is reachable without leaving the app / a 'contact us' detour.",
    "suggested_acceptance": "Surface at least a credit-pack dollar price (or a 'from $X/mo') on /pricing so a Free user can decide without a sales detour."
  },
  {
    "id": "PRIY-L1-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "priyanka-indie-solo",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Per-dimension trend moves shown without the noise/confidence caveat the headline trajectory carries",
    "expected": "Every score move she sees on the recurring read carries a signal-vs-noise cue, so a 3-point dimension wiggle isn't read as real drift.",
    "got": "Only the headline Trajectory surfaces R² 'trend confidence' + the flat-floor (Trajectory.tsx:93-97). The per-dimension trend rows and raw deltas show moves with no confidence chrome, so a guardband wobble on an unchanged dimension reads as a change.",
    "evidence": [
      "src/components/org/Trajectory.tsx:93-97",
      "src/lib/maturity/forecast.ts:64,131",
      "src/app/trends/page.tsx:167-169"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Re-scan an unchanged repo twice under claude-cli; observe whether per-dimension trend rows move within the guardband and whether anything flags that as noise.",
    "suggested_acceptance": "Carry a per-dimension confidence/flat indicator (or suppress sub-threshold dimension deltas) on the trends rows, not just the headline."
  },
  {
    "id": "PRIY-L1-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "priyanka-indie-solo",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "Recurring period summary restates the number on a stable repo instead of saying what changed",
    "expected": "On a low-velocity (mature, stable) repo, the cycle either surfaces a genuine non-obvious mover or honestly says 'nothing actionable changed' — not a re-render of the current score.",
    "got": "PeriodSummary's no-change branch renders 'Fleet maturity held at {n}.' (PeriodSummary.tsx:35) — a restatement. For her steady-state single repo (even if she upgraded to reach /org), repetition flatlines into 'nothing new', the journey's stated low-velocity failure mode.",
    "evidence": [
      "src/components/org/PeriodSummary.tsx:25-41",
      "src/app/org/[slug]/page.tsx:183"
    ],
    "code_check": "by-design",
    "verdict": "uncertain",
    "l2_priority": "On a stable repo with no real movement across 2 cycles, confirm the recurring summary/digest says something new vs. restating the held number.",
    "suggested_acceptance": "When deltas are within the noise floor, say 'no actionable change this cycle' rather than restating the score, so 'nothing new' is explicit not implied."
  },
  {
    "id": "PRIY-L1-05",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "priyanka-indie-solo",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "STRENGTH — trajectory is honest at low N: R² confidence + flat-floor surfaced where the move is shown",
    "expected": "A 2–3-point OLS fit must not over-claim a confident trajectory at N=1.",
    "got": "forecastTrajectory returns null below 2 distinct days (forecast.ts:87,100); the flat-floor (FLAT_PER_WEEK=0.5) calls sub-threshold drift 'holding' not a slope (forecast.ts:64,131); R² renders as 'trend confidence NN% · noisy' next to the move (Trajectory.tsx:93-97). This meets her statistical-honesty senior bar — the read admits its own uncertainty.",
    "evidence": [
      "src/lib/maturity/forecast.ts:64,87,100,131",
      "src/components/org/Trajectory.tsx:88-97",
      "src/app/trends/page.tsx:155-165"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm 'trend confidence' renders honestly low (<50% · noisy) on a 2-point N=1 fit, not a falsely confident ETA."
  }
]
```

## Character feedback (first person — Priyanka)

Okay, so I pointed it at my repo and scanned it a couple of times, a few weeks apart. First scan: "only a baseline so far" — fine, nothing to show yet, I get it. Second scan is where it has to earn its keep, because I *wrote this thing*, I know where the bodies are buried.

Credit where it's due: the trajectory chart didn't lie to me. It said "holding around 62, no level change," trend confidence in the 40s, "noisy" right there on the label. That's the one thing that made me not roll my eyes — most tools would've drawn me a confident little arrow off two dots and called it insight. This one admitted it only has two dots. As a one-person shop staring at my own code, that honesty is the *only* thing that'd make me trust a move when it does happen.

But would each cycle tell me something new? Mostly no. The headline just confirms the number I already carry in my head. The per-dimension rows show little wiggles with no "is this real?" tag, so I can't tell if my Docs dimension actually slid or the model just breathed differently this run — and chasing model noise is exactly what I don't have time for. The fleet "period summary" thing isn't even mine — that's a team dashboard, and for one repo it'd just say "held at 62," which is not a sentence I'd pay for.

And here's the part that ends the conversation: I went to see what Pro costs, because maybe the recurring stuff is better up there. **There's no price.** "Prepaid — credits, 1 per private scan." That's not a price, that's a riddle. Every dollar here is mine; if you won't show me the number I assume I can't afford the conversation, and I close the tab. Worse, the Free tier I'm on advertises "30-day history" — but as far as I can tell the product doesn't actually do anything with that limit, so I don't even know what boundary I'm living inside.

Does the cost pencil out? At my size the recurring read saves me maybe ten minutes a month versus just skimming my own CI and test dirs — that's nothing. The only thing worth money would be catching a blind spot, and this cycle didn't catch one. Would I tell a peer? I'd say "the free public scan is a decent honest mirror, the trajectory doesn't bullshit you — but don't expect the monthly re-scan to reveal much about a repo you already know, and good luck finding the Pro price." I'm staying Free. I'm not converting.

## Scorecard

- **Grounding score: 3 / 5** recurring-context sources reach the N=1 read.
  - ✅ Trajectory exists at N=1 (`forecast.ts` over single-repo history, `trends/page.tsx:115`).
  - ✅ Noise defense surfaced on the headline (R²/flat-floor, `Trajectory.tsx:93-97`).
  - ✅ Per-repo history/CSV reaches the read (`scans-read.ts`, `/api/history`).
  - ❌ Retention window is **not** wired — advertised 30-day cap reads nothing (`retentionDays` dead, GA finding PRIY-L1-01).
  - ❌ Movers/period provenance is **Pro-gated AND restate-prone** for her — unreachable at her tier and flatlines at N=1 (PRIY-L1-04).
- **Per-cycle time-saved: ≈10 minutes** (she is the whole team and already knows her repo; the read only beats memory if it catches a blind spot — this cycle didn't).
- **Renew/downgrade/churn/upgrade: DOWNGRADE → stay Free, would not convert.** One-line reason: the N=1 recurring read is honest but rarely non-obvious, the Pro price is invisible, and the Free retention boundary she's judging against isn't even real.

## l2_priority carry-forward

1. **(top)** On Free, scan a repo whose history predates 30 days and confirm whether `/trends` actually clips the trajectory lookback at 30 days — i.e. is `retentionDays` enforced at all, and is the `/pricing` "30-day history" claim true? (PRIY-L1-01)
2. Re-scan an unchanged repo twice under `claude-cli`: does the overall score (and each per-dimension row) move within the ±25 guardband, and is that wobble flagged as noise anywhere outside the headline trajectory? (PRIY-L1-03)
3. From `/pricing` as a Free user, confirm no dollar figure for Pro is reachable without a sales detour. (PRIY-L1-02)
4. On a stable repo across 2 cycles, confirm whether the recurring summary/digest ever says something new vs. restating the held number. (PRIY-L1-04)
