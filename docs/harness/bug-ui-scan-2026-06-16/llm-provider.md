# LLM Provider Abstraction — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 3, Medium: 2, Low: 0)
> Lens split: bug-hunter 5 / ui-perfectionist 0
> Files read: 12

This context is pure backend (provider plumbing + JSON hardening), so all five findings are bug-hunter. The two consumers (`src/lib/scan.ts`, `src/lib/scoring/engine.ts`) and the colocated tests were read to ground severity/impact.

## 1. `LLM_PROVIDER=openai` / `claude-cli` silently serve mock scores with no "model unavailable" caveat
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent failure / success theater
- **File**: src/lib/llm/index.ts:107-110 (with src/lib/scan.ts:117, 278)
- **Scenario**: An operator deploys with `LLM_PROVIDER=openai` but the `OPENAI_API_KEY` secret fails to load (typo, unmounted secret, wrong env scope). `getProvider()` hits the `orMockIf(providerAvailable("openai"), …)` branch, the env sniff fails, and it returns a `MockProvider` whose `.name` is `"mock"`. In `scan.ts`, `intendedProvider = provider.name` therefore becomes `"mock"`, so `llmFailed = intendedProvider !== "mock"` is `false`, the "Model unavailable — showing deterministic scores." SSE event never fires, and the report is branded as a normal deterministic run.
- **Root cause**: The bedrock branch was deliberately changed to STOP pre-degrading to mock for exactly this reason (see the long comment at index.ts:98-106: pre-degrading "set intendedProvider='mock', which suppressed the llmFailed warning entirely, so a falsely-gated healthy deploy served mock scores with no caveat"). That fix was applied to bedrock only — `openai` and `claude-cli` still pre-degrade via `orMockIf`, reintroducing the same success-theater bug for those two providers.
- **Impact**: A misconfigured paid provider returns deterministic-floor scores indistinguishable from a healthy scan. No operator log, no SSE `fallback:true`, no UI banner — the misconfiguration is invisible until someone notices scores never have LLM nuance. This is the highest-value finding because it silently nullifies the whole paid-LLM path.
- **Fix sketch**: Apply the bedrock stance to openai/claude-cli: construct the real provider on explicit selection and let it fail fast at `assess()` so the retry → failover → mock chain runs with honest `llmFailed` accounting. Or, if pre-gating is kept, have `getProvider` surface a distinct `intendedProvider` so `scan.ts` still flags the degrade.

## 2. OpenAI provider ignores an already-aborted client signal — issues (and bills) a doomed request
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race condition / missing abort honoring
- **File**: src/lib/llm/openai.ts:38-41
- **Scenario**: `assess()` is entered with `opts.signal` already in the aborted state — which happens on the failover step in `scan.ts` (the shared `llmSignal` = `AbortSignal.any([signal, llmDeadline.signal])` can already be aborted by the time step `i>0` runs, and the client may disconnect during the `sleep(LLM_RETRY_MS)` before the call). OpenAI registers `opts.signal.addEventListener("abort", onAbort, {once:true})` on a FRESH `ctrl`; because the abort event already fired, the listener never runs, `ctrl` is never aborted from the client side, and the `fetch` proceeds to completion.
- **Root cause**: Unlike gemini/bedrock, which combine signals with `AbortSignal.any([opts.signal, timeoutCtrl.signal])` (immediately reflects an already-aborted input), and unlike mock which calls `opts.signal?.throwIfAborted()` at entry (mock.ts:48), OpenAI uses only an `addEventListener` bridge and has no entry-time abort check. `addEventListener` does not fire for an abort that already happened.
- **Impact**: An abandoned/disconnected scan still issues a full billable OpenAI completion (and waits up to `LLM_TIMEOUT_MS`), defeating the cancellation contract documented on `AssessOptions.signal` ("aborts the … provider call when the client disconnects"). Inconsistent abort behavior across providers.
- **Fix sketch**: At entry, `opts.signal?.throwIfAborted();` then build the request signal with `const ctrl = AbortSignal.any([opts.signal, AbortSignal.timeout(LLM_TIMEOUT_MS)].filter(Boolean))` (or check `ctrl.signal.aborted` before `fetch`). Matches the gemini/bedrock pattern.

## 3. Bedrock empty/whitespace tool-input + empty text yields an unhelpful throw that masks a real answer shape
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge case / silent degrade
- **File**: src/lib/llm/bedrock.ts:101-129
- **Scenario**: The forced-tool Converse response comes back with a content block whose `toolUse.input` is an empty object `{}` or an object missing `dimensions` (model called the tool but produced nothing usable). Line 122 `if (input && typeof input === "object") return validateAssessment(input);` returns immediately on the FIRST such block — `validateAssessment({})` coerces to a zero-dimension assessment. The text-path safety net (lines 127-129) is never reached, and `isAssessmentUsable` in scan.ts then treats it as a failure and burns a retry/failover round trip instead of the text-path having a chance.
- **Root cause**: The `typeof input === "object"` short-circuit assumes a non-null object input is always the real answer. An empty/partial object is "object" but carries no score. Contrast: the string branch (111-121) deliberately falls through on a parse miss, but the object branch cannot fall through.
- **Impact**: A model that emits a usable answer in a later block, or in text alongside an empty tool-call object, is discarded; the scan needlessly degrades or spends extra latency/budget. Lower severity than #1/#2 because the retry/failover/mock chain still produces a report — it just wastes a round trip and can lose a recoverable answer.
- **Fix sketch**: Before returning at 122, require non-empty content, e.g. only short-circuit when `Array.isArray(input.dimensions) && input.dimensions.length` (or when the validated result is usable); otherwise continue scanning blocks and fall through to the text path.

## 4. No range validation on `LLM_TEMPERATURE`, `BEDROCK_MAX_TOKENS`, or a negative `LLM_TIMEOUT_MS`
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation gap at config boundary
- **File**: src/lib/llm/config.ts:8-13 (consumed at gemini.ts:50 / bedrock.ts:74-75 / openai.ts:48; timeout at gemini.ts:16, bedrock.ts:28, openai.ts:19)
- **Scenario**: `envNumber` accepts any finite number with no bounds. `LLM_TEMPERATURE=5` (or `-1`) is passed straight to Gemini/Bedrock/OpenAI, which reject out-of-range temperature with a hard 4xx — every real attempt throws, and the scan silently degrades to mock. `BEDROCK_MAX_TOKENS=0` or a negative value is `Math.round`-ed and sent as `maxTokens`, causing empty/erroring completions. Separately, `LLM_TIMEOUT_MS=-5` survives `Number(...) || 60_000` (a negative is truthy), producing `setTimeout(..., -5)` that fires immediately and aborts every request before it starts.
- **Root cause**: `envNumber` only guards `Number.isFinite`; it does not clamp to a valid domain. The timeout literals use `Number(env) || default`, which mishandles negatives (and silently maps `0` to the default rather than erroring).
- **Impact**: A single fat-fingered tuning env turns every paid scan into a silent deterministic-floor result (for temperature/timeout) or empty answers (maxTokens), with the misconfiguration only visible as repeated `[scan] LLM provider failed` logs. Operator-facing footgun on the documented tuning knobs.
- **Fix sketch**: Add an optional `{min,max}` to `envNumber` and clamp (warn on out-of-range): temperature `[0,2]`, maxTokens `[1, …]`, timeout `[1, …]`. Read timeout via `envNumber("LLM_TIMEOUT_MS", 60_000)` with a positive floor instead of `Number(...) || 60_000`.

## 5. `parseJsonLoose` fence path can return a partial fenced block before trying the full-text scan
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge case / parsing precedence
- **File**: src/lib/llm/json.ts:94-110
- **Scenario**: A model emits a short illustrative JSON fence (e.g. ```json {"example": 1} ``` in a preamble) followed by the real assessment fence or the real assessment as the top-level object. The fence loop (95-104) returns the FIRST fenced block that `JSON.parse`s successfully — the tiny example — and never reaches the balanced full-text scan (109) that would find the real, larger assessment. `validateAssessment` then coerces the wrong object to a near-empty assessment, which the usability gate rejects and degrades to mock.
- **Root cause**: Fenced-block extraction is unconditionally preferred over the full-document scan, and "first fence that parses wins" assumes the first fence is the answer. There is no preference for the largest/last candidate or for the object that actually matches the assessment shape.
- **Impact**: Lower-frequency than #1-#4 (depends on a model emitting an earlier parseable fence), but when it hits, a perfectly good paid answer is silently discarded for the mock floor. Hard to diagnose because parsing "succeeded."
- **Fix sketch**: Collect all fenced + balanced candidates, then prefer the one that best matches the contract (e.g. has a `dimensions` array), or the largest object; only fall back to first-parseable. At minimum, after a fenced parse, sanity-check it has expected top-level keys before returning.
