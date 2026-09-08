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
`src/features/bought/digest/DigestTab.tsx` (a server component; every co-located `Digest*.tsx` part is
server-safe too — the only client components on the page are `CopyForLlm` and the kit's `WhyChip`,
which cross the boundary by themselves), assembled by `buildWeeklyDigest` (`src/lib/org/digest.ts`) and serialized by
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
| Headline tiles | `headline` | Deltas are **cohort-matched** — repos scanned on *both* sides of the week. `DigestCoverageStrip` nests the three populations (fleet → scanned → compared); a null `cohortSize` draws the cohort as a **void** and the tiles drop their delta badges. |
| Score deltas per dimension | `dims[].band` | Three presentations, never re-derived at the renderer. On screen they are three marks: a bar clear of the shaded noise band, a bar inside it, and — for **unmeasured** — no bar and no numeral at all. |
| Follow-ups | `followups` (`src/lib/db/org-followups-week.ts`) | "Closed" is an event with a `how` (by rescan / by hand). Dismissals are drawn as their own segment across a visible gap, in the kit's `decided` state — dismissing is a decision not to do the work, and nothing can fold it into the closes. |
| Next three actions | `actions` | Rank 1 gets the accent block and is the same sentence the markdown leads with. `DigestReachBars` draws each move's reach and the subset it would lift a level; the ranking rule (`leverage`) is disclosed on a `WhyChip`, not asserted in the header. |
| Repository movement | `movement` | A null read ("could not be read this week") stays distinct from an empty one ("nothing moved beyond the noise band"). `DigestMoveAxis` shades the band every mover is, by construction, clear of. |
| Provenance footer | `provenance` | Scan count, the mock-engine caveat, and one line per degraded read — printed, because the digest is pasted into a room where nobody can ask the database a follow-up question. |

**The export.** "Copy as markdown" hands over `weeklyDigestMarkdown(d)` — a self-contained update in
a leadership voice, aimed at a Slack post, an email, or a paste into Claude Code. The audience is a
lead reporting upward, not an operator: it names moves and next actions, not query internals. The
Slack weekly push links to this tab (`orgTabHref(slug, "digest")` → `/org/<slug>?tab=digest`); the
tab was **born migrated** — it has never had a legacy `/org/<slug>/digest` route.

**Known gap:** "opened" is a **derived identity diff**, not an event. No creation event exists for a
follow-up, so the opened column diffs the pre-window scan against the latest one — a repository with
no pre-window scan cannot contribute (counted on a hatched legend row, "N repositories not
compared"), and when *no* repository has one the whole track is a **void**: `rendersValue("missing")`
is false, so the 0 that would read as a calm week is unprintable. Closing this gap means emitting a
creation event when a recommendation first appears.

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
there is no digest, so a null rollup — or one that fails `hasFleetGrade` (`src/lib/db/org-shared.ts`)
— returns `null` and the caller renders an empty state. Everything else is optional.

That guard used to be `scannedCount === 0`, **which an all-mock fleet passes**: every repo scanned,
every score on the deterministic mock floor, every average excluded from — so the digest published
`avg 0 · L1` into the Slack push and the board PDF. `hasFleetGrade` is strictly stronger (the three
averages share one population, `realScoredCount`) and narrows all three fields for everything after
it. The tab's empty state was corrected in the same wave: it used to assert "No scanned repositories
yet", which is flatly wrong for the second cause.

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

## Briefing, redesigned (2026-09-08)

The Briefing is what a lead takes into a leadership meeting, and until this pass it carried **17
components and zero SVG**: five `SectionHeader description` paragraphs, a chip row standing in for a
movement chart, and a numbered "Explore first" list standing in for a ranking. Prose in a briefing is
the part the reader has to translate under time pressure, so [the /org redesign
law](../../ORG-UX-REDESIGN.md) §2 was applied here in full. `SectionHeader description` in
`src/features/bought/executive/`: **5 → 1**, and the survivor is the window (`period.title`).

**What is drawn now**

| Panel | Was | Is |
| --- | --- | --- |
| Widest shared gaps (`OrgLeverageMoves`) | A 232-char header explaining the ranking, then a numbered list with an "Explore first" pill | `LeverageBars` — one bar per gap on a shared scale, length = `perRepo × repoCount` (the fleet maturity points on the table), one segment per affected repo, an accent tick where the repos that would cross a level end |
| Impact ledger | Tiles + a by-dimension chip row + a field-notes paragraph | A `FlowRibbon` funnel (merged → re-scanned → repos moved) beside `ImpactMovement`, a diverging per-dimension bar on one symmetric axis; then the tiles; then the receipt table |
| Transition programme | A header sentence asserting the baseline is frozen | `ProgramBaseline` — the frozen origin as an accent **ring** (the kit's `decided` encoding: a person froze it) on the 0-100 maturity ramp, the movement to today's standing, and the target rung as a dashed edge |
| vs previous period | A header sentence naming the comparison window | `PeriodDumbbell` in each of the three cells: hollow origin dot at the prior window's end, filled dot at now, on one track. Rendered by `PriorPeriodGrid`, so the public `/share/briefing/[token]` page gets the same mark |

**The pure view-models** — `leverageMoves.ts` and `impactView.ts` decide every state and every scale,
so the panel's refusals are unit-testable without a DOM (`leverageMoves.test.ts`,
`impactView.test.ts`), with the render layer pinned separately in `LeverageBars.dom.test.tsx`,
`briefingMarks.dom.test.tsx` and `ImpactLedger.dom.test.tsx`.

**The two voids, which are the point.** Both used to be sentences and are now shapes that cannot be
misread:

- A gap whose `projectedPoints` is null gets **no bar at all** — a dashed rule and an em dash. The
  old panel simply omitted the gain phrase, so a reader could not tell an unprojected gap from a
  small one. A short bar would have been a claim ("small gain"); `rendersValue("missing")` is false,
  so the view structurally cannot print a numeral there.
- `ImpactLedger.dimPoints === null` (nothing re-scanned) draws a **dashed zero axis with no bars**. A
  chart of zero-length bars would be a legible claim — "the period bought nothing" — and the ledger
  does not have that measurement; it has no measurement.

**Where the paragraphs went.** `ImpactLedgerFieldNotes.tsx` is deleted; its four sentences are now
`IMPACT_BASIS_HINT` (a `WhyChip` on the panel title), the counted legend rows `N awaiting rescan` /
`N with no baseline` (labels visible, sentences on hover), and `IMPACT_NO_SUM_HINT` on the *Repo
overall* column header it governs. The ranking basis is `LEVERAGE_BASIS_HINT`; "somewhere to look
next, not an order" is `LEVERAGE_ORDER_HINT` **and** the absence of rank numerals and CTA styling.
The empty ledger keeps its argument — that is the state where the reader has nothing to look at.

The `Source` column's provenance tag and the `merged`/`branch` split above are unchanged; the ledger
table is deliberately still a table (§2.7: auditable row-level evidence is what a table is for). The
`GOOD`/`BAD`/`MUTED` cell paints now read from `LEVEL_HEX` and `DIRECTION_TONE` rather than three
hand-typed hexes — same values, one home.

## Weekly digest, redesigned (Wave 4, 2026-09-08)

The digest was seven components, **zero SVG** and 508 characters of prose, and it is the one tab in
`/org` whose output leaves the product. That makes the [redesign law](../../ORG-UX-REDESIGN.md) apply
to it asymmetrically, and the split is worth stating because it is easy to get backwards:

- **The screen rendering is fair game.** §2 governs it, and every header sentence below is gone.
- **Prose that survives the copy is not chrome.** `weeklyDigestMarkdown` keeps its words — "flat
  (within noise)", the `—` in the dimension table, the "not measurable" line, the cohort clause. A
  recipient reading the update in Slack has no band to look at, no legend, and nothing to hover, so
  there the sentence *is* the encoding. **Where the screen and the artifact diverge, they diverge on
  purpose**, and each divergence is noted in the component that owns it.

**The last live copy of the em-dash sentence is gone.** *"Where each dimension stands now, and how it
moved over the week. An em dash is a missing measurement, not a zero."* was hand-written in two tabs;
Delivery encoded its copy away in Wave 1 and `DigestDimChart` encodes this one. Three readings, three
marks: a bar reaching out of the shaded band, a bar that stays inside it (the band is the reason a +1
is not a climb — nothing has to say "flat"), and, for an unmeasured dimension, **no bar and no
numeral anywhere on the row**. That last one is structural rather than careful: `bandState` maps the
`unmeasured` band to the kit's `missing`, whose `rendersValue()` is false.

**"Beside, never folded into" is a segment, not a promise.** `DigestLedgerBars` puts the closed and
dismissed counts on one axis with a visible gap between them, and paints the dismissals in the kit's
`decided` state — the accent ring is "a person decided this", which is exactly what a dismissal is.
An unmeasurable "opened" is a void on the same axis: no rect, no numeral, and the reason on a legend
row. The two tracks share one count scale so the week's closes and opens are comparable rather than
each self-scaled.

**The noise band is a band.** *"Repos whose overall score crossed the noise band between the two ends
of the week"* described a shape. `getOrgMovers` admits a repo only when `classifyDelta` puts it
outside ±`SCORE_NOISE_BAND`, so every mark on `DigestMoveAxis` is by construction clear of the shaded
middle — and the drawing shows by how much, which the sentence could not. The gainers/slippers
columns are gone with it; their numbers are positions on the axis now, and the deep links a list
still owns survive as the report links under the chart.

**A wrong claim, corrected.** "Next three actions" was headed *"Ranked by projected fleet gain over
the repos each one lifts."* It is not: `getOrgRecommendations` sorts by `leverage` (reach × impact
weight × dimension weight), and `projectedPoints` is a per-repository mean the ranking never reads —
the two can disagree, and the header asserted the wrong one. `DigestReachBars` draws the exact reach,
marks the subset a move would lift a level, and prints the points as the per-repo figure they are; a
move with **no** projection draws a void instead of a short bar, where before an unprojected move and
a low-value one looked identical. The real rule rides a `WhyChip` on the header.

**The cohort is drawn, not narrated.** "measured over 8 repositories scanned on both sides of the
week (+2 onboarded, 1 departed) · 10/12 repositories scanned" is three nested populations in one
line. `DigestCoverageStrip` nests them; the churn that explains why the cohort is smaller than the
scanned set is on a chip; a null cohort is a void, never a 0. The markdown keeps the sentence.

**One `SectionHeader description` survives on the tab** (down from five) and it is the window —
`2026-08-26 → 2026-09-01`, 23 characters. One clause of the removed lede turned out to duplicate a
`title` already shipped on the exact control it described — "copy it as markdown to paste into a
leadership update" is `CopyForLlm`'s own title — which is worth checking before demoting anything.

Kit used: `Legend` + `StateSwatch` (dimensions, follow-ups, actions), `WhyChip` (ranking basis, delta
cohort), and `states.ts` for every encoding — `stateFill`/`stateStroke`/`stateStrokeWidth`/
`stateTitle`/`rendersValue`/`VOID_DASH`/`HATCH_ID`/`VizDefs`/`STATE_LABEL`. No hatch, dash or state
label is re-defined. Colour is `scoreHex`, `deltaHex` and `DIRECTION_TONE`; there is no hand-picked
hex in the directory. The charts are deliberately **server-safe and motionless**: a digest is a
static artifact people paste, and an entrance animation on a document is noise — so there is no
reduced-motion branch to honour rather than an unhonoured one.

Key files: `src/features/bought/digest/` — `digestViz.ts` (the pure view models: every scale and
every state, unit-tested without a DOM), `DigestDimChart.tsx`, `DigestLedgerBars.tsx`,
`DigestMoveAxis.tsx`, `DigestReachBars.tsx`, `DigestCoverageStrip.tsx`, plus the five orchestrators.
Pinned by `digestViz.test.ts` and `DigestViz.dom.test.tsx`; `DigestTab.test.tsx` keeps the page
contract.

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

- **The pasted artifact's footer names the wrong denominator.** `weeklyDigestMarkdown` closes with
  "fleet averages over scanned repositories". Since `b1042324` the averages are over **live-scored**
  repos — mock-floored scans are excluded from every one of them (`realScoredCount`, not
  `scannedCount`). The screen has the same imprecision in its coverage strip, which draws
  `headline.scanned`. Fixing it properly means carrying `realScoredCount` / `mockCount` on
  `DigestHeadline`; the mock caveat in `provenance.engineCaveat` partly covers it today. Producer-side
  (`src/lib/org/digest*.ts`), outside the Wave 4 write set.
- **A quiet week is invisible in the pasted artifact.** The markdown omits the whole "Repository
  movement" section when nothing crossed the band (its rule: never a header with no rows). On screen
  those two states are kept apart — "could not be read" vs "nothing moved beyond the noise band" — so
  the caveat exists only on the screen side, which is the divergence running the *wrong* way. The
  footer's degraded-read note covers the failure case but not the quiet one.
- **Three orphaned reads** — `getOrgRework`, `getOrgGapAnalysis`, `getOrgDiscrepancies` — carry real
  data with no UI. Kept (tested) rather than deleted so a future home does not have to re-derive
  them; each is a decision, not an oversight.
- **Goals have no management UI.** Deliberate half-state, see above.
- (Closed 2026-08-14.) ~~Goal metrics are point-in-time.~~ Every `GoalProgress` row carries
  `series`, drawn by `GoalCard` (`src/components/org/shared/GoalTrend.tsx`).
