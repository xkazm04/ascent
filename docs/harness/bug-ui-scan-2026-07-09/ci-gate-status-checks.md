# CI Gate & Status Checks — bug-hunter + ui-perfectionist scan

> Context: CI Gate & Status Checks (group: Repository Scanning & Scoring)
> Files scanned: 10
> Total: 7 findings (Critical: 0, High: 3, Medium: 3, Low: 1)

## 1. Public gate endpoint ingests with the operator PAT — anonymous private-repo score enumeration
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: auth-bypass
- **File**: src/app/api/gate/[owner]/[repo]/route.ts:68
- **Scenario**: An anonymous caller hits `GET /api/gate/acme/secret-private-repo`. The route has NO auth check and calls `scanRepository(\`${ownerN}/${repoN}\`, { mock, ref })` (also line 89) WITHOUT `noAmbientToken: true`. So `scanRepository` falls back to `process.env.GITHUB_TOKEN` (scan.ts:163) — an operator PAT the codebase itself documents as "commonly carries private `repo` scope" (org/import/route.ts:121). The caller receives that private repo's `pass`, `level`, `overallScore`, `posture`, and detailed `failures`.
- **Root cause**: The badge (badge/route.ts:319) and import (import/route.ts:130) routes both set `noAmbientToken: true` on anonymous surfaces to prevent exactly this; the gate route was missed, so its public path ingests private repos with the operator token.
- **Impact**: Security — anonymous confirmation of private-repo existence + full maturity/gate profile for any repo the operator PAT can read.
- **Fix sketch**: Pass `noAmbientToken: true` to both `scanRepository` calls (a private repo then 404s → clean error), matching the badge/import discipline; add a route test asserting `opts.noAmbientToken === true`.

## 2. Degraded / fallback scan returns a confident JSON verdict — no honesty flag any CI consumer can read
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/app/api/gate/[owner]/[repo]/route.ts:106
- **Scenario**: CI calls `/api/gate/owner/repo?mock=0` to get an AI-graded verdict. The LLM times out; `scanRepository` degrades to the deterministic MockProvider and appends `report.warnings` ("AI analysis was unavailable…", scan.ts:486). `evaluateGate` (gate.ts:209) reads only scores — never `report.warnings`/`confidence`/`engine` — and the JSON response returns `{ pass, level, overallScore, posture, archetype, policy, failures }`. `warnings`/`engine` are omitted entirely, so `curl --fail` sees a clean `200 PASS` indistinguishable from a real AI-graded pass.
- **Root cause**: The honesty flags exist on `ScanReport` (`warnings`, `confidence`, engine=`mock`) but the gate verdict and its JSON surface read none of them — the PR-comment path flags mock (gate-comment.ts:126) but the machine-readable CI path does not.
- **Impact**: Success theater — a team gates merges on a deterministic-rubric or degraded verdict believing it is the full AI grade.
- **Fix sketch**: Include `engine.provider`, `warnings`, and `confidence` in the JSON body; optionally add a `degraded: boolean` and let CI branch on it (or fail closed on degraded when `?mock=0` was requested but fell back).

## 3. createCheckRun is a single un-retried POST — a transient GitHub error leaves a required check permanently pending
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: missing-retry
- **File**: src/lib/github/checks.ts:32
- **Scenario**: A PR fires the gate; `createCheckRun` does one `githubAppFetch` POST (no retry — app.ts:94 throws on any non-2xx). GitHub returns a transient 429/502. The only caller `await`s it with an inline `.catch(console.error)` (webhook/route.ts:266), so the throw is swallowed and never reaches the outer catch that would post the neutral "could not run" fallback (route.ts:277). If "Ascent maturity gate" is a *required* check, GitHub shows "Expected — waiting for status" and the PR is blocked with no check, no comment, no Re-run button, and no retry — until an unrelated new push happens to re-fire the webhook.
- **Root cause**: checks.ts has no internal retry/idempotency; it assumes the caller handles failure, but the caller swallows it inline, bypassing the neutral fallback.
- **Impact**: A finished PR is stuck un-mergeable; worst during a GitHub rate-limit window when it fires across many PRs at once.
- **Fix sketch**: Wrap the POST in bounded backoff for transient statuses (mirror auth.ts `withGithubRetry`); on final failure, rethrow so the caller's neutral-check path runs (or post the neutral check from within checks.ts).

## 4. upsertStickyComment read-then-write races on concurrent PR events → duplicate comments
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/lib/github/checks.ts:80
- **Scenario**: A PR is opened and a commit pushed immediately after (`opened` + `synchronize` — two distinct delivery ids, so webhook dedup does not merge them). Both `runPrGate` runs execute concurrently in `after()`. Each scans the comment thread (checks.ts:81-89), neither finds the marker (the first hasn't POSTed yet), so both fall through and POST (checks.ts:105) — two sticky comments. Every later run then finds+updates only the FIRST (checks.ts:86), orphaning the duplicate forever.
- **Root cause**: The upsert is an unsynchronized find-then-create with no idempotency key or lock, so two in-flight runs both miss the not-yet-created marker.
- **Impact**: The exact duplicate-stacking the upsert exists to prevent, on active PRs.
- **Fix sketch**: Serialize per (owner,repo,prNumber) with an in-process mutex, or re-list + re-check just before POST, or dedupe post-hoc by deleting all-but-first marker comment.

## 5. Gate-policy audit actor read from the dormant getSession() — null-actor audit rows
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/app/api/org/gate-policy/route.ts:39
- **Scenario**: An owner saves a gate policy. Authorization correctly uses the ACTIVE Supabase wall (`requireOrgRole(body.org, "owner")`, route.ts:31 → authz.ts:193 resolves via `getViewer()`). But the audit actor is read from the DORMANT legacy path: `const session = await getSession()` (route.ts:39) then `actorId: session?.login` (route.ts:44). Under the Supabase wall the custom-OAuth `getSession()` returns null (auth.ts:257 gates on `isAuthConfigured()`), so every `org.gate_policy` audit row records `actorId: undefined` → null.
- **Root cause**: Identity for the audit trail is sourced from the legacy session, not the active viewer that already passed the gate — a confirmed systemic pattern.
- **Impact**: The audit log for who changed the merge-blocking bar is anonymous; accountability lost exactly on a security-relevant change.
- **Fix sketch**: Resolve the actor from the active identity (`getViewer()`), e.g. `const viewer = await getViewer(); … actorId: viewer?.login ?? session?.login`.

## 6. GatePolicyEditor: client validation doesn't match server rules and there is no preview of what the policy blocks
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: validation-feedback
- **File**: src/components/org/GatePolicyEditor.tsx:39
- **Scenario**: The number inputs declare `min={0}` (lines 111/124/139) but the server drops any floor `<= 0` or `> 100` (sanitizeGatePolicy). Entering `0` or `150` passes client validation, then `buildPolicy` sends it and the server silently resets it to the archetype default. Worse: checking "Security floor (D9 ≥)" with value `0` builds `{ minDimensionFor: { D9: 0 }, forbidPostures: ["ungoverned"] }` (lines 37-42); the server drops `D9:0` but keeps the posture ban, so `d.policy` is non-null and the success copy says "Policy saved — the gate now enforces it" — while the security floor the owner set is gone. There is also no preview of the resulting gate (e.g. "fails any repo below L3 or any dimension < 40").
- **Root cause**: Client mirrors the server's *shape* but not its numeric contract (`> 0`, `<= 100`), and surfaces no summary of what the saved policy actually enforces.
- **Impact**: An owner believes a stricter bar is live when it was silently downgraded; no confidence the gate does what they intended.
- **Fix sketch**: Set `min={1}`, validate on change with inline errors matching sanitize rules; render a live "This gate will block: …" summary derived from `buildPolicy()`; disable Save while any field is out of range.

## 7. Corrupt stored gatePolicy silently downgrades to the archetype default with no log
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/db/org-gate.ts:14
- **Scenario**: An org configured a stricter-than-default policy (e.g. min overall 80, D9 ≥ 70). Its `gatePolicy` TEXT column becomes non-JSON (partial write, a legacy jsonb→text migration artifact, a manual DB edit). `parseStoredGatePolicy` catches and returns null with no log (org-gate.ts:18); `getOrgGatePolicy` returns null (line 30), so every consumer falls back to the WEAKER archetype default. It technically fails to a gate (not "no gate"), but silently relaxes the configured bar.
- **Root cause**: The parse failure is swallowed with no observability, so a corrupted stricter policy weakens the merge bar invisibly.
- **Impact**: A team's configured gate silently loosens with no alert; hard to notice until bad code merges.
- **Fix sketch**: `console.warn` on the parse failure with the org slug; consider surfacing a "policy unreadable" state to the editor rather than presenting the default as if configured.
