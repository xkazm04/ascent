# Playbooks — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)
> Lens split: bug-hunter 3 / ui-perfectionist 2
> Files read: 9

## 1. Optimistic apply/unapply swallow API failures → UI shows adoption the server never recorded
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent failure / state desync
- **File**: src/components/org/PlaybookCard.tsx:56 (and unapply :93)
- **Scenario**: A member without write access (or any network/5xx blip) clicks "Mark applied". `apply()` does the optimistic `setApplied((a) => [...a, repo])` and then `await fetch(...)` with **no `res.ok` check and no `.catch`**. The POST returns 403 ("You don't have access…") / 404 / network error, the promise resolves (or rejects unhandled), and the chip stays rendered as adopted. `unapply()` (:93–100) has the identical pattern for DELETE.
- **Root cause**: The fetch result is never inspected; there is no rollback of the optimistic state and no error surface (unlike `openPr()`, which does check `res.ok` and renders `prError`).
- **Impact**: The card permanently shows a repo as adopted/unadopted out of sync with the DB. Downstream this is not cosmetic: "Track as initiative" (:37) and the adoption/lift analytics are seeded from `applied`, so a phantom adoption creates a real Initiative scoped to a repo that never adopted the playbook, and skews the "Adopted by N repos" count on next render the server disagrees with.
- **Fix sketch**: Mirror `openPr()`: check `res.ok`, surface an error line, and roll back the optimistic `setApplied` on failure (and on `unapply`, re-add the repo). Disable the controls while the request is in flight.

## 2. POST /repos marks adoption for ANY repo string — no org/ownership validation (orphan adoption rows)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: repo-assignment integrity / IDOR-adjacent
- **File**: src/app/api/org/playbooks/[id]/repos/route.ts:23 → src/lib/db/playbooks.ts:142 (applyPlaybook)
- **Scenario**: An authorized member POSTs `{ repo: "some-other-org/secret-repo" }` (or a typo, or a deleted repo). The route only checks `body.repo?.trim()` then calls `applyPlaybook(org, id, repo)`. `applyPlaybook` validates the *playbook/org* exist but **never checks the repo belongs to the org** — it upserts a `playbookApplication` row keyed on `playbookId_repoFullName` for the arbitrary string. Contrast the `/apply` (PR) route (apply/route.ts:49) which *does* enforce `parsed.owner.toLowerCase() === org.toLowerCase()`.
- **Root cause**: The cheap "mark applied" path has weaker integrity than the PR path; no `repository` lookup constrains the `repoFullName`.
- **Impact**: Orphan/cross-org adoption rows accumulate; `getPlaybookAdoption` (playbooks.ts:196–243) counts them in `repos`/`appliedRepos` and joins them against `repository`, inflating the "Adopted by N" figure with repos that don't exist in the org (lift just stays unmeasured for them). Adoption analytics become untrustworthy.
- **Fix sketch**: In the `/repos` POST, validate `repo` is one of the org's repositories (e.g. `repository.findFirst({ where: { orgId, fullName } })`, same as `getPlaybookAdoption` already does for the join) before recording, returning 400/404 otherwise. Apply the same enforcement of `owner === org` used in the PR route.

## 3. createPlaybook upserts a phantom Organization for any slug under open/public auth
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: data integrity / authz edge
- **File**: src/lib/db/playbooks.ts:74 (organization.upsert) ← src/app/api/org/playbooks/route.ts:37
- **Scenario**: On an auth-off deployment (local/demo, `ASCENT_OPEN_ORG_DASHBOARDS`-style funnel) or for `PUBLIC_ORG`, `requireOrgAccess(body.org)` returns `null` (open by design). POST then calls `createPlaybook(body.org, …)`, which does `organization.upsert({ create: { slug, name: slug } })` — **creating a brand-new org row** from an attacker/typo-chosen `org` slug, then attaching a playbook to it. There is no check that the org already exists before the write path goes open.
- **Root cause**: `createPlaybook` is "create org on demand" convenience, but the create-org side effect runs even on the open/public funnel where any caller passes the gate. The list path correctly returns `[]` for an unknown org (playbooks.ts:52); only the write path conjures one.
- **Impact**: The `organization` table can be polluted with arbitrary phantom orgs (each with a playbook), which then surface anywhere orgs are enumerated and permanently skew org counts. Cleanup is manual.
- **Fix sketch**: For the playbook write path, resolve the org with `findUnique` and 404 if absent (let real org provisioning happen via the install/connect flow), or restrict the upsert to PUBLIC_ORG only.

## 4. Repo picker (and "Open draft PR") silently disappears when every repo is applied or repoOptions is empty
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: empty/edge state / assignment UX
- **File**: src/components/org/PlaybookCard.tsx:180 (`available.length > 0 && …`)
- **Scenario**: When `repoOptions` is empty (org has no scanned repos yet) or every repo is already applied, `available` is `[]`, so the entire `<select> + Mark applied + Open draft PR` block is hidden with no replacement text. The user sees a card with no way to act and no explanation. The "Open draft PR" affordance — the headline action — also vanishes the moment all repos are marked, even though re-opening a PR for an already-marked repo is valid.
- **Root cause**: The picker and the PR button are gated together on `available.length`, conflating "nothing left to *newly* mark" with "no actions available".
- **Impact**: On a fresh org (the common first-run state) the playbook card looks inert; experienced users can't reopen a PR for an already-adopted repo. Reads as broken.
- **Fix sketch**: When `repoOptions.length === 0`, render a hint ("Scan a repository to roll this out"). Keep the repo picker/PR button available even when `available` is empty by sourcing the picker from `repoOptions` (the per-action guards already prevent duplicate marks), or show an explicit "all repos adopted" state.

## 5. Destructive remove is a tiny low-contrast link with no confirm, no aria-label, and no failure handling
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: a11y / destructive-action UX / consistency
- **File**: src/components/org/PlaybookCard.tsx:118 (`remove` button) + src/components/org/PlaybooksPanel.tsx:68 (`remove()`)
- **Scenario**: The "remove" control is `font-mono text-sm text-slate-600` (well below WCAG contrast on the dark card) with no `aria-label` distinguishing *which* playbook it deletes, no confirmation, and no undo. `PlaybooksPanel.remove()` optimistically drops the row then `await fetch(... DELETE)` **without checking `res.ok`** (same silent-failure class as #1) — a 403 (DELETE requires admin per route.ts:61) removes the playbook from the UI while the server keeps it, so it reappears on the next refresh with no explanation. The per-repo `×` unmark buttons (:174) share the same low-contrast/`title`-only pattern.
- **Root cause**: Destructive affordances styled as muted secondary text; client deletes optimistically and ignores the (admin-gated) response.
- **Impact**: Easy accidental deletion of an org standard; screen-reader users hear a bare "remove"; non-admins get a confusing flicker (row vanishes then returns). Fails a11y and destructive-action conventions.
- **Fix sketch**: Add a confirm step (or an undo toast), give each control a descriptive `aria-label` (e.g. `Remove playbook "${p.title}"`), raise contrast to at least `text-slate-400`/hover, and check `res.ok` in `remove()` — restore the row and show an error when the DELETE is rejected.
