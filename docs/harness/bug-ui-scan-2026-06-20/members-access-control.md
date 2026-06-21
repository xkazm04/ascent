> Total: 6 findings (1 critical, 2 high, 2 medium, 1 low)

# Members & Access Control — combined bug+ui scan

## 1. Invite is consumed by a GET on page load — prefetch/scanner self-XSRF and first-clicker capture
- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: CSRF / capability-leak / authorization
- **File**: src/app/invite/[token]/page.tsx:75
- **Scenario**: `acceptInvite(token, session.login)` runs during render of a plain GET navigation — there is no POST/confirmation step and no `isSameOrigin` check (unlike every mutation in members/invites routes). Any GET of the URL while a viewer is signed in mutates state: a Next.js `<Link prefetch>`, the browser address-bar prefetch, an email/Slack/Teams link unfurler, antivirus URL scanner, or RSS/preview bot all silently consume the invite and write a Membership row. Worse, an **unpinned** invite (no `githubLogin`) is granted to *whoever opens the link first* (members.ts `setMembershipRole` keys on the *viewer's* login, not the invited address) — so a leaked link (forwarded email, referrer header, browser-history sync, shoulder-surf) hands org access (up to `owner`, see #2) to an unintended signed-in account, and the legitimately-invited person then sees "already used".
- **Root cause**: A security-sensitive, single-use, capability-granting mutation is performed as an idempotent-looking GET side effect, violating the repo's own per-handler "mutations require POST + isSameOrigin" model.
- **Impact**: Unintended/forged org-membership grants; invite burned by automated prefetch (DoS of the invite); cross-account capture of an unpinned invite.
- **Fix sketch**: Make the page render an "Accept invitation to {org} as {role}" confirmation that POSTs to a new `/api/org/invites/accept` handler (with `isSameOrigin` + `requireViewer`); accept only on the user gesture, never on GET render. Strongly prefer requiring `githubLogin`-pinned invites (or matching the invite email to the viewer) before granting.

## 2. Owners can mint and grant the `owner` role with no transitive/last-owner protection on invite-accept
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: privilege-escalation
- **File**: src/app/api/org/invites/route.ts:30 ; src/lib/db/invites.ts:99
- **Scenario**: POST /api/org/invites validates `isOrgRole(body.role)` but does not exclude `owner`, so any owner can issue an `owner`-role invite link. Combined with #1, that link, once opened by *any* signed-in viewer (unpinned), seeds a second org owner. There is no audit event on accept (only on create), so the actual grant — and *who* received it — is never recorded in the trail, despite the file header claiming "every privilege change is audited".
- **Root cause**: Invite role is unconstrained and acceptance bypasses the audited `/api/org/members` path; `acceptInvite` records nothing.
- **Impact**: Silent owner-tier escalation with no audit trail of the recipient; weakens the org takeover guard the rest of the module is built around.
- **Fix sketch**: Disallow `owner` at invite creation (require explicit owner-to-owner promotion via the audited member route), or at minimum `recordAudit("org.member.invite.accepted", { org, login, role })` inside the accept path so the grant is attributable.

## 3. Pending invite tokens are returned in the owner GET listing and re-shipped to the page bundle
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: secret-exposure
- **File**: src/lib/db/invites.ts:55 (listPendingInvites returns full row incl. token) ; src/app/org/[slug]/members/page.tsx:36
- **Scenario**: `listPendingInvites` maps `toPending` which includes the raw `token`; GET /api/org/invites returns `{ invites }` with tokens, and the members page serializes the same tokens into the client `MembersPanel` props (`initialInvites`). The token IS the capability (the only thing protecting the accept flow). Any owner-readable response, browser cache, RSC payload in history, or proxy log now contains live, un-hashed acceptance tokens for every pending invite — a much wider exposure than the one-time "copy link" moment, and they remain valid for 7 days.
- **Root cause**: The capability secret is treated as ordinary list data and broadcast on every members-page load, not shown once at creation.
- **Impact**: Bulk invite-token leakage → anyone with a captured token (logs, cache, screenshare) can accept and join the org as the invite's role.
- **Fix sketch**: Return the token only from the POST create response; have `listPendingInvites` omit `token` (or expose a non-secret derived id) and store a hash of the token, looking up by hash on accept.

## 4. Members page reads `getSession()` for `selfLogin` while the live auth is Supabase, so "(you)" badge is wrong/missing
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / identity-mismatch
- **File**: src/app/org/[slug]/members/page.tsx:28 ; src/components/org/MembersPanel.tsx:182
- **Scenario**: The page derives `selfLogin` from `getSession()` (the *dormant* custom GitHub-OAuth session per authz.ts header), but under the active Supabase login wall the real identity comes from `getViewer()` (access.ts). When the Supabase wall is on, `getSession()` is null, so `selfLogin` is null and the "you" marker never renders — and worse, if a custom session ever coexisted, the marker could point at the wrong account. The page gate itself (`hasOrgRole`) correctly uses the viewer, so the mismatch is purely in the self-identification handed to the UI.
- **Root cause**: Mixing the two identity sources — the gate uses the viewer model while the display uses the legacy session model.
- **Impact**: An owner can't reliably see which row is themselves before demoting/removing, raising the chance of self-lockout (the last-owner guard catches the worst case, but the UX safety cue is gone).
- **Fix sketch**: Resolve `selfLogin` from `getViewer()` when `authGateEnabled()`, falling back to `getSession()` for the dormant-OAuth path.

## 5. Optimistic role change to a higher tier isn't reconciled, and removing yourself isn't guarded in the UI
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-state / optimistic-UI drift
- **File**: src/components/org/MembersPanel.tsx:108 ; :131
- **Scenario**: `changeRole`/`remove` apply the change optimistically and only roll back on a non-ok response; on success they keep the optimistic value but never re-fetch, so any server-side normalization (e.g. an unknown role coerced to `member` in members.ts) leaves the table showing a value the server didn't persist. Separately, an owner can pick `remove` (or demote) on their *own* row with only a generic confirm; the only protection is the server `last_owner` 409 — a non-last owner who removes themselves is silently dropped from the org with no client-side "this is you / you'll lose access" guard beyond the generic confirm.
- **Root cause**: Optimistic mutations are treated as authoritative; no self-action affordance.
- **Impact**: Stale role display after coercion; accidental self-removal / self-demotion.
- **Fix sketch**: On success, trust the server echo (POST already returns `{ login, role }`) and set state from it; add a distinct confirm and/or disable destructive self-actions when `login === selfLogin`.

## 6. OrgSwitcher silently no-ops on a failed switch with no user feedback
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: missing-error-state
- **File**: src/components/OrgSwitcher.tsx:50
- **Scenario**: `choose` posts to /api/org/active; on `!res.ok` it `return`s and on `catch` it swallows the error — the menu just closes and the active org silently stays the same. A user who lost access to an org (membership revoked) or hits a transient error sees the switcher snap back to the old org with zero explanation, looking like a frozen UI.
- **Root cause**: Failure paths produce no visible state.
- **Impact**: Confusing dead-click; user can't tell whether the switch failed or the org is gone.
- **Fix sketch**: Surface a brief inline error/toast on non-ok or thrown switch, and keep the menu open or re-show the prior selection explicitly.
