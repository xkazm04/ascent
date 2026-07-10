# Fix Waves 2 & 3 — Dormant-auth: attribution + lockouts

> 4 commits · **22 routes/files corrected** · 0 regressions.
> tsc **0 → 0** · vitest **3057 → 3057 passing** (198 files).
> Branch `vibeman/bug-ui-scan-2026-07-09`. Uncommitted WIP never staged.

Same root cause as [Wave 1](FIXES-WAVE-1.md): `isAuthConfigured()` is permanently `false` in production
(`.env.production` sets no `GITHUB_OAUTH_CLIENT_ID`/`_SECRET`), so guards written against it silently
invert. Wave 1 closed the security holes. Waves 2 and 3 close the **attribution** and **lockout** damage.

---

## Wave 2 — null-actor audit attribution

| Commit | Scope |
|---|---|
| `b656d3f` | `org/members`, `org/invites` — privilege changes |
| `c655a90` | the remaining 17 routes |

**Scoped at 7 findings in the INDEX; it is really 19 routes.** Each scan agent saw only its own context,
so nobody counted the cluster. Every one derived its audit actor from the dormant `getSession()`.

In production the audit log, the change timelines, and the `createdBy` / `appliedBy` / `invitedBy`
columns all recorded **"nobody"** for: alerts, gate-policy, plan, `credits.grant`, llm-provider, skills
(×3), ops, issue, every playbook write + apply (×4), recommendation edits (the backlog **and** roadmap
timelines share this route), practices `apply` + `apply-batch` (which open PRs in customer repos), and
both passport writes.

`members/route.ts`'s own header calls this *"the action that most needs a trail."* It recorded `null`.

Two consequences beyond the trail itself:

- **`org/issue` stamped no attribution into the GitHub issue body.** The `_Filed via Ascent by @user_`
  line is conditional on the login, which was always null — so every issue Ascent filed on a customer's
  behalf was anonymous.
- **The `isAuthConfigured() && !session` sign-in checks were dead code.** They are re-keyed to fire
  whenever **either** stack is live.

### A regression I introduced, and how it was caught

Re-keying those sign-in checks onto `authGateEnabled()` **alone** silently dropped the 401 on dev boxes
where only the legacy stack is configured. Four route tests (`practices/apply`, `apply-batch`,
`org/issue`, `passport/pr`) failed exactly as they should have. The predicate is now
`(authGateEnabled() || isAuthConfigured())` — the same shape `invites/accept/route.ts` already used.

The lesson generalizes: **"this guard is dead in production" does not mean "this guard is dead."**

---

## Wave 3 — feature lockouts

| Commit | Scope |
|---|---|
| `355628d` | `readableOrgForOwner` — 9 call sites, 5+ user-visible features |
| `9c5a637` | the invite accept page |

### `readableOrgForOwner` (`auth.ts:336`) — the highest-leverage fix in the scan

It resolved authorization straight off the custom-OAuth session cookie, so under the Supabase wall it
**always returned `"public"`** — for members and strangers alike. A **lockout, not a leak**: the
private-repo guard in `scans-read.ts` then correctly refused to serve anything.

Every private-org member was locked out of their own data:

- `/trends` and `/report/compare` rendered *"No scans recorded yet."*
- `/api/history` returned public-only history
- the **Private-tier PDF export 404'd** — a paid feature, permanently broken
- the repo report permalink wouldn't show an owner their own private repo
- `/api/report/skill` + `/api/report/conformance` resolved to the public org
- passport read, and **passport PR** — which 403s on `org === PUBLIC_ORG`, so opening a passport PR was
  impossible for every org-owned repo

It now delegates to `canReadOrg`, the single read-side gate. `@/lib/authz` is imported **lazily**: it
imports `auth.ts`, so a static import would close the cycle at module-init time. (`access.ts` already
uses this pattern for `getSession`.)

`recommendations/route.ts` had already worked around this locally by calling `canReadOrg` directly — a
symptom treated once, at one call site, while the helper stayed broken for the other eight.

### The invite accept page (`invite/[token]/page.tsx:63`)

`isAuthConfigured() ? await getSession() : null` ⇒ always null ⇒ the sign-in branch never fired ⇒ every
invited teammate fell through to *"Authentication required."* **The entire invite feature was unreachable
in production.** The sibling accept *route* had already been migrated; the page was left behind.

---

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 errors | **0 errors** |
| `vitest run` | 3057 passed | **3057 passed** |
| Failures | 0 | **0** |
| Regressions | — | 4, all **caught by existing tests** and fixed forward |

---

## ⚠ Deferred, with a recipe: the org switcher

**Not fixed.** `getActiveOrg` / `orgOptionsForSession` (`auth.ts:348`) derive the switcher's org list from
**session installations**. Under the Supabase wall the session is null, so the list collapses to
`["public"]` and `POST /api/org/active` rejects every real org with *"Unknown org."*

This is not a predicate swap — it needs a different **data path**: org membership, not installations.

**The recipe (the query already exists):**

1. `listOrgsForLogin(login)` is already implemented at `src/lib/db/members.ts:205` and returns `ViewerOrg[]`.
2. Add `orgOptionsForViewer(): Promise<string[]>` — `resolveViewerLogin()` → `listOrgsForLogin()` → slugs,
   with `PUBLIC_ORG` appended last (preserving `orgOptionsForSession`'s ordering + case-insensitive dedup).
   Keep the dormant-session path for dev boxes, exactly like `invites/accept/route.ts`.
3. Swap the three consumers: `components/Brand.tsx:47-48`, `app/org/page.tsx:14`, `app/usage/page.tsx:33`,
   and the validator at `api/org/active/route.ts:42`.
4. `getActiveOrg(session)` must likewise validate the `ACTIVE_ORG` cookie against the **viewer's** orgs.
   `auth.test.ts:697` (*"tampered ACTIVE_ORG cookie can't widen access"*) pins that invariant — keep it green.

**Why it was deferred:** it needs a new helper *and* it touches `src/components/Brand.tsx`, which carries
uncommitted WIP in this working tree. Combining a new data path with surgical staging into a file the
author is actively editing is how you lose someone's work. Left for a session with a clean tree.

---

## Patterns established (catalogue items 5–8)

5. **A guard dead in production may be live in dev.** Re-keying `isAuthConfigured() && !session` onto the
   active wall alone dropped a real 401 on legacy-configured dev boxes. Gate on `(active || dormant)`
   when the intent is "some auth stack is live"; gate on `active` only when the intent is "the production
   wall is enforced."
6. **A local workaround is evidence of a broken shared helper.** `recommendations/route.ts` called
   `canReadOrg` directly, with a comment explaining that `readableOrgForOwner` was dormant-keyed. The
   symptom was treated at one call site; eight others stayed broken. **Grep for the workaround's comment,
   not just its code** — it names the root cause.
7. **Lockout bugs are invisible to a security audit and to your users.** `readableOrgForOwner` returning
   `"public"` fails *closed*, so nothing alarms: no error, no 500, no alert. The paid PDF export simply
   404s and Trends says "no scans yet." Fail-closed defects hide in the same silence that makes them safe.
8. **Cross-context clusters are structurally invisible to per-context scanning.** Wave 2 was scoped at 7
   findings and is really 19 routes; Wave 1's two worst Criticals were in a *library*, never scanned as a
   route. When a finding's root cause is a shared predicate, **grep the predicate across the whole tree
   before sizing the wave.**
