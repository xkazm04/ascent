# Feature Scout — LLM Provider Abstraction

> Total: 6
> Critical: 0 | High: 3 | Medium: 2 | Low: 1

## 1. Capture and meter LLM token usage / cost per scan
- **Severity**: High
- **Category**: feature
- **File**: src/lib/llm/gemini.ts:67 (Gemini), src/lib/llm/bedrock.ts:73 (Bedrock), surfaces in src/lib/db/usage.ts:35
- **Gap**: Both real providers throw away the token-usage payload the SDK already returns. Gemini reads only `response.text` (gemini.ts:67) and never touches `response.usageMetadata`; Bedrock reads `res.output.message.content` (bedrock.ts:75) and ignores `res.usage` (input/output token counts). The metering layer (`getUsageSummary`) only counts *rows per provider* (`byProvider` = `ProviderUsage { provider, count }`, usage.ts:9-12, 100-102) — there is no concept of tokens spent or dollar cost anywhere. `LlmAssessment` (types.ts:202) and the `engine: { provider, model }` report stamp (types.ts:325) carry no usage field.
- **User value**: Org admins and the SaaS operator get true cost-of-goods per scan instead of a raw scan count, enabling accurate usage-based billing, per-org cost dashboards, and "you've used $X of Bedrock spend this month" — the difference between metering *volume* and metering *value*. Directly strengthens the existing `/usage` page.
- **Implementation sketch**: Add an optional `usage?: { inputTokens; outputTokens }` to the value `assess()` returns (or a side channel on the provider), read `response.usageMetadata`/`res.usage` in the two SDK providers, thread it through `scan.ts:164` into the persisted Scan row alongside `engineProvider`, and extend `getUsageSummary` to sum tokens and apply a per-model price table.
- **Effort**: M

## 2. Bounded retry with provider failover before degrading to mock
- **Severity**: High
- **Category**: automation
- **File**: src/lib/scan.ts:163-196
- **Gap**: The scan does a single-shot `provider.assess()` and on ANY throw or unusable response drops straight to the deterministic mock (scan.ts:164-195). There is no retry, no backoff, and no failover to a second provider — even though the codebase already has a reusable backoff helper for transient failures (`fetchCommitActivity`'s 202 backoff in github/governance.ts:107-120 and the DSQL `withRetry` exponential-backoff-with-jitter in db/client.ts:173-196). A transient 429/503 or one-off timeout from Gemini permanently downgrades that scan to the no-nuance floor and stamps a user-visible "AI analysis was unavailable" warning (scan.ts:217-221).
- **User value**: Paying users get a real AI report far more often. A momentary rate-limit blip no longer silently strips the qualitative analysis they're paying for, and an enterprise on `bedrock` could fail over to `gemini` (or vice versa) rather than to the mock.
- **Implementation sketch**: Wrap `assess()` in a small retry (1-2 attempts, jittered backoff, retry only on transient/timeout errors — reuse the `withRetry` pattern from db/client.ts) and, on exhaustion, optionally try a configured `LLM_FALLBACK_PROVIDER` via `getProvider` before the final mock degrade. Skip retry on abort (the `signal?.aborted` branch already exists at scan.ts:177).
- **Effort**: M

## 3. Add an OpenAI / Azure-OpenAI / generic-endpoint provider
- **Severity**: High
- **Category**: integration
- **File**: src/lib/llm/index.ts:28 (provider registry), src/lib/types.ts:8 (`ProviderName`)
- **Gap**: `ProviderName` is a closed union of `"gemini" | "bedrock" | "mock" | "claude-cli"` (types.ts:8) and the selector hard-codes exactly those four (index.ts:28). Grepping the repo confirms no OpenAI, Azure-OpenAI, Vertex, or Ollama integration exists. Yet the abstraction is already provider-agnostic: every provider just implements `assess()` and the JSON contract is centralized in `schema.ts` (`ASSESSMENT_JSON_SCHEMA`) with both a native-structured-output path (Gemini) and a tool-calling path (Bedrock) to copy from.
- **User value**: The most-requested enterprise LLM today is OpenAI/Azure-OpenAI; teams standardized on it (or on a self-hosted OpenAI-compatible endpoint like vLLM/Ollama) currently cannot run real scans at all. An OpenAI provider with `response_format: json_schema` reuses the existing schema verbatim and unlocks a large buyer segment with near-zero new contract work.
- **Implementation sketch**: Add `src/lib/llm/openai.ts` implementing `LLMProvider` using `response_format: { type: "json_schema", json_schema: ASSESSMENT_JSON_SCHEMA }`, support an `OPENAI_BASE_URL` override for Azure/self-hosted, extend `ProviderName` and the `resolveProviderChoice` allow-list (index.ts:28), and register it in the `getProvider` switch.
- **Effort**: M

## 4. Provider preflight / health-check endpoint and "test connection"
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/llm/index.ts:22 (`hasLlmKey`), src/lib/llm/provider.ts:34 (interface)
- **Gap**: The only readiness check is `hasLlmKey()`, which merely tests for a Gemini env var (index.ts:22-24). It does not validate Bedrock AWS credentials/region, the `claude` CLI binary's presence, or that the configured model id is actually reachable — those failures only surface mid-scan as a thrown error that silently degrades to mock (scan.ts:182-195). There is no `LLMProvider.healthCheck()` method and no admin route to verify "is my configured provider actually working?" before a user runs a scan.
- **User value**: Operators and enterprise admins configuring Bedrock/Claude-CLI get an immediate, explicit "credentials OK / model reachable" signal instead of discovering a misconfiguration only when every scan mysteriously returns deterministic-only results. Eliminates a frustrating silent-failure class.
- **Implementation sketch**: Add an optional `healthCheck(): Promise<{ ok; detail? }>` to the `LLMProvider` interface (cheap: Bedrock `ListFoundationModels` or a tiny ping, claude-cli `claude --version`, Gemini a 1-token call), and expose a small admin/settings route that calls `getProvider().healthCheck()` and renders status — mirroring how `isAppConfigured()` already gates GitHub-App features.
- **Effort**: M

## 5. Per-provider/model temperature, token, and timeout overrides via env
- **Severity**: Medium
- **Category**: feature
- **File**: src/lib/llm/gemini.ts:53, src/lib/llm/bedrock.ts:54
- **Gap**: Temperature is hard-coded to `0.2` in both Gemini (gemini.ts:53) and Bedrock (bedrock.ts:54), and Bedrock's `maxTokens` is hard-coded to `4096` (bedrock.ts:54). Only the model id and timeout are env-configurable today (gemini.ts:39, bedrock.ts:34, claude-cli.ts:22). A larger monorepo's assessment can be truncated by the fixed 4096-token cap with no escape hatch, and there's no way to tune determinism without editing source.
- **User value**: Power users / operators tuning quality vs. cost (raise `maxTokens` for big-repo reports, nudge temperature for more/less conservative scoring) can do so per deployment without a code change — consistent with the existing `GEMINI_MODEL` / `BEDROCK_MODEL_ID` / `LLM_TIMEOUT_MS` env convention.
- **Implementation sketch**: Read `LLM_TEMPERATURE` and `BEDROCK_MAX_TOKENS` (with the current values as defaults) where the literals live now (gemini.ts:53, bedrock.ts:54). Trivial, additive, and backward-compatible.
- **Effort**: S

## 6. Capture and surface model-reported confidence per dimension
- **Severity**: Low
- **Category**: user_benefit
- **File**: src/lib/llm/schema.ts:34-44, src/lib/llm/provider.ts:86-92
- **Gap**: The assessment schema and `validateAssessment` capture `score/summary/strengths/gaps` per dimension (schema.ts:36-43, provider.ts:86-92) but no confidence/uncertainty signal. The engine already distinguishes `signalScore` vs `llmScore` (types.ts:221-222) and even has a discrepancy channel where the LLM flags detectors it thinks are wrong (`Discrepancy`, types.ts:197) — so the report is built to reason about disagreement, but nothing lets the model say "I'm only weakly confident in this dimension because evidence was thin."
- **User value**: Readers can weight a low-confidence AI score appropriately (e.g., a sparse repo where the model is guessing) instead of treating every blended score as equally trustworthy — improving the credibility of the report's most subjective dimensions.
- **Implementation sketch**: Add an optional `confidence: { type: "string", enum: ["high","medium","low"] }` to the dimension schema (schema.ts:36) and coerce it in `validateAssessment` (provider.ts:86) with a default; surface it as a subtle badge in the dimension UI. Mock can derive it from signal density.
- **Effort**: S
