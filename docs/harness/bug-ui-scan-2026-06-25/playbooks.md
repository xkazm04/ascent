# Playbooks — Bug + UI Scan
> Context: Playbooks (Org Planning & Execution)
> Total: 5 findings (0 critical, 1 high, 2 medium, 2 low)

## 1. Archive (member-gated PATCH) is a soft-delete that bypasses the admin-only DELETE gate
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: access-control / auth-bypass
- **File**: src/app/api/org/playbooks/[id]/route.ts:15-36,49-52 · src/lib/db/playbooks.ts:53,103,116-131,190
- **Value**: impact 7 · effort 3 · risk 2
- **Scenario**: DELETE is deliberately restricted to admins (`resolvePlaybookOrg(id, "admin")`, line 51). But PATCH defaults to member-level (`resolvePlaybookOrg(id)`, line 17) and accepts `archived: true`. `listPlaybooks` filters `archived: false` (playbooks.ts:53), so any signed-in member can POST `PATCH {archived:true}` to make an org standard vanish from everyone's list — the exact destructive outcome the admin gate guards. There is no un-archive UI or API, so the hide is effectively permanent for non-DB users.
- **Root cause**: `archived` is treated as ordinary editable content (member-level) rather than a destructive state change, and "remove from list" was split between a hard DELETE (admin) and a soft archive (member) with no shared severity contract.
- **Impact**: A non-admin can permanently suppress the org's published standards (governance/auth integrity). Worse, the soft-delete is half-baked: `getPlaybook` (used by /apply) and `getPlaybookAdoption` do NOT filter `archived`, so an "archived" playbook still opens PRs and still counts in adoption analytics — hidden from the list but live everywhere else.
- **Fix sketch**: Gate `archived` toggles behind `resolvePlaybookOrg(id, "admin")` (separate the archive field from the member-editable content patch), and make archived consistently exclude the playbook from /apply + adoption. Add an admin un-archive path so the state is reversible.

## 2. Draft-PR branch & file path are derived only from slug(title) → cross-playbook collision
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption / edge-case
- **File**: src/app/api/org/playbooks/[id]/apply/route.ts:23,75,77 · src/lib/github/write.ts:90-120
- **Value**: impact 6 · effort 3 · risk 3
- **Scenario**: The branch (`ascent/playbook-${slug(title)}`) and committed path (`docs/playbooks/${slug(title)}.md`) ignore the playbook id and key only on the title slug. Two distinct playbooks whose titles slug identically (e.g. "Our CI standard" and "Our CI Standard!" → both `our-ci-standard`) applied to the same repo collide: `openDraftPr` reuses the pre-existing branch (write.ts:90-94), updates the same file with the second playbook's body (write.ts:101-104), and returns the first playbook's still-open PR with `reused: true` (write.ts:116-120). Meanwhile `applyPlaybook(org, id, …)` records adoption against the *correct* id.
- **Root cause**: Identity of a playbook is its DB id, but the GitHub artifact namespace was derived from a non-unique human title.
- **Impact**: A user "opens a PR" for playbook B but gets playbook A's PR, now showing B's file content; the two playbooks' adoption/lift analytics diverge from what was actually committed. Confusing and silently wrong.
- **Fix sketch**: Include the playbook id in the branch and path (e.g. `ascent/playbook-${id}-${slug(title)}` and `docs/playbooks/${id}-${slug(title)}.md`), so distinct playbooks can never share a branch/file.

## 3. Mark-applied / unmark failures are silently swallowed in PlaybookCard
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/components/org/PlaybookCard.tsx:56-73,100-113
- **Value**: impact 5 · effort 3 · risk 2
- **Scenario**: `apply()` and `unapply()` optimistically mutate `applied`, then roll the change back on a non-ok response or network error — but never call `setError`. So a 403, 404 ("Repo must belong to …", repos/route.ts:27-29) or network blip just makes the chip flicker and disappear with zero feedback; the user re-clicks, sees the same silent nothing. Contrast `PlaybooksPanel.remove()` (PlaybooksPanel.tsx:68-80), which snapshots, restores AND surfaces the error.
- **Root cause**: The card has no error surface for the adoption-mark actions (only `prError` exists, scoped to the Open-PR flow), so all mark/unmark failures are invisible.
- **Impact**: Adoption marks appear to silently not "stick"; users can't tell whether they lack access, sent a cross-tenant repo, or hit a transient error. Erodes trust in the adoption numbers that feed lift analytics and Initiatives.
- **Fix sketch**: Add a shared `setError`/message surface to the card; on rollback set a concrete message from the response body (mirror `remove()`), e.g. "Couldn't record adoption for {repo}."

## 4. trackAsInitiative is one-shot and swallows non-ok responses
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/components/org/PlaybookCard.tsx:37-52,167-179
- **Value**: impact 4 · effort 3 · risk 2
- **Scenario**: On a non-ok POST (`res.ok` false), `tracked` is never set, `tracking` resets, no message is shown — the button just looks idle again (the "leave the button enabled to retry" comment only covers the thrown-exception branch, not the API-rejection branch). And once `tracked` flips true it stays true for the component's lifetime, so if more repos adopt the playbook afterward there's no way to re-track / widen the Initiative's `repos` scope — the initiative is frozen to the repo set at first click.
- **Root cause**: Success is modeled as a permanent local boolean with no error channel and no notion of "scope changed since tracked".
- **Impact**: Silent failures on initiative creation; stale initiative scope when adoption grows. Low frequency but quietly misleading.
- **Fix sketch**: Surface a message on `!res.ok`; re-enable "Update initiative" when `applied` grows beyond the set captured at track time (compare against a snapshot).

## 5. Lift badge paints zero movement green ▲ +0 and hardcodes hex colors off the design system
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: visual-consistency / success-theater
- **File**: src/components/org/PlaybookCard.tsx:161-165 · src/lib/db/playbooks.ts:241-246
- **Value**: impact 3 · effort 2 · risk 1
- **Scenario**: Lift is `Math.round(liftSum/measured)` over 0–100 dimension scores; the badge uses `lift >= 0` to choose color and the ▲ glyph. A genuine zero (or a sub-0.5 average that rounds to 0) renders a green "▲ +0 avg D5 since", implying improvement where there was none. The colors are inline hex (`#84cc16` / `#f97316`) while the rest of the card uses Tailwind tokens (`text-emerald-300`, `text-orange-300`, `text-accent`), so the lift badge drifts from the design system and won't follow theming.
- **Root cause**: `>= 0` conflates "flat" with "up", and the color was hardcoded rather than mapped to the existing positive/negative token pair.
- **Impact**: A subtly dishonest "improvement" signal on a flat metric, plus a visual inconsistency that bypasses the theme.
- **Fix sketch**: Treat 0 as neutral (e.g. `lift > 0` up/green, `< 0` down/orange, `=== 0` muted "no change" with no arrow) and use the Tailwind emerald/orange utility classes already used elsewhere in the card.
