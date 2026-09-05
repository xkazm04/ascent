# L2 (live-evidence-verified) — Yusuf (bootstrapped Rails eng lead) × "Repeated org scans: worth the price?"

cert_level: L2 · verdict: **downgrade, trending toward churn** (not renewed at full trust — right-sizes hard, and one confirmed lie moves him from "downgrade" to "gone")

Evidence base: `uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md` (live claude-cli run, 2026-07-16, org `vercel`, two genuinely re-scanned repos 21 real days apart). This L2 does not re-drive the browser; it reasons from that shared evidence against my own L1 findings and scored criteria.

---

## 1. First-person reaction to the live evidence

"Alright, you actually went and re-scanned the same commit three weeks apart for real, not in my head this time. Let's see what held up.

The good part first: `vercel/ai` and `vercel/eve` came back **exactly flat, overall** — 80→80, 75→75 — and the Fleet row rendered `→0`, neutral tone, not a fake arrow. That's the mechanism I said I trusted in my L1 walkthrough (`isWithinNoise`/`SCORE_NOISE_BAND`), and now it's not a code-read, it's a live re-scan. Confirmed. I'll take that as an actual win — the row-level noise gate wasn't vaporware.

But two things in this evidence are worse for me than what I predicted, not better.

First — my own top L1 finding was that the Briefing's 'Value this period' line prints a raw, unguarded point delta. This run happened to land on an org-level delta of *exactly* zero, so that specific sentence never got exercised — I can't say 'confirmed' on that one, I can only say 'not stress-tested, still standing on the code read.' But then you show me something worse on the *same tab*: the Executive Briefing's Trajectory line says **'At risk of slipping to L3 in ~4 weeks (≈ 2026-08-13)'** — a specific calendar date — off n=2 data points, with **zero confidence caveat anywhere on the page**. The per-repo Trends page, same org, same data, says the honest thing: `trend confidence — low data (n=2)`. Same underlying fit, two different levels of honesty, and the dishonest one is the one with a 'Download PDF' and 'Copy for LLM' button on it. That's not a wobble I have to guess at — that's a fabricated-sounding date I could paste into a renewal memo to my own board without ever knowing it was a coin flip. That is *exactly* the fabricated-trend failure my senior-quality bar forbids, and it's on the highest-stakes surface, not a low-stakes one. Worse than what I predicted, not better.

Second — and this is the one that actually costs you the renewal, not just a downgrade: you're now showing me, live, on a real `/usage` page, the line 'Unused credits roll over — they never expire' sitting directly under an allotment computation, on a Free-tier org that's never bought a credit. I called this exact contradiction out in my L1 read of the code. Now it's confirmed live, word for word, not a hypothetical. I said in L1: 'if I catch that lie at renewal time, I'm not downgrading anymore — I'm gone.' You just handed me the live catch. My monthly allowance resets to zero every month — it does not roll over — and the panel that exists specifically to earn my trust for a right-sizing decision is telling me the opposite of what your own `/pricing` page says two clicks away. I don't downgrade after that. I churn, and I tell the other founder in my Slack group exactly why.

Also new and relevant: that same `/usage` page has a banner bug — 'Out of private-scan credits, next scan will be refused' — firing on an org with its full 5/mo allowance untouched. If I were evaluating on Free before committing to Pro, that banner alone would make me think this is a bait-and-switch pricing page, not a legible one. That's a second, independent hit to the exact price-legibility criterion I score you on.

The pricing page itself, though — genuinely fixed. Real `$10/mo`, `$20/mo`, `Custom`, and a 'where your credits actually go' table that explicitly says re-scanning an unchanged commit never costs a credit. That's the dollar-math I asked for in L1, and it's there now, unambiguously. I'll give you that one clean.

Net: the mechanism for what I want (noise-aware deltas, real $ pricing, an allotment-based right-size nudge) all genuinely exist in this codebase. But the two surfaces I'd actually use to make a keep/downgrade/churn call — the Briefing's trajectory headline and the Usage page's rollover claim — both told me something untrue or overconfident, live, not hypothetically. I don't trust either enough to skip cross-checking it myself, which defeats the entire point of a 5-minute Monday glance."

**Verdict: downgrade, trending toward churn.** The row-level noise gate and the real dollar pricing keep me from churning outright today. But the confirmed-live rollover misstatement is the specific thing I told you would flip me from "downgrade" to "gone" — and you confirmed it's still there. I'm not renewing Pro without a fix; I'm one more discovered inconsistency from cancelling entirely rather than downgrading.

**Time saved this cycle: ~8 min**, not the ~25 min my motivation section describes. The Overview glance (flat, muted, honest) genuinely takes under a minute and I trust it. But the actual job — "is Pro still worth $10/mo for a shop that burns 6-8 scans" — required cross-checking the Briefing's ETA against the Trends page and the Usage rollover claim against the Pricing page, by hand, because neither trust-critical surface stood on its own. That cross-checking is most of my old 30-minute manual skim, just moved to a different set of tabs.

---

## 2. Adversarial verification of L1 findings against the live evidence

| L1 finding | L2 disposition | Basis |
|---|---|---|
| **L1-yusuf-repeated-01** — Briefing's "Value this period" line unguarded by noise band | **NOT RE-TESTED (still open on code)** — evidence's org-level delta happened to land on exactly 0 (both repos flat), so `valueRealizedLine`'s `pointsMoved !== 0` branch never fired live. Neither confirmed nor refuted directly. **However, the shared evidence surfaces a worse live instance of the identical class of bug** — see new finding below — which raises confidence the underlying finding is real, just not the litmus test I asked for in L1. |
| **L1-yusuf-repeated-02** — `/usage` and `/pricing` unreachable from org dashboard nav | **NOT ADDRESSED** — shared evidence confirms page *content* is good (§5, §6) but does not test in-app navigation/click-paths from a populated org dashboard. Carried forward from L1 unverified either way. |
| **L1-yusuf-repeated-03** — AllotmentPanel's rollover copy misdescribes the monthly allowance as rolling over | **CONFIRMED LIVE.** Shared evidence §6 quotes the exact live `/usage` page for a fresh Free-tier org: *"Comfortably within your 5/mo Free allotment. Unused credits roll over — they never expire."* — word-for-word the contradiction I flagged from the code in L1, now reproduced against a real render, not a static read. This is my single most consequential finding and it survived L2 unchanged. |
| **L1-yusuf-repeated-04** — "Fleet" framing hardcoded regardless of repo count | **NOT ADDRESSED** — the shared evidence's seeded org (`vercel`, 6 repos) is not a 1-repo org, so this can't be confirmed or refuted against genuinely single-repo live copy. Carried forward from L1 unverified. |
| **L1-yusuf-repeated-05** — No link from Overview to a repo's `/trends` view | **NOT ADDRESSED directly**, but evidence reinforces why it matters: §3/§4 shows `/trends?repo=vercel/ai` renders the *correct* honest low-data caveat while the Executive Briefing (which Overview does link to) does not — so the missing shortcut to `/trends` is now demonstrably a missing shortcut to the *more trustworthy* of the two recurring-value surfaces, not just a nice-to-have. Priority raised, not resolved. |

---

## 3. New findings this evidence surfaces for Yusuf's specific angle

1. **[major, NEW]** Executive Briefing's trajectory ETA (`"~4 weeks (≈ 2026-08-13)"`) renders with **zero** confidence/low-data caveat on the exact org where the underlying fit is `n=2, lowData: true` — while the per-repo Trends page shows the honest caveat for the identical data. This is a sharper, live-confirmed instance of the same trust failure L1-01 predicted for the Briefing tab, just located in the forecast headline rather than the value-realized line, and it's worse because it's the surface with a "Download PDF"/"Copy for LLM" export a co-founder would forward unedited into a renewal decision. Root cause: `src/lib/org/briefing.ts:242-248`, `forecastConfidenceNote()` returns `null` on low data instead of substituting the honest string `Trajectory.tsx` already has.
2. **[major, NEW]** `/usage`'s "Out of private-scan credits, next scan will be refused" banner fires on a Free-tier org with a full, untouched 5/mo allowance — directly contradicting the "Comfortably within your allotment" text three lines below it on the same page. For a bootstrapped operator deciding whether to trust the credits-vs-allotment read enough to skip his manual skim, two panels on one screen disagreeing about whether he's about to be locked out is disqualifying on its own, independent of the rollover-copy bug. `src/app/usage/page.tsx:142`, `usageDashboard.tsx:45-51`.
3. **[note, refines L1]** The row/digest-level noise gate (`SCORE_NOISE_BAND=2`) is confirmed solid at the *overall*-score level (Δ0 on both live-rescanned repos) but the evidence found a wider *per-dimension* swing (±4 on D7) than the band was calibrated against (±1, from the prior sample). Not currently user-visible (no per-dimension delta UI exists), so it doesn't change today's verdict — but if a future feature adds per-dimension delta arrows, it will inherit the same "was that real or noise" problem Yusuf cares about most, at a tighter tolerance than the app's own constant assumes.

---

## 4. Scored acceptance criteria — updated verdicts

| Criterion | L1 verdict | L2 verdict | Change |
|---|---|---|---|
| Recurring-value check | PARTIAL | **PARTIAL, evidence shifts locus** — Briefing's "Value this period" line not stress-tested; but Briefing's Trajectory *headline* now confirmed to overstate confidence live. Still fails on the Briefing tab, just via a different sentence. | reframed, not resolved |
| Noise check | PARTIAL | **PARTIAL** — Overview row + digest confirmed genuinely honest live (Δ0 → `→0` neutral). Briefing's ETA headline confirmed dishonest-by-omission live. Net unchanged: passes at the surfaces he glances at first, fails at the one he'd act on. | confirmed both ways |
| Price-legibility check | PARTIAL (content) / FAIL (reachability) | **content now upgraded to PASS** (`/pricing` real $10/$20/Custom, live-confirmed) but a **new FAIL** found: `/usage`'s incorrect low-balance banner actively misleads a Free-tier evaluator about whether they're about to be locked out. Reachability question untested either way. | mixed: one part resolved, one new failure found |
| Idle-credit check | PARTIAL | **downgraded to FAIL-equivalent** — the right-size nudge mechanism is sound, but the rollover misstatement it sits next to is now confirmed live, not just a code read. This is the exact "silent overpay disguised as reassurance" his pet peeves warn about, reproduced. | worse — confirmed, not hypothetical |
| Cadence check | PASS | **PASS, unchanged** — not specifically re-tested in this evidence, but nothing in the shared run contradicts `digestHasSignal`'s design intent, and the flat-repo re-scan data is consistent with it (a flat pair would produce no digest signal). | unchanged |
| Time-saved bar (<5 min) | PASS structurally, at risk in practice | **FAIL in practice** — cross-checking the Briefing ETA and the rollover claim against other pages, now proven necessary by live evidence, consumes most of the 5-minute budget. | downgraded from "at risk" to "fails" |

---

## 5. Findings (JSON)

```json
[
  {
    "id": "L2-yusuf-repeated-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "yusuf-bootstrapped-rails",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Executive Briefing trajectory renders a dated, confident ETA with zero confidence/low-data caveat, while the identical per-repo data is honestly caveated on /trends",
    "expected": "The board-facing/exportable surface should never be less honest about forecast confidence than the internal per-repo Trends page for the same underlying data.",
    "got": "Live at /org/vercel/executive: 'At risk of slipping to L3 in ~4 weeks (≈ 2026-08-13)' with 0 confidence-note occurrences on the page (grep-confirmed). Same org's /trends?repo=vercel/ai renders 'trend confidence — low data (n=2)' for the identical n=2/lowData situation. Root cause: src/lib/org/briefing.ts forecastConfidenceNote() returns null on low data instead of substituting the honest low-data string.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §4", "src/lib/org/briefing.ts:242-248", "src/app/org/[slug]/executive/page.tsx:159-161"],
    "code_check": "confirmed-present-live",
    "verdict": "confirmed",
    "resolution": "open",
    "note": "New/sharper instance of the trust-erosion class predicted by L1-yusuf-repeated-01; supersedes that finding's severity for the Briefing tab specifically."
  },
  {
    "id": "L2-yusuf-repeated-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "yusuf-bootstrapped-rails",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "AllotmentPanel's 'unused credits roll over, never expire' copy confirmed live on a Free-tier org whose allowance actually resets monthly",
    "expected": "The panel he'd use to decide whether Pro is right-sized should not claim the thing it's measuring rolls over, when it resets every calendar month and only a separate (usually-zero) purchased-credit balance rolls over.",
    "got": "Live /usage for org vercel (Free plan): '0% of your 5/mo allotment... Comfortably within your 5/mo Free allotment. Unused credits roll over — they never expire.' — reproduces L1-yusuf-repeated-03's code-level finding verbatim against a live render.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §6", "src/app/usage/AllotmentPanel.tsx:80-82", "src/lib/entitlement.ts:44-68"],
    "code_check": "confirmed-present-live",
    "verdict": "confirmed",
    "resolution": "open",
    "note": "Was L1-yusuf-repeated-03 (code-read only); now L2-confirmed against live output. Per this Character's own stated threshold, a confirmed live instance of this exact lie converts his stance from 'downgrade' to 'churn.'"
  },
  {
    "id": "L2-yusuf-repeated-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "yusuf-bootstrapped-rails",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "/usage low-balance banner fires incorrectly for Free-tier orgs with untouched allowance, contradicting adjacent copy on the same page",
    "expected": "A price-legibility surface should not tell an evaluator they're about to be refused a scan when their full monthly allowance is unused.",
    "got": "Live /usage for org vercel (Free, 0 private scans, 0/5 used) would render 'Out of private-scan credits — the next private scan will be refused (402)' per creditBalance===0 check that ignores usageThisMonth vs allowance, directly contradicting the same page's 'Comfortably within your 5/mo Free allotment' line.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §6", "src/app/usage/page.tsx:142", "src/app/usage/usageDashboard.tsx:45-51"],
    "code_check": "confirmed-present-live",
    "verdict": "confirmed",
    "resolution": "open",
    "note": "New finding, not present in L1 — surfaced only once the shared evidence exercised a real Free-tier org's /usage render."
  },
  {
    "id": "L2-yusuf-repeated-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "yusuf-bootstrapped-rails",
    "cert_level": "L2",
    "type": "strength",
    "severity": "n/a",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "n/a" },
    "dimension": "trust",
    "title": "Row-level and digest-level noise gating confirmed genuinely honest on a real repeated-commit re-scan",
    "expected": "n/a — strength to protect.",
    "got": "vercel/ai and vercel/eve, live-rescanned 21 real days apart on the identical commit, both landed Δ0 overall and rendered '→0' neutral (not a false arrow) on the Fleet rollup; /trends showed 'trend confidence — low data (n=2)' honestly.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §2-3"],
    "code_check": "confirmed-present-live",
    "verdict": "confirmed",
    "resolution": "n/a",
    "note": "Confirms the strength already noted in L1; do not regress."
  },
  {
    "id": "L2-yusuf-repeated-05",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "yusuf-bootstrapped-rails",
    "cert_level": "L2",
    "type": "strength",
    "severity": "n/a",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "n/a" },
    "dimension": "trust",
    "title": "/pricing content-legibility fix confirmed live",
    "expected": "n/a — resolves prior finding.",
    "got": "Live /pricing shows real $0/$10/$20/Custom by tier plus a 'where your credits actually go' table explicitly stating same-commit re-scans never cost a credit — resolves the earlier 'subscription price invisible' finding.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §5"],
    "code_check": "confirmed-present-live",
    "verdict": "confirmed",
    "resolution": "resolved",
    "note": "Reachability from inside the org dashboard (L1-yusuf-repeated-02) remains untested and open."
  }
]
```

---

## 6. Bottom line

Adopt? **No, not as shipped — downgrade at best, and the confirmed rollover lie pushes toward churn.** The mechanisms Yusuf's references demand (noise-gated deltas, real $ pricing, a right-size nudge) genuinely exist in this codebase and two of them — row-level noise gating and `/pricing`'s dollar figures — held up under live re-scanning. But the two surfaces he'd actually use to make the renew/downgrade/churn call both failed live, not hypothetically: the Executive Briefing overstates forecast confidence on the exact document he'd forward to a co-founder or CFO, and the Usage page tells him idle credits roll over on the exact page where they don't. He would still open the app Monday out of habit, but per his own emotional baseline, he does not renew or upgrade without both fixed — and having *caught the rollover claim live and not just in code*, he is now closer to cancelling than to quietly right-sizing.
