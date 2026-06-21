> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

# Practices, Governance & Adoption — combined bug+ui scan

## 1. `requireProtectedBranch` is advertised but never enforced on the fleet view (dashboard vs CI drift)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: gate-policy correctness / policy drift
- **File**: src/lib/org/governance.ts:127
- **Scenario**: An org owner enables "Default branch must be protected" in `GatePolicyEditor` (it sets `requireProtectedBranch: true`, persisted and read back by `buildGovernanceOverview`). The Governance tab then shows "Default branch must be protected" in the Active policy, emits `require_protection=1` in the gate URL, and `require-protection: 'true'` in the copyable CI snippet. But the fleet pass-rate, "Where the fleet fails", and "Cheapest path to green" treat every repo as clearing that condition.
- **Root cause**: `buildGovernanceOverview` calls `evaluateGateLite({ level: s.level, overall: s.overall, posture: s.posture, dims: s.dims }, policy)` — it never passes `protected`/`govReadable`. `OrgRepoRow.latest` (src/lib/db/org-rollup.ts:65) carries no branch-protection fields, so `evaluateGateLite`'s `requireProtectedBranch` branch (gate.ts:242, gated on `snap.govReadable && snap.protected === false`) can never fire. The module header at governance.ts:82-85 explicitly warns that gateQuery/ciWith must enforce exactly what policyText shows "otherwise the dashboard enforces a bar the copyable CI snippet / gate URL silently drops" — this is the inverse drift: the dashboard advertises and exports a bar it does not itself enforce. The CI snippet WILL fail repos the dashboard reports as passing.
- **Impact**: Silent under-enforcement + dashboard↔CI drift. A repo with an unprotected default branch counts toward the "X/Y repos PASS (Z%)" pass-rate and is omitted from the failing/closest-to-green worklists, yet the identical policy run in the customer's pipeline (or the App PR Check Run) blocks its merges. Leadership sees a green fleet number that the gate they copied contradicts.
- **Fix sketch**: Either (a) plumb per-repo `protected`/`govReadable` into `OrgRepoRow.latest` and pass them through to `evaluateGateLite`, then add a `governance` row to the page REASONS + markdown "Failing on" line; or (b) if the rollup genuinely can't carry protection yet, drop `requireProtectedBranch` from `policyText`/`gateQuery`/`ciWith` in the fleet view (or annotate it "enforced in CI only, not in this fleet rollup") so the dashboard stops advertising a bar it doesn't measure.

## 2. Batch rollout silently drops repos past the 25-cap — UI promises "N PRs", opens at most 25
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: silent failure / missing feedback
- **File**: src/components/org/PracticeApply.tsx:56
- **Scenario**: A practice has 40 gap repos. The user clicks "select all" (default), the button reads "Open draft PRs across 40 repos →", they click it. `/api/practices/apply-batch` caps the batch at `MAX_BATCH = 25` (apply-batch route:77) and returns `{ results, attempted: 25, skipped: 15 }`. The UI renders only the 25 result rows and never mentions the 15 that were dropped.
- **Root cause**: `applyBatch` reads only `data.results` and ignores `data.skipped`/`data.attempted`. The button label is driven by `selected.size`, not by what the server actually attempted, so it overstates the action.
- **Impact**: The user believes all 40 PRs were opened; 15 repos silently get nothing. They have no signal to re-run for the remainder, leaving part of the fleet un-seeded.
- **Fix sketch**: Read `skipped`/`attempted` from the response and, when `skipped > 0`, render a notice ("Opened/attempted 25 of 40 — re-run for the remaining 15; a batch is capped at 25"). Optionally disable/cap the selection client-side at 25 with the same explanation.

## 3. Batch apply gives a worse error than single apply for the common "file already exists" (409) case
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: error-handling consistency
- **File**: src/app/api/practices/apply-batch/route.ts:110
- **Scenario**: A repo already has the target file on its base branch (e.g. `SECURITY.md`). `openDraftPr` throws `AppApiError(409, …)` (write.ts:82). In single-apply, the route maps 409 to the precise hint "That file already exists in the repo — Ascent won't overwrite it with a starter. Edit the existing file instead." In batch, the per-repo catch only special-cases 403; the 409 falls into the `else` and becomes the generic "GitHub rejected the write."
- **Root cause**: The batch worker's error map (`err.status === 403 ? … : "GitHub rejected the write."`) omits the 409 (and 404) branches the single route handles.
- **Impact**: On a fleet rollout — where "file already exists" is the single most likely benign rejection — every such repo reports a vague "GitHub rejected the write." The user can't tell a real permission/API failure from an expected "already has it" skip, undermining trust in the batch result list.
- **Fix sketch**: Mirror the single route: in the batch catch, map `err.status === 409` to the "already exists — won't overwrite" message and `404` to a repo/branch-gone message, keeping 403 and the generic fallback.

## 4. "Below overall score" reason row always renders even when the policy sets no overall floor
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: consistency / misleading empty data
- **File**: src/app/org/[slug]/governance/page.tsx:16
- **Scenario**: The default org policy (`defaultGatePolicy("org")`) sets `minLevel`, `minDimension`, and `forbidPostures` but NO `minOverall`. The "Where the fleet fails" panel hardcodes a REASONS list that always includes "Below overall score", so it renders a permanently-empty (0 repos, gray) bar for a condition the active policy doesn't even contain.
- **Root cause**: The REASONS array is static and not derived from which conditions the active policy actually defines; `byReason.overall` is structurally 0 whenever `minOverall` is unset. (Note the Copy-for-LLM markdown already conditionally hides overall at governance.ts:200 — the page is inconsistent with the brief.)
- **Impact**: Cosmetic-but-confusing: the dashboard implies the gate checks an overall-score floor that isn't part of the policy, and the row never reflects reality. Mild erosion of trust in the panel's accuracy.
- **Fix sketch**: Render only the reason rows whose condition is present in the active policy (e.g. drop "overall" when `minOverall` is undefined), mirroring the markdown's conditional. Consider also surfacing the `governance` reason once finding #1 is addressed.

## 5. `apply()` doesn't clear prior single/batch result state, so stale success can linger after an error
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: stale UI state
- **File**: src/components/org/PracticeApply.tsx:99
- **Scenario**: User opens a draft PR for repo A (the green "Draft PR opened: <url>" line appears with `pr` set). They switch the select to repo B (which resets `pr` via onChange) — fine. But if they instead re-`preview()` then `apply()` and the second apply FAILS, `apply()` sets `error` but leaves the previously-set `pr` untouched only across the *first* path; more concretely, `applyBatch()` results and a prior single `pr` are never reset relative to each other, so the card can simultaneously show a stale success link and a new error, or a batch result list alongside a single-PR success from a different repo.
- **Root cause**: `apply()` clears `error` but not `pr` on entry, and the single vs batch flows don't reset each other's result state (`pr`, `batchResults`, `batchError`). Only the select `onChange` resets `pr`.
- **Impact**: A user can see a success affordance (clickable PR link) that no longer corresponds to the current action/repo, or mixed success+error states — leading them to click a PR link for the wrong repo or assume the failed action actually succeeded.
- **Fix sketch**: At the start of `apply()` set `setPr(null)` before the request; clear `batchResults`/`batchError` when starting a single apply (and vice-versa) so only the result for the current action is shown.
