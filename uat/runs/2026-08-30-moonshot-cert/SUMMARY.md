# UAT — `2026-08-30-moonshot-cert`

**Run id:** 2026-08-30-moonshot-cert · **L1 walked** 2026-08-30 · **L2 driven** 2026-08-30 → 2026-08-31
**Scope:** certify the moonshot programme's shipped-but-unverified work — 22 items across waves 1–4,
all landed on master `fca0c742` — through the standing roster, and pay the three owed journeys
(Dana M1, Sam, Tomáš). Registry declared and mapped (`.ai/registry-map.json`).
**Findings:** [`findings.json`](./findings.json) — 86 rows. **Baseline:** `uat/accepted-gaps.md` is
empty, so nothing was suppressed.

**The two-level design.** L1 is theoretical and mass-parallel: seven walkers build a surface model by
following import chains (never by grepping names), compute each Character's reachable surface set
*before* judging, and file impact-scored findings with `file:line` evidence. L2 is empirical and
serial: real browsers and real HTTP against a running app, with each finding's environment
precondition declared in advance, so a finding that cannot be reached resolves `uncertain`, never
`refuted`. Three arms were constructed, because one host cannot satisfy all seven journeys at once.

| Arm | Construction | Serves |
|---|---|---|
| **A — anonymous** | A second, isolated `next dev` on **:3100** with the three invalidating flags neutralized (`ASCENT_AUTH_BYPASS` empty, `PUBLIC_SCAN_QUOTA_DISABLED` empty, `ASCENT_SELF_HOSTED=0`), its own throwaway PGlite dir and `distDir`; anonymity asserted from the rendered ARIA before any evidence was trusted. `:3000` was never touched. | Tomáš; Sam's report surfaces |
| **B — seeded / authed** | The **shared** `:3000` dev server, reused and never restarted, against two pre-existing orgs treated as *found* fixtures: `public` (48 repos, 93 scans, real multi-day history) and `kiro` (two priced usage lanes). The low-data forecast fixture was **selected**, not written — the org shell already accepts `?range=custom`. | Dana, Nadia, Victor, Priya (standard); Sam's roadmap |
| **C — the loop arm** | The same shared `:3000` in its self-hosted posture (`autopilotEnabled()` true), org `kiro`, with the 2026-08-30 twenty-run campaign as a found corpus. Two runs armed and both stopped; two API tokens minted and both revoked. | Priya × loop-to-l5 |

---

## Scorecard

| # | Character × journey | L1 verdict | L2 delta |
|---|---|---|---|
| 1 | **Dana** × prove-and-track-fleet-maturity | `L1-conditional` | **Unchanged.** All three trust findings confirmed live; the low-data hedge proven *deleted* on screen, in the markdown, and through the PDF's identical conditional. One surface-model correction: the fleet has exactly **one** forecast surface (Briefing), not several. |
| 2 | **Sam** × scan-my-repo-get-a-roadmap | `CONDITIONAL PASS` | **Holds, with three corrections.** Guardband magnitude is **±6 / ±12, not ±25 / ±50**; the widened band is not merely mislabelled but *not drawn* (28.32 px on every dimension); and his `expectedLift` diagnosis is refuted — the UI seam exists, the outcome ledger does not. |
| 3 | **Tomáš** × evaluate-whether-to-adopt | `L1-conditional` | **Confirmed 5 of 5, one worse than filed.** `/report?repo=` does not merely lack a gate — it starts a live 155 s scan on page load, anonymously. See the verdict note below. |
| 4 | **Nadia** × supply-chain-and-governance-posture | `PASS WITH MAJOR RESERVATIONS` | **Unchanged, one finding worse.** `requireChecks` is not invisible — it renders read-only above an editor that silently deletes it. Three ledger findings resolve `uncertain` on an empty ledger (no GitHub App ⇒ no watched repo ⇒ no observations). |
| 5 | **Priya** × set-and-enforce-the-standard | `PASS with findings` | **Downgraded to conditional.** Her terminal step does not merely dead-end at a hand-written DB row: the next save through the form *undoes* that row. |
| 6 | **Victor** × repeated-org-scans-worth-the-price | `HOLD TEAM (renew)`, 3 conditions | **One check refuted, a bigger defect exposed.** Per-lane cost is not absent — it is on screen, and it is what proves the headline tile understates the page's own total by **78 %**. Renewal conditions: 3 → 4. |
| 7 | **Priya** × loop-to-l5 | `L1-conditional` (self-hosted pass / cloud fail) | **Self-hosted narrows, cloud unchanged and now double-gated.** 702 confirmed and materially worse; 704 confirmed; 701's mechanism confirmed and its local control *passed*, which is what isolates the defect. Two new blocking gates found (C-4, C-5). |

**A verdict tension I had to resolve.** Tomáš's L1 carried a standing instruction: *"If L2 confirms the
wall live against the real deployment, this journey becomes `L1-fail` retroactively — a buyer who
cannot run the scan has no journey."* L2 confirmed it. His own L2 verdict nonetheless reads
*"unchanged — L2-conditional, and the condition is one expression."* **Call: recorded as
`L2-conditional`** — the later judgment is the evidence-bearing one, made by the same Character after
seeing that the funnel behind the wall is genuinely good and that the fix is a single expression. The
retroactive-fail clause is noted here so the drain can overrule it if it disagrees.

---

## The blockers — final post-L2 state

### 1 · `TOMAS-L1-01` — the wall and the endpoint disagree, both halves live-proven

The moonshot's B2 lane un-walled the anonymous public scan **on the server** and left the landing
dialog locked on the old predicate. Arm A proved both halves in one anonymous session, thirty seconds
apart:

```
hero CTA  ->  dialog "Scan a repository": no repo input, "Sign in to scan.
              Scanning is for signed-in members on this deployment."
curl      ->  POST :3100/api/scan, no cookie  ->  HTTP 200 in 3.323 s, full report body
```

The dialog's own paragraph — *"Paste any GitHub repo and a live model reads it — under 2 minutes"* —
sits directly above the panel that says he may not. `grep -rn publicScanSignInRequired
src/components src/app/page.tsx` → **0 hits**: the predicate the server now gates on has no client
reader at all. The fix is one expression: pass `gated && publicScanSignInRequired()`.

Its twin, `TOMAS-L1-08`, is worse than filed. Arm A found that `/report?repo=…` does not show a card
or ask for a click — **the live scan starts on page load**, ran 155.4 s on claude-cli/opus, and
returned a full 27/100 report with radar, waterfall, roadmap and per-dimension evidence, under the
same header carrying the Sign-in button. So the wall is not a security control, not a cost control
(the limiter and the quota sit outside it), and not a signup funnel. It bounces the visitors who trust
the front door and converts the ones who guess a URL.

### 2 · `PRIYA-L1-701` — reading the cockpit kills a running remote run

**Mechanism confirmed.** `markStaleRunsStopped` selects `{phase:"running"}` and filters only on
`!isLive(id)`; `grep -n executor src/lib/db/loop-runs-write.ts` returns hits at the three lane-creation
paths and **none inside the sweep**, though `executor` exists on the lane. `route.ts:58` fires the
sweep on every GET, and `startRemoteRun` documents that it adds no registry entry — so `isLive` is
false for a remote run by construction.

**Local half confirmed SAFE, and that is what isolates the defect.** A live local run survived six
`GET /api/org/loop` reads from a second client over ~24 s, `phase=running error=null` every time. The
reads *do* fire the sweep; the only thing that spared the run was its live-registry entry — precisely
the entry a remote run never gets.

**Remote half `uncertain — not reproducible on this host`,** and the two reasons are themselves new
findings: `claim_followups` refused at autonomy tier T0 (`PRIYA-L2-C4` — `repoGate` reads the *derived*
tier and never consults the recorded admission override), and the override could not be recorded at
all (`PRIYA-L2-C5` — `repoUnderOrg` requires `owner === org`, and org `kiro` watches `xkazm04/*`).
Raising the derived tier needs a fresh passport scan, and claude-cli is over its weekly cap until
Sep 1 20:00. **Fixing either C-4 or C-5 unblocks the fixture** — the cheapest route to a verdict.

### 3 · `PRIYA-L1-702` — outcome laundering. Is it blocker-grade?

Arm C escalated this from "the panel labels an unverified claim as verified" to a mechanism:

```
agent writes "RESOLVED: x"  ->  lane-commit.ts stamps `Ascent-Resolves: x` into the commit
  ->  engine.ts:394 parseResolvedIds(commit messages)  ->  loop-lane.ts:383 closedIds
  ->  recordLaneOutcomes writes `resolved`             ->  panel prints "closed by the rescan"
```

The claimant and the verifier are one hop apart. `lane-commit.ts`'s own header states the contract —
*"the trailer is a CLAIM, never a verdict"* — and the cockpit renders it as the verdict. That is why
all **46 of 46** stored `resolved` outcomes across 20 runs are also in their lane's `closedIds`: not
agent honesty, a tautology. Two live facts make it concrete:

- **Two products disagree about the same repos.** Cockpit: 46 items *closed by the rescan*. Ledger:
  `GET /api/org/backlog?org=kiro&includeClosed=1` → `{tracked:12, open:3, inProgress:9, done:0}`.
  Item timelines show `lane_verdict → resolved` and `status: open -> in_progress`, with **no `-> done`**.
  Cause: `scans-persist.ts` runs the trailer set through the movement witness before closing a ledger
  row; `rescanWorktree` hands `recordLaneOutcomes` the **raw, ungated** set.
- **The dangerous input is a dead agent, not a lying one.** The local control run was killed by a
  20-minute timeout, reported **0 item verdicts**, and its lane still wrote *"5 `Ascent-Resolves`
  trailer(s) (the session named no ids, so the whole armed batch is claimed)"*. Only an operator stop
  landing one step before the rescan prevented five rows reading *"closed by the rescan."*

**Judgement: NOT blocker-grade — but ranked #1 in the drain.** Its impact triple
(`frequency: high · reachability: high · trust_erosion: high`) is the highest in the run, and the
defect is systemic rather than occasional. But the rubric's `blocker` means the Character cannot
complete the job, and Priya completes it and says so: *"I would still roll this out. I would not show
anyone the verdict panel until it says which of those two numbers it means."* That is `major` — a
verdict she would not defend — at the very top of the band. Drain order is impact-weighted, not
severity-ordered, which is why it sits above both blockers: `TOMAS-L1-01` is one expression away from
gone, and `PRIYA-L1-701`'s surface is unreachable on any host today.

---

## The systemic theme: present-but-unwired

The run brief predicted it — *"the moonshot merged 30+ lanes, which is exactly the refactor-shape that
produces present-but-unwired"* — and made the wiring audit a standing rule: **a zero-hit
`grep <field> <ui-dir>` is a finding by construction.** It is the largest class in this run.
**Twenty-two members, found across all seven journeys; seventeen of them by a literal zero-hit grep.**

| Member | What is built | What reads it | Row |
|---|---|---|---|
| `forecastBasis` | composes *"fit over 5 scan days across 4 days, 3 of them compacted"* — pure, tested three ways, docstring says the briefing calls it | nothing (definition + its own test) | DANA-L1-013 |
| `getCompactionCoverage` | org-level reader with honest-null semantics, barrel-exported | nothing — and the rollup never sets `compacted`, so the count is structurally 0 | DANA-L1-014 |
| digest `controlsFailed: []` | a deliberate three-state contract, unit-tested | the only production caller sends `undefined` when empty; the branch is unreachable | DANA-L1-015 |
| `expectedLift` / `lifts` | measured-basis clause, conditional sort toggle, `?sort=measured` — the *seam exists* | nothing publishes a basis, because no path produces an outcome row | SAM-L1-09 |
| `rubricVersion` | load-bearing in the corpus filter, the outcome ledger and the digest keys | absent from `RegisterEntry`; the public leaderboard ranks across rubric bumps | TOMAS-L1-11 |
| `publicScanSignInRequired` | the server's new public-funnel predicate | no client reader — the landing still uses `authGateEnabled()` | TOMAS-L1-01 |
| `NEXT_PUBLIC_SOURCE_REPO_URL` | four consumers, a deliberate no-default | set in no production env file; the only github.com URL on the site is the Feedback issue tracker | TOMAS-L1-10 |
| `PUBLIC_SCAN_WEEKLY_LIMIT` | documented in `.env.production` and `.env.example` | `grep src/` → 0; the code reads a *monthly* variable | TOMAS-L1-09 |
| `failMeans` | *"printed beside the state so nobody reads fail as insecure"* | 0 consumers — the red "not operating" ships without its disclaimer | NADIA-L1-02 |
| `stateTone` | the catalogue's tone mapping | 0 non-test callers; re-implemented inline in the card | NADIA-L1-02 |
| `descriptor` | *"a surface must render the value, not the state"* | 0 hits in the governance UI; Visibility renders "operating · public" | NADIA-L1-03 |
| `truncated` / `limit` | `/api/org/controls` computes the cap disclosure, with a comment saying why | the card never calls the route (`grep api/org/controls` → 0) | NADIA-L1-01 |
| control-ledger CSV | `SEAL_RECIPE` publishes the row-digest field order and the day-root construction | no export exists to recompute it over; `?format=csv` is ignored | NADIA-L1-04 |
| `/api/audit/verify` | the only thing that *seals*, plus a full integrity verdict | one non-interactive `<code>` string, inside the card's non-empty branch | NADIA-L1-05 |
| seal backlog | `sealPendingDays` caps at 14 days per call | the cap is in a comment and nowhere in the response | NADIA-L1-06 |
| admission `propose` / `ruleset` | three of the compiler's four artifacts | 0 `.tsx` callers | NADIA-L1-09 |
| `listOrgAdmissions` | the recorded, *overridable* per-repo decision | the one gate deciding whether an agent may claim work never reads it | PRIYA-L2-C4 |
| `schemaAhead` + parse `notes` | *"parsed leniently, flagged honestly"*, persisted | 0 consumers under `src/features` — including redaction notes | PRIYA-L1-04 |
| report-back column | spec #35 handoff 2: `getFoundationRollout` on the capability matrix | one consumer, on a different tab | PRIYA-L1-05 |
| `.economics` / `microsPerVerifiedPoint` | computed, serialized, shipped to the browser | `grep -rn "\.economics" src/features src/app` → **0 hits**, reproduced live | PRIYA-L1-704 |
| `showback` view | the finished finance CSV — lanes, teams, unpriced counts, reconciling exactly | `grep showback src/app src/components src/features` → the route only | VICTOR-L1-02 |
| `teamKey` | the column answering "which team drove this lane" | no `meter()` caller passes it — even the local lane, which knows its repo | VICTOR-L1-04 |
| `queueDepth()` | the cadence-backlog number | only the two cron routes' JSON | VICTOR-L1-07 |

Three things are worth saying about the class rather than about its members.

**It costs more trust than an absence does.** Dana said it plainest: *"When a thing is missing, I think
'they haven't got to it.' When a thing is built, tested, documented as being wired, and isn't — I stop
trusting the inventory."* Nadia reached the same place from the other side: *"the design is better than
the wiring."*

**Half-shipping can be worse than not shipping.** Two rows in this run are defects *created by a fix*.
The integrity chip (`RV-B6`) closed Sam's disclosure gap and turned the provenance track from an
omission into an on-page contradiction. And `requireChecks` is not invisible, as two walkers
independently assumed — it renders read-only directly above an editor that cannot set it and deletes
it on the next save, which is strictly worse than invisible.

**Almost every member is cheap.** One env var, one prop, one import, one button, one predicate. The
expensive exceptions are the two where the *data* is missing rather than the wire: `expectedLift`'s
outcome ledger, and `compacted` in the org rollup.

---

## What passed — strengths, and the prior findings that closed

Ten strength rows carry `resolution: "strength"` in `findings.json`, each with a
`suggested_acceptance` beginning **PROTECT**. The four that decide verdicts:

- **r11's D1 coherence read** (`TOMAS-L1-S1`, corroborated by Sam). Five instruction formats used to
  sum on presence — 22+16+14+14+10 = 76 — so a repo with four contradicting copies outscored a repo
  with one true document. r11 collapses them into one award plus `round(18 × coherence/100)`, grades
  content on the *canonical* document, and makes D1 claim-scored so the model's number is recorded and
  ignored. A vendor that takes points away from its customer's most likely configuration is why Tomáš
  would carry the number upstairs. *Ceiling: not exercised live — arm A's subject carried no guidance
  documents at all.*
- **The shared briefing composers** (`DANA-L1-017`). Three prior findings were fixed inside the shared
  functions, so screen, board PDF, share page and Copy-for-LLM markdown got them at once — verified on
  the artifact: three different denominators (*scanned*, *comparable*, *sharing the gap*), each named
  in place. *Ceiling: the same page still fails on trajectory honesty.*
- **The honest-null discipline** (`NADIA-L1-S1`; Priya calls it "the best I've seen in this product").
  `unmeasurable` is a first-class third arm and never renders as failure; `unchecked` outranks `pass`
  so an unmeasured clause cannot hide behind a measured sibling; a "Not judged" tile keeps the
  denominator from swallowing a repo; unreadable governance yields `unmeasurable`, never `fail`.
  *Ceiling: the one place it breaks is where the authored contract is not read at all.*
- **The loop's refusal to flatter** (`PRIYA-L1-S2`). Every price cell carries its `n`; unproductive
  spend is its own line and never a denominator; `pickDriveModel` returns null rather than choose on a
  self-fulfilling sample; lessons sit behind a human door that says *"not in memory until you keep
  one"*; the PR door is the one control whose effect leaves her machine and the only one that asks her
  to type the repo name.

Also recorded: Sam's assertion-substance detector and the model's willingness to call the product's own
detectors wrong (`SAM-L1-S1`); the advisory/D9 claim separation with its *"that is NOT a clean bill of
health"* degraded banner, and the audit CSV with a recomputed per-row integrity verdict
(`NADIA-L1-S2`); the `.ai/` standard that reads its own output back and the blast-radius gates on
secrets provisioning (`PRIYA-L1-S1`); the honest-null lane meter (`VICTOR-L1-S1`); pricing that leads
with the free way not to pay for it (`TOMAS-L1-S2`); and the loop-proof line's *"on branches, not
merged"* clause (`DANA-L1-016`).

**Eleven prior findings closed at root** and are carried forward as rows (`RV-*`), not as prose — seven
`resolved-verified` (live evidence exists) and four `fixed` (code-verified only). Each names its honest
remaining limit in a `ceiling` field:

| Row | Prior finding | Resolution | Ceiling |
|---|---|---|---|
| `RV-B2-public-scan-endpoint` | B2 / TOMAS-L1-01 server half | resolved-verified | The client half is this run's first blocker; the server fix is worth nothing to a buyer until the button changes |
| `RV-B3-briefing-denominators` | B3 / DANA-L1-010 · -011 · -012 | resolved-verified | The same artifact still fails criterion 5 — it reconciles, and its forecast does not |
| `RV-B6-integrity-chip` | B6 / SAM-L1-02 half A | resolved-verified | The fix created SAM-L1-02's on-page contradiction |
| `RV-B10-scan-duration` | B10 / TOMAS-L1-03 | resolved-verified | The honest sentence lives in the dialog TOMAS-L1-01 replaces; the hosted-inference clause was not measured |
| `RV-TOMAS-L1-06-enquiry-dialog` | TOMAS-L1-06 | resolved-verified | Presence confirmed; the POST round-trip deliberately not exercised |
| `RV-M11-meter-wiring` | moonshot #11 | resolved-verified | Three defects ride on top of correct instrumentation |
| `RV-LOOP-lane-commits-its-work` | 2026-08-29 L2-A-01 / B-01 / C-02 | resolved-verified | The proving commit landed under the subject `fix: Agent session exceeded 20 min and was stopped`, and the same lane claimed all five armed ids for a session that reported nothing |
| `RV-B1-credit-banner` | B1 / DANA-L1-003 | fixed | Not driven; needs a fresh Free org — the cheapest fixture in the run |
| `RV-B4-signal-paths` | B4 / SAM-L1-01 majority | fixed | Arm A's subject was absence-shaped, so no path-cited D1 line could be exhibited |
| `RV-SAM-L1-03-badge` | SAM-L1-03 | fixed (by removal) | The *job* is now unserved; criterion #6 scored N/A — see SAM-L1-12 |
| `RV-M10-queue-replaces-continue` | moonshot #10 | fixed | Not driven; needs a bulk scan that hits the wall-clock budget |

---

## Time-saved ledger

Each Character's baseline comes from their own character file, never re-estimated here. The L2 column
corrects the L1 estimate only where live evidence moved it.

| Character | Manual baseline | Ascent, as built | Net | L2 correction |
|---|---|---|---|---|
| **Dana** | 4–8 weeks of DORA pulls, repo sampling, interviews and deck assembly | ~25 min to a defensible read; ~20 min per later board cycle | **≈150–235 h saved on cycle one; ≈35–75 h per quarter after** | Unchanged. The leak stays 2–4 h per cycle spent hand-verifying the scan-day count before quoting an ETA — and L2 confirmed there is no in-product way to do it |
| **Sam** | ~6 h — clone, read the CI config and the suite for real assertions, grep conventions, hand-write a plan | ~3 min to a credible verdict | **≈5 h 40 net** (up from 5 h 20 on 2026-08-10, entirely on B4 + r11) | **Improved to ≈5 h 50.** Arm A found the LLM narrative already names `.github/workflows/main.yml` and `readme.md`, so the D3 re-grep deduction is closer to 5 min than 15 |
| **Tomáš** | no tool at all — Copilot acceptance dashboards, a DX survey, a spreadsheet of AI-touched-commit percentages | ~75 s of self-serve reading + one ~100 s scan, replacing a demo request and a 30–45 min sales call | **≈40 min saved if the front door worked; ≈0 as configured** | **Confirmed at 0 through the front door.** He reached the product only by routing around it; a visitor who guesses `/report?repo=` gets the full ≈38 min |
| **Nadia** | 10–14 h per audit cycle, stale on export, not repeatable | ~35 min across Security, Governance, the pack and the audit CSV | **≈7–10 h saved per cycle, re-pullable** | Unchanged; the +2–4 h rework (re-deriving the control table by hand) is unretired, and the published verification remains unexecutable |
| **Priya — standard** | 2–3 weeks authoring + ~1 day per repo of conformance review, re-run per revision | minutes to generate, one afternoon to roll out, then continuous from each repo's own CI | **≈150–200 h in the first quarter at 25 repos** | **Worse.** The last mile was costed as one hand-written DB row; L2 shows the next save through the form deletes it, so the row must be re-written after every policy edit |
| **Priya — loop** | ~1 day per repo, manual | five rounds, 19 → 38, L1 → L2, mostly unattended | **≈8–10×, and the economics panel now turns it into a budget line** | Carried from 2026-08-29 — arm C could not run the engine (weekly cap). The **remote** posture stays **negative**: token minting plus hand-built batches plus a run that dies when observed is slower than pasting the brief in by hand, and it is now double-gated |
| **Victor** | 30–45 min per cycle of spreadsheet work + a quarterly 60-min deep cut | a ~3–5 min monthly glance | **≈30 min saved per cycle**; the quarterly deck still costs ~10 min of hand-work | **Same minutes, new risk.** The 10 min was for finding the showback CSV; L2 adds that the number he would paste instead is wrong by 78 % |

---

## Environment ceilings — what this host could not certify

Every one of these resolved `uncertain — not reproducible on this host`, never `refuted`, with the
closing fixture named on the row.

| Ceiling | What it blocked | Closing fixture |
|---|---|---|
| **No GitHub App** (`autoscan.githubApp: false`) | No repo can be *watched*, so `recordConformance` returns `recorded:false` and **no `ControlObservation` row can be created through any app path** — which blocks NADIA-L1-01, -02, -03 and -06, the digest Controls block (DANA-L1-015), and the whole #35 secrets-provisioning and pr-batch flow (PRIYA-L1-S1's ceiling) | An installed App with `Secrets: write` on a test org — or a direct `WatchedRepo` insert, then the same conformance POST |
| **claude-cli weekly cap** (over quota until Sep 1, 20:00 Europe/Prague) | No lane in arm C could produce a real agent report; no fresh passport scan could raise a derived autonomy tier; PRIYA-L1-705's model-switch fixture (≥3 lanes × 2 models per dimension) is unreachable | A quota window |
| **Remote executor unreachable** | PRIYA-L1-701's remote half. Gated twice: `claim_followups` refuses at T0 because `repoGate` reads the derived tier only (C-4), and the override cannot be recorded because `repoUnderOrg` requires `owner === org` (C-5) | An org whose slug equals its repos' owner namespace (seed `xkazm04`, not `kiro`), or `repoGate` taught to consult `listOrgAdmissions` |
| **No cloud posture** | PRIYA-L1-703 was not attempted — it needs `selfHosted()` false, and this host is `ASCENT_SELF_HOSTED=1` while arm A's isolated instance was anonymous, not a cloud org member | A cloud-shaped deployment, an org-owner session, and a token with `followups:write` |
| **No outcome ledger** | SAM-L1-09's measured arm. No seeder produces outcome rows and there is no app path to insert them | ≥3 `kind:"recommendation"` outcome rows sharing one `recommendationMatchKey` and one instrument |
| **Single-rubric corpus** | TOMAS-L1-11 — on a freshly seeded host every row is r12, so a cross-rubric ranking is real but invisible | A corpus spanning ≥2 rubric versions (production almost certainly qualifies) |
| **Narrative LLM surface off** (`BRIEFING_NARRATIVE` + `ANTHROPIC_API_KEY` both unset) | DANA-L1-005 and -009 | Both env flags set |
| **`ASCENT_EMPTY` / DB-off arms** | SAM-L1-04's arm (b) — the instance boots PGlite in-process and a restart would have cost the arm | A second instance with `DATABASE_URL` unset |
| **The `public` slug trap** | Discovered *by* L2 (`VICTOR-L2-01`): `meter.ts:219` drops every non-scan model call for an org whose slug is literally `public`, so a genuine 12.1 s claude-cli turn recorded nothing. It silently invalidated one arm before the cause was found | Any non-`public` org slug — `kiro` proved the lane path works |

---

## Recommended drain order

Ranked by **impact** (frequency × reachability × trust erosion), not by severity — which is why the
run's #1 is a `major` and one of its two blockers sits at #11.

| # | Finding | Why it is here |
|---|---|---|
| 1 | **PRIYA-L1-702** — outcome laundering | The highest impact triple in the run, and systemic rather than occasional: the loop's most load-bearing word is the agent's own claim, the ledger that applies the real gate reads `done: 0`, and a *timed-out* session claims its whole batch |
| 2 | **TOMAS-L1-01** (+ `-08`) — the wall the server already lifted | A blocker that ends the buyer journey at the first click, live-proven on both halves, and the fix is one expression. Highest value per line of code in the run |
| 3 | **SAM-L1-02** — the page contradicts itself about the guardband | The chip says DOUBLED, the title says ±6, the rectangle measures ±6. Three statements, two wrong, on the number a staff engineer would defend in front of a VP — and it is a contradiction the previous release did not have |
| 4 | **NADIA-L1-07** (+ PRIYA-L1-01) — `requireChecks` visible, unsettable, silently deleted | An adjacent save destroys a merge-blocking control and the audit row proves the app knew. It is also the terminal step of a second Character's whole journey. Ship PRIYA-L1-02's fleet-count honesty in the same PR |
| 5 | **DANA-L1-002** (+ `-001`) — the board PDF projects from a sample the app refuses to project from | Briefing and Delivery contradict each other one click apart, and the confident one is the artifact with the org's name on it. Third run of the hedge-deletion finding |
| 6 | **VICTOR-L1-05** — the headline cost tile understates by 78 % | The big number on the billing page is the small one, and the page prints the real total three rows below it. A FinOps director reads the big number first |
| 7 | **SAM-L1-11** — the provenance track draws a mechanism that does not exist on 3 of 9 dimensions | D1, D4 and D9 plot an inert "LLM judgment" tick inside a band the model cannot move. Proven live by D1 vs D8 on identical signals. It hides a selling point — those dimensions are *fully reproducible* |
| 8 | **DANA-L1-013** (+ `-014`) — `forecastBasis` unwired | The exact sentence a three-run-old finding asked for is written, tested, documented as wired, and called by nothing. One call site, and it is the archetype of the whole systemic theme |
| 9 | **PRIYA-L1-704** — per-lane ¢/point rendered nowhere | The one figure that defends the programme to a VP is computed, shipped to the browser and thrown away, while the org-wide average that *does* render is what hides a $10.19-for-zero-points lane |
| 10 | **TOMAS-L1-10** + **VICTOR-L1-02** — one env var and one button | The cheapest pair on the list: an AGPL product whose only github.com URL is its issue tracker, and a finished finance CSV that is correct, reconciling, and linked from nowhere |

Just below the line, and worth reading as a group: **PRIYA-L1-701** (#11 today only because its surface
is unreachable — reachability jumps to high the moment C-4 or C-5 lands, and either is a small fix),
**NADIA-L1-04/-05** (a published verification recipe with no rows to run it on, and sealing that
happens only as a side effect of a URL nobody is shown), and **SAM-L1-04** (a permalink the pricing
page sells at $0 and the product never hands over — the same item would serve SAM-L1-12's unserved
README job).

---

## Housekeeping for the next run

- **Two overlay denominators are stale.** Victor's character sheet says Team = 500 credits/mo; the code
  says 150 (`plans.ts:234`, repriced 2026-08-19). Sam's Surface A grounding list was derived 2026-08-10
  and the prompt builder has changed twice since (r11's guidance block, r12's `craftBuiltBlock`). Both
  walkers correctly took the denominator from the code and did **not** change the overlay; `/uat update`
  should re-derive both before the next sweep or cross-run trends will drift.
- **Sam's scored criterion #6** (a badge he would stake his name on) has no object since the badge
  retirement. It must be decided, not left scoring N/A — see `SAM-L1-12`.
- **Residue is fully ledgered** in `_L2-armA.md`, `_L2-armB.md` and `_L2-armC.md`. Net state: org
  `public`'s gate policy restored to `null`; both arm-C loop runs stopped and no run left stuck; the
  five claimed recommendations released (backlog counts byte-identical before and after); both minted
  API tokens revoked and their raw values redacted; the admission grant rejected before any write.
  Permanent by design: append-only audit rows, two `LoopRun` rows, and one branch in the paired working
  copy carrying real agent work.
