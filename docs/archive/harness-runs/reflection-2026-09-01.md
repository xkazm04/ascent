# Loop reflection — 2026-09-01 (33 runs, campaigns 1–5)

Sources: `docs/harness/campaign*/run-*.json` (84 lanes), the live PGlite copy (`Recommendation` rows joined to every lane's `batchIds`/`closedIds`/`itemOutcomes`), `live.md`, `followups.ts`, `lane-reservation.ts`, `lane-commit.ts`.

## Findings

### 1. Craft DID run — every close in campaign 5 was a craft rung, and the brief never knew

Joining `batchIds` to recommendation `kind`: **26 of 29 campaign-5 batches were mixed** (kp: 2 gaps + 5 craft every run; systedo: 1–3 gaps + 5–6 craft). 143 craft items and 51 gap items were dispatched; **23 closes, all craft, 0 gaps** (`closedKinds`). Item verdicts: craft 25 resolved / 40 skipped / 30 absent / 8 needs_human; gaps 1 / 21 / 8 / 3. Across all campaigns 118 craft rungs closed (ledger: systedo 88 distinct done, kp 18). "Lane kind craft = 1" is a labelling artefact: `proposeLaneKind` calls a mixed batch `backlog`, and `loop-reflect.mjs` reads a `dv.craftAxis` that deliverables don't carry.

The consequence is the real defect. `buildFixPrompt` (`followups.ts:454`) sets `craftMode = items.every(kind === "craft")` under a comment that says "`openBatch` never mixes kinds" — stale since the green reservation (2026-08-30). So on every mixed batch the agent got the **gap** brief: "Prefer the smallest change that closes the gap for real", and **`STRUCTURAL_INVITATION` (line 512) has never once been delivered** in campaign 5. The "permission to make a larger change" shipped 2026-08-31 and was never read by an agent.

### 2. Cycle time: 75% agent, 17% rescan, 3% verify; the 25-min ceiling truncates half the lanes

19 committed systedo cycles (campaign 5), mean 1606 s: guard baseline 59 s (cycle 1 only) · **agent 1203 s** · verify 53 s · **rescan 279 s** · land 11 s. Verification of a 46-s typecheck is 3% — not the problem. **15 of 29 lanes hit the 25-min session ceiling** (`Agent session exceeded 25 min`), 7 of them still committed a truncated tree. A run of 3 cycles is ~85 min and $16–40; cycles 2–3 produced 18 of the 23 closes (cycle 1 is mostly `noted: Committed 1 change` — the agent runs out of clock on the guard + a 7–9 item batch). Three cycles beat one only because the first cycle is spent warming up; a 45-min single cycle with a 5-item batch would likely match it at half the rescan cost.

### 3. Output mix: 0% structural. The ladder is built to produce gates about code, not code

30 closed/hardened deliverables in campaigns 4–5: **(a) new capability 1** (issue→draft-PR dispatch) · **(b) hardening/gates 21** · **(c) config/registries/docs 8** (contract-ledger pins, constraint-map, ADR ownership, group-owners, agent-lessons ledger) · **(d) refactor/dedup/perf 0**. Product code touched in 21 systedo cycles: ~6 files under `src/` (one latent TypeError, three fenced tool inputs); everything else landed in `scripts/*.mjs`, `test-unit/*.test.mjs`, `.github/*.json`, `AGENTS.md`. The repo is accreting a meta-harness (`guidance-budget`, `docs-staleness`, `autonomy-budget`, `contract-ledger`…).

Why, in order of force: (i) the brief said "smallest change" (finding 1); (ii) the craft-mode rules that would replace it still say "Keep it small and reversible — one rung, not a redesign. Prefer something that RUNS (a check, a budget, a drill)" — an explicit steer to gate-building; (iii) every craft axis brief (`craft.ts:41`) is phrased as a check *about* the system ("measured budgets, regression gates", "failure drills"), and craft entries are generated **per dimension**, and all nine dimensions are process dimensions — there is no dimension or axis under which "this module is duplicated three ways" can be raised; (iv) the agent has no shell (finding 6), so a refactor has no test loop; (v) 25 minutes for 7–9 items is item-shaped time.

### 4. Value curve: systedo plateaued at 88±2 on 2026-08-30; kp has landed nothing since 08-31

systedo: 72 (08-26) → 86 (08-30 14:45) → 88 (08-30 16:05) → **oscillating 86–92 across 45 scans since**, net 90→89 over campaign 5's 19 commits. Adoption swings ±7–17 on one-commit diffs (`adoption 90→73` then `73→84`) — the movement signal is scanner noise, and it produced one `regressed` deliverable. kp: 82 → 92 (one scan, 08-31 09:01) → 84 (08-31 12:36) and **not rescanned since**, because no kp lane has committed in 8 runs. Verified closes per run in campaign 5: 2,0,0,2,5,5,4,5 — rising after the batch/timeout dials, but every point is a craft rung with no score attached, so "value" is now the odometer, not the score. Across an infinite horizon the score is flat by construction (green means gaps above the floor) and the only thing left to rise is craft count, which today means harness bloat.

### 5. Waste: ~$60 of kp work discarded per campaign; 27% of items are "already covered"

- **kp, 7 of 8 lanes**: agent produced 10–17 changes ($5–11, up to 1242 s), then `Could not commit the agent's N change(s): commit-msg ✗` — kp's own hook (built by an earlier loop run) rejects the lane's subject (`fix: All work is in the tree. Here's what I found and did`, or `chore: partial work from an interrupted lane session`). All of it "discarded with the worktree". The 8th kp lane died on a session-limit + a 10-min typecheck timeout.
- **Claimed-but-unconfirmed pile**: every systedo cycle logs "20–30 more were CLAIMED by a commit trailer and the rescan did not confirm them". DB: systedo has **2757 `in_progress` craft rows over 186 titles**, the top title re-raised **61 times**. `getCraftBuilt` only reads `done`, so the model is never shown these, re-proposes them, the lane dispatches them, and the agent skips them: **37 of 136 campaign-5 verdicts begin "Already covered"**.
- D9 "pin actions to SHA": dispatched and skipped **8/8 times** in campaign 5 for "no network" (529 in_progress rows), because `deferUntil` keys on a row id the next rescan replaces.
- 10 of 29 lanes ended with 0 commits (7 hook, 2 session-limit, 1 rejected). Retired-vs-closed is fine (1/32 repeats).

### 6. What the agent says stops it

Verbatim reasons: "*this session has no network*", "*no node, no typecheck and no test runner*", "*this session cannot run `next build`*", "*a mutation harness is only real once its survival count has been measured … this session cannot run node --test*", "*not permitted to write .claude/settings.json*", "*on this repository's red list for an unattended agent*" (D3 progressive delivery, 6×). And it names the loop itself: "*the commits land anyway because an automation lane commits in a throwaway worktree where `.husky/commit-msg` … do not exist*". Nothing in 136 reasons says "too large" — the blockers are capability, not courage.

## Adjustment plan (ranked by value ÷ effort)

| # | Mechanism | Effect over infinite runs | Size | Proof in next 2 cycles |
|---|---|---|---|---|
| 1 | **`followups.ts:454/512`** — `craftMode` → `items.some(kind==="craft")` for the heading + `STRUCTURAL_INVITATION`; delete "Keep it small and reversible — one rung" and "Prefer something that RUNS" from the craft rules; fix the stale "never mixes kinds" comment. | The invitation reaches an agent for the first time; removes the two sentences that select for gates. | S | Brief bytes rise; ≥1 deliverable whose `files` include ≥3 `src/` paths and a deletion. |
| 2 | **`lane-commit.ts:laneCommitSubject`** — subject from the first `RESOLVED:` headline (`feat: <headline>`), never from the closing prose; `INTERRUPTED_SUBJECT` likewise; on `commit-msg` rejection retry once with `-m` + a `Commit-convention-exemption: lane` trailer, then `--no-verify` with a loud log. | Ends the kp discard (~$60/campaign); kp gets rescanned again. | S | Both kp cycles commit ≥1; kp `afterScanId` non-null. |
| 3 | **Run dials (campaign script / `run-limits.ts` defaults)** — batch 5, `agentTimeoutMs` 45 min, `maxCycles` 1–2 for green repos. | Trades item count for depth; halves rescan share; kills the 52% timeout rate. | S | Timeouts <20%; mean files-per-resolved-item rises. |
| 4 | **Craft adjudication** (`followups.ts decideInProgress` + `org-insights-craft.ts`) — a craft row with a verified lane trailer becomes `done` on that rescan (craft has no score for the rescan to "confirm"); feed `in_progress`-claimed titles into `CRAFT ALREADY BUILT`. | Drains the 2757-row pile; stops re-proposing built rungs; "Already covered" → <10%. | M | "CLAIMED … not confirm" count <10; zero "Already covered" in the batch. *(Semi-owner: changes what the odometer counts.)* |
| 5 | **Deferral identity** (`lane-outcomes.ts` / `openBatch`) — key `deferUntil`/`needs_human` on `dimId+normalizeRecTitle`, not row id. | Capability-blocked gaps (D9 pins, D3 rollout) stop eating 1–2 slots per batch. | S | No D9 pin item dispatched. |
| 6 | **`loop-reflect.mjs`** — read craft via `covers`→kind; count mixed batches; "no work" only when `batchIds` is empty; print uncommitted-loss lanes. | The next reflection sees the truth in one command. | S | Tool shows craft closes and the kp losses. |
| 7 | **Rescan cadence** — on a multi-cycle run rescan only after the last cycle (adjudicate claims by verified trailer meanwhile). | Saves ~9 min/run and removes noise-driven `regressed` rows. | M | Run time −15% with equal closes. |
| 8 | **OWNER — where does (d) come from?** Options: a craft axis `code-health` ("duplication, module size, hot-path cost — measured in the code, not a gate about it", `craft.ts` + `prompt.ts`) with ≥1 rung per scan required; and/or a scoped Bash grant (`npm run typecheck|lint|test:fast`, `agent.ts`) so a refactor has a test loop. | Only path to "deduplicated, blazingly fast": the rubric has no dimension for it and the sandbox cannot run a test. Both move what the scan proposes; #8b changes the blast-radius posture. | M/L | A `code-health` rung appears in `propose`; a deliverable deletes more lines than it adds. |

Rubric/score-touching items are flagged: #4 (what counts as a built rung), #8 (a new axis or a scoring dimension; the Bash grant). Everything else is mechanism.

## Outcome — the two cycles after the adjustments (campaign 7 / 7b, 2026-09-01→02)

Campaign 7 run 1 (2 cycles) and campaign 7b (2 cycles; campaign 7's run 2 was voided when the
machine slept — every timer fired at once on resume, which reads as "FORCE-FAILED … no stage in
flight"). Flags: `--delivery land --batch-size 5 --agent-timeout-min 45 --verify on --rescan run`.

| lane | agent | committed | trailers | verify | landed | closed (verified) | score |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 7 · kp c1 | finished | 12 | 1 | typecheck | main d8fa24fc..66a0d99b | craft rung closed | 83 → 90 |
| 7 · systedo c1 | finished | 1 | 0 | lint | master 58439be7..49241ef3 | — (bases diverged) | 87 → 90 |
| 7b · kp c1 | finished | 15 | 4 | typecheck | **refused: main +50 (eval merges), not ff** | 3 | 90 → 88 (D4 −15) |
| 7b · systedo c1 | finished | 14 | 1 | lint | master ec55d969..ffb0c8bb | 1 | 90 → 90 |
| 7b · kp c2 | finished | 23 | 3 | typecheck | refused (same) | 6 | — |
| 7b · systedo c2 | finished | 17 | 2 | lint | master ffb0c8bb..24c2ae8e | 3 | — |

Against the success criteria set above:
- **Structural deliverables** — yes: "Extracted shared ratchet protocol, rebuilt both ratchets",
  "Unified two colliding provenance vocabularies" (kp), "Merged four twinned context-map groups,
  added decidability test" (systedo). kp's branch is 36 files, +4171/−504.
- **Every session finished; zero timeouts; zero discards.** Six of six lanes ended with RESOLVED
  lines; subjects came from the headline ("fix: Moved unit suite ahead of build in check:ci").
- **kp commits and lands** — commits yes, lands only when `main` stands still: a parallel session
  merged eight `eval/*` branches into `main` mid-run, so `land` correctly refused the non-ff merge
  and both kp cycles sit on `ascent/loop-20260902075008-xkazm04-kp` (merge-tree: clean).
- **Verified closes**: 13 in 7b (0 in run 1, whose only claims were a craft rung and an unnamed
  systedo change). Cycle 2 closed more than cycle 1 on both repos, as predicted.
- **Craft** ran in every batch; the code-health axis has not yet surfaced a rung (backlog still
  had gaps to spend the 3/5 gap slots on).

Open after these runs:
1. kp D4 −15 on a cycle that mutation-tested both workflows — either the unquoted-env rule
   changed what the workflow excerpt shows, or the D4 oscillation is back; needs a third reading.
2. "16 more were CLAIMED … stay open" on systedo c2 counts trailers of commits already landed by
   earlier runs, whose rows the rescan replaced — a stale count, not stale rows.
3. Last-resort subject fixed (db7103ee): names the armed work, never a count of claims.
4. A campaign cannot survive machine sleep; the run driver has no resume.
