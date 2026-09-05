# L2 — empirical (live, `LLM_PROVIDER=claude-cli`) — pricing-20

**Engine:** real Claude via the local CLI — every scan returned `engine: {provider:"claude-cli", model:"sonnet"}`, confirming this is genuine Claude output, **not** the deterministic mock floor. **Env:** `npm run dev` (port 3000), in-process PGlite, `.env.local` (claude-cli + mock fallback + `ASCENT_AUTH_BYPASS`). The L2 brief deliberately did NOT re-walk all 20 Characters live — the recurring value-vs-price verdict is org-level (the scan output is the same whoever views it), so L2 spent its expensive browser/CLI budget on the **two questions L1 could only raise theoretically** + live confirmation of the cheap P0s.

## Test 1 (the crux) — is a re-scan "mover" real signal or LLM noise? → **REFUTED as noise; engine is stable**

The single most-raised L1 trust concern (8+ Characters: yusuf, lena, gabriel, robert, camille, klaus, mariam, victor) was: *the LLM is guardbanded ±25 and blended 60/40 — so a score change between cycles could be the model breathing on an unchanged repo, not real movement.* If true, repetition is untrustworthy and not worth paying for.

**Experiment:** two independent `fresh:true` (cache-busting) claude-cli scans of the **same unchanged commit** of `sindresorhus/ky` (identical headSha `61d6d66d27911001b9b4d57ab93139f9ad61384b`), ~285s and ~299s respectively.

| | Scan A | Scan B | Δ |
|---|---|---|---|
| Overall | 29 | 29 | **0** |
| Level | L2 | L2 | — |
| Adoption / Rigor | 4 / 42 | 3 / 42 | −1 / 0 |
| Per-dimension max swing | — | — | **±1** (D3 47→46, D7 14→13, D5 33→34; D1/D2/D4/D6/D8/D9 unchanged) |
| Confidence | 0.61 | 0.61 | 0 |

**Verdict:** run-to-run variance is **±1 dimension point, 0 overall** — an order of magnitude below the ±25 guardband. The deterministic-signal anchor + 60/40 blend make the blended score **stable across independent LLM runs**. The worst-case fear is **refuted**: a real score move reflects a real repo change, not noise. This is a **major strength** for the recurring-value proposition and resolves the top `l2_priority` of most of the cohort.
- **BUT the L1 *legibility* finding still stands** (`resolution: open`): the engine being stable is invisible to the user. The movers/PeriodSummary tiles, executive briefing, and digest still render a raw `+N` with no confidence annotation — the user *can't see* that the engine is trustworthy. Empirically the move is real; the UI doesn't say so. So the fix is cheap (surface the confidence the engine already has), and the panel's instinct to distrust an un-annotated delta is reasonable even though the underlying number is sound.

## Test 2 — is the live claude-cli output senior-grade? → **YES**

From Scan A of `ky` (a repo whose real state is knowable: superb tests, zero AI-native tooling):
- **Headline (specific, accurate, leverage-aware):** *"ky is an exceptionally well-tested solo OSS library with strong type and lint guardrails, but zero AI tooling, no agentic workflows, and thin supply-chain security — placing it at L2 Assisted, with its outstanding test suite as the most leverageable foundation for an AI-native upgrade."*
- **Roadmap (defensible, repo-specific — not "add more tests"):** D1 "AI context for this codebase lives only in contributors' heads" · D3 "any push can reach main without touching CI or review" · D9 "Supply chain security is invisible in the pipeline for a widely-consumed package."
- **Provenance / self-critique (the trust differentiator):** the `discrepancies` track has the LLM *challenging the deterministic signal* — e.g. D3 *"signalScore of 50 appears slightly generous: the CI workflow sampled (.github/workflows/main.yml) only lints,"* D5 *"signalScore of 30 likely underweights inline documentation density."* This is the signal→LLM→blended provenance the rubric prizes, visible and traceable.
- **Evidence is concrete:** D2=94 cites *"23 test files, test-to-source ratio 0.79, 60 substantive assertions across 4 sampled test files."*
- **Reconciles with reality:** the scores match what a staff engineer would say about `ky`. Senior-quality bar **cleared**.

## Live confirmations of the L1 P0s
- **Price invisible (CONFIRMED live):** `GET /pricing` renders `Free $0 · Pro "Prepaid" · Team "Prepaid — credits, 1 per private scan" · Enterprise "Custom / contact us"`. No subscription dollar figure for the paid tiers — a buyer cannot compute value-vs-price in-app. (`src/app/pricing/page.tsx:15-20`.)
- **Org dashboard renders (CONFIRMED live):** `/org/vercel` → 200, renders "fleet maturity" + posture ("Getting Started") — the cross-sectional recurring read is real.
- **Trajectory requires repetition over TIME (CONFIRMED live):** after two scans of `ky`, `GET /api/history?repo=sindresorhus/ky` returns **1** entry — same-commit re-scans **dedup to one history point**, so the trajectory (which needs ≥2 distinct calendar days, `forecast.ts:87`) does not render from same-day re-runs. Repetition that pays off is **scanning over time as the repo changes**, not re-running today. (Also confirms klaus's unchanged-commit dedup → you are not charged/cluttered for re-scanning a static repo.)
- **`retentionDays` not enforced:** not re-tested live (would need >365-day-old data); already verified absent across query/purge paths by 6 Characters + the synthesis grep. Stands as code-confirmed.

## L2 findings
```json
[
  { "id":"L2-01","journey":"repeated-org-scans-worth-the-price","character":"PANEL","cert_level":"L2","type":"trust","dimension":"trust","severity":"polish","impact":{"frequency":"high","reachability":"high","trust_erosion":"low"},"title":"Re-scan of an unchanged repo is stable (Δoverall 0, Δdim ±1) — far inside the ±25 guardband","expected":"A repeated scan could wobble within the guardband and present LLM noise as a real mover","got":"Two independent fresh claude-cli scans of the same headSha: overall 29→29, max dim ±1, confidence 0.61→0.61","evidence":["uat/runs/2026-06-20-pricing20/_l2-scan1-ky.json","uat/runs/2026-06-20-pricing20/_l2-scan2-ky.json","src/lib/scoring/engine.ts (60/40 blend, ±25 guardband)"],"code_check":"by-design","verdict":"confirmed","resolution":"resolved-verified","ceiling":"Tested on one repo/commit at confidence 0.61; a very-low-confidence repo or a different model tier could vary more. Stability ≠ visibility — see L2-02.","strength":true },
  { "id":"L2-02","journey":"repeated-org-scans-worth-the-price","character":"PANEL","cert_level":"L2","type":"trust","dimension":"clarity","severity":"major","impact":{"frequency":"high","reachability":"high","trust_erosion":"high"},"title":"The engine's stability is invisible: movers/briefing/digest show a raw +N with no confidence, so the user can't tell a real move from noise","expected":"Where a score move is shown, a confidence/noise signal travels with it","got":"R²/flat-floor confidence exists only on the Trajectory card; PeriodSummary/executive/digest render bare deltas — empirically the move is real but the UI never says so","evidence":["src/components/org/Trajectory.tsx:96","src/components/org/PeriodSummary.tsx:25-41","src/app/org/[slug]/executive/page.tsx:97-110","src/app/api/cron/digest/route.ts"],"code_check":"present-but-missed","verdict":"confirmed","resolution":"open","l2_priority":"surface the confidence the engine already carries at every place a move is shown" },
  { "id":"L2-03","journey":"repeated-org-scans-worth-the-price","character":"PANEL","cert_level":"L2","type":"quality-gap","dimension":"senior-quality","severity":"polish","impact":{"frequency":"high","reachability":"high","trust_erosion":"low"},"title":"Live claude-cli output is senior-grade: specific headline, repo-specific roadmap, self-critical signal/LLM discrepancies, concrete evidence","expected":"Output a staff engineer would forward unedited","got":"ky read reconciles with reality (great tests, no AI tooling → L2); discrepancies track challenges the deterministic signal","evidence":["uat/runs/2026-06-20-pricing20/_l2-scan1-ky.json (headline, roadmap, discrepancies, dimensions[D2].evidence)"],"code_check":"by-design","verdict":"confirmed","resolution":"resolved-verified","ceiling":"Per-SCAN quality is senior-grade; per-CYCLE *new* value on a stable fleet is a separate question (camille/klaus) not testable without multi-date history.","strength":true },
  { "id":"L2-04","journey":"repeated-org-scans-worth-the-price","character":"PANEL","cert_level":"L2","type":"trust","dimension":"trust","severity":"major","impact":{"frequency":"high","reachability":"high","trust_erosion":"high"},"title":"Pro/Team subscription price is invisible live — value-vs-price is undecidable in-app","expected":"A number to divide value by","got":"/pricing shows Free $0, Pro/Team 'Prepaid', Enterprise 'Custom'","evidence":["src/app/pricing/page.tsx:15-20","GET /pricing (live)"],"code_check":"by-design","verdict":"confirmed","resolution":"open","l2_priority":"n/a — confirmed" }
]
```

## What L2 changes vs L1
- **Upgrades the engine from suspicion to trust:** L1 could only say "the guardband *allows* ±25 of noise." L2 measured the actual variance at ~±1/0. The recurring *number* is trustworthy; **repetition is not measuring noise**. This is the single most important correction to the panel's fears and strengthens the "worth paying for" case on the quality axis.
- **Sharpens the real blocker:** what's left after L2 is not *engine quality* (proven good) but **legibility + commerce** — the user can't see that the engine is good (L2-02) and can't see the price (L2-04). Both are cheap fixes with outsized impact on the value-vs-price decision.
- **Confirms the longitudinal thesis:** trajectory value comes from scanning *over time*, and same-commit re-scans correctly dedup — so the cost of "keeping it current" is bounded.
