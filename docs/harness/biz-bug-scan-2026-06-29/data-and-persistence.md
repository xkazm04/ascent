# Biz+Bug Scan — Data & Persistence — ascent — 2026-06-29

> Combined business-visionary + bug-hunter scan over 3 contexts.
> Total: 15 findings — Critical: 0, High: 4, Medium: 8, Low: 3  (bug: 9, business: 6)

---

## Data Retention & Purge

### 1. Org loop has no ordering and no time budget — a fleet that exceeds maxDuration perpetually starves the same tail of orgs
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: latent-failure
- **File**: src/lib/db/retention.ts:228 (org `findMany`, no `orderBy`); src/app/api/cron/purge/route.ts:14 (`maxDuration = 300`); src/lib/db/retention.ts:235 (loop)
- **Scenario**: As the corpus grows, `purgeExpiredData` iterates every org × every repo doing paged deletes. On a large fleet the single Vercel function exceeds the 300s cap and is hard-killed mid-run (no throw, no summary log). Committed batches survive, but every org after the kill point is never processed this run — and `prisma.organization.findMany` has no `orderBy`, so the iteration order is unstable/repo-defined, leaving no cursor to resume from.
- **Root cause / Rationale**: The job is "process all orgs in one shot" with no checkpoint, ordering, or deadline awareness. A consistently-timing-out job silently never reaches its tail orgs.
- **Impact**: A compliance promise ("we delete your data past the window") is silently broken for whichever orgs land late in the scan — exactly the liability the module exists to remove.
- **Fix sketch**: Add a stable `orderBy: { createdAt: "asc" }`, a soft wall-clock budget (stop cleanly at ~250s and record where it stopped), and persist a resume cursor (or rotate the starting org each run) so no org is perpetually starved.

### 2. Purge "completed with errors" still returns HTTP 200 — audit-write/compliance failures are swallowed at the route boundary
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/app/api/cron/purge/route.ts:35-38; src/lib/db/retention.ts:280-282, 305-308
- **Scenario**: retention.ts deliberately pushes "deletes applied, compliance trace missing" into `summary.errors` so a degraded run is visible. The route then logs `console.warn` and returns `NextResponse.json(summary)` with a 200. Vercel Cron records a green success; nobody is paged. The careful error-surfacing inside retention.ts is defeated one layer up.
- **Root cause / Rationale**: The route treats a non-empty `errors[]` as informational instead of as a partial failure.
- **Impact**: A destructive purge that lost its audit trail (the compliance record of *what* was deleted) looks healthy. For an audit product that is a SOC2/GDPR evidence gap going undetected.
- **Fix sketch**: When `summary.errors.length > 0`, return a 207/500 (or fire the org-alert webhook / `recordQuotaEvent`-style signal) so the failed compliance trace surfaces in monitoring rather than only in a buried log line.

### 3. Per-page `skip: max` OFFSET re-paging makes deep-history repos expensive under the 300s cap
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case / performance
- **File**: src/lib/db/retention.ts:124-163 (`pruneRepoScans`)
- **Scenario**: The selection re-issues `findMany({ skip: max, take: batchSize, orderBy: createdAt desc })` every page. Postgres/DSQL OFFSET is O(skip): a repo configured to keep the newest, say, 1000 scans re-scans and discards 1000 rows on every page, every repo, every run — multiplied across the fleet inside one 300s function.
- **Root cause / Rationale**: OFFSET pagination over a "keep newest N, delete the rest" window; the kept prefix is re-walked on each page.
- **Impact**: Wasted DB time that compounds finding #1's timeout risk; not corruption.
- **Fix sketch**: Capture the createdAt boundary of the Nth-newest scan once, then delete `where createdAt < boundary` in keyset-paged batches (no growing OFFSET).

### 4. Configurable data retention is a packaged enterprise pricing lever — but it's DB-column-only with no UI or plan gating
- **Severity**: High
- **Lens**: business-visionary
- **Category**: monetization
- **File**: prisma/schema.prisma:36-39 (`retentionMaxScans` / `retentionAuditDays`); src/lib/db/retention.ts
- **Scenario**: Retention is fully built (env defaults + per-org overrides + a working cron), but the only way to set it is writing `Organization` columns directly. Buyers of audit/security tooling (vs Snyk, Datadog, Splunk) expect retention windows to be a visible, self-serve, tier-differentiated control — and a reason to upgrade.
- **Root cause / Rationale**: The capability exists; the productization (settings surface + entitlement gate on `Organization.plan`) does not, so it generates zero revenue and zero perceived value.
- **Impact**: Leaves an obvious enterprise upsell ("compliance-grade retention controls") and a storage-cost-control story unmonetized.
- **Fix sketch**: Add an org-settings panel that writes the two columns, gate longer/custom windows behind `team`/`enterprise` plans, and surface the purge summary as a "storage reclaimed" stat to make the value tangible.

### 5. No on-demand "delete my data" (DSR) endpoint — GDPR/SOC2 right-to-erasure is table stakes for enterprise sales
- **Severity**: High
- **Lens**: business-visionary
- **Category**: differentiation / compliance
- **File**: src/lib/db/retention.ts:106-191 (reusable `pruneRepoScans` / `pruneAudit`)
- **Scenario**: Deletion is scheduled-only. An enterprise security buyer doing vendor review will ask "can a customer trigger erasure of a repo's/org's data on request?" Today the answer is "wait for the nightly cron, if a policy is even configured."
- **Root cause / Rationale**: The delete primitives exist but aren't exposed behind an authenticated, owner-scoped, audited on-demand action.
- **Impact**: A missing checkbox that can block or slow enterprise/regulated deals; conversely a cheap, demoable trust differentiator.
- **Fix sketch**: Add an owner-gated `POST /api/org/[slug]/erase` (and per-repo variant) that reuses the prune helpers in a bounded transaction, writes a `data.erased` audit entry, and confirms completion synchronously.

---

## Scan Persistence & History

### 1. The "most AI-native" leaderboard ranks only within the 200 most-recently-updated repos — it silently becomes inaccurate as the public corpus grows
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / correctness
- **File**: src/lib/db/scans-read.ts:463 (`GALLERY_CANDIDATE_CAP = 200`), 486-513 (candidate window by `updatedAt desc`), 547-549 (`topAiNative` sort within that window)
- **Scenario**: The leaderboard materializes the 200 most-recently-*active* public repos, then sorts those by score. A genuinely high-scoring public repo that hasn't been re-scanned recently falls outside the 200-row candidate window and can never appear on "most AI-native." Once the public corpus passes ~200 active repos, the board quietly means "top within the recently-touched 200," not "top overall."
- **Root cause / Rationale**: One bounded query reused for two different rankings (recency vs score); the score ranking inherits the recency cap.
- **Impact**: A public growth/credibility surface shows a wrong leaderboard with no error — undermining the exact virality loop it's meant to drive.
- **Fix sketch**: Maintain a denormalized "latest scan score per public repo" (or a periodic top-N materialization) and rank the leaderboard over that, independent of recency; keep the 200-cap only for the recency rail.

### 2. Read-side "latest scan" lookups use a bare `scannedAt desc` — non-deterministic tie-break where the persist path is careful
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / consistency
- **File**: src/lib/db/scans-read.ts:41-45 (`findScanByCommit`), 599-603 (`getLatestRecommendations`), 715-719 (`getScanReportByCommit`) — vs the deliberate `[scannedAt desc, createdAt desc, id desc]` in src/lib/db/scans-persist.ts:197
- **Scenario**: persist.ts explicitly notes `scannedAt` isn't unique (two re-scores can share a timestamp; backfills) and tie-breaks on createdAt+id. The read helpers that resolve "the latest scan" / "this commit's scan" order by `scannedAt desc` only. On a timestamp tie the public report page (`/report/owner/repo` with no sha), the recommendations read, and the dedup lookup can each resolve to a *different* arbitrary row, and the page can flip between reloads.
- **Root cause / Rationale**: The ordering invariant fixed on the write side was never propagated to the read side.
- **Impact**: Inconsistent public report content and a dedup lookup that may not agree with what the report page shows — subtle, hard-to-repro UX/correctness drift.
- **Fix sketch**: Use the same `orderBy: [{ scannedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }]` in every "pick the latest" read.

### 3. Sha-less dedup keys on exact `scannedAt` equality — two distinct same-millisecond re-scores silently collapse to one
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/lib/db/scans-read.ts:55-69 (`findScanByScannedAt`); used at src/lib/db/scans-persist.ts:178
- **Scenario**: When a report has no resolvable commit SHA, dedup matches on `scannedAt` equality. Two genuinely different sha-less scores produced in the same millisecond (coalesced lanes, a fast double-submit of changed inputs) match, so the second is suppressed as a "duplicate" and never persisted.
- **Root cause / Rationale**: High-precision-timestamp equality used as an identity key; acknowledged as fragile in the code comment (lines 60-66).
- **Impact**: Rare lost scan on the sha-less path; data, not crash.
- **Fix sketch**: Carry a real content/idempotency key (hash of report inputs) for sha-less reports and dedup on that instead of timestamp equality.

### 4. The public scan gallery + leaderboard is a ready-made viral growth flywheel that's under-leveraged
- **Severity**: High
- **Lens**: business-visionary
- **Category**: growth / retention
- **File**: src/lib/db/scans-read.ts:447-579 (`getPublicScanGallery` / `loadPublicGalleryCards`)
- **Scenario**: The latest-per-repo public data already powers a "recently scanned" rail and a "most AI-native" board. The same data can drive embeddable rank badges ("Top 1% AI-native"), per-language/per-archetype leaderboards, and a weekly "biggest movers" — the badge/leaderboard adoption loops that competitors (OpenSSF Scorecard badges, SonarCloud quality gates) ride for free distribution.
- **Root cause / Rationale**: The corpus exists but is exposed as two static rails, not as shareable, competitive, re-engaging artifacts.
- **Impact**: Each badge embed is a backlink + acquisition surface; leaderboards create return-visit and "beat your rival" loops. (Pair with bug #1 — an accurate board is a prerequisite.)
- **Fix sketch**: Add `/leaderboard` segmented by language/archetype off the cached gallery, plus an embeddable rank badge endpoint that links back to the pinned report; seed a weekly "top movers" email/digest.

### 5. The "what changed" scan comparison is a shareable retention/social artifact, not just an internal diff
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: retention / differentiation
- **File**: src/lib/db/scans-read.ts:374-419 (`getScanComparison`)
- **Scenario**: The comparison already diffs two scans into dimension deltas + recommendation status changes. Packaged as a shareable "we went L2 → L3 this quarter" card (image/PDF/permalink), it becomes a brag-worthy progress artifact teams post internally and externally — a re-engagement and word-of-mouth hook.
- **Root cause / Rationale**: Rich diff data is computed but only consumed by an in-app view.
- **Impact**: Converts a private analytics view into a retention + light-virality surface at low build cost.
- **Fix sketch**: Add a `/report/.../compare?from=&to=` permalink with an OG image + "share progress" CTA; reuse the existing Remotion/PDF pipeline for an exportable improvement card.

---

## Database Client & Schema

### 1. Read paths use raw `getPrisma()`/`dbReadSafe`, not `withDb` — a DSQL IAM-token expiry 500s the report page, landing gallery, history, and recommendations
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: latent-failure
- **File**: src/lib/db/scans-read.ts:41,60,90,116,214,380,479,588,698 (all `getPrisma()` directly); src/lib/db/client.ts:212-222 (`dbReadSafe` catches only `isDbUnavailableError`); contrast src/lib/db/scans-persist.ts:70 (persist wrapped in `withDb`)
- **Scenario**: On Aurora DSQL the connection password is a ~15-min IAM token. `getPrisma()` only *kicks a background refresh* on staleness and returns the still-cached (possibly expired) client (client.ts:404-410). The persist path is wrapped in `withDb`, which awaits a fresh token and reconnect-retries on auth-expiry. The read helpers are not: a frozen serverless instance that thaws past the TTL runs its first read on the dead token → an auth-expiry error (SQLSTATE 28xxx / P1000 / P1010). `dbReadSafe` only swallows *unreachable* errors, and `getRepositoryHistory`/`getScanReportByCommit`/the gallery don't even use `dbReadSafe` — so the error propagates as a 500.
- **Root cause / Rationale**: Token-expiry recovery (`withDb`/`runWithReconnect`) was applied to writes but not to the read surface, even though the same "frozen instance thaws past TTL" hazard the persist comment cites applies equally to reads.
- **Impact**: Intermittent 2 AM 500s on the public report page, landing leaderboard, history/trends, and recommendations after idle periods — the highest-traffic read routes — until the next process/refresh. Exactly the silent DSQL outage the module set out to prevent, left open on reads.
- **Fix sketch**: Route the read helpers through `withDb` (or a `dbReadSafe` that also treats `isAuthExpiryError` as recoverable by awaiting `reconnectDb` and retrying once).

### 2. PGlite local-dev boot skips schema upgrades — an existing data dir never picks up new tables/columns added to init.sql
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case / DX
- **File**: src/lib/db/pglite-boot.ts:25-32
- **Scenario**: Boot gates the whole `init.sql` exec on `to_regclass('public."Organization"')` being non-null. Once a dev has any PGlite data dir, `Organization` exists, so after a `git pull` that adds a table/column to init.sql the bootstrap is skipped entirely — and queries to the new model fail locally until the dev manually wipes `PGLITE_DATA_DIR`.
- **Root cause / Rationale**: "Bootstrap only when empty" with no migration/versioning step; init.sql uses bare `CREATE TABLE` (not `IF NOT EXISTS`), so it can't be re-run idempotently.
- **Impact**: Confusing local-dev failures after schema changes; no production impact.
- **Fix sketch**: Stamp a schema-version row and run additive `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` steps on version bumps, or log a loud "wipe PGLITE_DATA_DIR" hint when the probe sees an older schema.

### 3. `Organization.gatePolicy` uses Prisma `Json`/JSONB — the lone jsonb column, contradicting the schema's stated "no jsonb dependency" DSQL-safe invariant
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: latent-failure / portability
- **File**: prisma/schema.prisma:7-9 (header: "stored as serialized JSON in text columns (no jsonb dependency)") vs prisma/schema.prisma:51 (`gatePolicy Json?`); prisma/init.sql:27 (`"gatePolicy" JSONB`)
- **Scenario**: The schema deliberately stores every bulky structured field as serialized JSON in TEXT columns specifically to stay portable across local Postgres and Aurora DSQL. `Organization.gatePolicy` is the one exception — a real `Json`/JSONB column. Any store/migration path that doesn't treat jsonb identically (the documented DSQL caveat) makes this column the single point that breaks the init.sql ↔ schema parity the design works hard to preserve.
- **Root cause / Rationale**: A later feature added a `Json` column without following the established "JSON-in-TEXT" convention the rest of the schema obeys.
- **Impact**: A portability landmine and parity risk for the exact DSQL target; inconsistent with every sibling JSON field (techStackJson, passportJson, etc. are TEXT).
- **Fix sketch**: Store gatePolicy as `String?` TEXT holding serialized JSON (mirroring `techStackJson`), parse at the edge; align init.sql to TEXT to keep the parity test honest.

### 4. The tamper-evident audit trail (per-row HMAC) is a built but unsold SOC2/compliance differentiator
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: differentiation / monetization
- **File**: src/lib/db/scans-audit.ts:7,26-37 (`withAuditSignature` folded into every audit row)
- **Scenario**: Every audit entry is already signed with a migration-free HMAC for tamper-evidence. That's a concrete enterprise/regulated-buyer story ("cryptographically verifiable, tamper-evident audit log") that competitors rarely foreground — yet it's invisible in product and pricing.
- **Root cause / Rationale**: The security primitive exists; there's no verification UI, export, or plan gating to turn it into perceived value.
- **Impact**: A ready compliance selling point and enterprise gate left on the floor.
- **Fix sketch**: Add an audit-log "verify integrity" action + signed CSV/JSON export, document it in the security/compliance page, and gate verified export behind `enterprise`.

### 5. The AWS-native stack (Aurora DSQL + Bedrock BYOM) is a data-residency / "runs in your account" enterprise differentiator and Marketplace path
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: differentiation / monetization
- **File**: src/lib/db/scans-read.ts:454-457 + 577-578 (`dbMode` "served live from Aurora DSQL"); prisma/schema.prisma:616-635 (`OrgLlmConfig` — per-org Bedrock BYOM)
- **Scenario**: The app already surfaces "served live from Aurora DSQL" and supports per-org Bedrock so inference runs in the customer's AWS account/region/bill. That combination is a strong "your data and your LLM stay in your AWS boundary" pitch for security-conscious buyers — and a natural AWS Marketplace listing.
- **Root cause / Rationale**: The AWS-native posture is an implementation detail today, not a marketed enterprise trust/residency value prop or a distribution channel.
- **Impact**: Untapped enterprise positioning (data residency, in-account inference) and an AWS Marketplace co-sell/distribution motion.
- **Fix sketch**: Package "data residency + bring-your-own-Bedrock" as an enterprise tier with a trust/security page, and pursue an AWS Marketplace listing leveraging the existing DSQL + BYOM plumbing.
