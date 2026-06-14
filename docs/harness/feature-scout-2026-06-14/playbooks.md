# Feature Scout — Playbooks (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 3H / 2M / 0L

## 1. One-click playbook rollout via draft PRs (close the apply gap)
- **Severity**: Critical
- **Category**: functionality
- **File**: src/components/org/PlaybookCard.tsx:31 (`apply()` only marks adoption) vs. src/app/api/practices/apply/route.ts:20
- **Scenario**: An owner authors "Our CI standard" and wants it landed across 12 repos. Today their only "apply" path is the `CopyForLlm` button (PlaybookCard.tsx:62) — copy the markdown from `playbookMarkdown()` (src/lib/org/playbook-brief.ts:5), paste into Claude Code, repeat per repo by hand. The card's "Apply" button (PlaybookCard.tsx:109) does NOT open a PR; it merely POSTs to `/repos` to record an adoption mark (src/app/api/org/playbooks/[id]/repos/route.ts:23).
- **Gap**: The product already has full draft-PR rollout machinery for the *derived* Practice Library — `openDraftPr` + `buildArtifact` behind `/api/practices/apply`, surfaced by `PracticeApply.tsx` ("Preview starter → Open draft PR"). Playbooks, the org's *first-party* standards, get none of it. Grep confirms `openDraftPr`/`buildArtifact` are wired only to `practiceId`, never to a playbook (practice-artifact.ts:102 keys on `PRACTICES`). The richest, most authoritative content in the system can't be rolled out automatically.
- **Impact**: Every org admin who writes a playbook. Turns playbooks from a copy-paste doc into the fleet's actual change-delivery mechanism — the single biggest value multiplier for the feature and the platform's "scan → improve" loop.
- **Fix sketch**: Add `POST /api/org/playbooks/[id]/apply { repo }` that (a) renders `playbookMarkdown()` into a PR body via `openDraftPr` (write.ts) as a checklist/issue-style PR, OR (b) routes the playbook through an LLM-backed artifact generator. MVP = open a draft PR whose body is the playbook brief + steps as a task list, reusing the installation-token + `requireOrgAccess` gate already in practices/apply/route.ts. On success, auto-record the adoption mark so `lift` analytics light up. ~1 day reusing existing GitHub-write plumbing.

## 2. Bulk-apply a playbook to a segment / the whole fleet
- **Severity**: High
- **Category**: feature
- **File**: src/components/org/PlaybookCard.tsx:101 (one `<select>`, one repo at a time)
- **Scenario**: "Roll our security baseline to every mobile repo." The org already has Segments (src/app/api/org/segments/route.ts) — named slices like platform/mobile/legacy — and fleet-level fan-out exists for autoscan (`setWatchedSchedule(org, schedule, segmentId)` in src/app/api/org/schedule/route.ts:44). Playbooks have no equivalent: adoption is marked one repo at a time through a single dropdown.
- **Gap**: No segment-scoped or "apply to all watched" action on playbooks. Grep of PlaybookCard.tsx for `segmentId`/`bulk` returns nothing; `applyPlaybook` (playbooks.ts:115) takes exactly one `repoFullName`. Segments are a first-class concept everywhere else but absent from the playbook surface.
- **Impact**: Org admins managing 20–200 repos. Bulk rollout is the difference between a standard that's aspirational and one that's actually enforced fleet-wide — directly multiplies the value of Finding #1.
- **Fix sketch**: Extend the apply endpoint to accept `{ segmentId }` or `{ all: true }`, resolve the repo set via the existing segments lib, then fan out `applyPlaybook` (and, with #1, draft PRs) per repo. Add a "Apply to segment ▾" control next to the per-repo picker in PlaybookCard.tsx. ~0.5 day on top of #1.

## 3. Promote a mined practice into a reusable playbook
- **Severity**: High
- **Category**: user_benefit
- **File**: src/app/org/[slug]/practices/page.tsx:24 (Playbooks panel sits directly above the derived Practice Library, but they don't talk)
- **Scenario**: Ascent mines a strong practice from the org's best repo (`getOrgPractices`, org-insights.ts:613 — exemplar + reusable shape + starter steps). The admin thinks "that should be our official standard." Today they must manually retype it into the playbook author form (PlaybooksPanel.tsx:93).
- **Gap**: No "Save as playbook" / "Promote to standard" action bridging the *derived* Practice Library to the *authored* Playbooks. The two systems are explicitly described as distinct (playbooks.ts:1–4) but there's zero hand-off. Grep shows no code path that constructs a `PlaybookInput` from an `OrgPractice`.
- **Impact**: Anyone curating standards. Eliminates the blank-page problem for authoring and grounds playbooks in the org's own proven exemplars — the highest-quality seed content available, generated for free by the scanner.
- **Fix sketch**: Add a "Promote to playbook" button on each Practice Library card (practices/page.tsx) that pre-fills `createPlaybook` with `{ title: p.label, dimId: p.dimId, summary: p.what, steps: p.starter }`. Pure mapping; no new storage. ~0.5 day.

## 4. Starter playbook templates / library
- **Severity**: Medium
- **Category**: feature
- **File**: src/components/org/PlaybooksPanel.tsx:80 ("No playbooks yet — define your first standard below.")
- **Scenario**: A new org opens the Playbooks panel and faces an empty form with no idea what a good playbook looks like for D5 (CI/CD) or D3 (security). They abandon the feature.
- **Gap**: No seeded templates, no curated catalog, no examples. `createPlaybook` (playbooks.ts:61) only accepts free-text; grep for `template|preset|catalog` in playbooks.ts finds none. The empty-state is a dead end — the classic cold-start problem for an authoring feature.
- **Impact**: Every new org / first-time admin. Templates convert the empty Playbooks panel from intimidating to one-click-useful, driving feature adoption (and, downstream, the rollout value of #1).
- **Fix sketch**: Ship a small static `PLAYBOOK_TEMPLATES: PlaybookInput[]` (one or two per dimension) in a new `src/lib/org/playbook-templates.ts`, render them as "Start from a template" chips in PlaybooksPanel's empty state that pre-fill the author form. No schema change. ~0.5 day.

## 5. Playbook ↔ initiative bridge (track rollout as a program of work)
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/app/api/org/initiatives/route.ts:26 (initiative accepts `practiceId` but never `playbookId`)
- **Scenario**: An admin commits to rolling a playbook across the org over a quarter and wants the standard initiative tracking — status (open→in_progress→done, initiatives/[id]/route.ts:13), target score, scoped repo set — instead of the lightweight adoption count on the card.
- **Gap**: Initiatives ("tracked, scoped programs of work") link to a `practiceId` but there is no `playbookId` linkage. Grep confirms `createInitiative` has no playbook field. A playbook rollout is exactly an initiative, yet the two are siloed; the playbook only exposes a raw adoption count + dim lift (PlaybookCard.tsx:78–88) with no targets, owner, or status.
- **Impact**: Engineering leaders/PMs steering maturity. Lets a playbook become a first-class, status-tracked program with a target and deadline — connects the "what" (playbook) to the org's existing goal/initiative governance layer.
- **Fix sketch**: Add optional `playbookId` to the initiative model/`createInitiative`, plus a "Track as initiative" button on PlaybookCard that pre-fills `{ title, dimId, repos: appliedRepos }`. Surface back-links both ways. ~1 day incl. a migration column.

## 6. Versioning & change history for playbooks
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/db/playbooks.ts:87 (`updatePlaybook` overwrites in place)
- **Scenario**: A playbook applied to 30 repos gets edited. Which repos adopted the old version vs. the new one? When did the CI standard change and why? There's no answer.
- **Gap**: `updatePlaybook` mutates the row destructively; `PlaybookApplication` (playbooks.ts:127) records *that* a repo applied a playbook but not *which version*. No revision table, no `updatedAt`/`version` field, no audit entry on edit (unlike practices/apply which calls `recordAudit`). Adoption `lift` (playbooks.ts:155) silently attributes score changes to a playbook whose content may have changed underneath it.
- **Impact**: Compliance-minded orgs and anyone auditing how a standard evolved. Versioning makes adoption analytics trustworthy and gives an audit trail for governance/SOC-style reviews.
- **Fix sketch**: Add `version` + `updatedAt` to the Playbook model, stamp `version` onto `PlaybookApplication` at apply time, and call `recordAudit("playbook.updated", …)` in the PATCH route. Optional revision-history table for full diffs. ~1 day incl. migration.
