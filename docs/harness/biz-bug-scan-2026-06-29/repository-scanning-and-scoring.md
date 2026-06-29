# Biz+Bug Scan — Repository Scanning & Scoring — ascent — 2026-06-29

> Combined business-visionary + bug-hunter scan over 4 contexts.
> Total: 20 findings — Critical: 0, High: 6, Medium: 11, Low: 3  (bug: 12, business: 8)

---

## CI Gate & Status Checks

### 1. `/api/gate` mock path is unauthenticated AND unthrottled — GitHub-quota / compute DoS
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: trust-boundary / resource-exhaustion
- **File**: src/app/api/gate/[owner]/[repo]/route.ts:36-45
- **Scenario**: The rate limiter only runs on the LLM path (`if (!mock) { rateLimitRequest… }`). The default (`mock=true`) gate still calls `scanRepository`, which fetches the repo tree + files from GitHub. Passing `?ref=<unique>` bypasses the cache (line 42-45 re-scans the ref directly every call). An attacker loops `/api/gate/<owner>/<repo>?ref=<rand>` (or enumerates owner/repo pairs) with zero auth and no throttle.
- **Root cause / Rationale**: The comment assumes "mock is cheap"; it is cheap on *LLM* but each call still spends a unit of the shared `GITHUB_TOKEN` REST budget (5000/hr) and CPU for analysis. `?ref=` makes it uncached → unbounded.
- **Impact**: Exhausts the server's GitHub rate limit (degrading every legitimate scan to 403/429) and burns serverless compute — an availability + cost amplification with no account required.
- **Fix sketch**: Apply `rateLimitRequest(req, SCAN_RATE_LIMIT)` to the mock path too (a cheaper per-IP bucket), and cap/aggressively-cache `?ref=` (it is the cache-bypass lever); optionally require the GitHub App installation for `?ref=` gating.

### 2. Sticky PR comment dedup scans the OLDEST pages — stacks duplicates on busy PRs
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / ordering
- **File**: src/lib/github/checks.ts:65-79
- **Scenario**: `upsertStickyComment` pages `?page=1..5` of `/issues/{n}/comments` with no `direction=` param. GitHub returns issue comments **oldest-first** by default. On a PR with >500 comments, the bot's own (recently created) sticky comment lives on the *last* page, never scanned — so each gate run fails to find it and `POST`s a new comment.
- **Root cause / Rationale**: The inline comment claims "newest activity is usually early" — true for the events feed, false for this endpoint's default ascending sort. The marker match works; the page window is just looking at the wrong end.
- **Impact**: The "sticky, updated-in-place" guarantee silently breaks on active PRs, spamming a fresh Ascent comment every push — the exact noise the design avoids.
- **Fix sketch**: Request `…&sort=created&direction=desc` and scan newest-first (or query the bot's comments directly), so the most recent marker comment is always found within the page bound.

### 3. The documented CI gate endpoint never honors the saved org gate policy
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / success-theater
- **File**: src/app/api/gate/[owner]/[repo]/route.ts:66 (vs src/lib/db/org-gate.ts:13)
- **Scenario**: An owner sets a strict policy in `GatePolicyEditor` ("Policy saved — the gate now enforces it"). The public `/api/gate` endpoint — the one the README badge and `curl --fail` CI snippet hit — builds its policy purely from `policyFromParams(searchParams, report.archetype)`, which falls back to the **archetype default**. `getOrgGatePolicy()` is only consulted by the App-mode Check Run, never here.
- **Root cause / Rationale**: The endpoint is anonymous/org-less, so it can't resolve the org; nobody bridged the saved policy to the param-driven path.
- **Impact**: A team that configured a security floor (e.g. D9≥70) and wires the `/api/gate` CI call silently runs at archetype defaults — under-enforcing the bar they believe is active. The editor's success copy overstates reality.
- **Fix sketch**: Accept an org-scoped, signed gate token (or `?org=` + an installation/API key) that resolves the persisted policy server-side; otherwise the editor should say the policy applies to the **App Check Run only**.

### 4. Org gate-pass-rate trend dashboard — retention + upsell surface
- **Severity**: High
- **Lens**: business-visionary
- **Category**: retention / monetization
- **File**: src/lib/scoring/gate.ts:245 (evaluateGateLite already computes fleet verdicts)
- **Scenario**: The platform computes a gate verdict per commit/repo but exposes no *historical* "gate pass-rate over time / which repos regressed past the bar" view. SonarCloud's Quality Gate trend is a primary daily-return hook teams pay for.
- **Root cause / Rationale**: `evaluateGateLite` + the persisted scans already hold everything needed; the trend is just unbuilt. A pass-rate line is the metric a platform/eng-lead checks weekly.
- **Impact**: Adds a recurring-engagement reason (vs one-shot scans) and a natural Team/Enterprise gate ("policy history & trends"), lifting retention and ARPU.
- **Fix sketch**: Persist each gate verdict, render an org "Gate health" panel (pass-rate sparkline + offenders list) reusing `evaluateGateLite`; gate the historical window length by plan tier.

### 5. The PR comment is a per-contributor viral impression — and the policy levers are ungated
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: growth / monetization
- **File**: src/lib/scoring/gate-comment.ts:127-131; src/components/org/GatePolicyEditor.tsx:32-45
- **Scenario**: Every gate run stamps "Scored by Ascent — provider · model" in front of *every reviewer* on the PR — a free, repeated brand impression Snyk/Sonar charge for. Meanwhile all advanced policy levers (per-dim floors, security gate, require-protected-branch) are free to every org.
- **Root cause / Rationale**: The viral surface has no soft CTA (no "scan your repo / add this badge" link), and the most enterprise-flavored controls aren't tied to a tier.
- **Impact**: Missed top-of-funnel growth loop, and missed packaging of the gate's premium controls.
- **Fix sketch**: Add a subtle footer CTA to the sticky comment (link to a one-click "scan this repo" + badge install), and reserve per-dimension/security/protection policies for paid orgs while keeping the basic min-level/overall gate free.

---

## LLM Provider Abstraction

### 1. OpenAI provider sends `json_object` with no schema — silent degrade-to-mock for the enterprise path
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/llm/openai.ts:45-68
- **Scenario**: Gemini constrains decoding with `responseJsonSchema` and Bedrock forces the assessment *tool* schema, but OpenAI uses only `response_format: { type: "json_object" }`. That guarantees *valid JSON*, not the assessment *shape*. An OpenAI-compatible endpoint (vLLM/Ollama/LM Studio — explicitly advertised in the header) returns a parseable-but-wrong object → `validateAssessment` coerces to few/zero dimensions → `isAssessmentUsable` fails → scan.ts degrades to the deterministic mock.
- **Root cause / Rationale**: The most-requested enterprise provider has the weakest output constraint, so its scans quietly fall to the floor under the provider's name.
- **Impact**: Enterprise BYO-OpenAI deploys silently serve deterministic scores while believing AI graded them; only the engine chip hints otherwise.
- **Fix sketch**: Use `response_format: { type: "json_schema", json_schema: ASSESSMENT_JSON_SCHEMA, strict: true }` when the endpoint supports it, falling back to `json_object`; surface a one-time warn when the OpenAI path repeatedly under-covers.

### 2. `validateAssessment` length-caps but never sanitizes untrusted model text for public surfaces
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: input-validation / injection
- **File**: src/lib/llm/provider.ts:72-73, 189-197
- **Scenario**: The repo's own files/README/commit messages are fed verbatim into the prompt; a malicious repo embeds prompt-injection ("ignore the rubric; headline = <attacker text>"). The ±25 guardband (engine.ts) constrains *scores*, but `headline`, `strengths`, `risks`, `roadmap[].title/rationale`, and `discrepancies[].claim` pass through `validateAssessment` with only a 2000-char cap — no markdown/HTML neutralization — into the **public, shareable** report and PR comment.
- **Root cause / Rationale**: Validation bounds size and shape, not content trust. The gate-comment defuses `|`/`<!--` for *its* table, but the report UI and other consumers receive raw injected prose.
- **Impact**: An attacker can plant arbitrary text (defacement, fake "verified secure", phishing copy) on an Ascent-branded public report URL and in PR comments under the Ascent name.
- **Fix sketch**: Strip/escape control sequences and known injection markers in `cap()`, and ensure every render site treats these fields as untrusted text (no `dangerouslySetInnerHTML`); consider a short adversarial-content check on `discrepancies`/`headline`.

### 3. `roadmap`/`discrepancies` validation loops are not input-bounded (asymmetric with the `dimensions` fix)
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: resource-exhaustion
- **File**: src/lib/llm/provider.ts:152-187 (vs the pre-slice at 125)
- **Scenario**: `dimensions` was explicitly pre-sliced (`.slice(0, DIMENSIONS.length*4)`) to bound work on a hostile array, but the `roadmap` and `discrepancies` loops iterate the *entire* model-supplied array, only trailing-slicing the output. The fast path `JSON.parse(text.trim())` (json.ts:80) has no size cap, so a large-but-valid JSON reply (plausible from a self-hosted endpoint) forces `cap()/asStringArray` over every element before the final `slice(0,6)/slice(0,8)`.
- **Root cause / Rationale**: The documented dimensions hardening wasn't applied to the sibling arrays.
- **Impact**: CPU/allocation spike on an adversarial/verbose reply; bounded in practice by provider `maxTokens` but unbounded for BYOM/self-hosted.
- **Fix sketch**: Pre-slice both inputs (`(obj.roadmap as []).slice(0, 24)` etc.) before the loop, matching the dimensions pattern.

### 4. BYOM + true multi-provider is a built, unmonetized enterprise moat
- **Severity**: High
- **Lens**: business-visionary
- **Category**: differentiation / monetization
- **File**: src/lib/llm/index.ts:185-201; src/lib/llm/bedrock.ts:29-66; src/lib/llm/openai.ts
- **Scenario**: Ascent already runs scans on the customer's *own* Bedrock account (code never leaves their AWS boundary) and against any OpenAI-compatible endpoint (incl. self-hosted vLLM/Ollama). Snyk/SonarCloud/CodeClimate force their model — a hard blocker for privacy-sensitive enterprises.
- **Root cause / Rationale**: The capability exists (`getProviderForOrg`, `BedrockProvider` credentials) but is the kind of thing that justifies an Enterprise tier and lands security-review deals.
- **Impact**: A concrete, defensible enterprise sales wedge ("scan with your model, in your cloud, no training on your code") and a premium price point.
- **Fix sketch**: Package "Bring Your Own Model / in-your-cloud inference" as the Enterprise headline, with the SOC-2/no-training story front-and-center on pricing; the PrivacyNotice copy already exists to anchor it.

### 5. Per-model price table + token metering → cost transparency as a monetization lever
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/lib/llm/config.ts:80-96, 113-122
- **Scenario**: The app already prices each scan per-model and meters cache-aware input tokens, but this is internal. Buyers comparing tools want "what does a scan cost / what's our fleet spend."
- **Root cause / Rationale**: The data is computed for `/usage` but not turned into a value-add (cost dashboards, budget alerts) or a margin lever on platform-credit scans.
- **Impact**: Enables a "fleet inference spend" panel (enterprise value) and clean credit-margin tuning; differentiates on transparency.
- **Fix sketch**: Surface a per-org cost rollup using `priceForModel` + `billableInputTokens`, add budget/anomaly alerts, and let BYOM orgs see "you saved $X by using your own model" as an upsell narrative.

---

## Maturity Model & Scoring Engine

### 1. `projectSandbox` drops the present-dimension predicate — baseline diverges from the report
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption / consistency
- **File**: src/lib/scoring/engine.ts:312-313 (vs assembleReport 176-177)
- **Scenario**: `assembleReport` computes axes with `axisScore(…, (id) => present.has(id))` so a dropped dimension (failed detector) is excluded from both numerator and weight denominator. `projectSandbox` calls `axisScore("adoption", scoreFor, report.archetype)` with **no** `isPresent` predicate — so a dropped dim is charged at 0 with full weight. With empty overrides the sandbox's adoption/rigor/posture then differ from the report's stored values.
- **Root cause / Rationale**: The documented "maturity-model-scoring-engine #1" fix was applied to `assembleReport` but missed in `projectSandbox`. `scoreFor` returns `?? 0` for absent dims, which the predicate is meant to exclude.
- **Impact**: The interactive Roadmap Sandbox's baseline ("empty overrides = the report's own numbers, byte-for-byte" per its docstring) breaks on any partial scan, and the posture quadrant can flip vs the report hero — eroding trust in the simulator.
- **Fix sketch**: Pass `(id) => report.dimensions.some((d) => d.id === id)` to both `axisScore` calls in `projectSandbox`, mirroring `assembleReport`.

### 2. A totally-failed scan (0 scorable dimensions) is published as a genuine L1 on warning-blind surfaces
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/scoring/engine.ts:153-165, 174-177
- **Scenario**: When every detector fails/returns nothing, `dimensions` is empty, `overallScoreFor` returns 0, level = L1, axes = 0, posture = "early". A warning is pushed — but the badge, the gate verdict, and the fleet rollup consume `overallScore`/`level`/dimension scores, **not** `warnings`.
- **Root cause / Rationale**: The incomplete state is encoded only in prose; numeric consumers can't distinguish "couldn't scan" from "genuine Manual repo."
- **Impact**: A repo that merely couldn't be ingested shows a confident public "L1 Manual" badge and is gate-evaluated against bogus zeros — a misrepresentation on exactly the public/shareable surfaces.
- **Fix sketch**: Carry an explicit `incomplete: true` flag on the report when `dimensions.length === 0` (or coverage≈0), and have the badge/gate/rollup render "Unscored / re-scan needed" instead of L1.

### 3. `cheapestPathToNextLevel` can list a 0-gain step for a lens-zero-weight dimension
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/lib/scoring/engine.ts:355-368
- **Scenario**: Candidates are ranked by `d.weight * (100 - d.score)` where `d.weight = lensW[id] ?? def.weight` (nonzero), but the projection (`overallScoreFor`) weights a lens-missing id at `?? 0`. A dimension that carries display weight but zero projection weight can be ranked first and pushed as a step whose `gain` is 0.
- **Root cause / Rationale**: Ranking weight and projection weight come from two different fallbacks (`def.weight` vs `0`).
- **Impact**: The "how to level up" path can show a meaningless first step (e.g. "improve D7" → +0 pts), undermining the motivating ROI framing. Reachability stays correct (the ceiling guard at 346 protects it).
- **Fix sketch**: Rank by the same lens weight the projection uses (`lensW[id] ?? 0`), and skip pushing a step whose computed `gain` is 0.

### 4. The what-if simulator + glass-box attribution is a premium "Improvement Planner"
- **Severity**: High
- **Lens**: business-visionary
- **Category**: differentiation / monetization
- **File**: src/lib/scoring/engine.ts:218-321 (projectScore/projectSandbox/cheapestPathToNextLevel/contributions)
- **Scenario**: Ascent can already compute "raise D2→100 = +N pts, unlocks L4", a live slider sandbox, and a per-dimension contribution waterfall. Competitors mostly hand back a static grade; "how do we *get better* and what's it worth" is the question buyers actually have.
- **Root cause / Rationale**: This is built but reads as a report widget rather than a headline value prop / saved plan.
- **Impact**: A shareable "Path to L4" plan (assignable, trackable across re-scans) is a strong differentiator, a re-engagement loop, and a clean Team/Enterprise feature.
- **Fix sketch**: Promote the simulator to a first-class "Improvement Plan" object (persist target, diff progress on each scan, notify on movement via scan-alerts); free shows the path, paid tracks/assigns it.

### 5. Archetype-aware fair grading is an under-marketed trust differentiator
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: differentiation
- **File**: src/lib/maturity/model.ts:232-254
- **Scenario**: Solo/team/org lenses re-weight dimensions so a single-author repo isn't dragged to L1 for lacking org-scale CI. One-size scorers (CodeClimate/Sonar) routinely feel "unfair" to small teams — a common churn reason.
- **Root cause / Rationale**: The lens is applied silently; users don't know *why* their score is fair, and orgs can't tune it.
- **Impact**: "Graded the way your repo is actually run" is a credibility message that wins trust; an owner-tunable lens is a paid customization.
- **Fix sketch**: Explain the active lens in-report (the `ARCHETYPE_HINT` copy exists), and let orgs override/lock the lens fleet-wide as a Team/Enterprise setting reusing `weightsFor`.

---

## Scan Pipeline & Ingestion

### 1. "Email me when it's done" is an open relay — Ascent-branded mail to arbitrary recipients
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: trust-boundary / abuse
- **File**: src/app/api/scan/stream/route.ts:81-83, 197-201; src/lib/email/index.ts:29-33
- **Scenario**: `notifyTo = body.notify ? viewer?.email ?? (isValidEmail(body.email) ? body.email.trim() : undefined)`. When the signed-in account has no email (GitHub hides it), the **client-supplied** `body.email` is used with no proof of ownership/consent. If `authGateEnabled()` is false (Supabase unconfigured), `viewer` is null and *any* caller can set the recipient. A completed scan then sends a branded "Your Ascent scan is ready" email via the verified SES domain to that address.
- **Root cause / Rationale**: The recipient is trusted from the request body; `NotifyToggle` only *shows* the custom field to email-less signed-in users, but the API doesn't enforce that — and a direct API call ignores the UI.
- **Impact**: Spam/phishing amplification through Ascent's SES identity (unsolicited mail with a report link), damaging sender reputation and deliverability; per-scan rate limits bound volume but not the abuse pattern.
- **Fix sketch**: Only send to the *verified account email*; drop the arbitrary-custom-address fallback (or require a one-time verify/confirm step before it's usable), and gate the whole notify path on an authenticated viewer regardless of `authGateEnabled()`.

### 2. Client-controlled `headSha` pins ingestion and persists an arbitrary commit
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: input-validation / cache-shaping
- **File**: src/app/api/scan/stream/route.ts:129-133; src/lib/scan.ts:165-167
- **Scenario**: The stream route accepts `body.headSha` (peek→stream handoff optimization) and feeds it as `lookup.headSha`, which scan.ts uses as `pinnedRef = opts.ref ?? opts.headSha` to ingest *that* commit and stamp it as the report's identity. A caller can pass any valid historical/cherry-picked SHA; the scored report is persisted under it.
- **Root cause / Rationale**: The handoff is "trusted only as an optimization" for keys, but it also drives *which commit gets scored and saved*, not just the cache key.
- **Impact**: The any-commit salvage (`getScanReportByCommit(owner, repo, {})`, used on quota walls and error fallback in route.ts:96, 207) can later serve that attacker-chosen, flattering commit as the repo's "most recent" public report (flagged `x-ascent-stale`, but still shown).
- **Fix sketch**: Ignore client `headSha` for ingestion — re-resolve the real head server-side (or verify the supplied SHA is the current head before pinning); only reuse it as a cache-key hint, never as the scored ref.

### 3. Opt-in "email me" silently no-ops on a cache hit
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure / UX
- **File**: src/app/api/scan/stream/route.ts:134-146 (early return) vs 197-201
- **Scenario**: A user checks "email me when it's done" expecting to close the tab. If the scan resolves from cache, the stream sends the `result` frame and `return`s before ever reaching the notify block — no email is sent.
- **Root cause / Rationale**: The notify dispatch lives only on the fresh-scan tail; the cached-hit branch returns early.
- **Impact**: A user who deliberately walked away gets no email even though a valid report exists — a broken promise on the exact "I don't want to wait" flow. (Related: `parseSSE` in src/lib/sse.ts:16-19 concatenates multi-line `data:` without re-inserting `\n`, a latent corruption risk if any frame ever spans lines.)
- **Fix sketch**: Send the completion email on the cached-hit path too (it already has the report + permalink), or document that cache hits are instant and intentionally skip mail.

### 4. The completion email is a wasted re-engagement / virality engine
- **Severity**: High
- **Lens**: business-visionary
- **Category**: retention / growth
- **File**: src/lib/email/index.ts:37-74; src/components/scan/NotifyToggle.tsx
- **Scenario**: The scan-completion email (and the smart signed-out "sign in to get emailed" nudge) is prime real estate, but the body is just score + link — no "scan another repo", no "share your badge", no "watch this repo / alert me on regression" upsell tied to the existing scan-alerts system.
- **Root cause / Rationale**: The plumbing is new; the lifecycle/growth content isn't there yet.
- **Impact**: Misses the highest-intent moment (user just got value) to drive a second scan, a viral badge share, and a subscription to regression alerts.
- **Fix sketch**: Add CTAs to `buildScanCompletionEmail` — share badge/report (with OG image), "scan another repo", and "get alerted when this repo's score drops" (wire to scan-alerts.ts) as the paid hook.

### 5. Keyless zero-signup public scan is top-of-funnel — under-leveraged for viral growth
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: growth / activation
- **File**: src/app/api/scan/route.ts (anonymous public funnel); src/components/ScanForm.tsx
- **Scenario**: Anyone can scan a public repo with no account (mock keyless demo + free weekly quota) — excellent activation. But the public results aren't turned into a growth loop: no public leaderboard, no shareable OG-card report, no "how does your repo rank" hook that pulls maintainers in.
- **Root cause / Rationale**: The funnel optimizes for one scan, not for the maintainer-vanity / comparison loop that drives organic reach (OpenSSF Scorecard / "best repos" lists travel on social).
- **Impact**: Leaves the cheapest acquisition channel (maintainers sharing flattering scores / badges) on the table.
- **Fix sketch**: Ship a public "top AI-native repos" leaderboard + per-report OG image + a one-line "scan yours" CTA; let maintainers claim and badge their repo, turning every scan into a backlink.
