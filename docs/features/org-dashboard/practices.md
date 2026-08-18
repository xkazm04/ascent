# Practices

A **practice** is a recommended engineering improvement, one per dimension (D1–D9), that
Ascent can scaffold as a concrete starter file and **open as a draft pull request** in a
target repo. It turns a roadmap insight ("you're weak on CI gates") into a leak-free
artifact ("here's a starter `ci.yml` tailored to this repo's language") that a team can
review and merge. Practices power the org-level [Practice Library](./org-intelligence.md)
and its "apply" buttons.

## Catalog (`src/lib/practices.ts`)

`PRACTICES: PracticeDef[]` defines nine practices, each with `{ id, label, dimId, what,
starter[] }`. `dimId` ties the practice to the dimension it strengthens, so the org gap
analysis can link a weak dimension to its practice.

| ID | Practice | Dim |
| --- | --- | --- |
| `agent-guidance` | Agent guidance (CLAUDE.md / AGENTS.md) | D1 |
| `test-discipline` | Test discipline | D2 |
| `ci-gates` | CI gates on merge | D3 |
| `agent-in-loop` | Agent in the loop | D4 |
| `docs-adrs` | Architecture docs & ADRs | D5 |
| `enforced-quality` | Enforced quality | D6 |
| `legible-history` | Legible, attributable history | D7 |
| `ai-harness` | AI process & harness | D8 |
| `supply-chain-security` | Supply-chain security | D9 |

## Artifact generation (`src/lib/practice-artifact.ts`)

`buildArtifact(practiceId, ctx: RepoContext)` is a **pure, deterministic, keyless** builder
(no LLM, no I/O) returning an `ArtifactSpec`:

```ts
{ path, body, commitMessage, branch, prTitle, prBody, title }
```

It is **language-aware**: a `commandsFor(language)` helper supplies the right test/lint
commands and CI setup step (node, python, go, rust, or generic), so a Node repo gets
`npm test` while a Python repo gets `pytest`. A per-practice `switch` builds the right file
(e.g. `agent-guidance` → `AGENTS.md`, `ci-gates` → `.github/workflows/ci.yml`, `docs-adrs`
→ an ADR template, `enforced-quality` → a PR template with a Definition-of-Done). It is
**leak-free**: repo-specific details are left as `<!-- TODO -->` placeholders, and the body
degrades to placeholders when context is sparse.

`POST /api/practices/generate` accepts `{ repo, practiceId }`, fetches read-only repo
context from GitHub, calls `buildArtifact`, and returns the spec for **preview** (no
writes).

## Apply flow (`POST /api/practices/apply` → `src/lib/github/write.ts`)

`POST /api/practices/apply { repo, practiceId, base? }` opens a draft PR and returns
`{ url, number, branch, reused, path }`. Gates:

- GitHub App installed with `contents: write` + `pull_requests: write` (else `503`).
- If auth is configured, a signed-in session (else `401`).
- Caller holds at least the **admin** role in the target org (`requireOrgRole(owner,
  "admin")`, else `403`), since this route pushes a branch/commit and opens a draft PR into a
  real customer repo using the org's installation token, so it requires the same floor as
  other mutations of comparable blast radius (segment delete, credit grants), not merely
  "member". The batch route (below) applies the same gate.
- Ascent installed on `owner` (`getInstallationIdForOwner`, else `403`).

`openDraftPr()` then drives the GitHub git-data API with the installation token:

1. Resolve the base branch (default branch if `base` omitted).
2. Read the base ref SHA.
3. Create `refs/heads/<branch>` at that SHA (tolerates `422` if it already exists;
   idempotent).
4. `PUT` the file via the Contents API (includes the existing blob `sha` if updating).
5. Open a **draft** PR; if one already exists for the head, fetch and return it with
   `reused: true`.

When the DB is configured, a `practice.pr_opened` audit entry is recorded. `AppApiError`s
are mapped to friendly messages (403 → "install lacks write scope", 404 → "check repo and
base branch").

### Shared write path, drift guard, and PR tracking (`src/lib/practices/apply.ts`)

Both the single-repo and batch routes go through `applyPracticeToRepo()`, so the
three behaviors below apply to either. Its inner write (openDraftPr + the uniform
`path`/`pr`/`reused` audit envelope) is exported as `openArtifactDraftPr()`, which the
AI-stance module reuses to open its `AI_POLICY.md` PR (`/api/org/ai-stance/apply`, see
[org-intelligence.md](./org-intelligence.md)) instead of forking the customer-repo write path.

- **Content-drift guard.** The caller may pass the `expectedFingerprint` it previewed.
  If `artifactFingerprint(artifact.body)` no longer matches, apply returns
  `{ kind: "content-drift" }` and **opens no PR**, so a template or repo-context
  change between preview and apply can't silently land unreviewed content.
- **PR tracking.** On success, `recordPracticePr()` (`src/lib/db/improvement.ts`)
  persists the opened PR as an `ImprovementPr`, which is what the war room polls for
  merge detection and post-merge impact measurement. A failure here is logged loudly:
  the PR is open but untracked.

### Batch apply (`POST /api/practices/apply-batch`)

Applies one practice across many repos: `{ repos: [...], practiceId, base? }`, bounded
to `MAX_BATCH = 25`, fanned out with `mapPool` at `SCAN_CONCURRENCY`, with per-repo
error isolation so one failure doesn't sink the batch. Driven by
`PracticeApplyBatch.tsx` / `PracticeApplyBatchResults.tsx`.

## UI (`src/app/org/[slug]/practices/page.tsx`, `src/features/shared/practices/PracticeApply.tsx`)

The practices page renders one card per practice (label, "what", adoption meter, exemplar
link, gap repos, the reusable-shape checklist) with an embedded `PracticeApply`. That
client component lets the user pick a target gap repo, **Preview** (→ `/generate`, shows
the artifact body in a collapsible block), and **Open draft PR** (→ `/apply`, shows a link
to the PR, labeled "Existing draft PR" when reused). Errors surface inline.

## Playbooks: the org's OWN standards (authored, not mined)

Alongside the mined practices, the Practice Library lists **playbooks** an org authors for
itself (`src/lib/db/playbooks.ts`, `/api/org/playbooks`). Three things connect the two
halves:

- **Promote a mined practice into a playbook (G7-25).** A mined practice detail carries a
  "Save as playbook →" action that opens the author form pre-filled from the practice:
  its label becomes the title, its dimension carries over, its "what" plus the exemplar
  repo become the summary, and its leak-free starter becomes the checklist. The mapping is
  pure and bounded to exactly what `createPlaybook` stores (single-line title ≤200,
  summary ≤1000, ≤20 steps of ≤300 chars, see
  `src/features/shared/practices/promotePractice.ts`), so nothing is silently truncated on
  save. Everything stays editable: a promotion is a review, not a commit.
- **Fleet rollout for playbooks (G7-24).** `POST /api/org/playbooks/[id]/apply-batch
  { repos[] }` opens a draft PR seeding the playbook into a whole segment (or the whole
  fleet) in one action, mirroring the practices batch verbatim. Its bounds: the **admin**
  role (resolved from the playbook's own org; the single-repo `apply` stays member-level),
  every repo must belong to that org (a foreign coordinate fails the whole batch, never
  partially applies), **25 repos per call** after case-insensitive dedupe with the excess
  reported as `skipped`, and `SCAN_CONCURRENCY` lanes. One repo's failure never aborts the
  rest. UI: `PlaybookApplyBatch.tsx`, behind the same `batchPrConfirm` dialog the practices
  rollout uses; the single-repo and batch paths are mutually locked. The write sequence
  itself is single-sourced in `src/lib/org/playbook-apply.ts`, shared with the single route.
- **Rollout rollup (G7-20).** `summarizeRollout` (in `practiceRows.ts`) folds the rows
  already on screen into the fleet answer: repos adopting, starter PRs landed / in flight,
  and lift, rendered by `PracticeRolloutStrip.tsx`. It adds no query and no schema: the
  per-repo loop was already complete (apply → `ImprovementPr` → `refreshOps` merges it →
  `verifyMergedPrs` stamps the measured dimension impact), what was missing was the
  aggregate. Playbook lift is **sample-weighted** by `adoption.measured` so a one-repo
  playbook can't outvote a twelve-repo one, and it is reported SEPARATELY from practice-PR
  lift because the two are measured on different bases (adoption mark vs. a specific merged
  PR). A null lift means "not measured yet" and never drags an average toward zero; the
  strip renders nothing at all until something has actually been rolled out.

## Relationship to recommendations

Recommendations (see [report.md](../reporting/report.md)) are *exploratory, prioritized, status-tracked*
nudges per dimension. Practices are the *concrete scaffold* for the same dimension. The org
gap analysis (`getOrgGapAnalysis` in `src/lib/db/org-insights.ts`) links a systemic gap to its
practice via `PRACTICES.find(p => p.dimId === dimId)?.id`, so "common gap in D3" points
straight at the CI-gates practice and its exemplars.

## Key files

| File | Role |
| --- | --- |
| `src/lib/practices.ts` | `PRACTICES[]` catalog + `PracticeDef`. |
| `src/lib/practice-artifact.ts` | `buildArtifact()`: deterministic, language-aware artifact builder. |
| `src/lib/practice-artifact.test.ts` | Verifies tailored AGENTS.md, language-appropriate CI, non-null for every practice, null for unknown, placeholder degradation. |
| `src/app/api/practices/generate/route.ts` | Preview endpoint (no writes). |
| `src/app/api/practices/apply/route.ts` | Apply endpoint: gates + `openDraftPr` + audit. |
| `src/lib/github/write.ts` | `openDraftPr()`: branch → file → draft PR (idempotent). |
| `src/features/shared/practices/PracticeApply.tsx` | Preview + apply UI. |
| `src/app/api/org/playbooks/[id]/apply-batch/route.ts` | Playbook fleet rollout: admin-gated, org-scoped, capped at 25 repos/run. |
| `src/lib/org/playbook-apply.ts` | The shared single-repo playbook write sequence (PR + adoption mark + audit). |
| `src/features/shared/practices/PlaybookApplyBatch.tsx` | Playbook fleet-rollout UI (select, confirm, per-repo results). |
| `src/features/shared/practices/promotePractice.ts` | Mined practice → playbook draft mapping (pure, bounded). |
| `src/features/shared/practices/PracticeRolloutStrip.tsx` | Fleet "applied → landed → lift" rollup strip. |

## Your house pattern — mined from the org's own repos (W6, 2026-08-14)

[`VISION-TRANSITION.md`](../../VISION-TRANSITION.md) §Pillar 2 promised that the org's strongest
repos would have their institutional knowledge **templatized and offered to the repos that lack
it**: "mine those exemplars, templatize their *shape* (not their code), and systematically offer it
to the teams/repos that lack them". What shipped was nine hand-written starters, one per dimension,
**identical for every customer**. An org that applied all nine had exhausted the product, and the
starters described a generic good practice rather than *this org's* practice.

This is the missing half. The **House pattern** panel sits above the catalog on the Practices tab
and describes what the organization actually shares.

### What "shape" means, and why it is leak-safe

Two kinds of structure are extracted at scan time
(`src/lib/analyze/practice-shape.ts` → `Scan.practiceShape`), and **neither carries an artifact's
body**:

| | |
| --- | --- |
| **Outline** | The markdown heading skeleton (H1–H3) of a guidance file, PR template, ADR or CONTRIBUTING. |
| **Layout** | The directory/file layout of a harness or workflow set: path segments only. |

The leak boundary the vision draws is **proprietary code**, and the travel is repo→repo *inside one
organization*: an org's own headings moving to its own other repo is precisely the intended reuse.
What must never travel is the body (where the code, the credentials and the customer names live),
so **the body is not extracted at all** rather than extracted-and-filtered.

The one place body content could leak into an outline is a `#` inside a fenced code block (a shell
comment, a CSS id). `outlineOf` tracks fences explicitly and skips them; a test pins that a deploy
script inside a fence never reaches the shape.

Mined shapes are **strictly org-internal**. `getOrgPracticeShapes` is org-scoped, there is no
cross-org variant, and nothing derived from it appears on a public report or in the shared corpus.

### The house pattern is AGREEMENT, not the best repo's copy

The tempting implementation is "take the highest-scoring repo's outline and hand it to everyone".
That is one team's document promoted to a standard nobody agreed to, and the first reader who
recognises it as *their* file reads the whole feature as surveillance rather than reuse.

So a line enters the pattern only when at least **`MIN_AGREEMENT` (2)** exemplar repos carry it
**independently**, counted by *distinct repo* so one verbose repo cannot manufacture a pattern from
its own three ADRs. Layout agreement compares trailing path segments, not full paths, because
`evals/golden/` and `packages/api/evals/golden/` are the same practice in two places.

Normalization stops at case and punctuation **on purpose**: `Build & Test` and `Build and Test` read
as one section to a human, but equating them needs a synonym table, and that is where a "your own
pattern" claim quietly becomes the vendor's interpretation of it.

**Every mined line carries its evidence**: the `n×` count of how many repos agreed, and every
practice names which repos those were. A suggestion an engineer cannot trace back to their own
codebase is one they are entitled to ignore.

### Three honest silences, all rendered

1. **Fewer than 2 exemplars** → no pattern, and the panel says one strong repository's document is
   that team's document, not a house standard.
2. **Exemplars that share nothing** → no pattern, rather than promoting the best repo's copy.
3. **A pattern with no gap repos** → said plainly as a good state, not dressed up as a task.

`minedStarter()` returns `null` when nothing was mined: the signal to fall back to the static
starter. A caller **must say which it used**: "your own pattern, from 3 repos" and "a generic
starter" are very different claims to put in front of an engineer.

Shapes appear as repos are re-scanned; there is no backfill, and thin coverage reads as thin
coverage rather than as "your org shares nothing".

## Registry-backed state (UC2, 2026-08-18)

Practices are the second consumer of the org's registry repo. The same
`RegistrySyncStrip` heads this tab (unmapped ⇒ a pointer to the Registry tab; mapped ⇒ the repo,
last-index time and counts), and a **"From your registry"** section
(`src/features/shared/practices/RegistryPractices.tsx`) lists the `practices/<slug>/PRACTICE.md`
entries the indexer read out of that repo, above ascent's generic catalog.

Those rows carry the dimension, the `applies-when` line and an **Open in registry** link — and
deliberately **no Apply button**. They are files under the customer's own review process; ascent
indexes them so the whole fleet can see what the org already agreed on, but applying one is a write
into someone else's repo through a PR flow that does not exist yet (see Known gaps). The section
renders nothing when there are no registry-origin shapes, so an org that never mapped a registry sees
no empty scaffolding.

## Known gaps

- **Adoption is tracked at the PR, not the repo**: `recordPracticePr()` persists each
  opened PR as an `ImprovementPr` (so merge detection and post-merge impact work), but
  there is no separate "practice X is adopted by repo Y" projection; adoption is
  derived from scan signals rather than from the apply event.
- **Reuse doesn't update**: an already-open PR is returned as-is; a re-apply won't push a
  refreshed template.
- **Overwrites existing files**: `PUT` updates a file already at the path; there's no
  "create-only" safety check.
- **Batch apply is capped**: both `POST /api/practices/apply-batch` and
  `POST /api/org/playbooks/[id]/apply-batch` are bounded to **25 repos per call** (a
  deliberate bound, not a limitation to remove: one click must never become hundreds of
  PRs); larger fleets need repeated, re-confirmed passes. The `base` override has no UI yet.
- (Closed 2026-08-14.) ~~The rollout rollup is page-local.~~ The rollout proof now rides
  the executive briefing: `buildExecBriefing` folds `buildPracticeLibrarySummary(...)
  .rollout` onto `ExecBriefing.proof`, and one shared `briefingProofLine` renders it on the
  Briefing tab (`BriefingProofBanner`), the public share page, the board PDF and the
  Copy-for-LLM markdown (`## Proof — improvement shipped and measured`). Always fleet-wide
  (practices aren't segment-scoped) and every renderer says so; null when nothing was ever
  applied, so "never tried" can't read as "tried and nothing landed".
- **Catalog is global**: ascent's own practice catalog can't be customized per org — but an org can now
  declare its own in its registry repo, and those are read and shown (see Registry-backed state).
- **Registry practices are read-only**: a `practices/<slug>/PRACTICE.md` from the registry can be opened
  in git but not applied from ascent; the "apply a registry practice to N repos" PR flow is not built.
