# L2 — Klaus (embedded firmware lead) × repeated-org-scans-worth-the-price

**cert_level: L2** — judged against the live shared evidence in `uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md` (real `claude-cli` scans of `vercel/ai` / `vercel/eve`, a genuine 21-calendar-day two-point history, and live loads of `/org/vercel`, `/org/vercel/executive`, `/trends?repo=vercel/ai`, `/usage?org=vercel`, `/pricing`). I did not re-drive the browser myself; I am reasoning from that evidence against my own L1 report and scored criteria.

## Character reaction (first person)

Same drill as last time: I set up monthly autoscans on a fleet that barely moves, and a top-up prompt made me ask again whether I'm paying for a flatline. Someone actually ran the experiment I asked for — two independent live scans of the same commit, 21 days apart on the calendar — so I have real numbers to look at instead of taking the product's word for it.

The economics hold. Overall score didn't move a point on either repo across that window (`80→80`, `75→75`). That's the load-bearing fact for my renewal and it's now been checked twice, by two different teams, on two different repos. Good.

The price question is closed, for real this time — not "present in the source" but rendered: `$10/month` for Pro, `$20/month` for Team, sourced from the one table the entitlement gate also reads. I can do the arithmetic on my own repo count without emailing anyone.

Now the part that actually matters to me — noise versus signal — got more interesting, and not entirely in the direction I'd have hoped. The good news: the mechanism I asked for exists and has a name now, `SCORE_NOISE_BAND`, calibrated directly off a prior UAT finding (mine, more or less — the same "rescan the same commit" experiment). It's wired into the digest and the movers formatting helper. The live evidence didn't hand me a clean test of whether my own Overview masthead — the page I actually open first — shows that flag on a nonzero-but-noise-band delta, because both my test repos happened to land on an exact zero. So that specific worry from my last pass is neither confirmed nor cleared; it's still open.

But here's what I didn't ask for and got anyway, and it's worse: the Executive Briefing — the one page with a "Download PDF" and "Copy for LLM" button, the exact page I'd forward to my director when he asks "are we behind on AI" — renders a dated, specific-sounding ETA ("at risk of slipping to L3 in ~4 weeks, ≈2026-08-13") with *zero* confidence caveat, on exactly the low-data situation (n=2) my quarterly cadence produces every single cycle. The identical low-data case on the per-repo Trends page says the honest thing — "trend confidence — low data (n=2)." Same underlying flag, same root cause, one surface tells the truth and the one that leaves my organization does not. That's not a hypothetical for me — n=2 isn't an edge case for a firmware fleet, it's the modal case. If I ever hit "Copy briefing for LLM" and paste that ETA into a memo for my director, I'd be reporting upward a number the product itself can't stand behind, and it wouldn't tell me that.

Nothing in the live evidence touched the lens-fit problem — nobody ran a real embedded repo through the scanner this round, so I can't confirm or refute whether the roadmap still nags a certified-firmware fleet toward L5 autonomy. That one's untested at L2, not resolved.

**Verdict: RENEW (conditionally, downgrade-watch — unchanged from L1, but the specific thing that would tip me over got more concrete, not less).** The dedup-and-refund fact is now proven twice over and that's most of my monthly bill decision. But I now have a named, board-facing failure mode instead of a suspected one: the one export surface built for "report this upward" will hand my director a confident date with no asterisk on the exact low-data profile my repos always produce. That's closer to my churn trigger than it was last week, not further.

**Time saved: ~15–20 min/month realized** (down from my L1 estimate of ~20–30). The dedup/refund fact still saves the full ~20-30 min of "did this bill me for nothing" checking. But I now have to spend some of that back double-checking any Executive Briefing ETA by hand before I'd forward it — exactly the "negative time-saved" failure mode my own acceptance criteria warned about, just localized to one surface instead of the whole product.

## Findings

```json
[
  {
    "id": "klaus-price-now-visible-strength",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "klaus-embedded-firmware",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "polish",
    "dimension": "clarity",
    "title": "STRENGTH confirmed live: /pricing renders real Pro $10/mo and Team $20/mo, single-sourced from plans.ts",
    "verdict": "CONFIRMED",
    "resolution": "resolved-verified",
    "evidence_from_shared": "_L2-shared-pricing-evidence.md §5 — live GET /pricing table: Free $0, Pro $10/month, Team $20/month, Enterprise Custom; directly refutes the 2026-06-20 report's L2-04 finding that price was invisible.",
    "note": "L1 asked L2 to confirm the cards literally paint '$10 / month' next to the feature list on a live load, not just in source. Done — shared evidence's §5 table is exactly that live confirmation."
  },
  {
    "id": "klaus-dedup-refund-strength",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "klaus-embedded-firmware",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "polish",
    "dimension": "trust",
    "title": "STRENGTH confirmed live: an unchanged-commit rescan is free — the shared evidence's own seed methodology had to deliberately mangle a headSha to force a second billable-looking scan",
    "verdict": "CONFIRMED",
    "evidence_from_shared": "_L2-shared-pricing-evidence.md §1 step 2 (had to append '-backdated21d' to the stored headSha specifically to dodge the same-commit dedup constraint) and §5's pricing-page credits table: 'Re-scan an unchanged commit — Cached ... never costs a credit ... Free, Included [all tiers]'.",
    "note": "Stronger confirmation than a mere code trace: the evidence-gathering process itself only worked BECAUSE dedup fired on the real same-commit rescan, which is closer to a live behavioral proof than L1's static code_check."
  },
  {
    "id": "klaus-overview-movers-noise-guard-inconclusive",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "klaus-embedded-firmware",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "Whether the Overview masthead/per-repo rows show a noise flag on a nonzero-but-within-band delta remains untested — the live two-point pair happened to land on an exact Δ0, which trivially renders 'holding' with or without a noise-band mechanism",
    "verdict": "PLAUSIBLE (inconclusive, not confirmed or refuted)",
    "evidence_from_shared": "_L2-shared-pricing-evidence.md §3: 'the Fleet rollup on /org/vercel renders vercel/ai and vercel/eve ... as →0 avg move (neutral tone, not styled as a fall)' — both repos' overall score genuinely didn't move, so this doesn't distinguish 'noise-band-aware rendering' from 'zero literally renders as holding regardless.' §2 shows the underlying per-dimension swing (±4 on D7) that COULD have produced a nonzero overall move never actually surfaced one this cycle.",
    "note": "The evidence's own §3 claims format.ts's noise-band fmtDelta/toneFor is 'applied everywhere a delta renders' but only explicitly names the digest and lib/alerts.ts as call sites, not RepoCategoryRollup on Overview by name. My original L1 majoro concern — is the noise flag co-located with the delta on the page I open first — is not resolved by this evidence either way."
  },
  {
    "id": "klaus-executive-briefing-eta-no-confidence-NEW",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "klaus-embedded-firmware",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "NEW (surfaced by shared evidence, not in my L1 pass): the Executive Briefing's dated trajectory ETA — the board/PDF/LLM-export surface — renders with ZERO confidence/low-data caveat on the exact low-data (n=2) profile a quarterly-cadence firmware fleet always produces, while the identical situation on /trends is honest",
    "verdict": "CONFIRMED",
    "evidence_from_shared": "_L2-shared-pricing-evidence.md §4: live /org/vercel/executive renders 'At risk of slipping to L3 · Augmented in ~4 weeks (≈2026-08-13)' with zero occurrences of the word 'confidence' anywhere on the page (grep-verified), while /trends?repo=vercel/ai for the identical n=2 case renders 'trend confidence — low data (n=2)'. Root-caused to src/lib/org/briefing.ts:242-248 and forecastConfidenceNote() returning null (renders nothing) instead of the honest low-data string Trajectory.tsx already has. Confirmed the same null-guard also silences briefingMarkdown() (the PDF/'copy for LLM' export).",
    "why_it_matters_for_klaus": "This is precisely his JTBD #2 ('trust that a score move reflects the repo, not LLM wobble, before I act on it or report it upward') and his acceptance criterion 'noise vs signal ... where the move is shown.' His cadence (a few changes a quarter) means n=2-3 low-data trajectories are his NORMAL case, not an edge case — so this bug hits him on essentially every cycle he'd use the Executive page for its intended purpose (reporting to his director).",
    "l2_priority_for_future": "Fix is cheap per the shared evidence: reuse Trajectory.tsx's existing 'low data (n=X)' string, gated on forecastHeadline alone rather than forecastConfidence != null."
  },
  {
    "id": "klaus-lens-fit-embedded-unchanged",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "klaus-embedded-firmware",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "senior-quality",
    "title": "No embedded/safety-critical archetype; L5-Autonomous still framed as the unqualified apex — untested by the live evidence this round",
    "verdict": "UNTESTED (carried forward, not confirmed or refuted at L2)",
    "evidence_from_shared": "The shared evidence run scanned vercel/ai and vercel/eve (JS/TS web tooling), not a C/C++/Rust embedded repo, and did not touch RepoArchetype or LEVELS/roadmap copy. No live signal either way.",
    "note": "L1's l2_priority #4 ('scan a real embedded C/C++ repo, check whether the roadmap pushes autonomy') was not exercised by this shared run. Remains open exactly as L1 left it — code-level, by-design, unconfirmed live."
  },
  {
    "id": "klaus-trajectory-starved-by-velocity",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "klaus-embedded-firmware",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "missing",
    "title": "STRENGTH-with-caveat confirmed live: low-data (n=2) trend confidence renders honestly on /trends, and the fleet-wide GPS card is confirmed to live one hop away from Overview (on /executive), matching L1's description exactly",
    "verdict": "CONFIRMED",
    "evidence_from_shared": "_L2-shared-pricing-evidence.md §1/§45: /trends?repo=vercel/ai with exactly 2 scans renders 'trend confidence — low data (n=2)' per forecast.ts's lowData: n<3 guard, and forecastHeadline reads 'Holding around 80 (L4 · Integrated) — no level change projected' — an honest flat-verdict, exactly the wording my acceptance criteria asked for. Separately confirms L1's observation that this card is not on /org/[slug] itself.",
    "note": "This is the good twin of the new executive-briefing finding above: same lowData flag, correctly handled on /trends, incorrectly silenced on /executive. Both are now live-confirmed facts, not code inferences."
  }
]
```

## Adversarial verification notes

- I checked whether the shared evidence's "→0 avg move" language on the Fleet rollup could be read as confirming my L1 "no noise guard" finding is now *resolved*. It cannot — a literal Δ0 renders as "holding" trivially under the pre-existing `▲/▼/→` categorization scheme with or without a noise-band mechanism behind it. The evidence does not contain a nonzero-but-within-±2-band delta rendered anywhere on the Overview masthead/rows, so I'm marking that finding inconclusive rather than either confirming or refuting it — resisting the temptation to claim a win the data doesn't support.
- I checked whether the new Executive Briefing finding might be a false generalization from a single org (`vercel`) that isn't representative of Klaus's slow cadence. It isn't — the bug is root-caused in shared evidence to the `lowData` boolean and a `!= null` guard, which fires precisely at `n<3` regardless of domain; a firmware fleet with quarterly changes will spend most of its life at `n<3`, making this MORE relevant to Klaus than to a fast-moving org like the one actually tested.
- I did not carry forward the shared evidence's `/usage` low-balance-banner bug (finding in shared evidence §6) as a Klaus finding — it's scoped to a fresh Free-tier org with untouched allowance, and Klaus is an established Pro-tier renewal, not a Free-tier evaluator. Noting it here only to explain the omission, not counting it toward his score.
