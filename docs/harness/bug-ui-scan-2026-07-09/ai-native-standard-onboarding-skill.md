# AI-Native Standard & Onboarding Skill — bug-hunter + ui-perfectionist scan

> Context: AI-Native Standard & Onboarding Skill (group: Onboarding, Shell & AI Standard)
> Files scanned: 16
> Total: 7 findings (Critical: 0, High: 1, Medium: 3, Low: 3)

## 1. `maintain.mjs check` is a silent no-op in its documented pre-push placement
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/standard/maintain.ts:27
- **Scenario**: A repo wires `node .ai/maintain.mjs check` into its pre-push hook (skill.ts:180 instructs exactly this). A dev commits a change under `src/foo/` without refreshing `src/foo/CONTEXT.md`, then pushes. `check` prints "CONTEXT graph current" and the push proceeds.
- **Root cause**: `changed()` computes `git diff --name-only HEAD` + `--cached`, which only report UNcommitted working-tree/index changes. At pre-push time everything is already committed, so both diffs are empty ⇒ `changed()` returns `[]` and every freshness/`note` warning is skipped. The design assumes "the push's changes == the uncommitted diff," which is false post-commit.
- **Impact**: The headline "self-maintaining upkeep" guardrail never fires for any adopting repo; CONTEXT docs and the memory ledger silently rot — the exact decay the standard exists to prevent.
- **Fix sketch**: Diff the push range, not the worktree: `git diff --name-only @{push}..HEAD` (fallback `@{u}..HEAD`, then `HEAD~1..HEAD`), or read the pre-push refs from stdin. Keep the `--cached`/`HEAD` diff only as a manual-invocation fallback.

## 2. Doctor's hook-wiring check uses naive substring matching → false "wired" pass
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: false-pass
- **File**: src/lib/standard/doctor.ts:108
- **Scenario**: A repo moves `test` into `controls.prePush` (the manifest comment invites this) but never wires it into its hook. The hook happens to contain the word "latest" (e.g. `npm run build:latest`). The doctor checks `hookText.includes('test')` — `"latest".includes("test")` is true — so it emits no warning and the maintainer believes tests run pre-push when they don't.
- **Root cause**: `al.some((a) => hookText.includes(a))` does an unbounded substring test over lowercased hook text, with no word boundary. Aliases like `test`, `lint`, `format` are substrings of unrelated tokens.
- **Impact**: A false PASS in a tool whose entire value proposition is "prove the claims" — worse than a false fail; a control is reported as enforced while it isn't.
- **Fix sketch**: Match on word boundaries (`new RegExp('\\b' + escape(a) + '\\b')`) or tokenize the hook text on non-word chars before comparing.

## 3. Conformance ingest coerces `null`/`""`/booleans into valid numbers, persisting 0
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: src/app/api/report/conformance/route.ts:17
- **Scenario**: A reimplemented/buggy doctor (the spec explicitly invites reimplementation) computes a NaN score; `JSON.stringify({score: NaN})` serializes it as `{"score":null}`. The route's `int()` does `Number(null)` → `0` (also `Number("")`→0, `Number(true)`→1), which passes the `!== null` guard and persists `score=0`.
- **Root cause**: `int()` relies on `Number()`, which coerces `null`/`""`/`[]`/`false` to `0` and `true` to `1` instead of rejecting them. The trust-boundary comment (lines 41-44) claims the endpoint is untrusted, but the numeric guard leaks non-numeric inputs through.
- **Impact**: A malformed report silently zeroes a repo's conformance score and every org-dashboard aggregate that reads it, instead of returning 400 — a self-inflicted "regression to 0%" with no error.
- **Fix sketch**: Reject non-numbers before coercion: `if (typeof v !== "number" || !Number.isFinite(v)) return null;` (parse strings explicitly only if string input is intended).

## 4. Skill route logs `parsed.sha` instead of the report's resolved commit, corrupting STD-6 history
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: data-integrity
- **File**: src/app/api/report/skill/route.ts:46
- **Scenario**: A user downloads the skill for `owner/name` with no `@sha`. `getScanReportByCommit` resolves the latest saved scan (a concrete commit, available as `report.repo.headSha`), but `recordSkillGeneration(..., parsed.sha ?? null, ...)` records `headSha=null`.
- **Root cause**: The route discards the commit it already resolved and logs the caller's raw (absent) sha. The dedup in skill-history keys on `{repoFullName, headSha:null}`, so every "latest" generation collapses onto one null bucket.
- **Impact**: The STD-6 "how onboarding focus shifted over time" timeline can't attribute generations to commits, and a later generation for a NEW commit with the same track set is deduped away (no history row) — the feature's core value silently drops entries.
- **Fix sketch**: Record `report.repo.headSha ?? parsed.sha ?? null` so the persisted commit reflects what was actually generated from.

## 5. `recordSkillGeneration` dedup is check-then-act → duplicate history rows under concurrency
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/lib/db/skill-history.ts:43
- **Scenario**: Two near-simultaneous GETs for the same repo/sha/tracks (a link prefetch + the real click, or a CDN revalidation) both run `findFirst` (returns the same prior row or none), both pass the `sameTrackSet` check, and both `create` — inserting duplicate no-change entries.
- **Root cause**: The "deduped, so bots can't fill the history" guarantee in the doc comment is implemented as a non-atomic read-then-write with no unique constraint.
- **Impact**: Low — best-effort history gains occasional duplicate rows, mildly noising the STD-6 timeline. Never breaks the download.
- **Fix sketch**: Add a DB unique index on `(repoFullName, headSha, trackIds-hash)` and use `createMany({ skipDuplicates })` / upsert, or accept the dup as documented and soften the comment.

## 6. Conformance CI token compared with `===` (non-constant-time)
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: timing-side-channel
- **File**: src/app/api/report/conformance/route.ts:53
- **Scenario**: `ciAuthed = !!ingestToken && bearer === ingestToken` short-circuits character-by-character. A network attacker with a stable path to the deployment could in principle time-probe `CONFORMANCE_INGEST_TOKEN`.
- **Root cause**: Secret compared with JS string `===` rather than a length-independent constant-time compare.
- **Impact**: Low in practice (network jitter dwarfs the signal), but this is the one deployment-wide bypass credential for the ingest endpoint.
- **Fix sketch**: `crypto.timingSafeEqual` over equal-length buffers (hash both sides first to normalize length), guarded by a length check.

## 7. Generated `ai-conformance.yml` declares no `permissions:` (no least-privilege)
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: least-privilege
- **File**: src/lib/standard/wiring.ts:23
- **Scenario**: Every adopting repo installs this workflow. Without an explicit `permissions:` block the job inherits the repository/org default `GITHUB_TOKEN` scopes, which on many orgs is still read/write.
- **Root cause**: The template omits a top-level `permissions:` declaration; the doctor run needs only `contents: read`.
- **Impact**: Low — an over-scoped token on a conformance-only job; broadens blast radius if the job or an action it uses is ever compromised.
- **Fix sketch**: Add `permissions:\n  contents: read` at the workflow top level in the generated YAML.
