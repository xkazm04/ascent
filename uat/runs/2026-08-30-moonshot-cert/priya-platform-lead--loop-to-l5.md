# UAT L1 — Priya (Platform/DevEx Lead) · `loop-to-l5` · 2026-08-30-moonshot-cert (pair #7)

**Level:** L1 — theoretical, code-grounded, no browser. Surface model built by reading the tree at
`fca0c742`-era master (branch `fix/gate-lint-unescaped-entities-20260827`).
**Baseline:** yesterday's L2 of this same journey (`uat/runs/2026-08-29-loop-l2/SUMMARY.md`,
journey `L2-pass` on everything driven). What changed since is exactly the moonshot loop trio
(#27 economics, #25 lane brief, #26 one ledger/PR-from-lane) and the work protocol (#3 remote
lanes + MCP claim/brief/report) — plus a cockpit refactor that replaced `CockpitOutcome*` with a
full-width `outcome/` sheet, which is precisely the refactor-shape the run brief warned produces
present-but-unwired.

---

## 1. Surface model (file:line)

### Reachability first — which Priya sees what

There are two of me now, and the code treats us very differently.

**Self-hosted Priya** (`selfHosted()` + `ASCENT_AUTOPILOT=1` + paired repos): the full cockpit.
- Gate: `cockpitGate.ts:22-28` — five ordered blocked states, one predicate for loop and drive
  (`canDispatch`, :32). `CockpitSetup.tsx` names the one next action per state.
- Server load: `LiveTab.tsx:130-143` reads `getActiveLoopRun`/`listLoopRuns`/`getLoopRunDetail`
  **only when `local`** (`selfHosted()`, :55).

**Cloud Priya** (managed cloud, org member/owner):
- `GET /api/org/loop` is now open to her — `route.ts:42-49` removed `selfHostGuard` with an
  in-code justification ("404ing its own runs would hide the operator's own rows"), returns
  `{enabled: autopilotEnabled(), active, runs, prices}`.
- `POST /api/org/loop {executor:"remote-agent"}` skips `selfHostGuard`/`autopilotEnabled`
  (`route.ts:119-122, 143, 152-168`), keeps `requireOrgRole(org,"owner")` and `dbGuard`.
  `startRemoteRun` (`loop-engine.ts:231-271`): no worktree, no process, run in **`curating`**
  (the first writer of that phase ever), lanes `executor:"remote-agent"`, `phase:"queued"`,
  audit `loop.remote_run_started`.
- But: `/api/org/loop/propose` **keeps** `selfHostGuard` (`propose/route.ts:56`), the lessons
  route keeps it (`lessons/route.ts:34,50`), the PR route keeps it (`[id]/pr/route.ts:7`), and
  the cockpit UI never enters run mode for her (§3, F-703).

### #27 — remediation economics

- Pure fold `src/lib/local/lane-economics.ts`: `laneEconomics` (:75-97) — `verifiedPoints` =
  positive deltas only, `null` when either scan end missing (:80-84); `unproductive` requires
  `costMicros > 0 && verifiedPoints === 0` (:95). `priceList` (:111-141): proportional
  attribution (:126-127), unproductive spend its own line never a denominator (:121-123),
  `unpricedLanes` counted (:117-119), every cell carries `n`.
- `pickDriveModel` (:163-202): **null unless every named dimension has ≥2 models at
  `n >= DRIVE_MODEL_MIN_N` (=3, :144)**; single measured model → null with the stated reason
  ("the sample would be self-fulfilling", :151-154); intersection across dims; ties broken by
  lowest total micro-cents. 38 tests green (`lane-economics.test.ts` + `lane-outcomes.test.ts`
  run in this walk).
- Wire: `loop-runs-read.ts:274` puts `economics: outcomes.map(laneEconomics)` on the detail;
  `getOrgPriceList` on `GET /api/org/loop` (`route.ts:62-67`), derived at read time, org-scoped.
- UI: `LaneRail.tsx:23-27,66-83` cost chip — `cost unknown` for null, never `$0.00`; costSource
  tooltip; remote-lane tooltip "Unknown — not free." `PriceListPanel.tsx` — `n=` on every cell
  (:75-80), empty state in words (:60-64), footer for unproductive/unpriced (:92-109), fetches
  its own data once on mount (poll discipline stated :15-17). Mounted `LiveCockpit.tsx:131`.
- A/B: `route.ts:99-109` validates exactly-two distinct `MODEL_TOKEN` arms (400, never a
  spawn); `loop-engine.ts:155-160` re-checks at arm time; :374-425 fans the SAME curated batch
  into two lanes per repo per cycle, `abPairKeyFor(runId, repo, cycle)` (:449). **No picker**:
  `useRunDials.ts` has `model`/`effort` only, no `modelPolicy`/`models` — disclosed verbatim in
  `live.md:1605-1608`.

### #25 — lane brief, report verdicts, lessons

- `lane-brief.ts`: `omitted[]` with `why:"none"` (:254-259), `briefSummaryLine` names missing
  sections as `no <kind>` (:286-295). Propose route builds the preview from the SAME
  `loadLaneBriefInput → buildLaneBrief` pair the engine calls (`propose/route.ts:96-103`, and
  the claim "the preview cannot promise a standard the lane does not use" holds by construction
  — `loop-lane.ts:43,47,616` imports the same two).
- `loop-lane.ts`: brief assembled and stamped (:616), report read back, per-item outcomes
  recorded after the rescan rules (:795), lessons as candidates only with the log line "nothing
  was written into memory" (:815-818), playbook stamp only for briefed playbooks on verified
  closes (:821-828), deferral filter on batch pick (:241, :515).
- `lane-outcomes.ts`: `LANE_DEFER_CYCLES=3`, 14-day cap (:24-26); DEFERRING = skipped +
  needs_human only (:33); the **incapacity heuristic** downgrades an unverified `resolved`
  whose own reason admits it couldn't act → `needs_human` + park (:202-205), with the real
  session sentence as the test fixture (test :194-207). Deferral advisory to `openBatch` alone
  — status untouched, `RecommendationEvent` written.
- UI: `BriefStrip.tsx` provenance line per proposal, mounted `CockpitInspector.tsx:148`.
  `CockpitVerdicts.tsx` — five-verdict vocabulary rendered, `needs_human` the only warn tone
  (:21-27), deferral explained in a title (:67), defaulted prop against stale payloads (:38-40);
  mounted `OutcomeSection.tsx:91` off `detail.itemOutcomes`. `CockpitLessons.tsx` — "**not in
  memory until you keep one**" (:74), Keep/Discard, discard soft; mounted `LiveCockpit.tsx:133`.
- Lessons route: `selfHostGuard` → `requireOrgAccess`/`requireOrgRole(member)`,
  gate-then-constrain (`lessons/route.ts:13-14,34-60`).

### #26 — one ledger, PR-from-lane

- `POST /api/org/loop/[id]/pr` — the full stack in order: `selfHostGuard` → `requireSameOrigin`
  → `dbGuard` → owner → tenancy re-check, typed `confirm` = repo full name
  (`[id]/pr/route.ts:5-17`). `recordAudit` imported (:29).
- `LanePrAction.tsx` — visibility matrix in code and comment (:10-15, `canOpenLanePr` :29-31:
  done ∧ branch ∧ commits>0 ∧ no prUrl), owner-only via `canOpen`, link replaces button once
  `prUrl` set; mounted `OutcomeSheetRow.tsx:46`.
- Union: `org-impact.ts:59-62,151-154` (`source: p.loopLaneId ? "loop" : "practice-pr"`,
  branch-basis beside — never inside — bought, :96); `ImpactLedger.tsx:103-104` in-review tile
  with `—` and "no measured lane" for null; Source column in the table head. (Depth on the
  briefing proof line is Dana's walk; I confirmed presence, not prose.)

### #3 — work protocol

- Scope: `followups:write` in `SKILL_TOKEN_SCOPES` (`org-api-tokens.ts:22,33`), never implied
  by `mcp:read` (`tools.ts:112,214-217`).
- One claim path: `followup-claims.ts` — compare-and-set (:210-225: `status:"open"` ∧
  lease null-or-expired), refusal reasons `held`/`not-open`, events + audit in the same call;
  **no verb closes a row** (:19, and `reportAttempt` :316-341: resolved → stays in_progress
  lease cleared; skipped → open; needs_human → in_progress + flag). `runTool` fails closed
  without a principal (`handlers.ts:382-395`).
- Remote brief: `buildAgentBrief` (`followups.ts:512-`) = fix prompt + perimeter (tier, lease,
  permitted tools/models, no-AI zones, "absence is not permission" for a missing stance) + the
  protocol rules — every line a stored value, no new prose.
- Remote lifecycle: `attachRemoteClaim` (`loop-runs-write.ts:78-125`) moves queued →
  dispatching, run curating → running on first claim, best-effort by contract.
- UI: `LaneRail.tsx:61-65` executor chip + claimant + lease countdown, chip only on remote
  lanes; `CockpitRunPanel.tsx:42-43` remote run detection + unclaimed count;
  `followupsModel.ts:33` claim columns on the ledger row.

**Grounding: 0.92** — 44 of 48 surface-model claims above carry file:line I read myself; the 4
un-walked: the PDF/share briefing render path, `stampPlaybookApplications` internals,
`lane-report.ts` fuzz behaviour beyond its type table, and the MCP door's rate-limit charge
order (asserted from module comments, not stepped through).

---

## 2. The walk (first person)

I start where I left off yesterday: a repo I don't care about, paired, `?tab=live`.

**Curate.** I lasso the repo; the inspector proposes a lane and — new — a **Brief** line under
the batch: "2 playbooks · house pattern from 3 practices · 4 memories · no skill · 8.1 KB". The
absences are stated, not blank (`briefSummaryLine` maps `omitted` to "no skills"), and the strip
is built from the same assembly the engine will run, so it can't flatter me. This is the first
time the product tells me, before I spend a session, that the agent is about to work D9 with
nothing of mine to follow. That is a reason to write the playbook first. Okay, that's actually
shippable.

**Arm.** Model and effort dials exist and are resolved server-side against a closed list
(`normalizeAgentModel`, `route.ts:201-202`). The A/B policy I read about is real at the API —
two arms, one `abPairKey`, each arm rescanning its own worktree so neither grades the other —
but the cockpit offers me one model. The known-gaps list says so in as many words, so it's a
disclosed hole, not a hidden one. Fine. Arming an experiment via curl is not a golden path,
though — it's the 7-hop detour my references call a fail.

**Run, and what it cost.** The lane rail now prints `sonnet · 4 turns · $0.62` in the counters'
own muted type — cost is not a verdict, and `cost unknown` when the envelope said nothing. The
one-source rule is written into the module header and guarded by a test; OTLP developer sessions
can never pad a lane's cost.

**Verify.** The outcome sheet keeps yesterday's refusal vocabulary (`within noise`,
`mock scan`, `not measured`, `uncommitted` — `outcomeText.ts:27-41`) and adds the per-item
verdict ledger: skipped items now carry the agent's own reason and a "not re-offered until"
date, with a title spelling out that nothing on my backlog row changed. The substitution check —
downgrading a claimed `resolved` whose own sentence admits the session couldn't do the thing —
is the single most Priya-shaped feature in this wave; the test pins the real sentence a real
lane wrote. **But then I read one test title that says the opposite of its assertion, and I go
quiet and start poking at provenance** (finding 702 below).

**Price the work.** After a few runs the Price List panel states ¢/point per model × dimension
with `n=` on every cell, spend-without-movement as its own line, unpriced lanes counted. No
intervals, no confidence theater — deferred to #30 and it says so. `pickDriveModel` refuses to
choose until two models are measured at n≥3 on every dimension in play, and null means "keep
what I configured". That's the honest arithmetic I'd defend to my staff engineers. What I can't
find is the **per-lane** ¢/point the spec promised beside `before → after` (finding 704), or any
line telling me the drive *switched* model on evidence (finding 705).

**PR.** The lane's branch gets an owner-gated, typed-confirm door to a real draft PR — the one
control whose effect leaves my machine, and it's the only one that asks me to type the repo
name. Correct friction, correctly placed. The merged PR then moves points from "in review (on
branches)" to bought with no re-measurement. That closes the loop my rollout story needs:
scan → lane → verified movement → reviewed PR → fleet number moves.

**Go again.** Deferrals mean cycle 2 asks a different question instead of re-buying the same
refusal. The kind rule still re-reads my working copy each round (yesterday's five-round
L2-E pass; now with `craft` lanes narrowing the empty-batch gap, disclosed at live.md:1618-1623).

**Then I try to be the other Priya.** My real org is on managed cloud; the pitch of #3 is that
my CI's agent can claim work from Ascent's queue with a scoped token while Ascent stays the
referee. The token, the scope, the CAS claim, the lease, the report-that-never-closes — all of
it is built and built well. And then the journey collapses twice, in code, before any agent
writes a line (findings 701 and 703).

---

## 3. Findings

### PRIYA-L1-701 · broken-flow · **blocker** (remote posture) — reading the cockpit kills a running remote run

`markStaleRunsStopped` (`loop-runs-write.ts:305-337`) treats every `phase:"running"` run not in
THIS process's live registry as an orphan — and a remote run is **never** in the registry:
`startRemoteRun` deliberately adds no entry, and its own comment says so:
`loop-engine.ts:228-230` — "`markStaleRunsStopped` must never be pointed at one: `isLoopRunLive`
returning false for a remote run is the truth, not a death certificate."
But `GET /api/org/loop` points it at all of them on **every read** (`route.ts:58`), and the
cockpit fires one unconditional tick on mount (`useLoopRun.ts:88-95`).

Sequence, by construction: arm remote run (`curating`, safe) → agent calls `claim_followups` →
`attachRemoteClaim` flips it `running` → **anyone opens the Live tab, or any poll lands** → the
run is marked `stopped` with *"Interrupted — the server restarted while this run was in
flight."* (a false statement — nothing restarted), and its claims are force-released
(:338-380) while the remote agent still holds a live lease. The agent's subsequent
`report_attempt` then fails its `status:"in_progress"` CAS (`followup-claims.ts:333,357`).

Secondary inconsistency: the release path sets `status:"open"` but does not clear
`claimActor`/`leaseUntil` (:365-369) — producing an open row with a live lease, which
`claimFollowups` refuses (`OR: leaseUntil null|expired`) and `sweepExpiredLeases` never clears
(it sweeps `in_progress` only, :210 region). The row is unclaimable by anyone until the lease
wall-clocks out, and the follow-ups ledger shows "claimed by agent:… " on an open row.

`loop-runs-write.stale.test.ts` has no remote case; `route.test.ts` tests the remote start but
never a GET after a claim. Impact: the entire #3 protocol survives only until observed —
every-use × total-loss-of-work-in-flight × direct trust hit (the error message blames a restart
that didn't happen). Fix shape is one predicate: exclude runs whose lanes are all
`executor:"remote-agent"` (or stamp executor on the run).

### PRIYA-L1-702 · trust · **major** — an unverified agent claim renders as "closed by the rescan"

`recordLaneOutcomes` stores an agent's `resolved` **verbatim** when the rescan did NOT close the
id, unless the incapacity heuristic fires (`lane-outcomes.ts:193,202-203`). `LaneOutcomeRow`
carries no "verified" discriminator. `CockpitVerdicts.tsx:30` then labels **every** `resolved`
row "**closed by the rescan**", and its header comment (:6-7) asserts "`resolved` here always
means the RESCAN closed it" — which the data cannot support. The codebase knows it's confused:
the test at `lane-outcomes.test.ts:99` is titled *"does NOT write `resolved` for an id the agent
claimed but the rescan did not close"*, its comment says *"only the verifier writes
`resolved`"* — and its assertion at :102 is `expect(rows[0]!.verdict).toBe("resolved")`. A test
whose name and assertion contradict each other is a spec dispute frozen mid-argument.

My stated bar for this journey is Fowler's: *an agent's own claim of completion is not
evidence*. This panel launders exactly that claim into the verifier's voice. The honest design
is a sixth stored value (or a `verified` boolean): rescan-closed → "closed by the rescan";
agent-claimed-unverified → "claimed resolved — awaiting the rescan" in a different tone.
Frequency: every backlog lane where the agent finishes but the movement gate doesn't close the
row — which yesterday's L2 showed is the *common* case (4 of 5 closed, 1 honoured as skipped).

### PRIYA-L1-703 · confusion + broken-flow · **major** (cloud posture) — #3's cloud half is API-complete and cockpit-invisible

Walking cloud-Priya's screen: `LiveTab.tsx:130-143` loads `activeRun`/`runs`/`runDetails` only
when `selfHosted()` — so her armed remote runs never server-render. Client-side,
`useCockpit.ts:43` enters `mode:"run"` only from that (empty) server prop or from a local
start click; the rail therefore falls through to `CockpitRail.tsx:83` → the `hosted` setup
panel, whose copy (`CockpitSetup.tsx:37-45`) tells her the loop *"exists only on a self-hosted
Ascent"* — a sentence the deployment's own POST route now contradicts. The executor chip, the
claimant label and the lease countdown built FOR remote lanes (`LaneRail.tsx:61-65`) are
unreachable on the only posture that produces remote lanes with unknown claimants. Settled
remote runs never reach the outcome sheet (`runDetails` gated on `local`). And the curation
half is still walled: `/api/org/loop/propose` keeps `selfHostGuard` (`propose/route.ts:56`), so
cloud-Priya cannot see a proposed batch or a brief preview — she must hand-assemble
recommendation ids from `list_open_recommendations` to arm a run the UI then denies exists.
(One mount tick does fetch her runs — `useLoopRun.ts:88-90` — but nothing renders them; and per
finding 701 that same tick kills the run, so the blindness is briefly load-bearing.)

`docs/features/org-planning/live.md:1574-1602` documents the remote protocol honestly at the
API level; nothing documents that the cockpit doesn't participate. This is the rubric's
"present-but-undiscoverable", compounded by copy that actively denies the capability.

### PRIYA-L1-704 · quality-gap · **medium** — per-lane ¢/point is computed, shipped, and rendered nowhere

`getLoopRunDetail` returns `economics: LaneEconomics[]` — one `microsPerVerifiedPoint` per lane
— on every detail read (`loop-runs-read.ts:274`), and `loopTypes.ts:16,35` re-exports the type
to the cockpit. Wiring audit: `grep -rn "\.economics" src/features src/app` → **0 hits**. The
spec's placement ("a ¢/point figure beside the existing before → after… `not measured` when
null") named `CockpitOutcomeLedger.tsx`, which the wave-2 refactor deleted; the replacement
`outcome/` sheet renders attribution, commits, gaps and `agentConfig`
(`OutcomeSheetHeader.tsx:66`) but no cost figure of any kind. So the product's headline
arithmetic — cents per verified point *for this lane, this run* — exists only as an org-wide
aggregate at the page bottom. The predicted refactor casualty, found by the predicted grep.

### PRIYA-L1-705 · trust · **minor** — the drive's evidence-led model switch is silent

`chooseDriveModel` (`drive.ts:265-273`) consults the price list and `startLoopRun` gets
`picked ?? st.model` (:312-318) — but nothing logs the decision or its basis. Spec #27's audit
paragraph required exactly one record: "the drive's model choice, logged into the lane log with
its basis (`n` and the prices compared)." As shipped, a drive that quietly switches my configured
`opus` to `sonnet` mid-chain shows the new label in `agentConfigLabel` with no why. For the
character whose reflex is "who authored this," an unexplained substitution of the thing I
explicitly configured is provenance failure — small only because n≥3-on-every-dim makes it rare.

### PRIYA-L1-706 · quality-gap · **minor** — remote agents never receive the org's own standard

The local lane's prompt carries "YOUR ORGANIZATION'S STANDARD" (`loop-lane.ts:616` →
`buildLaneBrief`: playbooks, house pattern, memory, skills, scan evidence). The remote brief
(`get_fix_brief` → `buildAgentBrief`, `followups.ts:512-`) is the fix prompt + the governance
perimeter — no playbooks, no house pattern, no memory. Defensible scope (#25 predates #3's
lane), but #25's stated goal is the org's standard "INTO every lane the loop dispatches," and a
remote close consequently can never stamp `PlaybookApplication` adoption evidence (the stamp
requires the playbook to have been in the brief — `loop-lane.ts:821-828`, correctly). Nothing
discloses that remote lanes work un-briefed. One paragraph in `live.md` §Remote runs, or a
`loadLaneBriefInput` call in `getFixBriefTool`, closes it.

### PRIYA-L1-707 · polish (doc) — dangling pointer to a deleted known gap

`live.md:871` still reads "…needs the sandboxed executor the 'no hosted dispatch' gap below
already names" — #3 deleted that gap from §Known gaps (correctly). In a docs culture whose own
constitution says a stale stated gap does more damage than an absent doc, a reference to a
deleted gap is the miniature of the failure mode. One sentence to fix.

### Verified as disclosed, not findings (the lane-declared gaps I was told to check)

- **A/B picker UI unbuilt, API complete** — TRUE and disclosed verbatim (`live.md:1605-1608`);
  route validation (`route.ts:99-109`), engine fan-out + `abPairKey`
  (`loop-engine.ts:155-160, 374-425, 449`) all real.
- **`pickDriveModel` null until n≥3 on every dim** — TRUE, stricter than stated: also null with
  a single measured model, with the self-fulfilling-sample reasoning in-source
  (`lane-economics.ts:144-189`); tests pass (38/38 this walk).
- **Remote lanes carry no cost** — TRUE and honest end to end: `startRemoteRun` stamps
  `model:null` "unknown, not the default" (`loop-engine.ts:251-254`), LaneRail tooltip says
  "Unknown — not free," `live.md:1598-1602` documents the null-never-zero rule.

### Recurrence vs 2026-08-29

| yesterday | today |
|---|---|
| L2-A-01 / B-01 / C-02 (fixed on-branch) | **hold in code** — `lane-commit.ts` present; `outcomeGapRows.ts` renders lost work as its own `uncommitted` warn state, distinct from no-work; stranded-worktree sweep test exists (`loop-worktree.stranded.test.ts`). `resolved-verified` candidates for L2. |
| L2-F-02 (CLAUDECODE env markers not stripped) | **still open**, now honestly disclosed (`live.md:1629-1632`). Not re-filed. |
| L2-C-01 (resume click before hydration) | **still open**, disclosed (`live.md:1624-1627`). Not re-filed. |
| L2-E-01 (empty-batch backlog lane) | **narrowed** by r12 `craft` lanes, residual disclosed (`live.md:1618-1623`). |
| L2-B-02 (agent config vs engine unlabelled) | **plausibly addressed** — `agentConfigLabel` on the sheet's run column (`OutcomeSheetHeader.tsx:66`); L2 to confirm the engine label sits beside it. |

---

## 4. Verdict

**L1-conditional.** Split by posture, as the brief asked:

- **Self-hosted Priya: L1-pass.** The loop trio is the strongest honest-arithmetic work in the
  product. The brief strip tells me what my standard *lacks* before I spend a session; verdicts
  and deferrals stop the loop re-buying a "no"; lessons are held at a human door and say so; the
  price list refuses to pretend one lane is a rate; the PR door has exactly the right friction.
  I would run this on my fleet — with finding 702's label fixed first, because the one panel
  that launders an agent claim into the verifier's voice is the one my staff engineers will
  find on day one.
- **Cloud / remote Priya: L1-fail.** The protocol's plumbing (scope, CAS claim, lease,
  report-never-closes) is genuinely vendor-neutral and well-guarded — and the run it serves is
  killed by its own status read (701), invisible in the cockpit, and denied by the cockpit's
  own copy (703). A standard you have to arm by curl and defend from your own dashboard is a
  standard that already lost.

**Grounding score: 0.92** (44/48 claims with first-hand file:line; see §1).

**Time-saved:** self-hosted posture — holds, unchanged from yesterday's L2 (five rounds,
19 → 38, L1 → L2, mostly unattended; vs my manual per-repo day, ≈8–10×), and the economics
panel now converts that into a number I can put in a budget line, which is new value on top.
Remote posture — currently **negative**: token minting + hand-built batches + a run that dies
when observed is slower than pasting the brief into the agent myself.

---

## 5. L2 priorities (with preconditions)

| # | what to drive | precondition |
|---|---|---|
| 1 | **701** — arm a remote run, claim over MCP, then GET `/api/org/loop` (or open `?tab=live`); confirm the run flips `stopped` "Interrupted — the server restarted", claims released mid-lease, `report_attempt` refused; check the open-row-with-live-lease residue on the followups ledger | any deployment (cloud-shaped is fine; self-hosted works — executor is body-selected) + org API token with `followups:write` + `mcp:read` |
| 2 | **702** — a live backlog lane where the agent claims `resolved` on an item the rescan does not close (no incapacity phrase in its reason); read the verdict panel | self-hosted + `ASCENT_AUTOPILOT=1` + paired repo + one real `claude -p` session |
| 3 | **703** — as a cloud org member with a remote run armed and claimed: walk `?tab=live`, screenshot the hosted denial beside the live header, confirm no lane/chip/countdown renders | cloud-shaped deployment (`selfHosted()` false), org owner session, token as in #1 |
| 4 | **704** — drive one lane to a measured lift with a recorded cost; confirm no per-lane ¢/point anywhere on the sheet while the detail payload carries it | self-hosted + autopilot + paired repo + real engine both ends (or mock — the payload field is engine-independent) |
| 5 | **L2-D carryover (still not run twice)** — the GitHub-side platform fold replay with provenance/age line | self-hosted + a repo scanned once WITH a GitHub token before the loop run |
| 6 | **705/706** — observe a drive's silent model switch (needs ≥3 lanes × 2 models per dim first — expensive; deprioritize), and diff the remote brief against a local lane's prompt | as #2 plus a second model's worth of history; #706 needs only the MCP token |

*Report ends. — P.*
