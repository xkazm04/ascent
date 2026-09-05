# L2 report — Sasha (build-vs-buy DevEx lead) × "Repeated org scans worth the price?"

cert_level: L2 (live, claude-cli engine, real seeded 21-day history) · date: 2026-07-16
Live evidence source: `uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md`

---

## Verdict: **conditional-hold — would not renew as-is; ledger tips further toward build after this live pass, not less**

**Time saved this cycle, as actually observed: ~90 min**, not the full ~3.5 hr I scored the designed experience at in L1. The forecast math and pricing legibility earned their keep live — real numbers, not slideware. But the live pass surfaced a *new, board-facing* instance of exactly the trust gap I flagged in L1, on the one surface (`/executive`) that leaves my building unedited via PDF/"copy for LLM." I'm not paying recurring rent on a number I still have to caveat myself before I hand it to a CFO.

---

## 1. Reaction to the live evidence, in order I'd actually read it

**Engine stability — confirmed, and it's the right kind of boring.** Two independent live `claude-cli` scans of the same commit, 21 days apart, both landed on Δ0 overall (`vercel/ai` 80→80, `vercel/eve` 75→75). That's the baseline sanity check for a *recurring* buy — if the score wobbled on an unchanged repo I'd have stopped reading right there. It didn't. Good.

**But the per-dimension swing (±4 on D7 "Commits") is wider than your own calibrated noise band (`SCORE_NOISE_BAND=2`).** Nobody's showing per-dimension deltas in the UI yet, so this isn't user-facing today — but it's a data point for my ledger, not yours: the "is this real" question you've solved at the *overall* level is not yet solved at the *dimension* level, and dimension-level is exactly where a staff engineer on my team would look next. File it, don't ship a delta-arrow heatmap on a ±2 band until you've sampled more than two repos.

**The Overview rows and digest email get noise right, live, not just in source.** `→0` renders neutral on the fleet masthead, not styled as a fall. That closes the loop on the general mechanism — I believe `isWithinNoise` works where it's wired.

**Then I open `/executive` for the cycle's board read — and this is where the live evidence is worse than what I scored in L1, not better.** The trajectory headline says, with a specific dated ETA: *"At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13)."* Zero confidence caveat anywhere on the page — verified by grep, not eyeballing. The *identical* org, on the *identical* low-data situation, one click away on `/trends?repo=vercel/ai`, says *"trend confidence — low data (n=2)"* in plain text. Same `lowData` flag, same root cause, two different products depending which URL I'm on.

This is not a new category of problem for me — it's the *same* pattern I called out in L1 against the Executive movers list (noise-band logic built once, wired in two of three places, forgotten on the one a leader actually screenshots). But live evidence makes it strictly worse than L1 anticipated: this isn't the movers list, it's the **headline number**, and it's wired into the "Download PDF" and "Copy briefing for LLM" buttons — `briefingMarkdown()` has the same silent guard. That means a dated, specific-sounding ETA with zero caveat is the thing that leaves the building. If a director on my team forwards that PDF to a CFO with "AI-native maturity slipping by Aug 13," and it turns out that's a 2-point-fit line I'd have flagged with one string, that's not a UI polish bug — that's the exact failure mode DX Core 4 warned me about, except worse, because at least a wrapper-dashboard doesn't actively mislead.

**Corpus percentile and per-cycle "move to make next"** — no live counter-evidence against these; the executive briefing's ranked, quantified recommendation ("Agentic AI Tooling · ≈+9.3 pts on 3 repos") ties to real weakest-dimension numbers (D4 Agentic 33, D9 Security 52) confirmed against the live heatmap. That's a genuinely new, actionable per-cycle decision — I'll credit that criterion live.

**Pricing — confirmed, directly refutes nothing I said, strengthens the "table stakes done right" line.** `$10/mo` Pro, `$20/mo` Team, `Custom` Enterprise, single-sourced from the same file the entitlement gate reads. I can put a real number in the ledger. Not a differentiator — I said that in L1 — but it's not a blocker either, confirmed.

**Data portability — no live evidence either way this run.** The shared evidence didn't re-hit `/api/org/export`, `/api/org/repositories`, or loop `/api/history` across a real fleet size. My L1 finding (no single bulk call for the 9-dim scores + trajectory + movers — the actual product) stands unconfirmed-but-also-unrefuted by this pass. I'm not dropping it from the ledger; I just can't upgrade it to "live-confirmed" and I can't downgrade it either.

**One thing on my bound surfaces I'd flag but not weight heavily for my own tier:** the `/usage` low-balance banner bug (§6 of the shared evidence — fires "next scan will be refused" on a Free org with its full allowance untouched, contradicting the very next line of copy on the same page). I'm evaluating Team/Enterprise, not Free, so this doesn't hit my ledger directly — but it's the same *species* of bug as the executive-headline gap: two panels on one screen disagreeing with each other. A vendor whose own UI contradicts itself twice in one live pass is not instilling confidence that the "moat" parts (corpus, calibration) are getting the same scrutiny.

---

## 2. Adversarial verification of L1 findings against live evidence

- **L1-sasha-01 (no bulk org-level export of scores/dims/trajectory/movers) — NOT RE-TESTED LIVE.** The shared evidence run didn't hit `/api/org/export`, `/api/org/repositories`, or exercise `/api/history` across the fleet. **Verdict: carried forward as-is (open), verified only at L1/code level, not upgraded to live-confirmed.** I'm not inflating my confidence in this finding past what was actually driven.

- **L1-sasha-02 (Executive "Movement this period" list shows unfiltered arrows) — NOT DIRECTLY EXERCISED, but strongly corroborated by an analogous live finding.** The seeded pair (`vercel/ai`, `vercel/eve`) both landed at exactly Δ0, which doesn't populate the gainers/regressers partition at all (0 is neither `>0` nor `<0`) — so this run never produced a genuinely-noisy nonzero mover to check against the movers list specifically. **However**, the *identical failure pattern* — noise/confidence logic correctly wired in one place (Overview rows, `/trends`) and silently absent in the executive-briefing surface — is now live-confirmed on a **different field of the same page** (§4: trajectory headline, not movers). That's not proof of L1-sasha-02 itself, but it is live evidence that the underlying root cause I named (exec briefing surface inconsistently reuses the noise/confidence primitives) is real and already manifesting elsewhere on that exact page. **Verdict: PLAUSIBLE, corroborated-by-analogy, not directly confirmed.** I'm treating my original finding as still live risk, arguably worse now that a sibling instance of the same bug class has live-confirmed.

- **L1-sasha-03 (corpus percentile has no sample-size disclosure) — NOT RE-TESTED LIVE.** No live evidence gathered on the executive corpus tile's percentile/sample-size copy this run. **Verdict: carried forward as-is (open), unconfirmed by L2.**

- **L1-sasha-04 (Free tier retention line omitted) — out of scope for my tier, unchanged.** No live counter-evidence, and it wasn't mine to chase.

- **L1's PASS calls (forecast is more than a slope; price legibility) — both LIVE-CONFIRMED, strengthened.** `/trends?repo=vercel/ai` renders the honest `lowData` string live; `/pricing` renders real `$10`/`$20`/Custom live, matching the single-sourced `plans.ts` I cited in L1. These upgrade cleanly from code-read to live-verified.

---

## 3. NEW finding for this journey (from live evidence, not in my L1 list)

**Executive-briefing trajectory ETA renders a dated, specific-sounding forecast with ZERO confidence/low-data caveat — on the exact surface with a PDF/"copy for LLM" export a director would forward unedited to a CFO.** This is a sharper, higher-stakes instance of the general "confidence primitive not applied everywhere it needs to be" problem I already scored as major in L1 (there, aimed at the movers list). Root cause per the shared evidence: `forecastConfidenceNote()` returns `null` on low data instead of substituting the honest string `Trajectory.tsx` already has for the identical case — so the JSX guard renders nothing instead of a caveat. Both the on-screen `/executive` page and the exported markdown (`briefingMarkdown()`) are silent. **Severity: major, trust-eroding, board-facing — directly on my "move-is-real trust" criterion, and worse than the movers-list gap because it's the headline, not a sub-list, and it leaves the building via PDF.**

---

## 4. Scored acceptance criteria — re-judged against live evidence

- [~] **Recurring-value / moat check** — unchanged, PARTIAL. Corpus percentile not re-tested live this run; forecast math confirmed real and operating correctly live (`lowData n=2` string).
- [ ] **Data portability** — unchanged, FAIL as designed at L1; not retested live, so still the single biggest open item on my ledger.
- [ ] **Move-is-real trust at the point the move is shown** — WORSE than L1 scored it. Live evidence adds a second, higher-stakes confirmed instance of the same inconsistency (trajectory headline, not just movers), on the board/PDF surface specifically.
- [x] **Forecast is more than a slope** — PASS, live-confirmed (`/trends` honest low-data string, real `forecastHeadline` text).
- [x] **Price legibility** — PASS, live-confirmed (`$10`/`$20`/Custom, single-sourced).
- [x] **Per-cycle new decision** — PASS, live-confirmed. The "move to make next" recommendation is specific, quantified, and ties to real live dimension numbers (D4 Agentic 33, D9 Security 52).

---

## 5. Findings (JSON)

```json
[
  {
    "id": "L2-sasha-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sasha-megacorp-buildvsbuy",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Executive-briefing trajectory ETA renders a dated, specific forecast with zero confidence/low-data caveat, on the board/PDF/LLM-export surface — live-confirmed, and a sharper instance of the L1-flagged pattern",
    "expected": "The board-facing trajectory headline substitutes the same honest 'trend confidence — low data (n=X)' string the per-repo Trends page already renders for the identical lowData case.",
    "got": "Live at /org/vercel/executive: 'At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13)' with zero 'confidence' occurrences anywhere on the page (grep-verified). forecastConfidenceNote() returns null on lowData instead of substituting the honest string; the JSX guard then renders nothing. briefingMarkdown() (PDF/copy-for-LLM export) shares the same guard, so the exported artifact is silent too.",
    "evidence": ["src/lib/org/briefing.ts:242-248", "executive/page.tsx:159-161", "_L2-shared-pricing-evidence.md §4"],
    "code_check": "present-but-broken",
    "verdict": "CONFIRMED",
    "resolution": "open",
    "note": "New at L2 — not itemized in Sasha's L1 findings list, though it is the same bug class as L1-sasha-02 (noise/confidence primitive not reused everywhere it needs to be), now confirmed on a higher-stakes field (trajectory headline + PDF export, not just the movers list)."
  },
  {
    "id": "L1-sasha-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sasha-megacorp-buildvsbuy",
    "cert_level": "L2",
    "type": "missing-feature",
    "severity": "major",
    "title": "No bulk org-level export of maturity scores/dimensions/trajectory/movers",
    "verdict": "PLAUSIBLE",
    "resolution": "open",
    "note": "Carried forward from L1, code-grounded. Not re-tested by this run's live evidence (no live hit on /api/org/export, /api/org/repositories, or a looped /api/history across a real fleet) — status neither confirmed nor refuted live; do not upgrade confidence past L1."
  },
  {
    "id": "L1-sasha-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sasha-megacorp-buildvsbuy",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "major",
    "title": "Executive 'Movement this period' list shows within-noise moves with the same confident arrow as real moves",
    "verdict": "PLAUSIBLE",
    "resolution": "open",
    "note": "Not directly exercised live — the seeded pair landed at exactly Delta-0, which never populates the gainers/regressers partition, so no genuinely-noisy nonzero mover appeared in the movers list to check. Corroborated by analogy: L2-sasha-01 live-confirms the identical bug class (confidence/noise primitive missing on the executive surface) on a sibling field of the same page."
  },
  {
    "id": "L1-sasha-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sasha-megacorp-buildvsbuy",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "minor",
    "title": "Cross-org corpus percentile has no sample-size disclosure in the UI",
    "verdict": "PLAUSIBLE",
    "resolution": "open",
    "note": "Not re-tested by this run's live evidence (no live hit on the executive corpus tile's copy/sample-count this run)."
  },
  {
    "id": "L1-sasha-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sasha-megacorp-buildvsbuy",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "polish",
    "title": "Free tier's feature list omits its own retention window",
    "verdict": "N/A",
    "resolution": "open",
    "note": "Out of scope for Sasha's own tier (Team/Enterprise); no live evidence gathered against Free tier's plan-feature copy in this run."
  },
  {
    "id": "L2-sasha-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "sasha-megacorp-buildvsbuy",
    "cert_level": "L2",
    "type": "positive",
    "severity": "n/a",
    "title": "Overall-score stability re-confirmed live (Delta0 on 2 repos, 21-day real window); price legibility and forecast-confidence mechanics both live-confirmed",
    "verdict": "CONFIRMED",
    "resolution": "n/a",
    "note": "Upgrades L1's code-level PASS calls (forecast, pricing) to live-verified. Also surfaces a new, non-user-visible-yet data point: per-dimension noise swing (±4 seen) exceeds the app's own SCORE_NOISE_BAND=2 constant, wider than the single prior sample (±1) — worth a larger recalibration before any per-dimension delta UI ships."
  }
]
```

---

## 6. Character voice — closing reaction

Same corpus, same forecast — still the two lines in the buy column, and this pass confirmed both live instead of just in source, which is worth something. Pricing's real too; I can put a number in the ledger without emailing sales.

But I came here to check whether you'd fixed the thing that would've flipped me to build, and instead I found a worse version of it. Last time I read your code and said "the noise-band logic exists, it's just missing from the movers list." This time I watched the *headline* — the sentence with a date in it, the one that goes on a PDF with your logo on it — say "at risk of slipping... in ~4 weeks" with a straight face and zero caveat, while the page one tab over, same org, same low-data problem, says "low data (n=2)" like an adult. You already wrote the honest string. You just didn't call it from the surface that leaves the building.

That's not a moat problem, that's a QA problem, and it's worse than a moat problem for a build-vs-buy call: a moat gap tells me what I can't build; an inconsistent UI tells me I can't trust what you *did* build without re-verifying it myself — which is the whole reason I'd be paying you instead of my own squad. Fix the executive headline caveat, fix the movers list the same way, and give me one API call for the score itself instead of four adjacent CSVs, and I'll stop asking what the moat is and start asking what the SLA is. Until then: conditional hold, not a renewal, and I'm keeping my analyst on the manual re-derivation for anything that leaves this dashboard.
