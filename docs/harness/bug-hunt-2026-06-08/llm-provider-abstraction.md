# Bug Hunter — LLM Provider Abstraction (ascent)

> Total: 7 findings (Critical: 1, High: 3, Medium: 2, Low: 1)
> Files read: 12
> Scope: src/lib/llm/*

## 1. Quadratic balanced-brace rescan stalls the scan on adversarial / truncated model output
- **Severity**: Critical
- **Category**: code_quality
- **File**: src/lib/llm/json.ts:99-114 (balancedParse) + json.ts:29-53 (extractBalanced)
- **Scenario**: A model (or a man-in-the-middle / prompt-injected repo that steers the model) returns a large reply full of unclosed structural characters — e.g. tens of thousands of bare `{` with no matching `}`, or a single huge truncated object. `JSON.parse` fast path fails, no fence matches, so `balancedParse` runs: for EVERY `{`/`[` index it calls `extractBalanced`, which on an unbalanced tail scans all the way to end-of-string returning `null`, then advances to the next structural char and rescans to the end again. With N opening braces that is O(N²) character visits. A few-MB reply (Gemini/Bedrock/OpenAI can legitimately emit large bodies; `BEDROCK_MAX_TOKENS` is tunable up) turns into hundreds of millions of iterations on the single-threaded Node event loop.
- **Root cause**: The "try every structural start until one parses" recovery assumes failures are cheap, but each failed start is a full O(N) scan with no memoization of "no balanced value exists from here", and no input-size ceiling before entering the recovery scan.
- **Impact**: silent failure / UX degradation — a synchronous CPU stall blocks the request (and, on a serverless function, the whole instance), starving other concurrent scans and eventually hitting the function duration limit; the per-request AbortSignal cannot interrupt a synchronous loop.
- **Fix sketch**: Cap the input length before recovery (e.g. bail to ProviderParseError above ~256KB), and short-circuit `balancedParse` once `extractBalanced` reports the remaining text has more opens than closes — or limit the number of start positions attempted.

## 2. Gemini/Bedrock/OpenAI request keeps running (and billing) after the client-side timeout fires
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/llm/gemini.ts:19-67 (withTimeout) ; mirrored in openai.ts:38-72
- **Scenario**: `withTimeout` in gemini.ts rejects the outer promise after `LLM_TIMEOUT_MS`, but it never aborts the underlying `generateContent` call — only `opts.signal` (client disconnect) is wired to `abortSignal`. So when a model hangs past 60s, the scan proceeds to retry/fallback while the original Gemini request is still open in the background, consuming tokens and a socket. Under load this doubles in-flight requests on every timeout (timed-out original + retry), accelerating rate-limit exhaustion and cost — a retry storm that masks the original hang.
- **Root cause**: Timeout is implemented as a promise race, not as cancellation. The timer rejects the wrapper but has no handle to cancel the request it was guarding.
- **Impact**: silent failure / cost leak — orphaned, still-billing model calls; rate-limit pressure that makes the timeout self-perpetuating.
- **Fix sketch**: Drive the timeout through an `AbortController` whose `abort()` the timer calls, and pass that signal (combined with `opts.signal`) to `generateContent`/`fetch`, so a timeout actually cancels the request (OpenAI already aborts but should clear its own pending request similarly).

## 3. Token usage from a FAILED attempt is billed against the report after degrading to mock
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/scan.ts:177-186, 240-241, 260 + gemini.ts:71-72 / bedrock.ts:79-93 / openai.ts:68-69
- **Scenario**: Gemini calls `opts.onUsage(...)` at line 71 BEFORE `validateAssessment(parseJsonLoose(text))` at line 72. If the reply is malformed JSON, `parseJsonLoose` throws AFTER usage was already captured into `capturedUsage`. The attempt is counted as a failure, retry/fallback also fail, the scan degrades to `MockProvider` (which never calls `onUsage`), and `report.usage = { ...capturedUsage, latencyMs }` then persists the failed attempt's input/output tokens. The user is billed/metered for tokens on a scan whose AI layer "was unavailable." Same ordering hazard in OpenAI (onUsage before the empty-text/parse path is moot, but usage survives a later parse throw) and Bedrock (onUsage at line 79 before tool/text extraction can throw at line 92/93).
- **Root cause**: `onUsage` is invoked optimistically before the response is proven usable, and `capturedUsage` is a last-writer-wins variable with no "commit only on the winning attempt" semantics. The comment in scan.ts claims "a thrown attempt never reports," which is false for providers that report usage before parsing.
- **Impact**: wrong cost metering / silent over-billing — usage attributed to a scan that produced only deterministic mock scores.
- **Fix sketch**: Capture usage into a per-attempt local and only fold it into `capturedUsage` after `attemptAssess` returns successfully (i.e. assign usage inside the same scope that resolves), or call `onUsage` only after `validateAssessment` succeeds.

## 4. claude-cli writes to child stdin with no error handler — early child exit raises an unhandled EPIPE that crashes the process
- **Severity**: High
- **Category**: code_quality
- **File**: src/lib/llm/claude-cli.ts:58-109 (runClaude), specifically 107-108
- **Scenario**: `child.stdin.write(stdin)` / `child.stdin.end()` run unconditionally. If `claude` exits immediately (binary missing despite `shell:true`, bad `--model`, auth failure, or it closes stdin early), writing to a closed pipe emits an `error` event on `child.stdin`. Only `child` and `child.stdout`/`stderr` `data`/`close`/`error` are handled — the stdin stream has no `'error'` listener, so an `EPIPE`/`ERR_STREAM_DESTROYED` becomes an unhandled `'error'` event and an uncaught exception that tears down the Node process (the whole server), not just the scan. The prompt is also large (full system+user), increasing the odds the write is still in flight when the child dies.
- **Root cause**: stdin is treated as fire-and-forget; the failure mode of an immediately-dying child process (a normal occurrence for an external CLI) isn't handled on the write side.
- **Impact**: crash — a single bad claude-cli invocation can crash the host process instead of failing one scan.
- **Fix sketch**: Attach `child.stdin.on("error", reject)` (and guard with `if (!child.stdin.destroyed)`) before writing, so a broken pipe rejects the promise like any other CLI failure.

## 5. claude-cli runs through a shell with env-derived argv (`shell: true` + model) — command-injection / arg-injection surface
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/llm/claude-cli.ts:64-74
- **Scenario**: The child is spawned with `shell: true`, and both the binary (`CLAUDE_CLI_PATH`) and the model argument (`CLAUDE_MODEL`, default `sonnet`) flow into the shell command line. `shell:true` means the args are concatenated and re-parsed by the shell, so a value like `sonnet; rm -rf x` or `$(...)` in `CLAUDE_MODEL`/`CLAUDE_CLI_PATH` is interpreted by the shell rather than passed literally. Even if these are operator-set today, this is a config-injection landmine the moment provider/model becomes per-request or org-configurable (the abstraction's whole point is config-driven model selection). Note: the spawn intentionally `delete env.ANTHROPIC_API_KEY` to force subscription auth — verify that matches current Claude CLI behavior, since headless API runs may otherwise be expected.
- **Root cause**: `shell: true` (added for Windows `.cmd` resolution) defeats spawn's normal argv isolation, turning every argv element into shell-parsed text.
- **Impact**: security/leak — potential arbitrary command execution if any of these env values become attacker- or tenant-influenced.
- **Fix sketch**: Drop `shell:true` and resolve the Windows `.cmd` explicitly (e.g. spawn `cmd /c claude ...` only with a hard-coded, validated binary, or use an absolute path), keeping all dynamic values strictly as argv array elements.

## 6. Unbounded model-supplied strings pass straight through validateAssessment into the persisted report
- **Severity**: Medium
- **Category**: code_quality
- **File**: src/lib/llm/provider.ts:55-153 (asStringArray / summary / headline coercion)
- **Scenario**: `validateAssessment` trims and caps the *count* of array elements (`max=6`, roadmap 6, discrepancies 8) but never caps the *length* of any individual string — `summary`, `headline`, each `strengths`/`gaps`/`risks` entry, `rationale`, `claim`. A model that emits a multi-megabyte `summary` (hallucinated repetition, prompt-injected payload, or just a verbose model) yields a "valid" assessment that is then composed into the report and persisted (Prisma) and shipped over SSE to the browser. There is no per-field ceiling anywhere in the LLM layer.
- **Root cause**: Defensive coercion validates type and shape but treats string size as trusted, so the "never crash on a flaky response" guarantee doesn't extend to resource exhaustion from a large-but-well-typed response.
- **Impact**: UX degradation / storage bloat — oversized DB rows, heavy SSE payloads, and UI rendering jank from a single verbose/adversarial response.
- **Fix sketch**: In `asStringArray` and the scalar string coercions, truncate each value to a sane max (e.g. `.slice(0, 2000)`) so field size, like field count, is bounded.

## 7. Bedrock toolUse.input returned as a string (not object) silently coerces to an empty, unusable assessment
- **Severity**: Low
- **Category**: functionality
- **File**: src/lib/llm/bedrock.ts:84-93 + provider.ts:78-79
- **Scenario**: The happy path takes `part.toolUse.input` and passes it directly to `validateAssessment`. Converse normally returns `input` as a parsed object, but some models/regions/SDK paths can surface the tool input as a JSON *string* (or a partially-populated object on a truncated/throttled response). `validateAssessment` casts whatever it gets to `Record<string, unknown>`; a string has no `dimensions`/`roadmap` arrays, so every field defaults to empty and it returns a zero-dimension assessment. Because `input != null`, the function returns immediately and never reaches the `parseJsonLoose` text fallback below. `isAssessmentUsable` then correctly rejects it, so the scan silently degrades to mock — masking that Bedrock actually responded, just in an unparsed shape.
- **Root cause**: The happy path assumes `toolUse.input` is always a fully-parsed object; it short-circuits the text/JSON-repair fallback for any non-null value, including a string.
- **Impact**: silent failure / wrong scores — a working Bedrock response is discarded and replaced by deterministic mock with only a generic "AI unavailable" caveat.
- **Fix sketch**: If `toolUse.input` is a string, run it through `parseJsonLoose` before `validateAssessment`; otherwise only short-circuit when it's a non-empty object, and fall through to the text path otherwise.
