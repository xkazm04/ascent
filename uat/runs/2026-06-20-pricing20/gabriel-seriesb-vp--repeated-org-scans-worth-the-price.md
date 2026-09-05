# L1 — Gabriel (Series-B VP Engineering) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the recurring board read is structurally sound and definition-stable, but Gabriel's owned facet (tier-ceiling / forced-upgrade economics) has a **major price-legibility gap**: at his cadence he cannot model the bill or see the tier wall before he hits the 402, and the "Custom — contact us" step-up is value-blind at the exact moment he must decide. Completes; not clean.

---

## Reachable surface set (tier-honest, Gabriel on **Team**)

Under `ASCENT_AUTH_BYPASS=1` on a populated `/org/<slug>` he renders as synthetic owner, so the routes all paint. Judged at **Team** entitlements:

- **Reachable + in-tier:** `/org/[slug]` overview incl. **Trajectory** (`src/components/org/Trajectory.tsx`) + movers/period; `/org/[slug]/executive` board briefing + PDF + Copy-for-LLM; `/trends`; `/usage` (credit burn, reconciliation, runway); `/pricing`; CreditsControl chip; segments/comparisons + playbooks/planning (Team-tier features); scheduled autoscans + alerts + digest (Pro+, so Team has them).
- **Reachable by bypass but OUT of his tier (the upsell, folded into the price verdict):** unlimited scans, branding/white-label (`canBrand` is `credit?.unlimited` only — `executive/page.tsx:46`), custom retention. These are exactly the Enterprise step he's being pushed toward.
- **His structural wall:** Team includes **500** private scans/mo (`plans.ts:38`). His cadence is ~60 private repos × ~20 working days = **~1200/mo**. He is **2.4× over** Team's allotment — there is no in-tier configuration that supports his desired cadence. The next stop is Enterprise = "Custom — contact us" (`pricing/page.tsx:19`).

## Surface-model notes (recurring-value affordances → file:line)

- **Trajectory needs repetition to exist, and surfaces its own trust signal — on the OVERVIEW.** `forecastTrajectory` returns null below 2 distinct calendar days (`src/lib/maturity/forecast.ts:87,100`); `FLAT_PER_WEEK=0.5` noise floor (`forecast.ts:64,131`); R² as "trend confidence N% · noisy" when <50% (`src/components/org/Trajectory.tsx:96`). **Good machinery, well-fed by his daily cadence.**
- **But the board surface drops the confidence signal.** `executive/page.tsx:97-110` renders only `briefing.forecastHeadline` text — the R²/`fitQuality` that `Trajectory.tsx:96` shows is **not** rendered on the briefing he actually puts in front of the board. So the one surface where "is this move real" matters most omits the defense.
- **Definition stability (his consistency check) holds.** Overall/adoption/rigor come from the same deterministic blend each run — `LLM_GUARDBAND` ±25, `SCORE_BLEND` 60/40 (`src/lib/scoring/engine.ts:27-34`), coverage-weighted toward the deterministic floor at low coverage (`engine.ts:60-70`). Same computation quarter-over-quarter → board slides are comparable. **Strength.**
- **Period deltas / movers compute against the prior window with provenance** — `executive/page.tsx:112-152` (vs-previous-period, per-dimension prior→now deltas) + Movement-this-period (`:196-208`). This is the "what changed since the board last saw it" he needs.
- **Credit burn IS metered and visible — but only as depletion, never as ceiling.** `/usage` shows billable/day, runway "≈Nd at current burn" (`src/app/usage/page.tsx:163-164,222-228`) and a low-balance warning. **But `lowBalance` and the CreditsControl `low` flag are both purely balance-driven** (`usage/page.tsx:166`, `CreditsControl.tsx:108` = `balance <= 0`). Nothing compares burn against the **tier's monthly allotment** (`includedCredits`), so he learns about the 500-cap by running out, not in advance.
- **`includedCredits` / `retentionDays` are display-only metadata.** Grep confirms `includedCredits` is referenced ONLY on `/pricing` (`pricing/page.tsx:63,65`) and `retentionDays` ONLY on `/pricing` — neither binds to enforcement. The actual gate is balance-driven (`src/lib/entitlement.ts:26-33`, 402 at `entitlement.ts:36`), and actual retention is governed by `Organization.retentionMaxScans` / env defaults (`src/lib/db/retention.ts:72-76`), **not** the per-tier `retentionDays`. So "365-day history" on the pricing card is a marketing claim not wired to how far his trajectory can actually look back.
- **Price invisibility at the decision point.** `/pricing` shows Pro/Team as `"Prepaid — credits, 1 per private scan"` with no subscription $, Enterprise as `"Custom — contact us"` (`pricing/page.tsx:15-20`). The "Get started"/"Contact us" CTAs both route to `/connect` (`pricing/page.tsx:76`). At the moment his cadence forces the step-up, the only signal is a contact wall with no anchor and no calculator.

## Findings

```json
[
  {
    "id": "GAB-L1-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "No burn-vs-allotment ceiling signal — he learns about Team's 500 cap by hitting the 402, not before",
    "expected": "At ~1200 scans/mo on a daily-fleet cadence, the dashboard tells me I'm on pace to exceed Team's 500/mo allotment and names the next tier — BEFORE the paywall, so I can model the step-up and brief finance.",
    "got": "Credit warnings are depletion-only: `lowBalance` and the CreditsControl `low` flag both trigger on `balance <= 0`, never on 'your run-rate exceeds your tier'. `includedCredits` (500) is never compared against observed burn anywhere outside the static /pricing card.",
    "evidence": ["src/app/usage/page.tsx:163", "src/app/usage/page.tsx:166", "src/components/org/CreditsControl.tsx:108", "src/lib/plans.ts:48", "src/lib/entitlement.ts:36"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Seed an org burning >500 metered scans in a window and confirm NO surface (usage chip, credits popover, dashboard) warns about the tier ceiling before the balance depletes — only the 402/low-balance fires.",
    "suggested_acceptance": "When period billable scans project to exceed the plan's includedCredits, /usage and the credits chip surface 'on pace to exceed your <tier> allotment (N/included) — see plans' before depletion."
  },
  {
    "id": "GAB-L1-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "Enterprise step-up is a value-blind 'Custom — contact us' at the exact moment of decision",
    "expected": "When my cadence forces me off Team, I can see roughly what unlimited costs / model 1200 scans-mo, and the value of the step-up is self-evident so the sales call is a formality.",
    "got": "Pro/Team show only 'Prepaid — credits, 1 per private scan' (no subscription $), Enterprise is 'Custom — contact us'; both CTAs route to /connect. No price anchor, no cadence calculator, no burn-based 'you'd need Enterprise' nudge. A usage-priced tool gives the buyer nothing to model the bill with at the decision point.",
    "evidence": ["src/app/pricing/page.tsx:15", "src/app/pricing/page.tsx:19", "src/app/pricing/page.tsx:76"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "From a Team org over the cap, confirm the only path forward is the /connect contact wall with no in-product cost model or step-up justification."
  },
  {
    "id": "GAB-L1-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The board briefing drops the trajectory's confidence signal — he could present model-noise as a trend",
    "expected": "On the surface I put in front of the board, a flat/noisy trend is flagged so I don't present the model breathing within its guardband as real movement.",
    "got": "The overview Trajectory shows 'trend confidence N% · noisy' (R²) where the move is shown, but the Executive briefing renders only `forecastHeadline` text — no fitQuality/R², no noisy flag. The board-facing artifact omits the exact 'is this move real' defense that the LLM-guardband (±25, 60/40 blend) makes necessary.",
    "evidence": ["src/app/org/[slug]/executive/page.tsx:97", "src/app/org/[slug]/executive/page.tsx:100", "src/components/org/Trajectory.tsx:96", "src/lib/scoring/engine.ts:27"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Re-scan an unchanged repo twice under claude-cli; confirm a within-guardband wobble can move the briefing headline/trajectory with NO confidence/noise flag on the executive surface."
  },
  {
    "id": "GAB-L1-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Advertised tier retention ('365-day history') isn't what governs the trajectory window",
    "expected": "The retention I'm paying Team for is how far back my trajectory can actually look.",
    "got": "`retentionDays` (365 for Team) is referenced ONLY on /pricing; actual purge is governed by `Organization.retentionMaxScans` / env defaults, decoupled from the tier. So the pricing claim doesn't bind to how much history feeds my board trajectory.",
    "evidence": ["src/lib/plans.ts:51", "src/lib/db/retention.ts:72", "src/app/pricing/page.tsx:65"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "l2_priority": "Confirm whether a Team org's effective scan-history window matches the advertised 365 days or the env/per-org retention default."
  },
  {
    "id": "GAB-L1-05",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "STRENGTH — definition-stable quarterly number + delta-with-provenance make the board read defensible",
    "expected": "The same maturity computation every quarter, with what-moved-since-last-period, so my board slide is comparable and current.",
    "got": "Overall/adoption/rigor use the same deterministic guardbanded blend each run (LLM_GUARDBAND ±25, SCORE_BLEND 60/40, coverage-weighted to the deterministic floor); the briefing carries vs-previous-period deltas per dimension + movement-this-period with provenance. This directly replaces his ~1-week manual deck with a re-pullable, comparable read.",
    "evidence": ["src/lib/scoring/engine.ts:27", "src/lib/scoring/engine.ts:60", "src/app/org/[slug]/executive/page.tsx:112", "src/app/org/[slug]/executive/page.tsx:196"],
    "code_check": "by-design",
    "verdict": "confirmed"
  },
  {
    "id": "GAB-L1-06",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "effort",
    "title": "STRENGTH — /usage already meters burn + runway, so the ceiling signal is one derivation away",
    "expected": "I can see my run-rate and how long my credits last.",
    "got": "/usage shows per-day billable burn, runway '≈Nd at current burn', reconciliation vs the ledger, and top repos by metered scans — the raw material for a tier-ceiling projection is already computed; it just isn't compared to includedCredits (see GAB-L1-01).",
    "evidence": ["src/app/usage/page.tsx:163", "src/app/usage/page.tsx:222", "src/lib/db/usage.ts:160"],
    "code_check": "by-design",
    "verdict": "confirmed"
  }
]
```

## Character feedback (Gabriel, first person)

Would I renew? On the *read*, yes — and that surprised me. The executive briefing is the same number every quarter computed the same way, it tells me what moved since the board last saw it, and it's re-pullable on demand instead of stale the day my staff ships the deck. That's most of an engineer-week back per quarter and a board slide I can actually defend. The trajectory even tells me when it's noisy — "trend confidence 38% · noisy" — which is exactly the honesty I need. *Except* it tells me that on the overview, not on the briefing I put in front of the board. On the board page it's just a confident sentence. I'm not putting a model's guardband wobble up as "we're trending to L4" — so I have to go cross-check it on another screen. Fix that and the read is clean.

Is each cycle telling me something new? Yes, as long as my repos are actually moving — daily cadence keeps it live. Do I trust a move is real? On the overview, yes; on the board surface, not without leaving it.

Does the cost pencil out at my size — and can I even see the price? This is where it falls down for me, and it's *my* whole question. Sixty repos, daily, is twelve hundred scans a month. Team includes five hundred. So I am 2.4× over the line and there's no version of Team that fits my cadence — I'm forced to Enterprise. Fine, that's a real boundary. But the product never *tells* me that. The credits chip is green until I'm out, then it's "out of credits, paused." Nothing on /usage says "you're burning past your Team allotment — you need the next tier." I find the ceiling by slamming into it. And when I go to step up, the only thing waiting is "Custom — contact us." No anchor, no calculator, nothing to model twelve-hundred-scans-a-month against. I have to walk into my CFO and say "I don't know what it costs, I have to get on a call" — that's the sentence I started this evaluation trying to avoid. A usage-priced tool that won't let me predict the bill at my own cadence hasn't met a finance review.

What's missing for MY recurring job: a burn-vs-allotment ceiling warning *before* the wall, and a cadence cost model at the step-up. Would I tell a peer? "Great board read, definition-stable, saves you the deck — but go in knowing that if you scan a real fleet daily you'll blow past Team and hit a contact-us wall with no way to model the cost. Budget the surprise."

## Scores

- **Grounding score: 4 / 5** recurring-context sources reach the read. (1) Trajectory — real history required, R²/flat-floor surfaced ✔ *on overview*. (2) Score-move real-vs-noise — confidence surfaced on overview ✔ but **absent on the board briefing** ✗ (the one that counts for him → docked). (3) Movers/period deltas with provenance ✔. (4) Recurring depth gated by tier ✔ (entitlement/credits). (5) Burn-vs-allotment ceiling signal — **absent** (his facet). Counting the sources that actually reach *his* board decision: trajectory, movers/deltas, tier-gating, and definition-stability all land; the noise-flag-on-the-board and the ceiling-signal do not. **4/5.**
- **Per-cycle time-saved (number): ~24–32 engineer-hours per quarter** (replacing a ~1-engineer-week, ~32–40 hr manual maturity deck; he keeps ~1 hr to frame it). ≈ a full engineer-month/year, *and* the read is current vs. quarter-stale — contingent on him trusting the briefing enough to present it as-is (GAB-L1-03 gates that trust).
- **Renew / downgrade / churn / upgrade verdict: UPGRADE (forced, reluctant).** His cadence makes Team structurally impossible (1200 > 500), so the mechanical answer is upgrade to Enterprise — but the *manner* is the risk: a value-blind "contact us" with no cost model at the decision point is exactly where a numbers-first VP stalls or shops a competitor that lets him self-model. The read earns the renew; the pricing legibility threatens to convert a forced upgrade into a churn.

## l2_priority carry-forward
1. **(GAB-L1-01)** Seed an org over 500 metered scans in a window — confirm no surface warns about the tier ceiling before depletion; only 402/low-balance fires.
2. **(GAB-L1-03)** Re-scan an unchanged repo twice under `claude-cli` — confirm a within-guardband wobble can move the **executive briefing** headline with no confidence/noise flag on that surface.
3. **(GAB-L1-02)** From a Team org over cap, confirm the only forward path is the `/connect` contact wall with no in-product cost model / step-up justification.
4. **(GAB-L1-04)** Confirm a Team org's effective history window matches the advertised 365d or the env/per-org retention default (does the trajectory look back as far as the tier promises?).
