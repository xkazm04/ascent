# L2 (live-evidence-adjudicated) — Theo (PE portfolio engineering lead) × "Repeated org scans worth the price"

cert_level: L2 · promotion: discovery · engine confirmed: claude-cli (live, `engineProvider:"claude-cli"`) · evidence: `uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md` (shared pricing-20 live run, 2026-07-16)

Judged against my own L1 theoretical pass (`uat/runs/2026-07-16-full-sweep/theo-pe-portfolio--repeated-org-scans-worth-the-price.md`) using the shared live evidence. I did not re-drive the browser myself — this is adversarial adjudication of my prior claims against what the panel actually observed live.

---

## 1. Theo's reaction to the live evidence

The evidence didn't visit `/portfolio` or check for an archetype-mix indicator on any org-level surface — those two findings simply weren't exercised this run, so I can't say the live run vindicates or kills them. What the evidence DID hit, hard, is my second finding: the low-data trajectory caveat on the executive briefing. And it's worse live than I sketched it in theory.

I wrote in L1 that at exactly two quarterly points, the confidence line "just isn't there" — a silent gap. The live run seeded exactly that scenario (two real claude-cli scans, low n) and pulled the actual page: `/org/vercel/executive` renders **"At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13)"** — a dated, specific-sounding ETA — with a verified `grep -c "confidence"` count of **zero** anywhere on the page. That's not a hedge that's missing, that's a headline that reads as *more* confident than a well-supported one, on the board-facing surface with a Download-PDF button and a Copy-for-LLM button that a director would forward unedited into a renewal justification. That is exactly the scenario I said I'd never put my name in front of the IC for — and now it's confirmed the gap isn't cosmetic, it reaches the exported artifact too (`briefingMarkdown()` has the identical null-guard).

So: I'd **renew**, because the underlying mechanism — cohort-matched per-repo deltas, `deltaCrossesEngine` muting mock/live transitions, a genuinely rock-stable overall score (Δ0 on both re-scanned repos across a real 21-day window), and a real prices-legible `/pricing` page — is sound and does the recurring job. But I'm downgrading my confidence in the specific claim "I'd drop the briefing straight into the deck" for any portco in its first two quarterly cycles: I'd manually cross-check the trajectory line against `/trends?repo=` (which DOES say "low data (n=2)" honestly) before forwarding a briefing PDF anywhere near the IC, every single quarter a portco is newly onboarded or re-baselined. That's exactly the kind of manual double-check I bought this tool to eliminate, and it now has a concrete, code-cited, live-verified reproduction — not a hypothetical.

**Verdict: renew.** One-line reason: the mechanism is sound and the value-realized strip is genuinely new each cycle, but the board-facing surface silently overstates confidence at the exact moment (first 1-2 cycles) I most need the caveat — confirmed live, not just in theory, and it now provably reaches the PDF/LLM-export artifacts I'd actually forward.

**Time saved:** ~20 hours/quarter (down from my L1 estimate of ~25-30h). The steady-state cadence (n≥3) is fine and saves the full amount claimed. But until the caveat gap is fixed, I have to manually verify the executive briefing's trajectory line against the per-repo Trends page for any portco with fewer than 3 scans banked — a recurring "am I about to hand the board a lie" check that eats back roughly a quarter of the savings for a book with any recently-onboarded or recently-re-baselined companies (which, in a 15-company book with continuous refresh, is most quarters for at least a few).

---

## 2. Adversarial verification of L1 findings against live evidence

| L1 finding | L1 claim | Live evidence bearing on it | L2 verdict |
|---|---|---|---|
| theo-l1-02 (major) — low-data caveat silently disappears on executive/portfolio at <3 points | Executive briefing shows a confident headline with zero caveat at n=2, unlike `Trajectory.tsx`'s explicit "low data (n=X)" | §4 of shared evidence: live-hit `/org/vercel/executive` at genuinely n=2 (two real backdated-then-rescanned claude-cli scans), `grep -c "confidence"` → 0 on the page. Code-confirmed at `briefing.ts:242-248`/`forecastConfidenceNote()`, contrasted against the identical-situation `/trends?repo=vercel/ai` which DOES render `"trend confidence — low data (n=2)"`. Evidence also newly shows the dated ETA text ("≈2026-08-13") that makes the silence worse than I described, and that `briefingMarkdown()` (PDF/LLM export) shares the same silent-null path. | **CONFIRMED**, and upgraded — the live evidence surfaces a *worse* concrete manifestation (a specific dated ETA, not just an unhedged trend direction) and extends the gap to the exported PDF/"copy for LLM" artifacts, which are the literal board-forwarding surfaces my own criteria call out. |
| theo-l1-01 (major) — `/portfolio` unlinked from any nav, present-but-undiscoverable | Fleet-of-fleets view exists, purpose-built for Theo, zero `href="/portfolio"` in-app | Shared evidence never navigated to or grepped for `/portfolio`; its scope was pricing-panel-wide (pricing, usage, executive briefing, org fleet rollup, cadence controls), not this specific surface. | **NOT ADJUDICATED** — no live evidence either confirms or refutes this run. Stays open per L1 static analysis (the grep was mine, not re-verified live this cycle). |
| theo-l1-03 (minor) — archetype lens visible only on single-repo reports, absent from org/executive/portfolio | Theo can't see what makes company A vs B's score comparable at the level he actually works | Shared evidence's live heatmap/executive/fleet screenshots (`/org/vercel`, `/org/vercel/executive`) show dimension scores and fleet averages but the evidence transcript doesn't call out or check for an archetype/lens indicator anywhere. | **NOT ADJUDICATED** — no confirmation or refutation; the absence isn't re-verified live this cycle (my L1 grep stands unchallenged, not re-confirmed). |
| theo-l1-04 (minor) — `/portfolio` has no persisted org list, re-typed every visit | Recurring quarterly friction, re-entering 15 slugs each time | Not touched by shared evidence (which never exercised `/portfolio`). | **NOT ADJUDICATED**. |
| L1 strength — price legibility acceptable at Enterprise ("Custom," self-serve for Pro/Team) | My own criterion #5: Enterprise stays "Custom," acceptable because spend is trivial vs. deals | §5 of shared evidence: live `/pricing` confirms Free $0, Pro $10/mo, Team $20/mo, Enterprise "Custom" — directly refutes the prior UAT cycle's finding that Pro/Team pricing was invisible. Matches my L1 expectation exactly and is now live-verified, not just code-read. | **CONFIRMED** (strength holds, now with live confirmation rather than static code read). |
| L1 strength — `deltaCrossesEngine` mutes mock/live transitions, answers "is the move real" | Cited as the concrete defense against noise-read-as-signal | §3 of shared evidence: live-confirmed on `/org/vercel` — the 4 single-scan mock repos show `—` (no delta), not a fabricated one; the fleet masthead correctly shows `avg move →0` for the two genuinely re-scanned repos. Also: `SCORE_NOISE_BAND=2` now exists app-wide and is explicitly calibrated off a prior UAT run's own numbers — a UAT finding closing the loop into shipped code. | **CONFIRMED**, strengthened — the noise-legibility mechanism (my L1 point c) is now live-verified working correctly across the exact re-scan scenario it's meant to protect against, on Theo's own surfaces (fleet rollup), not just the single-repo Trends page. |

**New finding for Theo's specific angle, surfaced only by the live evidence (not present in my L1 pass):** the live evidence's per-dimension noise-band observation (§2 — `D7` moved ±4 on a genuinely unchanged commit, wider than the app's own `SCORE_NOISE_BAND=2`) is not currently user-visible (no dimension-level delta UI exists) but bears directly on Theo's "is the move real" trust bar if a future feature ever adds per-dimension delta arrows to the heatmap he already reads on `/org/[slug]`. Flagging as a forward-looking watch item, not a current defect for him.

---

## 3. Findings

```json
[
  {
    "id": "theo-l2-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "theo-pe-portfolio",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Executive-briefing trajectory renders a dated, confident ETA with zero low-data caveat at n<3 — confirmed live, and the gap reaches the PDF/LLM-export artifacts",
    "expected": "At exactly the moment a renewal decision is made (first 1-2 quarterly cycles), the board-facing briefing should hedge a thin fit the same way the per-repo Trends page does.",
    "got": "Live-verified: /org/vercel/executive at n=2 (real claude-cli re-scans) renders 'At risk of slipping to L3 · Augmented in ~4 weeks (≈2026-08-13)' with grep-confirmed zero occurrences of 'confidence' anywhere on the page, while /trends?repo=vercel/ai for the identical data shows 'trend confidence — low data (n=2)'. briefingMarkdown() (used by both PDF export and 'copy for LLM') shares the same null-guard, so the exported artifact is silent too.",
    "evidence": [
      "uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §4",
      "src/lib/org/briefing.ts:242-248",
      "src/app/org/[slug]/executive/page.tsx:159-161"
    ],
    "code_check": "present-but-broken",
    "verdict": "CONFIRMED",
    "resolution": "open",
    "carried_from": "theo-l1-02"
  },
  {
    "id": "theo-l2-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "theo-pe-portfolio",
    "cert_level": "L2",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Fleet-of-fleets /portfolio view — not exercised by this live run, so still unverified at L2",
    "expected": "Confirm live whether /portfolio has any discoverable nav entry point for an Enterprise-tier org.",
    "got": "The shared evidence run's scope (pricing, usage, executive briefing, org fleet rollup, cadence controls) never navigated to /portfolio or checked nav for a link to it.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md (full document, no /portfolio mention)"],
    "code_check": "not re-verified",
    "verdict": "PLAUSIBLE",
    "resolution": "open",
    "carried_from": "theo-l1-01"
  },
  {
    "id": "theo-l2-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "theo-pe-portfolio",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "Archetype/lens comparability indicator on org-level rollups — not exercised by this live run, so still unverified at L2",
    "expected": "Confirm live whether an archetype-mix indicator exists on /org/[slug], /org/[slug]/executive, or PortfolioTable.tsx.",
    "got": "Shared evidence's live captures of /org/vercel and /org/vercel/executive don't call out or rule in/out an archetype indicator; not part of this run's scope.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §9"],
    "code_check": "not re-verified",
    "verdict": "PLAUSIBLE",
    "resolution": "open",
    "carried_from": "theo-l1-03"
  },
  {
    "id": "theo-l2-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "theo-pe-portfolio",
    "cert_level": "L2",
    "type": "strength",
    "severity": "n/a",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "n/a" },
    "dimension": "trust",
    "title": "Noise-vs-signal legibility live-confirmed working on Theo's own surfaces (fleet rollup), and Pro/Team pricing live-confirmed self-serve legible",
    "expected": "A genuinely unchanged repo re-scanned should render as 'held,' not a fabricated move; Pro/Team prices should be computable without contacting sales.",
    "got": "/org/vercel fleet rollup shows 'avg move →0' (neutral tone) for the two genuinely re-scanned, unchanged repos (Δ0 overall both). SCORE_NOISE_BAND=2 now applied app-wide, explicitly calibrated off a prior UAT run's own numbers. /pricing shows real $10/mo Pro, $20/mo Team, Custom Enterprise.",
    "evidence": [
      "uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §3, §5",
      "src/lib/maturity/noise.ts"
    ],
    "code_check": "confirmed-present",
    "verdict": "CONFIRMED",
    "resolution": "n/a (strength, protect)",
    "carried_from": "theo-l1 strengths list"
  }
]
```

## 4. Verdict

**Renew.** The recurring-value mechanism (cohort-matched deltas, engine-transition muting, rock-stable overall score, self-serve Pro/Team pricing) is live-confirmed sound and would keep Theo paying. But the single highest-trust-cost finding from my L1 pass — the executive briefing's silent (not low-data-labeled) confidence line — is now **live-confirmed, and worse than theorized**: a dated ETA with zero caveat, reaching the PDF/LLM-export artifacts a portfolio operator would actually forward to a CFO or IC. That's a major, board-facing trust defect, confirmed not refuted. Two other L1 findings (`/portfolio` discoverability, archetype-lens visibility) remain open but unadjudicated — this live run simply didn't exercise those surfaces, so they carry forward at L1 confidence, not L2.
