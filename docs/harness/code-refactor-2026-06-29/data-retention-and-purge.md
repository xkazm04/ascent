# Code Refactor — Data Retention & Purge
> Total: 3 | Critical: 0 High: 1 Medium: 1 Low: 1

## 1. CRON_SECRET fail-closed auth gate triplicated across all three cron routes
- **Severity**: High
- **Category**: duplication
- **File**: src/app/api/cron/purge/route.ts:17-28 (also src/app/api/cron/digest/route.ts:35-46, src/app/api/cron/rescan/route.ts:31-42)
- **Scenario**: Each cron route opens its `GET` handler with the same ~12-line block: read `process.env.CRON_SECRET`, return `503 "Cron is not configured (CRON_SECRET unset)."` when missing/empty, then read the `authorization` header + `?key=` param and return `401 "Unauthorized."` unless `auth === \`Bearer ${secret}\`` or `key === secret`. The purge copy is:
  ```ts
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron is not configured (CRON_SECRET unset)." }, { status: 503 });
  }
  const auth = request.headers.get("authorization");
  const key = new URL(request.url).searchParams.get("key");
  if (auth !== `Bearer ${secret}` && key !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  ```
  The 4-line "Fail closed:" explanatory comment is also copy-pasted into all three (only the trailing "a route that …" clause differs per route).
- **Root cause**: The gate was hardened to fail-closed in three places independently; the logic is identical and the bodies/status codes are byte-for-byte the same. There is no shared `requireCronAuth` helper today (grep finds no such symbol — only the three inline copies).
- **Impact**: Three-way drift risk on a security-critical control: a future tweak (e.g. constant-time compare, a new header form, a different status code) must be applied in three files and is easy to miss in one — exactly the failure mode the in-file comments say already happened once (the gate regressed to fail-open). Also triples the surface every auth test must cover.
- **Fix sketch**: Add `src/lib/cron-auth.ts` exporting `requireCronAuth(request: Request): NextResponse | null` that returns the 503/401 `NextResponse` on failure and `null` on success. Replace each route's block with `const denied = requireCronAuth(request); if (denied) return denied;`. Keep the explanatory comment once, in the helper. The existing per-route auth tests (purge/digest/rescan `route.test.ts`) continue to assert end-to-end; optionally add one focused unit test for the helper.

## 2. Unused barrel re-exports of retention symbols in db/index.ts
- **Severity**: Medium
- **Category**: dead-code
- **File**: src/lib/db/index.ts:49-56
- **Scenario**: The `@/lib/db` barrel re-exports nine retention symbols: `purgeExpiredData`, `envRetentionDefaults`, `resolveRetention`, `clampBatchSize`, `PURGE_ACTION`, `RETENTION_DEFAULT_BATCH_SIZE`, and the types `RetentionPolicy`, `OrgPurgeResult`, `PurgeSummary`. Only `purgeExpiredData` (and `isDbConfigured`) is actually imported from the barrel (`src/app/api/cron/purge/route.ts:10`). The other eight have zero consumers via `@/lib/db` anywhere under `src` — the unit test imports them directly from `@/lib/db/retention` (`retention.test.ts:2-9`), and the rest are used only inside `retention.ts` itself.
- **Root cause**: The barrel forwards the module's full public surface by reflex, but nothing downstream consumes that forwarded surface; the only external consumer needs a single function.
- **Impact**: Dead forwarding surface: it advertises a public API (env-default parsing, policy resolution, batch clamping, the audit-action constant) that no caller uses, so readers/refactorers must chase eight phantom "exports" and tools can't tree-shake them out of the barrel's transitive graph. Confirmed zero references (grep over `src` for each symbol returns only `retention.ts`, `retention.test.ts`, and this `index.ts` block).
- **Fix sketch**: Trim the `export { … } from "@/lib/db/retention"` block to just `purgeExpiredData` (plus any type genuinely consumed via the barrel — none today). The underlying symbols stay exported from `retention.ts`, so the direct-import test is unaffected. If a shared "import db things from the barrel" convention is desired instead, point `retention.test.ts` at `@/lib/db` and keep the re-exports — but pick one; the current state is re-exports nobody reads.

## 3. Orphan audit sweep duplicates the per-org audit-write + failure-check tail
- **Severity**: Low
- **Category**: duplication
- **File**: src/lib/db/retention.ts:258-282 vs 300-318
- **Scenario**: The per-org branch and the org-less orphan sweep repeat the same shape: compute the cutoff `new Date(Date.now() - <window>.auditDays * DAY_MS)` (lines 259 and 302), call `pruneAudit(...)`, then `recordAudit(PURGE_ACTION, …)` and run the identical failure check:
  ```ts
  if (!audited) {
    errors.push(`${scope}: retention audit write failed (deletes applied, compliance trace missing)`);
  }
  ```
  (lines 280-282 and 306-308, with only `${org.slug}` vs `(orphan)` differing), followed by a near-identical `results.push({ orgSlug, policy, …Deleted })` object (284-292 and 309-317).
- **Root cause**: The orphan sweep was bolted on after the per-org loop and re-implements the same "prune audit window → record self-audit → push result, surfacing a failed audit write" tail rather than sharing it.
- **Impact**: Two copies of the compliance-trace failure string and the audit-write semantics; a change to the audit payload or the degraded-run wording must be made in both, and the duplicated cutoff math invites the two windows drifting apart silently.
- **Fix sketch**: Extract a small local helper, e.g. `async function auditPurge(scope: string, payload: object, opts): Promise<void>` that calls `recordAudit` and pushes the standard failure message to `errors` on `!audited`; call it from both sites. Optionally factor the `cutoff = now − auditDays·DAY_MS` into a one-line helper shared by both sweeps. This removes the duplicated string literal and keeps the two windows computed identically by construction.
