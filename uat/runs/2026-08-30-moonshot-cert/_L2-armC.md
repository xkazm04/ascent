# L2 — arm C (the LOOP arm) · Priya × loop-to-L5

**Run:** 2026-08-30-moonshot-cert · **Driven:** 2026-08-31 08:00–08:30 UTC · **Character:** Priya, platform lead
**Target:** the SHARED dev server `http://localhost:3000` — reused, never restarted.

## Preflight

| Precondition | Verified |
|---|---|
| Server **identity** (not liveness) | `GET /api/health` → `{"status":"ok","db":"up","reconnected":false,"dbMode":"pglite","autoscan":{"ready":false,"cronSecret":false,"githubApp":false,"db":true}}` — `dbMode` + `autoscan` both present ⇒ Ascent, not a sibling app |
| Self-hosted + autopilot | `GET /api/org/loop?org=kiro` → `"enabled": true` ⇒ `autopilotEnabled()` true, `selfHostGuard` passing. Priya's L2 arm is **satisfied** |
| Fixture org | **`kiro`** — 2 paired repos (`xkazm04/kp`, `xkazm04/systedo-case`, both `watched`, local paths under `C:/Users/kazda/kiro/`), **20 loop runs** from the 2026-08-30 campaign, 12-column outcome sheet, a populated remediation price list. Pre-existing; I made none of it (provenance flagged). |
| ⚠ **Real engine unavailable** | The newest pre-existing run's own lane log: `21:27:21 Agent failed: Agent error (success): You've hit your weekly limit · resets Sep 1, 8pm (Europe/Prague)`. Today is **Aug 31** — the subscription cap is still in force. Every `claude -p` lane in this arm therefore ends in failure or timeout, never in a real report. This constrains check 3 and is named in each verdict it touches. |

Drivers reused/added: `uat/driver/drive.mjs` (arm A/B), plus two new reusable ones —
`drive-armC-openrun.mjs` (opens a run column, captures **untruncated** text; `drive.mjs` caps at 9000
chars and the price list lives past that) and `drive-armC-701-local.mjs` (start → poll → **always stop**).

---

## Journal

**08:01.** I open my own cockpit at `?tab=live` and it is, genuinely, the thing I was promised. The
Observatory places my two repos in adoption × rigor, the inspector names the shared ground (`D2 open
in 2 of 2`, `D3 open in 2 of 2`), the proposed batch reads like something a colleague wrote — *"The
deploy is declarative; the schema it deploys onto is not"* — and the outcome sheet says **Fleet
climbed ▲+4 across 12 runs · 2 repos · 478 gaps closed.** Yesterday's five-round pass holds. I am
not here to re-litigate that. I am here to check three things I flagged as a reader of the code.

**08:02.** I go for the money first (704) because it is the cheapest to falsify and I expect to be
wrong. I am not. `GET /api/org/loop/e85d11c8…?org=kiro` hands me `economics[]` with
`microsPerVerifiedPoint: 156684150` for the `kp` lane — **$1.57 a point, this lane, this run.** Then
I open that same run in the cockpit and count the `¢` characters above the org-wide price list:
**zero.** The number is computed, serialized, shipped over the wire to the browser, and thrown away.
The systedo lane in the same run spent **$10.19 for 0 verified points** — `microsPerVerifiedPoint:
null`, the exact "not measured" case the spec named — and that is not rendered either. So the one
figure I would put in front of a VP to defend this program is the one figure the panel omits, while
faithfully rendering the org-wide average that hides it. `grep -rn "\.economics" src/features src/app`
→ 0 hits. The refactor casualty is real.

**08:03.** Now 702, and this is where the morning turned. My L1 said the panel launders an unverified
agent claim into the verifier's voice. I went looking for a counterexample in the corpus and found
the opposite: across all 20 runs, **46 of 46** `resolved` item outcomes were also in their lane's
`closedIds`. Perfect agreement. For about ten minutes I believed I had over-filed this.

Then I asked where `closedIds` comes from, and the floor gave way.

`loop-lane.ts:383` → `closedIds: report.resolvedFollowUpIds`. `engine.ts:394` →
`parseResolvedIds(snap.commits.map((c) => c.message))`. **The "rescan" is reading commit messages.**
And `lane-commit.ts`'s own header says whose messages they are: *"the brief now asks the session to
END with `RESOLVED: <id>` / `SKIPPED: <id>` lines, and this module turns those into the trailer set.
When the session names none, **every armed id is trailed** — the trailer is a CLAIM, never a verdict."*

So the chain is: agent says `RESOLVED: x` → lane stamps `Ascent-Resolves: x` into a commit → rescan
parses that commit → `closedIds` contains `x` → `recordLaneOutcomes` writes `resolved` → the panel
prints **"closed by the rescan."** The claimant and the verifier are the same actor, one hop apart.
The 46/46 agreement is not agent honesty. It is a **tautology** — which is also why my L1 could not
find a divergent row, and why the finding is worse than I filed it, not better.

The precedence comment in `lane-outcomes.ts` says *"the RESCAN closed it. The verifier outranks the
claim, always."* It is describing a verifier that, on this path, is a mirror.

**08:04.** I check whether the backlog agrees with the cockpit. It does not.
`GET /api/org/backlog?org=kiro&includeClosed=1` → `{"tracked":12,"open":3,"inProgress":9,"done":0,
"dismissed":0}`. **Zero done.** The cockpit has told me 46 items were *closed by the rescan*; my
ledger says nothing has ever closed. I pull the timelines of the four items run `e85d11c8` reports
as closed and every one ends the same way: a `lane_verdict → resolved` event, and a `status` event
reading `open -> in_progress`. **No transition to `done` exists.** They are still claimed, on a
branch, in my ledger — and green in my cockpit. That is two products disagreeing about my own repo.

The mechanism is the second half of the same bug: `scans-persist.ts` puts the trailer set through
`decideInProgress` with a **movement witness** before it closes a ledger row — the honest gate. But
`rescanWorktree` hands `recordLaneOutcomes` the **raw, ungated** `resolvedFollowUpIds`. One rescan,
two definitions of "closed", and the cockpit got the loose one.

**08:05–08:25.** 701, the blocker. I try to build the remote run for real and get stopped twice by
gates that are themselves findings. Then I run the local control, and the control hands me the best
evidence of the day — see the verdicts below.

**What I would tell my staff engineers.** The loop works. I watched it climb, I priced it, and the
per-item verdict ledger with its "not re-offered until" dates is the most Priya-shaped thing in this
product. But my stated bar for this journey is Fowler's — *an agent's own claim of completion is not
evidence* — and on this build the cockpit's single most load-bearing word, `resolved`, is the agent's
claim wearing the verifier's clothes, while the ledger that applies the real gate quietly reads
`done: 0`. I would still roll this out. I would not show anyone the verdict panel until it says
which of those two numbers it means.

---

## Verdicts

### PRIYA-L1-702 · trust · major — "an unverified agent claim renders as 'closed by the rescan'"
**Verdict: CONFIRMED — and materially worse than filed.**

L1's claim held on every point, and the live corpus exposed a mechanism L1 did not have:

1. **The label is unconditional.** `CockpitVerdicts.tsx:31` — `const LABEL = { resolved: "closed by
   the rescan", … }` — with the header comment at `:6-7` asserting *"`resolved` here always means the
   RESCAN closed it."* Rendered live: 4 rows reading `closed by the rescan` in the ITEM VERDICTS
   panel of run `e85d11c8` (`shots/armC-run11open.text.txt:1803,1810,1824,1831`).
2. **The row carries no discriminator.** The live API `itemOutcome` object is
   `{id, runId, laneId, repoFullName, recommendationId, cycle, verdict, reason, files, deferUntil,
   createdAt}` — no `verified` field exists to render a different tone from.
3. **The cited test contradicts itself, verbatim.** `src/lib/db/lane-outcomes.test.ts:99-105`: title
   *"does NOT write `resolved` for an id the agent claimed but the rescan did not close"*, comment
   *"only the verifier writes `resolved`"*, assertion `expect(rows[0]!.verdict).toBe("resolved")`.
4. **NEW — the "verifier" reads the claimant's own commit message.**
   `loop-lane.ts:383` `closedIds: report.resolvedFollowUpIds` ← `engine.ts:394`
   `parseResolvedIds(snap.commits.map((c) => c.message))` ← trailers written by `lane-commit.ts` from
   the agent's own `RESOLVED:` lines. `lane-commit.ts`'s header states the contract outright: *"the
   trailer is a CLAIM, never a verdict."* The panel prints it as the verdict.
5. **NEW — the movement gate is bypassed on this path.** `scans-persist.ts:353-370` runs the trailer
   set through `decideInProgress(..., movement, movementEngines)` before closing a ledger row.
   `rescanWorktree` passes `recordLaneOutcomes` the **raw** set. Same rescan, two meanings of "closed".

**Sharpest evidence — two independent proofs.**

*(a) The two surfaces disagree about my repos.*
```
cockpit  → 46 item outcomes labelled "closed by the rescan" across 20 runs
backlog  → GET /api/org/backlog?org=kiro&includeClosed=1
           {"tracked":12,"open":3,"inProgress":9,"done":0,"dismissed":0}
```
Timeline of `0eff00a8-…` (a row the cockpit reports closed), `GET /api/recommendations/<id>/events`:
```
lane_verdict | autopilot | null -> resolved | "Added docs/task-index.md, …"
status       | autopilot | open -> in_progress | "Loop cycle 1: dispatched to a local agent …"
```
There is no `-> done`. Same shape for `d5d90a60-…`.

*(b) The laundering does not need a dishonest agent — only a silent one.* The local run I started for
check 3 (`a5a2bf9f`) timed out with **zero** item verdicts, and its lane log reads:
```
08:24:31 Agent failed: Agent session exceeded 20 min and was stopped.
08:24:31 Report: 0 item verdict(s), 4 lesson(s).
08:24:31 The lane committed the agent's 14 change(s) on ascent/loop-20260831080428-xkazm04-kp
         — 5 Ascent-Resolves trailer(s) (the session named no ids, so the whole armed batch is claimed).
```
A session that was **killed by a timeout and reported nothing** had all 5 armed ids stamped as
resolved trailers. Had the rescan run, `parseResolvedIds` would have returned all 5 as `closedIds`
and the panel would have rendered 5 × *"closed by the rescan."* The only reason it did not is that my
own `stop` landed one step earlier: `08:24:32 Stop requested — winding this lane down before the
rescan; the batch is released.`

*Correction to my L1 frequency estimate:* I wrote that the divergent case is "the common case."
On this corpus the divergence is **invisible**, because the trailer path makes agent-claimed and
rescan-closed the same set by construction. The user impact is unchanged; the failure is systemic
rather than occasional.

### PRIYA-L1-704 · quality-gap · medium — "per-lane ¢/point is computed, shipped, and rendered nowhere"
**Verdict: CONFIRMED.** (Mock engine was permitted; not needed — real pre-existing lanes carried the field.)

- **Computed and shipped.** `GET /api/org/loop/e85d11c8-4e1a-44a7-ab00-9718bf4efcde?org=kiro` →
  ```json
  "economics":[{"laneId":"7521ca82…","repo":"xkazm04/kp","model":"claude-opus-5",
                "costMicros":626736600,"verifiedPoints":4,"microsPerVerifiedPoint":156684150},
               {"repo":"xkazm04/systedo-case","costMicros":1019440450,
                "verifiedPoints":0,"microsPerVerifiedPoint":null}]
  ```
  = **156.68¢/point** for the `kp` lane; the systedo lane is the `null` "not measured" case after
  **$10.19** of spend. **14 lanes** across the corpus carry a non-null figure.
- **Rendered nowhere.** With that exact run open in the cockpit, the full page text contains **0**
  `¢` characters above the org-wide `REMEDIATION PRICE LIST` (`armC-run11open.text.txt`, price list
  begins line 1851; all 5 `¢` on the page are inside it). No `$n/point` either.
- **Wiring audit reproduced live:** `grep -rn "\.economics" src/features src/app` → **0 hits**.
- The org-wide aggregate does render and is good (`47.18¢/point n=4`, `$1.65/point n=6`, plus
  `$47.51 spent without measured movement · 7 lanes unpriced`) — which is precisely the aggregate
  that averages away the $10.19-for-nothing lane sitting one panel above it.
- The spec's named home, `CockpitOutcomeLedger.tsx`, is gone; the replacement `OutcomeSheetHeader.tsx:66`
  renders `col.agentConfig` and no cost figure of any kind.

### PRIYA-L1-701 · broken-flow · blocker — "reading the cockpit kills a running remote run"
**Verdict: split.** Static mechanism **CONFIRMED**; local half **CONFIRMED SAFE** (control passed);
remote half **UNCERTAIN — not reproducible on this host**.

**The missing predicate is real.** `markStaleRunsStopped` (`loop-runs-write.ts:305-337`) selects
`where = { phase: "running", …orgId }` and filters only on `!isLive(r.id)`. `grep -n executor
src/lib/db/loop-runs-write.ts` returns hits at :105/:157-175/:227 (the lane-creation paths) and
**none inside the stale sweep** — although `executor` exists on the lane
(`prisma/schema.prisma:1842`, `String @default("local") // local | remote-agent | human`), so the
exclusion is available and simply absent. `route.ts:58` calls it on every GET, and `startRemoteRun`
(`loop-engine.ts:227-229`) documents that it adds no registry entry, so `isLive` is `false` for a
remote run **by construction**.

**Control 1 — a `curating` remote run survives a read (as designed).** I armed a real remote run:
`POST /api/org/loop {"action":"start","org":"kiro","repos":["xkazm04/kp"],"executor":"remote-agent"}`
→ `dc3f8752-99b6-4283-9dc8-8070de27721a`, `phase:"curating"`. A subsequent
`GET /api/org/loop?org=kiro` left it `curating`, `error: null`, and listed it as `active`. Correct —
the sweep only touches `phase:"running"`.

**Control 2 — a live LOCAL run is protected, exactly as the 2026-08-26 fix intended.**
`drive-armC-701-local.mjs` started `a5a2bf9f-9a90-439b-b956-fc701435d8dd` (`phase:"running"`) and
issued **6** `GET /api/org/loop?org=kiro` reads from a second client over ~24 s
(`shots/armC-701-local.log`):
```
probe 1..6: GET /api/org/loop -> phase=running error=null active=this run
```
Not one read disturbed it. **This is what isolates the defect**: the reads *do* fire the sweep on
every request, and the only thing that spared this run was its live-registry entry — the one thing
`startRemoteRun` deliberately never creates. The local half is safe *because of* the registry, which
means the remote half is unprotected *because of its absence*. The blocker's premise is sound.

**Why the remote half could not be closed here — two independent, precisely-located gates.** Reaching
`phase:"running"` on a remote run requires `attachRemoteClaim`, whose only caller is the MCP
`claim_followups` tool. I minted a correctly-scoped org token
(`mcp:read`, `followups:write`, `telemetry:write`) and called it for real:
```
POST /api/mcp  (MCP-Protocol-Version: 2026-07-28, Mcp-Method: tools/call, Mcp-Name: claim_followups)
→ "xkazm04/kp is at autonomy tier T0: this organization has not cleared it for
   unattended AI authorship, so its follow-ups cannot be claimed by an agent."
```
1. **The admission override cannot be applied to this org's repos.**
   `POST /api/org/admission {"org":"kiro","repo":"xkazm04/kp","grantedTier":"T2",…}` →
   `{"error":"Provide repo as \"owner/name\" under this organization."}` — `repoUnderOrg`
   (`admission/route.ts:42-43`) requires `owner.toLowerCase() === org.toLowerCase()`, and org `kiro`
   watches `xkazm04/*` repos.
2. **Even a granted admission would not lift this gate** (see the new finding below): `repoGate`
   reads the *derived* tier only.

Raising the derived tier needs a fresh passport scan, and `LLM_PROVIDER=claude-cli` is over its
weekly cap until **Sep 1, 20:00 Europe/Prague**. So the remote half resolves
**`uncertain — not reproducible on this host`**.

> **Closing fixture (the cheapest route to a verdict):** an org whose **slug equals its repos' owner
> namespace** (e.g. seed org `xkazm04` rather than `kiro`), one repo scanned to a derived tier ≥ T1
> *or* `repoGate` taught to consult `listOrgAdmissions`, and a claude-cli quota window. Then:
> arm remote → `claim_followups` → confirm `phase:"running"` → `GET /api/org/loop` from a second
> client → assert the run is **not** stopped, no `"Interrupted — the server restarted…"`, claims not
> force-released, and no open-row-with-live-lease on the ledger.

*Secondary inconsistency from L1 (release sets `status:"open"` without clearing
`claimActor`/`leaseUntil`, `:365-369`) is unreached without a live claim and rides the same
`uncertain` resolution.*

---

## Surface-model gaps L1 missed

These came only from driving the live instance; none is visible from the static surface model.

**C-1 · The loop's "verifier" is the claimant's own commit message** *(elevates 702 from major
toward blocker).* `parseResolvedIds` over commit messages the *lane* wrote from the *agent's* own
`RESOLVED:` lines. `lane-commit.ts` names the contract — *"the trailer is a CLAIM, never a verdict"* —
and the cockpit renders it as the verdict. Explains the corpus's 46/46 tautology.

**C-2 · One rescan, two definitions of "closed."** `scans-persist.ts` applies the movement witness
(`decideInProgress`) before closing a ledger row; `rescanWorktree` → `recordLaneOutcomes` gets the raw
trailer set. Live consequence: cockpit says 46 closed, backlog says `done: 0`.

**C-3 · A silent agent claims its whole batch.** When a session names no ids — including a **timeout
that produced no report at all** — `lane-commit.ts` trails *every armed id*. Witnessed live on run
`a5a2bf9f`: 0 item verdicts, 5 `Ascent-Resolves` trailers. The most dangerous input to C-1 is not a
lying agent but a dead one.

**C-4 · Agent admission (moonshot #8) is not wired into the door it exists for.** `repoGate`
(`work-tools.ts:52-62`) resolves the claim gate from `getStanceRepoFacts(org)` → `row.autonomyTier`,
the *derived* tier. It never consults `listOrgAdmissions`. The admission table's stated purpose is
"the recorded, **overridable** per-repo decision" — but the one gate that decides whether an agent may
claim work cannot see the override. An owner who records `T2 / agents-allowed` still gets a T0 refusal.

**C-5 · An org whose slug ≠ its repos' owner namespace can never admit its own repos.**
`repoUnderOrg` requires `owner === org`. Org `kiro` therefore cannot grant admission to
`xkazm04/kp` at all — permanently T0, so the entire #3 remote protocol is unreachable for it. Not a
test artifact: `kiro` is this host's real working org.

**C-6 · `stop` is cooperative and the cockpit does not say so.** `stopLoopRun` (`loop-engine.ts:280-292`)
sets `state.stopRequested` and returns `{"ok":true}` immediately; it does not signal the in-flight
`claude -p`. My run read `running` for **19 minutes 43 seconds** after I stopped it, settling only at
the `ASCENT_AUTOPILOT_TIMEOUT_MS` (20 min) horizon. The run row has no `stopRequested` field, so the
cockpit shows an unchanged `RUNNING` chip after the operator pressed stop — with no "stopping…"
state and no indication of the wait. An operator will press it again, or conclude it failed.

**C-7 · A timed-out lane's error message becomes the commit subject.** Branch
`ascent/loop-20260831080428-xkazm04-kp` carries **1605 insertions across 15 files** of real work under
the subject `fix: Agent session exceeded 20 min and was stopped`. (Adjacent to L2-B-02: the sheet
header renders `col.agentConfig` — `opus` — with no engine label beside it.)

---

## Verdict table

| Check | Priority | Verdict | Anchor |
|---|---|---|---|
| **PRIYA-L1-702** — unverified claim rendered as "closed by the rescan" | 1 | **confirmed** (worse than filed; see C-1/C-2/C-3) | cockpit 46 "closed by the rescan" vs `backlog done:0`; `armC-run11open.text.txt:1803` |
| **PRIYA-L1-704** — per-lane ¢/point rendered nowhere | 2 | **confirmed** | API `microsPerVerifiedPoint:156684150`; 0 `¢` above the org price list; `.economics` → 0 hits |
| **PRIYA-L1-701** — cockpit read kills a running remote run | 3 | **mechanism confirmed** (no executor exclusion; local control passed) · **remote half uncertain — not reproducible on this host** | `loop-runs-write.ts:305-337`; `armC-701-local.log`; T0 gate + `repoUnderOrg` + claude-cli weekly cap |
| PRIYA-L1-703 (cloud posture) | 4 | **not attempted — precondition unsatisfiable** | needs `selfHosted()` false; this host is `ASCENT_SELF_HOSTED=1` and arm A's isolated instance was anonymous, not a cloud org member |
| PRIYA-L1-705 / 706 | 6 | **not attempted** | 705 needs ≥3 lanes × 2 models per dim (engine capped out); 706 needs a live remote brief, blocked with 701 |
| L2-D carryover | 5 | **not attempted** | needs a fresh GitHub-token scan; `autoscan.githubApp:false` + engine capped |

---

## Residue — everything this arm created or changed

| # | What | State now |
|---|---|---|
| 1 | `LoopRun dc3f8752-99b6-4283-9dc8-8070de27721a` (org `kiro`, `executor:"remote-agent"`, repo `xkazm04/kp`) — armed for check 3 | **Stopped.** `phase:"stopped"` via `POST {"action":"stop"}`. Never reached `running`; no lane ever claimed; no recommendation touched. Row is permanent (runs are not deletable through any app path). |
| 2 | `LoopRun a5a2bf9f-9a90-439b-b956-fc701435d8dd` (org `kiro`, local executor, repo `xkazm04/kp`) — the 701 local control | **Stopped**, `endedAt 2026-08-31T08:24:32Z`, `error:null`. Lane `done`. Stop was requested at 08:05 and honoured at the 20-min agent timeout. Row permanent. |
| 3 | 5 × `Recommendation` on `xkazm04/kp` flipped `open → in_progress` by run #2's dispatch | **Released.** Lane log: `08:24:32 Stop requested — … the batch is released.` Verified: `GET /api/org/backlog?org=kiro` reads `{"tracked":12,"open":3,"inProgress":9,"done":0}` — **identical to the pre-run reading**. |
| 4 | Git branch **`ascent/loop-20260831080428-xkazm04-kp`** in the paired working copy `C:/Users/kazda/kiro/kp` — 1 commit `d5c73a03`, 1605 insertions / 15 files, **5 `Ascent-Resolves:` trailers** | **Left in place, deliberately.** It carries real agent work; deleting it would destroy the deliverable. It is 1 of **27** pre-existing `ascent/loop-*` branches there — standard residue for this host, not an anomaly. `kp` is on `main`; its worktree list is clean of loop worktrees (the lane removed its own). |
| 5 | 2 × `OrgApiToken` on `kiro` — `29169d76…` (`uat-armC-701`) and `a24d9ef2…` (`uat-armC-701b`) | **Both revoked** (`DELETE /api/org/tokens/<id>?org=kiro` → `{"ok":true}` each). `GET /api/org/tokens?org=kiro` → `{"tokens":[]}`. Raw values **redacted** from `armC-701-token*.json` and the scratch file deleted; only the non-secret `tokenPrefix` remains. |
| 6 | `AuditLog` rows: 2 × `org_api_token.created` (+ any revoke rows), actor `developer` | **Permanent.** Audit rows are append-only by design; not deletable through any app path. |
| 7 | 1 × `POST /api/org/admission` (grant T2 / agents-allowed to `xkazm04/kp`) | **Rejected before any write** — 400 from `repoUnderOrg`. `GET /api/org/admission?org=kiro` → `{"rows":[],"stanceVersion":null}`, byte-identical to the pre-attempt capture `armC-admission-before.json`. **No row, no audit entry.** |
| 8 | 1 × `claim_followups` over MCP | **Refused at the tier gate** (T0). No row claimed, no lease taken, no `LoopRunLane` mutated. |
| 9 | 1 × real `claude -p` agent session (~20 min, org `kiro`, repo `kp`) | Ran against the user's subscription while it was **already over its weekly cap**; ended `Agent session exceeded 20 min and was stopped`, `cost unknown`. |
| 10 | New driver files `uat/driver/drive-armC-openrun.mjs`, `uat/driver/drive-armC-701-local.mjs` | Uncommitted working-tree files; reusable by later arms. |
| 11 | Artifacts under `shots/`: `armC-live`, `armC-run2`, `armC-run2open`, `armC-run11open`, `armC-final-verdicts` (`.png`/`.aria.yaml`/`.text.txt`/`.net.txt`), `armC-all-details.json`, `armC-runs-kiro.json`, `armC-detail-768acbbe.json`, `armC-backlog{,-closed}.json`, `armC-recs-*.json`, `armC-admission-{before,grant}.json`, `armC-701-{armed,claim,token,token2,localrun-final}.json`, `armC-701-local.log` | Run artifacts. |
| 12 | **Nothing else created**: no org, no scan persisted, no watched repo, no memory, no member, no credit grant, no gate policy, no AI stance. **`:3000` was never restarted.** | — |

**Pre-existing data I used but did not make** (provenance flagged): org `kiro` — 2 paired repos,
**20 loop runs** and their lanes/outcomes/price list from the 2026-08-30 campaign, and a backlog of
12 tracked rows (3 open / 9 in_progress). All predate this arm; treated as found fixtures. Two of
those 20 runs were pushed off the API's 20-row listing window by my two runs; the rows themselves are
untouched.

**Net state check:** `GET /api/org/loop?org=kiro` → `active: null`; both of my runs `stopped`;
`GET /api/org/tokens?org=kiro` → `{"tokens":[]}`; backlog counts unchanged. **No run left in a stuck
state.**
