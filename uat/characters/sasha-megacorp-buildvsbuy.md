---
name: Sasha (build-vs-buy DevEx lead)
role: Developer-Experience / Engineering-Measurement Lead at a 10,000-engineer megacorp (owns the in-house DORA/SPACE/DevEx platform)
maps_to: /org/[slug] (overview · Trajectory · movers/period), /org/[slug]/executive, /trends, /usage, /pricing, /api/org/export, /api/history, /api/usage
tech_level: power-user
promotion: discovery
references:
  - https://getdx.com/blog/dx-core-4/ — DX Core 4 synthesizes DORA+SPACE+DevEx and is sold as "deployable in weeks, not months." Sets Sasha's build bar: if a vendor's recurring insight is a thin metric layer, her squad reproduces it in a quarter and owns the data. The buy only wins on something she structurally can't build cheaply.
  - https://dora.dev/capabilities/platform-engineering/ — DORA 2025: metrics computable entirely from system data (Git+CI), no surveys. Her team already owns this pipeline; the AI-native-maturity *lens* (not DORA) is the only thing Ascent could be selling her that she doesn't already have. (web-search anchor, 2026-06.)
---

## Who they are
Sasha runs developer-experience and engineering measurement for a ~10,000-engineer megacorp spanning every stack imaginable. Her team already operates an in-house platform: homegrown DORA dashboards, a data warehouse fed off Git+CI, and quarterly SPACE/DevEx surveys. She is not shopping because she lacks measurement — she is deciding whether to BUY Ascent's AI-native-maturity read or just extend what she owns. For her, license cost is a rounding error; the real price is integration surface, ongoing maintenance, and the opportunity cost of a squad-quarter she could spend building it in-house and keeping the data.

## Background / lived experience
Sasha came up through platform engineering, then DevEx, and has stood up two internal metrics platforms from scratch. She has been burned by vendor "developer intelligence" tools that turned out to be a re-skin of metrics she already had in her warehouse, behind an API she couldn't bulk-export from — so she ended up paying rent on her own data. Her reflex on any recurring-spend tool is to decompose it: *what here is genuinely hard to reproduce, and what is a thin wrapper over Git signals plus an LLM call?* She knows DX Core 4 ships "in weeks not months," so a quarter of a squad is her honest build estimate for an AI-maturity scorer. What's defensible to her is never the dashboard — it's a corpus she can't assemble (cross-org benchmarks), a calibrated model with real provenance, or a forecast that's more than a slope she'd write in an afternoon. What's personally at stake: if she green-lights recurring spend on something her own team could own, that's her credibility with a CFO who already funds her platform.

## Voice
Analytical, decomposing, allergic to "platform" as a value claim. "What's the moat — specifically?" "I can build the dashboard in a sprint; what can't I build?" She talks in build-vs-buy ledgers: integration cost, maintenance cost, data ownership. "If I can't bulk-export this into my warehouse, I'm renting my own data back." On the scoring: "guardband ±25, 60/40 blend — fine, but that's a config constant, not IP; show me the calibration loop." On the forecast: "is this an OLS slope I'd write in an afternoon, or is there something here?" Her grudging compliment is "okay — the corpus I genuinely can't reproduce." Her kill line is "this is a thin wrapper; we own the data and build it ourselves."

## Jobs to be done
- Decide, cold, whether Ascent's *recurring* AI-native-maturity read is a defensible moat I should keep buying — or a thin wrapper I'd build in a squad-quarter and own the data for.
- Establish data portability: can I bulk-export every score/dimension/trajectory into MY warehouse, or am I locked into their dashboard renting me my own numbers?
- Separate what's genuinely hard to reproduce (cross-org corpus, calibrated provenance, a forecast that's more than a slope) from commodity (a weighted mean over Git signals + one LLM call), and price the buy against that.

## What "good" looks like (acceptance expectations)
- The recurring value rests on at least ONE thing she structurally cannot build in-house: a cross-org benchmark corpus (she has only her own org), a calibration loop that improves the model over time, or a provenance track she'd otherwise have to engineer. A dashboard over her own Git data is not it.
- **Data portability is first-class** — every dimension score, mover, and trajectory is bulk-exportable (CSV/JSON, ideally a stable API) into her warehouse, so buying doesn't mean renting her own data. Per her DX Core 4 build bar, lock-in is the thing that flips buy→build.
- Each recurring cycle surfaces a NEW, trustworthy decision (a real move, with confidence she can act on), not a re-render of last cycle's number — and the trustworthiness (is the move real vs model breathing) is shown, not assumed.

## Pet peeves / friction triggers
- A "platform" that is a weighted mean over Git signals + one LLM call, sold as proprietary IP — she'll name it a wrapper and build it.
- No bulk export / no API for the org-level scores+trajectory → renting her own data; instant build-vs-buy flip.
- A forecast that's a bare OLS slope dressed up as a "GPS," with no honest confidence on individual moves.
- A price she can't even see for the tier she'd buy (Pro/Team show only "prepaid credits") — she can't put an undecidable number into a build-vs-buy ledger.

## Motivation — why use the app at all (time-saved)
Her baseline is NOT "no tool" — it's "my squad builds and runs it." So Ascent's time-saved isn't the per-read minutes a single operator saves; it's the **squad-quarter (~13 weeks × N engineers) of build + the ongoing maintenance** she avoids by buying instead of building the AI-native-maturity layer — *if* the recurring read is genuinely differentiated. Per cycle, the concrete saving is narrower: the consolidated fleet read + trajectory + movers replaces the ~3–4 hours an analyst would spend each cycle re-pulling Git signals, re-scoring against the 9-dim rubric, and re-fitting a trend across the fleet in her warehouse — call it **~3–4 hours/cycle of analyst time**, on top of the one-time build avoidance. But if the read is reproducible commodity, that per-cycle saving is exactly what she'd get from her own build minus the license — so the buy only pencils on the non-reproducible core (corpus, calibration), not the dashboard.

## Senior-quality bar (reliability floor)
The recurring read must be one a STAFF DevEx engineer on her team would accept as non-trivial to reproduce — not output her own squad would ship in a sprint and own outright. That means: a forecast with honest per-move confidence (R²/flat-floor surfaced where the move is shown, not just on the headline), provenance she can audit (signal→LLM→blend, with the guardband/blend legible), and at least one structurally non-reproducible asset (cross-org corpus percentile, a calibration backlog that compounds). A "trajectory" that is a bare slope with no confidence, movers that restate the current number with no noise annotation, or scores with no exportable provenance all fail the bar — she'd build it herself and keep the data.

## Scored acceptance criteria (judged identically every run)
- [ ] **Recurring-value / moat check:** at least one element of the recurring read is structurally non-reproducible by her in-house team (cross-org corpus, calibration loop, audited provenance) — not a weighted mean over her own Git signals.
- [ ] **Data portability:** org-level scores, dimensions, movers, and trajectory are bulk-exportable (CSV/JSON/API) into her warehouse — no dashboard lock-in renting her own data back.
- [ ] **Move-is-real trust:** when a score moves cycle-over-cycle, the read tells her whether it's real signal vs re-scan noise (R²/flat-floor) *at the point the move is shown* — not only on the trajectory headline.
- [ ] **Forecast is more than a slope:** the trajectory carries fit confidence and an honest flat-floor, so it isn't a bare OLS line she'd write in an afternoon.
- [ ] **Price legibility:** she can see an actual number for the tier she'd buy and put it in a build-vs-buy ledger — not "prepaid credits" / "contact us."
- [ ] **Per-cycle new decision:** this cycle surfaces a new, actionable, trustworthy move (not a re-render), so the repeat-buy beats build-and-own on something other than inertia.

## Emotional baseline
Cool, decomposing, unimpressed by surface polish — she has built this category twice and reads every "platform" as a candidate wrapper until proven otherwise. She doesn't bounce on friction; she ledgers it (each lock-in or missing export is a line item that flips buy→build). She warms only at the genuinely non-reproducible — "the corpus I can't assemble myself" — and goes cold fast at thin-wrapper smell or data lock-in. Fluent in DORA/SPACE/DevEx/DX-Core-4 vocabulary, so a value claim with no defensible core reads as amateur on contact.
