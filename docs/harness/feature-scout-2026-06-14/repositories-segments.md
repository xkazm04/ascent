# Feature Scout — Repositories & Segments (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 3H / 2M / 0L

## 1. Segment-scoped scan & cadence are built into the backend but unreachable from any UI
- **Severity**: Critical
- **Category**: functionality
- **File**: src/app/org/[slug]/segments/page.tsx:86 (page has no actions); src/app/api/org/schedule/route.ts:43 (`setWatchedSchedule(org, schedule, segmentId)`); src/app/api/org/scan/route.ts:39 (`repos:[...]` scope); src/lib/db/org-watch.ts:81; src/lib/db/org-shared.ts:14 (`segmentScope`)
- **Scenario**: A fleet owner has tagged a "platform" segment and wants to "rescan the platform segment now" or set "platform rescans weekly, legacy monthly" as policy — managing cadence per slice instead of clicking every repo.
- **Gap**: The whole capability already exists server-side. `POST /api/org/schedule` accepts `segmentId` and `setWatchedSchedule` filters by `segmentScope(segmentId)`; `POST /api/org/scan` accepts an explicit `repos:[...]` list and `staleOnlyDays`. But grep of `src/components` for `setWatchedSchedule|segmentId|staleOnlyDays` shows the only callers pass per-repo `fullName` (ScheduleSelect) or `staleOnlyDays` (OrgScanButton) — **no component ever passes a `segmentId` or a segment's repo set**. The Segments page (segments/page.tsx) renders only comparison cards; the comparison header `right={<SegmentComparePicker/>}` has no scan/cadence control, and the Overview's `SegmentSelector` only filters the read view. The headline "segment-scoped scanning/cadence" promise in segments.ts:3-4 is therefore half-built: the data plane ships, the control surface doesn't.
- **Impact**: Every org admin running cadence as policy. This is the single biggest value multiplier in scope — it turns segments from a passive comparison lens into an operational unit (scan/track this slice on this rhythm), and it's nearly free because the backend, credit gating, and SSE plumbing all already exist.
- **Fix sketch**: Add a "Scan segment" button + a cadence `<select>` to each `SegmentCard` (and/or the comparison header). The cadence calls the existing `POST /api/org/schedule` with `{ org, segmentId, schedule }` (reuse `ScheduleSelect`'s optimistic pattern). The scan resolves the segment's tagged `fullName`s (the page already has `getRepoSegmentMap`) and POSTs `{ org, repos }` to `/api/org/scan`, consuming SSE exactly like `OrgScanButton`/`RepoRescanButton`. ~1 day; mostly UI wiring of existing endpoints.

## 2. No per-segment digest — fleet leaders can't get a weekly push for the slice they own
- **Severity**: High
- **Category**: feature
- **File**: src/app/api/cron/digest/route.ts:48 (`getOrgRollup(org, win)` — no segment arg); src/lib/db/org-alerts.ts (single `alertWebhookUrl` per org)
- **Scenario**: The mobile lead wants the weekly Slack digest scoped to the mobile segment; the platform lead wants theirs scoped to platform. Today both get one org-wide digest or nothing.
- **Gap**: `getOrgRollup`/`getOrgMovers`/`getOrgRecommendations` all already accept a `segmentId` (org-rollup.ts, used on the Overview at page.tsx:78-85), so a segment-scoped digest is computable. But the digest cron passes no segment, and `Organization` carries exactly one `alertWebhookUrl` (org-alerts.ts) — there is no per-segment webhook field on the `Segment` model (schema.prisma:155-167 has only id/name/color). So segment owners cannot subscribe a channel to their slice. Confirmed: grep for `segment` in cron/digest and org-alerts returns nothing.
- **Impact**: Team/segment leads — the people who actually act on a slice's regressions. Per-segment digests make the product sticky for line managers, not just the one org admin who set the global webhook, and naturally drive seat/segment expansion.
- **Fix sketch**: Add `digestWebhookUrl String?` to `Segment`, a small field on the Segments page to set it, and a loop in cron/digest that, after the org digest, iterates segments with a webhook and re-runs the existing rollup/movers helpers with `segmentId`, reusing `buildFleetDigestMessage`. ~1.5 days (migration + UI + cron loop).

## 3. Segments show only a current snapshot — no trend/history of a segment over time
- **Severity**: High
- **Category**: user_benefit
- **File**: src/app/org/[slug]/segments/page.tsx:94 (SegmentCard is a point-in-time tile); src/lib/db/segments.ts:204 (`listSegmentSummaries` has no time window)
- **Scenario**: "Is the legacy segment actually improving since we kicked off the migration?" A leader wants a line/sparkline of each segment's avg overall over the last 8–12 weeks, and an A-vs-B trend on the compare page.
- **Gap**: The Overview already renders a `TrendChart` (page.tsx:2) and `getOrgRollup` accepts a window + `segmentId`, so segment time-series is feasible from existing data. But `summarizeSegment`/`compareSegments` (segments.ts:217-262) take no window — every segment number is "latest scan only." The compare page (segments/page.tsx) shows current A/B deltas with zero history. Grep confirms no segment trend/sparkline anywhere.
- **Impact**: Anyone tracking a remediation program by slice. A snapshot says where you are; a trend says whether the investment is working — the difference between a dashboard you glance at and one you report to leadership from.
- **Fix sketch**: Add a `segmentTrend(orgSlug, segmentId, weeks)` to segments.ts that calls `getOrgRollup` per weekly window (the digest already windows like this), returning `TrendPoint[]`. Drop a `TrendChart` into `SegmentCard` and an A-vs-B dual line onto the compare page. ~1.5 days.

## 4. No auto-segments — segmentation is 100% manual tagging even though primaryLanguage is already stored
- **Severity**: Medium
- **Category**: feature
- **File**: src/components/org/RepoSegmentsPanel.tsx:82 (`toggle` is the only path to membership); src/lib/db/segments.ts:109 (`setRepoSegment` is single-repo); prisma/schema.prisma:117 (`Repository.primaryLanguage`)
- **Scenario**: A 200-repo org wants segments by language ("all TypeScript", "all Go") or by owner team without hand-tagging hundreds of repos one chip at a time.
- **Gap**: The only way a repo enters a segment is the per-repo, per-chip `toggle()` in RepoSegmentsPanel → `POST /api/org/segments/:id/repos` (one repo per call). `Repository.primaryLanguage` is persisted (schema.prisma:117) and `Team` membership exists (org-teams.ts), but nothing derives or bulk-fills a segment from them. Grep for `primaryLanguage` in the segments layer returns nothing. So segmentation does not scale past a few dozen repos.
- **Impact**: Mid/large orgs — exactly the customers segments are meant to serve. Auto-segments (by language, by topic, by team) make the feature usable at fleet scale and dramatically cut time-to-value on first setup.
- **Fix sketch**: Add `POST /api/org/segments/:id/repos/bulk { fullNames[] }` and a `setRepoSegmentsBulk` in segments.ts (a single `createMany` of `RepoSegment` rows). In the panel, add "Auto-add by language ▾" / "by team" pickers that resolve the matching `fullName`s client-side (the page already has the repo list + languages) and call the bulk endpoint. ~1.5 days.

## 5. Leaderboard has no export (CSV) and no bulk repo operations
- **Severity**: Medium
- **Category**: functionality
- **File**: src/app/org/[slug]/repositories/page.tsx:56 (OrgTable; per-row controls only); cf. src/app/api/usage/route.ts:90 + src/app/api/history/route.ts:97 (CSV already implemented elsewhere)
- **Scenario**: An admin wants to drop the repo leaderboard into a spreadsheet for a board deck, or tag/schedule/rescan 30 repos at once instead of clicking 30 rows.
- **Gap**: The leaderboard renders each repo with per-row `ScheduleSelect` + `RepoRescanButton` only — there is no row selection, no "select all → tag into segment / set cadence / rescan", and no export. CSV export is a proven pattern in this codebase (`/api/usage` and `/api/history` both stream `text/csv` with a sanitized Content-Disposition filename — usage/route.ts:90, history/route.ts:97), but grep shows **no org/leaderboard CSV route** reuses it. So the fleet table — the densest data in the org view — can't leave the browser, and bulk actions don't exist.
- **Impact**: Admins of larger fleets and anyone who reports upward. Export is table stakes for an "org/fleet" product; bulk ops remove the repetitive per-row grind that makes the leaderboard tedious at scale.
- **Fix sketch**: (a) Add `GET /api/org/repositories?org=&format=csv` that serializes `getOrgRollup().repos` (reuse the `safeFilenameSlug` + CSV header pattern from history/route.ts) and an "Export CSV" link in the leaderboard `SectionHeader`. (b) Add checkbox selection to the table rows feeding a sticky action bar that calls the bulk endpoints from findings #1/#4. CSV ~0.5 day; bulk bar ~1 day.

## 6. SegmentSelector and ComparePicker can't reach create/rename/recolor — and segments are absent from the compare page's empty path
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/components/org/SegmentSelector.tsx:30 (`if (segments.length === 0) return null`); src/components/org/SegmentComparePicker.tsx:33 (read-only `<select>`s); src/app/api/org/segments/[id]/route.ts:21 (PATCH rename/recolor exists)
- **Scenario**: A user on the Overview sees no segment filter at all (it renders nothing when there are none) and has no hint that segments exist; another wants to rename "platform" to "core-platform" without hunting back to the Repositories tab.
- **Gap**: `SegmentSelector` returns `null` with zero segments, so the capability is invisible from the Overview until you happen to find the Repositories tab. The `PATCH /api/org/segments/:id` rename/recolor endpoint is fully implemented (segments/[id]/route.ts) and `updateSegment` exists (segments.ts:76), but **no UI calls PATCH** — RepoSegmentsPanel only creates (POST) and deletes (DELETE); there is no rename/recolor affordance anywhere (grep: no `PATCH` to `/api/org/segments`). So a built, tested mutation is dead code from the user's side.
- **Impact**: All segment users — discoverability and basic CRUD completeness. Small surface, but the missing rename makes a typo'd segment permanent-until-deleted (which drops all its tags), and the invisible selector hides the whole feature from the tab most users live on.
- **Fix sketch**: Wire double-click-to-rename + a color swatch on the segment chips in RepoSegmentsPanel to the existing `PATCH /api/org/segments/:id`; show a subtle "Create segment →" link from `SegmentSelector` when empty (link to Repositories tab). ~0.5 day.
