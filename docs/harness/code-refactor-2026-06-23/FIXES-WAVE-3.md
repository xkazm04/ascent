# Code Refactor — Fix Wave 3: Shared infra plumbing (COMPLETE)

> 6 commits, 6 findings closed (4 High + 2 from llm-provider). Baseline: tsc 0→0 ·
> tests 2606→2610 (+4 lock tests; 0 regressions).

| # | Commit | Finding | What was consolidated / fixed |
|---|---|---|---|
| 1 | `refactor(sse): extract shared server-side SSE plumbing` (`1d001bb`) | org-import #2 | `src/lib/sse-server.ts` (`SSE_HEADERS` + `makeSseSend`); routed org/import, org/scan, scan/stream through it. scan/stream keeps its keepalive + spreads the shared headers. |
| 2 | `refactor(onboarding): drain import SSE via shared parseSSE` (`5b01811`) | onboarding #1 | importScan now uses `parseSSE` from `@/lib/sse` instead of a 3rd hand-rolled per-frame parser (outer read loop kept so the stall watchdog is untouched). |
| 3 | `refactor(github): centralize REST request headers in ghHeaders` (`5302faa`) | github-repo-data #1 | `ghHeaders(token?, …)` in `host.ts`; routed source/governance/discover/list through it. |
| 4 | `refactor(retention): route purge through shared withRetry (DSQL drift fix)` (`1d5af29`) | data-retention #1 | **Drift fix** — deleted the private inferior `withRetry`/`isSerializationConflict`; the purge now retries DSQL's native `OC###` + `40P01` with jitter (the local copy missed both). |
| 5 | `refactor(llm): share LLM_TIMEOUT_MS via config.llmTimeoutMs` (`5ce90d0`) | llm-provider #1 | Three `Number(env)||60_000` copies → `config.llmTimeoutMs()`. **Fix:** a configured `0`/blank is now honored via `envNumber` instead of coerced to 60s. |
| 6 | `refactor(llm): unify per-call timeout/abort wiring in withLlmTimeout` (`111a5b9`) | llm-provider #2 | `withLlmTimeout(signal, ms, message)`; migrated openai off its leak-prone manual addEventListener onto `AbortSignal.any` (+ a real timeout reason). |

## Reasoned deviations (honest scoping)

- **Onboarding (#2)**: did NOT add a "trailing-frame flush" — `lib/sse.ts` deliberately does not parse a truncated trailing frame (a pinned test), so the `\n\n` framing is retained. The real win (deduping the inner parser) is done; CRLF tolerance comes free via `parseSSE`'s per-line trim.
- **GitHub (#3)**: `graphql.ts` is intentionally NOT migrated — its GraphQL POST sends `Content-Type` and no `Accept`/`X-GitHub-Api-Version`, a genuinely different header set (the report's "same 4 headers" claim was inaccurate for that file).

## Patterns established (catalogue items 6–7)

6. **Inferior drifted copy of a resilience primitive** — a module re-rolls `withRetry`/conflict-classification and its private copy lags the shared one on the production target (here: missing DSQL `OC###`/`40P01`). The duplication is a *reliability* bug, not just cruft; route through the shared, better-tested one.
7. **`|| fallback` vs a real env coercion** — `Number(process.env.X) || D` silently coerces a configured `0` (or blank) back to the default. A shared `envNumber(name, fallback)` makes `0` honorable; consolidating onto it is a behavior fix, not only dedup.
