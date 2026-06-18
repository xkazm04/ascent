> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)

# Test Mastery — Investment Simulator & Forecast

The pure leaf functions here are well-tested in the *uniform* case: `orgsim.test.ts` exercises `recomputeRepo`/`simulateFleet`, and `forecast.test.ts` exercises `forecastTrajectory`/`forecastHeadline`/`humanizeDays`. But the risk lives one layer up and one branch over:

- The whole DB orchestration layer (`src/lib/db/plan.ts`: `simulateOrgFixes`, `rankOrgInvestments`, `goalImpactsForScenario`, `fleetSnapshot`, `metricSeries`) has **zero** tests — verified: no `.test` references `simulateOrgFixes`/`rankOrgInvestments`/`goalImpactsForScenario`/`projectGoal` anywhere in the repo.
- `projectGoal` — the goal-pacing verdict (`on-pace`/`behind`) leaders plan against — has **zero** tests despite `forecast.ts` carrying its own test file.
- Every existing `orgsim` test uses `flatRepo` with **all 9 dimensions present**, hiding a real divergence between how `recomputeRepo` computes `overall` (renormalized over present dims) and how axis scores are computed (NOT renormalized) — and posture is derived from axis scores.
- The simulate route (`route.ts`) carries an inline comment documenting a *previously shipped* NaN-target silent-no-op bug, but the regression guard has no test file (`route.test.ts` does not exist).

---

## 1. Test the present-dims divergence between `overall` and the axis/posture scores in the simulator
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/lib/scoring/orgsim.ts:65 (recomputeRepo) + src/lib/maturity/model.ts:245 (axisScore) → src/lib/scoring/orgsim.ts:117,134 (postureFor)
- **Scenario**: A repo whose latest scan persisted only a *subset* of dimensions (detector recovery, a partial/older scan, or a dropped ScanDimension row) is fed through `simulateFleet`. `recomputeRepo.overall` renormalizes the weighted mean over **present** dims only (orgsim.ts:72-76), so the headline isn't deflated. But `adoption`/`rigor` come from `axisScore`, which divides by the **full** axis weight sum and treats every absent dim as a `scoreFor → 0` with full weight (model.ts:251-254). So a repo that's genuinely L4 on overall can show a deflated adoption/rigor, flip its `postureFor` band, and land in the wrong bucket of `before.postureCounts`/`after.postureCounts`. A simulated "raise D2 to 70" can then appear to move a repo *across a posture* purely because the baseline axis was wrong — and the simulator's whole pitch is "consistent with how each repo's headline was actually computed." Today every test uses `flatRepo` (all dims present), so this divergence ships silently.
- **Root cause**: `orgsim.test.ts` only ever constructs repos with all 9 dims at one flat score, where renormalized-overall and non-renormalized-axis happen to agree. The partial-scan path that production `fleetSnapshot` can produce (it copies only the dims the scan persisted, plan.ts:74-80) is never exercised.
- **Impact**: Fleet posture mix (the headline "X repos AI-Native / ungoverned") and per-repo posture flips in the what-if can be wrong for any partially-scanned repo — corrupting the management dashboard's data-integrity story and making investment decisions off a mis-bucketed fleet.
- **Fix sketch**: In `orgsim.test.ts`, add a repo with only `{D1,D2}` present (both ≥ POSTURE_THRESHOLD) and assert the invariant: a repo whose every *present* dimension is ≥ 50 must NOT land in `early`/`manual` posture solely because absent dims were treated as 0. Concretely assert `recomputeRepo({D1:80,D2:80},"org")` yields `adoption`/`rigor` consistent with `overall` (all ≥ 50) and that `postureFor(adoption,rigor).id === "ai-native"`. If the assertion fails, it surfaces the bug; if `axisScore` is intended to penalize missing dims, the test documents that overall and axis use *different* present-dim policies (the real defect to fix).

## 2. Cover the untested simulator DB orchestration layer (simulateOrgFixes / rankOrgInvestments / goalImpactsForScenario)
- **Severity**: High
- **Category**: coverage-gap
- **File**: src/lib/db/plan.ts:501 (simulateOrgFixes), :588 (rankOrgInvestments), :542 (goalImpactsForScenario), :47 (fleetSnapshot)
- **Scenario**: `simulateOrgFixes` defaults a missing `scope` to "all scanned repos" (plan.ts:512), defaults a null `archetype` to `"org"` (plan.ts:84), and returns `null` on "no scanned repos" so the route can 404. A regression that (a) stops defaulting the archetype (NaN weights → NaN overall, polluting `avgOverall`), (b) silently widens scope to the whole fleet when the caller passed an empty-but-intentional array, or (c) returns an empty projection instead of `null` would all pass CI today — nothing tests this glue. Same for `rankFleetInvestments` being run once per dimension over the live snapshot.
- **Root cause**: All Prisma-backed functions in `plan.ts` are untested; the only coverage stops at the pure `simulateFleet`/`rankFleetInvestments` leaves, which never see a real snapshot, archetype defaulting, or the empty-scope→all-repos resolution.
- **Impact**: The simulator and the "where to invest" ranking are the planning surface leaders steer money/headcount with; a wrong default archetype or scope resolution silently mis-projects the entire fleet.
- **Fix sketch**: Add `src/lib/db/plan.test.ts` with a mocked `getPrisma()` returning a fixed repo+scan fixture (mix of archetypes, one repo with a null archetype, one with partial dims). Assert: (1) empty `repoFullNames` ⇒ scope = every scanned repo's fullName; (2) a repo with `archetype: null` is scored under the `"org"` lens, not NaN; (3) zero scanned repos ⇒ `simulateOrgFixes`/`rankOrgInvestments` return `null` (so the route 404s); (4) `rankOrgInvestments` returns one entry per `DIMENSIONS` id, sorted by `gain` desc. Invariant: the DB layer must never produce a NaN `avgOverall` or silently change scope semantics.

## 3. Test projectGoal's pace verdict — the on-pace / behind / required-rate logic leaders plan against
- **Severity**: High
- **Category**: coverage-gap
- **File**: src/lib/maturity/forecast.ts:223 (projectGoal)
- **Scenario**: `projectGoal` decides whether a maturity goal is `reached` / `on-pace` / `behind` / `tracking`, computes `etaDate`, and the `requiredPerWeek` a team must sustain to make a deadline. A regression that flips the deadline comparison (`etaDate <= deadline` at forecast.ts:259), miscounts `daysToDeadline` sign, or returns `behind` when the goal is already `reached` would ship green — `forecast.test.ts` tests only `forecastTrajectory`, `humanizeDays`, and `forecastHeadline`. `projectGoal` has zero test references in the repo.
- **Root cause**: The goal-pacing half of the module (lines 184-272) was added with no test; coverage chasing on the file would even look "fine" because the trajectory half is well covered.
- **Impact**: A leader reading "on pace to hit L4 by Q3" when the math actually says "behind" makes a wrong planning call; `requiredPerWeek` being wrong sets an impossible-or-trivial team target. Directly drives the Goals panel and the SIM-4 goal-impact ETAs.
- **Fix sketch**: Add `projectGoal` cases to `forecast.test.ts` with an injected `nowMs` (deterministic): (a) `current >= target` ⇒ `pace === "reached"` regardless of slope/deadline; (b) rising slope whose projected `etaDate` lands before `targetDate` ⇒ `"on-pace"`, after it ⇒ `"behind"`; (c) flat/falling slope with a deadline ⇒ `"behind"` (target never reached); (d) no deadline ⇒ `"tracking"` even with a valid `etaDate`; (e) `requiredPerWeek === ((target-current)/daysLeft)*7` rounded, and `null` once `current >= target` or the deadline is past. Invariant: a `reached`/`on-pace` verdict must never be returned when the projected crossing is after the deadline.

## 4. Assert the simulate route rejects a non-finite / out-of-range target (the documented NaN no-op regression)
- **Severity**: Medium
- **Category**: error-branch
- **File**: src/app/api/org/simulate/route.ts:54 (fix validation) + :37 (rank-target fallback)
- **Scenario**: The route's own comment (route.ts:51-53) records a real shipped bug: `target: NaN` passed `typeof === "number"`, survived `clamp(Math.round(NaN)) = NaN`, made `cur < NaN` false for every repo, and returned a silent **200 with `before === after`** — a "nothing changes" projection that looks like a legitimate result. The fix is the `Number.isFinite(t) && t in [0,100]` guard, but there's no `route.test.ts`, so a refactor that drops `Number.isFinite` (e.g. "simplifying" the condition) silently re-opens it. The rank-mode fallback (`body.target` → 70 when not finite/in-range, :37-40) is likewise unguarded by any test.
- **Root cause**: No test file exists for this route; the guard is regression-prevention code with no regression test pinning it.
- **Impact**: Users get a confidently-rendered "no impact" simulation instead of a 400, eroding trust in the planning tool and masking client bugs that send bad targets.
- **Fix sketch**: Add `src/app/api/org/simulate/route.test.ts` (mock `requireOrgRead` → null, `isDbConfigured` → true, and the `@/lib/db` sim functions). Assert: `target: NaN`, `target: -1`, `target: 101`, and a non-`D[1-9]` `dimId` each return **400** (not 200); a malformed `fixes[]` leg returns 400; and rank mode with `target: NaN` falls back to 70 (assert `rankOrgInvestments` is called with `70`). Invariant: an invalid target must never produce a 200 projection.

## 5. Make orgsim/forecast assertions catch the *direction* and *magnitude*, not just `>= 0`
- **Severity**: Low
- **Category**: success-theater
- **File**: src/lib/scoring/orgsim.test.ts:52 and :45
- **Scenario**: `simulateFleet(... target:100 ...)` asserts only `proj.promotions >= 0` (orgsim.test.ts:52) — vacuously true for any integer, including a regression that computes `promotions` as a constant 0 or a negative. Likewise `:45` asserts `after.avgOverall >= before.avgOverall`, which passes even if a bug made the fix a no-op. The tests confirm the function returns *a* number, not the *right* one.
- **Root cause**: Lower-bound-only assertions on outputs whose whole point is the magnitude of movement.
- **Impact**: A regression that zeroes out promotions or flattens the projected lift would still pass — false confidence on the simulator's headline numbers ("N would cross up a level").
- **Fix sketch**: Tighten to exact values on a hand-computable fixture: for `repos = [flatRepo("o/a",40), flatRepo("o/b",40), flatRepo("o/c",80)]` raising D2→100 across all, assert the specific `promotions` count and that `after.avgOverall - before.avgOverall` equals the hand-derived delta (a fixed integer), plus `proj.affected === 2`. Invariant: promotions and avg-lift must equal computed constants, not merely be non-negative.
