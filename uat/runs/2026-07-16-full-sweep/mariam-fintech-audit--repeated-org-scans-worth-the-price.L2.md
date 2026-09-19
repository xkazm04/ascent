# L2 — Mariam (fintech audit lead) × repeated-org-scans-worth-the-price

**Run date:** 2026-07-16. **L1:** this same file's `.md` sibling (2026-07-16, L1-conditional). **Live evidence:** `uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md` (shared pricing-20 panel run, live `claude-cli` engine, real two-point history on `vercel/ai`/`vercel/eve`).

I did not re-drive the browser. I read the shared live evidence against my own five L1 findings and my scored criteria.

## Character reaction (first person)

Verdict on the live evidence: it makes my strongest complaint *worse*, not better, and it independently confirms my weakest one.

Start with what it confirms cleanly. The pricing table (`/pricing`, their §5) is exactly what I logged: Pro $10/mo, Team $20/mo, Enterprise "Custom." My retention numbers match too — Team 365d. That's MAR-L1-04, and it's now not just code-read, it's a live-rendered page. Fine — that I could put in front of an examiner as "the price is legible."

Now the part that actually matters to my job. My top L1 finding, MAR-L1-03, was: you built a real noise-band classifier (`noise.ts`, ±2) and wired it into the digest and the trajectory tone and the period summary — and then didn't wire it into `DimensionDetail.tsx`, the one place I'd click to check whether D9 moved for real. The shared evidence didn't open that exact modal. But it did something more damning: it found the *same defect, on a worse surface*. The Executive Briefing — the board-facing page with a "Download PDF" button and a "Copy briefing for LLM" button, the exact artifact that leaves my hands and lands on a CFO's desk or in a renewal packet — renders a dated, specific-sounding trajectory ETA ("At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13)") with **zero** confidence caveat, on data the team's own `lowData: n < 3` guard knows is thin. The identical situation on the per-repo Trends page *does* render the honest caveat — "trend confidence — low data (n=2)." Same underlying flag, two renderings, one honest, one silent, and the silent one is the one that goes to the board.

That is not a coincidence I can wave off — it's the pattern I already flagged, now showing up a second time on a higher-stakes surface. It tells me the fix lands wherever a specific ticket touched, not by a principle enforced everywhere a confidence-bearing number renders. If I'd cited "the org is fixing noise-legibility systematically" in my last write-up, this would make me walk that back. I'm not walking back the underlying verdict — I'm sharpening it: this is now two confirmed instances, not one code-read instance, and the newer one is worse because it's the exported artifact, not just a UI screen.

The evidence also independently strengthens the *reason* per-dimension noise-muting matters: their own re-scan measured a **±4 swing on D7** across a real 21-day-labeled pair — double the app's own calibrated `SCORE_NOISE_BAND=2`. That's not my dimension (D9), but it's proof the per-dimension noise floor is genuinely wider than the constant the team is trusting, on the same class of surface my D9 complaint lives on. If D9 can swing similarly on re-scan noise (plausible — same engine, same class of signal), a raw colored arrow in `DimensionDetail` is exactly as dangerous as I said.

What the evidence does *not* touch: my retention finding (MAR-L1-01 — the CSV export I'd actually file isn't bounded by `retentionDays`, and the destructive purge reads an unrelated policy) and my tamper-evidence finding (MAR-L1-02 — HMAC signing exists but is silently inert without a configured secret, and `verifyAudit` has no self-serve caller). Neither was exercised in this run — no >365-day-old scan was tested, no audit-CSV signature was hand-verified. I'm carrying both forward exactly as filed, unconfirmed-live but unrefuted, still "present-but-missed" per code.

Net: renew Team, still do NOT upgrade to Enterprise. My reasoning is sharper now, not softer: the live evidence proves the "we built the control and then missed the surface that matters" pattern isn't a one-off — it's now observed twice, and the second instance is the board-facing export. Time-saved stays where I put it in L1: **~4-6 hours a cycle** (a real pre-read improvement over June's ~2h) — not the ~14 hours the design promises, because the two things standing between "pretty read" and "audit evidence" (noise-checked per-dimension/trajectory moves at the surface that's actually cited, and a retention-bounded filed artifact) are both still open, and one of them now has a second, worse live instance.

## Findings

```json
[
  {
    "id": "MAR-L2-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "mariam-fintech-audit",
    "cert_level": "L2",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "CONFIRMED live — Team's $20/mo and Enterprise 'Custom' render exactly as MAR-L1-04 predicted from code",
    "expected": "Concrete Team price + retention visible without a sales call; Enterprise stays negotiated.",
    "got": "Shared live evidence §5: /pricing renders Free $0, Pro $10/mo (100 scans, 180d), Team $20/mo (500 scans, 365d), Enterprise Custom (unlimited, custom retention) — matches plans.ts exactly. A viewer can compute $/scan-cycle self-serve.",
    "evidence": [
      "uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §5",
      "src/app/pricing/page.tsx:40-41,45,56",
      "src/lib/plans.ts:50,62,74"
    ],
    "code_check": "by-design",
    "verdict": "CONFIRMED",
    "outcome": "no_change_needed"
  },
  {
    "id": "MAR-L2-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "mariam-fintech-audit",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "NEW (extends MAR-L1-03) — the board/PDF/LLM-export Executive Briefing trajectory renders a dated confident ETA with ZERO low-data/noise caveat, while the per-repo Trends page shows the caveat for the identical situation",
    "expected": "Per her acceptance criterion 'Move is real, not noise: a D9/overall change is distinguishable from LLM ±25 guardband wobble (R²/flat-floor or provenance surfaced where the move is shown)' — this applies with even higher stakes to the exported/board artifact than to an in-app modal.",
    "got": "Shared live evidence §4: /org/vercel/executive renders 'At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13)' with no 'trend confidence' line anywhere on the page (grep count = 0), root-caused to briefing.ts's forecastConfidenceNote() returning null on low data instead of substituting the honest 'low data (n=X)' string Trajectory.tsx already has for the identical case. The PDF/LLM-copy export shares the same guard, so the artifact that leaves the building is silent too. This is the same defect shape I flagged in MAR-L1-03 (noise/confidence machinery built, then not applied uniformly at the surface that matters) — now a live-confirmed second instance, and on the highest-stakes surface in my entire journey (the one with a Download PDF button).",
    "evidence": [
      "uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §4",
      "src/lib/org/briefing.ts:242-248",
      "src/app/org/[slug]/executive/page.tsx:159-161"
    ],
    "code_check": "present-but-missed",
    "verdict": "CONFIRMED",
    "outcome": "no_change_needed"
  },
  {
    "id": "MAR-L1-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "mariam-fintech-audit",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "CARRIED FORWARD, not directly re-driven — DimensionDetail.tsx per-dimension delta still not routed through classifyDelta/isWithinNoise",
    "expected": "Same as L1: D9's 'since last scan' delta muted to '≈' when within the ±2 noise band.",
    "got": "The shared live-evidence run did not open a Repositories-heatmap dimension cell/modal, so this specific claim was not re-exercised live this cycle. It remains code-confirmed (present-but-missed) from L1. New corroborating live data (§2): a real re-scan of the same commit 21 days apart showed a ±4 swing on D7 — double the app's own SCORE_NOISE_BAND=2 — which raises my confidence that an unmuted per-dimension arrow (D7's or D9's) would misfire in practice, not just in theory.",
    "evidence": [
      "src/components/report/DimensionDetail.tsx:22,31-36",
      "src/lib/maturity/noise.ts:1-27",
      "uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §2 (±4 swing on D7, vs the app's own ±2 band)"
    ],
    "code_check": "present-but-missed",
    "verdict": "PLAUSIBLE",
    "outcome": "no_change_needed"
  },
  {
    "id": "MAR-L1-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "mariam-fintech-audit",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "CARRIED FORWARD, not tested live — CSV export (/api/history) still unbounded by retentionDays; purge policy still unrelated to it",
    "expected": "Team's 365-day retention bounds the filed CSV artifact and/or governs purge, same as it now bounds the two dashboard reads.",
    "got": "Shared evidence did not construct a >365-day-old scan or hit /api/history?format=csv against one, so this was not re-verified live this cycle. Remains code-confirmed from L1 (scans-read.ts:238 row-count clamp only, no retentionCutoff import; retention.ts:81-90 reads an unrelated opt-in policy).",
    "evidence": [
      "src/lib/db/scans-read.ts:227-270",
      "src/lib/db/retention.ts:81-90",
      "src/lib/plans.ts:189-192"
    ],
    "code_check": "present-but-missed",
    "verdict": "PLAUSIBLE",
    "outcome": "no_change_needed"
  },
  {
    "id": "MAR-L1-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "mariam-fintech-audit",
    "cert_level": "L2",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "CARRIED FORWARD, not tested live — audit HMAC signing not confirmed live-active; no self-serve verify path",
    "expected": "She can independently confirm a row's _sig verifies, and knows the signing secret is actually configured.",
    "got": "Shared evidence's audit surfaces were not exercised (no /audit CSV pull, no secret-configuration check) this cycle. Remains code-confirmed from L1: auditSecret() silently returns null if unset; verifyAudit() has no route/UI caller.",
    "evidence": [
      "src/lib/db/audit-integrity.ts:16-19,76-87",
      "uat/env.md (AUDIT_SIGNING_SECRET absent from pinned .env.local set)"
    ],
    "code_check": "present-but-missed",
    "verdict": "PLAUSIBLE",
    "outcome": "no_change_needed"
  }
]
```

## Grounding, time-saved, pricing verdict (L2)

- **Verdict: renew Team, do NOT upgrade to Enterprise.** The live evidence hardens this rather than softening it: the exact defect pattern I flagged (noise/confidence machinery built, then inconsistently applied at the surface that matters) now has a second, live-confirmed instance on the highest-stakes surface in my journey — the board PDF/LLM-export briefing.
- **One-line reason:** the fleet read is a stronger pre-read than a month ago (real pricing, real read-floor retention on two surfaces, real HMAC tamper-evidence), but the artifact I'd actually file (CSV export, unbounded by retention) and the number I'd actually cite (a per-cycle move, unmuted for noise — now confirmed live on the board briefing, not just my original per-dimension claim) both still fail my bar.
- **Time-saved:** unchanged from L1 — **~4-6 hours/cycle** as the product stands today (up from a ~2h "pretty pre-read" baseline), versus the **~14 hours (840 min)** the design promises once the retention-consistency and noise-muting gaps close.

## l2_priority carry-forward (unchanged targets, now with one live-confirmed instance)
1. Open a D9 cell in the Repositories heatmap on a repo re-scanned twice with no code change; confirm the "since last scan" delta shows the raw colored arrow (bug, MAR-L1-03) vs muted "≈" (fixed) — not yet directly re-driven.
2. Fix the now-live-confirmed executive-briefing gap (MAR-L2-02) first — it's cheaper (reuse Trajectory.tsx's existing low-data string) and higher-stakes (board/PDF surface) than the DimensionDetail fix.
3. On a populated Team org with a >365-day-old scan: confirm /api/history CSV still leaks past retention and is still not purged (MAR-L1-01) — not yet directly re-driven.
4. Confirm AUDIT_SIGNING_SECRET/AUTH_SECRET is live and a row's _sig recomputes by hand (MAR-L1-02) — not yet directly re-driven.
