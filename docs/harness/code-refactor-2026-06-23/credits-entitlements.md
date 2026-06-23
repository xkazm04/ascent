# Code Refactor — Credits & Entitlements
> Context group: Billing, Credits & Metering
> Total: 3 findings (Critical: 0, High: 0, Medium: 2, Low: 1)

The context is in good shape: the billing-critical accounting (`grantCredits`, `consumeScanCredit`, `getCreditReconciliation`) is well-factored, the policy decision is already centralized in the shared pure helper `decideScanCharge`/`scanAllowance` (`@/lib/plans`), and every export I checked for liveness (`getCreditReconciliation`, `getCreditLedger`, `getCreditState`, `estimateMonthlyCredits`, `MONTHLY_RUNS`, `CREDIT_ESTIMATE_NOTE`) has real consumers. The findings below are localized and behavior-preserving.

## 1. Stale `isUnlimitedPlan` re-export through the credits module
- **Severity**: Medium
- **Category**: dead-code
- **File**: src/lib/db/credits.ts:13-16 (and the pass-through at src/lib/db/index.ts:70)
- **Scenario**: `credits.ts` imports `isUnlimitedPlan` from `@/lib/plans` for its own internal use, then re-exports it (`export { isUnlimitedPlan };`) with a comment claiming the re-export exists "so existing importers (entitlement, scan paths) keep their `@/lib/db/credits` import." `index.ts` then re-re-exports it from `@/lib/db`. A repo-wide grep shows NO module imports `isUnlimitedPlan` from `@/lib/db/credits` or `@/lib/db` — every consumer (`credits.ts` itself, `credits.test.ts`) imports it straight from `@/lib/plans`. The stated reason for the re-export no longer holds.
- **Root cause**: Leftover from the CRED-2 migration that moved `isUnlimitedPlan` out of `credits.ts` into the data-driven `@/lib/plans`. The compatibility re-export was added to avoid touching old call sites, but those call sites were subsequently repointed at `@/lib/plans` directly, leaving the shim with zero consumers.
- **Impact**: A dead pass-through export plus a now-false explanatory comment. It implies `@/lib/db/credits` is the canonical home for the predicate (it isn't — `@/lib/plans` is), which misleads a maintainer choosing where to import from and invites the value/source to drift conceptually from its real owner.
- **Fix sketch**: Delete the `export { isUnlimitedPlan };` line and its preceding comment block in `credits.ts:13-16` (keep the plain `import { isUnlimitedPlan, decideScanCharge, scanAllowance } from "@/lib/plans"` for internal use). Remove `isUnlimitedPlan` from the `export { ... } from "@/lib/db/credits"` block in `index.ts:70`. No call sites to update — verified none import it from these paths.

## 2. Duplicated allowance-gate wiring across the read gate and the write gate
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/entitlement.ts:34-41 and src/lib/db/credits.ts:188-198
- **Scenario**: `checkScanEntitlement` (the point-in-time pre-flight read) and `consumeScanCredit` (the atomic write/debit) each independently assemble the same charge decision: read the org's `plan`+`balance`, compute `countMeteredScansThisMonth(slug)`, then call `decideScanCharge({ unlimited, allowance: scanAllowance(plan), usageThisMonth, balance })` and branch on the `"allowance" | "credit" | "denied"` result. The `scanAllowance(plan)` argument-wiring + `decideScanCharge(...)` invocation + result-branching is copy-pasted in both places.
- **Root cause**: The two gates were authored at different layers (entitlement policy vs. db accounting) and the shared `decideScanCharge` pure helper was extracted for the *core math* but not for the *org-resolution-to-charge assembly* around it. Each call site re-derives the `decideScanCharge` inputs by hand.
- **Impact**: Drift risk on the most billing-sensitive path: if the input wiring changes (e.g. a new pre-condition, or passing a different usage basis), one gate can update while the other silently keeps the old behavior — exactly the read-gate/write-gate divergence the scan route comments already warn about. Today they agree only by careful manual parallelism.
- **Fix sketch**: Add a thin shared helper in `@/lib/plans` (or a new `lib/scan-charge.ts`), e.g. `resolveScanCharge({ plan, balance, usageThisMonth }): ScanCharge` that internally does `decideScanCharge({ unlimited: isUnlimitedPlan(plan), allowance: scanAllowance(plan), usageThisMonth, balance })`. Call it from both `checkScanEntitlement` and `consumeScanCredit`'s overflow gate so the input assembly lives in one place. Behavior-preserving — it only collapses the identical wiring; the surrounding read/transaction logic stays where it is.

## 3. Inconsistent slug casing in the P2002 fallback of `grantCredits`
- **Severity**: Low
- **Category**: cleanup
- **File**: src/lib/db/credits.ts:148
- **Scenario**: `grantCredits` canonicalizes the org slug once (`const slug = orgSlug.toLowerCase();`, line 86) and uses that `slug` everywhere — the fast-path return (`getCreditState(slug)`, line 105), the transaction `where: { slug }`, etc. The lone exception is the unique-constraint (P2002) catch block, which returns `getCreditState(orgSlug)` (line 148) using the raw, possibly mixed-case original instead of the already-computed `slug`.
- **Root cause**: The `slug` local was introduced when canonical-casing was added, but the one reference inside the `catch` was missed in the sweep.
- **Impact**: Cosmetic / consistency only — `getCreditState` lowercases its argument internally, so the returned balance is correct either way. It's a latent footgun: a reader could conclude raw slugs are acceptable here, and any future refactor that drops `getCreditState`'s internal lowercasing would turn this into a real bug (mixed-case read → phantom $0/free org).
- **Fix sketch**: Change line 148 from `return (await getCreditState(orgSlug)).balance;` to `return (await getCreditState(slug)).balance;`, matching the other two `getCreditState` calls in the function. One-line, behavior-preserving.
