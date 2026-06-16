# CI Gate & Status Checks — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 1, High: 3, Medium: 1, Low: 0)
> Lens split: bug-hunter 5 / ui-perfectionist 0
> Files read: 7

## 1. Default mock gate can return an LLM-scored verdict from cache (cross-mode read)
- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: state-corruption / cache-key-collision
- **File**: src/app/api/gate/[owner]/[repo]/route.ts:55
- **Scenario**: A repo is first scanned via the badge/scan flow with `?mock=0` (real LLM), which writes the report under `llmKey`. Later CI calls the gate with the default deterministic mode (`mock=true`). The lookup is `report = cacheGet(llmKey) ?? cacheGet(mockKey)` — it probes the **LLM** entry first, hits it, and gates on a stochastic LLM score while the caller (and the comment `Policy: … (engine.provider)`) believes it ran the deterministic mock rubric.
- **Root cause**: The read fallback chain ignores the resolved `mock` mode. It was written to "serve whatever we have" but the gate's whole value proposition is that the default path is *deterministic and reproducible*; mixing in the LLM entry makes the pass/fail non-deterministic and mode-confused. The asymmetry is worse because line 58 writes back to the *correct* key (`mock ? mockKey : llmKey`), so reads and writes disagree.
- **Impact**: A PR can flip pass↔fail between two CI runs with identical code, purely from which scan populated the cache first — a flaky merge gate plus a verdict whose stated provider is wrong.
- **Fix sketch**: Probe only the mode that was requested: `const key = mock ? mockKey : llmKey; report = cacheGet(key);` (and `cacheSet(key, report)`). If a cross-mode fallback is genuinely wanted, label the response with the report's actual `engine.provider`/mode.

## 2. `?min_security=` (empty/zero) silently disables the security floor it claims to set
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: validation-gap / silent-failure
- **File**: src/lib/scoring/gate.ts:206-209
- **Scenario**: CI configures the security gate as `?min_security=` (templated from an empty variable) or `?min_security=0`. `Number("")` and `Number("0")` are both `0`, `Number.isFinite(0)` is true, and `params.get("min_security") != null` is true (it's `""`/`"0"`, not null). So `hasMinSecurity` is true, `wantSecurity` is true, and `securityFloor = 0`. The gate now enforces "D9 ≥ 0" (always passes) while still *appearing* to be a security gate.
- **Root cause**: The "is a security floor requested" signal is derived from a successfully-parsed-to-finite number without rejecting `0`/empty as a non-floor. An unset env var rendered into the query becomes a *weaker* gate than the archetype default, with no error.
- **Impact**: Teams believe security enforcement is on; it is effectively off. A repo with Security = 5/100 passes a "security gate". Security-relevant false-negative.
- **Fix sketch**: Require a positive floor: `const hasMinSecurity = Number.isFinite(minSecurity) && minSecurity > 0;` and treat empty/0 as "not requested" (or 400 on a malformed value) rather than silently flooring at 0.

## 3. Dimensions with a missing/NaN score slip past every floor check
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: edge-case / success-theater
- **File**: src/lib/scoring/gate.ts:114 (also :172, and gate-comment.ts:82)
- **Scenario**: A scan produces a `DimensionResult` whose `score` is `undefined`/`NaN` (partial LLM output, a newly added dimension the model didn't score, or a mock gap). `report.dimensions.filter((x) => x.score < min)` evaluates `undefined < 40` / `NaN < 40` → `false`, so the unscored dimension is treated as *passing*. The same holds for `minDimensionFor` (line 127) and the `evaluateGateLite` snapshot path (line 172).
- **Root cause**: The floor uses a `<` comparison that quietly treats "no score" as "above the floor". The gate assumes every dimension always carries a numeric score, but nothing at this trust boundary validates that.
- **Impact**: A repo that failed to score its Security/Testing dimension passes the gate — the exact dimensions a gate exists to enforce can be bypassed by *absence* of data. Worst-case it's silent and indistinguishable from a real pass.
- **Fix sketch**: Treat a non-finite score as a failure (fail-closed): `for (const d of report.dimensions.filter((x) => !Number.isFinite(x.score) || x.score < min))`, with a message that distinguishes "unscored" from "below floor".

## 4. Failing-dimension table crashes the comment build when a dimension has no `gaps`
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: missing-null-check / unhandled-exception
- **File**: src/lib/scoring/gate-comment.ts:91
- **Scenario**: A gate fails and `failingDims` is non-empty. For each failing dim the builder reads `d.gaps[0] ?? d.summary ?? ""`. If `d.gaps` is `undefined` (an LLM/mock report that omitted the array for that dimension, or an older persisted report from before `gaps` existed), `d.gaps[0]` throws `TypeError: Cannot read properties of undefined (reading '0')` and `buildGateComment` rejects.
- **Root cause**: Indexing `d.gaps[0]` assumes the array is always present. The `?? d.summary` fallback only guards a *null first element*, not a missing array. The pure builder feeds both the check-run summary and the sticky PR comment, so its failure kills the entire PR surface.
- **Impact**: On a *failing* gate (precisely when the comment matters most) the whole comment/check-run write throws; CI either errors out or the merge-blocking signal never posts. Exception is data-dependent, so it slips through the happy-path tests (which use `dimensions: []`).
- **Fix sketch**: `const gap = (d.gaps?.[0] ?? d.summary ?? "")…` — optional-chain the array access, and consider `Array.isArray(d.gaps)` before relying on it.

## 5. Unescaped failure/policy strings are interpolated into PR-comment markdown
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: injection / output-integrity
- **File**: src/lib/scoring/gate-comment.ts:74, 92, 119
- **Scenario**: `f.message`, the dimension `name`, and `report.engine.provider` are dropped straight into markdown (`lines.push(\`- ${f.message}\`)`, the `| ${d.id} ${d.name} | … |` table cell, and the `<sub>… scored by Ascent (${report.engine.provider})</sub>` footer). Only `d.gaps[0]` is `\|`-escaped (line 91); `d.name`, posture/level labels, and failure messages are not. A dimension name or posture label containing `|`, backticks, or `<!-- … -->` (note: the same HTML-comment mechanism used by `GATE_COMMENT_MARKER`) breaks the table or injects markup into the sticky comment.
- **Root cause**: The builder assumes all interpolated report fields are clean plain text, but several originate from LLM output / repo-derived labels and reach a rendered GitHub surface unsanitized. The sticky-comment marker is itself an HTML comment, so attacker-influenced text emitting `<!-- ascent-maturity-gate -->` could even confuse the upsert/dedupe matcher in `write.ts:76`.
- **Impact**: Broken/garbled gate comments (table cells split, content escaping the `<sub>` tag), and a path for LLM-influenced text to corrupt the marker-based comment-upsert logic. Low security blast radius but real output-integrity/confusion risk.
- **Fix sketch**: Escape `|`, newlines, and `<!--` in every interpolated label/message (a shared `mdCell()`/`mdInline()` helper), matching what line 91 already does for the gap text.
