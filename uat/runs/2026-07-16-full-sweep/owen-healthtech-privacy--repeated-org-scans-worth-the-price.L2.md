# L2 — Owen (HIPAA platform eng) × repeated-org-scans-worth-the-price

**Verdict: UPGRADE (to Enterprise) — unchanged from L1, but with one new caveat I want fixed before I forward anything.**
One-line reason: the shared live evidence doesn't touch my core surface (BYOM Bedrock Settings — that org wasn't seeded with it), but it independently corroborates the engine-honesty machinery I already trusted, and it surfaces a new, board-facing over-confidence bug that sits exactly on my "no over-claim" nerve.
Time saved: **~16 hours/cycle** (unchanged from L1 — the manual baseline is a 2–3 day by-hand security/architecture memo; a self-serve, engine-honest recurring read compresses that to ~15–20 min/cycle, *conditional on the privacy-safe path actually being what's running*).

---

## What the shared evidence could and couldn't speak to

The shared run (`_L2-shared-pricing-evidence.md`) scanned `vercel/*` repos live on `LLM_PROVIDER=claude-cli` — a cloud engine, and precisely the one I can't put under a BAA. It never touched `/org/vercel/settings`, never configured BYOM Bedrock, and never hit `/pricing`'s Enterprise feature-bullet list directly (it read the tier table: price + scans + seats + retention, not the feature strings). So my central L1 finding — that the BYOM Settings page is real, self-serve, and fails closed — is **not re-verified by this evidence, and not contradicted either.** I'm carrying it forward at L1 confidence, not L2. Same for the self-host gap, the max-files disclosure drift, and the mock-floor-is-thin note: none of those surfaces got touched this cycle. That's a scope limit of this run, not a retraction on my part.

What the shared evidence *does* speak to, directly:

## 1. Engine-honest recurring read — reinforced, now with independent corroboration (CONFIRMED)

My L1 finding was that `repoTrajectory.ts` excludes engine-crossing deltas from "real movement," and that `engineProvider` persists and surfaces everywhere. The shared run adds a second, independent data point I didn't have: `SCORE_NOISE_BAND=2` / `isWithinNoise()` is now applied to movers, the digest, and alerts — and it's **calibrated off a real repeat-scan experiment** (their own code comment cites the prior UAT's Δ0/±1 numbers). Live-confirmed: `vercel/ai` and `vercel/eve`, genuinely Δ0 across 21 days, render `→0` neutral — not a fake ▲/▼. That's the same discipline I found in the trajectory movement guard, applied one layer further down (period-over-period deltas, not just engine-crossing ones). Good — it means a small number moving on an unchanged repo doesn't get sold to whoever's reading `/usage` or the digest as a real signal, which is exactly the "can I tell a real move from noise" question my whole recurring-scan bet turns on. This strengthens my confidence in the machinery beyond what I could see at L1 on my own surfaces.

One nuance the shared evidence adds that I should flag for my own criteria: the per-*dimension* swing (±4 on D7 in their sample) is wider than the app's own `SCORE_NOISE_BAND=2`. Not user-visible today — no delta styling exists at the dimension level — but if a future feature adds per-dimension delta arrows, that band needs a wider recalibration sample first. Filing as a minor watch item, not a finding against the product as it ships today.

## 2. `/pricing` Enterprise still doesn't name BYOM (CONFIRMED, unchanged)

The shared evidence's pricing table confirms the tier structure I already found: Enterprise stays **"Custom · contact us"** — no itemized feature list shown in their pass, consistent with `plans.ts`'s `["Unlimited scans", "Unlimited members", "Custom retention", "Priority support"]` that I read directly at L1. Nothing here moves my finding. The one feature that gates my actual decision is still not the thing sold to me on the page built to sell it.

## 3. NEW — the exact over-confidence failure mode I distrust vendors for, now confirmed live on the board-facing surface

This is the finding that matters most from the shared evidence, for my angle specifically. `/org/vercel/executive` renders a dated ETA — *"At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13)"* — with **zero confidence caveat**, on data with only 2 comparable scans (`n=2`, `lowData: true`). The identical situation on the per-repo `/trends` page correctly renders `trend confidence — low data (n=2)`. Root cause is code-confirmed: `forecastConfidenceNote()` returns `null` on low data instead of substituting the honest low-data string the per-repo component already has.

Read my own acceptance bar back to yourself: *"the recurring read is engine-honest: each scan records which provider produced it... so a degraded/mixed-engine cycle is visible in the trend, not laundered."* This isn't an engine-mix issue, it's the same species of bug — a number that looks more certain than the underlying data supports, shipped silently on the surface with a "Download PDF" and "Copy briefing for LLM" button, i.e. the artifact most likely to leave the building with my name near it and land on a CFO's desk unedited. That's precisely my failure mode: not a lie, but an unearned confident tone where a hedge belongs. I killed a vendor pilot for less than this. It doesn't move me off "upgrade" today because the underlying trajectory math is still honest (guardbanded blend, engine provenance intact) — but it tells me the honesty discipline I found in Settings and in the trajectory guard hasn't been applied uniformly across every surface that exports a number. Before I'd paste a briefing into a renewal doc for my own CFO, I want this fixed.

## Findings (L2)

```json
[
  {
    "id": "owen-executive-briefing-confidence-silent",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "NEW — /org/[slug]/executive shows a dated trend ETA with no low-data confidence caveat, on the exact surface (PDF/LLM-export) a regulated buyer would forward for a renewal decision",
    "expected": "Per my own acceptance bar, a recurring read must be engine/data-honest end to end — a low-confidence trajectory should read as low-confidence everywhere it's shown, especially on the board-facing export surface, not just on the per-repo trends page.",
    "got": "src/lib/org/briefing.ts's forecastConfidenceNote() returns null on lowData instead of the honest 'trend confidence — low data (n=X)' string Trajectory.tsx already renders for the identical case; executive/page.tsx's guard then renders nothing. Verified live: /org/vercel/executive shows '~4 weeks (≈2026-08-13)' with zero confidence text (grep count 0), on n=2 data. briefingMarkdown() (used by both PDF and 'copy for LLM') has the same gap, so exported artifacts inherit the silence.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §4", "src/lib/org/briefing.ts:242-248", "src/app/org/[slug]/executive/page.tsx:159-161"],
    "code_check": "confirmed-absent",
    "verdict": "CONFIRMED",
    "l2_priority": "already-verified-live"
  },
  {
    "id": "owen-engine-honest-trend-reinforced",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L2",
    "type": "trust",
    "severity": "minor",
    "dimension": "trust",
    "title": "CONFIRMED via independent evidence — SCORE_NOISE_BAND/isWithinNoise now applies the same honesty discipline to movers/digest/alerts, calibrated off a real repeat-scan sample",
    "expected": "carried from L1: engine/period-over-period deltas should not be laundered as real movement.",
    "got": "Shared evidence's live vercel/ai + vercel/eve repeat scans (Δ0 overall, 21 days apart) correctly render '→0' neutral, not a fake trend arrow, corroborating my own repoTrajectory.ts finding with an independently observed data point on a different org.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §3", "src/lib/maturity/noise.ts"],
    "code_check": "present-but-missed",
    "verdict": "CONFIRMED",
    "l2_priority": "none — corroborated, no further action"
  },
  {
    "id": "owen-pricing-omits-byom",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "major",
    "dimension": "clarity",
    "title": "CONFIRMED (unchanged) — Enterprise tier on /pricing still shows only 'Custom · contact us,' no BYOM/Bedrock mention",
    "expected": "carried from L1.",
    "got": "Shared evidence's pricing table confirms Enterprise = Custom/contact, matching my L1 read of plans.ts's feature-bullet list (no BYOM/Bedrock string present). Not re-litigated by the shared run's feature-bullet text, but the tier structure it captured is consistent with my finding.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §5", "src/lib/plans.ts:69-80"],
    "code_check": "confirmed-absent",
    "verdict": "CONFIRMED",
    "l2_priority": "unchanged — add BYOM bullet to Enterprise feature list"
  },
  {
    "id": "owen-byom-settings-live",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L1-carried",
    "type": "trust",
    "severity": "major",
    "dimension": "senior-quality",
    "title": "NOT RE-TESTED this cycle — BYOM Bedrock Settings page (my central L1 strength) was outside the shared evidence's scope (vercel org, claude-cli engine, no Settings visit)",
    "expected": "carried from L1 — self-serve, fail-closed per-org Bedrock config.",
    "got": "Shared run never opened /org/vercel/settings or configured Bedrock. No contradiction found, no fresh confirmation either. Standing on my own L1 source read.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/owen-healthtech-privacy--repeated-org-scans-worth-the-price.md (L1)"],
    "code_check": "not-retested",
    "verdict": "CARRIED-UNVERIFIED",
    "l2_priority": "still open: live BYOM save+test+scan end-to-end on an Enterprise org"
  },
  {
    "id": "owen-no-selfhost-beyond-bedrock",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "owen-healthtech-privacy",
    "cert_level": "L1-carried",
    "type": "missing-feature",
    "severity": "major",
    "dimension": "missing",
    "title": "NOT RE-TESTED — no self-host/on-prem path beyond Bedrock remains an open gap; shared evidence didn't touch provider config",
    "expected": "carried from L1.",
    "got": "No new evidence either way.",
    "evidence": [],
    "code_check": "not-retested",
    "verdict": "CARRIED-UNVERIFIED",
    "l2_priority": "unchanged"
  }
]
```

## Character feedback (Owen, first person)

"I went into this cycle expecting to re-check the one thing that actually moved me last time — the BYOM Bedrock Settings page — and instead got a different org's evidence, on a cloud engine I already can't use for real work. So on my own core question I'm exactly where L1 left me: the Settings page exists in the code I read, it's real, it fails closed, nobody's shown me a reason to distrust that this cycle, but nobody's re-driven it live either. Fair — that wasn't this run's job. I'm not downgrading on silence.

What I *did* get is useful, just not where I expected it. The noise-band work — `SCORE_NOISE_BAND`, applied now to movers, the digest, alerts — is the same discipline I found in the trajectory engine-crossing guard, just extended. Two independent real re-scans, 21 days apart, render as `→0`, not a fake arrow. Good. That's one more reason to believe a move I see in this product is a move that actually happened, not model wobble dressed up as insight.

But then there's the executive briefing. `~4 weeks (≈2026-08-13)`, no hedge, on two data points, exportable to PDF, exportable as a paste-ready LLM prompt for a CFO. The same product that correctly says 'low data (n=2)' one click away on the per-repo trends page says nothing at all on the surface built for someone who isn't going to click one more page to check. That's the exact shape of thing I flag: not a lie, a *confident tone the data doesn't earn*, shipped on the highest-stakes export. I don't kill deals over this — the underlying math is still honest, still guardbanded, still provider-tagged — but if I forwarded that PDF to my CFO today and someone later asked 'how sure were we,' the honest answer 'not very, on two points' isn't anywhere on the page I gave them. Fix that before I trust the export enough to actually attach it to a renewal case.

**Verdict stands: upgrade to Enterprise.** The reason stands too — the on-ramp is real and I can reach it myself. But add this to the list: name BYOM on `/pricing`, and put the low-data caveat on the briefing page and its exports, not just the trends page. Two honesty gaps, same root cause — a good instinct (don't over-claim) applied inconsistently across surfaces. Fix both and I'd call this clean."

## Carry-forward for next L2/L3 pass
1. Live BYOM Bedrock end-to-end (save creds, test-connection, run a private scan, confirm report chip shows org's own account) — still untested by any live evidence to date.
2. Confirm the executive-briefing confidence-caveat fix once shipped: `forecastConfidenceNote()` should substitute the low-data string, gated on `forecastHeadline` alone, matching `Trajectory.tsx`.
3. `/pricing` Enterprise feature bullets: confirm BYOM/Bedrock gets named.
4. Self-host/on-prem path below Bedrock: still open, still untested this cycle.
5. Max-files disclosure drift (32 vs 50): still open, still untested this cycle.
