# Feature Scout — Org Overview & Standing (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 3H / 2M / 0L

Context audited: the org landing (`/org`, `/org/[slug]`) + shared org shell/nav — fleet rollup, standing/benchmark, gaps, leverage moves, trajectory forecast, time-range + segment selectors, period summary, goals.

Verified-already-shipped (NOT re-proposed): trajectory forecast (`Trajectory.tsx`), top gainers/regressers movers (`page.tsx` MoversList + `getOrgMovers`), cross-repo gap analysis (`OrgGapsSection` + `getOrgGapAnalysis`), goal-vs-actual progress with pace/ETA (`GoalsOverview` + `GoalCard`), saved/shareable time-range *via URL* (`TimeRangeSelector` writes `?range=`), corpus + same-language peer-cohort benchmark (`getOrgBenchmark`), segment scoping + side-by-side segment compare (`segments/page.tsx`), org switcher (context-switch only), weekly Slack/webhook fleet digest (`api/cron/digest`), and exec-briefing PDF + Copy-for-LLM (on the `/executive` tab only).

---

## 1. Multi-org portfolio / cross-org standing for users who own several orgs
- **Severity**: Critical
- **Category**: feature
- **File**: src/components/OrgSwitcher.tsx:17 ; src/app/org/page.tsx:12
- **Scenario**: A platform lead or agency installs the Ascent GitHub App on several GitHub orgs (the switcher already lists "the viewer's installations"). They want one screen that ranks "which of my orgs is healthiest / moving fastest / lagging" — a portfolio rollup above the per-org dashboard.
- **Gap**: `OrgSwitcher` can only *switch the active tenant one at a time* (POST `/api/org/active` then navigate); bare `/org` just `redirect()`s to the single remembered org. Grep for `compareOrgs|portfolio|multi.?org|fleet.*compare` found only false positives ("vs the org") — there is no surface that aggregates or compares more than one org. `getOrgBenchmark` compares against the anonymous *corpus*, not against the viewer's own other orgs.
- **Impact**: Anyone managing >1 org (agencies, holding-co platform teams, the operator's own demo orgs) currently re-navigates per tenant and can't answer "where do I focus this quarter across my orgs". This is the natural top-of-funnel for the fleet layer and a clear paid-tier differentiator.
- **Fix sketch**: New `getOrgsRollup(slugs[])` in `lib/db/org-rollup.ts` looping the readable orgs from `getViewer()`/installations and reusing `getOrgRollup` per slug; new `/org` (or `/orgs`) page rendering a sortable standing table (org · level · overall · Δ vs period · trajectory arrow), each row linking to `/org/[slug]`. Reuse `Tile`/`OrgTable`/`scoreHex`. Medium effort (one query fan-out + one page; auth already gates each slug via `canReadOrg`).

## 2. Email delivery of the period summary / briefing (digest is Slack-only)
- **Severity**: High
- **Category**: feature
- **File**: src/app/api/cron/digest/route.ts:48 ; src/lib/alerts.ts
- **Scenario**: A VP/CTO who is the audience for the "Quarter in review" banner (`PeriodSummary.tsx`) doesn't live in the engineering Slack. They want the weekly fleet summary — and the board-ready briefing — to land in their inbox on a schedule, with no app login.
- **Gap**: The only push channel is a Slack/webhook Block-Kit message (`dispatchAlert` → `Organization.alertWebhookUrl`/`ALERT_WEBHOOK_URL`). Grep for `email|smtp|nodemailer|resend|@react-email|mailto|sendEmail` over `src/` returns **zero** email-send code; the briefing PDF (`api/org/briefing/pdf`) is download-only — no scheduled or emailed delivery, and no per-recipient subscription.
- **Impact**: Executives are exactly the persona the standing/briefing is written for, yet they can't subscribe. Email is the lowest-friction exec channel and the standard "weekly digest" expectation; it also creates a recurring re-engagement loop without a seat.
- **Fix sketch**: Add an email transport (Resend/`@react-email`) behind a `RESEND_API_KEY` guard; extend the digest cron to also render `buildExecBriefing` to HTML and send to org-configured recipients (new `Organization.digestEmails` or a `DigestSubscription` table). A "Email me this" / manage-recipients control on the overview + briefing pages. Medium-high effort (transport + recipient model + template).

## 3. Drill-everywhere from the overview aggregates into a filtered repo list
- **Severity**: High
- **Category**: functionality
- **File**: src/app/org/[slug]/page.tsx:160 ; src/app/org/[slug]/page.tsx:178-209
- **Scenario**: A lead reads "Solid but Manual: 7" in Posture distribution, or sees Dimension "Testing" averaging 38, and immediately wants the list of *which* repos make up that bucket so they can act.
- **Gap**: The summary tiles (`Tile` at line 137-161, including "Repos scanned 12/40"), the posture-distribution rows (line 182), and the dimension-average rows (line 198) are all **static** — none are links. Only repo-specific gap outliers and leverage-move repo names link out. `repositories/page.tsx` exists but there is no `?posture=`/`?dim=`/`?status=unscanned` filter wiring from the overview, so the user must eyeball the full table.
- **Impact**: Breaks the core "see a number → act on it" loop on the dashboard home. Every overview reader hits this. Cheap to add and disproportionately increases the dashboard's usefulness as a launchpad.
- **Fix sketch**: Make posture rows and dimension rows `Link`s to `/org/[slug]/repositories?posture=…` / `?weakDim=…`; make "Repos scanned 12/40" link to `?scan=unscanned`. Add the corresponding query-param filter to `repositories/page.tsx`'s repo list. Reuse existing `scoreHex`/`postureLabel`. Low-medium effort.

## 4. Customizable / collapsible overview (section order + show-hide, persisted)
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/app/org/[slug]/page.tsx:107-231
- **Scenario**: A security-focused org wants gaps + standing at the top; a delivery-focused org cares most about trajectory + movers. Different leaders want a different "home".
- **Gap**: `OrgOverview` renders a **fixed** vertical stack (controls → PeriodSummary → tiles → Trajectory → Goals/Standing → Gaps → Posture/Dims → Trend → Movers → Leverage) with no reordering, collapsing, or per-viewer layout. Grep for `localStorage|defaultRange|savedRange|preferred` found no persisted dashboard/layout preference anywhere. The only persisted preference is the *active org* cookie.
- **Impact**: Power users and repeat viewers benefit; reduces scroll fatigue on a long page and lets each org tailor its standing view. A recognized "dashboard home" expectation vs competitor dashboards.
- **Fix sketch**: Wrap each section in a `<Collapsible>` keyed by a stable id; persist collapsed/order state in a cookie or `Organization`-scoped `OrgPreference` (server-readable so SSR matches). Start with collapse-only (no DnD) to keep it a server-component-friendly change. Medium effort.

## 5. Default time-range / "remember my period" preference
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/lib/window.ts:27 ; src/components/org/TimeRangeSelector.tsx:20
- **Scenario**: An org that runs on calendar quarters wants every visit to open on "This quarter" (or a saved custom range), not the hardcoded 90-day default — without re-selecting it each session.
- **Gap**: `DEFAULT_RANGE` is a hardcoded `"90d"` constant; `resolveWindow` falls back to it whenever `?range=` is absent. The range is shareable via URL but **not remembered** — landing on `/org/[slug]` with no query always resets to 90d. No cookie/pref persistence (confirmed by the `localStorage|defaultRange|savedRange|preferred` grep returning nothing).
- **Impact**: Small per-visit friction for every returning user; quarter-driven orgs especially. Pairs naturally with finding #4's preference store.
- **Fix sketch**: Persist the last-chosen `range`/`from`/`to` in a cookie when `TimeRangeSelector.navigate()` fires; have the page read it as the fallback before `DEFAULT_RANGE` when `?range=` is absent (keeps explicit URLs authoritative for sharing). Low-medium effort.

## 6. Goal-vs-actual headline on the overview tiles ("on track / behind target")
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/app/org/[slug]/page.tsx:137-161 ; src/components/org/GoalsOverview.tsx:10
- **Scenario**: A leader who set "AI Adoption 60 by December" wants the *headline maturity tiles* to show standing against that target at a glance — e.g. an "AI Adoption 52 · target 60 · behind" badge on the tile — not just inside a separate Goals card lower on the page.
- **Gap**: Goals exist as their own panel (`GoalsOverview` with per-goal progress/pace/ETA), and tiles show period-over-period deltas (`rollup.deltas`), but the two are **disconnected**: a `Tile`'s value/delta has no notion of the active goal for that metric, so the top-line numbers never say "vs target". The tile component (`ui.tsx` `Tile`) has no goal/target prop.
- **Impact**: Connects the org's stated objectives to its most-glanced numbers — the single most valuable "are we winning?" read for a leader. Low incremental cost since goals data is already fetched (`listGoals`) on the same page.
- **Fix sketch**: Match active goals by metric (overall/adoption/rigor) from the already-fetched `goals`, pass an optional `{ target, onTrack }` to `Tile`, and render a small "target N · on track/behind" line under the delta. No new query. Low effort.
