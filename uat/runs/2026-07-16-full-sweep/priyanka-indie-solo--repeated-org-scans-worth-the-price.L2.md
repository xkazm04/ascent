# L2 (live-evidence-verified) — Priyanka (indie solo) × "Repeated org scans worth the price"

cert_level: L2 · promotion: discovery · verdict: **stay-Free, trust dented**

## 0. Binding note (unchanged from L1)

My surface is `/trends?repo=owner/repo` + `/pricing` — org fleet/executive stuff is the upsell I'd *weigh*,
not something I own. The shared evidence run happened to build its entire fixture on `vercel/ai` /
`vercel/eve`, scanned live twice, 21 real days apart in the DB (same underlying commit) — which is, by pure
luck, exactly my surface: a real ≥2-scan `/trends` history off a live `claude-cli` engine, not mocked. I'm
judging against that.

## 1. My reaction, first-person

*Okay. Real two-point history this time, not a theoretical one — good, that's the thing I actually asked for
in L1.*

**Trajectory card — still the good part.** `/trends?repo=vercel/ai` at n=2 renders `trend confidence — low
data (n=2)` and the headline says *"Holding around 80 (L4 · Integrated) — no level change projected."* That's
verbatim the honest "nothing changed" branch I said would earn my trust. Confirmed live, not just read in
source this time. Good.

**Dimension grid — this is where the live data actually makes it worse than my L1 guess, not just confirms
it.** The two real scans of `vercel/ai` didn't move overall (80→80, exactly what I'd expect from an unchanged
repo) but D7 "Commits" swung **98→94, a real Δ4** — nothing about the repo changed in the 7 minutes between
those two live calls. That's pure model wobble. Now: the app's *own* calibrated noise floor
(`SCORE_NOISE_BAND = 2` in `noise.ts`) is tighter than that swing. So even setting aside my L1 finding that
`DimensionTrends`/`DeltaTag` isn't wired to the noise helpers at all — if someone fixed that wiring tomorrow,
a Δ4 like this would *still* clear the band and render as a "real" green ▲4, because the band itself is
calibrated too tight for the swing this repo actually produced. I said in L1 "I already know my re-scans
wobble ±1–2 doing nothing" — turns out on live data it's more like ±4 on at least one dimension. That's not a
smaller problem than I thought. It's a bigger one: the fix isn't just "wire DeltaTag to noise.ts," it's "the
noise.ts band itself needs a wider sample before I'd trust it on the row I actually read."

**Price legibility — confirmed, no notes.** `/pricing` shows real numbers live: Free $0, Pro $10/mo, Team
$20/mo, Enterprise Custom. No credits-only pitch, no contact-us wall on the tier that'd matter to me. I said
in L1 I was "genuinely surprised" reading the source; seeing it rendered live doesn't change that. This one's
solid.

**New thing the live evidence caught that I couldn't have found reading source: the `/usage` banner bug.**
On a Free-tier org with its full 5/mo allowance untouched (0 private scans used), `/usage` renders a
warning-colored banner: *"Out of private-scan credits — the next private scan will be refused."* That is
exactly, precisely the kind of thing that would make me — budget-cold, opaque-pricing-allergic, checking my
own account mid-evaluation — either panic-upgrade for no reason or conclude "bait and switch, nope." It
directly contradicts the "Comfortably within your 5/mo Free allotment" text three lines below it *on the same
page*. This isn't my dimension-grid finding, but it's the same species of bug: something on my Free-tier
screen tells a confident lie that a five-second glance one line down refutes. I did not predict this in L1
because I hadn't walked `/usage` — the shared evidence did, and it's squarely in my segment.

**Retention honesty — still can't confirm or refute.** The live fixture is 21 days old, which is inside
Free's 30-day window either way, so it doesn't exercise the retention-cutoff question at all. My L1 finding
(`scans-read.ts` never calls `retentionCutoff`, unlike `personal.ts`/`org-rollup.ts`) stands as a code-level
read only — nobody drove a >30-day fixture through `/trends` live. Still open.

## 2. Verdict

**Stay Free. Don't open it again next month unless something changes — and now I trust the Free-tier account
page a little less than I did before this evidence, not more.** The trajectory honesty is real and I credit
it. But the one thing I'm here for every cycle — "did anything actually change" — still can't be told apart
from a *confirmed, live, same-commit* Δ4 wobble, and the calibration gap is worse than my L1 guess. Add a
false lockout banner on my own account page and the net trust move this cycle is negative, not positive.

**Time-saved this cycle:** worse than my L1 estimate of ~10–15 min. With a live-confirmed Δ4 wobble sitting
right there un-flagged, I'd burn time double-checking whether "Commits ▲4" is real before I could trust the
page — call it **~5 minutes** net saved, below my own stated bar. Pure-confirmation cycles fail the bar per
my own criteria; this one is worse than pure confirmation because it actively risks a false chase.

## 3. Findings

1. `{ id: "L2-priyanka-repeated-1", journey: "repeated-org-scans-worth-the-price", character: "priyanka-indie-solo", cert_level: "L2", type: "trust", severity: "major", title: "Live re-scan shows a real Δ4 dimension swing that exceeds the app's own noise band — confirms AND strengthens L1-priyanka-repeated-1", verdict: "CONFIRMED", carried_from: "L1-priyanka-repeated-1", evidence: ["_L2-shared-pricing-evidence.md §2 (vercel/ai D7 Commits 98→94, Δ4, same commit, 21-day-labeled live re-scan)", "_L2-shared-pricing-evidence.md §2 finding 5 (SCORE_NOISE_BAND=2 is narrower than the observed swing)", "src/components/report/DimensionTrends.tsx:197 / deltas.tsx:47-69 (DeltaTag still unwired to noise.ts, per L1, not contradicted by this evidence)"], impact: "Even the hypothetical fix (wire DeltaTag to isWithinNoise) would still misclassify this specific real-world swing as a genuine move, because the band itself is under-calibrated versus live dimension-level variance. Raises the finding from 'UI not wired to existing safeguard' to 'the safeguard's threshold needs re-derivation from a wider sample before it can be trusted on this row.'", resolution: "open, escalated" }`

2. `{ id: "L2-priyanka-repeated-2", journey: "repeated-org-scans-worth-the-price", character: "priyanka-indie-solo", cert_level: "L2", type: "trust", severity: "major", title: "NEW — /usage low-balance banner falsely claims imminent lockout on an untouched Free-tier org", verdict: "CONFIRMED (new finding for this angle)", evidence: ["_L2-shared-pricing-evidence.md §6 (live: 'Out of private-scan credits' banner fires with 0/5 private scans used, full allowance untouched)", "src/app/usage/page.tsx:142", "src/app/usage/usageDashboard.tsx:45-51 (lowBalance checks prepaid creditBalance, ignores usageThisMonth/allowance)"], impact: "Directly in my segment: I am exactly the Free-tier, budget-cold, opaque-pricing-averse user this would hit hardest, and it contradicts the 'Comfortably within your allotment' copy on the same screen. Would read to me as bait-and-switch, not as a bug, on first encounter.", resolution: "open" }`

3. `{ id: "L2-priyanka-repeated-3", journey: "repeated-org-scans-worth-the-price", character: "priyanka-indie-solo", cert_level: "L2", type: "trust", severity: "minor", title: "Price legibility — CONFIRMED live, strength reaffirmed, no residual doubt", verdict: "CONFIRMED (strength)", carried_from: "L1 strengths list", evidence: ["_L2-shared-pricing-evidence.md §5 (live /pricing: Free $0, Pro $10/mo, Team $20/mo, Enterprise Custom)", "_L2-shared-pricing-evidence.md §5 (refutes prior-cycle L2-04 opaque-pricing finding, same code path she'd hit)"], resolution: "closed, protect" }`

4. `{ id: "L2-priyanka-repeated-4", journey: "repeated-org-scans-worth-the-price", character: "priyanka-indie-solo", cert_level: "L2", type: "trust", severity: "minor", title: "Retention-clamp question (L1-priyanka-repeated-2) not exercised by this evidence pass", verdict: "UNVERIFIED (neither confirmed nor refuted)", carried_from: "L1-priyanka-repeated-2", evidence: ["_L2-shared-pricing-evidence.md — fixture is 21 days old, inside Free's 30-day window either way, so retentionCutoff clamping is not exercised"], resolution: "open, needs a >30-day live fixture to settle" }`

**Not carried forward as a live finding for her:** L1-priyanka-repeated-3 (low-data caveat visually
subordinate to the ETA pill) and L1-priyanka-repeated-4 (no digest for solo/no-webhook users) — the shared
evidence didn't screenshot `/trends`'s Trajectory-card visual weight specifically, and confirms the digest
gap is by-design/out-of-my-binding. Both remain as-is from L1, neither confirmed nor refuted by this pass.
Worth noting: the shared evidence *did* find a more severe cousin of #3 one layer up — the org-executive
briefing renders its ETA with **zero** caveat at all (not just visually subordinate) — which isn't my surface,
but if I ever got curious about the org tier this is the kind of thing that would confirm my instinct to stay
solo-scoped.

## 4. Character voice — final word

"Two real scans, one commit, seven minutes apart, and one of my nine dimensions swung four points doing
absolutely nothing. That's not a hypothetical anymore, that's the data. Your own noise band is set to catch a
2-point wobble and I just watched a 4-point one sail past it. Fix the wiring *and* re-measure the threshold,
or I'm going to keep not trusting the grid I open this page for.

And then I go check my own usage page and it tells me I'm about to get locked out when I haven't spent a
single private scan. On the free plan. That I'm not paying for. That's the kind of thing that makes me close
the tab and remember why I don't trust 'productivity' tools with money in the first place — even though,
credit where due, your pricing page itself is the most honest one I've seen all year.

Staying Free. Not because Pro is a ripoff — genuinely, $10/mo would be cheap if this actually caught something
I didn't know. Because right now the two screens I'd actually use to decide that both told me something that
wasn't true."

## 5. Verification notes

- I did **not** re-drive the browser — this file reasons entirely from `_L2-shared-pricing-evidence.md` plus
  my own L1 report, per instructions.
- Where the shared evidence's fixture (vercel/ai, org-scoped) diverges from my stated binding (a solo dev's
  own single private repo), I've treated the numbers as directly transferable — the mechanism under test
  (per-dimension delta rendering vs. `noise.ts`, `/pricing` legibility, `/usage` balance logic) is
  repo/org-agnostic code, so a swing or bug observed on `vercel/ai` is the same code path I'd hit on my own
  repo.
- Two of my four L1 findings (retention clamp, low-data visual weight) remain **unverified** by this pass —
  reported honestly as open rather than claimed as confirmed, since the shared evidence didn't exercise
  either condition directly.
