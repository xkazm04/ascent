# Members & Access Control — bug-hunter + ui-perfectionist scan

> Context: Members & Access Control (group: Org Scanning & Fleet Rollups)
> Files scanned: 11
> Total: 7 findings (Critical: 0, High: 2, Medium: 4, Low: 1)

## Authorization core — answers to the scoped questions

**Q1 — predicate each guard depends on (authz.ts / access.ts).** The guards themselves are all
active-path-correct; the dormant-predicate leaks are at the *call sites*, not the guards:

| Guard | Gates on | Verdict |
|---|---|---|
| `getViewer` (access.ts:43) | Supabase `getUser()` (+ `authBypassEnabled`) | ACTIVE-correct |
| `requireViewer` (access.ts:70) | `authGateEnabled()` + `getViewer` | ACTIVE-correct |
| `canReadOrg` (authz.ts:106) | `authGateEnabled()` → `getViewer`+`viewerOrgRole`; dormant `isAuthConfigured`/`sessionOwnsOrg` only when gate OFF | ACTIVE-correct |
| `requireOrgRead` (authz.ts:129) | delegates to `canReadOrg` | ACTIVE-correct |
| `requireOrgAccess` (authz.ts:69) | `requireViewer` + `authGateEnabled` → `getViewer`+`viewerOrgRole` | ACTIVE-correct |
| `requireOrgRole` (authz.ts:180) | `requireViewer` + `authGateEnabled` → `getViewer`+`viewerOrgRole` | ACTIVE-correct |
| `resolveViewerLogin` (access.ts:89) | dormant `getSession()` first, then ACTIVE `getViewer()` fallback | net ACTIVE-correct (see Q2) |

**Q2 — DOES `resolveViewerLogin()` resolve a real identity under the active Supabase wall? YES.**
`resolveViewerLogin` (access.ts:89-94) does `const session = await getSession(); if (session?.login) return session.login; return (await getViewer())?.login ?? null;`. Under the active Supabase wall the dormant custom OAuth mints no `ascent_session` cookie, so `getSession()` (auth.ts:306 → getSessionState:257-261) returns **null**, the `session?.login` branch is skipped, and it falls through to **`(await getViewer())?.login`** — the JWT-validated Supabase login (access.ts:43-58). So it returns a REAL identity (the Supabase login) whenever a viewer is signed in; it returns null ONLY when nobody is signed in. **It is a correct, safe canonical fix for the null-actor audit bug — it is NOT broken.** The two scan agents that disagree: the "returns null" claim is wrong for the active wall. Sole caveat (inert in prod): it *prefers* the dormant session (access.ts:91-92), so if a stray `ascent_session` ever exists (dev mixing stacks) it returns the custom-OAuth login, a different namespace than the Supabase login at access.ts:54 — benign for an audit string, only relevant for identity-keyed DATA (Shared Memory), out of this context's scope.

**Q3 — Role hierarchy.** Consistent. `roleAtLeast` uses `ROLE_RANK[...] >= ROLE_RANK[min]` (members.ts:16-22). No gate uses `!==`/bare equality to admit a lower role; the two `=== "owner"` checks (members.ts:138, 178) correctly PROTECT owners, not gate access.

**Q4 — Privilege escalation.** None found. Every member mutation requires `requireOrgRole(org, "owner")` (members/route.ts:31,50,79); a member/admin can't reach `setMembershipRole`/`removeMembership`. Invites are capped at admin (invites/route.ts:43-48) so no owner-by-invite. An owner can change their own role but the last-owner guard prevents orphaning, and an owner is already the max role — no self-escalation. An admin can neither reach the route nor pass the last-owner guard to remove the last owner.

**Q5 — Invites.** Token = `randomBytes(24).toString("base64url")` = 192-bit CSPRNG (invites.ts:35). Expiry enforced on redeem (invites.ts:147). Single-use enforced atomically via conditional `updateMany` claim keyed on `status:"pending"` (invites.ts:166-170) — race-safe against double-redeem. Binding: login-pin must equal viewer login; email-pin must equal viewer verified email; neither = open to any signed-in viewer (invites.ts:148-156). Solid — except the email-verification trust gap (finding #6).

**Q6 — Auth-off / `openOrgDashboardsEnabled`.** When both gates are off (`!authGateEnabled() && !isAuthConfigured()`): `requireOrgAccess` (authz.ts:85) and `requireOrgRole` (authz.ts:206) return null — WRITES fall fully open (local/demo). `canReadOrg` returns `openOrgDashboardsEnabled()` (default OFF; authz.ts:118,159), so READS stay closed unless `ASCENT_OPEN_ORG_DASHBOARDS` is set. This write-open/read-closed asymmetry is intentional and documented (authz.ts:152-158).

---

## 1. Invite acceptance page is gated on the dormant `getSession()` — no invited teammate can accept in production
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: dormant-predicate
- **File**: src/app/invite/[token]/page.tsx:63
- **Scenario**: Under the documented prod config (Supabase login wall), a signed-in viewer opens `/invite/<token>`. Line 63 `const session = isAuthConfigured() ? await getSession() : null` — `getSession()` returns null in prod (no `ascent_session` cookie is ever minted). So line 64 renders the `SignInNotice` sign-in wall (when OAuth env is present) or line 71 renders "Authentication required" (when it isn't). The `AcceptInviteForm` is NEVER reached, even though the viewer is signed in.
- **Root cause**: The page consults the dormant custom-OAuth stack for "is there a viewer?" instead of the active `authGateEnabled()`/`getViewer()` gate. The sibling accept ROUTE was already migrated (accept/route.ts:26-36 explicitly notes "the old route... under the Supabase wall acceptance always 403'd"); the page was left behind — a half-finished migration.
- **Impact**: The entire teammate-invite feature (the reason invites.ts exists) is dead on the common path — every invited user is blocked from accepting. Fail-closed, so not a security hole, but a total feature outage.
- **Fix sketch**: Mirror accept/route.ts: `if (authGateEnabled()) { const viewer = await getViewer(); if (!viewer) <SignInNotice>; else render form with selfLogin=viewer.login }` and derive the pin `mismatch` from `viewer.login`/`viewer.email`, falling back to the dormant `getSession()` only when `!authGateEnabled()`.

## 2. Privilege-change audit records a null actor — role grants, removals, and invites are un-attributable
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: audit-integrity
- **File**: src/app/api/org/members/route.ts:62
- **Scenario**: An owner changes a member's role (POST), removes a member (DELETE), or creates an invite (invites/route.ts:64). Each handler does `const session = await getSession()` and passes `session?.login` as the audit actor (members/route.ts:66-68 & 87; invites/route.ts:69 `invitedBy`, :76 `actorId`). Under the active Supabase wall `getSession()` is always null, so every one of these records `actor = undefined/null`.
- **Root cause**: Actor attribution reads the dormant auth stack directly instead of the cross-stack resolver. The route comment (members/route.ts:8) promises "Every privilege change is audited (the action that most needs a trail)" — but the trail has no "who".
- **Impact**: The audit log for the most security-sensitive actions in the app (role escalation, member removal, invite issuance) cannot answer "who did this". Defeats incident forensics; a rogue/compromised owner leaves no attributable trace. Pending invites also show `invitedBy: null`.
- **Fix sketch**: Replace `const session = await getSession(); … session?.login` with `const actor = await resolveViewerLogin()` (access.ts:89 — confirmed in Q2 to resolve the real Supabase login) and pass `actor` as the audit actorId / `invitedBy`.

## 3. Self-demotion confirm + "you" badge are dead — `selfLogin` is derived from the dormant session
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: dormant-predicate
- **File**: src/app/org/[slug]/members/page.tsx:28
- **Scenario**: The page passes `selfLogin={session?.login ?? null}` from `getSession()` (line 25-29,45). Under the Supabase wall this is always null. In MembersPanel, `m.login === selfLogin` (MembersPanel.tsx:47, :136) is then never true, so (a) the self-demotion confirmation dialog (the guardrail at MembersPanel.tsx:42-53 that warns "you'll lose owner access to this page") never fires, and (b) the "you" badge never renders. An owner (with a co-owner present, so the server's last-owner guard doesn't catch it) can silently demote themselves to viewer with zero warning and instantly lose access to the page.
- **Root cause**: Same dormant-predicate class as #1/#2 — the self-identity signal that drives a UX safety rail is sourced from the inert auth stack.
- **Impact**: A deliberate lock-out-prevention guardrail is inert in production; an owner self-locks with no confirm and no self-recovery (only another owner can restore them).
- **Fix sketch**: In the page, derive self-identity from the active stack: `const viewer = await getViewer(); … selfLogin={viewer?.login ?? null}` (or `resolveViewerLogin()`), matching the invite/audit fixes.

## 4. Optimistic rollback restores a stale snapshot — a failed role-change can resurrect a removed member
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/components/org/MembersPanel.tsx:56
- **Scenario**: Two rows mutate concurrently (each row gates only its own login via `busy === m.login`, so cross-row concurrency is allowed). Owner changes A's role — `changeRole` captures `prev = members` (line 56) and applies the optimistic update. Before it resolves, owner removes B — `remove` captures its own `prev` and filters B out (line 83-86). B's DELETE succeeds; then A's POST fails and runs `setMembers(prev)` (line 71) with the snapshot taken *before* B was removed — **B reappears in the list**. Symmetric clobbering happens for two concurrent role changes.
- **Root cause**: Rollback replays a whole-array snapshot captured at call time instead of reverting only the one field via a functional updater; concurrent optimistic mutations don't compose.
- **Impact**: UI shows a member who was actually removed (or a role that was actually changed) — misleading state on a security-management surface until a manual refresh. No server-side corruption.
- **Fix sketch**: Roll back with a functional, targeted update, e.g. `setMembers(ms => ms.map(m => m.login === login ? { ...m, role: prevRole } : m))`, capturing only the prior role; likewise re-insert on failed remove rather than restoring a stale array.

## 5. Last-owner guard depends on serializable isolation — TOCTOU orphans the org on non-DSQL Postgres
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/lib/db/members.ts:132
- **Scenario**: Org has two owners A and B. Concurrently, one request demotes A and another demotes B (or removes them — removeMembership:172-184 has the same shape). Each `$transaction` reads `count({role:"owner"})` and sees 2 (`> 1`, so the guard passes), then upserts/deletes a *different* row (A vs B) — no write-write conflict. Both commit → the org is left with zero owners.
- **Root cause**: The guard is a read-then-write invariant that is only safe under SERIALIZABLE isolation. The code comment (members.ts:127-130) explicitly leans on "Aurora DSQL (serializable)", but no `isolationLevel` is set on the Prisma transaction, so a vanilla Postgres deployment (the stack's stated DB) runs at READ COMMITTED and the predicate isn't enforced across the two transactions.
- **Impact**: An org can be orphaned with no owner — no one can manage members, billing, or invites; unrecoverable without direct DB surgery. Narrow (needs two concurrent owner demotions) but a true correctness hole in the core invariant.
- **Fix sketch**: Pin the transaction to serializable (`prisma.$transaction(fn, { isolationLevel: "Serializable" })`) so the count predicate conflicts, or enforce the invariant with a conditional write (e.g. a partial unique/`updateMany` guarded on remaining-owner count) rather than a plain read-then-write.

## 6. `getViewer` trusts `u.email` as verified — email-pinned invite binding is bypassable if Supabase confirmations are off
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: trust-boundary
- **File**: src/lib/access.ts:54
- **Scenario**: `getViewer` returns `email: u.email ?? undefined` with no check of `email_confirmed_at`/`email_verified` (access.ts:52-56). `acceptInvite` binds an email-only invite to `identity.email` and its comment calls it "the viewer's VERIFIED email" (invites.ts:119-120,150-156). If the Supabase project does not enforce email confirmation (or a provider supplies an unconfirmed email), an attacker who registers a Supabase account carrying `victim@example.com` (unverified) satisfies the email pin and claims an invite intended for the victim.
- **Root cause**: The "verified email" guarantee that the invite binding relies on is asserted in the invite layer but never actually established in `getViewer` — the trust boundary is assumed, not checked.
- **Impact**: Under a permissive Supabase config, email-pinned invites degrade to bearer-any-with-matching-email — a role granted to the wrong person. Exploitability is gated by external Supabase config, hence Medium.
- **Fix sketch**: In `getViewer`, only surface `email` when Supabase reports it confirmed (`u.email_confirmed_at`/`identities[].identity_data.email_verified`); otherwise omit it so `acceptInvite`'s email branch fails closed (`!viewerEmail`).

## 7. Failed org switch is silently swallowed — the user gets no feedback
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: error-state
- **File**: src/components/OrgSwitcher.tsx:48
- **Scenario**: `choose` closes the menu, POSTs to `/api/org/active`, and on `!res.ok` (or a thrown fetch) simply `return`s (lines 48, 53) with no user-visible state. The viewer clicks a different org, the menu closes, and nothing changes — no error, no toast, no revert of the label. They cannot tell the switch failed vs. succeeded.
- **Root cause**: The component has no error/failure surface; the failure path is a bare early-return, mirroring "success theater".
- **Impact**: Confusing dead-click on a navigation control; the viewer may believe they switched org and act on the wrong tenant's dashboard. Cosmetic/UX, no data risk.
- **Fix sketch**: Track an error state and render a small inline notice (or toast) on failure, and keep the menu open so the user can retry; optionally show a busy indicator on the chosen item during the POST.
