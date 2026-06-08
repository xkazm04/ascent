# Bug Hunter Fix Wave 5 — Resource lifecycle, crashes & input boundaries

> 6 commits, 8 findings closed (1 Critical + 4 High + 2 Medium + 1 Low).
> Baseline preserved: tsc 0→0 errors, eslint clean, `next build` green.
> Branch: `vibeman/bug-hunt-wave1-authz` (continued).
> **Closes the last open critical** (llm #1). All 9 of the scan's criticals are now dispositioned.

Shared model: a hostile/malformed input — a model reply, a child process, a disconnecting client, an `/api/history` body — must fail in **bounded, contained** ways, never stall the loop, crash the process, or crash a render.

## Commits

| # | Commit | Findings | Severity | Files |
|---|---|---|---|---|
| 1 | `353be6b` | llm #1 | **Critical** | `llm/json.ts` |
| 2 | `46e8cf7` | llm #4, #5 | High, Medium | `llm/claude-cli.ts` |
| 3 | `b269e5b` | scan-pipeline #1 | High | `api/scan/stream/route.ts` |
| 4 | `273fb12` | report-trends #2 | High | `report/chartScale.ts`, `report/Charts.tsx` |
| 5 | `dab2769` | report-trends #1 | High | `report/validate.ts`, `ReportView.tsx`, `DimensionTrends.tsx` |
| 6 | `c38bfb9` | llm #6, #7 | Medium, Low | `llm/provider.ts`, `llm/bedrock.ts` |

## What was fixed

1. **parseJsonLoose event-loop stall (llm #1, Critical)** — the balanced-brace recovery is O(starts×N): each failed `{`/`[` start re-scans to end-of-string, so a truncated/adversarial reply full of bare unclosed braces became O(N²) on the single-threaded loop, uninterruptible by the (synchronous) AbortSignal. Bound both dimensions: skip recovery above 256KB (the O(N) clean fast path is unaffected), and cap `balancedParse` to 512 structural starts.

2. **claude-cli stdin EPIPE crash (llm #4, High)** — `child.stdin.write/end` had no `'error'` listener, so a child that dies immediately (missing binary / bad model / auth) and closes stdin raised an unhandled error that **tore down the whole Node process**. Attach `stdin.on("error", reject)` + guard with `!destroyed`.

3. **claude-cli arg-injection (llm #5, Medium)** — `shell:true` (Windows `.cmd` resolution) re-parses argv as a shell line; validate `CLAUDE_MODEL` against a simple-token charset before the spawn so a per-request/org-configurable model can't smuggle shell metacharacters. (`CLAUDE_CLI_PATH` stays operator-only — paths carry legit special chars — documented residual.)

4. **SSE heartbeat leak on disconnect (scan-pipeline #1, High)** — the keepalive `setInterval` was only cleared in `start()`'s finally, so a client disconnect mid-scan left it firing on a torn-down controller until the scan unwound. Hoist the handle and add a stream `cancel()` that clears it immediately (the scan already aborts via `request.signal`).

5. **NaN/out-of-range chart geometry (report-trends #2, High)** — `vScale` and the `ScoreRing` offset never clamped their 0..100 input (only `scoreHex` colour did), so a bad score produced a NaN `y` that breaks the whole `<path>`, a point outside the box, or a full-circle ring reading as a perfect 100. Clamp + `Number.isFinite`-guard at the scale boundary (shared by all charts) and in the ring offset.

6. **/api/history unvalidated (report-trends #1, High)** — both consumers cast the body `as RepositoryHistory` with no runtime check, then iterated; a 200 with a drifted/wrong-shaped body crashed the trend render (the streamed report has `parseScanReport`, this second boundary had nothing). Added `parseRepositoryHistory` (same dependency-free guards, never throws — empty `scans` on junk, drops unplottable points) and wired both fetch sites.

7. **Unbounded model strings (llm #6, Medium)** — `validateAssessment` capped array *count* but not string *length*, so a multi-megabyte summary/headline bloated the DB row + SSE payload. Added a `cap()` (2000 chars) on every coerced string.

8. **Bedrock string tool-input (llm #7, Low)** — `validateAssessment(toolUse.input)` coerced a JSON-*string* input to a zero-dimension assessment (silent mock degrade); repair-parse a string first, only short-circuit on a real object, else fall through to the text path.

## Verification

| Check | Baseline | After Wave 5 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `eslint` (changed files) | (3 pre-existing warnings, untouched) | clean |
| `next build` | pass | pass |

Each fix committed atomically after its own `tsc` pass.

## Cumulative status (waves 1–5) — all criticals closed

- **27 findings closed** in 21 fix commits; 1 reassessed (github-app #2); deferred-with-cause: persistence #3-prevention/#4/#5, the read-path withDb migration, maturity #5/#6, maturity-#1 stricter gate, maturity-#4 mock cosmetic.
- **Criticals: 8 of 9 closed via code** (github-app #1, org-dashboard #1, org-scanning #1, usage #1, persistence #1, persistence #2, maturity #1, llm #1) + 1 reassessed to Medium (github-app #2). **No open criticals remain.**
- Remaining per INDEX: **Wave 6** (LLM cost/billing integrity — llm #2/#3, scan-pipeline #2, org-scanning #4, usage #5/#6), **Wave 7** (cache/dedup & GitHub App sync), **Wave 8** (session/OAuth + aggregate/UI tail). All High→Low.

## Patterns established (catalogue items 13–15)

13. **A synchronous loop is unbounded by AbortSignal.** Any recovery/parse that can scale with hostile input must have an explicit size/iteration ceiling — the per-request abort can't interrupt a sync CPU loop.
14. **Child-process stdin is a crash surface.** An external CLI can die mid-write; an unhandled `stdin` `'error'` (EPIPE) is an uncaught exception that takes the server down. Always attach the listener before writing.
15. **Every untrusted JSON boundary needs its own guard.** Validating the streamed report but `as`-casting the sibling `/api/history` body that feeds the same charts is asymmetric trust — the unvalidated one is the one that crashes.
