# GitHub OAuth & Session — bug-hunter + ui-perfectionist scan

> Context: GitHub OAuth & Session (group: Identity & GitHub Connectivity)
> Files scanned: 16
> Total: 7 findings (Critical: 0, High: 2, Medium: 3, Low: 2)

Predicate map (which auth layer each surface actually gates on):
- ACTIVE (Supabase wall): `authGateEnabled()` / `getViewer()` / `requireViewer()` — used by `org/[slug]/layout.tsx`, `access.ts`, `proxy.ts`, `authz.ts`, `recommendations/route.ts` (already migrated).
- DORMANT (custom OAuth, inert in prod — no `ascent_session` cookie is ever minted because sign-in is Supabase): `isAuthConfigured()` / `getSession()` — still consumed by `readableOrgForOwner`, `getActiveOrg`, `orgOptionsForSession`, `resolveViewerLogin` (first), Brand header, and the auth pages (trends/usage/launch/invite/compare). Every one of those is dead-code authz today.

## 1. `readableOrgForOwner` derives org access from the dormant custom-OAuth session
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: dead-code-authz
- **File**: src/lib/auth.ts:336
- **Scenario**: A private-org member (signed in via the active Supabase wall) opens their private report / history / pdf / skill / passport. Those routes org-scope reads through `readableOrgForOwner(owner)`, which calls `getSession()` (line 338). Under Supabase no `ascent_session` cookie exists, so `getSession()` is always null → the `.some(installation…)` check is always false → the function always returns `"public"`.
- **Root cause**: The false assumption that `getSession()` reflects the signed-in viewer. It reflects only the DORMANT stack; the active identity is `getViewer()`.
- **Impact**: Private-tenant scan data is unreadable in production — every private-org member is silently downgraded to the public org across ~9 consumer surfaces (history, report/pdf, report/skill, passport{,/pr,/overrides}, report page, opengraph, trends, compare). Fail-closed (not a leak) but the private-read feature is broken. `recommendations/route.ts:32-41` already documents and worked around this exact bug by switching to `canReadOrg`.
- **Fix sketch**: Re-implement `readableOrgForOwner` on the Supabase-aware `canReadOrg`/`getViewer` path (as `recommendations` did), or resolve installations from the active viewer; retire the `getSession()` dependency.

## 2. `getActiveOrg` / `orgOptionsForSession` also key off the dormant session — dead org switcher + broken active-org POST
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: dead-code-authz
- **File**: src/lib/auth.ts:348
- **Scenario**: A Supabase-signed-in user with real GitHub-App installations opens the header (Brand.tsx). `orgOptionsForSession(session)` and `getActiveOrg(session)` both take the dormant `getSession()` result (null), so options collapse to `["public"]`. Brand's `showSwitcher` (Brand.tsx:46) requires `isAuthConfigured() && session && installations.length>0` — all dormant — so the org switcher NEVER renders. Separately, `POST /api/org/active` validates the requested org via `orgOptionsForSession(await getSession())` (org/active/route.ts:42) → only `"public"` matches → every real org is rejected with 400 "Unknown org."
- **Root cause**: Same false assumption as #1 — org selection UI/authorization is computed from the inert stack.
- **Impact**: The multi-tenant header org switcher is invisible for every real user, and programmatic active-org selection 400s. Multi-org navigation is effectively dead under the production auth config.
- **Fix sketch**: Feed `orgOptionsForSession`/`getActiveOrg` from the active viewer's memberships (`listOrgsForLogin(viewer.login)` / `canReadOrg`) instead of `getSession().installations`.

## 3. `SignInNotice` defaults to the dormant GitHub provider — sign-in CTA is a dead end
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: dead-cta
- **File**: src/components/SignInNotice.tsx:20
- **Scenario**: `provider` defaults to `"github"` (line 20), rendering `GitHubSignInButton` (line 45). Callers that don't pass `provider="supabase"` — launch, usage, trends, invite, report/compare, and org-layout's *expired* branch (org/[slug]/layout.tsx:69) — show a CTA that navigates to `/api/auth/login`. With the custom OAuth dormant that route redirects to `/connect?error=not_configured`; even if its creds are present it starts a custom flow whose `ascent_session` the active Supabase gate (`getViewer`) ignores. Either way the user cannot actually sign in from those prompts.
- **Root cause**: The default provider tracks the legacy stack, not the active wall (`authGateEnabled`).
- **Impact**: Users who hit an expired/absent session on gated pages get a sign-in button that leads to an error page or a no-op, on the app's most conversion-sensitive surface.
- **Fix sketch**: Default `provider` to `"supabase"`, or derive it from `authGateEnabled()`/`supabaseAuthConfigured()` so the CTA always drives the active backend; audit the six default-provider call sites.

## 4. `resolveViewerLogin` resolves the dormant session first and mixes identity namespaces (WIP)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: dead-code-authz
- **File**: src/lib/access.ts:90
- **Scenario**: The new (uncommitted) `resolveViewerLogin` returns `getSession()?.login` before `getViewer()?.login` (lines 91-93) and backs Shared Org Memory's `visibility='private'` author check + `createdBy`. The custom `getSession().login` is a raw GitHub login; the Supabase `getViewer().login` is `user_name ?? preferred_username ?? email ?? id` (access.ts:54). In prod the first branch is permanently dead; but if any `ascent_session` is ever present (dev used the custom flow, or a stray cookie) the function flips to the custom login while every other authz path uses the Supabase login — so a private memory written under one namespace becomes invisible/unowned under the other.
- **Root cause**: Precedence favors the inert stack, and private-data ownership is keyed on a derived, non-stable login rather than a single canonical identity.
- **Impact**: Dead branch today; latent cross-stack ownership mismatch that could hide a user's own private memory or misattribute `createdBy`/actor.
- **Fix sketch**: Drop the `getSession()` branch (resolve from `getViewer()` only), and key private ownership on the stable Supabase `u.id` rather than the fallback-derived login.

## 5. Supabase sign-in / sign-out failures are swallowed to the console — no visible error state
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: error-state
- **File**: src/components/SupabaseAuthButtons.tsx:41
- **Scenario**: In `SupabaseSignInButton.signIn` an OAuth error only `console.error`s and re-enables the button (lines 39-43); `SignOutButton.signOut` does the same on failure (lines 71-76). A user on a flaky network clicks "Sign in" / "Sign out", the screen shows nothing, no message appears, and the control silently returns to idle — indistinguishable from "nothing happened." On a shared machine a failed sign-out reads as success theater.
- **Root cause**: The components own a pending state but no error state, so the only failure signal goes to a console the user never sees.
- **Impact**: Silent failure on the primary auth affordance; users retry blindly or wrongly believe they signed out.
- **Fix sketch**: Add an error state rendered as an inline `role="alert"` region ("Couldn't reach GitHub — try again") next to the button on the `{ error }` / catch paths, mirroring `SignInNotice`'s alert slot.

## 6. `SignOutButton` clears only the Supabase session, never the custom `ascent_session`
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: incomplete-logout
- **File**: src/components/SupabaseAuthButtons.tsx:65
- **Scenario**: The header's active sign-out (Brand.tsx:62) calls only `supabase.auth.signOut()`. It never POSTs `/api/auth/logout`, so it neither clears the `ascent_session` cookie nor bumps the custom-OAuth server-side session version. If a deployment ever runs both stacks (or a leftover `ascent_session` exists from an earlier custom sign-in), "Sign out" leaves that session valid for its full TTL.
- **Root cause**: Sign-out assumes a single auth stack; the two logout paths are not unified.
- **Impact**: Incomplete logout in a dual-stack/leftover-cookie situation (edge, given the custom stack is dormant).
- **Fix sketch**: After `supabase.auth.signOut()` succeeds, also `fetch("/api/auth/logout", { method: "POST" })` (same-origin) so both cookies/versions are cleared.

## 7. `createSupabaseBrowserClient` asserts env non-null — stuck-pending click when Supabase is unconfigured
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: missing-config-guard
- **File**: src/lib/supabase/client.ts:9
- **Scenario**: The client uses `process.env.NEXT_PUBLIC_SUPABASE_URL!` / `ANON_KEY!` (lines 10-11). `QuotaNotice` renders `SupabaseSignInButton` unconditionally (QuotaNotice.tsx:63,111). In an auth-off / no-Supabase deployment, clicking it runs `SupabaseSignInButton.signIn`, which calls `createSupabaseBrowserClient()` before any try/catch — `createBrowserClient(undefined, undefined)` throws synchronously, the rejection is unhandled, and `setPending(true)` (already set) never clears, leaving the button stuck on "Redirecting to GitHub…" forever.
- **Root cause**: The Supabase CTA is rendered without a config guard, and the client trusts env vars that may be absent in supported auth-off modes.
- **Impact**: A permanently stuck, disabled sign-in button on the quota surface of auth-off/demo deployments.
- **Fix sketch**: Guard the CTA render on `supabaseAuthConfigured()` (don't render it when unset), and/or wrap `signIn`'s body in try/catch that resets `pending` and surfaces an error.
