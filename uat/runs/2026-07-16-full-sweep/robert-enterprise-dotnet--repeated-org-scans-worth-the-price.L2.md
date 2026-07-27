# L2 (live-evidence-grounded) — Robert (enterprise .NET director) × "Repeated org scans worth the price"

cert_level: L2 · promotion: discovery → L2 · reasoned from `uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md` (live claude-cli run, 2026-07-16); browser not re-driven for this pass — my two open majors sit outside what that shared run happened to exercise, so they are carried forward on their L1 code grounding, not re-confirmed live.

---

## 1. My reaction to the live evidence

"I read the shared evidence the way I'd read a status update from my own platform team, not the vendor's press release. Three things land:

First — the part I was most worried about at L1, whether the noise-filtering in `digestHasSignal()` was just a nice comment or an actual behavior, is now shown working against a *real* re-scan, not a hypothetical. Two commits, 21 days apart, genuinely unchanged, and the fleet rollup renders `→0` in a neutral tone, not a fake ▲ or ▼. That's exactly the discipline my own reference material demands, and now I have a live data point, not just a code comment, to defend it with. Good.

Second — pricing legibility, which I don't personally negotiate but do have to certify, is confirmed live: Pro and Team show real $/month, Enterprise correctly stays 'Custom — contact us,' same source of truth as the entitlement gate. That part of my renewal story holds.

Third, and this is new and it worries me more than either of my original findings: the shared evidence caught the org-level Executive Briefing — the exact page my digest links to, the one with the 'Download PDF' and 'Copy briefing for LLM' buttons I would use to forward this up — stating a dated ETA ('at risk of slipping... in ~4 weeks, ≈ 2026-08-13') with *zero* confidence caveat, on data that the sibling per-repo Trends page, looking at the identical low-data situation, correctly flags as 'low data (n=2).' That is precisely the failure mode I'm most allergic to: a specific-sounding number leaving my building with no hedge attached. If I forward that PDF and a CFO later asks 'how confident were you in that August date,' I have nothing — the tool itself didn't tell me to hedge. This isn't my cadence problem or my Slack problem; it's a *third*, independent trust gap on the one surface I'd actually put my name behind.

My two original blockers — no cadence control (I need quarterly, I have a hardcoded Monday cron) and Slack-only delivery (my floor runs Outlook/Teams) — are not addressed one way or the other by this run. Nobody exercised the alert-config popover or the cron schedule live in this pass. I'm not walking those back; they stand exactly as I found them at L1, on the same code citations, because nothing in this evidence contradicts or resolves them.

**Verdict: still would not certify at renewal — and I found a third reason, not a countervailing one.** The content quality is real and I believe it more now than I did at L1. But 'I believe the content is good' and 'I can certify this line item to procurement' are different bars, and today I clear the first, not the second."

**One-line reason:** the digest's substance is now live-confirmed (noise-aware, price-legible), but the board-facing briefing it deep-links to has an unhedged confident ETA on thin data, on top of my still-unresolved cadence and delivery gaps — so renewal cannot be certified as-is.

**Time-saved (unchanged, still conditional):** ~4–8 hrs (240–480 min) of chief-of-staff time per quarterly cycle + ~10 min of my own read time, *if and only if* the digest reliably reaches me on my chosen cadence — which today it structurally cannot guarantee (weekly-only cron, Slack-only pipe). Call it **360 min (midpoint)**, flagged conditional.

---

## 2. Adversarial verification of L1 findings against the live evidence

### L1-robert-01 — No digest cadence control (hardcoded weekly cron) — **not addressed by this evidence; carried forward, unconfirmed live**
The shared evidence run never touched `vercel.json`, `AlertsControl.tsx`, or `/api/org/alerts` — its browser session was spent on `/org/vercel`, `/org/vercel/executive`, `/trends`, `/usage`, `/pricing`, `/org/vercel/repositories`. Cadence config was not in scope for that session. I cannot say the live evidence confirms it (no live attempt was made to set quarterly), and I cannot say it refutes it either. **Status: open, standing on its original L1 code citations** (`vercel.json:11-14`, `src/lib/window.ts:100-104`, `AlertsControl.tsx:18-27`). No change to severity (major).

### L1-robert-02 — Slack-only delivery, no email path — **not addressed by this evidence; carried forward, unconfirmed live**
Same situation: `dispatchAlert()`/`alerts.ts` and the email infra split were never exercised live in this pass (the session's live checks were pricing, usage, executive briefing, fleet rollup, repositories cadence-disabled state — not alert delivery transport). **Status: open, standing on its original L1 code citations.** No change to severity (major).

### L1-robert-03 — ScheduleSelect (per-repo autoscan) easy to conflate with digest cadence — **partially touched, consistent with L1**
§7 of the shared evidence confirms live that `/org/vercel/repositories`'s cadence `<select>` is disabled-with-hint (`"Autoscan scheduling requires the GitHub App."`) in this dev environment — which is the same control L1-robert-03 flagged as a different mechanism from the digest push. This doesn't change the finding (it's still a distinct control, still capable of being mistaken for digest cadence by someone who finds it and doesn't read the tooltip carefully) — it just confirms the control exists and renders as designed, live, not just in source. **Status: open, minor, unchanged severity.** This is a confirmation of the control's *existence and disabled-state rendering*, not a test of the conflation risk itself.

**Net: 0 of 3 L1 findings directly confirmed or refuted by this evidence pass** — none of the three sit inside what the shared session happened to exercise. All three remain open on their original static-code grounding, which I have no reason to doubt (the cited line numbers describe cron config and component state, not runtime behavior that this session's server restarts or seeding would have changed).

---

## 3. New finding this evidence surfaces for my specific angle

```
{
  "id": "L2-robert-04",
  "journey": "repeated-org-scans-worth-the-price",
  "character": "robert-enterprise-dotnet",
  "cert_level": "L2",
  "type": "trust-gap",
  "severity": "major",
  "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
  "dimension": "clarity",
  "title": "Executive Briefing — the exact surface Robert would forward up (PDF / 'copy for LLM') — states a dated trajectory ETA with zero confidence/low-data caveat, unlike the sibling per-repo Trends page for the identical situation",
  "expected": "The one artifact Robert has said he'd personally stake his name on ('I'd forward this digest up as-is') must not contain an unhedged, specific-sounding claim (a dated ETA) built on data the app's own logic already knows is thin — especially not on the surface with a Download-PDF / Copy-for-LLM button meant to leave the building unedited.",
  "got": "Live at /org/vercel/executive: 'At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13).' with NO 'trend confidence' line anywhere on the page (grep -c \"confidence\" on the captured HTML = 0), while /trends?repo=vercel/ai, facing the identical n=2 low-data situation, correctly renders 'trend confidence — low data (n=2)'. Root cause: src/lib/org/briefing.ts:242-248's forecastConfidenceNote() returns null on low data instead of substituting the honest low-data string Trajectory.tsx already has; executive/page.tsx:159-161's guard then renders nothing at all. The same silent gap propagates into briefingMarkdown() (used by both the PDF export and the 'copy for LLM' button).",
  "evidence": [
    "uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md §4",
    "src/lib/org/briefing.ts:242-248",
    "executive/page.tsx:159-161"
  ],
  "code_check": "confirmed-live",
  "verdict": "confirmed",
  "resolution": "open",
  "note": "This is independent of Robert's two L1 majors (cadence, Slack-only delivery) — it is a THIRD, separate reason renewal cannot be certified today, on the surface most likely to be forwarded unedited to a CFO."
}
```

---

## 4. Updated summary

- **Verdict: L2-still-conditional, worse than L1 assumed** — the digest's content quality is now live-confirmed as substantive and noise-aware (not just well-commented code), which strengthens my confidence in the *design intent*. But renewal certification requires three things to be true, and only the content-quality one is now live-verified: (1) cadence control — still absent, unverified this pass, standing on L1 code grounding; (2) delivery reaches my org's actual channel (email/Teams) — still absent, unverified this pass, standing on L1 code grounding; (3) NEW — the forward-up artifact itself must not contain an unhedged confident claim on thin data — **this one is now a confirmed live failure**, not just a theoretical gap.
- **Findings tally for this pass:** 0 of 3 L1 findings confirmed or refuted by the live evidence (none were in scope of what the shared session exercised); 1 new major finding surfaced that bears directly on Robert's "senior wouldn't forward a report he can't defend" bar.
- **Time-saved: ~360 min/cycle (midpoint of 240–480), still fully conditional** on cadence + delivery + (now also) briefing-confidence-hygiene being fixed — unchanged from L1's estimate, because none of the blocking conditions were resolved by this evidence, and one new one was added.
- **Grounding score:** n/a — the digest itself is a template over precomputed facts (per L1); the new finding is about a rendering/guard-logic bug in `briefing.ts`, not an LLM grounding failure.
