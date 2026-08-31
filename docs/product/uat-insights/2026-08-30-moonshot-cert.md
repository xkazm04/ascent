# UAT drain: `2026-08-30-moonshot-cert`

> Drained 2026-08-31 with `/uat drain` (skill v1.8.0). Source run:
> `uat/runs/2026-08-30-moonshot-cert/` — 7 Character × journey pairs, **86 findings**, three L2 arms
> (A anonymous · B seeded/authed · C the loop arm), all seven per-Character reports read at **both**
> voice levels, plus `_L1-BRIEF.md`, `_L2-PREFLIGHT.md` and the three arm journals.
> Recurrence baseline: [`2026-08-10-ascent-first.md`](./2026-08-10-ascent-first.md).
> Build items land in [`docs/BACKLOG.md`](../../BACKLOG.md) § *UAT drain — 2026-08-30-moonshot-cert*.
> Registry: **declared and mapped** (`.ai/registry-map.json`, 54 contexts / 199 pairs); every build
> item below carries a `standard:` line, `none` where nothing governs it.

**Panel verdict the document hangs off: the wiring is behind the design, and half-shipping now costs
more trust than the original absence did.** The prior drain's verdict was *"the reasoning is ahead of
the reporting."* One release later the reporting has genuinely caught up in three places — the
briefing's denominators, the integrity chip, the honest-null vocabulary — and the new failure mode is
one layer further out: **twenty-two payload halves that shipped without their consumer**, and **two
defects created by a fix**. Dana names the cost precisely, and it is the sentence this whole drain is
organised around:

> *"When a thing is missing, I think 'they haven't got to it.' When a thing is built, tested,
> documented as being wired, and isn't — I stop trusting the **inventory**. I don't know any more
> which of the other reassuring functions in there are actually running."* — Dana, L1 voice

---

## 1 · Confirmed-and-fixed (reference only — the ceilings are inputs to §2)

Eleven prior findings closed at root and are carried in this run's `findings.json` as `RV-*` rows —
seven `resolved-verified` (live evidence), four `fixed` (code-verified only). This is the schema
discipline the prior drain asked for in its §3, and it arrived: **every row in this run carries a
`resolution`**, and every closed row carries a `ceiling`.

| Row | What closed | Resolution | **Ceiling — and where it lands in §2** |
|---|---|---|---|
| `RV-B2-public-scan-endpoint` | `scanAuthGate` exempts the anonymous public funnel by default; cookie-less `POST /api/scan` → **200 in 3.3 s** (arm A) | resolved-verified | **The client half was never changed.** The hero dialog still locks on `authGateEnabled()` alone. The server fix is worth nothing to a buyer until the button changes → **§2 A2** |
| `RV-B3-briefing-denominators` | DANA-L1-010/-011/-012 fixed **inside the shared composers**, so screen, PDF, share page and markdown got them at once. Live: *"fleet +2 pts across 48 scanned repos"* · *"1 of 1 repos with a comparable prior scan moved (of 48 scanned)"* · *"shared by 2 of the 48 scanned repositories"* | resolved-verified | The same artifact still fails criterion 5. Dana: *"passes on reconciliation, fails on trajectory honesty — and it is the same page."* → **§2 A1** |
| `RV-B6-integrity-chip` | `scoreIntegrity` is persisted and disclosed by one shared `integrityNotes` record; live chip read `integrity · widened D2, D6 · blend 95%`. Sam: *"exactly the disclosure I said was missing last time, and it's good."* | resolved-verified | **The fix created a new defect.** The provenance track still asserts the undoubled band and draws it 28.32 px wide on every dimension, so the page now contradicts itself where it used to merely omit → **§2 A3** |
| `RV-B10-scan-duration` | The "about a minute" promise is gone; `scanDurationClaim()` composes over the same constants the progress bar runs on and rounds *away* from the flattering number. Live: 155.4 s, no early client timeout | resolved-verified | The honest sentence lives **in the dialog TOMAS-L1-01 replaces** — on a walled deployment the buyer never reads it. The hosted-inference clause was not measured (no hosted provider on this host) → **§2 A2** |
| `RV-TOMAS-L1-06-enquiry-dialog` | The bespoke tier opens a real enquiry dialog (`PlanEnquiryCta`), keyed off the billing **model** not the tier id, with the `ASCENT_CONTACT_EMAIL` dependency gone | resolved-verified | Presence and affordance type confirmed; the POST round-trip was deliberately not exercised (residue rule) |
| `RV-M11-meter-wiring` | Moonshot #11: all five lanes produce events, every lane total reaches `/usage`, `decideCharge` is a no-op generalisation. Live on `kiro`: `Scan $25.90 (43) · Local agent $89.38 (53)` with the unpriced count beside it | resolved-verified | **Three defects ride on top of correct instrumentation**: the headline tile understates by 78 % (**§2 C2**), the showback CSV is unlinked (**§2 C9**), and every non-scan call for an org slugged `public` is dropped (**§2 C10**) |
| `RV-LOOP-lane-commits-its-work` | 2026-08-29's L2-A-01/B-01/C-02: the lane commits the agent's work (`d5c73a03`, 1605 insertions / 15 files), lost work renders as its own `uncommitted` state, stranded worktrees are swept | resolved-verified | **Two new defects ride on the fix**: the proving commit landed under the subject *"fix: Agent session exceeded 20 min and was stopped"* (**§2 C16**), and the same lane trailed **all five armed ids for a session that reported nothing** — the most dangerous input to **§2 C1** |
| `RV-B1-credit-banner` | `creditNotice` deleted its local arithmetic and calls `resolveScanCharge` — the same function that issues the 402. Dana: *"the version I'd have insisted on if you'd asked me."* Victor re-verified independently | fixed (code) | **Not driven.** Needs a fresh Free org (0 credits, 0 scans) — the cheapest fixture in the run, and it pairs with **§2 C11** |
| `RV-B4-signal-paths` | B4 majority: `found()` recovers the matched path into `Signal.detail` (`grep -c detail` → 15, was 1); D1/D4 model claims render as `path: "quote"` | fixed (code) | Arm A's live subject was absence-shaped, so no path-cited D1 line could be exhibited — which is also what **weakened** the D1-vs-D3 contrast. Residue → **§2 A7** |
| `RV-SAM-L1-03-badge` | The badge surface was removed wholesale (`773c9aa0`); journey and Character retired. A product decision, not a defect | fixed (by removal) | **The job is now unserved** and scored criterion #6 read N/A this run. Ruled in **§2 A4** — it is not allowed to evaporate |
| `RV-M10-queue-replaces-continue` | Moonshot #10: the truncated `Continue` button is gone; `queued` frame + passive poll + two-speed freshness cell, `creditCharged` on the job row | fixed (code) | Not driven — needs a bulk scan that hits the wall-clock budget. Residual gap (no org-wide queue depth) → **§2 C19** |

**Two prior *method* items also closed, and both closures are §3 material.** `M2` (the env.md fixture
gap that blocked B9 from ever reaching `resolved-verified`) was closed **by selection, not by
seeding** — arm B found org `public` already carries 93 scans over four calendar days and the org
shell already accepts `?range=custom`. `M3` (emit `resolution` on every row) was honoured: 86 of 86.

---

## 2 · Design opportunities, ranked

Ranking is the skill's contract: **recurrence first**, then **convergence**, then **voice
escalation**, then impact arithmetic. `[B]` build · `[C]` concept-doc · `[M]` method-commitment ·
`[D]` decline · `[X]` covered-elsewhere. Every item names its backlog id.

> **Read the order as a triage key, not a work queue.** The run's single highest-impact finding
> (`PRIYA-L1-702`, impact `high/high/high`, the highest triple in the run) is first-raised, so the
> recurrence rule places it at **C1** rather than at the top. If only three items ship this week they
> are **C1**, **A2** and **A3** — one systemic trust defect and two contradictions the product makes
> about itself on a page it asks a customer to believe.

### Band A — recurrence (a gap the last drain recorded, returning unbuilt)

#### A1 · `[B]` The board forecast still deletes its hedge — and the composer that would replace it has zero callers · **recurrence 3** → `MC-B1`
`DANA-L1-001` (recurrence **3**, prior B9) + `DANA-L1-002` (recurrence 2) + `DANA-L1-013` +
`DANA-L1-014`.

**Verified, not theorised** — arm B holds the artifact (`_L2-armB.md` check 2), two windows over one
org in one session, no rows written:

```
range=90d  (n≥3) → "Trajectory: Declining at -2/wk … (trend confidence 34%, noisy)"
custom 08-21→24  → "Trajectory: Climbing at +35/wk, staying within L4 · Integrated for now."
Briefing → Climbing at +35/wk        Delivery → Not enough history to project: 2 distinct scan days
```

The weaker the evidence, the more confident the sentence, and one click away the product refuses to
make the same claim. `forecastBasis` — which composes *"fit over 5 scan days across 4 days, 3 of them
compacted"*, is unit-tested three ways, and whose docstring **names a caller that does not exist** —
has zero non-test callers.

> *"There is a function in your codebase called `forecastBasis`. It returns 'fit over 5 scan days
> across 4 days, 3 of them compacted.' That is my sentence. That is exactly, word for word, the thing
> I have been asking for. It has a comment saying it's called by the executive briefing. **Nothing
> calls it.**"* … *"The ETA I would delete from the slide before presenting. Not because I think it's
> wrong. Because when Marcus on the audit committee asks 'based on what?' — and he will, it's the only
> question he asks — the honest answer today is 'I couldn't find out either.'"* — Dana

**Cost/value:** hours, and L2 narrowed it further — the fleet has exactly **one** forecast surface
(Briefing), not several, so this is one call site plus one guard. Third cycle of the same finding;
Dana has now paid for it three times. **Build.** The `compacted` half (`DANA-L1-014`: `org-rollup.ts`
never sets the flag, so `compactedPoints` is structurally 0) is `hypothesis` for its *user-visible*
consequence — the grep is unambiguous, but no purged-history fixture exists to demonstrate it.
**Guardrail (G4 / `DANA-L1-016`):** the basis clause degrades to **absence**, never to a fabricated
basis, and branch points never fold into the bought number.
`standard: metric-forecasting/projection-presentability-gates` (also `fit-confidence-honesty`).

#### A2 · `[B]` The wall the server already lifted · **recurrence 2, blocker** → `MC-B2`
`TOMAS-L1-01` (blocker) + `TOMAS-L1-08`. Arm A proved both halves in one anonymous session thirty
seconds apart; `grep -rn publicScanSignInRequired src/components src/app/page.tsx` → **0 hits**.
`/report?repo=` is worse than filed: it does not gate at all — the live 155 s scan **starts on page
load**, anonymously.

> *"This is not a wall — it's a wall that isn't there, painted onto the door people actually use.
> Every visitor who behaves normally bounces off a lock; the only ones who get the product are the
> ones who guess a URL. They are turning away exactly the buyers who trust the front door, and
> converting the ones who don't."* — Tomáš, L2

**The opposing-verdict call, made here rather than averaged.** Tomáš's L1 carried a pre-registered
clause: *"if L2 confirms the wall live, this journey becomes `L1-fail` retroactively."* L2 confirmed
it — and the same Character then wrote *"unchanged — L2-conditional, and the condition is one
expression."* **Ruling: `L2-conditional` stands as the record**, because the later judgment is the
evidence-bearing one and was made by the same Character after seeing that the funnel behind the wall
is good. The retroactive-fail clause is not discarded — it is honoured as a **ranking input**: this is
the journey-ending item, and the "one expression" is the only reason it is not a fail. Had the fix
been structural, the fail would stand.

**Cost/value:** the highest value per line of code in the run — `gated && publicScanSignInRequired()`
— plus giving all three doors one predicate. **Build.**
`standard: plan-entitlements/capability-gate-predicates`.

#### A3 · `[B]` The page states three things about one number and two are wrong · **recurrence 2** → `MC-B3`
`SAM-L1-02` (recurrence 2, prior B6 half-shipped) + `SAM-L1-11` + `SAM-L1-STR-04`.

Live, one report (`shots/armA-dimloop.json`): chip says D2/D6 were **DOUBLED**; both `<title>`s say
*"the LLM can move the score at most **±6**"*; the guardband `<rect>` measures **28.32 on D2, D6, D3,
D4, D5, D7 and D9** — byte-identical. **The widened band is not mislabelled; it is not drawn.** And
the track paints a guardband and an "LLM judgment" tick on D1, D4 and D9, three dimensions whose score
the model cannot move that way — proven live by D1 (`signal 0 / LLM 3 / blended 0`) against D8
(`0 / 4 / 2`) on identical starting points.

> *"The number's good. The diagram explaining the number is lying to me."* … *"If I were the one being
> asked to trust this number in front of a VP, that single page would be the reason I didn't."* — Sam, L2

**L2 corrected the magnitude in the open, and that correction must travel into the fix:** ±6/±12, not
±25/±50 (`LLM_GUARDBAND` narrowed 25→6 in r8). The scan-sweep already logged the same staleness at
`noise.ts:9-10` — same root, reference it rather than re-file. **Cost/value:** small and local — pass
the dimension id in, read `widened ? 12 : 6`, suppress the tick on claim-scored and deterministic
dimensions and render the claim facets that *are* the provenance there. Delete the dead
`DimensionCard.tsx` in the same PR or the fix has to be made twice. **Build.**
**Guardrail (G5 / `SAM-L1-S1`):** surface the real band; never widen it, never soften the model's
objections to the product's own detectors. D1/D4 being fully reproducible is a **selling point** the
track currently hides.
`standard: judgment-guardbands/score-guardband` (also `judgment-integrity-record`).

#### A4 · `[B]` The permalink the pricing page sells at $0 — and the ruling on Sam's criterion #6 · **recurrence 3** → `MC-B4`
`SAM-L1-04` (recurrence **3**, prior B5) + `SAM-L1-12`. Arm A swept the whole report DOM: one hit, a
share-card **PNG**. Meanwhile the `/pricing` Free card sells `✓ Public report permalink`. Two
Characters hit it independently in the same run.

> *"They are billing a feature — at $0, but billing it — that the product never hands you."* — Tomáš, L2
> *"I can't put a query-string URL in a README and I can't put a PNG in CI."* — Sam, L2

**The decision `SAM-L1-12` demanded, made and recorded** (the finding was filed precisely so the drain
could not let a scored criterion quietly evaporate): the badge was legitimately removed, the *job* was
not. **Take option (b): serve it.** A permalink control plus a level line on the report answers "hand
me a badge and a level I'd stake my name on in the README" without rebuilding an SVG endpoint, and it
closes `SAM-L1-04` in the same change. **Sam's character file and criterion #6 stay as written** — the
job is real and the product is about to serve it. One item, not two. **Build.**
`standard: none` — no technique in the bundle governs handing over a durable artifact URL.

#### A5 · `[B]` "Unlimited free public scans", next to a meter counting 5 · **recurrence 2** → `MC-B5`
`TOMAS-L1-02` (recurrence 2, prior B8) + `TOMAS-L1-09`. Arm A put both on screen minutes apart:
Free card `✓ Unlimited free public scans` vs report header `◷ 4 free public scans left this month`,
`GET /api/quota` → `{"enforced":true,"remaining":4,"limit":5}`. Two edges ride along: the 429 upsells
**"Pro"** for a tier the UI calls **Starter**, and `.env.production` documents a **weekly** gate
(`PUBLIC_SCAN_WEEKLY_LIMIT`) the code does not implement (`grep src/` → 0 hits; the code reads a
*monthly* variable). The scan-sweep's group-09 note (`public-scan-quota.ts` 5/month vs `plans.ts` 20)
is the same family — reference, don't re-file.

> *"Unmetered, next to a meter. It's small, and small is the kind that makes me go back and check the
> big claims — which is the opposite of what you want a price card to do."* — Tomáš

**And the two findings compound**, which only L2 could see: the sign-in panel replaces `ScanForm`
**and** its `QuotaMeter`, so on a walled deployment the honest number is only visible *after* the
visitor has gone through the un-walled door. **Cost/value:** copy plus one rename. **Build**, ships
with A2. `standard: plan-entitlements/id-vs-label-split` (also `price-book-authority`).
**Guardrail (G8 / `TOMAS-L1-S2`):** pricing stays numeric, anonymous, one click, with the self-host
band **above** the grid. No "talk to sales" on Starter/Team.

#### A6 · `[B]` The ROI simulator is still eight invented repos with no label · **recurrence 2** → `MC-B6`
`TOMAS-L1-04`, re-verified line by line: `W = 0.16`, annotated in source as *"deliberately NOT the
production weighting"*, and the render path (`:79-97`) still carries no caption.

> *"Take it out. The register of real repos two scrolls up on the homepage does more for you than that
> thing ever will, because I can check it against a codebase I already have an opinion about."* — Tomáš

**Build (XS)** — label it illustrative, or delete it and promote the register.
`standard: executive-reporting/provenance-caveats`.

#### A7 · `[B]` D3 cites no file — narrowed by L2, and the owner moved · **recurrence 2** → `MC-B7`
`SAM-L1-01` (recurrence 2, prior B4 partly shipped). Confirmed on the expanded DOM for D3, D5 and D8
— **and honestly softened by the walker**: the LLM narrative above each evidence list *does* name
`.github/workflows/main.yml`, `npm test`, `readme.md`.

> *"I'm not actually left hunting — I'm left with a paragraph that cites its sources and a list
> **labelled EVIDENCE** that doesn't. That's a smaller gap than I claimed and it points somewhere
> different: the deterministic detectors are the thing lagging the model, not the UI."* — Sam, L2

**Cost/value:** the reframe changes the fix — carry the **workflow filename** the matching line came
from, rather than a path from `idx.first()`. Downgraded major → minor by its own author. **Build (S).**
**Guardrail (G6):** D2's assertion-substance sample and its `detail` string survive untouched.
`standard: scoring-rubrics/score-explanation`.

#### A8 · `[B]` The recurrence papercut batch · **all recurrence 2** → `MC-B8`
- `SAM-L1-05` — the invitational voice buries the move; confirmed live on the rendered roadmap. B14's
  **additive** `firstStep` field is the only fix that does not undo a deliberate decision (G2).
- `SAM-L1-06` — "Flagged for review" names D2/D6 with the model's (correct) objections and never says
  what each claim *did*. *"The header knows. The list doesn't say. One word per row closes it."*
- `SAM-L1-08` — `scoreLabel` covers 5 of 8 providers and the gap **widened** (was 4-of-6):
  `local`, the self-hosted path this product now ships, is the slowest and falls through to generic copy.
- `TOMAS-L1-05` — the register's `0 public repos rated` counter survives beside a good new empty state.
  Downgraded major → polish.

**Build (XS batch).** `standard: remediation-roadmaps/invitational-framing` (SAM-L1-05 — the technique
is why the fix is additive), `judgment-guardbands/judgment-integrity-record` (SAM-L1-06),
`status-vocabulary/number-formatting` (TOMAS-L1-05), `none` (SAM-L1-08).

#### A9 · `[D]` A trajectory on the fleet Overview · **recurrence 2 — decline stands, unchanged** → `MC-D1`
`DANA-L1-004`. The prior drain declined this (`D1`) with an explicit reopen condition: *B9 has shipped
**and** recertified, and a Character needs the trajectory on Overview specifically.* B9 has not
shipped. Adding a second ETA surface before A1 lands would multiply the exact defect A1 fixes.

**L2 sharpened the decline rather than weakening it:** the fleet has exactly **one** forecast surface,
so A1 fixes the fleet GPS *in place*, and the caveated renderer (`Trajectory.tsx`) is wired only to
`/trends` and the personal workspace — *"the honest version was built and pointed at the audience that
does not need it."* Reopen condition unchanged.

#### A10 · `[X]` The briefing narrative still bypasses the LLM seam · **recurrence 2 — covered-elsewhere** → `MC-X1`
`DANA-L1-005` + `DANA-L1-009` are the prior drain's concept-doc **C3**, still open, and both are
doubly env-gated on this host (`uncertain`, never refuted). **Not re-entered as a build item.** One
thing did change and is recorded against C3: the **enterprise data-boundary claim is now on the
pricing page**, so a deferral that was free is no longer free. C3 gets a trigger, not a ticket.

### Band B — convergence (independently reached by more than one Character)

#### B1 · `[B]` `requireChecks`: visible, unsettable, and silently deleted by an unrelated save → `MC-B9`
`NADIA-L1-07` **and** `PRIYA-L1-01` — one defect, two Characters, two journeys, deduped in the run
itself. Arm B built the precondition by API, changed **one unrelated number** (Min overall 50 → 55),
clicked Save, and the merge-blocking control bar was gone: no warning, no diff, no toast. **The app's
own audit row names the deleted field under `previousPolicy` while `policy` and the human-readable
`status` mention nothing.**

> *"Visible, unsettable, and silently destroyed by an adjacent save — the terminal step of my journey
> doesn't merely dead-end at 'write the column directly', it actively **undoes** the write the next
> time anyone touches the form."* — Priya, L2
> *"The system knows precisely what it destroyed and the operator is never told."* — Nadia, L2

**Both walkers' L1 claim that "no UI mentions the field" is refuted, and the truth is worse** — it
renders read-only six rows above an editor that cannot set it.

**Covered-elsewhere, partly:** the moonshot round's item **#8** already lists *"requireChecks editor
surface"* as a known follow-up. This item does **not** duplicate that row; it adds the three halves
that follow-up does not cover: (1) round-trip unknown policy fields through the form, or make the POST
a **merge** rather than a replace; (2) the reconciliation compares the request against the echo, so a
field the form never sent can never be reported as dropped; (3) ship `PRIYA-L1-02`'s fleet-count
honesty with it — four of nine gate-failure rows are pinned to 0 by construction and render as live
meter rows, captured **while `requireChecks` was actively set** (*"A required control is failing — 0
repos"*, beside *"A dimension below floor — 33 repos"*). Rename the Delivery tile to *"Required status
checks"* (`PRIYA-L1-07`) **before** the editor lands, or the phrase means two things two tabs apart.

**Cost/value:** one PR, four parts, and it is the terminal step of a whole journey. **Build.**
`standard: quality-gates/enforcement-binding` (also `policy-projection`); the 0-repos rows:
`quality-gates/unmeasurable-criteria`; the rename: `status-vocabulary/vocabulary-chain-integrity`.

#### B2 · `[B]` Three unrelated things are called "controls", and "SEALED" is already taken → `MC-B10`
`NADIA-L1-08` + `PRIYA-L1-07`, the same collision seen from two tabs; L2 added a fourth word — the
Governance tab uses **SEALED** for the AI-stance perimeter, so on the one tab where an appsec lead
looks for a tamper-evident seal, the word means a posture control and the thing an examiner asks about
has no word on screen. **Build (copy):** name them distinctly ("D9 check battery" / "Manifest
conformance" / "Governance control ledger") and cross-link.
`standard: status-vocabulary/vocabulary-chain-integrity`.

#### B3 · `[M]` The wiring audit becomes a merge condition, not a UAT trick → `MC-M1`
**Twenty-two members, found across all seven journeys, seventeen by a literal zero-hit grep.** This is
convergence in its purest form: no Character went looking for it and every Character found one. The
run brief predicted it (*"the moonshot merged 30+ lanes, which is exactly the refactor-shape that
produces present-but-unwired"*) and made the grep a standing rule for the run — which is why it was
found seven times instead of once.

> *"the design is better than the wiring"* — Nadia · *"I stop trusting the inventory"* — Dana ·
> *"The refactor casualty is real."* — Priya, arm C

**This is a process ask, not a code fix, and forcing it into a build item would lose its shape.**
Recorded as a standing commitment with a trigger:

> **M1 (method).** A lane that adds an exported field, a route, or an env var lands its **consumer** in
> the same PR — or the PR body names the consumer's backlog id. Before merge on any such PR, run the
> wiring grep (`grep -rn <field> <the UI dir that should read it>`); **a zero hit is a defect by
> construction, not a TODO.** A docstring asserting a caller is not evidence of one — `forecastBasis`
> shipped with *"(Called by the executive briefing's trajectory clause)"* and zero callers.

The cheap members are batched across the build items below (`MC-B12`, `MC-B15`, `MC-B16`, `MC-B18`);
the two expensive exceptions — where the **data** is missing rather than the wire — are `SAM-L1-09`
(**C13**, concept-doc) and `DANA-L1-014`'s `compacted` flag (folded into A1).

### Band C — voice escalation, and the first-raised items ranked by impact

#### C1 · `[B]` The cockpit prints the agent's own claim as "closed by the rescan" → `MC-B11`
`PRIYA-L1-702`. **The highest impact triple in the run (`high · high · high`), and the item to ship
first.** Arm C supplies the mechanism L1 could not see, and it is an artifact-verified chain, not a
theory (`_L2-armC.md` §702, four independent proofs):

```
agent writes "RESOLVED: x" → lane-commit.ts stamps `Ascent-Resolves: x` → engine.ts:394
parseResolvedIds(commit messages) → loop-lane.ts:383 closedIds → recordLaneOutcomes writes `resolved`
→ CockpitVerdicts.tsx:31 prints "closed by the rescan"
```

Three facts settle it. **(a)** All **46 of 46** stored `resolved` outcomes across 20 runs are also in
their lane's `closedIds` — not agent honesty, a **tautology**, which is why no divergent row exists to
exhibit. **(b)** Two products disagree about the same repos: cockpit *46 closed by the rescan* vs
`GET /api/org/backlog?org=kiro&includeClosed=1` → `{"tracked":12,"open":3,"inProgress":9,"done":0}`,
with item timelines showing `lane_verdict → resolved` and `open -> in_progress` and **no `-> done`** —
because `scans-persist.ts` runs the trailer set through the movement witness before closing a ledger
row and `rescanWorktree` hands `recordLaneOutcomes` the **raw, ungated** set. **(c)** The dangerous
input is a **dead** agent, not a lying one: the local control run was killed by a 20-minute timeout,
reported **0 item verdicts**, and its lane still wrote *"5 `Ascent-Resolves` trailer(s) (the session
named no ids, so the whole armed batch is claimed)"*. Only an operator stop landing one step before the
rescan prevented five rows reading *"closed by the rescan."*

> *"my stated bar for this journey is Fowler's — an agent's own claim of completion is not evidence —
> and on this build the cockpit's single most load-bearing word, `resolved`, is the agent's claim
> wearing the verifier's clothes, while the ledger that applies the real gate quietly reads `done: 0`.
> **I would still roll this out. I would not show anyone the verdict panel until it says which of those
> two numbers it means.**"* — Priya, arm C

**The blocker-vs-major conflict, ruled rather than averaged.** The run considered and declined a
blocker escalation because the Character completes her job and says so; per the rubric that is `major`.
**The ruling stands, with a condition attached:** it becomes blocker-grade the day a divergent row can
exist — i.e. the moment the trailer path is ungated in a deployment where an operator stop is not
standing between a dead agent and five false closures.

**Cost/value:** medium, and it is the loop's credibility. Store a `verified` discriminator on
`LaneOutcomeRow`, route `rescanWorktree` through the same `decideInProgress` movement witness
`scans-persist.ts` already uses, and render *"claimed resolved — awaiting the rescan"* in a distinct
tone. Fix `lane-outcomes.test.ts:99-105`, whose title asserts the opposite of its assertion, in the
same change. **Build.**
**Guardrail (`PRIYA-L1-S2`):** no confidence theatre — every price cell keeps its `n`, unproductive
spend stays its own line, `pickDriveModel` keeps refusing.
`standard: remediation-handoff/evidence-based-auto-close` — the technique is explicit that *"an
executor's self-report is not evidence"* and that **every close records which rule fired** ("claimed by
a marker in a named commit" vs "no longer raised by a named run"). Rendering one word for both is the
deviation. The timeout case is the `failure-not-empty-success` law verbatim.

#### C2 · `[B]` The big number on the billing page is the small one — **voice escalation, minor → major** → `MC-B12`
`VICTOR-L1-05`. Filed at L1 as an unqualified-headline nit (F5, `minor`); L2 measured it and the voice
is the escalation:

> *"`$25.90` is the scan lane alone; the lane panel sums to `$115.28`, and the team panel prints that
> exact number three rows below the tile… **I read the big number first. The big number is the small
> one.**"* — Victor, L2

78 % understatement on one page, one 30-day window, corroborated by the API (`estimatedCostUsd:
25.89913` vs `byLane` summing to `115.276653`) — and `$115.28` is itself a floor, because 34 of 53
local calls could not be priced. **Rank by the voice: recorded as `major`.** **Build (S):** sum all
lanes into the tile, or qualify it *"scan lane only"*.
**Guardrail (`VICTOR-L1-S1`):** never render a null cost as `$0.00`; keep the unpriced count beside
the money. `standard: cost-metering/spend-observability`.

#### C3 · `[B]` The control ledger breaks its own three authored contracts — **voice escalation on a `minor`** → `MC-B13`
`NADIA-L1-01` (major) + `NADIA-L1-02` (major) + `NADIA-L1-03` (**minor** — and the voice is a trust
finding):

> *"'Published advisories · not operating.' In red. The catalogue's own sentence for that control is
> 'No coordinated-disclosure advisory was observed. **NOT** a statement that the repo is insecure.'
> That sentence exists, it is written, it is unit-tested — and it is never printed anywhere. I grepped.
> **If I screenshot this table for the CISO, I have just told him nine repositories failed a security
> control. They did not.**"* — Nadia

Plus the cap defect: the row's **state** comes from the newest 400 observations and its **coverage**
from the oldest 2000, so past 2000 rows the two windows do not overlap; `timelineTotals` renders a
400-row slice as fleet fact; and `/api/org/controls` computes the exact `truncated`/`limit` disclosure
the card never calls (`grep -rn 'api/org/controls' src/` outside the route → 0). *"A compliance number
that silently excludes repos is the exact thing I have been burned by, and this is it, rebuilt with
better comments."*

**Cost/value:** small — three consumers for three authored contracts (`failMeans`, `descriptor`,
`stateTone`) plus one route swap. **Build.** The **wiring** halves are confirmed statically and are
not in dispute; the **numeric** consequence is `uncertain — not reproducible on this host` (no GitHub
App ⇒ no watched repo ⇒ `recordConformance` returns `recorded:false`) and rides fixture `MC-M3`.
**Guardrail (`NADIA-L1-S1`):** the three-state vocabulary — `unmeasurable` as a first-class arm,
`unchecked` outranking `pass`, the "Not judged" denominator tile — is the best-executed part of the
moonshot. Any edit here extends it; nothing collapses it.
`standard: status-vocabulary/vocabulary-chain-integrity` + `metrics-rollups/aggregate-honesty`.

#### C4 · `[B]` A published verification recipe with no rows, and sealing as a side effect of a URL → `MC-B14`
`NADIA-L1-04` + `NADIA-L1-05` + `NADIA-L1-06` + `NADIA-L1-11`. `GET
/api/org/controls?org=public&format=csv` → `200 application/json`, the param silently ignored. The
only UI reference to verification is a **non-interactive `<code>` string**, and it lives inside the
card's **non-empty** branch, so a new org is never told the ledger is verifiable at all. `verifySeals`
is the only thing that seals, and it seals only when someone curls it — while retention purges the
observation rows.

> *"I am told exactly how to recompute a chain and given no rows to recompute it over. That is the
> shape of a control I cannot take to an examiner."* — Nadia

**Cost/value:** small-to-medium and it converts her one unfileable artifact into a filed one:
`?format=csv` emitting `DIGEST_FIELD_ORDER` verbatim, a download link, a rendered *"Ledger integrity:
chain verified through YYYY-MM-DD · N days unsealed"* with a Verify action, sealing moved to the
existing rescan/digest cron, `sealBacklogRemaining` in the response, `unsealedDays` derived from a
DISTINCT-day query, and the seal root added to the pack manifest. **Build.**
**Guardrail (`NADIA-L1-S2`):** never fold advisory counts into D9; keep the degraded banner's *"that
is NOT a clean bill of health"*; keep the audit CSV's recomputed per-row integrity verdict.
`standard: audit-logging/tamper-evidence` (also `append-only-design`,
`retention-and-partitioning` for the state-the-seal-before-purge-condition half).

#### C5 · `[B]` The one figure that defends the programme is computed, shipped to the browser, and thrown away → `MC-B15`
`PRIYA-L1-704`. `GET /api/org/loop/e85d11c8…` returns `microsPerVerifiedPoint: 156684150` (**$1.57/
point**) for the `kp` lane and `null` for the sibling lane after **$10.19 of spend for 0 verified
points** — the exact "not measured" case the spec named. With that run open in the cockpit the page
carries **zero `¢` characters** above the org-wide price list; `grep -rn "\.economics" src/features
src/app` → 0 hits, reproduced live.

> *"the one figure I would put in front of a VP to defend this program is the one figure the panel
> omits, while faithfully rendering the org-wide average that **hides** it."* — Priya, arm C

The sharpest single instance of the systemic theme: the spec's named home
(`CockpitOutcomeLedger.tsx`) was deleted by the wave-2 refactor and its replacement renders
`agentConfig` and no cost figure at all. **Build (S).** `standard: cost-metering/spend-attribution`.

#### C6 · `[B]` Reading the cockpit kills a running remote run → `MC-B16`
`PRIYA-L1-701`, `blocker` on the job-impact scale, `reachability: low` **today only**. The missing
predicate is fact: `markStaleRunsStopped` selects `{phase:"running"}` and filters only on
`!isLive(id)`; `grep -n executor src/lib/db/loop-runs-write.ts` returns hits at the three lane-creation
paths and **none inside the sweep**, though `executor` exists on the lane; `route.ts:58` fires the
sweep on every GET; `startRemoteRun` documents that it adds no registry entry.

**The local control is what makes this an isolation rather than an excuse** — a live local run survived
six reads from a second client over ~24 s, `phase=running error=null` every time, *"and the only thing
that spared the run was its live-registry entry — precisely the entry a remote run never gets."*

**The remote consequence is `hypothesis`** and must be labelled so for the fixer: it resolves
`uncertain — not reproducible on this host`, never refuted. **Build (one predicate)** — exclude
remote-executor runs from the sweep (or stamp `executor` on the run row) and clear
`claimActor`/`leaseUntil` on release. Reachability jumps to `high` the day C7 lands.
`standard: none` — no technique governs a liveness sweep's exclusion set; the adjacent law is
`failure-not-empty-success` (absence of a registry entry read as a death certificate).

#### C7 · `[B]` The two gates that made C6 unbuildable — and the admission table nothing consults → `MC-B17`
`PRIYA-L2-C4` + `PRIYA-L2-C5`, both **new at L2** and both found while trying to build a fixture,
which is the strongest provenance a finding can have.

- **C-4:** `repoGate` (`work-tools.ts:52-62`) resolves the claim gate from the **derived** autonomy
  tier and never calls `listOrgAdmissions` — so moonshot #8's *"recorded, **overridable** per-repo
  decision"* is invisible to the only gate that would act on it. Found live: a correctly-scoped org
  token calling `claim_followups` over MCP was refused *"xkazm04/kp is at autonomy tier T0."*
- **C-5:** `repoUnderOrg` requires `owner === org`, so org `kiro` — this host's real working org —
  **can never admit its own `xkazm04/*` repos**, and the entire #3 remote protocol is permanently
  unreachable for it.

**Cost/value:** small, and **either one unblocks C6's fixture**, which is the cheapest route to a
verdict on a blocker. `NADIA-L1-09` filed the softer adjacent version (three of the compiler's four
artifacts are API-only) — its **dry-run modal** half is `covered-elsewhere` under moonshot #8's known
follow-ups; only the disclosure sentence is new (folded into `MC-B18`). **Build.**
`standard: mcp-tools/authentication-and-scoping` (C-4 — the gate reads the wrong authority) +
`remediation-handoff/handoff-tenancy-and-idempotence` (C-5 — tenancy checked against a string prefix
rather than the org's watched set).

#### C8 · `[B]` The public register ranks across rubric versions with no disclosure → `MC-B18`
`TOMAS-L1-11`. `model.ts` states in writing that r10 and r11 numbers are not comparable, and
`rubricVersion` is load-bearing in the corpus filter, the outcome ledger (*"an absent rubricVersion is
UNKNOWN, never 'the same'"*) and the digest keys — while `RegisterEntry` carries every other
provenance qualifier and not this one (`grep` → 0 hits).

> *"The register already refuses to rank mock-engine scans for exactly this reason. Same instinct, one
> surface short."* — Tomáš

`uncertain` at L2 by construction (a freshly seeded host is single-rubric); production almost certainly
qualifies — r8→r12 in one month with no bulk re-scan. **Build (S):** carry `rubricVersion` onto
`RegisterEntry` and qualify a stale-rubric row the way a mock row already is.
`standard: scoring-rubrics/rubric-stability`.

#### C9 · `[B]` A finished finance CSV that is correct, reconciling, and linked from nowhere → `MC-B19`
`VICTOR-L1-02` + `VICTOR-L1-04` + `VICTOR-L1-03`. `GET /api/usage?org=kiro&view=showback` returns
exactly the artifact — `scope,lane,team,calls,estimatedCostUsd,unpricedCalls`, reconciling to $115.28 —
and `grep -rn showback src/app src/components src/features` returns **only the route**.

> *"That is sharper than 'missing': it is built, correct, and unlinked — I would have gone to the
> vendor and been told it doesn't exist."* — Victor, L2

**Build**, in order: a third export button beside CSV/JSON (trivial) → pass `teamKey` from the local
lane, which already knows its repo (`VICTOR-L1-04`) → then the lane × team matrix
(`VICTOR-L1-03`), **after** `-04`, never before, or every non-scan cell reads "Org-wide" anyway.
`standard: cost-metering/spend-attribution` (also `spend-observability`).

#### C10 · `[B]` The meter silently drops every non-scan call for an org slugged `public` → `MC-B20`
`VICTOR-L2-01`, **discovered by driving** — arm B minted a genuine 12.1 s Claude CLI turn and the
ledger recorded nothing. `meter.ts:219`: `if (!orgSlug || orgSlug === "public") return;`. Defensible
for the real anonymous funnel; *"a live trap for any tenant on that slug — it burns inference and shows
$0 for it forever."* Low reachability, high trust erosion, and it **silently invalidated one L2 arm
before the cause was found** — which is the reason it is filed at all. **Build (S):** refuse `public`
as a creatable org slug, or gate the drop on the anonymous-funnel org **id** rather than the string.
`standard: cost-metering/usage-ledgers`.

#### C11 · `[B]` The rollover sentence is true of the other currency → `MC-B21`
`VICTOR-L1-01`. *"Unused credits roll over. They never expire, so a quiet month is not lost"* — printed
directly under a header reading **"Monthly allotment · 150 credits / mo"**, which resets on the 1st.

> *"If I take that sentence at face value, an idle month costs me nothing and I never downgrade; the
> code says an idle month burns 150 scans of headroom I paid $10 for. **That's my pet peeve verbatim,
> and it flips the math.**"* — Victor

**Build (one sentence):** name the two currencies. Pairs with `RV-B1`'s live confirmation on the same
cheap fixture (a Team-plan seeded org with `usageThisMonth > 0` and a prepaid balance). `standard: none`
— a true sentence under the wrong meter is a copy defect no technique governs.

#### C12 · `[B]` An AGPL product whose only github.com URL is its issue tracker → `MC-B22`
`TOMAS-L1-10`. `NEXT_PUBLIC_SOURCE_REPO_URL` is set in no committed production env file, so
`sourceRepoHref()` is null and all four consumers degrade at once. Arm A's raw-HTML sweep of `/` and
`/pricing`: **exactly one github.com hit each**, and it is `…/ascent/issues`.

> *"a buyer told three times on one page that the product is AGPL and self-hostable can only reach the
> code by noticing that the issues link has a parent directory."* — arm A

**Build (one env var, no code)** — a deployment task, and it must be set **at build time**
(`NEXT_PUBLIC_*` is inlined). The self-hosting guide should be a link, not a text node.
`standard: none`.

#### C13 · `[C]` `expectedLift` has a seam and no ledger — the diagnosis L2 refuted → `MC-C1`
`SAM-L1-09`. L1 said *"the data exists and only the UI seam is missing"*; arm B **refuted his own
diagnosis** and the correction changes the work:

> *"`ExpectedLiftBasis` renders `expectedLiftClause`, and `RecommendationTracker` holds a `sortMode`
> with `anyMeasured` gating both the toggle and the ordering. The toggle is deliberately conditional
> on at least one publishable basis, and the API's `sort:"priority"` downgrade is the **same** refusal.
> **What is absent is the data, not the UI.** That is a better product than I credited, and it moves
> the finding from 'wire the seam' to 'there is no path to ever produce an outcome row.'"* — Sam, L2

**Concept-doc, not build.** No seeder produces outcome rows, no app path inserts them, and
`OUTCOME_MIN_SAMPLES = 3` means the first real measurement is three closes away. What instrument
writes an outcome row, at what `recommendationMatchKey`, against which scan pair, and what happens at a
rubric bump are design questions, not a patch — and moonshot **#9** is already `shipped-unverified` in
the backlog, so this extends that row rather than replacing it.
**Write:** `docs/resolutions/intervention-outcome-ledger.md` (do not write it in this change).
**Guardrail:** the pure half is excellent and must not be touched — no median without its `n` and
instrument, `null` never `"+0"`, and the refusal to order by zero measurements stays.
`standard: adoption-measurement/before-after-outcome-pairing`.

#### C14 · `[B]` The exemplar diff compares string tails, not capabilities → `MC-B23`
`SAM-L1-10`. `diffAcrossRepos` differences evidence strings by exact normalised equality — over
strings that B4 had made repo-specific two days earlier. So `Test framework configured
(vitest.config.ts)` ≠ `(jest.config.js)` and a repo **with** a framework is told the exemplar has one;
every count-bearing line lands in *both* `absentSignals` and `aheadSignals`; and in cohort mode the
strongest shared practices fall below support and drop out.

> *"a wrong transfer recommendation is the one output a staff engineer will forward to their team."*

Reachability is low (three walls), which is why it ranks here despite `major` severity and high trust
erosion. **The fix already exists in the neighbouring module** — `signalName`/`nameKey`, written for
exactly this, and not imported. **Build (S, local):** difference through `nameKey`, keep the raw
string for display. `standard: diff-comparison/semantic-level-selection`.

#### C15 · `[B]` The exemplar diff has no discovery path, and calls 500 public repos "Your repos" → `MC-B24`
`SAM-L1-13`. The only inbound link is `ScoringTab`'s time-vs-time "What changed →", gated on
`scans.length >= 2` and carrying no `?against=`; and for a non-member viewer `readableOrgForOwner`
resolves to the shared public org, so up to `ORG_CANDIDATE_CAP = 500` corpus repos render under
`<optgroup label="Your repos">` with an "Org best" that means "best in the public corpus". **The
sign-in and DB walls are defensible and are NOT the finding.** **Build (S).**
`standard: diff-comparison/pair-and-baseline-selection`.

#### C16 · `[B]` `stop` is cooperative and says nothing; a timeout message becomes the commit subject → `MC-B25`
`PRIYA-L2-C6` + `PRIYA-L2-C7`, both new at L2, both measured: the run read **RUNNING for 19 min 43 s**
after the operator pressed stop, settling only at the 20-minute agent horizon, with no `stopRequested`
on the run row and an unchanged `RUNNING` chip — *"an operator will press it again, or conclude it
failed."* And branch `ascent/loop-20260831080428-xkazm04-kp` carries 1605 insertions across 15 files
under the subject **`fix: Agent session exceeded 20 min and was stopped`**. (Carries the prior run's
still-open L2-B-02 forward: the sheet header renders `agentConfig` with no engine label beside it.)
**Build (S):** persist `stopRequested` and render a "stopping…" state with the timeout horizon; fall
back to a neutral commit subject when the session ended in error and keep the error in the body.
`standard: agent-cli-transport/child-observed-posture`.

#### C17 · `[B]` The cockpit denies a capability the deployment ships → `MC-B26`
`PRIYA-L1-703`. `LiveTab` loads runs only when `selfHosted()`, so a cloud owner's armed remote runs
never render, and the rail falls through to a setup panel whose copy says the loop *"exists only on a
self-hosted Ascent"* — which that deployment's own POST route contradicts. Not attempted at L2 (needs
`selfHosted()` false); resolves `uncertain`. **Build:** at minimum stop the copy denying a shipped
capability; ideally load runs for cloud owners and drop `selfHostGuard` from `propose`.
`standard: plan-entitlements/deployment-mode-short-circuit`.

#### C18 · `[B]` The digest's three-state contract collapses to two, and carries no control coverage → `MC-B27`
`DANA-L1-015`. `alerts.ts` specifies a deliberate three-state contract (`undefined` = say nothing,
`[]` = *"we looked and none failed"*, rows = these failed); the only production caller sends
`undefined` when the array is empty, so the `[]` branch is unit-tested and unreachable — **a week in
which every control held is byte-identical to a week in which the ledger was never populated.**
`controlCoverage` never travels with the block, against `control-observations.ts`'s own stated coverage
law. And the digest reimplements the forecast headline with no hedge in any branch. **Build (S)** — the
digest is the artifact Dana reads *instead of* opening the app. Not reproducible here (cron + ledger
fixture). `standard: alerting/periodic-digest`.

#### C19 · `[B]` Org-wide queue depth reaches no operator surface → `MC-B28`
`VICTOR-L1-07`. `queueDepth()` is returned only by the two cron routes' JSON. *"I'd see 400 per-row
'queued' tags before I saw the number 400."* Residual gap of moonshot #10, whose closure is otherwise
confirmed (`RV-M10`). **Build (S):** one aggregate line on the Repositories tab.
`standard: metrics-rollups/aggregate-honesty`.

#### C20 · `[B]` The rollout copy describes the hard path the product now automates → `MC-B29`
`PRIYA-L1-03` + `PRIYA-L1-04` + `PRIYA-L1-05` + `PRIYA-L1-06` + `NADIA-L1-09` (disclosure half) +
`NADIA-L1-10`. Her rollout principle is *"make the right thing the easy thing"* — *"the thing IS easy;
the words aren't."* Four small, independently-cheap items: point the generated-workflow comment and
the empty-state at the Repositories tab's one-click provisioning; chip `schemaAhead` and disclose parse
**redaction** notes; land spec #35's promised report-back column (`getFoundationRollout` has one
consumer, on a different tab); one sentence saying the copied CI snippet is a **snapshot** that
tightens with the server bar but never loosens; one sentence naming which artifacts an admission
decision writes; pass `named` on the two evidence-pack CSV links. **Build (XS batch).**
**Guardrail (`PRIYA-L1-S1`):** keep `observed` winning on regeneration, keep the owner/admin
blast-radius split, keep the one-typed-`owner/repo`-per-write rule. *"a provisioning flow I'd ship
under my own name."*
`standard: conformance-checking/declared-then-proven` (the matrix half) + `none` (the copy halves).

#### C21 · `[B]` The loop's small honesty batch → `MC-B30`
`PRIYA-L1-705` (an evidence-led model switch is silent — one lane-log line with its `n` and the prices
compared), `PRIYA-L1-706` (remote agents never receive the org's standard, so a remote close can never
stamp adoption evidence — a `loadLaneBriefInput` call, or one disclosing paragraph), `PRIYA-L1-707`
(`live.md` still points at a known gap that #3 correctly deleted — *"the miniature of the failure
mode"* in a docs culture whose constitution says a stale stated gap does more damage than an absent
doc). **Build (XS batch).** `standard: agent-cli-transport/dated-capability-matrix` (705) + `none`.

#### C22 · `[B]` Meter-edge honesty and the `/usage` footer → `MC-B31`
`VICTOR-L1-08` (a `?? 0` written where the module's own rule is null-never-zero; an unknown lane
dropped from `byLane` while still counted in `byTeam`, so two panels on one page can disagree about
the same call total) + `VICTOR-L1-06` (an unconditional footer telling a fully-attributed private org
that attribution has not activated yet, on a billing page with no route to the price). **Build (XS).**
`standard: cost-metering/usage-ledgers`.

#### C23 · `[M]` The verdict-vocabulary recertification trigger → `MC-M2`
`M1` from the prior drain (*"any change to the briefing PDF re-runs Dana's journey before merge"*)
**worked**: the briefing PDF changed in the moonshot, the commission named Dana M1 as an owed journey,
and that journey produced this run's #5 item and confirmed the #3 strength. Extend the same shape to
the surface that now carries the equivalent risk:

> **M2 (method).** Any change to the loop's **verdict vocabulary** — the words `resolved`, `closed`,
> `verified`, `in progress` as rendered in the cockpit, the outcome sheet or the backlog — re-runs
> Priya × `loop-to-l5` before merge. Trigger: a diff touching `CockpitVerdicts.tsx`,
> `lane-outcomes.ts`, `outcomeText.ts` or `recordLaneOutcomes`.

---

### Tally

| Recommendation | Count | Items |
|---|---|---|
| **build** | **28** | A1–A8, B1, B2, C1–C12, C14–C22 |
| **concept-doc** | **1** | C13 (`docs/resolutions/intervention-outcome-ledger.md`) |
| **method-commitment** | **2** | B3 (`MC-M1` wiring audit), C23 (`MC-M2` verdict-vocabulary recert) |
| **decline-with-reason** | **1** | A9 (`DANA-L1-004`, prior decline stands unchanged) |
| **covered-elsewhere** | **4** | A10 (C3 briefing-narrative egress) · B1-part (moonshot #8 *requireChecks editor surface*) · C7-part (moonshot #8 *proposal dry-run modal UI*) · C13-context (moonshot #9 outcome ledger) |

### Strengths → do-not-touch guardrails (this run's ten PROTECT rows, phrased as constraints)

Carried as **G10–G19** in the backlog; each is a constraint on a build item above, not a compliment.

| # | Strength | Constraint it places |
|---|---|---|
| G10 | `TOMAS-L1-S1` — r11's D1 coherence read: five formats collapsed into one award + `round(18 × coherence/100)`, D1 claim-scored | Any edit to A3 or A7 keeps D1 **claim-scored** (no guardband reintroduction), keeps the coherence read **itemized**, and keeps `coherence: null` — never 0 — for a repo with no guidance document |
| G11 | `TOMAS-L1-S2` — pricing: numeric, one click, self-host band **above** the grid, only Custom is a button | A2/A5/C12 may not move auth in front of pricing, demote the self-host band, or add a "talk to sales" path to Starter/Team |
| G12 | `DANA-L1-017` — the shared briefing composers: one `ExecBriefing`, four renderers, every scope-bearing sentence a single exported pure function | A1 lands **in the composer**, never inlined into a renderer. That architecture is what made a three-finding fix a one-place fix |
| G13 | `DANA-L1-016` — the loop-proof line's *"on branches, not merged"* clause and its null-is-absence | C1/C5 may never fold branch points into the bought number, and `briefingProofLine` keeps returning null rather than "0 · 0" |
| G14 | `SAM-L1-S1` — the assertion-substance detector with its `MIN_SAMPLE_FRACTION` fairness floor, and the model's willingness to call the product's own detectors wrong | A3/A7/A8 keep the fairness floor and keep **surfacing** the model's objections; no cleanup pass may suppress a discrepancy (this is G1, still binding) |
| G15 | `NADIA-L1-S1` — the honest-null discipline: `unmeasurable` a first-class third arm, `unchecked` outranking `pass`, the "Not judged" denominator tile | C3/C4/B1 extend the three-state vocabulary; nothing collapses it, and no new surface may render `unmeasurable` as failure |
| G16 | `NADIA-L1-S2` — advisories as a separate claim from D9, the demo flag travelling with them, the *"NOT a clean bill of health"* degraded banner, the audit CSV's recomputed per-row verdict | C3/C4 never fold advisory counts into D9 and never drop the degraded banner or the `-PARTIAL` honesty |
| G17 | `PRIYA-L1-S1` — the `.ai/` standard reading its own output back; the provisioning flow's blast-radius gates | C20 keeps `observed` winning on regeneration, the owner/admin split, and one typed `owner/repo` per write |
| G18 | `PRIYA-L1-S2` — the loop's refusal to flatter: every price cell carries its `n`, unproductive spend is its own line, `pickDriveModel` returns null rather than choose on a self-fulfilling sample, lessons sit behind a human door | C1/C5/C21 add no confidence theatre, no invented interval, no median without its `n`; `pickDriveModel` keeps refusing |
| G19 | `VICTOR-L1-S1` — the lane meter's honest nulls: "no estimate", never `$0.00`, with the unpriced-call count printed beside the money | C2/C9/C10/C22 never render a null cost as zero, and never drop the unpriced count when the tile is corrected |

---

## 3 · Methodology lessons

### What the three-arm construction bought, and what it cost

**One host cannot satisfy seven journeys, and pretending it can is how a run reports a clean journey it
never tested.** This run's central method advance is that the arm was treated as a *constructed
instrument* rather than a given: arm A stood up an isolated `next dev` on :3100 with the three
invalidating flags neutralized, its own `distDir` and a throwaway PGlite dir, and **asserted anonymity
from the rendered ARIA before trusting any evidence**. `:3000` was never touched.

The cost was real and worth paying: three of Tomáš's four top findings are **invisible** under the
overlay's own convenience flags. `ASCENT_AUTH_BYPASS=1` alone would have *falsely refuted* the run's
blocker. This is the skill's own corollary — *"the overlay's convenience flags are the likeliest thing
invalidating a Character"* — realised in a measurement rather than a warning, and it is now the
overlay's rule (see the env.md correction below).

**Arm B's counter-lesson is that a fixture can be *selected* rather than *written*.** The preflight
inherited a claim that no seeded org can produce a forecast. Arm B found org `public` already carrying
93 scans across four calendar days and the org shell already accepting `?range=custom`, and selected a
window containing exactly two scan days — **zero rows written**, and the prior drain's blocking `M2`
fixture gap closed without a seeder change. **Look for the fixture before building one.** The same
instinct is why arm C used the 2026-08-30 twenty-run campaign as a found corpus.

**Arm C's lesson is the opposite one: the fixture you cannot build is itself the finding.** The remote
half of `PRIYA-L1-701` could not be reached, and *both* obstacles turned out to be defects
(`PRIYA-L2-C4`, `PRIYA-L2-C5`) — one of which is the cheapest route to closing the blocker they
blocked. A precondition that cannot be satisfied deserves a root-cause pass before it is recorded as an
environment ceiling.

### Surface-model gaps only L2 could expose

The L1 walkers built their models by following import chains, and L2 still corrected them four times.
All four corrections were made **in the open, by the walker, against their own filing** — which is what
makes the rest of the report trustworthy:

| L1 said | L2 found | Consequence |
|---|---|---|
| "every forecast Dana reads" | The fleet has **one** forecast surface (Briefing). `Trajectory.tsx` is imported only by `/trends` and the personal workspace | Narrowed A1 to one call site; **widened** `DANA-L1-004` and re-confirmed its decline |
| Guardband ±25 / ±50 | **±6 / ±12** — narrowed in r8; and the widened band is not merely mislabelled, it is **not drawn** (28.32 px on every dimension) | A3's fix reads `widened ? 12 : 6`; a stale constant in a rubric-versioned product is a recurring hazard (`noise.ts:9-10` has the same staleness) |
| `expectedLift`: "the data exists, only the UI seam is missing" | **Refuted.** The seam exists and is a *designed refusal* to order by zero measurements; the **ledger** has no producer | Moved C13 from build to concept-doc. This is the drain rule working: a report's diagnosis is a hypothesis until an artifact settles it |
| `requireChecks`: "no UI surface mentions the field exists" (**both** walkers, independently) | **Refuted, and worse**: it renders read-only six rows above an editor that cannot set it and deletes it on the next save | Two walkers agreeing is not corroboration when they read the same file. Convergence at L1 is a *hypothesis multiplier*, not evidence |

The last row is the sharpest methodological point in the run: **two independent walkers reached the
same wrong conclusion from the same static surface**, and only driving the form separated them. A
convergent L1 claim should carry a `l2_priority`, not a higher confidence.

### The hypothesis discipline held, and it earned its keep

The `_L1-BRIEF.md` labelled **every** recurrence lead an explicit hypothesis — *"ALL are HYPOTHESES;
verify independently, and contradict the brief if the code says otherwise"* — and the walkers used the
licence: two leads came back *fixed* (`RV-B10`, `RV-TOMAS-L1-06`), one *half-fixed* (`RV-B6`, and the
half that shipped **created** this run's `SAM-L1-02`), and one refuted-as-briefed (Victor's "expect an
absence" on per-lane cost, which is on screen — and the presence exposed a 78 % understatement no
absence-hunt would have found). The mass-parallel L1 phase produced no confirmation-bias artifact worth
recording, which is the first time that is true of an ascent run.

### The reachability discipline that worked, and the one label that slipped

**`uncertain — not reproducible on this host` was used correctly on every blocked check**, with the
closing fixture named on the row — nine environment ceilings, each with its fixture. Not one blocked
check was recorded as `refuted`. That is the discipline that makes the environment ceilings table
usable as a fixture backlog (it becomes `MC-M3`…`MC-M5` below).

**One label did slip and the synthesis caught it:** arm B's own verdict table labels the
headline-understatement row **`VICTOR-L1-02`**, which is the unlinked showback CSV; the finding is
`VICTOR-L1-05`. It is recorded under the correct id in `findings.json` with the slip noted in the
row's `scope_note`. Cheap to catch here, expensive if it had reached a backlog — an arm journal writes
ids from memory while the canonical table writes them from the L1 report. **Lesson: an arm journal's
finding ids are transcription, not authority; reconcile every journal id against `findings.json`
before the synthesis, which is what happened and is why this is a note rather than a defect.**

### Severity normalisation

Two rows arrived with non-rubric severities: `PRIYA-L1-704` was filed **"medium"**, which is not a
rubric severity, and `VICTOR-L1-05` was filed as an L1 nit (`F5`) and upgraded to `major` by live
measurement. Both were normalised in `findings.json` with the change stated on the row rather than
applied silently. The rubric's severity words are a closed set; a walker inventing one is a
`/uat update` signal.

### Overlay corrections applied in this change

All four were flagged by the walkers or the preflight and **none was applied by the walker** — each
correctly took its denominator from the code and left the overlay alone, which is the rule. The drain
is where they land:

1. **`uat/characters/victor-finops-director.md` — Team = 150 credits/mo, not 500.** The plan was
   repriced on 2026-08-19 (`plans.ts:234`); the character sheet's baseline, JTBD, acceptance
   expectations, pet peeves and three scored criteria all quoted **500**, which would have made his
   utilization arithmetic wrong by 3.3× in every future run. Corrected throughout, with a dated note.
2. **`uat/env.md` §Grounding Surface A — marked STALE with the reason.** The list was derived
   2026-08-10 and the prompt builder has changed twice since (r11's guidance block, r12's
   `craftBuiltBlock`; `LlmScoreInput` grew to 13 fields). **The denominator is deliberately NOT
   changed here** — it is a scored instrument and changing it casually invalidates cross-run grounding
   trends; that is `/uat update`'s job. A dated banner now names exactly what changed so the next
   update knows what to re-derive.
3. **`uat/env.md` — the "no seeded org can produce a forecast" fixture gap is CLOSED.** Replaced with
   what arm B proved: `public` carries 93 scans across four calendar days, and `?range=custom&from=&to=`
   selects a two-scan-day window — the zero-write low-data fixture — with the exact window recorded so
   the next run does not re-derive it.
4. **`uat/env.md` — a new §Arm construction rule.** The anonymous / free-tier / first-run journeys may
   **never** be certified on the shared dev server: `ASCENT_AUTH_BYPASS`, `PUBLIC_SCAN_QUOTA_DISABLED`
   and `ASCENT_SELF_HOSTED` each independently hide a top finding, and identity must be asserted from
   the rendered ARIA before any evidence is trusted. Arm A's exact construction is recorded as the
   recipe.

Also written in this change: **`uat/README.md` gained the `## Drain homes` section** the skill requires
every overlay to carry (analysis doc → `docs/product/uat-insights/<run-id>.md`, build items →
`docs/BACKLOG.md`, concept docs → `docs/resolutions/`). The overlay had a prose paragraph pointing
concept docs at `docs/features/<area>/`; the repo's actual concept-doc home has been
`docs/resolutions/` since the moonshot round, so the section now names the real one.

### Repo-local asks for the next run

- **`M3` from the prior drain is closed** — every row in this run carries a `resolution`, and every
  closed row carries a `ceiling`. Keep it.
- **The environment ceilings table is a fixture backlog and should be read as one.** Three of the nine
  ceilings block more than one finding each; they are entered as `MC-M3` (GitHub App / watched repo),
  `MC-M4` (an outcome ledger with ≥3 rows on one match key), `MC-M5` (an org whose slug equals its
  repos' owner namespace).
- **Sam's scored criterion #6 has a decision now** (§2 A4) and stays scored. It must not read `N/A`
  again without the decision being reversed in writing.

---

## Follow-up drain — 2026-08-31 (post-recertify passes 1+2)

> Second drain of the **same run**, appended rather than filed separately: `recertify` has no run id of
> its own, so its findings belong to `2026-08-30-moonshot-cert`. Source:
> [`uat/runs/2026-08-30-moonshot-cert/recertify.md`](../../../uat/runs/2026-08-30-moonshot-cert/recertify.md)
> — pass 1 (`f7bfa8d2..c56ab666`, 18 commits, 6 drain items built) and pass 2
> (`b1992360..afc913c0`, 23 commits, 12 drain items built) — plus the run's `findings.json`, now
> carrying **31 recertify-stamped rows**. The skill's rule is the reason this document exists:
> *"recertify-born findings have no other door into the backlog."*
>
> Recurrence baseline is unchanged ([`2026-08-10-ascent-first.md`](./2026-08-10-ascent-first.md) →
> this run's §2). **Nothing already routed in §2 above is re-entered here.**

**The verdict of the follow-up: the wiring caught up, and the vocabulary did not.** The first drain's
panel verdict was *"the wiring is behind the design"* — twenty-two payload halves shipped without a
consumer. Two passes later that class is largely closed: `forecastBasis` has a caller, `economics`
renders, the showback fields reach a screen, `verifiedAt` is written where a join used to lie. What
survives — and what nearly every new finding below is an instance of — is **one fact wearing two
words, or one word covering two facts**: `blend 95%` beside `Blend weight 57%`, `1 free public scans`,
`Unlimited` above a card that says 1, and `closed` still meaning three different things on the loop
cockpit after the fix that was supposed to settle it.

### 1 · The closed loop

Thirty-one of the run's 86 rows were re-certified across the two passes. Twenty-eight reached
`resolved-verified` with live evidence; three resolve `fixed` (code-verified, live demonstration
blocked by a named fixture); one — `SAM-L1-05` — stayed **open** and was fixed after the pass (§2 F0).
**Every closed row carries a `ceiling`**; the ceilings are inputs to §2, not closed topics.

| Backlog item | Findings closed | Resolution | Ceiling that remains |
|---|---|---|---|
| `MC-B1` `4aa12080` | `DANA-L1-001` · `-002` · `-013` | resolved-verified (p1) | The `forecastBasis` **compacted** tail has still never rendered (no purged-history org); the low-data window still prints a `Change vs … start: +2` delta beside the refusal, ungated by the same presentability rule; the **digest** path was never exercised (`cronSecret:false`) → `MC-B27` |
| `MC-B2` `f6cbe4a2` | `TOMAS-L1-01` (blocker) · `TOMAS-L1-08` | resolved-verified (p1) | The three doors agree because the wall is **off**, not because they share a source — door 2's copy is still a literal (`ColdScanGate.tsx:52`). Turn `PUBLIC_SCAN_SIGN_IN_REQUIRED` on and it contradicts the other two again |
| `MC-B3` `904bcc21` | `SAM-L1-02` · `SAM-L1-11` | resolved-verified (p1) | The claim-scored panel says what it is *not* and renders **no facet table**, so with `claimPoints > 0` a reader still cannot see which citations awarded the points; and the page now prints one fact in **two units** → **§2 F1** |
| `MC-B4` `9d85f01a` | `SAM-L1-04` (rec 3) · `SAM-L1-12` | resolved-verified (p2) | Answered as option (b): a markdown link, not a badge. A README wanting a rendered shield still has nothing |
| `MC-B5` `21bef0ed` | `TOMAS-L1-02` (rec 2) | resolved-verified (p2) | **The credit matrix on the same page still says `Unlimited`** → **§2 F5**; and the derived number is not pluralized → **§2 F2** |
| `MC-B6` `27a722ee` | `TOMAS-L1-04` (rec 2) | resolved-verified (p2) | Labelled, not deleted — the *"a live scan substitutes for proof"* limb is untouched |
| `MC-B7` `13410fcf` | `SAM-L1-01` (rec 2) | resolved-verified (p2) | Judged on one absence-shaped repo; a repo with several CI workflows would test whether the D3 cluster can name a workflow filename at all |
| `MC-B8` b–d `0d088f41` · `97d48243` | `SAM-L1-06` · `SAM-L1-08` · `TOMAS-L1-05` | resolved-verified (p2) | Only the `widened` branch of (b) was exercised live; (c)'s `local` arm is compile-verified only |
| `MC-B9` `a96dd03a` | `NADIA-L1-07` + `PRIYA-L1-01` · `PRIYA-L1-02` · `PRIYA-L1-07` | resolved-verified (p1) | **Only the round-trip half shipped** — an owner still cannot *set or clear* a required control from the product (`MC-X2`); two of Priya's four rows are **earned zeros with the reasoning only in code** → **§2 F3**; `unjudgedBarsDeclared()` exists and is not consulted → **§2 F4** |
| `MC-B10` `527b5973` | `NADIA-L1-08` | resolved-verified (p2) | The noun "controls" survives in all three headings — they are distinguished, not renamed |
| `MC-B11` `d165da23` **+ `MC-B33` `9e8906f1`** | `PRIYA-L1-702` | **open (p1) → resolved-verified (p2)** | The POSITIVE half is unit-verified only (no live row has yet earned a stamp); the lane rails and the sheet header still print "closed" for two other quantities → **§2 F6** |
| `MC-B12` `e2eaf39b` | `VICTOR-L1-05` (voice escalation) | resolved-verified (p1) | 45 of 76 local-lane calls still price at $0 — the headline is a floor by an unknown margin, and it names the *count*, not the exposure; per-org attribution is still one bucket → `MC-B19` |
| `MC-B13` `9f0f83ce` | `NADIA-L1-02` · `NADIA-L1-03` | **fixed — `uncertain`, not reproducible on this host** | The wiring audit now answers the other way, but **no row on this host is red**: all 16 observations are `unmeasurable` (no GitHub App) and `/api/org/controls` is GET-only, so the fixture cannot be built over HTTP → `MC-M3` |
| `MC-B14` `30f53490` | `NADIA-L1-04` · `-05` · `-06` | resolved-verified (p2) | The export is the **rows**, not the chain; the retention consequence needs ≥2 closed UTC days of observations, and the seal backlog was measured at zero on a host that has none |
| `MC-B15` `de0ca559` | `PRIYA-L1-704` | resolved-verified (p2) | — the org-wide aggregate that hid the $-for-0-points lane is now *beside* the per-lane figure, not instead of it |
| `MC-B16` `d3b026d9` | `PRIYA-L1-701` (blocker) | **resolved-verified on the local control; the remote consequence stays `uncertain — not reproducible`, never passed** | A live local run survived ~35 min and ~30 cockpit reads. The remote half still needs `MC-M5` |
| `MC-B17` `99b290a5` | `PRIYA-L2-C5` | resolved-verified (p2) | **There is no revoke door** — the route exposes only GET and POST → **§2 F7** |
| `MC-B17` `99b290a5` | `PRIYA-L2-C4` | **fixed** — code-verified, no live claim exercised | Needs an MCP `claim_followups` call against an admitted repo at a granted tier |

**The `PRIYA-L1-702` inversion is the story of the two passes, and it is worth telling as one.**
Pass 1 shipped the mechanism and measured **no user-visible change whatsoever**: the payload gained its
`verified` field and **36 of 36** stored `resolved` rows still answered `true`, because
`listRunOutcomes` *joined* verification back out of the lane's `closedIdsJson` — the very
commit-trailer set the finding indicted. The tautology re-entered through the join. Pass 1 refused the
close (*"the fix landed, it is reachable, and it does not unblock the job"*) and named the exact
remedy: **stop joining, stamp the row**. `MC-B33` (`9e8906f1`) did that, and pass 2's sweep is an
exact inversion — **0 true / 40 false**, every false row carrying `verifiedAt: null`, and the cockpit
reading *"claimed resolved — awaiting the rescan"* on rows where pass 1 counted 8 of 8 reading
*"closed by the rescan"*. `grep -c "closed by the rescan"` over the ITEM VERDICTS section: **0**. The
two surfaces stopped contradicting each other in the same move — `backlog {done: 0}` and *"nothing here
has been adjudicated"* are now the same statement.

Three things in that sequence are worth keeping as practice, because none is automatic: a recertify that
**declines to close a landed, reachable, tested fix**; a remainder recorded as its parent's *blocker*
rather than as its ceiling (`RC-N4` — and pass 2 proved the escalation right: 100 % of `MC-B11`'s user
value was behind that one column); and a second pass that **re-ran the same sweep** rather than
re-arguing it. `RC-N4` therefore opens no backlog row — it was routed by being **built**.

### 2 · The new findings, routed

Ranking is the skill's contract — recurrence, then convergence, then voice escalation, then impact. No
item here is recurrence-2 in the strict sense (none was recorded unbuilt by a prior drain); three carry
a weaker but real relative, the **fix-created defect** — the class the first drain named as this run's
signature failure (`RV-B6` → `SAM-L1-02`), which has now happened three more times.

#### F0 · `RC2-N1` — the rubric bump that shipped a field the model returns empty · **ALREADY FIXED** → `MC-B8a`
*(major · quality-gap / trust · Sam)* — recorded as **fixed-pending-next-recert**, not as open.

`firstStep` was threaded end to end — schema, prompt skeleton, DB column, wire types, renderer — and
`SCORING_RUBRIC_VERSION` was bumped to **r14** on the stated grounds that *"the model is now ASKED a
different question, so a cached r13 answer and a fresh r14 answer are not the same reading"*, which
invalidates every cached scan on the estate. The first live r14 reading returned `firstStep` on **0 of
9** roadmap items (fresh claude-cli/opus scan of `sindresorhus/slugify`, 177 s;
`shots/recert2-B8-freshreport.text.txt`, zero hits for "First step:"). The pass labelled the *cause* a
hypothesis and the *measurement* a fact — correctly: `firstStep` appeared only as an empty slot in the
JSON skeleton (`prompt.ts:354`) and a schema description, while the ROADMAP COVERAGE block that tells
the model what a row must contain never mentioned it, and the surrounding instruction pressed the other
way (*"Ascent is a transition COMPANION, not a boss"*).

**`ece52101` (r15) fixed exactly that** — the mandate now asks for the field in the ROADMAP COVERAGE
block, in the invitational voice (*"stated as what the move IS rather than as an order"*), with
`Omit "firstStep" only when no single concrete move exists` preserving the absent-is-absent rule the
finding insisted must survive the fix. **No live r15 scan has been read.** The measurement that produced
this finding was `0/9`; nothing yet replaces it with a number. `MC-B8a` is re-stamped **fixed
(`ece52101`, r15) — pending live verification**, and it is the cheapest thing the next recertify can do:
one fresh scan answers it.

> Note for the next pass: r14 → r15 is the **second** rubric bump in one day, both invalidating the
> estate's cache. The bump was right both times (the question genuinely changed), but a bump whose only
> evidence of effect is a 0-of-9 reading bought nothing — which is the case for reading one live scan
> **before** stamping the version, not after.

#### F1 · `RC-N1` — one page, two units for the blend weight *(minor · clarity · Sam)* → `MC-B35`
**Fix-created defect, and the second one on this exact surface.** `ScoreIntegrityChip` reads
*"integrity · widened D2, D6 · **blend 95%**"* while every provenance track on the same page reads
*"**Blend weight 57%**"* (`shots/recert-B3-dims.text.txt:28`, `shots/armA-dimloop.json`). Both are
correct — 95 % is the realized fraction of the configured weight (0.57 against a configured 0.6), 57 %
the absolute weight — and the chip's tooltip reconciles them in one clause. **The reconciliation is
inside a hover**, on the surface whose prior finding was literally *"the page states three things about
one number and two are wrong"*. A reader who does not hover sees 95 and 57 for one fact.
**Build (XS)** — print one unit in the chip, or label its number *"95 % of the configured weight"*; the
reconciling sentence already exists and only needs to leave the tooltip.
`standard: status-vocabulary/number-formatting`.

#### F2 · `RC2-N2` — the derived allowance is not pluralized *(polish · clarity · Tomáš)* → `MC-B38`
With `PUBLIC_SCAN_MONTHLY_LIMIT=1` the Free card reads **"1 free public scans / month"**, the feature
line *"Private scans every month, and **1 free public scans**"*, and the footnote *"The **1 free public
scans** run on their own rolling 30-day window"* (`shots/recert2-B5-pricing-l1.text.txt:44,51,435`).
The 429 pluralizes correctly (`limit === 1 ? "" : "s"`, `public-scan-quota.ts:367`) — **the same care
was not applied to the copy that now derives the same number**, which is the characteristic cost of
turning a hard-coded value into a derived one: the sentence around it was written for a constant.
Invisible at the default of 5; visible the moment an operator sets 1 — and a self-hosting operator
setting 1 is exactly the reader this page was rebuilt for. **Build (trivial)** — reuse the ternary.
`standard: status-vocabulary/number-formatting`.

#### F3 · `RC-N3` — two of Priya's four rows are earned zeros whose reasoning lives only in code *(polish · clarity · Priya)* → `MC-B37`
`MC-B9` fixed two of the four "0 repos" gate-failure rows Priya named, by declaring them *not judged
fleet-wide*. The other two — `provenance` (*"AI changes merged without human review — 0 repos"*) and
`governance` (*"Ungoverned posture — 0 repos"*) — were **deliberately excluded** from
`FLEET_UNJUDGED_REASONS` because the rollup genuinely carries `aiGovernedRate` / `aiPrSample` and the
branch-protection fields (`governanceReasons.ts:47-51`). That call is right and the reasoning is
committed. But Priya named all four, and she will now read two rows that changed beside two that did
not, with the distinction — *these zeros were measured, those were not measurable* — visible only in a
source comment. **This is G15's own vocabulary one step short**: `unmeasurable` is a first-class arm and
an **earned zero** has no word of its own. **Build (XS)** — a hover on an earned zero naming what was
measured to reach it. `standard: metrics-rollups/aggregate-honesty`.

#### F4 · `RC-N2` — `unjudgedBarsDeclared()` computes the escalation and nothing calls it *(minor · clarity · Priya)* → `MC-B36`
`governanceReasons.ts:52-60` exports a function computing exactly *"this org's stored bar carries a
criterion the fleet view cannot judge"*, and the rendered row prints the same em-dash sentence whether
or not the operator has declared one. The strongest version of `PRIYA-L1-02` was a lead who had **just
set two required controls** — and she now reads a correct sentence that does not acknowledge she has
skin in it. **This is an `MC-M1` member created by the PR that closed the finding about zero-consumer
fields**: an exported function, zero non-test callers, shipped in the same change. That, not the
severity, is the ranking argument — the wiring commitment is one release old and its first violation is
inside its own fix. **Build (S)** — when `unjudgedBarsDeclared()` is true, append *"— you have declared
2 of these; the per-repo gate enforces them"*. `standard: quality-gates/unmeasurable-criteria`.

#### F5 · `RC2-N5` — `/pricing` still answers "Unlimited" for the allowance the same page caps *(minor · clarity · Tomáš)* → `MC-C2` *(concept-doc)*
`MC-B5` fixed the Free card, the metadata and the FAQ; the **credit matrix further down the same page**
was not in the write set. `creditMatrixData.ts:124` still opens the Scanning section with *"Public scans
are always free and never metered."* and the "Public repository scan" row renders `Unlimited` in all
four tier cells (`cells: all("Unlimited")`, line 131). The reconciliation exists — *"Never metered on
any plan — rate-limited and monthly-capped instead"* — **in the row's detail text, below a cell that
says Unlimited, on a page whose Free card says 1**. And it is **pinned as intentional** by
`creditMatrixData.test.ts:58-59`.

**That pin is why this is `concept-doc` and not `build`.** A test asserting the current wording makes
this a decision to revisit, not a miss, and the question underneath is a product one: can *metered*
(credit-consuming) and *capped* (allowance) be two words on a page a buyer skims — or should the matrix
cell simply state the allowance and let "never metered" live in the detail? **Rank by convergence: this
is the third run in which a Tomáš-class reader meets two numbers for one free tier** (`B8` at
2026-08-10, `TOMAS-L1-02` in this run, and now its direct residue). **Write
`docs/resolutions/free-allowance-vocabulary.md`** — do not code it, and do not delete the test without
answering the question it pins. `standard: plan-entitlements/price-book-authority`.

#### F6 · `RC2-N6` — "closed" still means three things on the cockpit *(minor · clarity · Priya)* → `MC-B41`
`MC-B33` fixed the per-item verdict; two siblings kept the old word. The lane rails print
`{closedIds.length} closed by the rescan` (`LaneRail.tsx:56`, `AutopilotBandParts.tsx:123`) — honest for
post-fix lanes, still the **raw trailer count** for every pre-fix one — and the outcome sheet header
prints *"324 gaps closed"* where `gaps` is `diff.closedGapCount` (`outcomeCellFold.ts:81`), a
**scan-diff quantity** wearing the same word.

The voice argument outranks the `minor` label: a reader who has *just* been taught that "claimed
resolved" is not "closed" then meets "closed" twice more, meaning two other things, on the same screen
in the same session. The lesson the fix teaches is unlearned by the chrome around it — and the un-backfilled
rail is the same laundering `PRIYA-L1-702` indicted, one component over. **Build (S)** — the rail says
*"verified closed"*, the header says *"gaps no longer raised"*. **`MC-M2` binds this change by
construction** (it touches the loop's verdict vocabulary), so it re-runs Priya × `loop-to-l5` before
merge. `standard: status-vocabulary/vocabulary-chain-integrity`.

#### F7 · `RC2-N4` — an admission decision cannot be withdrawn *(major · trust · Priya)* → `MC-B40`
`/api/org/admission` exposes `GET` and `POST` and nothing else. `upsertRepoAdmission` can *change* a
decision, so the closest thing to a revoke is writing `grantedTier == derivedTier` — which still records
that an owner decided something. On a surface whose whole argument is *"an override with no named author
is not a decision — it is a measurement with a different value"* (`route.ts:99-102`), the inverse
asymmetry is the defect: **a decision made in error is permanent, and the ledger cannot distinguish
"decided, then withdrawn" from "decided."**

The provenance is the strongest kind — the pass hit it while cleaning up after itself: its own probe row
on org `public` could only be *neutralised*, not removed (pass 2 residue #6), and the residue table says
so. **Build (S)** — a `DELETE` that clears the state row and writes a **withdrawal** act to `OrgAudit`,
never a silent row removal. The governing technique is explicit that a decision is two stores: a sparse
mutable **state** (an undecided item has *no record at all*) and an append-only ledger of **acts**
carrying actor, previous and new status, and reason. Ascent built the ledger and made the state one-way,
so an item can never return to undecided. `standard: audit-logging/decision-records`.

#### F8 · `RC2-N3` — the register's worded empty state is unreachable *(polish · missing · Tomáš)* → `MC-B39`
`IndexGallery.tsx:88-90` renders *"No public scans yet. Scan a repository below to be the first on the
register."* when `board.length === 0`. **It cannot fire.** `loadPublicGalleryCards` returns `null` when
no cards exist (`scans-read.ts:840`) and the landing page then drops the whole gallery block — which is
what pass 2 observed on a truly empty arm: no heading, no counter, no empty state. Non-null implies
`cards.length > 0` implies `recent.length > 0` implies `board.length > 0`, so the branch is dead **in
the exact case it was written for**. Present-and-correct-but-unwired — the class L1's wiring audit owns,
found here by an arm constructed to be empty. **Build (S)** — decide which behaviour is wanted, an
absent section or a worded one, and delete the other. `standard: none`.

#### Tally (follow-up)

| Recommendation | Count | Items |
|---|---|---|
| **build** | **7** | F1 `MC-B35` · F2 `MC-B38` · F3 `MC-B37` · F4 `MC-B36` · F6 `MC-B41` · F7 `MC-B40` · F8 `MC-B39` |
| **concept-doc** | **1** | F5 `MC-C2` → `docs/resolutions/free-allowance-vocabulary.md` |
| **fixed-pending-recert** | **1** | F0 `RC2-N1` → `MC-B8a` re-stamp (`ece52101`, r15) — no new row |
| **routed by being built** | **1** | `RC-N4` → `MC-B33` (`9e8906f1`) — no new row |
| **method** | **5** | `RC-M1` · `RC-M2` · `RC2-M1` · `RC2-M2` · `RC2-M3` → §3, all applied to the overlay in this change |
| **decline** | **0** | — |

### 3 · Methodology

#### The lesson that cost two passes: a driver with a hard-coded shot name destroys the arm it is reused from

`RC-M2` (pass 1) and `RC2-M2` (pass 2) are the same lesson learned twice, and the second time it was
already written down. `drive-armB-gatepolicy.mjs` wrote `armB-nadia07-{before,after}.*` from **inside
the driver**, so re-running it for recertification overwrote arm B's originals in place — and shots are
gitignored, so the baselines are unrecoverable. Pass 1 recorded the fix precisely (*"every reusable
driver should take its shot stem as an argument the way `drive-armC-openrun.mjs` does"*) and **did not
apply it**; pass 2 then did the same thing to `drive-armA-dimloop.mjs`'s `armA-dim-D{1..9}.png` and
`armA-dimloop.json` before noticing.

That is the argument for this drain existing at all: **a recorded method lesson nobody applies is a
lesson that will be paid for again.** Applied here — both drivers now take `SHOT_PREFIX` (env) or a
positional stem, with the old names as defaults so no existing invocation changes — and written into
`uat/env.md` as a rule. `drive-armA-dims.mjs` was checked and already takes a `tag`: the pattern existed
in the same directory the whole time, which is the more uncomfortable half of the finding.

The general form is worth keeping past this repo: **an evidence artifact whose name is a constant is an
artifact with a single slot.** A run stores evidence *per pass*; a driver that cannot express which pass
it is cannot store two, and it destroys the earlier one silently.

#### A shared `distDir` makes an empty-database arm lie — and the false pass was nearly recorded

`RC2-M1` is the sharpest environment finding of either pass. The register read `2 PUBLIC REPOS RATED`,
then `5`, on **freshly bootstrapped** PGlite directories, because `loadPublicGalleryCards` is wrapped in
`unstable_cache` (`scans-read.ts:797`, tag `public-scan-gallery`) and every `ASCENT_EMPTY=1` arm shares
`distDir: .next-empty` (`next.config.ts:47`). A brand-new database was served the **previous arm's**
cached rows. An empty-state check run that way is a silent false pass, and it nearly produced one for
`MC-B8d` — the finding whose entire content is *what renders at zero*.

Two things generalize. **(a)** Arm isolation has a level below the database: isolating the data store is
not isolating the *render*, and any framework cache keyed to the build directory outlives the database it
describes. **(b)** The tell was a **number that changed between two runs both supposed to be zero** — a
preflight that asserts "empty" once and proceeds would have sailed past it. Both are now standing rules in
`uat/env.md` §Arm construction: `rm -rf .next-empty` before an empty-database arm, and only one
`ASCENT_EMPTY` instance at a time (a second dies with *"Another next dev server is already running"*,
pointing at the shared `.next-empty` — the collision is visible, which is why the *silent* variant is the
dangerous one).

#### `RC2-M3`'s two keepers, both now in the overlay

**(a) The zero-residue gate probe.** When a POST route validates tenancy *before* its field validators, a
deliberately **invalid field** distinguishes "the gate accepted this repo" from "the gate rejected it" by
*which* error comes back — proving the gate **without writing a row**. It settled `PRIYA-L2-C5` on the
real working org with zero residue; the write was then exercised on a demo org where the residue is inert.
This turns the residue rule from a restriction into a technique: **the cheapest proof of a gate is the
request the gate refuses.** (Driver note recorded with it: ascent's org POST routes enforce same-origin, so
a probe must send `Origin`/`Referer` or it answers `403 Cross-origin request rejected` before any validator
runs — a 403 that looks exactly like a gate refusal and is not one.)

**(b) To certify a single-source claim, MOVE the source.** `MC-B5`'s claim was *"one number everywhere"*.
Reading the default (5) on three surfaces proves nothing — three hard-coded 5s look identical to one
derived 5. Booting the arm with `PUBLIC_SCAN_MONTHLY_LIMIT=1` made every surface that re-typed the number
visible **instantly**, and produced `RC2-N2` (the un-pluralized copy) as a free by-product. This is the
strongest single addition either pass made to the method: it converts "derived" from a code claim into a
measurement, and it applies to every single-source fix this backlog contains.

#### `RC-M1` — a board deliverable that was being verified by proxy

Pass 1 overturned arm B's *"@react-pdf subsets its fonts so the text is not extractable here"*, which had
reduced `DANA-L1-013`'s PDF half to comparing **byte sizes**. It is extractable: inflate the FlateDecode
content streams and decode the `TJ` operands, which are **hex-encoded ASCII**, not glyph indices — ~30
lines of Node, no dependency (`shots/recert-B1-pdftext.txt`). The PDF is Dana's actual deliverable and
every run before this one verified it by inference from a shared conditional. Recorded as a standing
recipe in `uat/env.md`. The general form: **an evidence format once declared unreadable should be
re-tested each run-generation, because "we could not read it" quietly becomes "we did not check it."**

#### What the two passes prove about `recertify` itself

- **Pass 1's refusal to close `MC-B11` is the single most valuable act in either pass**, and it is what
  the `resolution` vocabulary exists to permit. The fix had landed, was reachable, was tested, and
  changed **nothing a user sees**. The three-way distinction *landed ≠ reachable ≠ unblocks the job* is
  not a formality; here it was 100 % of the value.
- **A second pass over the same run is cheap and it pays.** Twelve items were built between the two, and
  pass 2's headline is pass 1's own named remedy, measured. The pattern to keep: a pass that cannot close
  an item **names the exact remaining condition** in a form the next fixer can execute and the next pass
  can measure — *"stop joining, stamp the row"* → a sweep that inverts 36/0 to 0/40.
- **Both passes restarted the server against the diff and said so, and pass 2 caught a 12-minute gap** —
  PID 35740 started 13:56:54, twelve minutes before `afc913c0` (14:08:28), and was serving pre-fix code.
  `recertify`'s step 0 earned its place on this run rather than in principle.
- **An id collision in the backlog reached the recertify report.** `MC-B23` named two different items —
  the exemplar-diff `nameKey` build from §2 C14, and the `verifiedAt` handoff row a builder appended
  later — as did `MC-B22` and `MC-B24`. Pass 2's header cites *"MC-B23 = `verifiedAt`"*; pass 1's
  `RC-N4` cites `MC-B19` for the same item; that is three names for two items. Resolved in this drain by
  renumbering the three **handoff-born** rows to `MC-B32` / `MC-B33` / `MC-B34` — the §2 ranking is the
  canonical mapping and keeps its ids — with the alias recorded on each row so both recertify passes stay
  readable against it. **Rule for the next builder: a handoff row takes the next free number in the
  section, and a drain's numbering is never reused.** An id naming two items makes a finding's history
  unreadable, which is precisely what the recurrence check depends on.

#### Overlay changes applied in this change

1. `uat/driver/drive-armB-gatepolicy.mjs` and `uat/driver/drive-armA-dimloop.mjs` — shot stems are now
   `SHOT_PREFIX` (env) or a positional argument, **defaulting to the old names**, so every existing
   invocation is byte-identical (`RC-M2`, `RC2-M2`).
2. `uat/env.md` §Arm construction — five new standing rules: `rm -rf .next-empty` before an
   empty-database arm plus the one-instance constraint (`RC2-M1`); *move the source to certify a
   single-source claim* (`RC2-M3b`); the zero-residue gate probe with its same-origin note (`RC2-M3a`);
   the PDF text-extraction recipe (`RC-M1`); and the reusable-driver stem rule.
3. `docs/BACKLOG.md` — 18 rows re-stamped from *built — pending recert* to their measured resolutions,
   three colliding ids renumbered, seven build rows and one concept-doc added, and `MC-M7` records this
   drain's overlay edits for the next `/uat update`.

Not changed, deliberately: **the grounding denominators.** Neither pass touched an LLM surface's
grounding sources, `env.md` §Surface A keeps its ⚠ STALE banner, and re-deriving a scored instrument
outside `/uat update` would invalidate every cross-run trend. `r15` changes what the model is *asked to
output*, not what reaches the prompt as context.
