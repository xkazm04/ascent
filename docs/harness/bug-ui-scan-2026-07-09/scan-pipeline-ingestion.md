# Scan Pipeline & Ingestion — bug-hunter + ui-perfectionist scan

> Context: Scan Pipeline & Ingestion (group: Repository Scanning & Scoring)
> Files scanned: 14
> Total: 7 findings (Critical: 0, High: 1, Medium: 2, Low: 4)

## Notes on the brief's priority items (verified, not findings)
- **Degradation honesty is genuinely handled.** When the LLM fails/is unusable, `scan.ts:411-413,486-498` sets `report.warnings` ("AI analysis was unavailable…" / "No AI model is configured…"); the engine adds a partial-coverage warning (`engine.ts:155-166`) and a total-failure warning (`engine.ts:171-176`); `ReportNotices.tsx:4-19` renders them in an amber "Heads up" panel; and both routes skip cache+persist on `degradedToMock` (`scan-finalize.ts:124-128`). A mock score is NOT persisted or served as real. No Critical here.
- **SSRF:** `parseRepoUrl` (`github/source.ts:98-107,126-128`) requires a `github.com` host and rejects `..`/leading-dot — `owner/repo` cannot be coerced to another host. Clean.
- **SSE multiline:** server `makeSseSend` (`sse-server.ts:31`) `JSON.stringify`s payloads (no literal `\n`); client `parseSSE` (`sse.ts:20-25`) accumulates multiple `data:` lines. Framing is correct.
- **Scoped file `src/components/landing/ScanGallery.tsx` does not exist** (the gallery is `IndexGallery.tsx`) and `src/app/page.tsx` does exist; UI findings target `ScanForm.tsx` + `IndexGallery.tsx`.

## 1. Scan cache key omits model, provider, and rubric version
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: cache-key-correctness
- **File**: src/lib/cache.ts:51
- **Scenario**: Operator upgrades the model (gemini-1.5→2.0), switches `LLM_PROVIDER`, or bumps the scoring rubric/weights. Every already-scored, unchanged repo keeps hitting the persisted (`getScanReportByCommit`) and in-memory caches under the identical key and serves the OLD score as the current scan — for up to 7 days (`scanMaxCacheAgeMs`) / 15 min (memory), with no bulk-invalidation lever except per-repo `?fresh=1`.
- **Root cause**: `makeCacheKey` assumes the score is a pure function of `owner/repo@sha` + LLM-on/off (`::llm|::mock`). It ignores every other input that changes the number: provider, model, rubric weights, `SCORE_BLEND`, prompt. A rubric bump has no visible cue at all (the report stamps `engine.model` but no rubric version).
- **Impact**: Silent, fleet-wide staleness after any model/rubric change; the product's core artifact (the score) is superseded but presented as current. Correctness + honesty.
- **Fix sketch**: Fold a `SCORING_VERSION` constant + `provider`/`model` into `makeCacheKey` (e.g. `…::llm:gemini-2.0:v7`). Bumping the constant invalidates the whole corpus atomically instead of relying on the 7-day age gate.

## 2. scan-alerts swallows any error and silently drops a real regression alert
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/scan-alerts.ts:95
- **Scenario**: `checkAndAlertRegression` diffs the fresh scan against `prev` (a historical *persisted* report). If any statement in the block throws — most plausibly `diffReports`→`reportToComparable` (`engine.ts:461-479`) dereferencing `prev.level.id` / `prev.posture.id` / `prev.engine.provider` / `prev.dimensions.map` on a report saved under an older schema — the outer `catch` returns `{ regressed: false, dispatched: false }`. A genuine score regression then produces NO alert AND NO `scan.regression` audit entry, only a `console.error`.
- **Root cause**: The block treats "any failure" as "no regression." The design assumption that `diffReports` never throws is false across schema versions of persisted reports.
- **Impact**: The push/cron "live intelligence" loop silently misses regressions after a schema evolution — the exact event the feature exists to catch. Degraded reliability, invisibly.
- **Fix sketch**: Narrow the catch — on an unexpected (non-diff) throw, still `recordAudit("scan.regression.error", …)` and/or emit a monitoring signal, rather than collapsing to "no regression." Defensively coerce missing `prev` fields in `reportToComparable`.

## 3. ScanForm validation error is not announced to screen readers
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/ScanForm.tsx:226
- **Scenario**: A screen-reader user submits an invalid value ("Enter a GitHub repo as owner/repo…"). The visible `<p id={errorId}>` has no `role="alert"` / `aria-live`; it's only linked via `aria-describedby`, which announces on focus, not on appearance. The one live region (`role="status" aria-live="polite"`, line 233) only announces "Scanning…" and stays empty on a validation failure. The user gets a silent shake and no spoken feedback.
- **Root cause**: Error text relies on a describedby association rather than a live region; the polite status is scoped only to the in-flight state.
- **Impact**: AT users can't tell why submission failed. Accessibility regression on the app's primary entry point.
- **Fix sketch**: Add `role="alert"` (or `aria-live="assertive"`) to the error `<p>`, or render the error string inside the existing `role="status"` region so it's announced when it appears.

## 4. claude-cli LLM budget (15 min) exceeds route maxDuration (300s)
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: assumption-landmine
- **File**: src/lib/scan.ts:59
- **Scenario**: `llmTotalBudgetMs("claude-cli")` returns 900_000 ms, but both scan routes hardcode `export const maxDuration = 300` (`route.ts:24`, `stream/route.ts:23`) under `runtime = "nodejs"`. If `LLM_PROVIDER=claude-cli` is ever deployed serverless (Vercel Pro caps at 300s), the platform hard-kills the function at 300s — *before* the 900s budget can abort to the mock degrade — so the user gets a 500/504 instead of the deterministic floor.
- **Root cause**: The generous claude-cli budget assumes "claude-cli only ever runs on a long-lived server," but nothing couples the budget to `maxDuration`; the route's 300s cap is set unconditionally.
- **Impact**: A stock `LLM_PROVIDER=claude-cli` serverless deploy times out every scan instead of degrading gracefully. Latent, config-dependent.
- **Fix sketch**: Clamp `llmTotalBudgetMs()` to `maxDuration*1000 - composeMargin`, or make `maxDuration` provider-aware, so the mock degrade always precedes the platform kill.

## 5. Client normalizeRepo accepts inputs the server rejects
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: src/components/ScanForm.tsx:36
- **Scenario**: `normalizeRepo`'s charset `/^[A-Za-z0-9_.-]+$/` (line 42) permits `..` and leading dots, so `owner/..` or `a/.git` passes client validation and navigates to `/report?repo=…`. The server's `parseRepoUrl` (`source.ts:127`) then rejects it with `INVALID_URL` → the report page shows a generic scan error after a wasted round-trip.
- **Root cause**: The client normalizer diverged from the server's traversal guard (`!s.startsWith(".") && !s.includes("..")`).
- **Impact**: Minor UX papercut — an avoidable failed navigation + generic error instead of inline "enter owner/repo" feedback.
- **Fix sketch**: Mirror the server guard in `normalizeRepo` (reject leading dot / `..` segments) so invalid coordinates fail inline before navigation.

## 6. IndexGallery: low-contrast missing-score placeholder and no empty state
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: loading-state
- **File**: src/components/landing/prototypes/index/IndexGallery.tsx:24
- **Scenario**: A repo with no score for a featured dimension renders `—` in `text-slate-700` on the near-black `slate-950` page — well under the WCAG 3:1 non-text / 4.5:1 text contrast floor, so it reads as an empty cell. Separately, if both `topAiNative` and `recent` are empty, `board` is `[]` and the component renders a header + divider + CTA with no "no repos rated yet" message (line 37,74-96).
- **Root cause**: Placeholder color chosen for subtlety over legibility; no explicit empty branch (the parent guards rendering, so this only bites if invoked with an empty gallery).
- **Impact**: Missing scores look like rendering bugs; a degenerate empty gallery shows a headerless void. Minor polish.
- **Fix sketch**: Lighten the `—` to ≥`text-slate-500`; add an explicit empty-state row ("No repos rated yet — scan one to seed the register").

## 7. resolveScanAuth silently downgrades a private scan on App-token failure
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/scan.ts:130
- **Scenario**: An authorized private/tenant scan resolves an installation id, but `getInstallationToken(id)` throws (App key rotation, GitHub App outage, revoked install). The `catch` returns `{ orgSlug: "public" }`, so the scan proceeds anonymously: a private repo then 404s (token-less), and a public repo owned by that org gets persisted into the shared **public** corpus instead of the org's tenant.
- **Root cause**: The catch conflates "couldn't mint a token" with "this is a public scan," discarding the caller's clear private intent with no surfaced error.
- **Impact**: An App outage is invisible (looks like a 404 or an unexpectedly-public result) rather than a diagnosable "couldn't authenticate the private scan." Low, outage-gated.
- **Fix sketch**: Distinguish "no installation" (→ public) from "mint failed" (→ surface an UPSTREAM/auth error to the route) so an App-config problem is diagnosable instead of masquerading as an anonymous scan.
