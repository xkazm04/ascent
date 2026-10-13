# /infinite - lessons

Append-only. One dated entry per lesson that changes how the loop runs. The first entries are carried over
from the weekend rig that this skill generalises (2026-10-09..12, 7 blocks against xkazm04/personas).

## 1.0 - 2026-10-12 - carried from the weekend rig

- **A dry round is not the end of a block's usefulness.** The runner's dry-backoff (1 h / 4 h / 12 h,
  `DRY_BACKOFF_MS`) is per drive, and a new drive lifts it. The weekend ran 24 of 70 planned rounds because blocks
  ended on it and the Director waited. Reflect and start the next block at once.
- **A target with no reachable headroom measures nothing.** Personas sat at overall 79 for all 7 blocks: L4, with D1/D2/D8
  near 100 and its only headroom in D3/D4 (unmeasurable locally) and D9 (needs workflow edits and network). Check reachable
  headroom before a T1 wave; if there is none, the tier is T2, or a fence is an operator decision.
- **Machine load turns into planner timeouts.** At 14 claude processes, tool calls ran 3-5x slower and planners hit the
  8-minute ceiling (blocks 003, 004). The planner prompt now states its budget, uses direct reads only and writes the
  plan once (10f7249c). Still: check load in preflight.
- **A lane's work is lost to protocol, not just to quality.** The weekend lost whole lanes to: an ADDED fixture or
  gate-config file (void), a MODIFIED `vite.config.ts` (void by name), a report ending in prose with no `RESOLVED:` lines
  (0 trailers, so 0 closes), and a hook commit killed at 15 s (fixed: 180 s, 9321ebae). Read void reasons and report
  trailers first when a block underperforms.
- **Process trees leak on Windows.** A leaked `npm test` tree held ~23 GB in block 001. `child.kill()` before
  `taskkill /T` leaves the tree alive (b3824f84, 46ade06a). The driver sweeps after every round; keep it that way.
- **A session limit is not a verdict.** Blocks that stop on `session-limit` are not scored and nothing is edited.

## 1.1 - 2026-10-13 - the first wave through the skill (xkazm04/personas-web, overnight, blocks 001-007)

- **A project with no declared check lands nothing, and still reports closes.** personas-web declared no gate Ascent
  could resolve (no manifest control, no `test`/`check`/`verify` script, CLAUDE.md gitignored), so every agent lane
  verified `skipped` and delivery refused it. Block 001 still showed 14 verified closes, all of them on 7 held lanes.
  Preflight now checks the verify ladder (SKILL.md Phase 2 step 4). The loop can bootstrap the gate itself
  (66ad2e95 + 6b65fb10 did, in block 003 round 1), but only once the plan fence lets that lane through.
- **Typecheck-only lanes poison the full gate.** Lanes verified on the narrowed rung landed a lint warning over the
  ceiling and tests that fail, the full gate went red on the runner tip, and from then on every lane narrowed too.
  Between blocks, run the full declared gate on the `ascent/runner` tip in a throwaway clone; a red tip is an
  operator decision (no lane may edit an existing test), and it belongs at the top of the report.
- **A dry first round makes a one-round block.** Blocks 002 and 006 ran one round each, and a 30-minute reflection
  then rested on one sample. The reflection may decide "no change, re-run" when the sample does not point at a defect.
- **An early refusal can park a whole dimension for days.** D9 got 0 of 79 batch slots across two blocks because
  block 001's refusals parked it until three days out; 456a41de made a dimension-wide park lapse after 4 h, and D9
  went 75 -> 90 in the next block's first round.
- **The driver must not count the run its own stop aborts** (fa1e3322). A block that reaches its round count stops the
  drive just as it opens the next run; counted, that run read as a dry, errored round and flipped a verdict.
- **A reflection's test run through a linked `node_modules` writes into the operator's real one.** Use a throwaway
  clone with its own `npm ci`, never a lane-shaped worktree with the junction.
- **When T1's remaining gaps are all fenced, raw closes per round stop measuring the paradigm.** Block 003 drained
  live gaps (debt 79 -> 58); blocks 006-007 worked craft rungs that score nothing. The T1 -> T2 move then waits only
  on the operator recording the fences in `project.json`; ask for it in the report, and correct verdicts for headroom.
- **Ascent's own lane commits lower the target's D7.** They carry `Ascent-Resolves:` and no AI co-author trailer, so
  each one pushes a trailered commit out of the scanner's 30-commit window (D7 94 -> 80 in block 005).
- **The paradigm rule works.** Two weak blocks forced P2 (a read-only review plus one repair turn before the guard,
  f6994190). In its first full block it caught the exact compile error that had rejected two earlier lanes, and
  0 of 5 lanes were rejected.
