> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)

# Test Mastery — Launch Fleet Map

This context (idx 10) ships an animated landing/fleet map. It looks "view-only," but it contains real, untested **pure data-shaping logic** that decides what scores and which repos a signed-in user sees: `mergeStars` (live-refresh reconciliation), `mapRepos` (untrusted-API → star coercion), the `scanOrg` SSE event filter (the only path that mutates live maturity scores), and the `stats`/`matcher`/`ordered` derivations in `FleetMap.tsx`. **Zero `.test.ts(x)` files exist anywhere under `src/components/launch/`**, and `src/lib/sse.ts` (which this map consumes) is also untested. The repo's Vitest setup is pure-logic only (no jsdom / no `@testing-library/react` in `package.json`), so the correct, generatable batches target the pure functions and the reducer-shaped helpers — not React rendering.

Findings are ranked by business blast radius, not line count.

## 1. Test `mergeStars` for data-integrity invariants (no dropped, duplicated, or stale-but-changed stars)
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/components/launch/FleetMap.tsx:14
- **Scenario**: The 90s live-refresh (`refreshAll`) calls `mergeStars(prev, fresh)` to patch each org's repos in place. A regression to its identity-preservation rule — e.g. flipping the equality so a repo whose `overall`/`dOverall` changed keeps the OLD object (`return f.… ? p : f` → `… ? f : p`), or forgetting to `freshBy.delete(p.fullName)` so a repo present in both lists is **appended a second time** — would either freeze stale maturity scores on screen or render duplicate stars/links. Either ships silently: the map still "looks alive," and there is no test to catch it.
- **Root cause**: `mergeStars` is documented as "Pure" and carries four explicit invariants in its comment (keep old identity when unchanged; swap only changed; append new; preserve order), but **none are asserted by any test**. The function is not exported, so it's currently untestable without a refactor.
- **Impact**: The fleet map is the post-OAuth landing surface (`/launch`) — the product's first impression for a signed-in user. A frozen score makes Ascent look broken/stale to the exact decision-makers it's pitching maturity scoring to; a duplicated star inflates the headline `repos`/`scanned` tallies, mis-reporting the fleet.
- **Fix sketch**: Export `mergeStars` (or move it into `fleetMapStars.ts` beside `mapRepos`). Add a batch asserting: (a) a star unchanged across pulls keeps **referential identity** (`merged[i] === prev[i]`) so React won't re-animate; (b) a star whose `overall`/`level`/`dOverall`/`watched` changed is **replaced** by the fresh object (`!== prev`, value equals fresh); (c) a repo in both lists appears **exactly once** (no dupe) and at its original index (order preserved); (d) a repo only in `fresh` is appended once at the tail; (e) a repo only in `prev` (deleted upstream) is retained as-is.

## 2. Test the `scanOrg` SSE event filter — the only path that writes live maturity scores onto the map
- **Severity**: High
- **Category**: coverage-gap
- **File**: src/components/launch/FleetMap.tsx:82
- **Scenario**: `readSSE(...,({event,data}) => …)` is the sole place a streamed scan result becomes a brightened star. Its guard — `if (event !== "repo" || !data || data.error || data.skipped || !data.repo) return; … if (!Number.isFinite(overall)) return;` — is hand-rolled coercion over an **untrusted server stream**. If a regression drops the `data.skipped` check, a skipped repo (e.g. over-quota or unscannable) gets coerced (`Number(undefined)` → `NaN` is caught, but `Number(0)` from a skipped-with-zero payload is **not**) and paints a misleading `0` over a real score; dropping `Number.isFinite` lets a `NaN` overall flow into `starLook`/`scoreHex` and crash the color route. None of this is tested, and the handler isn't even extracted to a testable unit.
- **Root cause**: The reducer logic lives inline inside an async closure with no seam. `readSSE`/`parseSSE` in `src/lib/sse.ts` — the parser that produces these `{event,data}` frames — **also has no test file**, so the whole stream→state path is unverified end to end.
- **Impact**: This map is what the OAuth callback deliberately lands on to "light up a grey field on the spot." A silently mis-applied or `NaN` score either shows a customer a wrong maturity number for their repo or blanks the map with a color-fn throw — directly undermining the product's core claim (trustworthy maturity scores).
- **Fix sketch**: Extract a pure `applyScanEvent(constellations, login, msg): Constellation[]` reducer and test it: a `repo` event updates only the matching `fullName` in the matching `done` org; events with `error`/`skipped`/missing `repo`/non-finite `overall` are **no-ops** (constellations returned unchanged, ideally same reference); a non-`repo` event is ignored. Separately add `src/lib/sse.test.ts` asserting `parseSSE` returns `{event,data:null}` on malformed JSON and `readSSE` skips empty keepalive frames and emits one callback per `\n\n` frame.

## 3. Add a generatable invariant batch for `mapRepos`, `starPosition`, and `starLook`
- **Severity**: High
- **Category**: edge-case
- **File**: src/components/launch/fleetMapStars.ts:50
- **Scenario**: `mapRepos(raw)` defensively coerces the `/api/app/repos` JSON (it even guards `Array.isArray`), `starPosition` must be deterministic across SSR/CSR, and `starLook` must clamp out-of-range scores. A regression that lets `mapRepos` throw on a null/garbage row (e.g. `r.state?.overall` rule changed to `r.state.overall`) would **blank the entire constellation grid** on a single malformed repo; a non-deterministic `starPosition` (e.g. seeding with `Math.random` or dropping the `hash01` seed) reintroduces SSR/CSR hydration jitter; `starLook(150)` or `starLook(-10)` must stay inside `r`/`opacity` bounds. All three are pure and exported — ideal LLM-generatable batch — yet untested.
- **Root cause**: These are classic "pure helper, assumed obviously correct" functions; the deterministic-position and clamp invariants are load-bearing for hydration correctness and color safety but documented only in comments.
- **Impact**: `mapRepos` is the trust boundary for an external GitHub API payload feeding every star; a throw here takes down the landing experience for a logged-in user. Position non-determinism causes visible hydration flicker on the marquee page.
- **Fix sketch**: For `mapRepos`: assert non-array / `null` / `undefined` → `[]`; a row missing `state` yields `overall:null,level:null,watched:false` without throwing; `dOverall` non-number → `null`. For `starPosition`: same `(i,total,seed)` returns the **identical** `{cx,cy}` on repeated calls, and output stays within the 120×120 field (`0 ≤ cx,cy ≤ 120`). For `starLook`: `starLook(null)` is the faint default; `starLook(150)` and `starLook(-10)` clamp so `r` and `opacity` stay within `[1.5,3.4]` and `[0.55,1.0]` (the `t∈[0,1]` contract).

## 4. Cover the FleetMap derivations: `stats` tallies, `matcher` filter, and `ordered` sort
- **Severity**: Medium
- **Category**: coverage-gap
- **File**: src/components/launch/FleetMap.tsx:167
- **Scenario**: The header `stats` (`repos`, `scanned`, `avg`, `risers`/`fallers`), the `matcher` predicate (query + level-band + watched-only), and the `ordered` sort comparator are pure `useMemo` derivations with real edge cases: `avg` must be `null` (not `NaN`/`0`) when `scanned === 0`; `risers`/`fallers` use the `>= 1` / `<= -1` movement threshold; the `levels` filter must treat a null-level star as the `"unscanned"` band (`r.level ?? "unscanned"`); the sort must keep `done` orgs ahead of `loading`/`error` ones regardless of `sortKey`. A regression (e.g. `avg = sum / scanned` without the `scanned ?` guard → `NaN`, or the `unscanned` fallback dropped) silently mis-states the fleet headline or hides unscanned repos from the filter.
- **Root cause**: The logic is trapped inside `useMemo` closures in a `"use client"` component with no extraction seam and no test, so its branch behavior (empty fleet, all-unscanned, mixed statuses) is unverified.
- **Impact**: These are the numbers a prospect reads first ("avg maturity", "X/Y scanned", "▲ risers ▼ fallers"). A `NaN` avg or an off-by-one mover count makes the headline pitch look wrong; a broken `unscanned` band hides exactly the repos a user filters for to act on.
- **Fix sketch**: Extract pure helpers `fleetStats(constellations)`, `makeMatcher({q,levels,watchedOnly})`, and `orderConstellations(constellations,sortKey)`. Assert: empty/all-loading fleet → `avg:null`, `scanned:0`; movement threshold counts `dOverall:1`/`-1` but not `0.5`; matcher with a level set including `"unscanned"` matches a `level:null` star; matcher returns `undefined` (full brightness) when no filter active; sort places every `done` org before any `loading`/`error` org and orders by metric within.

## 5. Add a calibrated changed-code coverage gate so new launch logic can't ship untested
- **Severity**: Low
- **Category**: quality-gate
- **File**: vitest.config.ts:1
- **Scenario**: An entire interactive, data-bearing module (`src/components/launch/`) reached production with **no test file at all**, and the shared `src/lib/sse.ts` it depends on is likewise untested. Nothing in CI flags new untested pure logic in this area, so the gaps in findings 1–4 are the predictable result, and the next addition will repeat it.
- **Root cause**: `vitest.config.ts` defines no `coverage` block and there is no per-changed-file threshold; coverage is purely opt-in by whoever remembers to write a test.
- **Impact**: Low individually, but it's the systemic reason money/data-shaping helpers land untested. A calibrated gate prevents regression on **changed** files without forcing a big-bang backfill of the existing UI.
- **Fix sketch**: Enable `test.coverage` (v8) and gate **changed `.ts` files under `src/lib/**` and the pure `*Stars.ts`/extracted-helper modules** on a modest line+branch floor (e.g. 70%), scoped to the diff — not the whole repo, and explicitly excluding `*.tsx` render code the infra can't test. Once findings 1–4 export their helpers, this gate keeps them and future launch logic honest.
