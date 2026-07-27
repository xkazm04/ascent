# LLM Provider Abstraction — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. A typo'd LLM_PROVIDER silently falls back to "auto", defeating the module's own fail-loud philosophy
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/lib/llm/index.ts:66`
- **Scenario**: `resolveProviderChoice()` maps any unrecognized `LLM_PROVIDER` value (e.g. `bedrok`, `claude`, `Bedrock ` with trailing chars other than case) to `"auto"` with no log or warning. The rest of the file is built around the opposite principle — getProvider's bedrock/openai/gemini branches contain long comments explaining why an explicit-but-misconfigured selection must fail LOUD at assess() rather than degrade silently ("success theater"). But a misspelling of the provider *name itself* — the most likely operator error — bypasses all of that and quietly becomes auto → Gemini-or-mock.
- **Root cause**: The allow-list membership check treats "unknown value" and "unset" identically; the fail-loud hardening was applied one layer down (provider construction) but not at the choice-parsing layer.
- **Impact**: An enterprise deploy intending `LLM_PROVIDER=bedrock` (the privacy path — inference inside the AWS boundary) that fat-fingers the value silently scores private repository source through Gemini or serves mock scores, with `intendedProvider` reporting a provider the operator never chose. This is exactly the boundary breach the BYOM path fails closed on (index.ts:226-233), yet a one-character env typo reproduces it with zero signal.
- **Fix sketch**: On an unrecognized non-empty `LLM_PROVIDER`, either throw at first use ("Unknown LLM_PROVIDER \"bedrok\" — expected one of …") or at minimum `console.warn` once and record the raw value so it surfaces in scan telemetry. Add a unit case to `index.test.ts` pinning the behavior.

## 2. claude-cli timeout knob uses the exact env-parsing anti-pattern config.ts was created to eliminate
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/lib/llm/claude-cli.ts:25`
- **Scenario**: `CLI_TIMEOUT_MS = Number(process.env.CLAUDE_CLI_TIMEOUT_MS) || 600_000` is (a) evaluated at module load, so tests/ops can't restub it (config.ts's `llmTimeoutMs` doc explicitly calls out "read at CALL time … without module-load ordering games"); (b) the `Number(env) || default` idiom that config.ts:33 names as a bug ("coerced a deliberately-configured 0 back to the default") — here `CLAUDE_CLI_TIMEOUT_MS=0` yields 600s, a blank/garbage value yields NaN→600s silently; (c) unfloored, so `CLAUDE_CLI_TIMEOUT_MS=5` kills every CLI run in 5ms → silent mock degrade, precisely the failure class `MIN_LLM_TIMEOUT_MS` exists to prevent for the other four providers. Additionally, config.ts:22-24 documents scan.ts's total budget as 90s and forbids unbounded calls for that reason, while this provider defaults to 600s — the relationship (does the scan budget stretch for claude-cli? is the failover starved?) is stated nowhere.
- **Root cause**: claude-cli.ts predates the config.ts consolidation and was never migrated; the divergent scan-budget interaction was left implicit.
- **Impact**: Inconsistent knob semantics across providers (0 means "misconfig→floor" for four providers, "default" for the fifth); tiny values silently route all local-dev scans to mock; the 600s-vs-90s budget assumption is unverifiable from this module.
- **Fix sketch**: Replace with a call-time `Math.max(MIN, envNumber("CLAUDE_CLI_TIMEOUT_MS", 600_000))` from config.ts, and add one sentence documenting how scan.ts's budget accommodates (or doesn't) the 10-minute CLI default.

## 3. Timeout is floored against misconfiguration, but temperature and max-token knobs accept values that fail every call
- **Severity**: Medium
- **Category**: edge-case-gap
- **File**: `src/lib/llm/config.ts:46`
- **Scenario**: `llmTimeoutMs()` got an elaborate `MIN_LLM_TIMEOUT_MS` floor because "a 0/negative/tiny timeout is a misconfiguration" that silently routed 100% of scans to mock. The sibling knobs have no equivalent guard: `LLM_TEMPERATURE=5` (Gemini/OpenAI reject >2 with a 400) or `-1`, and `BEDROCK_MAX_TOKENS=0` / `OPENAI_MAX_TOKENS=0` / negative (bedrock.ts:101, openai.ts:55, openrouter.ts:56) flow straight into the request and make every real-provider call fail — producing the identical hard-to-diagnose "all scans quietly degrade to the deterministic floor" symptom the timeout floor was built to kill. Bonus drift: openrouter.ts:52 inlines `envNumber("LLM_TEMPERATURE", 0.2)` instead of calling `llmTemperature()`, contradicting that function's "the single source the real providers read" contract.
- **Root cause**: Hardening was applied per-incident (timeout) rather than as a policy across the knob family; OpenRouter was added after `llmTemperature()` was written and didn't adopt it.
- **Impact**: One bad env value → 100% mock scans disclosed only by a generic caveat; the module's own docs promise a consistency ("same parsing rules as every other knob") the knobs don't actually share.
- **Fix sketch**: Clamp `llmTemperature()` to [0, 2] and floor the max-token reads (e.g. `Math.max(256, …)`) in config.ts helpers (`llmMaxTokens(envName)`), and route OpenRouter through `llmTemperature()`.

## 4. Provider label vocabulary is missing "openai" and "openrouter" — raw ids leak into the usage dashboard and executive briefing
- **Severity**: Medium
- **Category**: visual-inconsistency
- **File**: `src/lib/llm/config.ts:90`
- **Scenario**: `PROVIDER_LABEL` — documented as "the single source for the /usage 'By inference engine' bars and the executive briefing's 'Scored by' provenance line" — covers claude-cli/claude/gemini/bedrock/mock but not `openai` or `openrouter`, both first-class members of `ProviderName` that persist their name into scans. `providerLabel()` falls back to the raw id, so an OpenAI/OpenRouter deploy renders lowercase "openai" / "openrouter" next to polished labels like "AWS Bedrock" and "Mock (deterministic)". The stale five-provider inventories in provider.ts:1-7 and index.ts:2-11 headers (neither lists OpenRouter) show the same add-a-provider drift.
- **Root cause**: The map is typed `Record<string, string>` instead of `Record<ProviderName, string>` (plus the extra "claude" id), so TypeScript cannot flag a missing entry when the union grows.
- **Impact**: Casing/naming inconsistency on the two provenance surfaces executives actually read; every future provider addition will silently repeat it.
- **Fix sketch**: Add `openai: "OpenAI"` and `openrouter: "OpenRouter"`; retype as `Record<ProviderName, string> & Record<string, string>` (or a satisfies-checked base map) so exhaustiveness is compiler-enforced; refresh the two header comment inventories.

## 5. MockProvider's memoization key omits the signal labels its output is built from
- **Severity**: Low
- **Category**: edge-case-gap
- **File**: `src/lib/llm/mock.ts:36`
- **Scenario**: `assessKey()` fingerprints `owner/name@headSha|archetype|id:signalScore,…` and the comment asserts it covers "the actual drivers." But `dimSummary()` derives each dimension's summary/strengths from `s.signals[].label`, which is not in the key. Two scans of the same commit whose per-dimension *scores* tie while the underlying *signal sets* differ (e.g. a tokened scan that adds a PR-review signal and loses another, netting the same score; or a signal-battery version change that relabels checks without moving scores) collide and return the first scan's cached prose — deep-frozen, so it's confidently wrong rather than mutated-wrong.
- **Root cause**: The key was designed around score-affecting inputs; label-only variation was an unconsidered edge case for a "deterministic" provider whose text output is label-driven.
- **Impact**: Rare but silent: a re-scan can show strengths naming signals that weren't detected in that run, undermining the mock's determinism-and-honesty value proposition. Bounded blast radius (50-entry LRU, same repo+sha only).
- **Fix sketch**: Fold a cheap label digest into the key — e.g. `s.signals.map(x => x.label).join("|")` hashed, or count+first-label per dimension — or key on a hash of the full `DimensionSignals` JSON.
