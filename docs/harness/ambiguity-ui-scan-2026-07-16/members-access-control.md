# Members & Access Control — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

## 1. Members page still resolves `selfLogin` via the dormant `getSession()` — self-demotion guard dead in production
- **Severity**: High
- **Category**: undocumented-assumption
- **File**: `src/app/org/[slug]/members/page.tsx:28`
- **Scenario**: The page passes `selfLogin={session?.login ?? null}` from `getSession()` (the dormant custom-OAuth stack). Under the ACTIVE Supabase wall no `ascent_session` cookie exists, so `getSession()` is always null in production. `MembersPanel` keys two safety affordances on `selfLogin`: the "you" badge and the self-demotion confirm gate (`onRoleSelect` at `MembersPanel.tsx:47`).
- **Root cause**: The exact call-site-rot pattern this context is known for (the invite page and both audit actors were already migrated to `resolveViewerLogin()`; this page was left behind — same class as the bug fixed at `invite/[token]/page.tsx:64-70`).
- **Impact**: In prod an owner never sees the "you" marker and can demote THEMSELVES with a single unconfirmed `<select>` change — permanent lockout from the owner-only surface (only another owner can restore them), the precise scenario the confirm flow was built to prevent. Every deploy silently downgrades a deliberate UX safety feature.
- **Fix sketch**: `const selfLogin = await resolveViewerLogin();` (from `@/lib/access`), falling back to `getSession()` only when the gate is off — mirroring the routes. Add a test asserting `selfLogin` is populated when `authGateEnabled()`.

## 2. Accepting an invite silently DOWNGRADES an existing higher-role member (and the sole owner gets a misleading "db" error)
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/lib/db/invites.ts:172`
- **Scenario**: `acceptInvite` unconditionally calls `setMembershipRole(org, viewer, invite.role)`, which UPSERTS `update: { role }`. An unpinned invite link dropped in a channel (the documented common case) can be opened by someone who is ALREADY an admin/owner of that org: clicking Accept rewrites their role to the invite's (e.g. owner→viewer). If they are the LAST owner, `setMembershipRole` returns `last_owner`, which `acceptInvite` collapses into `reason: "db"` → the page shows "Something went wrong… Try again" — an infinite misleading retry.
- **Root cause**: Happy-path assumption that an accepter is always a non-member; the upsert semantics of `setMembershipRole` (correct for the owner-driven admin route) are wrong for a self-service accept, and the `AcceptResult` union has no variant for "grant refused by policy".
- **Impact**: Silent privilege LOSS with no audit trail (accepts aren't audited via `recordOrgAudit` either), plus a dead-end error for the sole owner. A prank/mistake vector: anyone can demote a teammate-owner by getting them to click a viewer invite.
- **Fix sketch**: In `acceptInvite`, read the accepter's existing role first; if `roleAtLeast(existing, invite.role)`, mark the invite accepted and return `{ ok: true, role: existing }` (no-op grant). Map `last_owner` to its own reason with accurate copy. Optionally audit `org.member.invite_accepted`.

## 3. Invite role selector offers "owner", which the API categorically rejects
- **Severity**: Medium
- **Category**: ui-api-mismatch
- **File**: `src/components/org/members/MemberInvites.tsx:109`
- **Scenario**: The invite panel's role `<select>` maps over the full `ROLES` array (`owner|admin|member|viewer`), but `POST /api/org/invites` hard-rejects `role: "owner"` with 400 ("Owner can't be granted by invite…", `route.ts:44-49`) — a deliberate, well-reasoned server policy.
- **Root cause**: `ROLES` was reused wholesale from the member-role editor (where owner IS valid) without an invite-scoped subset; the server-side policy decision never made it into the UI contract.
- **Impact**: A guaranteed post-submit failure path: the owner picks "owner", fills the target, clicks Create, and only then learns the option never existed. Wasted round-trip and erodes trust in the form; the policy rationale (audited owner-to-owner promotion only) stays invisible until the error.
- **Fix sketch**: Export `INVITE_ROLES = ROLES.filter(r => r !== "owner")` next to `ROLES` in `memberRoles.ts` and map over that; add a hint line "Owner is granted by promoting an existing member." The server check stays as defense-in-depth.

## 4. OrgSwitcher declares `role="menu"` but implements none of the menu keyboard contract
- **Severity**: Medium
- **Category**: a11y
- **File**: `src/components/OrgSwitcher.tsx:94-117`
- **Scenario**: The trigger sets `aria-haspopup="menu"` and the popup `role="menu"`/`role="menuitemradio"`, which promises the ARIA menu pattern to AT users: focus moves into the menu on open, ArrowUp/ArrowDown navigate, Home/End jump, Escape returns focus to the trigger. None of that exists — opening leaves focus on the trigger, arrow keys do nothing, Escape closes without restoring focus context, and Tab walks out while the menu stays visually open (only outside-mousedown closes it).
- **Root cause**: The roles were added for semantics (screen-reader announcement) without the behavioral half of the pattern; the outside-click/Escape effect only handles dismissal.
- **Impact**: Keyboard and screen-reader users are told "this is a menu" and then find a broken one — worse than plain buttons in a labeled listbox, because AT users rely on the announced pattern's key bindings. Org switching is a header-level, every-session control.
- **Fix sketch**: On open, focus the active `menuitemradio`; add ArrowUp/ArrowDown (roving focus), Home/End, and Escape→refocus trigger; close on focus-out. Alternatively drop to the simpler disclosure pattern (`aria-expanded` + plain buttons) if the full menu contract isn't wanted — either honest choice fixes it.

## 5. Three different "danger" color languages across one management surface
- **Severity**: Low
- **Category**: visual-inconsistency
- **File**: `src/components/org/members/MembersPanel.tsx:131`
- **Scenario**: Errors and destructive affordances in this one context use three palettes: MembersPanel/MemberInvites error alerts are `text-orange-300` (`MembersPanel.tsx:131`, `MemberInvites.tsx:124`), OrgSwitcher's error banner is `red-500/red-300` (`OrgSwitcher.tsx:122`), and destructive buttons use the design tokens `text-danger-soft`/`hover:text-danger` (`MembersPanel.tsx:182,206`) — while MemberInvites' equally destructive "revoke" hovers `orange-300` (`MemberInvites.tsx:144`).
- **Root cause**: The repo has semantic `danger`/`danger-soft` tokens, but ad-hoc Tailwind palette classes were used in later additions; no lint/convention pins alerts and destructive actions to the tokens.
- **Impact**: The same severity signal reads differently panel to panel (orange = warning? red = error?), weakening the learned meaning of red on the remove/confirm flow and making a future theme change (or contrast fix) a scavenger hunt. `role="alert"` styling in particular should be uniform.
- **Fix sketch**: Standardize: error alerts → one shared `text-danger-soft` (or an `InlineAlert` component, since the `role="alert"` + margin + text-sm trio now repeats 3×); destructive hovers → `hover:text-danger-soft`. Reserve orange for genuine warnings (the self-demotion confirm can keep it deliberately).
