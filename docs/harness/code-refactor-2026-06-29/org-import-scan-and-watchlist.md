# Code Refactor — Org Import, Scan & Watchlist
> Total: 5 | Critical: 0 High: 2 Medium: 2 Low: 1

## 1. `isSameOrigin` reimplemented locally in /api/org/active instead of importing the canonical one
- **Severity**: High
- **Category**: duplication
- **File**: src/app/api/org/active/route.ts:19-31 (vs canonical src/lib/auth.ts:385-396)
- **Scenario**: `active/route.ts` defines a private `function isSameOrigin(request)` (Origin-host compare with a `sec-fetch-site` fallback) that is a byte-for-byte copy of the exported `isSameOrigin` in `@/lib/auth.ts`. The header even narrates the same "mirroring /api/auth/logout" rationale that the shared helper already serves.
- **Root cause**: The canonical CSRF guard was extracted to `@/lib/auth.ts` (its JSDoc says "Single-sourced here so the handlers can't drift apart") and is imported by ~15 routes (logout, revoke-sessions, org/plan, org/members, org/credits/grant, passport/*, etc.). This route never migrated and kept the original inline copy.
- **Impact**: Two definitions of a security-relevant guard that must stay identical; a future hardening to the shared version (e.g. handling a missing/null host, or a `null`-origin sandbox) silently skips this endpoint. Also makes the route untestable via the shared `isSameOrigin` mock the sibling route tests already use.
- **Fix sketch**: Delete the local function and `import { isSameOrigin } from "@/lib/auth";`. No call-site changes (same name/signature). The 11-line local block disappears; behavior is identical.

## 2. CRON_SECRET fail-closed auth gate triplicated across the cron routes
- **Severity**: High
- **Category**: duplication
- **File**: src/app/api/cron/rescan/route.ts:31-42 (also src/app/api/cron/purge/route.ts:17-28, src/app/api/cron/digest/route.ts:35-46)
- **Scenario**: All three cron handlers open with the identical ~12-line block: read `process.env.CRON_SECRET`; if falsy return the same 503 `{ error: "Cron is not configured (CRON_SECRET unset)." }`; then read the `authorization` header + `?key=` param and `if (auth !== \`Bearer ${secret}\` && key !== secret)` return the same 401 `{ error: "Unauthorized." }`. Even the multi-line "Fail closed…" comment is copy-pasted (only the route-name clause differs).
- **Root cause**: The fail-closed hardening (the comment notes the gate "already regressed to fail-open once") was applied by pasting the same block into each cron route rather than extracting one guard. The cron test files (`*.test.ts`) each re-assert the same matrix, confirming the contract is meant to be uniform.
- **Impact**: Three places to keep in lockstep for an auth gate that has already regressed once; the next route that forgets the `!secret` fail-closed branch reopens an unauthenticated, token-minting / data-deleting endpoint. High duplication-of-security-logic cost.
- **Fix sketch**: Add `function requireCronAuth(request: Request): NextResponse | null` (e.g. in a new `src/lib/cron-auth.ts` or alongside the existing auth helpers) returning the 503/401 response or `null` when authorized. Each route becomes `const denied = requireCronAuth(request); if (denied) return denied;` — mirroring the existing `requireOrgAccess` denial pattern used by the org routes in this same context.

## 3. Org-slug → id resolution preamble repeated ~6× in org-watch.ts instead of the canonical `getOrgId`
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/db/org-watch.ts:21, 71, 92, 231, 255, 274 (canonical: src/lib/db/org-rollup.ts:34 `getOrgId`)
- **Scenario**: `isRepoWatched`, `setRepoSchedule`, `setWatchedSchedule`, `recordScanOutcome`, `recordConformance`, and `listWatchedRepos` each inline `const org = await prisma.organization.findUnique({ where: { slug … }, select: { id: true } }); if (!org) return …`. `getOrgId(slug)` in org-rollup.ts already encapsulates exactly this (`isDbConfigured` + lookup + `?.id ?? null`) and is exported through the `@/lib/db` barrel for reuse.
- **Root cause**: Each function grew its own resolver before/instead of routing through the shared one. The drift is already visible: `recordConformance` (line 255) lowercases the slug (`slug: orgSlug.toLowerCase()`) while its siblings do not — the exact inconsistency `getOrgId` was built to normalize away ("lets callers share this one resolver instead of each maintaining a privately-drifting copy").
- **Impact**: Six copies of a tenant-scoping lookup with subtle case-handling drift; a change to org resolution (caching, soft-delete filter, normalization) must be applied six times or tenants behave inconsistently. Noise that obscures each function's real work.
- **Fix sketch**: Add a tiny `resolveOrgId(slug)` to the already-shared `src/lib/db/org-shared.ts` (or import `getOrgId` from org-rollup; org-shared avoids any org-rollup↔org-watch coupling concern). Replace each preamble with `const orgId = await resolveOrgId(orgSlug); if (!orgId) return …;`, then use `orgId` directly in the `where`. Note: `setRepoWatch`/`seedWatchlist` keep `ensureOrg` (they upsert) — leave those.

## 4. RepoRescanButton duplicates OrgScanButton's POST-/api/org/scan + SSE-consume logic
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/org/RepoRescanButton.tsx:33-73 (mirrors src/components/org/OrgScanButton.tsx:26-77)
- **Scenario**: Both components `fetch("/api/org/scan", { method:"POST", … })`, branch on `!res.ok || !res.body` to parse an error-JSON fallback, then `await readSSE(res.body, ({ event, data }) => …)` decoding the same `repo` (`data.error` / `data.skipped`) and stream-level `error` vocabulary, and `router.refresh()` on success. RepoRescanButton's own header comment states it "Mirrors OrgScanButton's SSE consumption (repo/error/skipped vocabulary)".
- **Root cause**: The scoped single-repo button (`repos:[fullName]`) was built by copying the all-watched button's request+stream plumbing rather than factoring the shared transport out; only the presentation (progress meter + counters vs. a single terminal `Outcome`) genuinely differs.
- **Impact**: The `/api/org/scan` SSE contract (event names, the `skipped: "insufficient_credits"` sentinel, the `INSUFFICIENT_CREDITS` 402 code) is decoded in two places; a server-side change to that vocabulary must be chased through both components or one silently misreports partial/credit outcomes.
- **Fix sketch**: Extract a `src/lib/orgScan.ts` (or a `useOrgScan` hook) that POSTs the body and invokes typed callbacks (`onRepo`, `onNotice`, `onProgress`, `onError`) over `readSSE`, returning the credit/error classification. Both buttons keep only their own UI state and pass callbacks. Keeps the wire contract single-sourced.

## 5. Schedule-validation `Set` rebuilt from the same SCHEDULES constant in two routes
- **Severity**: Low
- **Category**: duplication
- **File**: src/app/api/org/schedule/route.ts:14 and src/app/api/org/import/route.ts:38,44
- **Scenario**: `schedule/route.ts` does `const VALID = new Set<string>(SCHEDULES)` then `!VALID.has(body.schedule)`; `import/route.ts` imports the same constant aliased (`SCHEDULES as SCAN_SCHEDULES`), wraps it `const SCHEDULES = new Set<string>(SCAN_SCHEDULES)`, then `SCHEDULES.has(body.schedule)`. Both build a membership Set over the canonical `SCHEDULES` tuple from `installationRepoTypes` purely to validate an incoming free-string cadence.
- **Root cause**: No shared validator exists for the `Schedule` vocabulary, so each route re-derives a lookup Set (the import route's alias-then-shadow also makes the file harder to read).
- **Impact**: Minor — two duplicate Sets plus a confusing rename/shadow; low ongoing cost, but a third caller will copy the pattern again.
- **Fix sketch**: Export `export const isValidSchedule = (s: string): s is Schedule => (SCHEDULES as readonly string[]).includes(s);` from `src/components/connect/installationRepoTypes.ts` (next to `SCHEDULES`/`Schedule`). Both routes drop their Set and call `isValidSchedule(body.schedule)`; the import route also loses the alias/shadow. (`ScheduleSelect.tsx`'s `normalize` could reuse the same predicate.)
