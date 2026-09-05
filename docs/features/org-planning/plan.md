# Planning: what remains after the Plan and Backlog tabs (retired 2026-08-17)

**The Plan tab and the Backlog tab are gone.** They were planning machinery sized for a quarter —
goals with owners and pace, initiatives, a what-if simulator, an owner/due-date backlog, a debt
statement, a detector-calibration list — for work that is usually one Claude Code session per repo.
The **[Follow-ups ledger](../org-followups/README.md)** (`?tab=followups`, Standing) replaced them
for that common case: every open gap in one table, tick a batch, one fix prompt for a local agent,
and the next default-branch scan closes what landed. Three ideas were ported into it because they
fit a mass-scan world (10–20 items per repo): **bulk resolve/dismiss** (from Backlog), the
**org-wide gap call** — a dimension open in ≥ half the fleet is a practice to fix once (from Plan's
gap decomposition) — and the **per-row timeline** (from Backlog). The **transition programme**
control (W1c) moved to the Briefing tab.

Everything below is what still exists in this area and what it is for.

## Goals

A goal is a fleet-level target. Its progress is **live**: recomputed from the latest scan
per repo, never stored as a snapshot.

- **Model:** `Goal { id, orgId, label, metric, target (0–100), status, createdAt, baselineValue?,
  baselineAt? }`, where `metric` ∈ `overall | adoption | rigor | D1…D9` (validated by `isGoalMetric`).
- **API** (`src/app/api/org/goals/route.ts`, `…/goals/[id]/route.ts`):
  - `GET ?org=` → `{ goals: GoalProgress[] }` (with current value per goal).
  - `POST { org, label, metric, target }` → `{ id }`.
  - `PATCH /:id { status?, target?, label? }`, `DELETE /:id`.
  - Writes require a session when auth is configured.
- **UI:** `src/components/org/plan/GoalsPanel.tsx` lists goals (label, current/target,
  progress meter) and a create form, refreshing via the GET after each change.
- **DB:** `createGoal`, `listGoals` (computes progress through `currentFor(metric, snap)`),
  `updateGoal`, `deleteGoal`.

### The meter: progress or attainment, and it says which

`GoalProgress.pct` used to be `current / target` unconditionally — **attainment**, not progress. A
goal set at 70 while the fleet already sat at 63 rendered a 90%-full bar the moment it was created
and barely moved as the work happened, so goal reporting to leadership was inflated by the distance
travelled *before* anyone committed to travelling it.

Progress needs the metric's value at creation, which is not recoverable afterwards, so `createGoal`
captures it: `Goal.baselineValue` / `baselineAt`, stamped from the same fleet read the already-met
guard uses. `pct` is then `(current − baseline) / (target − baseline)` and `pctBasis` is `"progress"`.

Goals created **before** that column existed have no baseline and never will. They keep the old
ratio and report `pctBasis: "attainment"` with a `pctLabel` that says so — a back-derived baseline
(the earliest scan on record, say) would be a fabrication indistinguishable from a measurement, and
could make an in-flight goal read as having regressed. Same for a goal created against a fleet with
no scans, where the metric reads 0 as a placeholder rather than an observation: no baseline is
stored. **Any surface rendering `pct` must render `pctLabel` (or its own wording for `pctBasis`)** —
an unlabelled attainment ratio in a progress bar is the original defect.


**Goals are READ, not managed, since 2026-08-17.** The GoalsPanel retired with the Plan tab, so
there is no in-app way to create or edit a goal; the write API (`/api/org/goals`) is kept because
the seed route and any external caller still use it. The read paths that made goals worth keeping
for now: the executive briefing's goals card, the live wall's goal banner, the overview's fix-first
band ("behind the pace its deadline needs" now sends the reader to the Follow-ups ledger), and the
digest alerts. Goals duplicate the transition programme's single named commitment and are the next
retirement candidate; when that happens those four readers lose a branch each, nothing else.

## Transition programme

Documented in [org-intelligence.md](../org-dashboard/org-intelligence.md) (W1c). Its control panel
(`ProgramPanel`: start / re-target / pause / end) now renders on the **Briefing** tab
(`src/features/bought/executive/ProgramPanel.tsx`), which is where the shell's
`ProgramStrip` and the getting-started "programme" step link.

## Executive briefing, live wall, playbooks

Unchanged by the retirement and documented where they live: the briefing and its PDF in
[org-intelligence.md](../org-dashboard/org-intelligence.md); playbooks in
[practices.md](../org-dashboard/practices.md); the live wall — and the loop cockpit that now fronts
it at `?tab=live` — in [live.md](live.md).

## Weekly digest (`?tab=digest`, Bought)

The Briefing's fixed-window sibling, and the one page in the product designed to leave it: a lead
opens it on Monday, reads it in a minute, and pastes it into a leadership update. Panel:
`src/features/bought/digest/DigestTab.tsx` (a server component; the co-located `Digest*.tsx` parts
carry no `"use client"`), assembled by `buildWeeklyDigest` (`src/lib/org/digest.ts`) and serialized by
`weeklyDigestMarkdown` (`src/lib/org/digest-markdown.ts`) over the shared wire contract in
`src/lib/org/digest-types.ts`.

**The window is fixed, and that is the feature.** Trailing **7 calendar days in the org's canonical
zone**, half-open `[start, endExclusive)`. It ignores the period selector *and* the period cookie —
the tab takes `sp` only for shell uniformity and never reads it. A weekly update whose window
followed a cookie would silently compare different spans week to week, and the reader would have no
way to tell.

**What each section reads:**

| Section | Reads | The distinction it protects |
| --- | --- | --- |
| Headline tiles | `headline` | Deltas are **cohort-matched** — repos scanned on *both* sides of the week. The caption always names that denominator (`+onboarded / departed`), or says "no earlier scans to compare against" when `cohortSize` is null. |
| Score deltas per dimension | `dims[].band` | Three presentations, never re-derived at the renderer: a signed coloured move, `flat (within noise)`, and `—` for **unmeasured**. An em dash is a missing measurement, not a zero. |
| Follow-ups | `followups` (`src/lib/db/org-followups-week.ts`) | "Closed" is an event with a `how` (by rescan / by hand). Dismissals are counted **beside** the closes and never folded in — dismissing is a decision not to do the work. |
| Next three actions | `actions` | Rank 1 gets the accent block and is the same sentence the markdown leads with, so the page and the pasted update cannot recommend different things. |
| Repository movement | `movement` | A null read ("could not be read this week") stays distinct from an empty one ("nothing moved beyond the noise band"). |
| Provenance footer | `provenance` | Scan count, the mock-engine caveat, and one line per degraded read — printed, because the digest is pasted into a room where nobody can ask the database a follow-up question. |

**The export.** "Copy as markdown" hands over `weeklyDigestMarkdown(d)` — a self-contained update in
a leadership voice, aimed at a Slack post, an email, or a paste into Claude Code. The audience is a
lead reporting upward, not an operator: it names moves and next actions, not query internals. The
Slack weekly push links to this tab (`orgTabHref(slug, "digest")` → `/org/<slug>?tab=digest`); the
tab was **born migrated** — it has never had a legacy `/org/<slug>/digest` route.

**Known gap:** "opened" is a **derived identity diff**, not an event. No creation event exists for a
follow-up, so the opened column diffs the pre-window scan against the latest one — a repository with
no pre-window scan cannot contribute (counted and stated as `(N repositories had no earlier scan and
are not counted)`), and when *no* repository has one the whole column is unmeasurable and says so in
a sentence rather than printing a 0. Closing this gap means emitting a creation event when a
recommendation first appears.

### The model and its markdown (`src/lib/org/digest*.ts`, `src/lib/db/org-followups-week.ts`)

The weekly digest is a fixed-period read: the trailing **7 calendar days in the org's canonical zone**,
resolved once by `weekRangeParams(now) → resolveWindow` and half-open `[start, endExclusive)`. The
period is deliberately not selectable — a digest whose window depended on a cookie or a query string
would mean two people reading "this week" saw two different weeks.

`buildWeeklyDigest(orgSlug, now)` (`src/lib/org/digest.ts`) adds **no queries of its own**. It fans out
seven reads in parallel over aggregates that already exist and are already tested — `getOrgRollup`,
`getOrgMovers`, `getOrgRecommendations(…, 3)`, `getOrgEngineMix`, plus the three week-shaped reads in
`src/lib/db/org-followups-week.ts` — hands every one of them the *same* window value, and composes the
wire contract in `digest-types.ts`. The only load-bearing read is the rollup: with no fleet standing
there is no digest, so a null rollup (or `scannedCount === 0`) returns `null` and the caller renders an
empty state. Everything else is optional.

**Degradation is the design.** Each read is wrapped `.catch(() => null)`, because one unavailable
aggregate must not blank an update the other six could still fill — but a failure must never
*disappear*. Every degraded read appends one sentence to `provenance.notes`, which the markdown prints
in the footer ("Repository movement could not be read."). A silently missing section is the failure
mode that makes a report untrustworthy: the reader cannot tell "nothing happened" from "we could not
look."

**Closed and opened are measured by different mechanisms, and the asymmetry is load-bearing.**

*Closed* is an **event**: `RecommendationEvent{kind:"status", toValue:"done"}`, written in the same
transaction as the mutation that caused it, scoped org → repo → scan → recommendation and restricted to
`kind:"gap"` (a craft entry was never a follow-up the team owed, so closing one is not debt paid down).
The window bound arrives through the shared `dateRange(start, window, "createdAt")` helper, so the
half-open policy is *inherited* rather than restated — a boundary event cannot be counted by two
adjacent weeks. `dismissed` is counted **beside** closed and never folded in: a dismissal is a decision
not to do the work, and reporting it as a closure would let a fleet "improve" by declining its own
backlog. Each closed row also carries *how* it closed — a non-null `actor` is a person, a null one is
the rescan resolver, the only other writer of those rows.

*Opened* has no event to count, so it is a **derived identity diff**. Recommendation rows are recreated
on every scan with status carried across by the `(dimId, title)` identity
(`scans-persist.ts`), which means `Recommendation.createdAt` is the *scan's* date, not the date the gap
appeared — counting it inside the window would report every gap on every rescanned repository as
"opened this week". Instead a gap is opened when its `dimId::title` is present in a repository's latest
scan (status `open`/`in_progress`) and **absent from that repository's latest scan strictly before the
window start**. The baseline side is read without a status filter on purpose: an identity that existed
before the window in *any* state is carried forward, not new. Both "latest per repository" picks are
`scan.groupBy({ by:["repoId"], _max:{ scannedAt } })` followed by an exact-pair `findMany` — never a
nested `take: 1`, for the reason documented in the `getOrgBacklog` header.

**The diff can be unmeasurable, and says so.** A repository with no pre-window scan has nothing to
compare against; treating "no baseline" as "empty baseline" would report a newly onboarded repository's
entire backlog as this week's regression. Such repositories are excluded and **counted**
(`unmeasuredRepos`), and when *no* repository has a baseline the read returns `null` — the digest sets
`openedMeasurable: false` and the markdown prints "Opened this week: not measurable — no repository has
a scan from before `<from>` to compare against." That line is the whole point of the branch: it is a
history gap, not a quiet week. (A repository whose pre-window scan simply found *zero* gaps is a
different case and remains measurable: its baseline is genuinely empty, so every gap on it today is new.)

**The noise band decides the word, once.** Each dimension row carries a `band` alongside its number:
`null` → `"unmeasured"`, `isWithinNoise(delta)` (the canonical `SCORE_NOISE_BAND = 2`) → `"flat"`, else
the sign. Fixing the verdict in the model rather than in each renderer is what stops the tab and the
markdown from printing different words for the same number, and stops a +1 from wearing the same arrow
as a +8. Headline deltas follow the same discipline in the other direction: `dOverall`/`dAdoption`/
`dRigor`/`cohortSize` are null *together*, because a cohort-matched delta without its denominator
cannot be read.

`weeklyDigestMarkdown(d)` (`src/lib/org/digest-markdown.ts`) serializes the model into the
"Copy as markdown" payload. It is **not** `briefingMarkdown`: that one is a prompt ending in an explicit
`## Ask`, while this is the finished artifact a lead pastes into a channel, so it ends with its own
provenance and has no Ask (a test pins the absence). Two rules govern it — **never a header with no rows
under it**, and content that is *unknown* says so in words ("—", "flat (within noise)", "not
measurable") rather than rendering as a zero. It stays node-safe: it imports nothing from
`@/components`, including its own `+4`/`-3`/`0` sign formatter, which never writes `+0`.

## The improvement ledger counts both populations (2026-08-30, moonshot #26)

Until now the Impact Ledger, the programme strip and the briefing's proof block counted exactly one
population — practice PRs that merged into a default branch. A local loop lane that dispatched an
agent, committed, rescanned its own worktree and measurably moved a dimension counted **nowhere**, so
the surfaces that answer "what did this buy" were blind to the half of the product that does the work.
`src/lib/db/improvement-events.ts` is now the one fold behind all three.

**Two bases, stated on every row:**

| Basis | Measured | Counts as |
| --- | --- | --- |
| `merged` | on the default branch, after a merge | **bought** — `ImpactLedger.dimPoints`, `ProgramNow.pointsBought` |
| `branch` | on a loop lane's own branch, from the worktree it scanned | **in review** — `ImpactLedger.inReviewPoints`, `ProgramStatusView.pointsInReview` |

Branch movement is real, independently rescanned movement. It is also **not bought**, because nothing
has landed on a trunk anyone else has. Folding it into the bought number would tell a buyer they own
something sitting on an unreviewed branch, so the two are reported side by side and the in-review tile
says "on branches, not merged" in words. When a lane's PR merges (see
[live.md](live.md) → *From lane branch to reviewed PR*), the points move across with **no
re-measurement**: the merged row is verified against the lane's own baseline scan.

**Honest nulls, unchanged:** `inReviewPoints` is `null` — never 0 — when no lane is measurable, and
the tile prints an em dash. A one-ended lane, or one that committed nothing, contributes nothing and
is not counted as a zero. The dedupe lives in the fold, so the ledger and the briefing can never
disagree about how much the org improved.

**The ledger table** gains a `Source` column (`Practice` / `Loop`) — a provenance tag, not a verdict,
so it carries no colour.

## Retired on 2026-08-17 (for the record)

| Was | Where it went |
| --- | --- |
| Backlog tab (owners, due dates, owner/due grouping, undo, CSV, bulk assign) | Follow-ups ledger; bulk resolve/dismiss + timeline ported; owners/due dates dropped (`assigneeLogin`/`targetDate` columns remain on `Recommendation`, unread by the ledger). |
| Debt Ledger (rework/revert/exposure statement) | Deleted with the tab. `getOrgRework` (`src/lib/db/org-rework.ts`, W5 revert linkage) is now an **orphaned read** — real data, no consumer; a Delivery-tab home is the obvious next step. |
| Plan tab: initiatives (+ `CreateInitiativeButton` on Adoption, Delivery ROI, Tech-stack playbooks) | Deleted, incl. `/api/org/initiatives`, `createInitiative/listInitiatives/updateInitiative`, the `Initiative` nav count. Those three surfaces now link to the Follow-ups ledger scoped to the dimension (`?tab=followups&dim=Dn`). The `Initiative` table stays in the schema (no migration; rows are inert). |
| Plan tab: what-if simulator | Deleted, incl. `src/lib/scoring/orgsim.ts`, `/api/org/simulate`, `simulateOrgFixes/rankOrgInvestments/goalImpactsForScenario`. |
| Plan tab: gap decomposition (org vs repo problem) | Ported as the ledger's `org-wide N/M` tag + filter (`dimensionSpread`). `getOrgGapAnalysis` is now an orphaned read. |
| Plan tab: detector backlog (LLM auditor's suspected detector misses) | Deleted with the tab. `getOrgDiscrepancies` is now an orphaned read; calibration is documented in [calibration.md](../scanning/calibration.md) and needs a new (operator-side) home. |
| Plan tab: goals management | See *Goals* above. |
| `plan` / `backlog` tab ids, rail items, `OrgNavCounts.plan` | Removed; `OrgNavCounts.backlog` → `followups`. `/org/<slug>/plan` and `/backlog` remain as permanent redirects (links in inboxes) → `?tab=followups`. |

## Known gaps

- **Three orphaned reads** — `getOrgRework`, `getOrgGapAnalysis`, `getOrgDiscrepancies` — carry real
  data with no UI. Kept (tested) rather than deleted so a future home does not have to re-derive
  them; each is a decision, not an oversight.
- **Goals have no management UI.** Deliberate half-state, see above.
- (Closed 2026-08-14.) ~~Goal metrics are point-in-time.~~ Every `GoalProgress` row carries
  `series`, drawn by `GoalCard` (`src/components/org/shared/GoalTrend.tsx`).
