# L1 — Robert (enterprise .NET director) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional.** The recurring artifact is structurally real and genuinely good — a self-contained, decision-ready digest that survives a director who never opens the app, and a regression-alert layer with a credible noise floor. But it ships with **two recurring-value defects that bite every cycle for THIS character specifically**: the digest is a **fixed weekly cron with no cadence control and no movement gate** (it emails "no change this week" on a stable fleet, the exact pattern that trains an inbox filter), and the regression threshold's default (**5 pts**) sits **inside** the ±25 scoring guardband, so a recommitted-but-unchanged-maturity repo can page him. Both are visible in code, both are fixable, both are L2-eligible.

## Reachable surface set (tier-honest — Robert = Enterprise)
Enterprise unlocks everything the cadence machinery offers, so unlike a Free/Pro character nothing here is gated away from him:
- **Digest** `src/app/api/cron/digest/route.ts` — the weekly fleet push; his primary touchpoint. Reachable (Pro+; Enterprise ⊇ Pro). `vercel.json:12-15` pins it to `0 13 * * 1` (Mon 13:00 UTC), **deployment-global, not per-org**.
- **Alerts** `src/lib/alerts.ts` + `src/lib/db/org-alerts.ts` + `src/components/org/AlertsControl.tsx` (`/api/org/alerts`) — regression / low-credit pushes; per-org webhook + per-org overall/dimension thresholds. Reachable + configurable.
- **Digest deep-link target** `/org/[slug]/executive` — where the digest links (`digest/route.ts:78`); he likely never clicks it, by design of his character.
- **Pricing** `/pricing` + `src/lib/plans.ts:55-64` — Enterprise = `includedCredits:null` (unlimited, no credit burn — the P×C cost model is moot for him), `retentionDays:null` (custom retention — trajectory can look back as far as the deployment keeps data), price = **"Custom — contact us."** Procurement owns the number; he certifies value, not price.

His credit/retention anxieties (the facets that bind Free/Pro characters) **don't apply** — unlimited + custom retention. His entire verdict rides on the **between-login artifact**.

## Surface-model notes (recurring-value affordances → file:line)
- **Digest is genuinely self-contained** (strength). `buildFleetDigestMessage` (`src/lib/alerts.ts:167-208`) packs fleet score+level, delta-this-week, trajectory headline, top gainers/regressers with magnitudes, the single highest-leverage gap (with repo-count), percentile, and a credit-runway line. The body carries the decision, not just a link. `digest/route.ts:64-94` feeds it from real rollup/movers/recs/benchmark/forecast. This is the artifact that replaces his chiefs-of-staff doc — and it reads like one.
- **Digest fires unconditionally on a fixed weekly cron** (defect). `digest/route.ts:65` gates only on `rollup.scannedCount === 0`; if ≥1 repo scanned and a sink resolves (`:60,:95`), it **always sends**. On a stable fleet `overallDelta === 0` renders **`" (no change this week)"`** (`alerts.ts:171-172`). There is no movement gate and no auto-pause. Cadence is hardcoded weekly (`vercel.json:13-14`); **no per-org cadence field exists** (`AlertsControl.tsx` exposes webhook + thresholds only — no cadence input; grep for cadence/digest-schedule fields returns none). For a director on a quarterly rhythm this is the "weekly summary nobody reads after month two."
- **Regression noise floor — half-right** (defect + strength). Unchanged commits dedup and **skip the diff entirely** (`rescan/route.ts:136,138`; `scan-alerts.ts:58` returns no-op on missing/equal `prev`), so a literally-unchanged repo fires nothing — good. But when a repo IS recommitted, `detectRegression` (`alerts.ts:46-95`) fires `overall-drop` at `DEFAULT_THRESHOLDS.overallDrop = 5` (`alerts.ts:38`). The scoring engine guardbands the LLM **±25** to the deterministic signal, blended 60/40 — so a 5-point swing is **comfortably inside the model's own breathing room**. Nothing in the alert tells him "this move cleared the noise band"; the forecast's R²/flat-floor (`forecast.ts:64` `FLAT_PER_WEEK=0.5`, `fitQuality`) is computed but **not carried into the regression alert** — only into the digest's trajectory headline. He can raise the threshold himself (`AlertsControl.tsx:148-157`), but the default invites a noise page.
- **Trajectory needs repetition to exist** (correct gate, strength). `forecastTrajectory` (`forecast.ts:82-149`) returns null below 2 distinct calendar days; the digest only shows a trajectory line once history exists (`digest/route.ts:88`). Repetition is what makes the artifact richer over time — the right shape. With Enterprise custom retention, the look-back isn't capped, so his quarterly trajectory is real.
- **Low-credit push** (strength, but moot for him). `maybeAlertLowCredits` (`scan-alerts.ts:110`) pushes on depletion — exactly the silent-churn moment — but Enterprise is `unlimited`, so it never fires for Robert. Fine; it's there for the metered tiers.

## Findings
```json
[
  {
    "id": "ROB-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "robert-enterprise-dotnet",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Weekly digest fires on a fixed cron with no movement gate — emails 'no change this week' and trains the inbox filter",
    "expected": "A director who never logs in gets the recurring artifact ONLY when the fleet actually moved (or on his cadence), per the actionable-alerts bar: a push that consistently says nothing must auto-pause, or it erodes trust in the whole channel.",
    "got": "digest/route.ts sends every Monday for any org with >=1 scanned repo and a sink; a stable fleet renders ' (no change this week)' (alerts.ts:171-172). No movement gate, no auto-pause, no suppression-when-flat.",
    "evidence": ["src/app/api/cron/digest/route.ts:65", "src/app/api/cron/digest/route.ts:95", "src/lib/alerts.ts:171", "vercel.json:13"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "l2_priority": "Run the digest cron twice over a fleet whose scores didn't move; confirm it sends a 'no change this week' message the second cycle with no new actionable content — the inbox-filter trigger.",
    "suggested_acceptance": "Digest suppresses (or downgrades to a quieter monthly/quarterly) when overallDelta==0 AND no mover crosses a material threshold AND no new top-rec; or a 'send only on movement' toggle in AlertsControl."
  },
  {
    "id": "ROB-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "robert-enterprise-dotnet",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Default regression threshold (5 pts) sits inside the ±25 scoring guardband — alerts can fire on model wobble, not real movement",
    "expected": "An interruption clears the scan-to-scan noise band, and the alert says so — a move I'm paged for is real, not the LLM breathing within its guardband on a recommitted repo.",
    "got": "DEFAULT_THRESHOLDS.overallDrop=5 (alerts.ts:38) vs the engine's LLM ±25 guardband / 60-40 blend. The forecast's R²/flat-floor (forecast.ts:64) is computed but never carried into buildRegressionMessage — the alert states the drop, not whether it cleared noise. Unchanged-commit dedup (rescan/route.ts:138) protects only the literally-identical case.",
    "evidence": ["src/lib/alerts.ts:38", "src/lib/alerts.ts:69", "src/lib/maturity/forecast.ts:64", "src/lib/scan-alerts.ts:58"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Re-scan a CHANGED-but-maturity-stable repo twice under claude-cli; if overall swings >=5 within the guardband, confirm a regression alert fires and check whether anything flags it as noise vs real.",
    "suggested_acceptance": "Raise default overallDrop above the guardband floor, or annotate the alert with fit-confidence / 'cleared the noise band' so a 5-pt page is defensible."
  },
  {
    "id": "ROB-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "robert-enterprise-dotnet",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "No per-org digest cadence — a director on a quarterly renewal rhythm gets a weekly drip he can't retune",
    "expected": "Set the recurring push to my rhythm (monthly/quarterly) so it matches the renewal/review cadence I actually act on.",
    "got": "Cadence is the global vercel.json cron only (0 13 * * 1). AlertsControl exposes webhook + drop thresholds, no cadence field; org-alerts.ts stores webhook + thresholds, no cadence column.",
    "evidence": ["vercel.json:13", "src/components/org/AlertsControl.tsx:136", "src/lib/db/org-alerts.ts:40"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "n/a at L2 (config-shape) — confirm no hidden cadence control on the dashboard.",
    "suggested_acceptance": "Per-org digest cadence (weekly/monthly/quarterly) on the org record, surfaced in AlertsControl."
  },
  {
    "id": "ROB-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "robert-enterprise-dotnet",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "completion",
    "title": "STRENGTH: the digest is a self-contained, forward-it-up artifact, not a bare dashboard link",
    "expected": "The recurring value must survive a director who never opens /org/[slug] — the decision lives in the inbox body.",
    "got": "buildFleetDigestMessage carries fleet score+level+delta, trajectory headline, named movers with magnitudes, the single highest-leverage gap, and percentile — the dashboard link is the LAST line, not the payload. This genuinely replaces the chiefs-of-staff status doc.",
    "evidence": ["src/lib/alerts.ts:167", "src/lib/alerts.ts:179", "src/app/api/cron/digest/route.ts:75"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm a real claude-cli digest body reads as forward-it-up senior-grade, not a metrics dump."
  },
  {
    "id": "ROB-05",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "robert-enterprise-dotnet",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH: unchanged-commit dedup means a re-scan of a literally-unchanged repo fires zero alerts",
    "expected": "Re-scanning an unchanged repo must not generate noise.",
    "got": "rescan dedups unchanged commits and skips the regression diff entirely; scan-alerts no-ops on missing/equal prev. The noise floor exists for the identical-commit case — it's the CHANGED-but-stable case (ROB-02) that leaks.",
    "evidence": ["src/app/api/cron/rescan/route.ts:136", "src/lib/scan-alerts.ts:58"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "n/a — covered by ROB-02's live re-scan test."
  }
]
```

## Character feedback (Robert, first person)
Here's my honest read, and I'm reading it the only way I ever will — from my inbox, because I am not logging into your dashboard weekly. I won't.

**Would I renew?** Conditionally yes — and that "conditionally" is the whole story. The digest is the best version of this I've seen: it's the chiefs-of-staff status doc, written for me, arriving on its own. Fleet number, where it's heading, who moved and by how much, the one gap worth chasing. That's a forward-it-up artifact. If that's what hits my inbox, my two chiefs-of-staff stop spending two days a quarter assembling it, and at renewal I can tell procurement "yes, this earned its line item" in one sentence.

**Is each cycle telling me something new?** Here's where it wobbles. You email me **every Monday whether or not anything happened**, and on a stable quarter it literally says *"no change this week."* I have lived this exact movie — the weekly summary that's empty 48 weeks a year. By month two everyone in my org has a filter rule, and then we miss the one week it mattered. A report that pings me on a timer regardless of the world is a report I will train myself to ignore. Send me the digest when the fleet **moved**, or send it on **my** cadence — quarterly, to match my review — and I'll read every one.

**Do I trust a move is real?** Mostly, but your default alert threshold worries me. Five points? Your own scoring model breathes ±25 when it re-reads a repo. So a repo that got recommitted but isn't actually any more or less mature can swing five points and page me — and the alert just states the drop, it never tells me it cleared the noise. You compute a trend-confidence number; put it in the alert. Page me on real movement, and I'll defend the interruption upward. Page me on the model breathing, and I'll mute the channel.

**Does the cost pencil out / can I see the price?** I can't see a price — Enterprise is "contact us" — and honestly that's fine, procurement owns that number and I'm on unlimited, so I'm not watching credits. My math is purely value-for-line-item, and the digest carries that *if* it stays trustworthy. It's the noise that kills the renewal, not the dollars.

**What's missing for my recurring job?** A cadence control (let me pick quarterly), a movement gate (don't email me "no change"), and a "this move is real" line on the alert. Small features, but they're the difference between an artifact I forward up and an email I filter.

**Would I tell a peer?** Yes — with the caveat: "great digest, just set it to fire on movement and crank the alert threshold above the noise before your directors filter it."

## Scorecard
- **Grounding score (recurring-context sources reaching the read): 5/6.** Reaching the digest/alert: rollup+delta (`org-rollup`), movers (`org-insights`), top recommendation (`org-recommendations`), trajectory/forecast (`forecast.ts`→headline), benchmark percentile — all flow into `buildFleetDigestMessage`. The **6th, fit-confidence / noise-band (R², flat-floor), does NOT reach the regression alert** — it's the one source missing where it matters most (ROB-02). Retention/credit (the 7th class) is N/A for Enterprise (unlimited, custom).
- **Per-cycle time-saved (number): ~4–8 person-hours per cycle** (his cadence = quarterly), i.e. the chiefs-of-staff fleet roll-up the digest replaces (~16–32 person-hours/yr), plus ~20 min of his own read-and-forward vs. commissioning a doc — **conditional on trust holding** (if he must log in to verify each digest, this goes net-negative).
- **Renew / downgrade / churn / upgrade: RENEW (conditional).** The Enterprise artifact is right-sized and the digest genuinely replaces his manual baseline — but the fix-before-renewal items are the **movement gate (ROB-01)** and the **noise-clear threshold (ROB-02)**; ship those and it's an unconditional renew, leave them and the channel goes silent (filtered) and the renewal turns into a "we stopped reading it" churn at the next quarter.

## l2_priority carry-forward
1. **(ROB-01, top)** Run the digest cron twice over a fleet that didn't move — confirm the 2nd cycle sends "no change this week" with no new actionable content (the inbox-filter trigger).
2. **(ROB-02)** Re-scan a CHANGED-but-maturity-stable repo twice under `claude-cli`; if overall swings ≥5 within the ±25 guardband, confirm a regression alert fires and check whether anything marks it as noise vs real.
3. **(ROB-04)** Confirm a real claude-cli digest body reads as a forward-it-up senior artifact, not a metrics dump.
