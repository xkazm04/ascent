# Code Refactor — Usage Metering & Public Badge
> Context group: Billing, Credits & Metering
> Total: 4 findings (Critical: 0, High: 2, Medium: 1, Low: 1)

## 1. Inline tenant-read IDOR gate hand-rolled twice instead of calling `canReadOrg`
- **Severity**: High
- **Category**: duplication
- **File**: src/app/usage/page.tsx:82-112 ; src/app/api/usage/route.ts:36-77
- **Scenario**: `authz.ts` exports a canonical read-side tenant gate, `canReadOrg(org)` (authz.ts:62-70), explicitly documented as "the read-side tenant gate for org-scoped pages/APIs … closing the cross-tenant read IDOR." Yet both files in this context re-implement that decision by hand: the page (lines 87-112) does an auth-off `!== PUBLIC_ORG` branch + an auth-on `session.installations.some(...)` membership branch; the API route (lines 56-77) does the same auth-off-403 + `getSession()` + `installations.some(...)` membership branch. Both are line-for-line the logic already inside `canReadOrg` / `requireOrgRead`.
- **Root cause**: The usage page and API predate (or never adopted) the shared `canReadOrg`/`requireOrgRead` helpers and inlined the membership math at each call site; the long apologetic comments at both sites are a tell that the same security reasoning was authored twice.
- **Impact**: This is the dangerous class of duplication: a security gate copied three ways. The two inline copies have **already drifted** from the canonical one — `canReadOrg` additionally honors the Supabase login wall (`authGateEnabled()` → any signed-in viewer, authz.ts:65-67) and the `openOrgDashboardsEnabled()` auth-off opt-in (line 68), neither of which the inline copies in page.tsx/route.ts implement. So an org readable under the canonical gate (e.g. the seeded org-e2e flow with `ASCENT_OPEN_ORG_DASHBOARDS=1`, or a Supabase-walled deployment) is silently refused by /usage and /api/usage, and any future tightening of the gate must be remembered in three places. A divergence on the *permissive* side here is a latent IDOR.
- **Fix sketch**: In `route.ts`, replace the whole `if (orgLc !== "public") { … }` block (lines 56-77) with `const denied = await requireOrgRead(org); if (denied) return denied;` (after the `isDbConfigured()` 503). In `page.tsx`, replace the two membership branches (lines 87-94 and 102-112) with a single `if (!(await canReadOrg(org))) return <Notice …/>;`. Import from `@/lib/authz`. Both helpers already gate on `PUBLIC_ORG` first and already encode the auth-off-403 semantics, so this is behavior-preserving for the cases the inline copies handle and corrects the two they miss. The window-bound `Math.min(... PUBLIC_ORG ? 90 : 365 ...)` stays as-is (separate concern from the membership gate).

## 2. `?ref=badge` report click-through URL built three different ways
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:266-267 ; src/components/badge/BadgeGenerator.tsx:56 ; src/app/usage/page.tsx:388-392
- **Scenario**: The "badge → report" attribution link, `${origin}/report/<owner>/<repo>?ref=badge`, is constructed independently in the badge route (`const href = \`${origin}/report/${ownerN}/${repoN}?ref=badge\``) and in BadgeGenerator (`const reportUrl = … \`${origin}/report/${parsed.owner}/${parsed.repo}?ref=badge\``), and the literal `?ref=badge` token is also hard-coded into prose on the usage page. The `ref=badge` tag is a load-bearing analytics contract (badge-analytics reach + the "Click-throughs are tagged `?ref=badge`" copy), but nothing centralizes it.
- **Root cause**: Two independent features (the SVG endpoint and the embed-snippet UI) each needed the same permalink and each inlined it; the marketing copy then quoted the literal.
- **Impact**: Low blast radius but a real drift risk: if the attribution param is ever renamed (e.g. `?ref=readme-badge`) or the report path changes, the route and the generator must be kept in lockstep by hand or click-through attribution silently breaks for one of the two emitters while the other keeps working — exactly the kind of half-updated state that makes the reach panel quietly wrong.
- **Fix sketch**: Add a tiny shared builder, e.g. `export function badgeReportHref(origin: string, owner: string, repo: string) { return \`${origin}/report/${owner}/${repo}?ref=badge\`; }`, in a neutral spot both sides already import from (`@/lib/ui` is imported by the route, or a small `@/lib/badge` leaf). Call it from route.ts:267 and BadgeGenerator.tsx:56. Leave the usage-page prose as documentation. Behavior-preserving — identical string output.

## 3. `parseStyle` (route) vs `STYLES`/`Style` (generator) — duplicated badge-style vocabulary
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:95,198-200 ; src/components/badge/BadgeGenerator.tsx:23,27
- **Scenario**: The set of valid badge styles `"flat" | "flat-square" | "for-the-badge"` is declared as the `BadgeStyle` type + `parseStyle` validator on the server (route.ts:95, 198-200) and re-declared as the `Style` type + `STYLES` array on the client (BadgeGenerator.tsx:23, 27). The generator builds query strings the route must accept, so these two lists are an implicit contract maintained in two files.
- **Root cause**: The client component deliberately avoids importing the server route module (sensible — see its `parseRepo` comment), so it re-typed the enum rather than importing a shared one.
- **Impact**: Adding a fourth style (or renaming one) requires editing both the route's `parseStyle`/`BadgeStyle` and the generator's `STYLES`/`Style`; miss one and the UI offers a style the endpoint silently downgrades to `flat`, or the endpoint supports a style the UI never surfaces. Maintenance + subtle-mismatch risk, not a live bug today.
- **Fix sketch**: Extract `export type BadgeStyle = "flat" | "flat-square" | "for-the-badge";` and `export const BADGE_STYLES: BadgeStyle[] = ["flat", "flat-square", "for-the-badge"];` into a shared, dependency-light leaf (e.g. `@/lib/badge`) importable by both a server route and a `"use client"` component. Have route.ts import `BadgeStyle` (keep `parseStyle` local, narrowing against `BADGE_STYLES`) and the generator import `BADGE_STYLES`/`BadgeStyle` for its `Style` type and `STYLES` array. Behavior-preserving.

## 4. Duplicated `PUBLIC_ORG = "public"` literal in the db leaf
- **Severity**: Low
- **Category**: duplication
- **File**: src/lib/db/badge-analytics.ts:13
- **Scenario**: `badge-analytics.ts` declares `const PUBLIC_ORG = "public"; // mirrors @/lib/auth PUBLIC_ORG without coupling a db leaf to auth`, a fourth hand-maintained copy of the same sentinel (alongside `@/lib/auth`, `OrgSwitcher.tsx`, and — after finding #1 — the inline checks). The comment acknowledges it is a deliberate copy.
- **Root cause**: Intentional decoupling — the author didn't want a `src/lib/db` leaf to import `@/lib/auth`. Reasonable instinct, but it leaves the magic string redundantly defined.
- **Impact**: Cosmetic / very low. The value "public" is effectively frozen (changing it would be a data-layer migration anyway), so drift is unlikely; flagged only for completeness. The existing comment already documents the trade-off, so this is borderline a non-finding.
- **Fix sketch**: Optional. If a shared constants leaf with no auth dependency is ever introduced (e.g. `@/lib/constants`), move `PUBLIC_ORG` there and import it from both `@/lib/auth` and `badge-analytics.ts`. Otherwise leave as-is — the documented copy is an acceptable decoupling and not worth a churn-only change. (Not recommending an action; recorded for the audit trail.)
