> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)

# Test Mastery — Backlog Management

The backlog is the org's "run the maturity roadmap like a board" surface: each item is a per-repo recommendation that carries an **owner**, a **due date**, and a **status**, and every edit writes an **immutable audit row**. The board reads from `getOrgBacklog` (aggregation/grouping/counts) and writes through `PATCH /api/recommendations/:id` → `updateRecommendation` (transactional row update + activity events + audit). Today only the two leaf pure helpers are tested — `dueBucketFor` (`src/lib/db/org.test.ts`) and `percentileOf` (`src/lib/db/org-insights.test.ts`). **Every write path, every aggregate count, and both auth gates are untested**, even though the repo already has the exact fakePrisma harness needed (see `src/lib/db/credits.test.ts`).

---

## 1. Pin the transactional update + atomic audit write in updateRecommendation
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/lib/db/scans-recommendations.ts:43-124
- **Scenario**: A refactor moves the `auditLog.create` outside the `$transaction` (it was *already* a post-tx best-effort call once — the comment at line 106-108 documents that regression), or the change-detection guard at line 78-97 starts logging no-op edits. A committed status change ships with **no audit row** (silent compliance gap for the audit product), or the timeline fills with phantom "X → X" events. Both pass CI today because nothing executes this function.
- **Root cause**: `updateRecommendation` — the org's only data-mutation + audit path for the backlog — has **zero tests** (`scans-recommendations.test.ts` does not exist). The riskiest invariants (audit-row-shares-the-mutation's-atomicity, per-field change events, `orgId` resolved onto the audit row so it's *readable* in the viewer) live one layer above the tested `dueBucketFor`.
- **Impact**: A backlog status/owner/due-date change that commits with no audit row breaks the immutable "who did what" guarantee the audit product sells; phantom or missing events corrupt the per-item history leaders triage against.
- **Fix sketch**: New `src/lib/db/scans-recommendations.test.ts` using the `vi.hoisted` + fakePrisma pattern from `credits.test.ts`. Assert: (a) changing status+assignee+targetDate in one call produces **exactly one** `recommendationEvent` per *actually-changed* field with correct `from`/`to`/`actor`/`note`; (b) the `auditLog.create` runs **inside** the `tx` callback (spy the tx object — `tx.auditLog.create` called, not the top-level client) and carries the resolved `orgId` (non-null when the rec→scan→repo→org chain exists); (c) a no-op patch (same values) writes **no** row update and **no** events/audit and returns the current rec; (d) a missing id throws a `P2025` `PrismaClientKnownRequestError`. Invariant: *events.length and audit-write count both equal the number of fields whose value actually changed, and all three writes commit or roll back together.*

## 2. Cover the getOrgBacklog aggregation: counts, ACTIVE filtering, and group ordering
- **Severity**: High
- **Category**: coverage-gap
- **File**: src/lib/db/org-insights.ts:316-484
- **Scenario**: A change to the status filter (line 366/389) lets `done`/`dismissed` items leak into `byOwner`/`byDue`, or the `overdue`/`dueSoon`/`assigned`/`unassigned` tallies (lines 391-393, 464-465) drift (e.g. `dueSoon` accidentally counts overdue items because the `>= 0` guard is dropped). The SummaryStrip then shows wrong headline numbers and the "needs an owner" pile is misallocated — and nothing fails.
- **Root cause**: `getOrgBacklog` does all the real shaping (active-only filtering, six summary counts, owner grouping with Unassigned-last ordering at line 443-449, fixed-order due bucketing, bot exclusion via `isBot`, `projectedPoints` null-when-pre-dimension) yet has **no test**. The function already takes an injectable `now: Date = new Date()` (line 316) and reads prisma only at the top, so it is fully fakePrisma-testable.
- **Impact**: The backlog's headline metrics (Active / Overdue / Due ≤7d / Unassigned / In progress / Done) are the numbers a leader steers the fleet by; a silent miscount sends work to the wrong owner or hides overdue items.
- **Fix sketch**: In the new org-insights backlog test, feed a fakePrisma returning two repos with a mix of `open`/`in_progress`/`done`/`dismissed` recs, some assigned, some with past/near/far `targetDate`, plus a `repoContributor` set including a `[bot]` login. Assert with a fixed `now`: (a) `active` == count of open+in_progress only, and done/dismissed appear in `tracked`+`done`/`dismissed` counts but **not** in any `byOwner`/`byDue` items; (b) `overdue`, `dueSoon` (>=0 && <=7), `assigned`, `unassigned` equal the hand-computed values; (c) `byOwner` puts the Unassigned group **last** and orders the rest by overdue-desc then active-desc; (d) `assignees` excludes the `[bot]` login and is sorted. Invariant: *grouped item totals reconcile exactly with the summary counts, and only open+in_progress items are ever grouped.*

## 3. Test the PATCH route's tenant gate, validation, and public-org block for FAILURE
- **Severity**: High
- **Category**: error-branch
- **File**: src/app/api/recommendations/[id]/route.ts:38-102
- **Scenario**: The PUBLIC_ORG guard (line 44-49) or the `requireOrgAccess` call (line 50-51) is reordered/removed during a refactor, letting any signed-in user mutate another tenant's backlog and **poison its audit log** by guessing a rec id — exactly the cross-tenant IDOR the comments say was just closed. Or the strict `targetDate` shape check (line 86-94, which fixed a prior bug that stored `"June 9 2026"` verbatim) regresses to `Date.parse`-anything. No route test exists to catch any of it.
- **Root cause**: This route is the sole entry point for backlog writes and the place all input validation + authorization lives, but there is **no `route.test.ts`**. `authz.test.ts` covers `requireOrgAccess` in isolation, yet nothing asserts this route actually *calls* the gate before `updateRecommendation`, nor that bad input is rejected with the right status.
- **Impact**: A regression here is a cross-tenant data-integrity/compliance breach (mutating + auditing another org's backlog) or silent acceptance of malformed due dates — the highest blast-radius failure on this surface.
- **Fix sketch**: New route test (mock `@/lib/db`, `@/lib/auth`, `@/lib/authz` per the house pattern). Assert: (a) when `getRecommendationOrgSlug` returns `PUBLIC_ORG` → **403** and `updateRecommendation` is **never called**; (b) when `requireOrgAccess` returns a denial response, it is returned and the mutation is skipped; (c) invalid `status`, an `assigneeLogin` failing `/^[A-Za-z0-9-]{1,39}$/`, and `targetDate` of `"June 9 2026"`/`"2026/06/09"`/`"2026-13-45"` each → **400** with no write; (d) an empty patch → **400**; (e) a valid patch forwards `{ actor: session.login, note }` to `updateRecommendation`. Invariant: *no mutation occurs unless the caller passed the tenant gate AND the input matches the documented contract.*

## 4. Add error-branch cases to dueBucketFor and a determinism guard on the `now` default
- **Severity**: Medium
- **Category**: edge-case
- **File**: src/lib/db/org-insights.ts:223-241 (tested via src/lib/db/org.test.ts:7-39)
- **Scenario**: The existing `dueBucketFor` test only walks the happy path of each bucket. The boundary that actually bites users is `daysUntil` rounding and the **negative/today** edge feeding `dueLabel` and the `overdue` flag (line 392) — e.g. a date exactly at midnight-today vs. a fractional-day `now`. A `Math.round` → `Math.floor` swap in `daysUntil` (line 226) would silently flip an item from "due today" to "1 day overdue" and is uncaught.
- **Root cause**: `daysUntil` is not exported and only its consumer's *forward* buckets are asserted; the overdue/today boundary that drives the prominent orange "overdue" treatment isn't pinned, and `dueInDays` (the value `dueLabel` and `dueSoon` depend on) is never asserted directly.
- **Impact**: Off-by-one due math mislabels overdue work — the single most action-driving signal on the board — eroding trust in the backlog.
- **Fix sketch**: Extend `org.test.ts`: assert `dueBucketFor(day("2026-06-01"), now)` and a date one second before midnight-today both classify consistently, and that the **boundary** dates (d == 0, d == -1, d == 8, d == 32) land in the right bucket *and* that the corresponding `dueInDays` sign is correct (negative ⇔ `overdue`). If practical, export `daysUntil` and assert it returns whole-day deltas symmetric around 0. Invariant: *`dueInDays < 0` ⇔ bucket `overdue` ⇔ the row renders as overdue, with no rounding gap at the today boundary.*

## 5. LLM-batch the backlogShared display helpers (dueLabel / eventValue) against their invariants
- **Severity**: Low
- **Category**: coverage-gap
- **File**: src/components/org/backlogShared.ts:25-38
- **Scenario**: A tweak to `dueLabel` pluralization (line 36-37) ships "due in 1 days" / "-1 days overdue", or `eventValue` (line 25-29) stops mapping a status id to its label so the history timeline shows raw `in_progress` instead of "In progress". Cosmetic, but these strings are user-facing on every backlog row and every history entry, and nothing tests them.
- **Root cause**: `dueLabel` and `eventValue` are pure, table-driven string functions with obvious singular/plural and null branches — exactly the kind of leaf logic that drifts unnoticed because it's "just labels," and they have no test file.
- **Impact**: Low business risk, but broken pluralization/labels undermine the polished, leader-facing feel of the planning surface.
- **Fix sketch**: A small `backlogShared.test.ts` (no DOM needed — pure functions): assert `dueLabel({dueInDays:0})` == "due today", `dueInDays:1` == "due in 1 day", `dueInDays:2` == "due in 2 days", `dueInDays:-1` == "1 day overdue", `dueInDays:-2` == "2 days overdue", `dueInDays:null` == null; and `eventValue("status","in_progress")` == "In progress", `eventValue("status","weird")` == "weird" (fallthrough), `eventValue("assignee",null)` == "—". Invariant: *singular only at ±1, the em-dash for null, and status ids always resolve to their human label or echo unchanged.*
