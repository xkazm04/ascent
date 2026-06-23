# Code Refactor — GitHub App Installation & Webhooks
> Context group: Identity & GitHub Connectivity
> Total: 3 findings (Critical: 0, High: 1, Medium: 1, Low: 1)

This context is in good shape. The webhook route, token minting, and installation persistence are dense but purposeful — most of the apparent complexity is documented security/idempotency machinery (replay dedup, fail-closed ownership confirmation, truncation-aware reconcile) and is genuinely load-bearing, not cruft. Three findings stand out; the first is a real dead-code removal worth doing.

## 1. Dead exported helper `unwatchReposForInstallation` (superseded by `reconcileWatchedRepos`)
- **Severity**: High
- **Category**: dead-code
- **File**: src/lib/db/installations.ts:88-110 (also src/lib/db/index.ts:95-101; src/app/api/app/webhook/route.test.ts:44,66,91,223,227)
- **Scenario**: `unwatchReposForInstallation(installationId, fullNames)` clears watch/schedule for a named set of repos an installation lost access to. It is fully defined and re-exported through the `@/lib/db` barrel, but **no production code calls it**. A repo-wide grep finds only: the definition, the barrel re-export, and the webhook test — where it is imported solely to assert it is *never* called (`expect(mockUnwatch).not.toHaveBeenCalled()`).
- **Root cause**: The `installation_repositories` handler was deliberately reworked (see route.ts:430-444 and the docblock at installations.ts:112-122) to stop trusting the payload's `repositories_removed` and instead GitHub-confirm the live set via `reconcileInstallationRepos` → `reconcileWatchedRepos`. That replacement made `unwatchReposForInstallation` — the old "act on the payload's removed list verbatim" path — obsolete, but the function, its export, and the test's import/mock were left behind.
- **Impact**: A maintainer reading `installations.ts` sees two near-identical "quiesce repos for an installation" functions and must reverse-engineer which is live; the dangling `unwatchReposForInstallation` import in the webhook test (it's mocked in the `vi.mock("@/lib/db", …)` block at route.test.ts:44 and aliased to `mockUnwatch`) implies a code path that no longer exists. It is a small but real correctness-of-mental-model tax and adds surface to the public DB API for nothing.
- **Fix sketch**: Delete the `unwatchReposForInstallation` function (installations.ts:88-110) and its docblock, remove the `unwatchReposForInstallation,` line from the `@/lib/db` re-export (index.ts:98), and remove the now-unused test plumbing in route.test.ts: the `unwatchReposForInstallation: vi.fn()` mock entry (line 44), the import (line 66), the `mockUnwatch` alias (line 91), and the two `expect(mockUnwatch).not.toHaveBeenCalled()` assertions (lines 223, 227) — those assertions are vacuous once the symbol no longer exists; the surrounding tests still meaningfully pin "nothing is unwatched straight from the payload" via the `mockReconcile` assertions. Behavior-preserving: nothing imports it at runtime.

## 2. `githubAppFetch` is a redundant one-line alias of the private `ghApp`
- **Severity**: Medium
- **Category**: structure
- **File**: src/lib/github/app.ts:89-115
- **Scenario**: `githubAppFetch<T>(path, auth, init)` (lines 94-96) is a pure pass-through — its entire body is `return ghApp<T>(path, auth, init);` — to the private `ghApp<T>` (lines 98-115), which has the **identical signature**. The module then uses two different names for the same call: internal callers (`getInstallation`, `getInstallationToken`, `listInstallationReposResult`) call `ghApp` directly, while external write surfaces (`github/write.ts`, `github/checks.ts`) import `githubAppFetch`.
- **Root cause**: `ghApp` was the original private helper; when `write.ts`/`checks.ts` needed the same authenticated fetch, an exported wrapper was added rather than just exporting `ghApp`. The two have not diverged — the wrapper adds no headers, validation, or behavior.
- **Impact**: Two names for one function invites the reader to look for a difference that isn't there, and a future change to fetch behavior must be made conscious of which name a call site uses. Minor maintenance/confusion cost; no bug risk today.
- **Fix sketch**: Collapse to a single name. Rename the private `ghApp` to `githubAppFetch`, `export` it, and delete the wrapper (lines 89-96), updating the three internal call sites (app.ts:119, 166, 220) to the renamed function. External importers (`write.ts`, `checks.ts`) already use `githubAppFetch` and need no change. Behavior-preserving — same headers, same `AppApiError` handling, same signature.

## 3. Unused `WebhookPayload` fields documenting a removed payload-trusting path
- **Severity**: Low
- **Category**: dead-code
- **File**: src/app/api/app/webhook/route.ts:45-61 (specifically lines 52, 54-57)
- **Scenario**: The `WebhookPayload` interface declares `before?` (line 52), `repositories_added?` (line 55), `repositories_removed?` (line 56), and `repository_selection?` (line 57), with a comment (line 54) explaining the `installation_repositories` add/remove lists. None of these four fields is read anywhere in the handler — the `installation_repositories` branch (lines 430-444) deliberately ignores the payload's repo lists and reconciles against GitHub's live set, and the `push` branch reads `payload.after`/`payload.deleted`/`payload.ref` but never `payload.before`.
- **Root cause**: These fields described the old "act on `repositories_removed` / `repositories_added` from the payload" approach that was intentionally abandoned for the GitHub-confirmed reconcile (same refactor as finding #1). The type members and their explanatory comment outlived the code that consumed them.
- **Impact**: The interface and its comment imply the handler still keys off the payload's add/remove lists, which is precisely the behavior the security rework removed — mildly misleading to a reader auditing the destructive-event path. No runtime cost.
- **Fix sketch**: Remove the four unused members (lines 52, 55, 56, 57) and the now-orphaned explanatory comment on line 54. Keep `before` only if you prefer to leave it as documentation of the push payload shape; otherwise drop it too. Behavior-preserving — these are type-only declarations with no readers. (Leave `repository_selection` removal as-is; it is referenced only in this interface.)
