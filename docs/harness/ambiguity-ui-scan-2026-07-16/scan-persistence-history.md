# Scan Persistence & History — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. getLatestRecommendations is the FOURTH public-org reader missing the private-repo guard
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/lib/db/scans-read.ts:709-713`
- **Scenario**: `getRepositoryHistory` (line 257), `getScanComparison` (line 439), and `getScanReportByCommit` (line 852) all carry the defense-in-depth guard `if (orgSlug === DEFAULT_ORG_SLUG && repo.isPrivate) return null;` — the comment at line 438 even claims "the third twin reader was the only public-org read path missing it". But `getLatestRecommendations` resolves the same org→repo→scan chain, has the same public-fallback recursion (a member-scoped miss retries under `"public"`), and performs no `isPrivate` check before returning recommendation titles, rationales, assignees, and target dates.
- **Root cause**: The guard was retrofitted reader-by-reader; the recommendations reader was overlooked, and the "third twin" comment recorded a completeness claim that is false.
- **Impact**: A legacy private-repo row persisted under the public org before the persist-side backstop (scans-persist.ts:86) — exactly the case the other three guards exist to backstop — serves its roadmap (rationale text can quote private code/evidence, plus internal assignee logins) to any anonymous visitor via the recommendations path.
- **Fix sketch**: Add the identical guard after the repo lookup in `getLatestRecommendations`, and correct the "third twin" comment in `getScanComparison` (or extract a shared `resolvePublicReadableRepo(owner, name, orgSlug)` helper so the guard cannot be forgotten a fifth time — `getRepoPassport` delegates gating to callers by documented contract, so it needs an explicit note either way).

## 2. Sha-less dedup keys on exact timestamp equality and silently bypasses the mock→live upgrade
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/lib/db/scans-persist.ts:207-218` (and `src/lib/db/scans-read.ts:74-88`)
- **Scenario**: When a report carries no `headSha`, dedup falls back to `findScanByScannedAt(repoId, new Date(report.scannedAt))` — equality on a millisecond timestamp. The code's own comment admits "equality dedup on a high-precision timestamp is inherently fragile — a stable content/idempotency key would be the authoritative fix (tracked as a follow-up)". Two hidden assumptions ride on it: (a) the ISO string → JS Date → DB column round-trip preserves precision identically on both write and read paths (Postgres `timestamp` is microsecond-precision; any driver/serialization asymmetry makes dedup silently never match, or match a different report that truncated to the same ms); (b) the sha-less branch has NO equivalent of the `engineProvider === "mock"` upgrade check (lines 198-206) — a live sha-less re-persist that happens to share `scannedAt` with a mock row dedups to the mock row and returns its id as if it were the live scan. NOTE: this file is uncommitted user WIP — the finding is WIP-dependent.
- **Root cause**: `scannedAt` is a proxy identity for "the same computed report"; the real identity (content hash / idempotency key) was deferred, and the upgrade rule was only wired into the sha branch.
- **Impact**: Duplicate sha-less Scan rows on every persist if precision ever drifts (billing + history noise), or — the inverse failure — a live result discarded in favor of a mock placeholder with no `upgraded` signal.
- **Fix sketch**: Land the acknowledged follow-up: persist a content/idempotency key (hash of repo + dimensions + scores) with a unique index, and mirror the mock-upgrade branch (`existing.engineProvider === "mock" && report.engine.provider !== "mock"` → fall through to replace) in the sha-less path meanwhile.

## 3. PersistResult.failures is a dead field that always reports success
- **Severity**: Medium
- **Category**: trade-off-undocumented
- **File**: `src/lib/db/scans-persist.ts:33-38` (shape), `:204`, `:216`, `:462` (hardcoded values)
- **Scenario**: `PersistResult.failures: { audit: boolean; contributors: number }` promises per-area partial-write reporting, but every return site hardcodes `{ audit: false, contributors: 0 }`. The doc comment explains it is "retained for backward compatibility with callers that still inspect them" — yet nothing records whether such callers exist, and the field's type invites new callers to write `if (result.failures.audit) …` branches that are provably dead.
- **Root cause**: The atomicity refactor (everything commits in one transaction) made the field meaningless, but the API surface was frozen instead of deprecated, and the trade-off (keep a lying field vs. break callers) was decided without recording who the callers are.
- **Impact**: New code can build retry/alerting logic on a signal that can never fire; readers of the type get false confidence that partial failures are surfaced rather than thrown. Note `syncTechStackGroups` (line 454) IS a genuine best-effort post-commit step whose failure is log-only — exactly the kind of thing `failures` claims to report but doesn't.
- **Fix sketch**: Grep call sites; if none inspect it, remove the field (or mark `@deprecated always success — a partial failure throws`). If a real partial-failure channel is wanted, repurpose it for the post-commit best-effort steps (tech-group sync, cache invalidation) that actually can fail independently.

## 4. Inconsistent DB-down degradation: three readers degrade to null, four throw
- **Severity**: Medium
- **Category**: trade-off-undocumented
- **File**: `src/lib/db/scans-read.ts:108` (wrapped) vs `:233`, `:414`, `:698`, `:827` (unwrapped)
- **Scenario**: `getHeadHint`, `getRepoPassport`, and `getPublicScanGallery` wrap their reads in `dbReadSafe(…, null)` so a configured-but-unreachable DB degrades to null (with detailed comments justifying each). `getRepositoryHistory`, `getScanComparison`, `getLatestRecommendations`, and `getScanReportByCommit` issue raw `getPrisma()` reads — a `PrismaClientInitializationError` (or DSQL IAM-token expiry, which `dbReadSafe` also recovers) propagates and 500s the report/history/comparison pages. Every one of these functions' doc comments says "null when persistence is off", so callers already handle null — but whether a DB outage should 500 the report page or render the "not scanned" fallback was decided implicitly, differently per function, with no recorded reasoning for the split.
- **Root cause**: `dbReadSafe` was retrofitted onto the routes where an outage was actually observed (public homepage, scan funnel); the remaining readers never had the question asked.
- **Impact**: During a DB blip, the landing page degrades gracefully while a report permalink hard-500s; the token-expiry recovery `withDb` gives the persist path is also absent, so a thawed serverless instance fails its first read. Support-wise the same outage presents as two different symptoms.
- **Fix sketch**: Either wrap the four remaining readers in `dbReadSafe(…, null)` (callers already treat null as "no data"), or record the deliberate trade-off ("a report permalink SHOULD 500 rather than claim 'never scanned'") in a comment at the first unwrapped reader — one line resolves the ambiguity either way.

## 5. Reconstructed reports fabricate `forks: 0` and `defaultBranch: ""` as if they were data
- **Severity**: Low
- **Category**: magic-number
- **File**: `src/lib/db/scans-read.ts:949-951`
- **Scenario**: `getScanReportByCommit` rebuilds a `ScanReport` whose `repo.forks` is hardcoded `0` and `repo.defaultBranch` is `""` — neither column is persisted. Unlike contributors (deliberately blanked with a documented rationale, lines 884-891) and warnings (persisted precisely so a reloaded scan "keeps its disclosure"), these two placeholders carry no comment and are typed as real values (`forks: number`), so a consumer rendering "0 forks" or building a branch URL from `""` has no way to distinguish "unknown" from a genuine zero/empty.
- **Root cause**: The `ScanReport` type requires the fields; the reconstruction path filled them with falsy literals instead of widening the type or persisting the values, and the trade-off went unrecorded.
- **Impact**: A pinned permalink can display a fork count of 0 for a 10k-fork repo (the same "silently assert wrong data" failure the contributor blanking explicitly avoids), and any `github.com/{owner}/{repo}/tree/{defaultBranch}` link built from the snapshot is malformed.
- **Fix sketch**: Persist `forks`/`defaultBranch` on the Repository row alongside `stars` (they arrive in the same GitHub payload), or make the fields optional in `ScanReport` and let the UI render "—"; at minimum, add the same style of comment the contributor blanking has so the placeholder is a documented decision.
