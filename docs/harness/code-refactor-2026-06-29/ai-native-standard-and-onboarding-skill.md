# Code Refactor — AI-Native Standard & Onboarding Skill
> Total: 5 | Critical: 0 High: 0 Medium: 2 Low: 3

This context is unusually clean (it has been through prior refactor waves), so there are no
clearly-dead exported functions or large copy-pasted blocks. The findings below are the genuine,
verifiable cruft: two duplications that must be hand-kept-in-sync, one write-only field, one
split source-of-truth, and one unused barrel re-export.

## 1. `langDeliverable` re-hardcodes the `summary` strings already in `CONTROL`
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/onboarding/tracks.ts:334, 339 (vs. 101, 126)
- **Scenario**: `langDeliverable()` builds the language-aware deliverable for D2/D3. It only needs to
  override the `path`, but it also re-states the `summary`:
  - D2 (line 334): `"make coverage visible to the agent locally, then enforce a minimum as a CI backstop"` — byte-identical to `CONTROL.D2.deliverable.summary` (line 101).
  - D3 (line 339): `"the same lint/typecheck/test checks run locally before push and enforced on merge"` — byte-identical to `CONTROL.D3.deliverable.summary` (line 126).
- **Root cause**: When the language-aware path was added, the whole `{ path, summary }` object was
  copied from the static control instead of reusing the existing `summary`.
- **Impact**: Two literal strings live in two places. Editing the D2/D3 deliverable summary in the
  obvious place (`CONTROL`) silently leaves the language-aware path showing the old wording for every
  Node/Python/Go/Rust repo (i.e. the common case), with no test catching the divergence.
- **Fix sketch**: In `langDeliverable`, return only the path override and pull the summary from the
  source of truth, e.g. `summary: CONTROL[dimId].deliverable.summary`. (The function already runs
  after `CONTROL` is defined, so it can reference it directly.) Removes both duplicated literals.

## 2. `definitionOfDone` paraphrases `prePushChecklist` + `ciHardPasses` for every dimension
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/onboarding/tracks.ts:72-279 (the `CONTROL` matrix; e.g. D2 lines 103-117, D6 lines 195-205)
- **Scenario**: Each of the 9 `ControlSpec` entries carries three parallel bullet lists. The
  `definitionOfDone` is, in nearly every case, a reworded merge of the same dimension's
  `prePushChecklist` (the local norms) plus its `ciHardPasses` (the backstops). E.g. D2's DoD
  "Every behavioral change ships with a test", "Coverage is visible locally and checked before push",
  "One-command test run wired into the local hook", "CI enforces a coverage floor as the backstop"
  are paraphrases of the three prePush items + the two CI items. This holds across all 9 dimensions —
  roughly 27 hand-maintained lists / ~90 bullets where DoD ⊆ (prePush ∪ ciHardPass).
- **Root cause**: Three lists were authored independently per dimension; the DoD was written as a
  hand-rolled summary of the other two rather than derived from them.
- **Impact**: The largest maintenance surface in the file. A change to a pre-push or CI item won't
  flow into the DoD, so the rendered skill can show a "definition of done" that contradicts the very
  checklist above it — exactly the kind of drift that erodes trust in a generated artifact, and
  nothing keeps the three in sync.
- **Fix sketch**: Prefer deriving the rendered DoD from `prePushChecklist` + `ciHardPasses` (e.g. a
  small `definitionOfDone(spec)` helper in skill.ts that labels each group "local norm" / "backstop"),
  dropping the per-dimension `definitionOfDone` field entirely. If the curated reordering is
  intentional UX, at minimum drop it down to only the items that are NOT already covered by the other
  two lists, so each fact lives once. (Tradeoff: the curated phrasing is lost — call it out in review.)

## 3. `GeneratedSkill.fileName` is a write-only (dead) field
- **Severity**: Low
- **Category**: dead-code
- **File**: src/lib/onboarding/skill.ts:19, 45
- **Scenario**: The `GeneratedSkill` interface declares `fileName: string` (line 19) and
  `buildOnboardingSkill` sets it to the constant `"SKILL.md"` (line 45). A repo-wide grep for
  `fileName` finds only the declaration, that assignment, and a mock literal in
  `report/skill/route.test.ts:58` — it is never read. The route derives its own download filename via
  `safeFilenameSegment(...)` and uses only `skill.body`; the redundant `path` field already encodes
  `.../SKILL.md`.
- **Root cause**: Leftover field from an earlier shape of the skill object; the constant `"SKILL.md"`
  became redundant once `path` carried the full repo-relative location.
- **Impact**: Minor — a confusing field that implies a configurability that doesn't exist, and dead
  weight on the public interface.
- **Fix sketch**: Remove `fileName` from the `GeneratedSkill` interface and from the return object;
  drop the property from the route test mock. (`path` already conveys the filename.)

## 4. Per-language CI setup knowledge is split between `CI_SETUP` and `ciWorkflow`
- **Severity**: Low
- **Category**: structure
- **File**: src/lib/onboarding/tracks.ts:310-316 (`CI_SETUP`) and src/lib/practice-artifact.ts:70-80 (`ciWorkflow`)
- **Scenario**: Two places encode "which GitHub Action sets up each language": `CI_SETUP` maps
  `node→"setup-node"`, `python→"setup-python"`, `go→"setup-go"`, `rust→"rust-toolchain"` (short labels
  woven into the deliverable path), while `ciWorkflow`'s ternary maps the same `CiKind` to the full
  `actions/setup-node@v4` / `actions/setup-python@v5` / `actions/setup-go@v5` /
  `dtolnay/rust-toolchain@stable` steps. `commandsFor` (same file) is explicitly documented as "the
  single source of truth for language→commands", but this setup-step dimension lives outside it, in
  two spots.
- **Root cause**: The setup-action knowledge grew alongside `commandsFor` rather than inside the same
  per-language record, so a second copy appeared when the onboarding track needed a short label.
- **Impact**: Adding a language family (or an action version bump) requires editing two unrelated
  files that don't reference each other; easy to update one and forget the other.
- **Fix sketch**: Fold a `ciSetup` (or `{ label, step }`) field into the `LangCommands` returned by
  `commandsFor`, then have `CI_SETUP` and `ciWorkflow` both read from it. One source of truth for the
  language→setup mapping.

## 5. Unused barrel re-export `buildManifest` (and onboarding barrel re-exports)
- **Severity**: Low
- **Category**: dead-code
- **File**: src/lib/standard/index.ts:14 (and src/lib/onboarding/index.ts:5-10)
- **Scenario**: `standard/index.ts` re-exports `buildManifest` (line 14), but no consumer imports it
  through the barrel — it's only used internally by `buildFoundation` via the local `import` (line 7),
  and no test imports `buildManifest` (the standard tests import `buildManifestData` /
  `serializeManifestYaml`, not the `GeneratedFile` wrapper). Likewise the `onboarding` barrel
  re-exports `selectTracks`, `WEAK_THRESHOLD`, `OnboardingTrack`, `SelectOpts`, but every caller
  imports those directly from `./tracks` (skill.ts and the tests); the route only uses
  `buildOnboardingSkill`. So these re-exported names have zero importers through their barrel.
- **Root cause**: The barrels re-export the full builder surface for symmetry; some names were never
  actually consumed via the barrel.
- **Impact**: Minor — extra public surface that suggests an entry point nobody uses, and a slightly
  misleading "this is the supported import path" signal.
- **Fix sketch**: Drop `buildManifest` from the `standard/index.ts` re-export (keep the internal
  import for `buildFoundation`). For `onboarding/index.ts`, either keep the re-exports as the
  intended public API (and switch skill.ts/tests to import from the barrel) or trim them to what is
  actually consumed through it (`buildOnboardingSkill`, `GeneratedSkill`). Pick one direction so the
  barrel's "import from here" promise is true.
