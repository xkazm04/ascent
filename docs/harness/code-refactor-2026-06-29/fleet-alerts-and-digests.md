# Code Refactor — Fleet Alerts & Digests
> Total: 5 | Critical: 0 High: 1 Medium: 2 Low: 2

## 1. CRON_SECRET auth gate duplicated byte-for-byte across all three cron routes
- **Severity**: High
- **Category**: duplication
- **File**: src/app/api/cron/digest/route.ts:35-46 (also src/app/api/cron/rescan/route.ts:31-42, src/app/api/cron/purge/route.ts:17-28)
- **Scenario**: Each cron GET handler opens with the identical 8-line block: read `process.env.CRON_SECRET`; if unset → 503 "Cron is not configured (CRON_SECRET unset)."; read `authorization` header + `?key`; if `auth !== \`Bearer ${secret}\`` and `key !== secret` → 401 "Unauthorized." The code is identical in all three routes (only one clause of the explanatory comment differs).
- **Root cause**: The fail-closed hardening was applied by copy-paste to each route rather than factored into one helper; there is no shared cron-auth utility anywhere under `src` (grep for `requireCron|cronAuth|verifyCron` → none).
- **Impact**: A security-sensitive gate is maintained in triplicate. The prior fail-open regression history (documented in each route's comment + the purge/rescan tests) is exactly the kind of bug that re-creeps when one copy is edited and the others are missed; three near-identical test suites compound the cost.
- **Fix sketch**: Add `requireCronAuth(request: Request): NextResponse | null` to a shared module (e.g. `src/lib/cron-auth.ts` or alongside the cron routes). It returns the 503/401 response when auth fails, else null. Replace the block in each route with `const denied = requireCronAuth(request); if (denied) return denied;` (mirrors the existing `requireOrgRole` → `denied` convention in src/app/api/org/alerts/route.ts). Collapse the three duplicated auth-gate test cases onto the helper.

## 2. Digest route inlines public-base-URL resolution instead of the canonical `publicBaseUrl()`
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/cron/digest/route.ts:49 (siblings: src/lib/scan-alerts.ts:32-34 `publicBase()`, src/app/api/app/webhook/route.ts:175)
- **Scenario**: The digest route computes `const base = (process.env.ASCENT_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "")`. `scan-alerts.ts` defines a private `publicBase()` with the same expression, and the GitHub-App webhook route re-implements it again. Meanwhile `src/lib/site.ts` already exports `publicBaseUrl()` as the single canonical origin resolver, adopted by layout.tsx, sitemap.ts, robots.ts and billing/checkout/route.ts.
- **Root cause**: The alert/cron layer predates (or never adopted) the `publicBaseUrl()` consolidation. robots.ts's own comment notes it was migrated off a "local copy" for exactly this reason — these three are the remaining stragglers.
- **Impact**: Four definitions of "the site origin" that can drift. They already differ subtly: `publicBaseUrl()` also honors `VERCEL_PROJECT_PRODUCTION_URL` and strips multiple trailing slashes (`/\/+$/`), while the copies strip only one (`/\/$/`) and ignore the Vercel fallback — so digest links can resolve to `""` on a deploy where canonical URLs resolve fine.
- **Fix sketch**: Import `publicBaseUrl` from `@/lib/site` in the digest route (`const base = publicBaseUrl()`), delete `publicBase()` from scan-alerts.ts in favor of the import, and do the same at webhook/route.ts:175. One origin resolver, used everywhere.

## 3. Block-Kit section/context wrappers hand-rolled repeatedly across the four message builders
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/alerts.ts:154-165, 217-235, 286-288, 296-303
- **Scenario**: All four builders (`buildRegressionMessage`, `buildFleetDigestMessage`, `buildLowCreditsMessage`, `buildTestAlertMessage`) hand-construct the same Slack Block-Kit shapes inline: the section wrapper `{ type: "section", text: { type: "mrkdwn", text: … } }` appears ~7 times (lines 155, 156, 218, 223, 226, 286, 301) and the URL footer `{ type: "context", elements: [{ type: "mrkdwn", text: \`<${url}|label>\` }] }` appears 3 times (lines 162, 234, 287). The companion plain-text footer `if (url) parts.push("", url)` is likewise repeated in three builders.
- **Root cause**: Each builder grew independently; the shared Block-Kit primitives were never extracted, so the verbose literal shape is restated every time.
- **Impact**: ~10 copies of two literal structures in one module. Any Block-Kit change (e.g. switching `mrkdwn`→`plain_text`, adding an `accessory`) means editing every builder; the repetition also bloats the file and obscures each builder's actual content.
- **Fix sketch**: Add two tiny pure helpers in alerts.ts — `mrkdwnSection(text: string)` returning the section object, and `linkContext(url: string, label: string)` returning the context block (plus an optional `textFooter` for the `["", url]` pair). Rewrite the four builders to push helper results. All four are already unit-tested, so the refactor is verifiable against existing tests.

## 4. `org-alerts.ts` repeats the resolve-org-then-update boilerplate and lowercased-slug lookup
- **Severity**: Low
- **Category**: duplication
- **File**: src/lib/db/org-alerts.ts:24-31 and 50-63 (slug lookups also at 11-17, 40-47)
- **Scenario**: `setOrgAlertWebhook` and `setOrgAlertThresholds` are structurally identical: `isDbConfigured()` guard → `findUnique({ where: { slug: orgSlug.toLowerCase() }, select: { id: true } })` → `if (!org) return undefined` → `update({ where: { id: org.id }, data: … })`. The `where: { slug: orgSlug.toLowerCase() }` lookup is restated in all four exported helpers.
- **Root cause**: The two setter pairs (webhook, thresholds) were written separately against the same Organization row without a shared resolve step.
- **Impact**: Minor, but the repeated "lowercase the slug" rule is easy to get inconsistently right in a future fifth helper; the duplicated find-then-update obscures that both setters do the same thing with a different `data` payload.
- **Fix sketch**: Add a private `resolveOrgId(orgSlug): Promise<string | undefined>` (handles the `isDbConfigured` guard + lowercased-slug lookup + missing-org). Both setters become `const id = await resolveOrgId(orgSlug); if (!id) return undefined; await prisma.organization.update({ where: { id }, data: … })`.

## 5. Signed-delta formatting idiom restated inside `buildFleetDigestMessage`
- **Severity**: Low
- **Category**: duplication
- **File**: src/lib/alerts.ts:200-201, 205
- **Scenario**: The "prefix a `+` for non-negative numbers" idiom is written three times in one builder: `${d.overallDelta > 0 ? "+" : ""}${d.overallDelta}` twice in the `delta` summary ternary (lines 200, 201) and `${m.delta >= 0 ? "+" : ""}${m.delta}` in the `gain` helper (line 205).
- **Root cause**: A trivial formatter that was never named, so it's inlined wherever a signed score appears (note the two copies even disagree on the boundary: `> 0` vs `>= 0`).
- **Impact**: Small. Mostly a readability/consistency nit, but the `>0` vs `>=0` divergence is the classic sign of copy-paste formatting that drifts.
- **Fix sketch**: Add a `signed(n: number)` helper (`n > 0 ? \`+${n}\` : String(n)`) near the top of alerts.ts and use it in the `delta` string and `gain`. Pick one boundary deliberately and document it.
