# Code Refactor Remediation — Cumulative Status (ascent, 2026-06-23)

Branch: `vibeman/code-refactor-2026-06-23` (off `vibeman/app-passport-p1`).
Scanner: `code_refactor` 🧹 · Scope: all 44 contexts.

## Headline

**64 of 159 findings closed across 9 themed waves — every one of the 43 High findings + 21 Mediums — in ~64 atomic fix commits (+ 9 wave/INDEX docs), with ZERO regressions throughout.**

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
| — | Wave docs | — | ~9 | INDEX + FIXES-WAVE-1..8-9 + this file |

**High findings: 43 / 43 closed (100%). Medium: 21 / 63. Low: 0 / 53.**

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

## What remains (deliberately deferred — low-value tail)

**42 Medium + 53 Low** findings remain — predominantly cosmetic / UI-micro cleanups with low ROI per the per-context reports:

- **Lower-value Medium duplication** (UI-micro): inline "labelled Meter row" micro-components, Export-CSV anchor copy, "pill" button class strings, impact/effort chip markup, clamp-scale/stagger chart closures, the `?ref=badge` URL built 3 ways, badge-style vocab, ADR-regex D5/D8, GoalImpact client/server type mirror, `filterActive` double-compute, Bedrock model/region resolution, session-cookie attrs, `explore` JSON parse, `PACE_NOTE` map, `optionLabel`/`scanCaption` caption, `githubAppFetch` alias, `fmtPts` placement, OG fallback-card, `applyWatchOptimistic` aliases, the "diagram card/glow" chrome, list.ts/discover.ts repo-normalization, fleet-alerts test-message builder, the org/import 4× schedule literal, the compare-page `Notice` empty-state.
- **All 53 Lows**: stray `console.log`, single unused imports, `import` vs `import type`, stale `(CRITICAL #n)`/`BUG` comments, write-only minor fields, redundant ternary arms, file-name↔export-name mismatches, a11y keyboard-nav (PanelTabBar-style), etc.

These are safe to pick up in a future session (the per-context reports carry exact line refs + fix sketches). None are correctness/security risks — the High tier and the consequential Mediums are fully closed.

## Verification

Every wave boundary: `node_modules/.bin/tsc --noEmit` = 0 errors; `npm run test` green. Final state: **tsc 0 · 2610/2610 tests · 168 test files · 0 regressions.** `next build` not run (live dev server); tsc + full vitest were the gates throughout.
