# Code Refactor — LLM Provider Abstraction
> Total: 5 | Critical: 0 High: 1 Medium: 2 Low: 2

## 1. Repeated "empty-check → parse → validate → meter usage" epilogue across every provider
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/llm/gemini.ts:57-61, src/lib/llm/openai.ts:65-68, src/lib/llm/bedrock.ts:140-145,172-174, src/lib/llm/claude-cli.ts:58
- **Scenario**: Each text-completion provider closes its `assess()` with the same shape:
  ```ts
  const text = <extract>;
  if (!text) throw new Error("Empty response from <X>.");
  opts.onUsage?.({ inputTokens: …, outputTokens: … });
  return validateAssessment(parseJsonLoose(text));
  ```
  `validateAssessment(parseJsonLoose(text))` is the terminal line in all five provider paths (gemini, openai, bedrock text path, bedrock tool-string path, claude-cli). The `if (!text) throw new Error("Empty response from …")` guard is copied verbatim (only the provider noun changes) in gemini/openai/bedrock. The `onUsage?.({ inputTokens, outputTokens })` call is hand-mapped per provider into the same `TokenUsage` shape.
- **Root cause**: No shared "finish a text assessment" helper exists, so the abstraction's common tail was copy-pasted into each new provider as the union grew from 3 to 5.
- **Impact**: Five edit sites for any change to the parse/validate/empty-handling contract (e.g. adding a structured `ProviderParseError` log, changing the empty-response error text, or adding a usage field); the four providers can silently drift in how they treat an empty/blank reply.
- **Fix sketch**: Add one helper near `validateAssessment` in provider.ts, e.g. `finalizeTextAssessment(text: string | undefined | null, providerLabel: string): LlmAssessment` that does the empty-check throw + `validateAssessment(parseJsonLoose(text))`. Call it from gemini/openai/bedrock (text path) and reuse just the `validateAssessment(parseJsonLoose(...))` portion in bedrock's tool-string path and claude-cli. Leave the provider-specific usage extraction in place (only the `{inputTokens, outputTokens}` mapping differs), or factor a tiny `reportUsage(opts, {...})` if desired.

## 2. `envNumber("LLM_TEMPERATURE", 0.2)` duplicated in three providers instead of a config helper
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/llm/gemini.ts:46, src/lib/llm/bedrock.ts:107, src/lib/llm/openai.ts:47
- **Scenario**: All three real providers read the determinism knob with the literal `envNumber("LLM_TEMPERATURE", 0.2)`. The env name *and* the magic default `0.2` are repeated at three sites.
- **Root cause**: config.ts already centralizes the sibling knob (`llmTimeoutMs()` wraps `envNumber("LLM_TIMEOUT_MS", 60_000)` specifically so "it obeys the same parsing rules… in one place"), but no equivalent `llmTemperature()` was added — so temperature stayed an inline literal.
- **Impact**: Changing the default temperature or its env semantics requires editing three files; the `0.2` default can drift between providers (bedrock already special-cases `thinking > 0 ? 1 : envNumber(...)`, making divergence easy to miss).
- **Fix sketch**: Add `export function llmTemperature(): number { return envNumber("LLM_TEMPERATURE", 0.2); }` to config.ts (mirroring `llmTimeoutMs`). Replace the three call sites; bedrock becomes `thinking > 0 ? 1 : llmTemperature()`.

## 3. `testBedrockConnection` re-implements `assess()`'s SDK setup with a hand-rolled timeout
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/llm/bedrock.ts:184-212 (vs assess() at 68-86)
- **Scenario**: Both `assess()` and `testBedrockConnection()` perform the same three-step setup: `await import("@aws-sdk/client-bedrock-runtime")`, `new BedrockRuntimeClient(bedrockClientConfig(region, credentials))`, then `client.send(new ConverseCommand(...), { abortSignal })`. For cancellation, `assess()` uses the shared `withLlmTimeout()` helper, but `testBedrockConnection()` hand-rolls the exact pattern that helper was created to remove:
  ```ts
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("Bedrock test timed out.")), 15_000);
  try { … } finally { clearTimeout(timer); }
  ```
- **Root cause**: `withLlmTimeout()` (config.ts) was introduced for the per-call provider timeouts so "the bug-prone parts (clearing the timer, not leaking a listener) are then correct everywhere at once," but the test-connection path predates/sidesteps it and keeps its own copy.
- **Impact**: Two implementations of the same SDK-bootstrap + timeout logic; a fix to timer/abort handling (or to the lazy-import + client construction) must be made twice, and the test path can diverge from the real assess path it is meant to validate.
- **Fix sketch**: Use `withLlmTimeout(undefined, 15_000, "Bedrock test timed out.")` in `testBedrockConnection` (call `clear()` in `finally`). Optionally extract a small `sendConverse(region, credentials, command, signal)` that does the lazy import + `new BedrockRuntimeClient(bedrockClientConfig(...))` + `client.send(cmd, { abortSignal })`, shared by both functions.

## 4. Module header doc-comments omit the OpenAI and claude-cli providers (stale map)
- **Severity**: Low
- **Category**: cleanup
- **File**: src/lib/llm/provider.ts:1-5, src/lib/llm/index.ts:1-11
- **Scenario**: The header comment in provider.ts lists only `GeminiProvider`, `BedrockProvider`, `MockProvider` as the provider set; index.ts's selection-table comment documents only `gemini / bedrock / mock / auto`. But `OpenAiProvider` and the claude-cli provider are fully implemented, selectable via `LLM_PROVIDER`, and handled in `resolveProviderChoice`/`getProvider`/`providerByName`.
- **Root cause**: The headers were written when the union was 3-way and never updated as openai + claude-cli were added (the closed "4-way ProviderName union" note in openai.ts confirms the abstraction grew after these comments were written).
- **Impact**: The canonical "here are the providers" comment under-counts the real surface, so a reader's mental model of the abstraction is wrong from the first file they open.
- **Fix sketch**: Add the two missing providers (and the `LLM_PROVIDER=openai` / `=claude-cli` flags) to both header blocks so the doc enumerates all five.

## 5. Resolved-bug narration left inline as `BUG (...)` comments
- **Severity**: Low
- **Category**: cleanup
- **File**: src/lib/llm/index.ts:109-116 (and the parallel "BUG (llm-provider-abstraction #1)" reference)
- **Scenario**: The `claude-cli` case in `providerAvailable()` carries a multi-line comment prefixed `// BUG (llm-provider-abstraction #1): …` that narrates a *past* defect (gating on `VERCEL` instead of `NODE_ENV`) and the fix that was already applied. The surrounding code is already correct; the comment documents history under a "BUG" banner.
- **Root cause**: Fix-time scratch notes were committed verbatim rather than condensed into a forward-looking rationale once the change landed.
- **Impact**: A `BUG (...)` prefix on already-fixed code is misleading scaffolding — it reads as an open defect, and the ticket-style id (`#1`) references an external tracker meaningless in-repo. Inflates the file and obscures the (valid) one-line "why" behind the guard.
- **Fix sketch**: Collapse to a short rationale, e.g. "Mirror `LazyClaudeCliProvider.assess()`: it throws when `NODE_ENV === 'production'`, so availability must gate on the same signal (not `VERCEL`)." Drop the `BUG`/ticket framing.
