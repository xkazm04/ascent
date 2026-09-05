# Regression alerts

When a tracked repo is re-scanned and its maturity **drops**, Ascent records the regression
and (if a webhook sink is configured) posts an alert. Detection is a pure, unit-tested
function over a scan diff; delivery is a separate integration layer that never lets an
alerting failure break the scan.

## Detection (`src/lib/alerts.ts`)

`detectRegression(diff, thresholds)` → `RegressionVerdict { regressed, severity, reasons[] }`
where `severity` ∈ `critical | warning | null`:

| Severity | Triggers |
| --- | --- |
| **critical** | A level demotion (e.g. L4 → L3); sliding **into** the "ungoverned" posture, gated on `postureTransition` (below), not on a bare label change. |
| **warning** | Overall score drop ≥ 5 (configurable `thresholds.overallDrop`); any single-dimension drop ≥ 15 (configurable). |

**Posture-transition hysteresis.** The quadrant cuts at exactly 50 per axis, so a repo hovering at
49/51 flipped its label on a re-scan of an unchanged commit and fired the *critical* ungoverned alert
on pure wobble. `postureTransition` (`src/lib/maturity/noise.ts`) now gates it: a crossing is news only
once an axis is clear of the corridor: **enter at ≥52, leave at <48**. The classification itself is
untouched (`postureFor` stays pure), so nothing re-labels; only the announcement is damped.

`detectPromotion(diff)` → `PromotionVerdict { promoted, severity: "celebration" | null, reasons[] }`
is the sibling condition in the same module: an **upward** band crossing (L3 → L4). It is a
separate verdict on purpose: `RegressionVerdict.regressed` gates the `scan.regression` audit
row and the regression memory, so a celebration must never set it. `buildPromotionMessage`
renders the celebratory voice (🎉 "leveled up", "What got you here:" attributions, no alarm
chrome).

`buildRegressionMessage(repo, diff, verdict)` formats a Slack-compatible message (emoji
headline 🔻/⚠️, reason bullets, top-3 movement attributions from `diff.movements`, report
link). `dispatchAlert(message, opts)` POSTs to the **resolved sink**: `resolveAlertWebhook`
picks the org's own `Organization.alertWebhookUrl` when set, else the global
`ALERT_WEBHOOK_URL`, so one tenant's fleet intelligence never lands in another's channel.
It never throws and returns `false` when no sink resolves or the POST fails.
`isAlertConfigured(orgWebhookUrl?)` checks for the sink. Per-org sinks and per-org
sensitivity (`alertOverallDrop` / `alertDimensionDrop`) are configured through
`GET`/`POST /api/org/alerts` (admin-gated) and the dashboard's Alerts popover
(`src/components/org/shared/AlertsControl.tsx`). The two sensitivity fields are **independently
optional** on the POST: a body carrying only one leaves the other exactly as stored. (Until
2026-09-04 an absent key parsed to the same `null` an explicit clear produces, so a one-sided update
silently reset the other threshold to its default — invisible from the popover, which always posts
both.)

### Control transitions (moonshot #1)

Score movement is not the only thing worth interrupting a human for. The **control** kind reports
that a *named control* changed state — branch protection came off, required approvals fell to zero,
a repository was archived — read from the **control-observation ledger**, not from a `ScanDiff`.
That source matters: a control can flip between two scans (a webhook-triggered probe re-reads it
within seconds), and a diff of two scan reports would miss it entirely and then report it hours
later against the wrong time.

`detectControlTransitions(prev, next)` and `transitionsFromRows(rows)`
(`src/lib/controls/transitions.ts`) classify a state move into one of three codes:

| Code | Move | Severity | Dispatched to a sink? |
| --- | --- | --- | --- |
| `control-failed` | `pass → fail`, `unmeasurable → fail` | critical | yes |
| `control-restored` | `fail → pass` | celebration | yes |
| `control-unmeasurable` | `pass\|fail → unmeasurable` | info | **no** |

**`unmeasurable` never alerts as failed, and never pages anyone.** A token that loses a scope, a
repository turned private, a GitHub 403 — each turns a `pass` into "we cannot see it", and reporting
that as a failure would page a team about a control that is very probably still on. It is recorded
as an `AlertEvent` (`delivered: false`, no `suppressedReason` — it was never *eligible*, so blaming
the operator's sink configuration would be wrong) and goes no further. Symmetrically,
`unmeasurable → pass` is not a celebration: regaining a read is news about our access, not about the
org's controls.

Two further rules in `alertControlTransitions` (`src/lib/scan-alerts.ts`):

- It runs **independently of the regression path** — a control flip needs no `prev` report and is
  never gated on whether the score moved.
- Its cooldown key is **per (repo, control)** (`controlCooldownKey` → `acme/api#control:branch-protection`),
  so a branch-protection flip is never starved by a score push that already consumed the repo's
  generic slot, and two controls failing on one repository both get through.

`buildControlAlertMessage` names the control, the values either side (`2 → 0` explains a
required-approvals failure that "pass → fail" leaves abstract), how it was observed
(`scan | probe | webhook | conformance`), and the actor **only when a webhook observed one** —
scan- and probe-sourced rows carry no actor because nobody performed those in a way we observed.

W1-A's doctor path (`detectControlRegressions`, `src/lib/standard/control-matrix.ts`) dispatches
through the same builder with `source: "conformance"`.

### Standing regressions (a decline that stopped moving)

`detectStandingRegressions(points, opts?)` → `StandingConcern[]`. Pure, dependency-free, computed
from **persisted scans alone** — no run, no lane, no attribution verdict — because a dimension
knocked down by a human commit deserves the same alarm as one knocked down by a loop lane.

**The failure it closes.** In a 21-run campaign, `kp`'s D9 (Supply Chain & Security) went
93 → 96 → 75 at run 3 and sat at 75 for eighteen further runs. Twenty-one points, permanent, and
nothing anywhere reported it. Two independent silences produced that:

1. **Every existing signal is an event, not a state.** `detectRegression` compares one adjacent pair
   and `getOrgMovers` compares a period's ends. Both were *right* to say nothing on runs 4–21 — the
   adjacent delta was zero every time. But "nothing changed this week" and "this repo has been
   twenty-one points down for a month" are different facts, and only the first was reachable.
2. **Attribution refuses what it cannot explain.** `src/lib/maturity/attribution.ts` declines to
   *claim* a delta across a mock floor, inside the noise band, on an uncommitted lane, or across a
   platform-fold mismatch. That is correct, and it is the guard that stops the loop inventing lifts —
   but the same guard silences a true decline. **A guard against false claims must not become a guard
   against true regressions**, so this detector consults none of it.

**The rule.** For each dimension of the latest scan, walk the repo's readings newest-outward keeping
a running maximum, until one sits `STANDING_REGRESSION_DROP` (**10**) or more *above* that maximum —
which means every scan since that reading has held at least 10 points below it. If that reading is at
least `STANDING_REGRESSION_SCANS` (**3**) scans back, it is a standing concern. Consequences worth
naming: a plateau eighteen scans long is still measured against the reading *before the fall*, not
against a three-scan-ago reading that is itself part of the plateau; a one-scan dip that recovers
never qualifies; a shortfall inside the noise band never qualifies however long it holds
(10 is several times `SCORE_NOISE_BAND` = 2, and still under the per-scan `dimensionDrop` alarm of
15 — a standing concern is allowed to be quieter than a page because it is earned by persistence).
`mock`-engine readings are dropped from the series: a mock floor is a different ruler, and comparing
across one would manufacture a concern out of an engine swap.

**It is an observation, never an attribution.** A concern renders as
`D9 has held 21 points below its 2026-08-11 reading (96 → 75) across 19 scans since 2026-08-12` —
two readings, their dates, and how long it has persisted. `getStandingRegressions(orgSlug)`
(`src/lib/db/scans-read.ts`) supplies the readings for a whole org in two bounded queries and, for
the concerns actually raised, attaches the signals that appeared/disappeared between the two named
scans (via `diffStringSets`, the same set-diff the "what changed" view uses). Those lines are a
**list a reader can check**, not a stated cause.

**Which channel it reuses, and why the digest.** Nothing new was invented: the concern rides the
**weekly fleet digest** (below). That is the surface that goes silent in exactly this scenario — its
whole contract is "a flat week stays silent", and a decline that stopped moving reads as a flat week
to every movement-based input it has. Per-repo regression alerts were the wrong home: they are
event-shaped, cooldown-throttled, and would have to invent a "still true" cadence.

### Unestablished baselines (the loop's guard could not verify a repository)

`getRedBaselines(orgSlug, { limit })` (`src/lib/db/loop-baselines.ts`) → `RepoRedBaseline[]`. The
second inhabitant of the standing-concerns block, and it rides it for **exactly the reasoning above**.

The improvement loop's A/B degradation guard records `baseline-unavailable` on a lane when the
repository's resolved command — `npm run test:unit`, whatever the repo declares — **did not pass on
the lane's pristine worktree** ([live.md](../org-planning/live.md#the-ab-degradation-guard-2026-08-31)).
The guard then has no measurement to compare against, so it can neither catch a regression nor confirm
a fix: it is **effectively off on that repository** and everything the loop commits there is
unverified.

**What this concern does NOT say, and said wrongly for one cycle.** It does **not** claim the
repository's own checks are failing. Until 2026-08-31 it did — *"this repository's own check has
failed before the session on every loop lane since ‹date›"* — and that was false. Measured on
`xkazm04/systedo-case`: **3744 tests, 0 failing** in the operator's paired checkout; **8 failing** in a
`git worktree` cut from the same commit with `node_modules` linked exactly as the lane links it, every
one of them `Error: Could not load the default credentials`. A worktree carries tracked files plus the
dependency caches the loop links, and gitignored local state — credentials, `.env`, service config —
is correctly absent. The measurement supports *"the guard cannot establish a baseline here"* and
nothing stronger. Full evidence:
[live.md §What a missing baseline does NOT mean](../org-planning/live.md#what-a-missing-baseline-does-not-mean-2026-08-31).

That is a **state**, not an event, and it is invisible to every other signal for the same two reasons a
standing regression is: nothing *moves* while it holds, and the guard that stops the loop making false
claims is also what stops it raising this one. The digest is the surface whose silence it exploits.

**The rule.** The repository's lane history is walked newest-first; the unbroken run of
`baseline-unavailable` at the head is the concern (`consecutiveUnavailableBaseline`,
`src/lib/local/lane-baseline.ts`; rows carrying the legacy `baseline-red` still parse). A lane with
**no** verdict is skipped rather than breaking the run — that is a lane written before the guard
existed, and reading "unknown" as "a baseline existed then" would shorten every run spanning the
guard's own introduction. `verified`, `rejected` and `skipped` all **do** break it. **One lane is
enough**: unlike a score, "no baseline" has no noise band to see through, and the three-scan patience a
standing regression earns would buy three more lanes of unverifiable commits here.

**It is an observation, never an attribution — and it now ends with what would fix it:**

> `npm run test:unit` has not passed in the loop's isolated worktree on any loop lane since 2026-08-28
> (3 lanes). A worktree carries tracked files plus linked dependency caches and none of the gitignored
> local state a check may need, so this is not a reading of the repository's own checks. With no
> baseline the degradation guard cannot compare anything, so nothing the loop commits here is
> verified. To make this repository verifiable, declare a command that runs from a clean checkout at
> `controls.ciHardPass` in `.ai/manifest.yaml` (the guard prefers it over anything it infers), or turn
> `verifyMode` off for this repository.

What, since when, how long, the consequence, and the **remedy**. The remedy is the half the old line
lacked, and it is the whole point of raising this in a channel an **operator** reads: both options are
true, specific and in their hands, and the guard's resolution chain already prefers a manifest
declaration over anything it infers, so wiring `controls.ciHardPass` takes effect on the next lane. A
**date**, never a wall-clock time. No cause, no actor. Its `evidence` lines are the command's captured
output — bounded to 4 lines / 400 chars and passed through `neutralize`
(`src/lib/llm/untrusted.ts`), because that same text is quoted into a model prompt on the loop side.

**In the digest** they are folded into `FleetDigestInput.standingConcerns` alongside the dimension
concerns, **unestablished baselines first**: a guard that cannot run outranks a score that fell.
Deliberately ONE list and one heading — *"observed, cause not attributed"* is already true of both,
each line names its own subject, and a second block would be a second thing for a reader to learn for a
distinction that lives in the sentence. They count toward `digestHasSignal`'s `standingConcerns`, so a
fleet whose only news is a disabled guard still sends. A fleet with none raises nothing and the block
says so — *"Standing concerns: none open."* — while a run that could not READ either column omits the
block entirely: the same three-state contract `controlsFailed` keeps (2026-09-04).

The loop tells the **agent** too, but only that the cycle cannot be verified and that it should work
conservatively — it does **not** ask for a repair, and there is no attempt counter. That half lives in
[live.md](../org-planning/live.md#an-unestablished-baseline-is-surfaced-and-what-it-does-not-claim-2026-08-31).

## Integration (`src/lib/scan-alerts.ts`)

`checkAndAlertRegression(prev, fresh, opts)`:

1. Diff the prior persisted report vs the freshly computed one (`diffScans`, see
   [report.md](../reporting/report.md)).
2. Detect a regression and record a `scan.regression` audit entry **even without a webhook
   sink**.
3. If a sink is configured, claim the per-repo cooldown and dispatch the message.
4. **If it did not regress**, check `detectPromotion`: an upward band crossing dispatches the
   celebratory message through the same sink and the same claim pool (a promotion *consumes*
   the window, so a repo flapping across a band edge can't alternate 🎉/🔻 every scan). No
   audit row, since the level change is already recorded to Shared Org Memory, both directions.
5. Return `{ regressed, verdict, dispatched, promoted? }`. Never throws.

It's called from **three** fire sites, all *after* a new scan is persisted (capturing the prior
report before persist, diffing after): the [rescan cron](./rescan.md), the
[push webhook](../github/github-app.md), and, since the shared finalize layer was wired
(`cacheAndPersistScan` in `src/lib/scan-finalize.ts`), every **interactive** scan through
`/api/scan` and `/api/scan/stream`, on a newly written row. All three share the per-repo
cooldown claim, so an interactive rescan can't double-alert with the cron.

## Key files

| File | Role |
| --- | --- |
| `src/lib/alerts.ts` | Pure detector + Slack message builder (regression, promotion, **fleet digest** `buildFleetDigestMessage`) + webhook dispatch + `digestHasSignal`/`creditsAlertThreshold`. |
| `src/lib/alerts.test.ts` | Threshold + verdict + message tests. |
| `src/lib/alerts-standing.test.ts` | Standing-regression rule: the kp shape raises, a single-scan dip / a fresh drop / a within-noise drop / no history do not, and it fires on a drop attribution refuses to claim. |
| `src/lib/db/scans-read.ts` | `getStandingRegressions(orgSlug)` — the persisted-scan read behind the standing detector, plus the appeared/disappeared evidence lines. |
| `src/lib/local/lane-baseline.test.ts` | Unestablished baselines: the consecutive walk (a verdict-less lane is skipped, `skipped` breaks it, one lane is enough); the observation naming the **worktree**, ending in the remedy, and asserting **nothing** about the repository's own checks; the brief carrying no `attempt` field; the evidence lines bounded on both axes and neutralized. |
| `src/app/api/cron/digest/route.test.ts` | An unestablished baseline reaches the movement gate and the rendered block with its evidence; the rendered line carries `controls.ciHardPass` and does not accuse the repository; a fleet whose baselines were established raises nothing and the block is omitted; it is listed above a standing regression. |
| `src/lib/scan-alerts.ts` | Glue: diff prior vs fresh, audit, dispatch. |
| `src/app/api/cron/digest/route.ts` | Weekly fleet digest cron handler. |
| `src/app/api/cron/digest/extra-alerts.ts` | Goal-at-risk + spend-anomaly pushes that ride the weekly run. |
| `src/lib/email/alert-sink.ts` | Renders an `AlertMessage` as mail for a `mailto:` sink. |
| `src/lib/email/unsubscribe.ts`, `src/app/api/email/unsubscribe/route.ts` | Signed one-click unsubscribe (clears the org's sink). |

## What moved since you last looked (in-app unread state)

The dashboard's Alerts chip carries a movement count. It is a **read** over records the scan
pipeline already persists (Shared Org Memory: regressions, level changes, closed gaps), not a
new event system:

- **Watermark:** `Membership.alertsSeenAt` (nullable, per-user-per-org). Never opened it? The
  window falls back to the member's join date. Advanced by `POST /api/org/alerts { seen: true }`
  when the popover opens.
- **Count:** `getOrgMovementSince(orgSlug, since)` (`src/lib/db/org-movement.ts`): ONE bounded
  `OrgMemory` query with `take: MOVEMENT_CAP + 1`, so ">9" costs no second query. Hidden at zero.
- **Rows:** repo + event label + age, and under each, the persisted one-line summary the memory
  record carries (2026-09-04). Without it every row read "acme/api regressed 1h ago", identical for a
  3-point wobble and a two-band demotion, while the sentence that separates them was already on the
  client.
- **Degrades:** auth-off deployments, the public org, a viewer with no membership, or any read
  failure answer `{ movement: null }` and the chip renders exactly as it did before.

## Weekly fleet digest (`GET /api/cron/digest`)

Where regression/promotion alerts fire per-repo on a slide, the digest is the **positive
periodic push**: a leader relies on it instead of opening the app, so a flat week stays
silent rather than training the inbox filter.

- **What it summarizes:** for each org with watched repos: the past-week fleet rollup
  (`getOrgRollup(org, win)`: avg overall, level, scanned/repo counts, overall delta vs the
  week's start), the **top movers** (`getOrgMovers`, up to 3 gainers + 3 regressers,
  noise-filtered via `isWithinNoise` so within-jitter moves never appear under
  "Regressions:"), the **highest-leverage gap** (`getOrgRecommendations(org, 1)`'s top
  result: title + affected repo count), the corpus percentile (`getOrgBenchmark`), a
  one-line forecast trajectory (`trajectoryLine` — see "The trajectory line is gated and
  hedged" below), and, for metered, non-public orgs
  running low, the remaining credit balance. The week is derived from the shared
  `weekRangeParams()`/`resolveWindow()` period helper (a custom range snapped to local
  calendar days). **The message links to the Weekly digest tab** (`?tab=digest`, see
  [plan.md](../org-planning/plan.md#weekly-digest-tabdigest-bought)), whose window is fixed at
  that same trailing week, so the push and the page it opens cannot disagree about the period;
  the goal-at-risk / spend pushes below still deep-link the executive briefing with
  `?range=custom&from=&to=` because that page's window is selectable.
- **Movement gate:** `digestHasSignal()` (`src/lib/alerts.ts`) decides whether the week is
  worth sending at all: a level change, a beyond-noise regression, a beyond-noise gainer, a
  non-zero overall delta, a low credit balance, a control that failed (`controlsFailed > 0`),
  **or a standing concern** (`standingConcerns > 0`, which counts unestablished baselines too). An org with none of those is skipped
  (`skippedFlat`). A standing concern is re-stated every period it persists — on the same reasoning
  as the low-credit line: the reader needs to know it is *still* true, not only that it once
  happened. Every other condition is a movement, which is precisely why a decline that stopped
  moving could sit unreported for eighteen scans.
- **The trajectory line is gated and hedged (MC-B1, 2026-08-31).** The digest's one-line trajectory
  comes from `trajectoryLine(rollup.forecast)` (`src/lib/maturity/forecast.ts`), the same composer the
  executive briefing, the board PDF, the read-only share page and the "Copy for LLM" markdown read.
  Three outcomes, and only three: a fit that clears the shared presentability gate
  (`isProjectable` — ≥ 3 distinct scan days AND ≥ 14 days of calendar span) pushes its headline **with
  its hedge attached** ("… (trend confidence 34% · noisy · fit over 9 scan days across 84 days)"); a
  fit below the gate pushes `forecastInsufficiency`'s refusal *verbatim* — the same sentence the
  Delivery fit readout and `/trends` print; no fit at all pushes **nothing**, because an absent basis
  degrades to silence, never to a fabricated one. It previously pushed `forecastHeadline` raw, so a
  two-scan-day fit went out to Slack as a bare "Climbing at +35/wk" — a push channel is the worst
  place to state a slope nobody can click through to question.
- **Controls block (moonshot #1):** `FleetDigestInput.controlsFailed` renders a
  "Controls that failed this week" block **above** the movers — a control that came off a repository
  outranks every score delta on the page, and a reader who has to scroll past six gainers to find it
  will stop finding it. An empty array is the positive statement "we looked and none failed";
  omitting the field entirely omits the block, because a deployment without the ledger should say
  nothing rather than claim "0 controls failed". A failed control is **always** signal: a week whose
  only news is branch protection coming off is precisely the week the digest exists for.

  **All three states are reachable from the cron (fixed 2026-08-31, UAT `DANA-L1-015`).** The route
  used to send `undefined` whenever the transition list came back empty, so the `[]` branch — tested in
  `alerts.test.ts` since it shipped — could never fire in production and a clean week was
  byte-identical to a week nobody had populated the ledger. `listObservationsSince` now fails to
  **null**, not to `[]`: null (the read failed) omits the block, `[]` (the read succeeded, nothing
  failed) prints *"Controls: none failed this week."*

  **And the block never travels without its N.** `control-observations.ts` states the coverage law —
  any surface printing a control's state over a period must print its coverage beside it — and the
  digest is the surface it was written for, because it is read *instead of* the page that would
  otherwise correct it. `FleetDigestInput.controlCoverage` carries a fleet roll-up of
  `controlCoverage(org, { from: windowStart })`: `{ pairs, observations, maxGapDays, truncated }`,
  where `maxGapDays` is the **worst** pair's gap (a claim is only as strong as its thinnest evidence)
  and a single-observation pair contributes no gap rather than a 0. It renders as
  *"Coverage: 42 observations across 6 repo/control pairs, largest gap 3.2d."* under the heading;
  an empty window reads *"no control was observed in this window — the all-clear above is not
  evidence."*; a capped read prints `2000+`. Same three-state rule as the block itself — a coverage
  read that failed omits the line rather than printing zero, and it never appears without the block it
  qualifies.
- **Standing-concerns block:** `FleetDigestInput.standingConcerns` renders
  "Standing concerns (N) — observed, cause not attributed:" beside the Controls block and above the
  movers, each line the repo + the observation + up to three appeared/disappeared evidence lines. The
  disclaimer is in the heading so a line quoted out of the message still cannot read as an
  attribution. Same three-state contract as `controlsFailed`: undefined omits the block (a caller
  that did not compute it says nothing rather than "0 concerns"), an empty array is the positive
  statement "we looked and nothing is standing down". Fed by **two** reads, both deliberately **not**
  window-scoped for the same reason — the whole failure they close began before this week:
  `getRedBaselines(org, { limit: 5 })` first (a repository the loop's guard could not establish a
  baseline for, so it cannot run at all) then `getStandingRegressions(org, { limit: 5 })`.

  Until 2026-09-04 the cron caller kept none of that: both reads were `.catch(() => [])` and the
  block was passed only when non-empty, so an unreadable ledger, a clean fleet and a block that was
  never computed all rendered as the same silence — the `failure-not-empty-success` law the registry's
  `alerting` subject names in its `periodic-digest` technique, and the exact defect `controlsFailed`
  had already been fixed for three lines above. Both reads now catch to `null`; `[]` reaches the
  builder and renders "none open."; `null` from BOTH omits the block; one read failing still prints
  the other's rows (they are true observations, and the block is a top-5, never an exhaustive total).
- **Schedule/trigger:** invoked by Vercel Cron (see `vercel.json`) hitting
  `GET /api/cron/digest` (`src/app/api/cron/digest/route.ts`), `runtime: "nodejs"`,
  `maxDuration: 300`. Orgs are processed with bounded concurrency (`mapPool`, concurrency 4)
  and a soft deadline (270s); past it, remaining orgs are counted as `remaining` instead of
  silently dropped when the platform kills the function.
- **`CRON_SECRET` auth:** via the shared `requireCronAuth` gate (`src/lib/cron-auth.ts`),
  which this route hand-rolled until G8-48 promoted the strict contract into the helper. Fails
  closed: a missing/empty `CRON_SECRET` 503s rather than running unauthenticated. The secret
  must be presented as an `Authorization: Bearer <secret>` header (never a `?key=` query param,
  which routinely lands in access/CDN/proxy logs and Referer headers, accepted only behind the
  temporary `CRON_ALLOW_QUERY_KEY=1` deprecation hatch, which warns on every use) and is
  compared with a constant-time `timingSafeEqual` (length-mismatch short-circuits without
  calling it, since `timingSafeEqual` throws on unequal-length buffers).
- **At-most-once per window:** an atomic conditional-insert claim (`claimOrgAuditOnce` /
  `releaseAuditClaim`, `src/lib/db/scans-audit.ts`) against the `org.digest.sent` audit
  action guards against double-sends from a platform retry or an overlapping schedule fire;
  a failed dispatch releases the claim so the next run retries.
- **Block-Kit message shape:** `buildFleetDigestMessage(input)` (`src/lib/alerts.ts`,
  pure) builds the same `AlertMessage { text, blocks }` shape as the regression/promotion
  builders: a headline (`📊 Ascent weekly digest: <org>`), a summary line (fleet maturity,
  level, delta, scanned/repo counts, percentile), an optional trajectory line, a "Top
  gainers"/"Regressions" block, a "Highest-leverage gap" block, an optional "Credits
  remaining" line, and a link to the org's executive briefing (carrying the same
  `?range=custom&from=&to=` window). A `null` `overallDelta` (no baseline exists for the
  window at all, whether a freshly-onboarded org or a fleet whose entire scan history is younger
  than the window boundary) renders as an explicit "not enough history yet for a
  week-over-week comparison" clause, never a silently-dropped delta: an empty string there
  used to be indistinguishable from "the fleet held exactly flat."
- **Shares webhook resolution with interactive alerts:** the digest resolves its sink
  through the exact same path as regression/promotion delivery: `getOrgAlertWebhook(org)` →
  the org's own `Organization.alertWebhookUrl` → falls back to the global
  `ALERT_WEBHOOK_URL` via `resolveAlertWebhook`/`isAlertConfigured`, and dispatches with the
  same `dispatchAlert()`. Orgs with no resolvable sink are skipped before any rollup work
  (`skippedNoSink`), so a deployment with neither configured is a clean no-op. A lookup
  *failure* (vs. a genuine unset column) is intentionally NOT treated as "no sink"; it
  propagates to the per-org error handler so a transient DB error can't misroute one
  tenant's fleet digest to the operator's global channel.
- **Deliberately separate noise policy:** the digest's gainers/regressers lists are gated
  by the global `isWithinNoise` band, not by the org's configured "Regression sensitivity"
  thresholds (`alertOverallDrop`/`alertDimensionDrop`, which tune only the per-repo
  `scan-alerts.ts` path). This keeps the digest's "beyond measurement jitter" semantics
  comparable across orgs rather than something each org tunes.

## Email transport (`src/lib/email`)

Every message Ascent sends (scan completions, org invites, `mailto:` alert sinks, Custom-plan
enquiries) leaves through **one** selection point, `getEmailSender()`, so "email is off on this deploy"
is a single unambiguous fact (`emailSendingEnabled()`).

| `EMAIL_PROVIDER` | Sender |
| --- | --- |
| `auto` (default) | SES when `SES_FROM_EMAIL` is set, else Resend when `RESEND_API_KEY` is set, else the logging no-op |
| `ses` | `SesEmailSender` (lazy-imports the AWS SDK; credentials from the standard chain) |
| `resend` | `ResendEmailSender` (one `fetch` POST to `api.resend.com`, no npm dependency) |
| `noop` | Never sends, reports `{ ok: true, skipped: true }` |

SES wins over Resend under `auto` **deliberately**: adding a second provider must not silently re-route a
deployment that already had one. Choose the other order explicitly with `EMAIL_PROVIDER=resend`.

Selecting a provider whose credential is missing is a **broken deploy**: `ok: false`, logged, never the
`skipped` no-op, which means "no provider is wired here, nothing was attempted".

**Resend sender identity.** Resend refuses any `from` on an unverified domain. `RESEND_FROM_EMAIL`
defaults to Resend's shared sandbox identity (`Ascent <onboarding@resend.dev>`), which needs no
verification but **only delivers to the Resend account owner's own address**. That fits a single operator
inbox (the Custom-plan enquiry) and nothing else; verify a domain and set `RESEND_FROM_EMAIL` before
pointing user-facing mail at it.

`EmailMessage.replyTo` (honored by both real senders: SES `ReplyToAddresses`, Resend `reply_to`) exists
for mail that carries someone *else's* message: a Custom-plan enquiry lands in the operator's inbox and
Reply must reach the prospect. Pass it via `dispatchBuiltEmail(to, built, { replyTo })`.

## Scan-completion email (a separate path)

The per-scan "email me when it's done" opt-in is **not** the alert layer; it goes through
`src/lib/email` (`dispatchScanCompletionEmail`). When no provider is wired
(`SES_FROM_EMAIL` unset, or `EMAIL_PROVIDER=noop`) the no-op sender returns
`{ ok: true, skipped: true }` and **nothing is sent**. `/api/scan/stream` emits a `notify`
SSE frame *before* the `result` frame with `status: "sending" | "unconfigured"` (derived from
`emailSendingEnabled()`), and logs the skip, so an unconfigured deploy says so instead of
implying a send.

## Email sinks (`mailto:`, G7-01)

The alert sink accepts **an email address as well as a webhook**, so an org whose leadership
doesn't live in Slack still receives regression, promotion, low-credit, digest, goal-at-risk and
spend-anomaly pushes. There is no second transport and no second recipient list.

- **How it is turned on:** an admin stores `mailto:someone@example.com` in the org's alert sink
  (`POST /api/org/alerts { webhookUrl: "mailto:…" }`, the same admin-gated field and the same
  deliberate act as pointing the sink at a Slack channel). `validateAlertWebhookUrl` accepts the
  `mailto:` scheme, requires a single well-formed address (no comma-separated fan-out), and
  normalizes the stored value. The global `ALERT_WEBHOOK_URL` may also be a `mailto:` for a
  single-tenant deployment. The Alerts popover's sink field **names the address form** in its help
  text and placeholder (2026-09-04); before that it said only "Slack-compatible incoming webhook",
  so the one surface that configures this channel never mentioned it existed.
- **Who receives it:** exactly the one configured address. Nothing is ever sent to org members,
  to a scan requester, or to any address the org did not store as its sink.
- **Off by default, three ways over:** no sink stored, no global `ALERT_WEBHOOK_URL`, and no
  email provider (`SES_FROM_EMAIL`) each independently make it a no-op. With no provider,
  `dispatchAlert` to a `mailto:` sink performs **no network I/O** and returns `false`, so the
  digest releases its window claim and retries later rather than recording a phantom send.
- **How it stops:** every alert mail states why it arrived and carries an unsubscribe link to
  `GET/POST /api/email/unsubscribe`, whose token is an HMAC over the org slug signed with
  `EMAIL_UNSUBSCRIBE_SECRET`. `GET` only renders a confirm form (mail clients and security
  gateways prefetch links); `POST` clears `Organization.alertWebhookUrl`. With no secret
  configured there is no one-click link at all; the footer names the settings page instead, and
  the route 503s (no unauthenticated mutation endpoint on a deploy that never mailed a token).
  Clearing the sink stops the webhook pushes too, because they are one setting; the mail says so.
- **Rendering:** `buildAlertEmail` (`src/lib/email/alert-sink.ts`, pure) uses each builder's
  existing plain-text fallback as the body, so a new alert builder gets an email rendering for
  free. Slack Block Kit is ignored on this path.

## Goal-at-risk and spend-anomaly pushes (G7-03)

Two trigger classes the layer could always compute and never pushed. Both ride the weekly digest
cron (`src/app/api/cron/digest/extra-alerts.ts`) and route through the org's own sink, so an org
with no sink gets no extra work and no extra push.

| Trigger | Condition | Recipient | Cadence |
| --- | --- | --- | --- |
| **Goal at risk** (`buildGoalAtRiskMessage`) | Any goal `listGoals` already marks `pace: "behind"` and not achieved. | The org's alert sink. | At most once per weekly window (`org.alert.goal-at-risk` claim). |
| **Spend anomaly** (`buildSpendAnomalyMessage`) | This week's billable scans ≥ `SPEND_ANOMALY_RATIO` × the trailing 3-week per-week average, with a floor of 10 scans so small fleets can't trip it. A spend *drop* never fires. | The org's alert sink. | At most once per weekly window (`org.alert.spend-anomaly` claim). |

**The spend figure is the ALL-LANE total.** Detection is still scan VOLUME (this week's billable
scans vs the trailing average — that is what `daily` carries), but the dollar line in the message
quotes `UsageSummary.allLanesCostUsd`, not `estimatedCostUsd`, which prices the scan lane alone. The
digest was the last reader of the understated figure `/usage`'s headline tile stopped showing in
MC-B12 — and the reader least able to notice, because nobody cross-checks a push (UAT MC-B32). The
message says *"all lanes"* out loud and, when calls in the period could not be priced, discloses the
count so the figure reads as a **floor** — the same disclosure rule the lane rows and the tile carry.

They are dispatched **before** the digest's movement gate on purpose: a goal sliding off pace is
exactly the news a flat fleet week still needs to carry. Each takes its own at-most-once claim and
releases it on a failed delivery; the whole call is internally caught, so it can add to `errors`
but can never fail the digest that carries it. The run's response reports `goalAlerts` /
`spendAlerts`.

**Security alerts (dispatched 2026-08-14, from the scan pipeline as intended).**
`buildSecurityAlertMessage` fires from `checkAndAlertRegression`'s post-scan diff, the same-day
trigger this doc always named, when **D9 fell past the org's `dimensionDrop` line but the generic
regression push headlined a different dimension** (or only the overall drop). When D9 *is* the
headline, no second push fires: one slide must not ping twice. It takes its own cooldown key
(`<fullName>#security` in the shared claim pool) so the generic claim can't starve it.

## Alert history (`AlertEvent`)

Every dispatch decision is persisted to the **`AlertEvent`** table
(`src/lib/db/alert-events.ts`: `recordAlertEvent` / `listAlertEvents`), deliberately NOT
`AuditLog`, whose claim rows are deleted on failed delivery (`releaseAuditClaim`) and purged by
`retentionAuditDays`. Rows are written **even when no sink is configured**
(`delivered=false, suppressedReason="no-sink"`), so a webhook-less org finally has a trace of what
it would have been told. Fields: kind (`regression | promotion | security | low-credits | digest |
goal-at-risk | spend-anomaly | control`), severity, repo, title, body, `delivered`, `sinkKind`
(`webhook | email`), `suppressedReason` (`no-sink | cooldown | dispatch-failed`). Writers:
`scan-alerts.ts` (regression / promotion / security / low-credits / control), the digest cron (digest), and
`extra-alerts.ts` (goal-at-risk / spend-anomaly). Test alerts are deliberately not recorded.

The history is surfaced in the Alerts popover ("Recent alerts", `AlertsHistory.tsx`, lazy-loaded
`<details>`) via `GET /api/org/alerts?org=…&history=1`, member-readable like movement (rows carry
titles and outcomes, never the sink URL).

## Environment variables

| Var | Default | Effect |
| --- | --- | --- |
| `ALERT_WEBHOOK_URL` | unset | Global fallback sink. May be an `https://` webhook **or** a `mailto:` address. |
| `SES_FROM_EMAIL` | unset | Verified SES sender; its presence selects SES under `auto`. |
| `RESEND_API_KEY` | unset | Resend API key; selects Resend under `auto` when SES is unconfigured. |
| `RESEND_FROM_EMAIL` | `Ascent <onboarding@resend.dev>` | Resend `from`. The default is Resend's shared sandbox identity: needs no domain verification but delivers **only to the Resend account owner**. |
| `EMAIL_PROVIDER` | `auto` | `auto` \| `ses` \| `resend` \| `noop`. With **neither** SES nor Resend configured, no email is ever sent (the no-op sender reports `skipped`). |
| `EMAIL_UNSUBSCRIBE_SECRET` | unset | HMAC key for one-click unsubscribe links. Unset ⇒ no link is minted and `/api/email/unsubscribe` 503s. |
| `EMAIL_INVITES` | on | Set to `off` to refuse invite mail on a deploy that has SES wired for other mail. |
| `SPEND_ANOMALY_RATIO` | `2` | Multiple of the trailing average that trips the spend alert. Blank/invalid → 2, never 0. |
| `REGRESSION_COOLDOWN_MINUTES` | `360` | Per-repo regression/promotion alert cooldown. |
| `CREDITS_ALERT_THRESHOLD` | `5` | Low-water mark for credit alerts. |

## Known gaps

- **Promotions are band-crossings only:** a large in-band gain (46 → 60, still L3) is not
  pushed; only a level crossing is.
- (Closed 2026-08-14.) ~~No in-app alert history~~: the `AlertEvent` table + the popover's
  "Recent alerts" section persist every dispatch decision with its outcome (see above). Still open
  within it: no acknowledgement state on individual rows.
- **Per-org digest frequency/sections are not configurable:** the cadence is the weekly cron plus
  the movement gate; per-org preference fields would also need a migration.
- (Closed 2026-08-14.) ~~Security alerts are built but not dispatched~~: dispatched from the
  scan pipeline's post-scan diff (see above).
- (Closed 2026-08-30, moonshot #1.) ~~The taxonomy cannot say "a control failed"~~: the `control`
  kind ships with the codes `control-failed | control-restored | control-unmeasurable`, dispatched
  from the control-observation ledger (see "Control transitions" above). **The honest remainder:**
  `control-unmeasurable` is recorded but never reaches a sink, so a control that becomes unreadable
  is visible in the alert history and on the Governance tab's timeline card but does not page
  anyone. That is deliberate — a lost read is missing evidence, not a finding — and it means a
  control that quietly stops being observable will not interrupt a team the way one that flips to
  `fail` does.
- (Closed 2026-08-31.) ~~A regression that stops moving stops being reported~~: every signal in this
  layer was an adjacent-pair or period-delta event, so `kp`'s permanent 21-point D9 drop was silent
  for eighteen scans after the one it happened on. `detectStandingRegressions` + the digest's
  standing-concerns block report the *state* (see above). **The honest remainder:** the concern is
  delivered only through the weekly digest, so an org with no configured sink still learns about it
  only by opening the dashboard, and there is no in-app standing-concern surface on the repository
  or report pages yet.
- (Closed 2026-08-31.) ~~A repository the loop's guard cannot verify is reported nowhere~~: the guard
  wrote its verdict to a lane log, which meant it could be effectively off on a repository
  indefinitely with nobody told. `getRedBaselines` + the same standing-concerns block now report it
  (see "Unestablished baselines" above), with the remedy the operator can act on.
  **The honest remainder:** it shares the previous item's remainder — digest-only delivery — and the
  in-app half is one word (`no baseline`) on the Live tab's outcome sheet, which an operator only sees
  if they open that tab. There is no repository- or report-page surface for it.
- **No acknowledgement or assignment on a control alert:** the `AlertEvent` row records the decision,
  but there is no "who is fixing this" state — the same gap the history rows have generally.
