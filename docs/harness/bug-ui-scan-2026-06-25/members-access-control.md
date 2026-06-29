# Members & Access Control — Bug + UI Scan
> Context: Members & Access Control (Org Scanning & Fleet Rollups)
> Total: 5 findings (0 critical, 0 high, 2 medium, 3 low)

This context is unusually well-hardened already (extensive prior IDOR / land-grab / last-owner / token-as-capability fixes, with matching tests). The findings below are the residual gaps the existing guards do not cover.

## 1. Unpinned invite is multi-use under a concurrent accept race
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/lib/db/invites.ts:133-158 (status read at :143; consume at :157)
- **Value**: impact 6 · effort 3 · risk 3
- **Scenario**: An owner creates an UNPINNED invite (no `githubLogin`/`email` — explicitly allowed: "stays open to any signed-in viewer") and drops the link in a team channel. Two different signed-in viewers click "Accept invitation" at nearly the same moment. `acceptInvite` does three *separate* DB operations: `findUnique` (reads `status:"pending"`), then `setMembershipRole` (its own `$transaction`), then `invite.update({ where:{ id } })` to flip to `accepted`. Both requests read `pending`, both grant a membership (to two *different* users), both flip to accepted. A "single-use" invite has now granted the role to two accounts.
- **Root cause**: The pending-check and the status-flip are not atomic, and the final `update` is keyed only on `id` — it is not conditional on the row still being `pending`. The serializable isolation that protects `setMembershipRole` does not span these three independent statements.
- **Impact**: Single-use capability bypass — one shared link onboards more accounts than intended (each at the invite's role, capped at admin). Pinned invites are mostly shielded (both racers must be the same pinned login → idempotent), but unpinned invites are a designed, common case.
- **Fix sketch**: Claim-first. Replace the trailing `update` with an atomic `updateMany({ where:{ id, status:"pending" }, data:{ status:"accepted" } })` performed *before* the grant; only proceed to `setMembershipRole` when `count === 1` (the winner), and return `used` otherwise. That makes the loser of the race observe a non-pending row and makes double-grant impossible.

## 2. An owner can silently lock themselves out via the role <select> (no self-guard, no confirm)
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/components/org/MembersPanel.tsx:37-58 (changeRole), :124-137 (self select enabled)
- **Value**: impact 5 · effort 3 · risk 3
- **Scenario**: An org with two owners. Owner A opens Members and, on their own row (already badged "you"), mis-clicks the role `<select>` to `viewer`. `changeRole` fires immediately and optimistically; the server allows it (A is not the *last* owner, so the last-owner guard does not trip). A is now a viewer and is instantly locked out of the owner-only Members surface and every owner action, with no way back except another owner.
- **Root cause**: Removal has a deliberate two-step inline confirm, but the role `<select>` is a single uncommitted change with no confirmation, and nothing constrains the *self* row (the destructive "demote myself below owner" case) even though `selfLogin` is already known to the component.
- **Impact**: Accidental self-lockout from the management surface (recoverable only by another owner). A pure footgun on a privileged screen.
- **Fix sketch**: When `m.login === selfLogin` and the new role is below the current one, require an explicit confirm (reuse the inline Remove? affordance) before POSTing; or disable downgrading your own owner role and show a hint ("ask another owner to change your role"). Mirrors the care already taken for Remove.

## 3. Invite creation skips the GitHub-login / email shape validation the member route enforces
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/app/api/org/invites/route.ts:29-44 (no shape check) vs src/app/api/org/members/route.ts:22,47 (GITHUB_LOGIN regex)
- **Value**: impact 3 · effort 2 · risk 1
- **Scenario**: An owner typos a login ("acmecorp-jondoe " with a trailing space, or "jon doe") or an invalid email into the invite box. The members route would reject a malformed login with 400 ("login must be a valid GitHub login"), but the invites route accepts any non-empty string, lowercases it, pins it, and stores a pending invite. Because acceptInvite requires the pin to match a *real* logged-in identity, that invite can never be accepted — it just sits in the owner's pending list as dead weight until it expires.
- **Root cause**: The invite path was added to end the "typo → ghost membership" class (per the module header in invites.ts), but it never applied the `GITHUB_LOGIN` shape check the direct-member path uses, nor any email-format check.
- **Impact**: Confusing un-acceptable invites pollute the pending list; the owner believes a teammate was invited. No security impact (the pin check fails closed).
- **Fix sketch**: Reuse the `GITHUB_LOGIN` regex for `body.githubLogin` and a minimal email check for `body.email` in the invites POST, returning 400 on a malformed target — same contract as /api/org/members.

## 4. `setMembershipRole` failure is reported to the user as "Unknown organization" (404)
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/app/api/org/members/route.ts:54-55 ; src/lib/db/members.ts:141-143 (catch → "error")
- **Value**: impact 4 · effort 2 · risk 1
- **Scenario**: A legitimate owner changes a teammate's role on a real org, but the role-write transaction throws transiently (DB blip / serialization abort). `setMembershipRole`'s `catch { return "error" }` collapses *both* "unknown org" and "transaction failed" into the same `"error"`, and the route maps `"error"` → 404 `{ error: "Unknown organization." }`. The MembersPanel rolls back the optimistic change and surfaces "Unknown organization." for an org that plainly exists.
- **Root cause**: One sentinel (`"error"`) is overloaded for two distinct conditions (not-found vs infrastructure failure), so the route cannot tell them apart and picks the wrong status/message.
- **Impact**: Misleading error on a privileged path; an operator chasing a "missing org" report when the real cause is a retryable DB error. No data corruption (no write occurred, correctly no audit).
- **Fix sketch**: Distinguish the two — return a separate outcome (e.g. `"db_error"`) from the `catch` and map it to 500/503 ("Couldn't update the role, try again"), reserving 404 "Unknown organization" for the genuine `getOrgId === null` case.

## 5. Email-pinned invite shows GitHub-account error copy and surfaces no email requirement
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: error-state
- **File**: src/app/invite/[token]/page.tsx:88-90 ; src/app/invite/[token]/AcceptInviteForm.tsx:18 ; src/lib/db/invites.ts:147-150
- **Value**: impact 3 · effort 3 · risk 1
- **Scenario**: An owner invites a teammate by EMAIL (no login pinned). The accept page only computes `mismatch` from `peek.pinnedLogin` (the GitHub login), so an email-pinned invite shows no up-front hint about which email is required. If the viewer's verified email doesn't match, `acceptInvite` returns `wrong_user` — but `wrong_user` copy reads "This invitation was issued to a different GitHub account. Sign in as that user to accept it." For an email mismatch that guidance is actively wrong (switching GitHub accounts won't change the verified email).
- **Root cause**: `wrong_user` is a single reason reused for two distinct binding failures (login pin vs verified-email pin), and the UI copy assumes only the login case; the page's pre-flight `mismatch` hint never covers the email-pinned case.
- **Impact**: A correctly-invited user is stuck on a misleading message with no actionable path. Pure UX/error-clarity, no security effect (binding still fails closed server-side).
- **Fix sketch**: Either split the reason (e.g. `wrong_email` vs `wrong_user`) with email-specific copy, or generalize the `wrong_user` message to "This invitation is bound to a specific account/email; accept it while signed in as the invited identity." Optionally surface an email-pinned hint in the page's pre-flight like the login `mismatch` banner.
