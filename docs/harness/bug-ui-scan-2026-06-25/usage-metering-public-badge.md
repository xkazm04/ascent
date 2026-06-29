# Usage Metering & Public Badge — Bug + UI Scan
> Context: Usage Metering & Public Badge (Billing, Credits & Metering)
> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. Unbounded badge-impression rows via spoofable Referer on an unthrottled cached path
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: state-corruption (storage exhaustion / write-amplification abuse)
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:287-316 · src/lib/db/badge-analytics.ts:15-29
- **Value**: impact 7 · effort 3 · risk 3
- **Scenario**: An attacker warms the cache for one valid public repo with a single request (the rate limiter at route.ts:290 only fires inside the `if (!report)` block). Every subsequent GET finds the cached report, skips the rate limiter entirely, and reaches `recordBadgeImpression(repo, refererHost(req))` at line 316. `refererHost` (line 202-210) derives the host from the client-controlled `Referer` header. Sending N requests with N distinct fake `Referer` values inserts N new `badgeImpression` rows (the upsert keys on `repoFullName_refererHost`, badge-analytics.ts:21-25) — one row per spoofed host, with no per-request throttle on this path.
- **Root cause**: The expensive-scan rate limit was placed only around `scanRepository`, but the DB write (`recordBadgeImpression`) sits on the always-executed post-cache path; row cardinality is driven by an unvalidated, spoofable header whose only bound is a 100-char truncation, not distinctness.
- **Impact**: Unbounded DB table growth (storage + cost) plus a write per origin hit; directly degrades the `/usage` "Badge reach" panel, which already does full distinct scans (see finding 3). Pure abuse amplification, no auth required.
- **Fix sketch**: Rate-limit the impression path independently of the scan path (or cap distinct hosts per repo, e.g. only `update` an existing (repo,host) row and refuse `create` past a per-repo host cap); optionally sample writes. Make unbounded host cardinality structurally impossible by bounding rows per repo.

## 2. `negCache` map grows unbounded — memory leak on a public, crawler-hammered endpoint
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption (memory leak)
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:56-69,373
- **Value**: impact 6 · effort 3 · risk 2
- **Scenario**: Every genuine miss (404/empty/invalid repo) calls `negSet(key)` (line 373), adding an entry to the module-level `negCache` Map. Entries are only ever removed inside `negGet` when that *same* key is queried again after expiry (line 61-64). Crawlers / abusers hitting many unique non-existent `owner/repo` paths (which pass `validName`) each add a key that is never re-queried, so it never expires-and-deletes. The Map grows without bound for the life of the process.
- **Root cause**: A TTL map implemented as lazy delete-on-read with no size cap and no periodic sweep, on an endpoint whose whole point is to absorb arbitrary public input.
- **Impact**: Slow memory growth → eventual OOM / GC pressure on long-lived server instances; an availability risk on the most-exposed unauthenticated route.
- **Fix sketch**: Bound `negCache` (LRU with a max size) or run a periodic sweep that drops expired entries; even a simple "evict oldest when size > N" makes growth impossible.

## 3. `getBadgeReach` loads every distinct host/repo row just to count them
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case (perf / memory at scale)
- **File**: src/lib/db/badge-analytics.ts:72-76
- **Value**: impact 5 · effort 3 · risk 2
- **Scenario**: `distinctHosts`/`distinctRepos` are computed as `hosts.length`/`repos.length` after `findMany({ distinct: [...] })` with no `take`. On a large public org (and finding 1 inflates exactly this table), these two queries stream every distinct host and every distinct repo string into Node memory purely to take `.length`. The "Badge reach" panel is rendered on the `/usage` billing page for the shared public org (page.tsx:129).
- **Root cause**: Using `findMany(distinct).length` as a count instead of a DB-side distinct count.
- **Impact**: Unbounded result size proportional to distinct cardinality; slow, memory-hungry render of a page that is supposed to degrade gracefully. Amplified by the row-growth abuse in finding 1.
- **Fix sketch**: Replace with a `COUNT(DISTINCT …)` raw query (or `groupBy` length is already paid for `topHosts`/`topRepos`, but the *total* distinct count needs a SQL count), and cap rows defensively.

## 4. Org slug not case-normalized before lookup → phantom-empty usage page
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case (inconsistent normalization)
- **File**: src/lib/db/usage.ts:92 · src/app/usage/page.tsx:83,126-131
- **Value**: impact 5 · effort 2 · risk 3
- **Scenario**: The page lowercases `org` for the day-cap and for the public-vs-private panel selection (`org.toLowerCase() === PUBLIC_ORG`, page.tsx:83,126-131), but `getUsageSummary` does `prisma.organization.findUnique({ where: { slug: orgSlug } })` with the raw, un-normalized slug (usage.ts:92). A user opening `/usage?org=Public` (or any mixed-case bookmark) is treated as the public org by the page logic, yet the DB lookup for slug `"Public"` misses the canonical `"public"` row and returns the `empty` summary — the page then renders "No scans metered yet" despite real data. The same raw-slug lookup path is shared by `/api/usage` (route.ts:47).
- **Root cause**: Two different code paths disagree on canonicalization — the cap/panel logic lowercases, the persistence lookup does not.
- **Impact**: Confusing, wrong "no usage" state for a perfectly valid org via a case variation in a user-controllable `?org=` param; billing/usage appears empty.
- **Fix sketch**: Normalize the slug once (lowercase/trim) at the entry of `getUsageSummary` (and `requireOrgRead`) before the `findUnique`, so every downstream check and the DB lookup agree on one canonical identity.

## 5. UsageTrend x-axis labels drift from their bars (justify-between over a filtered subset)
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: visual-consistency
- **File**: src/components/usage/UsageTrend.tsx:85-91
- **Scenario**: The bar row renders one `flex-1` bar per day (line 65), but the date labels render only a filtered subset (`i % labelEvery === 0 || i === last`, line 86-90) inside a `flex justify-between` container (line 85). `justify-between` spreads the filtered labels evenly across the full width, so they no longer sit under the bars they describe — and because the always-appended last label (e.g. index 29) lands right after a regularly-spaced one (e.g. index 28), the final two labels bunch at the right edge while the rest are evenly spread. A reader hovers a bar and the date beneath it is the wrong day.
- **Root cause**: Decoupling label positions (even spread) from bar positions (fixed per-day grid).
- **Impact**: Misleading axis — users misread which day a spike belongs to on any window where `labelEvery > 1` (≥9 days).
- **Fix sketch**: Render a label slot per day aligned to the same `flex-1` grid (empty for skipped days), or absolutely position each shown label at its bar's `index / (length-1)` offset, so labels track bars exactly.
