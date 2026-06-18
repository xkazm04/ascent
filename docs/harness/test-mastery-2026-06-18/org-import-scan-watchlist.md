> Total: 5 findings (2 critical, 2 high, 1 medium)

# Test Mastery — Org Import, Scan & Watchlist

This context is fleet-scale scanning: import an org, watch repos, scan them in bounded-concurrency
batches (manual / scheduled / cron), and re-scan on a cron. Every path here spends real GitHub-app
tokens and prepaid LLM credits across a portfolio, so the load-bearing invariants are money
(reserve-before-scan, refund-on-no-result, never-scan-for-free) and data-integrity (claim-before-work
so two cron passes can't double-scan/double-bill). The credit *ledger primitive* (`consumeScanCredit`
/ `grantCredits`) is well-tested in `src/lib/db/credits.test.ts`. What is NOT tested is the layer that
wires those primitives together at the route — and the concurrency primitive (`mapPool`) every route
fans out through. The risk lives exactly one layer above where the tests stop.

## 1. Test mapPool's exactly-once / order / concurrency-cap invariants — the unguarded engine under every fleet scan

- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/lib/pool.ts:14 (`mapPool`); no `src/lib/pool*.test.ts` exists
- **Scenario**: A refactor of the lane loop (e.g. `cursor++` moved, an off-by-one in `Math.min(concurrency, n)`, or switching to `items.forEach`) silently double-runs or skips an item. Because each lane both **consumes a credit** and **calls `scanRepository`** per item, a double-run = a repo billed twice and persisted twice; a skipped item = a watched repo that silently never scans. The whole context's "scanned N/total" accounting also depends on `results` being correctly sized and ordered.
- **Root cause**: `mapPool` is the single fan-out used by `org/import`, `org/scan`, and `cron/rescan`, yet has zero tests. `grep` for `mapPool` across `**/*.test.ts` returns nothing. Its three documented contracts — preserve result order, run each item exactly once, cap in-flight at `concurrency` — are entirely unverified, and so is its sharpest footgun: the header says "a thrown `fn` rejects the whole pool," which means if any caller's per-item try/catch ever regresses, one bad repo aborts the entire batch (every later repo silently un-scanned).
- **Impact**: A concurrency bug here corrupts billing and coverage across the entire fleet product simultaneously — the highest blast radius in the context.
- **Fix sketch**: Add `src/lib/pool.test.ts` asserting: (a) `mapPool([], 4, fn)` returns `[]` and `fn` is never called; (b) result array equals `items.map(fn)` **in input order** even when later items resolve first (use deferred promises that resolve out of order); (c) **exactly-once** — a call-counter Map shows each index invoked once, total invocations === `items.length`; (d) **concurrency cap** — instrument a live-counter that increments on entry / decrements on exit and assert its observed max never exceeds `min(concurrency, n)` (and is `>1` for n>1, proving it actually parallelizes); (e) **error propagation contract** — a `fn` that throws on one item rejects the whole `Promise.all`, pinning the "fn must own its errors" precondition so callers can't quietly violate it.

## 2. Test cron/rescan's auth gate, claim-before-scan, and refund — the unattended money/token spender

- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/app/api/cron/rescan/route.ts:31 (`GET`); no `src/app/api/cron/rescan/route.test.ts` exists
- **Scenario**: Four separate silent-money regressions can ship undetected: (1) the `if (!secret)` fail-closed block (line 33-38) regresses back to the old opt-in `if (secret)` form → the route runs **unauthenticated**, minting every org's token and spending LLM budget for any anonymous caller; (2) the `claimRescan(...)` guard (line 85-89) stops short-circuiting on `false` → two overlapping cron passes both scan and **double-bill** the same repo; (3) the broken-install short-circuit (line 95-99) stops skipping → a revoked-token org gets re-attempted every pass, each repo 404→refund→6h-backoff forever; (4) the failure-path refund (line 147) regresses → orgs are charged for scans that threw.
- **Root cause**: This is the only fully unattended scan path (no human watching an SSE stream), and it has no test at all. Every guard here is "fail-closed" or "claim-before-spend" — precisely the logic that looks fine in code review but only a FAILURE-path test catches when it silently flips.
- **Impact**: A regression bills customers for nothing, scans for free, or exposes an unauthenticated token-minting endpoint — and nobody is watching when the cron runs.
- **Fix sketch**: Add a route test (mock `@/lib/db`, `@/lib/github/app`, `@/lib/scan`, `@/lib/scan-alerts` like the sibling route tests). Assert: (a) **missing `CRON_SECRET` → 503** and `scanRepository`/`listDueRescans` never called; (b) **wrong bearer/key → 401**, no scan; (c) when `claimRescan` resolves `false`, that repo's `scanRepository` is **not** called and `skippedAlreadyClaimed` increments; (d) when the org is in `brokenInstallOrgs` (install id present, token mint returns `undefined`), `consumeScanCredit` is **never** called and `recordScanOutcome(..., {ok:false})` is; (e) when `scanRepository` throws after a charged reservation, `grantCredits(org,1,{reason:"refund"...})` **is** called exactly once and `advanceScheduleAfterFailure` runs. The invariant: no credit is net-spent unless a real non-deduped scan persisted, and an unauthed/duplicate/dead-install repo is never scanned.

## 3. Test the "lost reservation never scans for free" + "out of credits surfaces" paths in org/scan — the test today only proves the happy refund

- **Severity**: High
- **Category**: success-theater
- **File**: src/app/api/org/scan/route.test.ts (3 tests, all happy-path); route at src/app/api/org/scan/route.ts:93 and :121
- **Scenario**: The existing suite makes the credit logic *look* covered — three green tests on the dedup/degrade/keep-debit refund branches. But the two branches that actually protect revenue are untested: (1) when `consumeScanCredit` returns `ok:false` mid-pool (balance exhausted by a concurrent batch), the route must emit `repo.skipped:"insufficient_credits"` and **not call `scanRepository`** (line 121-127) — a regression here scans a repo with no credit reserved, i.e. for free; (2) when the up-front balance slices `scanList` to empty, the route must emit the `"Out of scan credits — N watched repos couldn't be scanned."` **error** (line 93-96) rather than a silent `0/0` success. Neither is asserted, so either could break while the suite stays green.
- **Root cause**: The test fixture hard-codes `consumeScanCredit → {ok:true, balance:4}` in `beforeEach` and only ever varies the report/persist provider. It exercises the refund math but never the *gate* — the success-theater pattern where the cheap, happy assertions pass and the money-protecting branch is never entered.
- **Impact**: The free-scan leak (charge nothing, run real LLM inference) and the silent-success-on-zero are exactly the regressions that lose money or hide a stalled paid run from the customer.
- **Fix sketch**: Add to `org/scan/route.test.ts`: (a) mock `consumeScanCredit` to resolve `{ok:false, balance:0, unlimited:false}` for the watched repo and assert `scanRepository` was **called 0 times** and the drained SSE body contains `skipped":"insufficient_credits"`; (b) set `checkScanEntitlement → {allowed:true, unlimited:false, balance:0}` with a non-empty watchlist and assert the stream emits the out-of-credits `error` event and **no `repo` scored events**. Invariant: a repo is scanned iff a credit was actually reserved (or the plan is unlimited).

## 4. Test org/import's credit-cap slice and per-repo refund — the import test only pins token discipline

- **Severity**: High
- **Category**: coverage-gap
- **File**: src/app/api/org/import/route.test.ts (token-discipline only); route at src/app/api/org/import/route.ts:170 and :188-205
- **Scenario**: The metered-import money logic is untested: (1) the up-front cap `fullNames.slice(0, creditBalance)` + `skippedForCredits` notice (line 170-174) — a regression scans the whole list regardless of balance, over-billing or going negative; (2) the per-repo reserve-then-refund-on-throw/degrade (line 188-205, 220, 237) — the import path duplicates `org/scan`'s reservation logic but has no equivalent of `org/scan`'s refund test, so a regression that drops the refund silently charges for failed imports; (3) the `metered = !mock && org !== "public"` switch — a flip would meter the free public funnel or let a paid import run free.
- **Root cause**: `route.test.ts` deliberately scopes itself to "ambient-token discipline" (it mocks `checkScanEntitlement → {unlimited:true}`, so the metered branch is never entered). The entire credit dimension of the import funnel is out of the test's frame.
- **Impact**: The import funnel is the free-tier-to-paid conversion path; a billing regression here either over-charges new paying orgs or gives away private-repo inference for free.
- **Fix sketch**: Add tests with `checkScanEntitlement → {allowed:true, unlimited:false, balance:2}` and `repos:[3 repos]`, `mock:false`: assert only 2 repos call `scanRepository`, the `notice` carries `skipped:1`, and the final `result.skippedForCredits === 1`. Add a per-repo refund test: `scanRepository` throws → `grantCredits(org,1,{reason:"refund"...})` called once for the reserved repo. Add: `mock:true` (default) on a private org → `consumeScanCredit` **never** called (mock is free). Invariant: credits reserved === repos that produced billable non-deduped real inference.

## 5. Test claimRescan's CAS contract and listDueRescans round-robin fairness — org.test.ts covers a different module

- **Severity**: Medium
- **Category**: coverage-gap
- **File**: src/lib/db/org-watch.ts:194 (`claimRescan`), :152 (`listDueRescans`); no `org-watch*.test.ts` (the `org.test.ts` present only tests `dueBucketFor`/`computeWindowDeltas` from `org-rollup.ts`)
- **Scenario**: (1) `claimRescan` returns `res.count === 1` — the single-claim guard the cron's double-scan protection rests on. A regression to `res.count >= 1` or `> 0` would still return true even if the conditional `updateMany` matched 0 (already-claimed) rows, defeating the cross-instance double-bill guard from the inside. (2) `listDueRescans`'s round-robin (line 168-174) is what stops one large fleet starving every other org in a cron pass; a regression to a plain `orderBy nextScanAt take limit` reintroduces the documented starvation and there's no test to catch it.
- **Root cause**: `org-watch.ts` — the watchlist + scheduling heart of this context — has no dedicated test file; the similarly-named `org.test.ts` tests pure helpers from a sibling module, which *looks* like coverage but exercises none of `org-watch`'s logic. The round-robin interleave is pure list logic that an LLM-generatable batch can cover deterministically.
- **Impact**: A silent break in the claim CAS reopens double-scan/double-bill under overlapping crons; a break in fairness lets a 500-repo org indefinitely block a 5-repo org's scheduled scans.
- **Fix sketch**: For `claimRescan`, mock `getPrisma().repository.updateMany` to return `{count:1}` → expect `true`; `{count:0}` → expect `false`; and `schedule:"off"` → expect `false` with `updateMany` **not** called. For `listDueRescans`, feed a fake `findMany` returning interleavable rows across 3 orgs (one org dominating the oldest-due head) and assert the returned slice draws **round-robin across orgs** (no single org consumes the whole `limit` while another org has due repos waiting) and respects `limit`. Invariant: a claim succeeds for exactly one caller, and a cron pass spreads work fleet-wide rather than oldest-first-only.
