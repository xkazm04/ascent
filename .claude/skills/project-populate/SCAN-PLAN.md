# ascent — context sweep plan

Precomputed 2026-07-30 from `git ls-files` (1,489 source files). Re-derive if
the tree has moved substantially since.

- **Personas project id:** `32c9b23b`
- **Repo root:** `C:\Users\kazda\kiro\ascent`
- **Bridge:** first free port at or above 17400 — probe, do not assume.

## Why this file exists

A whole-tree scan under-maps a repo this size and reports success anyway. On the
personas repo one whole-tree pass mapped 9% of files; sweeping subtree-by-subtree
reached ~89%. Everything below is the partition for that sweep. Full mechanics in
[`references/bridge.md`](references/bridge.md).

## Scopes

Five scans covering 1,257 of 1,489 files (84%). Run 3-4 concurrently; the
single-flight guard is per-scope so they do not block each other.

| Files | `subtree` |
|------:|---|
| 434 | `src/lib` |
| 394 | `src/components/org` |
| 281 | `src/app` |
| 98 | `src/components/report` |
| 50 | `src/components/onboarding` |

## The 232-file tail

This is the largest tail of the three projects, and most of it is real UI code
rather than config — worth covering. **Do not scan `src/components` or `.` to
sweep it up**: `src/components` is a prefix of the three scopes above, and a
scoped scan retires the contexts already inside its scope, so that pass would
delete the `org` / `report` / `onboarding` maps and replace them with something
coarser.

Scan these individually instead:

`src/components/ui` (25), `src/components/about` (24), `src/components/launch`
(23), `src/components/landing` (21), `scripts` (25), `src/components/connect`
(16), `uat` (16), `src/components/about-org` (14), `e2e` (10).

Below that: `deck` (6), `auth`/`badge`/`leaderboard`/`pricing`/`scan` (3 each),
`usage` (2), `credit`/`github` (1 each), plus 24 loose files directly in
`src/components` and 9 more at the root — reasonable to leave unmapped, but say
so in the final report rather than letting the coverage number imply otherwise.

## After the sweep

Run the idempotent repair routes once, then consolidate group sprawl with
explicit merge pairs. Verify by counting DISTINCT paths across all contexts
against the 1,489 above — not by trusting the per-scan numbers.

## Note on `context-map.json`

This repo has one committed at the root. Check whose it is before believing it:
if it carries a `$schema` of `vibeman.dev`, it is a different tool's artifact and
its counts will disagree with the Personas database. **The database is the
authority** for anything the app does. The same trap cost a personas session a
5x sizing error.
