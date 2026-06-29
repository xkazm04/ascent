# Biz+Bug Scan — Org Planning & Execution — ascent — 2026-06-29

> Combined business-visionary + bug-hunter scan over 6 contexts.
> Total: 30 findings — Critical: 0, High: 6, Medium: 16, Low: 8  (bug: 16, business: 14)

---

## Executive Briefing

### 1. White-label PDF branding survives a plan downgrade
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/app/api/org/briefing/pdf/route.ts:46
- **Scenario**: The exec page gates *editing* branding with `planAllowsWhiteLabel(credit?.plan)` (page.tsx:54), but the PDF route applies `getOrgBranding(org)` unconditionally. An enterprise org sets a logo + brand color, downgrades to a cheaper plan, and its exported PDFs stay fully white-labeled forever.
- **Root cause / Rationale**: White-label is a paid feature, but the only plan check is at the editing UI; persisted branding is never re-checked at render time, so the value leaks across the downgrade path.
- **Impact**: Revenue leak — paid differentiation given away to lower tiers; removes a concrete upgrade incentive.
- **Fix sketch**: In the PDF route, pass branding only when `planAllowsWhiteLabel((await getCreditState(org))?.plan)`; otherwise render unbranded.

### 2. Share tokens have no per-link revocation
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / security
- **File**: src/lib/briefing-share.ts:38
- **Scenario**: A minted briefing link is valid 14 days. If it leaks (forwarded email, shoulder-surf), the only way to kill it is rotating `BRIEFING_SHARE_SECRET` — and when the fallback `AUTH_SECRET` is the signer, that simultaneously invalidates every user session AND every other share link.
- **Root cause / Rationale**: The token *is* the capability with no server-side allowlist/jti, so revocation is all-or-nothing and coupled to the auth secret.
- **Impact**: A leaked board briefing (maturity + security posture) can't be contained without an org-wide logout; an owner who leaves keeps working links for 14 days.
- **Fix sketch**: Add a per-org `shareTokenEpoch` (or a revoked-jti table) checked in `verifyBriefingShareToken`; bump it to revoke without touching `AUTH_SECRET`.

### 3. Shared link re-runs LIVE, not a snapshot
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: data-exposure
- **File**: src/app/share/briefing/[token]/page.tsx:44
- **Scenario**: The shared page re-runs `buildExecBriefing` on every visit, so an open-ended window (all-time / a `to`-less range) keeps showing the newest scans for the full 14 days. An owner who shares "this quarter's standing" doesn't realize the recipient sees live-updating numbers (including newly scanned private repos) until expiry.
- **Root cause / Rationale**: The token carries the window but not a frozen snapshot; data inside the window mutates as scans land.
- **Impact**: Unexpected continued exposure of fleet data to an unauthenticated holder.
- **Fix sketch**: Either snapshot the briefing at mint time, or clamp shared windows to a closed `[from,to]` and label the link "as of <date>".

### 4. No view receipts / analytics on shared briefings
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: retention
- **File**: src/components/org/BriefingShareButton.tsx:29
- **Scenario**: An owner shares a board link but has zero signal on whether leadership opened it, how often, or which sections — the classic "did anyone read my report?" gap.
- **Root cause / Rationale**: Share is fire-and-forget; no open/view event is recorded.
- **Impact**: Misses a high-intent engagement signal (an opened exec briefing = a renewal/expansion moment) and a "your board viewed this 4× this week" hook.
- **Fix sketch**: Record an opened-event on `/share/briefing/[token]` load (org + token id), surface a small "viewed N times" badge to the owner, and trigger a sales/CS signal on first board open.

### 5. Scheduled exec email digest is referenced but unbuilt
- **Severity**: High
- **Lens**: business-visionary
- **Category**: activation / retention
- **File**: src/lib/org/briefing.ts:4
- **Scenario**: The module header literally says it "Powers /org/[slug]/executive and (Phase 5.2) the scheduled PDF digest," but no scheduler exists. Leaders must remember to visit the tab; most won't, and the product goes silent between scans.
- **Root cause / Rationale**: The briefing assembly + PDF render + SES email are all already present — only the cron + opt-in are missing.
- **Impact**: A weekly/monthly auto-emailed exec briefing is the single strongest re-engagement loop for a sleepy fleet dashboard; its absence caps activation and renewal narrative.
- **Fix sketch**: Add an org setting (cadence + recipients) and a cron route that calls `buildExecBriefing` → `BriefingDocument` → SES, reusing the exact PDF path.

---

## Live War Room

### 1. Fleet adoption/rigor averages divide by the wrong denominator
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/components/org/liveWarRoomFold.ts:95
- **Scenario**: `computeStats` filters `s = repos with overall != null`, then computes `avgAdoption = Σ(r.adoption ?? 0) / s.length`. A repo with `overall` set but `adoption` null (the SSE fold allows this via `finiteOrNull(d.adoption)`) contributes 0 to the sum yet still counts in the denominator, dragging the headline "AI Adoption" tile down on the projected wall.
- **Root cause / Rationale**: Denominator is the overall-scored count, not the adoption-present count.
- **Impact**: Understated, wrong adoption/rigor numbers on a wall meant to be projected in a review.
- **Fix sketch**: Average each axis over `s.filter(r => r.adoption != null)` (its own count), like the orgsim renormalization does.

### 2. Auto-loop silently burns prepaid scan credits with no cap
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: latent-failure / cost
- **File**: src/components/org/LiveWarRoom.tsx:266
- **Scenario**: With "auto-relaunch" on, a full-fleet scan fires every 15 min as long as the tab is foregrounded. A war-room TV left on a desk (tab visible, nobody watching) keeps scanning the entire fleet indefinitely, draining prepaid credits.
- **Root cause / Rationale**: The only guard is page-visibility; there is no idle cap, no max-runs, and no owner alert.
- **Impact**: Runaway metered cost / credit exhaustion that surfaces only on the bill.
- **Fix sketch**: Cap auto-loop to N consecutive unattended cycles, require periodic interaction to keep looping, or warn/disable when prepaid balance drops below a threshold.

### 3. Public/embeddable leaderboard + maturity badges
- **Severity**: High
- **Lens**: business-visionary
- **Category**: growth / virality
- **File**: src/components/org/LiveWarRoomLeaderboard.tsx:1
- **Scenario**: The leaderboard + AI-Native celebrations are pure dopamine but locked to an authed wall. Engineers love a badge; OpenSSF Scorecard's README badge is a proven adoption loop ascent currently lacks.
- **Root cause / Rationale**: The ranking/posture data already exists; only an embeddable surface is missing.
- **Impact**: Per-repo README "AI-Native maturity" badges + an opt-in org leaderboard drive inbound virality and team-vs-team competition — top-of-funnel growth.
- **Fix sketch**: Ship a signed `/badge/[repo].svg` (cache-controlled) and an opt-in public leaderboard page reusing `computeLeaderboard`.

### 4. War room as a gated "presentation/review" premium surface
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/app/org/[slug]/live/page.tsx:1
- **Scenario**: The kiosk/TV war room is a high-perceived-value "exec theater" feature given to everyone. Teams running quarterly fleet reviews would pay for it plus scheduled, branded "fleet review" share links.
- **Root cause / Rationale**: No tier gating on a clearly enterprise-flavored capability.
- **Impact**: Direct upsell lever (team/enterprise) with low marginal cost.
- **Fix sketch**: Gate `liveShareEnabled` minting + auto-loop behind a plan flag; bundle with white-label.

### 5. Milestone events to Slack/Teams
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: re-engagement
- **File**: src/components/org/liveWarRoomFold.ts:88
- **Scenario**: A repo crossing into AI-Native fires a celebration only on-screen; nobody not watching the wall ever learns. Engineering orgs live in Slack/Teams.
- **Root cause / Rationale**: The crossing is already detected (`celebration`), just not routed anywhere durable.
- **Impact**: "repo X just reached AI-Native 🎉" posts create organic re-engagement + social proof inside the customer.
- **Fix sketch**: Reuse the existing alert-webhook validator to POST milestone crossings to an org-configured Slack/Teams incoming webhook.

---

## Investment Simulator & Forecast

### 1. Exec briefing renders "100% trend confidence" on a 2-point fit
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / success-theater
- **File**: src/lib/org/briefing.ts:237
- **Scenario**: `forecast.ts:60` explicitly warns that with `< 3` distinct days OLS fits perfectly (`fitQuality = 1`) and consumers "must not render fitQuality as a hard confidence %" — they must surface `lowData`. But `buildExecBriefing` maps `forecastConfidence = round(fitQuality*100)` and drops `lowData`; the exec page (executive/page.tsx:153) prints "trend confidence 100%" with only a `< 50` "noisy" caveat. A repo scanned twice yields a board-facing PDF claiming 100% confidence in a trajectory.
- **Root cause / Rationale**: The `lowData` flag is discarded at the briefing assembly boundary, defeating the forecast module's own guardrail.
- **Impact**: Overconfident, misleading trajectory shown to leadership in the durable PDF and on-screen.
- **Fix sketch**: Carry `lowData` into `ExecBriefing`; when set, suppress the % and render "early signal — not enough history."

### 2. "Track as initiative" silently drops the extra dimensions
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: data-loss
- **File**: src/components/org/plan/Simulator.tsx:141
- **Scenario**: A user models a multi-leg scenario ("raise D2→70 AND D3→60", via `extras`), sees the combined projection, then clicks "Track as initiative." `trackAsInitiative` posts only the primary `{ dimId, targetScore: target }` — the `extras` legs are discarded, so the tracked initiative represents a different (smaller) scenario than the one simulated.
- **Root cause / Rationale**: The initiative payload was written for the single-leg case and never updated for SIM-2 multi-dim.
- **Impact**: The plan-of-record diverges from the analysis that justified it; the dropped dimension is silently lost.
- **Fix sketch**: Either disable "Track as initiative" when `extras.length > 0`, or extend the initiative model/route to accept multiple `{dimId,target}` legs and post all of them.

### 3. Rank mode silently substitutes target 70 when the typed target is out of range
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/app/api/org/simulate/route.ts:36
- **Scenario**: Type `150` into the target box and click "Suggest (→ 150)": the rank route clamps an out-of-range target to a silent fallback of 70, so the ranking is computed at 70 while the button label and the user's mental model say 150.
- **Root cause / Rationale**: Defensive fallback instead of a 400, with no echo of the effective target back to the client.
- **Impact**: Misleading ROI ranking; user acts on numbers for a target they didn't ask for.
- **Fix sketch**: Return 400 on an out-of-range rank target (as the fixes path does), or return the effective `target` and render it.

### 4. Gate the planning suite as a premium tier
- **Severity**: High
- **Lens**: business-visionary
- **Category**: monetization / differentiation
- **File**: src/components/org/plan/Simulator.tsx:35
- **Scenario**: Fleet what-if simulation + ROI ranking ("where should we invest?") + one-click "track as initiative" is exactly the management-layer planning Snyk/SonarCloud/Scorecard don't offer — yet it's ungated.
- **Root cause / Rationale**: High-value, clearly buyer-persona (eng leadership) capability with no tier.
- **Impact**: A natural "Plan/Enterprise" upsell anchored on ROI modeling and differentiation.
- **Fix sketch**: Put simulate/rank/initiatives behind a plan flag with a teaser preview for lower tiers.

### 5. Saved scenarios are client-only and unshareable
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: retention / differentiation
- **File**: src/components/org/plan/Simulator.tsx:52
- **Scenario**: The SIM-5 save/compare scratchpad lives in component state — a refresh wipes it, and a leader can't share "Plan A vs Plan B" with the team or a board.
- **Root cause / Rationale**: No persistence/sharing layer for scenarios.
- **Impact**: Loses the collaborative "investment options memo" workflow that makes the simulator sticky.
- **Fix sketch**: Persist scenarios per org and add a read-only share link (mirror briefing-share), turning a what-if into a board artifact.

---

## Playbooks

### 1. Playbook PR branch/path collide on slug
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/app/api/org/playbooks/[id]/apply/route.ts:75
- **Scenario**: Both the branch (`ascent/playbook-${slug(title)}`) and the file path (`docs/playbooks/${slug(title)}.md`) are derived from the title slug only. Two distinct playbooks whose titles slugify identically ("CI/CD!" and "CI CD" → `ci-cd`) collide; opening the second reuses/overwrites the first's branch + doc.
- **Root cause / Rationale**: Slug derived from non-unique title instead of the unique playbook id.
- **Impact**: One playbook's rollout PR silently clobbers another's; adoption marks attach to the wrong artifact.
- **Fix sketch**: Include the playbook id in the branch and filename (`...-${id.slice(0,8)}`).

### 2. Optimistic adoption can seed an initiative the DB never recorded
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/components/org/PlaybookCard.tsx:56
- **Scenario**: `apply()` optimistically adds a repo to `applied` before the POST resolves; `trackAsInitiative()` reads that same optimistic `applied`. Click "Mark applied" then immediately "Track as initiative" and, if the mark POST is still in flight or 4xx-rolls-back, the initiative is created scoped to a repo the server never recorded as adopted.
- **Root cause / Rationale**: Two actions share optimistic state with no in-flight guard.
- **Impact**: Initiative scope diverges from persisted adoption; skewed rollout tracking.
- **Fix sketch**: Disable "Track as initiative" while any mark is pending, or scope it from the server-confirmed `adoption.appliedRepos`.

### 3. Playbook "lift" attributes all dimension change to the playbook
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: success-theater
- **File**: src/lib/db/playbooks.ts:233
- **Scenario**: `getPlaybookAdoption` computes lift as `current − score-at-apply` for the playbook's dimension and the card renders "▲ +X avg D2 since." Any unrelated improvement to that dimension after the apply date is credited to the playbook, manufacturing ROI.
- **Root cause / Rationale**: Correlation (after apply) is presented as causation (because of the playbook).
- **Impact**: Inflated, misleading ROI that erodes trust when scrutinized.
- **Fix sketch**: Label it "change since adoption (not necessarily caused by it)," or compare adopters vs a non-adopter baseline for the same dimension/period.

### 4. Cross-org playbook marketplace / curated standards library
- **Severity**: High
- **Lens**: business-visionary
- **Category**: differentiation / growth
- **File**: src/lib/org/playbook-templates.ts:15
- **Scenario**: Templates today are derived from the local PRACTICES rubric. A curated, shareable library of industry playbooks (OpenSSF, SLSA, SOC2-readiness, AI-adoption) — and the ability for orgs to publish/clone each other's — is a wedge no scanner-competitor has.
- **Root cause / Rationale**: The playbook model + apply-as-PR delivery already exist; only a shared catalog is missing.
- **Impact**: Differentiation + a content-driven growth loop (and a place to feature partners).
- **Fix sketch**: Add a read-only catalog of vetted playbooks with one-click "clone into my org," reusing `createPlaybook`.

### 5. Meter PR rollouts + surface aggregate playbook ROI
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: monetization / retention
- **File**: src/app/api/org/playbooks/[id]/apply/route.ts:71
- **Scenario**: Opening draft PRs across a fleet is real change-delivery (write access, GitHub App) given away unmetered; meanwhile the renewal-grade story "playbooks drove +N maturity across M repos" is computed per-card but never aggregated.
- **Root cause / Rationale**: No billable event on rollout; no org-level lift rollup.
- **Impact**: Leaves a metering lever and a quantified-value renewal narrative on the table.
- **Fix sketch**: Count playbook PR-opens as a metered action and add an org "playbook impact" rollup (total adopters, aggregate lift) to the exec briefing.

---

## Backlog Management

### 1. Inline edit controls snap back to the old value mid-save
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: UX-degradation
- **File**: src/components/org/BacklogItemRow.tsx:139
- **Scenario**: The status/owner/due `<select>`/`<input>` are controlled by `item.*` (server state) with no optimistic update. On a slow PATCH the control visually reverts to the previous value (and disables) until `patch()` → `refresh()` completes, then jumps to the new value — reading as "my change failed" before it succeeds.
- **Root cause / Rationale**: Controlled inputs bound to server state that only updates after a full backlog re-read.
- **Impact**: Confusing flicker on every edit; users re-click thinking it failed, risking double edits.
- **Fix sketch**: Apply an optimistic local override for the edited field until the refresh confirms (and revert on error).

### 2. Opening a PR only advances status from "open"
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/components/org/BacklogItemRow.tsx:76
- **Scenario**: `openDraftPr` flips the item to in_progress only `if (item.status === "open")`. Open a draft PR on an item already marked "dismissed" or "done" and the board shows a closed item with a live PR — an inconsistent state nobody reconciles.
- **Root cause / Rationale**: The guard assumes PRs are only opened on open items.
- **Impact**: Backlog status misrepresents reality; the PR is orphaned from the board view.
- **Fix sketch**: Always move to in_progress on a successful PR open (or surface a confirm when re-opening work on a closed item).

### 3. Promote-to-initiative has no duplicate guard across sessions
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: latent-failure
- **File**: src/components/org/BacklogItemRow.tsx:33
- **Scenario**: "Promote to initiative" POSTs a new initiative and disables only the local `promoted` flag. Reload the page (or use another tab) and promote the same gap again — a second identical initiative is created with no server-side de-dupe.
- **Root cause / Rationale**: Idempotency lives only in transient component state.
- **Impact**: Duplicate initiatives clutter the plan and double-count work.
- **Fix sketch**: De-dupe server-side on (org, dimId, repo, source rec id), or mark the recommendation as promoted and reflect it on load.

### 4. Two-way sync with GitHub Issues / Jira
- **Severity**: High
- **Lens**: business-visionary
- **Category**: integration / differentiation
- **File**: src/app/api/org/backlog/route.ts:1
- **Scenario**: The backlog is a capable board (owner, due date, status, history) but an island — teams won't abandon Jira/GitHub Issues to babysit a second tracker.
- **Root cause / Rationale**: No export/sync to where the work actually lives.
- **Impact**: Backlog items pushed as GitHub Issues / Jira tickets (with status mirrored back) makes ascent the *source* of the maturity roadmap instead of a parallel todo list — major stickiness.
- **Fix sketch**: Add "Create GitHub Issue" per item (reusing the App token) with a stored issue link and a webhook to mirror closes back to status.

### 5. Overdue-item nudges via email/Slack
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: re-engagement
- **File**: src/components/org/backlogShared.ts:32
- **Scenario**: The backlog already computes `overdue`/`dueInDays` but nothing acts on it; an overdue gap just sits there until someone visits the tab.
- **Root cause / Rationale**: Due-date intelligence is display-only.
- **Impact**: Automated "you have 3 overdue maturity items" digests (SES is already in the stack) turn a passive board into an accountability loop that pulls owners back in.
- **Fix sketch**: A daily cron that emails each assignee their overdue/ due-soon items, opt-in per org.

---

## Goals & Initiatives

### 1. Deleting a goal ignores the server response (data-loss illusion)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/components/org/plan/GoalsPanel.tsx:73
- **Scenario**: `remove()` optimistically drops the goal from the list, then `await fetch(... DELETE)` without checking `res.ok` or catching network errors. On a 4xx/5xx/offline, the goal vanishes from the UI but survives in the DB and reappears on the next load — the exact bug the sibling `PlaybooksPanel.remove` (PlaybooksPanel.tsx:68-80) was already fixed for with snapshot+restore.
- **Root cause / Rationale**: The fix applied to playbooks was never ported to goals.
- **Impact**: Confusing "it deleted then came back" behavior; user can't tell the delete failed.
- **Fix sketch**: Mirror the playbooks pattern — snapshot, optimistic remove, and on `!res?.ok` restore + surface the error.

### 2. Goal `target` is not range-validated
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: input-validation
- **File**: src/app/api/org/goals/route.ts:25
- **Scenario**: The create route only checks `typeof body.target === "number"`. POST `target: 1000` (or `-5`) and it's accepted, producing meters past 100%, a permanently "Behind" pace, and fantasy ETAs. The simulate route validates `0..100` but goals don't — inconsistent trust boundaries.
- **Root cause / Rationale**: Missing bounds check on a metric that is always 0..100.
- **Impact**: Corrupt/absurd goal state that the pace/forecast UI then renders as if real.
- **Fix sketch**: Reject (400) unless `Number.isFinite(target) && target >= 0 && target <= 100` in both POST and the `[id]` PATCH.

### 3. Initiative `repos[]` accept arbitrary, untenanted repo names
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: input-validation
- **File**: src/app/api/org/initiatives/route.ts:48
- **Scenario**: Create/PATCH stores `repos.filter(typeof string)` with no check that each fullName belongs to the org — unlike the playbook routes which require `parsed.owner === org` (playbooks/[id]/repos/route.ts:27). A typo'd or foreign `other-org/private` name flows into initiative scope and goal-laggard matching.
- **Root cause / Rationale**: The repo-coordinate tenant gate added to playbooks wasn't applied to initiatives.
- **Impact**: Garbage/foreign repo names pollute initiative scope and downstream progress matching.
- **Fix sketch**: Validate each repo with `parseRepoUrl` + owner === org (or intersect against the org's known repos) before persisting.

### 4. Goal-pace digests to Slack/email
- **Severity**: High
- **Lens**: business-visionary
- **Category**: re-engagement / accountability
- **File**: src/components/org/plan/goalView.tsx:61
- **Scenario**: The `readout()` already produces leader-grade lines ("Behind — at +1/wk, needs +3/wk to hit 70 by 2026-09-01") but they only exist when someone opens the Plan tab. Most goals quietly drift.
- **Root cause / Rationale**: Pace verdicts are computed but never pushed.
- **Impact**: A weekly "your goals: 1 on-pace, 2 behind" digest (with the required-rate ask) is a powerful accountability + re-engagement loop and a renewal-justifying artifact.
- **Fix sketch**: Cron that runs `projectGoal` per active goal and emails/Slacks pace changes (especially on-pace→behind transitions).

### 5. Package the Plan tab as enterprise "OKRs for engineering maturity"
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/app/org/[slug]/plan/page.tsx:24
- **Scenario**: Goals + simulator + initiatives + the calibration backlog together form an OKR-style planning layer aimed squarely at eng leadership, but it's bundled into the base product with no upsell framing.
- **Root cause / Rationale**: Differentiated, buyer-persona capability with no tier or narrative.
- **Impact**: Clear "Plan/Enterprise" monetization anchor that scanner-only competitors can't match.
- **Fix sketch**: Gate the Plan suite behind a plan flag with a teaser, and lead enterprise messaging with "set maturity OKRs and track them."
