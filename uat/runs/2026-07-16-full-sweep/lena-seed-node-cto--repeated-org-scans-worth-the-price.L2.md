# L2 report — Lena (seed-stage CTO) × "Repeated org scans worth the price"

cert_level: L2 (live claude-cli evidence, reasoned against shared run) · date: 2026-07-16
verdict: **RENEW (Team) — but do not paste the executive ETA into a board deck until the low-data caveat is fixed**

---

## 1. Lena's voice — reaction to the live evidence

"Okay, this changes my answer on one thing I was too quick to praise.

I read the code in my first pass and said the suppressed confidence number — no fake 100% on a two-point fit — was 'the kind of self-aware design that earns trust from someone who's been burned by vanity metrics before.' I was wrong about what that suppression actually *does* on screen. I assumed 'suppressed' meant 'hedged' — like the per-repo Trends page, which literally prints `trend confidence — low data (n=2)`. It doesn't. On the Executive tab — my board tab, the one with the PDF button and the 'copy for LLM' button — a low-data fit renders the full confident sentence, *'At risk of slipping to L3 in ~4 weeks (≈ 2026-08-13)'* — a specific calendar date — with the confidence line just... gone. Not hedged. Gone. Nothing under it says 'go easy on this, we've only got two points.'

That is precisely my pet peeve, word for word: 'a rising arrow with no confidence number — that's hope, not a forecast.' Except it's worse than a rising arrow, because it comes with a *date*, which reads as more confident, not less. And it's on the one artifact in this whole app designed to leave the building without me in the room — the PDF, the copy-to-LLM markdown. If I'd exported that in week two of our Cursor rollout, before I had three real data points, I'd have handed my board a dated ETA my own product quietly knew was unsupported. That's the exact way I get burned in front of a partner, and I wouldn't even know it happened, because the page that's supposed to warn me chose that moment to say nothing.

The rest of the picture still holds up, and I want to be fair about that. The noise-band work is real and it's live — I can see `vercel/ai` sit at a genuine Δ0 across a real 21-day gap and get rendered as a neutral '→0,' not a fake green tick, and the per-dimension swing (±4 on one dimension even on a flat repo) staying invisible in the UI is exactly the kind of thing I'd want caught before someone builds a dimension-delta feature on top of it — so I'm noting it, not panicking about it. Pricing is real numbers now too — Team's $20/mo, 500 credits, 365-day retention, no more guessing — so the half of my Price-legibility question that was open in my L1 (does the $ figure exist at all) is closed. My other L1 note — that the one in-app hop from `/usage` to `/pricing` disappears under my exact dev config — wasn't re-tested live this round, so I'm leaving that one as unconfirmed, not walked back.

**Renew/downgrade/churn:** Renew Team. The unit economics haven't moved — I'm still at ~48/500, still comfortably 'under,' still not overpaying, and the recurring-value case (noise-honest movers, a real fleet-level 'what moved and why,' a real dollar figure to check my tier against) is genuinely stronger than my L1 gave it credit for on three of my six criteria. But I'm putting an asterisk on 'Trajectory is board-credible' until the ETA either grows a caveat or I personally verify scan count before every quarterly export — which is exactly the manual-checking tax the tool was supposed to remove.

**Time saved:** ~80–90 min/quarter, not the full ~105 I estimated in L1. The copy-paste flow is real and fast — that part of the savings holds. But until this is fixed, I have to spend a couple of minutes each quarter manually confirming 'do we have 3+ real scans in the window' before I trust the headline enough to paste it, and the first quarter or two of any newly-onboarded team (which is exactly my situation right now) is the highest-risk window for hitting this. That's not zero savings — it's real savings with a manual gate bolted back on."

---

## 2. Confirm / refute against L1, criterion by criterion

| Lena's scored criterion | L1 verdict | L2 (live evidence) verdict | Change |
|---|---|---|---|
| Recurring-value check | PASS | **CONFIRMED** — §3 shows live `→0` neutral rendering on a genuinely flat, real 21-day-apart re-scan pair; noise-band muting is real, not theoretical. | held |
| Trajectory is board-credible (R²/confidence surfaced, noisy fit flagged not hidden) | PASS ("honest suppression... earns trust") | **REFUTED** — §4: the exec-briefing ETA renders a confident, dated headline with **zero** confidence/low-data caveat (`grep -c "confidence"` → 0 on the page), while the per-repo Trends page shows the honest `low data (n=2)` string for the identical situation. L1 mistook "confidence number suppressed" for "hedged"; live evidence shows it's silent, not hedged — this is her stated worst-case pattern, on her board/PDF surface specifically. | **overturned** |
| Move is trustworthy (real move vs. guardband noise) | PASS | **CONFIRMED**, with a refinement — noise-band muting works live on the overall score (§3); per-dimension swing is wider (±4) than the app's own `SCORE_NOISE_BAND=2` calibration, but not currently rendered anywhere with delta styling, so not user-facing yet (§2/§5 of shared evidence). Flag for future dimension-delta features, not a current gap. | held, refined |
| Provenance (biggest mover ties to a named cause) | CONDITIONAL (fleet-level strong, repo-level weak — extra click) | **NOT RE-TESTED** — shared evidence didn't specifically drive the repo-level mover-to-dimension interaction this run. L1-LENA-01 carried forward unverified, not refuted. | unconfirmed |
| Price-legibility check | CONDITIONAL (price exists, not co-located with `/usage`, and the one bridging link is hidden under her exact dev config) | **PARTIALLY CONFIRMED** — §5 confirms `/pricing` now shows real, un-drifting $ figures (Team $20/mo/500 credits/365d), closing the "does the number exist" half. The specific claim that `CreditsControl`'s "See plans →" link is hidden under `ASCENT_ALLOW_CREDIT_GRANTS=1` was not re-driven live this run — carried forward unverified. | partially confirmed |
| Right-sizing | PASS | **CONFIRMED** — nothing in shared evidence changes the `allotmentRead()` "under ~10%" read; her 48/500 cadence still lands there. | held |

---

## 3. New finding surfaced by the shared evidence (specific to Lena's angle)

**The single highest-relevance item in the whole shared evidence file for Lena is §4** — it isn't a new bug she'd never have hit, it's a direct hit on her #1 named pet peeve, on the exact export surface (PDF / "copy for LLM") her JTBD says she uses to leave the building with a board-ready number. Because her own org is mid-rollout (just adopted Cursor + Claude Code, per her background), a low-data (`n<3`) trajectory window is not a corner case for her — it's the state her real org's dashboard would likely be in for the first 4-6 weeks of adoption, i.e. exactly her first quarterly board cycle.

Secondary, lower-relevance new item: §6's `/usage` "out of credits" banner bug was demonstrated on a Free-tier org, not Team — it's not confirmed to reproduce for a Team org with an untouched prepaid-credit balance of 0 (which is Lena's likely state, since she's drawing from her 500 monthly allowance, not overflow credits). Flagging as a **possible** analog risk to her Right-sizing read, not a confirmed one — would need a live Team-tier `/usage` check to resolve.

---

## 4. Findings (cert_level: L2)

```json
[
  {
    "id": "L2-LENA-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "lena-seed-node-cto",
    "cert_level": "L2",
    "type": "trust-violation",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Executive-briefing trajectory ETA renders a confident, dated projection with zero confidence/low-data caveat when the fit is low-data — on the board/PDF/copy-for-LLM export surface",
    "expected": "Per Lena's #2 scored criterion, a noisy/thin fit must be flagged, not hidden, wherever the ETA is shown for board use.",
    "got": "src/lib/org/briefing.ts:242-248's forecastConfidenceNote() returns null on lowData, causing executive/page.tsx:159-161's guard to render nothing at all — no caveat text — while the identical n=2 situation on /trends?repo=... renders an explicit 'trend confidence — low data (n=2)' string. Live-confirmed on /org/vercel/executive: headline 'At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13)' with 0 occurrences of the word 'confidence' anywhere on the page.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §4", "src/lib/org/briefing.ts:242-248", "src/app/org/[slug]/executive/page.tsx:159-161"],
    "code_check": "confirmed-live",
    "verdict": "CONFIRMED",
    "resolution": "open",
    "note": "Overturns L1's positive read of this same code path — L1 (correctly reading the code's INTENT to avoid a false 100%) inferred an honest hedge; live behavior is a silent omission, not a hedge, which is worse for exactly Lena's stated failure mode."
  },
  {
    "id": "L2-LENA-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "lena-seed-node-cto",
    "cert_level": "L2",
    "type": "carried-forward",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Repo-level movers still lack dimension attribution (L1-LENA-01) — not re-tested live this run",
    "expected": "n/a — status check only.",
    "got": "Shared L2 evidence run did not specifically drive the executive Movement-list → per-repo dimension interaction; no confirming or refuting live data available.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/lena-seed-node-cto--repeated-org-scans-worth-the-price.md (L1-LENA-01)"],
    "code_check": "not-tested",
    "verdict": "PLAUSIBLE",
    "resolution": "open"
  },
  {
    "id": "L2-LENA-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "lena-seed-node-cto",
    "cert_level": "L2",
    "type": "resolved-partial",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "/pricing now shows real $ figures (closes half of L1-LENA-02); the hidden usage→pricing link claim was not re-tested",
    "expected": "n/a — status check.",
    "got": "Shared evidence §5 confirms /pricing shows real Team $20/mo/500cr/365d, resolving 'does a $ figure exist at all.' The narrower claim that CreditsControl's 'See plans →' link disappears under ASCENT_ALLOW_CREDIT_GRANTS=1 (Lena's own seeded env) was not re-driven live this run.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §5", "src/components/org/shared/CreditsControl.tsx:250-257"],
    "code_check": "partially-confirmed",
    "verdict": "PLAUSIBLE",
    "resolution": "open"
  },
  {
    "id": "L2-LENA-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "lena-seed-node-cto",
    "cert_level": "L2",
    "type": "possible-analog-risk",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "/usage 'out of credits' banner bug (shared evidence §6) demonstrated on Free tier only — unconfirmed whether it reproduces for Lena's Team-tier org",
    "expected": "n/a — flag for future L2 pass.",
    "got": "Shared evidence's banner-mismatch bug (creditBalance===0 firing regardless of unused monthly allowance) was shown live only on a Free-tier vercel org. Lena is Team, drawing from her 500/mo allowance rather than overflow credits, which is the same structural condition (prepaid balance 0) that triggers the bug — but this was not verified live against a Team-tier org.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §6"],
    "code_check": "not-tested-on-team-tier",
    "verdict": "PLAUSIBLE",
    "resolution": "open"
  }
]
```

---

## 5. Verdict summary

- **Renew / downgrade / churn / upgrade:** **Renew (Team)** — unit economics unchanged, right-sizing confirmed live, noise-honesty confirmed live, pricing now legible. One reason: *"the credit math and the noise-handling both check out live, but I'm not signing my name to the ETA date until it either hedges itself or I manually check the scan count first."*
- **Time saved:** ~80–90 min/quarter (down from L1's ~105 min estimate) — the copy-paste flow is real, but the newly-confirmed silent low-data ETA adds back a manual verification step for the highest-stakes number on the page, especially likely to bite during her org's first 1-2 quarters of adoption.
- **cert_level:** **L2-fail** — her own senior-quality bar states explicitly: *"A rising projection with no R²... fail the bar — even if the page renders beautifully."* Live evidence confirms exactly that failure mode on the board/PDF export surface, so the journey fails her stated reliability floor even though five of six scored criteria pass or partially pass.
