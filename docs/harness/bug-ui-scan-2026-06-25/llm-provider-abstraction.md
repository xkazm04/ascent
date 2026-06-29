# LLM Provider Abstraction — Bug + UI Scan
> Context: LLM Provider Abstraction (Repository Scanning & Scoring)
> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

This is a pure backend/lib context — no UI surface, so all findings are bug-hunter. The context is already heavily hardened (per-call timeouts, usage attribution, validateAssessment guards, provider-availability honesty all have regression suites). The findings below are the gaps those suites do not yet cover.

## 1. BYOM scan silently falls back to the platform provider, breaching the privacy contract
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure
- **File**: src/lib/llm/index.ts:185-201 (specifically `.catch(() => null)` at 192 and the unconditional fallback `getProvider(opts)` at 200)
- **Value**: impact 7 · effort 4 · risk 5
- **Scenario**: An Enterprise org enables BYOM (Bedrock-in-their-AWS-account) precisely so private repo contents never leave their boundary. Later the `ENCRYPTION_KEY` is rotated, the stored credential blob can't be decrypted, or the DB read hiccups. `resolveByomProvider` is designed to return `null` on ANY such failure (org-llm.ts:234 catch), and `getProviderForOrg` adds its own `.catch(() => null)`. Both collapse "BYOM configured but unresolvable" into the same path as "no BYOM", so the scan proceeds via the env provider — which may be Gemini or an OpenAI-compatible endpoint — sending the org's private source outside their AWS boundary with `byom:false`, no error, and no caveat. The `/connect` PrivacyNotice may even still promise Bedrock.
- **Root cause**: The BYOM path is fail-OPEN. A resolution failure is treated as "no BYOM" rather than "BYOM intended but broken". The two are indistinguishable to `getProviderForOrg`.
- **Impact**: Data-governance/privacy breach for the exact customers who paid for in-boundary inference; the failure is completely silent.
- **Fix sketch**: Have the resolver/factory distinguish "BYOM not configured" from "BYOM active but unresolvable". When `isByomActive(orgSlug)` is true but creds fail to resolve, fail CLOSED — return the MockProvider (no external send) and surface a warning/SSE caveat — instead of routing through the platform provider.

## 2. OpenAI provider sets no `max_tokens`, so self-hosted endpoints truncate the JSON → silent mock degrade
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/lib/llm/openai.ts:44-56 (request body — no `max_tokens`)
- **Value**: impact 6 · effort 2 · risk 2
- **Scenario**: The module explicitly targets OpenAI-compatible self-hosted servers (vLLM, Ollama, LM Studio — see header comment). Many default to a small completion cap (e.g. Ollama's `num_predict` ≈ 128). The assessment JSON for 8-9 dimensions plus roadmap/discrepancies is multi-KB, so the reply is truncated mid-object. `parseJsonLoose` then recovers nothing usable (or a partial object), `isAssessmentUsable` falls below 50% coverage, and scan.ts degrades to the mock floor — under the "openai" provider name, with no obvious cause. Bedrock sets `maxTokens` (4096, bumped for thinking) and Gemini relies on a high native default; OpenAI alone sets nothing.
- **Root cause**: The output-length budget that the other real providers set explicitly was omitted here, and the targeted compatible servers don't default to a generous cap.
- **Impact**: Every scan against an under-capped compatible endpoint silently produces mock-quality scores branded as a real LLM.
- **Fix sketch**: Add `max_tokens: Math.round(envNumber("OPENAI_MAX_TOKENS", 4096))` to the request body (mirroring `BEDROCK_MAX_TOKENS`), so the response has room to complete.

## 3. validateAssessment iterates the FULL roadmap/discrepancies arrays before trailing-slicing (unbounded work)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/lib/llm/provider.ts:152-187 (roadmap loop 152-175, discrepancies loop 177-187; contrast the pre-slice for `dimensions` at 125)
- **Value**: impact 5 · effort 2 · risk 1
- **Scenario**: `dimensions` and every string array were hardened to PRE-SLICE the input (line 125 slices to `DIMENSIONS.length*4`; `asStringArray` pre-slices to `max*4`) precisely so a hostile reply can't force a giant transient allocation. `roadmap` and `discrepancies` were left as full-iterate-then-`.slice(0,6)`/`.slice(0,8)` at the end (the dimensions comment even notes "roadmap/discrepancies are trailing-sliced"). validateAssessment is the runtime safety net for UNCONSTRAINED replies — OpenAI uses `json_object` (not a strict schema), and any provider can be prompt-injected via scanned repo file contents fed into the user message. A reply carrying a multi-million-element `roadmap` array is fully walked (each element building a capped object via cap/asStringArray/validLevelUnlock) before the slice, pinning the single-threaded event loop and spiking heap.
- **Root cause**: The input-bounding hardening applied to `dimensions`/strings was never extended to the two remaining model-supplied arrays.
- **Impact**: A single hostile/injected scan can stall the whole Node server for other requests.
- **Fix sketch**: Pre-slice `obj.roadmap`/`obj.discrepancies` to a small headroom (e.g. `.slice(0, 6*4)` / `.slice(0, 8*4)`) before the loop, exactly as `dimensions` does.

## 4. MockProvider caches and returns SHARED mutable arrays that escape into the report by reference
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/lib/llm/mock.ts:52-58, 94 (cache returns the stored object); consumer aliasing in src/lib/scoring/engine.ts:197-200
- **Value**: impact 5 · effort 3 · risk 4
- **Scenario**: The mock LRU returns the SAME `LlmAssessment` object reference on a cache hit. Its comment asserts safety because "callers read it and copy fields into a fresh report" — but the primary consumer doesn't copy the arrays: engine.ts assigns `strengths: assessment.strengths`, `risks: assessment.risks`, `roadmap` (the `assessment.roadmap` reference), and `discrepancies: assessment.discrepancies` straight into the returned report (lines 197-200). Any downstream in-place mutation of `report.roadmap`/`report.strengths` (a reorder, a `.sort()`, a `.push()`) therefore mutates the mock's cached arrays, so the NEXT keyless scan of the same commit+signals (a degrade-to-mock fallback or a re-scan) returns the corrupted/reordered data.
- **Root cause**: An immutability contract that is documented but unenforced; the cache hands out live references and the engine aliases rather than clones them.
- **Impact**: Cross-scan cache poisoning for keyless/degraded scans — non-deterministic results from a provider whose entire value proposition is determinism.
- **Fix sketch**: Freeze the cached result (`Object.freeze` the object and its arrays) or return a shallow clone on hit; alternatively have the engine clone the arrays it copies in. Freezing is cheapest and will surface any offending mutation immediately in dev.

## 5. cap() can split a UTF-16 surrogate pair, leaving a lone surrogate in a persisted field
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/lib/llm/provider.ts:72-73 (`cap` uses `s.length`/`s.slice(0, MAX_FIELD_LEN)`)
- **Value**: impact 2 · effort 2 · risk 1
- **Scenario**: A model emits a headline/summary that crosses the 2000 code-unit boundary exactly at an astral character (emoji, CJK extension B, etc.). `s.slice(0, 2000)` cuts between the high and low surrogate, leaving a lone unpaired surrogate (\uD800–\uDBFF) at the end of the stored string. That code unit is invalid UTF-16 and can break strict JSON re-serialization, corrupt the DB column, or render as a replacement glyph downstream.
- **Root cause**: Length-based truncation operates on UTF-16 code units with no surrogate-pair awareness.
- **Impact**: Rare cosmetic/serialization corruption of an assessment text field.
- **Fix sketch**: After slicing, strip a trailing lone high surrogate (if the last char code is in 0xD800–0xDBFF, drop it), or use a grapheme/code-point-aware truncation.
