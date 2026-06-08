# Feature Scout Fix Wave 5 — Scoring depth

> 2 of 6 findings closed in 2 atomic commits — the two highest-leverage, fully-verifiable
> scoring-honesty fixes. 4 deferred with cause. Baseline preserved: tsc 0 → 0 · eslint clean · `next build` green.

## Why these two

MAT-1 and MAT-2 are the two scoring fixes that (a) make the LLM smarter with evidence already in
hand and (b) make the blended score honest about how much it actually saw — both pure backend,
both verifiable, neither touching the UI the concurrent run is editing. The other four are deferred
for concrete reasons (below): UI-collision, a new endpoint with no consumer yet, or detector logic
whose effect can't be runtime-verified here without a live scan.

## Commits (shipped)

| # | Commit | Finding | Sev | What |
|---|--------|---------|-----|------|
| 1 | `b8b7233` | MAT-1 | High | feed PR + governance evidence into the LLM prompt |
| 2 | `2aa723c` | MAT-2 | High | confidence-weight the blend by repo coverage |

## What was fixed

1. **MAT-1** — The scan already fetches PR review/velocity/AI-governance stats + branch-protection
   rules and folds them into the deterministic D3/D6/D7/D8 scores, but `scoreInput` never passed them
   on, so the LLM auditor reasoned about review discipline / merge gating / AI governance **blind** —
   the exact axes the product sells. Added optional `prStats`/`governance` to `LlmScoreInput`, threaded
   the in-hand data from `scan.ts`, and render a compact "PROCESS SIGNALS" block in the prompt
   (reviewed/merge/AI-governed rates, time-to-merge, small-PR rate, branch-protection rules). No new
   fetches; degrades to a one-line note on a tokenless scan.
2. **MAT-2** — `snap.coverage` (0..1) was computed, surfaced as `report.confidence`, even warned on
   below 0.5, but never touched the math: the blend was a fixed `SCORE_BLEND` whether the LLM saw 8k or
   70k bytes of a truncated repo — false precision. Now `effectiveBlend = SCORE_BLEND * coverage`, so a
   low-coverage scan leans harder on the coverage-robust deterministic signals. **At full coverage it's
   exactly `SCORE_BLEND`, so the calibrated full-scan path is byte-for-byte unchanged** (no calibration
   regression for the bench, which scans full repos).

## Deferred (with cause)

- **MAT-3 — close the auditor loop (`discrepancies` → detector-improvement feed).** Read-side
  aggregation, but it's a new `GET /api/discrepancies` endpoint whose only consumer would be an internal
  "detector misses" view that doesn't exist yet — an endpoint with no caller (same anti-pattern I avoided
  with APP-2/ORGS-6 UI). Better paired with the view in a focused session.
- **SCAN-2 — surface "files inspected" + coverage gap as evidence.** Needs persisting the inspected file
  list onto the report AND a `ReportView` expander — the report UI the concurrent UI-Perfectionist run
  is editing. Deferred to avoid collision.
- **SCAN-4 — lockfile / dependency-manifest ingestion.** Backend, but the valuable half is new D9/D6
  detector logic whose effect can't be verified here without running a real scan against a repo with
  lockfiles (no live scan in this env). Adding lockfiles to the fetch list without the detector logic
  would just fetch bytes nobody reads. Deferred as a unit for a session that can run a real scan.
- **LLM-6 — per-dimension model confidence.** Low value, and touches the schema + `ReportView` UI
  (collision). Deferred.

## Verification (before → after)

| Gate | Result |
|------|--------|
| `tsc --noEmit` | 0 → 0 errors |
| `eslint` (4 changed files) | 0 errors, 0 warnings |
| `next build` | ✅ all routes compiled |
| unit tests | none (Playwright e2e only); not run |

## Patterns established (catalogue addition, item 11)

11. **Use evidence you already paid for** — when an upstream stage fetches rich data and folds it into
    one consumer (the deterministic scores), check whether the OTHER consumer (the LLM prompt) is being
    starved of it. Threading already-in-hand data costs nothing and is often higher-signal than anything
    new. And: a derived confidence value (coverage) should modulate the math it describes, not just be
    displayed beside it.

## What remains

Wave-5 leftovers: MAT-3, SCAN-2, SCAN-4, LLM-6 (above). Other scan waves: 1 (usage→billing),
6 (scan reach), 7 (export/alerts/compliance) + mediums/lows, per the INDEX.
