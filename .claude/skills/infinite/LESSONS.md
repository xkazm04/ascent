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
