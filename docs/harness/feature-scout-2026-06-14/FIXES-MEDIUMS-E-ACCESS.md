# Feature Scout Fix — Mediums Wave E · Access control & safety (complete: 3/3)

> Close the RBAC mediums: a real safety hole (orphanable org), role transparency for every member,
> and team-invite at the activation peak. Baseline preserved: `tsc` 0; **vitest 456/456**; eslint 0;
> `next build` ✓ (EXIT 0).

## Commits

| Finding | Commit | What shipped |
|---|---|---|
| MEM #5 — last-owner guard | `d068638` | `setMembershipRole` now returns `ok \| last_owner \| error` and refuses a demotion that would drop the org to zero owners (removeMembership already guarded removal); the route maps `last_owner` → 409, which the Members panel already surfaces + rolls back. |
| MEM #6 — self-service role | `f90c3b7` | The org header renders the viewer's own role badge (`getMembershipRole`, fetched alongside the existing rollup/credit reads) — every member can see their access level, not just owners who can open the Members tab. |
| ONB #5 — onboarding invite | `3949e73` | An "Invite your team" panel + checklist step in the onboarding done state (App path) POSTs GitHub handles to `/api/org/members` as `viewer` — seat expansion at peak motivation, no App install needed for the invitee. |

## What was fixed

- **MEM #5 — the orphan footgun.** Demoting (not just removing) the sole owner left an org with no one
  able to manage it — support then patched it in the DB. The guard mirrors the existing
  `removeMembership` last-owner check; the panel's existing optimistic-rollback + error display means
  the 409 ("assign another owner first") shows with no extra UI work. Defense-in-depth: the guard lives
  in `setMembershipRole`, so the invite-accept path is covered too.
- **MEM #6 — role legibility.** A non-owner had no way to see their own role (the Members tab is
  owner-gated), driving "why can't I do X" confusion. A server-rendered role badge in the org header
  answers it for everyone — no extra endpoint, no client round-trip.
- **ONB #5 — invite at the peak.** The strongest retention signal in fleet products is multi-user
  activation; the wizard never touched the RBAC backend. The done state now invites teammates as
  viewers. `requireOrgRole` auto-seeds the installation-owner, so the first grant succeeds even before
  they've opened the dashboard.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | 456/456 (54 files) |
| eslint (changed) | 0 errors |
| `next build` | ✓ EXIT 0 |

## Patterns reinforced

- **A safety invariant belongs in the data layer, not the route** (MEM #5): putting the last-owner
  guard in `setMembershipRole` (returning a typed outcome like `removeMembership`) protects every
  caller — the members route AND invite-accept — rather than one endpoint.
- **Surface a fact the page already fetches** (MEM #6): the role badge reuses the layout's existing
  membership/rollup round-trip; no new endpoint for a one-value read.
- **Reuse the gate's auto-seed** (ONB #5): `requireOrgRole` already seeds the installation-owner as
  `owner` on first owner-gated access, so the onboarding invite works without a separate "make me owner"
  step.

## What remains (from the INDEX)

Medium waves C, D, F, G, H + the 4 lows. Stripe (CRED-1/CRED-3) + notifications/email stay excluded.
