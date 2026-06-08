# Bug Hunter Fix Wave 8 — OAuth/session hardening + aggregate/UI tail (final wave)

> 5 commits, 5 findings closed (1 High + 3 Medium + 1 Low). The remaining tail items are deferred
> with cause (lower-severity polish, a deliberate design tradeoff, or DB/aggregate-math items).
> Baseline preserved: tsc 0→0 errors, eslint clean, `next build` green.
> Branch: `vibeman/bug-hunt-wave1-authz` (continued — final wave of the 2026-06-08 bug-hunt).

Wave 8 is the INDEX tail. It spans ~18 findings; per the wave-size discipline (and after the prior
waves), this run took the **clean, bounded, security/correctness-relevant subset** and documents the
rest as a backlog rather than ramming ~18 low-severity edits through in one pass.

## Commits

| # | Commit | Findings | Severity | Files |
|---|---|---|---|---|
| 1 | `a57d6c0` | github-oauth #1 | High | `lib/auth.ts`, `api/auth/callback/route.ts` |
| 2 | `0d765c9` | report-trends #3 | Medium | `components/report/Charts.tsx` |
| 3 | `0c4e604` | report-trends #5 | Medium | `lib/report/validate.ts` |
| 4 | `fa6bbbe` | org-dashboard #3 | Medium | `components/org/OrgScanButton.tsx` |
| 5 | `ff7cccc` | report-trends #7 | Low | `api/history/route.ts` |

## What was fixed

1. **Initial session cookie `Secure` (github-oauth #1, High)** — the OAuth callback minted the cookie with `secure` from the internal request origin, so behind a TLS-terminating proxy the FIRST session cookie lacked `Secure` and could leak over plaintext (the refresh path already used `secureCookieForRequest`). Exported that helper (x-forwarded-proto, `NODE_ENV=production` backstop) and used it on the callback mint.

2. **Posture-quadrant undefined color (report-trends #3)** — `QUAD_TINT[posture.id]` with no fallback; an untrusted/drifted `posture.id` made the "you are here" marker render with no fill and vanish. Default to the neutral slate the inactive labels use.

3. **Unparseable scannedAt (report-trends #5)** — `parseRepositoryHistory` kept points whose date couldn't be parsed; they blank the x-axis label and feed `forecastTrajectory`'s date math. Require a parseable `scannedAt` at the boundary (a point we can't place in time is unplottable).

4. **OrgScanButton swallows per-repo failures (org-dashboard #3)** — the bulk-scan SSE consumer handled only `progress`/`error`, ignoring the per-repo `repo` events that carry `error`, so partial failure read as full success. Count failing `repo` events and show "N repos failed to scan — see the Repositories tab".

5. **CSV export field quoting (report-trends #7)** — `historyToCsv` quoted some columns but emitted `scannedAt`/`overall`/dim cells raw; a future comma-bearing value would misalign the whole export. Quote every field through `csvField`.

## Deferred (with cause) — the remaining tail

- **github-oauth #2 (High) — revocation fails open when the DB is briefly down.** This is a **deliberate, documented tradeoff**: `verifySessionVersion` returns "unknown" on a DB blip and the short 60-min access TTL is the backstop (the code comment argues failing closed would log every user out on a transient hiccup). Changing it is a security-posture decision for the owner, not a bug fix — left as-is.
- **github-oauth #3 (Medium)** — `verifySessionVersion` can't distinguish a never-revoked login from a wiped revocation table; edge case, low likelihood.
- **github-oauth #4 (Medium)** — concurrent logins don't rotate/invalidate the prior session; needs a session-rotation design.
- **github-oauth #6 (Low)** — re-sync confirmation flag lost when `next` carries a URL fragment.
- **org-dashboard #4 (Medium)** — scoped-scan progress denominator wrong until the first event.
- **org-dashboard #5 (Medium)** — heatmap renders a fabricated 0 for a dimension a scan didn't emit (distinguish missing from 0 — relates to the maturity-#4 "unscored vs zero" theme).
- **org-dashboard #6 (Low)** — overview re-fetch can briefly render a blank page inside the org chrome.
- **org-scanning #5 (Medium)** — benchmark percentile / movers are meaningless on a single data point (needs a min-sample guard in `db/org.ts`; aggregate math, DB-verify).
- **org-scanning #6 (Medium)** — `/api/org/import` silently truncates orgs > 100 repos.
- **org-scanning #7 (Low)** — `recordScanOutcome` timestamp can lie under the bounded-concurrency staleness skip.
- **report-trends #6 (Low)** — RadarChart degenerates to an invisible single-vertex polygon for a 1-dimension report (render bars below ~3 dims).
- **scan-pipeline #6 / #7 (Low)** — `parseRepoUrl` host check end-anchored (`evilgithub.com`) and owner/repo charset allows bare `.`/`..`. The scanner itself rated these **defense-in-depth only** (ingestion targets hardcoded `api.github.com`/`raw.githubusercontent.com` with regex-sanitized, slash-free segments — not exploitable as SSRF). Known, low.

These are tracked in the INDEX and `harness-learnings.md` for a future polish pass; none is a critical, an exploitable security hole, or a data-loss path.

## Verification

| Check | Baseline | After Wave 8 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `eslint` (changed files) | (3 pre-existing warnings, untouched) | clean |
| `next build` | pass | pass |

## Final cumulative status (waves 1–8) — bug-hunt 2026-06-08 complete

- **40 findings closed via code** in **34 atomic fix commits** across 8 themed waves; **1 reassessed** (github-app #2 → Medium); the remaining ~27 are **deferred with documented cause** (lower-severity polish, design tradeoffs, or items needing a live DB / calibration bench / load test).
- **All 9 criticals closed.** Every High that was bounded + verifiable is closed; the deferred set is concentrated in DB-concurrency, calibration-sensitive scoring, and Low-severity polish.
- Every wave held the baseline: `tsc` 0→0, eslint clean, `next build` green, no regressions.
- Branch `vibeman/bug-hunt-wave1-authz` off `master`; INDEX + 8 per-wave `FIXES-WAVE-N.md` + this file are the durable record.

### Standing deferred backlog (needs a live DB / bench / design call)
- **DB migrations / concurrency:** persistence #4 (`@@unique([repoId, headSha])`), persistence #5 (connection pooler), org-scanning #2 (dup scans), org-scanning #4 (cron retry), maturity #6 (PATCH OCC), the read-path `withDb` migration.
- **Calibration-sensitive:** maturity #5 (guardband anchor — needs `npm run bench`).
- **GitHub-App flow/infra:** github-app #2 (OAuth-during-install), github-app #4 (selection-narrowing reconcile), OpenAI timeout-abort (mirror of llm #2).
- **Polish tail:** the Wave-8 deferrals listed above.

## Patterns established (catalogue items 20–21)

20. **Match the cookie's security flags to the EDGE connection, not the internal hop.** Behind a TLS-terminating proxy, the internal request is http; derive `Secure` from `x-forwarded-proto`, and apply it on every mint (initial + refresh), not just one path.
21. **Render-time lookups on untrusted ids need a default.** A `RECORD[untrusted.id]` that can miss (schema drift / a new id) must `?? fallback`, or the element silently disappears — the same class as the chart-geometry and posture-color misses.
