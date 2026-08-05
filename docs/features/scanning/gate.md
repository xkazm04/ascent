# PR maturity gate

The maturity gate turns a scan into a **CI pass/fail**. A repo adds the published GitHub
Action to a workflow; on each PR the action scores the PR head against an archetype-aware
policy and exits non-zero if the repo falls short — so a team can *block merges* on
AI-native maturity. The same scoring also drives a GitHub **Check Run** and a sticky PR
**comment** when Ascent runs as a [GitHub App](../github/github-app.md).

## Why you can trust the security floor

The strongest reason to turn the gate on is **D9 (Supply Chain & Security)**: it is the one
**fully deterministic** dimension in the whole rubric. Its score is the security check
battery's risk-weighted mean, and `src/lib/scoring/engine.ts` takes that signal score
**verbatim** — D9 is excluded from the LLM guardband blend every other dimension goes
through, so the model can only *narrate* the number, never move it.

The practical consequence: a `min-security` / `?min_security=N` floor is a bar **no model
can talk a repo past**, and the same tree always produces the same verdict. That is a
different kind of promise from an AI-graded threshold, and it is why the security floor is
the bar to reach for when the gate has to be defensible.

One deliberate exception, and it only ever *removes* D9 from the score: when the assessment
flags a high-confidence, D9-targeted **visibility** blind spot (CodeQL default-setup leaves
no workflow file; an org-level `SECURITY.md` lives in the org's `.github` repo), D9 is
treated as **unmeasurable** and renormalized out rather than counted as a measured 0. The
model can mark D9 n/a this way; it can never raise a measured D9 sub-check score.

## Gate API (`src/app/api/gate/[owner]/[repo]/route.ts`)

`GET /api/gate/:owner/:repo` scores the repo and evaluates a policy, returning **`200` on
pass**, **`422` on fail**, and **`503` when degraded** (see below) so `curl --fail` / CI can
branch on the status alone.

| Query param | Effect |
| --- | --- |
| `ref` | Score this exact ref (PR head SHA / branch) instead of the default branch. |
| `mock=0` / `mock=false` | Score with the LLM instead of the deterministic mock (default mock). |
| `min_level` | Minimum maturity level, e.g. `L3`. |
| `min_overall` | Minimum overall score (1–100). |
| `min_dimension` | Minimum score for **any single** dimension. |
| `min_security` | Minimum **Security (D9)** score — the deterministic security floor. Also forbids the "ungoverned" posture. |
| `security=1` | The security floor at its default value (`DEFAULT_SECURITY_MIN`), same posture rule. |
| `no_ungoverned=1` | Forbid the "ungoverned" posture (heavy AI, light guardrails). |
| `require_protection=1` | Fail if the default branch has no branch-protection rules (when readable). |

A `≤0`, `>100` or unparseable threshold is **dropped**, not clamped — it is "not set" by
contract, so a bad value can never install an always-pass (`≤0`) or unreachable (`>100`)
floor. An in-range fractional value is truncated (`40.7` → `40`).

Flow: normalize names → if `?ref` scan that ref fresh, else resolve HEAD and use the
LLM/mock cache → resolve the policy → `evaluateGate(report, policy)` → return a `GateResult`:

```jsonc
{ "repo", "ref", "pass", "degraded", "level", "overallScore", "posture", "archetype",
  "policy": { … }, "failures": [ … ], "engine", "confidence", "warnings" }
```

### Policy precedence: params TIGHTEN, never weaken

This endpoint is **unauthenticated by design** (CI calls it with plain `curl`), so a query
param must never be able to relax a bar an org configured:

- The org's **persisted** gate policy (`getOrgGatePolicy` — the same bar the App-mode Check
  Run and the governance fleet view enforce) is the baseline whenever it exists.
- Explicit params then merge **on top as a tighten-only overlay** (`tightenGatePolicy`):
  strictest field wins. `explicitPolicyFromParams` deliberately contributes *only* the
  fields the query names — padding the rest with archetype defaults would drag a
  deliberately-relaxed org bar back toward the default.
- With **no** persisted policy (DB-less / unknown org), params override the archetype default
  per field via `policyFromParams(searchParams, report.archetype)`.

Without this, any single param (`?min_dimension=1`) replaced the whole persisted policy and
handed an anonymous caller — or a PR author editing the workflow URL — a green verdict the
org never configured.

A **failed read** is not "no policy configured". `getOrgGatePolicy` returns `null` *without
throwing* for every legitimate unset case (no DB, unknown org, unset or unparseable column),
so a rejection means only that the bar is **unknown** — and gating on the archetype default
there would silently relax an org's configured merge bar for the length of a DB blip. Both
consumers now fail closed: the endpoint returns **`503`** with no verdict at all, and
`runPrGate` lets the error reach its outer catch, which posts the neutral "could not run"
check and releases the delivery for GitHub to redeliver.

### Incomplete scans fail closed (one honest failure)

A scan where **every** detector failed produces no dimensions, so the renormalized roll-up floors at
`0 / L1` — numerically identical to a genuinely manual repo. `evaluateGate` short-circuits on it
(`isIncompleteReport`: the report's `incomplete` flag, or an empty `dimensions` array on a legacy /
reconstructed report) and returns a single failure with code **`incomplete`** instead of running the
criteria. Two reasons: the gate must not certify a repository it could not read, and it must not emit
a wall of "D1 scored 0" failures that read as findings *about the repository* when the only true
statement is that nothing was measured. Fail-closed, like every other criterion here.

> Fleet parity note: `evaluateGateLite` (the org rollup) does not yet carry an incompleteness signal
> in `GateSnapshot`; such a repo currently fails the fleet view via its `0 / L1` numbers, with a
> less precise reason.

### Degraded scans fail closed (`503`)

`evaluateGate` reads *only* scores — never the engine or the warnings — so a scan that fell
back to the deterministic `MockProvider` can still compute `pass: true`. When the caller
asked for the real AI grade (`?mock=0`) and the LLM was unavailable, that verdict is a floor
score wearing a green badge.

So: when `report.engine.provider === "mock"` **and** the request did not ask for mock, the
response is **`503` with `degraded: true`** — `curl --fail` trips and CI cannot merge on a
fabricated floor. The full verdict is still returned (plus `engine` / `confidence` /
`warnings`) so a consumer that reads the body knows why and can retry. The **default** path
(`?mock` omitted → mock) is the *documented* deterministic rubric, not a degradation, and
keeps the exact 200/422 contract.

A degraded report is also **never written to the scan cache** — the same `degradedToMock`
guard `scan-finalize.ts` applies to every other cache write. Without it the floor score
landed under the `::llm` key, so every retry for that commit was a cache *hit* that re-served
the floor and 503'd again without re-scanning: the gate stayed wedged for the full 15-minute
TTL while the response told the operator to retry. Skipping the write is what makes "retry
the gate" actually true.

### Private repositories

The public endpoint cannot gate a private repo, on purpose. Every ingest passes
`noAmbientToken`, so a scan never runs against the operator's ambient `GITHUB_TOKEN` —
otherwise any anonymous caller could enumerate private repos' full verdicts through the
operator's credentials. Token-less ingestion of a private repo 404s, and the route says so.

**Private repositories are gated through the GitHub App check run** (`/api/app/webhook`),
which scores with the installation's own token and writes the verdict back as a Check Run.
That is the authenticated path — the public `/api/gate/...` endpoint is for public repos.

## GitHub Action (`action.yml` + `scripts/maturity-gate.mjs`)

`action.yml` is a composite action. Inputs (only non-empty ones are forwarded):

| Input | Notes |
| --- | --- |
| `ascent-url` (required) | Base URL of the Ascent deployment. |
| `repo` | `owner/repo` (defaults to the workflow's repo). |
| `ref` | Ref to score; on a `pull_request` set to `github.event.pull_request.head.sha`. |
| `min-level` / `min-overall` / `min-dimension` | Policy thresholds. |
| `min-security` | Minimum **Security (D9)** score — the deterministic security floor. |
| `no-ungoverned` | Reject the ungoverned posture. |
| `require-protection` | Fail if the default branch has no branch-protection rules (when readable). |
| `live` | Use the live LLM (`true`) instead of mock. |

It runs Node 20 and invokes `scripts/maturity-gate.mjs`, which builds the query string
(`--min-level L3` → `?min_level=L3`), calls `${ASCENT_URL}/api/gate/<repo>?…`, and exits:

| Exit | Meaning |
| --- | --- |
| **0** | `pass: true` — prints a green summary. |
| **1** | The repo is **below the bar** (`422`); lists the `failures`. |
| **2** | The gate **could not run**: a network error, a 5xx, a bad repo, missing args — **and a `degraded` (`503`) verdict**. |

`degraded` deliberately exits **2, not 1**: "the grade could not be produced" and "the repo
is below the bar" mean opposite things to whoever reads the job log, and only the second is
the repo's fault. `.github/workflows/maturity.yml` is the repo's own example using the
action (and `npm run gate` runs the script locally).

## Check Run + sticky comment (App mode)

When Ascent is installed as a GitHub App, the webhook gates PRs and writes results back
using the installation token (see [github-app.md](../github/github-app.md)).

| Function | File | Role |
| --- | --- | --- |
| `runPrGate()` | `src/lib/github/pr-gate.ts` | The single check-writing path: score the PR head, diff it against the base, post the Check Run + sticky comment. Shared by the webhook (PR events, the "Re-run" button) and the org gate-policy sweep. |
| `buildGateComment()` | `src/lib/scoring/gate-comment.ts` | **Pure** builder → `{ conclusion, title, summary, commentBody }`. Includes verdict, level, overall, posture, archetype lens, adoption/rigor, an optional baseline delta phrase ("overall +5 · L2 → L3"), failures, a per-failing-dimension table, top-3 roadmap prompts, the scoring path, and the applied policy. The comment body carries a hidden `<!-- ascent-maturity-gate -->` marker; when a D9 floor is enforced it also states that the floor is deterministic. |
| `createCheckRun()` | `src/lib/github/checks.ts` | Creates a GitHub **Check Run** on the head SHA (the status that can block merge) with `conclusion` success/failure/neutral, title, markdown summary, a deep link to the report, and a "Re-run" action. |
| `upsertStickyComment()` | `src/lib/github/checks.ts` | Finds the marker by scanning **forward to the end of the thread** and **updates in place** (or creates one), so re-runs don't stack duplicates. |

Two verdicts are deliberately **`neutral`** rather than pass/fail, because a required status
must never assert something it didn't measure:

- **Fork PRs** whose head commit isn't reachable via the base repo's tree API: the gate falls
  back to scoring the **default branch**, and says so in the title, the summary, and a
  blockquote. Such a verdict structurally cannot reflect the PR's own changes — treat it as
  non-authoritative.
- **A hard failure**: rather than leave a required check silently absent (blocking merge
  forever with no explanation), the gate posts "Maturity gate could not run" with a Re-run
  button.

### When a policy change takes effect

Saving an org gate policy (`POST /api/org/gate-policy`) schedules a **bounded, best-effort
sweep** that re-runs `runPrGate` on the org's open PRs — up to 25 watched repos / 20 PRs,
deferred via `after()`, every failure logged and isolated. Without it, open PRs kept a
verdict from the *old* bar until their next push. The response reports what was scheduled
(`sweep: { status: "scheduled", repos, cap }`) or why nothing was
(`{ status: "skipped", reason: "no-installation" | "no-watched-repos" }`), and the editor
states that outcome verbatim. With no App installation there is no Check Run to write at
all, so the new bar simply applies on each PR's next push or CI run.

## Key files

| File | Role |
| --- | --- |
| `src/app/api/gate/[owner]/[repo]/route.ts` | Gate endpoint: score → resolve policy → 200/422/503. |
| `src/lib/scoring/gate.ts` | `evaluateGate()`, `explicitPolicyFromParams()`, `policyFromParams()`, `tightenGatePolicy()`, `describeGatePolicy()`, `sanitizeGatePolicy()`. |
| `src/lib/scoring/gate-comment.ts` | `buildGateComment()` — check title/summary + PR comment markdown. |
| `src/lib/github/pr-gate.ts` | `runPrGate()` — the shared Check Run + sticky comment writer. |
| `src/lib/github/checks.ts` | `createCheckRun()`, `upsertStickyComment()`. |
| `src/app/api/org/gate-policy/route.ts` | Persist the org bar (owner-gated) + sweep open PRs. |
| `src/components/org/governance/GatePolicyEditor.tsx` | The owner's policy form, incl. when the bar applies. |
| `src/app/badge/gate-snippets.ts` | The public `/badge` curl + workflow snippets, from one policy. |
| `action.yml` | Composite GitHub Action definition. |
| `scripts/maturity-gate.mjs` | CLI: call the gate API, exit 0/1/2 (`npm run gate`). |
| `.github/workflows/maturity.yml` | Example workflow gating this repo. |

## Known gaps

- The gate API scores via **mock** by default; pass `?mock=0` / `live: true` for an
  LLM-scored verdict (slower, needs a key — and a provider outage then surfaces as a `503`
  rather than a silent floor score).
- The policy-change sweep is a **courtesy**, not a guarantee: PRs past the 25-repo / 20-PR
  cap pick the new bar up on their next push or a manual "Re-run".
- Sticky-comment lookup scans forward with a 50-page (5000-comment) safety ceiling; the
  common case still costs a single request.
