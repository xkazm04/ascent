# PR maturity gate

The maturity gate turns a scan into a **CI pass/fail**. A repo adds the published GitHub
Action to a workflow; on each PR the action scores the PR head against an archetype-aware
policy and exits non-zero if the repo falls short, so a team can *block merges* on
AI-native maturity. The same scoring also drives a GitHub **Check Run** and a sticky PR
**comment** when Ascent runs as a [GitHub App](../github/github-app.md).

## Why you can trust the security floor

The strongest reason to turn the gate on is **D9 (Supply Chain & Security)**: it is the one
**fully deterministic** dimension in the whole rubric. Its score is the security check
battery's risk-weighted mean, and `src/lib/scoring/engine.ts` takes that signal score
**verbatim**: D9 is excluded from the LLM guardband blend every other dimension goes
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
| `min_security` | Minimum **Security (D9)** score: the deterministic security floor. Also forbids the "ungoverned" posture. |
| `security=1` | The security floor at its default value (`DEFAULT_SECURITY_MIN`), same posture rule. |
| `no_ungoverned=1` | Forbid the "ungoverned" posture (heavy AI, light guardrails). |
| `require_protection=1` | Fail if the default branch has no branch-protection rules (when readable). |

A `≤0`, `>100` or unparseable threshold is **dropped**, not clamped: it is "not set" by
contract, so a bad value can never install an always-pass (`≤0`) or unreachable (`>100`)
floor. An in-range fractional value is truncated (`40.7` → `40`).

Flow: normalize names → if `?ref` scan that ref fresh, else resolve HEAD and use the
LLM/mock cache → resolve the policy → `evaluateGate(report, policy)` → return a `GateResult`:

```jsonc
{ "repo", "ref", "pass", "degraded", "level", "overallScore", "posture", "archetype",
  "policy": { … }, "failures": [ … ], "engine", "confidence", "warnings" }
```

### Policy precedence: ONE ordered fold, every layer TIGHTENS

This endpoint is **unauthenticated by design** (CI calls it with plain `curl`), so no layer may
relax a bar an org configured. Per [`docs/resolutions/gate-as-code.md`](../../resolutions/gate-as-code.md),
every source of gate policy produces a `GatePolicy` **and nothing else**, and the gate resolves them
as one strictest-wins fold:

```
effective = tighten( tighten( tighten( org ?? archetype, admission ), manifest ), params )
```

The `manifest` slot is deck item #5's and is not built yet; the fold's shape reserves it so that item
lands as a fourth layer rather than as a second precedence rule. Nothing in the chain can weaken what
precedes it, which is the whole safety argument for reading org-scoped state on an anonymous request.

**Adding a bar is four edits and never a fifth resolution path**: (1) the `GatePolicy` field, (2) a
`sanitizeGatePolicy` clause, (3) a `tightenGatePolicy` rule, (4) a `describeGatePolicy` row — plus
either an absolute input on `NormalizedGate` or an honest-null skip there.
`src/lib/scoring/gate-policy-sources.test.ts` holds that as a table-driven structural guard typed over
`Required<GatePolicy>`, so a field added without its four places is a compile error.

The layers:

- The org's **persisted** gate policy (`getOrgGatePolicy`, the same bar the App-mode Check
  Run and the governance fleet view enforce) is the baseline whenever it exists.
- The repo's **admission** decision (moonshot #8) folds next, via `resolveAdmissionLayer`
  (`src/lib/scoring/gate-admission.ts`) — the one IO seam, called by **both** gate surfaces so the
  public endpoint and the merge-blocking Check Run cannot enforce different bars. Tier → floors added:
  `T0` → `requireProtectedBranch` + `minAiGovernedRate: 100` + `forbidPostures: ["ungoverned"]`;
  `T1` → `requireProtectedBranch` + `minAiGovernedRate: 100`; `T2` → `minAiGovernedRate: 90`;
  `T3` and an **unassessed** tier → nothing. `mode: "blocked"` adds `forbidAiAuthorship`. A **read
  failure** is a `503` with no verdict, exactly like the org-policy read.
- Explicit params then merge **on top as a tighten-only overlay** (`tightenGatePolicy`):
  strictest field wins. `explicitPolicyFromParams` deliberately contributes *only* the
  fields the query names; padding the rest with archetype defaults would drag a
  deliberately-relaxed org bar back toward the default.
- With **no** persisted policy (DB-less / unknown org), params override the archetype default
  per field via `policyFromParams(searchParams, report.archetype)`.

Without this, any single param (`?min_dimension=1`) replaced the whole persisted policy and
handed an anonymous caller, or a PR author editing the workflow URL, a green verdict the
org never configured.

A **failed read** is not "no policy configured". `getOrgGatePolicy` returns `null` *without
throwing* for every legitimate unset case (no DB, unknown org, unset or unparseable column),
so a rejection means only that the bar is **unknown**, and gating on the archetype default
there would silently relax an org's configured merge bar for the length of a DB blip. Both
consumers now fail closed: the endpoint returns **`503`** with no verdict at all, and
`runPrGate` lets the error reach its outer catch, which posts the neutral "could not run"
check and releases the delivery for GitHub to redeliver.

### Incomplete scans fail closed (one honest failure)

A scan where **every** detector failed produces no dimensions, so the renormalized roll-up floors at
`0 / L1`, numerically identical to a genuinely manual repo. `evaluateGate` short-circuits on it
(`isIncompleteReport`: the report's `incomplete` flag, or an empty `dimensions` array on a legacy /
reconstructed report) and returns a single failure with code **`incomplete`** instead of running the
criteria. Two reasons: the gate must not certify a repository it could not read, and it must not emit
a wall of "D1 scored 0" failures that read as findings *about the repository* when the only true
statement is that nothing was measured. Fail-closed, like every other criterion here.

> Fleet parity note: `evaluateGateLite` (the org rollup) does not yet carry an incompleteness signal
> in `GateSnapshot`; such a repo currently fails the fleet view via its `0 / L1` numbers, with a
> less precise reason.

### Degraded scans fail closed (`503`)

`evaluateGate` reads *only* scores, never the engine or the warnings, so a scan that fell
back to the deterministic `MockProvider` can still compute `pass: true`. When the caller
asked for the real AI grade (`?mock=0`) and the LLM was unavailable, that verdict is a floor
score wearing a green badge.

So: when `report.engine.provider === "mock"` **and** the request did not ask for mock, the
response is **`503` with `degraded: true`**: `curl --fail` trips and CI cannot merge on a
fabricated floor. The full verdict is still returned (plus `engine` / `confidence` /
`warnings`) so a consumer that reads the body knows why and can retry. The **default** path
(`?mock` omitted → mock) is the *documented* deterministic rubric, not a degradation, and
keeps the exact 200/422 contract.

A degraded report is also **never written to the scan cache**: the same `degradedToMock`
guard `scan-finalize.ts` applies to every other cache write. Without it the floor score
landed under the `::llm` key, so every retry for that commit was a cache *hit* that re-served
the floor and 503'd again without re-scanning: the gate stayed wedged for the full 15-minute
TTL while the response told the operator to retry. Skipping the write is what makes "retry
the gate" actually true.

### Private repositories

The public endpoint cannot gate a private repo, on purpose. Every ingest passes
`noAmbientToken`, so a scan never runs against the operator's ambient `GITHUB_TOKEN`;
otherwise any anonymous caller could enumerate private repos' full verdicts through the
operator's credentials. Token-less ingestion of a private repo 404s, and the route says so.

**Private repositories are gated through the GitHub App check run** (`/api/app/webhook`),
which scores with the installation's own token and writes the verdict back as a Check Run.
That is the authenticated path; the public `/api/gate/...` endpoint is for public repos.

## GitHub Action (`action.yml` + `scripts/maturity-gate.mjs`)

`action.yml` is a composite action. Inputs (only non-empty ones are forwarded):

| Input | Notes |
| --- | --- |
| `ascent-url` (required) | Base URL of the Ascent deployment. |
| `repo` | `owner/repo` (defaults to the workflow's repo). |
| `ref` | Ref to score; on a `pull_request` set to `github.event.pull_request.head.sha`. |
| `min-level` / `min-overall` / `min-dimension` | Policy thresholds. |
| `min-security` | Minimum **Security (D9)** score: the deterministic security floor. |
| `no-ungoverned` | Reject the ungoverned posture. |
| `require-protection` | Fail if the default branch has no branch-protection rules (when readable). |
| `live` | Use the live LLM (`true`) instead of mock. |

Outputs (written on **every** exit path, so `status` always says what happened):

| Output | Notes |
| --- | --- |
| `status` | `pass` \| `fail` \| `degraded` \| `not-found` \| `rate-limited` \| `error`: the value worth branching on. |
| `pass` | `'true'` only when the repo cleared the bar; a degraded or errored run is never `'true'`. |
| `degraded` | `'true'` when the AI grade could not be produced, so the verdict is not authoritative. |
| `level` / `overall` / `posture` | The scored ref's reading; empty when nothing was scored. |

A failing gate fails the step, so read the outputs under `continue-on-error: true` (or
`if: always()`) when the workflow wants to handle the verdict itself: post its own comment,
set a label, record the score. Without these the exit code was the only signal that escaped.

It runs Node 20 and invokes `scripts/maturity-gate.mjs`, which builds the query string
(`--min-level L3` → `?min_level=L3`), calls `${ASCENT_URL}/api/gate/<repo>?…`, writes the
outputs above to `$GITHUB_OUTPUT`, and exits:

| Exit | Meaning |
| --- | --- |
| **0** | `pass: true` (`200`): prints a green summary. |
| **1** | The repo is **below the bar** (`422`); lists the `failures`. |
| **2** | The gate **could not run**: a network error, a 5xx, a `404`, a `429` throttle, missing args, **a `degraded` (`503`) verdict**, or any status that isn't `200`/`422`. |

Only `200` and `422` carry a verdict; every other status exits **2, not 1**, because "the
grade could not be produced" and "the repo is below the bar" mean opposite things to whoever
reads the job log, and only the second is the repo's fault. A `429` is the easiest one to get
wrong: it is the *operator's* rate limit, and the repo was never scored, so it reports the
throttle (with `Retry-After` when present) instead of a failure line full of `?` placeholders. `.github/workflows/maturity.yml` is the repo's own example using the
action (and `npm run gate` runs the script locally).

## The ungoverned-AI-change gate (W2, 2026-08-14)

`minAiGovernedRate` (0–100) is the **provenance** criterion: the minimum share of AI-attributed
merged PRs that carried an approving human review. `100` means *every AI-attributed change must be
approved before it merges*. The research behind
[`docs/AI-SDLC-STANDARDS-LANDSCAPE.md`](../../AI-SDLC-STANDARDS-LANDSCAPE.md) §3.4 found this policy
**described everywhere and productized nowhere**: it is the sharpest unclaimed slice in the market,
and it is deliberately built on `PrStats.aiGovernedRate`, the **same** deterministic signal the
[evidence pack](../org-dashboard/org-intelligence.md#change-management-evidence-pack-w2-2026-08-14)
reports. A gate and an audit artifact that disagreed about whether AI work is governed would
discredit both.

| Surface | How to set it |
| --- | --- |
| Gate API | `?min_ai_governed=100`, or `?no_ungoverned_ai=1` for the strict shorthand |
| GitHub Action | `min-ai-governed: '100'`, or `no-ungoverned-ai: 'true'` |
| CLI | `--min-ai-governed 100`, or `--no-ungoverned-ai` |
| Org policy | persisted `minAiGovernedRate` (sanitized like every other numeric bar) |

A failure reads: *"62% of AI-attributed merged PRs carried an approving human review, below the
required 100% (20 AI-attributed PRs sampled)."* Its `GateFailure.code` is `provenance`.

### It is the ONE criterion that does not fail closed, deliberately

Every other rule in this gate fails closed, because an unscored value means the measurement
**broke**. Here `aiGovernedRate` is null when the measurement was never **due**: no token (so no
`prStats` at all, including the whole unauthenticated `/api/gate` path), or fewer than five
AI-attributed PRs in the window. Failing those would block repositories for having *little* AI
activity, inverting the intent of a policy that exists to govern repositories with a lot of it.

So a null rate **skips** the criterion, exactly as `requireProtectedBranch` skips when governance was
unreadable. The practical consequence worth knowing: the anonymous gate endpoint can never enforce
this bar. It lands where the data lives: the App-mode Check Run and the fleet governance view.

`OrgRepoRow.latest` now carries `aiGovernedRate`/`aiPrSample` (parsed from the same persisted
`prStats` blob the activity columns already read, so no extra query), and `buildGovernanceOverview`
threads them into `evaluateGateLite`. Without that, an org setting the bar would see repos marked
passing on the dashboard that CI blocks: the exact drift the shared evaluator exists to prevent.

## Two more criteria under the same fold (moonshot #8 / #16, 2026-08-30)

**`forbidAiAuthorship`** — failure code `admission`. No AI-attributed change may land at all; the
policy fragment a repo admitted in `mode: "blocked"` compiles to. Distinct from
`minAiGovernedRate: 100` ("AI work must be approved"): this says AI work must not be here. It shares
the provenance criterion's fail-**open** exception and for the same reason — `aiInvolvedRate` is null
with no token and under the PR-sample floor, and a repo with no observable AI activity must not be
blocked by an AI policy. `evaluateGateLite` (whose rollup row carries no PR stats) skips it always
rather than letting the fleet view condemn what the CI gate would clear. It has **no query param and
no Action input**: admission is a decision an org records, never something a caller requests.

**`requireChecks: string[]`** — failure code `control`. Doctor check ids that must not be reported
FAILING by the repository's own conformance run. **Union**-merged, exactly like `forbidPostures`, so
a layer can add a required control and never drop one. Three honest-null skips, all meaning "the
measurement was never due": no ledger at all, a check the latest report did not name (`unchecked` is
a *result*, not a pass and not a failure), or a report that named it `unchecked`. Only an explicit
`fail` fails the gate. The ledger is read (`loadCheckStates`) **only when the effective policy names
a check**, so an ordinary gate call pays no extra query; a ledger read failure returns null (a skip),
because `requireChecks` fails a repo for its *own* reported failure and an unreadable ledger cannot
name one.

The verdict body gains `admission: { mode, tier, source }` when a row applied — **omitted entirely**
(not nulled) when none did, so a repo with no admission decision produces a byte-identical response to
the one this endpoint returned before the layer existed. `logGateVerdict` records the same triple as
its own field: `policySource` says which *layer* set the bar, `admission` says why *this* repository
got that layer's stricter form.

## Verdict telemetry

Every produced verdict, from both the API endpoint and the App Check Run, emits one queryable
line, `[gate:verdict] {…}` (`src/lib/scoring/gate-telemetry.ts`), carrying `surface`, `repo`,
`ref`, `pass`, **`blocked`**, `degraded`, `authoritative`, the deduped failing `codes`,
`policySource` (`org` / `params` / `archetype`), and the scored reading.

`blocked` is the measurement, and it is deliberately *not* `!pass`: a degraded grade and a
fork-PR default-branch fallback both fail for reasons that are not "this repo is below the
bar", so counting them would overstate the gate's bite. The governance fleet view cannot
answer any of this: it re-evaluates *stored scans* on page load, which is a snapshot of the
fleet rather than a record of gate traffic, and it never sees ref-scoped PR verdicts.

A log line rather than a table on purpose: gate calls are CI-frequency, and the useful
questions (block rate over time, which condition bites most, degraded share) are aggregations
a log drain already does well.

## Check Run + sticky comment (App mode)

When Ascent is installed as a GitHub App, the webhook gates PRs and writes results back
using the installation token (see [github-app.md](../github/github-app.md)).

| Function | File | Role |
| --- | --- | --- |
| `runPrGate()` | `src/lib/github/pr-gate.ts` | The single check-writing path: score the PR head, diff it against the base, post the Check Run + sticky comment. Shared by the webhook (PR events, the "Re-run" button) and the org gate-policy sweep. |
| `buildGateComment()` | `src/lib/scoring/gate-comment.ts` | **Pure** builder → `{ conclusion, title, summary, commentBody }`. Includes verdict, level, overall, posture, archetype lens, adoption/rigor, an optional baseline delta phrase ("overall +5 · L2 → L3"), failures, a per-failing-dimension table, top-3 roadmap prompts, the scoring path, and the applied policy. The comment body carries a hidden `<!-- ascent-maturity-gate -->` marker, a **link to the full report** (`reportUrl`, comment only, since the Check Run already has the same destination as `details_url`), and, when a D9 floor is enforced, a note that the floor is deterministic. |
| `createCheckRun()` | `src/lib/github/checks.ts` | Creates a GitHub **Check Run** on the head SHA (the status that can block merge) with `conclusion` success/failure/neutral, title, markdown summary, a deep link to the report, and a "Re-run" action. |
| `upsertStickyComment()` | `src/lib/github/checks.ts` | Finds the marker by scanning **forward to the end of the thread** and **updates in place** (or creates one), so re-runs don't stack duplicates. |

Two verdicts are deliberately **`neutral`** rather than pass/fail, because a required status
must never assert something it didn't measure:

- **Fork PRs** whose head commit isn't reachable via the base repo's tree API: the gate falls
  back to scoring the **default branch**, and says so in the title, the summary, and a
  blockquote. Such a verdict structurally cannot reflect the PR's own changes; treat it as
  non-authoritative.
- **A hard failure**: rather than leave a required check silently absent (blocking merge
  forever with no explanation), the gate posts "Maturity gate could not run" with a Re-run
  button.

### Per-dimension floors

`GatePolicy.minDimensionFor` holds a floor for any of **D1–D9**, and the gate enforces every
one (the stricter of it and the global `minDimension`, see `effectiveFloor`). The owner's
form exposes them all: **D9 keeps its own dedicated control** (it is the deterministic
dimension, the only floor the gate URL / CI input surface as `min_security` / `min-security`,
and enabling it also forbids the ungoverned posture), and every other dimension is added as a
row in `DimensionFloorRows`. Before this, a non-D9 floor such as "no repo below 50 on Testing"
was reachable only by POSTing raw JSON to `/api/org/gate-policy`.

Non-D9 floors render into `policyText` and the PR-comment footer but carry **no** `query` /
`ci` projection, which is correct rather than a gap: the gate endpoint resolves the org's
persisted policy as its baseline on every call, so the CI snippet does not need to restate
them and a param could not weaken them anyway.

### The form replaces only what it renders

The Governance editor **round-trips every `GatePolicy` field it does not show**. `buildPolicy()`
starts from `passthroughPolicyFields(stored)` — the stored policy minus `EDITED_POLICY_FIELDS` — and
overwrites only the six bars the form actually renders, so `requireChecks`, `minAiGovernedRate` and
`forbidAiAuthorship` survive a save byte-identical. The carried copy is re-seeded from the server's
**echo** on every save, never from the request, so it cannot drift from what is stored.

This was live-proven broken (UAT 2026-08-30, `NADIA-L1-07` / `PRIYA-L1-01`): an owner set two
required controls, changed **Min overall 50 → 55**, and the controls were gone. The payload was
assembled field by field and the POST replaces wholesale, so every unrendered bar was collateral on
every save — of a *merge-blocking* control that the Active-policy summary was printing read-only six
rows above the form.

The fix is round-trip and deliberately **not** a merging POST: a POST that merged the submitted
subset could never *clear* a field, so unchecking "Require a protected default branch" would silently
stop working. The form owns exactly what it shows. **When a field gains a control, add it to
`EDITED_POLICY_FIELDS` in the same change** — otherwise the editor would show it *and* stash a stale
copy, and the stash would win. Pinned by `GatePolicyEditor.roundtrip.test.tsx`.

### A write that drops a bar says so

`diffGatePolicy` (`src/lib/scoring/gate-diff.ts`) compares the stored policy before and after every
write, field by field, in `describeGatePolicy`'s own wording, and:

- appends the losses to the audit row's human-readable `status`
  (`min L3 · min overall 55 — dropped required controls (Reported controls must not be failing: …)`),
  with the structured list under `changes`;
- returns the removals to the caller as `dropped`, which the editor surfaces as
  *"Policy saved — but this save also REMOVED …"*.

Both halves exist because the editor's own reconciliation (`droppedFields`) compares its **request**
against the echo and is therefore structurally blind to a field it never sent. Only the server holds
both policies. Before this, the save that deleted two required controls wrote an audit row naming
them **only** under `previousPolicy` — a field nobody diffs — while `status` read clean. The form is
no longer a writer that can lose a bar, but it is not the only writer (the admission overlay, the
API, a future editor), and a control that can vanish without the log saying so is not a control.

### The audit row

Every save writes an `org.gate_policy` audit row carrying **the bar itself**, not just that it
moved: `policy` / `previousPolicy` (the sanitized objects) plus `status` / `previousStatus`,
the human rendering from `describeGatePolicy`, the same canonical enumeration the dashboard,
gate URL, CI snippet and PR footer use, so the trail can't advertise a bar different from the
one enforced. `status` is the field the audit viewer already renders for non-scan rows, so the
change shows up in the table as e.g. `min L3 · no D9 < 30`. Without those fields the log could
not answer the question it exists for: *who lowered the security floor from 70 to 30, and when*.

### When a policy change takes effect

Saving an org gate policy (`POST /api/org/gate-policy`) schedules a **bounded, best-effort
sweep** that re-runs `runPrGate` on the org's open PRs, up to 25 watched repos / 20 PRs,
deferred via `after()`, every failure logged and isolated. **Drafts are skipped and cost no
budget**: GitHub won't merge one, and `ready_for_review` is in the webhook's `PR_ACTIONS`, so
a draft is re-gated against the current bar the moment it becomes mergeable.

Repos are swept **4 at a time, PRs within a repo strictly serially**: GitHub asks callers not
to issue concurrent mutating requests against the *same* repository, and every gated PR writes
a Check Run plus a comment. A **240s deadline** (inside `maxDuration = 300`) stops the sweep on
its own terms rather than being killed mid-flight, and the completion log names what was left
(`STOPPED at the 240s deadline with N repo(s) unswept`) so a truncated sweep can't read as a
complete one. Without it, open PRs kept a
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
| `src/lib/scoring/gate-admission.ts` | `resolveAdmissionLayer()` / `loadCheckStates()`: the one IO seam both gate surfaces read the admission row and the conformance ledger through. |
| `src/lib/org/admission.ts` | `compileStance()` / `admissionGateOverlay()`: the pure tier → tighten-only fragment. |
| `src/lib/scoring/gate-comment.ts` | `buildGateComment()`: check title/summary + PR comment markdown. |
| `src/lib/github/pr-gate.ts` | `runPrGate()`: the shared Check Run + sticky comment writer. |
| `src/lib/github/checks.ts` | `createCheckRun()`, `upsertStickyComment()`. |
| `src/app/api/org/gate-policy/route.ts` | Persist the org bar (owner-gated) + sweep open PRs; diff the write and name what it dropped. |
| `src/lib/scoring/gate-diff.ts` | Field-level diff of a policy write, in `describeGatePolicy`'s wording — the audit `status` clause and the editor's removal warning. |
| `src/features/standing/governance/GatePolicyEditor.tsx` | The owner's policy form, incl. when the bar applies. |
| `src/features/standing/governance/DimensionFloorRows.tsx` | Per-dimension floors (D1–D8) in that form. |
| `src/app/badge/gate-snippets.ts` | The public `/badge` curl + workflow snippets, from one policy. |
| `action.yml` | Composite GitHub Action definition. |
| `src/lib/db/org-rollup.ts` | `parseProvenanceLite`: the fleet gate's `aiGovernedRate` input. |
| `scripts/maturity-gate.mjs` | CLI: call the gate API, exit 0/1/2 (`npm run gate`). |
| `.github/workflows/maturity.yml` | Example workflow gating this repo. |

## Known gaps

- (Closed 2026-08-30, moonshot #8.) ~~`policyFromParams` drops `minAiGovernedRate` on the
  no-org-policy path.~~ It hand-listed six fields and omitted the seventh, so `?min_ai_governed=90`
  parsed correctly and was then discarded — the strictest bar in the product, silently inert on every
  deployment with no persisted org bar (self-hosted, DB-less, and every org that never set one). It is
  now written as an explicit-wins spread over the whole object so the next field cannot repeat it, and
  `gate-policy-sources.test.ts` asserts every field `explicitPolicyFromParams` can parse survives.
- **`requireChecks` has no editor CONTROL yet.** It is a real `GatePolicy` field with all four places
  and is enforced whenever it appears in a persisted org policy — but the Governance form offers no
  input for it, so today it can only be *set* by writing `Organization.gatePolicy` directly (or by
  `POST /api/org/gate-policy`). The evaluator half is what #16 needed; the input is not built.
  Scoped: the *destructive* half of this gap closed 2026-08-31 — a stored `requireChecks` is rendered
  read-only in the Active-policy summary, round-trips untouched through every save, and any write that
  does drop it is named in the audit row and in the editor's own message (see "The form replaces only
  what it renders" and "A write that drops a bar says so").
- The gate API scores via **mock** by default; pass `?mock=0` / `live: true` for an
  LLM-scored verdict (slower, needs a key, and a provider outage then surfaces as a `503`
  rather than a silent floor score).
- The policy-change sweep is a **courtesy**, not a guarantee: PRs past the 25-repo / 20-PR
  cap pick the new bar up on their next push or a manual "Re-run".
- Sticky-comment lookup scans forward with a 50-page (5000-comment) safety ceiling; the
  common case still costs a single request.
