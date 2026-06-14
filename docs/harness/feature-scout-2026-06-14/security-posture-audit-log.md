# Feature Scout — Security Posture & Audit Log (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 3H / 2M / 0L

## 1. Audit-trail export (CSV / JSON) for compliance evidence
- **Severity**: High
- **Category**: feature
- **File**: src/app/api/audit/route.ts:16 · src/components/org/AuditLogViewer.tsx:103
- **Scenario**: A SOC 2 / ISO auditor or the org admin needs to hand over "every recorded action for Q2" as a file. Today they can only scroll an infinite-paginated table and screenshot it.
- **Gap**: `/api/audit` returns JSON for the in-app viewer only; there is no downloadable export. Grep confirms `text/csv` / `Content-Disposition` exports exist for reports, usage, history, and the briefing PDF (src/app/api/report/pdf, src/app/api/usage, src/app/api/history) but NOT for audit. The viewer has no export button.
- **Impact**: Enterprise buyers; an exportable, immutable audit trail is table-stakes for any security/compliance review and a frequent procurement checklist item. Multiplies the value of the data already being recorded.
- **Fix sketch**: Add `?format=csv` (or a sibling `/api/audit/export`) that streams all matching rows (reuse `getAuditLog` with a larger/looped cursor), flatten `meta`/`scan` columns, set `Content-Disposition: attachment`. Add a "Download CSV" button in AuditLogViewer that links to the current filter querystring. ~0.5 day.

## 2. Audit viewer can't filter by date range or actor (API already supports it)
- **Severity**: High
- **Category**: functionality
- **File**: src/components/org/AuditLogViewer.tsx:79 · src/app/api/audit/route.ts:34 · src/lib/db/scans-audit.ts:124
- **Scenario**: "Show me everything user X did between May 1 and May 15." The query layer and API already accept `since`, `until`, and `actorId`; the user just has no way to set them.
- **Gap**: `getAuditLog` and `/api/audit` fully implement `since`/`until`/`actorId` filtering, but `AuditLogViewer` only builds a querystring with `action` (line 83-85). No date inputs, no actor filter — confirmed by grep (the component references `actorId` only to render it, never to filter).
- **Impact**: Every admin investigating an incident. This is a half-built feature: the expensive backend exists and is wasted. Closing it is almost pure UI wiring.
- **Fix sketch**: Add two `type="date"` inputs (since/until) and an actor text/select input to the filter bar; pass them through `load()` into the querystring. ~0.5 day, no backend change.

## 3. Recommendation-update audit entries are mislabeled and unfilterable (action-name mismatch)
- **Severity**: High
- **Category**: functionality
- **File**: src/components/org/AuditLogViewer.tsx:15 · src/components/org/AuditLogViewer.tsx:24 · src/lib/db/scans-recommendations.ts:110
- **Scenario**: An admin picks the "Recommendation updates" filter to review who changed remediation statuses — and gets zero rows, even though such events exist.
- **Gap**: The actual recorded action is `recommendation.updated` (scans-recommendations.ts:110), but `ACTION_META` and `ACTION_FILTERS` key on `recommendation.status_changed` (lines 15, 24). Grep confirms `recommendation.status_changed` is written nowhere. Result: the filter silently matches nothing and those entries render with the raw action string and a grey "unknown" badge. Likewise `scan.regression`, `org.alerts.webhook`, `practice.pr_opened`, and `retention.purged` are recorded but unrecognized by the viewer (no badge, no filter option).
- **Impact**: Anyone using the audit page — the central feature of this context is partly broken. Fixing the key plus registering the other 4 real action types makes the whole trail legible and filterable.
- **Fix sketch**: Rename the key to `recommendation.updated`; add `ACTION_META`/`ACTION_FILTERS` entries for `scan.regression`, `org.alerts.webhook`, `practice.pr_opened`, `retention.purged` (drive the list from the known action constants). ~0.25 day.

## 4. No security alert on new critical vulnerabilities or gate failures
- **Severity**: Critical
- **Category**: user_benefit
- **File**: src/lib/scan-alerts.ts:52 · src/lib/security/supply-chain.ts:112 · src/lib/org/security.ts:69
- **Scenario**: A new critical Dependabot advisory lands, or a repo's Security (D9) drops below the gate. The security view shows it — but only if someone happens to open the page. Nobody is paged.
- **Gap**: The alert loop (`checkAndAlertRegression`, `maybeAlertLowCredits`) only fires on overall-score regression and low credits. Grep of src/lib/alerts.ts shows builders for regression and low-credits only — no `buildVuln*`/`buildSecurity*` message and no dispatch path for supply-chain or gate-failure events. `getOrgSupplyChain` is render-time only; `securityGate` failures are never pushed. The org alert webhook (Slack) already exists and is wired for the other two signal types.
- **Impact**: Every security owner; this is the difference between a passive dashboard and "live security intelligence." Critical because unalerted critical CVEs are exactly the failure mode the Security tab is meant to prevent, and the dispatch plumbing already exists.
- **Fix sketch**: Add `buildVulnAlertMessage`/`buildSecurityGateMessage` to alerts.ts; in the autoscan/webhook re-scan path (where `checkAndAlertRegression` runs), diff new critical/high advisory counts and D9-gate crossings vs. the prior scan, `recordAudit("security.vuln_detected"/"security.gate_failed", …)`, and `dispatchAlert` to the org webhook. Reuse the per-org sink routing already in scan-alerts.ts. ~1.5 days.

## 5. Supply-chain & security posture has no trend over time
- **Severity**: Medium
- **Category**: feature
- **File**: src/lib/security/supply-chain.ts:103 · src/app/org/[slug]/security/page.tsx:111 · prisma/schema.prisma:329
- **Scenario**: A security lead wants "are we getting better? advisories this month vs last; is branch-protection coverage trending up?" The Security tab only shows the current snapshot.
- **Gap**: `getOrgSupplyChain` is fetched on demand into a 5-min in-memory cache (supply-chain.ts:104-105) and never persisted — confirmed by grep: no Advisory/SupplyChain model in schema.prisma. There is no D9/governance time series on the Security page either (other tabs like usage have `UsageTrend`, so the trend pattern exists in the product). Nothing records advisory counts at scan time.
- **Impact**: Security leads and execs proving ROI of remediation work; trend is what turns a posture number into a managed program. Medium because the snapshot is functional today.
- **Fix sketch**: Persist a daily/at-scan `SecuritySnapshot` row per org (avg D9, band counts, advisory totals, protectedRate) in a small new table or reuse scan history; render a sparkline/area chart on the Security tab mirroring `UsageTrend`. ~1.5 days incl. migration.

## 6. No exportable security posture report (PDF) for the Security tab
- **Severity**: Medium
- **Category**: feature
- **File**: src/app/org/[slug]/security/page.tsx:47 · src/lib/org/security.ts:108 · src/app/api/org/briefing/pdf/route.ts:19
- **Scenario**: A security manager needs to attach a one-page "fleet security posture" to a board deck or vendor questionnaire — the same way they can already export the executive briefing as a board-ready PDF.
- **Gap**: The Security tab only offers `CopyForLlm` markdown (page.tsx:47). The PDF-export pattern exists for the briefing (`/api/org/briefing/pdf`, `BriefingDocument`) and per-repo reports, but grep finds no `security` PDF route and `securityMarkdown`/`buildSecurityOverview` are consumed only by the page and its test — no document/export sibling.
- **Impact**: Security/compliance owners and the people they report to; a shareable artifact extends the feature's reach beyond people with app access. Medium — the markdown brief partially covers the LLM-handoff use case.
- **Fix sketch**: Add `/api/org/security/pdf` mirroring the briefing route (reuse `buildSecurityOverview` + `getOrgSupplyChain`, a new `SecurityDocument` PDF component, `requireOrgRead` gate) and a "Download PDF" button on the Security tab next to `CopyForLlm`. ~1 day.
