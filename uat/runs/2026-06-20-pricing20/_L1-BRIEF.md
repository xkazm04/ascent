# L1 sweep brief — 2026-06-20 "pricing-20" (theoretical / code-grounded, NO browser)

You are running **Level-1 certification** for ONE `character × journey`, where the journey is **`repeated-org-scans-worth-the-price`** and your Character is one of 20 buyers/operators across different **company sizes, stacks, and situations**. This is a thought experiment over a *surface model built from the code*. **Do not start or drive a browser. Do not run the app.** You read code, inherit the shared surface model below (spot-checking the 2–3 files most relevant to YOUR Character's angle for fresh `file:line`), walk the journey in-character, and judge the *designed* experience for **recurring value vs. recurring price**.

The question you must answer in-character: **"After scanning my fleet on a cadence for a while, is the *repetition* still worth what I'd pay — at my company's size and budget?"** Renew / downgrade / churn / upgrade, with a number.

## Method (do these in order)

1. **Inherit the shared surface model (below); spot-check your angle.** Don't re-read the whole app — the shared model already maps the recurring-value machinery with `file:line`. Open only the 1–3 files most load-bearing for YOUR Character (e.g. a compliance lead → retention gating; an embedded lead → the flat-trend floor; a FinOps director → credit burn) and cite fresh `file:line`. Keep three verdicts distinct: **exists in code ≠ reachable by this Character ≠ unblocks their recurring-value job.**
2. **Grounding audit — retargeted to REPETITION (the L1 sweet spot here), scored as coverage.** The recurring value is a *credible read of what changed since last time*. Enumerate the sources the recurring read should use and score how many actually reach it (`grounding N/M`):
   - Does the **trajectory** need real history to exist? (`src/lib/maturity/forecast.ts` — OLS needs ≥2 distinct calendar days, else returns null; `FLAT_PER_WEEK=0.5` noise floor; surfaces R² as "trend confidence".) → repetition is *required* for this feature to render at all.
   - Is a score move **real signal or re-scan noise**? (`src/lib/scoring/engine.ts` — LLM guardbanded ±25 to the deterministic signal, blended 60/40. Re-scanning an *unchanged* repo under `claude-cli` can wobble within the guardband. Does anything tell the user "this move is real" vs "this is the model breathing"? The forecast's R²/flat-floor is the only defense — is it surfaced where the move is shown?)
   - Do **movers / period deltas** compute against the *previous* scan, with provenance? (`src/lib/db/org-insights.ts`, `src/lib/db/org-rollup.ts`, `src/components/org/PeriodSummary.tsx`, `src/lib/window.ts`.)
   - Is recurring depth **gated by tier**? (`src/lib/plans.ts` — `retentionDays` 30/180/365/null = how far back the trajectory can look; `includedCredits` 0/100/500/null; scheduled autoscans+alerts are Pro+.)
   "Good machinery fed thin context" applies doubly to repetition: a beautiful trajectory over a 30-day retention window, or movers that just re-state the current number, is the defect — and it's fully visible in code.
3. **Reachability check (resolve BEFORE judging).** Under `ASCENT_AUTH_BYPASS=1` + a populated `/org/<slug>`, this Character reaches the full `/org/*` set as a synthetic **owner**. But judge *their tier's* entitlements honestly: a Free-tier Character does NOT get scheduled autoscans, alerts, segments, or >30-day history even though the bypass renders the route. Tag anything their *plan* wouldn't include as `unreachable`/by-tier and fold it into the price verdict (it's the upsell, not a free feature).
4. **Walk the journey in-character over the model.** Cognitive-walkthrough questions (know what to do? · see the control? · connect control→intent? · understand the result?) PLUS your Character's **scored acceptance criteria**, **Motivation (time-saved, as a NUMBER)**, and **Senior-quality bar** — all applied to the *recurring* read. Stay in their head and vocabulary. The crux: does *this cycle* surface something **new + actionable + trustworthy**, and does the **cost↔value** pencil out at their tier?

## Pricing facts (the thing they're judging value against)
- `/pricing` (`src/app/pricing/page.tsx`) renders 4 tiers from `PLAN_FEATURES` (`src/lib/plans.ts`): **Free $0** (public scans only, 1 member, **30-day** history) · **Pro** (100 private scans/mo, org dashboard, scheduled autoscans+alerts, 3 members, **180-day** history) · **Team** (500 scans/mo, segments+comparisons, playbooks+planning, 10 members, **365-day** history) · **Enterprise** (unlimited, unlimited members, custom retention).
- **The $ is NOT shown for Pro/Team** — only `"Prepaid — credits, 1 per private scan"`; Enterprise is `"Custom — contact us"`. Actual subscription price lives in the billing provider (Polar), not in the app. A Character judging "worth the price" literally cannot see the price for the paid tiers — weigh that.
- Cost model for *repetition*: **public scans are always free + unlimited**; **private (installation) scans cost 1 credit each**. So a fleet of P private repos re-scanned C times/month burns **P×C credits/month** against the tier allotment. Retention caps how long the trajectory can look back.

## Shared surface model (inherit; cite these `file:line`, spot-check your angle)
Reachable recurring-value set under the bypass (synthetic owner on a populated org):
- **Overview** `/org/[slug]` — `src/app/org/[slug]/page.tsx` (+ `layout.tsx` seeds the dev owner on 2nd visit) → fleet level, adoption×rigor posture, **Trajectory** (`src/components/org/Trajectory.tsx` ← `forecast.ts`), **movers/period** (`PeriodSummary.tsx`, `org-insights.ts`, `org-rollup.ts`), gap.
- **Executive** `/org/[slug]/executive/page.tsx` — board-shaped recurring read; **Briefing** share (`src/lib/org/briefing.ts`, `briefing-share.ts`, `/share/briefing/[token]`).
- **Trends** `/trends` — `src/app/trends/page.tsx`, `DimensionTrends*`, `src/app/api/history/route.ts` (the rear-view history).
- **Cadence machinery (mostly Pro+):** scheduled rescans `src/app/api/cron/rescan/route.ts` + `src/components/org/RepoRescanButton.tsx` + `ScheduleSelect.tsx` (`/api/org/schedule`); **alerts** `src/lib/db/org-alerts.ts` + `AlertsControl.tsx` (`/api/org/alerts`) + `src/lib/alerts.ts`; **digest** `src/app/api/cron/digest/route.ts`; **watch** `src/lib/db/org-watch.ts`.
- **Usage / spend** `/usage` — `src/app/usage/page.tsx` + `src/lib/db/usage.ts` + `src/components/usage/UsageTrend.tsx` (credit burn over time; IDOR-guarded). **Pricing** `/pricing`. **Plan/credits** controls on the dashboard.
- **Scoring core (for the noise/grounding audit):** `src/lib/scoring/{engine,prompt,recommendations}.ts`, `src/lib/maturity/{model,forecast}.ts`, `src/lib/github/source.ts` (≤32 files sampled/scan), `src/lib/analyze/*`.

## App facts (Ascent — the maturity index for AI-native engineering)
5-level ladder L1 Manual→L5 Autonomous × 9 weighted dimensions; adoption×rigor posture quadrant; every score cites evidence via a signal→LLM→blended provenance track (LLM guardbanded ±25, blended 60/40); rolls up a prioritized roadmap. Free public single-repo scan; B2B = org dashboards. L2 engine for this run = **`LLM_PROVIDER=claude-cli`** (real Claude output — so senior-quality + "is the move real" are meaningfully testable, not the mock floor).

## Finding schema (one object per finding; strengths allowed) — NEW skill: impact-scored
`{ id, journey:"repeated-org-scans-worth-the-price", character, cert_level:"L1", type, severity, impact, dimension, title, expected, got, evidence[], code_check, verdict, l2_priority?, suggested_acceptance? }`
- `type`: missing-feature | quality-gap | broken-flow | confusion | trust
- `dimension`: completion | effort | clarity | trust | missing | time-saved | senior-quality
- `severity`: blocker | major | minor | polish — **derive from `impact`, don't free-hand it.**
- `impact`: `{ frequency, reachability, trust_erosion }` each `low|med|high`. For THIS journey `frequency` ≈ how often the recurring cadence hits it (an every-cycle papercut outranks an unreachable "major"); `reachability` reuses the tier/surface-binding.
- `evidence[]`: `file:line` (REQUIRED at L1).
- `code_check`: confirmed-absent | present-but-missed | present-broken | by-design | unreachable | n-a
- `verdict`: confirmed | refuted | uncertain (adversarial — default refuted/uncertain unless the `file:line` holds).
- `l2_priority`: what L2 must confirm live with the **claude-cli engine** (e.g. "re-scan an unchanged repo twice — does the score move within the guardband and is that surfaced as noise?"; "does a 2nd-cycle digest say anything new?").

## Per-journey verdict (pick one) + REQUIRED extras
- **L1-pass** — recurring value is structurally sound at this tier, no majors → clean to L2.
- **L1-conditional** — completes but has major recurring-value or pricing-legibility findings; still L2-eligible.
- **L1-fail** — a structural gap means repetition can't pay off for this Character (e.g. their tier's retention can't support a trajectory; movers just restate the number; price undecidable).
- **Also record:** the journey's **grounding score** (`N/M` recurring-context sources that reach the read), an **estimated time-saved-if-it-all-worked** per cycle (the upside the design promises vs their manual cadence — a NUMBER), and the **renew/downgrade/churn/upgrade verdict** with a one-line reason.

## What to WRITE (two files)
1. **The durable Character file** → `uat/characters/<slug>.md` (slug given in your task), following the template in `uat/README.md` and matching the depth/voice of the worked example `uat/characters/tomas-prospective-buyer.md`. Fill EVERY section: Who they are · Background/lived-experience · Voice · JTBD · What good looks like · Pet peeves · **Motivation (time-saved, as concrete minutes/hours for the recurring read)** · **Senior-quality bar** · **Scored acceptance criteria** (incl. a recurring-value and a price-legibility check) · `maps_to` the recurring surfaces · 1–2 grounded `references:` (do ONE WebSearch if it sharpens the bar; else cite training-data and mark it). Keep it under ~140 lines.
2. **The L1 report** → `uat/runs/2026-06-20-pricing20/<slug>--repeated-org-scans-worth-the-price.md` with: `# L1 — <Character> × repeated-org-scans-worth-the-price` + one-line verdict; **Reachable surface set** (tier-honest); **Surface-model notes** (the recurring-value affordances → `file:line`, emphasizing your grounding-audit findings); **Findings** as a fenced ```json array (schema above, include strengths); **Character feedback** (first-person, in their VOICE — would I renew? · is each cycle telling me something new · do I trust a move is real · does the cost pencil out at my size · can I even see the price · what's missing for MY recurring job · would I tell a peer); the **grounding score + per-cycle time-saved number + renew/downgrade/churn/upgrade verdict**; and **l2_priority** carry-forward.

## What to RETURN to the orchestrator (short)
`VERDICT: L1-pass|L1-conditional|L1-fail` · `PRICING: renew|downgrade|churn|upgrade` · counts by severity · grounding score (N/M) · per-cycle time-saved (number) · the single sharpest finding (title) · a one-sentence Character verdict in their voice · top `l2_priority`.
