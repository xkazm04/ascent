# Code Refactor — GitHub OAuth & Session
> Total: 4 | Critical: 0 High: 0 Medium: 3 Low: 1

> Scope note on the "dormant custom OAuth": investigated thoroughly and it is **NOT dead**.
> `src/lib/auth.ts` and the `/api/auth/login|callback|logout|session|revoke-sessions` routes back
> the live `ascent_session` cookie that drives org-data authorization (`getSession`,
> `getSessionState`, `readableOrgForOwner`, `orgOptionsForSession`, `getActiveOrg`, `isSameOrigin`,
> `safeNext`, `PUBLIC_ORG`) across ~50 files, and `GitHubSignInButton` (→ `/api/auth/login`) is still
> the default sign-in CTA in the header (`Brand.tsx`) and on most gated pages. So nothing in the
> custom-OAuth module is flagged as dead. The findings below are duplication/structure/dead-export.

## 1. Sign-in button markup shell duplicated across the two CTA components
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/GitHubSignInButton.tsx:51-73 and src/components/SupabaseAuthButtons.tsx:54-69
- **Scenario**: `GitHubSignInButton` (an `<a>`) and `SupabaseSignInButton` (a `<button>`) render a byte-identical inner body: the `focus-ring inline-flex items-center justify-center gap-2 transition ${v.box} ${pending ? "cursor-wait opacity-70" : ""} ${className}` wrapper class, the crossfading icon stack (`<span className="relative inline-flex…" style={{width:v.icon,height:v.icon}}>` holding the two opacity-toggled `<GitHubMark/>` / `<Spinner/>` spans), the label span, and the `<span role="status" aria-live="polite" className="sr-only">` region. Only the outer element (`<a href>` vs `<button>`) and the `aria-disabled` vs `disabled` attribute genuinely differ.
- **Root cause**: An earlier refactor extracted `GitHubMark`, `Spinner`, and `SIGN_IN_VARIANTS` into `src/components/auth/buttonChrome.tsx` but stopped short of the *markup* — `buttonChrome.tsx`'s own header even states "each button supplies only its distinct wrapper element + click handler", yet today both buttons re-spell the entire icon-stack + status-region body.
- **Impact**: ~15 lines duplicated across two files; any polish to the spinner crossfade, the box class, or the a11y status region must be made twice and has already started to drift (e.g. `GitHubSignInButton` wraps its label in `<span className="transition-opacity duration-150">` while `SupabaseSignInButton` uses a bare `<span>`; one uses `busyLabel`, the other `v.busy`).
- **Fix sketch**: Add a small presentational helper to `buttonChrome.tsx` — e.g. `signInButtonClass(v, pending, className)` plus a `<SignInButtonBody v pending idleLabel busyLabel />` that renders the icon stack + label + status region. Each button then becomes just its `<a>`/`<button>` wrapper around `<SignInButtonBody/>`.

## 2. auth.ts embeds a parallel GitHub REST client that duplicates the canonical github/host.ts helpers
- **Severity**: Medium
- **Category**: structure
- **File**: src/lib/auth.ts:472-548 (esp. `gh()` at 509-521)
- **Scenario**: auth.ts hand-rolls a complete mini GitHub REST client to back the OAuth callback's two calls (`fetchGithubUser`, `fetchUserInstallations`): `gh()` hardcodes `https://api.github.com${path}` (line 510) and re-spells the request headers inline (`Accept`/`Authorization`/`User-Agent: "ascent-maturity-scanner"`/`X-GitHub-Api-Version: "2022-11-28"`, lines 511-516), alongside its own `GitHubError`, `TRANSIENT_STATUS`, `isTransientGithubError`, `sleep`, and `withGithubRetry`.
- **Root cause**: `src/lib/github/host.ts` already exists as the documented single source for exactly this — `githubApiBase()` (GHES-aware base URL) and `ghHeaders(token, …)` (the identical Accept/UA/version header set, +Bearer). The sibling module `src/lib/github/discover.ts`, called from the *same* `/api/auth/callback` request, was already migrated onto these helpers and even carries a `BUG` comment warning that hardcoding `api.github.com` breaks GHES — auth.ts's `gh()` is the remaining copy that ignores the override and re-implements the headers.
- **Impact**: Header set + host resolution maintained in two places (pinned API version, UA string, GHES env override drift between auth.ts and the rest of `src/lib/github/*`); a GitHub-client concern living in the session/crypto module bloats it (auth.ts is 604 lines spanning cookie crypto, the session state machine, org authorization, CSRF, redirect safety, OAuth URLs, *and* this client).
- **Fix sketch**: Route `gh()` through `githubApiBase()` + `ghHeaders(token)` from `@/lib/github/host.ts` (keeping `cache: "no-store"`). Ideally relocate the whole client slab (`gh`/`fetchGithubUser`/`fetchUserInstallations` + the retry/transient helpers) into `src/lib/github/` next to `discover.ts`, leaving auth.ts focused on session + authorization.

## 3. `GitHubError` is exported from auth.ts but used only internally, and shadows the canonical one
- **Severity**: Medium
- **Category**: dead-code
- **File**: src/lib/auth.ts:474-482
- **Scenario**: auth.ts declares `export class GitHubError extends Error` with a `(status: number, path: string)` constructor. Its only references are inside auth.ts itself (`isTransientGithubError` at line 488, thrown by `gh()` at line 519). A repo-wide grep confirms **zero** external imports of `GitHubError` from `@/lib/auth` — every other `GitHubError` in the app (badge/scan/practices/passport/playbooks routes and tests) comes from `@/lib/github/source.ts` (or its re-export in `@/lib/scan.ts`), which is a *different* class with a `(code, message, status?)` constructor.
- **Root cause**: Leftover public surface — the `export` keyword is unnecessary (the class never crosses the module boundary), and the duplicated *name* shadows the canonical `src/lib/github/source.ts:49` `GitHubError`.
- **Impact**: Confusion/foot-gun: a developer who autocompletes `import { GitHubError } from "@/lib/auth"` gets a class with an incompatible constructor and incompatible `instanceof` semantics from the one used everywhere else. Misleading public API.
- **Fix sketch**: Drop the `export` (make it module-private), or — better, alongside finding #2 — delete it entirely and have `gh()` throw the canonical `@/lib/github/source.ts` `GitHubError`, so the codebase has one GitHub error type. Adjust `isTransientGithubError` to read `err.status` from that type.

## 4. Short-lived OAuth cookie attributes hand-repeated 4× in the login route
- **Severity**: Low
- **Category**: duplication
- **File**: src/app/api/auth/login/route.ts:42-50
- **Scenario**: The same options literal `{ httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: <600|0> }` is written out four times — for `STATE_COOKIE`, `NEXT_COOKIE`, and twice for `RESYNC_COOKIE` (set vs clear), differing only in `maxAge`.
- **Root cause**: The session cookie already has a shared attribute factory (`sessionCookieAttrs(secure)` in auth.ts), but the short-lived OAuth round-trip cookies never got an equivalent, so each call site re-spells the attribute set.
- **Impact**: Minor maintenance risk — a change to the shared attributes (e.g. adding `priority`, or correcting `sameSite`) for these CSRF/next/resync cookies must be applied in four spots and kept in sync with the explicit-clear path noted in the comments; easy to update three and miss one.
- **Fix sketch**: Add a tiny helper next to `sessionCookieAttrs`, e.g. `oauthCookieAttrs(secure: boolean, maxAge = 600)` returning the shared shape, and call it with `maxAge: 0` for the clear branch. Single-sources the set/clear attributes so they can't drift.
