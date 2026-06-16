# Credits & Entitlements — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 3, Medium: 1, Low: 1)
> Lens split: bug-hunter 4 / ui-perfectionist 1
> Files read: 13

## 1. Negative-adjustment grant corrupts the ledger and clamps non-atomically
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: Money integrity / ledger invariant / race
- **File**: src/lib/db/credits.ts:96-118
- **Scenario**: An owner (dev) or an internal "adjustment" debits more than the balance, e.g. balance 30, `grantCredits(org, -100, { reason: "adjustment" })`. The tx does `increment: -100` → `scanCredits = -70`, computes `balanceAfter = Math.max(0, -70) = 0`, then issues a *second* `tx.organization.update(... scanCredits: 0)` to clamp, and writes a ledger row with `delta = -100, balanceAfter = 0`.
- **Root cause**: Two problems. (a) The ledger invariant `previousBalance + delta === balanceAfter` is violated (30 + (-100) ≠ 0), so `getCreditReconciliation` (credits.ts:216) and any audit that sums deltas against stamped balances diverges permanently — the clamped 70 credits silently vanish from the running total. (b) The clamp is a read-then-write *after* a relative `increment`, so a concurrent `consumeScanCredit`/`grantCredits` that lands between the increment and the clamp read can have its effect overwritten by the absolute `scanCredits: 0` set (last-writer-wins on an absolute value), losing a concurrent debit/credit. The decrement-by-increment is atomic; the clamp is not.
- **Impact**: Audit/reconciliation trail becomes unreconcilable (the whole point of the append-only ledger per the file header), and a concurrent movement can be silently clobbered to zero. On DSQL/serializable this surfaces as lost updates rather than a clean retry.
- **Fix sketch**: Clamp atomically and stamp a consistent delta: instead of `increment` + a follow-up absolute write, compute the *effective* delta server-side (`appliedDelta = max(delta, -previousBalance)`), apply it in one conditional update, and stamp `balanceAfter = previousBalance + appliedDelta` with `delta = appliedDelta`. Record the requested-vs-applied difference in a metadata field if the over-debit must be visible. Never issue a second absolute write inside the same tx after a relative increment.

## 2. Owner-gated manual grant lets an owner mint unlimited free private scans
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: Authz / monetization bypass
- **File**: src/app/api/org/credits/grant/route.ts:36-49
- **Scenario**: On any deployment where `ASCENT_ALLOW_CREDIT_GRANTS` is truthy, the org **owner** can POST `{ org, amount: 100000 }` repeatedly to `/api/org/credits/grant` and self-credit unlimited prepaid private scans — exactly the "owner mints free scans" outcome the header comment (lines 4-5) says must not happen. The gate is `requireOrgRole(org, "owner")`, and an installation-owner is *auto-seeded* as `owner` on first access (authz.ts:140-145, members.ts:66-88). So every real org admin is an owner, and the only thing standing between them and free credits is one env flag.
- **Root cause**: The control is a single boolean env var, not a privilege boundary. The endpoint is owner-self-serve by design; the comment treats `ASCENT_ALLOW_CREDIT_GRANTS=off` in prod as the safety, but there is no second factor (no super-admin role, no audit alert, no per-org cap, no rate limit). A misconfigured/leaked-default flag, a staging value bleeding into prod, or a future "let owners reconcile their own balance" product decision all collapse to free money. `Math.abs(amount) > 100_000` caps a *single* call, not the cumulative total — N calls = N×100k.
- **Impact**: Direct revenue bypass: an owner runs paid LLM inference indefinitely without paying Polar. Because grants land in the same ledger as Polar top-ups (reason "grant" vs "polar"), the spend looks legitimate.
- **Fix sketch**: Gate self-serve grants on a privilege strictly above org-owner (a platform `superAdmin`, or an explicit per-actor allowlist `ASCENT_GRANT_ACTORS`), not merely "owner + flag". Enforce a cumulative per-org grant ceiling and emit an audit/alert on every manual grant. Keep the Polar webhook (server-authoritative product→credits map) as the only unrestricted credit source.

## 3. /api/scan runs paid inference, then debits best-effort — concurrent scans serve paid LLM for free
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: TOCTOU double-spend / under-charge
- **File**: src/app/api/scan/route.ts:139-143, 219-238
- **Scenario**: Single-repo path checks `checkScanEntitlement` up front (balance > 0), runs the full real-inference scan, *then* calls `consumeScanCredit` afterwards. With balance = 1 and two concurrent private scans of different repos: both pass the entitlement check (TOCTOU on the point-in-time read), both run paid Gemini/LLM inference, the conditional decrement lets exactly one win, and the loser hits the `unbilled` branch (line 231) — it already consumed real inference but is charged nothing. The code even logs "metered scan ran but debit failed — unbilled" and serves a clean 200.
- **Root cause**: Unlike `/api/org/scan` and `/api/cron/rescan` (which RESERVE before scanning, scan-route.ts:112-128 / rescan:105-109), the interactive single-scan path keeps the legacy "scan first, debit after" ordering. The atomic decrement prevents a *negative balance*, but not free inference: the cost was already incurred before the debit could fail. There is no reservation, so every concurrent over-subscription on a near-zero balance is a free paid scan.
- **Impact**: Per-scan revenue leak proportional to concurrency at low balances; an org parked at balance 1 can be scripted to fire parallel `/api/scan` calls and harvest several paid scans for one credit. Logged but not prevented.
- **Fix sketch**: Reserve-then-refund like the other two paths: `consumeScanCredit` *before* `scanRepository`; if the reservation fails, return `paymentRequired` instead of running inference; refund on degrade-to-mock / dedup / throw. This makes the atomic decrement the actual gate rather than an after-the-fact accounting note.

## 4. Slug case mismatch: authz lowercases, credit read/debit does not — silent no-op debits / 404 grants
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Data consistency / entitlement edge case
- **File**: src/lib/db/credits.ts:52, 98, 146, 152 (vs grant/route.ts:36,44 and credits.ts:183)
- **Scenario**: `requireOrgRole(body.org, "owner")` lowercases the slug internally (authz.ts:133) and resolves the role against the lowercased org, but `grantCredits(body.org, ...)` and `getCreditState`/`consumeScanCredit` query `where: { slug: orgSlug }` with the **raw** value. `setOrgPlan` (credits.ts:183) and many sibling paths *do* `.toLowerCase()`. So a caller passing `Acme` authorizes successfully (role resolved on `acme`) but the credit lookup on `Acme` misses → grant returns null → 404 "Unknown organization", and on the read side `getCreditState("Acme")` falls through to `{ balance: 0, plan: "free" }`, wrongly paywalling a paid org. If any non-public org slug were ever persisted non-lowercase, `consumeScanCredit` would silently match nothing in the conditional `updateMany` and debit no credit while the plan/entitlement check (which can hit a different casing) still passes — a free-scan path.
- **Root cause**: No canonical-casing contract enforced at the credit layer; slug normalization is applied inconsistently across the codebase (some paths lowercase, the money paths don't).
- **Impact**: Best case, mixed-case org input breaks grant/balance (support noise). Worst case (non-lowercased stored slug), debits become silent no-ops while entitlement passes elsewhere — free metered scans.
- **Fix sketch**: Normalize once at the trust boundary: lowercase `orgSlug` at the top of `getCreditState`, `grantCredits`, and `consumeScanCredit` (matching `setOrgPlan`), or enforce a stored-lowercase invariant + reject non-canonical input. Make the grant route pass the same canonical slug to both `requireOrgRole` and `grantCredits`.

## 5. CreditsControl: shared busy flag, no success feedback, no aria-live for balance/errors
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: Action feedback / a11y
- **File**: src/components/org/CreditsControl.tsx:74-95, 124-135, 162-191
- **Scenario**: All three top-up buttons (+50/+200/+1000) disable on a single `busy` flag, so the user can't tell *which* grant is in flight, and a successful grant gives no confirmation — the balance number just changes silently with no toast/announcement. The balance chip (line 124) and the popover balance (line 135) update on state change but are not wrapped in an `aria-live` region, so a screen-reader user who triggers a top-up hears nothing; the error `<p>` (line 191) is likewise not announced. There is also no spinner/`aria-busy` on the active button — only `disabled:opacity-50`.
- **Root cause**: Optimistic balance update mutates `useState` without any polite-live announcement or per-button pending state; success is implicit.
- **Impact**: Owners on the dev/manual-grant surface get ambiguous feedback on a money action (did the +1000 apply? did it fail silently?), and the flow is inaccessible to AT users — they perceive no result for a balance-changing operation.
- **Fix sketch**: Add `aria-live="polite"` to the balance display and a status region that announces "Added N credits — balance X" / the error on settle; set `aria-busy`/a spinner on the specific button that was clicked (track the pending amount, not a single boolean); keep the others enabled or visibly distinguish the active one.
