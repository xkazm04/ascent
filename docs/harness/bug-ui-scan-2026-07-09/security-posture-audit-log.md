# Security Posture & Audit Log — bug-hunter + ui-perfectionist scan

> Context: Security Posture & Audit Log (group: Org Dashboard & Analytics)
> Files scanned: 11
> Total: 7 findings (Critical: 0, High: 2, Medium: 3, Low: 2)

Read notes: `/api/audit` (route) and `/api/org/security/pdf` BOTH correctly call `requireOrgRead(org)` before returning data — verified, no cross-tenant IDOR there. The audit page relies on the org layout's `canReadOrg` gate, which is real (layout.tsx:83). There is no DELETE/PATCH audit route, so the trail is append-only at the API layer. Those angles are clean; the findings below are elsewhere.

## 1. Audit actor is sourced from the DORMANT getSession() → null-actor entries in production
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/db/scans-audit.ts:28
- **Scenario**: A signed-in owner (authenticated via the ACTIVE Supabase wall, `authGateEnabled()`) changes alert thresholds, gate policy, or invites a member. The route computes `actorId: session?.login` from `getSession()` — the DORMANT custom-OAuth session, which returns null under the Supabase wall. `recordAudit` then stores `actorId: opts.actorId ?? null` with no guard. The Audit tab renders `e.actorId ?? "—"`, so every such entry reads "who did this: unknown."
- **Root cause**: The shared recorder assumes callers supply a real actor, but the app's live identity is `getViewer()`, not `getSession()`. Confirmed instances: org/alerts/route.ts:118 & :137, org/gate-policy/route.ts:45, report/passport/pr/route.ts:73 (`session?.login`). scans-audit.ts is the single choke point that silently accepts and persists the null.
- **Impact**: security/compliance — the audit log, itself a security control, cannot attribute org-mutating actions to a person in any production deployment running the Supabase wall. Every `org.*` mutation is actorless.
- **Fix sketch**: Resolve the actor from the active viewer (`getViewer()?.login`) at the callers; and in `recordAudit`, `console.warn` when `actorId` is null for an actor-bearing action so the regression can't recur silently.

## 2. Security page silently discards the supply-chain `degraded` flag → GitHub-auth failure shows as "clean"
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/app/org/[slug]/security/page.tsx:56
- **Scenario**: With `SUPPLY_CHAIN_PROVIDER=github`, a transient installation/token-mint failure makes `getOrgSupplyChain` return the intentionally-distinct `{ degraded: true, scanned: 0, repos: [] }` state (supply-chain.ts:145). The page computes `supplyOn = !!supply && supply.scanned > 0` (false here) and only ever checks `scanned`, never `degraded`. The advisories column is dropped and NO error is shown — identical to "feature not enabled / no advisories."
- **Root cause**: supply-chain.ts went to lengths to build `degraded` precisely so the UI would "surface this as a transient error, never as an all-clear," but grep confirms NO consumer reads `supply.degraded` anywhere in the codebase. The mitigation is defeated at the render layer. `securityMarkdown` (security.ts:228) gates on `scanned > 0` too, so the LLM brief drops it as well.
- **Impact**: security false-negative — an org owner sees a clean supply-chain posture while GitHub auth is actually broken; the exact dangerous signal the module’s comment warns against.
- **Fix sketch**: In the page, branch on `supply?.degraded` and render an error banner ("Couldn't reach GitHub for Dependabot data — not an all-clear"); pass the degraded state through to the register/markdown instead of collapsing it into `supplyOn=false`.

## 3. Dependabot fetch caps at per_page=100 with no pagination → undercounts advisories
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/lib/security/supply-chain.ts:72
- **Scenario**: A large/monorepo with >100 open Dependabot alerts is fetched with `?state=open&per_page=100`; the response is a single page and no `Link`/`page=` follow-up is issued. `countAdvisories` tallies only the first 100 alerts.
- **Root cause**: Assumes one page covers all open advisories. GitHub’s Dependabot alerts API is paginated; the 101st+ alert is dropped from the tally.
- **Impact**: a security dashboard silently under-reports critical/high advisory counts for the most at-risk (alert-heavy) repos — understated risk exactly where it matters most.
- **Fix sketch**: Loop pages via the `Link: rel="next"` header (or `page` param) until exhausted, with a sane max-page safety cap, then tally the accumulated array.

## 4. Audit entries written with orgId=null are invisible in the org trail (and CSV export)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/db/scans-audit.ts:63
- **Scenario**: `recordOrgAudit` (and every `recordAudit` caller) resolves the org via `getOrgId(slug).catch(() => null) ?? undefined`. On a DB hiccup or slug miss, `orgId` becomes null and the entry is stored anyway (by design, "still records"). But `getAuditLog` filters strictly on `where.orgId = orgId` (scans-audit.ts:166), so a null-orgId row never matches ANY org — it’s written but permanently hidden from the dashboard and the CSV compliance export.
- **Root cause**: The write path treats orgId as best-effort/optional; the read path treats it as a mandatory equality filter. The two disagree, so a "recorded" audit action can be silently unretrievable.
- **Impact**: compliance/integrity — an action recorded "for the trail" vanishes from the trail whenever org resolution blips; the loss is invisible (recordAudit still returns true).
- **Fix sketch**: If `orgId` can’t be resolved, either fail the audit loudly (return false) or fall back to filtering by a stable org key that is always present; don’t persist an org-scoped entry with a null org.

## 5. CSV export uses live (un-applied) filters, diverging from the on-screen trail
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-inconsistency
- **File**: src/components/org/AuditLogViewer.tsx:146
- **Scenario**: The table only re-queries on the "Apply" button for `since`/`until`/`actor` (via `applyFilters`), but `csvHref` is recomputed inline from the LIVE state on every render. A user types a `since` date (or actor) and clicks "Download CSV ↓" WITHOUT clicking Apply: the table still shows the unfiltered trail while the CSV downloads the date/actor-filtered subset.
- **Root cause**: Two sources of truth for "the active filter" — deferred (table) vs immediate (export href). The export doesn’t reflect what the reviewer is actually looking at.
- **Impact**: an operator files CSV compliance evidence that silently differs from the trail they reviewed on screen (missing rows, or a narrower window than intended).
- **Fix sketch**: Derive `csvHref` from the last *applied* filter set (store it in state on `applyFilters`/`changeAction`), not from the raw input state; or auto-apply on input change so table and export stay in lockstep.

## 6. No loading feedback when applying filters — stale rows persist
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: loading-state
- **File**: src/components/org/AuditLogViewer.tsx:114
- **Scenario**: Clicking "Apply" (or changing the action dropdown) sets `loading=true` and re-fetches, but the table keeps rendering the previous filter’s rows unchanged until the response lands. The only cues are disabled controls; there is no spinner, skeleton, or dimming over the table. On a slow query the UI looks frozen/wrong (old rows under a new filter).
- **Root cause**: `loading` is only wired to control `disabled` states and the "Load more" button label, not to the table body.
- **Impact**: UX — momentary "success theater" where the visible trail contradicts the selected filter; users may distrust or double-submit.
- **Fix sketch**: While `loading && reset`, overlay a subtle skeleton/spinner on the table (or reduce opacity) so it’s clear a refresh is in flight.

## 7. Divergent empty states + unbounded actor/detail cells
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: visual-consistency
- **File**: src/components/org/AuditLogViewer.tsx:199
- **Scenario**: The initial no-data case renders the marketing-style `SectionEmpty` (audit/page.tsx:15), but filtering to zero rows renders a different bordered "No entries match this filter." box — two visually distinct empty treatments for the same "nothing to show" state. Separately, the Actor cell uses `whitespace-nowrap` and the Details `meta.status`/`meta.id` values are printed untruncated, so a long login/email or status value stretches the row (mitigated only by the table’s `overflow-x-auto` + `min-w-[640px]` horizontal scroll).
- **Root cause**: Empty-state styling isn’t centralized between the page shell and the client viewer; cell content has no max-width/truncation contract.
- **Impact**: UX polish — inconsistent empty affordance and horizontal-scroll jank on long identifiers, especially on mobile.
- **Fix sketch**: Reuse one empty component for both zero-states; add `max-w-[…] truncate` (with a `title`) to the Actor and Details value cells so long values ellipsize instead of forcing scroll.
