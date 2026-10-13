---
name: infinite
description: "Ascent's endless improvement loop for any paired project. Asks which known project(s) to work, then runs Ascent's standing runner in waves of blocks, reflects after every block, and climbs an objective ladder: a perfect maturity score first, then subscores, then breakthroughs in the project's technology. It never stops on a dry round; it pivots. Use when the operator wants a project improved session after session without a ceiling."
version: 1.2
argument-hint: "[start | resume <owner/name> | status | reflect <owner/name> <NNN> | stop]"
---

# /infinite - the loop that does not stop climbing

> The operator, 2026-10-12: "The goal was not to measure level increase, but to achieve ability to loop
> infinitely with attempt to always increase with a loop so we can achieve technological breakthroughs and
> code quality excellence. At some point we will reach high level enough to ignore for periodical pushing and
> find subscores or another measuring metrics to chase. I expect project like Personas will still have after
> 50-100 items to do and the way architecture and code improves is the subject of interest."

The weekend experiment (2026-10-09..12, seven blocks against Personas) showed what stops a loop like this,
and this skill is built against each cause:

| What stopped the weekend loop | What /infinite does instead |
|---|---|
| A dry round paused the drive 1 h / 4 h / 12 h, and blocks ended after 1-3 of 10 rounds | The pause is per drive. Reflect, pivot the objective, start the next block (a new drive) at once |
| The target was at L4 with its only headroom fenced (D3/D4 unmeasurable, D9 needs network) | The objective ladder moves on: subscores and craft rungs, then technology metrics. Fences become operator decisions, asked once |
| Reflection spent its budget repairing the rig | The rig fixes are carried by the worktree branch; rig failures are fixed as `rig(` commits outside the hypothesis count |
| Planner timeouts under machine load (tool calls 3-5x slower beside 6 builders) | Preflight checks load and says when the machine is too busy for a fair block |
| A stop rule paused the experiment after one weak block | No stop rule on a weak block. Only the usage limit, the operator, or a broken rig stops a wave |

## Words

- **Round**: one run of Ascent's standing runner against the project (plan-first lanes, verified closes).
- **Block**: one `node scripts/infinite.mjs block` call, normally 10 rounds, one drive. It ends early when the
  runner can no longer make a round, and that is information, not failure.
- **Wave**: the blocks one session runs, with a reflection after each. A wave ends on its budget (blocks or hours)
  or a stop condition, and writes a wave report.
- **Objective tier**: what the wave is chasing (see the ladder below). The tier sets the block's primary metric.
- **Paradigm**: how Ascent turns a measurement into landed work (references/reflect.md section 5). Rewording a
  prompt is not a paradigm change.

## The objective ladder

Full detail and the source of every measure: [references/ladder.md](references/ladder.md).

| Tier | Chase | Primary metric per block | Move up when |
|---|---|---|---|
| **T1 Perfect score** | overall maturity to 100: every measurable dimension D1-D9 to 100, debt (sum of 85 - score) to 0, open gaps to 0 | verified closes per round | no open gap is reachable (debt 0, or every remaining gap is fenced or unmeasurable and its operator decision is recorded) |
| **T2 Subscores** | the measures under a dimension: contested and unmeasurable dimensions, conformance to 100, D4 and D1 claim facets, guidance coherence and context health, discrepancies to 0, then the craft-rung ladder on 7 axes, which never runs out | the chosen subscore's gain per round (craft: verified craft closes per round, balanced across axes) | two blocks in a row move no subscore, or the operator calls it |
| **T3 Breakthrough** | the project's technology itself: speed, size, simplicity, capability, architecture. Measured by project-specific technology metrics the operator confirms (build and test time, p95 latency, bundle size, dependency count, lines per feature, a new capability with tests) | the chosen technology metric's improvement, gates green | never: T3 is the open end. A T3 breakthrough is recorded and the next T3 target is chosen |

Two kinds of breakthrough are recorded, and both are the point:
- **A loop breakthrough**: after a paradigm shift, a block whose primary metric beats every earlier block of the
  same tier (references/reflect.md section 5).
- **A technology breakthrough**: a block whose landed work moves a T3 metric by at least the threshold set in
  project.json (default 10%), with the gates green and the work real (not a stub, not a gamed detector).

## The rig

| Thing | Where |
|---|---|
| Driver | `.claude/skills/infinite/scripts/infinite.mjs` (generalised from the weekend's cycle.mjs; Node built-ins only) |
| State | `$INFINITE_HOME`, default `~/.personas/infinite/`: `rig.json`, `next-dev.pid`, and per project `projects/<owner__name>/` with `project.json`, `LEDGER.md`, `waves.jsonl`, `blocks/<NNN>/` (`000` is the baseline) |
| Ascent server | `next dev -p <port>` (default 3200) from ONE Ascent worktree, with `ASCENT_AUTOPILOT=1` and the local org (`ASCENT_LOCAL_ORG`, org `kiro`). Its DB is the worktree's own PGlite copy, never the operator's `.pglite` in the main checkout |
| Prompt surface | that worktree's branch. Today: `experiment/infinite-cycles` (weekend worktree `~/.personas/weekend/ascent-cycles/ascent-wt`). Each reflection's change lands there as `cycle(<project>-NNN)`; the weekend's 8 commits are on master since 88413c4b |
| Target | the project's own checkout. The runner writes ONLY `refs/heads/ascent/runner`, never checked out; merging it into the project is the operator's (`POST /api/org/local/runner/merge`, or by hand) |

| T3 measurement | `infinite.mjs tech --project p [--ref r] [--runs 2] [--label l]` measures `project.json` `techMetrics` in a throwaway detached worktree of the target with its own `npm ci` (never a link to the operator's `node_modules`), and removes it unless a junction inside points outside it. In a T3 block the driver measures the start commit before the drive and the runner tip after, and writes `tech-before.json`, `tech-after.json` and `metrics.json` `tech.delta` (gain per metric, `breakthrough`, `noisy`) |
| Frontier objective | an org memory in the namespace `frontier:<owner/name>` (`POST /api/org/memory {org, namespace, kind: "procedural", content}`; sharpen it later with `supersedeId`). When a runner lane's batch is empty and the objective exists, the lane works it instead of exiting dry (`src/lib/local/lane-frontier.ts`, paradigm P4) |

One drive per org is a hard limit of the runner, so one block runs at a time. A drive may name several repos,
but the driver measures one project per block; run projects one after another inside a wave.

## `/infinite start` (and `/infinite` with no argument)

### Phase 0 - Preflight (no questions yet)

1. `node .claude/skills/infinite/scripts/infinite.mjs status`. If `rig.json` is missing, record the rig:
   `node .claude/skills/infinite/scripts/infinite.mjs rig --wt <ascent worktree> --port 3200 --org kiro`. Use the
   weekend worktree unless the operator names another. If the worktree is gone, create it from
   `experiment/infinite-cycles`, run `npm ci` in it (a real install, not a junction), and copy the operator's
   PGlite DB into it once.
2. Server: `node .claude/skills/infinite/scripts/infinite.mjs server status`. Start it with `server start` if it is down. If the port has a
   listener the driver did not start, use it if it answers 200 and serves the org; never kill it.
3. No live drive (`status` lists them). A live drive you did not start is the operator's: report it and stop.
4. Machine load: free memory and other heavy work (builders, a cargo build, a Curator pool). Under heavy load
   the planner times out (weekend block 003/004). Say what is running; the operator decides whether to wait.

### Phase 1 - Choose, in waves of questions

Read `node .claude/skills/infinite/scripts/infinite.mjs projects` first. It lists every known project with level, overall, debt, open
gap dimensions, unmeasurable and contested dimensions, whether it is initialised, and how many blocks it has run.

**Question wave 1 (one AskUserQuestion):**
- **Projects** (multiSelect, at most 4 options; the rest through Other): the known projects, each option's
  description giving level, overall, debt and blocks run. Recommend first the one with the most reachable
  headroom (high debt, few unmeasurable gaps) unless the operator named one. Several picks run one after
  another inside the wave, each with its own ledger.
- **Wave budget**: `3 blocks` / `6 hours` / `until the usage limit` / `one block (a probe)`.

**Question wave 2 (one AskUserQuestion), per chosen project, only the questions that are open:**
- **Objective tier**: propose the tier the ladder rule gives (T1 while reachable gaps remain), with the reason
  in the description. The operator may jump to T2 or T3.
- **Fences** (only when the project's remaining T1 gaps are fenced, multiSelect): for example "let the runner
  edit CI workflows on its own branch", "allow network for supply-chain pins", "run a GitHub fleet scan so
  D2/D3/D4 become measurable". These are operator decisions. Record them in `project.json` under
  `operatorDecisions` with the date. The reflection may act on a recorded decision; it never widens the agent's
  tool grant on its own.
- **T3 metrics** (only when entering T3): propose 2-4 technology metrics with the command that measures each,
  read from the project's own scripts and manifest. Record the confirmed ones in `project.json` as
  `techMetrics: [{name, command, parse, direction, threshold, timeoutMin?}]`, measured in order in one worktree;
  `parse` is `{kind: "wall", unit: "s"}`, `{kind: "json-sum", file, field, scale?, unit}` or
  `{kind: "regex", pattern, unit}`, and `command: null` reads what an earlier command left (bundle stats after
  the build). Measure the baseline twice (`tech --label baseline --runs 2`): a metric whose spread is at or
  above its threshold is not usable as it stands; widen its threshold to the measured noise, or drop it.
  Before the first T3 block, run the project's build once: a target whose build is red cannot be measured.

Ask nothing the code or the ledger can answer. Never ask about usage: the operator manages it.

### Phase 2 - Initialise each chosen project

1. `node .claude/skills/infinite/scripts/infinite.mjs init --project <owner/name> [--path <abs checkout>] [--base <branch>]`. It pairs
   the project if it is not paired yet, writes `project.json`, and records the baseline in `blocks/000`.
2. If the latest scan is older than the project's newest commit, rescan first:
   `POST /api/org/local/rescan {org, fullName}` (about 2.5 minutes), then `init` again to refresh the baseline.
3. Set `verifyTimeoutMin` in `project.json` from the project's own verify ladder (the weekend used 3 minutes
   for Personas, so lanes verify on the typecheck rung). Once set it is part of the instrument: never change
   it inside a tier.
4. Check that the project DECLARES a gate Ascent can resolve: a `.ai/manifest.yaml` control (`ciHardPass` or a
   `typecheck`/`lint`/`test` capability), or a `test`/`check`/`verify` script in `package.json`. Without one, every
   lane verifies `skipped`, delivery refuses it, and the block's closes count on work that never lands
   (personas-web block 001: 14 closes, 0 landed). Say so before block 001. The operator may declare the gate on the
   base branch; otherwise the first block's honest job is to bootstrap it, and its closes are not comparable.
5. Run the full declared gate once on the base, so a red gate on arrival is not later blamed on the loop.

### Phase 3 - The wave loop

Repeat until the wave budget is spent or a stop condition holds:

1. **Run a block** in the background and await it:
   `node .claude/skills/infinite/scripts/infinite.mjs block --project <p> --rounds 10 --ceiling 0 --label "<tier> <hypothesis>"`, plus
   the dials the last reflection named (`--model`, `--effort`, `--agent-timeout-min`). `--ceiling 0` means no
   spend ceiling; the operator owns usage.
2. **Read the exit code** (references/reflect.md section 6) and branch:
   - `0`, `10` (dry-backoff) or `12` (stall, drive ended, max-hours): reflect (step 3), then go straight to the
     next block. Do not wait out a dry-backoff; the new block is a new drive.
   - `11` with `session-limit`: the block is not scored. Schedule a wake-up at the reset the pause names, then
     continue the same wave.
   - `11` with `repo-failures`, `branch-conflict` or `dependency-install`: operator territory. Ask once with
     AskUserQuestion, then continue with the next project in the wave or end it.
   - `3`/`4` (preflight): fix the rig (server down) or report the foreign live drive.
3. **Reflect**: spawn ONE Opus subagent with `references/reflect.md`, the project, the block id, the tier, the
   recorded operator decisions and T3 metrics. It scores the block for its tier, makes ONE change (or one
   paradigm shift), commits it on the worktree branch, restarts the server, and appends to the ledger. Read its
   `reflection.md`; never edit its verdict.
4. **Ladder check** after each reflection (references/ladder.md section 4). Move the tier up when its rule holds,
   and say so in the wave log. A tier change resets the "best block" the verdicts compare against.
5. Append one line to `waves.jsonl`: `{wave, project, block, tier, exitCode, verdict, primary, breakthrough}`.

Stop conditions, and only these:
- the wave budget is spent;
- the operator says stop;
- the rig is broken and the reflection could not repair it;
- a breaker that belongs to the operator, still unanswered.

A weak block is NOT a stop. The paradigm rule forces a change of mechanism instead.

### Phase 4 - Wave end

1. `node .claude/skills/infinite/scripts/infinite.mjs trend --project <p>` for each project in the wave.
2. Write the wave report in the terminal, from the evidence only:
   - blocks run, verdicts, primary metric per block, tier and tier changes;
   - breakthroughs (loop or technology) with the numbers;
   - commits that landed on `ascent/runner` (`git -C <target> log --oneline <base>..ascent/runner`): the work
     waiting for the operator's merge;
   - operator decisions asked and answered.
3. Offer the next wave. Inside a `/loop`, schedule it with ScheduleWakeup. Outside one, name the command.
4. Never merge `ascent/runner` into the project, and never push. Both are the operator's.

## T3 and the frontier lane (paradigm P4)

The operator's direction (2026-10-13): leave behind areas where a limit was reached, and push past the edge where
model knowledge and creativity allow it. Fences never move to manufacture supply; the loop makes its own.

1. Write the objective as an org memory in `frontier:<owner/name>`. One paragraph: the technology metrics with their
   baseline values and directions, what "past the edge" means for this stack, and anything already known to be
   over a budget. The frontier brief tells the session to choose ONE improvement, name its mechanism, and leave
   behind anything that needs network, new dependencies, CI, `.claude/` or an existing test.
2. Run T3 blocks as usual. A frontier lane closes no follow-up row, so the runner's own policy counts its round dry
   and pauses the drive; in T3 the driver opens the next drive inside the same block (`NEXT DRIVE` in `cycle.log`)
   until the block has its rounds. The policy and `DRY_BACKOFF_MS` are untouched.
3. The block's verdict is the tech delta (`metrics.json` `tech.delta`), read against the noise: a `noisy` metric
   is not evidence either way. The reflection may sharpen the objective memory (`supersedeId`) or the frontier
   brief (`lane-frontier.ts`) as its one change.

## `/infinite resume <owner/name>`

Read `project.json`, the last 3 ledger sections, `waves.jsonl` and the last `reflection.md`. Say in one
paragraph where the project stands (tier, best block, paradigm counter, open operator decisions), then go
straight to Phase 3.

## `/infinite status`

`node .claude/skills/infinite/scripts/infinite.mjs status` and `projects`, plus each initialised project's last ledger row and tier. One
paragraph, numbers from the output only.

## `/infinite reflect <owner/name> <NNN>`

Run step 3 of Phase 3 by hand for a block that ended without a reflection.

## `/infinite stop`

Stop the live drive cleanly (`POST /api/org/local/drive {org, action:"stop", id}`), let the block finalise its
metrics, and write the wave report. Leave the server running unless the operator asks.

## Guardrails

- **The instrument is untouchable**: scan, scoring, rescan, adjudication, verify, guard, runner policy and
  breakers, `DRY_BACKOFF_MS`, the driver's metrics, and a project's `verifyTimeoutMin` inside a tier. Changing
  any of them makes the numbers incomparable.
- **Honesty**: "Do the WORK, never the detector". Stub files, configs for unused tools and comment-only fixes
  are negative results, however good the number.
- **Containment**: never widen the agent's tool grant or add network on the reflection's own initiative. A
  recorded operator decision is the only way a fence moves, and the reflection names the exact change.
- **Places**: the runner writes only `ascent/runner` in the target. The reflection commits only on the
  worktree's branch. Nothing touches ascent master, the target's branches or its working tree. No push, no
  `git stash`, no `git add -A`.
- **Processes**: the driver stops only the server it started (`next-dev.pid` plus a command-line check). Never
  kill anything else.
- **Usage** is the operator's. Do not throttle on the meter; a `session-limit` pause is waited out, then the wave continues.

## Known gaps (v1.0)

- T3 was first set up on 2026-10-13 (personas-web). Wall-time metrics on a shared machine are noisy (unit tests
  measured 44 s then 26 s on the same commit, a cold cache); judge them only with their spread. A deterministic
  metric (bundle bytes from the build's own stats) is the dependable one.
- `projects` reads overall and level with one call per project, and debt only from the org's green summary.
  Subscores (claim facets, conformance, craft tallies) are read by the reflection from the API and the DB
  through the server. There is no single subscore endpoint yet.
- The weekend's 8 commits were merged into ascent master on 2026-10-12 (88413c4b). Every reflection since commits
  its `cycle(<project>-NNN)` change on `experiment/infinite-cycles` again, so the branch runs ahead of master by the
  wave's changes; folding them in is the operator's call, after reading the wave's verdicts.
- The `ascent/runner` tip is verified lane by lane, often on the narrowed typecheck rung, never as a whole. Its full
  gate can go red without any block noticing (personas-web: 3 failing tests at 32 commits). Run it before a merge.

## Skill Reflection

At the end of every wave, append to `LESSONS.md` only what would change how this skill runs (a rig trap, a
question that wasted the operator's time, a ladder rule that misfired). Bump `version:` on a change to this file.
