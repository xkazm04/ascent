# LLM Provider Abstraction — bug-hunter + ui-perfectionist scan

> Context: LLM Provider Abstraction (group: Repository Scanning & Scoring)
> Files scanned: 15 (scoped) + scan.ts / usage.ts / consolidation-engine.ts (adjacent, for trace)
> Total: 7 findings (Critical: 0, High: 0, Medium: 6, Low: 1)

Context note: the degradation-honesty spine is genuinely well-built. scan.ts labels every mock
fallback (`llmFailed` → "Model unavailable" warning + `fallback:true` SSE; keyless-mock caveat at
scan.ts:490), failed-attempt token usage is discarded before commit, `isAssessmentUsable` gates a
parseable-but-empty reply to mock, and `validateAssessment` no longer coerces a missing score to a
real 0. No "mock renders as real" Critical was found. `__proto__` is not exploitable
(`validateAssessment` reads named fields, never merges untrusted keys). claude-cli's model arg is
shell-injection-locked (provider.ts regex) and the API key is env-deleted, never in `argv`. The
findings below are honest-degrade footguns and contract gaps in the new/fringe paths.

## 1. OpenRouter "vendor/model" ids never match the price table — whole /usage cost estimate collapses to null
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: contract-drift
- **File**: src/lib/llm/config.ts:80
- **Scenario**: An org runs the new OpenRouter provider (default model `openai/gpt-4o-mini`, openrouter.ts:18 — all OpenRouter ids are `vendor/model` slugs). `priceForModel` (config.ts:144) does longest-prefix `startsWith` over `MODEL_PRICES`, but every prefix is a bare id (`gpt-4o-mini`, `anthropic.claude-…`) with no `vendor/` namespace, so `"openai/gpt-4o-mini".startsWith("gpt-4o-mini")` is false → returns null. `estimateLlmCostFromTable` (usage.ts:248) then `return null` for the ENTIRE aggregate the moment one token-bearing row is unpriced.
- **Root cause**: the new provider persists a model-id namespace (`vendor/model`) the price table never anticipated; the price contract that config.ts owns wasn't extended when OpenRouter landed.
- **Impact**: any period containing an OpenRouter scan shows "no estimate" for the whole org's LLM spend — the fleet/BYOM cost panel silently blanks. config.test.ts only tests null for genuinely-unknown ids, so this slipped through.
- **Fix sketch**: strip a leading `vendor/` segment in `priceForModel` before matching, or add `openai/…`, `anthropic/…`, `google/…` prefixes to `MODEL_PRICES`.

## 2. LLM_TIMEOUT_MS=0 (or negative) passes the isFinite guard → instant abort → every scan degrades to mock
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: config-landmine
- **File**: src/lib/llm/config.ts:22
- **Scenario**: An operator sets `LLM_TIMEOUT_MS=0` intending "no timeout / disabled". `envNumber` (config.ts:8) accepts 0 (its docstring explicitly brags it no longer coerces a configured 0 to the default). `llmTimeoutMs()` returns 0, `withLlmTimeout` does `setTimeout(abort, 0)` (config.ts:40) → the combined signal aborts on the next tick → every gemini/bedrock/openai/openrouter call is cancelled before it can answer. Negative values are also `isFinite` and clamp to 0.
- **Root cause**: 0 is treated as a legitimate timeout value, but a 0ms timeout is semantically "disable the LLM," the opposite of the natural "0 = off" reading.
- **Impact**: a single well-meant env tweak silently routes 100% of scans to the deterministic mock floor (disclosed only by the generic "Model unavailable" caveat). Very hard to diagnose.
- **Fix sketch**: floor the timeout to a sane minimum (e.g. `Math.max(1000, n)`), or treat `<= 0` as "disabled/no-timeout" and skip the abort timer entirely.

## 3. `jsonc` fence tag advertised but JSON.parse can't handle JSONC — trailing commas/comments silently degrade to mock
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: parsing-gap
- **File**: src/lib/llm/json.ts:94
- **Scenario**: A model emits ```` ```jsonc ```` (or a plain fence) whose body has a trailing comma (`…"gaps":[],}`) — a common LLM/token-boundary artifact — or a `// comment`. The fence regex matches and captures the body, but recovery only ever calls strict `JSON.parse` (json.ts:99) and `balancedParse` (also strict `JSON.parse`, 124). Both reject JSONC → all fences fail → `ProviderParseError` → scan degrades to mock.
- **Root cause**: the `jsonc` alternative in `fenceRe` creates a promise the parser doesn't keep — there is no comment/trailing-comma normalization anywhere before `JSON.parse`.
- **Impact**: an otherwise-perfect paid assessment marred by one trailing comma is thrown away and re-rendered as the deterministic floor. json.test.ts covers prose/truncation/DoS but has no trailing-comma case.
- **Fix sketch**: before the final `JSON.parse`, strip `//`/`/* */` comments outside strings and remove `,` immediately preceding `}`/`]` (or adopt a tolerant JSON5 parse for the recovery path only).

## 4. Bedrock extended-thinking budget starves the answer (thinking+1024) → truncated assessment → mock
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: latent-failure
- **File**: src/lib/llm/bedrock.ts:92
- **Scenario**: `LLM_THINKING_BUDGET` is enabled (its documented use is the reasoning-heavy discrepancy audit on complex repos). `maxTokens = Math.max(baseMaxTokens, thinking + 1024)`. For any `thinking >= ~3072`, this resolves to `thinking + 1024`, leaving only ~1024 tokens for the actual answer — but a full 9-dimension assessment normally consumes the whole `baseMaxTokens` (4096). The tool-input JSON truncates mid-object → `parseJsonLoose` throws → text path empty → "Empty response from Bedrock" → mock.
- **Root cause**: the answer-room headroom is a fixed `1024` constant unrelated to the assessment's real size; it should be `thinking + baseMaxTokens`.
- **Impact**: turning on the feature meant to *sharpen* the assessment on complex repos instead breaks it there (silent mock degrade). Off by default, so latent until enabled.
- **Fix sketch**: `const maxTokens = thinking > 0 ? thinking + baseMaxTokens : baseMaxTokens;`.

## 5. Explicit LLM_PROVIDER=gemini with a missing/typo'd key silently degrades to mock — inconsistent with the other providers' fail-fast
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/llm/index.ts:148
- **Scenario**: An operator sets `LLM_PROVIDER=gemini` but `GEMINI_API_KEY` is unset/misspelled. `getProvider` → `geminiOrMock()` (index.ts:72) returns a `MockProvider`, so `intendedProvider === "mock"` and `llmFailed` never trips. The same switch's bedrock/openai/openrouter branches (index.ts:137-143) deliberately do NOT pre-degrade — their comment calls that "success theater" — and openai throws "OPENAI_API_KEY is not set" → honest "Model unavailable." Gemini is the lone explicit selection that pre-collapses to mock.
- **Root cause**: the explicit `gemini` case reuses `geminiOrMock()` (correct for `auto`), inheriting the keyless→mock shortcut the code elsewhere rejects for explicit selection.
- **Impact**: the operator believes real AI is scoring; scores are the floor, disclosed only by the soft keyless caveat and a "Scoring against the rubric…" message that looks intentional. Broken key goes unnoticed.
- **Fix sketch**: for an EXPLICIT `gemini` selection, construct `GeminiProvider` unconditionally (let `assess` throw on a keyless client), mirroring the openai/bedrock branches; keep `geminiOrMock()` only for `auto`.

## 6. Bedrock BYOM test-connection doesn't exercise the forced tool schema → false "connection OK", every scan mocks
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: src/lib/llm/bedrock.ts:198
- **Scenario**: A BYOM org saves Bedrock creds for a model that doesn't support Converse tool use (or a wrong/legacy model id). `testBedrockConnection` sends a bare `ping` with `maxTokens:1` and NO `toolConfig`, so it returns `{ok:true}`. But `assess()` (bedrock.ts:118-129) forces `toolConfig` with a REQUIRED tool; the real scan then errors on every call → degrades to mock.
- **Root cause**: the test request is structurally different from (and looser than) the request `assess()` actually makes, so a passing test doesn't prove a passing scan.
- **Impact**: the settings UI green-checks a BYOM config that silently mocks every subsequent scan for that enterprise org — the exact privacy/quality path they paid for, reading as configured.
- **Fix sketch**: make the ping include the same `toolConfig` (required `report_assessment` tool) with a trivial prompt, so tool-capability is actually validated end-to-end.

## 7. Exported runClaudePrompt has no internal production guard — relies on every caller re-deriving the dead-code pattern
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: latent-failure
- **File**: src/lib/llm/claude-cli.ts:110
- **Scenario**: `LazyClaudeCliProvider.assess` (index.ts:50) hard-guards on `NODE_ENV !== "production"` so the prod build dead-code-prunes `child_process.spawn`. The new `runClaudePrompt` export has NO such internal guard — its safety lives entirely in the caller (consolidation-engine.ts, which correctly gates on `providerAvailable` + a dead-code import). A future caller that imports it without that dance would spawn `claude` in production and pull child_process into the file trace.
- **Root cause**: the local-dev-only invariant is enforced by convention at call sites, not by the function itself.
- **Impact**: none today (sole caller is guarded); a latent trap for the next integrator. Defense-in-depth.
- **Fix sketch**: add a top-of-function `if (process.env.NODE_ENV === "production") throw new Error("claude-cli is local-dev-only")`, matching `assess()`.
