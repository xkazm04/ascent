# L2 report — Arjun (data/ML platform lead) × "Repeated org scans — worth the price?"

cert_level: L2 (live evidence, adversarial verification against L1). Reasoned from `uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md` — no separate browser drive; this journey's angle is recurring-value-vs-price, judged against the shared `/org/vercel`, `/org/vercel/executive`, `/trends`, `/usage`, `/pricing` evidence gathered live with `LLM_PROVIDER=claude-cli`.

## 1. Verdict

**Renew — but the fleet-level trust gap I flagged in L1 didn't close, it moved.** The one surface I said was "genuinely good, no complaints" (`/usage`, `/pricing`) is still good on the numbers that matter to me, but the live run surfaced a banner bug on that exact page that would make me question it if I hit it cold. And the executive-briefing surface I said I couldn't yet put in a slide has a *second*, worse silent-caveat bug beyond the one I predicted — not about ML stack-fit this time, about trend confidence itself. Net: I keep paying through this renewal, same as L1, but my four-hour manual baseline barely moves this cycle.

**Time saved this cycle: ~150 minutes** (down from the ~230 min I'd get if the fleet + executive surfaces were fully trustworthy). I still have to open the executive briefing and mentally caveat its trajectory line myself, and now I also have to double-check the `/usage` banner against the allotment panel before I believe either one — that's exactly the "debunking step" my own Motivation section said erases the savings.

## 2. Findings — adversarial verification of L1

### L1-ARJ-01 (archetype lens has no ML branch) — **carried forward, unconfirmed either way (PLAUSIBLE, not tested)**
The live evidence run seeded and re-scanned `vercel/ai` / `vercel/eve` — real repos, not a notebook-heavy ML fixture. No live scan in this evidence exercises `detectStackFit`'s `ml` branch or `classifyArchetype`'s bucketing on an actual `.ipynb`-heavy repo. My L1 code-read finding (`classifyArchetype` buckets solely on stars/CODEOWNERS/workflow-count, no `ml` archetype, `ARCHETYPE_WEIGHTS` has exactly solo/team/org) stands unverified in either direction by this run. This is still the finding that matters most for my scored criterion #1, and it's still open.

### L1-ARJ-02 (stack-fit caveat invisible on fleet/executive surfaces) — **not directly retested, but reinforced by a sibling bug on the exact surface I named**
No ML repo was scanned live, so I can't confirm the stack-fit caveat is still absent from `briefing.ts`. But §4 of the shared evidence found something adjacent and worse on that same page: the executive briefing's *trend-confidence* caveat — a different footnote than stack-fit, but the same pattern (a real caveat that exists on the per-repo page and silently vanishes on the board-ready export) — is dropped with zero indication anywhere on `/org/vercel/executive` or in "Copy briefing for LLM." This is exactly the failure mode I predicted for stack-fit, now independently confirmed for trend-confidence on the same page. It raises, not lowers, my confidence that L1-ARJ-02 is real: this isn't a one-off, it's a pattern of the executive-briefing surface dropping caveats that exist elsewhere in the app. I would not paste that markdown to my VP unedited.

### L1-ARJ-03 (fleet rollup mutes only mock→live, not live-to-live wobble) — **REFUTED for the fleet rollup specifically — real fix, live-confirmed**
This is the one clean win. §3 of the shared evidence: a new `SCORE_NOISE_BAND=2` / `isWithinNoise()` (`src/lib/maturity/noise.ts`) is now applied to `components/ui/format.ts`'s `fmtDelta`/`toneFor` — the exact rendering path the fleet rollup uses — and it's **live-confirmed**: two genuinely independent live claude-cli scans of `vercel/ai`/`vercel/eve`, 21 days apart, same commit, render as `→0 avg move` in neutral tone on `/org/vercel`, not a confident colored delta. That's precisely the "is that a 3-point bump my team's work or your LLM breathing" question I asked in L1, answered correctly, on the fleet page I actually open first. I'm crediting this: L1-ARJ-03 as I wrote it (fleet rollup has no live-to-live noise guard) is **refuted** — the guard exists and works where I said it didn't.

But — the noise-vs-signal story isn't uniformly fixed. §4's new finding shows the *executive briefing's* forecast/trajectory line (a different noise-vs-signal control, the R²/low-data guard, not the delta-noise-band) is silent exactly when data is thin (n=2) instead of showing the honest "low data (n=X)" string the per-repo Trends page already has. So: fleet-level delta noise = fixed. Executive-level forecast noise = still broken, just a different mechanism than I originally cited in L1-ARJ-03's "engine-transition-only" framing. I'm marking L1-ARJ-03 refuted-as-written, with a new, more specific successor finding below.

### L1-ARJ-04 (heatmap doesn't flag stack-fit-calibrated rows) — **carried forward, unconfirmed (polish, unchanged)**
No live evidence bears on this — still a code-level observation from L1, not retested. Low priority either way.

### L1-ARJ-05-STRENGTH (price legibility is solid) — **CONFIRMED live, and strengthened on the pricing page, but now shares a page with a new contradiction bug**
§5 confirms live: `/pricing` shows real Team $20/mo, 500 credits, 365d retention, matching `plans.ts` exactly — no drift between billed and displayed. This directly resolves the prior pricing-page finding (2026-06-20 L2-04, "subscription price invisible") and matches my scored criterion #5 cleanly. Good.

But §6 surfaces something I need to flag against my own "genuinely good, no complaints" line: `/usage`'s low-balance banner (`"Out of private-scan credits — the next private scan will be refused (402)"`) fires whenever `creditBalance === 0`, **regardless of monthly allowance remaining** — it doesn't check `usageThisMonth` against the plan's included credits at all. That check isn't tier-gated to Free; it's the same formula for every plan, including Team. My org runs 40 of 500 Team credits/mo (≈8%) and has never bought prepaid overflow credits, so `creditBalance` would read 0 for me too — meaning **this banner would very plausibly fire on my own `/usage` page**, right above the `AllotmentPanel`'s honest "comfortably within your allotment / a smaller tier may fit" copy. Two panels on the one screen I said I trusted disagreeing about whether I'm about to be locked out is not a minor UI wrinkle for someone whose whole renewal case rests on that page reading clean. I'm downgrading L1-ARJ-05 from "no complaints" to "confirmed, plus one new contradiction to watch."

### L1-ARJ-06-STRENGTH (prompt carries the stack-fit caveat) — **still unverified live (ceiling unchanged)**
No notebook/ML repo was live-scanned in this evidence run, so whether the LLM actually complies with the "do NOT penalize for conventions this stack legitimately doesn't use" instruction remains exactly as untested as it was at L1. This is still the single biggest open question for my renewal case, and it's still open after L2.

## 3. New findings (surfaced by the shared evidence, specific to my angle)

- **[major, NEW]** The executive briefing's forecast/trajectory line silently drops its low-data confidence caveat (renders a confident, dated ETA with zero caveat when `n=2`), while the identical situation on the per-repo Trends page renders an honest "low data (n=X)" string. Same root cause pattern I predicted for the stack-fit caveat in L1-ARJ-02 (a real caveat computed elsewhere, missing on the export/board surface) — but this is a distinct mechanism (trend confidence, not stack-fit) and it's now confirmed live, not just theorized. `src/lib/org/briefing.ts:242-248`, `forecastConfidenceNote()`, `executive/page.tsx:159-161`. This is the surface with the "Copy briefing for LLM" and "Download PDF" buttons — exactly what I'd hand my VP.
- **[major, NEW]** `/usage`'s low-balance banner logic (`creditBalance === 0` alone triggers it, ignoring `usageThisMonth` vs. allowance) is not Free-tier-scoped — it would plausibly fire on my own Team org (8% utilization, no purchased overflow credits) directly contradicting the `AllotmentPanel`'s honest utilization read on the same page. This threatens the one part of the product I rated as unambiguously good in L1.
- **[confirmed-good, carried into L2]** The fleet-rollup delta-noise fix (`SCORE_NOISE_BAND`, `isWithinNoise`, live-confirmed `→0` neutral render on a real 21-day-apart same-commit re-scan pair) resolves my L1-ARJ-03 concern for the surface I actually open monthly. Real, working, worth crediting.

## 4. In-character close

"Two things got better since my first pass and one thing got more specific and worse. The fleet page — the one I open first every month — now correctly tells me 'held' instead of dressing up LLM wobble as my team's work. That's real, that's the exact fix I asked for, and I'll say so.

But the executive tab, the one with the PDF and LLM-copy buttons — the one surface built specifically so I don't have to open forty repos by hand — dropped a confidence caveat I didn't even know to worry about yet. Not the stack-fit footnote I was chasing, a *different* one: the trajectory ETA. Same shape of bug though — a real caveat that exists somewhere in this app and evaporates exactly on the page my VP would see. That's not reassuring, that's a pattern.

And then the usage page — the one part of this product I said had no complaints — has a banner that would tell me I'm about to get refused a scan while the panel right below it says I'm at 8% utilization. If I hit that live, cold, mid-renewal-defense, that's the kind of thing that makes me re-read every other number on the page with more suspicion than I had before, not less.

Verdict stands: I renew. The core bet — does the LLM actually respect the stack-fit instruction on my notebook repos — is still unverified, still the thing that decides whether I keep paying past this cycle. But I'm not getting my four hours back yet. I'm getting maybe half of them, and I'm spending the other half double-checking a briefing tab and a usage banner I used to trust by default."

## 5. Findings summary (for aggregation)

```json
[
  {
    "id": "L2-ARJ-01",
    "carried_from": "L1-ARJ-01",
    "verdict": "unconfirmed",
    "note": "No ML/notebook repo scanned live in shared evidence; open."
  },
  {
    "id": "L2-ARJ-02",
    "carried_from": "L1-ARJ-02",
    "verdict": "unconfirmed-but-reinforced",
    "note": "Stack-fit caveat not retested live, but §4's trend-confidence caveat-drop on the same executive-briefing surface is a live-confirmed sibling bug of the same failure pattern."
  },
  {
    "id": "L2-ARJ-03",
    "carried_from": "L1-ARJ-03",
    "verdict": "refuted",
    "note": "SCORE_NOISE_BAND/isWithinNoise now applied to fleet-rollup deltas; live-confirmed →0 neutral render on genuine live-to-live re-scan of unchanged repo, 21 days apart."
  },
  {
    "id": "L2-ARJ-04",
    "carried_from": "L1-ARJ-04",
    "verdict": "unconfirmed",
    "note": "Not exercised by shared evidence; polish severity, unchanged."
  },
  {
    "id": "L2-ARJ-05",
    "carried_from": "L1-ARJ-05-STRENGTH",
    "verdict": "confirmed-with-caveat",
    "note": "Pricing page numbers live-confirmed exact; new /usage banner bug (not Free-tier-scoped) threatens the same page's credibility for Team orgs including Arjun's."
  },
  {
    "id": "L2-ARJ-06",
    "carried_from": "L1-ARJ-06-STRENGTH",
    "verdict": "unconfirmed",
    "note": "No live ML-repo scan in shared evidence; ceiling unchanged."
  },
  {
    "id": "L2-ARJ-07-NEW",
    "type": "trust",
    "severity": "major",
    "title": "Executive briefing forecast trajectory ETA renders with zero low-data confidence caveat, unlike the identical case on per-repo Trends",
    "evidence": ["src/lib/org/briefing.ts:242-248", "executive/page.tsx:159-161"],
    "verdict": "confirmed"
  },
  {
    "id": "L2-ARJ-08-NEW",
    "type": "trust",
    "severity": "major",
    "title": "/usage low-balance banner not tier-scoped — would plausibly fire on a Team org with unused allowance and no purchased overflow credits, contradicting the AllotmentPanel on the same page",
    "evidence": ["src/app/usage/page.tsx:142", "usageDashboard.tsx:45-51"],
    "verdict": "confirmed"
  }
]
```
