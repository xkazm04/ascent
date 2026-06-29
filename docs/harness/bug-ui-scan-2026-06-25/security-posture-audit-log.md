# Security Posture & Audit Log — Bug + UI Scan
> Context: Security Posture & Audit Log (Org Dashboard & Analytics)
> Total: 5 findings (0 critical, 1 high, 4 medium, 0 low)

## 1. `until` date filter silently drops the entire final day from the audit trail (and CSV export)
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: edge-case
- **File**: src/lib/db/scans-audit.ts:151-154 (driven by src/components/org/AuditLogViewer.tsx:164 and src/app/api/audit/route.ts:88)
- **Value**: impact 6 · effort 2 · risk 2
- **Scenario**: An auditor narrows the trail (or exports compliance evidence) with "until 2026-06-25". The `<input type="date">` yields the bare string `"2026-06-25"`; `getAuditLog` does `atFilter.lte = new Date(query.until)`, which parses to `2026-06-25T00:00:00.000Z` — UTC midnight at the *start* of the day. Every entry recorded on June 25 (`…T00:00:01`…`T23:59`) is `> lte` and excluded. The user asked for "through June 25" and silently gets nothing from June 25.
- **Root cause**: A date-only string is treated as an instant (start-of-day UTC) rather than an inclusive day bound. `since`/`gte` happens to be correct (start-of-day is the right lower bound), which masks the asymmetry on the `until` side.
- **Impact**: Wrong/incomplete results on a compliance audit log — the most recent day's actions vanish from both the on-screen viewer and the downloadable CSV evidence, exactly when "what happened today/most recently" is the common query. Quietly under-reports.
- **Fix sketch**: When `until` is a date-only value, set the bound to the *end* of that day: `lte = new Date(`${until}T23:59:59.999Z`)` (or add one day and use `lt`). Apply once in `getAuditLog` so both the viewer and CSV branch inherit the inclusive semantics.

## 2. Supply-chain card ignores the tech-stack scope the rest of the page is filtered by
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/app/org/[slug]/security/page.tsx:29-33 (and src/lib/security/supply-chain.ts:112)
- **Value**: impact 5 · effort 3 · risk 3
- **Scenario**: The page resolves a tech-stack scope (`techGroupId`) and threads it into `buildSecurityOverview(...)` so the header, bands, gate, weakest-list and governance all reflect e.g. "Frontend" only. But `getOrgSupplyChain(slug)` is called with no scope argument (the function signature takes only `orgSlug`). So when a user selects "Frontend", the Supply-chain card still tallies Dependabot advisories across the **entire** fleet — backend repos included — while every other number on the page is frontend-only.
- **Root cause**: The scope was retrofitted into the rollup/governance path but `getOrgSupplyChain` was never extended to accept/apply `techGroupId`; the page comment ("scope the whole overview") over-promises.
- **Impact**: Misleading security data — advisory counts attributed to a stack subset that they don't belong to. A user reasons "my Frontend repos have N critical advisories" when N is fleet-wide. Confusion and wrong remediation prioritization.
- **Fix sketch**: Thread `techGroupId` into `getOrgSupplyChain` (filter `rollup.repos` to the scoped set before the advisory fan-out), and key the TTL cache by `slug+techGroupId`. Until then, hide/label the card as "fleet-wide" when a stack filter is active so it isn't read as scoped.

## 3. CSV per-row tamper-evidence is unverifiable — the export omits `orgId`, a signed field
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/app/api/audit/route.ts:19,36-44,60-62 (signature def src/lib/db/audit-integrity.ts:47-62)
- **Value**: impact 5 · effort 2 · risk 2
- **Scenario**: The CSV route advertises (lines 60-62) "Each row also carries its own HMAC `_sig` in the meta cell, so individual rows are tamper-evident too." To verify a row an examiner must recompute `HMAC(action, orgId, actorId, createdAt, meta-minus-_sig)` — but `CSV_COLUMNS` exports `at, action, actorId, repo, level, overall, headSha, meta`, with **no `orgId`**. The filename carries the org *slug*, not the DB `orgId` the signature is computed over, so the canonical input can't be reconstructed from the file. Independent per-row verification is impossible from the CSV alone.
- **Root cause**: The signed field set (`AuditFields`) and the exported column set were defined separately and drifted; the row-level integrity claim assumes all signed inputs are present in the artifact, but one is dropped.
- **Impact**: Success theater on a compliance feature — a row-level integrity guarantee that the filed evidence can't actually back up. Only the file-level SHA-256 header truly protects the CSV. An auditor relying on the stated per-row guarantee would be misled.
- **Fix sketch**: Add an `orgId` column to `CSV_COLUMNS` and the row tuple (it's already on each entry's source row), or drop the per-row claim from the comment and rely solely on the documented file-level SHA-256 + the DB-side `verifyAudit`.

## 4. Audit viewer has no stale-response guard — rapid filter changes can scramble or duplicate rows
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/components/org/AuditLogViewer.tsx:109-131,144-148
- **Value**: impact 4 · effort 3 · risk 3
- **Scenario**: `changeAction` fires `load(true, …)` immediately on every dropdown change, but the `<select>` is not disabled while a request is in flight (only the Apply / Load-more buttons are). Pick action A, then quickly pick action B: two `fetch`es race with no request-sequencing/abort. If A's response resolves last, `setEntries(data.entries)` lands A's rows while the control shows B — the list and the active filter disagree. The same un-sequenced `load` underlies "Load more"; an interleaving with a reset can append a page that belongs to the prior filter, producing duplicate/foreign `e.id` rows.
- **Root cause**: Fire-and-forget `void load(...)` with shared `entries`/`cursor` state and no in-flight token, abort controller, or "ignore if superseded" check.
- **Impact**: UX confusion / wrong data shown — the trail appears to contain entries that don't match the selected filter, and React key collisions are possible on duplicated ids. Misleads someone reading an audit log.
- **Fix sketch**: Track a monotonically increasing request id (or an `AbortController`) in `load`; on resolve, apply results only if the request is still the latest. Also disable the `<select>` while `loading`.

## 5. Transient installation/token failure is cached for 5 min as an empty (all-clear) supply-chain result
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/lib/security/supply-chain.ts:123-151
- **Value**: impact 4 · effort 3 · risk 3
- **Scenario**: In `github` mode, if `getInstallationIdForOwner` or `getInstallationToken` transiently fails (DB hiccup / GitHub 5xx — both swallowed via `.catch(() => …)`), `token` is `undefined`, so every `provider.fetchAdvisories` returns null and all repos are dropped → `rows = []` → `scanned: 0`. That empty result is unconditionally written to the module cache (`cache.set`) and served for the full 5-minute TTL. The Security page then renders the "No Dependabot advisory data yet / scanning isn't enabled" empty card — presenting a transient auth blip as "supply chain is clean / off". (The cache `Map` is also keyed only by slug and never evicted, so it grows unbounded across tenants.)
- **Root cause**: No distinction between "successfully scanned, genuinely zero advisories" and "couldn't authenticate, scanned nothing" — both collapse to `scanned: 0`, and negative results are cached identically to positive ones.
- **Impact**: A security tool shows a false "no risk / not configured" state for 5 minutes after a recoverable failure — the most dangerous false signal in a security view. Plus slow memory growth.
- **Fix sketch**: Treat a failed token mint as a hard error for this run (return a distinct `error`/`degraded` state, or `null`) and do **not** cache it (only cache when at least one repo fetch succeeded, or cache a short negative TTL). Surface "couldn't reach GitHub for advisories" rather than the "not enabled" empty state. Bound the cache (LRU / periodic prune).
