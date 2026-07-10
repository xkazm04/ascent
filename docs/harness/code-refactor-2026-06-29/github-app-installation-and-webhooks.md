# Code Refactor — GitHub App Installation & Webhooks
> Total: 5 | Critical: 0 High: 1 Medium: 3 Low: 1

## 1. Local `publicBase()` duplicates (and lags) the canonical `publicBaseUrl()`
- **Severity**: High
- **Category**: duplication
- **File**: src/app/api/app/webhook/route.ts:174-176 (identical twin at src/lib/scan-alerts.ts:32-34)
- **Scenario**: The webhook route defines its own `publicBase()`:
  ```ts
  function publicBase(): string {
    return (process.env.ASCENT_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  }
  ```
  This is byte-for-byte identical to `publicBase()` in `src/lib/scan-alerts.ts:32-34`, and a near-copy of the project's canonical `publicBaseUrl()` in `src/lib/site.ts:5-13`.
- **Root cause**: Two ad-hoc local copies of an origin resolver that already has a single documented home (`@/lib/site`, used by sitemap/robots/layout/billing). The local copies were never folded back in.
- **Impact**: Three-way drift on a security/correctness-relevant value (the absolute base for the PR Check Run `detailsUrl`). The canonical `publicBaseUrl()` also falls back to `VERCEL_PROJECT_PRODUCTION_URL` and strips multiple trailing slashes (`/\/+$/`); the two local copies do neither — so on a Vercel-only env the webhook's `detailsUrl` silently becomes a relative path and the "details" link is dropped (`detailsUrl.startsWith("http") ? detailsUrl : undefined` at route.ts:241), while the rest of the app produces a correct absolute URL. The comment in `site.ts` explicitly says webhooks should derive from it.
- **Fix sketch**: Delete both local `publicBase()` functions; `import { publicBaseUrl } from "@/lib/site"` in `webhook/route.ts` and `scan-alerts.ts` and call it at the two use sites (route.ts:231, scan-alerts.ts:38/119). No behavior loss — only the missing fallbacks are gained.

## 2. Inline fork/archived filter in `app.ts` bypasses the canonical `isListableRepo` predicate
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/github/app.ts:277
- **Scenario**: `listInstallationReposResult` filters with a hand-rolled predicate `.filter((r) => !r.fork && !r.archived)`, with a comment that it should "match the public listing (listOrgRepos) and discovery (fetchUserRepos)".
- **Root cause**: `src/lib/github/host.ts:107` already exports `isListableRepo(r)` whose doc-comment states it is "The single source for this filter — both repo-listing surfaces gate on it so they can't silently diverge." `list.ts:117` and `discover.ts:87` call it; `app.ts` re-implements the rule inline instead.
- **Impact**: The explicit single-source-of-truth contract is defeated — a future change to what "listable" means (e.g. also excluding `disabled` or template repos) updates `host.ts`, `list.ts`, `discover.ts` but silently misses the App installation listing, the exact divergence `isListableRepo` was created to prevent.
- **Fix sketch**: `import { isListableRepo } from "@/lib/github/host"` (already imported there is `githubApiBase`) and replace the inline lambda with `.filter(isListableRepo)`. `GhRepo` already has `fork`/`archived`, so it satisfies the predicate's structural type.

## 3. The "log + forgetDelivery" failure-net catch is copy-pasted across every deferred handler
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/app/webhook/route.ts:248-267, 298-307, 325-329, 383-387 (plus the inner releases at 365 and 380)
- **Scenario**: Each deferred function (`runPrGate`, `reconcileInstallationRepos`, `runPushRescan`, `runInstallationLifecycle`) ends with the same shape:
  ```ts
  } catch (err) {
    console.error("[webhook] <label> failed", err instanceof Error ? err.message : err);
    if (deliveryId) forgetDelivery(deliveryId);
  }
  ```
  and `runInstallationLifecycle` repeats the `if (deliveryId) forgetDelivery(deliveryId)` release three more times on its internal failure branches.
- **Root cause**: The redelivery-retry net (release the dedup slot when deferred work fails after the 2xx) is a single cross-cutting policy implemented by hand in every handler, so the policy lives in 4+ places.
- **Impact**: A new deferred handler that forgets the release silently breaks the redelivery guarantee (the bug class this whole module is built to prevent), and a change to the net (e.g. add metrics, narrow which errors release) must be edited in every copy. The pinning test only covers the handlers that exist today.
- **Fix sketch**: Add one wrapper, e.g. `async function runDeferred(label: string, deliveryId: string | undefined, fn: () => Promise<void>)` that try/catches, logs `[webhook] ${label} failed`, and releases the delivery. Schedule handlers as `after(() => runDeferred("PR gate", delivery, () => runPrGate(ref)))`. `runPrGate` keeps only its bespoke neutral-check posting; the generic release moves into the wrapper.

## 4. Replay-dedup cache lives inside the route module, only reachable through `POST`
- **Severity**: Medium
- **Category**: structure
- **File**: src/app/api/app/webhook/route.ts:63-96 (within a ~490-line route file)
- **Scenario**: The self-contained replay-dedup infrastructure — the `seenDeliveries` Map plus `DELIVERY_TTL_MS`/`DELIVERY_MAX` and `deliveryAlreadySeen`/`forgetDelivery` — sits in the HTTP route file alongside all the business handlers, none of it exported.
- **Root cause**: A reusable, framework-agnostic bounded-TTL-set was written inline in the route rather than as its own module.
- **Impact**: The dedup logic (TTL expiry + oldest-first eviction) can only be exercised end-to-end through `POST`, which is why `route.test.ts:633-634` has to hand-copy the constants (`DELIVERY_TTL_MS`/`DELIVERY_MAX`) and drive the cache via crafted `installation`/`labeled` carrier requests — a sign the unit under test wants to be its own unit. It also bloats an already large route file mixing transport, auth, gate orchestration, reconcile and lifecycle.
- **Fix sketch**: Extract to `src/lib/github/webhook-dedup.ts` exporting `markSeenOrDuplicate(id)` and `forget(id)` (constants + Map inside), with a focused unit test for TTL + eviction. The route imports them; `route.test.ts` drops its mirrored constants and tests the policy directly.

## 5. `err instanceof Error ? err.message : err` repeated 12× with no shared helper
- **Severity**: Low
- **Category**: cleanup
- **File**: src/app/api/app/webhook/route.ts (12 occurrences: 113-116, 138-141, 166-169, 213, 226 area, 243, 246, 249, 263, 296, 299-302, 326, 358-361, 384) — 19× repo-wide across 6 files
- **Scenario**: The narrow-an-unknown-to-a-message idiom `err instanceof Error ? err.message : err` is inlined at every `console.warn`/`console.error` in the file (and recurs in `scan-alerts.ts`, `alerts.ts`, `scans-audit.ts`, billing/cron routes).
- **Root cause**: No shared `errMessage(err)` utility exists, so the same ternary is retyped at each log site.
- **Impact**: Minor verbosity/noise; inconsistent error logging if one site is later changed (e.g. to include a stack). Pure cleanup.
- **Fix sketch**: Add `export const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));` to a shared util (e.g. `@/lib/site` neighbour or a small `@/lib/errors`) and replace the inline ternaries. Low priority — batch with another touch of these files.
