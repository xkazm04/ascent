# Bug Hunter Fix Wave 4 — LLM provider resilience & degradation

> 5 fix commits, 7 findings closed.
> Baseline preserved: tsc 0 → 0 errors · tests 260/260 · eslint clean · next build passes.
> Branch: `vibeman/bug-hunt-2026-06-09` (off `master`).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `77e8a3f` | llm #1 + #2 | High + Medium | scan.ts, llm/mock.ts |
| 2 | `0f62121` | llm #5 | High | llm/index.ts |
| 3 | `6504e38` | llm #3 + #4 | High + Medium | llm/claude-cli.ts |
| 4 | `a154f12` | llm #7 | Medium | llm/bedrock.ts |
| 5 | `40ef55b` | llm #6 | Low | llm/provider.ts |

## What was fixed (grouped by sub-pattern)

### Scan-wide degradation budget
1. **Per-scan LLM deadline** (`77e8a3f`, High). Each attempt had its own per-call timeout, but the resilience plan (primary + retry + failover) multiplied them — three ~60s attempts could burn ~181s and blow the 120s serverless `maxDuration` BEFORE the mock degrade ran, 500-ing instead of returning the deterministic floor. Added `LLM_TOTAL_BUDGET_MS` (90s) via a deadline `AbortController` combined with the client signal; on expiry the in-flight + remaining attempts abort and we fall through to mock. The budget signal is distinct from the client signal so a budget expiry degrades while a real disconnect unwinds the scan.
2. **Mock degrade honors the signal** (`77e8a3f`, Medium). The mock fallback called `assess(scoreInput)` without `{ signal }` — the degrade path is the one most likely to run after a disconnect, yet it ignored the cancellation contract. Pass `{ signal }`, and `MockProvider.assess` now `throwIfAborted()` at entry.

### Fast pre-degrade on misconfiguration
3. **Provider prerequisite pre-check** (`0f62121`, High). Only Gemini pre-degraded to mock when its key was absent; bedrock/openai/claude-cli were returned bare. A `bedrock → openai` failover could pick a keyless OpenAiProvider (a guaranteed-failing round trip), and `LLM_PROVIDER=claude-cli` on Vercel burned every plan step before the inevitable mock. Added `providerAvailable(name)` (cheap env check): the picker pre-degrades a selected-but-unavailable provider to mock (logged); the failover returns null so the orchestrator skips the doomed attempt.

### Subprocess safety
4. **claude-cli output cap + error detail** (`6504e38`, High + Medium). Child stdout/stderr accumulated into unbounded strings — a runaway/looping CLI OOMs the whole Node server during accumulation, before json.ts's downstream cap can help. Cap stdout at 4 MB (SIGKILL + reject) and stderr at 16 KB. Separately, the envelope-parse error collapsed every non-JSON outcome into one opaque message and dropped `raw`, so a subscription-auth `/login` prompt (the most common failure) surfaced with no actionable detail; now includes `raw.slice(0,300)`.

### Recovery-path correctness
5. **Bedrock text-path fallthrough** (`a154f12`, Medium). A malformed tool-input string made `parseJsonLoose` throw out of the whole content-block loop, skipping the text-extraction safety net even when the model also answered in a text block — degrading a recoverable answer to mock. Wrapped the string-repair in try/catch so it falls through as intended.
6. **Bounded dimensions array** (`40ef55b`, Low). `validateAssessment` capped field length and trailing-sliced roadmap/discrepancies, but the `dimensions` array was iterated in full and never count-capped — a million valid-id duplicates survived validation and bloated the row/payload/UI (json.ts's 256KB cap doesn't apply on the fast parse path). Slice the input to `DIMENSIONS.length*4` + de-dupe by id; pre-slice `asStringArray` input before filter/map.

## Verification table

| Gate | After Wave 7 | After Wave 4 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `vitest run` | 260 passed / 260 | 260 passed / 260 |
| `eslint` (changed) | clean | clean |
| `next build` | passes | passes |

## Cumulative status (across all waves so far)

| Wave | Theme | Findings closed |
|---|---|---|
| 1 | Concurrency, dedup & billing integrity | 7 |
| 2 | Auth, webhook & session integrity | 7 |
| 3 | Resilient rendering & empty-data UX | 8 |
| 7 | Public-surface input validation & completeness | 7 |
| 4 | LLM provider resilience & degradation | 7 |
| | **Total** | **36 / 70 — all 3 Criticals + 15 of 21 Highs closed** |

## Patterns established (catalogue items 16–18)

16. **A per-operation timeout isn't a per-request budget** — when a resilience plan issues N retries/failovers, each with its own timeout, the worst case is N×timeout. Add ONE wall-clock budget across all attempts, sized under the platform's hard limit, so the graceful-degrade path is always reached before the platform kills the request.
17. **Pre-check prerequisites; don't discover them the slow way** — a provider/integration selected without its key/region/binary should pre-degrade (or be skipped) on a cheap synchronous check, not spend the full retry budget proving the obvious and risk the request timeout.
18. **Cap untrusted input at the accumulation boundary, not just downstream** — a downstream size cap (parse, recovery) can't prevent an OOM that happens while *accumulating* unbounded subprocess/model output. Bound the buffer in the `data` handler / pre-slice the array before mapping.

## What remains

Open themes per the INDEX (34 of 70 still open, 0 Critical, 6 High): Scoring/maturity math (Wave 5 — 2 H), SSE lifecycle & cache staleness (Wave 6 — 1 H), Persistence & DSQL token lifecycle + residual polish (Wave 8 — 3 H + the deferred org-scan #5, oauth #4/#6/#7, report #4/#7, org-dash #4/#5).
