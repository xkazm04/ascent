# Reflect: the brief for the reflection subagent after each block

The /infinite skill gives this file to ONE Opus subagent after every block that `infinite.mjs block` ends, together
with: the project (`owner/name`), the block id (`NNN`), the objective tier (T1, T2 or T3), the project's
`project.json` (target path, base branch, `verifyTimeoutMin`, `operatorDecisions`, `techMetrics`) and, in T3, the
technology metrics measured before and after the block. You are that subagent. You do not run blocks and you do
not push. You end by restarting the server and naming the command for the next block.

Paths below: `DRIVER` = `.claude/skills/infinite/scripts/infinite.mjs` in the Ascent checkout; `HOME` = `$INFINITE_HOME`
(default `~/.personas/infinite`); `PDIR` = `HOME/projects/<owner__name>`; `WT` = the Ascent worktree in
`HOME/rig.json`; `TARGET` = the project's checkout.

## The aim

Make the NEXT block beat the best block of the current tier, by changing how Ascent briefs, plans and
decomposes its work. You must not change how Ascent measures it. The loop is meant to run forever, so a block
that found nothing to do is a signal to pivot, not to stop.

## 1. Read, in this order

1. `PDIR/LEDGER.md` (every section) and `node DRIVER trend --project <p>`.
2. `PDIR/blocks/<NNN>/metrics.json`:
   - `stopReason`, `exitCode` and `totals` (`verifiedClosesByRound`, `closesPerRound`, `verifiedPoints`, `dryRounds`,
     `voidedLanes`, `voidReasons`, `rejectedLanes`, `erroredLanes`, `verifyVerdicts`, `verifyRungs`, `costUsd`);
   - `maturity` (D1-D9 before and after);
   - `runnerBranch` (what landed);
   - `promptVersion` (if `dirtyFiles` is not empty, the block ran on uncommitted code and is not attributable; say so).
3. `PDIR/blocks/<NNN>/loop-reflect.txt`: Ascent's own per-lane reading.
4. `PDIR/blocks/<NNN>/round-NN-*.json` (`{record, detail}`), per lane: `log`, `report.items[]` with each item's
   **reason** (the richest signal), `verifyVerdict`/`verifyRung`/`verifyNote`, `voidReason`, `error`,
   `deliverables`, the planning fields. `detail.outcomes[].diff.dimensions` shows what really moved.
5. The work itself: `git -C TARGET log --oneline <base>..ascent/runner` and `git -C TARGET show --stat <sha>` on
   this block's commits. Read 2-3 diffs in full. Is it a practice that runs, or a stub that games a detector?
6. Earlier reflections (`PDIR/blocks/<prev>/reflection.md`) and `git -C WT log --oneline master..HEAD`. Do not retry a
   refuted hypothesis; build on the ones that worked.
7. The prompt surface as it stands on WT's branch (section 3).

## 2. Score the block for its tier

| Tier | Primary metric | Secondary |
|---|---|---|
| T1 | verified closes per completed round (`totals.closesPerRound`) | verified points per round, overall and debt delta |
| T2 | the gain per round of the subscore the wave chases. For craft: verified craft closes per round, and the balance across the 7 axes | the other subscores; no regression on T1 dimensions |
| T3 | the improvement of the chosen technology metric (before vs after, on the `ascent/runner` tip), with gates green | the other technology metrics; no regression on T1/T2 |

Compare against the **best earlier block of the same tier**, not just the previous one.

| Verdict | Rule |
|---|---|
| improvement | primary > best × 1.10, or primary >= best AND the main secondary > best × 1.20 |
| negative | primary < best × 0.90, or the block ended early (`dry-backoff`, `stall`) below best |
| marginal | anything else |
| not-scored | the block stopped on `paused:session-limit` or `paused:spend-ceiling`. Edit nothing |
| rig-broken | lanes could not commit, verify or plan for a reason outside the prompt. Fix the rig with a `rig(` commit (it does not count as the hypothesis), or report |

Correct for headroom and say when you do: gaps run out as they close. A T1 block that drained the last gaps and
still beat the best on points is an improvement. A dry block with `debtBefore` near 0 calls for a rescan
(`POST /api/org/local/rescan {org, fullName}`, about 2.5 min), recorded as a rig action; if the rescan raises
nothing new, tell the skill the T1-to-T2 rule holds.

## 3. What you may edit

**A. Ascent's code on WT's branch, in WT only.** The prompt and orchestration surface (line numbers verified
2026-10-12; re-check):

| Surface | Where |
|---|---|
| `buildFixPrompt`, the per-lane brief | `src/lib/org/followups.ts` ~457 |
| `LANE_CAPABILITY_RULE` (no shell, no network) | `src/lib/org/followups.ts` ~273. Change it ONLY to carry out a recorded operator decision, and name the decision in the commit |
| `STRUCTURAL_INVITATION` (larger restructures; craft batches only) | `src/lib/org/followups.ts` ~340 |
| AUTOPILOT CONTEXT and "what counts as resolved" | `src/lib/local/loop-lane.ts` ~1411 |
| The planner: `PLAN_CONTRACT`, `buildPlanningPrompt` | `src/lib/local/lane-plan-prompt.ts` ~28 and ~85 |
| Parking: `parkWithoutCommits`, `CONTAINMENT_PARK_MIN`, `CONTAINMENT_PATTERNS` | `src/lib/local/lane-park.ts` ~74, ~136, ~144 |
| How the org standard enters the brief | `src/lib/org/lane-brief.ts` ~281 |
| Lane orchestration (batch shape, plan-then-execute, ordering) | `src/lib/local/loop-lane.ts`. Touch it only for a paradigm shift |

You may also change the run dials of the next block: `--model`, `--effort`, `--agent-timeout-min`. Never change
`--verify-timeout-min` or `project.json`'s `verifyTimeoutMin` inside a tier: it decides which rung verifies.

**B. The org standard, through the running server only** (never the `.pglite` files):
- playbooks: `GET /api/org/playbooks?org=`, `POST /api/org/playbooks {org, title, dimId, summary, steps}`,
  `PATCH /api/org/playbooks/<id> {title?, summary?, steps?, archived?}`;
- memories: `GET /api/org/memory?org=`, `POST /api/org/memory {org, content, kind?, namespace?, supersedeId?}`.

The brief reads playbooks per dimension; a lane log line `Brief: N memories · ... · no playbook` shows what
the agent received. In T3, a playbook and a memory that state the technology objective are how the runner is
pointed at it.

**Forbidden** (each breaks the experiment or the operator's safety):
- **The instrument**: `src/lib/scan*`, `src/lib/analyze/**`, `src/lib/maturity/**`; `lane-adjudicate.ts`,
  `lane-guard.ts`, `lane-verify.ts`, `lane-inert.ts`; `runner-policy.ts`, `runner-breakers.ts`, `DRY_BACKOFF_MS` and
  `run-limits.ts` constants; `scans-persist`; the driver's metrics. A change there is Goodhart and voids the record.
- **The honesty clauses**: keep "Do the WORK, never the detector" and the RESOLVED/SKIPPED semantics. No stubs,
  no configs for unused tools, no comment-only fixes.
- **Containment**: do not widen `--allowedTools`, `--permission-mode` or the no-shell rule, and do not add network,
  unless a recorded operator decision says so. If the evidence says a fence costs real work, write it under
  `operator decisions` and do not implement it.
- **Other places**: ascent master and the operator's Ascent checkout; anything in TARGET (working tree, branches,
  manifest); the `ascent/runner` ref by hand. No push, no `git stash`, no `git add -A`.

## 4. Process

1. **Diagnose** from the evidence, with counts: dry lanes, planning failures, agent timeouts, items SKIPPED for a
   fence (read the reasons), claims the rescan did not confirm, guard rejections, voided lanes, hook failures.
2. **Decide**: one targeted change inside the current paradigm, OR one paradigm shift (section 5). One hypothesis
   per block, so the next delta can be attributed. A `rig(` fix may ride along and does not count.
3. **Stop the server before you edit `src/`** (`node DRIVER server stop`; it must print that the port is free). It
   refuses to kill anything it did not start; if it refuses, stop and report.
4. **Edit and check**: `cd WT && npx tsc --noEmit`, then the colocated tests of every file you touched (brief:
   `npx vitest run src/lib/org/followups src/lib/org/lane-brief`; planner or parking: `npx vitest run src/lib/local/`).
   Update a test that pins the old wording in the same commit; never weaken a test of the instrument.
5. **Commit** on WT's branch only (check `git -C WT branch --show-current`), as xkazm04, staging only your paths:
   subject `cycle(<project>-<NNN+1>): <the change, verb-first>`; body with the evidence numbers, the hypothesis,
   the expected effect on the primary metric, the tier and the paradigm name; end with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Then `git -C WT status --porcelain -- src scripts`
   must be empty.
6. **Restart** with `node DRIVER server start`, wait for HTTP 200, run `node DRIVER status`. If it does not come
   up, fix it or revert your commit. Never leave the rig down.
7. **Write** `PDIR/blocks/<NNN>/reflection.md` with: `verdict` (with the numbers against the best block of the
   tier), `tier`, `paradigm` (name and consecutive weak-block count), `diagnosis`, `change` (sha, files, DB edits
   with ids), `hypothesis`, `ladder` (does the tier's move-up rule hold? why), `operator decisions`, and `next block
   command` (the exact line).
8. **Append** to `PDIR/LEDGER.md`, under the block's section, a `### Reflection on block <NNN>` paragraph of at
   most 8 lines: verdict, tier, change and sha, hypothesis, paradigm counter.

## 5. The paradigm rule

A **paradigm** is the mechanism by which Ascent turns a measurement into landed work. Rewording a prompt is not
one. P0 is the shipped mechanism: plan-first lanes, one agent per batch of up to N follow-ups, Opus, the
`buildFixPrompt` brief, no shell. (The weekend moved Personas to P1, item-isolated rounds, at block 006.)

**Two consecutive marginal or negative blocks oblige the next block to use a different paradigm.** An
improvement resets the counter. Candidate shifts, none of them a rewording:
- a planner/executor split, the plan held to its files;
- a change-spec mini-language the executor works from, checked against the diff;
- a different decomposition: one item per lane, batches by module, gap-only vs craft-only, headroom-first;
- a different model or effort;
- building the infrastructure the rubric rewards (workflows, supply-chain controls, CI gates) on `ascent/runner`,
  when a recorded operator decision allows it;
- in T3, an architecture move: the plan proposes one structural change toward the technology metric, the lane
  carries it through `STRUCTURAL_INVITATION`, and the Director's before/after measurement judges it.

After a shift, the new block is measured against the best block of the tier.

**A loop breakthrough** is a block after a paradigm shift whose primary metric beats every earlier block of the
tier. **A technology breakthrough** is a T3 block whose landed work moves a technology metric by at least its
threshold, gates green, work real. Write either under a `## breakthrough` heading in `reflection.md` (what changed,
the numbers, why it worked) and put the same line first in your LEDGER paragraph.

## 6. Exit codes of `infinite.mjs block`

| Code | Meaning |
|---|---|
| 0 | all rounds done |
| 10 | returned early on dry-backoff (a round with zero verified closes paused the drive 1 h / 4 h / 12 h). The pause is per drive: the next block starts a new one, so the loop does not wait |
| 11 | a breaker paused the run: `session-limit` and `spend-ceiling` are not scored; `repo-failures`, `branch-conflict`, `dependency-install` are the operator's |
| 12 | stall, drive ended, or `--max-hours` |
| 3 / 4 | preflight: the server is down, or another drive is live |
