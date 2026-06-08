# Bug Hunter Fix Wave 6 — LLM cost / billing integrity

> 3 commits, 3 findings closed (2 High + 1 Medium); 3 deferred with cause (1 High + 2 Medium).
> Baseline preserved: tsc 0→0 errors, eslint clean, `next build` green.
> Branch: `vibeman/bug-hunt-wave1-authz` (continued).

Shared model: every billed token / metered unit must map to a real, completed, billable scan — and a timeout must stop the meter, not just look away.

## Commits

| # | Commit | Findings | Severity | Files |
|---|---|---|---|---|
| 1 | `ac39b1a` | llm #3 | High | `lib/scan.ts` |
| 2 | `98519ee` | llm #2 | High | `lib/llm/gemini.ts` |
| 3 | `c38e70d` | usage #6 | Medium | `lib/db/usage.ts` |

## What was fixed

1. **Failed-attempt tokens billed (llm #3, High)** — providers call `onUsage(...)` BEFORE the parse/usability check, and `attemptAssess` wrote those tokens straight into the shared `capturedUsage`. So when an attempt was malformed/unusable and the scan degraded to mock, `report.usage` still carried — and persisted — the FAILED attempt's tokens, metering the user for AI that "was unavailable". Capture each attempt's usage into a local and commit to `capturedUsage` only after it passes the usability gate (commit-on-success).

2. **Timeout doesn't cancel the request (llm #2, High)** — `withTimeout` was a promise race that rejected the wrapper but left the underlying Gemini `generateContent` running in the background (still consuming tokens + a socket) while retry/fallback fired — doubling in-flight requests on every timeout (a self-perpetuating retry storm). Replace it with an `AbortController` the timer aborts, combined with the client-disconnect signal via `AbortSignal.any`, so a timeout actually cancels the call. (OpenAI already wires its signal; same pattern is the follow-up there.)

3. **estimatedCost partial-rate half-bill (usage #6, Medium)** — cost was computed when EITHER rate was `> 0`, via `envNumber(name, 0)` which can't tell "unset" from "0". A partial config (only the input rate set) billed the output side at $0 behind a confident dollar figure. Parse both rates from raw env (null when blank, not 0) and estimate only when BOTH are present + finite; a deliberate "0" stays a valid price, a missing rate surfaces "rate not set".

## Deferred (with cause)

- **usage #5 (Medium) — mock/keyless scans billed as private.** "billable = private" is woven through the `priv` count, the per-day SQL series (`fetchDailySeries` buckets `billable = isPrivate`), the JS fallback, the CSV export, AND the `UsageTrend` chart. Excluding mock consistently is a metering-wide change, unverifiable DB-less; a partial fix (just the "Billable" stat) would disagree with the trend. **Lower impact now**: W6-1 zeroed mock token cost and W6-4 fixed cost-rate handling, so the residual is the private-scan UNIT count, not the dollar figure. Deferred.
- **scan-pipeline #2 (High) — cache-stampede double-bill.** A singleflight (share one in-flight computation across concurrent identical scans) is clean for the JSON route, but the PRIMARY scan path is the SSE STREAM route, which streams per-client progress — two clients can't share one computation's stream, so a correct singleflight there is non-trivial. Deferred (needs a stream-aware design + load verification).
- **org-scanning #4 (Medium) — cron at-least-once retry re-burn.** A Vercel/GitHub retry re-scans repos scanned-but-not-yet-advanced. The robust fix ties to a DB-level `@@unique([repoId, headSha])` (the deferred persistence #4) + advance-before-or-atomic — DB-concurrency, unverifiable DB-less. Deferred with persistence #4.

## Verification

| Check | Baseline | After Wave 6 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `eslint` (changed files) | (3 pre-existing warnings, untouched) | clean |
| `next build` | pass | pass |

Each fix committed atomically after its own `tsc` pass.

## Cumulative status (waves 1–6)

- **30 findings closed** in 24 fix commits; 1 reassessed (github-app #2); deferred-with-cause now includes usage #5, scan-pipeline #2, org-scanning #4 (this wave) plus the earlier set.
- **All 9 criticals remain closed.** Wave 6 was High→Medium billing hardening.
- Remaining per INDEX: **Wave 7** (cache/dedup & GitHub App sync — scan-pipeline #3/#5, org-scanning #2, github-app #4/#5/#6/#7, report-trends #4), **Wave 8** (session/OAuth + aggregate/UI tail). All High→Low. Note: several Wave-7 items (cross-instance dup scans) tie to the deferred DB-unique-constraint work.

## Patterns established (catalogue items 16–17)

16. **Meter on commit, not on attempt.** Usage/cost captured optimistically (before the response is proven usable) bills failures. Fold per-attempt usage into the billable total only on the winning attempt.
17. **A timeout must cancel, not just abandon.** A promise-race timeout leaves the guarded request running (still billing). Drive timeouts through an AbortController so the deadline actually aborts the work.
