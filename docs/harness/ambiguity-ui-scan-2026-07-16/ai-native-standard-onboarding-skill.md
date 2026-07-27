# AI-Native Standard & Onboarding Skill — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

## 1. `verified` is advertised as a flag the doctor "flips to true" — but nothing ever writes it back
- **Severity**: High
- **Category**: undocumented-assumption
- **File**: `src/lib/standard/doctor.ts:15` (also `src/lib/standard/manifest.ts:114`, `src/lib/standard/types.ts:27-30`)
- **Scenario**: Three separate places promise the same contract: the doctor's usage banner says `--run` "flips \"verified\""; the generated manifest comment says "`verified` is a claim the doctor flips to true once it has actually run the command"; the `Capability` type doc repeats it. But the emitted `doctor.mjs` contains no `writeFileSync` at all — `--run` only appends pass/fail findings. Every adopting repo's `manifest.yaml` carries `verified: false` on all capabilities forever, even after a green `--run`.
- **Root cause**: The write-back half of the verify loop was never implemented (or was dropped), while the prose describing it survived in three files. Nothing in `standard.test.ts` pins the flip, so the drift is invisible to CI.
- **Impact**: Agents reading the manifest per the standard's own semantics ("verified is a claim the doctor flips") must conclude every capability is unproven, permanently — undermining the standard's core "verifiable" pillar. A future doctor check on `verified: true` would hard-fail every repo. Humans diffing the manifest see a field that never changes and stop trusting the schema's comments.
- **Fix sketch**: Either implement the flip (in `--run`, on success, rewrite the `verified: false` token for that capability line — the serializer's regular one-line-per-capability format makes this a safe targeted regex) or fix the three docs to say `verified` is reserved for a future doctor version and today the proof lives only in the doctor's run output. Add a test pinning whichever contract is chosen.

## 2. Conformance ingest silently drops `headSha` — stale CI re-runs clobber the newest score with no ordering
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/app/api/report/conformance/route.ts:60` (body.headSha parsed at :27-31; sender at `src/lib/standard/doctor.ts:179`)
- **Scenario**: The doctor deliberately POSTs `headSha: process.env.GITHUB_SHA` so a conformance result can be tied to a commit. The route parses `body.headSha` into its typed body… and then never uses it: `recordConformance(parsed.owner, fullName, { score, fails, warns })` persists only the three numbers onto the Repository row. Re-running an old PR's CI (a retry button on a 2-week-old workflow, a backport branch) overwrites the org dashboard's "current" conformance with a stale snapshot, and nothing can detect or order it.
- **Root cause**: Last-write-wins persistence with the ordering key received but discarded — the adopt→verify→re-score loop was wired for the happy path (one linear stream of reports per repo) only.
- **Impact**: The org dashboard number the whole loop exists to produce is only as fresh as the *last workflow to finish*, not the newest commit. A maintainer who just fixed all FAILs can watch the score revert when a queued old run completes — and the doctor prints "Reported conformance to Ascent." for both, so the corruption is invisible.
- **Fix sketch**: Persist `headSha` (bounded/validated, e.g. `/^[0-9a-f]{7,40}$/i`) alongside the score, and either (a) skip the write when the incoming sha is an ancestor/known-older report, or minimally (b) store `reportedAt` + sha and let the dashboard label the result with the commit so staleness is at least visible. Document the last-write-wins trade-off wherever `recordConformance` is defined if (b) is chosen.

## 3. The maintainer "multiselect" path (`SelectOpts.include`/`max`) is unreachable from the product — the skill always ships the default track set
- **Severity**: Medium
- **Category**: trade-off-undocumented
- **File**: `src/app/api/report/skill/route.ts:43` (opts plumbing at `src/lib/onboarding/skill.ts:33-35`, `src/lib/onboarding/tracks.ts:346-351`)
- **Scenario**: `buildOnboardingSkill(report, opts?)` and `selectTracks` carry a fully built, tested `include`/`max` API "the maintainer's multiselect… can surface a refinement on an otherwise-strong dimension". The only production caller is the GET route, which calls `buildOnboardingSkill(report)` with no opts and accepts no query params for tracks. The generated SKILL.md even tells the repo's agent to "pass specific dimensions to revisit a refinement" when there are no weak dims (`skill.ts:193`) — advice the download URL cannot honor.
- **Root cause**: The selection API was designed (and unit-tested) ahead of the UI/route surface that would drive it; the gap between "supported by the library" and "reachable by a user" was never recorded.
- **Impact**: Strong repos (all dims ≥ 70) download a skill whose Tracks section is an empty shell with a dead suggestion; maintainers of weak repos can't scope a session to one dimension. The STD-6 skill-generation history only ever records the default set, so its track-diff feature (`diffTrackSets`) has nothing meaningful to diff.
- **Fix sketch**: Accept `?tracks=D2,D9` (and optionally `&max=N`) on the route, validate against `DimensionId`, and forward as `opts.include` — the sanitizer and history plumbing already handle arbitrary sets. Until then, drop the "pass specific dimensions" sentence from the no-gaps Tracks section so the artifact doesn't reference an unreachable capability.

## 4. Conformance score is a mean over a variable set of findings with magic weights — scores aren't comparable across runs, repos, or flags
- **Severity**: Medium
- **Category**: magic-number
- **File**: `src/lib/standard/doctor.ts:157-158` (weights + denominator; `--run` findings at :102-108; 180000ms timeout at :105)
- **Scenario**: `score = round(100 * Σweight / findings.length)` with `weight = {pass:1, warn:0.5, fail:0}`. The denominator is whatever happened to be checked: `--run` adds one pass/fail *per capability* (so the same repo scores differently with and without `--run`); a repo with no hooks skips the per-control wiring findings entirely; a missing manifest yields exactly one finding (score 0) while a manifest with 1 fail among 12 passes scores ~92. None of the 0.5 warn weight, the run-dependent denominator, or the 180-second capability timeout is documented in the spec or the report output.
- **Root cause**: The score was implemented as a quick pass-ratio heuristic, but it is then persisted (route + Repository row) and surfaced on the org dashboard as if it were a stable, comparable metric — a trade-off nobody wrote down.
- **Impact**: Cross-repo comparison and per-repo trends (the dashboard's whole purpose for this number) move when a maintainer merely adds `--run` to CI or wires one more capability — reading as regressions/improvements that never happened. A capability whose test suite legitimately takes >3 min flips from pass to FAIL (exit 1, merge blocked) with no message pointing at the timeout.
- **Fix sketch**: Fix the denominator to a stable rubric (score over the *defined* check list, not the emitted findings) or persist `fails`/`warns` as the headline and demote `score` to display-only; document the weight map and the 180s `--run` timeout in `docs/AI_MANIFEST_SPEC.md` and the doctor's usage banner (and name the timeout in the FAIL message).

## 5. `maintain note` numbering is read-then-write with a truncating write — concurrent agents can silently overwrite each other's memory
- **Severity**: Low
- **Category**: edge-case-gap
- **File**: `src/lib/standard/maintain.ts:103-110` (emitted `note` subcommand)
- **Scenario**: `note` derives the next id via `readdirSync → max+1`, then `writeFileSync(file, …)` with default flags. Two agents (or an agent + a human, or two worktree sessions sharing a checkout) appending "one fact" at the same moment both compute `0008`, and the second `writeFileSync` truncates and replaces the first — exactly the durable knowledge the append-only ledger exists to preserve. The test suite proves collision-freedom only for *sequential* appends (`standard.test.ts:773-790`).
- **Root cause**: Non-atomic check-then-act on the filesystem; the README's "append-only, never rewrite history" norm is enforced socially, not mechanically, and the standard explicitly targets multi-agent workflows where concurrency is the point.
- **Impact**: Rare but silent, unrecoverable loss of a memory entry with no error on either side — the worst failure mode for a system whose pitch is "hard-won knowledge survives". The slug differing doesn't save you when two notes share an id *and* similar text (e.g. two agents logging the same incident).
- **Fix sketch**: Open with the exclusive flag (`writeFileSync(file, …, { flag: 'wx' })`) and on `EEXIST` retry with `max+1` recomputed — three extra lines, still zero-dep, keeps the same filenames. Optionally note the concurrency guarantee in `.ai/memory/README.md`.
