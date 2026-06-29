# Bug + UI Scan — Medium/Low Tail Fix Summary (ascent, 2026-06-25)

> Continuation of `FIXES-SUMMARY.md` (which covered the 27 highs).
> Branch `vibeman/bug-ui-fixes-2026-06-25` (isolated worktree off `master`@1223535).
> **Medium + Low tail: 188 of 193 findings closed** across 18 waves (12 medium + 6 low).
> Baseline preserved end-to-end: **tsc 0 → 0**, **vitest 2630 → 2699 passing** (+69 tests), **0 net regressions**.
> Whole run total on the branch: **219 commits**, 235 files, +5368/−1163.

## Tail tally

| Severity | Found | Closed | Open (deferred) |
|---|---:|---:|---:|
| Medium | 117 | 112 | 5 |
| Low | 76 | 76 | 0 |
| **Tail total** | **193** | **188** | **5** |

Combined with the 27 highs (all closed): **215 / 220 findings closed**.

## Waves (one executor each, sequential; full tsc+suite verified after every wave)

- **Medium** — 12 waves by context group: Org Dashboard (19), Org Planning (16), Onboarding/Shell (14), Reporting/Viz (13), Fleet Rollups (11), Billing (10), Repo Scanning/Scoring (10), Data/Persistence (9), Marketing/Design-System (8), Identity/GitHub (7).
- **Low** — 6 waves (~14 each), packed across groups.

## Regressions caught & fixed-forward (the verify gate working)

1. **medM08 → 8 refund tests** — the credit-reason refactor added a `CREDIT_REASON` export the scan/cron-rescan/import/org-scan routes use; the route tests mock `@/lib/db` without it. Stubbed it in the 4 mocks (`8f280d9`).
2. **medM12 → 30 webhook tests** — the cross-instance webhook dedup added `claimWebhookDelivery`/`releaseWebhookDelivery`; webhook test mock lacked them. Stubbed claim→true / release→noop (`4a15099`).
3. **lowL04 → 1 sse test** — an added multi-line-`data:` test asserted a literal newline survives inside a JSON string (impossible); rewrote it to a valid split-JSON reassembly (`8feb235`).

All three were the same shape as the Wave-C gate regression: a new export missing from a wholesale module mock, or a test whose premise was itself wrong. None weakened a real assertion.

## Open (deferred-with-cause) — 5 mediums

1. **fleet-rollups `CHAMPION_MIN_POP` in the data producers** — the prescribed fix contradicts deliberately-pinned test contracts (`org-contributors.test.ts` / `teamRollup.test.ts` assert champions populated at low population); the guard intentionally lives in the view layer. Would require rewriting pinned assertions.
2. **scan-persistence sha-less dedup** — needs a `@@unique` idempotency-key **Prisma column**; blocked by the shared-`node_modules` junction (a client regen would break both trees). No safe in-schema alternative.
3. **scan-pipeline scan-completion email recipient** — *WIP-only*: the email module exists only in the user's uncommitted `master` WIP, not on this branch.
4. **scan-pipeline notify opt-in** — *WIP-only*: same (the notify toggle lives in the WIP `ScanForm.tsx`).
5. **landing ScanModal focus trap** — *WIP-only*: `ScanModal.tsx` is untracked WIP, not on this branch.

(The 3 WIP-only items should be re-checked once the user's in-progress refactor lands — they may already be handled there.)

## ⚠️ Pre-deploy action items introduced by the tail

- **`prisma generate` required**: two schema changes need a client regen + migration before deploy:
  - `WebhookDelivery` table (cross-instance webhook dedup, medM12) — uses raw SQL so tsc is clean, but the table must be migrated.
  - `gatePolicy` column **JSONB → TEXT** (database-client low, lowL06) — migration + init.sql included; a localized typed cast keeps tsc at 0 until regen.
- **Cron secret is now `Authorization: Bearer` only** (rejects `?key=`, constant-time compare) — update any cron caller that passed the key as a query param.
- (From the highs) **set `POLAR_PLAN_PRODUCTS`** in prod or paid plan purchases still won't upgrade the tier.

## Notable security/correctness hardening in the tail

- SSRF-safe PDF logo fetch (`resolveSafeLogoDataUri`: https + private-IP reject + no-redirect + image-only).
- `/api/app/setup` now requires a session + owner/admin authz before the GitHub round-trip.
- Atomic claim-first invite accept (closes the multi-use race on unpinned invites).
- Purge route returns **207** (not 200) when errors occur, with a wall-clock budget + org shuffle (no tail-org starvation).
- DB read surface surfaces query timeouts instead of silently degrading to empty data.
- Rate-limit retry-after now reports the true sliding-window edge (not the full window).
