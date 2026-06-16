# Bug-UI Fix Wave 1 — Tenant Isolation & Auth

> 4 atomic commits, 6 findings closed (1 critical, 3 high, 2 medium).
> Baseline preserved: `tsc` 0 → 0 errors · tests 465/465 → 470/470 (+5 new auth regression tests).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|--------|-----------------|----------|-------|
| 1 | `7e8059d` fix(authz): close cross-tenant owner takeover under the Supabase login wall | members #1, #3 | Critical + Medium | `authz.ts`, `db/members.ts`, `authz.test.ts` |
| 2 | `74db099` fix(api/members): canonicalize org slug once + validate login shape | members #2, #4 | High + Medium | `api/org/members/route.ts` |
| 3 | `2d94b78` fix(access): hard-disable ASCENT_AUTH_BYPASS in production | oauth #1 | High | `access.ts`, `proxy.ts` |
| 4 | `1e2820e` fix(api/recommendations): make public-funnel recommendations read-only | roadmap #1 | High | `api/recommendations/[id]/route.ts` |

## What was fixed

1. **Cross-tenant owner takeover (CRITICAL).** In the documented production config — Supabase login wall ON, custom GitHub OAuth dormant — `requireOrgRole` ran `if (!isAuthConfigured()) return null` right after the signed-in check, so *any* free Supabase account was treated as OWNER of *every* org: it could enumerate/alter/remove members, grant credits, and rebrand any tenant. The fix makes the gate resolve the viewer's **real** membership role when the wall is enforced (`authGateEnabled()`), with a trust-on-first-use bootstrap: the first viewer to manage an as-yet-unowned org is seeded as its owner, and thereafter only members with a sufficient role pass. The custom-OAuth path is reordered but behaviorally unchanged. 5 regression tests pin the new behavior.

2. **Last-owner TOCTOU (Medium).** `setMembershipRole` and `removeMembership` checked `owners > 1` and then wrote in two separate statements, so two concurrent owner changes could each pass the guard and orphan the org with zero owners. Both now run the guard + write/delete inside a single `prisma.$transaction` (serializable on Aurora DSQL).

3. **Org-slug canonicalization / audit divergence (High).** The gate, the mutation, and the audit each normalized the org slug differently, so a mixed-case org row could let authz pass for one org while the write + audit hit another. The slug is now lowercased once at the route boundary and that single value flows everywhere.

4. **Phantom membership rows (Medium).** Member-admin granted a role to any free-text `login`, fabricating a `User` row — a pre-seeded `owner` for a not-yet-registered login was a standing backdoor. The route now validates the GitHub-login shape (`^[A-Za-z0-9-]{1,39}$`) before granting, and (combined with #1) only real owners can reach this path.

5. **Dev auth-bypass without a prod guard (High).** `ASCENT_AUTH_BYPASS` was honored anywhere, so one stray env var dropped the whole login wall in production and served a synthetic privileged viewer. Now hard-disabled when `NODE_ENV === "production"` (mirrored in `proxy.ts`).

6. **Public-funnel recommendation poisoning (High).** `requireOrgAccess` is intentionally open for the shared `public` org, so anyone could mutate every public scan's recommendation status/assignee/due-date and write to its shared audit trail by lifting a rec id. PATCH now returns 403 for the public org — public-funnel recommendations are a read-only demo surface.

## Verification

| | Before wave | After wave |
|---|---|---|
| `tsc --noEmit` errors | 0 | 0 |
| Tests | 465/465 | 470/470 |
| New regression tests | — | +5 (Supabase-wall RBAC) |

## Patterns established (catalogue items 1–5)

1. **Auth-config-branch-fails-open** — `if (!primaryAuthConfigured()) return null` silently blanket-allows when a *different* auth system is the active gate. When two auth layers coexist, every gate must branch on which one is *enforced* and resolve a real principal for it; never treat "system A is off" as "open" while system B is the live wall.
2. **Canonicalize-the-key-once** — when a gate, a mutation, and an audit each independently normalize the same identifier (slug/login/id), they can disagree and authorize one target while acting on another. Canonicalize once at the trust boundary and thread the single value through.
3. **Invariant guard must be transactional** — a "≥1 owner / ≤N of X" rule enforced as `count()` then `write()` is a TOCTOU; two concurrent actors each pass and violate it. Put the check and the write in one transaction.
4. **Escape hatches need a prod fence** — any "open everything" dev flag (`*_BYPASS`, `*_SKIP_AUTH`) must be hard-disabled in production (`NODE_ENV`/deploy signal), not merely defaulted off — one stray env var shouldn't disable the wall.
5. **Shared-public tenant: gate writes separately from reads** — a `public`/shared org that's deliberately open for reads + the free funnel is *not* automatically safe to leave open for mutations of shared records. Reject writes to shared-tenant rows explicitly.

## What remains (open follow-ups for theme A)

- **Any-member cross-tenant *writes* under the Supabase wall.** `requireOrgAccess` (non-owner mutations: trigger scans, edit a private org's recommendations) still follows "any signed-in viewer may act" simple-wall semantics. Closing this needs a real membership/invite model for non-owners (none exists today), so it was left out of this wave deliberately. Tracked for a future auth pass.
- **TOFU first-touch window.** In a brand-new Supabase-wall deployment where no org has an owner yet, the *first* caller to manage an org claims it — including an attacker who reaches it before the real owner. A proper owner-seeding step at org import/connect would close this.

Remaining waves per INDEX: W2 Revenue integrity · W3 Data integrity & concurrency · W4 Destructive ops · W5–W11 correctness + UX/a11y.
