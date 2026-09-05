# L2 report — Diane (gov / on-prem eng lead) × "Repeated org scans worth the price"

cert_level: L2 (live evidence review — reasoned against `_L2-shared-pricing-evidence.md`, no fresh browser drive by this Character)
date: 2026-07-16
source evidence: `uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md` (live `LLM_PROVIDER=claude-cli` run against seeded `vercel` org)
prior: `uat/runs/2026-07-16-full-sweep/diane-gov-onprem--repeated-org-scans-worth-the-price.md` (L1, verdict: L1-conditional)

---

## 1. In-character reaction to the live evidence

I read the shared run the way I'd read a 3PAO's field notes, not a marketing deck.

**First, the good news, live and reconfirmed, not just claimed in code.** The noise-legibility mechanism I found in the source (`deltaCrossesEngine`, `SCORE_NOISE_BAND`, `forecastConfidenceNote`) actually fired correctly on a real re-scan: two independent live `claude-cli` calls, 21 days apart, same commit, and the fleet rollup rendered `avg move →0` in a neutral tone instead of a fake up/down. That's the exact "is this signal or LLM breathing" answer I need before I'd put a number in front of a CO. And `/pricing` now shows real `$10`/`$20` figures sourced from the same table the entitlement gate reads — my own tier stays "Custom," which is correct and matches how a locked multi-year line actually works. Neither of those was a live blocker for me at L1 and they aren't now — they're confirmed working, not just structurally sound.

**Then the finding that actually worries me.** The same evidence run surfaces something my own L1 walkthrough got only half right. I wrote, from source alone: *"Trend confidence (R²) is shown, and suppressed rather than falsely reported at 100% on thin data. I'd actually trust a move this app reports."* Live, on the exact low-data situation (n=2 scans) my own retention math predicts for anyone under a Team-length window: the **per-repo** Trends page does the honest thing — `trend confidence — low data (n=2)`. But the **Executive Briefing** — the board-facing, PDF-exportable, "Copy for LLM"-exportable surface, i.e. the *actual document I would generate quarterly and hand to a contracting officer* — renders a specific, dated, confident-sounding headline (`"At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13)"`) with **zero** confidence caveat anywhere on the page or in either export. Same underlying `lowData` flag, two different renderings, and the one that's silent is the one that leaves the building.

That is precisely the failure mode my Voice calls out: an insight dressed as a fact, with no paper trail for why it's confident. If I filed that PDF as my quarterly attestation and a 3PAO later asked "what's your basis for the 4-week ETA," I'd have nothing on the artifact itself to point to — I'd have to know to distrust my own export and go find the per-repo page's honest caveat by hand. That's not a hypothetical for me: my retention is contractually "custom" but my *cadence* is quarterly, and the run that produced this bug was a genuinely fresh 2-scan history — which is exactly the shape my org's data will be in at renewal time, and every time a new repo is onboarded into the fleet thereafter.

**Verdict: renew** — this is a multi-year locked contract, my lever was never the visible price, and nothing here breaks the deployability/GHES/artifact-signing story that made this "L1-conditional" in the first place. But I am filing the Executive Briefing confidence gap as a **documented finding for the renewal record**, escalated above where my two original minors sat, because it lands on the one surface explicitly designed to leave my hands unedited.

**One-line reason:** the audit trail and noise-suppression machinery are real and live-confirmed, but the board-facing attestation document itself can silently overstate confidence on thin data — exactly the defect class I renew tools to prevent, not commit them.

**Time-saved this cycle:** my L1 estimate was 6–9 hours saved vs. hand-assembly, conditional on the deployability gate (untested live either way, still an open item — see §3). The mechanics that were live-verified this cycle (signed audit CSV, honest engine-mix disclosure, real noise suppression) hold up and would bank most of that. But the Executive Briefing gap means I can no longer treat the PDF/markdown export as sign-ready out of the box — I'd need to manually check every low-data forecast headline against the per-repo Trends page and hand-append a caveat before I'd stake my name on it. That's real but bounded extra work, maybe 20–30 minutes a cycle at this fleet size. Net: **~5.5 hours saved** this cycle, still clears my own ≥6-hour... actually just under it. Worth noting on the record, not worth the renewal decision.

---

## 2. Adversarial verification of L1 findings against the live evidence

| L1 finding | L1 severity | Bears on live evidence? | L2 disposition |
|---|---|---|---|
| **L1-diane-01** — air-gap/offline-engine story exists in code, undocumented in-product (no `/pricing`, `/about`, Settings copy) | major | The shared run does hit `/pricing` live (§5) but only checks pricing figures, not air-gap/GHES language; it does not grep `/about` or org Settings for deployability copy. | **Not addressed — remains open, unverified either way.** Carried forward as-is, not newly confirmed by live evidence (no live page was checked for this specific copy) and not refuted (nothing in the live run shows the copy now exists). |
| **L1-diane-02** — no in-product confirmation a configured `GITHUB_API_URL` (GHES) is active | minor | The shared run's environment has no GHES configured (it scans `vercel/*` against public `api.github.com`); no live check of a "connected to: host" surface was performed. | **Not addressed — remains open.** Neither confirmed nor refuted by this run; still a source-only finding. |
| **L1-diane-03** — no CSV export of the maturity/dimension scores themselves (only contributors/delivery/passports/teams) | minor | The shared run exercises `/audit` CSV and the Executive Briefing PDF/markdown, not `/api/org/export`; it doesn't test whether a `kind=scores` export exists. | **Not addressed — remains open.** Carried forward unchanged. |
| L1 strength claim: "trend confidence is shown, and suppressed rather than falsely reported at 100% on thin data. I'd actually trust a move this app reports." | (strength, not a filed finding) | Directly tested live: §3 confirms the *per-repo* Trends page does exactly this (`trend confidence — low data (n=2)`). §4 shows the **org-level Executive Briefing** — the surface my JTBD actually cares about (the exportable attestation) — takes the same `lowData` signal and suppresses the confidence line into **nothing**, leaving a bare confident-sounding dated ETA. | **Partially refuted.** The underlying mechanism (compute + gate on `lowData`) is real and correct, confirming half my claim; but my inference that "the app" as a whole would never show me a false-confident number was wrong — one of its two consumers of that exact flag does. This is the run's single most consequential finding for my journey and gets filed as new. |
| L1 strength claim: `deltaCrossesEngine` mutes mock→live deltas so they don't dress up as real movement | (strength) | Live-confirmed: §3/§9 — the 4 single-scan mock `vercel` repos render `—` (no delta), not a fabricated one; the Fleet masthead reads `avg move →0` correctly for the two genuinely-compared repos. | **Confirmed.** Holds exactly as I reasoned from source. |
| L1 strength claim: `/pricing` Pro/Team figures are real and sourced from the same table the entitlement gate reads | (strength) | Live-confirmed: §5 shows `$10`/`$20`/`Custom` rendered live, and directly refutes the *prior* pricing-20 cycle's L2-04 ("price invisible") — consistent with, and stronger evidence for, my own L1 read. | **Confirmed.** |

---

## 3. New finding (from live evidence, filed at L2)

```json
[
  {
    "id": "L2-diane-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "diane-gov-onprem",
    "cert_level": "L2",
    "type": "bug",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Executive Briefing trajectory ETA renders with zero confidence/low-data caveat on the exact board-exportable artifact Diane's JTBD is built around, while the per-repo Trends page shows the caveat for the identical situation",
    "expected": "Per her scored criterion #4 ('a score move carries an evidence delta + fit/confidence, not bare LLM wobble') and her senior-quality bar ('a trajectory fit over a retention window too short to be a quarter-over-quarter baseline fails'), the quarterly attestation artifact she would file with a CO/3PAO must never present a dated forecast headline without its confidence/data-sufficiency caveat.",
    "got": "Live at /org/vercel/executive with n=2 scans: headline 'At risk of slipping to L3 - Augmented in ~4 weeks (~2026-08-13)' with zero 'confidence' occurrences anywhere on the page (grep-confirmed). The PDF and 'Copy for LLM' markdown exports inherit the same silent gap (briefingMarkdown() shares the same forecastConfidence != null guard). The identical lowData case on /trends?repo=vercel/ai correctly renders 'trend confidence - low data (n=2)'.",
    "evidence": [
      "uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md#4",
      "src/lib/org/briefing.ts:242-248",
      "src/app/org/[slug]/executive/page.tsx:159-161"
    ],
    "code_check": "confirmed-present (bug reproduced live, root-caused to code)",
    "verdict": "CONFIRMED",
    "resolution": "open",
    "l2_priority": "n/a - this is the L2 finding itself",
    "note_for_character": "This directly downgrades my L1 strength claim that I'd 'actually trust a move this app reports' - true for the per-repo surface, false for the one surface (Executive Briefing PDF/markdown) that is actually my deliverable."
  }
]
```

---

## 4. Findings carried forward unresolved (not addressed by this live evidence run)

- `L1-diane-01` (major, open) — air-gap/offline-engine story undocumented in-product; the live run never checked `/pricing`, `/about`, or Settings copy for this language, only pricing figures. Still needs its own L2 pass.
- `L1-diane-02` (minor, open) — no in-product confirmation a configured GHES base URL is active. Live run's environment has no GHES configured, so this could not be exercised.
- `L1-diane-03` (minor, open) — no raw CSV export of the maturity/dimension scores themselves. Not exercised by this run.

---

## 5. Verdict

**Renew**, with the Executive Briefing confidence-caveat gap (`L2-diane-01`) escalated to the top of my renewal-file findings list — it lands squarely on the artifact I actually export, not a page I merely browse, and it's the first live-evidence contradiction of something I'd inferred safe from source alone. The deployability, GHES-reachability, and audit-signing story I found at L1 all survive this run untouched (nothing in the live evidence contradicts them; two of the three haven't been tested live at all yet — that's still open, not resolved). This is not a churn-grade defect on a multi-year contract, but it is exactly the kind of finding I document rather than shrug off: a tool that can produce a confident, dated, board-ready number it cannot back up on demand is a tool I'd flag to my own compliance office before the next attestation cycle, regardless of what my contract says about renewal.
