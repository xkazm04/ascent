# Goals & Initiatives — bug-hunter + ui-perfectionist scan

> Context: Goals & Initiatives (group: Org Planning & Execution)
> Files scanned: 10
> Total: 7 findings (Critical: 0, High: 0, Medium: 3, Low: 4)

Note on IDOR (the brief's primary concern): **both `[id]` routes are safe.** `/api/org/goals/[id]` (route.ts:14-19) and `/api/org/initiatives/[id]` (route.ts:19-22) resolve the owning org from the record itself (`getGoalOrgSlug`/`getInitiativeOrgSlug`, plan.ts:350/505) and gate on `requireOrgAccess(org)`. `requireOrgAccess` correctly gates on the ACTIVE Supabase wall (`authGateEnabled()`/`getViewer()`/`viewerOrgRole`) first, falling back to the dormant `getSession` path only when the wall is off. No dormant-auth misgating in any scoped route. A cross-org read/update/delete is not possible. The findings below are lower-severity.

## 1. Concurrent edits silently overwrite each other (no optimistic concurrency)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/lib/db/plan.ts:326
- **Scenario**: Two org admins open the Plan tab. Admin A retargets goal G to 80 and links initiative I to a different goal; Admin B, moments later, changes G's label and I's status. Each PATCH is a blind `prisma.goal.update`/`initiative.update` of only the fields it carries — last write wins with no version check.
- **Root cause**: `updateGoal` (plan.ts:326) and `updateInitiative` (plan.ts:487) assume a single editor; the schema has **no `updatedAt`/version column** on `Goal` or `Initiative` (schema.prisma:480, 499), so a stale client's write can't be detected.
- **Impact**: Silent lost updates to org planning state — a deliberate retarget/relink vanishes with no error, on a surface explicitly built for multiple stakeholders.
- **Fix sketch**: Add `updatedAt DateTime @updatedAt`; have the client send the last-seen `updatedAt`; `update({ where: { id, updatedAt } })` and return 409 on `P2025` so the UI can refetch and merge.

## 2. Destructive goal DELETE is gated to `member`, not `admin`
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: authorization
- **File**: src/app/api/org/goals/[id]/route.ts:18
- **Scenario**: A `viewer`-promoted-to-`member` (lowest write role, rank 1) calls `DELETE /api/org/goals/:id`. The `gate()` helper uses `requireOrgAccess` (allows `>= member`), so the delete succeeds — including goals another admin created, with their `achievedAt` milestone history.
- **Root cause**: `authz.ts`'s own guidance says destructive deletes should use `requireOrgRole(org, "admin")`, but the goal delete (and all Goal/Initiative PATCH mutations) use the member-level `requireOrgAccess`. The design assumes "any member may manage the plan," which conflicts with treating deletes as owner/admin-only elsewhere.
- **Impact**: Any member can irreversibly wipe org goals and their achievement history; no admin gate, audit, or soft-delete. Combined with finding #3 (no confirm) this is a one-click data-loss path.
- **Fix sketch**: Switch the DELETE gate to `requireOrgRole(org, "admin")` (keep PATCH at member if intended), or add soft-delete (`status: "archived"`) instead of a hard `goal.delete`.

## 3. Goal "remove" deletes instantly with no confirmation
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: destructive-confirmation
- **File**: src/components/org/plan/GoalsPanel.tsx:134
- **Scenario**: A user scanning the goals list clicks the small `remove` link (GoalsPanel.tsx:134, and again at :160 for achieved goals) sitting inches from each card. `remove(id)` fires the DELETE immediately — optimistic removal, no dialog, no undo.
- **Root cause**: The control assumes deletion is cheap/reversible; it is neither (server hard-deletes, and `achievedAt` history is lost). The optimistic path has rollback-on-failure but nothing guards against an *intended-by-the-click but unintended-by-the-user* delete.
- **Impact**: Trivial misclick permanently destroys a goal and its history — the classic "no confirmation on irreversible destructive action" UX failure.
- **Fix sketch**: Wrap `remove` in a confirm step (inline "Remove? · confirm / cancel" swap on the button, or a lightweight dialog), and/or offer an undo toast that re-POSTs from the snapshot already held in `prev`.

## 4. Tracked-initiative title lacks `truncate` (overflows on long titles)
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: long-title-truncation
- **File**: src/components/org/plan/InitiativesPanel.tsx:128
- **Scenario**: An initiative titled with a long unbroken string (e.g. a pasted URL or `no-spaces-mega-title`) renders in a tracked row. The wrapping `<div className="min-w-0">` (line 127) has `min-w-0` but the title `<div>` (line 128) has **no `truncate`**, so the unbroken title overflows the flex row and pushes/overlaps the status `<select>`.
- **Root cause**: The brief's rule — `min-w-0` and `truncate` must BOTH be present — is half-met. The seed row directly below (line 215) correctly uses `truncate`, so this is an internal inconsistency, not a deliberate choice.
- **Impact**: Layout break / control overlap for long titles; visually inconsistent with the seed list in the same panel.
- **Fix sketch**: Add `truncate` to the title div at InitiativesPanel.tsx:128 (parent already has `min-w-0`), matching line 215; optionally `title={i.title}` for the full text on hover.

## 5. `targetDate` validation claims YYYY-MM-DD but accepts any parseable datetime → off-by-one
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: timezone
- **File**: src/lib/db/plan.ts:167
- **Scenario**: A non-UI API client (or a future integration) POSTs `targetDate: "2026-03-01T20:00:00-08:00"`. The route validators only check `!Number.isNaN(Date.parse(...))` (goals route.ts:38/31, initiatives via body pass-through), so it passes despite the "must be an ISO date (YYYY-MM-DD)" message. `parseTargetDate` stores the parsed instant (2026-03-02T04:00Z), and read-back `toISOString().slice(0,10)` yields **"2026-03-02"** — a day later than intended.
- **Root cause**: The validator's contract (calendar date) and its implementation (`Date.parse` of any datetime) disagree; UTC-slice on a non-midnight instant shifts the day.
- **Impact**: Deadlines silently off by a day for API/integration callers; the browser `<input type="date">` path is safe (always sends bare `YYYY-MM-DD`), so blast radius is limited to non-UI clients.
- **Fix sketch**: Enforce the format with a regex (`/^\d{4}-\d{2}-\d{2}$/`) before accepting, and/or parse+store as UTC-midnight of the calendar date only.

## 6. Assignee input is uncontrolled — a failed PATCH rolls back state but not the field
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: optimistic-rollback
- **File**: src/components/org/plan/InitiativesPanel.tsx:154
- **Scenario**: A user edits the assignee (`defaultValue={i.assigneeLogin}`, onBlur → `patch`). The PATCH fails (403/network); `patch` calls `setItems(prev)` to roll back, but because the input is **uncontrolled**, React reuses the same DOM node (same `key={i.id}`) and never re-applies `defaultValue`. The field keeps the rejected value while state holds the old one.
- **Root cause**: Mixing an uncontrolled field with an optimistic-rollback model; rollback restores React state but can't reset an uncontrolled input.
- **Impact**: After a failed assignee edit the UI shows a login the server rejected, contradicting the error message — a stale/misleading field until reload.
- **Fix sketch**: Make it controlled (`value` + `onChange`) sourced from `items`, or force a remount on rollback (`key` that includes `i.assigneeLogin`).

## 7. `goalId` link is never validated to the caller's org
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: src/lib/db/plan.ts:498
- **Scenario**: A member of org A PATCHes their own initiative with `goalId` set to a Goal id belonging to org B (initiatives/[id]/route.ts:36 passes it straight through; `updateInitiative` plan.ts:498 and `createInitiative` plan.ts:439 store it unchecked).
- **Root cause**: The write trusts the client-supplied FK without confirming the goal shares the initiative's org — a validation gap at the trust boundary.
- **Impact**: Low in practice — `listInitiatives` resolves `goalLabel` from an **org-scoped** map (plan.ts:459/477), so a cross-org id renders as "unlinked" and leaks nothing; but it persists a dangling cross-tenant reference (data-integrity smell, and a latent leak if a future reader resolves goalId globally).
- **Fix sketch**: On create/patch, verify `goalId` (and `playbookId`) belongs to the same `orgId` before writing; reject with 400 otherwise.
