# CI Gate & Status Checks — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

## 1. Any single gate query param silently discards the ENTIRE persisted org policy — and lets an anonymous caller weaken the org bar
- **Severity**: High
- **Category**: trade-off-undocumented
- **File**: `src/app/api/gate/[owner]/[repo]/route.ts:129`
- **Scenario**: Policy precedence is all-or-nothing: `hasPolicyParams = GATE_POLICY_PARAMS.some(...)` — if the CI URL carries even ONE policy param (e.g. `?min_overall=60`), the org's persisted policy is skipped entirely and the gate runs on `policyFromParams` (params + archetype default). A team that saved `{ minDimensionFor: { D9: 70 }, requireProtectedBranch: true }` in GatePolicyEditor and then added `?min_overall=60` to their curl gets the D9 floor and protection rule silently dropped. Worse, the endpoint is unauthenticated by design, so anyone (including a PR author editing the workflow file) can pass a lax param (`?min_dimension=1`) and get a green verdict that no longer reflects the org's configured bar.
- **Root cause**: The precedence comment (route.ts:123-128) documents "explicit query params override; else the persisted policy" but never records WHY override is full-replacement rather than per-field merge, nor that params can override the saved bar DOWNWARD on an unauthenticated surface. `policyFromParams` merges each param against the archetype default, not against the org policy.
- **Impact**: The exact drift the persisted-policy fix (ci-gate-status-checks #2) was built to eliminate reappears the moment CI adds one param: the HTTP gate and the App check-run enforce different bars on the same repo, and the weakening path is invisible (the response's `policy` field looks legitimate).
- **Fix sketch**: Merge params ON TOP of the resolved org policy (`policyFromParams(searchParams, archetype, orgPolicy ?? undefined)` — per-field fallback to org policy before archetype default). If full replacement is intentional, document the trade-off at `GATE_POLICY_PARAMS` and consider a `strict=1`/org-config flag that forbids per-request weakening (only allow params that are ≥ the persisted floor).

## 2. Fail-closed is applied only to dimension floors — minOverall/minLevel fail OPEN on a non-finite score, and the two evaluators disagree on a malformed level
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/lib/scoring/gate.ts:219-223`
- **Scenario**: `belowFloor()` exists precisely because `NaN < 40 === false` lets an unscored value slip the gate (gate.ts:45-53), and it guards both dimension sweeps. But the overall check is still a plain `g.overall < pol.minOverall` and the level check `g.level < levelNum(pol.minLevel)` — a NaN `overallScore` or a malformed `level.id` (`levelNum("Lx")` → NaN at gate.ts:43) sails past both rules and can produce `pass: true`. Meanwhile `evaluateGateLite` parses a malformed level as `... || 0` (gate.ts:305) → 0 → FAILS any minLevel. So the exact input the fail-closed doctrine targets passes in `evaluateGate` and fails in `evaluateGateLite`, contradicting the "SAME rules... can no longer drift" contract documented at gate.ts:189-201.
- **Root cause**: The fail-closed rationale was implemented (and tested — gate.test.ts:69-74) only for the dimension path; the overall/level comparisons were never revisited, and the two shape adapters chose opposite defaults for unparseable levels.
- **Impact**: A partially corrupt persisted report or an LLM response missing `overallScore` yields a confident 200-pass in CI while the fleet dashboard shows the same repo failing — verdict-identity drift in the one code path built to prevent it.
- **Fix sketch**: In `evaluateNormalized`, treat a non-finite `overall` as below any `minOverall` (reuse `belowFloor`) and a non-finite/0 `level` as below any `minLevel`, with an "unscored — fail-closed" message; align `evaluateGate`'s level parse with lite's (`|| 0`). Add the NaN-overall and malformed-level cases to gate.test.ts for both evaluators.

## 3. GatePolicyEditor can save a policy that silently sheds fields the form shows as enabled — `Number(securityFloor) || 0` and 0-valued mins are dropped server-side while the UI reports "the gate now enforces it"
- **Severity**: Medium
- **Category**: missing-state
- **File**: `src/components/org/governance/GatePolicyEditor.tsx:39`
- **Scenario**: With the Security checkbox on, clearing the floor input (or typing a non-number) makes `buildPolicy()` emit `{ D9: 0 }` via `Number(securityFloor) || 0`; `sanitizeGatePolicy` drops any ≤0 floor (gate.ts:159-164), so the stored policy has NO security floor. Same for `Min overall`/`Min per-dimension` set to `0` (inputs allow `min={0}`). If any other field survives, the server echo is non-null, so the success message says "Policy saved — the gate now enforces it" (line 67) — the owner believes a D9 bar is live that was never stored. The prior fix (line 58-63) only distinguishes null vs non-null echoes; it doesn't catch a partially-dropped policy.
- **Root cause**: The form validates nothing client-side and never reconciles its fields against the server's sanitized echo (`d.policy` is fetched but only null-checked); the sanitizer's "≤0 means not set" contract is invisible in the UI (`min={0}` even suggests 0 is valid).
- **Impact**: An org owner can believe a security floor / overall bar is enforced when it isn't — the exact success-theater failure mode finding #4 was supposed to close, one level deeper.
- **Fix sketch**: Set `min={1}` on the three number inputs; on save, diff `buildPolicy()` against the echoed `d.policy` and message which fields were dropped ("Security floor 0 is not a valid bar — field cleared"); or simply seed the form state from the echo so the UI always shows what is actually stored.

## 4. Verdict-identity via persisted scans quietly reintroduces the mode-mixing the cache fix removed — and the two adjacent comments contradict each other
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/app/api/gate/[owner]/[repo]/route.ts:98-110`
- **Scenario**: The persisted-scan branch (line 98-103) serves an LLM-scored verdict to a DEFAULT (`mock=true`) gate call whenever a persisted scan exists for the resolved sha. Ten lines later, the cache-probe comment (line 104-108) explains that mode-mixed reads were removed precisely because "a default (mock=true) CI gate could return a STOCHASTIC LLM verdict — a PR flipping pass↔fail between runs with identical code". Both behaviors now coexist: the same default gate call returns the deterministic rubric verdict until someone scans the repo in the dashboard, then flips to the LLM verdict for the same commit — pass↔fail can change with zero code change, exactly the failure mode the second comment declares fixed.
- **Root cause**: The UAT fix (L2-RAJ-01) optimized for dashboard/gate agreement, the cache fix for determinism; each is documented in isolation and neither comment acknowledges that they trade off against each other. Which invariant wins was decided implicitly by branch order.
- **Impact**: Teams keying CI on the default gate get non-reproducible verdicts near the threshold (fresh push → mock verdict; post-dashboard-scan re-run → LLM verdict), and debugging it requires reading two comments that each claim the opposite guarantee.
- **Fix sketch**: Record the precedence decision explicitly at the persisted-scan branch ("verdict identity beats mode determinism when a persisted scan exists — here's why"), and expose it in the response (e.g. `source: "persisted" | "cache" | "fresh"`) so a CI operator can see why two runs differed. Alternatively, only serve persisted scans whose provider matches the requested mode (parity with the mock-row skip that already exists for `?mock=0`).

## 5. Save/error feedback in GatePolicyEditor is invisible to assistive tech — status text is a bare styled span with no live region
- **Severity**: Low
- **Category**: a11y
- **File**: `src/components/org/governance/GatePolicyEditor.tsx:170`
- **Scenario**: After Save/Reset, the outcome ("Policy saved…", "Reset to the archetype default…", or an error) renders as `{msg && <span className=...>}` distinguished only by color (emerald vs orange). There is no `role="status"`/`aria-live`, so a screen-reader user who activates "Save policy" hears nothing — success, silent field-dropping (finding #3), and failure are all indistinguishable. Color is also the only differentiator between note and error, which fails WCAG 1.4.1 (Use of Color) for low-vision users.
- **Root cause**: The message span was styled, not wired for announcement; busy state is conveyed only by swapping button text.
- **Impact**: Org owners using assistive tech cannot confirm whether the merge-blocking policy they just edited actually saved — high-stakes feedback for this particular form.
- **Fix sketch**: Wrap the message in a persistent `<span role="status" aria-live="polite">` (rendered always, content swapped) and prefix errors with a textual marker (e.g. "Error: …") or an icon with alt text so the kind is not color-only. Optionally `aria-busy` on the button group while `busy !== null`.
