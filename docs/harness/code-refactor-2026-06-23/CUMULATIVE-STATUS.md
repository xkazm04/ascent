# Code Refactor Remediation — Cumulative Status (ascent, 2026-06-23)

Branch: `vibeman/code-refactor-2026-06-23` (off `vibeman/app-passport-p1`).
Scanner: `code_refactor` 🧹 · Scope: all 44 contexts.

## Headline

**155 of 159 findings closed across 14 themed waves + a gap-closure audit — every Critical (0), every High (43), every Medium (63), and 49 of 53 Lows — in ~135 atomic fix commits (+ wave/INDEX docs), with ZERO regressions throughout.** The only 4 open findings are Lows left un-consolidated with documented cause (listed at the end).

Baseline held the entire way: **tsc 0 errors** at every wave boundary; tests **2585 → 2610** (net +25 = new lock/regression tests added by the security & infra waves, minus the 1 test removed alongside its dead code). No production behavior changed except the explicitly-approved security hardenings and a handful of noted drift-corrections.

## Waves

| Wave | Theme | Closed | Commits | Notes |
|---|---|---:|---:|---|
| 1 | Dead-code removal | 9 (7H+2M) | 9 | 2 dead components, 5 dead exports, a cross-domain barrel leak, Flight-Deck leftovers |
| 2 | Security/safety primitives | 7H | 6 | CSV-injection gap closed; parseRepo; filename; **3 approved hardenings** (orgIdForSlug, SSRF, IDOR) |
| 3 | Infra plumbing | 6H | 6 | SSE server helper, onboarding SSE drain, GitHub headers, retention withRetry (DSQL drift fix), LLM timeout/env |
| 4 | Scoring/domain logic | 5H | 5 | one gate evaluator, level helpers, isDimensionId, apply-PR pipeline, CI snippet |
| 5 | UI constants & chips | 7H | 7 | STATUS maps, POSTURE_ORDER, SCHEDULES, DIRECTION_TONE, DeltaTag, Kicker, humanizeDays |
| 6 | UI components & markup | 8H | 7 | OG brand chrome, ScopeFilterBar, sign-in chrome, briefing DimRow+grid, LiveRepoSeed, Remotion Metric, bulkTagRepos |
| 7 | Billing/quota orchestration | 2H | 2 | credit reserve/refund loop, scan-route post-scan orchestration (the money paths, held for last) |
| 8 | Dead-code Mediums | 9M | 9 | pure subtraction |
| 9 | Duplication Mediums | 10M | 10 | env-bool helper, abortable fetch, quota window/key, HistoryPoint mapping, effective-floor, aiStandard, roundedMean, audit/playbook gates |
| 10 | Cosmetic cleanup + dead-code Lows + cleanup Meds | 21 | 21 | stale comments, dead exports/fields, import-paths, eslint-disable |
| 11 | Structure (Lows + Meds) | 13 | 13 | file/export naming, barrel routing, re-export shims, component extractions |
| 12 | Duplication Lows | 11 | 11 | shared formatters/types/constants (signedDelta, hex regex, PUBLIC_ORG, …) |
| 13 | Backend/data/scoring dup Mediums | 15 | 15 | allowance-gate, paging-delete, champion-select, cookie-attrs, GhRepo, Bedrock, SCHEDULES, … |
| 14 | UI duplication Mediums | 14 | 12 | OG fallback card, MeterRow/ExportCsvLink, pill styling, RoadmapMeta, vScale (NaN-guard), badge URL/styles |
| gap | Gap-closure audit (4 missed, incl. 1 High) | 4 | 4 | fleet-alerts #1 (High), maturity ADR regex, checkout return-URL, PracticeApply Artifact |
| — | Wave docs | — | ~11 | INDEX + FIXES-WAVE-1..14 + CUMULATIVE-STATUS |

**Critical 0/0 · High 43/43 (100%) · Medium 63/63 (100%) · Low 49/53. Total 155/159.**

## Security hardenings applied (Wave 2, explicit user sign-off)

1. **CSV formula-injection** — `org/repositories` CSV route was missing the `=/+/-/@` guard; one shared `csvField` closes it (the scan's #1 finding).
2. **orgIdForSlug → getOrgId** — canonical = lowercase (matches how `upsertInstallation` persists slugs); fixed `orgHasOwner` mis-normalizing via `normalizeLogin`.
3. **SSRF guard** — alert-webhook validator now also rejects CGNAT/IPv6 ULA+link-local/multicast/metadata hosts (shared `src/lib/net/ssrf.ts`).
4. **Tenant-read IDOR gate** — usage page+API now honor the Supabase login-wall + `ASCENT_OPEN_ORG_DASHBOARDS` opt-in via canonical `canReadOrg`/`requireOrgRead`.

Plus drift-fixes in later waves: retention OCC retry now covers DSQL `OC###`/`40P01`; `LLM_TIMEOUT_MS=0` now honored; share-page deltas corrected; gate-comment fail-closed; several unguarded mean/dimensions copies corrected.

## Pattern catalogue (10 durable items)

1. **Back-compat/forwarder wrapper rot** — a thin singular→plural / `fn→fnY(opts)` wrapper outlives its migration.
2. **Tripwire-only dead code** — a fn kept alive only by a test asserting it's *never* called; safe to delete iff the test also asserts the replacement positively.
3. **Cross-domain barrel re-export** — a barrel re-exports a neighbouring domain; verify with a multiline grep for those symbols *from the barrel path*.
4. **Drifted-copy security primitive** — the danger is a copy that *omits a guard* the others have (CSV formula guard); grep each copy for the guard, not just the name.
5. **Shared-signature latent-bug reveal** — widening a helper to 2 args turns `arr.map(fn)` into passing the index as arg 2 (quote-by-index bug); audit callback-position uses.
6. **Inferior drifted resilience primitive** — a private `withRetry` lags the shared one on the prod target (DSQL codes); the dup is a *reliability* bug.
7. **`|| fallback` vs real env coercion** — `Number(env)||D` silently coerces a configured `0`; a shared `envNumber` makes `0` honorable.
8. **Twin functions over different shapes** — same rules over different field shapes; consolidate via one evaluator over a normalized view + thin adapters; prove identity by running existing tests unchanged.
9. **`x==="1"||x==="true"` env-flag sprawl** — consolidate to `envBool`, but leave modules with a *different* truthy set (trim/lowercase).
10. **Quota/window math split from its tested core** — route the untested `peek` through the tested `decide` core.

## What remains — 4 Lows, all won't-fix with documented cause

The full Medium/Low tail was worked in waves 10–14 (+ the gap-closure audit). The only findings left open are 4 Lows that are intentionally NOT consolidated:

1. **`dev-inspector #4`** — `splitLoc`/loader path-tail slicing spans the build/runtime layer boundary; the report itself says do NOT consolidate.
2. **`design-system #3`** — `DeckNav`'s per-state accent/slate color toggle cannot route through the 2-tone `Kicker` without a visible change.
3. **`members-access-control #4`** — the client `AcceptResult` is deliberately broader than the canonical server type (carries route-guard `reason`/`error`); the report's "identical" premise was false.
4. **`org-overview-standing #3`** — `MoversList` (overview) and `MoveRow` (executive) use different level-pair guards; sharing would change the executive render.

See `FIXES-WAVE-10-14.md` for the full tail breakdown and the gap-closure audit (which caught one mis-bucketed High — fleet-alerts #1).

## Verification

Every wave boundary: `node_modules/.bin/tsc --noEmit` = 0 errors; `npm run test` green. Final state: **tsc 0 · 2610/2610 tests · 168 test files · 0 regressions.** `next build` not run (live dev server); tsc + full vitest were the gates throughout.
