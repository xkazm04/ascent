# L2 (live-verified) — Victor (FinOps-minded Engineering Director) × "Repeated org scans: worth the price?"

cert_level: L2 · promotion: discovery · engine: claude-cli (confirmed live, `engineProvider:"claude-cli"`) · evidence: `uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md` (run 2026-07-16)

## 1. Character voice — first-person reaction to the live evidence

Two things got better since my L1 pass, and two things got worse, and net-net I'm still not putting this in front of the CFO unedited.

The good: `/pricing` now shows me real numbers — Team, $20/mo, 500 included, computed against the same `plans.ts` the entitlement gate actually reads. That's the "one price source" I asked for; $20 ÷ 500 = $0.04/scan is a number I can defend without a footnote. And the Fleet card's noise handling held up under an actual live 21-day-labeled re-scan of the same commit — `vercel/ai` and `vercel/eve` both moved exactly zero and both rendered as `→0`, not a fake colored delta. Good, that instinct was real, not a demo.

Here's the bad. My L1 finding was that the sentence directly under the allotment number — "Unused credits roll over — they never expire" — describes the *wrong* field: it's true of the prepaid credit pool, not of the monthly allowance the panel is displayed under, which resets hard every UTC month with no carry-forward in the code. The live evidence confirms that exact sentence is still rendering, live, today, right where I said it would: `/usage` for a Free-tier org reads *"Comfortably within your 5/mo Free allotment. Unused credits roll over — they never expire."* Same words, same seam, same wrong pairing of concepts. I didn't get a chance to cross a real UTC month boundary to watch the number reset while that sentence still claims persistence — that's the one piece of my finding that stays theoretical — but the copy bug itself is live-confirmed, not a static-read artifact.

And it's worse than I scoped it in L1, because the live run turned up the sibling bug I should have expected once you know the codebase conflates "prepaid balance" and "monthly allowance" in one sentence: the low-balance banner on that same `/usage` page — *"Out of private-scan credits — the next private scan will be refused (402)"* — fires for a Free-tier org that has done **zero** private scans and has its full 5/mo allowance sitting untouched, because it checks the prepaid-credit balance (0, since nobody bought overflow credits) instead of the allowance. That's not a new bug class to me, it's the *same* bug class — the app has two different credit concepts and, on the one page I budget from, it keeps reaching for the wrong one. Two panels on the same screen now disagree with each other about whether I'm about to get locked out. If I were a numerate buyer reading this cold I'd stop trusting every number on the page, not just the rollover line.

Third thing, and this one's new and it matters more than either of the above for the renewal conversation specifically: the executive briefing — my board-ready, PDF-exportable, "copy for LLM" artifact — renders a dated ETA ("At risk of slipping to L3 in ~4 weeks, ≈ 2026-08-13") with **zero** confidence caveat, on data that's a 2-point fit. The per-repo Trends page does the honest thing for the identical low-data case ("trend confidence — low data (n=2)"); the executive briefing's confidence line just silently doesn't render. That ETA is exactly the kind of specific-sounding number I'd paste into a renewal deck without re-deriving it myself — that's the whole point of the export buttons — and it's the one surface where an uncaveated wrong-sounding number does the most damage if it turns out to be noise. This is worse than a UI polish gap: it's my exact "can I trust a delta on this page" question, unanswered on the highest-stakes page.

**Verdict: hold Team, but do not export/screenshot the executive briefing or the /usage allotment panel to the CFO without independently re-deriving the two numbers by hand first.** That's not "renew" and it's not "downgrade" — it's "renew provisionally, budget spreadsheet stays open." The pricing legibility and noise-muting wins are real and I'll take credit for them in my head, but the rollover contradiction is still live, it now has a corroborating sibling bug, and the board-facing surface has its own version of the same "confident number, no caveat" problem. That's three variations on one root failure mode across three surfaces I'd actually use in one budgeting session.

**Time saved this cycle: ~10 minutes**, down from the ~30 I'd have claimed if the rollover copy were trustworthy. I get the $/scan number for free from `/pricing` now (that part of the spreadsheet dies, that's real time back), and the Fleet noise-muting saves me the "is this real" eyeball check. But the allotment/rollover math and anything from the executive briefing I'd cite externally still gets manually re-derived or re-verified, because I've now seen the same "wrong number, right next to a contradicting correct one" pattern twice on the page I budget from. A tool that makes me re-verify its own headline numbers hasn't actually replaced the spreadsheet — it's just moved where I do the arithmetic.

## 2. Adversarial verification of L1 findings against the live evidence

| L1 finding | L1 verdict | L2 verdict | Basis |
|---|---|---|---|
| **L1-VF-01** — AllotmentPanel's "roll over, never expire" copy sits under the monthly-allowance number but describes the separate prepaid-credit pool; contradicts `/pricing`'s allowance-reset language | confirmed (code-read) | **CONFIRMED, live** — and reinforced by a new sibling bug | The shared evidence §6 quotes the *exact* live-rendered sentence — "Comfortably within your 5/mo Free allotment. Unused credits roll over — they never expire." — under the allowance figure on a real `/usage` page load, matching L1's static-code read verbatim. Not retested: an actual UTC month-boundary crossing to watch the number reset while the sentence still claims no-expiry (that piece stays L1-theoretical). New corroborating evidence: shared-evidence §6 independently found the low-balance banner making the *same* category of prepaid-balance-vs-allowance conflation error, on the same page, one panel over — two independent bugs from one root confusion, which raises my confidence the underlying model genuinely muddles these two fields rather than this being one isolated copy typo. |
| **L1-VF-02** — retention window (30/180/365d by tier) never rendered on `/usage` or `/trends`, only in a `plans.ts` comment and a `/pricing` bullet | confirmed (code-read), `l2_priority`: check live DOM | **NOT RETESTED** — carried forward unconfirmed | The shared evidence never loaded `/trends` or `/usage` looking for a retention-window string, and none of its quoted `/usage` or `/trends` copy includes one. It doesn't refute L1's claim, but it doesn't independently confirm the DOM omission either — it's silent on this specific question. Status: open, unconfirmed by L2, no new evidence either way. |
| **L1-VF-03** — AllotmentPanel's utilization % blends allowance-covered and credit-debited scans into one number without breaking out the split | uncertain, low priority | **NOT RETESTED** — carried forward unconfirmed | Shared evidence §6 shows an engine-mix breakdown (`Claude CLI 4 · 50%, Mock 4 · 50%`) but nothing about an allowance-vs-credit split within the utilization %. No new evidence either way; stays a low-priority open item, unchanged from L1. |

## 3. New findings surfaced by the shared live evidence, specific to Victor's recurring-value-vs-price angle

```json
[
  {
    "id": "L2-VF-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "victor-finops-director",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Low-balance banner conflates prepaid-credit balance with monthly allowance — same root bug class as L1-VF-01, on the same page",
    "expected": "The 'out of credits, next scan will be refused' warning should reflect actual entitlement risk: allowance usage vs. plan.includedCredits, checked before the separate prepaid balance (matching decideScanCharge's real charge order).",
    "got": "usageDashboard.tsx's lowBalance check fires on creditBalance===0 alone, regardless of unused monthly allowance — so a fresh Free-tier org with 0/5 scans used and 0 purchased overflow credits sees 'the next private scan will be refused' directly above text on the same page saying 'Comfortably within your 5/mo Free allotment.'",
    "evidence": ["src/app/usage/page.tsx:142", "src/app/usage/usageDashboard.tsx:45-51", "src/lib/plans.ts decideScanCharge (allowance checked before balance)"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "notes": "Not a new root cause — it's the same prepaid-balance-vs-monthly-allowance conflation as L1-VF-01, expressed as a second, more alarming symptom on the same screen. Raises my confidence L1-VF-01 is a systemic modeling gap, not an isolated copy bug."
  },
  {
    "id": "L2-VF-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "victor-finops-director",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Executive-briefing trajectory ETA (the board/PDF/LLM-export surface) renders a dated, confident-sounding number with zero confidence caveat on low-data input, while the per-repo Trends page states the caveat honestly for the identical case",
    "expected": "A dated ETA I might paste unedited into a renewal deck needs the same 'trend confidence — low data (n=X)' honesty the per-repo Trends page already has for the same underlying forecast.",
    "got": "org/vercel/executive renders 'At risk of slipping to L3 in ~4 weeks (≈2026-08-13)' with no confidence line anywhere on the page (0 occurrences of 'confidence' in the rendered HTML); forecastConfidenceNote() returns null on low-data instead of substituting the honest string Trajectory.tsx already has, so the guard around it renders nothing rather than a caveat. Same gap exists in the PDF/LLM-export markdown (briefingMarkdown()).",
    "evidence": ["src/lib/org/briefing.ts:242-248", "src/app/org/[slug]/executive/page.tsx:159-161"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "notes": "Directly relevant to the 'recurring-value-per-credit' and senior-quality-bar criteria: this is the exact surface I'd export for the CFO, and it's the one place a wrong-turning-out-to-be-noise number does the most damage with nobody around to add context."
  },
  {
    "id": "L2-VF-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "victor-finops-director",
    "cert_level": "L2",
    "type": "resolved",
    "severity": "n/a",
    "impact": { "frequency": "n/a", "reachability": "n/a", "trust_erosion": "n/a" },
    "dimension": "trust",
    "title": "Price legibility criterion now met live — /pricing shows real Team $20/mo · 500 credits, computable $/scan",
    "expected": "Subscription $ reachable in-app so $/scan is computable without contacting sales.",
    "got": "Confirmed live: Free $0, Pro $10/mo/100, Team $20/mo/500, Enterprise Custom — all sourced from plans.ts, the same file the entitlement gate reads, so it can't drift from what's billed.",
    "evidence": ["_L2-shared-pricing-evidence.md §5"],
    "code_check": "present-fixed",
    "verdict": "confirmed",
    "resolution": "resolved",
    "notes": "Closes a gap Victor's DoD flagged as needing re-verification post-pricing-20 remediation. Positive finding."
  }
]
```

## 4. Scored acceptance criteria — re-scored against live evidence

- [x] **Burn-vs-allotment visible** — `AllotmentPanel` renders utilization %; not contradicted by shared evidence (not independently re-loaded for a Team org, but nothing refutes it and the mechanism is unchanged).
- [ ] **Rollover is stated** — **FAIL**. The exact wrong sentence ("roll over, never expire") is confirmed live under the allowance figure, and a second live bug (the low-balance banner) shows the same field-conflation elsewhere on the identical page.
- [~] **Right-size signal exists** — not retested live; carried from L1 as present, unconfirmed by L2.
- [x] **Price legibility** — **PASS, newly confirmed live**. Team $20/mo/500 computable in-app.
- [ ] **Recurring-value-per-credit** — **partial**. The executive briefing's "move to make next" is real, specific, and quantified (confirmed live in shared evidence §8) — that half passes. But the trajectory ETA on the same board-facing artifact fails the honesty bar (no confidence caveat), so the artifact as a whole isn't yet something I'd export unedited.
- [ ] **Time-saved bar** — **FAIL**. Pricing legibility and noise-muting shave real minutes off the cycle, but the rollover contradiction (now reinforced by a sibling bug) and the uncaveated exec-briefing ETA both force a manual re-check, so the page doesn't yet fully replace the spreadsheet.

## 5. Net assessment

3 of 6 scored criteria pass or partially pass, up from roughly 2 of 6 at L1 (pricing legibility is a genuine, verified win). But the core trust failure from L1 — contradictory rollover semantics on the exact page Victor budgets from — is not just still present, it's now corroborated by an independent live bug in the same page's low-balance banner, and compounded by a new major finding on the highest-stakes surface (the executive briefing's uncaveated ETA). Net motion is sideways-to-slightly-worse on the trust dimension even though price legibility genuinely improved.
