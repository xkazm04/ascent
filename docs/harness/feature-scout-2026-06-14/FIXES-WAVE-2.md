# Feature Scout Fix Wave 2 — Expose dormant backends

> 4 commits, 6 of 6 planned findings closed (MEM-2 + ALRT-3 deferred as migration-only — see below).
> Branch: `vibeman/feature-scout-wave2` (stacked on Wave 1).
> Baseline preserved: `tsc` 0 errors → 0; **vitest 450/450 → 450/450**; eslint 0 errors; `next build` ✓.

One mental model: **ascent shipped fully-tested backends (RBAC, alert routing, segment-scoped
scan/cadence, bulk watch) with no UI — reachable only by curl.** Each fix is "add the control
surface to a finished backend"; the only new server code is two thin additions (members `DELETE`,
watch `repos[]`) that need no schema change.

## Commits

| # | Commit | Findings | Sev | What shipped |
|---|---|---|---|---|
| 1 | `5140471` | MEM-1, MEM-3, MEM-4 | C+H+H | Members tab (page + MembersPanel + nav), inline role change, Remove (DELETE + last-owner guard), audited role changes; `authz.hasOrgRole`, `db.removeMembership` |
| 2 | `db681d5` | ALRT-1 | C | Admin-only Alerts chip/popover in the org header: set/clear webhook + "Send test" (POST `{test:true}` dispatches a sample) |
| 3 | `b8d0d9a` | SEG-1 | C | Per-segment cadence `<select>` + "Scan segment" button on each segment card (SegmentActions), inverting `getRepoSegmentMap` to scope each slice |
| 4 | `bf04772` | CONN-1 | C | "Watch all (N filtered)" + "Schedule watched" on Connect; `/api/org/watch` extended with a `repos[]` bulk path |

## What was fixed

1. **MEM-1/3/4 — Member management is usable.** New owner-gated `/org/[slug]/members` page +
   `MembersPanel` (table of login/name/role/joined, inline optimistic role change, Remove). Backend:
   `removeMembership()` with a **last-owner guard** (an org can't be orphaned) behind a new
   `DELETE /api/org/members`, and **every role change / removal now audits** (`org.member.role` /
   `.removed`) — the most security-sensitive action previously left no trail while setting a webhook
   did. Added `authz.hasOrgRole()` (boolean `requireOrgRole` for server pages). "Members" tab in OrgNav.
2. **ALRT-1 — Alert routing is configurable in-app.** Admin-only `AlertsControl` chip/popover in the
   org header (non-public orgs): set/clear the Slack-compatible webhook (the org's regression /
   low-credit / weekly-digest sink) and a **"Send test"** that POSTs a sample `AlertMessage` to the
   resolved sink so delivery is confirmable immediately. Non-admins see an "admins only" note (GET 403s).
3. **SEG-1 — Segment-scoped scan & cadence have a UI.** Each segment card gained `SegmentActions`: a
   cadence `<select>` that POSTs `{org, segmentId, schedule}` (the dormant `setWatchedSchedule` +
   `segmentScope`), and a "Scan segment" button that scans the slice's watched repos via
   `/api/org/scan {repos}` with SSE progress (reusing the OrgScanButton pattern). The page inverts
   `getRepoSegmentMap` into segment→repos to scope each card.
4. **CONN-1 — Bulk watch + bulk schedule on Connect.** "Watch all (N filtered)" (extends
   `/api/org/watch` with a sequential, capped `repos[]` batch — sequential so the lazy org upsert can't
   race; per-row failures reported) and "Schedule watched" (the no-`fullName` `/api/org/schedule` body
   that sets one cadence across the whole watched set). Both optimistic-with-rollback, like the per-row toggles.

## Verification (before → after)

| Gate | Baseline | After Wave 2 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `vitest run` | 450/450 (54 files) | 450/450 (54 files) |
| eslint (changed) | 0 errors | 0 errors (2 pre-existing warnings on the unchanged `repos` ternary) |
| `next build` | ✓ | ✓ |

## Deferred (migration-only — same risk rationale as STD-1)

- **MEM-2 (invite flow)** — needs a new `Invite` model + migration + an `/invite/[token]` accept page.
- **ALRT-3 (per-org regression thresholds)** — needs `Organization.alertOverallDrop/alertDimensionDrop`
  columns + migration; the webhook config (ALRT-1) needed no schema change, so it shipped without it.

Both are clean follow-ups once a focused migration session is run; details in `followups-2026-06-14.md`.

## Patterns established (catalogue additions, items 5–7)

5. **"Add the UI to a shipped backend" is a wave, not a fix.** When a backend ships with tests but no
   caller (RBAC, alerts, segment scope, bulk watch), the work clusters: each is a small page/panel +
   maybe one thin route addition, all sharing the optimistic-with-rollback + per-handler-gate model.
6. **Boolean gate for pages, Response gate for routes.** `requireOrgRole` returns a `NextResponse`
   (for API handlers); server pages need a yes/no, so `hasOrgRole = (await requireOrgRole(...)) === null`
   reuses the exact resolution (incl. owner-seed) without duplicating it.
7. **Bulk = accept an array on the existing single route, gate once, guard the shared upsert.** Extend
   the single-item route with an array branch rather than a new endpoint; write sequentially when each
   item lazily upserts a shared parent row (the Organization) so concurrent writes can't race it.

## What remains (from the INDEX)

Waves 3–8 + the optional tail are unstarted: notifications/email (GOAL-1/SEC-4/EXEC-1/ALRT-2/OVR-2),
monetization (CRED-1/QUOTA-1), planning completeness, live ops, audit/compliance + CI gate, growth/SEO
+ onboarding, plus STD-1, MEM-2, ALRT-3, and the 49 mediums / 4 lows.
