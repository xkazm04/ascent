> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

# Playbooks — combined bug+ui scan

## 1. `remove` swallows a failed (non-admin) DELETE — playbook vanishes from the UI but survives in the DB
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / authz-UX mismatch
- **File**: src/components/org/PlaybooksPanel.tsx:68
- **Scenario**: A non-admin member clicks "remove" on a playbook. The card optimistically drops it from local state, then fires `DELETE /api/org/playbooks/:id`. That route gates DELETE at `admin` (`gate(id, "admin")` in `[id]/route.ts:61`), so a member gets a 403. `remove()` never inspects `res.ok`, so the failure is invisible: the playbook disappears from the list and only reappears on a hard refresh.
- **Root cause**: `remove()` does `setPlaybooks(filter)` then `await fetch(... DELETE)` with no `res.ok` check and no rollback — the optimistic delete is treated as always-succeeding, but the route enforces a stricter role than the panel exposes (the "remove" button is rendered for every member in PlaybookCard.tsx:131, with no role gating).
- **Impact**: Confusing data-loss illusion / authz UX mismatch — a member believes they deleted an org standard that is still live. Also masks any genuine 500.
- **Fix sketch**: Capture the response; on `!res.ok` re-insert the removed playbook (restore prior state) and surface an error ("Only admins can delete a playbook."). Better: hide/disable the remove button unless the viewer has the admin role (pass a role/canDelete prop down).

## 2. Playbook→repo adoption mark accepts an arbitrary, unvalidated `repoFullName`
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: data-integrity / input-validation
- **File**: src/app/api/org/playbooks/[id]/repos/route.ts:30
- **Scenario**: A member POSTs `{ repo: "anything/at-all" }` (or `"other-org/private-repo"`) to `/api/org/playbooks/:id/repos`. `applyPlaybook(gated.org, id, body.repo.trim(), …)` validates only that the org owns the playbook (db/playbooks.ts:152) — it never checks the repo belongs to the org. A `playbookApplication` row is written verbatim.
- **Root cause**: Unlike the PR `apply` route, which enforces `parsed.owner === org` (apply/route.ts:49), the lightweight "mark applied" path trusts the client repo string. The adoption rollup (`getPlaybookAdoption`) joins applications to `repository` by `fullName` scoped to `orgId`, so a foreign/garbage repo silently won't compute lift — but it still inflates the "Adopted by N repos" count and is propagated into Initiatives.
- **Impact**: Skewed adoption analytics (phantom adopters), and arbitrary attacker/typo-controlled repo strings flow into `trackAsInitiative` payloads (PlaybookCard.tsx:44) → polluted Initiative scope. Cross-tenant repo names can be recorded against an org's playbook.
- **Fix sketch**: Validate `repo` against the org's known repositories before upsert (reuse the same `owner === org` check, or look up `repository` by `orgId + fullName` and 400/404 if absent), mirroring the PR-apply route's tenant check.

## 3. "Mark applied" / "Track as initiative" have no in-flight guard and surface no error on failure
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race / silent-failure
- **File**: src/components/org/PlaybookCard.tsx:56
- **Scenario**: `apply()` ("Mark applied") has no busy flag — only `applied.includes(repo)` guards re-entry, but the optimistic `setApplied` makes that membership-check pass on the very next render, so two fast clicks before state flushes can both fire the POST. On failure it rolls back silently with no message (unlike `openPr`, which has `prBusy` + `prError`). `trackAsInitiative` similarly swallows a non-ok response (`if (res.ok) setTracked(true)` — a 403/500 leaves the button enabled with no feedback).
- **Root cause**: The two lightweight actions were written without the busy/error scaffolding the PR action got; failures are caught and discarded.
- **Impact**: A member sees no indication when "Mark applied" or "Track as initiative" fails (e.g. 403 under stricter auth, or 503 no-DB) — the action just silently does nothing. Minor duplicate-request risk (idempotent upsert mitigates the DB side).
- **Fix sketch**: Add a per-action busy flag and an inline error message (reuse the `prError` pattern) for both `apply()` and `trackAsInitiative()`.

## 4. Stale adoption/lift after marking a repo — local count diverges from server analytics with no refresh
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: stale-state / consistency
- **File**: src/components/org/PlaybookCard.tsx:28
- **Scenario**: `applied` is seeded once from `adoption?.appliedRepos` and only ever mutated locally. After "Mark applied"/"Open PR"/"unapply", the count chip updates but the server-computed `lift` (`adoption?.lift`) and the parent `adoption` map are never re-fetched. If two users edit the same playbook, or the server idempotently coalesces an apply, the card's count can disagree with what the analytics actually stored, with no reconciliation until a full page reload.
- **Root cause**: Adoption state is split between an immutable server snapshot (`lift`, parent map) and a local optimistic array, with no revalidation hook after mutations.
- **Impact**: Confusing "Adopted by N / ▲ +x avg" combinations (count moves, lift frozen); count can drift from the canonical DB value. Cosmetic but erodes trust in the analytics surface.
- **Fix sketch**: After a successful apply/unapply, optionally refetch adoption (or `router.refresh()`), or at minimum render a "lift updates after the next scan" hint so the frozen lift next to a changing count reads as intentional.

## 5. `create()` assumes a JSON error body — a 503/non-JSON response throws and shows a generic failure
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: error-handling
- **File**: src/components/org/PlaybooksPanel.tsx:56
- **Scenario**: `create()` does `throw new Error((await res.json()).error ?? "Failed.")`. The POST route can return 503 ("Playbooks require a database.") which is JSON, fine — but any non-JSON failure (proxy 502/HTML error page, network mid-stream) makes `res.json()` reject, the original status/message is lost, and the catch shows the generic "Failed." with no diagnostic. The same `await res.json()` on a body-less error path discards the real cause.
- **Root cause**: Unconditional `res.json()` on the error branch assumes the server always returns a JSON `{ error }`.
- **Impact**: Operator/user can't distinguish "DB not configured" (503), "not signed in" (401), and a transient gateway error — all collapse to "Failed."
- **Fix sketch**: Guard with a `.catch(() => ({}))` around `res.json()` (as the API routes already do for request parsing) and fall back to `res.status`-based messaging.

## 6. Template `<select>` and adoption controls lack accessible labels / `aria-live` feedback
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: src/components/org/PlaybookCard.tsx:195
- **Scenario**: The "Pick a repo…" `<select>` (PlaybookCard.tsx:195) and the title/summary inputs in PlaybooksPanel have placeholder-only labeling (no `aria-label`/`<label htmlFor>`), so a screen reader announces an unlabeled combobox/textbox. The optimistic adoption-chip changes and the `prError`/`prResult` status lines are not in an `aria-live` region, so non-visual users get no announcement when a repo is marked, a PR opens, or an error appears.
- **Root cause**: Controls rely on visual placeholders and inline status text without programmatic labels or live regions.
- **Impact**: Reduced accessibility for keyboard/SR users managing playbooks; status changes are silent for them.
- **Fix sketch**: Add `aria-label` to the repo `<select>` and form inputs (or visible `<label>`s), and wrap the `prError`/`prResult`/adoption-status block in `role="status"` / `aria-live="polite"`.
