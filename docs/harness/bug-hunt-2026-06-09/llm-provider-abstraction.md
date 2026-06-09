# Bug Hunter Scan — LLM Provider Abstraction (ascent)

> Total: 7 findings (Critical: 0 | High: 3 | Medium: 3 | Low: 1)

## 1. Gemini/OpenAI timeout is per-`assess()`, not per-scan — retry+failover can run ~3× the configured timeout serially
- **Severity**: High
- **Category**: recovery-gap
- **File**: src/lib/llm/gemini.ts:36, src/lib/llm/openai.ts:41, src/lib/scan.ts:228
- **Scenario**: If the primary provider hangs and `LLM_FALLBACK_PROVIDER` is set, the scan runs plan = [primary, primary-retry, fallback]. Each step constructs its own `LLM_TIMEOUT_MS` (default 60s) timer inside `assess()`. A model that always stalls burns `60s + 500ms + 60s + 500ms + 60s` ≈ 181s before degrading to mock.
- **Root cause**: The timeout is scoped to a single provider call, but the orchestrator's resilience plan multiplies the number of calls. There is no scan-wide deadline. The SSE keepalive (route.ts:58) masks this by keeping the connection warm, so the user just waits 3 minutes with no provider-level cap they can reason about.
- **Impact**: UX degradation — multi-minute "Scoring with gemini…" stalls; on Vercel the function can hit the platform's hard timeout and 500 the whole scan before the mock degrade ever runs, so the user gets *nothing* instead of the deterministic floor.
- **Fix sketch**: Thread a single scan-level `AbortController` with one budget (e.g. `LLM_TOTAL_BUDGET_MS`) into every `attemptAssess` via `opts.signal`, or shrink per-attempt timeout when steps remain. Ensure the mock degrade is reached well before the platform timeout.

## 2. Mock fallback `assess()` is called without the AbortSignal — abandoned scans still compose & persist
- **Severity**: Medium
- **Category**: race-window
- **File**: src/lib/scan.ts:270
- **Scenario**: If the client disconnects after every real provider attempt has failed, the code reaches `usedProvider = new MockProvider(); assessment = await usedProvider.assess(scoreInput)` — note no `{ signal }`. The post-call `signal?.throwIfAborted()` at line 278 does catch it before compose, but only if the abort landed *before* that check; the abort that arrives during the (cached, synchronous-ish) mock assess is silently honored only by luck of ordering.
- **Root cause**: The fallback path drops the per-call options the primary path threads. Inconsistent signal propagation means the cancellation contract ("`signal` aborts the provider call", provider.ts:38) is not uniformly honored — the degrade path is the one most likely to run after a disconnect, yet it's the one that ignores the signal.
- **Impact**: Wasted compute (compose + DB persist for a report nobody receives); harmless correctness-wise but defeats the disconnect-honoring design the rest of scan.ts carefully implements.
- **Fix sketch**: Pass `{ signal }` to the mock fallback call too, and have `MockProvider.assess` honor `opts.signal` (cheap: check `signal?.throwIfAborted()` at entry) so the contract is uniform across providers.

## 3. claude-cli buffers child stdout/stderr unbounded — runaway CLI can OOM the Node process
- **Severity**: High
- **Category**: recovery-gap
- **File**: src/lib/llm/claude-cli.ts:84, 103-104
- **Scenario**: If the spawned `claude` CLI streams a very large (or runaway / looping) response, `out += d` and `err += d` accumulate the entire output into two unbounded strings until `close`. There is no size cap analogous to `json.ts`'s `MAX_RECOVERY_BYTES`. A multi-hundred-MB stdout (compromised binary, model emitting a giant `.result`, or a CLI that streams progress forever under SIGKILL-resistant conditions) grows the heap until the process OOMs.
- **Root cause**: `json.ts` deliberately caps recovery at 256KB to protect the event loop, but the subprocess layer that *feeds* it has no upstream byte cap. The trust boundary (untrusted/unbounded subprocess output) is unguarded; the downstream cap can't help because OOM happens during accumulation, before `parseJsonLoose` ever runs.
- **Impact**: Crash — a single misbehaving local CLI run tears down the whole Node server, not just the one scan.
- **Fix sketch**: Track a running byte count in the `on("data")` handlers; once `out.length` exceeds a bound (e.g. 4MB), `child.kill("SIGKILL")` and `reject(new Error("Claude CLI output too large"))`. Same for `err` (cap to a few KB — only `err.slice(0,200)` is ever used).

## 4. claude-cli timeout SIGKILLs the child but leaves stdin write to a dead pipe; envelope parse error swallows the real failure
- **Severity**: Medium
- **Category**: silent-failure
- **File**: src/lib/llm/claude-cli.ts:86-89, 47-49
- **Scenario**: On timeout the timer does `child.kill("SIGKILL"); reject("Claude CLI timed out.")`. But `runClaude` also resolves with `out` on a clean `close(0)`. If the CLI exits 0 having printed a partial/non-JSON envelope (e.g. auth prompt text on stdout, or a truncated stream), `JSON.parse(raw)` at line 47 throws and is caught → `throw new Error("Claude CLI did not return JSON envelope.")`. The actual stdout/stderr content (the diagnosable reason — "Please run /login", rate-limit text, etc.) is discarded.
- **Root cause**: The error path collapses every non-JSON outcome into one opaque message and drops `raw`/`err`, unlike `ProviderParseError` in json.ts which preserves a snippet. A subscription-auth failure (the single most common claude-cli failure mode) thus surfaces as a generic "no JSON envelope" with no actionable detail, and silently degrades to mock.
- **Impact**: UX degradation + debuggability loss — operators can't tell a timeout from an auth failure from a CLI-not-installed; all read as "model unavailable, deterministic scores."
- **Fix sketch**: Include `raw.slice(0, 300)` (and a `err` snippet) in the envelope-parse error, mirroring `ProviderParseError`. Distinguish exit-0-but-unparseable from is_error envelopes in the message.

## 5. `LLM_PROVIDER=claude-cli` (and `bedrock`/`openai`) NEVER degrades to mock on missing prerequisites — first real failure is a hard throw out of the picker, no keyless safety net
- **Severity**: High
- **Category**: recovery-gap
- **File**: src/lib/llm/index.ts:41-58, 50-51
- **Scenario**: `getProvider()` returns a `geminiOrMock()` only for the `gemini`/`auto` cases. For `claude-cli`, `bedrock`, and `openai` it returns the bare provider with no key/binary presence check. If an operator sets `LLM_PROVIDER=claude-cli` on a host where `claude` isn't installed (e.g. accidentally deployed to Vercel), `intendedProvider !== "mock"`, so scan.ts *does* eventually degrade to mock — BUT only after the spawn `error` event rejects on every plan step (primary + retry), each preceded by a 500ms sleep. Worse: `providerByName` used for the fallback returns these same unchecked providers, so a `bedrock → openai` failover can pick an `openai` provider whose `OPENAI_API_KEY` is unset, guaranteeing a second wasted round-trip that always throws.
- **Root cause**: Only Gemini has the "construct mock instead when the prerequisite is absent" shortcut. The other three trust that selecting them implies their prerequisites exist, so a misconfiguration spends the full retry/failover budget proving the obvious instead of failing fast or pre-degrading.
- **Impact**: UX degradation (multi-second stall before the inevitable mock) and noisy `console.error` per attempt; on a constrained serverless timeout it can exhaust the budget (see #1) and 500 instead of degrading.
- **Fix sketch**: Give bedrock/openai/claude-cli a cheap synchronous `isAvailable()` (key present / binary resolvable) checked in `getProvider`/`providerByName`; when unavailable, either return mock (for the picker) or null (for the fallback) so the orchestrator skips a doomed attempt.

## 6. `validateAssessment` caps field LENGTH but not array element COUNT before slice → multi-MB transient allocation from a hostile/verbose reply
- **Severity**: Low
- **Category**: untrusted-parse
- **File**: src/lib/llm/provider.ts:62-68, 89-113
- **Scenario**: A model (or prompt-injected payload) returns `dimensions` as an array of 1,000,000 entries, each a valid object. The loop at line 90 iterates every element building `dims` (only `id`/score filtering trims it, not a count cap), and `asStringArray` runs `.filter().map(cap).slice()` over each element's `strengths`/`gaps` arrays of arbitrary length *before* slicing to 6. The final `dims` array is never length-capped (unlike `roadmap.slice(0,6)` / `discrepancies.slice(0,8)`).
- **Root cause**: The comment at line 55-59 claims field SIZE is now bounded, but element COUNT for the top-level `dimensions` array is not — only `roadmap` and `discrepancies` get a trailing `.slice`. The `asStringArray` work is done in full before its own slice. There are only ~9 valid dimension ids, but duplicates with valid ids all pass `VALID_DIM_IDS.has`, so a million-element array of `{id:"D1",score:1}` survives validation entirely.
- **Impact**: UX degradation / transient memory spike — a bloated `dimensions` array bloats the persisted row, SSE payload, and UI (the engine de-dupes by id only downstream, if at all). The 256KB recovery cap in json.ts does NOT apply when the reply parses on the fast path (line 81), so a clean 50MB JSON array sails through.
- **Fix sketch**: De-dupe `dims` by `id` and/or `dims.slice(0, DIMENSIONS.length)` after the loop; cap `asStringArray` input length before mapping (`v.slice(0, max)` first, then filter/cap).

## 7. Bedrock tool-input string repair re-throws `ProviderParseError` instead of falling through to the text path, defeating its own safety net
- **Severity**: Medium
- **Category**: silent-failure
- **File**: src/lib/llm/bedrock.ts:84-98
- **Scenario**: If the model returns the assessment as a `toolUse.input` that is a non-empty STRING but the string is malformed JSON (truncated tool args — observed on long Converse responses), line 90 calls `parseJsonLoose(input)`, which THROWS `ProviderParseError`. Because that throw escapes the `for` loop entirely, the text-extraction fallback at lines 96-98 is never reached even when the model ALSO put a recoverable assessment in a text block — and the whole `assess()` rejects.
- **Root cause**: The comment (line 87-89) intends "Repair-parse a string first; only short-circuit on a real object, else fall through to the text path" — but a *throw* from `parseJsonLoose` is not "falling through," it aborts the method. The string-repair branch can't fail soft. (Net effect is still a degrade-to-mock at the scan layer, but it discards a possibly-recoverable text block and loses the structured `toolUse` diagnostic.)
- **Impact**: Wrong score / lost recovery — a Bedrock response that *did* answer (recoverably) degrades to the deterministic mock floor under the bedrock name, when the text-path safety net would have salvaged it.
- **Fix sketch**: Wrap the string-repair in `try { return validateAssessment(parseJsonLoose(input)); } catch { /* fall through to text path */ }` so a malformed tool-input string doesn't bypass the text fallback.
