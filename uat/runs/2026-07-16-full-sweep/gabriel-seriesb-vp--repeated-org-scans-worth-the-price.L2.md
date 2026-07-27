# L2 — Gabriel (Series-B VP Engineering) × repeated-org-scans-worth-the-price

**Cert level: L2-fail** (severity-driven — see finding 1). Reasoned against the shared live evidence in `_L2-shared-pricing-evidence.md` (2026-07-16 claude-cli run on `vercel`), not re-driven.

---

## Character reaction (first person)

I need to walk back part of what I said last cycle.

The good news held up under a real scan. My cost story is genuinely better: Team is now a public $20/month, not a shrug, and I confirmed on `/usage` that the burn-vs-allotment math is real — not just a unit test, an actual page reading actual usage against the actual allowance. And the number my board sees quarter to quarter really is stable: the same repo, scanned twice, 21 days apart, held at 80 with zero drift on the overall score. That's the "same number I showed the board last quarter" guarantee I need, and it's confirmed against a real re-scan, not just a claim about the blend logic.

But here's what stops me cold: the evidence panel re-ran the exact motion I care about most — an org's trajectory with a thin history, the honest case where the model shouldn't sound confident — and on `/org/vercel/executive`, the page I literally export to PDF and copy into an LLM prompt for the board, the trajectory headline says *"At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13)"* with **nothing under it**. No confidence percentage. No "low data." Nothing. The exact same underlying fit, on the exact same org, shown on `/trends?repo=vercel/ai`, correctly prints "trend confidence — low data (n=2)." One surface tells the truth, the other goes silent — and the silent one is the one with the Download PDF and Copy-for-LLM buttons on it.

That's not a cosmetic gap for me. That's the one thing I said last cycle made me trust the tool enough to "present it as-is." I was wrong to trust it as-is. If my two staff engineers hand me a slide with a dated ETA and no caveat, and it turns out the model only had two data points, that's the tool failing my senior-quality bar in the single worst place — silently, on the artifact that leaves the building. I don't want a caveat that only shows up when the fit is decent; I want to know when it's thin, especially since near-daily scanning means I'll hit small-n windows constantly at cycle boundaries.

The rest of my prior list mostly still stands, unexamined by this pass: the header chip is still binary calm/paused with no ambient allotment cue (not tested live here — the seeded org wasn't near its cap), the "move up a tier" copy is still generic, and Enterprise is still a bare "Custom" with no calculator — confirmed again, still true, still forces me into a sales call I can only roughly pre-price myself ($20/500 → ~$0.04/scan → ~$48/mo at 1200, my own arithmetic, not the product's, and probably wrong at real Enterprise volume). And I noticed something adjacent that isn't directly my tier but sours the whole family of these meters for me: the Free-tier `/usage` page has a warning banner claiming "next private scan will be refused" on an org that hasn't touched its allowance — two panels on one screen disagreeing about the same number. If the metering surfaces get miscalibrated at Free, I trust them less at Team too, even though my own allotment panel checked out fine.

**Renew/downgrade/churn/upgrade: still forced UPGRADE mechanically — 1200 scans/mo doesn't fit in 500 no matter what.** But I'm downgrading my own trust score on the "present it as-is" claim from last cycle. I still take the board slide, but now I have to eyeball the trajectory card myself before I copy it out, because I now know the confidence line can silently vanish exactly when the data is thin. That's exactly the failure mode I hate most: not being able to tell real signal from the model shrugging, except now it's not the model's fault, it's the UI hiding its own uncertainty.

**Time saved this cycle: ~26 engineer-hours** (still most of the ~1-week manual deck, discounted slightly from my prior 24–32 hr estimate because I now have to manually eyeball the trajectory card for a missing caveat before I trust it — call it 30–45 minutes of new verification tax per cycle, not enough to erase the saving, enough that I noticed it).

---

## Adversarial verification of L1 carry-forward findings

| L1 finding | L2 disposition | basis in shared evidence |
|---|---|---|
| **GAB-L1-07b** (strength: definition-stable quarterly number) | **CONFIRMED** | §2/§3: `vercel/ai` 80→80, `vercel/eve` 75→75 across a real 21-day-labeled window, genuine independent claude-cli scans. Overall score Δ0 exactly as claimed. |
| **GAB-L1-05b** (strength: board briefing now carries its own trend-confidence caveat, "closing the prior run's trust gap") | **REFUTED for the low-data case** — the exact case this evidence run reproduces | §4: live `/org/vercel/executive` renders the dated ETA headline with **zero** confidence/low-data line (`grep -c "confidence"` → 0), while the identical org's `/trends?repo=vercel/ai` correctly shows `trend confidence — low data (n=2)`. Root cause confirmed in `src/lib/org/briefing.ts:242-248` + `forecastConfidenceNote()`: `lowData` case returns `null` and the page's `{...&&...}` guard renders nothing, instead of the honest string `Trajectory.tsx` already has. L1 read the code path for the *populated*-confidence case and called it fixed; it did not catch that the suppression path (which is exactly what fires on a thin 2-point series — Gabriel's own near-daily-rescan reality at any short window) goes silent rather than honest. This is a genuine regression-in-spirit from what L1 certified, on the single highest-stakes surface for this character (board PDF / Copy-for-LLM). |
| **GAB-L1-02b** (no cadence calculator at Enterprise boundary) | **CONFIRMED**, price legibility partially improved | §5: `/pricing` now shows real Pro $10/mo, Team $20/mo — confirms the improved half. Enterprise stays bare "Custom · contact us" with a `mailto:`/"Learn more" CTA and no calculator — confirms the gap is unchanged. |
| **GAB-L1-04b** (per-repo Fleet deltas carry no noise/confidence cue) | **CONFIRMED**, with a sharper reason why it matters | §2: per-dimension deltas aren't rendered with up/down styling anywhere in the UI (so the gap is real), but the same section found a real per-dimension swing of **±4** (D7 "Commits" 98→94) on a genuinely unchanged repo — wider than the app's own `SCORE_NOISE_BAND=2`. If a future feature adds per-repo delta arrows without first widening that band, it would misread real engine noise as movement. Raises the priority of closing GAB-L1-04b before that UI is built. |
| **GAB-L1-01b** (ambient CreditsControl chip is depletion-only, not allotment-aware) | **NOT TESTED** in this evidence pass | The seeded `vercel` org's `/usage` data (§6) is Free-tier, 0 private scans, nowhere near its cap — the l2_priority called for a Team org burning >90% of allotment, which this run didn't seed. Carries forward unverified. |
| **GAB-L1-03b** (generic "move up a tier" copy doesn't name Enterprise) | **NOT TESTED** — no over-cap Team org seeded live in this run. Carries forward unverified. |
| **GAB-L1-06b** (strength: retentionCutoff genuinely bounds the trajectory) | **NOT TESTED** live — the evidence run's history windows (21 days) never approached Team's 365-day boundary, so the clamp wasn't exercised. Carries forward as code-plausible, not live-reconfirmed. |

## New finding for this journey (beyond carry-forward)

- **NEW, major** — the board-facing exec briefing's trajectory ETA is confidently dated with zero caveat exactly on low-data series, while the per-repo Trends page for the identical data is honest. This is worse for Gabriel specifically than a generic bug: it fails his **Trust check** acceptance criterion ("he can tell a score move is real signal vs. re-scan noise… surfaced where the move is shown") on the one artifact he actually exports and forwards. `src/lib/org/briefing.ts:242-248`, `forecastConfidenceNote()`, `executive/page.tsx:159-161`.
- **NEW, adjacent, worth flagging even though it's Free-tier not his own** — `/usage`'s "Out of private-scan credits" banner fires for any Free org with 0 prepaid overflow credits regardless of unused monthly allowance, directly contradicting the "Comfortably within your allotment" text on the same screen (§6). Gabriel doesn't hit this exact banner on Team (his own `AllotmentPanel` checked out correctly per L1), but it's the same family of "metered UI says something the entitlement logic doesn't back up" — it costs the *other* metering surfaces some of the credibility he just extended them.

## Findings (JSON, cert_level L2)

```json
[
  {
    "id": "GAB-L2-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Executive-briefing trajectory ETA renders with zero confidence/low-data caveat when the underlying fit is thin — refutes L1's GAB-L1-05b strength claim for this exact case",
    "expected": "The board-facing trajectory (the surface with Download PDF / Copy-for-LLM) shows the same honest low-data caveat the per-repo Trends page shows for identical data, so I never present model noise as a confident dated projection.",
    "got": "Live at /org/vercel/executive: 'At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13)' with zero confidence/low-data text anywhere on the page, while /trends?repo=vercel/ai for the same org/data prints 'trend confidence — low data (n=2)'. Root cause: forecastConfidenceNote() returns null on lowData instead of substituting the honest string Trajectory.tsx already has; briefingMarkdown() (PDF/LLM export) has the same null-guard, so the exported artifact is silent too.",
    "evidence": ["src/lib/org/briefing.ts:242-248", "src/app/org/[slug]/executive/page.tsx:159-161", "_L2-shared-pricing-evidence.md#4"],
    "code_check": "confirmed-present",
    "verdict": "confirmed",
    "outcome": "refutes prior L1 finding GAB-L1-05b (strength) for the low-data case"
  },
  {
    "id": "GAB-L2-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "No cadence calculator at the Enterprise boundary — reconfirmed live",
    "expected": "Same as L1 GAB-L1-02b: the product does the arithmetic for my 1200/mo cadence at the Enterprise line.",
    "got": "/pricing live: Pro $10/mo, Team $20/mo now real numbers; Enterprise still bare 'Custom' with only a mailto/about CTA, no calculator.",
    "evidence": ["_L2-shared-pricing-evidence.md#5"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed"
  },
  {
    "id": "GAB-L2-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Per-repo Fleet deltas still carry no noise/confidence cue, and live data shows the real per-dimension swing (±4) exceeds the app's own noise band (2)",
    "expected": "Same as L1 GAB-L1-04b, now sharpened: before adding delta styling to the per-repo heatmap, the noise band it would be judged against should be recalibrated against a wider sample than 1-2 repos.",
    "got": "Live re-scan of vercel/ai (same commit, 21 days apart): D7 'Commits' swung 98→94 (±4), wider than SCORE_NOISE_BAND=2. Not currently user-visible since no per-dim delta UI exists, but a real gap for anyone tempted to add one soon.",
    "evidence": ["_L2-shared-pricing-evidence.md#2", "src/lib/maturity/noise.ts"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed"
  },
  {
    "id": "GAB-L2-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "clarity",
    "title": "NEW (adjacent) — /usage low-balance banner contradicts the allotment text on the same page for Free-tier orgs",
    "expected": "A metering surface I'm asked to trust for my own Team-tier allotment reads shouldn't be visibly self-contradictory anywhere in the product.",
    "got": "Free-tier org, 0 private scans, full 5/mo allowance untouched, still shows 'Out of private-scan credits — next scan will be refused (402)' directly above text saying 'Comfortably within your 5/mo Free allotment.' Root cause: banner checks prepaid creditBalance===0 rather than usageThisMonth vs allowance.",
    "evidence": ["_L2-shared-pricing-evidence.md#6", "src/app/usage/page.tsx:142", "src/app/usage/usageDashboard.tsx:45-51"],
    "code_check": "confirmed-present",
    "verdict": "confirmed",
    "outcome": "new finding, not previously in Gabriel's L1 list"
  },
  {
    "id": "GAB-L1-01b",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L2",
    "title": "Ambient CreditsControl chip still depletion-only, not allotment-aware",
    "verdict": "not_tested",
    "note": "l2_priority called for a Team org burning >90% of allotment; the shared evidence run seeded a Free-tier org instead. Carries forward unverified."
  },
  {
    "id": "GAB-L1-03b",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L2",
    "title": "Generic 'move up a tier' copy doesn't name Enterprise when already on Team",
    "verdict": "not_tested",
    "note": "No over-cap Team org exercised live in this evidence run."
  },
  {
    "id": "GAB-L1-06b",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L2",
    "title": "retentionCutoff genuinely bounds the board trajectory (strength)",
    "verdict": "not_tested",
    "note": "Evidence run's 21-day window never approached the 365-day Team boundary; code-plausible, not live-reconfirmed."
  }
]
```

## Scores (L2)

- **Grounding score: 4.5 / 6** — the per-cycle read is still structurally sound (definition-stability CONFIRMED, price legibility CONFIRMED, allotment math not retested but no counter-evidence), but the trust-signal source (org trajectory confidence) that L1 counted as fixed is now known to fail silently on thin data — the exact condition his own near-daily cadence will hit at short windows. Down from L1's claimed 5/6.
- **Per-cycle time-saved: ~26 engineer-hours/quarter** (down slightly from L1's 24–32 hr estimate — the new verification tax of manually eyeballing the trajectory card before trusting it, since the missing-caveat bug is now known).
- **Renew/downgrade/churn/upgrade verdict: UPGRADE, still forced, trust now conditional (not clean).** The math still forces Team → Enterprise (1200 > 500) with no walkback possible. But the specific thing that made him say "less hedging than last cycle" in L1 — the board briefing being trustworthy as-is — does not survive contact with a genuine low-data live scenario. He upgrades because he has to, not because the trust gap he flagged last cycle is actually closed.

## Cert-level rationale

**L2-fail.** A prior-cycle "strength" (GAB-L1-05b) that the L1 pass certified as closing the character's single most important senior-quality requirement (board-defensible trend confidence) is refuted by live evidence in exactly the scenario this UAT run was built to exercise (n=2 low-data trajectory). This is a major, board-facing, trust-eroding defect on the highest-stakes surface named in the character's own acceptance criteria ("Trust check"). It does not block the mechanical Enterprise upgrade, but it fails the character's senior-quality bar as written ("A briefing that's beautiful but can't tell him whether this cycle moved… fails the bar even if every pixel renders").
