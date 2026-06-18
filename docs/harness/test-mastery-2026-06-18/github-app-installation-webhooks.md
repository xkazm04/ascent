> Total: 5 findings (2 critical, 2 high, 1 medium)
# Test Mastery — GitHub App Installation & Webhooks

The webhook route is heavily security-hardened (forge-confirmation on every destructive action, fail-closed owner binding, replay dedup with a retry-release net), but the existing `route.test.ts` exercises **only two** of its five event branches — the installation lifecycle and `installation_repositories` reconcile. The `pull_request`/`check_run` gate and the `push` rescan paths, and the cross-tenant authorization gate `installationMatchesOwner`, have **zero** assertions. Separately, `app.test.ts` tests **only** `verifyWebhook`, leaving the token mint/cache and the paginated repo lister — the code that actually authenticates private-repo access — untested. Findings are ranked by blast radius.

## 1. Test the cross-tenant authorization gate `installationMatchesOwner` for FAILURE
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/app/api/app/webhook/route.ts:109-148
- **Scenario**: A regression that relaxes the fail-closed binding — e.g. restoring the old `.catch(() => null)` on `getInstallationIdForOwner` (DB error → treated as "no mapping" → falls through to the looser GitHub-confirmation path), or flipping the `known !== String(installationId)` mismatch to fail-open — lets a forged-but-signed `pull_request`/`push` delivery pair a **victim's** installation id with an **attacker's** owner login, minting a token and scanning a private repo the caller never controlled. No test fails.
- **Root cause**: `route.test.ts` mocks `getInstallationIdForOwner` as a bare `vi.fn()` but never sets a return value or asserts the gate's verdict; `installationMatchesOwner` is never called by name in any test. The four branches (DB-error→false, stored-mismatch→false, GitHub-account-mismatch→false, happy-path→true) are all uncovered.
- **Impact**: Cross-tenant private-repo read / token mint — the highest-blast-radius security boundary in this context. A silent fail-open ships green.
- **Fix sketch**: Drive `runPrGate`/`runPushRescan` through the deferred `after()` runner with table-driven cases asserting the **invariant: `getInstallationToken` is only called when (a) a stored mapping equals the payload installation id, OR (b) no mapping exists AND `getInstallation(id).account` case-insensitively equals the owner**. Assert `getInstallationToken` is NOT called when `getInstallationIdForOwner` rejects (DB error → fail closed), when the stored id differs, and when GitHub's account login differs — and IS called on each happy path.

## 2. Cover token minting, the expiry-skew/NaN guard, and the 401 self-heal in `app.ts`
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/lib/github/app.ts:147-251
- **Scenario**: `getInstallationToken`'s cache logic ships a regression — e.g. dropping the `Number.isFinite(cached.expires)` guard so a malformed `expires_at` (`NaN`) makes `NaN > Date.now()+skew` evaluate false-but-also-never-refresh paths, or shrinking `TOKEN_EXPIRY_SKEW_MS` back to 0 — and every private-repo scan starts intermittently 401-ing on clock-skewed hosts. Or `listInstallationRepos` loses its 401-retry / `MAX_PAGES` walk and silently serves a stale-token failure or a truncated repo set. `app.test.ts` only tests `verifyWebhook`, so all of this is invisible.
- **Root cause**: There is no test that stubs `fetch`/`createAppJwt` to exercise the token cache, the 3-minute skew buffer, the NaN-expiry rejection, or the paginated `collect()` + 401 `invalidateInstallationToken`→re-mint retry. The functions that gate access to every private repo have no behavioral test.
- **Impact**: Auth/data-access correctness — a regression here breaks ALL private-repo scans (gate checks, scheduled rescans) fleet-wide, or self-heals a stale token incorrectly. Money/security path with no net.
- **Fix sketch**: With `fetch` mocked, assert invariants: (1) a second call within the skew window returns the **cached** token (one POST), (2) a cached entry with a **non-finite** `expires` forces a re-mint, (3) a token expiring inside the 180s skew window is re-minted (not served), (4) a 401 on `/installation/repositories` triggers exactly one `invalidateInstallationToken` + one re-mint + retry, and a second 401 throws, (5) pagination walks until `raw.length >= total_count` and **filters out** `fork`/`archived` repos.

## 3. Test the PR gate path `runPrGate` — failure must post a neutral check, never a silent absent required check
- **Severity**: High
- **Category**: coverage-gap
- **File**: src/app/api/app/webhook/route.ts:202-273, 402-413
- **Scenario**: A regression in the catch block (GATE-3) — e.g. removing the neutral `createCheckRun` on failure, or the head-ref fork fallback (line 215-221) — means a transient scan error leaves a **required** gate check permanently absent, blocking every PR merge with no explanation; or a thrown gate stops posting the "could not run" check. The `pull_request` branch is never delivered in any test (`grep pull_request` in `route.test.ts` = 0).
- **Root cause**: `route.test.ts` never posts a `pull_request` or `check_run` event; `runPrGate`, `createCheckRun`, and `upsertStickyComment` are mocked but never asserted. The success path (head-ref scored, base diffed, sticky comment built) and the three documented failure modes (head-scan fallback, neutral-check-on-throw, delivery release) are all uncovered.
- **Fix sketch**: Post a `pull_request` `opened` event, run the deferred work, and assert: (1) **happy path** — `getInstallationToken` minted once, `scanRepository` called with `{mock:true, ref:headSha}` then base, `createCheckRun` called with `comment.conclusion`, sticky comment posted; (2) **head-ref unreachable** (first `scanRepository` rejects) — falls back to default branch, **no** baseline diff, check still posts; (3) **gate throws after mint** — a `neutral` "could not run" check is posted with the Re-run action AND `forgetDelivery` releases the slot. Invariant: a `pull_request` event never completes without either a real or a neutral Check Run when a token was minted.

## 4. Test the `push` rescan gate: watched-only, default-branch-only, head-moved guards
- **Severity**: High
- **Category**: error-branch
- **File**: src/app/api/app/webhook/route.ts:304-324, 431-440
- **Scenario**: A regression flips a guard — e.g. dropping `isRepoWatched` (line 310) so **unwatched** repos auto-rescan and burn the credit/LLM budget, or weakening the `onDefault`/`headMoved` check (lines 436-437) so branch-delete pushes (`after` all-zeros) or non-default-branch pushes trigger scans, or scoring a regression alert off a `deduped` persist. None of it is tested (`grep push`/`runPushRescan` in `route.test.ts` = 0).
- **Root cause**: The `push` branch and `runPushRescan` are entirely uncovered; `isRepoWatched`, `persistScanReport`, and `checkAndAlertRegression` are mocked with no assertions. The branch-delete (`/^0+$/.test(after)`) and non-default-branch skips are pure boolean logic that an LLM-generatable table closes cheaply.
- **Impact**: Unmetered/duplicate scans (cost + rate-limit exhaustion) and false or missing regression alerts on the watched fleet.
- **Fix sketch**: Table-drive the gate: assert `scanRepository` is **not** called when `isRepoWatched` is false, when `ref` ≠ `refs/heads/<default_branch>`, when `deleted` is true, or when `after` is all-zeros; assert it **is** called (and `checkAndAlertRegression` fires with the prior report) only when watched + on-default + head-moved AND `persistScanReport` returns `{deduped:false}` — and that a `deduped:true` persist suppresses the alert.

## 5. Test the replay dedup window: TTL expiry and `DELIVERY_MAX` eviction
- **Severity**: Medium
- **Category**: edge-case
- **File**: src/app/api/app/webhook/route.ts:72-101
- **Scenario**: A regression in `deliveryAlreadySeen` — e.g. eviction deleting still-valid (non-expired) entries first, or never expiring the TTL so the map grows unbounded, or `forgetDelivery` failing to release — either re-opens the replay window (a captured signed request re-triggers scans/gates) or permanently dedups legitimate redeliveries. Current tests assert release/dedup behavior end-to-end but never the **TTL expiry** or the `DELIVERY_MAX`-overflow eviction directly.
- **Root cause**: The 10-minute TTL and the 2000-entry bounded eviction are time/size-dependent branches that the existing redelivery-net tests (which reuse a fresh id per case) don't reach. With real timers and a hardcoded `Date.now`, these are deterministic and untested.
- **Impact**: Either a reopened webhook replay vector (security) or silently dropped legitimate scans (data-integrity) — moderate because the GitHub-confirmation gates are the primary control, but the dedup map is the documented replay defense.
- **Fix sketch**: Unit-test the dedup behavior with a mocked clock: assert a delivery seen at `T` returns `false`, returns `true` at `T+5min`, and returns `false` (re-processable) at `T+11min` (past `DELIVERY_TTL_MS`); insert >`DELIVERY_MAX` ids advancing the clock and assert expired entries are evicted **before** any unexpired one, and that map size stays bounded. Invariant: an unexpired id is never evicted while an expired id remains.
