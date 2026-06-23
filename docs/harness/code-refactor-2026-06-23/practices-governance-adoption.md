# Code Refactor — Practices, Governance & Adoption
> Context group: Org Dashboard & Analytics
> Total: 4 findings (Critical: 0, High: 2, Medium: 1, Low: 1)

## 1. Apply-PR pipeline duplicated between `/api/practices/apply` and the batch worker
- **Severity**: High
- **Category**: duplication
- **File**: src/app/api/practices/apply/route.ts:53-79 and src/app/api/practices/apply-batch/route.ts:85-117
- **Scenario**: Both routes run the identical per-repo sequence: `fetchRepoContext(ref, token)` → `buildArtifact(practiceId, ctx)` → null-guard → `openDraftPr({ token, owner, repo, branch, base, path, content, commitMessage, prTitle, prBody })` → `recordAudit("practice.pr_opened", { repo, practiceId, path, pr, reused, [batch] }, { orgId, actorId })`. The `openDraftPr` argument-mapping block (single route lines 59-70, batch lines 90-101) is character-for-character the same, and the `recordAudit` payload differs only by the `batch: true` flag.
- **Root cause**: `apply-batch` was added later as a fleet-rollout of the single `apply` action (its header comment says "Same trust model as /api/practices/apply … then fanned out"). The shared core was copied into the pool worker rather than extracted, so the two now carry parallel copies of the same write logic.
- **Impact**: Two copies of a customer-repo WRITE path must be kept in lockstep. A change to artifact mapping, the audit payload shape, or `openDraftPr` options (e.g. a new field) has to be made in both or the single and batch paths silently drift — exactly the kind of divergence that ships an inconsistent PR body/branch to customers depending on which button was clicked.
- **Fix sketch**: Extract one helper, e.g. `openPracticeStarterPr(token, ref, practiceId, base, audit: { orgId; actorId; batch?: boolean })` in a shared module (alongside `buildArtifact` in `src/lib/practice-artifact.ts`, or a new `src/lib/practices/apply.ts`), returning `{ ok, url, number, reused }` / a typed unknown-practice result. Have it run `fetchRepoContext` → `buildArtifact` → `openDraftPr` → `recordAudit`. The single route calls it once; the batch worker calls it inside `mapPool`. Both routes keep their own auth/tenant gating and HTTP error mapping (which legitimately differ); only the inner write sequence is shared. Behavior-preserving.

## 2. CI snippet preamble re-implemented in the page, duplicating `governanceMarkdown`
- **Severity**: High
- **Category**: duplication
- **File**: src/app/org/[slug]/governance/page.tsx:26-28 (and consumed at :43, :191, :203) vs src/lib/org/governance.ts:226-231
- **Scenario**: `governance/page.tsx` defines a local `ciSnippet(g)` that assembles the GitHub Action YAML: `"- uses: <owner>/ascent@v1"`, `"  with:"`, `"    ascent-url: ${{ vars.ASCENT_URL }}"`, then `...g.ciWith.map((w) => "    " + w)`. `governanceMarkdown` in governance.ts (lines 226-231) builds the byte-identical block (`- uses: <owner>/ascent@v1`, `with:`, `ascent-url: ${{ vars.ASCENT_URL }}`, then the same `ciWith` lines) for the Copy-for-LLM brief. The literal action ref, the `ascent-url` var line, and the indentation contract live in two places.
- **Root cause**: The page needed the snippet for its on-screen `<pre>` and the lib needed it for the markdown brief; each grew its own copy of the preamble instead of sharing one. The file even documents that these conditions must not drift ("the dashboard enforces a bar the copyable CI snippet / gate URL silently drops (policy drift)"), but the *preamble* around `ciWith` is itself duplicated.
- **Impact**: Bump the action version to `@v2`, rename the `ascent-url` input, or change the indent and you must edit both the page and the markdown builder or the on-screen snippet and the LLM brief will hand customers two different (one stale) CI configs — a copy-paste-into-prod hazard for a feature whose whole selling point is "no drift."
- **Fix sketch**: Export a single `ciSnippet(g: GovernanceOverview): string` (or `ciActionYaml(ciWith: string[])`) from `src/lib/org/governance.ts`, use it inside `governanceMarkdown` (indenting its lines for the fenced block), and import it in `governance/page.tsx` to replace the local function at line 26-28. One source for the action preamble.

## 3. `ArtifactSpec.title` is a dead field (set, typed, never read)
- **Severity**: Medium
- **Category**: dead-code
- **File**: src/lib/practice-artifact.ts:26 (interface) and :296 (`title: p.label`)
- **Scenario**: `ArtifactSpec` declares `title: string` and `buildArtifact` populates it with `p.label`, but no consumer ever reads `.title` off an artifact. The two apply routes destructure `branch`, `path`, `content`/`body`, `commitMessage`, `prTitle`, `prBody` (apply/route.ts:63-69, apply-batch/route.ts:94-100) — never `title`. The generate route returns the whole spec as `{ artifact }`, and the client (`PracticeApply.tsx`) reads only `artifact.path` and `artifact.body`. A repo-wide grep for `artifact.title` / `.title` shows every `.title` hit belongs to unrelated objects (recommendations, playbooks, roadmap tracks), never an `ArtifactSpec`.
- **Root cause**: `title` was likely intended as a human label for a preview header but the UI ended up showing `artifact.path` instead; the field was left wired but never surfaced.
- **Impact**: Low cost but genuinely misleading — a maintainer reading `ArtifactSpec` assumes `title` is displayed and may "fix" it or build on it. It's a confusing no-op in the public type of a customer-facing artifact builder.
- **Fix sketch**: Remove `title` from the `ArtifactSpec` interface (line 26) and drop `title: p.label,` from the returned object (line 296). Correspondingly drop `title` from the local `Artifact` interface in `PracticeApply.tsx` (see finding 4). Behavior-preserving — nothing reads it. (Leave `prTitle`, `prBody`, `commitMessage`, `branch` — all are consumed by the routes.)

## 4. `PracticeApply` local `Artifact` interface carries two unused fields
- **Severity**: Low
- **Category**: cleanup
- **File**: src/components/org/PracticeApply.tsx:10-15
- **Scenario**: The component's local `Artifact` interface declares `{ path; title; body; prTitle }`, but only `artifact.path` (line 169) and `artifact.body` (line 173) are ever read. `title` and `prTitle` are dead in this component — they exist only because the interface mirrors a slice of the API response.
- **Root cause**: The interface was hand-written to loosely shadow the `ArtifactSpec` returned by `/api/practices/generate`; the extra fields were included speculatively (e.g. for a richer preview header) but never used.
- **Impact**: Cosmetic. Minor confusion about what the preview actually renders; the unused `title` also props up the dead `ArtifactSpec.title` from finding 3.
- **Fix sketch**: Trim the local `Artifact` interface to `{ path: string; body: string }` (the only two fields the component consumes). Pairs with finding 3's removal of `ArtifactSpec.title`. Behavior-preserving.
