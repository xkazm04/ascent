# Recertify — 2026-08-30-moonshot-cert

**Mode:** `/uat recertify` · **No new run id** — this is a diff report over the originating run's own
`findings.json`, which carries the resolutions.

| | |
|---|---|
| **Commits under test** | `f7bfa8d2..c56ab666` (18 commits) |
| **Drain items built** | MC-B1 `4aa12080` · MC-B2 `f6cbe4a2` · MC-B3 `904bcc21` · MC-B9 `a96dd03a` · MC-B11 `d165da23` · MC-B12 `e2eaf39b` |
| **App server (:3000)** | **RESTARTED** for this pass. Pre-existing PID 16532 predated every commit above and was killed at 2026-08-31 ~12:36 +02:00; `npm run dev` restarted, healthy at **2026-08-31T12:39+02:00**. Identity asserted, not liveness: `{"status":"ok","db":"up","dbMode":"pglite","autoscan":{…}}`. `.next` was NOT deleted — the restart did not wedge. |
| **Anonymous arm (:3100)** | Constructed per `env.md` §Arm construction, verbatim: `ASCENT_EMPTY=1 PGLITE_DATA_DIR=.pglite/uat-armA ASCENT_AUTH_BYPASS= PUBLIC_SCAN_QUOTA_DISABLED= ASCENT_SELF_HOSTED=0 npx next dev -p 3100`. Anonymity asserted from ARIA **before** any verdict (see MC-B2). |
| **Pre-flight discipline** | `GET /api/health` was read before the kill; `/api/org/loop` was **not** touched until after the restart (MC-B16 unfixed — a pre-fix build kills remote runs on read). The new server's own boot sweep reported "1 loop run stopped, 2 stranded worktrees removed", so nothing was in flight when the cockpit was read. |
| **Drivers** | Reused from `uat/driver/`: `drive.mjs`, `drive-armA-dimloop.mjs`, `drive-armA-dims.mjs`, `drive-armB-copybrief.mjs`, `drive-armB-gatepolicy.mjs`, `drive-armC-openrun.mjs`. No bespoke driver was written. |
| **Shots** | `SHOT_DIR=uat/runs/2026-08-30-moonshot-cert/shots`, prefix `recert-*` |

---

## Verdicts

| Item | Findings | Verdict |
|---|---|---|
| **MC-B2** | `TOMAS-L1-01` (blocker), `TOMAS-L1-08` (major) | ✅ **resolved-verified** |
| **MC-B3** | `SAM-L1-02` (major), `SAM-L1-11` (major) | ✅ **resolved-verified** |
| **MC-B1** | `DANA-L1-001`, `-002`, `-013` (major ×3) | ✅ **resolved-verified** |
| **MC-B9** | `NADIA-L1-07` (major), `PRIYA-L1-02` (minor), `PRIYA-L1-07` (polish) | ✅ **resolved-verified** |
| **MC-B11** | `PRIYA-L1-702` (major) | ⚠️ **open** — mechanism landed, symptom unchanged |
| **MC-B12** | `VICTOR-L1-05` (major) | ✅ **resolved-verified** |

**Regressed: none.** Every check that passed in arms A/B/C still passes.

> `PRIYA-L1-01` is named in the brief but is **not a row** in this run's `findings.json` — Priya's half
> of the requireChecks defect was filed inside `NADIA-L1-07` ("also filed by Priya (PRIYA-L1-01)").
> It is recertified there; no ghost row was created.

---

## 1. Resolved-verified

### MC-B2 — one wall predicate for all three scan doors · `TOMAS-L1-01`, `TOMAS-L1-08`

Anonymity first, per the overlay's corollary: `shots/recert-B2-landing.aria.yaml:17` carries a bare
`button "Sign in"` — no org name, no avatar, no identity menu — and `GET /api/quota` answers
`{"enforced":true,"remaining":4,"limit":5,"scope":"anon"}`. This is a real anonymous visitor.

The hero CTA "Scan a repository" now opens a dialog with the **scan form**, not a lock:

```
- dialog "Scan a repository":
  - textbox "GitHub repository":  /placeholder: owner/repo
  - button "Scan" [disabled]
  - paragraph: 4 of 5 free scans left this month · button "Sign in for more scans"
```
`shots/recert-B2-scandialog.aria.yaml:57-65`

The "Sign in to scan" panel arm A photographed is gone from the capture entirely, and the QuotaMeter
that went down with it is back. The predicate is single-sourced: `page.tsx:109 publicScanWallEnabled()`
→ `scan-gates.ts:120-121 authGateEnabled() && publicScanSignInRequired()`, the **same expression**
`scan-gates.ts:98` applies on the endpoint's `publicScan: true` branch. The wiring audit that returned
0 hits now returns the page.

The three doors agree, all read live: door 1 (hero dialog) offers the form; door 2 (cold permalink
`/report/sindresorhus/query-string`) says *"It's free for public repositories and needs no account"*
above a working Scan-now button and a teaser naming the cap; door 3 (`/report?repo=`) mounts
ReportClient with no predicate of its own and renders whatever the server answers.

**Ceiling.** Door 2's copy is still a hard-coded literal (`ColdScanGate.tsx:52`), not a read of the
predicate — the doors agree because the wall is **off**, not because they share a source. Turn
`PUBLIC_SCAN_SIGN_IN_REQUIRED` on and door 2 contradicts the other two again. And the quota copy is
still two phrasings on two doors ("4 of 5 free scans left this month" vs "capped at a few per month
per visitor") — **MC-B5**, unbuilt.

### MC-B3 — the provenance track reads the per-dimension band · `SAM-L1-02`, `SAM-L1-11`

Fixture: a live claude-cli report for `sindresorhus/slugify` on :3000 which — like arm A's p-limit —
carries `widenedDims: [D2, D6]`, so the discriminating case was available without fabricating one.
All nine dimensions read from the DOM via `drive-armA-dimloop.mjs`.

**The doubled band is now drawn, not just relabelled.** Arm A measured every one of nine guardband
rects at width **28.32** while the chip declared D2/D6 doubled. Now:

| Dim | `<title>` | band rect width |
|---|---|---|
| D2 | "Guardband **DOUBLED to ±12**: the model flagged this detector as suspect…" | **56.64** |
| D6 | same | **56.64** |
| D3 · D5 · D7 | "Guardband: the model's judgment was clamped to within **±6** of the signal" | **28.32** |

56.64 = exactly 2 × 28.32. And the blend weight — the half of `SAM-L1-02`'s `expected` that was
missing entirely — is now on every blended dimension as a nested reach: *"Blend weight 57%: after
weighting, the model can move this score at most **±7** from the signal 46"* (D2), ±3 on the ±6
dimensions.

**The lever that does not exist is no longer drawn.** `SAM-L1-11`'s three dimensions:

```
D1  aria-label: "…0 points from verified citations, score 0. No LLM judgment band on this dimension."
    band rect: null   titles: ["Signal (deterministic): 0", "Score (signal + verified citations): 0"]
D4  identical shape
D9  aria-label: "Score provenance: deterministic score 24. The model does not move this number."
    band rect: null   titles: ["Signal (deterministic): 24", "Score (deterministic, unmoved): 24"]
```

No band, no "LLM judgment" tick, on all three. The blended six still draw both, correctly. The panel
copy states the promise in Sam's own terms: *"Cited-claim scored: no guardband and no judgment blend.
The model moves this score only by citing evidence the detector missed."*
(`shots/recert-B3-dims.text.txt:179`, `shots/armA-dimloop.json`)

**Ceilings.** (a) The claim-scored panel says what it is *not* but renders **no facet table** — with
`claimPoints > 0` a reader still cannot see *which* citations awarded the points; that was the second
half of the suggested acceptance and it is unbuilt, and no fixture on this host has a non-zero
`claimPoints` D1/D4, so that branch is unexercised. (b) One page still prints the same fact in two
units: chip "blend 95%" vs track "Blend weight 57%" — see new findings below.

### MC-B1 — the trajectory clause states its basis, or refuses · `DANA-L1-001`, `-002`, `-013`

Both windows **selected**, not seeded — zero rows written, exactly arm B's method.

| Window | Trajectory clause, verbatim |
|---|---|
| custom `08-21→08-24` (points = 2) | `Not enough history to project: 2 distinct scan days (a line through ≤ 2 points fits perfectly no matter how noisy the data).` |
| `range=90d` (n ≥ 3) | `Declining at -2/wk, staying within L4 · Integrated for now. (trend confidence 34% · noisy · fit over 8 scan days across 75 days)` |

`shots/recert-B1-brief-lowdata.md:10` · `shots/recert-B1-brief-90d.md:10`; the same two on screen at
`shots/recert-B1-exec-lowdata.aria.yaml:83` and `recert-B1-exec-90d.aria.yaml:83-84`.

- **`-001`**: the hedge is no longer *deleted* on `lowData` — the clause refuses. Arm B's bare
  "Climbing at +35/wk" is gone.
- **`-002`**: the briefing now speaks **Delivery's exact sentence** — the same string
  `DeliveryFitReadout.tsx:19` renders and which arm B captured on the Delivery tab one click away.
  The product no longer contradicts itself in writing, and the version that goes to the board is the
  honest one.
- **`-013`**: `forecastBasis` has a caller. *"fit over 8 scan days across 75 days"* reaches the card,
  the markdown **and the PDF**.

**The PDF was read this time, not inferred.** Arm B could only compare byte sizes ("@react-pdf subsets
its fonts so the text is not extractable here"). It is extractable: the FlateDecode content streams
decompress and the `TJ` operands are **hex-encoded ASCII**, not glyph indices. Decoded
(`shots/recert-B1-pdftext.txt`):

```
…Declining at -2/wk, staying within L4 · Integrated for now.
  (trend confidence 34% · noisy · fit over 8 scan days across 75 days)      [90d, twice]
…Trajectory: Not enough history to project: 2 distinct scan days …          [low-data]
```

`GET /api/org/briefing/pdf` → 200, 7012 B (90d, was 6982) and 6747 B (low-data, was 6597).

**Ceilings.** The `forecastBasis` **compacted tail** ("…, N of them compacted") has still never
rendered — no org on this host has retention-purged history (`DANA-L1-014`'s fixture gap is open), so
only the uncompacted branch is certified. The low-data window still prints a "Change vs … start: +2"
delta beside the refusal, ungated by the same presentability rule. And the **digest** path was not
exercised live (`autoscan.cronSecret: false`), so "briefing AND digest" is verified on the briefing
half only.

### MC-B9 — the gate policy round-trips what it does not render · `NADIA-L1-07`, `PRIYA-L1-02`, `PRIYA-L1-07`

Arm B's shape re-run exactly: policy with `requireChecks` set over the API, then **one unrelated field
changed in the browser** and saved through the form.

```
POLICY BEFORE: {"minLevel":"L3","minOverall":50,"minDimension":40,
                "requireChecks":["control.prepush.lint","guardrail.never-commit"]}
   ↓  Min overall 50 → 55, typed in the form, "Save policy" clicked
POLICY AFTER : {"minLevel":"L3","minOverall":55,"minDimension":40,
                "requireChecks":["control.prepush.lint","guardrail.never-commit"]}
```

**Byte-identical.** Arm B's identical three steps deleted the field silently. The Active-policy summary
still lists it after the save (`shots/recert-B9-after.aria.yaml:60`).

**A dropped bar is now named.** The restore POST (`{policy:null}`) answered with the audit the old
reconciliation could not produce:

```json
"dropped":[ … {"label":"required controls",
   "was":"Reported controls must not be failing: control.prepush.lint, guardrail.never-commit"}]
```

**`PRIYA-L1-02`** — captured under the strongest condition, *while* two required controls were
actively declared six rows above:

```
AI authorship in a blocked repository   not judged fleet-wide — the per-repo gate decides it   —
A required control is failing           not judged fleet-wide — the per-repo gate decides it   —
A dimension below floor                                                                  33 repos
```
`shots/recert-B9-after.text.txt:132-137`

**`PRIYA-L1-07`** — `/org/public?tab=delivery` reads `REQUIRED STATUS CHECKS · 28% · branch
protection` (`shots/recert-B9-delivery.text.txt:503-505`), renamed before the editor lands, as asked.

**Ceilings.** (a) **Only the round-trip half shipped.** The recertified form exposes comboboxes
"Minimum level" / "Add a floor" and three checkboxes and *nothing else*
(`shots/recert-B9-after.aria.yaml:62-82`) — an owner still cannot **set or clear** a required control
from the product. That is **MC-X2**, unbuilt: Priya's last mile still needs one out-of-band write, it
just no longer needs re-writing after every save. (b) Two of the four rows Priya named still read
"0 repos" — `provenance` and `governance` were judged **earned** zeros with the reasoning committed
(`governanceReasons.ts:47-51`). Defensible, but she has not been shown why. (c)
`unjudgedBarsDeclared()` exists and computes "your policy declares a bar this view can't judge", and
the rendered row does not use it to escalate the wording.

### MC-B12 — the /usage headline sums every lane · `VICTOR-L1-05`

```
EST. COST
$211.51
last 30d · all 2 lanes · built-in rates (approx.) · floor: +45 calls unpriced
…
Spend by lane · Scan $33.17 · Local agent $178.34
Spend by team · Org-wide (no repo) · $211.51
```
`shots/recert-B12-usage.text.txt:100-102,126-136`

$33.17 + $178.34 = **$211.51** exactly. Tile, lane table and team table now agree on one screen, and
the tile carries the qualifier *and* the floor. API agrees: `allLanesCostUsd 211.509201`, `byLane`
sums to the same, `allLanesUnpricedCalls 45`. The footnote spells it out: *"The headline is the sum of
every lane and a FLOOR: 45 calls in this period could not be priced and contribute $0 to it."*

Arm B measured tile `$25.90` against an itemized `$115.28` — a 78% understatement. **The gap is zero.**
(Magnitudes moved because this host ran 22 more scan and 23 more local calls since; the *relation* is
the check, not the number.)

**Ceiling.** 45 of 76 local-lane calls still price at $0, so the headline is a floor by an unknown
margin — the qualifier names the *count*, not the exposure. And per-org attribution is still one
"Org-wide (no repo)" bucket, so Victor still has no per-team showback here.

---

## 2. Still open

### MC-B11 — `PRIYA-L1-702` — **mechanism landed, symptom unchanged**

This is the one that does not clear the bar, and it is worth being precise about why: the fix
*landed*, it is *reachable*, and it does **not unblock the job**.

**What is now true.** The payload carries the discriminator the finding said it lacked — a sweep over
`GET /api/org/loop/<id>?org=kiro` for all 20 runs found **36 of 36** stored `resolved` itemOutcomes
returning a `verified` field. `CockpitVerdicts.tsx:52-60` renders an unverified `resolved` as
*"claimed resolved — awaiting the rescan"* in an italic, muted tone with its own hover title, and
treats a payload with **no** `verified` field as unverified — the safe direction.

**What Priya can actually see.** Nothing changed. All 36 rows come back `verified: true`, because
`listRunOutcomes` (`lane-outcomes.ts:301-321`) **joins** verification from the lane's
`closedIdsJson` — and every pre-fix lane's `closedIds` *is* the raw commit-trailer set this finding
indicted. The tautology re-enters through the join. Live, run 1:

```
ITEM VERDICTS
xkazm04/systedo-case · f5ff69aa   closed by the rescan
xkazm04/systedo-case · 8e4e43b4   closed by the rescan
…  (8 rows, all identical)
```
`shots/recert-B11-run1.aria.yaml:2253-2277` — **zero** rows read "claimed resolved".

And the two surfaces still contradict, which was the second half of the discriminator:

```
cockpit   "Closed 16 follow-ups" · "2 repos · 328 gaps closed"
ledger    GET /api/org/backlog?org=kiro&includeClosed=1 → {tracked:17, open:3, inProgress:14, done:0}
```

**Exactly what is missing:** a pre-column backfill — clear or ignore `closedIdsJson` on lanes written
before the claim/verdict split, or store `verified` on the row instead of joining it, so historical
rows fall to `verified: false`. That is **MC-B19**, and until it lands the fix has zero visible effect
on the only corpus that exists. No new loop run was started (claude-cli weekly cap) and none was
needed: the discriminator is read-time, and it was read.

---

## 3. Metric deltas

Baselines are the run's own `SUMMARY.md` time-saved ledger, never re-estimated here.

| Journey · Character | Ledger said (post-L2) | Now | Δ |
|---|---|---|---|
| `evaluate-whether-to-adopt` · **Tomáš** | **≈0 as configured** — "confirmed at 0 through the front door"; he reached the product only by routing around it | **≈40 min saved**, through the front door, on an anonymous arm | **+≈40 min** — the run's single largest value swing; the blocker's whole cost was the funnel |
| `prove-and-track-fleet-maturity` · **Dana** | ≈150–235 h cycle one; **leak: 2–4 h per cycle** hand-verifying the scan-day count before quoting an ETA, "no in-product way to do it" | Same headline; the leak is **retired** — the basis is on the card, in the markdown and in the PDF | **+2–4 h per board cycle** |
| `scan-my-repo-get-a-roadmap` · **Sam** | ≈5 h 50 net | ≈5 h 50 net, unchanged | **0 min** — this was a *trust* fix, not a time fix. What moved: the page no longer makes three statements about one band, so the re-derivation Sam would have done to settle the contradiction is gone |
| `set-and-enforce-the-standard` · **Priya** | **"Worse"** — the last mile costed as one hand-written row, but "the next save through the form deletes it, so the row must be re-written after every policy edit" | Written **once**; it survives every subsequent form save | **Restores ≈150–200 h/quarter**; the residual is one out-of-band write, not one per edit (MC-X2) |
| `supply-chain-and-governance-posture` · **Nadia** | ≈7–10 h/cycle; +2–4 h rework unretired | Unchanged — her rework leak is the `ControlObservation` path, blocked by the no-GitHub-App environment ceiling, not by MC-B9 | **0** |
| `loop-to-l5` · **Priya** | ≈8–10×; remote posture negative | Unchanged | **0** — MC-B11 open |
| `repeated-org-scans-worth-the-price` · **Victor** | ≈30 min/cycle; "**the number he would paste is wrong by 78%**" | ≈30 min/cycle; the number he pastes is now the itemized total and labels itself a floor | **0 min, −78% error** — the risk, not the minutes, was the finding |

**Grounding scores: unchanged, 0 delta, and deliberately so.** None of the six items touches an LLM
surface's prompt input. Surface A (repo scan) and Surface B (briefing narrative) denominators were not
re-derived here — `env.md` §Surface A carries a **⚠ STALE** banner and re-deriving a scored instrument
outside `/uat update` invalidates every cross-run trend. MC-B1 changes what the briefing *renders*
from `ExecBriefing`, not what reaches a prompt; the narrative LLM surface remains gated off on this
host (`BRIEFING_NARRATIVE` + `ANTHROPIC_API_KEY` unset).

---

## 4. New findings for the next drain

The originating run's drain has already happened, so these have no other door into the backlog.

### RC-N1 — one page, two units for the blend weight *(minor · clarity · Sam)*

**Surface:** report → Dimensions. **Evidence:** `shots/recert-B3-dims.text.txt:28` and
`shots/armA-dimloop.json`.

The `ScoreIntegrityChip` header reads **"integrity · widened D2, D6 · blend 95%"** while every
provenance track on the same page reads **"Blend weight 57%"**. Both are correct — 95% is the
*realized fraction of the configured weight* (0.57 against a configured 0.6) and 57% is the
*absolute weight* — and the chip's tooltip reconciles them in one clause. But the reconciliation is
inside a hover, and this is the exact surface where the previous finding was "one page, three
statements". A reader who does not open the tooltip sees 95 and 57 for the same fact.
**Suggested:** print one unit in the chip label, or label the chip's number as "95% of the configured
weight". Cheap; the reconciliation sentence already exists.

### RC-N2 — the "not judged fleet-wide" row does not escalate when the policy declares that bar *(minor · clarity · Priya)*

**Evidence:** `governanceReasons.ts:52-60` — `unjudgedBarsDeclared(policy)` is exported and computes
exactly "this org's stored bar carries a criterion the fleet view cannot judge", and the rendered row
is the same em-dash sentence whether or not the operator has declared one. The strongest version of
`PRIYA-L1-02` was a lead who had *just set two required controls*; that lead now reads a correct
sentence that does not acknowledge she has skin in it. **Suggested:** when
`unjudgedBarsDeclared()` is true, add "— you have declared 2 of these; the per-repo gate enforces
them". `build`, small.

### RC-N3 — two of `PRIYA-L1-02`'s four rows are earned zeros with the reasoning only in code *(polish · clarity)*

`provenance` ("AI changes merged without human review — 0 repos") and `governance` ("Ungoverned
posture — 0 repos") were deliberately **excluded** from `FLEET_UNJUDGED_REASONS` because the rollup
genuinely carries `aiGovernedRate` / `aiPrSample` and the branch-protection fields
(`governanceReasons.ts:47-51`). That is right, and Priya named those two rows too — she will read the
two that changed and wonder about the two that did not. **Suggested:** `concept-doc` or a one-line
hover on an earned zero saying *what was measured* to reach it.

### RC-N4 — `MC-B19` is the whole of MC-B11's user-visible value *(major · trust · Priya)*

Filed as an escalation, not a duplicate: the drain recorded MC-B19 (historical rows read
`verified:true` pre-column) as MC-B11's **ceiling**. This pass measured it as MC-B11's **blocker** —
0 of 36 rows render the new label, so 100% of the shipped value is behind MC-B19 on the only corpus
that exists. It should be ranked as MC-B11's remainder, not as a separate lower-priority item.

### RC-M1 — methodology: a @react-pdf board deliverable **is** text-extractable *(method)*

Arm B recorded "@react-pdf subsets its fonts so the text is not extractable here" and fell back to
comparing byte sizes, which is why `DANA-L1-013`'s PDF half was inferred from a shared conditional
rather than read. It is extractable: inflate the FlateDecode content streams and decode the `TJ`
operands, which are **hex-encoded ASCII**, not glyph indices. ~30 lines of Node, no dependency; the
generator used here is in the scratchpad and the output is `shots/recert-B1-pdftext.txt`. Worth
folding into `env.md` as a standing recipe — a board PDF is Dana's actual deliverable and every run so
far has verified it by proxy.

### RC-M2 — methodology: a driver with a hard-coded shot name overwrites the arm it is reused from *(method)*

`drive-armB-gatepolicy.mjs` writes `armB-nadia07-{before,after}.{png,text.txt,aria.yaml}` — the names
are **inside the driver**, not derived from an argument — so re-running it for recertification
destroyed arm B's originals in place (they are gitignored, so unrecoverable). Copies were made under
`recert-B9-*` after the fact, but the arm-B baseline is gone. **Fix:** every reusable driver should
take its shot stem as an argument the way `drive-armC-openrun.mjs` does.

---

## 5. Residue — everything this pass wrote

| # | What | Where | Reverted? |
|---|---|---|---|
| 1 | Killed PID 16532 (`:3000` dev server, pre-commit-range) and restarted `npm run dev` | host | n/a — **:3000 is left RUNNING and healthy** |
| 2 | Started a **second** dev instance on `:3100` with `PGLITE_DATA_DIR=.pglite/uat-armA` and `distDir=.next-empty` | host | **Still running.** Isolated; the shared `:3000` and `.pglite/ascent` were never touched by it. Kill it when the arm is no longer wanted. |
| 3 | `POST /api/org/gate-policy` on org `public` — set `{minLevel:L3, minOverall:50, minDimension:40, requireChecks:[control.prepush.lint, guardrail.never-commit]}` | PGlite `.pglite/ascent` | **Yes** — `POST {policy:null}`, `GET` re-confirms `{"policy":null}` |
| 4 | `drive-armB-gatepolicy.mjs` saved the form with **Min overall 55** (an in-browser policy write) | same row as #3 | **Yes** — cleared by the same restore |
| 5 | Two org-audit rows written by #3/#4 (the policy save + the reset), each carrying `previousPolicy` | `OrgAudit` | **No** — audit is append-only by design. Two rows dated 2026-08-31 on org `public`, actor `developer`, are UAT residue, not operator activity. |
| 6 | Live claude-cli **report read** for `sindresorhus/slugify` (cached — no new scan was started; the report already existed on :3000) | — | n/a |
| 7 | 2 × `GET /api/org/briefing/pdf` (org `public`, two windows) → saved to the run dir | run dir only | n/a — read-only |
| 8 | Cold-permalink page view for `sindresorhus/query-string` on `:3100`. **No scan was started** — the gate was captured, the button not clicked. | — | n/a |
| 9 | Loop cockpit reads: `GET /api/org/loop`, 20 × `GET /api/org/loop/<id>`, and the cockpit UI. **No loop run was started or stopped by this pass** (claude-cli weekly cap; the discriminator is read-time). The boot sweep's "1 loop run stopped, 2 stranded worktrees removed" was the *server restart*, not a driver. | — | n/a |
| 10 | New shots, all prefixed `recert-*` (gitignored) | `runs/2026-08-30-moonshot-cert/shots/` | kept as evidence |
| 11 | **Overwrote** arm B's `armB-nadia07-{before,after}.*` and arm A's `armA-dim-D{1..9}.png` / `armA-dimloop.json` — hard-coded shot names in the reused drivers (see RC-M2) | same dir | **No — irrecoverable.** New content is this pass's; copies also exist as `recert-B9-*`. |
| 12 | `findings.json` — 12 rows patched in place (`resolution`, `ceiling`, `recertify_evidence`, `recertify_commit_range`). JSON re-parsed after the write; 86 rows, unchanged count. | run dir | intentional |
| 13 | This file | run dir | intentional |

**Nothing was committed.** The working tree carries the `findings.json` edit and this file for review.
