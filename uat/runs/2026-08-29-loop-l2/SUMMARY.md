# UAT — 2026-08-29 · ascent · `loop-to-l5` L2 (Priya, Platform/DevEx Lead)

One Character, one journey, **L2 only**. The journey's Status block said the honest verdict was
**unproven** until a live drive and a real agent lane had been run; this is that run.

Full report: [`loop-to-l5-l2.md`](./loop-to-l5-l2.md).

## Scorecard

| | Confirmation | Verdict |
|---|---|---|
| **L2-A** | a real agent lane | **FAIL** |
| **L2-B** | an attributable lift | **pass (partial)** |
| **L2-C** | a live drive, killed and resumed | **pass** |
| **L2-D** | the GitHub-side carry, end to end | **not run** |
| **L2-E** | merge and iterate | **pass** |
| **L2-F** | the blocked states, for real | **pass (1 of 5 states)** |

**Journey verdict: `L2-conditional`.** Everything the loop does *around* the agent works, live, and
survives having its process killed. The agent lane itself does not produce its deliverable.

## The one that decides the journey

**A real `claude -p` session did the work and could not commit it.** `runClaudeAgent` passes
`--permission-mode acceptEdits`, which auto-accepts *edits* and not *Bash*; headless `-p` has nobody
to grant the rest. The session ran 5 m 46 s, wrote `AGENTS.md` and a `test/` directory into the
worktree, reported it was blocked from `git add` / `git commit` — and `removeLoopWorktree`'s
`--force` then deleted the only copy. The branch that is supposed to *be* the deliverable carries
none of it.

Reproduced outside Ascent in 22 seconds for $0.03: same flags, throwaway repo, "write a file and
commit it" — the file appears, the commit is refused, and the envelope still says
`"is_error": false, "subtype": "success"`.

Worse, the ledger then reports it as progress. The after-scan was taken from the worktree *before* it
was deleted, so the operator's screen reads:

```
▲+39  ATTRIBUTABLE LIFT     …     19 → 43  ▲+24
31 gaps closed · 0 follow-ups closed · 0 commits
```

A **+24 attributable lift** with **0 commits**, three lines apart, for work that no longer exists —
and that scan is now the repo's latest reading, so the fleet's greenness credits it too. Priya's
stated trust bar for this journey is *"what verified this, and would I have believed it without the
verification?"*. Here the verification is what produced the false claim.

## What genuinely works, and is worth saying out loud

- **The restart story is real.** Server killed 3.5 s into a drive with a run in flight; on boot,
  `[loop] boot sweep: 1 loop run stopped, 1 drive marked interrupted — a previous process died while
  they were in flight.` The run reads `stopped`, the drive `interrupted`, and the cockpit offers it
  back as a banner above a still-usable inspector — *"was not resumed on its own"* — priced at
  `0/3 runs spent`. Resuming creates a new drive with `resumedFrom` set and `runsBefore` carried, so
  crashing cannot re-grant rope.
- **The zombie-claim failure that `boot-sweep.ts` was written against is closed, measured end to
  end.** `open=8 inProgress=0` → armed a backlog lane whose agent hangs → `open=4 **inProgress=5**` →
  `taskkill /F` → restart → `open=9 **inProgress=0**`. Five claims held by a dead process, all five
  released. Zero model spend: the agent was a stub.
- **The provenance disclosures are the best thing in the product.** On a run that *succeeded*, the
  ledger volunteers three separate reasons its own number may be softer than it looks — `widened
  D2, D3` (doubled guardband), `blend 95%` (a thin read pulls toward the detector), `D2/D3/D4 not
  measurable locally` — plus `engine claude-cli · opus` beside every lane.
- **Merge-and-iterate holds over five rounds.** `foundation → practice(agent-guidance) →
  practice(docs-adrs) → practice(legible-history) → backlog`, score 19 → 38, L1 → L2, debt 419 → 293,
  the kind changing under the rule each time because it re-reads the operator's own working copy.
- **`--effort` is no longer "passed unprobed"** (a known gap in the journey). The orphaned stub's
  argv on the process table: `-p --output-format json --permission-mode acceptEdits --model sonnet
  --effort low`.

## Findings, ranked

1. **`L2-A-01` (blocker)** — the agent cannot commit; every backlog lane's work is discarded.
2. **`L2-B-01` (high)** — an `ATTRIBUTABLE LIFT` is printed for a lane with `0 commits`, and that
   scan becomes the repo's standing. Attribution tests the engine and the noise band, never
   durability.
3. **`L2-C-01` (medium)** — a `Resume drive` click before hydration is swallowed silently.
4. **`L2-E-01` (medium, uncertain)** — a `backlog` lane proposed with an empty batch while 293 points
   of debt remain. Probably a mock-corpus artifact; the proposal has no guard either way.
5. **`L2-F-02` (medium)** — `agent.ts` strips `ANTHROPIC_API_KEY` from the spawn env but not
   `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT`; a self-hosted Ascent launched from inside Claude Code
   hands its own markers to every agent, which then silently produces nothing.
6. **`L2-B-02` (low)** — `sonnet · low effort` and `engine claude-cli · opus` on one panel,
   unlabelled.
7. **`L2-E-02` (low, design)** — a drive's debt falls on the lane's worktree rescan, before any merge.

## Fixed in this run

| commit | |
|---|---|
| `044d7dc5` | The run branch stamp was minute-resolution, so a **drive's** back-to-back runs collided on one branch name; the second lane died before it had a worktree and the drive reported the wreck as `dry` — "a whole run moved nothing" — i.e. as a finding about the operator's repository. Seconds plus a collision suffix; verified live. |
| `2959be4c` | A lane that lost its agent's work logged the same line as a lane that had none. It now names the uncommitted changes it is discarding and the branch they are not on, and gives the agent's own explanation 400 characters instead of the 160 that truncated this run's mid-word. |

## Cost

**Five completed model calls and one aborted**: four `claude-cli` assessments (opus), one agent
session (sonnet, low effort, 5 m 46 s), one $0.03 haiku probe. The entire mock phase — the drive kill
and resume, the claim-release proof, five foundation/practice lanes — spent nothing.

## Machinery added

- `e2e/loop/live-drive-resume.spec.ts` — the resume banner and the chain carry, against a server the
  harness does not own (it cannot: the test kills it).
- `e2e/loop/live-setup-blocked.spec.ts` — the `autopilot-off` state rendered by a real deployment,
  not by a prop.
- `playwright.loop-live.config.ts` — the sibling of `playwright.loop.config.ts` with **no**
  `webServer`. Not wired into CI, and must not be: it asserts against state a human staged, and its
  real-engine half spends model sessions.
