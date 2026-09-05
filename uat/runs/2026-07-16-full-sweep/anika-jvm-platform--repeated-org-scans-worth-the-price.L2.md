# L2 — Anika (JVM platform lead) × repeated-org-scans-worth-the-price

**Verdict: RENEW (Enterprise) — conditional, and now conditional on two things instead of one.** The shared live evidence reconfirms the fleet-legibility and noise-defense upgrades I credited last cycle, and adds real numbers behind the repeatability claim I could previously only read from code. It does **not** touch my top finding — no JVM/Gradle repo was in the live sample, so the `.kts` blind spot is neither confirmed nor refuted by new evidence, only carried forward unverified. But the shared run surfaces a **new major finding on the board-facing Executive Briefing** that lands squarely on my own "tell a real move from noise" criterion, and it's arguably worse than the one I already had my eye on, because it's the exact surface I hand to a VP.

## Character reaction (first person)

Renew or churn? Renew — I'm Enterprise, and nothing in this evidence moves the price question, it was never the lever. Would I renew *enthusiastically* versus *on principle*? Still on principle, same as last time, and today it's a closer call than it was.

Start with what got stronger. The repeat-scan evidence is the real thing this time, not a code trace — two independent live claude-cli scans, 21 real calendar days apart, same commit, and the overall score didn't move at all on either repo (80→80, 75→75). That's exactly the "did it wobble when nothing changed" test I care about most, and it held. Good. I'll take Δ0 on an unchanged repo over almost anything else this tool could show me.

But look one level down and the news is mixed. The per-dimension swing this time was **±4** (a "Commits" dimension moving 98→94), wider than the ±1 the team's own noise constant was calibrated against last cycle. That constant — `SCORE_NOISE_BAND = 2` — is now demonstrably tighter than what a real, nothing-changed re-scan can produce at the dimension level. Nobody's shipped a per-dimension delta arrow yet, so today this doesn't actively mislead me — but it means the thing I flagged last time as "uncertain, worth checking with real data" is now confirmed as a real risk, and it's a bigger one than the constant currently assumes. If someone ships a heatmap delta next quarter using that constant unchanged, it'll flag noise as signal on my fleet.

Then the new one. The Executive Briefing — the "Download PDF" / "Copy for LLM" page, the one built to leave the building — renders a dated, specific-sounding trajectory ("at risk of slipping to L3 in ~4 weeks, ≈ 2026-08-13") with **zero confidence caveat**, on data that's exactly as thin (n=2, low-data) as the per-repo Trends page for the same org, which *does* say "trend confidence — low data (n=2)" for the identical situation. Same underlying flag, one honest render, one silent one — and the silent one is the one with the PDF button. This is not a hypothetical for me. That's the exact document I'd forward to a VP without re-deriving it myself, and it's precisely the "can she tell a real move from noise" question my entire recurring-value case rests on. A confident-looking dated ETA with nothing under it is worse than no forecast at all, because it *looks* like a claim I could defend and isn't one.

So: two trust gaps sit alongside each other now, and they're not equally cheap to reason about. The `.kts` gap is a data-input problem — wrong the same way every cycle, I can price that risk once I know it's there and mentally discount those repos. The briefing gap is a presentation problem on my highest-stakes artifact — I might not catch it until a VP asks "how sure are we" and I have no answer on the page I already sent them. If I had to rank which one costs me more this cycle, it's this one, and it's new.

Do I still trust the fleet-legibility story? Yes, unreservedly — nothing here contradicts it, and the noise-band application to movers/digest is now demonstrated live (a genuinely flat pair rendering `→0` neutral, not a colored delta) rather than just read from source. That part of my L1 read stands as confirmed, not just plausible.

Would I tell a peer? Similar to last time, with an addition: "the recurring math is more trustworthy than it was, and I've now seen the noise-suppression actually fire on a real repeat scan — but before you forward the executive briefing to your VP, sanity-check the confidence line for yourself, because right now the app doesn't put one there when it should."

## Findings (impact-scored)

```json
[
  {
    "id": "anika-jvm-gradle-kts-still-missed",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "anika-jvm-platform",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "major",
    "verdict": "CARRIED-UNVERIFIED",
    "title": "Gradle Kotlin-DSL build manifests still not fetched/detected — L1 finding neither confirmed nor refuted by this cycle's live evidence (no JVM repo in the shared sample)",
    "note": "The shared L2 run scanned vercel/ai and vercel/eve twice each (both TS/JS repos) plus 4 mock vercel repos. No build.gradle.kts-only repo was live-scanned in this cycle, so I cannot upgrade this from L1 code-trace to L2 live-confirmed. The code paths cited in L1 (source.ts:613-654 picker, source.ts:687-695 sampler regex, analyze/index.ts:48 manifestText regex) were not re-read this pass but nothing in the shared evidence indicates they changed. Carried forward as-is; still my top blocker for full trust.",
    "l2_priority_still_open": "Scan a real build.gradle.kts-only repo live twice; this remains undone."
  },
  {
    "id": "anika-repeatability-confirmed-live",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "anika-jvm-platform",
    "cert_level": "L2",
    "type": "trust",
    "severity": "polish",
    "verdict": "CONFIRMED",
    "title": "STRENGTH, upgraded from code-trace to live-confirmed: overall score is Δ0 across two independent live claude-cli scans of the same unchanged commit, 21 real days apart",
    "expected": "A re-pullable read that doesn't wobble when nothing changed.",
    "got": "vercel/ai 80→80, vercel/eve 75→75, both genuinely independent live claude-cli scans of the same headSha. Fleet rollup renders both as `→0` neutral-toned, not a colored fall/rise.",
    "evidence": ["shared L2 evidence §2", "shared L2 evidence §3"]
  },
  {
    "id": "anika-per-dimension-noise-floor-wider-than-calibration",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "anika-jvm-platform",
    "cert_level": "L2",
    "type": "trust",
    "severity": "minor",
    "verdict": "CONFIRMED",
    "title": "L1's 'same-engine guardband wobble still unlabelled' finding (previously marked uncertain) is now confirmed real and larger than the app's own SCORE_NOISE_BAND assumes",
    "expected": "If a per-dimension delta is ever shown, its noise threshold should reflect the actual observed swing on an unchanged repo.",
    "got": "This cycle's real repeat-scan sample showed a ±4 per-dimension swing (D7 'Commits' 98→94 on vercel/ai) against the app's calibrated SCORE_NOISE_BAND=2 — a real, unchanged-repo swing that would exceed the noise band if a dimension-level delta UI existed. Not currently user-visible (no per-dim delta is rendered anywhere), so today this doesn't mislead me, but it upgrades my prior 'uncertain' L1 finding to a confirmed, quantified risk that any future per-dimension delta feature needs to account for before shipping.",
    "evidence": ["shared L2 evidence §2", "src/lib/maturity/noise.ts"],
    "prior_l1_id": "anika-same-engine-guardband-wobble-still-unlabelled"
  },
  {
    "id": "anika-exec-briefing-confidence-caveat-missing",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "anika-jvm-platform",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "major",
    "verdict": "CONFIRMED",
    "new_finding": true,
    "title": "NEW: the Executive Briefing — my board/VP artifact — renders a confident, dated trajectory ETA with zero confidence/low-data caveat, on the exact same underlying data that the per-repo Trends page correctly caveats",
    "expected": "The document with the Download-PDF and Copy-for-LLM buttons — the one I actually forward — should carry the same 'trend confidence — low data (n=X)' honesty the per-repo page already has for identical low-data situations, since this surface is precisely where 'is this a real move or noise' matters most.",
    "got": "/org/vercel/executive renders 'At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13)' with zero confidence text anywhere on the page (grep count 0), while /trends?repo=vercel/ai for the same org and the same low-data (n=2) forecast explicitly renders 'trend confidence — low data (n=2)'. Root cause: briefing.ts's forecastConfidenceNote() returns null on low-data instead of substituting the honest string Trajectory.tsx already has, so the page's conditional render shows nothing. The same guard silences the PDF/LLM-export markdown too.",
    "evidence": ["shared L2 evidence §4", "src/lib/org/briefing.ts:242-248", "src/app/org/[slug]/executive/page.tsx:159-161"],
    "why_this_character": "This is the single most consequential surface for Anika specifically: it's explicitly the artifact she takes external, unedited, to a VP to prove the rollout is landing. A dated ETA with no caveat fails her exact 'tell a real move from noise' acceptance criterion on her highest-stakes page — worse than a wobble she can eyeball, because there's nothing on the page signaling she should distrust the number."
  },
  {
    "id": "anika-price-legibility-confirmed",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "anika-jvm-platform",
    "cert_level": "L2",
    "type": "trust",
    "severity": "polish",
    "verdict": "CONFIRMED",
    "title": "Price-legibility criterion met as expected at her tier: /pricing correctly shows Enterprise as 'Custom — contact us', consistent with her stated expectation that unseen $ isn't a blocker at her tier",
    "evidence": ["shared L2 evidence §5"]
  },
  {
    "id": "anika-fleet-legibility-strength-reconfirmed",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "anika-jvm-platform",
    "cert_level": "L2",
    "type": "trust",
    "severity": "polish",
    "verdict": "CONFIRMED",
    "title": "L1 strength finding (fleet legibility upgrade / RepoCategoryRollup masthead) reconfirmed live via the shared evidence's Fleet-rollup readout, not just source",
    "got": "Shared evidence §9 shows the live masthead line rendering exactly as the L1 pass described from code: '6 repos, avg 72, ▲0 ▼0 →2, avg move →0, 4 mock' — matches the pattern (repos/avg/climbed/slipped/held/avgmove/mock) I asked for.",
    "evidence": ["shared L2 evidence §3", "shared L2 evidence §9"]
  }
]
```

## Adversarial verification of L1 carry-forward

- **`anika-jvm-gradle-kts-still-missed` (L1 major, confirmed-by-code)** → **not upgradeable this cycle.** The shared live run scanned only TS/JS repos (`vercel/ai`, `vercel/eve`) plus mock `vercel` repos. No `.kts`-only repo was exercised live, so I have no new evidence either way. Marking it carried-forward-unverified rather than re-asserting "confirmed" at L2, in the interest of not inflating my own finding with evidence that doesn't actually speak to it. This remains open and is still, in my judgment, the single highest-leverage fix for my trust in the tool.
- **`anika-same-engine-guardband-wobble-still-unlabelled` (L1 minor, verdict "uncertain")** → **upgraded to confirmed**, with a sharper number: the shared evidence's real ±4 per-dimension swing (vs. the app's own SCORE_NOISE_BAND=2) is direct proof the risk is real, not hypothetical, though it doesn't yet manifest as a misleading UI element since no per-dimension delta is rendered anywhere today.
- **`anika-strength-fleet-legibility-upgrade` (L1 polish, confirmed-absent/strength)** → **reconfirmed at L2** with an independent live readout matching the code-level description.
- **`anika-per-practice-adoption-rate-still-absent` (L1 minor)** → shared evidence does not touch the Practices page at all; carried forward unverified, no new evidence.
- I did not manually re-drive the browser for this pass, per instructions — all verdicts above are reasoned from the shared evidence file plus the cited L1 code-locations, which I did not re-read live this cycle (noted where relevant).

## Time-saved and pricing verdict (L2)

- **Time-saved estimate: ~18 hours/cycle** (down slightly from L1's ~20h). The fleet-legibility saving is now live-confirmed, so I'm keeping most of the ~20h I credited last time. I'm shaving ~2h off for the new executive-briefing gap: on a cycle where the fleet is genuinely near a level-change, I'd now have to independently sanity-check the ETA myself before trusting the PDF I'd otherwise forward straight to a VP — that's exactly the kind of manual double-check the tool was supposed to remove.
- **Verdict: RENEW** (Enterprise, price is not the lever) — **conditional on two fixes now, not one**: (1) feed the `.kts` parser real content (unchanged priority from L1), and (2) put the same low-data confidence caveat on the Executive Briefing that `/trends` already has, before I trust the PDF/LLM-export artifact enough to stop personally re-checking it. Neither is a churn trigger at my tier — I'm not walking away from an Enterprise contract over two named, cheap-to-fix gaps — but both keep this a "yes, on principle" renewal rather than an enthusiastic one.
