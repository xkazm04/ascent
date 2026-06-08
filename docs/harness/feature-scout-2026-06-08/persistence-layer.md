# Feature Scout — Persistence Layer (Prisma / Aurora DSQL)

> Total: 6
> Critical: 0 | High: 3 | Medium: 2 | Low: 1

## 1. Per-scan cost / token / latency metering (true usage-based billing)
- **Severity**: High
- **Category**: functionality
- **File**: prisma/schema.prisma:178 (model Scan); src/lib/db/usage.ts:42
- **Gap**: The product positions itself on "usage metering" and usage-based pricing ("per private scan"), but the `Scan` model stores no LLM cost, input/output token counts, model latency, or API-call count — only `engineProvider`/`engineModel`. `getUsageSummary` (usage.ts:79-90) literally `COUNT(*)`s Scan rows and splits private/public; there is no money or token dimension anywhere (grep for `tokens|costUsd|latencyMs` in src/lib/db hits only `client.ts`/`installations.ts`, unrelated). A Bedrock/Gemini scan of a 5k-file monorepo and a 20-file repo bill identically, so the company can't see per-scan margin, can't bill on consumption, and can't cap a runaway org.
- **User value**: Finance/ops and the billing owner get real cost-of-goods per scan and per org; enterprise buyers get a defensible "you used N tokens / $X" line item instead of a flat per-scan count.
- **Implementation sketch**: Add `inputTokens Int?`, `outputTokens Int?`, `costMicroUsd Int?`, `llmLatencyMs Int?` columns to `Scan`; have the scoring engine pass the provider's token usage into `persistScanReport` (scans.ts:285) and write them inside the existing atomic `$transaction` (scans.ts:373); extend `UsageSummary` with cost/token sums via the same `prisma.scan.aggregate` pattern already in usage.ts:86.
- **Effort**: M

## 2. Subscription + plan-quota enforcement (the billing model is schema-only)
- **Severity**: High
- **Category**: feature
- **File**: prisma/schema.prisma:297 (model Subscription); src/lib/db/index.ts
- **Gap**: `Subscription` (stripeId, status) and `Organization.plan` (free|pro|team|enterprise) are defined in the schema and init.sql but **no code touches them** — there is no `db/subscriptions.ts`, the barrel (index.ts) exports nothing for it, and grepping `src/lib` for `.subscription.` / `stripeId` / `seats` / `quota` finds zero reads or writes. So plans can't be created, Stripe webhooks have nowhere to land, and nothing enforces a free-tier scan cap or pro-tier seat count. The retention layer already keys off `Organization.plan`-style overrides (retention.ts), proving the per-org-config pattern, yet billing itself is inert.
- **User value**: Lets the business actually charge: a `getSubscription`/`setSubscriptionStatus` helper + a plan-quota check gives self-serve upgrades, enforced free-tier limits, and a Stripe webhook target — turning a demo into revenue.
- **Implementation sketch**: Add a `db/subscriptions.ts` with `upsertSubscription`, `getOrgPlan`, and `assertScanQuota(orgSlug)` that counts the org's period scans (reuse usage.ts windows) against a plan map; call `assertScanQuota` in the scan route before `persistScanReport`; wire a Stripe webhook route that upserts `Subscription.status`. No schema change needed — the tables already exist.
- **Effort**: M

## 3. Actor-attributed audit trail backed by the User/Membership tables
- **Severity**: High
- **Category**: functionality
- **File**: prisma/schema.prisma:47 (model User), :56 (Membership); src/lib/db/scans.ts:38 (recordAudit)
- **Gap**: `User` and `Membership` (with roles owner|admin|member|viewer) are fully modeled and in init.sql, but **no code ever reads or writes them** (grep `prisma.user.` / `\.membership\.` across src finds only UI-local state and a test comment). `AuditLog.actorId` is a free-text nullable string (scans.ts:45-51) that callers almost never populate, and `recordAudit` enriches entries with the referenced scan (getAuditLog, scans.ts:1356) but never with *who* the actor is, because there is no user/membership join. The ARCHITECTURE doc explicitly promises audit of "role changes" (line 144) — unbuildable today.
- **User value**: Enterprise/compliance buyers get a real "who did what" trail (resolve actorId → User email/name + org role), and the groundwork for RBAC ("viewers can't trigger scans / change retention").
- **Implementation sketch**: Add a `db/users.ts` with `ensureUser(login,email)` + `ensureMembership(orgId,userId,role)` called from the existing auth/session path; pass the resolved `userId` as `actorId` into `recordAudit`/`persistScanReport` (both already accept `actorId`); in `getAuditLog` (scans.ts:1397) batch-resolve actorIds to User rows the same way it already batch-resolves `scanId`.
- **Effort**: M

## 4. Scan/report data export (CSV / JSON) for history, audit, and usage
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/lib/db/scans.ts:550 (getRepositoryHistory), :1356 (getAuditLog); src/lib/db/usage.ts:42
- **Gap**: All the high-value persisted series — repository history, the audit log, usage/billing days, the org backlog — can only be read as JSON for the in-app UI. There is **no export helper** (grep for `text/csv` / `Content-Disposition` across src hits only an unrelated `reflector/ExportButton.tsx`, never the db layer or an `/api` route over these tables). Enterprise auditors and FinOps teams expect to pull the audit trail and usage into a spreadsheet/SIEM; today they'd screenshot a chart.
- **User value**: Compliance, finance, and team leads can export the audit trail, usage history, and a repo's maturity history to CSV/JSON for their own reporting, board decks, or SIEM ingestion — a standard expectation for an "audit product".
- **Implementation sketch**: Add thin `toCsv` formatters over the existing `AuditLogPage`, `UsageSummary.daily`, and `RepositoryHistory` shapes (no new queries) and expose `/api/export/{audit,usage,history}` route handlers that set `Content-Disposition: attachment`; the keyset pagination in `getAuditLog` already supports streaming the full set page by page.
- **Effort**: M

## 5. Persisted alert/notification preferences + delivery log for regression alerts
- **Severity**: Medium
- **Category**: automation
- **File**: prisma/schema.prisma:71 (model Repository); src/app/api/app/webhook/route.ts:159 (runPushRescan → checkAndAlertRegression)
- **Gap**: Push-triggered rescans already fire a regression alert (`checkAndAlertRegression`, webhook route.ts:170-172), but the persistence layer stores **nothing about alerting**: there is no per-org/per-repo alert config (threshold, channel, who to notify) and no record of what was sent. `Repository` has `watched`/`scanSchedule` but no `alertThreshold`, no Slack/webhook target, and no `AlertDelivery` table — so alerts can't be tuned, deduplicated across rescans, or audited ("did the L3→L2 drop actually notify the owner?").
- **User value**: Eng leaders can set "alert me only on a ≥10pt or level drop, to this Slack webhook" and trust it fires once; an alert-delivery log makes regressions accountable and prevents notification spam on every push.
- **Implementation sketch**: Add `alertThreshold Int?` + `alertChannel String?` to `Repository` (or a small `AlertConfig` model keyed by orgId), and an `AlertDelivery` row written from `checkAndAlertRegression` recording repo/scanId/severity/channel/sentAt; gate sends on the persisted threshold and dedupe by `(repoId, headSha)`. Reuse the existing `recordAudit` transaction pattern for the delivery write.
- **Effort**: M

## 6. Org-scoped data-deletion / GDPR purge-on-demand endpoint
- **Severity**: Low
- **Category**: functionality
- **File**: src/lib/db/retention.ts:191 (purgeExpiredData); prisma/schema.prisma:25 (Organization)
- **Gap**: Retention is time/count-based and runs only via the daily cron (`purgeExpiredData`, retention.ts), with no way to delete a *specific* org's data on request. There is no `deleteOrgData(orgSlug)` helper, and because `relationMode="prisma"` emits no FK cascades (schema.prisma:22), an org delete would orphan Scan/Dimension/Recommendation/Audit/RepoTeam rows — the very hazard the code already warns about in `ensureOrgId` (scans.ts:158-161). An audit/SaaS product that stores customer-derived data needs a "delete everything for this org now" path for offboarding and GDPR/DPA right-to-erasure.
- **User value**: Account admins (and the support team) can fully erase an org's data on offboarding or a deletion request, and the company can answer a GDPR/DPA erasure request — a frequent enterprise procurement requirement.
- **Implementation sketch**: Add `deleteOrgData(orgSlug)` to retention.ts that, in the established children-before-parents + batched `withRetry` order already used by `pruneRepoScans`, deletes RecommendationEvent→Recommendation→ScanDimension→Scan→RepoContributor/RepoTeam/RepoSegment→Repository→Goal/Initiative/Segment/AuditLog→Subscription→Membership→Organization, then calls `invalidateOrgIdCache(orgSlug)` (already exported, scans.ts:171) and records a `org.deleted` audit entry; expose it behind an admin-only route.
- **Effort**: M
