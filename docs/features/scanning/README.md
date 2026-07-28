# Repository Scanning & Scoring

The core engine: pull a repo's signals, score it against the 9-dimension maturity
model, blend deterministic signals with an LLM judgement, and turn the result into
a CI pass/fail.

Context-map group: **Repository Scanning & Scoring** (`feature`).

| Doc | Covers | Freshness (audited 2026-07-28) |
| --- | --- | --- |
| [scan.md](scan.md) | Scan pipeline: ingest → analyze → score → blend, cache tiers | CURRENT |
| [maturity-model.md](maturity-model.md) | The rubric: D1–D9, weights, levels, archetype lens, guardband | CURRENT |
| [calibration.md](calibration.md) | Benchmark workflow against the 20-repo labeled set | CURRENT |
| [gate.md](gate.md) | CI gate verdict, status checks, PR comment, org gate policy | CURRENT |
| [llm-providers.md](llm-providers.md) | All six providers, BYOM, JSON hardening, benchmark + observability | CURRENT |
| [llm-model-matrix.md](llm-model-matrix.md) | Cross-model benchmark leaderboard (self-flags its own staleness) | CURRENT |
| [async-scan-aws.md](async-scan-aws.md) | Contingency design for async scanning. Not implemented — has an explicit adoption trigger | CURRENT (concept) |

## Implementation roots

- `src/lib/scan.ts`, `src/lib/scan-cache.ts`, `src/lib/scan-finalize.ts` — pipeline
- `src/lib/analyze/**` — deterministic signal extraction
- `src/lib/maturity/**` — rubric, levels, forecast, noise
- `src/lib/scoring/**` — engine, gate, gate-comment, impact, orgsim
- `src/lib/llm/**` — provider abstraction, BYOM, eval/benchmark capture
- `src/app/api/scan`, `src/app/api/gate/[owner]/[repo]`, `src/app/api/org/gate-policy`

## Known gaps

- `scan.md` doesn't cover `stack-fit.ts`, `tech-extract.ts`, `ai-tools.ts`,
  `pr-thresholds.ts`, `maturity/noise.ts`, or `scoring/impact.ts`.
- `.env.example` has no OpenRouter block, though `openrouter.ts` reads
  `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` directly. The doc covers them; the
  env template should too.
- The context-map description for "Maturity Model & Scoring Engine" says
  "8 dimensions"; the code and `maturity-model.md` both say 9. The context map is
  the one that's wrong.
