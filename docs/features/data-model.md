# Persistence & data model

Ascent's MVP is stateless — a scan needs no database. Everything Phase 2 (history, org
rollups, recommendations tracking, usage, audit, planning) layers on the **optional**
Prisma persistence layer in `prisma/schema.prisma` + `src/lib/db/`. When `DATABASE_URL` is
unset, `isDbConfigured()` returns false and DB-backed features degrade to empty/notice
states rather than erroring.

The schema is **DSQL-safe by design** so the same migrations run on local Postgres and
Amazon Aurora DSQL:

- `relationMode = "prisma"` — **no foreign-key constraints** emitted (DSQL has none);
  relations enforced at the Prisma layer, so relation scalar fields carry manual `@@index`.
- **UUID primary keys** (`@default(uuid())`) — no `SERIAL`/sequences.
- Bulky string arrays stored as **serialized JSON in text columns** (no `jsonb`
  dependency); queryable fields (scores, level, timestamps) stay real columns so
  trend/history queries remain relational.

## Models

| Model | Purpose | Notable fields |
| --- | --- | --- |
| `Organization` | Tenant root (also the GitHub App installation record). | `slug` (unique), `name`, `plan` (free\|pro\|team\|enterprise), `githubInstallId`, `retentionMaxScans?`, `retentionAuditDays?` |
| `User` | For future multi-user invites. | `email` (unique), `name?` |
| `Membership` | Org ↔ user ↔ role. | `role` (owner\|admin\|member\|viewer); `@@unique([orgId, userId])` |
| `Repository` | A tracked repo within an org. | `fullName`, `isPrivate`, `primaryLanguage?`, `stars`, `headSha?`/`headEtag?` (conditional-request cache), `watched`, `scanSchedule` (off\|daily\|weekly\|monthly), `lastScanAt?`/`nextScanAt?`; `@@unique([orgId, fullName])` |
| `RepoContributor` | Recent committers + AI attribution. | `login`, `commits`, `aiCommits`, `lastActiveAt?`; `@@unique([repoId, login])` |
| `RepoTeam` | CODEOWNERS team ownership (backs the org [team rollup](org-intelligence/README.md)). | `slug` (`@org/team`), `ownedPaths`, `isDefaultOwner`, `source` (codeowners\|github_teams); `@@unique([repoId, slug])`. Parsed at scan time; the latest scan replaces the repo's whole set. |
| `Scan` | **The metered unit** — one persisted report. | `headSha?`, `overallScore`, `level`/`levelName`, `archetype`, `adoptionScore`/`rigorScore`, `posture`, `confidence`, `engineProvider`/`engineModel`, `headline`, JSON `strengths`/`risks`/`discrepancies`, nullable JSON `prStats`/`governance`/`commitActivity`, `scannedAt`; indexed `[repoId, scannedAt]` + `[repoId, headSha]` |
| `ScanDimension` | Per-scan D1–D9 breakdown. | `dimId`, `name`, `weight`, `score`, `signalScore`, `llmScore`, `summary`, JSON `evidence`/`strengths`/`gaps` |
| `Recommendation` | Per-scan roadmap items, tracked as a backlog. | `title`, `dimId`, `impact`, `effort`, `rationale`, JSON `explore`, `levelUnlock?`, `status` (open\|in_progress\|done\|dismissed), `assigneeLogin?` (owner), `targetDate?` (due date); indexed `[scanId]`, `[status]`, `[assigneeLogin]` |
| `RecommendationEvent` | Append-only activity timeline for a recommendation (who changed status/assignee/due date, from → to, with a note) — the backlog's audit trail. | `recommendationId`, `actor?`, `kind` (status\|assignee\|target_date), `fromValue?`, `toValue?`, `note?`, `createdAt`; indexed `[recommendationId]`, `[createdAt]` |
| `AuditLog` | Compliance trail. | `orgId?` (null for anonymous public scans), `actorId?`, `action`, JSON `meta`, `at`; indexed `[orgId, at]` for keyset pagination |
| `Subscription` | Billing stub. | `orgId` (unique), `stripeId?`, `status` |
| `Goal` | Org maturity target ([plan](org-intelligence/plan.md)). | `label`, `metric` (overall\|adoption\|rigor\|D1–D9), `target`, `status` (active\|achieved\|archived) |
| `Initiative` | Scoped program of work. | `title`, `dimId`, `practiceId?`, `targetScore`, JSON `repos` (fullNames), `status` |

## Dedup & carry-forward (`src/lib/db/scans.ts`)

`persistScanReport()` upserts the full graph (Organization → Repository → Scan →
ScanDimension + Recommendation + RepoContributor + RepoTeam) and is the heart of the data layer:

- **Dedup by `(repoId, headSha)`** — re-scanning the same commit reuses the existing `Scan`
  and returns `deduped: true` (so [usage](usage.md) never double-counts).
- **Recommendation carry-forward** — `status`, `assigneeLogin`, and `targetDate` from the prior
  scan are matched onto the new scan's items by `dimId + title`, so marking a rec "done", assigning
  an owner, or setting a due date all survive a re-scan. (The per-item `RecommendationEvent` timeline
  is anchored to the scan's rows, so it begins fresh each scan while the carried state persists.)
- **Atomic & race-safe** — the org/repo upserts recover from a concurrent-insert `P2002` by
  re-reading the winner's row; the dedup + carry-forward read + write run under a process-local
  per-repo lock so two scans of the same repo can't double-insert; and the `Scan` graph,
  `RepoContributor` upserts, and `AuditLog` entry commit in one interactive `$transaction` (no
  half-written scan on a mid-way crash). The repo's `RepoTeam` set (CODEOWNERS attribution) is
  replaced inside the same transaction, so the latest scan is authoritative — a removed/renamed team
  can't linger in the team rollups.
- Returns a `PersistResult { scanId, deduped, headSha, failures }`.

Other key functions:

| Function | Role |
| --- | --- |
| `findScanByCommit` / `getScanReportByCommit` | Dedup lookup / reconstruct a full `ScanReport` from rows (used by cache, diff, alerts). |
| `getHeadHint` | Durable `headSha`/`headEtag` for cross-instance conditional requests. |
| `getRepositoryHistory` | Recent scans + per-dimension scores for trend charts. |
| `recordAudit` | Append an audit entry (returns false on write failure, never throws). |
| `getLatestRecommendations` / `updateRecommendation` (+ `updateRecommendationStatus`) / `getRecommendationEvents` | Recommendations API backing — read, apply a status/assignee/due-date patch (recording a `RecommendationEvent`), and read an item's activity timeline. |
| `getOrgBacklog` (`org.ts`) | The org-wide recommendation backlog — actionable items from the fleet's latest scans grouped by owner and by due-date bucket, with overdue/due-soon counts. |

Org/plan/usage/retention/installation queries live in sibling modules
(`org.ts`, `plan.ts`, `usage.ts`, `retention.ts`, `installations.ts`); `src/lib/db/index.ts`
is the barrel that re-exports them. `src/lib/db/client.ts` provides the lazy
`getPrisma()` singleton + `isDbConfigured()`, plus the DSQL token-refresh helpers
`withDb()` / `reconnectDb()` / `dbHealthCheck()`.

> On Aurora DSQL the connection password is a **short-lived IAM token** (~15 min TTL), so a
> client cached from one static URL goes dead minutes after deploy. Setting `DSQL_ENDPOINT`
> switches `client.ts` into a connection factory: it mints the token (via
> `@aws-sdk/dsql-signer`), rebuilds the client from a fresh token before the TTL elapses
> (`getPrisma()` kicks a background refresh inside the refresh margin), and reconnects on an
> auth-expiry error — `withDb(op)` retries the op once after a reconnect, and `GET /api/health`
> (`dbHealthCheck()`) self-heals an expired-token client. Static/local Postgres is unchanged
> (one client, never expires). See [ARCHITECTURE.md](../ARCHITECTURE.md) §3-4.

## Key files

| File | Role |
| --- | --- |
| `prisma/schema.prisma` | The 14-model schema (DSQL-safe). |
| `src/lib/db/client.ts` | Lazy Prisma singleton + `isDbConfigured()`. |
| `src/lib/db/index.ts` | Barrel re-export of the data layer. |
| `src/lib/db/scans.ts` | Persist/dedup/history/audit/recommendations. |
| `src/lib/db/{org,plan,usage,retention,installations}.ts` | Feature-specific queries (linked from their docs). |

## Known gaps

- **No FK cascades** (`relationMode = "prisma"`) — children must be deleted before parents
  (the [purge](cron-and-retention.md) job does this explicitly).
- **Stripe billing is a stub** — `Subscription` exists but isn't wired.
- **Org invites / role enforcement** — `User`/`Membership` exist but aren't used by a
  permission flow yet.
