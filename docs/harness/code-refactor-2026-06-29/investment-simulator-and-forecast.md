# Code Refactor — Investment Simulator & Forecast
> Total: 4 | Critical: 0 High: 1 Medium: 2 Low: 1

## 1. `recomputeRepo` re-implements the canonical headline math (`overallScoreFor`) inline
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/scoring/orgsim.ts:62-82 (vs src/lib/maturity/model.ts:256-266)
- **Scenario**: `recomputeRepo` computes a repo's overall by hand:
  ```ts
  const present = DIMENSIONS.filter((d) => dims[d.id] != null);
  const wsum = present.reduce((a, d) => a + (lensW[d.id] ?? 0), 0);
  const overall = clamp(
    wsum > 0 ? Math.round(present.reduce((a, d) => a + scoreFor(d.id) * (lensW[d.id] ?? 0), 0) / wsum) : 0,
  );
  ```
  This is byte-for-byte the renormalized weighted-mean already exported as `overallScoreFor(scored, archetype)` in model.ts — which its own docblock calls "the single source of truth for how an overall headline rolls up." The axis half of `recomputeRepo` already delegates to the shared `axisScore`; only the overall is hand-inlined.
- **Root cause**: When the simulator was written the overall mean was copied in rather than reusing `overallScoreFor`, presumably because the input is a `Record<string, number>` instead of the `{id, score}[]` that `overallScoreFor` takes. The file comment even says it "mirrors assembleReport" — i.e. it knowingly duplicates the engine's roll-up.
- **Impact**: Two copies of the most load-bearing formula in the product (it determines every projected level transition and the whole ROI ranking). If the renormalization rule ever changes in model.ts (it has a history of partial-scan / drop-a-dim fixes), the simulator silently diverges from the real headline — exactly the "projection consistent with the live engine" invariant the module promises. This is the KNOWN THEME ("scoring math possibly duplicated with maturity/model").
- **Fix sketch**: Build the present-dims array and delegate:
  ```ts
  const scored = DIMENSIONS.filter((d) => dims[d.id] != null).map((d) => ({ id: d.id, score: dims[d.id]! }));
  const overall = overallScoreFor(scored, archetype);
  ```
  Drop the local `present`/`wsum`/inline mean and the now-unused `clamp` import if nothing else needs it. Semantics are identical (both `clamp(Math.round(Σ score·w / Σ w))`, both return 0 when no present weight). The existing orgsim tests already pin the consistency, so this is a safe swap.

## 2. DB-guard + org-auth route preamble duplicated across ~30 org routes
- **Severity**: Medium
- **Category**: structure
- **File**: src/app/api/org/simulate/route.ts:18-29 (pattern repeats in 30 files under src/app/api/org)
- **Scenario**: The POST opens with the same four-step ritual every org route uses:
  ```ts
  if (!isDbConfigured()) return NextResponse.json({ error: "… requires a database." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { org?: string; … };
  if (!body.org) return NextResponse.json({ error: "Provide { org }." }, { status: 400 });
  const denied = await requireOrgRead(body.org);
  if (denied) return denied;
  ```
  The `isDbConfigured() → 503` guard alone appears 45 times across 30 files; the full db-guard + `!body.org` + `requireOrgRead/Access` + `if (denied) return denied` block is the org-resolution preamble called out in this context's KNOWN THEMES (it is auth/org-resolution rather than literal CSRF — `requireOrgRead` does the resolution; there is no separate origin check).
- **Root cause**: Each route handler was written independently; no shared higher-order wrapper exists for "DB-backed, org-scoped POST."
- **Impact**: ~5 lines × 30 routes of copy-paste; the 503 message wording drifts per route, and any change to the auth/db contract (e.g. a new CSRF/origin check the theme anticipates) must be threaded through 30 hand-edited spots — easy to miss one.
- **Fix sketch**: Introduce a `withOrg(handler, { mode: "read" | "write" })` wrapper in `@/lib/authz` (or a small `resolveOrgPost(request)` helper returning `{ org, body } | NextResponse`) that runs the db-guard, parses the body, validates `org`, and applies `requireOrgRead/Access`, then have each route's handler receive the resolved `{ org, body }`. Migrate routes incrementally; this context's `simulate` route is a clean first candidate.

## 3. Per-calendar-day mean collapse implemented twice (and applied twice in series)
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/maturity/forecast.ts:95-107 (internal `byDay`) vs src/lib/db/plan.ts:113-127 (`dailyAvg`)
- **Scenario**: `forecastTrajectory` collapses observations to one point per calendar day (mean) before fitting:
  ```ts
  const byDay = new Map<number, { sum: number; n: number }>();
  for (const p of parsed) { const day = …; e.sum += p.value; e.n += 1; … }
  const ys = xs.map((d) => byDay.get(d)!.sum / byDay.get(d)!.n);
  ```
  `plan.ts`'s `dailyAvg` does the same "group timestamps by calendar day → mean" (its docblock literally says "the shape forecastTrajectory fits"), then feeds the result straight into `forecastTrajectory` (via `metricSeries` → `projectGoal`) — which collapses it a second time.
- **Root cause**: Two grouping helpers grew in parallel — `forecast` keys by integer day-offset (it needs `x` offsets for OLS), `plan` keys by ISO-date string and rounds each day to an int. The pre-collapse in `plan` is redundant given `forecastTrajectory` already de-dups by day.
- **Impact**: Two daily-averaging implementations to keep in sync; the redundant double-collapse also means `plan.dailyAvg`'s `Math.round` quietly perturbs the values the OLS later fits (rounded daily means vs raw), so the two paths can disagree on a slope by a rounding margin. Maintenance + a subtle precision inconsistency.
- **Fix sketch**: Extract one `collapseByDay(points): { day: string; value: number }[]` (string-key, no rounding) into `@/lib/maturity/forecast` (or a small shared util) and have both `dailyAvg` and `forecastTrajectory` consume it; or, since `forecastTrajectory` already collapses, have `plan` hand it the raw timestamped series and delete `dailyAvg`'s rounding step. Keep the existing `dailyAvg`/forecast tests as the guardrail.

## 4. Target validity (finite number in 0..100) expressed twice in the simulate route
- **Severity**: Low
- **Category**: duplication
- **File**: src/app/api/org/simulate/route.ts:35-38 and :52
- **Scenario**: Rank mode validates the target positively:
  ```ts
  typeof body.target === "number" && Number.isFinite(body.target) && body.target >= 0 && body.target <= 100
  ```
  and the fixes loop validates the identical predicate in negated form:
  ```ts
  typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > 100
  ```
  Same "finite number in [0,100]" rule, written two ways, with two long explanatory comments about why `NaN`/out-of-range must not pass.
- **Root cause**: The two validation sites (rank vs fix) were hardened independently in response to the same `NaN`-leaks-through bug.
- **Impact**: Minor — a future bounds change (e.g. allow 0..120) must be edited in two phrasings that are easy to keep inconsistent; the duplicated rationale comments add noise.
- **Fix sketch**: Add a tiny local guard `const isTargetValid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;` and use it in both spots (`isTargetValid(body.target) ? body.target : 70` for rank; `!isTargetValid(t)` in the fix loop), collapsing the two comment blocks into one on the helper.
