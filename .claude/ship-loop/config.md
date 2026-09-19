# ship-loop overlay - ascent

Read by `/ship-loop` at the start of every run. Hand-maintained; the loop proposes edits at CPn.
Lifted from the ascent copy of ship-loop 2.0 (2026-08-17) when the skill moved to the registry lane (2.1.0).

## Stack
Next.js 16.3 preview (app router) + Supabase (auth wall, route gating) + Polar (billing) + Vitest + Playwright (mock-LLM e2e) + `uat/` journeys. Hosted product with a public distributable (`npx ascent mentor`). Tree often carries large uncommitted foreign WIP that is not the loop's.

## Cadence
milestone (continuous was offered at CP0; if the user picked it, proceed by severity and stop only for blockers/product decisions)

## Ship bar (default answer at CP0)
Each golden use case runs end-to-end and is honest - all three ledger lights green.

## Gates (ordered - run top to bottom, sequentially)
| step      | command                                   | ratchet    | when / notes |
|-----------|-------------------------------------------|------------|--------------|
| lint      | `npm run lint`                            | 0 errors   |              |
| unit      | `npx vitest run`                          | 0 failed   |              |
| build     | `npm run build`                           | exits 0    | test-only diffs may skip the build |
| typecheck | `npx tsc --noEmit`                        | 0 errors   | **AFTER the build completes, never concurrently**: `next build` rewrites `.next/types/validator.ts` mid-flight, so a concurrent tsc reads an inconsistent tree and reports spurious "does not satisfy AppRouteHandlerRoutes" errors (bitten at boot + M2; a clean `rm -rf .next && npm run build` then tsc disproved them). When the build was skipped, tsc runs against the last build's types. |
| loc       | AGENTS.md 300-LOC check (PowerShell one-liner, `-LiteralPath` for bracket dirs) | zero rows | `.tsx` touched |
| e2e       | `npx playwright test` (mock-LLM)          | green      | UI touched, when feasible; `uat/` journeys are the deeper UAT lens; test-only diffs may justified-skip - record the justification |
Notes: **`npm run gate` is a product feature (`/api/gate`), not the verification gate - excluded from verification.**

## Value journeys (the golden ledger - read `docs/GOLDEN-USE-CASES.md` first)
| tag | journey | what the loop certifies | owner persona | docs |
|-----|---------|-------------------------|---------------|------|
| UC1 | Standardize a codebase for the AI development process - a few quick iterations lift a repo from L1 to L5 | scan -> gaps-to-explore -> apply practice / `.ai/` foundation -> rescan shows the lift | platform lead | docs/GOLDEN-USE-CASES.md |
| UC2 | Share & improve AI-development techniques across an org's codebases - skills and knowledge actively tracked and shared | observe skills in the fleet -> propose (PR) into a **customer-owned registry repo** -> adopt per repo -> invokes/drift/outcomes tracked -> lessons -> new version -> redistributed. Ascent onboards/indexes/tracks the registry; it is never the registry itself, and nothing assumes the ascent repo | DevEx lead | docs/GOLDEN-USE-CASES.md |
| UC3 | Individual care - help each developer use LLM dev tools to raise their own productivity | private reflection on real usage -> interview -> profile -> moves -> re-measure - via a skill shipped in the public distributable (`npx ascent mentor`) and seeded into each registry; only opt-in aggregates flow up to UC2 | a developer | docs/GOLDEN-USE-CASES.md |
- Tags on backlog items: `UC1|UC2|UC3|hyg`. Milestones are picked per use case (the next coherent slice of one journey); hygiene items only as blockers.
- Journey walk: reuse `uat/characters/*`.
- `value-case.md` is a legacy pointer to `docs/VALUE-CASE.md` - superseded by the ledger.

## Dimensions (hygiene scorecard - the gate axis)
| # | name | what it means here |
|---|------|--------------------|
| 1 | Build & types | lint/tsc/build green |
| 2 | Functional completeness | journeys' steps real, not stubs |
| 3 | Tests | vitest green + load-bearing coverage |
| 4 | Simulated UAT | Playwright e2e + `uat/` journeys (run as a lens) |
| 5 | Billing & value capture (Polar) | |
| 6 | Auth & security (Supabase wall, route gating) | |
| 7 | UX/UI polish | |
| 8 | Ops (CI / migrations / context-map hygiene) | |
| 9 | retired into the ledger | the value case is the three use cases |

## Conventions
- Max **300 LOC per `.tsx`** - extract before committing an over-limit file; the gate's loc step must return zero rows.
- Read `context-map.json` before editing and keep it accurate.
- Read `node_modules/next/dist/docs/` before writing Next-specific code (16.3 preview - breaking vs training data).
- Never bundle the loop's changes with the tree's pre-existing uncommitted WIP; stage only your paths (one `git reset -q && git add <paths>`), pathspec commits; or defer the commit decision to the user and journal it.
- Product calls that are CP questions here in addition to the generic list: pricing/positioning; **UC3 privacy boundaries** (what may leave a developer's machine).
- Premise-check incidents to remember: item 37 was already shipped; item 15 was context-map drift, not a deleted route.
- State dir: `.claude/ship-loop/` at the repo root (tracked).

## Lenses
- journey lens per UC (boot + every CP) replaces the value-market lens; `docs/GOLDEN-USE-CASES.md` lists the known holes.
- hygiene lenses: build health, functionality honesty vs docs, test coverage of load-bearing paths, security posture, ops/CI path -> `hyg` items.

## History
- Boot->M9 ran on 2026-07-05 with no skill definition; personas' ship-loop adopted 2026-07-27; v2.0 (golden ledger) 2026-08-17; one-time UC-tagging pass of the existing backlog was due at the first resume after v2.0 (journaled).
