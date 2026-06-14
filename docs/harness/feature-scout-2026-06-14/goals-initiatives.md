# Feature Scout — Goals & Initiatives (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 3H / 2M / 0L

## 1. Goal at-risk alerts never reach a leader (the pace verdict is computed but never pushed)
- **Severity**: Critical
- **Category**: user_benefit
- **File**: src/lib/db/plan.ts:258-289 (pace/etaDate/requiredPerWeek computed); src/app/api/cron/digest/route.ts:75-94 (digest omits goals); src/lib/alerts.ts (no goal awareness)
- **Scenario**: A platform lead sets "AI Adoption 60 by December", then closes the tab. The fleet's adoption trend goes flat; the deadline silently slips. They only discover they're "Behind" the next time they happen to open `/org/[slug]/plan`.
- **Gap**: `listGoals` already produces a rich, leader-facing verdict — `pace: "behind"`, `requiredPerWeek`, `etaDate` past the deadline. Confirmed by grep: `alerts.ts` and the weekly `digest` cron have zero references to goals/`projectGoal`/`requiredPerWeek`. The single most actionable signal the Plan layer produces is trapped behind a manual page visit. There is no "goal slipped behind pace" alert anywhere, even though the regression-alert and Slack-webhook plumbing (`dispatchAlert`, `buildFleetDigestMessage`, per-org `alertWebhookUrl`) already exists.
- **Impact**: Every org owner who set a deadline. This is the difference between a tracker (passive) and a steering system (active). At-risk goals are exactly what a leader wants interrupted for — it converts "I forgot" into "I was warned with the weekly gain I still need".
- **Fix sketch**: In `cron/digest/route.ts`, add `listGoals(org)` to the per-org `Promise.all`; pass `goals.filter(g => g.pace === "behind")` into `buildFleetDigestMessage` and render a "Goals at risk" Block-Kit section ("AI Adoption: needs +1.5/wk, now +0.3/wk, past Dec 1"). Optionally a dedicated crossing alert when a goal first flips to `behind`. ~0.5 day (reuses all existing dispatch infra).

## 2. Initiatives have no owner, assignee, or due date — the weaker sibling of the recommendation backlog
- **Severity**: High
- **Category**: functionality
- **File**: prisma/schema.prisma:378-393 (Initiative model — no assignee/targetDate); src/components/org/plan/InitiativesPanel.tsx:90-100 (status dropdown only); src/lib/db/plan.ts:347-398
- **Scenario**: A leader tracks "Bring 8 repos up to D4 on Testing." Three weeks later: who's actually driving it? When is it due? The card answers neither — only a status dropdown and a "5/8 repos there" meter.
- **Gap**: The `Initiative` model has `status` only — no `assigneeLogin`, no `targetDate`, no activity timeline. Yet the sibling `Recommendation` model (schema.prisma:280-327) already carries `assigneeLogin` + `targetDate` + a full append-only `RecommendationEvent` audit, and an org-member picker exists (`src/lib/db/members.ts`, `/api/org/members`). Initiatives — the *bigger, org-level* unit of work — are strictly less accountable than the per-repo gaps they bundle.
- **Impact**: Org owners running multi-quarter programs. Ownership + a due date is the line between a tracker and a plan; it's what makes Linear/Jira trustworthy. Reuses proven schema + UI patterns already shipped one model over.
- **Fix sketch**: Add `assigneeLogin String?` + `targetDate DateTime?` to `Initiative` (migration), thread through `createInitiative`/`updateInitiative` in plan.ts, add an assignee `<select>` (fed by `/api/org/members`) and a date input to the initiative card, and pace it against the deadline the same way goals are. Optionally mirror `RecommendationEvent` for an initiative timeline. ~1.5 days.

## 3. `practiceId` link from initiative to the Practice Library is stored but never set or surfaced (dead wiring)
- **Severity**: High
- **Category**: feature
- **File**: src/components/org/plan/InitiativesPanel.tsx:43-47 (POST omits practiceId) & :79-105 (card never renders it); src/lib/db/plan.ts:329,363,390 (field round-trips); src/lib/db/org-insights.ts:751 (CommonGap already resolves a practiceId)
- **Scenario**: A dev opens an initiative "Raise Testing across the fleet" and wants the one-click "open a starter PR" path — the org already has a Practice Library that does exactly this (`/api/practices/apply` opens a draft PR via `openDraftPr`). The initiative card offers no link to it.
- **Gap**: `Initiative.practiceId` exists end-to-end (schema → `createInitiative` → `InitiativeRow.practiceId` → `InitiativeView`) but is **never populated and never rendered**. Grep confirms: the only writer is the API default (`practiceId ?? null`), the seed objects built in `plan/page.tsx:48-54` don't include it, `InitiativesPanel.track()` doesn't send it, and the card JSX never references `i.practiceId`. Meanwhile `getOrgGapAnalysis` (org-insights.ts:751) already maps each dimension gap to a `practiceId`, and `PracticeApply`/`/api/practices/apply` already turn a practiceId into a draft PR.
- **Impact**: This is the "doing the work updates the goal" loop, half-wired. Connecting it makes an initiative actionable — from "8 repos need Testing" straight to a draft PR per repo — instead of a passive scoreboard. Multiplies the value of three existing subsystems (initiatives, practices, draft-PR).
- **Fix sketch**: Resolve `practiceId` when seeding (use `PRACTICES.find(p => p.dimId === seed.dimId)?.id`, already the pattern in org-insights), send it in `track()`, and in the initiative card render a "Open starter PRs" action that links each laggard repo into the existing `/api/practices/apply` flow. ~1 day.

## 4. No goal achieved state or celebration — `status:"achieved"` is defined but never set
- **Severity**: Medium
- **Category**: user_benefit
- **File**: prisma/schema.prisma:367 (status: active | achieved | archived); src/lib/db/plan.ts:274-276 (`achieved` computed live, status untouched); src/components/org/GoalsOverview.tsx:11 (filters `!== "archived"` only)
- **Scenario**: An org hits its "Reach AI-Native by Q3" target. The meter turns green and the chip reads "Reached" — then nothing. No moment, no record that the goal was met by the deadline, no auto-archive. It lingers in the active list forever next to live goals.
- **Gap**: The schema reserves a `"achieved"` status, but grep confirms it's never written — `updateGoal` only sets status when the client sends one, and nothing flips it on crossing. `achieved` is recomputed live each read (plan.ts:275), so the persisted status stays `"active"` even after the target is met. There is no celebration, no "achieved on <date>", and `GoalsOverview` only hides `archived`, so met goals clutter the active set.
- **Impact**: Every org that hits a target. Closure + a visible win is the reward loop that makes people set the *next* goal — and an "achieved by deadline" record is the artifact a leader screenshots for a board update.
- **Fix sketch**: In `listGoals`, when `current >= target` and status is `active`, persist `status:"achieved"` (+ an `achievedAt` column) once; render an "Achieved 🎉 on <date>, <N> days early" state in `goalView.tsx`; auto-collapse achieved goals into a "Met" group. Optionally fire a positive digest line. ~0.5 day.

## 5. No goal templates / suggested goals — every org starts from a blank box
- **Severity**: Medium
- **Category**: feature
- **File**: src/components/org/plan/GoalsPanel.tsx:79-116 (raw create form); src/components/org/GoalsOverview.tsx:26-38 (empty state just links to a blank form)
- **Scenario**: A new admin lands on Plan with zero goals. They're shown "e.g. Reach AI-Native by Q3" as placeholder text, but must invent the metric, a realistic target, and a deadline cold — with no idea what's achievable given their current fleet score.
- **Gap**: There is no template/preset/suggested-goal concept anywhere in the plan components (grep for `template|preset|suggested.?goal` in `components/org/plan` → no files). The create form is a raw label + metric + target + date. Yet the page already computes the current fleet average per metric (`dimAvg` / `dimOptions` in plan/page.tsx:36-37) — the data needed to propose "Adoption is at 42; aim for 55 in 90 days" is right there, unused.
- **Impact**: New orgs and onboarding. One-click "set the recommended next goal" removes the blank-page paralysis and anchors targets to what's realistic for *this* fleet — driving goal adoption (you can't track pace on a goal nobody created).
- **Fix sketch**: Add a small `suggestedGoals(dimOptions, rollup)` helper that proposes 2-3 goals (e.g. weakest dimension +12 over 90 days; overall to next band boundary using `levelForScore`) and render them as one-click "Add this goal" chips above the form. Pure client-side; reuses data already passed to `GoalsPanel`. ~0.5 day.

## 6. Goals and initiatives are disconnected — completing an initiative doesn't visibly move its goal
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/db/plan.ts:218-240 (createGoal — no link field) & :347-370 (createInitiative — no goalId); prisma/schema.prisma:360-393 (Goal and Initiative share only orgId); src/app/org/[slug]/plan/page.tsx:68-73 (panels rendered side-by-side, never cross-referenced)
- **Scenario**: A leader sets goal "Testing (D3) to 60 by Q3" and tracks an initiative "Raise D3 across 8 repos." These are obviously the same effort — but the product treats them as unrelated. The goal can't show "1 initiative driving this," and finishing the initiative gives no narrative of why the goal moved.
- **Gap**: No foreign key or reference ties an `Initiative` to a `Goal` (both only share `orgId`; grep shows `Initiative` has `dimId`/`targetScore` but no `goalId`, and `Goal` has no initiative relation). The Plan page renders `GoalsPanel` and `InitiativesPanel` as independent cards. The goal's "Must move" laggard list (goalView.tsx:130-159) and an initiative's scoped repos frequently target the *same dimension and repos*, yet nothing connects "this is the work for that target."
- **Impact**: Org owners steering a program. Linking work→target is the core promise of a "Plan" layer: a goal becomes "62% there, 2 initiatives driving it (1 done, 1 in progress)" instead of a lonely number. It turns the page from two lists into one coherent plan.
- **Fix sketch**: Add optional `goalId String?` to `Initiative` (migration); on the initiative card add a "Link to goal" picker (goals are already loaded on the page); on the `GoalCard`, render the initiatives attached to it with their progress. Auto-suggest the link when an initiative's `dimId` matches a goal's dimension `metric`. ~1.5 days (schema + both panels).
