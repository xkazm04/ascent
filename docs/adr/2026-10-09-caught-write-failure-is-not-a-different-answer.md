# A caught failure at a write door is never a different answer

- **Status:** Accepted (2026-10-09, the day the last commit below landed)
- **Date:** 2026-10-09
- **Deciders:** App Master `ascent`, through the full council on `practice-generation-pr`, rounds 1 and 2
  (2026-10-08). **No source this author could read shows an operator ruling on it.** The evidence is the
  council's round 2 report, the commit messages and the code at this head.
- **Extends** [2026-10-07-failed-read-is-not-absence](2026-10-07-failed-read-is-not-absence.md) from
  reads to the write doors. That record is not edited; it still governs reads.

## Constraint

`practice-generation-pr`'s full rounds 1 and 2 scored robustness 0.45 and 0.40 against a binding floor of
0.50. Round 2's `must_address`
(`.claude/master/ascent/headless/council/2026-10-08-practice-generation-pr-r2/report.md`) named the worst
site: "robustness: The shared PR-write door turns a failed installation lookup into a wrong 'isn't
installed' 403, and logs nothing."

That is the write-side form of the seam the earlier ADR closed for reads. A write door catches a failure
and answers something else:

- **The wrong answer.** `requirePrWriteContext` called `getInstallationIdForOwner` and, on a throw, fell
  through to the "no installation" 403. That tells an admin to install an App that is installed, and
  hides the outage from both of them.
- **The silent answer.** Per-row workers in apply-batch and rollout, the house-pattern version read in
  `apply.ts`, the shape read in `artifact.ts` and several degraded reads in the Practices tab caught their
  errors and carried on with a fallback, writing nothing to a log and nothing to the error reporter.
- **The untracked write.** `getOrgId(...).catch(() => null)` let a PR open with no org id when the lookup
  threw, so the write existed on GitHub and nowhere in Ascent.

## Decision

**A caught failure is never turned into a different answer, and it is never silent.**

1. **Where the code carries on with a fallback, it keeps the fallback, logs with a tag, and calls
   `reportHandledError`** (`src/lib/api/respond.ts:62`). The fallback is the same value it always was; what
   changes is that the failure is on the record. Applied by:
   - `6e531a60`: a failed house-pattern version read still writes the adoption row with
     `patternVersion` null (`src/lib/practices/apply.ts:182`), and a failed shape read still returns the
     generic starter (`src/lib/practices/artifact.ts:46-47`).
   - `d6eb25cb`: the Practices tab's degraded reads go through `practicesDegradedRead`
     (`src/features/shared/practices/practicesDegradedRead.ts:12-13`). The build-system sniff logs a
     thrown GitHub read but does not report it (`src/lib/practices/build-system.ts:71`, `:91`); that one
     is a guess about a repo's build file, not a state.
   - `0f41a6e5`: apply-batch and rollout log an unexpected per-repo error with the repo and report it,
     keeping the row copy; the rollout's `listBehindRepos` failure keeps its null fallback but is logged
     and reported (`src/app/api/practices/rollout/route.ts:149`).
2. **Where the failure is the answer, it is a classified 5xx, reported.** `2bda32bd`: a thrown
   installation lookup answers a reported 502 (`MINT_FAILED`), mints nothing, and leaves a null lookup and
   a missing database on the unchanged 403 (`src/lib/github/pr-route.ts:62-68`). `14567408` documents that
   a failed mint answers 502 on every practice route (`apply/route.ts:74-75`, `rollout/route.ts:203`)
   and that a failed org lookup refuses the write instead of opening an untracked PR
   (`apply/route.ts:82-83`; `rollout/route.ts:142`; `0f41a6e5`). `4b2b40f8`: the rollout GET answers a
   reported 500 "Could not load the rollout status." when its status read fails, because there is no
   honest partial status (`rollout/route.ts:55-59`).
3. **A classified 5xx is reported where it is mapped.** `mapPrWriteError` logs and reports a classified
   5xx through `respondError` with an unchanged body (`pr-route.ts:324-327`); the apply-batch and rollout
   workers report a classified 5xx row (`apply-batch/route.ts:135`; `rollout/route.ts:181`), keeping the
   row copy (`1fbffb20`).
4. **A 400, 401, 403, 404 and 409 answer stays unreported.** They are the caller's input or state, not
   our failure; reporting them would bury the 5xxs the reporter exists to show. `mapPrWriteError` returns
   a classified 4xx as a plain JSON error without reporting (`pr-route.ts:328`).

## Alternatives that lost

- **Let a failed write fall through to the unknown-error 500 everywhere.** One shape, no per-site
  judgment. It lost because several sites have a correct fallback (the generic starter, a null pattern
  version, a degraded tab panel), and turning those into 500s makes an outage of a nicety into an outage
  of the write. The rule keeps the fallback and removes only the silence.
- **Log only, and leave the reporter to real exceptions.** Cheaper, no new noise in the reporter. It lost
  because a log line on a serverless function is read by no one unless something else points at it; the
  council's finding was exactly that nothing was logged, and the fix has to reach the place operators
  look. The log tag stays as the local trail; the report is what makes it seen.
- **Fail closed at every site, as the earlier ADR does for class-A reads.** Consistent. It lost for the
  fallback sites because there the stakes are different from a read shown as absence: the starter and the
  null version are labelled as generic or unknown in the output, so they do not assert something false.
  The earlier ADR's class B (degrades but reaches a door) is the same reasoning, and this ADR is its
  write-side counterpart.
- **Report every caught error, 4xx included.** The most complete trail. It lost because a 403 or a 409 is
  the system working, and a reporter full of them hides the 502s. The line is drawn at the failure being
  ours.
- **A wrapper that every door must use, instead of a convention.** It would enforce the rule structurally,
  as `dbReadStrict` does for reads. It lost for now because the sites differ (a route answer, a per-row
  copy, a tab panel, a client message) and a wrapper that covers them all would be a framework; the rule
  here is applied site by site and checked by tests that pin each answer.

## Consequences

- **The rule is by convention at the write doors.** There is no structural test. A new door can still
  catch and swallow; the next review has to look for it.
- **Sites still outside the rule at this head**, each read in the code:
  - **Sibling batch workers call `classifyPrWriteError` directly and never report a classified 5xx**, so
    `1fbffb20` (which changed `mapPrWriteError` and the two practice workers) does not cover them:
    `src/app/api/org/ai-stance/apply-batch/route.ts:120`,
    `src/app/api/org/playbooks/[id]/apply-batch/route.ts:145`,
    `src/app/api/report/foundation/secrets/route.ts:167` and `:220`, and `src/lib/standard/pr.ts:159`.
    None imports `reportHandledError`. They do get the door's 502 on a thrown lookup, since they use
    `requirePrWriteTarget` or `requirePrWriteContext`.
  - **`usePracticesLibrary.ts:71`** rolls a failed delete back with `.catch(() => setPlaybooks(prev))`
    and a `!r.ok` branch, and says nothing to the user or the reporter
    (`src/features/shared/practices/usePracticesLibrary.ts:62-72`).
  - **The playbook-path controls read the response before checking `ok`**: `res.json()` at
    `src/features/shared/practices/usePlaybookCard.ts:70` and `PlaybookApplyBatch.tsx:87`, so a non-JSON
    error body throws a raw `SyntaxError`. The practice controls already use `readApiResponse` for this.
  - **The rollout POST's audit write.** `recordAudit` runs after the PRs have opened
    (`rollout/route.ts:187`), and a rejection reaches the outer catch and answers a reported 500 "Failed to
    open the rollout PRs." (`:203-204`). That is a different answer for a write that succeeded. It only
    happens if `recordAudit`'s own never-throw contract breaks, but the rule says it should keep the 200
    with its results and log and report the audit failure. This ADR does not change it.
  - **`build-system.ts`** logs a thrown read and does not report it, by the choice in item 1.
- **A reported 502 on a thrown lookup is louder than the 403 it replaces.** An outage of the installation
  table now shows in the reporter once per attempt, which is the point and also the volume.
- **The answers on the wire changed in one place:** a thrown installation lookup is a 502, where it was a
  403, for every caller of `requirePrWriteContext` and `requirePrWriteTarget` (the practice routes and the
  sibling PR-write routes listed above).
