# Feature Scout Fix — Mediums Wave D · Playbooks & practices authoring (complete: 3/3)

> Make org-authored standards easier to write, versioned, and previewable. 1 additive migration.
> Baseline preserved: `tsc` 0; **vitest 456/456**; eslint 0; `next build` ✓ (EXIT 0).

## Commits

| Finding | Commit | What shipped |
|---|---|---|
| PLAY #4 — starter templates | `350ba7e` | `PLAYBOOK_TEMPLATES` (new module, seeded from the leak-free `PRACTICES` starters — one per dimension) feeds a "Start from a template" picker in `PlaybooksPanel` that prefills the author form. No migration. |
| PLAY #6 — versioning & history | `80d1439` | Migration: `Playbook.version` (+`updatedAt`) bumped on each content edit; `PlaybookApplication.appliedVersion` records which version a repo adopted. PATCH route writes a `playbook.updated` audit entry; card shows a `v{N}` badge. |
| PRAC #5 — org-authored practice + preview | `731c0fc` | The starter-file builder is single-sourced as `playbookStarterFile()` (used by the apply route + a new "Preview starter file" collapsible on `PlaybookCard`), closing the last practice-parity gap. |

## What was fixed

- **PLAY #4 — no blank author form.** Writing a company standard started from nothing; a template
  picker (derived from the same rubric starters the Practice Library uses) prefills a sensible draft to
  edit. Templates can't drift from the rubric because they're computed from `PRACTICES`.
- **PLAY #6 — change history.** Playbook edits were invisible. Each content edit bumps a `version`,
  stamps `updatedAt`, and writes a `playbook.updated` audit entry; an adoption records the version it
  was applied at (so a repo on an older version is detectable). The card surfaces the version.
- **PRAC #5 — custom practices with a starter, preview included.** The "practice catalog is fixed code"
  gap was already closed by the playbook apply flow (PLAY-1 commits `docs/playbooks/<slug>.md` + opens a
  draft PR). This finishes parity with `PracticeApply`: the starter file is single-sourced and an author
  can preview the exact artifact before shipping it.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | 456/456 (54 files) |
| `init-sql.test.ts` parity | 28/28 (version/updatedAt + appliedVersion added to existing tables, no new table) |
| eslint (changed) | 0 errors |
| `next build` | ✓ EXIT 0 |

## Patterns reinforced

- **Templates derived from the canonical source** (PLAY #4): seeding from `PRACTICES` means the
  start-from-a-template content can't drift from the rubric — no parallel hand-maintained list.
- **Version-bump in the data fn, not the route** (PLAY #6): `updatePlaybook` decides what counts as a
  content edit and increments there, so every caller versions consistently; the route only audits.
- **Single-source a rendered artifact** (PRAC #5): the apply route and the preview both call
  `playbookStarterFile()`, so what you preview is exactly what gets committed.
- **Don't re-build what shipped** (PRAC #5): PLAY-1 already delivered the org-authored-practice-with-
  starter capability; the remaining gap was preview parity, not a re-implementation.

## What remains (from the INDEX)

Medium waves F (exec/sharing/exports), G (CI-gate/metering hygiene), H (live-ops polish) + the 4 lows.
Stripe (CRED-1/CRED-3) + notifications/email stay excluded.
