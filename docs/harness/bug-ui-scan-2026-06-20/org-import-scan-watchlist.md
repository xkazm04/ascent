> Total: 4 findings (1 critical, 0 high, 2 medium, 1 low)

# Org Import, Scan & Watchlist — combined bug+ui scan

## 1. /api/org/import never calls requireOrgAccess — cross-tenant credit drain + watchlist/dashboard pollution
- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: authorization / broken tenant isolation
- **File**: src/app/api/org/import/route.ts:116
- **Scenario**: A signed-in viewer (member of org A, or under the Supabase wall *any* free account) POSTs `{ org: "victim", mock: false, repos: ["someowner/publicrepo", ...] }`. The login wall at line 116 only checks `getViewer()` (is *anyone* signed in), not membership of `victim`. `sessionOwnsOrg` (line 77) is consulted *only* to decide token minting, so for a non-member it simply falls through to the `noAmbientToken` path and keeps going. The route then calls `checkScanEntitlement("victim")` / `consumeScanCredit("victim", …)` — debiting the victim org's prepaid credits — and `setRepoWatch("victim", …)` + `setRepoSchedule("victim", …)`, injecting attacker-chosen repos and scores into the victim's watchlist/dashboard. On an auth-off deploy the same writes are reachable fully anonymously. The default path (`mock:true`, `watch:true`) pollutes any org's watchlist even without spending credits.
- **Root cause**: The route assumes the *only* trust boundary worth gating is private-repo token minting (which it does gate via `sessionOwnsOrg`). But credit spend and watchlist/schedule/Repository writes are themselves mutating, tenant-scoped operations. Its sibling mutating routes (`/api/org/scan`, `/api/org/watch`, `/api/org/schedule`) all call `requireOrgAccess(org)` at the top; import is the lone mutating org endpoint that does not, so the per-handler authz model (no Next middleware — authz.ts says auth must be enforced per-handler) has a hole.
- **Impact**: Cross-tenant financial DoS (drain a competitor's prepaid scan credits by naming public repos), plus cross-tenant write — arbitrary repos/scores/schedules planted in another org's dashboard. Confused-deputy on the money + data-integrity boundary.
- **Fix sketch**: Add `const denied = await requireOrgAccess(org); if (denied) return denied;` right after the `org` is resolved (after the `!org` 400). Keep the existing `sessionOwnsOrg` token-mint gate as the second, finer layer. `requireOrgAccess` already leaves `public` and auth-off open, so the free/seeding funnel is preserved; only writes into a *real* tenant now require membership. Note the metered login wall at 116 becomes redundant once requireOrgAccess runs (it subsumes the 401).

## 2. Explicit repos[] list bypasses the per-call batch cap (unbounded fan-out)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: resource exhaustion / missing bound
- **File**: src/app/api/org/import/route.ts:141
- **Scenario**: The `count` clamp (`Math.min(100, …)`, line 64) only governs the `listOrgRepos` discovery branch. When `body.repos` is supplied (line 141), every entry is mapped and scanned with no length cap — the route header's "up to 100 GitHub ingests per call" (line 49) is false for explicit lists. On the public/mock funnel (no credit cap) a single request with `repos` of thousands of entries runs `scanRepository` over all of them until the 300s `maxDuration` ceiling is hit, maximizing GitHub-ingest + (if non-mock) LLM pressure per allowed request. The 3/min/IP rate limit caps *requests*, not items per request.
- **Root cause**: The cap was applied to the discovered set, not to the union of both repo sources; the explicit `repos[]` path was assumed to be small (an onboarding selection) but is attacker-controllable.
- **Impact**: Per-request work amplification — a few rate-limited requests can each pin a function for the full 300s and hammer GitHub/the LLM provider. `/api/org/watch` already caps its bulk path at `MAX_BULK = 500`; import has no equivalent.
- **Fix sketch**: After building `fullNames` from `body.repos`, cap it: `fullNames = fullNames.slice(0, count)` (or a dedicated `MAX_IMPORT_REPOS`), and surface a `notice` when truncated so the client knows the batch was clipped. Update the line-49 comment to match.

## 3. /api/org/repos is unauthenticated and unrate-limited while spending the shared operator token
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: rate limiting / abuse surface
- **File**: src/app/api/org/repos/route.ts:14
- **Scenario**: `GET /api/org/repos?org=X&count=50` is anonymous and calls `listOrgRepos(org, count, process.env.GITHUB_TOKEN)` with no `rateLimitRequest` guard. A script can loop arbitrary `org` values and burn the shared operator PAT's GitHub REST budget; once exhausted, the listing returns 429 to *every* user (the route even maps that to a 429 surface, line 27). Its expensive sibling `/api/org/import` is rate-limited (ORG_IMPORT_RATE_LIMIT) precisely because it spends GitHub budget; this listing endpoint spends the same budget per call but is ungated.
- **Root cause**: The route was treated as a cheap public listing, but each call is a real authenticated GitHub API spend against a single shared token — a depletable global resource.
- **Impact**: A single client can degrade org-repo listing app-wide (rate-limit DoS on the shared token), with no per-IP/global backstop.
- **Fix sketch**: Apply the existing limiter, e.g. `const rl = rateLimitRequest(request, SCAN_RATE_LIMIT)` (or a new `ORG_REPOS_RATE_LIMIT`); return `tooManyRequests(rl.retryAfterSec)` when over. Reuses the shared in-memory limiter already imported by the import route.

## 4. Import SSE `index` is read before increment across concurrent lanes → jumpy/duplicate progress
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: progress fidelity
- **File**: src/app/api/org/import/route.ts:206
- **Scenario**: Inside the `mapPool` (concurrency 4) lane, the pre-scan progress event sends `index: scanned` (line 206, and again at 195) *before* this repo's work and before the post-scan `scanned += 1` (line 242). Because each lane awaits `scanRepository`/`persistScanReport` between reading and incrementing, several lanes emit `index:` with the same (or out-of-order) value, so a live progress UI keyed on `index` sees the counter stall, repeat, or jump rather than climb monotonically. The final `scanned`/`total` are correct; only the streamed `index` is misleading.
- **Root cause**: The counter is a shared mutable read-before-write in a concurrent fan-out; the "single-threaded lanes — race-free" comment (line 180) holds for the *final* total but not for the interim `index` snapshot each lane reports.
- **Impact**: Cosmetic — choppy/duplicated "scanning N/total" during a fleet import; no data issue.
- **Fix sketch**: Emit a monotonically increasing progress index from a dedicated `let emitted = 0; …; index: ++emitted` taken at send time, or attach `mapPool`'s lane index, instead of reading the shared `scanned` before its own increment. Mirror the same in `/api/org/scan` (`done`) which has the identical pattern.
