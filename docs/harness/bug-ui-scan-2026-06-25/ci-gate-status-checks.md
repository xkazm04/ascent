# CI Gate & Status Checks — Bug + UI Scan
> Context: CI Gate & Status Checks (Repository Scanning & Scoring)
> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. Default (mock) gate path bypasses rate limiting → unauthenticated GitHub cost amplification
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure / resource-exhaustion
- **File**: src/app/api/gate/[owner]/[repo]/route.ts:36-64
- **Value**: impact 7 · effort 3 · risk 3
- **Scenario**: An anonymous client hammers `GET /api/gate/owner/repo?ref=main` (or any `?ref=<sha>`) in a loop. `mock` defaults to `true`, and the rate limiter only fires on `!mock` (line 36-39). The `ref` branch (line 42-45) calls `scanRepository(..., { mock, ref })` with **no cache and no throttle**, and `mock` only swaps the *LLM provider* — the full GitHub repo ingest (source/governance/pulls fetches) runs every single request. Even the non-ref mock path calls `resolveHeadWithHint` (a GitHub request) on every hit before consulting the cache.
- **Root cause**: The rate-limit comment assumes "default mock gating is cheap/deterministic" and equates mock with zero cost. But mock only disables the LLM; GitHub network I/O against the shared `GITHUB_TOKEN` is unconditional.
- **Impact**: Unauthenticated request flood can exhaust the operator's GitHub REST quota / trip secondary rate limits / get the server PAT throttled fleet-wide, and amplify outbound load — a denial-of-wallet/DoS on the public CI endpoint.
- **Fix sketch**: Apply a lightweight per-IP/global rate limit to ALL requests (cheaper budget for mock, stricter for `!mock`), and add a short-TTL cache/coalescing for the `ref` path keyed by `(owner,repo,ref)` so repeated identical refs don't re-ingest.

## 2. Public gate endpoint ignores the persisted org gate policy (configured bar silently not enforced)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure / state-divergence
- **File**: src/app/api/gate/[owner]/[repo]/route.ts:66
- **Value**: impact 7 · effort 4 · risk 3
- **Scenario**: An owner sets a strict policy in `GatePolicyEditor` (e.g. `minLevel L4`, security floor D9≥70), persisted via `setOrgGatePolicy`. They then wire the documented `curl --fail /api/gate/owner/repo` into CI. This route builds its policy **only** from `policyFromParams` (query params + archetype default) and never calls `getOrgGatePolicy` — so the configured bar is silently ignored and the gate enforces archetype defaults instead. The App-mode Check Run (which *does* resolve the org policy) and this endpoint can therefore disagree on pass/fail for the same repo.
- **Root cause**: Two enforcement surfaces with two policy sources; the org-policy plumbing (org-gate.ts:13) was wired to the App check + fleet view but never to the HTTP gate endpoint.
- **Impact**: A team believes merges are blocked at their configured bar while CI quietly enforces a weaker one — the core promise of the feature (block below a threshold) is under-enforced.
- **Fix sketch**: In the route, resolve the org's installation/slug and fall back to `getOrgGatePolicy(owner)` when no explicit policy query params are supplied (query params override; else org policy; else archetype default). Document the precedence.

## 3. Sticky-comment upsert stacks duplicates on long PR threads (inverted "newest early" assumption)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/lib/github/checks.ts:65-101
- **Value**: impact 5 · effort 3 · risk 2
- **Scenario**: `upsertStickyComment` scans only the first `MAX_PAGES = 5` pages (500 comments) to find the bot's prior marker, with the comment "newest activity is usually early." The GitHub issue-comments API returns comments **oldest-first** with no sort override. The first gate run on a PR that already has >500 comments appends the sticky comment past page 5; every subsequent run scans pages 1-5, fails to find it, and POSTs a brand-new comment — stacking a duplicate gate comment on each push.
- **Root cause**: Bounded forward scan paired with an incorrect ordering assumption; the search direction can't reach a sticky comment that lives on a late page.
- **Impact**: On busy PRs the gate spams duplicate comments instead of updating in place — the exact stacking the function exists to prevent.
- **Fix sketch**: Fetch with `sort=created&direction=desc` (newest first) so a recently-created sticky comment is found within the page budget, or persist the comment id keyed by PR so lookup is O(1) and page-independent.

## 4. GatePolicyEditor shows "Policy saved — the gate now enforces it" even when the server drops the policy
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: silent-failure / success-theater
- **File**: src/components/org/GatePolicyEditor.tsx:32-45,57-59
- **Value**: impact 5 · effort 4 · risk 2
- **Scenario**: `buildPolicy` sends raw `Number(minOverall)`/`Number(minDimension)` with no validation. If a user enters `0` (or an out-of-range/garbage value), the server's `sanitizeGatePolicy` drops those keys (a `<=0` floor → not set; `>100` → rejected) and an all-invalid object sanitizes to `null`, which **clears** the policy to the archetype default. The editor ignores the returned `stored` policy and unconditionally shows "Policy saved — the gate now enforces it." So a user who typed `min overall = 0` is told a bar is enforced when it was actually reset to default.
- **Root cause**: The success copy is hardcoded to the request, not the server's echoed result; the form does no client-side validation mirroring the server's drop rules.
- **Impact**: Owners trust a stricter gate is live than what is stored — false confidence in merge protection. Inputs >100 (e.g. min overall 150) are accepted by the form yet produce a different outcome than the server applies, with no feedback.
- **Fix sketch**: Drive the success message and the form state from the POST response (`{ policy: stored }`) — e.g. "Reset to archetype default" when `stored == null` and reflect the actual stored values; add `min/max` validation feedback before submit.

## 5. policyFromParams accepts unclamped/fractional floors, inconsistent with sanitizeGatePolicy
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case / consistency
- **File**: src/lib/scoring/gate.ts:280-301
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: `policyFromParams` only guards `> 0` for `min_overall`/`min_dimension`/`min_security`; it never clamps to `<= 100` nor truncates to int (unlike `sanitizeGatePolicy`'s `clampScore`, gate.ts:99-101). `?min_overall=150` or `?min_security=999` installs an unreachable floor (max score is 100) so the gate **always fails**, and `?min_dimension=39.9` compares a fractional floor against integer scores.
- **Root cause**: The query-param path and the DB-sanitize path implement different validation contracts for the same numeric floors.
- **Impact**: A typo in a CI gate URL silently turns the gate into an always-fail wall (every PR blocked) with no error; minor cross-path inconsistency. Self-inflicted (user's own URL), hence low.
- **Fix sketch**: Reuse the same clamp helper (finite, `0 < n <= 100`, `Math.trunc`) for `min_overall`/`min_dimension`/`min_security` so both entry points share one numeric contract; on out-of-range, fall back to the archetype default rather than installing an impossible floor.
