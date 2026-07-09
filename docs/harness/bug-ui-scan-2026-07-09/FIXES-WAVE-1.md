# Fix Wave 1 — Dormant-auth: authorization bypass (the Criticals)

> 7 commits · **5 Critical findings closed** · 0 regressions.
> Baseline preserved and improved: tsc **0 → 0** errors · vitest **3046 → 3057** passing (198 files).
> Branch `vibeman/bug-ui-scan-2026-07-09`. Uncommitted WIP in the working tree was never staged.

---

## The root cause, in one paragraph

`ascent` runs two auth stacks. `authGateEnabled()` / `getViewer()` is the **ACTIVE** Supabase wall.
`isAuthConfigured()` / `getSession()` is a **DORMANT** legacy custom-OAuth system. `isAuthConfigured()`
returns true only when `GITHUB_OAUTH_CLIENT_ID` **and** `GITHUB_OAUTH_CLIENT_SECRET` **and** `AUTH_SECRET`
are all set. **`.env.production` and `.env.vercel` set none of the first two.** So in production
`isAuthConfigured()` is permanently `false`, and every guard written as:

```ts
!isAuthConfigured() || (await sessionOwnsOrg(owner))   // → !false → true, for everyone
isAuthConfigured() && !session                          // → false && … → never fires
```

silently evaluated to "allow". `src/lib/authz.ts`'s own guards were always correct — the defect lived
entirely at the **call sites**, which is why this was fixable in one wave.

---

## Commits

| # | Commit | Finding | Sev | Files |
|---|---|---|---|---|
| 1 | `74f0fe5` | *(new primitive)* `canMintInstallationToken` | — | `lib/authz.ts`, `lib/authz.test.ts` |
| 2 | `c83a4ed` | **NEW Critical** — `resolveScanAuth` | C | `lib/scan.ts`, `lib/scan.test.ts`, `api/scan/route.ts`, `api/scan/stream/route.ts` |
| 3 | `91daa10` | **C1** — practices/generate | C | `api/practices/generate/route.ts` |
| 4 | `1bec4d6` | **C3** — app/setup | C | `api/app/setup/route.ts` |
| 5 | `857a574` | **C2** — public gate + operator PAT | C | `api/gate/[owner]/[repo]/route.ts` |
| 6 | `fd4954f` | **NEW Critical** — org/import confused deputy | C | `api/org/import/route.ts`, `+ .test.ts` |
| 7 | `fa3aa9a` | *(regression pin)* no-ambient-PAT on every gate ingest | — | `api/gate/[owner]/[repo]/route.test.ts` |

---

## What was fixed

### 1. The shared gate (`74f0fe5`)

`canMintInstallationToken(owner)` — the single authorization primitive for "may this caller cause the
server to mint `owner`'s GitHub App installation token?" (that token reads the org's **private** repos).
Requires real membership under the active wall; honors the dormant session only where it is actually
configured; open when auth is genuinely off; **never** allows `PUBLIC_ORG` (a funnel bucket, not an
identity). Five call sites now share it, so a sixth cannot reintroduce the short-circuit.

### 2. `resolveScanAuth` — the worst one, and it wasn't in the original INDEX (`c83a4ed`)

`/api/scan` mints a token at line 44 and only *then* checks `authGateEnabled() && !getViewer()` at line
52 — which requires **any signed-in viewer, not membership in the target org**. Combined with the dead
predicate, **any authenticated account** could `POST {repo: "victim-org/private-repo"}` and receive a
full maturity report on a private repo. A caller-supplied `installationId` was honored unconditionally,
which is the cross-tenant IDOR the function's own comment claimed to prevent. Same shape in
`/api/scan/stream`.

Ironically, C1's comment cited `resolveScanAuth` as *the correct template to mirror*.

### 3. Refusing the ambient PAT is half the fix

`scanRepository` resolves `opts.token ?? (opts.noAmbientToken ? undefined : process.env.GITHUB_TOKEN)`
(`scan.ts:163`). So denying the mint but leaving the fallback intact would have been **cosmetic** — the
operator PAT "commonly carries private `repo` scope" (per `org/import`'s own comment) and would have
served the very repo the gate just denied. `resolveScanAuth` now returns `noAmbientToken` whenever it
declines to mint **for an installed org**. Owners with no installation keep the ambient token, so the
anonymous public-scan funnel and its GitHub rate limits are untouched.

### 4. `org/import` documented the attack it failed to prevent (`fd4954f`)

`requireOrgAccess` leaves `PUBLIC_ORG` open to any signed-in viewer. With both dead guards, a signed-in
caller could `POST {org: "public", repos: ["victim/secret"], installationId: <victim id>}` and either
mint the victim's token or simply ride the operator PAT — exfiltrating a private repo's report into the
open org. The comment at `:120` describes this confused deputy precisely.

---

## Verification

| Gate | Before wave | After wave |
|---|---|---|
| `tsc --noEmit` | 0 errors | **0 errors** |
| `vitest run` | 3046 passed / 198 files | **3057 passed / 198 files** |
| Failures | 0 | **0** |
| Regressions introduced | — | 2, both **caught and fixed-forward** (see below) |

Two gate-route tests failed mid-wave because they pinned the *pre-fix* `scanRepository` options shape.
They were asserting the vulnerable call. Updated, plus a new explicit invariant test.

---

## ⚠ Behavior changes (deliberate)

1. **Private repos can no longer be gated via `GET /api/gate/:owner/:repo`.** Serving them required
   lending the operator's credentials to anonymous callers. Private-repo gating belongs to the
   authenticated GitHub App check-run path (`/api/app/webhook`), which is unaffected. The endpoint now
   returns a `404` that says so, instead of an unactionable `500`.
2. **A non-member scanning an installed org's repo no longer gets a report.** Previously it silently
   succeeded via the operator PAT. Token-less ingestion of a private repo 404s.
3. **`org/import` scans now run token-less unless an installation token was minted.** This restores the
   behavior the route's own comment always described. Local/demo seeding (`scripts/seed-org.mjs`) is
   preserved via a correctly-keyed auth-off check.
4. **A caller-supplied `installationId` is now only ever a hint** and must match the target owner's
   stored installation.

---

## Patterns established (catalogue items 1–4)

1. **Dead-predicate authz** — a guard keyed on an env-gated predicate that is false in production
   silently inverts to "allow". Grep for `!isConfigured() ||` and `isConfigured() &&` around any
   authorization decision. The predicate's *name* describes a capability, not an authorization state.
2. **Authorize-before-mint, and refuse the fallback** — denying a privileged credential is only half a
   fix if the code falls back to an *ambient* one. Always ask: what does this use when I say no?
3. **Tests that pin the dev configuration** — `scan.test.ts` and `import/route.test.ts` both mocked
   `isAuthConfigured` as `true`, a shape production never runs. 3046 green tests coexisted with a live
   cross-tenant read. **When a guard branches on deployment config, the test must pin the production
   branch by name.**
4. **The comment describes the exploit** — three of these five sites carried a comment accurately
   describing the attack the code failed to prevent. A precise security comment above an ineffective
   guard is a strong signal the guard's predicate drifted out from under it.

---

## What remains

Wave 2 (null-actor audit attribution, 7 findings) and Wave 3 (feature lockouts from
`readableOrgForOwner`, 6 findings) — the other two thirds of the dormant-auth cluster. Both are
attribution/lockout bugs, not security holes. See `INDEX.md` themes T2 and T3.

`resolveViewerLogin()` (`access.ts:89-94`) is verified safe and is the canonical fix for Wave 2 — but it
must never be awaited inside a `ReadableStream start()`, where its cookie-scoped reads return null.
