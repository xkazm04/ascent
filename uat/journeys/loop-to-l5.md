---
character: Priya (Platform/DevEx Lead)
goal: "Point the loop at our repos and iterate them from zero to green — scan, take the proposed lane, run it, see whether the number actually moved because of us, and go again — without babysitting it and without a mandate."
promotion: discovery
seed: self-hosted local mode — ASCENT_SELF_HOSTED=1 + ASCENT_AUTOPILOT=1 + ASCENT_LOCAL_ORG=<slug> + ASCENT_AUTH_BYPASS=1 + ASCENT_OPEN_ORG_DASHBOARDS=1, an embedded PGlite database (PGLITE_DATA_DIR), and at least one repo mapped AND paired to a real checkout via POST /api/org/local/projects. Entry: /org/<slug>?tab=live. See uat/env.md; the machine-checkable half of this seed is `playwright.loop.config.ts`.
references:
  - https://octopus.com/blog/paved-versus-golden-paths-platform-engineering — adoption must be EARNED. The loop passes only if the shortest path to the standard is "select the repo and press Run", not a 7-hop detour to a draft-PR door.
  - https://www.opslevel.com/resources/cortex-vs-backstage-whats-the-best-internal-developer-portal — a scorecard rollout must hand the team the fix, not the red square. Here the "fix" is a branch on their own machine, and the journey fails if reviewing/merging it is not obvious.
  - https://newsletter.getdx.com/p/introducing-the-dx-core-4 — the number has to read as friction-to-remove. A loop that reports a lift it cannot attribute turns the number into theatre, which is worse than a stick.
  - https://martinfowler.com/articles/exploring-gen-ai.html — an agent's own claim of completion is not evidence. Priya's trust bar here is specifically: what verified this, and would I have believed it without the verification?
---

## Trigger (why now)

Priya has the fleet number and the roadmap; what she does not have is the hours. Her platform team is six people and she has been asked to move "every team" to the AI-native standard by quarter end. She has heard that a self-hosted Ascent can run the improvement loop *on her own machine, against real checkouts* — install the standard, work the backlog, rescan, repeat — and she wants to know whether that is a real path from L1 to L5 or a demo. She is deliberately trying it on a repo she does not care about first, because she has been burned by agents that "finished" work nobody could review.

## Definition of done (their POV)

- She can get a repo **into the loop** — mapped, paired to a folder on disk, scanned — without reading source or guessing an env var, and she can see the mapping state afterwards rather than hoping.
- The cockpit **tells her what it would do before it does it**: which repos she has selected, what each lane would work, and — when the repo has no `.ai/` standard — that the first lane is going to *install the standard*, not spend an agent session guessing.
- She can **bound the run** (cycles, lanes at once) and **choose what it is run as** (model, effort) before she presses anything, and afterwards she can see which configuration produced which result.
- When it settles, the ledger tells her **what moved and whether the movement is hers**. A number the app cannot attribute must be refused out loud, with the reason — a mock engine, a movement inside the noise band, a dimension it could not measure locally.
- The output is **reviewable**: a branch on her machine she can read, diff and merge, never a push.
- She can **go again without rebuilding the setup** — the selection survives the outcome, and the next proposal reflects what she just merged.
- Optionally: she can hand it the **rope** ("drive to green") and leave, and when she comes back — including after her laptop slept and the server restarted — the app tells her honestly what happened rather than showing a job nobody is driving.

## Out of scope

- The managed-cloud path. The loop is self-hosted only by construction (it reads the filesystem and spawns processes); the hosted setup state is a *different* journey and its own gap.
- The quality of an individual agent session's code. This journey certifies the loop *around* the agent — proposal, bounds, verification, attribution, deliverable — not whether one `claude -p` session wrote good tests.
- Live-model scoring nuance. A mock or CLI engine is sufficient; the attribution rule's job is precisely to say when the engine makes the number uncomparable.
- Billing, credits, and the public funnel. Local mode is unmetered by construction.

## Discovery hints

Entry point(s): `/org/<slug>?tab=live` (the Loop Cockpit is the default view; `?view=wall` is the old war room). Getting there via `?tab=pairing` first is a legitimate path and the order she finds is itself a finding. Do NOT script the steps.

---

## L1 checks — the seams this branch built (theoretical, over the code-derived surface model)

Each is a claim the surface model must support, with the code that has to back it. An L1 pass means the
seam exists and is reachable from where Priya starts; it does **not** mean it works live.

| # | Claim | Where it has to hold |
|---|---|---|
| L1-1 | A repo with no `.ai/manifest.yaml` is proposed a **foundation lane**, and the curation panel says so *before* the run — with the reason, and with "no rows to curate" instead of an empty batch. | `src/lib/local/lane-kind.ts` (`proposeLaneKind` rule 1) · `src/app/api/org/loop/propose/route.ts` · `cockpit/CockpitBatch.tsx` (`laneKindTag`) |
| L1-2 | The proposal and the engine cannot disagree: **one rule, two callers**, re-read at arm time rather than trusted from the wire. | `src/lib/local/loop-engine.ts` `startLoopRun` (`laneKind(path, …)`) |
| L1-3 | A foundation/practice lane **spends no agent session** and goes through the *same generators* as the cloud draft-PR doors — install, commit, then the identical rescan and adjudication. | `src/lib/local/lane-install.ts` · `install-files.ts` (collision policy copied from `openDraftPr`) |
| L1-4 | The run is **bounded and armed explicitly**: cycles, lanes at once, and — new — **agent model and effort**, resolved at arm time and persisted on the row. | `cockpit/CockpitRunControls.tsx` · `src/lib/local/agent-options.ts` · `src/lib/local/agent.ts` `resolveAgentConfig` |
| L1-5 | The outcome ledger **prints the configuration beside the lift**, and prints nothing for a run recorded before those columns existed. | `cockpit/CockpitOutcome.tsx` · `agentConfigLabel` |
| L1-6 | A movement the app cannot attribute is **refused, in words**: `not attributable: mock scan` / `within noise (±2)` / `not measured`, and the per-dimension deltas inherit the row's verdict. | `src/lib/maturity/attribution.ts` (`attributeScores`, `attributionLabel:186`) · `cockpit/CockpitOutcomeLedger.tsx` |
| L1-7 | A worktree rescan **carries the GitHub-side platform fold or declares it missing** — `platform signals from scan <id>, <age>` / `D2/D3/D4 not measurable locally` — and the unmeasurable dimensions are excluded from the green verdict rather than scored at a floor. | `src/lib/analyze/platform-carry.ts:141` · `src/lib/maturity/green.ts` (`repoGreenness().unmeasurable`) |
| L1-8 | "Drive to green" is **reachable from the cockpit** (it was curl-only), and shares the loop's gate — one predicate for both. | `cockpit/CockpitDrivePanel.tsx` · `cockpit/useDrive.ts` · `cockpit/cockpitGate.ts` (`cockpitSetupState`) |
| L1-9 | Loop and drive state **survive a restart**: a `running` row a dead process left behind is reconciled at boot, its backlog claims released, and an interrupted drive is **offered back, never auto-resumed** — with the run budget belonging to the chain, not to a segment. | `src/lib/local/boot-sweep.ts` · `src/instrumentation.ts` `register()` · `cockpit/CockpitDriveResume.tsx` · `src/lib/local/drive-types.ts` `resumeParams` |
| L1-10 | The **branch is the deliverable** and the operator's own checkout is never touched, never pushed. | `src/lib/local/loop-worktree.ts` |
| L1-11 | Every blocked state **names the one next action** rather than hiding the cockpit: hosted · no-repos · not-owner · autopilot-off · unpaired. | `cockpit/CockpitSetup.tsx` |
| L1-12 | She can ask "what is mapped right now, and where does it stand" in **one read** before deciding anything. | `src/app/api/org/local/projects/route.ts` (`GET` + greenness) |

**Machine-checked subset.** `e2e/loop/cockpit-loop.spec.ts` (config `playwright.loop.config.ts`) drives
L1-1, L1-2, L1-3, L1-4, L1-5, L1-6, L1-7, L1-10, L1-12 for real against a live server and a real git
fixture repo — and it asserts the *refusal* in L1-6, because every scan it produces is a mock scan.
L1-8 is asserted as reachable but not started; L1-9 and L1-11 are **not** covered by it (see below).

## L2 confirmations — what only a live run can settle

These are the ones Priya's verdict actually turns on, and none of them can be reached from a surface
model or from the mock-engine e2e suite:

- **L2-A — a real agent lane.** Select a repo that already has its `.ai/` standard, let the backlog
  lane dispatch a real `claude -p` session, and judge the commits as a senior would. Does the loop's
  brief ("do the work, never the detector") survive contact? Does a claimed `Ascent-Resolves:` trailer
  actually get refused when the dimension did not move?
- **L2-B — an attributable lift.** With a real engine on **both** ends, does a real repository change
  clear the ±2 noise band and print a coloured delta — and does an unchanged repository correctly
  print `within noise` twice in a row? This is the single claim the mock-engine suite cannot make.
- **L2-C — a live drive, killed and resumed.** Start a drive, kill the server mid-run, restart it, and
  confirm: the boot sweep marks the run `stopped` and releases its backlog claims (no zombie
  `in_progress` rows), the drive reads `interrupted` rather than `running`, the resume banner appears
  above the inspector, and resuming inherits `runsBefore` so the rope cannot be re-granted.
- **L2-D — the GitHub-side carry, end to end.** Scan the same repo *with* a token (observed fold),
  then run a loop and confirm the worktree rescan replays the fold with its provenance line and age —
  and that a fold-only difference is reported as `unmeasured` per dimension rather than as a lift.
- **L2-E — merge and iterate.** Merge the loop's branch and confirm the *next* proposal changes kind,
  the follow-up ledger reflects it, and the fleet's greenness read moves. Two full iterations, not one.
- **L2-F — the blocked states, for real.** Boot the same build with `ASCENT_AUTOPILOT` unset, as a
  non-owner, and with no pairing, and confirm each setup state names the one next action.

## Status

- **L1: not yet run** as a Character walk. The seam table above is the checklist a run would grade
  against; the machine-checked subset noted under it is green as of the branch that added this file.
- **L2: RUN 2026-08-29** — `uat/runs/2026-08-29-loop-l2/` (report `loop-to-l5-l2.md`, scorecard
  `SUMMARY.md`). Journey verdict **`L2-conditional`**. The loop *around* the agent works live and
  survives having its process killed; the agent lane does not produce its deliverable.

  | # | confirmation | verdict | the one fact it turns on |
  |---|---|---|---|
  | **L2-A** | a real agent lane | ~~fail~~ → **pass** (re-run 2026-08-29, after the fix) | A real `claude -p` session (sonnet/low) worked 5m46s, wrote `AGENTS.md` + `test/`, and **could not commit**: `--permission-mode acceptEdits` grants edits, not Bash, and headless `-p` has nobody to ask. `removeLoopWorktree --force` then deleted the only copy. Reproduced outside Ascent in 22s for $0.03. **Re-verified live after `58cb4b34`:** the permission posture is unchanged (the session again reported "no shell approval was available"), the LANE committed its 5 files as `b6907978` carrying 4 `Ascent-Resolves:` trailers parsed from the session's own RESOLVED lines, the rescan ran, and 4 follow-ups closed. See the re-verdict in the run report. |
  | **L2-B** | an attributable lift | **pass (partial)** | Real engine both ends (`claude-cli/opus`, `engineDegraded:false`): **4 → 19, ▲+15**, outside ±2, backed by a real commit — and the ledger volunteered `widened D2, D3`, `blend 95%`, `D2/D3/D4 not measurable locally` unprompted. But the same run printed **`▲+24 ATTRIBUTABLE LIFT`** beside **`0 commits`** for the lost lane. The `within noise` twice-in-a-row half was not driven. |
  | **L2-C** | a live drive, killed and resumed | **pass** | Killed 3.5s into a drive with a run in flight → `[loop] boot sweep: 1 loop run stopped, 1 drive marked interrupted`; run `stopped`, drive `interrupted`, banner reading "was not resumed on its own · 0/3 runs spent" above a still-usable inspector; Resume produced a new drive with `resumedFrom` set and `runsBefore` carried. Claim release measured separately: `inProgress 0 → 5 → (kill, restart) → 0`. |
  | **L2-D** | the GitHub-side carry | **not run** | Both fixtures are local-only repos and every scan ran `noAmbientToken`, so there was never an observed fold to replay. The *absence* half held on every scan (`platformSignals.source: "unavailable"`, D2/D3/D4 excluded rather than floored). |
  | **L2-E** | merge and iterate | **pass** | Five rounds: `foundation → practice(agent-guidance) → practice(docs-adrs) → practice(legible-history) → backlog`, 19 → 38, L1 → L2, debt 419 → 293. The kind changed under the rule each time because it re-reads the paired working copy. |
  | **L2-F** | the blocked states | **pass (1 of 5)** | `autopilot-off` driven for real against a server booted without the flag: names `ASCENT_AUTOPILOT=1`, says "Restart the server after setting it.", leaves the chart readable, and the drive door answers 409 rather than 500. The other four need a different deployment shape, org or session. |

  Two defects were fixed at source during the run (`044d7dc5` the run-branch collision a drive
  produces by construction — which the drive then reported as `dry`, i.e. as a plateau in the
  operator's repository; `2959be4c` a lane that lost its agent's work logging the same line as a lane
  that had none). ~~Seven findings are open~~ — **three more closed 2026-08-29, in a follow-up pass
  on this same branch:** `58cb4b34` L2-A-01 (the lane commits the agent's work), `9033308b` L2-B-01
  (a lane with no commits contributes nothing to the lift and its scan is never adopted), `0a8be67b`
  L2-C-02 (the boot sweep removes the temp worktrees its stopped runs stranded). Both were
  re-verified live — see "The L2-A re-verdict" in the run report. **Four findings remain open**
  (L2-C-01, L2-E-01, L2-F-02, L2-B-02), none of which decides this journey; with L2-A passing and
  L2-B's counter-case closed, the journey verdict moves from `L2-conditional` to **`L2-pass`** on
  everything that was driven, with L2-D and four of five `CockpitSetup` states still not run.
- Known holes this journey will meet and should record rather than re-derive: no hosted dispatch; a
  retried lane lands on a second branch; ~~the agent's `--effort` is passed unprobed~~ — **probed
  2026-08-29**: the orphaned agent process's argv read
  `-p --output-format json --permission-mode acceptEdits --model sonnet --effort low`, so the
  operator's pick does reach the CLI; `curating` is a reserved phase nothing writes. All are
  documented in `docs/features/org-planning/live.md` § Known gaps.

## Frozen happy path  (filled in only on `promote`)
<!-- not yet promoted — discovery only. The e2e spec is the closest thing to a frozen path today, and
     it deliberately covers only the no-agent half of the loop. -->
