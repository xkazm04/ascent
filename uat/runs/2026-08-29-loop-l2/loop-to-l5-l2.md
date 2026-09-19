# L2 — `loop-to-l5` · Priya (Platform/DevEx Lead)

**Run date** 2026-08-29 · **Level** L2 (empirical, live app) · **Journey** `uat/journeys/loop-to-l5.md`

Until this run the journey's own Status block read **"L2: not yet run … the honest verdict for this
journey is *unproven*"**. This is that run. It executes L2-A…L2-F against a live self-hosted Ascent
with a real filesystem, real git repositories, a real `claude -p` agent session and a real restart of
the server process — the six confirmations the L1 surface model and the mock-engine e2e suite are
structurally unable to make.

---

## How it was run (so a re-run is possible, and so the isolation claims are checkable)

| | |
|---|---|
| Checkout | `.claude/worktrees/l2-run`, branch `l2/ascent-loop` off `master` (`b91eb3ef`). Never the operator's main checkout, which had a live sibling session in it. |
| `node_modules` | A junction to the main checkout's. No `npm install`. Consequence: `--webpack`, because Turbopack refuses a junction. |
| Server | `npx next dev --webpack -p 3220`, started and killed **by this run**, never the operator's own `:3210`. |
| Database | `PGLITE_DATA_DIR` pointed at a throwaway scratch dir — `pglite-mock` for the mock phase, a second `pglite-real` for the real-engine phase. Nothing touched `.pglite/ascent`. |
| Org | `ASCENT_LOCAL_ORG=l2loop`, `ASCENT_SELF_HOSTED=1`, `ASCENT_AUTOPILOT=1`, `ASCENT_AUTH_BYPASS=1`, `ASCENT_OPEN_ORG_DASHBOARDS=1`, `GITHUB_TOKEN=""`. The five facts `CockpitSetup` names, set the sanctioned way. |
| Subjects | Two scratch git repos in the OS temp dir, created per the `e2e/loop/fixture.ts` pattern: `ascent-l2/loop-fixture` (the mock phase's subject) and `ascent-l2/bare-svc` (the real phase's — deliberately no README, no CI, no tests, no `.ai/`). |
| Specs | `e2e/loop/live-drive-resume.spec.ts` and `e2e/loop/live-setup-blocked.spec.ts`, driven by `playwright.loop-live.config.ts` — a config that deliberately starts **no** server, because L2-C's central act is killing one. |

### The environment sanitation this run had to do, and the product hole it exposes

Every process launched here went through
`env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_SSE_PORT -u CLAUDE_EFFORT -u CLAUDE_CODE_SESSION_ID -u ANTHROPIC_API_KEY -u CLAUDE_MODEL -u ASCENT_AGENT_EFFORT`.
Two of those matter to the product, not just to the harness:

- **`ANTHROPIC_API_KEY`** — an inherited key would bill the API instead of the subscription.
  `src/lib/local/agent.ts` already deletes this from the spawn env (`delete env.ANTHROPIC_API_KEY`),
  so the product is covered here whether or not the operator is.
- **`CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT`** — **it does not delete these** (finding **L2-F-02**
  below). A nested `claude` that inherits the harness's own marker produces nothing, silently. The
  file's own comment block records the sibling collision — `CLAUDE_EFFORT` is set by the harness, so
  the effort env var was deliberately named `ASCENT_AGENT_EFFORT` to dodge it — which makes this the
  same hazard, one variable over, left unguarded. Sanitizing at server launch covers it because
  children inherit, but that is the operator's discipline, not the product's.

---

## Verdicts

| # | Confirmation | Verdict | Evidence |
|---|---|---|---|
| **L2-A** | a real agent lane | **FAIL** | The session ran 5m46s, edited the files, and **could not commit**: `--permission-mode acceptEdits` does not grant Bash, and headless `-p` has nobody to ask. 0 commits, the worktree deleted, the deliverable gone. Reproduced in 22 s outside the app. |
| **L2-B** | an attributable lift | **pass (partial)** | A real pair (`claude-cli/opus` both ends, `engineDegraded:false`) produced **4 → 19, ▲+15**, well outside ±2, backed by a real commit. The "unchanged repo prints `within noise` twice" half was not driven. And the same ledger printed **▲+24 · ATTRIBUTABLE LIFT** beside **"0 commits"** — see L2-B below. |
| **L2-C** | a live drive, killed and resumed | **pass (partial)** | boot-sweep line fired verbatim; drive `interrupted`; run `stopped`; banner + resume chain proven. The **claim-release** half is proven separately (see L2-C.2). |
| **L2-D** | the GitHub-side carry, end to end | **not run** | Requires a repo that exists on GitHub and a token; both fixtures are local-only, and every scan ran `noAmbientToken`. The *negative* half (`D2/D3/D4 not measurable locally`) was observed on every scan. |
| **L2-E** | merge and iterate | **pass** | Five consecutive iterations, lane kind changing under the rule each time, fleet score 19 → 38. |
| **L2-F** | the blocked states, for real | **pass (1 of 5 states)** | `autopilot-off` driven for real against a server booted without the flag. |

> **L2-A was re-driven on 2026-08-29 after the fix and PASSES.** The table above is left exactly as
> the run found it — see [The L2-A re-verdict](#the-l2-a-re-verdict--2026-08-29-after-the-fix) at the
> end of this report for the second live agent session, the commit the lane made, and the two other
> findings (L2-B-01, L2-C-02) closed with it.

---

## L2-C — a live drive, killed and resumed

### L2-C.1 — the kill, the sweep, and the offer

**What was driven.** `ascent-l2/loop-fixture` mapped and paired through `POST /api/org/local/projects`
(`{"added":1,"paired":1}`), scanned from disk, then a drive armed over it:

```
POST /api/org/local/drive
  {"org":"l2loop","action":"start","repos":["ascent-l2/loop-fixture"],
   "maxRuns":3,"maxCycles":2,"concurrency":1,"model":"sonnet","effort":"low"}
→ 202 {"drive":{"id":"drive_mteabnve_jony2t","phase":"running", … }}   11:16:04Z
```

The server process was killed **while a run was in flight** — polled until
`GET /api/org/loop?org=l2loop` reported `"active":{"id":"77feadf4-…"}`, then
`taskkill /PID 6896 /F` at **11:16:07.710Z**. Three seconds of drive, one live run, no graceful shutdown.

**The boot sweep fired, and said so.** On restart, `src/instrumentation.ts`'s `register()` printed
exactly the line `bootSweepLine` composes:

```
[pglite] embedded local DB ready (in-process) at …\pglite-mock
[loop] boot sweep: 1 loop run stopped, 1 drive marked interrupted — a previous process died while they were in flight.
```

**And the state agreed with the line.** Immediately after:

| read | value |
|---|---|
| `GET /api/org/loop` → `active` | `null` |
| run `77feadf4-…` | `stopped` · `model: "sonnet"` · `effort: "low"` |
| `GET /api/org/local/drive` → `drives[0]` | `drive_mteabnve_jony2t` · **`interrupted`** · `error: "Interrupted — the server restarted while this drive was pulling. Resume it to continue against the same run budget."` |

The model/effort pair surviving on the row is L1-4's persistence claim confirmed against a process
that no longer exists — the one condition under which an env var could not have recovered it.

**The cockpit offered it back.** `live-drive-resume.spec.ts` test 1, **passed in 44.5 s** (cold
webpack compile of `/org/[slug]`):

- `[data-testid="drive-interrupted"]` visible, reading **"Drive · Interrupted"**;
- the sentence that makes "not auto-resumed" true on screen: *"…the drive itself stopped and **was not
  resumed on its own**"*;
- **"0/3 runs spent"** — the dead process finished no run, and the banner counts against the budget
  the operator granted, not against the segment;
- the **inspector still underneath it**. It is a banner, not a mode — Priya can ignore the offer and
  select a different scope, which is the design claim `CockpitDriveResume`'s header makes.

**Resuming continued the chain.** Test 2 pressed the banner's own button:

```
drive_mteapxb0_xofr73   phase=dry   resumedFrom=drive_mteabnve_jony2t   runsBefore=0   maxRuns=3
drive_mteabnve_jony2t   phase=interrupted                                (unchanged — the record of what died)
```

`resumedFrom` points at the interrupted drive, `runsBefore` carries its spend, `maxRuns` is the same
budget. The rope cannot be re-granted by crashing, which is the claim.

> **A real wrinkle, recorded rather than smoothed over.** The **first** click of Resume after a cold
> `page.goto` fired **no request at all** — no POST reached the server, no error appeared, the banner
> simply did nothing. The banner is server-rendered, so `drive-resume` is visible *and enabled* in the
> HTML before React has hydrated and attached its `onClick`; a click landing in that window is
> swallowed in silence. On a warm page the first click worked (test 2 passes in 3.6 s). This is
> generic Next.js SSR behaviour rather than a bug in the drive, but it is expensive here in a way it
> is not elsewhere: the operator's mental model is "I pressed Resume and the machine ignored me". The
> spec now retries the click deliberately and says why. Finding **L2-C-01**.

### L2-C.2 — the backlog claims

The zombie-claim failure is the reason `boot-sweep.ts` exists ("drive #2 found *no open follow-ups*
on a fleet with 350 points of debt"), so certifying the sweep without certifying the claim release
would certify half of it. **The lane the kill above interrupted was a `foundation` lane, which claims
nothing** — only a `backlog` lane calls `updateRecommendation(… status: "in_progress")`
(`loop-lane.ts:228`). So it was exercised separately, on the real-engine fixture whose scan produces
real follow-ups, with `CLAUDE_CLI_PATH` pointed at a stub that hangs instead of a real model session —
zero model spend, a genuinely held claim.

**Result — proven, and cleanly.** With the org backlog carrying 9 tracked rows, a run was armed at
`maxCycles: 2` so cycle 2 would be a `backlog` lane by the engine's own cycle rule, and
`CLAUDE_CLI_PATH` pointed at a node script that drains the prompt and never answers:

| moment | `GET /api/org/backlog?org=l2loop` |
|---|---|
| before the run | `open=8  inProgress=0` |
| cycle 2 armed, agent hanging | `open=4  **inProgress=5**` |
| `taskkill /F` at **11:51:31.500Z**, then restart | `[loop] boot sweep: 1 loop run stopped — a previous process died while they were in flight.` |
| after the sweep | `open=9  **inProgress=0**` |

Five claimed rows, a process killed while holding them, and all five back to `open` — no zombie
`in_progress`, and `GET /api/org/loop/propose` returned its 5 items again. **This is the exact
failure `boot-sweep.ts` was written against ("drive #2 found *no open follow-ups* on a fleet with 350
points of debt"), reproduced and then shown to be closed.** Zero model spend: the "agent" was a stub.

> **A free by-product worth recording, because the journey lists it as a known gap.** The orphaned
> stub processes were still on the process table after the kill, so their argv could be read directly:
>
> ```
> node stub-hang.mjs -p --output-format json --permission-mode acceptEdits --model sonnet --effort low
> node stub-hang.mjs -p --output-format json --model opus
> ```
>
> The first is the **agent** seam carrying the operator's own per-run pick — so *"the agent's
> `--effort` is passed unprobed"* is no longer unprobed: **the flag reaches the CLI, with the chosen
> level**. The second is the **assessment** seam (`claude-cli.ts`), with no permission flag and a
> different model. The two seams `agent.ts`'s header insists are separate are visibly separate on
> the process table.

---

## L2-E — merge and iterate

Five consecutive iterations on `ascent-l2/loop-fixture`, each: propose → run one bounded cycle →
merge the branch the run left → rescan. **The lane kind changed under the rule every time**, which is
the claim (`proposeLaneKind` reads the paired working copy, so it keeps proposing until a human
merges — the operator's half of the loop is real work, not a formality).

| # | proposed kind | practice | branch left | overall after merge | level |
|---|---|---|---|---|---|
| 1 | `foundation` | — | `ascent/loop-202608291113-…` | 19 → **24** | L1 |
| 2 | `practice` | `agent-guidance` | `ascent/loop-202608291119-…` | 24 → **32** | L1 → **L2** |
| 3 | `practice` | `docs-adrs` | `ascent/loop-20260829112809-…` | 32 → **36** | L2 |
| 4 | `practice` | `legible-history` | `ascent/loop-20260829112815-…` | 36 → **38** | L2 |
| 5 | `backlog` | — | *(not run — an agent lane)* | — | L2 |

Fleet debt fell 419 → **293** across the five, and `GET /api/org/local/projects` reported the mapping
state and per-repo greenness on the same read throughout (L1-12), including
`unmeasurable: ["D2","D3","D4"]` on every reading.

**Two things this iteration walk turned up that the mock e2e suite cannot reach:**

1. **The branch-name collision — fixed in this run** (`044d7dc5`). See the section below; iterations 3
   and 4 above are the *verification* of that fix, six seconds apart in the same clock minute.
2. **The loop runs out of moves before it runs out of debt.** At iteration 5 the repo still carried
   **293 points of debt across six dimensions with gaps** (D6 at 85, D8 at 56, D9 at 56, D5 35, D1 31,
   D7 30) and the proposal was `backlog` with **`items: []`** — an agent lane with nothing to dispatch.
   Under the per-lane early-stop rule that produces a run with no commits and no closed rows, and a
   drive reads that as `dry`. **This one is honestly uncertain**: every scan in this phase was the
   deterministic mock, whose recommendation set is a corpus property, and the real-engine phase's very
   first backlog lane dispatched **5** follow-ups from a real scan. So the evidence says the empty
   batch is a *mock-corpus* artifact rather than a product dead-end — but the failure *mode* it
   demonstrates (a `backlog` lane proposed with an empty batch, rather than the panel saying there is
   nothing to work) is real code with no guard. Finding **L2-E-01**.

---

## L2-F — the blocked states, for real

`live-setup-blocked.spec.ts`, driven against the same build booted with **`ASCENT_AUTOPILOT=0`** —
**passed in 30.3 s**:

- the server's own answer first: `GET /api/org/loop?org=l2loop` → `{"enabled": false, …}`;
- the rail renders **"Loop disabled on this deployment"**, names **`ASCENT_AUTOPILOT=1`**, and adds
  **"Restart the server after setting it."** — the one next action, stated;
- the chart underneath is **still readable** ("The fleet, in adoption × rigor"). The field is never
  hidden behind a setup state, which is the panel's stated design;
- no second state claims the rail at the same time;
- and the dispatch door agrees with the card rather than 500-ing behind it: `POST /api/org/local/drive`
  → **409** with `error` matching `/ASCENT_AUTOPILOT/`.

**One of five.** `hosted`, `no-repos`, `not-owner` and `unpaired` were **not** driven live. `unpaired`
is covered by the mock suite at the route (`409 … not paired`); the other three need a different
deployment shape (managed cloud), a different org, or a non-owner session, and each is a separate
boot. Recorded as remaining work rather than claimed.

---

## L2-A — a real agent lane

**The one paid run.** `ascent-l2/bare-svc` — a two-function Node service with **no README, no CI, no
tests and no `.ai/`** — mapped, paired, and scanned for real (`LLM_PROVIDER=claude-cli`, subscription
auth, `ANTHROPIC_API_KEY` stripped). First scan: **1 m 40 s → overall 4, L1**, `engineProvider:
"claude-cli"`, `engineModel: "opus"`, `engineDegraded: false`. Then one run, two cycles, armed from
the cockpit's own dials as `sonnet` / `low`:

```
POST /api/org/loop {"action":"start","org":"l2loop","repos":["ascent-l2/bare-svc"],
                    "maxCycles":2,"concurrency":1,"model":"sonnet","effort":"low"}
```

| | |
|---|---|
| **cycle 1** — `foundation` lane | 11:34:08 → 11:36:08. Installed **10 files**, **1 commit** landed on `ascent/loop-20260829113408-ascent-l2-bare-svc`, then a real rescan. No agent session, exactly as designed. |
| **cycle 2** — `backlog` lane | 11:36:08 → 11:44:31. **5 follow-ups claimed and dispatched** to a real `claude -p` session (sonnet, low). The session ran **5 m 46 s** and was observed mid-flight writing `AGENTS.md` (2,560 bytes) and a `test/` directory into the worktree. |

### And then it could not commit any of it

```
11:41:54  Agent finished: All work is complete in the working tree but I'm unable to run
          `git add`/`git commit` in this sandboxed session — write git operations are blocked
          by the approv
11:41:54  0 commit(s) landed this cycle.
```

**An agent's own claim is not evidence** (this journey's Fowler reference, applied to the failure as
well as to the success), so the mechanism was reproduced outside Ascent entirely — a fresh throwaway
git repo, the exact flags `runClaudeAgent` passes, and the simplest possible instruction:

```
$ claude -p --output-format json --permission-mode acceptEdits --model haiku
  "Create probe.txt containing 'ok', then commit it with git add && git commit."

{"is_error": false, "subtype": "success", "num_turns": 4, "total_cost_usd": 0.029,
 "duration_ms": 22357,
 "result": "I need permission to run the git commands. The system is asking for approval to
            execute `git add` and `git commit`. Please approve these operations in the
            permission prompt…"}

$ git log --oneline      -> only `init`
$ git status --porcelain -> ?? probe.txt        # the FILE was written; the COMMIT was refused
```

`--permission-mode acceptEdits` auto-accepts **edits** and not **Bash**, and headless `-p` has nobody
to answer the prompt it raises instead. So the lane's own brief —

> *"You are in an isolated worktree on branch `…` — **commit directly to it, one commit per resolved
> item, each carrying its trailer**."*

— asks for the one action the flags make impossible. `agent.ts`'s header chose `acceptEdits` over
`--dangerously-skip-permissions` deliberately, calling worktree isolation "the real blast-radius
bound" and this flag "the second belt". The belt is fastened through the deliverable.

**What that cost, concretely.** `removeLoopWorktree` runs `git worktree remove --force` on the way
out. The temp checkout is gone; `git ls-tree` on the branch shows only the foundation's 13 files;
`AGENTS.md` and `test/` exist nowhere on this machine. **Verdict: L2-A FAIL** — the loop's brief does
not survive contact, and the journey's own definition of done ("a branch on her machine she can read,
diff and merge") is not met for an agent lane.

The second half of L2-A — *"does a claimed `Ascent-Resolves:` trailer get refused when the dimension
did not move?"* — is **unreachable behind this**: no commit means no trailer to adjudicate.
`0 follow-ups closed` is the correct output for the run that happened, and says nothing about the rule.

---

## L2-B — an attributable lift

Both ends of both comparisons were real: `engineProvider: "claude-cli"`, `engineModel: "opus"`,
`engineDegraded: false`, `platformSignals.source: "unavailable"`. This is the pairing the mock e2e
suite is structurally unable to produce, and it behaved:

| lane | before → after | delta | vs ±2 band | commits |
|---|---|---|---|---|
| cycle 1 · `.ai/ foundation` | 4 → 19 | **▲+15** | outside → **attributable** | **1** |
| cycle 2 · `backlog` | 19 → 43 | **▲+24** | outside → **attributable** | **0** |

**The positive claim holds.** A real repository change, measured by a real engine on both ends,
cleared the noise band and printed a coloured delta — with the provenance beside it rather than
buried under it. The rendered ledger for cycle 1, verbatim from the live rail:

```
32 gaps closed · 0 follow-ups closed · 1 commits   ascent/loop-20260829113408-ascent-l2-bare-svc
engine claude-cli · opus
D2/D3/D4 not measurable locally
widened D2, D3 . The model flagged the detector as suspect on D2, D3, so its guardband there was
                 DOUBLED. … a run-over-run delta on them carries materially less confidence.
blend 95%      . Only 95% of the model's usual weight was applied (0.57 against a configured 0.6),
                 because the ingest read a fraction of the repository. A thinner read shifts the
                 score toward the deterministic signal with zero repository change.
```

That is L1-7 confirmed live and then some: the ledger volunteers **three** distinct reasons a delta
might be less trustworthy than it looks, unprompted, on a run that succeeded. It is the best thing
this journey found.

**And the counter-case, on the same screen.** The run's headline is

```
▲+39   ATTRIBUTABLE LIFT   2 improved · 0 flat · 0 regressed     sonnet · low effort
…
ascent-l2/bare-svc     19 → 43  ▲+24
  AI Tooling ▲+55 · Testing ▲+13 · CI/CD ▲+30 · Docs ▲+30 · Quality ▲+38 · AI Process ▲+20
  31 gaps closed · 0 follow-ups closed · 0 commits   ascent/loop-20260829113408-…
```

**`▲+24 ATTRIBUTABLE LIFT` and `0 commits`, three lines apart**, for work that no longer exists. The
after-scan (`58f8b083`, overall 43, **L2**) was taken from a worktree holding the agent's uncommitted
edits, which were then deleted — and that scan is now the repo's *latest reading*, so the fleet's
greenness and debt credit `bare-svc` with a standard it does not have.

`attribution.ts` is doing exactly what it says: it rules out an **engine swap** and **model wobble**,
the two ways a score moves without the repository moving. It has no third test for *durability* —
whether the thing it measured still exists — because until now nothing could produce a measurement of
a worktree that was about to be discarded. Finding **L2-B-01**, and the sharpest form of this
journey's own DX Core 4 warning: a number the operator cannot act on is worse than no number.

**Not driven:** the "unchanged repository prints `within noise` twice in a row" half. It needs two
further real scans of an identical commit, and the pipeline's `deduped` path would have to be
defeated first. **L2-B is therefore `pass (partial)`.**

---

## Model spend for this run

| call | engine | duration |
|---|---|---|
| first scan of `bare-svc` | `claude-cli` assessment, opus | 1 m 40 s |
| cycle 1 rescan | `claude-cli` assessment, opus | 1 m 59 s |
| **the agent session** | `claude -p`, **sonnet**, `--effort low` | 5 m 46 s |
| cycle 2 rescan | `claude-cli` assessment, opus | 2 m 37 s |
| the permission probe | `claude -p`, haiku, 4 turns | 22 s · **$0.029** |
| one assessment aborted mid-flight by the L2-C.2 kill | `claude-cli`, opus | ~3 s |

**Five completed model calls and one aborted** — one agent session, four assessments, one probe.
Everything else in this certification (the whole mock phase, the drive kill and resume, the
claim-release proof, every foundation and practice lane) ran on the deterministic mock or on a stub
CLI and spent nothing.

> Worth noting for the ledger's own honesty: the outcome header shows **`sonnet · low effort`** while
> each lane row shows **`engine claude-cli · opus`**. Both are true and they describe different things
> — the agent the operator armed, and the model that scored the result — but nothing on screen says
> which is which. Finding **L2-B-02**.

---

## Product findings

| id | severity | finding |
|---|---|---|
| **L2-A-01** | **blocker** | `runClaudeAgent` spawns with `--permission-mode acceptEdits`, which cannot run `git add` / `git commit` headlessly, while the lane's brief instructs the agent to commit. Every backlog lane's work is written into a worktree that is then `--force`-removed. Minimal repro above (22 s, $0.03). **Two candidate fixes, both decisions rather than typos:** (a) allow exactly the git verbs the brief needs via `--allowedTools`, widening what an unattended agent may execute; (b) have the lane commit on the agent's behalf, as `lane-install.ts` already does for foundation and practice lanes — safer, but it loses the per-item `Ascent-Resolves:` trailers the adjudication reads. **Deliberately not fixed in this run:** it is a security-surface decision, and verifying either option costs another live agent session. |
| **L2-B-01** | **high** | The outcome ledger prints `ATTRIBUTABLE LIFT ▲+24` for a lane with `0 commits`, and the after-scan behind it becomes the repo's latest reading — so the fleet's greenness and debt credit the repo with work that no longer exists. `attributeScores` tests the engine and the noise band; nothing tests whether the measured state is durable. Suggested shape: a lane with no commits contributes nothing to a run's headline lift, and its scan is not adopted as the repo's standing. |
| **L2-C-01** | medium | The `Resume drive` button is server-rendered and enabled before hydration attaches its handler; a click in that window is swallowed with no request, no error and no state change. Observed once on a cold page; the live spec now retries deliberately and says why. Generic Next.js behaviour, unusually expensive on this particular control. |
| **L2-C-02** | low | A killed lane leaves its **temp worktree on disk**. `removeLoopWorktree` runs in the lane's `finally`, which a `taskkill /F` never reaches, and the boot sweep reconciles database rows but nothing on the filesystem. This run left 3 dangling `%TEMP%\ascent-loop-*` checkouts (~15 MB each, removed by hand); the operator's own machine was already carrying 4 more from 2026-08-26, which is the accumulation this predicts. The boot sweep is the natural place: it already knows every run it just marked `stopped`. |
| **L2-E-01** | medium *(uncertain)* | A `backlog` lane can be proposed with `items: []` — an agent lane with nothing to dispatch — while the repo still carries 293 points of debt across six dimensions. Seen only under the deterministic mock, whose recommendation set is a corpus property; the real engine's first backlog lane dispatched 5 items. So the *empty batch* is probably a mock artifact, but the *proposal* has no guard either way: the curation panel should say "nothing left to work" rather than offer a lane the run then early-stops. |
| **L2-F-02** | medium | `agent.ts` strips `ANTHROPIC_API_KEY` from the spawn env but not `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT`. A self-hosted Ascent started from inside a Claude Code session hands the harness's own markers to every agent it spawns, and a nested `claude` that inherits them produces nothing, silently. The file already documents the sibling collision (`CLAUDE_EFFORT` — which is why the effort var is named `ASCENT_AGENT_EFFORT`); this is the same hazard, one variable over. |
| **L2-B-02** | low | `sonnet · low effort` (the agent) and `engine claude-cli · opus` (the scorer) sit on the same outcome panel with nothing saying which is which. |
| **L2-E-02** | low *(design question)* | `measureDrive` reads each repo's **latest scan**, and a lane's worktree rescan is persisted as one — so a drive's debt falls the moment a lane rescans, before anything is merged. Observed: `debtBefore 419 → debtAfter 400` on a run whose only output was an unmerged branch. Defensible (it measures what the loop achieved) but it means "drive to green" can report progress the operator's `main` has not received. |

### Fixed in this run

| commit | what |
|---|---|
| `044d7dc5` | **The run branch could collide with itself, and a drive read the wreck as a plateau.** `runStamp` was minute-resolution, so a drive's back-to-back runs asked for one branch name; the second lane died before it had a worktree and the drive reported `dry`. Now seconds, plus a collision suffix; verified live by two runs six seconds apart inside one minute. |
| `2959be4c` | **A lane that lost its agent's work said the same thing as a lane that had none.** A backlog lane ending with zero commits now names the uncommitted changes it is discarding and the branch they are not on, and the agent's own first line gets 400 characters instead of the 160 that cut this run's explanation off mid-word. Makes L2-A-01 legible; does not fix it. |

### Not run, and why

- **L2-D** (the GitHub-side platform carry with a real token). Both fixtures are local-only git repos
  that do not exist on GitHub, and every scan ran `noAmbientToken`, so there was never an observed
  fold to replay. The *absence* half was confirmed on every single scan
  (`platformSignals.source: "unavailable"`, `D2/D3/D4 not measurable locally`, and those three
  dimensions excluded from the green verdict rather than scored at a floor). Needs a real repo, a
  token, and a scan pair either side of a loop run.
- **Four of the five `CockpitSetup` states** (`hosted`, `no-repos`, `not-owner`, `unpaired`). Each
  needs a different deployment shape, org or session; `autopilot-off` was driven for real, and
  `unpaired` is covered at the route by the mock suite.
- **The `within noise` half of L2-B** — see above.

### An environment fault worth writing down (not a product defect)

Every local rescan failed at first with
`Unknown field 'engineDegraded' for select statement on model 'Scan'`. The cause is the junctioned
`node_modules`: the shared Prisma client had been generated from the **main checkout's** branch
(`fix/gate-lint-unescaped-entities-20260827`), which predates `Scan.engineDegraded`,
`scoreIntegrityJson`, `platformSignalsJson`, `LoopRun.model/effort` and the whole `LoopDrive` model.
`npx prisma generate` from this worktree resolves its output through the `@prisma/client` package —
which the junction points at the main checkout — so the regeneration landed in the **shared**
`node_modules/.prisma/client`. That is strictly additive (`master`'s schema is a superset of the
sibling branch's, added fields only) and it also unblocks the operator's own `run-master` server,
which shares the same junction and would have hit the identical error on any local scan.

---

# The L2-A re-verdict — 2026-08-29, after the fix

The three product findings this run could fix without a second certification were fixed on this same
branch, and the blocker was **re-driven live, once**. This section is appended rather than woven in:
the run above is a record of what was true that afternoon, and editing it to read as though the
failure never happened would destroy the only thing it is for.

| commit | finding | what changed |
|---|---|---|
| `58cb4b34` | **L2-A-01** | The LANE commits the agent's work. The agent's permission grant is unchanged. |
| `9033308b` | **L2-B-01** | A lane with zero commits does not rescan, so nothing it measured is adopted; and on the read side such a pair is refused with its own verdict (`undelivered`) instead of counting toward the lift. |
| `0a8be67b` | **L2-C-02** | The boot sweep removes the temp worktrees belonging to the runs it just stopped. |

## The decision on L2-A-01, recorded because it is reversible

The finding named two candidate fixes: **(a)** widen `--allowedTools` so the agent may run `git add`
/ `git commit`, or **(b)** have the lane commit on the agent's behalf, as `lane-install.ts` already
does for the deterministic kinds.

**(b) was taken, as the reversible default.** `agent.ts`'s own header chose `acceptEdits` over
`--dangerously-skip-permissions` deliberately, calling worktree isolation "the real blast-radius
bound" and the flag "the second belt"; an unattended agent that may execute git is a materially wider
grant than one that may only write files, and this run is not the place to widen it. (b) also costs
nothing the loop was relying on — it is the agent lane adopting the shape its two siblings had.

The cost (b) had to pay was the one the finding predicted: the per-item `Ascent-Resolves:` trailers
are what the adjudication reads, and only the session knows which items it resolved. So the brief now
asks it to end with `RESOLVED: <id>` / `SKIPPED: <id>` lines, and the lane turns those into trailers.
Naming nothing trails the whole armed batch; naming only skips trails the rest. That is a claim, not
a verdict — the movement-gated resolve rule still decides.

## How the re-verification was run

Same isolation discipline as the run above, a **second** throwaway everything:

| | |
|---|---|
| Server | `npx next dev --webpack -p **3221**`, started and killed by this pass. The operator's `:3210` was never touched, and neither was the L2 run's `:3220`. |
| Database | `PGLITE_DATA_DIR=%TEMP%\ascent-l2b\pglite` — a third scratch dir. |
| Env | `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_SSE_PORT -u CLAUDE_EFFORT -u CLAUDE_CODE_SESSION_ID -u ANTHROPIC_API_KEY -u CLAUDE_MODEL -u ASCENT_AGENT_EFFORT`, then `ASCENT_LOCAL_ORG=l2bloop ASCENT_SELF_HOSTED=1 ASCENT_AUTOPILOT=1 ASCENT_AUTH_BYPASS=1 ASCENT_OPEN_ORG_DASHBOARDS=1 GITHUB_TOKEN="" LLM_PROVIDER=claude-cli`. |
| Subject | `ascent-l2b/agentfix` — a new scratch repo: two pure functions (`subtotal`, `total`), a README, a `package.json` with no `test` script, **no tests, no CI, no `CLAUDE.md`**. It carries `.ai/manifest.yaml` and a `docs/TESTING.md` scaffold deliberately, so `proposeLaneKind` skips the foundation and practice rules and proposes the **`backlog`** lane on cycle 1 — the agent lane, which is the only thing under test. |
| Run | `POST /api/org/loop {"action":"start","org":"l2bloop","repos":["ascent-l2b/agentfix"],"maxCycles":1,"concurrency":1,"model":"sonnet","effort":"low"}` |

First scan: **95 s**, overall **5**, **L1**, `claude-cli` / opus, `engineDegraded:false`.

## What happened — L2-A: **PASS**

The run: armed `12:31:01Z`, ended `12:35:38Z` (**4 m 37 s**). The agent session ran `12:31:02 ->
12:32:59` (**1 m 57 s**); the rescan `12:32:59 -> 12:35:38` (**2 m 39 s**).

**The permission posture is unchanged, and the session said so itself.** Verbatim from the lane log:

```
12:31:02  Cycle 1: dispatching 5 follow-up(s) to a local agent…
12:32:59  Agent finished: Given no shell approval was available in this session, I could not
          execute `npm test` to confirm the suite passes, but the assertions are straightforward
          and the one floating-point value is the well-known IEEE-754 result of `0.1+0.1+0.1`.
12:32:59  The lane committed the agent's 5 change(s) on
          ascent/loop-20260829123101-ascent-l2b-agentfix — 4 Ascent-Resolves trailer(s) from the
          session's own RESOLVED/SKIPPED lines.
12:32:59  1 commit(s) landed this cycle.
12:32:59  Rescanning the worktree from disk…
12:35:38  4 follow-up(s) closed by trailer
```

That first line is the same wall the L2 run hit — the agent still cannot run a shell. The difference
is the second one.

**The deliverable is on the branch.** In the operator's own repository, after the run and after
`removeLoopWorktree --force`:

```
$ git log -1 ascent/loop-20260829123101-ascent-l2b-agentfix
b690797828341b05e20088b9b78297619a161a5b

$ git show --stat --format= b6907978
 .github/workflows/ci.yml | 43 ++++++++++++++++++
 CLAUDE.md                | 40 ++++++++++++++++
 docs/TESTING.md          | 13 ++++--
 package.json             |  3 ++-
 src/index.test.js        | 31 +++++++++++++
 5 files changed, 125 insertions(+), 5 deletions(-)
```

**The trailers, verbatim from the commit body** — four, and *not* five:

```
Ascent-Resolves: 6a2f4a23-b15e-405c-a631-29ad7c59dfaa
Ascent-Resolves: 9e5d47c6-a244-4228-b4a5-72123dea001c
Ascent-Resolves: 80704f35-0136-4fd9-a380-3a4b44a1a239
Ascent-Resolves: 91a34e78-593c-4c71-a4c3-d116b946a950
```

The armed batch was **five** rows. The session wrote `RESOLVED:` for four and `SKIPPED:` for the
fifth (`72be4dd8`, D4), and the lane honoured that: the skipped id carries no trailer, and the commit
body says so in prose. **This is the second half of L2-A, which the original run could not reach at
all** ("no commit means no trailer to adjudicate") — the claim was made per item, by the agent, and
the adjudication read it.

**And the adjudication then did its job, in both directions.** `closedIds` on the lane:

```
6a2f4a23…  9e5d47c6…  80704f35…  91a34e78…
```

Four claimed, four closed by trailer. The fifth was never claimed, so it is still open. The rescan
moved the repo **5 -> 38**, engine `claude-cli` / opus on both ends, `engineDegraded:false`.

**The ledger includes it, and the history strip agrees.** `GET /api/org/loop?org=l2bloop`:

```
{"id":"908f26bc","phase":"done","lift":33,"model":"sonnet","effort":"low",
 "repos":["ascent-l2b/agentfix"]}
```

`lift: 33` is the run's headline, and it is there *because* `commits: 1`. Driving the same real scan
pair through the rule with the commit count forced to zero — the L2 run's exact situation — shows the
other side:

```
live lane   commits=1 -> {"kind":"attributable","delta":33}  | label: ""
same pair,  commits=0 -> {"kind":"undelivered","delta":33}   | label: "not attributable: nothing
                                                                was committed, so what this
                                                                measured no longer exists"
```

So **L2-B-01's headline is closed at the read side as well as the write side**: the number the L2 run
printed beside `0 commits` can no longer be printed, and the scan behind it is no longer taken at all.

## L2-C-02, re-driven for free

Verified in the same instance with **zero model spend**, using the same stub trick as L2-C.2:
`CLAUDE_CLI_PATH` pointed at a node script that drains its prompt and never answers, so a lane sits
holding a real worktree indefinitely.

| moment | observation |
|---|---|
| lane in flight | `git worktree list` in the paired repo: `%TEMP%\ascent-loop-8b8qtd  [ascent/loop-20260829123739-ascent-l2b-agentfix]` |
| `taskkill /F` at `12:37:57.101Z` | the directory is still on disk and populated (`README.md`, `docs/`, `package.json`, `src/`) — the `finally` never ran, exactly as the finding says |
| restart | `[loop] boot sweep: 1 loop run stopped, 1 stranded worktree removed — a previous process died while they were in flight.` |
| after the sweep | `ascent-loop-8b8qtd` **gone**; `git worktree list` back to the paired checkout alone; **both branches still present** |

And the negative half, which is the one that matters: the machine was carrying **four** other
`%TEMP%\ascent-loop-*` directories dated 2026-08-26, from the operator's own earlier runs. **All four
are untouched.** They belong to no run in this database, so the branch-driven sweep never considers
them — which is precisely the property that makes it safe to run at every boot.

## What this pass did NOT establish

- **L2-D is still not run.** Nothing here involved GitHub or a token.
- **The `within noise` half of L2-B is still not driven.** It needs two real scans of an identical
  commit and the `deduped` path defeated first.
- **The four un-driven `CockpitSetup` states** are unchanged.
- **The lane's commit runs the repo's hooks and needs a git identity.** The fixture had both. A repo
  with a failing `pre-commit` hook, or no `user.email`, falls back to the lost-work log rather than
  to a retry — recorded in `live.md` § Known gaps rather than fixed speculatively.
- **One commit per lane cycle, not per resolved item.** The old brief asked for one commit per item;
  the lane writes one commit carrying every claimed trailer. Per-item commits would need the session
  to delimit its own work item by item, which nothing asks it to do.

## A new finding this re-run produced

| id | severity | finding |
|---|---|---|
| **L2-A-02** | low | **The lane's commit subject is the agent's first line, and an agent's first line is often a caveat.** This run's read `fix: Given no shell approval was available in this session, I could not` — a truncated apology standing where a summary belongs, on a commit whose body is excellent. The subject is bounded, de-marked-down and skips `RESOLVED:`/`SKIPPED:` lines, but it cannot tell a summary from a hedge. Either ask the session for an explicit one-line subject, or compose one from the closed items' titles. |
