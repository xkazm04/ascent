> Total: 5 findings (0 critical, 2 high, 2 medium, 1 low)

# CI Gate & Status Checks — combined bug+ui scan

## 1. Fleet governance view silently never enforces `requireProtectedBranch` — diverges from the CI gate it claims to mirror
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/scoring/gate.ts:242
- **Scenario**: An owner enables "Require a protected default branch" in the gate policy editor (`requireProtectedBranch: true`, persisted on the org). A repo with an UNPROTECTED but readable default branch is then evaluated. The PR Check Run (`evaluateGate` on a real `ScanReport`) correctly FAILS it on the `governance` rule. But the org's `/governance` fleet dashboard — which calls `evaluateGateLite` via `buildGovernanceOverview` — passes the very same repo, because it only ever calls `evaluateGateLite({ level, overall, posture, dims }, policy)` (governance.ts:127), never populating `snap.protected`/`snap.govReadable`. The governance check at gate.ts:242 requires `snap.govReadable && snap.protected === false`; with both `undefined`, the branch is skipped entirely.
- **Root cause**: `evaluateGateLite` is documented to apply "the SAME rules as evaluateGate so the dashboard's fleet status and the CI gate agree", but its governance rule is conditioned on snapshot fields that the only production caller never supplies. The rollup snapshot has no per-repo protection data, so the rule is effectively dead in the fleet view while the policy text / `gateQuery` / `ciWith` all advertise "Default branch must be protected".
- **Impact**: Policy drift between two evaluators that are contractually supposed to agree. The dashboard reports a higher pass-rate than CI actually enforces; an owner reading the governance page believes unprotected repos are clearing a gate they are blocked by. False "all green" on a security-relevant control.
- **Fix sketch**: Either (a) make the divergence explicit — when `policy.requireProtectedBranch` is set but `snap.protected`/`snap.govReadable` are absent, surface it as an "unknown — not evaluated in fleet view" note rather than a silent pass; or (b) carry `protected`/`govReadable` into the rollup snapshot and pass them from `buildGovernanceOverview` so the rule actually runs. At minimum, `policyText`/`gateQuery` should not advertise a condition the fleet view cannot evaluate.

## 2. GatePolicyEditor silently downgrades a custom Security (D9) floor to 50 on any save
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: state-corruption
- **File**: src/components/org/GatePolicyEditor.tsx:30
- **Scenario**: An owner sets a stricter Security floor than the editor's fixed value — e.g. `min_security=70` via the gate API/`ciWith` snippet, or a policy persisted as `{ minDimensionFor: { D9: 70 } }`. They later open the editor: the "Security floor (D9 ≥ 50)" checkbox renders CHECKED (line 19: `initial?.minDimensionFor?.D9 != null`). They change something unrelated (e.g. min level) and click "Save policy". `buildPolicy()` hardcodes `if (security) p.minDimensionFor = { D9: 50 }` — the saved floor drops from 70 to 50.
- **Root cause**: The checkbox is a lossy boolean projection of a numeric floor. On read it reflects "any D9 floor present"; on write it can only emit the single hardcoded value 50. The editor cannot round-trip a non-50 floor it happily displays as enabled.
- **Impact**: A merge-blocking security bar is silently weakened by a routine, unrelated edit. No warning is shown; `sanitizeGatePolicy` accepts 50 as valid, so the downgrade persists. The org now enforces a lower security gate than the operator believes.
- **Fix sketch**: Make the security floor a numeric input seeded from `initial.minDimensionFor?.D9` (defaulting to 50 when newly enabled), and emit that value in `buildPolicy()`; or, if a fixed control is intentional, preserve any existing `initial.minDimensionFor` value when the checkbox state is unchanged rather than overwriting it with 50.

## 3. PR sticky-comment upsert has a read-then-write race that stacks duplicate comments
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/lib/github/checks.ts:65
- **Scenario**: Two PR webhook deliveries arrive close together for the same PR (e.g. `opened` immediately followed by `synchronize`, or `synchronize` + a `check_run` re-run). Each carries a distinct `X-GitHub-Delivery` id, so the replay-dedup map does not collapse them, and each schedules its own `after(() => runPrGate(...))`. Both `runPrGate` calls invoke `upsertStickyComment`; both scan the first pages, find NO comment with the marker yet (neither has posted), and both fall through to POST — producing two "sticky" comments.
- **Root cause**: The find-then-PATCH-else-POST upsert is a classic TOCTOU with no locking/idempotency key. GitHub's issue-comments API offers no conditional create, and nothing serializes concurrent gate runs for one PR, so the "updated in place, never stacked" guarantee in the module header is only true when runs are strictly sequential.
- **Impact**: The exact stacking the sticky comment is designed to prevent. A noisy PR with rapid pushes accrues multiple gate comments; subsequent runs then update only one of them, leaving stale duplicates that contradict each other.
- **Fix sketch**: Serialize gate runs per `(owner, repo, prNumber)` with a short-lived in-process lock/in-flight map (mirroring the delivery dedup pattern), so a second run waits for the first to post before it reads. As a backstop, after creating, re-scan and delete any older duplicate carrying the marker (lowest id wins).

## 4. PR comment policy footer omits the Security floor and protected-branch conditions
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-state
- **File**: src/lib/scoring/gate-comment.ts:135
- **Scenario**: A gate fails purely on the Security (D9) floor or the `requireProtectedBranch` rule. The rendered PR comment's "Policy: …" footer is built only from `minLevel`, `minOverall`, `minDimension`, and `forbidPostures` (lines 136–139). Neither `minDimensionFor` (the D9 security floor) nor `requireProtectedBranch` is ever shown, so the footer summarising the active gate misrepresents it — e.g. shows only "min L3 · no dim < 40" when the binding rule was "D9 ≥ 50" or "default branch must be protected".
- **Root cause**: `policyBits` was not extended when `minDimensionFor`/`requireProtectedBranch` were added to `GatePolicy`. The failure messages list the specific breach, but the policy summary the developer reads to understand "what bar am I held to" is incomplete.
- **Impact**: Confusing PR UX — a developer sees a failure for a condition that isn't reflected in the stated policy, making the gate feel arbitrary and harder to self-serve. Parity gap with `governance.ts`'s `policyText`, which DOES render both.
- **Fix sketch**: Append to `policyBits`: for each entry in `gate.policy.minDimensionFor`, `min <DIM> <floor>` (e.g. "min D9 50"); and when `gate.policy.requireProtectedBranch`, push "protected branch". Reuse `DIMENSION_BY_ID` for a readable dim name as `policyText` does.

## 5. Saving an all-invalid policy reports "cleared" in the audit log even though the user clicked Save
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/app/api/org/gate-policy/route.ts:43
- **Scenario**: An owner submits a policy object whose every field is invalid (e.g. a malformed body, or values that all fail `sanitizeGatePolicy`). `clean` becomes `null`, `setOrgGatePolicy` stores DbNull, returns `null`, and the audit record is written with `action: stored ? "set" : "cleared"` → "cleared". The audit trail records a destructive "reset to default" action that the user did not intend (they pressed "Save policy"), and the API returns `{ ok: true, policy: null }` with no indication the policy was dropped.
- **Root cause**: The route collapses two distinct outcomes — an explicit reset (`policy: null` from the body) and a save that sanitized down to nothing — into the same `stored == null` branch, then labels the audit by the result rather than the intent.
- **Impact**: Misleading audit log (an unintended "cleared" entry) and silent success-theater: the user believes they saved a gate that is actually disarmed back to the archetype default. Low frequency (requires an all-invalid policy) but it touches a compliance-relevant audit surface.
- **Fix sketch**: Distinguish intent from outcome: when `body.policy != null` but sanitization yields `null`, return a 400 ("No usable policy fields") rather than silently clearing, or record the audit `action` from the request intent (`body.policy == null ? "cleared" : "set"`) and include a `sanitizedToDefault: true` flag in the response so the UI can warn.
