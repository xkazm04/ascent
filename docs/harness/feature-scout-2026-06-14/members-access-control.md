# Feature Scout — Members & Access Control (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 3H / 2M / 0L

The RBAC machinery here is unusually complete on the *backend*: a four-tier role
hierarchy (`owner > admin > member > viewer`), a persistence layer (`members.ts`:
`getMembershipRole`/`setMembershipRole`/`listOrgMembers`/`ensureOwnerMembership`), role
gates wired into 4 endpoints (`requireOrgRole`), and an owner-gated REST API
(`/api/org/members` GET+POST). What's missing is almost entirely the *exposure and
lifecycle* layer: there is no UI to reach any of it, no way to invite or remove a
person, and the most security-sensitive mutation in the product (changing who can do
what) is the one org action that writes no audit entry. For a B2B "fleet" product,
team collaboration is table stakes — these gaps block real multi-seat use today.

## 1. Member management has no UI surface — RBAC is reachable only by raw API calls
- **Severity**: Critical
- **Category**: functionality
- **File**: src/components/org/OrgNav.tsx:17 (no "Members" tab); src/app/api/org/members/route.ts:18
- **Scenario**: An org owner signs in, opens their org dashboard, and wants to add a teammate as `viewer` so a stakeholder can see maturity scores without write access. They look for a "Members" or "People" or "Settings → Access" screen.
- **Gap**: Confirmed: `src/app/org/[slug]/` has 16 page routes (adoption, audit, backlog, contributors, delivery, executive, governance, live, plan, practices, repositories, security, segments, teams) — **none for members**. `OrgNav.tsx` lists 14 tabs across 5 groups; no members link. No `*member*` component exists (`find -iname "*member*"` returns only the db lib + its test + the API route). `CHANGELOG.md:17` and `context-map.json` both describe `/api/org/members` as an *endpoint* only. The fully-built `listOrgMembers`/`setMembershipRole` are dead from a user's perspective — callable only with a hand-crafted `fetch`/curl.
- **Impact**: Every org owner. Without this, granting `viewer`/`admin`/`member` is impossible through the product, so RBAC delivers zero user value despite being built and tested. This is the single highest-leverage gap: it converts an existing, working backend into a shipped feature.
- **Fix sketch**: Add `src/app/org/[slug]/members/page.tsx` (server component, gate via existing `requireOrgRole(slug,"owner")`, hydrate from `listOrgMembers`) + a `MembersPanel.tsx` client component (table of login/name/role/joined, an inline role `<select>` POSTing to `/api/org/members`, optimistic update). Add `{ href: \`${base}/members\`, label: "Members" }` to a new "Govern" or "Settings" group in `OrgNav.tsx`. ~0.5 day; reuses `SectionHeader`/`ui.tsx` patterns already in `components/org`.

## 2. No invite flow — owners can only assign roles to logins they already know exist
- **Severity**: High
- **Category**: feature
- **File**: src/lib/db/members.ts:91 (setMembershipRole); prisma/schema.prisma:94 (Membership, no Invite model)
- **Scenario**: An owner wants to bring a coworker who hasn't used ascent yet onto the org. The natural flow is "Invite by email / GitHub handle → they get a link → they accept and land in the org."
- **Gap**: Confirmed no invitation concept: grep for `invite|Invite|invitation|pendingMember` across the repo hits only `prisma/schema.prisma` (unrelated columns), scoring/recommendations text, and docs — no Membership invite. `setMembershipRole` (members.ts:91) *upserts a User row immediately* from a bare `login`, with `email` synthesized as `${gh}@users.noreply.github.com`. So the only "add member" path is: owner already knows the exact GitHub login AND types it correctly into a JSON POST. There is no pending/accept state, no email, no notification, no dedup against typos. A mistyped login silently creates a ghost membership.
- **Impact**: Owners + the people they want to onboard. Invite is the canonical B2B collaboration entry point; without it, growing a team is a manual, error-prone, login-guessing exercise — and the synthesized-email upsert means bad data accumulates. Competitors (Vercel, Linear, GitHub orgs) all lead with invite.
- **Fix sketch**: Add an `Invite` model (`id, orgId, email|githubLogin, role, token, status, expiresAt`) + migration; `createInvite`/`acceptInvite`/`listPendingInvites` in a new `src/lib/db/invites.ts`; `/api/org/invites` (POST create, GET list, DELETE revoke) gated by `requireOrgRole(org,"owner")`; an `/invite/[token]` accept page that resolves the signed-in GitHub login against the invite and calls `setMembershipRole`. Surface pending invites in the Members panel from #1. ~1.5–2 days.

## 3. Privilege changes write no audit entry — the one mutation that most needs a trail
- **Severity**: High
- **Category**: functionality
- **File**: src/app/api/org/members/route.ts:38 (POST, no recordAudit); src/lib/db/scans-audit.ts:14
- **Scenario**: A security reviewer or owner asks "who promoted this person to `admin`, and when?" — exactly the question the existing Audit tab ("who did what") promises to answer.
- **Gap**: Confirmed: the `recordAudit(action, meta, {orgId, actorId})` helper exists and is called from scans, retention, practices, and `/api/org/alerts` (which records `org.alerts.webhook` with the actor on every webhook change — the precedent). The members POST handler does **not** call `recordAudit` (grep of `recordAudit` across `src/` shows no hit in `members/route.ts` or `members.ts`). So changing someone's role — the most security-sensitive org action — leaves no trace, while *setting a Slack webhook* does. The audit viewer page even advertises "Scans, recommendation updates, and other recorded actions," conspicuously omitting access changes. The `AuditLog` model and keyset-paginated viewer are fully built; this is purely an unconnected wire.
- **Impact**: Org owners, security/compliance buyers. An access-control audit trail is a SOC2/enterprise procurement checkbox. Wiring it is near-zero cost and turns "we have RBAC" into "we have *auditable* RBAC."
- **Fix sketch**: In `members/route.ts` POST, after a successful `setMembershipRole`, call `recordAudit("org.member.role", { org, login, newRole: body.role, prevRole, actor: session.login }, { orgId })` — mirror the `org.alerts.webhook` block verbatim (members/route.ts already has the session via the gate; fetch `orgId` via `getOrgId`). Read `prevRole` from `getMembershipRole` before the upsert. ~1 hour.

## 4. No way to remove a member — access is grant-only, never revoked
- **Severity**: High
- **Category**: functionality
- **File**: src/app/api/org/members/route.ts:18 (only GET+POST); src/lib/db/members.ts (no removeMembership)
- **Scenario**: A contractor's engagement ends, or an employee leaves. The owner needs to revoke their access to the org's fleet data.
- **Gap**: Confirmed: the route exports only `GET` and `POST`; there is **no `DELETE`** and no `removeMembership`/`deleteMembership` in `members.ts`. The role enum has no "none"/"revoked" value, so even via the API the lowest you can drop someone is `viewer` — which still grants org *read* access to dashboards, scores, and audit-adjacent data. Once added (e.g. via the installation-owner auto-seed in `requireOrgRole`), a person can never be fully removed through the product.
- **Impact**: Every org with churn — i.e. every real team. Offboarding is a hard security/compliance requirement; "we can add people but never remove them" is a dealbreaker and a data-exposure liability.
- **Fix sketch**: Add `removeMembership(orgSlug, login): Promise<boolean>` to `members.ts` (delete the Membership row; guard the last-owner case — see #5). Add a `DELETE` handler to `members/route.ts` gated by `requireOrgRole(org,"owner")` + `isSameOrigin`, reading `?org=&login=`, and `recordAudit("org.member.removed", …)`. Wire a "Remove" action into the Members panel (#1). Also consider invalidating their session via the existing `bumpSessionVersion` revocation path. ~0.5 day.

## 5. The last owner can be demoted/removed, orphaning the org's admin surface
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/db/members.ts:91 (setMembershipRole, no last-owner guard)
- **Scenario**: An org with one owner; that owner (or another owner via the API) sets their role to `viewer`, or removes themselves. The org now has no one who can manage members, billing/credit grants, or destructive deletes.
- **Gap**: Confirmed: `setMembershipRole` blindly upserts `{ role }` with no check that at least one `owner` remains. There is a soft safety net — `requireOrgRole` *re-seeds* an installation-owner as `owner` (members.ts:66, authz.ts:131) — but it only covers people who hold the GitHub-App installation. A member promoted to owner who then demotes the *real* installation-owner, or any org where ownership diverged from the installation, can lock out all management. No invariant enforces "≥1 owner."
- **Impact**: Owners; support/ops who'd have to manually fix orphaned orgs in the DB. A classic RBAC footgun every mature product guards against.
- **Fix sketch**: In `setMembershipRole` (and the future `removeMembership`), when the change would demote/remove an `owner`, count remaining owners via `prisma.membership.count({ where: { orgId, role: "owner" } })` and reject (return `false`/throw a typed error → 409) if it would hit zero. Surface "You can't remove the last owner" in the Members panel. ~2 hours.

## 6. Members can't see their own role or who else has access — no self-service visibility
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/app/api/org/members/route.ts:22 (GET gated to "owner"); src/components/OrgSwitcher.tsx:17
- **Scenario**: A non-owner member opens the org and wonders "what can I do here?" or "who else is on this org?" A viewer hits a 403 on a write and doesn't understand why.
- **Gap**: Confirmed: the only members read path (`GET /api/org/members`) is gated to `owner` (route.ts:22), so members/admins/viewers can't list the roster or even confirm their own role. `getMembershipRole` exists and could answer "your role," but nothing surfaces it: `OrgSwitcher.tsx` shows org name only — no role badge — and no endpoint returns the caller's own role. Users discover their permissions only by trial-and-error 403s from `requireOrgRole`/`requireOrgAccess`.
- **Impact**: All non-owner members (the majority of seats in a healthy org). Role transparency reduces "why can't I do X" support load and makes the permission model legible — a small touch that signals a mature collaboration product.
- **Fix sketch**: Add a lightweight `GET /api/org/me?org=` (gated by `requireOrgRead`) returning `{ role }` from `getMembershipRole(slug, session.login)`; render a role badge next to the active org in `OrgSwitcher.tsx` (or the org header). Optionally relax the members *list* to `member`+ as read-only (names+roles, no management controls) so the roster is visible to the team. ~0.5 day.
