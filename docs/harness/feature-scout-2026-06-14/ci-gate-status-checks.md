# Feature Scout — CI Gate & Status Checks (ascent, 2026-06-14)
> Total: 5
> Severity: 1C / 2H / 2M / 0L

## 1. Persisted per-org / per-repo gate policy (the App Check ignores any configured bar)
- **Severity**: Critical
- **Category**: functionality
- **File**: src/app/api/app/webhook/route.ts:213, src/lib/org/governance.ts:74, prisma/schema.prisma:25
- **Scenario**: An org admin sets "we require L3 + Security (D9) ≥ 60 + no ungoverned posture" once, and every PR Check across the fleet enforces exactly that — without pasting flags into each repo's workflow.
- **Gap**: Policy can only be expressed *ad hoc* per request: query params on `/api/gate` (`policyFromParams`) or `action.yml` inputs. The **App-mode Check Run** — the status that actually blocks merge — calls bare `evaluateGate(headReport)` (route.ts:213) with NO policy, so it always uses archetype defaults and silently ignores any security/custom bar. `buildGovernanceOverview` likewise hardcodes `defaultGatePolicy("org")` (governance.ts:74). Grep confirms NO `gatePolicy`/`gate_policy` column on `Organization` or `Repository` and no settings UI — policy is never persisted anywhere.
- **Impact**: This is the core value prop of a "gate." Teams running Ascent as a GitHub App (the headline install path) cannot enforce their real bar on PRs; the auto-posted Check is cosmetic. Enterprise/security buyers expect policy-as-code, centrally owned.
- **Fix sketch**: Add `gatePolicy Json?` to `Organization` (and optional override on `Repository`); a `getOrgGatePolicy(orgSlug)` loader; have `runPrGate` and `buildGovernanceOverview` resolve persisted policy → `evaluateGate(report, policy)`; a small `/org/[slug]/governance` editor form posting the policy. ~1 focused session (migration + 2 call-sites + minimal form).

## 2. No "rescan" / re-run action on the Check Run (rerequested events dropped)
- **Severity**: High
- **Category**: feature
- **File**: src/lib/github/checks.ts:22, src/app/api/app/webhook/route.ts:59
- **Scenario**: A PR fails the gate, the author pushes a fix to an external file Ascent can't see instantly, or a transient scan error posted a stale verdict. They click "Re-run" on the Check in the GitHub UI to get a fresh score — without pushing an empty commit.
- **Gap**: `createCheckRun` posts a single `status: "completed"` run with no `actions:` buttons, and the webhook's `PR_ACTIONS` set (route.ts:59) handles only `opened/synchronize/reopened/ready_for_review`. Grep confirms NO handling of `check_run` `rerequested` / `requested_action` events anywhere. The only way to refresh a verdict is a new push (which re-burns a scan) — there's no manual re-evaluate.
- **Impact**: Standard expectation for any CI check (every linter/test integration offers re-run). Removes friction when a verdict is stale or a flaky scan posted, and avoids junk "rerun" commits. Power-user productivity for every gated PR.
- **Fix sketch**: Add `actions: [{ label: "Re-run", identifier: "rescan", ... }]` to `createCheckRun` output; add a `check_run` branch to the webhook that, on `rerequested`/`requested_action`, resolves the PR head from the run and calls `runPrGate`. ~half session.

## 3. Scan failure leaves the required Check missing instead of a `neutral` "couldn't evaluate"
- **Severity**: High
- **Category**: functionality
- **File**: src/app/api/app/webhook/route.ts:240, src/lib/scoring/gate-comment.ts:56
- **Scenario**: Ascent's scan throws (GitHub rate-limit, both head AND default-branch refs unreachable, LLM outage). The maintainer has set the Ascent check as a **required status**; they need to see "gate couldn't run — re-run or override" rather than a PR that hangs forever with no check.
- **Gap**: `runPrGate`'s catch (route.ts:240) only logs and posts nothing on a hard failure — no Check Run is created. `buildGateComment` only ever returns `conclusion: "success" | "failure"` (gate-comment.ts:56); the `neutral` value declared in `CheckRunInput` (checks.ts:14) is never produced. So a failed evaluation = silently absent check = a *required* gate blocks merge indefinitely with no explanation and no recourse.
- **Impact**: Makes the gate unsafe to mark "required" — the very configuration that gives it teeth. A `neutral` check with a clear message (and the re-run action from #2) keeps the merge unblocked-by-error while still surfacing the problem. Affects every org that takes the gate seriously.
- **Fix sketch**: In `runPrGate`'s catch, post a `createCheckRun({ conclusion: "neutral", title: "Maturity gate could not run", summary: <reason> })`; optionally a `buildGateComment` "neutral" branch. ~half session.

## 4. Check Run carries no per-dimension annotations / actionable detail beyond the summary
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/lib/github/checks.ts:32, src/lib/scoring/gate-comment.ts:78
- **Scenario**: A PR fails on "D9 Security scored 38, below 60." The developer wants to click straight from the Check to *which* signals dragged the dimension down (missing Dependabot, no CODEOWNERS) — not re-open the full report and hunt.
- **Gap**: `createCheckRun` sends only `output: { title, summary }` (checks.ts:32) — no `output.annotations` and no breakdown of the failing dimensions' contributing signals. `buildGateComment` surfaces top-3 roadmap items as prose (gate-comment.ts:78) but nothing structured/linked. Grep confirms `annotations` is never used in `checks.ts`.
- **Impact**: Turns a pass/fail into a teaching moment at the exact point of work, shortening the loop from "blocked" to "fixed." Differentiates from a dumb threshold gate. Benefits every developer who hits a failing gate.
- **Fix sketch**: Extend the failing-gate summary in `buildGateComment` with a per-failing-dimension signal table (data already on `report.dimensions`/roadmap), and optionally a few `output.annotations` for config-file gaps (e.g. annotate `.github/dependabot.yml` absence). ~1 session.

## 5. No status-badge for the gate verdict (only the maturity badge exists)
- **Severity**: Medium
- **Category**: feature
- **File**: src/app/api/badge/[owner]/[repo]/route.ts, src/app/api/gate/[owner]/[repo]/route.ts:62
- **Scenario**: A maintainer wants a README shield that reads "ascent gate: passing / failing" against their *policy* — the same green/red CI teams paste from Codecov, build, and coverage services — so the gate result is visible without opening a PR.
- **Gap**: The `/api/badge` route renders a *maturity level* badge; the gate endpoint (`/api/gate`) returns only JSON (200/422) and has no SVG/shields rendering. Grep shows no gate-verdict badge variant — `policyFromParams` is read by `badge` and `gate` routes but the badge surfaces the level/score, not the policy pass/fail. A README "gate: passing" shield is a natural, expected complement that doesn't exist.
- **Impact**: Public, always-on social proof of the gate (a growth/marketing surface) and a quick at-a-glance status for maintainers. Low-effort visibility multiplier that rides existing scoring + policy parsing.
- **Fix sketch**: Add `?gate=1` to the badge route (or a `/api/gate-badge/...` variant) that runs `evaluateGate` with `policyFromParams` and renders a green "passing" / red "failing" shield reusing the existing SVG builder. ~half session.
