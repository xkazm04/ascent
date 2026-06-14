# Feature Scout — Backlog Management (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 3H / 1M / 1L

## 1. Act on a backlog item — open a draft PR straight from the row
- **Severity**: Critical
- **Category**: functionality
- **File**: src/components/org/BacklogItemRow.tsx:128 (row actions) · src/lib/github/write.ts:70 (`openDraftPr`, already built) · src/app/api/practices/apply/route.ts:59 (proven pattern)
- **Scenario**: A leader triages the backlog, finds a high-ROI gap ("+8 pts · unlocks L3"), assigns an owner and a due date — then has to leave Ascent, open the repo, and hand-write the fix. The backlog tells you *what* to do but gives you no way to *start doing it*.
- **Gap**: The backlog is read-only-plus-metadata: status / owner / due / history. There is NO action that turns an item into work. Confirmed: `grep -i "draft.?pr|createPullRequest|apply.?fix"` over `src/` matches only `practices/apply` and `github/write.ts` — never the backlog. Yet `openDraftPr()` (branch → file → draft PR, idempotent, installation-token-gated, audit-logged) is fully built and wired for the Practice Library. The backlog item is the *more* natural trigger: it is already a concrete, per-repo, dimension-tagged gap.
- **Impact**: Closes the loop from "ranked gap" to "PR in review" — the single biggest value multiplier for the whole product. Every assigned item becomes a one-click starting point; the engine-true ROI chip becomes a *reason to click*, not just a number. Differentiates Ascent from a static scorecard/dashboard.
- **Fix sketch**: Add an "Open draft PR" button to `ItemRow` for items whose `dimId` maps to a known practice (reuse `PRACTICES.find(p => p.dimId === ...)`). POST to a new `/api/backlog/[id]/draft-pr` that resolves the rec's repo + dim, calls `buildArtifact` + `openDraftPr` (the exact `practices/apply` body), records a `target_date`-style RecommendationEvent ("PR #N opened") so it shows in history, and flips status to `in_progress`. ~1 day; ~80% is reuse of `practices/apply`.

## 2. Promote a backlog item into a tracked Initiative
- **Severity**: High
- **Category**: feature
- **File**: src/components/org/BacklogItemRow.tsx:79 (row controls) · src/lib/db/plan.ts:347 (`createInitiative`) · src/components/org/plan/InitiativesPanel.tsx:39 (`track`)
- **Scenario**: The same gap ("Add CI gating", D-rigor) shows up as a backlog row on repo A, B, and C. A manager wants to manage them as one *program* with a target score and progress — exactly what an Initiative is — but the only way to create an Initiative is from the deduped fleet-moves seeds on the Plan page.
- **Gap**: Backlog items and Initiatives live in parallel with no bridge. Confirmed: `createInitiative` is only called from `InitiativesPanel.track()`, seeded by `getOrgRecommendations` (deduped `OrgRec`), never from a `BacklogItem`. The backlog — which has the *real* per-repo rows and their owners — can't roll several rows up into one initiative, and an initiative can't see which backlog rows belong to it.
- **Impact**: Connects the two planning surfaces leaders bounce between (Backlog = per-repo accountability, Plan/Initiatives = program rollups). One menu action ("Track as initiative") turns ad-hoc triage into a managed program with target-progress, multiplying the value of both pages.
- **Fix sketch**: Add a "Promote to initiative" action (single row, or multi-select — see #4) that POSTs to `/api/org/initiatives` with `{ title, dimId, repos: [the rec's repos] }` (the body `InitiativesPanel.track` already sends). Optionally persist a `initiativeId` FK on `Recommendation` so `getOrgBacklog` can show an "in <initiative>" badge and `listInitiatives` can list member rows. ~1 day without the FK, ~2 with.

## 3. Export the backlog to GitHub Issues / CSV
- **Severity**: High
- **Category**: user_benefit
- **File**: src/app/api/org/backlog/route.ts:12 (GET only) · src/lib/github/write.ts:1 (App write surface exists) · src/components/org/BacklogPanel.tsx:113 (toolbar)
- **Scenario**: Teams that don't live in Ascent want the backlog *where they work* — as GitHub Issues on each repo, or a CSV they paste into Jira/Linear/a board review. Today the ranked, ROI-tagged backlog is trapped behind a login.
- **Gap**: No export of any kind. Confirmed: `grep -i "text/csv|Content-Disposition|github.*issue|/issues"` — CSV exporters exist for history/usage/report-pdf but NOT for the backlog, and there is zero GitHub *Issues* integration anywhere (the only GitHub write is `openDraftPr` for file/PR contents). The org has an installation token with the scopes; creating issues is one more API call.
- **Impact**: Meets users in their existing tooling, the table-stakes expectation competitors (Jira/Linear/board exports) set. CSV is an afternoon; GitHub Issues turns Ascent's prioritization into their team's actual sprint backlog — a strong adoption hook.
- **Fix sketch**: (a) CSV: a `GET /api/org/backlog/export?org=…&format=csv` that flattens `OrgBacklog.byOwner` to rows (repo, title, dim, impact, effort, projectedPoints, owner, due, status) with `Content-Disposition: attachment`; add a "Download CSV" button to the panel toolbar. (b) Issues: a `POST /api/org/backlog/[id]/issue` using `githubAppFetch('/repos/{o}/{r}/issues', …)` with the rec's title/rationale, store the issue number on the event timeline. ~half day CSV, ~1 day Issues.

## 4. Filtering, full-text search, and bulk actions
- **Severity**: High
- **Category**: functionality
- **File**: src/components/org/BacklogPanel.tsx:17 (only `view` state) · src/components/org/BacklogItemRow.tsx:79 (per-row only)
- **Scenario**: A 40-repo org has 150 active items. A leader wants "show me only overdue D-rigor items owned by nobody" and then "set them all to due-next-Friday" or "assign them all to @alice" in one go. Today they scroll three grouping views and edit one `<select>` at a time.
- **Gap**: Confirmed via grep of `BacklogPanel.tsx`: the only interactivity is the owner/due/points group toggle — no text search, no filter by dimension / impact / status / overdue, and no multi-select (no checkbox/`selectedIds`/bulk state anywhere in `src/components/org`). The summary strip surfaces counts (overdue, unassigned, due-soon) but clicking them does nothing — they beg to be filters. Every edit is a per-row PATCH + full refetch.
- **Impact**: At fleet scale the backlog is unusable without these. Power-user productivity: clickable summary chips → instant filters, plus bulk re-assign/re-date/triage that collapses 30 clicks into one. Directly multiplies the value of the assignment layer that already exists.
- **Fix sketch**: Client-side `filters` state (text, dim, impact, status, overdue/unassigned toggles) over the already-loaded `byOwner`/`byDue` arrays — no API change needed for filtering. Make `SummaryStrip` stats clickable to set filters. For bulk: add row checkboxes + a sticky action bar; either fan out existing per-id PATCHes or add a small `PATCH /api/org/backlog/bulk { ids[], patch }`. ~1–2 days.

## 5. Overdue / accountability digest (extend the weekly fleet push)
- **Severity**: Medium
- **Category**: feature
- **File**: src/app/api/cron/digest/route.ts:75 (`buildFleetDigestMessage`) · src/lib/db/org-insights.ts:316 (`getOrgBacklog` already computes `overdue`/`unassigned`/per-owner)
- **Scenario**: An owner assigns items with due dates, then nobody looks again until a board review. Overdue work rots silently. A weekly "you have 4 overdue items; @bob owns 3" Slack nudge would keep the backlog honest without anyone opening the app.
- **Gap**: The weekly digest cron exists and is per-tenant Slack-routed, but it only carries rollup + movers + the single top *fleet* recommendation. Confirmed: `getOrgBacklog` is never imported by the digest route, and `grep -i "overdue|reminder|nudge"` over `src/app/api` finds no backlog/accountability notification. The data (`overdue`, `dueSoon`, `unassigned`, per-owner `overdue`) is already computed and thrown away.
- **Impact**: Turns the backlog from a page you must remember to visit into a system that chases its own deadlines — the difference between a tool and a habit. Reuses the entire alert/Slack pipeline.
- **Fix sketch**: In the digest loop, call `getOrgBacklog(org)` and add a "Backlog" block to `buildFleetDigestMessage`: `${overdue} overdue · ${unassigned} unassigned`, plus the top 2 owners by overdue count, deep-linking `/org/{slug}/backlog`. ~half day.

## 6. Surface each item's rationale + "explore" prompts inline
- **Severity**: Low
- **Category**: user_benefit
- **File**: src/components/org/BacklogItemRow.tsx:53 (title only) · prisma/schema.prisma:287 (`rationale`, `explore`) · src/components/report/RecommendationTracker.tsx:178 (where they ARE shown)
- **Scenario**: A new owner is assigned a terse item ("Add dependency pinning") and asks "why does this matter / where do I start?" The answer already exists on the recommendation — they just can't see it on the backlog.
- **Gap**: `Recommendation` carries `rationale` and `explore` (JSON of guiding questions), rendered on the per-repo report's `RecommendationTracker` (lines 178–179). The backlog's `BacklogItem` type (`org-insights.ts:244`) doesn't even select those columns, so the row can only show title/dim/impact/effort. Confirmed: no `rationale`/`explore` reference in `BacklogItemRow.tsx` or `backlogShared.ts`.
- **Impact**: Gives the assigned owner the "why + how to start" without a round-trip to the report — reduces the friction of acting on an assignment, a quiet but real workflow win that complements #1.
- **Fix sketch**: Add `rationale` + `explore` to the `getOrgBacklog` rec `select` and the `BacklogItem` type, then reveal them in the existing expandable area of `ItemRow` (alongside History, or a "Why" disclosure). Reuse the report's `ExploreList`. ~half day.
