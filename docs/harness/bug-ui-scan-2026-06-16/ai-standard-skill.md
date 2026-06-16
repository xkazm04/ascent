# AI-Native Standard & Onboarding Skill — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)
> Lens split: bug-hunter 5 / ui-perfectionist 0
> Files read: 15

## 1. SKILL.md code fence can be closed early by a generated file body (four-backtick fence is not collision-proof)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: template generation / string escaping
- **File**: src/lib/onboarding/skill.ts:131-137
- **Scenario**: `embedFile` wraps every foundation file in a four-backtick fence (` ```` `) to survive triple-backticks inside. But the fence terminates on the *first line that is exactly four-or-more backticks*. The two `.mjs` scripts are hand-authored "with NO backticks" (doctor.ts:6, maintain.ts:6) precisely to dodge this — yet nothing enforces it, and `f.body` for the manifest/context/memory blocks is built from report-derived strings. If any embedded body ever contains a line of `````` ```` `````, the SKILL.md fence closes there and the remainder of the file (plus all later sections: tracks, run protocol, guardrails, footer) leaks out as rendered markdown / mangles the agent-facing skill.
- **Root cause**: A fixed-width fence (always 4 backticks) is used regardless of the content it must escape; there is no per-block computation of a fence longer than the longest backtick run inside `f.body`, and no assertion that bodies are backtick-free.
- **Impact**: A single future edit to a generator template (or a report field that reaches a body) silently produces a broken SKILL.md for every repo, with no test catching it because current bodies happen to be clean. The whole onboarding skill below the break becomes inert.
- **Fix sketch**: Compute the fence dynamically: `const n = Math.max(3, longestBacktickRun(f.body) + 1); const fence = "`".repeat(n);` and use it for open/close. Optionally add a dev-time assertion in `buildFoundation` that no body contains the fence string.

## 2. Content-Disposition filename is built from unsanitized request input (header injection / corrupt download name)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: route input validation / header injection
- **File**: src/app/api/report/skill/route.ts:54-56,60
- **Scenario**: `parseRepo` only checks that `?repo=` contains a `/` with non-empty halves (route.ts:21-23); it imposes no character whitelist. The raw `parsed.owner` and `parsed.name` are then interpolated directly into the `Content-Disposition: attachment; filename="..."` header. A value containing a `"`, `;`, CR/LF, or path separators yields a malformed (or injected) header — at best a broken/duplicated filename, at worst a header-splitting attempt depending on the runtime's header sanitization.
- **Root cause**: Request-derived strings are placed into a structured HTTP header without quoting/escaping or a charset restriction; the only validation is the slash-position check.
- **Impact**: Corrupt download filenames and a header-injection surface on a public-readable route. The DB exact-match on `owner/name` narrows exploitability (the value must match a stored repo), but the header is assembled from `parsed.*` independently of what the DB returned, so any persisted repo row with an odd `fullName` propagates straight into the response header.
- **Fix sketch**: Validate `owner`/`name` against the GitHub charset (`/^[A-Za-z0-9._-]+$/`) in `parseRepo`, rejecting otherwise; and/or sanitize the filename (strip everything outside `[\w.-]`) before interpolation. Prefer `filename*=UTF-8''<percent-encoded>` for safety.

## 3. Skill frontmatter `description` is a single YAML line but only quotes are escaped — a newline in owner/name/level breaks the frontmatter
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: template generation / string escaping
- **File**: src/lib/onboarding/skill.ts:50-62
- **Scenario**: `description` is emitted as one double-quoted YAML scalar and only sanitized with `desc.replace(/"/g, "'")`. It interpolates `report.repo.owner`, `report.repo.name`, `report.level.name`, and `report.scannedAt`. A newline (or a stray `"`-adjacent control char) in any of these splits the `description:` line, corrupting the SKILL.md YAML frontmatter so the skill loader can't parse it. These fields are reconstructed from the DB (scans-read.ts:666-700), not re-validated, so a crafted/legacy scan row with a multi-line value escapes the single `"`→`'` guard.
- **Root cause**: Ad-hoc escaping (quote-only) of free-form text that is forced onto one YAML line, instead of JSON-stringifying the scalar (which would also escape newlines) or stripping control characters.
- **Impact**: An unparseable skill file for the affected repo — the downloaded SKILL.md silently fails to register as a skill in the target repo's Claude Code CLI.
- **Fix sketch**: Build the scalar via `JSON.stringify(desc)` (valid YAML double-quoted form, escapes `"` and newlines), or collapse whitespace with `desc.replace(/\s+/g, " ").trim()` before quoting.

## 4. `ARCHETYPE_LABEL[report.archetype]` and an empty `dimensions` array render literal "undefined" / a header-only table
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: missing/empty report data rendering
- **File**: src/lib/onboarding/skill.ts:99,104-106
- **Scenario**: `archetype` is a free string cast from the DB (`scan.archetype as RepoArchetype`, scans-read.ts:679). If it isn't a known key, `ARCHETYPE_LABEL[report.archetype]` is `undefined`, and line 99 renders `**Run style:** undefined lens`. Separately, if `report.dimensions` is empty (a degraded/partial scan), the "Where this repo stands" table (skill.ts:104-106) renders only its header row with `${rows}` empty — a malformed, contentless markdown table. `strengths` already has an empty-guard (line 109) but `dimensions` does not.
- **Root cause**: Report fields sourced from persisted/casted data are interpolated without a fallback for the unknown-key and empty-array cases; only some fields (strengths, tracks) carry empty guards.
- **Impact**: User-visible "undefined" text and a broken table in the generated SKILL.md — exactly the kind of low-trust artifact the onboarding flow is meant to avoid, shipped to the repo's own agent.
- **Fix sketch**: `ARCHETYPE_LABEL[report.archetype] ?? "general"` (or the archetype id) for the label; and short-circuit `currentState` to a "no per-dimension data in this scan" line when `report.dimensions.length === 0`, mirroring the strengths guard.

## 5. `recordSkillGeneration` is fire-and-forget with a doubly-swallowed error — generation history can silently never persist
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent failure / swallowed errors
- **File**: src/app/api/report/skill/route.ts:53
- **Scenario**: `void recordSkillGeneration(...).catch(() => {})` is intentionally not awaited so the download isn't blocked, and the callee already wraps its write in `try/catch` that swallows everything (skill-history.ts:28-34). Any failure (DB hiccup, constraint, serialization) vanishes with zero logging at either layer. STD-6 depends on this history to show the "track diff" across generations; if writes quietly fail, the feature degrades with no diagnostic signal.
- **Root cause**: Two independent error swallows (the inline `.catch(() => {})` and the inner `catch {}`) with no logging, on a write whose result a downstream feature relies on.
- **Impact**: Silent loss of skill-generation history — hard to notice and hard to debug, since nothing is ever logged. Not a correctness bug for the download itself, hence Low.
- **Fix sketch**: Keep it non-blocking, but log on failure in `skill-history.ts` (`console.warn`/structured logger) so a persistent failure is observable; the route's `.catch(() => {})` can then stay as a belt-and-suspenders no-op.
