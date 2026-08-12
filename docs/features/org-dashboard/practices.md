# Practices

A **practice** is a recommended engineering improvement — one per dimension (D1–D9) — that
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

It is **language-aware** — a `commandsFor(language)` helper supplies the right test/lint
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
  "admin")`, else `403`) — this route pushes a branch/commit and opens a draft PR into a
  real customer repo using the org's installation token, so it requires the same floor as
  other mutations of comparable blast radius (segment delete, credit grants), not merely
  "member". The batch route (below) applies the same gate.
- Ascent installed on `owner` (`getInstallationIdForOwner`, else `403`).

`openDraftPr()` then drives the GitHub git-data API with the installation token:

1. Resolve the base branch (default branch if `base` omitted).
2. Read the base ref SHA.
3. Create `refs/heads/<branch>` at that SHA (tolerates `422` if it already exists —
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
AI-stance module reuses to open its `AI_POLICY.md` PR (`/api/org/ai-stance/apply` — see
[org-intelligence.md](./org-intelligence.md)) instead of forking the customer-repo write path.

- **Content-drift guard.** The caller may pass the `expectedFingerprint` it previewed.
  If `artifactFingerprint(artifact.body)` no longer matches, apply returns
  `{ kind: "content-drift" }` and **opens no PR** — so a template or repo-context
  change between preview and apply can't silently land unreviewed content.
- **PR tracking.** On success, `recordPracticePr()` (`src/lib/db/improvement.ts`)
  persists the opened PR as an `ImprovementPr`, which is what the war room polls for
  merge detection and post-merge impact measurement. A failure here is logged loudly
  — the PR is open but untracked.

### Batch apply (`POST /api/practices/apply-batch`)

Applies one practice across many repos: `{ repos: [...], practiceId, base? }`, bounded
to `MAX_BATCH = 25`, fanned out with `mapPool` at `SCAN_CONCURRENCY`, with per-repo
error isolation so one failure doesn't sink the batch. Driven by
`PracticeApplyBatch.tsx` / `PracticeApplyBatchResults.tsx`.

## UI (`src/app/org/[slug]/practices/page.tsx`, `src/components/org/PracticeApply.tsx`)

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
  summary ≤1000, ≤20 steps of ≤300 chars) — see
  `src/components/org/practices/promotePractice.ts` — so nothing is silently truncated on
  save. Everything stays editable: a promotion is a review, not a commit.
- **Fleet rollout for playbooks (G7-24).** `POST /api/org/playbooks/[id]/apply-batch
  { repos[] }` opens a draft PR seeding the playbook into a whole segment (or the whole
  fleet) in one action, mirroring the practices batch verbatim. Its bounds: the **admin**
  role (resolved from the playbook's own org — the single-repo `apply` stays member-level),
  every repo must belong to that org (a foreign coordinate fails the whole batch, never
  partially applies), **25 repos per call** after case-insensitive dedupe with the excess
  reported as `skipped`, and `SCAN_CONCURRENCY` lanes. One repo's failure never aborts the
  rest. UI: `PlaybookApplyBatch.tsx`, behind the same `batchPrConfirm` dialog the practices
  rollout uses; the single-repo and batch paths are mutually locked. The write sequence
  itself is single-sourced in `src/lib/org/playbook-apply.ts`, shared with the single route.
- **Rollout rollup (G7-20).** `summarizeRollout` (in `practiceRows.ts`) folds the rows
  already on screen into the fleet answer — repos adopting, starter PRs landed / in flight,
  and lift — rendered by `PracticeRolloutStrip.tsx`. It adds no query and no schema: the
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
| `src/lib/practice-artifact.ts` | `buildArtifact()` — deterministic, language-aware artifact builder. |
| `src/lib/practice-artifact.test.ts` | Verifies tailored AGENTS.md, language-appropriate CI, non-null for every practice, null for unknown, placeholder degradation. |
| `src/app/api/practices/generate/route.ts` | Preview endpoint (no writes). |
| `src/app/api/practices/apply/route.ts` | Apply endpoint: gates + `openDraftPr` + audit. |
| `src/lib/github/write.ts` | `openDraftPr()` — branch → file → draft PR (idempotent). |
| `src/components/org/practices/PracticeApply.tsx` | Preview + apply UI. |
| `src/app/api/org/playbooks/[id]/apply-batch/route.ts` | Playbook fleet rollout — admin-gated, org-scoped, capped at 25 repos/run. |
| `src/lib/org/playbook-apply.ts` | The shared single-repo playbook write sequence (PR + adoption mark + audit). |
| `src/components/org/practices/PlaybookApplyBatch.tsx` | Playbook fleet-rollout UI (select, confirm, per-repo results). |
| `src/components/org/practices/promotePractice.ts` | Mined practice → playbook draft mapping (pure, bounded). |
| `src/components/org/practices/PracticeRolloutStrip.tsx` | Fleet "applied → landed → lift" rollup strip. |

## Known gaps

- **Adoption is tracked at the PR, not the repo** — `recordPracticePr()` persists each
  opened PR as an `ImprovementPr` (so merge detection and post-merge impact work), but
  there is no separate "practice X is adopted by repo Y" projection; adoption is
  derived from scan signals rather than from the apply event.
- **Reuse doesn't update** — an already-open PR is returned as-is; a re-apply won't push a
  refreshed template.
- **Overwrites existing files** — `PUT` updates a file already at the path; there's no
  "create-only" safety check.
- **Batch apply is capped** — both `POST /api/practices/apply-batch` and
  `POST /api/org/playbooks/[id]/apply-batch` are bounded to **25 repos per call** (a
  deliberate bound, not a limitation to remove: one click must never become hundreds of
  PRs); larger fleets need repeated, re-confirmed passes. The `base` override has no UI yet.
- **The rollout rollup is page-local** — `summarizeRollout` folds the rows the Practices
  page already has, so the fleet ROI number lives only there. It is not yet a section in
  the executive briefing (`src/lib/org/briefing.ts`), which remains the natural next home.
- **Catalog is global** — orgs can't customize practices or starter checklists.
