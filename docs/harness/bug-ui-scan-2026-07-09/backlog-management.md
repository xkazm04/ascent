# Backlog Management — bug-hunter + ui-perfectionist scan

> Context: Backlog Management (group: Org Planning & Execution)
> Files scanned: 6
> Total: 7 findings (Critical: 0, High: 1, Medium: 2, Low: 4)

## 1. Timeline/audit actor resolved from the DORMANT auth stack — every change logs "system"
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: actor-attribution
- **File**: src/app/api/recommendations/[id]/route.ts:53
- **Scenario**: A member on the live Supabase-gated deployment changes a backlog item's status/owner/due date. The PATCH gate (`requireOrgAccess`) correctly uses the ACTIVE `authGateEnabled()`/`getViewer()` path, but the actor is captured separately: `const session = isAuthConfigured() ? await getSession() : null;` then `updateRecommendation(id, patch, { actor: session?.login ?? null })` (:107). `isAuthConfigured()` checks the dormant custom-OAuth env (`GITHUB_OAUTH_CLIENT_ID`/`AUTH_SECRET`), which is unset under the Supabase wall → `session` is null → `actor` is null.
- **Root cause**: The route assumes identity lives in the custom-OAuth `getSession()`, but on the enforced deployment identity lives in the Supabase viewer. Two auth systems, actor read from the off one.
- **Impact**: Every RecommendationEvent and every `recommendation.updated` audit row is written with `actor: null`. The history panel renders "system" (BacklogItemRow.history.tsx:21) for all edits and the compliance audit log loses "who changed it" — the entire point of the timeline.
- **Fix sketch**: Use the codebase's cross-stack resolver: `import { resolveViewerLogin } from "@/lib/access"` and `const actor = await resolveViewerLogin();` (it already prefers session, then Supabase/dev viewer). Pass that as `actor`.

## 2. Successful save can appear to revert — refresh failure is swallowed while the optimistic override is cleared
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/components/org/BacklogPanel.tsx:48
- **Scenario**: A user changes a status. `patchField` sets an optimistic override (BacklogItemRow.tsx:66), the PATCH succeeds, then `refresh()` runs. If that GET refresh fails transiently (503/500/network blip, or a session that lapsed only by the second request), `refresh` does `if (!res.ok) return;` — silently, setting no error. Back in `patchField`'s `finally` (BacklogItemRow.tsx:72-78) the override is cleared unconditionally, so the control now reads the STALE `item.status` (backlog was never updated) and snaps back to the old value with no error shown.
- **Root cause**: Assumes "PATCH ok ⇒ refresh ok". The optimistic override's lifetime is tied to the PATCH promise, not to the refresh actually landing.
- **Impact**: The change persisted server-side, but the UI shows the pre-edit value and no error. User believes the edit failed and re-does it (or gives up). Perceived data loss.
- **Fix sketch**: Have `refresh()` surface a failure (return a boolean / throw) and, on a failed refresh after a successful PATCH, either keep the optimistic value or set an errors[id] "Saved, but the view is out of date — reload." Don't clear the override until a refresh confirms.

## 3. Keyboard focus is dropped after an owner/status edit because the row remounts
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: keyboard-accessibility
- **File**: src/components/org/BacklogItemRow.tsx:224
- **Scenario**: A keyboard user tabs to the Owner `<select>`, picks a new owner, and hits enter. The edit re-groups the row into a different owner `<Card>`; because the row is keyed by item id under a *different* parent (BacklogPanel.tsx:157-173), React unmounts+remounts it (the file's own header comment at :10-15 documents this remount). Lifted state survives, but DOM focus does not — focus falls back to `<body>`.
- **Root cause**: The design lifts *state* across the remount but nothing restores *focus*, assuming edits don't move the focused element. Owner and status→done/dismissed edits both move or remove the row.
- **Impact**: Keyboard and screen-reader users lose their place on every owner change and must re-traverse the list. Fails a core keyboard-operability expectation for the row actions.
- **Fix sketch**: After a regroup, restore focus — e.g. an effect keyed on a "last edited id" that refocuses the matching control on mount, or avoid remounting by rendering a single flat list and moving items with layout animation rather than re-parenting into per-group Cards.

## 4. Long unbroken title can overflow the card — `min-w-0` present but no `truncate`/`break-words`
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: long-title-truncation
- **File**: src/components/org/BacklogItemRow.tsx:174
- **Scenario**: The title wrapper has `min-w-0` (:173) but the title node `<div className="font-medium text-white">{item.title}</div>` has neither `truncate` nor `break-words`. A recommendation title with a long unbroken token (a pasted path/URL, a very long identifier) won't wrap and, with `min-w-0` letting the flex child shrink below content, overflows horizontally — pushing the due-date chip (:193) or spilling past the card edge.
- **Root cause**: `min-w-0` was added (implying truncation was intended) but the matching clamp on the text was never applied. Assumes every title has whitespace to wrap on.
- **Impact**: Broken row layout / horizontal spill for adversarial or machine-generated titles. Cosmetic in the common (sentence) case.
- **Fix sketch**: Add `truncate` (with a `title={item.title}` for the full text) or `break-words`/`overflow-wrap:anywhere` on the title div so it clamps within `min-w-0`.

## 5. Optimistic due-date edit isn't mirrored in the due chip or the overdue accent
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: optimistic-ui-consistency
- **File**: src/components/org/BacklogItemRow.tsx:164
- **Scenario**: Changing the due date updates the date `<input>` immediately (bound to `shown.targetDate`, :241), but three sibling elements read the un-overridden `item`: `const due = dueLabel(item)` (:164), the left-border color `item.overdue` (:170), and the due chip's text+style `item.overdue` (:194). So on a slow save the input shows the new date while the "due in N days" chip and the orange overdue border still show the old date until the refresh lands.
- **Root cause**: The optimistic override was applied to the editable controls but not to the derived read-only affordances (chip, border) that depend on the same field.
- **Impact**: Momentary self-contradiction (new date in the picker, old urgency in the chip/border) — minor confusion during the save window.
- **Fix sketch**: Derive `due`, the border color, and the chip from `shown` (compute a client-side `dueInDays`/`overdue` from `shown.targetDate`) rather than `item`, or hide the chip while `saving`.

## 6. Status-select text color falls below AA contrast on the near-black field
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/org/BacklogItemRow.tsx:209
- **Scenario**: The status `<select>` sets `style={{ color: STATUS_ACCENT[shown.status] }}` over `bg-slate-950`. STATUS_ACCENT (backlogShared.ts:11-16) uses `#64748b` for "open" and `#475569` for "dismissed"; both against `#020617` land at roughly 3:1 or below — under the 4.5:1 WCAG AA threshold for normal text.
- **Root cause**: The accent palette was chosen as a *decorative* status hue but reused as the readable text color of the control's selected value.
- **Impact**: Low-vision users struggle to read the current status in the control (especially "open"/"dismissed").
- **Fix sketch**: Keep the accent as the left-border/dot indicator but render the select's text in a token that meets AA (e.g. `text-slate-200`), or lighten the accent values used for text.

## 7. "Open draft PR" creates a real PR and flips status with no confirmation
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: destructive-action-confirmation
- **File**: src/components/org/BacklogItemRow.tsx:250
- **Scenario**: A single click on "Open draft PR →" (:250) POSTs to `/api/practices/apply` opening a real GitHub draft PR against `item.repo`, and on success auto-PATCHes the item to `in_progress` (:126) — a side effect on an external system plus a state change, from one misclick, with no confirm and no undo affordance.
- **Root cause**: A significant, externally-visible, state-creating action is styled as an ordinary inline row button (like status/owner) with no distinction or guard.
- **Impact**: Accidental draft PRs in a real repo and unexpected status changes; noisy for repo maintainers. Mitigated only by the API reusing an existing draft when present.
- **Fix sketch**: Gate the click behind a lightweight confirm ("Open a draft PR in {repo}?") or a two-step affordance, and surface the auto-status-change in the confirm text.
