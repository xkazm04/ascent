# Playbooks — bug-hunter + ui-perfectionist scan

> Context: Playbooks (group: Org Planning & Execution)
> Files scanned: 11
> Total: 8 findings (Critical: 0, High: 1, Medium: 3, Low: 4)

Note on IDOR (brief's top concern): the per-row routes are SOUND. `[id]`, `[id]/repos`, and
`[id]/apply` all resolve the org FROM the playbook via `resolvePlaybookOrg` (playbook-gate.ts) →
`getPlaybookOrgSlug` → `requireOrgAccess`/`requireOrgRole` on the ACTIVE Supabase wall
(`requireViewer`/`getViewer`). No cross-org read/update/delete/apply. `apply` and `repos` also
tenant-check the target `repo` (`parsed.owner === org`). Gating is on the correct (active) stack. The
one dormant-auth defect below is ATTRIBUTION, not gating.

## 1. Every playbook write attributes the actor via the dormant OAuth session
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: actor-attribution-dormant-auth
- **File**: src/app/api/org/playbooks/[id]/apply/route.ts:34
- **Scenario**: In production the active login wall is Supabase (`getViewer`); the custom GitHub OAuth is dormant, so `isAuthConfigured()` is false and `getSession()` returns null (auth.ts:258). Every write route stamps identity from `getSession()`: create (route.ts:39,44 `createdBy`), PATCH audit ([id]/route.ts:44,46), mark-applied (repos/route.ts:31,32 `appliedBy`), and apply's `applyPlaybook`/`recordOrgAudit` (apply/route.ts:90,95). All record `null`.
- **Root cause**: These routes read the wrong (dormant) auth stack. The codebase already has the canonical cross-stack resolver `resolveViewerLogin()` (access.ts:89) — session first, then Supabase viewer — precisely for this.
- **Impact**: `createdBy`, `appliedBy`, and every `playbook.updated`/`playbook.pr_opened` audit entry show no actor in production — the audit trail the feature exists to provide ("the org's standards have history") is anonymous. Compliance/attribution loss for every org.
- **Fix sketch**: Replace each `getSession()`/`session?.login` with `await resolveViewerLogin()` and drop the dead `isAuthConfigured()` 401 gate in apply/route.ts:34-37 (the real gate is `resolvePlaybookOrg`).

## 2. Apply returns "Failed to open the PR" after the PR was actually opened
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: partial-failure
- **File**: src/app/api/org/playbooks/[id]/apply/route.ts:90
- **Scenario**: `openDraftPr` succeeds (branch + commit + PR created in the customer repo, line 71). Then `applyPlaybook` (line 90) throws on a DB blip. The catch (line 99) doesn't recognize it as `AppApiError`/`GitHubError`, so it falls through to line 109-110 and returns 500 `"Failed to open the playbook PR."`
- **Root cause**: External side-effect (the PR) and the DB adoption write live in one try block with an all-or-nothing failure response; a post-PR failure is reported as a total failure.
- **Impact**: User sees failure and a lost adoption mark, though a real draft PR now exists in their repo. Re-click reuses the PR (safe) but analytics stay wrong until a later mark succeeds. Confusing, silently inconsistent state.
- **Fix sketch**: Record adoption/audit in a nested try that logs-but-doesn't-fail once `pr` exists; still return `pr` (with a `warning` flag) so the client shows the PR link.

## 3. "Open draft PR" writes to a real customer repo with no confirmation
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: destructive-write-confirmation
- **File**: src/components/org/PlaybookCard.tsx:242
- **Scenario**: A member picks a repo and single-clicks "Open draft PR →"; `openPr` (line 100) immediately POSTs to `[id]/apply`, which creates a branch, commits a file, and opens a PR in the org's actual GitHub repo — visible to the whole team. No confirm dialog, no in-UI undo.
- **Root cause**: An irreversible-in-UI external side-effect is wired to a bare `onClick`, treated like the harmless local "Mark applied" beside it.
- **Impact**: One misclick opens a real PR a teammate must notice and close. Double-submit is guarded (`prBusy`), but the first click has no gate.
- **Fix sketch**: Add a confirm step (native `confirm`, or a two-step "Open PR? · Confirm" toggle) naming the repo before the fetch; keep the existing busy/disabled guard.

## 4. Detail modal renders the playbook title + summary twice
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: component-composition
- **File**: src/components/org/practices/PracticeDetailModal.tsx:32
- **Scenario**: `PracticeDetailModal` shows a `ModalHeader` with `title={row.label}` and `context={row.what}` — for an authored row these are `pb.title` and `pb.summary` (practiceRows.ts:74,76). The body then embeds `PlaybookCard`, which renders its OWN `p.title` (PlaybookCard.tsx:150) and `p.summary` (line 165). Both appear stacked.
- **Root cause**: `PlaybookCard` was designed as a standalone panel card (self-titled); it's now reused inside a modal that already supplies a header, so the header duplicates.
- **Impact**: Every authored-playbook detail dialog shows the title and summary twice — visual redundancy that reads as a rendering bug.
- **Fix sketch**: Give `PlaybookCard` a `chromeless`/`hideHeader` prop (or split its header out) so the modal path suppresses the in-card title/summary while the standalone use keeps them.

## 5. Apply maps every non-403 GitHub error to a generic 502, hiding the safety message
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: error-fidelity
- **File**: src/app/api/org/playbooks/[id]/apply/route.ts:100
- **Scenario**: `openDraftPr` throws `AppApiError(409, …, '"<path>" already exists on <base> — refusing to overwrite…')` (write.ts:82-88) or `AppApiError(422, …)` for a bad base. The handler computes `status = err.status === 403 || 404 ? … : 502` and returns the fixed hint `"GitHub rejected the write. Check the repo and base branch."` — discarding `err.message`.
- **Root cause**: The mapper only special-cases 403; all other statuses collapse to a generic 502, turning a client-fixable conflict into an apparent server error.
- **Impact**: The actionable "won't overwrite your real file" refusal never reaches the user (low reachability here since the path carries the DB id, but the class is real and shared with the higher-collision practices apply).
- **Fix sketch**: Pass `err.message` through for `AppApiError` and keep the client status (409/422) instead of forcing 502.

## 6. DELETE /repos skips the normalization + tenant check that POST enforces
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: validation-asymmetry
- **File**: src/app/api/org/playbooks/[id]/repos/route.ts:43
- **Scenario**: POST normalizes via `parseRepoUrl` and requires `owner === org` (lines 25-30), storing `owner/name`. DELETE passes `body.repo.trim()` straight to `unapplyPlaybook` (playbooks.ts:164 `deleteMany`). A miscased/unnormalized `repo` matches no row, so the adoption survives while the route still returns `{ ok: true }`.
- **Root cause**: The two halves of the same resource don't share a canonicalization/validation path.
- **Impact**: Silent no-op un-mark reported as success (playbookId scoping keeps it non-cross-tenant, so impact is a stuck adoption row, not a security issue).
- **Fix sketch**: Run the same `parseRepoUrl`→`owner/name` normalization in DELETE, and return 404 when `deleteMany` count is 0.

## 7. Long playbook title lacks `truncate`
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: truncation
- **File**: src/components/org/PlaybookCard.tsx:149
- **Scenario**: The title container has `min-w-0` but the title `<span>` (line 150) has no `truncate` (no `overflow-hidden`/`whitespace-nowrap`). A long title wraps and pushes the `D_ · label` dim badge and `v2` chip onto the next line instead of eliding.
- **Root cause**: `min-w-0` is present without its `truncate` partner, so the shrink hint has nothing to apply to.
- **Impact**: Untidy header wrapping for verbose org standards; the dim badge detaches from the title.
- **Fix sketch**: Wrap the title in a `min-w-0 flex-1` block and add `truncate` (with a `title={p.title}` tooltip) so it ellipsizes.

## 8. PlaybooksPanel is orphaned dead code
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: dead-code
- **File**: src/components/org/PlaybooksPanel.tsx:18
- **Scenario**: The practices page now renders `PracticesView` (ledger) → `PracticeDetailModal` + `NewPracticeModal`; `PlaybookCard` is reused there, but nothing imports `PlaybooksPanel` (repo-wide search finds only its definition + two stale comments).
- **Root cause**: The panel was superseded by the ledger redesign but left in the tree, keeping a second, divergent copy of create/remove/template logic (its `remove()` optimistic-restore differs from `PracticesView.removeAuthored`).
- **Impact**: Maintenance hazard — fixes to the live remove/create flow silently skip this file; future readers can't tell which is authoritative.
- **Fix sketch**: Delete `PlaybooksPanel.tsx` (and update the stale "PlaybooksPanel can build it inline" comments in playbook-brief.ts / playbook-templates.ts), or re-mount it if it was meant to survive.
