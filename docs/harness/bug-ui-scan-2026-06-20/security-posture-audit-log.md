> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

# Security Posture & Audit Log — combined bug+ui scan

## 1. Config-change audits attribute the actor to `meta.actor` instead of `actorId`, so "who did it" is invisible and unfilterable in the viewer
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: actor-attribution / audit-trail completeness
- **File**: src/app/api/org/plan/route.ts:41 (also src/app/api/org/gate-policy/route.ts:41, src/app/api/org/alerts/route.ts:109+127)
- **Scenario**: An owner changes the org plan, gate policy, or alert sink/thresholds. The handler has `session.login` in hand and writes `recordAudit("org.plan", { …, actor: session?.login }, { orgId })` — putting the actor inside `meta.actor` but passing `actorId: undefined` to the dedicated column. In the AuditLogViewer the "Actor" column renders `e.actorId ?? "—"` (AuditLogViewer.tsx:213) and `Details` only surfaces a scan ref or `meta.status`/`meta.id` (AuditLogViewer.tsx:69-80) — it never reads `meta.actor`. The actor filter posts `actorId` → `where.actorId` (scans-audit.ts:133), which can never match these rows.
- **Root cause**: The dedicated `actorId` audit column and the ad-hoc `meta.actor` convention diverged; the four most security-sensitive *config-change* actions chose the latter, so the column the UI and the filter both key on stays null.
- **Impact**: For exactly the actions where accountability matters most (plan/entitlement changes, CI security-gate policy, alert routing), the audit trail shows actor "—" and cannot be filtered by who did it — a real attribution gap in compliance evidence even though the data was captured.
- **Fix sketch**: Pass `{ orgId, actorId: session?.login }` for `org.plan`, `org.gate_policy`, `org.alerts.webhook`, `org.alerts.thresholds` (mirroring members/playbooks/practices which already do). Drop the redundant `meta.actor`, or have `Details`/the column fall back to `meta.actor` for legacy rows.

## 2. Recorded actions `org.gate_policy` and `playbook.updated` are missing from the viewer's action list — unfilterable, raw badge
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: filter/metadata drift
- **File**: src/components/org/AuditLogViewer.tsx:17-30
- **Scenario**: `gate-policy/route.ts` writes `"org.gate_policy"` and `playbooks/[id]/route.ts` writes `"playbook.updated"`, but neither value is in the viewer's `ACTIONS` array. So those rows fall through to the grey fallback badge (raw action string, ActionBadge :39) and there is no way to filter the trail down to them from the Action dropdown.
- **Root cause**: The list comment explicitly states it must enumerate "the audit actions the app actually records" so badge metadata and the filter "can't drift apart" — but two later-added actions weren't back-filled, so the single-source-of-truth invariant is already broken.
- **Impact**: An auditor cannot isolate CI-gate-policy changes (a security-relevant action) or playbook edits via the UI filter, and they render as unstyled raw strings instead of labeled badges.
- **Fix sketch**: Add `{ value: "org.gate_policy", label: "Gate policy", … }` and `{ value: "playbook.updated", label: "Playbook update", … }` to `ACTIONS`. Consider deriving the recorded-action set from a shared constant so this can't drift again.

## 3. Malformed `since`/`until` date params hard-fail the query (500) instead of being ignored
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: input validation / silent failure → crash
- **File**: src/lib/db/scans-audit.ts:135-137
- **Scenario**: A request with `?since=not-a-date` (or a typo, or a stale bookmarked URL) reaches `atFilter.gte = new Date(query.since)`, which is `Invalid Date`. Prisma rejects an `Invalid Date` in a `DateTimeFilter`, the exception bubbles to the route's catch (audit/route.ts:122-125 → 500 "Failed to load audit log"), and on the CSV path the *entire export* fails (audit/route.ts:106-109).
- **Root cause**: Date strings from the query string are passed straight to `new Date()` without validating `!Number.isNaN(d.getTime())`; an invalid filter value becomes a query error rather than a no-op filter.
- **Impact**: A trivially malformed filter (or future UI control) turns the whole audit page / compliance export into a 500 instead of returning unfiltered results — brittle for the one surface that must stay available during an audit.
- **Fix sketch**: Wrap each in a guard: `const d = new Date(query.since); if (!Number.isNaN(d.getTime())) atFilter.gte = d;` — otherwise ignore the bad bound. Optionally 400 at the route with a clear message.

## 4. Per-row HMAC tamper-evidence is write-only — nothing in the app ever verifies `_sig`
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: tamper-evidence completeness / security-theater
- **File**: src/lib/db/audit-integrity.ts:76-87 (vs src/components/org/AuditLogViewer.tsx, src/app/api/audit/route.ts)
- **Scenario**: `recordAudit` folds an HMAC `_sig` into every row's meta, and `verifyAudit()` exists to detect tampering — but `verifyAudit` is referenced only by its own unit test. No API route, no CSV column, and no viewer badge ever calls it. A row edited directly in the DB (the exact threat the module's header cites) is never flagged: the viewer shows it normally and the CSV export emits the now-stale `_sig` with no verdict.
- **Root cause**: The signing (write) half shipped without the verification (read) half, so the integrity guarantee is latent — present in the data, never enforced or surfaced.
- **Impact**: The "examiner-grade, tamper-evident" claim isn't actually realized end-to-end; tampering produces no signal anywhere a human or the export would see it.
- **Fix sketch**: Run `verifyAudit` over each row in `getAuditLog`/`exportCsv`, attach the verdict (`ok`/`tampered`/`unsigned`) to each entry, render a small integrity badge in the viewer, and add a `_verified` column (or a summary line) to the CSV so the filed artifact is self-checking.

## 5. CSV export silently truncates at 10,000 rows with no signal in the file or response
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent failure / compliance completeness
- **File**: src/app/api/audit/route.ts:32,42-63
- **Scenario**: `exportCsv` loops pages until `total < CSV_MAX_ROWS` (10000). For a busy org whose filtered trail exceeds 10k entries, the download stops at 10k with no header, trailing marker, or warning — and the `x-ascent-content-sha256` is computed over the *truncated* body, so it validates as "intact" while being incomplete.
- **Root cause**: The safety cap is necessary but unreported; "looks complete + valid checksum" is indistinguishable from "actually complete."
- **Impact**: A compliance export can quietly omit the oldest entries within a filter window, and the integrity hash gives false confidence that nothing is missing.
- **Fix sketch**: When the cap is hit, emit a trailing `# truncated at 10000 rows — narrow the date range` comment line and/or an `x-ascent-truncated: true` response header so the omission is explicit.
