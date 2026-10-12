# The objective ladder

Every measure below was located in Ascent's code at master `89093efc` on 2026-10-12. Re-check a citation
before relying on it; the line numbers drift.

## 1. T1 - perfect score

| Measure | Where | Target |
|---|---|---|
| overall (0-100) and level (L1 0-24, L2 25-44, L3 45-64, L4 65-84, L5 85-100) | `Scan.overallScore`, `Scan.level` (`prisma/schema.prisma` ~597-739); bands in `src/lib/maturity/model.ts` ~380-418 | 100 |
| D1-D9 scores | `ScanDimension.score` (with `signalScore`, `llmScore`; the LLM score is clamped to ±6 of the signal, `LLM_GUARDBAND`, `model.ts` ~376) | 100 each, where measurable |
| debt | `src/lib/maturity/green.ts` ~153,169: sum over dimensions of max(0, 85 - score) | 0 |
| open gaps | `Recommendation` with `kind="gap"`. A dimension below 65 always raises one (`FOLLOW_UP_BELOW`, `model.ts` ~429) | 0 open |

Read: `GET /api/org/repo-dimension?org=&repo=&dim=` (one call per dimension, returns overall and level too),
and `GET /api/org/local/projects?org=` (the `green` block: debt, gaps, contested, unmeasurable per repo).

## 2. T2 - subscores

| Measure | Where | Target |
|---|---|---|
| contested dimensions | `green.ts` ~96-102 | none |
| unmeasurable dimensions | `green.ts` ~96-102. In local scans D2/D3/D4 are unmeasurable: a GitHub fleet scan (`POST /api/org/scan`, SSE) measures them, which needs network and the operator's word | none |
| adoption, rigor (0-100) and confidence (0-1) | `src/lib/types.ts` ~1207-1209,1246 | 100 / 1 |
| D4 claim facets | `src/lib/scoring/claims.ts` ~84-147: seven facets summing to 100 (25/20/15/15/10/10/5) | all facets full |
| D1 claim points | `claims.ts` ~167-205: 20 claim points (8+6+6+0), the rest from guidance coherence | full |
| guidance coherence, context health (0-100, display-only) | `types.ts` ~1167-1178, ~1073-1112 | 100 |
| conformance | `Repository.aiConformance`, `ConformanceReport` / `ConformanceFinding` | 100, 0 fails, 0 warns |
| discrepancies | `Scan.discrepancies` | 0 |
| **craft rungs** | `Recommendation` with `kind="craft"` on 7 axes (`src/lib/scoring/craft.ts` ~34-51). The ledger tally only rises (`src/lib/db/org-insights-craft.ts` ~141-165) and is never scored | unbounded: the "50-100 items" a high-scoring project still has. Chase verified craft closes per round, fewest-built axis first (the runner's own order, `loop-lane.ts` ~616-642) |

The craft ladder is the bridge to T3: once the closed-form subscores are exhausted, craft rungs keep the
runner supplied with real work. Their quality, not their count, is what the reflection judges.

## 3. T3 - breakthrough

T3 measures the project's technology, so its metrics are the project's own. Propose them from the project's
scripts, manifest (`.ai/manifest.yaml` capabilities), benchmarks and CI; the operator confirms them. Record each in
`project.json`:

```json
"techMetrics": [
  { "name": "test suite wall time", "command": "npm test -- --reporter=dot", "parse": "elapsed seconds", "direction": "down", "threshold": 0.10 },
  { "name": "production bundle size", "command": "npm run build", "parse": ".next total kB", "direction": "down", "threshold": 0.05 },
  { "name": "p95 latency of the hot route", "command": "node scripts/bench.mjs --route /api/x", "parse": "p95 ms", "direction": "down", "threshold": 0.15 }
]
```

Good T3 metrics are cheap to measure (under ~3 minutes), stable across two runs on the same commit (measure
twice at the baseline; a metric that wobbles more than its threshold is not usable), and hard to game without
real engineering. Examples: build and test wall time, cold start, p95 latency, bundle or binary size, memory at
rest, dependency count, lines of code per feature (simplification), duplicate-code ratio, type-coverage, a new
capability that ships with tests.

How the runner is pointed at a T3 target without touching the instrument: the reflection writes or sharpens a
**playbook** and an **org memory** that state the technology objective (`POST /api/org/playbooks`, `POST
/api/org/memory`), and may favour the craft axes that carry it. The Director measures each T3 metric on the
`ascent/runner` tip before and after the block (in a throwaway checkout of that tip, never the target's working
tree) and gives the numbers to the reflection.

## 4. When to move up

- **T1 to T2**: no reachable gap is left. That means debt is 0, or every remaining gap sits in a fenced or
  unmeasurable dimension and the operator decision about it is recorded in `project.json`. A dry block with
  `debtBefore` near 0 first gets a rescan (a rig action, not a hypothesis), and moves up only if the rescan
  raises nothing new.
- **T2 to T3**: two consecutive blocks move no subscore (closed-form or craft), or the operator calls it.
- **T3**: open-ended. After a technology breakthrough, the next T3 target is chosen, the threshold may be raised,
  and the ladder can return to T1 or T2 if a rescan shows new gaps (a big architectural change often does).
- A tier change resets "the best block" that verdicts compare against; the ledger records the tier on every block.
