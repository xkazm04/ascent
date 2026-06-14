# Feature Scout — AI-Native Standard & Onboarding Skill (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 3H / 2M / 0L

The `.ai/` standard subsystem (`src/lib/standard/*`) produces a high-quality, vendor-neutral
foundation — a manifest, an executable `doctor`, a `maintain` upkeep script, structured `memory`, and
a `CONTEXT` graph — bundled by `buildFoundation()` and embedded into a personalized `SKILL.md` by
`src/lib/onboarding/skill.ts`. The only surface is one download button in `ReportHeader.tsx` →
`GET /api/report/skill`. The audit found a strong engine with a thin, lossy delivery layer: capable
generators whose richest options never reach the user, a manifest that points at subsystems it never
scaffolds, and no loop that closes the "adopt → verify → re-score" promise the product makes.

## 1. Doctor conformance never flows back into Ascent (no adopt→verify→re-score loop)
- **Severity**: Critical
- **Category**: functionality
- **File**: src/lib/standard/doctor.ts:122 (computes a 0–100 conformance %); src/lib/onboarding/skill.ts:131 (`Then re-scan in Ascent to confirm the maturity delta`); src/app/api/report — only `pdf/` and `skill/` exist
- **Scenario**: A maintainer downloads the skill, the agent installs `.ai/`, runs `node .ai/doctor.mjs`, and gets "Conformance: 78% (1 fail, 3 warn)". They want Ascent to register that they actually adopted the standard and reflect it in their score/badge — that is literally the product's value loop.
- **Gap**: The doctor emits a conformance score and the skill tells users to "re-scan in Ascent to confirm the delta," but there is no ingestion path. Grep confirms no route accepts doctor output, no `conformance` column in the rollup (`org-rollup.ts` mentions only onboarding *repos*, not `.ai/` adoption), and the badge/gate routes (`api/badge`, `api/gate`) are blind to `.ai/` standard adoption. The whole "shift-left, agent self-certifies, CI confirms" thesis dead-ends at a console log on the user's machine.
- **Impact**: Closes the core feedback loop for every user; turns a one-shot download into a measurable, repeatable maturity ratchet. Enables a "conformance" signal in the fleet rollup and an honest badge ("`.ai/` standard: 78%") — the proof points that make the platform sticky for orgs.
- **Fix sketch**: Add `POST /api/report/conformance` that accepts the doctor's JSON findings (add a `--json` flag to `doctor.ts` so the script can POST it, ~10 lines), persists `{ repo, headSha, score, fails, warns }`, and surfaces it on the report + org rollup. Have `ai-conformance.yml` (`wiring.ts`) optionally POST results so CI auto-reports. ~1 focused session for the route + storage; the doctor already computes everything.

## 2. The manifest points at `evals/` and `.ai/guardrails.yaml`, but neither is ever scaffolded
- **Severity**: High
- **Category**: feature
- **File**: src/lib/standard/manifest.ts:56-57 (`evals: "evals/"`, `guardrails: ".ai/guardrails.yaml"`); src/lib/standard/doctor.ts:68 (warns when `evals/` is missing); src/lib/standard/index.ts:28 (`buildFoundation` emits manifest/doctor/wiring/maintain/memory/context — no evals, no guardrails)
- **Scenario**: An agent reads the manifest, follows `paths.evals`/`paths.guardrails`, and finds nothing there; the doctor then WARNs the user about the missing evals harness it was never given. The D8 track (`tracks.ts:235`) tells the agent to "create an `evals/` harness," but unlike every other capability, no starter is generated.
- **Gap**: `buildFoundation()` generates 7 files but not the two subsystems the manifest advertises. Grep confirms there is no `buildGuardrails`/`buildEvals` anywhere — the manifest declares pointers to vapor. This is the classic half-built standard: the contract promises subsystems the toolkit doesn't deliver.
- **Impact**: Removes a self-inflicted WARN on every fresh adoption and makes the manifest's promises real. A seeded `evals/` (golden-test stub for the repo's runner) and a `.ai/guardrails.yaml` (allow/deny tool scopes, never-touch globs from `boundaries.neverTouch`) are exactly the artifacts that unlock the high-value D8/D9 tracks instead of leaving TODOs.
- **Fix sketch**: Add `src/lib/standard/evals.ts` (`buildEvalsScaffold(report)` → `evals/README.md` + a runner-aware golden-test stub via `commandsFor`) and `src/lib/standard/guardrails.ts` (`buildGuardrails(report)` → `.ai/guardrails.yaml` seeded from `boundaries`). Wire both into `buildFoundation`. Mirror the existing `standard.test.ts` style. ~1 session.

## 3. Track multiselect (`SelectOpts.include`) is built and tested but unreachable from the API
- **Severity**: High
- **Category**: feature
- **File**: src/lib/onboarding/tracks.ts:342-347 (`SelectOpts { include, max }`); src/lib/onboarding/skill.ts:30 (`buildOnboardingSkill(report, opts?)`); src/app/api/report/skill/route.ts:50 (`buildOnboardingSkill(report)` — opts never passed)
- **Scenario**: A maintainer at L4 with one weak dimension wants a skill scoped to just D9 (security), or an L2 maintainer wants only the two cheapest tracks this sprint. The capability exists — `selectTracks` honors an explicit include set and even surfaces refinements on strong dimensions — but the only way to invoke it is the auto-selected "all weak dims" path.
- **Gap**: The route reads only `?repo=` and hard-codes default selection. Grep confirms `include`/`max` are exercised solely in `skill.test.ts`; no caller passes them. The skill's own run-protocol asks the *agent* to present a multiselect, but the maintainer can't pre-scope the download — a built power-user lever with zero exposure.
- **Impact**: Lets maintainers tailor scope at download time (smaller, more relevant skills; faster sessions), and is the hook a future UI multiselect would call. Pure plumbing of an already-tested capability.
- **Fix sketch**: Parse `?dims=D2,D9` and `?max=3` in `route.ts`, validate against `DimensionId`, and pass `{ include, max }` into `buildOnboardingSkill`. Add a small chip multiselect next to the "Onboarding skill" button in `ReportHeader.tsx`. ~half a session.

## 4. No "install the `.ai/` foundation" PR — adoption is copy-paste-from-markdown only
- **Severity**: High
- **Category**: user_benefit
- **File**: src/lib/onboarding/skill.ts:129-136 (`embedFile` — files rendered as fenced code blocks inside SKILL.md); src/app/api/practices/apply/route.ts:1 (the existing draft-PR "systematic apply" for single practices); src/lib/github/write.ts:70 (`openDraftPr`)
- **Scenario**: A maintainer wants the `.ai/` foundation in their repo now. Today they download one SKILL.md and an agent must hand-extract 7 embedded files (`manifest.yaml`, `doctor.mjs`, the CI workflow, etc.) out of markdown fences and write each to the right path before anything runs. Ascent already opens draft PRs that seed a starter artifact for *practices* — but not for its own foundation.
- **Gap**: There is no foundation-install path. Grep confirms no zip/multi-file skill download and no route that calls `buildFoundation()` to open a PR — `practices/apply` only handles a single `practiceId` artifact. The richest, most deterministic output of the whole subsystem (`buildFoundation`) can only be consumed by manual transcription.
- **Impact**: Removes the highest-friction step in the journey and makes "adopt the standard" a one-click draft PR (exactly the install motion that already converts for the Practice Library). Biggest single uplift to activation for the standard.
- **Fix sketch**: Add `POST /api/report/foundation` (mirror `practices/apply`'s auth/org gating) that runs `buildFoundation(report)` and commits all files in one branch — extend `write.ts` with an `openMultiFilePr` (loop the Contents API or one git-tree commit), then open a draft PR. Reuse the audit/installation-token plumbing already in `practices/apply`. ~1 session.

## 5. `maintain.mjs note` defines memory `kind`s but nothing emits the high-value "failed-approach" / "decision" entries
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/standard/memory.ts:21-36 (open vocab: `decision | gotcha | failed-approach | convention | reference`); src/lib/standard/maintain.ts:51-65 (`note <kind> <text>` writes any kind); src/lib/onboarding/skill.ts:249 (the only `note` the skill prescribes is `note progress`)
- **Scenario**: The memory store's whole reason to exist is the "tried-and-failed ledger" so agents don't repeat dead ends (`memory.ts:12`). But the only `note` invocation baked into the skill is `note progress` — a session log. The durable, reuse-across-sessions kinds (`failed-approach`, `decision`, `gotcha`) are documented but never actually triggered by the workflow.
- **Gap**: Grep across the skill/track text shows `note progress` is the sole prescribed write; no track's definition-of-done says "log the decision/dead-end you hit as a `failed-approach` memory." The most valuable memory category is documented schema with no behavioral hook, so stores fill with progress noise instead of durable knowledge.
- **Impact**: Makes the memory store deliver its headline benefit (cross-session learning, no repeated dead ends) rather than a changelog. Cheap, high-leverage prompt-engineering change to the generated skill.
- **Fix sketch**: In `skill.ts` `runProtocol`/`trackBlock`, add a step: "When you hit a wrong turn or make a non-obvious call, append `node .ai/maintain.mjs note failed-approach \"…\"` / `note decision \"…\"`." Add a `definitionOfDone` line per track in `tracks.ts`. ~half a session, prompt-only.

## 6. The skill is generated but never persisted, history-tracked, or diffable across scans
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/app/api/report/skill/route.ts:50-60 (generates on every GET, streams as an attachment, never stored); src/app/api/history (report history exists for scans)
- **Scenario**: A maintainer adopts a few tracks, re-scans, and wants to download the *updated* skill and see what changed (which tracks dropped off, which conformance gaps closed). Today every download is ephemeral and stateless; there is no record that a skill was ever generated or how it evolved.
- **Gap**: Unlike scans (which have `api/history` and `getScanReportByCommit`), the skill is computed on demand and discarded. Grep confirms no persistence of generated skills and no diff/version surface. Combined with finding 1, this means a maintainer can't see their adoption trajectory — only re-derive a fresh snapshot.
- **Impact**: Enables a "your onboarding over time" view (tracks closed, conformance trend) and lets orgs audit which repos generated/adopted skills — turning a one-off file into a tracked program. Natural complement to the conformance loop (finding 1).
- **Fix sketch**: On generation, persist a lightweight record `{ repo, headSha, trackIds, generatedAt }` keyed like scans; add a small "skill history" section to the report or org view that diffs track sets between two scans. Lean on the existing scan-history storage pattern. ~1 session.
