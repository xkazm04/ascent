# The PR gate fails closed

- **Status:** Accepted (2026-10-08, the day the code landed; merged at `0169a2aa`)
- **Date:** 2026-10-08
- **Deciders:** App Master `ascent`, through the lite council's round 1 on the `pr-maturity-gate` span
  (2026-10-08). **The operator did not take this decision.** The council's must-address lines are not stored
  in the repo, so the evidence below is the four commit messages and the code. This record writes the choice
  down so a later ADR can confirm, amend or reverse it.

## Constraint

The council found the merge gate failing **open** in four places. Each let a PR merge on a verdict Ascent had
not produced:

- **The App check posted `neutral` when it could not decide.** GitHub counts a check run concluding
  `success`, `neutral` or `skipped` as satisfying a required check. (`docs/features/scanning/gate.md` states
  this as a claim not fetched from GitHub's documentation, and so does this record.) The "could not run" path
  and the default-branch fallback for fork PRs both posted `neutral`, so a required check passed what it
  never measured (`de932aa2`; its message: "a gate that could not run (or only scored the default branch of a
  fork PR) let the PR merge").
- **A floor on a missing dimension was skipped.** The floor sweep only visited dimensions present in the
  report, so an engine that dropped D9 skipped a configured `min-security` floor silently (`dcc0fd33`).
- **The Action scored the default branch.** `ref` defaulted to empty and the CLI then scored the default
  branch on every PR, so a PR that deleted the tests was judged on code it did not touch (`82be8b6f`).
- **The CI snippet emitted bars the token-less gate cannot measure.** `/api/gate` answers 503 for
  `require-protection` and `min-ai-governed`, so the copied snippet errored on every run (`f4242b6b`). That
  is fail-closed already, but it fails every run for every adopter, which teaches teams to ignore a red check.

## Decision

**Whatever the gate cannot measure, it fails, and it says so.**

1. **The App check never posts `neutral`.** The hard-failure path posts `failure` titled "Maturity gate could
   not run: no verdict", whose summary says it is not a score failure and that a re-run or new push clears
   it, with a Re-run button (`src/lib/github/pr-gate.ts:200-216`). The default-branch fallback posts
   `failure` too (`src/lib/scoring/gate-comment.ts:116`, `scoredHead ? (pass ? "success" : "failure") :
   "failure"`); the default branch's numbers stay informational. `de932aa2`, with the test pins updated in
   `0169a2aa`.
2. **A configured floor on a dimension the report lacks fails closed.** It pushes a `dimension` failure, "was
   not measured in this scan: failing the N floor (fail-closed)", with security-floor wording for D9
   (`src/lib/scoring/gate.ts:624-638`). A floor of 0 or less on a missing dimension stays a no-op
   (`gate.ts:628`). `dcc0fd33`.
3. **The Action scores the PR head by default.** `INPUT_REF` resolves `inputs.ref ||
   github.event.pull_request.head.sha || github.sha` in the step env, because composite-action input defaults
   are not documented to accept the `github` context (`action.yml:151-153`, passed to the CLI at `:189`). The
   copied snippet states the same `ref` (`src/lib/org/governance.ts:245`). `82be8b6f`.
4. **The CI snippet never emits unmeasurable bars.** `ciWith` drops `require-protection` and
   `min-ai-governed` and adds a comment that the App check run enforces them
   (`src/lib/org/governance.ts:100-108`). The Action keeps the inputs for callers who run their own gate
   endpoint. `f4242b6b`.

## Alternatives that lost

1. **Keep `neutral` and tell reviewers to treat it as non-authoritative.** This was the original design: a
   required status "must never assert something it didn't measure". It lost because GitHub's required-check
   rule, not our wording, decides what blocks a merge, and it accepts `neutral`. A verdict that is honest in
   the title and green in branch protection is the worst of both.
2. **Post nothing on failure and leave the required check pending.** Pending also blocks the merge. It lost
   because the author gets no explanation and no Re-run button, which the code names as the reason the
   fallback exists (`src/lib/github/pr-gate.ts:201-205`). Pending is still what happens when no token was
   minted, since a check can only be posted once a token exists (`:206`); that residue is accepted.
3. **Skip the unmeasurable floor and note it in the comment.** Honest, and it keeps a degraded engine from
   blocking merges. It lost because the model can drop D9, so the security floor would pass exactly when it
   could not be measured. `docs/features/scanning/gate.md` now says D9 can become unmeasurable but cannot make
   the floor pass by doing so (`dcc0fd33`).
4. **Fix the Action's default in `inputs.ref.default`.** The natural place. It lost because composite input
   defaults are not documented to take the `github` context (`action.yml:151-152`).
5. **Let the snippet pass the App-only bars and rely on the 503 as enforcement.** It is fail-closed already.
   It lost because every run fails for every adopter, so the signal is noise; those bars move to the App
   check, which holds a token.

## Consequences accepted

- **An Ascent outage or a degraded engine now blocks merges in any repo that requires the check.** A DB blip,
  a failed policy or tenant read, a failed check write, or a missing dimension turns the check red until it
  is re-run or a new commit is pushed. Before, those cases passed or sat neutral. The summary text is the
  author's only recourse, and the delivery release for redelivery (`retryable()`, `pr-gate.ts:219-220`) the only
  automatic one.
- A red check now means either "below the bar" or "no verdict". They share a conclusion and differ only in
  title and summary, so anything that counts failures will count outages as score failures.
- A fork PR whose head is not reachable always fails the App check and cannot pass on a default-branch score;
  its author must re-run or push.
- A floor on a dimension a scan legitimately never carries (for example a `min_d<N>` the engine version does
  not emit) fails every PR in that repo until the floor is removed.
- Reverting the `neutral` rule is only safe if GitHub stops counting `neutral` as satisfying a required
  check, which this record did not verify.
