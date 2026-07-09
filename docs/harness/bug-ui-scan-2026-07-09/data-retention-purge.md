# Data Retention & Purge — bug-hunter + ui-perfectionist scan

> Context: Data Retention & Purge (group: Data & Persistence)
> Files scanned: 3
> Total: 6 findings (Critical: 0, High: 2, Medium: 2, Low: 2)

## 1. Soft wall-clock budget cannot interrupt a single large org — the exact fleet it protects gets hard-killed mid-delete
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: recovery-gap
- **File**: src/lib/db/retention.ts:299
- **Scenario**: One fleet org watches thousands of repos, each with a huge scan history. The cron tick enters that org's iteration under budget (`overBudget()` passes at line 300). Its repo-pagination loop (328–346) and `pruneRepoScans` batched deletes then run for minutes — with NO budget check inside — blowing past `maxDuration=300` (route.ts:15). Vercel hard-kills the function mid-delete: no throw, no `PurgeSummary`, no summary log.
- **Root cause**: The budget is polled only BETWEEN orgs and before the trailing sweeps, never within an org's repo/scan loops. The comment at lines 35–39 claims the budget "stops cleanly a bit before" maxDuration so a large fleet "returns a proper (partial) summary" — but that guarantee holds only if no single org exceeds the budget, which is exactly the case for the biggest fleets the guard targets.
- **Impact**: On the largest tenant, the purge is hard-killed with no summary and no alert path (the budget error at 303 is never reached); the run repeats and fails the same way each tick, so that org's retention is never enforced — the failure this module exists to prevent.
- **Fix sketch**: Thread `overBudget`/`startedAt` into the repo loop and `pruneRepoScans`; check it before each repo (and ideally each page) and bail out setting `stoppedEarly` + `orgsRemaining` when exceeded, so a mega-org yields a partial summary instead of a hard kill.

## 2. Trailing sweeps deferred by the budget set stoppedEarly but push no error — the run reports a green 200
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/db/retention.ts:401
- **Scenario**: The org loop finishes fully within budget (no `(budget):` error pushed), but the last org's deletes push wall-clock past the budget. The org-less orphan-audit sweep (line 401) and the public-scan-quota sweep (line 431) then see `overBudget()` true, set `stoppedEarly = true`, and SKIP — but neither pushes to `errors`. The route (route.ts:51) returns 207 only when `summary.errors.length > 0`; it never inspects `stoppedEarly`, so it returns 200.
- **Root cause**: Two channels signal a degraded run (`errors` and `stoppedEarly`), but the route only wires one to the HTTP status. The org-loop early-stop happens to push an error; the sweep-skip paths do not.
- **Impact**: If a large fleet's org loop consistently near-exhausts the budget, the orphan `AuditLog` (orgId null) and `PublicScanQuota` sweeps are silently deferred every tick and never run — the exact unbounded-growth the module exists to prevent — while cron/uptime monitors see a green 200 and never page anyone. This directly violates the route's own stated invariant (route.ts:53–57: a budget-stopped run "must NOT report a green 200").
- **Fix sketch**: In route.ts, treat `summary.stoppedEarly` (or `orgsRemaining > 0`) as degraded and return 207 alongside the `errors.length > 0` check; or have the sweep-skip branches push an explanatory `(budget):` error like the org loop does.

## 3. A per-org failure mid-prune discards that org's already-committed deletion counts from the summary
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: partial-progress-lost
- **File**: src/lib/db/retention.ts:314
- **Scenario**: An org has 3,000 stale scans across many repos. Several batches commit (each `pruneRepoScans` batch is its own transaction), then a later repo's selection throws (DSQL outage, sustained conflict). The `catch` at line 393 pushes an error and moves on — but the accumulators `scansDeleted`/`dimensionsDeleted`/… (declared inside the `try` at 314–318) are only pushed into `results` at line 384, which is past the throw.
- **Root cause**: The running counts live in `try`-scoped locals that are surfaced only on the success tail; a throw drops them, even though the underlying batch deletes are durably committed.
- **Impact**: For an audit/compliance product, the run's reported "what was deleted" undercounts actual deletions for any partially-failed org (that org contributes 0 to `summary.scansDeleted` despite committed deletes). The 207 body — the operator's forensic record — is wrong.
- **Fix sketch**: Push a partial `OrgPurgeResult` with the accumulated counts in the `catch` (or hoist the accumulators and always append a result), so committed deletes are always reflected in the roll-up even when the org later throws.

## 4. Stateless random shuffle gives only probabilistic fairness, not bounded reach — a tail org can starve for many ticks
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: assumption-landmine
- **File**: src/lib/db/retention.ts:286
- **Scenario**: A fleet is large enough that one 250s tick drains only a fraction of orgs. `shuffleInPlace` (line 286, Fisher–Yates over `Math.random`) produces an independent uniform permutation each tick, so a given org is in the processed prefix with probability ≈ prefix/N per tick, independently. By variance, an unlucky org can go many consecutive ticks (well beyond the intended daily cadence) without ever being reached.
- **Root cause**: The comment at 239–252 / 278–285 asserts rotation means "every org is eventually reached across consecutive daily runs," but independent random shuffling guarantees only *probabilistic eventual* reach, not a bounded worst-case — the opposite of what a persisted round-robin/least-recently-purged cursor would guarantee, which is what fairness under a hard budget actually needs.
- **Impact**: The biggest fleets (the module's stated target) can leave specific orgs' retention/compliance windows unenforced for an unbounded stretch, with no signal that any particular org is being skipped.
- **Fix sketch**: Persist a rotating cursor (or a `lastPurgedAt` per org and order by it ascending) so each tick deterministically resumes where the last left off; this bounds worst-case reach to ⌈N/perTick⌉ ticks instead of relying on luck.

## 5. Audit cutoff uses Date.now() directly, bypassing the injectable clock used for the budget
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: clock-consistency
- **File**: src/lib/db/retention.ts:350
- **Scenario**: `purgeExpiredData` accepts an injectable `now` (line 265, `opts.now ?? Date.now`) and uses it for the wall-clock budget. But both audit cutoffs — per-org (line 350) and orphan (line 405) — call `Date.now()` directly rather than `now()`.
- **Root cause**: Two notions of "now" coexist; only the budget honors the injected clock, so the retention *window* is computed off the real wall clock regardless of `opts.now`.
- **Impact**: No production bug (both resolve to `Date.now` live), but an integration test or simulation that injects `opts.now` to advance time would move the budget without moving the cutoff, silently diverging the two and masking window off-by-one regressions. It also makes the cutoff the one piece of time-dependent logic that can't be driven deterministically without `vi.setSystemTime`.
- **Fix sketch**: Compute both cutoffs from the same `now()` closure (`new Date(now() - days * DAY_MS)`) so a single injected clock governs budget and window together.

## 6. orgsRemaining / budget message over-count unconfigured no-op orgs as "unprocessed"
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: reporting-accuracy
- **File**: src/lib/db/retention.ts:302
- **Scenario**: Retention is opt-in, so most orgs hit the `continue` skip at line 311 (policy 0/0) and cost ~nothing. When the loop stops on budget at index `i`, `orgsRemaining = orgs.length - i` (line 302) counts ALL remaining orgs — including the many that would be instant no-op skips — and the error string (304–306) reports them as "org(s) unprocessed this tick."
- **Root cause**: `orgsRemaining` measures list position, not enforcement backlog; a fleet that is 99% unconfigured reports a large fake backlog.
- **Impact**: Operators (and any downstream that reads `orgsRemaining`) over-estimate the resume tail and the run's degradation, inflating alert noise. Purely a reporting distortion, no data effect.
- **Fix sketch**: Count only orgs with a non-trivial resolved policy among the remainder (or track processed-vs-enforced separately), so `orgsRemaining` reflects real outstanding work.
