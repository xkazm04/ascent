> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

# AI-Native Standard & Onboarding Skill — combined bug+ui scan

## 1. doctor freshness check false-positives on every CI run after a git checkout
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: correctness / false-positive
- **File**: src/lib/standard/doctor.ts:114-116
- **Scenario**: A repo adopts the standard, commits `.ai/manifest.yaml` with `generatedAt: 2026-06-10`, and never touches `package.json` again. On any CI run on 2026-06-11+, `actions/checkout` writes the working tree afresh, so `statSync('package.json').mtime` is the checkout time (= "now"). The doctor computes `mtime.toISOString().slice(0,10) > gen` → `"2026-06-11" > "2026-06-10"` → true, and emits `manifest may be stale: package.json changed after generatedAt`.
- **Root cause**: The check assumes file mtime reflects *content* change time, but git does not preserve mtimes — a clean checkout stamps every file with the checkout time. Comparing a per-checkout mtime against a fixed generation *date* makes the warning fire for every adopting repo one day after generation, regardless of whether the source actually changed.
- **Impact**: Every CI conformance run produces a spurious "stale" WARN that drags the conformance score down (warn weight = 0.5) and trains maintainers to ignore the doctor's freshness signal — defeating the drift-detection feature. It is the single noisiest finding the shipped doctor emits.
- **Fix sketch**: Don't rely on mtime for committed files. Either drop the mtime freshness heuristic entirely in favor of the git-based drift signal `maintain.mjs check` already provides (compare against `reconciledToSha`/`git log` of the source path), or only run the mtime check when the file is git-dirty (`git status --porcelain <f>` non-empty). At minimum gate it behind `--run`/local use so it never fires in checkout-based CI.

## 2. Shared deployment ingest token lets any repo write conformance scores for any org's repo
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: security / authorization
- **File**: src/app/api/report/conformance/route.ts:43-52 (with src/lib/standard/doctor.ts:142-150)
- **Scenario**: The doctor auto-POSTs `{ repo: process.env.GITHUB_REPOSITORY, score, fails, warns }` with `Authorization: Bearer $ASCENT_CONFORMANCE_TOKEN`. The route's `ciAuthed` branch accepts any request whose bearer equals the single deployment-wide `CONFORMANCE_INGEST_TOKEN`, then calls `recordConformance(parsed.owner, fullName, …)` using the *request-supplied* `repo` to pick the org/repo row. Any repo that legitimately holds the shared token (it is one value across the whole deployment) can POST `repo: "victimOrg/victimRepo"` and overwrite that repo's `aiConformance`.
- **Root cause**: The unattended path authenticates the *caller* (a valid token) but never authorizes the *target* — `repo` is fully attacker-controllable (`GITHUB_REPOSITORY` is just an env var the calling workflow sets) and the token is not scoped to a single owner/installation.
- **Impact**: A team with the token can spoof a green conformance score onto another org's repository (or tank a competitor's), corrupting the dashboard's adopt→verify→re-score signal. Inflated scores can mask real gaps the gate exists to catch.
- **Fix sketch**: Bind the unattended path to the caller's identity: prefer a per-installation/per-repo token, or verify the GitHub OIDC token (`ACTIONS_ID_TOKEN`) and assert its `repository` claim equals `body.repo`. Failing that, namespace `CONFORMANCE_INGEST_TOKEN` per org and require the token's org to match `parsed.owner`.

## 3. Empty `report.dimensions` renders a headerless-but-rowless markdown table in the skill
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing empty state
- **File**: src/lib/onboarding/skill.ts:91-109
- **Scenario**: `currentState` always emits the `| Dim | Name | Score | Status |` header plus the `|-----|...` separator, then `${rows}`. If a report has `dimensions: []` (the mock/keyless path and the manifest unit fixtures both produce empty `dimensions`, and a degraded LLM result can too), `rows` is `""`, producing a table with a header, a separator, and zero data rows — which renders as an empty/broken table in the SKILL.md the maintainer reads.
- **Root cause**: The section assumes `report.dimensions` is always populated; there is no guard for the empty case (unlike `strengths`, which has a `|| "- (…)"` fallback right below it).
- **Impact**: The generated onboarding skill — the primary deliverable — shows a malformed "Where this repo stands" table for any report lacking per-dimension data, undermining the polished, trustworthy impression the document is meant to create.
- **Fix sketch**: Guard the table: when `report.dimensions.length === 0`, emit a one-line note (e.g. "- (per-dimension breakdown unavailable for this scan)") instead of the header+separator with no rows; mirror the `strengths` fallback pattern already used eight lines down.

## 4. `scoreLine` throws RangeError on an out-of-range score (negative repeat count)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge case / crash
- **File**: src/lib/onboarding/skill.ts:84-86
- **Scenario**: `filled = Math.round(value / 10)` then `"░".repeat(10 - filled)`. For any `value > 104` (e.g. an unclamped/aggregated score of 110), `filled = 11` and `10 - filled = -1`, so `String.prototype.repeat(-1)` throws `RangeError: Invalid count value`. The same applies to a negative score (`filled < 0` → `"█".repeat(negative)`). `scoreLine` is called three times (overall/adoption/rigor) and an uncaught throw aborts the entire `buildOnboardingSkill` call.
- **Root cause**: The bar math trusts that `value` is always within 0–100. The function never clamps before deriving the repeat counts, so a single out-of-band score (a defensive concern the rest of the engine clamps, but this renderer does not) crashes skill generation rather than degrading.
- **Impact**: One malformed score value (from a future scoring change, a corrupted persisted report, or an LLM path that returns >100) turns a 200-line markdown render into a 500/throw on the `/api/report/skill` route. Low likelihood given upstream clamping, but the failure mode is a hard crash, not a degraded bar.
- **Fix sketch**: Clamp before rendering: `const filled = Math.max(0, Math.min(10, Math.round(value / 10)));` so the bar is always 10 cells regardless of input.

## 5. Caller-supplied `headSha` persisted to skill-history without a length bound
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: validation gap
- **File**: src/app/api/report/skill/route.ts:53 (with src/lib/db/skill-history.ts:26-34)
- **Scenario**: The skill route parses `@<sha>` from the unvalidated `?repo=` query and passes `parsed.sha` straight to `recordSkillGeneration(..., parsed.sha ?? null, ...)`. There, `repoFullName` is defensively `.slice(0, 200)` but `headSha` is stored verbatim (`headSha: headSha ?? null`). A request like `?repo=acme/api@<5KB string>` writes an arbitrarily long value to the `headSha` column.
- **Root cause**: The history layer caps the repo name and the track array but treats `headSha` as already-bounded, while the route does no validation on the `@`-suffix it forwards. If the column has a length constraint the insert throws (silently swallowed, so the history record is lost); if not, it stores unbounded attacker-controlled data.
- **Impact**: Best-effort history silently drops the record (no user-visible break) or persists junk; minor data-quality / storage-abuse vector, no crash on the download path. Lowest-severity of the set.
- **Fix sketch**: Bound and shape `headSha` at the boundary, e.g. `headSha?.slice(0, 64)` in `recordSkillGeneration` (mirroring the `repoFullName.slice(0, 200)` guard), and/or reject a non-hex/over-long sha when parsing `?repo=` in the route.
