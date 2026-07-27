# Playbooks — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

Note: the context map is stale for this area — `src/components/org/PlaybooksPanel.tsx` no longer exists (superseded by `src/components/org/practices/PracticesView.tsx` + `NewPracticeModal.tsx`), and `PlaybookCard.tsx` lives at `src/components/org/practices/PlaybookCard.tsx`. Several code comments still say "mirrors PlaybooksPanel.remove".

## 1. PATCH lets a member blank out a playbook's title (no validation parity with POST)
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/app/api/org/playbooks/[id]/route.ts:35` (and `src/lib/db/playbooks.ts:100`)
- **Scenario**: POST create rejects a missing/blank title (`!body.title?.trim()` → 400), but PATCH forwards `title` with no emptiness check: `updatePlaybook` does `data.title = patch.title.trim().slice(0, 200)`, so `PATCH { title: "  " }` persists `""`. Similarly, `PATCH {}` passes the gate, runs a Prisma update with empty data, bumps nothing but still records a `playbook.updated` audit with `changed: []`.
- **Root cause**: The create-side invariants (non-empty title) were never mirrored on the update path; the route validates only `dimId`.
- **Impact**: A member can corrupt an org standard into a nameless row — the card header renders an empty `<span>`, `Roll out: ` initiative titles, `Adopt playbook: ` PR titles, and a branch slug that degrades to the literal `"playbook"`. Plus audit noise from no-op PATCHes.
- **Fix sketch**: In the PATCH handler, reject `title !== undefined && !title.trim()` with 400 (same message shape as POST); early-return 400 (or 200 no-op without audit) when no recognized field is present in the body.

## 2. Steps/title are bounded by length but not shape — an embedded newline breaks the committed starter artifact
- **Severity**: Medium
- **Category**: edge-case-gap
- **File**: `src/lib/db/playbooks.ts:44` (`cleanSteps`), `src/lib/org/playbook-brief.ts:40`
- **Scenario**: `cleanSteps` trims and caps each step at 300 chars but allows `\n` inside a step; `createPlaybook` likewise keeps inner newlines in `title`. The UI can't produce these (NewPracticeModal splits steps on `\n`), but the API accepts raw JSON `steps: ["a\nb"]`. `playbookStarterFile` then renders `- [ ] a\nb`, breaking the "one unchecked checkbox per step" invariant the test suite pins (`playbook-brief.test.ts:67`), and a newline in `title` breaks the H1, the PR title, and the commit message sent to GitHub.
- **Root cause**: The single (de)serialization chokepoint documents *size* bounds ("≤20 steps, ≤300 chars each") but the implicit *single-line* assumption the markdown renderers rely on is neither enforced nor documented.
- **Impact**: A malformed checklist / broken heading gets committed into a customer repo via the draft-PR apply route — the exact artifact the tests claim is byte-pinned, silently violated for API-authored playbooks.
- **Fix sketch**: In `cleanSteps`, collapse whitespace: `s.trim().replace(/\s*\n\s*/g, " ")`; do the same for `title` (and `summary` only if multi-line summaries are unwanted — the starter-file test at line 101 deliberately allows them, so leave summary alone). Add a test with a `\n`-bearing step.

## 3. The lift badge hides its sample size — "▲ +N avg" may be backed by 1 of many repos
- **Severity**: Medium
- **Category**: trade-off-undocumented
- **File**: `src/components/org/practices/PlaybookCard.tsx:198-208` (data at `src/lib/db/playbooks.ts:170-177`)
- **Scenario**: The server computes an honest `measured` count (how many applications actually had a pre-apply baseline + post-apply scan) alongside `lift`, and the DB layer documents it as the honesty companion. The card renders only `▲ +{lift} avg {dimId} since` — `measured` is fetched, typed, and then never shown anywhere.
- **Root cause**: The UI kept the headline number and dropped the qualifier the backend was specifically designed to carry ("Honest — only counts an application toward lift when…").
- **Impact**: "Adopted by 12 repos · ▲ +9 avg D5 since" can mean one repo out of twelve moved +9 — an org lead reads it as fleet-wide improvement. Also note the count and the lift come from different sources: `applied.length` is optimistic local state while `lift` is the server snapshot, so right after a mark/unmark the two halves of the same line describe different sets.
- **Fix sketch**: Render the sample: `▲ +9 avg D5 (measured in {measured}/{repos} repos)` or fold it into the existing `title` tooltip at minimum; consider muting the badge when `measured < repos / 2`.

## 4. Repo-picker select has no accessible name; the two error surfaces announce inconsistently
- **Severity**: Medium
- **Category**: a11y
- **File**: `src/components/org/practices/PlaybookCard.tsx:239` (also `:268`, `:245-250`)
- **Scenario**: The `<select>` that picks the target repo for "Mark applied"/"Open draft PR" has no `aria-label` — a screen reader announces it only by its current option ("Pick a repo…"). In the same feature, `NewPracticeModal` labels every field (`aria-label="Playbook title"` etc.), so this is an intra-context inconsistency. Additionally `trackError` renders with `role="alert"` (line 223) but `markError`/`prError` (lines 268-269) do not, so mark/PR failures — the errors this card most often produces — are never announced. The card's action buttons also omit the `focus-ring` class its sibling components (NewPracticeModal, PracticesView header) apply to every button.
- **Root cause**: The card predates the modal-era a11y pass; error surfaces were added at different times ("playbooks #3" added markError without copying the alert role).
- **Impact**: Keyboard/AT users can't identify the repo control, don't hear failure feedback (an optimistic chip silently rolls back — the exact bug markError was added to fix, still invisible to AT), and get inconsistent focus visibility.
- **Fix sketch**: `aria-label="Repo to apply this playbook to"` on the select; add `role="alert"` to the markError/prError `<p>`s; add `focus-ring` to the three action buttons.

## 5. Hard DELETE leaves no audit trail, contradicting the recorded PLAY-6 rationale
- **Severity**: Low
- **Category**: trade-off-undocumented
- **File**: `src/app/api/org/playbooks/[id]/route.ts:56-67`
- **Scenario**: PATCH writes a `playbook.updated` org-audit row justified by "a playbook edit leaves a trail (the org's standards have history)", and apply writes `playbook.pr_opened`. DELETE — the one irreversible operation, which also cascades away the adoption/lift history — records nothing; POST create also records nothing (it only stamps `createdBy`, which is null in production per the resolveViewerLogin comments, so creations are effectively anonymous too).
- **Root cause**: The audit hook was added per-finding (PLAY-6 targeted edits) rather than per-lifecycle; no recorded decision says deletes are intentionally untracked.
- **Impact**: An admin can silently erase an org standard plus its adoption analytics with no trace — precisely the "history" the PATCH comment argues the org needs; incident review can't answer "who removed our CI playbook".
- **Fix sketch**: Mirror PATCH: after `deletePlaybook(id)`, `recordOrgAudit("playbook.deleted", gated.org, { playbookId: id, title }, actorLogin ?? undefined)` (fetch the title before deleting so the audit row stays meaningful once the row is gone); optionally add `playbook.created` on POST for symmetry.
