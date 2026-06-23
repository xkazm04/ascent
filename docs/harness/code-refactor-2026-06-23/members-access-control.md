# Code Refactor — Members & Access Control
> Context group: Org Scanning & Fleet Rollups
> Total: 4 findings (Critical: 0, High: 1, Medium: 1, Low: 2)

This context is, on the whole, clean and well-documented: the gates carry detailed
rationale comments, the data layer returns typed outcomes, and the tests pin the
security invariants thoroughly. No dead code was found (every export is reachable —
`sessionHasInstallation`, `getMembershipRole`, `PendingInvite`, etc. all have live
callers), and the one literal that *looks* duplicated (`PUBLIC_ORG` in `OrgSwitcher`)
is deliberately and explicitly inlined with a comment explaining the server/client
bundle boundary, so it is intentionally NOT flagged. The findings below are about
consolidating a small amount of repeated slug→id plumbing.

## 1. Duplicated `orgIdForSlug` helper re-implements the exported `getOrgId`, with drifting slug normalization
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/db/members.ts:37-40, src/lib/db/invites.ts:25-28 (drift site: src/lib/db/members.ts:49)
- **Scenario**: Both in-scope data modules define their own private `orgIdForSlug(slug)` that does the exact same thing — `getPrisma().organization.findUnique({ where: { slug }, select: { id: true } })` → `org?.id ?? null` — which is also exactly what the already-exported `getOrgId` (`src/lib/db/org-rollup.ts:27`, re-exported via `@/lib/db`) does. The two private copies have *drifted*: `invites.ts:26` lowercases the slug (`slug: slug.toLowerCase()`), `members.ts:38` does not, and `getOrgId` does not either. Worse, inside `members.ts` the callers are themselves inconsistent — `orgHasOwner` calls `orgIdForSlug(normalizeLogin(orgSlug))` (members.ts:49), pushing the slug through the *login* normalizer, while every other call in the file (`getMembershipRole` :63, `setMembershipRole` :114, `removeMembership` :158, `listOrgMembers` :187) passes the slug verbatim. So one module's id resolution is case-folded, the other's is not, and one function in `members.ts` case-folds where its siblings don't.
- **Root cause**: `getOrgId` already existed in the rollup module, but when `members.ts` and later `invites.ts` were written each grew its own local copy rather than importing the shared one (the routes that call into these modules *do* import `getOrgId` from `@/lib/db` for the audit path, so the canonical helper was right there). The `normalizeLogin(orgSlug)` call is a copy-paste slip — the function meant to canonicalize the slug but reached for the login normalizer because that helper was the nearest one in scope.
- **Impact**: Three near-identical implementations of the single most security-relevant lookup in the context (slug → tenant id), each free to normalize differently. The route layer already lowercases slugs before calling in (`members/route.ts:30,45,73`), so today the divergence is masked — but it is a latent cross-tenant/lookup-miss hazard the moment a caller forgets to pre-lowercase (an org created with a mixed-case slug would resolve from `invites.ts` but not from `members.ts`). It is also pure maintenance drag: a future change to how orgs are resolved must be made in three places.
- **Fix sketch**: Delete the private `orgIdForSlug` in both `members.ts` and `invites.ts` and import the shared `getOrgId` from `@/lib/db/org-rollup` (or via `@/lib/db`). Decide the canonical normalization once — since routes already lowercase, either keep resolution verbatim everywhere or fold lowercasing into `getOrgId` itself — and route all five `members.ts` call sites + three `invites.ts` call sites through it. In particular replace `orgIdForSlug(normalizeLogin(orgSlug))` at members.ts:49 with the same verbatim-slug call its siblings use (or the chosen canonical form). Behavior-preserving given current callers; removes the drift.

## 2. Repeated "resolve orgId, then audit on success" boilerplate across the owner-gated mutations
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/org/members/route.ts:59-65, src/app/api/org/members/route.ts:83-85 (siblings: src/app/api/org/invites/route.ts:47-60, src/app/api/org/invites/accept/route.ts:42-51)
- **Scenario**: Every owner-gated mutation in this context ends with the identical tail: fetch the session, resolve the org id with the same defensive idiom `const orgId = (await getOrgId(org).catch(() => null)) ?? undefined;`, then call `recordAudit(action, payload, { orgId, actorId: session?.login })`. This exact 3-line shape appears twice within `members/route.ts` (POST and DELETE) and again in the two invite routes — four copies of the same orgId-resolution-for-audit dance, each independently spelling out the `.catch(() => null) ?? undefined` coercion.
- **Root cause**: Each route handler was written to be self-contained, and the audit call is the natural last step of each; the orgId-for-audit lookup got copy-pasted alongside it rather than extracted, because there was no shared "audit this org action" helper to reach for.
- **Impact**: Low-risk but real duplication on the audit trail — the part of the system that most needs to behave uniformly. If the audit envelope changes (e.g. always include the actor's resolved user id, or change the orgId fallback), it must be edited in four spots, and an inconsistency between them would produce silently divergent audit rows.
- **Fix sketch**: Add a small helper near `recordAudit` (e.g. `recordOrgAudit(action, slug, payload, actorLogin)`) that does the `getOrgId(slug).catch(() => null) ?? undefined` resolution and forwards to `recordAudit`. Replace the four call sites (the two in-scope ones in `members/route.ts:59-65` and `:83-85`, plus the invite-route siblings) with single calls. Pure consolidation, no behavior change.

## 3. `normalizeLogin` applied to an org slug in `orgHasOwner`
- **Severity**: Low
- **Category**: cleanup
- **File**: src/lib/db/members.ts:49
- **Scenario**: `orgHasOwner` resolves its org with `orgIdForSlug(normalizeLogin(orgSlug))`, i.e. it runs the org *slug* through the helper named and documented for *logins* (`normalizeLogin` at members.ts:33). Every other slug resolution in the file passes the slug straight in. The misuse is harmless today (trim+lowercase on a slug is benign and routes pre-lowercase anyway) but reads as if a login were expected here.
- **Root cause**: `normalizeLogin` was the closest canonicalization helper in scope when `orgHasOwner` was added, so it was reused for the slug instead of treating the slug consistently with the file's other functions.
- **Impact**: Misleading to a reader (suggests slugs and logins are normalized through the same path when the file's convention is they are not) and a maintenance trap if `normalizeLogin` ever gains login-specific behavior. No runtime effect.
- **Fix sketch**: Fold into finding #1's resolution — once `getOrgId` is the single resolver, drop the `normalizeLogin(orgSlug)` wrapping so `orgHasOwner` resolves the slug the same way its siblings do. If kept standalone, simply pass `orgSlug` verbatim (matching the rest of the file).

## 4. `AcceptResult` type defined twice — canonical in `invites.ts`, re-declared in the client form
- **Severity**: Low
- **Category**: duplication
- **File**: src/lib/db/invites.ts:116-118 (canonical), src/app/invite/[token]/AcceptInviteForm.tsx:10 (shadow copy)
- **Scenario**: `invites.ts` defines and exports `AcceptResult` (the typed accept outcome) and it is re-exported via `@/lib/db/index.ts:93`. The client component `AcceptInviteForm.tsx` declares its own local `type AcceptResult = …` to type the POST response instead of importing the canonical one. Two definitions of the same wire contract that must stay in lockstep with the `/api/org/invites/accept` response shape.
- **Root cause**: The accept page/form was built against the route's JSON shape and hand-redeclared the result type locally rather than importing the server-side type — likely to keep the client module free of a server import, though the type itself is server-import-free (it lives in the db layer and is a plain union).
- **Impact**: If the accept result union changes (a new `reason`, a renamed field), the client copy won't be caught by the compiler and the two can silently diverge, mis-typing the UI's branch handling. Low blast radius (one form) but exactly the kind of contract that should have one source of truth.
- **Fix sketch**: Import `AcceptResult` from `@/lib/db` (or `@/lib/db/invites`) in `AcceptInviteForm.tsx` and delete the local `type AcceptResult = …`. Verify the local copy is structurally identical first (it is a pure type, safe to import into a client component). Note: `AcceptInviteForm.tsx` is just outside the listed 11-file scope — the *canonical* definition is the in-scope file; flag and fix together.
