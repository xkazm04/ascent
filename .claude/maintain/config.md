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

- 2026-09-10, maintain@1.0.0: Org Memory clustering repeated tokenization for
  each pair. Per-call token sets preserved results and improved a 200-item local
  benchmark; keep this as a local CPU measurement, not an end-to-end latency claim.
  The registry map is older than the context map: use exact current names and
  retain actual inspected files rather than declaring the whole context covered.
