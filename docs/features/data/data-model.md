# Persistence & data model

Ascent's MVP is stateless — a scan needs no database. Everything Phase 2+ (history, org
rollups, recommendations tracking, usage, audit, planning, memory, skills, integrations)
layers on the **optional** Prisma persistence layer in `prisma/schema.prisma` + `src/lib/db/`.
When `DATABASE_URL` is unset, `isDbConfigured()` returns false and DB-backed features degrade
to empty/notice states rather than erroring.

The schema now defines **40 models**. It is **DSQL-safe by design** so the same migrations run
on local Postgres and Amazon Aurora DSQL (see the header comment in `prisma/schema.prisma`):

- `relationMode = "prisma"` — **no foreign-key constraints** emitted (DSQL has none);
  relations enforced at the Prisma layer, so relation scalar fields carry manual `@@index`.
- **UUID primary keys** (`@default(uuid())`) — no `SERIAL`/sequences.
- Bulky string arrays/objects stored as **serialized JSON in text columns** (no `jsonb`
  dependency); queryable fields (scores, level, timestamps) stay real columns so
  trend/history queries remain relational.
- On DSQL, indexes are created asynchronously (`CREATE INDEX ASYNC ...`); see
  [ARCHITECTURE.md](../../ARCHITECTURE.md).

## Models by feature area

Grouped by the owning context in `context-map.json`, not schema declaration order. Field
lists are the notable/queryable ones — see `prisma/schema.prisma` for the full definition and
inline comments (most models carry a multi-line design-rationale comment there).

### Tenancy, membership & billing

| Model | Purpose | Notable fields |
| --- | --- | --- |
| `Organization` | Tenant root — also the GitHub App installation record. `kind` distinguishes an `org` fleet from a `personal` workspace (a lens over the shared public corpus, never a copy). | `slug` (unique), `plan` (free\|pro\|team\|enterprise), `kind` (org\|personal), `scanCredits`, `retentionMaxScans?`/`retentionAuditDays?`, `alertWebhookUrl?`, `alertOverallDrop?`/`alertDimensionDrop?`, `gatePolicy?` (JSON), `brandName?`/`brandColor?`/`logoUrl?`, `githubInstallId?` |
| `User` | A known login (GitHub-OAuth/App identity), bridged to `Membership` for RBAC. | `email` (unique), `githubLogin?` (unique) |
| `Membership` | Org ↔ user ↔ role. | `role` (owner\|admin\|member\|viewer), `alertsSeenAt?` (per-user "last looked at the fleet" watermark); `@@unique([orgId, userId])` |
| `Invite` | A single-use pending invitation to join at a role, consumed by `acceptInvite`. | `token` (unique), `githubLogin?`/`email?` (optional pin), `role`, `status` (pending\|accepted\|revoked), `expiresAt` |
| `Subscription` | Billing stub (Stripe field names; Polar is the active checkout — see below). | `orgId` (unique), `stripeId?`, `status` |
| `CreditLedger` | Append-only ledger behind `Organization.scanCredits` — one row per grant or per-scan debit, each stamping the resulting balance. | `delta`, `balanceAfter`, `reason` (scan\|grant\|polar\|adjustment\|refund), `repoFullName?`, `scanId?`, `externalId?` (unique, Polar order-id idempotency key) |

### Repositories, scans & scoring

| Model | Purpose | Notable fields |
| --- | --- | --- |
| `Repository` | A tracked repo within an org. | `fullName` (unique per org), `isPrivate`, `primaryLanguage?`, `techStackJson?`/`passportJson?` (latest cached, display-only), `passportOverridesJson?` (owner overlay), `stars`, `headSha?`/`headEtag?` (conditional-request scan cache), `watched`, `scanSchedule` (off\|daily\|weekly\|monthly), `lastScanAt?`/`nextScanAt?`, `lastScanStatus?`/`lastScanError?`/`lastScanAttemptAt?`, `aiConformance?` + related fields (`.ai/` doctor report), `missingSince?` (flag only — reconciliation never unwatches) |
| `Scan` | **The metered unit** — one persisted report. | `headSha?`, `overallScore`, `level`/`levelName`, `archetype`, `adoptionScore`/`rigorScore`, `posture`, `confidence`, `engineProvider`/`engineModel`, `headline`, JSON `strengths`/`risks`/`discrepancies`, nullable JSON `prStats`/`governance`/`commitActivity`/`techStackJson`/`passportJson`/`warningsJson`/`aiUsageJson`, `rubricVersion?` (self-invalidation), `engineByom?` (whose AWS account ran inference), `inputTokens?`/`outputTokens?`/`llmLatencyMs?` (cost/usage metering), `scannedAt`; `@@unique([repoId, headSha])` is also the cross-instance dedup backstop |
| `ScanDimension` | Per-scan D1–D9 breakdown. | `dimId`, `name`, `weight`, `score`, `signalScore`, `llmScore`, `summary`, JSON `evidence`/`strengths`/`gaps` |
| `RepoContributor` | Recent committers + AI attribution — a per-repo latest-scan snapshot (replaced wholesale each scan, not accumulated). | `login`, `commits`, `aiCommits`, `lastActiveAt?`; `@@unique([repoId, login])` |
| `AiChange` | One AI-attributed pull request as an **evidence row**, not a rate — the population behind `prStats.aiInvolvedRate` / `aiGovernedRate`. Answers "show me the AI-assisted changes in the period and who approved each one", which a percentage structurally cannot. Extracted from the PR nodes ingest already fetches (no extra GitHub calls). | `prNumber`, `authorLogin?`, `authorIsBot`, `aiSignal` (`authored`\|`marked`), `aiTools`, `state`, `approved`, `approverLogin?`, `approvedAt?`, `reviewCount`; `@@unique([repoId, prNumber])`. **Upserted, not replaced** — a sliding PR window must not discard evidence that aged out of the latest page. Empty on tokenless scans (PRs aren't observable), which never means "no AI changes". Logins are internal; customer-facing exports pseudonymize unless the org opts into named evidence. |
| `RepoTeam` | A team owning part of a repo, parsed from CODEOWNERS at scan time — backs the org team rollup. | `slug` (normalized `@org/team`), `ownedPaths`, `isDefaultOwner`, `source` (codeowners\|github_teams); `@@unique([repoId, slug])`. The latest scan replaces the repo's whole set. |
| `TeamStandingSnapshot` | Team-standings snapshot captured as a durable output of a full org scan, so the leader/laggard decomposition can be trended over time (fully deterministic, no LLM). | `teamCount`, `fleetAvgOverall`, `spread`, `leaderSlug`/`leaderScore`, `laggardSlug`/`laggardScore`, `standingsJson` |
| `TechStackGroup` | Auto-derived tech-stack grouping (frontend/backend:\<lang\>/mobile/data_ml/infra/library), maintained per scan — parallel to the user-owned `Segment`, deliberately kept separate. | `key`, `label`; `@@unique([orgId, key])` |
| `TechStackGroupMember` | Repo ↔ tech-stack-group join (multi-membership: a fullstack repo can be in several groups). | `@@unique([groupId, repoId])` |

### Recommendations & backlog

| Model | Purpose | Notable fields |
| --- | --- | --- |
| `Recommendation` | Per-scan roadmap item, tracked as a backlog entry. | `title`, `dimId`, `impact`/`effort`, `rationale`, JSON `explore`, `levelUnlock?`, `status` (open\|in_progress\|done\|dismissed), `assigneeLogin?`, `targetDate?` — the last three carry forward across re-scans (matched by dimId+title) |
| `RecommendationEvent` | Append-only activity timeline for a recommendation (status/assignee/due-date changes, who + from→to + note) — the backlog's audit trail, written in the same transaction as the mutation. | `actor?`, `kind` (status\|assignee\|target_date), `fromValue?`/`toValue?`, `note?` |
| `RecommendationOverlay` | A **personal-workspace** overlay on a shared public-corpus recommendation (individual tier) — one viewer's private status/note on a public repo's rec, keyed by stable identity (`repoFullName`+`dimId`+`title`) so it survives re-scans without pointing at a scan-bound row. | `orgId` (the personal org), `repoFullName`, `dimId`, `title`, `status`, `targetDate?`, `note`; `@@unique([orgId, repoFullName, dimId, title])` |
| `ImprovementPr` | One improvement PR opened from the live-wall ship loop after an owner accepted a triaged recommendation — carries identify→triage→PR→merge→rescan→impact through to a score verification. | `repoFullName`, `practiceId`, `dimId`, `recommendationId?`, `prNumber`/`prUrl`, `state` (open\|merged\|closed), `baselineScanId?`/`verifiedScanId?`, `impactDim?`/`impactOverall?`; `@@unique([orgId, repoFullName, practiceId])` |

### Segments, playbooks & planning

| Model | Purpose | Notable fields |
| --- | --- | --- |
| `Segment` | A user-defined, uniquely-named repo tag within an org (e.g. "platform", "mobile") — every org aggregate accepts an optional segment filter. | `name`, `color`; `@@unique([orgId, name])` |
| `RepoSegment` | Repo ↔ segment join. | `@@unique([segmentId, repoId])` |
| `Goal` | A maturity target an org is steering toward; progress is derived at read time from the fleet's latest scans (no stored snapshot). | `label`, `metric` (overall\|adoption\|rigor\|D1–D9), `target`, `targetDate?`, `status` (active\|achieved\|archived), `achievedAt?` |
| `Initiative` | A tracked, scoped program of work — typically "bring these N repos up to \<target\> on \<dimension\>". | `title`, `dimId`, `practiceId?`, `targetScore`, JSON `repos` (fullNames), `status`, `assigneeLogin?`, `targetDate?`, `goalId?`, `playbookId?` |
| `Playbook` | An org-authored best-practice standard for a dimension (distinct from the derived Practice Library, which is inferred from scans). | `title`, `dimId`, `summary`, JSON `steps`, `archived`, `version` (bumped on content edit) |
| `PlaybookApplication` | Records a playbook applied to a repo — the explicit adoption signal for lift analytics. | `playbookId`, `repoFullName`, `appliedVersion?`; `@@unique([playbookId, repoFullName])` |

### Audit, security & decisions

| Model | Purpose | Notable fields |
| --- | --- | --- |
| `AuditLog` | Compliance trail. Tamper-**evident**: every write folds a per-row HMAC into `meta._sig`, and every read recomputes it (see below). | `orgId?` (null for anonymous public scans), `actorId?`, `action`, JSON `meta` (incl. `_sig`), `at`; indexed `[orgId, at]` for keyset pagination |
| `OrgDecision` | A human decision on a derived, recomputed-every-render finding (a failing check, a solo-maintained repo, a passport blocker) — the state layer that lets a rail badge's count actually go down. Upsert on `(orgId, module, itemKey)`; `itemKey` must be the finding's deterministic identity. | `module` (security\|teams\|passports\|contributors), `itemKey`, `status` (open\|accepted\|dismissed\|snoozed), `rationale`, `title`, `decidedBy?`, `memoryId?` (the `OrgMemory` row it writes through to), `snoozedUntil?`; `@@unique([orgId, module, itemKey])` |

#### Audit-trail tamper-evidence (sign on write, verify on read)

`src/lib/db/audit-integrity.ts` is the whole mechanism; it is migration-free (no new column) and
inert when no `AUDIT_SIGNING_SECRET` / `AUTH_SECRET` is set.

1. **Write** — `recordAudit` / `claimOrgAuditOnce` stamp `at` explicitly, then `withAuditSignature()`
   folds an HMAC-SHA256 over the canonical `(action, orgId, actorId, createdAt, meta)` into
   `meta._sig`. The secret never leaves the server; each row is independently verifiable (no chain,
   so concurrent writers can't fork it).
2. **Read** — `getAuditLog` recomputes the HMAC per row and attaches an `integrity` verdict to every
   `AuditLogEntry`. One HMAC over a few hundred bytes per row, so a 25-row page stays a cheap read
   and the 10k-row CSV cap costs single-digit milliseconds.
3. **Surface** — both consumers of that one verdict: the org dashboard viewer
   (`components/org/audit/`) renders an Integrity badge per row plus a banner when any row is
   `tampered`, and `/api/audit?format=csv` exports an `integrity` column alongside the raw `_sig`
   and `orgId`, so the filed artifact states its own verdict *and* stays independently re-verifiable.

| Verdict | Meaning |
| --- | --- |
| `ok` | Recomputed signature matched — the row is unchanged since it was written. |
| `tampered` | Signature MISMATCH — the row was altered at rest (e.g. edited directly in the DB). |
| `unsigned` | No `_sig` at all: a row written before signing landed. **Expected, not an alarm** — rendering these as `tampered` would fire on every legacy row and train reviewers to ignore the badge. |
| `no-secret` | The deployment configures no signing secret, so nothing can be verified. The UI hides the column entirely rather than showing a column of non-answers. |

A file-level SHA-256 of the CSV bytes also ships in the `x-ascent-content-sha256` response header —
that proves the *download* wasn't edited; the per-row `_sig` proves the *rows* weren't.

### Org knowledge & skills

| Model | Purpose | Notable fields |
| --- | --- | --- |
| `OrgMemory` | Shared, agent-readable org knowledge store (Memory-as-a-Service). Anti-poisoning triad: `source`+`createdBy` (provenance), `confidence` (trust score), `supersededBy` (a correction writes a new row, never overwrites). | `namespace?`, `content` (≤20KB), `kind` (episodic\|semantic\|procedural\|summary), `visibility` (shared\|private), `confidence` (0..1), JSON `tags`, `supersededBy?`, `version`, `archived`, `accessCount`, `expiresAt?` |
| `OrgSkill` | Org Skills Library — a categorized catalog of reusable Claude/LLM skill assets authored in-app. Distinct from `SkillGeneration` (the per-repo onboarding generator). | `name` (unique per org, ≤200 chars), `description`, `content` (≤50KB), `category`, JSON `tags`, `version`, `contentHash` (sha256, sync-manifest diff key), `archived`, `downloadCount` |
| `OrgSkillAdoption` | Records a repo adopting a skill — the explicit reuse signal (mirrors `PlaybookApplication`). | `skillId`, `repoFullName`, `adoptedBy?`; `@@unique([skillId, repoFullName])` |
| `OrgSkillDownload` | One rolling download/use tally row per skill — the denormalized hot sort key for "most used". | `count`, `lastSeen`; `@@unique([skillId])` |
| `OrgSkillEvent` | Append-only per-use event (download\|sync\|invoke) for slicing use rate by repo/type/source. | `type`, `repo?`, `source?` (cli\|hook\|ci\|web) |
| `OrgApiToken` | Org-scoped API token for machine access to the Skills Library. Only the SHA-256 hash is stored — the raw value is shown once at creation. | `name`, `tokenHash`, `tokenPrefix`, `scopes` (comma-joined), `revokedAt?` (soft-revoke) |

### LLM configuration & AI usage

| Model | Purpose | Notable fields |
| --- | --- | --- |
| `OrgLlmConfig` | Per-org connected LLM (BYOM) — one row per org, the org's own Bedrock provider so inference runs in their AWS account. Credentials only ever live encrypted. | `provider` (default "bedrock"), `enabled`, `modelId`, `region?`, `authMode`, `credentialsEncrypted?` (AES-256-GCM), `lastValidatedAt?`/`lastValidationError?`; `@@unique([orgId])` |
| `AiUsageRecord` | Normalized AI-usage records feeding the `/delivery` AI-ROI resolver. `scope=repo` carries measured per-repo spend (Claude Code OTel); `scope=org` an allocated total (Copilot/OpenAI) distributed to repos by git evidence. | `source` (claude-code\|copilot\|openai), `scope` (repo\|user\|team\|org), `scopeKey`, `periodStart`, `tokens`, `costCents`, `sessions`, `seats`, `fidelity` (measured\|allocated); `@@unique([orgId, source, scope, scopeKey, periodStart])` |

### Sessions, webhooks & quotas

| Model | Purpose | Notable fields |
| --- | --- | --- |
| `SessionRevocation` | Server-side session revocation — the signed cookie embeds a session version (`sv`) checked against this row; bumping it invalidates every outstanding token for a login immediately (logout, installation removal). | `login` (PK, lowercased GitHub login), `version` |
| `WebhookDelivery` | Cross-instance GitHub webhook replay/idempotency store — a row is a "claimed" mark for a delivery id, kept until `expiresAt`, deleted on a failed deferred process so GitHub can retry. | `id` (PK, `X-GitHub-Delivery`), `expiresAt` |
| `PublicScanQuota` | Soft weekly quota for anonymous public scans, keyed by a salted hash of the client IP (never the raw IP). Fails open if persistence hiccups. | `ipHash` (PK), `hits` (JSON epoch-ms array, trimmed to the rolling window) |
| `QuotaEvent` | Public-funnel abuse observability — a running tally bumped when a quota denial or rate-limit trip fires. | `kind` (quota_deny\|rate_limit), `scope`, `count`; `@@unique([kind, scope])` |
| `BadgeImpression` | Best-effort reach tally for the public README badge, one row per (repo, embedding host) — deliberately approximate (badges are CDN-cached). | `repoFullName` (lowercased), `refererHost` (lowercased, or "direct"), `count`; `@@unique([repoFullName, refererHost])` |
| `SkillGeneration` | A record of each onboarding-skill (SKILL.md) generation — which tracks targeted a repo's skill, at which commit, when. | `repoFullName`, `headSha?`, JSON `trackIds` |

## Dedup & carry-forward (`src/lib/db/scans-persist.ts`)

`scans.ts` is a thin barrel — the actual persist implementation lives in
`src/lib/db/scans-persist.ts` (with `scans-read.ts`, `scans-recommendations.ts`,
`scans-audit.ts`, `scans-shared.ts` as sibling themed modules). `persistScanReport()` upserts
the full graph (Organization → Repository → Scan → ScanDimension + Recommendation +
RepoContributor + RepoTeam) and is the heart of the data layer:

- **Dedup by `(repoId, headSha)`** — re-scanning the same commit reuses the existing `Scan`
  and returns `deduped: true` (so [usage](../billing/usage.md) never double-counts). A
  sha-less report falls back to deduping on `scannedAt`.
- **Engine upgrade (mock → live)** — if the only existing scan for a commit is the
  deterministic `mock`-engine floor and the new report is a real graded scan, the mock row is
  deleted and replaced in the same transaction (`upgraded: true`), rather than being kept
  forever or silently discarded.
- **Recommendation carry-forward** — `status`, `assigneeLogin`, and `targetDate` from the
  prior scan are matched onto the new scan's items via a tiered matcher (`matchRecommendations`:
  exact dim+title → dim+normalized title → unambiguous dimension), so marking a rec "done",
  assigning an owner, or setting a due date all survive a re-scan even though the raw LLM
  title isn't stable across live scans. The per-item `RecommendationEvent` timeline is
  anchored to the scan's rows, so it begins fresh each scan while the carried state persists.
- **Head pointer discipline** — `Repository.headSha`/`headEtag`/`lastScanAt` only advance once
  a scan is durably persisted (post-commit, or after a resolved race), and only when the new
  report is newer — never rolled back by a delayed/replayed older scan.
- **Atomic & race-safe** — the org id is resolved once per process and cached (`ensureOrgId`)
  rather than upserting the shared `public` org row on every scan; the repo upsert runs
  through `upsertRacing` so a concurrent create loses with a `P2002` and re-reads the winner;
  every write is wrapped in `withRetry` so a DSQL serialization/OCC conflict is retried with
  exponential backoff + full jitter; the dedup + carry-forward read + write run under a
  process-local per-repo lock (`withRepoLock`); and the scan graph, `RepoContributor` replace,
  `RepoTeam` replace, and `AuditLog` entry commit in one interactive `$transaction` (no
  half-written scan on a mid-way crash). A cross-instance same-commit race that still slips
  past the lock is caught by the `@@unique([repoId, headSha])` constraint (`P2002` → re-read
  the winner and treat it as a dedup).
- Returns a `PersistResult { scanId, deduped, upgraded?, headSha }`.

Other key functions (from the sibling modules, re-exported through the `scans.ts` barrel):

| Function | Role |
| --- | --- |
| `findScanByCommit` / `getScanReportByCommit` | Dedup lookup / reconstruct a full `ScanReport` from rows (used by cache, diff, alerts). |
| `getHeadHint` | Durable `headSha`/`headEtag` for cross-instance conditional requests. |
| `getRepositoryHistory` | Recent scans + per-dimension scores for trend charts. |
| `getScanComparison` | Diffs two scans' dimensions/recommendations for the compare view. |
| `getPublicScanGallery` | Public-corpus scan cards for the leaderboard/gallery. |
| `recordAudit` / `recordOrgAudit` / `getAuditLog` | Append an audit entry (signing it) / read the paginated audit log (verifying each row). |
| `getLatestRecommendations` / `updateRecommendation` / `getRecommendationEvents` | Recommendations API backing — read, apply a status/assignee/due-date patch (recording a `RecommendationEvent`), and read an item's activity timeline. |
| `getOrgBacklog` (`org.ts`) | The org-wide recommendation backlog — actionable items from the fleet's latest scans grouped by owner and by due-date bucket, with overdue/due-soon counts. |

Org/plan/usage/retention/installation/memory/skills queries live in sibling modules under
`src/lib/db/` (`org.ts`, `plan.ts`, `usage.ts`, `retention.ts`, `installations.ts`,
`org-memory.ts`, `org-skills.ts`, and others); `src/lib/db/index.ts` is the barrel that
re-exports them. `src/lib/db/client.ts` provides the lazy `getPrisma()` singleton +
`isDbConfigured()`, plus the DSQL token-refresh helpers `withDb()` / `reconnectDb()` /
`dbHealthCheck()`. `src/lib/db/mode.ts` reports which backend is actually live
(`getDbMode()`: `pglite` (local dev, in-process) → `dsql` → `postgres` → `disabled`, checked
in that precedence) for an honest "served live from …" UI indicator.

> On Aurora DSQL the connection password is a **short-lived IAM token** (~15 min TTL), so a
> client cached from one static URL goes dead minutes after deploy. Setting `DSQL_ENDPOINT`
> switches `client.ts` into a connection factory: it mints the token (via
> `@aws-sdk/dsql-signer`), rebuilds the client from a fresh token before the TTL elapses
> (`getPrisma()` kicks a background refresh inside the refresh margin), and reconnects on an
> auth-expiry error — `withDb(op)` retries the op once after a reconnect and also retries a
> DSQL optimistic-concurrency/serialization conflict (`40001`/`P2034`/`OC###`) with backoff,
> and `GET /api/health` (`dbHealthCheck()`) self-heals an expired-token client. A swapped-out
> client is retired (not disconnected) after `RETIRE_CLIENT_GRACE_MS` (300s) so in-flight
> queries can drain. Static/local Postgres is unchanged (one client, never expires); local dev
> can instead run an embedded in-process PGlite via a driver adapter (`instrumentation.ts`),
> which overrides the datasource URL entirely. See [ARCHITECTURE.md](../../ARCHITECTURE.md) §3-4.

## Key files

| File | Role |
| --- | --- |
| `prisma/schema.prisma` | The 40-model schema (DSQL-safe). |
| `src/lib/db/client.ts` | Lazy Prisma singleton, DSQL token refresh/retry, `isDbConfigured()`. |
| `src/lib/db/mode.ts` | Reports the live backend (`dsql`\|`postgres`\|`pglite`\|`disabled`). |
| `src/lib/db/index.ts` | Barrel re-export of the data layer. |
| `src/lib/db/scans.ts` | Thin barrel re-exporting the scans-* sub-modules. |
| `src/lib/db/scans-persist.ts` | Persist/dedup/carry-forward (the module documented above). |
| `src/lib/db/scans-read.ts` / `scans-recommendations.ts` / `scans-audit.ts` / `scans-shared.ts` | History/comparison reads, recommendation patching, audit log, shared row↔report mapping. |
| `src/lib/db/{org,plan,usage,retention,installations,org-memory,org-skills}.ts` | Feature-specific queries (linked from their docs). |

## Known gaps

- **No FK cascades** (`relationMode = "prisma"`) — children must be deleted before parents
  (the [purge](./retention.md) job does this explicitly; `scans-persist.ts`
  does the same in-transaction for a mock→live scan upgrade).
- **Stripe billing is a stub** — `Subscription` exists with Stripe-shaped fields, but Polar is
  the actually-wired checkout/webhook path (`CreditLedger.externalId` carries the `polar:`
  idempotency prefix).
- Not verified in this pass: row counts/production data volumes, whether every model listed
  above has a corresponding `src/lib/db/*.ts` accessor module (several — e.g. `WebhookDelivery`,
  `PublicScanQuota` — are documented in-schema as accessed via raw SQL / no typed accessor).
