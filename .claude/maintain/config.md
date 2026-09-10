# Maintain in Ascent

- scope: first-party source, co-located tests and coupled maintained documentation.
- contextMap: `context-map.json`.
- stateDir: `.ai/maintain/` (local evidence; git-excluded).
- minutes: 60; maxBatches: 5. Explicit run flags override these defaults.
- delivery: commit verified task paths on the current branch; never push.
- gates: focused Vitest tests and ESLint, `npm run typecheck`, and the repository's
  required commit/verification gates. Inspect the actual configuration before use.
- sensitiveScopes: auth, billing, org authorization, personal data, database schema;
  internal extraction must preserve security and serialization contracts.
- constraints: every `src/features/**` file <=200 lines; other `.tsx` <=300 lines.
  Preserve feature-group dependency direction and server/client boundaries.
- memoryOutbox: `.personas/memory-outbox.jsonl` when Personas-managed; otherwise
  local journal/coverage only. Exact context names come from the current context map
  unless a configured authoritative app source is available.
- docs: internal behavior-preserving refactors need no feature-doc update; record
  that reason. Do not edit `docs/archive/**` to modernize historical evidence.

## Skill improvement log

- 2026-09-10, maintain@1.0.0, run 04: exercise generated output in its consumer.
  Copy-snippet DOM tests passed while the exported Bearer header failed in Bash;
  executing the snippet with synthetic credentials exposed and verified the fix.
  Shared dialog checks need the real portal lifecycle: initially open, opened later,
  nested confirmation, Cancel autofocus, and out-of-order close. Content-only tests
  did not expose the focus and scroll-lock failures repaired in this run.

- 2026-09-10, maintain@1.0.0, resumed 20-batch run: keep source stable while a
  full verification process runs. An overlapping extraction made a checkpoint
  fail; later checks passed after correction. Inspect the final asynchronous
  exit code before committing or recording success: one premature checkpoint
  required an amended commit and explicit journal, coverage and memory correction.
  Preserve the original journal row and append the correction; resolve the retained
  commit in coverage and pending memory so future resumes do not trust a stale hash.

- 2026-09-10, maintain@1.0.0, 20-batch run: `npm run verify` does not run the
  standalone context-map checker tests. After adding or moving source modules, run
  `node scripts/context-map/__tests__/check-map-drift.test.mjs` and
  `node scripts/context-map/check-map-drift.mjs`; update justified file assignments
  and rebuild the registry map. Mapping files earns no source-inspection credit.
  Keep benchmark and extraction helpers under the local state directory with a
  non-source suffix (for example `.cjs.txt`): Git exclusion alone does not exclude
  `.cjs` helpers from the repository's ESLint scan.
  The current map has 54 contexts, while `.personas/contexts.txt` registers 49;
  validate memory names against the latter. Hold unmatched outcomes separately
  until app taxonomy is refreshed; do not silently assign an older context name.

- 2026-09-10, maintain@1.0.0: Org Memory clustering repeated tokenization for
  each pair. Per-call token sets preserved results and improved a 200-item local
  benchmark; keep this as a local CPU measurement, not an end-to-end latency claim.
  The registry map is older than the context map: use exact current names and
  retain actual inspected files rather than declaring the whole context covered.
