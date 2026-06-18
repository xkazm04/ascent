# Test Mastery Fix Wave 8 — The long tail (all criticals closed)

> 5 atomic fix commits, **5 critical findings closed → 60 / 60 criticals complete.**
> Suite: **1111 → 1155 tests (+44), 0 failures.** tsc 0 source errors. **0 production source changed.**

## Commits

| Commit | Test file(s) | Finding closed |
|---|---|---|
| `d07d0a5` | `src/lib/github/source.test.ts` (+8) | github-repo-data-access #2 `estimateCoverage` |
| `0529b04` | `src/lib/db/plan.test.ts` (+7, new) | goals #2 `listGoals` achievedAt |
| `697cd97` | `src/lib/db/playbooks.test.ts` (+13, new) | playbooks #2 `getPlaybookAdoption` lift |
| `26a6c03` | `src/lib/db/segments.test.ts` (+6) | repositories-segments #2 segment rollup |
| `73aeb16` | `src/lib/standard/standard.test.ts` (+13) | ai-native-standard #1 manifest round-trip |

## What was fixed (the invariant each test now pins)

1. **`estimateCoverage` cache-poison.** A transient fetch blip drives coverage **below** the cache-pin threshold (degraded, not falsely high, not poisoned-0); a thrown error behaves like a non-2xx; a genuinely-empty repo (`attempted=0`) is distinguished and takes the `*1` branch → 0.95. Poisoning is confirmed **not currently possible**.
2. **`listGoals` achievedAt idempotency.** An already-achieved goal is **not** re-stamped (the original timestamp is preserved, `update` never called); a goal first reaching target stamps once; below-target → no stamp.
3. **`getPlaybookAdoption` lift honesty.** Lift is credited **only** from a scan dated after adoption (a pre-adoption-only scan → `lift:null`, no fabricated improvement); a genuine pre/post pair → the correct delta; the aggregate divides by *measured* repos, not total.
4. **Segment-scoped rollup.** `summarizeSegment` narrows the rollup query to `{ segments: { some: { segmentId } } }`; two different segments produce different comparison columns (no whole-fleet fallback = no "comparison theater"); an empty segment → zero rollup.
5. **Manifest↔doctor round-trip.** The doctor's **actual shipped parsers** (extracted from `buildDoctor().body`) are run on real `serializeManifestYaml` output and asserted field-by-field — so a serializer/parser drift that would hard-fail every adopting repo's CI gate is caught. (Flags one KNOWN drift: a command containing a `"` doesn't round-trip.)

## Verification

| | After Wave 7 | After Wave 8 |
|---|---|---|
| Test files | 91 | 93 (+2 new) |
| Tests passing | 1111 / 1111 | **1155 / 1155** |
| tsc source errors | 0 | **0** |
| Production source files changed | 0 | **0** |

## Patterns established (catalogue items 38–42)

38. **Only-after-event accounting.** For any "improvement attributed to X" math, assert credit comes only from data dated after X — a pre-X data point yields zero/null, not a fabricated gain. *(getPlaybookAdoption)*
39. **Idempotent state-stamp.** For a one-time state-transition write, assert a second pass does NOT re-write (timestamp preserved, `update` not called). *(listGoals)*
40. **Scope-narrowing query assertion.** For a scoped aggregate, capture the `where` and assert it contains the scope key; prove two scopes yield different columns (anti-comparison-theater). *(segments)*
41. **Round-trip via the SHIPPED parser.** To test a serializer↔parser pair, extract the actual shipped parser (not a hand-copy) and feed it the real serializer output, asserting field-by-field equality — catches quote/indent/flow drift. *(standard)*
42. **Blip-vs-genuine-zero distinction.** For a metric computed from fetched data, assert a fetch failure yields a degraded/abstain value distinct from a genuine zero, so a transient blip can't be cached as a confident wrong number. *(estimateCoverage)*

## All 60 criticals closed

See `CUMULATIVE-STATUS.md` for the full 8-wave ledger, the 8 documented-and-pinned latent bugs, and the open Highs.
