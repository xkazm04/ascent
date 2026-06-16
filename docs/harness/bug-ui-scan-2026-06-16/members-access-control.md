# Members & Access Control — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 1, High: 1, Medium: 2, Low: 1)
> Lens split: bug-hunter 4 / ui-perfectionist 1
> Files read: 6

## 1. Supabase-wall mode grants every signed-in viewer OWNER on every org (member admin bypass)
- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: Authorization bypass / privilege escalation / cross-tenant IDOR
- **File**: src/lib/authz.ts:132 (also :39 requireOrgAccess, :68 canReadOrg branch)
- **Scenario**: Production runs the documented "Supabase login wall" mode — Supabase auth configured, custom GitHub OAuth (`isAuthConfigured()`) deliberately left unset ("dormant"). A signed-in viewer (any self-registered Supabase user — Supabase signup is typically open) calls `GET /api/org/members?org=victim-org`, then `POST /api/org/members {org:"victim-org", login:"attacker", role:"owner"}`. `requireOrgRole("victim-org","owner")` runs `requireViewer()` (passes — they are signed in), then hits `if (!isAuthConfigured()) return null;` and returns null = ALLOWED. The attacker now lists every member, sets themselves owner, and deletes the real owners (last-owner guard only protects the *current* sole owner, not against a co-owner being added then the original removed).
- **Root cause**: `requireOrgRole` (and `requireOrgAccess`) treat "custom OAuth not configured" as "auth off ⇒ open", but in Supabase-wall mode auth is very much ON — just enforced by a different module. The role check never consults `getMembershipRole` / `sessionOwnsOrg` because it returns early. The "simple-wall semantics" comment rationalizes read access ("any signed-in viewer may read any org") but silently extends the same blanket allow to *owner-gated mutations*: member admin, credit grants, branding, live-share, invites — every `requireOrgRole`/`requireOrgAccess` caller.
- **Impact**: Complete cross-tenant takeover with only a free Supabase account: enumerate/alter/remove any org's membership, grant credits, rebrand. The single most privileged surface in the app is wide open in the intended production auth mode.
- **Fix sketch**: In Supabase-wall mode, role gates must resolve a *real* role, not short-circuit. When `authGateEnabled()`, derive membership from `getMembershipRole(slug, viewer.login)` (the Supabase viewer's GitHub login) and enforce `roleAtLeast`; only fall through to the `!isAuthConfigured()` open path when neither auth system is active. At minimum, gate owner-level mutations behind explicit membership even when custom OAuth is off.

## 2. `org` slug from the client is trusted into role resolution without canonicalization on the write paths
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: IDOR / input trust
- **File**: src/app/api/org/members/route.ts:38, src/lib/authz.ts:139-145
- **Scenario**: In custom-OAuth mode, `requireOrgRole(body.org,"owner")` lowercases the slug and matches it case-insensitively against `session.installations`. `getMembershipRole` and `ensureOwnerMembership` independently lowercase via `normalizeLogin`/`trim().toLowerCase()`. But the *audit* and `setMembershipRole` paths use `body.org` (raw) and `body.org.toLowerCase()` inconsistently (route.ts:49 lowercases for `getOrgId`, route.ts:43 passes raw `body.org` to `setMembershipRole`, which re-lowercases only the *login*, not the org slug — it passes `orgSlug` straight to `orgIdForSlug` which does an exact-case `findUnique({where:{slug}})`). If an org row was ever persisted with mixed-case slug (orgs are created in `ensureOwnerMembership` from `session` login casing, e.g. `MyOrg`), an attacker-supplied lowercase `myorg` passes the installation check (case-insensitive) but `setMembershipRole("myorg",...)` resolves a *different or null* org row, while the audit log records `getOrgId("myorg")`. Result: authz checks one org, the mutation/audit can target/miss another.
- **Root cause**: Org-slug casing is normalized in three different places with three different rules; the gate and the mutation don't share a single canonical slug. The authz layer and the data layer can disagree on which org a request refers to.
- **Impact**: Authz/mutation target divergence — at best a confusing 404, at worst an audit-trail mismatch (gate passes for the real org, write/audit hit the wrong slug) undermining the "every privilege change is audited" guarantee.
- **Fix sketch**: Canonicalize the slug once at the route boundary (`const org = body.org.trim().toLowerCase()`), pass that single value to the gate, `setMembershipRole`, `getMembershipRole`, and the audit. Enforce lowercase slugs at the schema level so `findUnique({where:{slug}})` can never be case-bypassed.

## 3. `last_owner` guard is not transactional — race lets the last owner be demoted/removed
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: TOCTOU / membership race
- **File**: src/lib/db/members.ts:110-124 (setMembershipRole), :145-150 (removeMembership)
- **Scenario**: Two concurrent owner-gated requests against a two-owner org: request A demotes owner X to viewer, request B removes owner Y. Each reads `count({role:"owner"}) === 2 > 1` independently (check passes for both), then each performs its upsert/delete. Net result: zero owners — the org is orphaned with no one able to manage members, exactly the state both guards exist to prevent. The count check and the mutating write are separate awaited statements with no transaction or row lock.
- **Root cause**: The `owners <= 1` invariant is verified with a non-atomic read-then-write; nothing serializes concurrent membership changes on the same org.
- **Impact**: An org can be left with no owner (member admin permanently inaccessible), or via the inverse race a removal that should have been refused succeeds. Requires two near-simultaneous owner actions, so Medium.
- **Fix sketch**: Wrap the count-guard + mutation in a single `prisma.$transaction` with `Serializable` isolation, or enforce a partial unique/DB constraint guaranteeing ≥1 owner per org. Re-check the owner count inside the transaction after the write and roll back if it would hit zero.

## 4. `setMembershipRole` upserts a brand-new User/Membership for *any* login string — no existence/identity validation
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Data integrity / authorization input
- **File**: src/lib/db/members.ts:103-124, src/app/api/org/members/route.ts:35-43
- **Scenario**: `POST /api/org/members` accepts any `login` string and `setMembershipRole` does `prisma.user.upsert(... create:{githubLogin: gh, email:`${gh}@users.noreply.github.com`})`. There is no check that `login` corresponds to a real GitHub user, an installation member, or an invited party. An owner (or, combined with finding #1, any attacker) can mint membership rows for arbitrary/typo'd/squatted logins. A later legitimate sign-in by that GitHub login silently inherits the pre-seeded role (the `getMembershipRole` lookup keys purely on `githubLogin`), so a pre-seeded `owner` row becomes a standing backdoor that activates the moment that account first authenticates.
- **Root cause**: Membership is granted by free-text login with no verification that the principal exists or has any relationship to the org; the user row is fabricated on demand.
- **Impact**: Grant-before-existence backdoor and pollution of the User table with phantom accounts; pre-seeding an `owner` role for a not-yet-registered login is a persistence mechanism.
- **Fix sketch**: Require the target login to already exist as a User (or as a pending invite) before assigning a role, or constrain role-granting to logins present in the org's installation member list. Don't fabricate User rows from unverified input on the privilege-change path.

## 5. OrgSwitcher: menu items lack proper listbox/disabled semantics and no busy feedback in the list
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: Accessibility / loading-state consistency
- **File**: src/components/OrgSwitcher.tsx:85-107 (menu), :64-71 (trigger)
- **Scenario**: While a switch is in flight (`busy === true`) the trigger button is disabled, but the menu has already closed (`choose` calls `setOpen(false)` first), so the user gets no in-context "switching…" feedback — on a slow network the header just sits with the old org until `router.refresh()`/`push` resolves. Separately, the dropdown uses `role="menu"` + `role="menuitemradio"` but the trigger advertises `aria-haspopup="menu"` while semantically this is a single-select of the active org — a `listbox`/`option` + `aria-activedescendant` pattern is the correct combobox semantic. There is also no roving-tabindex/arrow-key navigation between items (only Escape and outside-click are handled), so keyboard users must Tab through each item, and the active item isn't programmatically focused on open.
- **Root cause**: The component implements a custom popup with menu roles but omits the keyboard interaction model those roles imply (arrow navigation, focus management) and gives no per-item busy/disabled state during the async POST.
- **Impact**: Screen-reader and keyboard users get an incompletely-implemented widget; all users lack feedback during the network round-trip. Low severity (functional via mouse, single finding expected).
- **Fix sketch**: On open, focus the active item and add ArrowUp/ArrowDown roving navigation; reflect `busy` with a spinner/`aria-busy` on the trigger and keep the menu open (or show an inline pending state) until navigation completes; consider `aria-disabled` on items while busy to prevent double-submits.
