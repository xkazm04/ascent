# L2 (live-evidence-checked) — Sofia (mobile EM) × "Repeated org scans worth the price"

cert_level: L2 · date: 2026-07-16 · evidence source: `uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md`
(live `vercel` org, `LLM_PROVIDER=claude-cli` confirmed, 21-day-labeled two-scan history on
`vercel/ai` / `vercel/eve`). No new browser driving done in this pass — reasoning purely from the
shared evidence plus my own L1 scored criteria.

**Scope caveat going in:** the shared run scanned a JS/TS org (`vercel/*`), not a Swift/Kotlin
mobile monorepo. That means my headline finding (F1: D3 has zero fastlane/Xcode Cloud vocabulary)
and F2 (the mobile stack-fit caveat is invisible on the surfaces I use) were **not** re-exercised
live this run — they stand as code-checked from L1, not freshly confirmed. What the shared evidence
*does* let me check: whether the org-wide trajectory/real-vs-noise machinery I praised in L1 holds
up live, and whether Team-tier price-legibility holds up live. It also surfaced something new I
didn't predict.

---

## 1. My reaction to the live evidence, in character

Okay. I read this the way I read a release note before a train — what changed, does it change my
sign-off.

**Real-vs-noise: confirmed, and better than I gave it credit for in the theoretical pass.** The
shared run did the thing I always want a vendor to actually show me: rescan the *same commit*
twice, days apart, and see if the number holds. `vercel/ai` and `vercel/eve` both came back **Δ0
overall** across a real 21-day-labeled window, and the fleet rollup rendered that as a neutral
`→0 avg move`, not a fake "improvement" or "regression." That's exactly the "is that the repo or
the model breathing" instinct I bring to every read, and it's live-verified now, not just
source-read. One thing worth flagging for calibration: the *per-dimension* swing was wider this
time (±4 on one dimension) than the single prior sample (±1) — still nowhere near the ±25 LLM
guardband, and it doesn't mislead anyone today because no UI renders per-dimension deltas with
arrows — but it tells me the dimension-level noise floor isn't as tight as the overall-level one.
Filed as a watch-item, not a blocker.

**Price-legibility: confirmed, cleanly.** `/pricing` live shows Team at **$20/mo, 500 scans, 10
seats, 365-day retention**, sourced from the same `plans.ts` the entitlement gate reads — so it
structurally can't be a stale marketing number. That's the thing I'd actually put in front of my VP
Eng at the quarterly tool-spend review: a number I don't have to double-check against a support
ticket.

**New finding, and it's the one that actually moves my needle most.** The shared evidence caught
something I flagged as "functionally fine" in my L1 pass and now have to walk back. I'd assumed
the org-wide trajectory on `/executive` — the surface I actually use for the go/no-go, since the
full R²/noise Trajectory card only lives on the single-repo `/trends` page — still carried *some*
honest confidence caveat as text, just thinner-rendered than the repo-level card. Live evidence
says no: on a genuinely low-data 2-scan window, `/org/vercel/executive` renders **"At risk of
slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13)"** — a specific, dated, confident-sounding
ETA — with **zero** confidence caveat anywhere on the page (grepped: 0 hits for "confidence"). The
identical low-data situation on `/trends?repo=vercel/ai` correctly renders `trend confidence — low
data (n=2)`. Same underlying `lowData` flag, two different renderings, and the silent one is on the
surface with the Download-PDF and Copy-for-LLM buttons — the exact artifact that leaves the
building unedited and lands in front of a CFO. This is precisely the "can I tell a real move from
noise" question my whole journey turns on, on the highest-stakes surface, failing exactly where I
said noise-handling was solid. That's worse than a UI polish gap — it's a caveat that silently
disappears instead of degrading gracefully, on the read I most need to trust.

**D3 mobile fidelity — still unresolved, still un-retested.** Nothing in the live evidence touches
a mobile stack, so I can't confirm or refute F1/F2 from this pass. They stand exactly where L1 left
them: `d3()` has no fastlane/Xcode Cloud/signing/store-submission vocabulary, and the honest
stack-fit caveat that exists in the data model still doesn't reach the org heatmap, the dimension
drill-in, or the executive briefing (confirmed by static code read, not contradicted by anything
live here). I'd want a real Swift/Kotlin org scanned live before I'd change my stance on this.

---

## 2. Verdict

**Hold, not renew-with-confidence — same call as L1, reinforced rather than resolved.** The parts
of the product that don't depend on mobile-specific evidence (noise handling, price legibility) are
now live-confirmed and genuinely good — better evidenced than I expected. But the live run also
surfaced a *second* trust gap on the exact axis I care about most (real move vs. noise, on the
board-facing surface), on top of the D3-fidelity gap that's still unverified either way. I'm not
churning — the trajectory math and noise handling are worth the seat through this train. I'm not
upgrading either. I'd tell my VP: the CI/CD number still isn't credible for a mobile org, and now
I'd add — don't trust the dated ETA on the exec PDF without cross-checking the sample size
yourself, because the tool won't warn you when it should.

**Time-saved: ~75 min/cycle** (down from my stated ~160 min ceiling, same range as L1's 60–90 min
estimate). The live evidence didn't change my D3-fidelity math (still untested for mobile, so I'd
still redo that slice by hand) — it added a second reason I'd manually cross-check the trajectory
read on `/executive` specifically (checking `n=` myself before trusting a dated ETA), which eats
into the exec-briefing time savings without touching the per-repo `/trends` savings.

---

## 3. Adversarial verification of L1 findings against live evidence

| ID | L1 claim | Live evidence verdict | Notes |
|---|---|---|---|
| F1 | D3 detector has zero mobile-release-train vocabulary | **carried forward, not retested** | Shared run scanned a JS/TS org only; no live mobile-repo scan exists to confirm/refute against a real fastlane pipeline. Code-check from L1 stands unchallenged. |
| F2 | Mobile stack-fit caveat invisible on fleet-level surfaces (heatmap drill-in, executive briefing) | **carried forward, not retested** | Same scope gap as F1 — the live org has no mobile stack-fit caveat to observe rendering (or not rendering). Static code-read from L1 unchallenged. |
| F3 | No biweekly autoscan cadence | **carried forward, partially touched** | Live evidence (§7 of shared doc) confirms the schedule `<select>` exists and renders disabled-with-tooltip when the GitHub App isn't configured (a dev-env fact) — it doesn't exercise the cadence option list itself. F3's core claim (`off\|daily\|weekly\|monthly`, no biweekly) is unchanged from L1's code-check. |
| S1 (real-vs-noise strength) | Real-vs-noise is a genuine shared primitive across Overview, digest, Trajectory | **CONFIRMED live**, upgraded from code-read to live-observed | Two independent live claude-cli scans of the same commit, 21 days apart, produced Δ0 overall and rendered as neutral `→0`, not a styled move. Engine-transition muting also confirmed live on the mock repos. |
| S2 (price-legibility strength) | Team $/mo and usage-allotment legibility are wired end to end | **CONFIRMED live** | `/pricing` shows real $20/mo Team pricing sourced from `plans.ts`; this also independently resolves the prior pricing-20 cycle's L2-04 finding, which the shared evidence cites explicitly. |
| (implicit, L1 §1.2 narrative) "the org-wide forecast reaches her, just as a line of text on /executive" | **REFUTED** | Live evidence shows the confidence note is **suppressed entirely** (returns `null`, nothing renders) in the low-data case that actually applies to this org — not "thinner text," but silently absent. This is worse than what I described in L1, where I assumed *some* honest caveat text still reached the exec surface. |

**New finding for this journey (not in L1):**

```json
{
  "id": "F4",
  "journey": "repeated-org-scans-worth-the-price",
  "character": "sofia-mobile-em",
  "cert_level": "L2",
  "type": "quality-gap",
  "severity": "major",
  "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
  "dimension": "trust",
  "title": "Executive briefing renders a confident, dated trajectory ETA with zero confidence/low-data caveat, on the exact board-facing PDF/LLM-export surface, when the identical low-data case is honestly caveated on /trends",
  "expected": "The org-wide trajectory Sofia relies on for her go/no-go (since the full R²/noise Trajectory card lives only on /trends, not /executive) should carry the same honest low-data caveat as the per-repo card for the identical underlying data.",
  "got": "Live at /org/vercel/executive: 'At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13)' with zero 'confidence' text anywhere on the page (grep count 0), on a 2-scan low-data window. src/lib/org/briefing.ts:242-248's forecastConfidenceNote() returns null on lowData instead of substituting the honest string Trajectory.tsx uses ('trend confidence — low data (n=X)'), so the {...&&(<p>)} guard renders nothing. Same bug propagates to briefingMarkdown() used by both the PDF export and 'Copy briefing for LLM.'",
  "evidence": [
    "src/lib/org/briefing.ts:242-248",
    "src/app/org/[slug]/executive/page.tsx:159-161",
    "shared evidence §4 (uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md)"
  ],
  "code_check": "confirmed-present",
  "verdict": "confirmed",
  "resolution": "open",
  "note": "Directly refutes my own L1 characterization of this surface as 'functionally fine, just the thinner rendering' — live evidence shows it's not thinner, it's silent exactly when the data is weakest, which is the one case where I most need the caveat."
}
```

---

## 4. Character voice — final take

The parts of this I could already vouch for held up under a real scan, twice, three weeks apart —
that's not nothing, and it's more than most tools give me. But the live run also found a second
version of the exact failure mode I was worried about: a number that sounds certain when it
shouldn't be, sitting on the one page that gets forwarded to people who won't know to ask "n=
what?" I'd still keep the seat this train. I'd still flag D3 to my VP as not-credible-for-us. And
now I'd add a line to that email: don't trust the dated ETA on the exec PDF without checking the
scan count yourself, because right now the tool won't tell you when it's guessing.
