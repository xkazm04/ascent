# L1 — Helena (M&A tech DD advisor) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the recurring read *and* its exportable deal artifact are structurally reachable and genuinely useful inside a deal window, but the pricing model is built for a steady monthly fleet (the exact opposite of her burst-per-deal use), and the in-app price is invisible — so "is the repetition worth the price" is *undecidable from the surface* for her, which is a major pricing-legibility finding even though the journey completes.

## Who's walking it
An independent M&A technical-due-diligence advisor who scans a *target* org 3–6 times across a 4–6 week deal, exports a defensible point-in-time artifact for the deal file, then never opens that org again. She owns the **anti-subscription** facet: she'd pay a lot per deal but resents an idle monthly tier between deals. Her "recurring" is a few clustered scans in a deal window, not a forever cadence.

## Reachable surface set (tier-honest)
Under `ASCENT_AUTH_BYPASS=1` on a populated `/org/<slug>`, she renders as a synthetic **owner**, so every `/org/*` route resolves. But her realistic tier is **Free or a one-month Pro** (she's there for weeks, not a year), and the journey is about whether *that* pencils out:

- **Reachable & tier-agnostic (the wins for her exit job):**
  - `/org/[slug]/executive` briefing — `src/app/org/[slug]/executive/page.tsx:57` **Download PDF** is gated by `requireOrgRead` only (`src/app/api/org/briefing/pdf/route.ts:24`), *not* by tier. **Copy briefing for LLM** (`executive/page.tsx:65`) emits the full markdown brief (`src/lib/org/briefing.ts:205`).
  - `/api/history?repo=…&format=csv` — per-scan CSV export, read-gated only (`src/app/api/history/route.ts:104`). Her portable deal-file artifact in three formats (PDF / markdown / CSV).
- **Reachable but by-tier (fold into price verdict, not free):**
  - **Scheduled autoscans + alerts** are Pro+ (`src/lib/plans.ts:43`) — irrelevant to her anyway; she re-scans on the deal clock by hand, not on a schedule.
  - **Read-only share link** is owner+`BRIEFING_SHARE_SECRET`-gated (`src/app/api/org/briefing/share/route.ts:15,21`); white-label PDF branding is enterprise-only (`executive/page.tsx:46` `canBrand = isOwner && credit.unlimited`). She doesn't need branding; the unbranded PDF is enough.
  - **Retention window** her tier buys: Free **30d**, Pro **180d** (`src/lib/plans.ts:31,41`). For her 4–6-week window even Free's 30 days is borderline-sufficient — but see the retention finding below: the marketed window is **not the enforcement mechanism**.

## Surface-model notes (recurring-value affordances + grounding audit)
- **Trajectory needs ≥2 distinct calendar days** (`src/lib/maturity/forecast.ts:87,100`) — so her *first* scan shows no trend; repetition is required for the GPS to render at all. Good: that's honest. Over her sparse 4–6-scan window, `fitQuality` (R²) will be low and `Trajectory.tsx:96` appends "· noisy" when `confidence < 50`. **Strength**: the noise honesty she demands is wired in.
- **But the ETA/headline still fires off a noisy fit.** `forecastHeadline` (`forecast.ts:283`) will assert "On track to reach L3 in ~8 weeks (≈ date)" whenever `|perWeek| ≥ FLAT_PER_WEEK` (0.5, `forecast.ts:64`) regardless of R². On 4 dots over 5 weeks the slope can clear 0.5/wk on noise alone, and the ETA pill (`Trajectory.tsx:79`) renders a confident date next to a "noisy" confidence chip. For a deal memo, that's a projection she can't defend — the confidence flag and the ETA are *co-equal* on the card, not the ETA *suppressed when noisy*.
- **Re-scan wobble vs real move:** a re-scan of an unchanged target can move the score within the LLM ±25 guardband (per brief / `scoring/engine.ts`); the only defense is the forecast R². Movers (`org-insights.ts` / `PeriodSummary.tsx`) compute deltas vs the previous scan but, from the briefing assembly (`briefing.ts:139`), a dimension delta of ±1–2 is reported as movement with no "within noise" annotation. For DD, a phantom regression is a finding she has to defend.
- **Retention is a display claim, not the trajectory bound.** `plans.ts` `retentionDays` (30/180/365) is read by `/pricing` for display, but the *actual* purge (`src/lib/db/retention.ts:70,231`) is keyed on `retentionMaxScans`/`retentionAuditDays` (env + per-org override, **opt-in, 0 = keep everything**) — `retentionDays` is **not wired to enforcement**. So her trajectory's true look-back is governed by env config, not her tier label. Immaterial to *her* 6-week window, but it means the tier's headline retention promise is decorative.
- **Price is invisible for any paid tier** (`src/app/pricing/page.tsx:15-20`): Pro/Team show only `"Prepaid — credits, 1 per private scan"`; the subscription $ lives in Polar, not the app. Credits debit 1 per private scan (`src/lib/db/credits.ts:147`); there's **no idle monthly floor visible anywhere in code** — but she can't *prove* that from the surface, which is the crux of her churn risk.

### Grounding score (recurring-context sources reaching the read): **5 / 7**
Reaches the read: (1) trajectory/forecast renders once ≥2 days exist; (2) R²/"noisy" flag surfaced on the card; (3) movers/period deltas vs previous scan; (4) exportable artifact (PDF+md+CSV) reachable at her tier; (5) credit-per-scan burn legible on `/usage`. **Missing/broken for her:** (6) the **subscription $ / idle-floor** is not surfaced in-app at all → she can't price the burst; (7) the ETA is **not suppressed or hedged when R² is low**, so trajectory honesty leaks at exactly her sparse-window scale.

## Findings
```json
[
  {
    "id": "HEL-1",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "helena-ma-techdd",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "clarity",
    "title": "No subscription price or idle-floor in-app — a burst buyer can't tell if she'd pay between deals",
    "expected": "From /pricing + /usage, see whether her use (a few scans in a 4–6wk window, then nothing) is payable as a burst, and whether any tier carries a monthly floor she'd idle between deals.",
    "got": "Pro/Team show only 'Prepaid — credits, 1 per private scan'; the subscription $ lives in Polar, never rendered (pricing/page.tsx:15-20). Credits do debit per-scan with no coded monthly floor (credits.ts:147), but she can't PROVE the absence of a recurring charge from the surface.",
    "evidence": ["src/app/pricing/page.tsx:15", "src/app/pricing/page.tsx:30", "src/lib/db/credits.ts:147"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Walk /pricing→/connect as a would-be one-month buyer: is there ANY in-app signal of a recurring subscription floor vs pure prepaid credits, or is the answer only discoverable in Polar checkout?",
    "suggested_acceptance": "Pricing surfaces, for each paid tier, whether there is a recurring monthly charge or it is pure prepaid credits — so a burst buyer can confirm 'pay per scan, no idle floor' without leaving the app."
  },
  {
    "id": "HEL-2",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "helena-ma-techdd",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Confident ETA fires off a noisy short-window fit — undefensible in a deal memo",
    "expected": "Over 4–6 sparse scans in a 5-week window, either no projection ('not enough history') or an ETA explicitly subordinated to its low R².",
    "got": "forecastHeadline asserts 'On track to reach Lx in ~N weeks (≈ date)' whenever |perWeek| ≥ 0.5, independent of fitQuality; the ETA pill renders the date right beside a 'trend confidence X% · noisy' chip as co-equal info (forecast.ts:131,283; Trajectory.tsx:79,96).",
    "evidence": ["src/lib/maturity/forecast.ts:64", "src/lib/maturity/forecast.ts:131", "src/lib/maturity/forecast.ts:283", "src/components/org/Trajectory.tsx:79"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Seed 4 scans over ~5 weeks with small jitter under claude-cli; does the Trajectory card show a confident ETA/date while R² is <50%? Is the ETA suppressed or visibly hedged when noisy?",
    "suggested_acceptance": "When fitQuality is below a confidence threshold, the trajectory suppresses or visibly downgrades the ETA/date to 'directional only' rather than asserting a crossing date."
  },
  {
    "id": "HEL-3",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "helena-ma-techdd",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Small dimension deltas reported as movement with no 'within noise' guard",
    "expected": "A ±1–2 dimension move on a re-scan of an unchanged target is flagged as possibly within the LLM guardband, not stated flatly as a regression/gain.",
    "got": "Briefing priorPeriod and movers report any non-zero delta as movement (briefing.ts:139,234); no annotation distinguishes a real change from a guardband wobble on an unchanged repo.",
    "evidence": ["src/lib/org/briefing.ts:139", "src/lib/org/briefing.ts:234", "src/app/org/[slug]/executive/page.tsx:133"],
    "code_check": "present-but-missed",
    "verdict": "uncertain",
    "l2_priority": "Re-scan an UNCHANGED target twice under claude-cli; does a phantom ±1–3 dimension delta appear in 'vs previous period' with no noise caveat?"
  },
  {
    "id": "HEL-4",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "helena-ma-techdd",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Marketed tier retention (30/180/365d) is decorative — not the enforcement mechanism",
    "expected": "The retention window a tier advertises is the window that actually bounds how far back the trajectory can look.",
    "got": "plans.ts retentionDays is display-only for /pricing; the purge job is driven by retentionMaxScans/retentionAuditDays (env + per-org, opt-in, 0=keep-everything) and never reads retentionDays (retention.ts:70,231).",
    "evidence": ["src/lib/plans.ts:31", "src/lib/db/retention.ts:70", "src/lib/db/retention.ts:231"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Low priority for her (6-week window unaffected); confirm whether any code path maps retentionDays → an enforced cutoff, or it is purely a marketing label."
  },
  {
    "id": "HEL-5",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "helena-ma-techdd",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "completion",
    "title": "STRENGTH — exportable, tier-agnostic deal artifact (PDF + markdown + CSV) enables a clean export-and-cancel",
    "expected": "Export a point-in-time brief for the deal file that survives after she cancels, without needing a paid seat to re-open it.",
    "got": "Download PDF (read-gated only, no tier check — briefing/pdf/route.ts:24), Copy-for-LLM markdown (briefing.ts:205), and per-scan CSV (history/route.ts:104) are all reachable at her tier; the artifacts are static files she keeps. White-label branding is enterprise-only but she doesn't need it.",
    "evidence": ["src/app/api/org/briefing/pdf/route.ts:24", "src/app/org/[slug]/executive/page.tsx:57", "src/app/api/history/route.ts:104"],
    "code_check": "by-design",
    "verdict": "confirmed"
  },
  {
    "id": "HEL-6",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "helena-ma-techdd",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — trajectory refuses to render without ≥2 distinct days, and flags low-R² fits as 'noisy'",
    "expected": "Don't draw a trend off a single scan; warn when the straight-line read is untrustworthy.",
    "got": "forecastTrajectory returns null below 2 distinct calendar days (forecast.ts:87,100); the card appends '· noisy' below 50% confidence (Trajectory.tsx:96). The honesty SCAFFOLD she wants exists — HEL-2 is that the ETA escapes it.",
    "evidence": ["src/lib/maturity/forecast.ts:87", "src/lib/maturity/forecast.ts:100", "src/components/org/Trajectory.tsx:96"],
    "code_check": "by-design",
    "verdict": "confirmed"
  }
]
```

## Character feedback (in Helena's voice)
Would I renew? **Wrong verb.** There's nothing to renew — I'm in this target's org for six weeks and then I'm gone, and the product doesn't seem to know people like me exist. The good news first: I can scan the target, watch a couple of dimensions actually move between my Tuesday and my Friday pulls, and then *export the whole thing* — a board PDF, a markdown brief I can paste into a memo, a CSV for my spreadsheet — and none of that asked me to be on a paid tier. That's exactly my exit: file it in the data room, walk away, keep the artifact forever. Whoever wired the PDF to read-access and not to a subscription seat understood my job.

Is each cycle telling me something new? Inside the window, mostly yes — the movers and the "vs previous period" block do show me what shifted since my last look, which beats me re-diffing by hand. **But do I trust a move is real?** Not entirely. When I re-pull an unchanged repo and a dimension ticks down two points, nobody tells me that's the model breathing inside its guardband versus an actual regression — and in a deal memo a phantom regression is a finding I have to defend to the buyer's lawyers. Worse, the trajectory will hand me a confident "reaches L3 in ~8 weeks, ≈ this date" off four dots over five weeks, sitting right next to a little chip admitting the trend is "noisy." Those two things shouldn't be the same size. If the fit's that weak, *don't give me a date* — say "directional only." I'd never put that ETA in front of an investment committee, so I just won't use it, which means I'm paying for a feature I have to ignore.

Does the cost pencil out at my size? **I genuinely can't tell, and that's the dealbreaker.** The page says "prepaid credits, one per private scan" — fine, that's the model I *want*, pay per scan and leave. But it won't show me the subscription dollar. Is there a monthly floor I'd idle ten months a year between deals? The code apparently doesn't charge one, but I can't see that from the page — and I've been dunned for a year by a tool that "just billed per use." If you can't show me there's no idle floor, I assume there is one, and I price you as a year-round subscription against six weeks of use. That math churns me before I start.

What's missing for my job? One line on the pricing page: "pay-per-scan, no recurring subscription" — or, if there *is* a floor, name it so I can expense it to the deal. And an ETA that knows when to keep its mouth shut. Would I tell a peer? I'd tell a peer doing DD: "great export, scan the target, file the brief, cancel — but don't trust the trajectory dates, and budget like there might be a monthly floor because they won't tell you."

## Verdict block
- **Grounding score:** **5 / 7** recurring-context sources reach her read (trajectory renders + noise-flagged; movers/deltas; exportable artifact at-tier; credit burn legible — but the subscription-$/idle-floor is invisible, and the ETA isn't suppressed when noisy).
- **Per-cycle time-saved (number):** **~2–4 hours per in-window re-scan** (replacing her manual re-diff since her last look), within a **~30–60 hour** total per-deal saving vs her 1–2-week manual first-pass audit. The recurring read's *marginal* value is the 2–4h/cycle figure.
- **Renew / downgrade / churn / upgrade:** **CHURN (priced wrong for her) — but a near-miss "buy-per-deal".** Reason: the export-and-cancel path is excellent and tier-agnostic, but the model is built for a steady monthly fleet she isn't; with no visible subscription $ she can't confirm there's no idle floor, so she walks. *Flip to "buy per deal" the instant the page states "no recurring subscription — pure prepaid credits."*

## l2_priority carry-forward (top first)
1. **HEL-1** — Walk `/pricing → /connect` as a one-month buyer: is there ANY in-app signal distinguishing a recurring subscription floor from pure prepaid credits, or is that only discoverable in Polar checkout?
2. **HEL-2** — Seed 4 scans over ~5 weeks (small jitter) under claude-cli: does the Trajectory card assert a confident ETA/date while R² < 50%, instead of suppressing/hedging it?
3. **HEL-3** — Re-scan an UNCHANGED target twice under claude-cli: does a phantom ±1–3 dimension delta surface in "vs previous period" with no noise caveat?
