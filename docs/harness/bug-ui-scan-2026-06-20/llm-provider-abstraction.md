> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

# LLM Provider Abstraction — combined bug+ui scan

## 1. claude-cli is "available" but always throws on any non-Vercel production deploy
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: config-mismatch / silent-degrade
- **File**: src/lib/llm/index.ts:111
- **Scenario**: A self-hosted production deploy (plain `next start` with `NODE_ENV=production`, Docker, ECS — anything that is NOT Vercel and so has no `process.env.VERCEL`) is configured with `LLM_PROVIDER=claude-cli`. `providerAvailable("claude-cli")` returns `!process.env.VERCEL` → `true`, and `getProvider()` hands back a `LazyClaudeCliProvider`. Its `assess()` (index.ts:48–53) is gated on `process.env.NODE_ENV !== "production"`, so in this prod build the dynamic-import branch is pruned/skipped and assess() **always throws** `"claude-cli is a local-dev-only provider…"`. Every primary + retry attempt throws; the scan degrades to mock on every single scan.
- **Root cause**: Two different signals decide "is claude-cli usable" — availability keys on `VERCEL`, but actual executability (the dead-code-pruned dynamic import) keys on `NODE_ENV`. A non-Vercel production host satisfies the first but fails the second, so the availability gate's whole purpose (skip a doomed provider, don't burn the budget) is defeated for the most common non-Vercel prod case.
- **Impact**: Operator sets a real provider, gets mock scores on every scan with no honest "this provider can't run here" up-front signal; wasted retry/failover budget per scan. Also affects the failover path: `providerByName("claude-cli")` (index.ts:167) returns a non-null provider that is guaranteed to throw in prod.
- **Fix sketch**: Make `providerAvailable("claude-cli")` reflect the same condition assess() enforces: `return process.env.NODE_ENV !== "production"` (claude-cli is dev/eval only by design). That correctly false-negatives every production host, so the picker degrades to mock cleanly and the failover skips it, instead of selecting a provider that always throws.

## 2. priceForModel mis-bills OpenAI-compatible models whose id starts with "sonnet"/"haiku"/"opus"/"gpt-4o"
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: cost-accounting / collision
- **File**: src/lib/llm/config.ts:49 (and 39–55, 103–113)
- **Scenario**: The OpenAI provider explicitly targets OpenAI-compatible endpoints (vLLM/Ollama/LM Studio per openai.ts header), where `OPENAI_MODEL` is operator-chosen. A self-hosted model named e.g. `opus-7b`, `haiku-router`, or `sonnet-local` persists as `engineModel` and is priced by `priceForModel` via `id.startsWith("opus")` → the Claude Opus row ($5 in / $25 out per MTok). A locally-hosted/free model is then billed in the /usage estimate at premium Claude rates.
- **Root cause**: The bare CLAUDE_MODEL aliases (`sonnet`/`haiku`/`opus`) are extremely short, generic prefixes matched by `startsWith` across ALL providers' persisted model ids, not just claude-cli ones. There is no provider scoping on the price row, so any model id beginning with those tokens collides.
- **Impact**: Confidently-wrong cost estimates for the exact OpenAI-compatible/self-hosted fleet the openai provider was added to support — the opposite of the file header's "never an invoice, but should be a credible estimate" intent.
- **Fix sketch**: Anchor the bare aliases so they only match an exact alias, not a prefix (e.g. store them as `{ prefix: "sonnet", exact: true }` and require `id === prefix` for `exact` rows), or scope alias rows to the claude-cli provider. The long Bedrock `anthropic.claude-*` rows already disambiguate and are unaffected.

## 3. OpenAI provider sends no max_tokens — verbose models truncate JSON and force avoidable degrade
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: robustness / truncation
- **File**: src/lib/llm/openai.ts:46–54
- **Scenario**: The request body sets `model`, `temperature`, `response_format`, and `messages`, but never `max_tokens`. Many OpenAI-compatible servers default to a small completion cap (vLLM/LM Studio commonly default to 256–512 tokens). A 9-dimension assessment with summaries/strengths/gaps easily exceeds that, so the JSON is truncated mid-object. `parseJsonLoose` then throws (or `validateAssessment` yields sub-coverage), the attempt fails, and the scan burns a retry + failover before degrading to mock — for a request that would have succeeded with a larger cap.
- **Root cause**: Bedrock budgets output explicitly (`BEDROCK_MAX_TOKENS`, default 4096) and Gemini relies on the API's generous default, but the OpenAI path inherits whatever the (often conservative) endpoint default is, with no knob.
- **Impact**: Systematic, silent degrade-to-mock for self-hosted OpenAI-compatible endpoints with small default caps; wasted retry/failover budget and latency per scan.
- **Fix sketch**: Add `max_tokens: Math.round(envNumber("OPENAI_MAX_TOKENS", 4096))` to the request body, mirroring the Bedrock `BEDROCK_MAX_TOKENS` convention already in config.ts.

## 4. MockProvider assessment cache can serve stale evidence on a tokened/failed re-scan of the same commit
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: caching / stale-data
- **File**: src/lib/llm/mock.ts:21–25 (assessKey) vs 27–40 (dimSummary)
- **Scenario**: The LRU key fingerprints `owner/name@headSha|archetype|<id:signalScore,…>`, but `dimSummary()` derives each dimension's `summary`, `strengths`, and `gaps` from `s.signals` (the evidence-label array) — which is NOT in the key — and the `failed` placeholder flag is also absent from the key. Two assessments of the same commit that yield identical numeric `signalScore`s but different evidence labels (e.g. a re-scan with a token now folding PR/governance evidence into the same final score, or a detector that previously `failed` and is now real) collide: the second call returns the first call's cached `strengths`/`summary` text.
- **Root cause**: The cache key assumes `signalScore` fully determines the rendered output, but the rendered strengths/summary/gaps depend on the label set and the `failed` flag, not just the score.
- **Impact**: A degraded/keyless report can show evidence strings that don't match the current scan's actual signals — quietly wrong narrative under the deterministic provider. Bounded blast radius (mock path, same commit) keeps this Medium.
- **Fix sketch**: Fold the evidence into the key — e.g. hash `s.signals.map(x => x.label).join("|")` and `s.failed` per dimension into `assessKey`, or key on the rendered driver set rather than the score alone.

## 5. cap()/asStringArray truncation can split a surrogate pair, emitting a lone surrogate
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: string-handling / edge-case
- **File**: src/lib/llm/provider.ts:66 (cap), 73–77 (asStringArray)
- **Scenario**: `cap(s)` does `s.slice(0, MAX_FIELD_LEN)` on a 2000-UTF-16-code-unit boundary. If position 2000 falls in the middle of a surrogate pair (emoji or astral-plane char common in model prose), the result ends in a lone high surrogate. That malformed string is then persisted and re-serialized into the DB row / SSE payload / PDF, where some JSON or PDF encoders throw or substitute U+FFFD.
- **Root cause**: Length-capping by UTF-16 code-unit index rather than by code point ignores surrogate-pair boundaries.
- **Impact**: Rare malformed-string artifacts in persisted/exported assessment fields; in strict encoders, a serialize failure. Low because it requires an astral char exactly at the 2000-unit boundary.
- **Fix sketch**: After slicing, drop a trailing lone surrogate (e.g. if the last code unit is in the 0xD800–0xDBFF range, slice one more off), or cap via `Array.from(s).slice(0, MAX_FIELD_LEN).join("")` to cap by code point.
