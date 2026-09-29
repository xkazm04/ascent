# Proposals for the registry's `kit` skill (not applied)

Written 2026-09-29 from the two route exercises. The registry checkout (`../ai-registry/skills/kit`) is a shared
linked directory and is not edited from this repo; these are proposals for whoever owns it. Evidence is in
`kit-exercise-overview.md` and `kit-exercise-live.md`.

1. **`coverage.mjs open-batch --attach` (or `--reopen`).** `open-batch` throws `already in-batch (<batch>)` for a
   module that sits in an open batch, so a second pass or a kit batch that touches a module from an earlier batch
   cannot be recorded. Workaround used and documented: `mark --status pending`, then `open-batch`. Proposal: allow
   `--attach` to add the module to a second batch without changing its status, keeping the first batch id in a history
   list.
2. **`add-kit-part` on a shipped part.** A part registered without `--batch` stays `KIT-GAP ... run /kit grow first` in
   `status` after it shipped (Masthead did). Proposal: `status` should read "built" from a later `--batch` call, and
   the KIT-GAP line should name the exact command that clears it.
3. **A baseline instrument.** Setup step S0.4 describes a before/after shooter but the method has no procedure for a
   baseline in a SHARED tree whose dev server serves the working tree. Proposal: `scripts/baseline.sh <route>` that
   renders `HEAD` from a scratch `git worktree` on its own port, and a rule "baseline before the first edit,
   diff against it, never against a previous batch".
4. **A roles instrument.** `style-contract.py` (contest skill) diffs a winner file against a port; a promoted kit has no
   winner file, only a spec table. Ascent built `scripts/kit/roles-check.mjs` (roles file -> selectors on `data-role`
   hooks -> expected computed values, `accept` list for owner-accepted departures, exit 1 on drift) and
   `scripts/kit/pairdiff.py`. Proposal: promote both into `skills/kit/scripts/` and name them in `batch.md` step 5 and
   `setup.md` S4/S6.
5. **`roles-check --hash`.** Level 2 of a nested surface lives behind a hash; the instrument cannot probe it yet.
6. **Source-scan tests.** Add to `batch.md` "Build": before splitting an entry file, grep tests for `readFileSync` of it.
7. **Parallel-session hygiene.** Add to the batch track: `git status --short <shared instrument dirs>` before creating a
   file there (one exercise overwrote another's script), and `git add <exact files>` before a pathspec commit.
8. **Shell pitfall.** A Bash heredoc containing an apostrophe fails with "unexpected EOF" and runs nothing; builder
   briefs should say to write source with the file tool.

Repo-side proposal (AGENTS.md is edited only by its owner): the import-rule wording is in
`KIT-REDESIGN-PROCESS.md`, section "The AGENTS.md import-rule conflict".
