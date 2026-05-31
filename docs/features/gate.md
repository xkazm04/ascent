# PR maturity gate

The maturity gate turns a scan into a **CI pass/fail**. A repo adds the published GitHub
Action to a workflow; on each PR the action scores the PR head against an archetype-aware
policy and exits non-zero if the repo falls short — so a team can *block merges* on
AI-native maturity. The same scoring also drives a GitHub **Check Run** and a sticky PR
**comment** when Ascent runs as a [GitHub App](github-app.md).

## Gate API (`src/app/api/gate/[owner]/[repo]/route.ts`)

`GET /api/gate/:owner/:repo` scores the repo and evaluates a policy, returning **`200` on
pass** and **`422` on fail** so `curl --fail` / CI can branch on the status alone.

| Query param | Effect |
| --- | --- |
| `ref` | Score this exact ref (PR head SHA / branch) instead of the default branch. |
| `mock=0` / `mock=false` | Score with the LLM instead of the deterministic mock (default mock). |
| `min_level` | Minimum maturity level, e.g. `L3`. |
| `min_overall` | Minimum overall score (0–100). |
| `min_dimension` | Minimum score for **any single** dimension. |
| `no_ungoverned=1` | Forbid the "ungoverned" posture (heavy AI, light guardrails). |

Flow: normalize names → if `?ref` scan that ref fresh, else resolve HEAD and use the
LLM/mock cache → `evaluateGate(report, policy)` with a policy from `policyFromParams()` (or
archetype-aware defaults) → return a `GateResult`:

```jsonc
{ "repo", "ref", "pass", "level", "overallScore", "posture", "archetype",
  "policy": { … }, "failures": [ … ] }
```

`evaluateGate` and `policyFromParams` live in `src/lib/scoring/gate.ts`.

## GitHub Action (`action.yml` + `scripts/maturity-gate.mjs`)

`action.yml` is a composite action. Inputs (only non-empty ones are forwarded):

| Input | Notes |
| --- | --- |
| `ascent-url` (required) | Base URL of the Ascent deployment. |
| `repo` | `owner/repo` (defaults to the workflow's repo). |
| `ref` | Ref to score; on a `pull_request` set to `github.event.pull_request.head.sha`. |
| `min-level` / `min-overall` / `min-dimension` | Policy thresholds. |
| `no-ungoverned` | Reject the ungoverned posture. |
| `live` | Use the live LLM (`true`) instead of mock. |

It runs Node 20 and invokes `scripts/maturity-gate.mjs`, which builds the query string
(`--min-level L3` → `?min_level=L3`), calls `${ASCENT_URL}/api/gate/<repo>?…`, and exits:
**0** on `pass: true` (prints a green summary), **1** on fail (lists `failures`), **2** on
error (network / 5xx / bad repo). `.github/workflows/maturity.yml` is the repo's own
example using the action (and `npm run gate` runs the script locally).

## Check Run + sticky comment (App mode)

When Ascent is installed as a GitHub App, the webhook gates PRs and writes results back
using the installation token (see [github-app.md](github-app.md)).

| Function | File | Role |
| --- | --- | --- |
| `buildGateComment()` | `src/lib/scoring/gate-comment.ts` | **Pure** builder → `{ conclusion, title, summary, commentBody }`. Includes verdict, level, overall, posture, archetype lens, adoption/rigor, an optional baseline delta phrase ("overall +5 · L2 → L3"), failures, top-3 roadmap items, and the applied policy. The comment body carries a hidden `<!-- ascent-maturity-gate -->` marker. |
| `createCheckRun()` | `src/lib/github/checks.ts` | Creates a GitHub **Check Run** on the head SHA (the status that can block merge) with `conclusion` success/failure, title, markdown summary, and a deep link to the report. |
| `upsertStickyComment()` | `src/lib/github/checks.ts` | Finds the marker in the first 5 pages of PR comments and **updates in place** (or creates one), so re-runs don't stack duplicates. |

## Key files

| File | Role |
| --- | --- |
| `src/app/api/gate/[owner]/[repo]/route.ts` | Gate endpoint: score → evaluate policy → 200/422. |
| `src/lib/scoring/gate.ts` | `evaluateGate()`, `policyFromParams()` (archetype-aware defaults). |
| `src/lib/scoring/gate-comment.ts` | `buildGateComment()` — check title/summary + PR comment markdown. |
| `src/lib/github/checks.ts` | `createCheckRun()`, `upsertStickyComment()`. |
| `action.yml` | Composite GitHub Action definition. |
| `scripts/maturity-gate.mjs` | CLI: call the gate API, exit 0/1/2 (`npm run gate`). |
| `.github/workflows/maturity.yml` | Example workflow gating this repo. |

## Known gaps

- **Fork PRs**: if a fork's head commit isn't reachable via the base repo's tree API, the
  webhook gate falls back to scoring the default branch — the check still posts, but less
  precisely.
- The gate API scores via **mock** by default; pass `?mock=0` / `live: true` for an
  LLM-scored verdict (slower, needs a key).
- Sticky-comment search is bounded to the first 5 comment pages on very long threads.
