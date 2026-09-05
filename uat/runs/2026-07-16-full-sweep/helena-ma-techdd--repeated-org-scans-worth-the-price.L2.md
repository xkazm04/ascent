# L2 report — Helena (M&A tech DD advisor) x "Repeated org scans worth the price"

Cert level: **L2 (live evidence)**. No new browser driving performed by this pass — reasoning is against `_L2-shared-pricing-evidence.md`, the one live `claude-cli` ground-truth run for the pricing-20 panel (2026-07-16, org `vercel`).

---

## 1. Helena's reaction to the live evidence

"Two things changed the moment I saw the real thing instead of the source code.

First, the good one: the noise-band story holds up under an actual repeat scan. You re-ran the same commit 21 days apart, live, twice, and the overall score didn't move a single point on either repo — and the UI reads that as `→0`, held, not a fake fall or a fake rise. That's the exact 'don't dress a wobble as a regression' behavior I need, and now I've seen it survive contact with a real re-scan, not just a code comment promising it. Good.

Second, the one that actually worries me: I go to the board-ready page — the one with the Download PDF and Copy-for-LLM buttons, the one a client's CFO would see verbatim — and it tells me, with a specific date, 'At risk of slipping to L3 in ~4 weeks (≈2026-08-13).' No caveat. No 'n=2.' Nothing. Meanwhile the plain per-repo trends page, looking at the *exact same two data points*, has the decency to say 'trend confidence — low data (n=2).' That's not a small inconsistency to me — that's the one line item I would have bet money on, because your own code comment brags about not doing exactly this. If I paste that briefing into a deal memo unedited — which is the entire selling point of the Copy-for-LLM button — I'm handing an acquirer's investment committee a dated ETA built off two data points with nobody, including the product, flagging that it's thin. That's precisely the finding I can't defend in a data-room Q&A, and it would be *my* name on it, not yours.

On the pricing side: real numbers, finally, on the subscription — $10, $20, plainly stated, no 'prepaid credits' fog for the thing most people actually pay for. That part I'm satisfied with; it wasn't re-tested live this round but nothing in the fresh evidence contradicts it and the source (`plans.ts`) is the same object billed and shown, so I'll take the L1 read as still good. But nobody actually clicked through to the credit-pack checkout this round, so my sharpest complaint from before — I still can't see a dollar sign on the *burst* pack anywhere inside the product — is neither confirmed fixed nor refuted. Still open, still unproven either way.

The prose I was worried would be generic filler — 'add more tests,' template noise — turned out specific: 'Agent guidance is thin ... ≈+9.3 maturity pts on each of 3 repos if closed ... affects next.js, v0-sdk, vercel.' Repo-named, quantified, tied to a real weak dimension I can see on the fleet heatmap (Agentic 33, Security 52). That's something I'd actually cite. Good.

Verdict: **conditional renew.** I'd use it for the deal in front of me — the export exists, the price is honest where I checked it, and the underlying stats discipline is real. But I will not paste the executive briefing's trajectory line into a client deliverable until that page hedges its own ETA the way the trends page already does two clicks away. Until then I'm manually adding my own caveat on top of your PDF, which defeats half the point of paying for a 'defensible artifact.' Fix that one line and I upgrade this to an unconditional renew.

Time saved: my own math holds — **roughly 3 hours per in-window re-scan cycle** (I'm reading a real, quantified 'what changed' section instead of re-diffing the target myself), **~30-60 hours across a 4-6 week deal** — contingent on that briefing page telling me the truth about its own confidence, which right now it does everywhere except the one page I'd actually forward."

---

## 2. Verification of L1 findings against the live evidence

### L1-HEL-01 — credit-pack $ not shown in-app (major)
**Status: NOT ADDRESSED by this evidence — carried forward unverified, still open.**
The shared L2 evidence run did not drive `CreditsControl` or the Polar sandbox checkout at all (its scope was pricing-page legibility, usage banner, trajectory/noise, and export content — see its §5-§8). L1's code citation (`src/lib/polar.ts` `CreditPack` has no price field; `CreditsControl` links straight to `/api/billing/checkout`) is unrebutted by anything in the live run. I am not weakening this finding, but I'm marking it **unverified-live** rather than confirmed-live: nobody has actually clicked "Buy credits" this cycle and reported what the sandbox checkout shows. Keeps its severity (major) and its L2 priority for a future pass that actually drives that flow.

### L1-HEL-02 — heatmap shows raw scores, no delta/noise framing (minor)
**Status: NOT DIRECTLY RE-TESTED, but adjacent evidence is consistent with L1's read.**
The live evidence (§3, §9) confirms the *Fleet rollup* card correctly renders noise-muted `→0` deltas, and separately reports the dimension heatmap fleet averages as flat numbers with no delta framing mentioned — consistent with L1's finding that the heatmap is a same-page-but-separate, delta-blind surface from the Fleet card. Nothing in the live evidence contradicts L1-HEL-02; it's neither newly confirmed nor refuted by a targeted click, so it stays **open, unverified-live**, severity unchanged (minor).

### L1-HEL-03 — prose quality unverifiable at L1 (minor, marked "uncertain")
**Status: CONFIRMED-LIVE — resolved in the positive direction.**
The live executive briefing's "move to make next" text (§8) is real, specific, and quantified: *"Agent guidance is thin ... AI Tooling · ≈+9.3 maturity pts on each of 3 repos if closed ... affects 3 repos: next.js, v0-sdk, vercel"* — tied to the fleet's actual weakest dimensions (Agentic 33, Security 52, confirmed against the live heatmap in §9). This is not generic "add more tests" filler; it would pass her senior-quality bar for citability in a deal memo. I'm closing L1-HEL-03 as **confirmed / resolved-positive** — this is a strength, not an open finding, going forward for her journey.

### Strength (L1) — trajectory honesty ("exactly her bar")
**Status: PARTIALLY REFUTED — the design intent is real but one high-stakes surface breaks it.**
L1 rated this her strongest pass, citing `forecastTrajectory`'s `lowData` guard and the per-repo Trends page's honest "low data (n=X)" copy — and the live evidence *does* confirm that exact page works as designed (§3: `/trends?repo=vercel/ai` renders `trend confidence — low data (n=2)`, an honest "holding, no level change projected" read on the identical two-point series). So the underlying statistical discipline L1 praised is real and live-confirmed on that surface.

But the live evidence also surfaces something L1's code-only read missed: the **executive briefing** — the specific surface she'd export and forward — uses a *different* code path (`forecastConfidenceNote()` returning `null` on `lowData` instead of substituting the honest string) that silently drops the caveat instead of stating it, and prints a dated, specific-sounding ETA with zero hedge. L1 treated `briefing.ts`'s suppression-of-a-bogus-100% as fully equivalent to the trends page's honest hedge; live evidence shows it is not equivalent — one path is honest-by-substitution, the other is honest-by-silence, and silence reads to a viewer as confidence, not caution. **This downgrades her single strongest L1 finding from "pass, as designed" to "pass on the surface she doesn't export, fail on the surface she does."** Given the export surface is the entire point of her journey (board-ready artifact, Copy-for-LLM, PDF), this is the most consequential single fact this L2 pass adds to her file.

---

## 3. New finding for this journey (Helena's angle)

**[major, NEW-to-Helena, carried from shared evidence]** — The org-level Executive Briefing's trajectory headline renders a confident, dated ETA (e.g. "≈2026-08-13") with **zero** confidence/low-data caveat on `n=2` data, on the exact surface with the "Download PDF" and "Copy briefing for LLM" buttons she would forward unedited to a client. The identical `lowData` situation is correctly hedged on the per-repo Trends page two clicks away. Root cause: `src/lib/org/briefing.ts:242-248`'s `forecastConfidenceNote()` returns `null` on low data (silently drops the line) instead of substituting the honest "low data (n=X)" string that `Trajectory.tsx` already has. `briefingMarkdown()` shares the same guard, so the exported PDF/markdown artifact is silent too, not just the HTML page.

This lands squarely on her **"Trajectory honesty over a short window"** and **"senior-quality bar"** scored criteria — both previously rated "pass, as designed" at L1 — and specifically on the artifact she'd file in a data room. Severity: major, trust-eroding, and the shared evidence's own assessment ("fix is cheap — reuse the exact string `Trajectory.tsx` already has") matches what she'd tell a vendor: this is a one-line fix, not an architecture problem, which is exactly the kind of gap that makes her more annoyed, not less, because it should have been free to get right.

Two other shared-evidence findings (the `/usage` low-balance banner miscalibration, §6; the wider per-dimension noise floor, §2) don't bear materially on Helena's specific scored criteria — she doesn't touch `/usage`'s private-credit banner in her typical Free-plus-burst pattern, and the per-dimension noise finding isn't user-visible in any surface she reads. Noting them as out-of-scope for her rather than omitting them silently.

---

## 4. Findings

```json
[
  {
    "id": "L2-HEL-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "helena-ma-techdd",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Executive-briefing trajectory ETA renders with zero confidence/low-data caveat on the exact board/PDF/LLM-export surface she'd forward to a client, while the per-repo Trends page hedges the identical situation",
    "expected": "The exported deal artifact (PDF / Copy-for-LLM markdown) hedges a trajectory ETA drawn from n<3 data the same way the per-repo Trends page does, so she never has to add her own caveat on top of the product's export.",
    "got": "Live at /org/vercel/executive: 'At risk of slipping to L3 · Augmented in ~4 weeks (≈2026-08-13).' with zero 'trend confidence' text anywhere on the page (grep count 0), off n=2 data. The identical n=2 series on /trends?repo=vercel/ai renders 'trend confidence — low data (n=2)'. Root cause: src/lib/org/briefing.ts forecastConfidenceNote() returns null on lowData instead of substituting the honest string Trajectory.tsx already has; briefingMarkdown() shares the guard so the PDF/markdown export is silent too.",
    "evidence": ["_L2-shared-pricing-evidence.md §4", "src/lib/org/briefing.ts:242-248", "src/app/org/[slug]/executive/page.tsx:159-161"],
    "code_check": "confirmed-live",
    "verdict": "confirmed",
    "resolution": "open",
    "note": "Downgrades L1's 'trajectory honesty — pass, as designed' strength finding for the specific surface (executive briefing / exported artifact) she actually uses; the per-repo Trends page still passes as L1 described."
  },
  {
    "id": "L2-HEL-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "helena-ma-techdd",
    "cert_level": "L2",
    "type": "carried-unverified",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Prepaid credit-pack $ price still not confirmed live one way or the other (L1-HEL-01 not re-driven)",
    "expected": "L2 evidence would confirm or refute whether the burst-credit price appears in-app or only after redirecting to Polar checkout.",
    "got": "The shared live evidence run did not exercise CreditsControl or the Polar sandbox checkout; L1's code-grounded finding (no price field on CreditPack, price only visible after external redirect) is neither confirmed nor refuted live this cycle.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/helena-ma-techdd--repeated-org-scans-worth-the-price.md (L1-HEL-01)", "_L2-shared-pricing-evidence.md (no CreditsControl coverage)"],
    "code_check": "not-tested-this-cycle",
    "verdict": "confirmed",
    "resolution": "open",
    "note": "Carried at L1's original severity; flagging for a future L2 pass that actually drives Buy Credits -> Polar sandbox checkout."
  },
  {
    "id": "L2-HEL-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "helena-ma-techdd",
    "cert_level": "L2",
    "type": "resolved-positive",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "Executive-briefing leverage-move prose is specific and citable, not generic filler (closes L1-HEL-03)",
    "expected": "N/A (verification item from L1).",
    "got": "Live 'move to make next' text names concrete repos and a quantified point gain tied to real fleet weak dimensions: 'Agent guidance is thin ... AI Tooling · ~+9.3 maturity pts on each of 3 repos if closed ... affects next.js, v0-sdk, vercel', cross-checked against the live heatmap (Agentic 33, Security 52).",
    "evidence": ["_L2-shared-pricing-evidence.md §8, §9"],
    "code_check": "confirmed-live",
    "verdict": "confirmed",
    "resolution": "closed",
    "note": "Would pass her senior-quality bar for a deal-memo citation."
  }
]
```

## 5. Strength reaffirmed (with the caveat above)
- Repeat-scan stability is real, not just theoretical: two independent live `claude-cli` scans of the same commit, 21 days apart, moved the overall score 0 points on both repos, and the Fleet card correctly renders `→0` neutral rather than a fake move. The noise-band machinery (`SCORE_NOISE_BAND`, `isWithinNoise`) she'd have distrusted on principle survived an actual repeat test. Do not regress.
- Subscription pricing ($10/$20/mo, real numbers) remains legible per the shared evidence, consistent with L1.

---

## 6. Verdict

**Conditional renew.** Pricing for the thing most buyers pay for (subscription) is honest; the statistics discipline she cares about most (noise-band, low-data hedging) is real and live-confirmed on the surface built to demonstrate it (Trends page) — but fails on the one surface that actually leaves her hands (the exported executive briefing), which is a major, board-facing, trust-eroding gap for exactly her use case. She'd use the product for the deal in front of her but would not forward the trajectory line unedited until it's fixed, and her burst-credit price question remains genuinely unanswered (not refuted, just untested this cycle).

**Time saved:** ~180 minutes (3 hours) per in-window re-scan cycle; ~30-60 hours across a full 4-6 week deal — contingent on the executive-briefing caveat gap being fixed, since until then she spends part of that saved time re-adding her own confidence caveat by hand.
