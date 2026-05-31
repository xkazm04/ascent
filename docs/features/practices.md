# Practices

A **practice** is a recommended engineering improvement — one per dimension (D1–D9) — that
Ascent can scaffold as a concrete starter file and **open as a draft pull request** in a
target repo. It turns a roadmap insight ("you're weak on CI gates") into a leak-free
artifact ("here's a starter `ci.yml` tailored to this repo's language") that a team can
review and merge. Practices power the org-level [Practice Library](org-intelligence/README.md)
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

## UI (`src/app/org/[slug]/practices/page.tsx`, `src/components/org/PracticeApply.tsx`)

The practices page renders one card per practice (label, "what", adoption meter, exemplar
link, gap repos, the reusable-shape checklist) with an embedded `PracticeApply`. That
client component lets the user pick a target gap repo, **Preview** (→ `/generate`, shows
the artifact body in a collapsible block), and **Open draft PR** (→ `/apply`, shows a link
to the PR, labeled "Existing draft PR" when reused). Errors surface inline.

## Relationship to recommendations

Recommendations (see [report.md](report.md)) are *exploratory, prioritized, status-tracked*
nudges per dimension. Practices are the *concrete scaffold* for the same dimension. The org
gap analysis (`getOrgGapAnalysis` in `src/lib/db/org.ts`) links a systemic gap to its
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
| `src/components/org/PracticeApply.tsx` | Preview + apply UI. |

## Known gaps

- **No adoption tracking** — applying a practice opens a PR but doesn't persist
  "applied to repo X" state.
- **Reuse doesn't update** — an already-open PR is returned as-is; a re-apply won't push a
  refreshed template.
- **Overwrites existing files** — `PUT` updates a file already at the path; there's no
  "create-only" safety check.
- **One-at-a-time** — no bulk "apply to all gap repos"; the `base` override has no UI yet.
- **Catalog is global** — orgs can't customize practices or starter checklists.
