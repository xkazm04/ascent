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

---

# Recertify pass 2 (b1992360..afc913c0)

**Mode:** `/uat recertify`, second pass over the same originating run. No new run id — resolutions are
written back into this run's own `findings.json`; this section is the diff report.

| | |
|---|---|
| **Commits under test** | `b1992360..afc913c0` (23 commits, master) |
| **Drain items built** | MC-B4 `9d85f01a` · MC-B5 `21bef0ed` · MC-B6 `27a722ee` · MC-B7 `13410fcf` · MC-B8 a–d `0d088f41` + `97d48243` + rubric r14 `afc913c0` · MC-B10 `527b5973` · MC-B13 `9f0f83ce` · MC-B14 `30f53490` · MC-B15 `de0ca559` · MC-B16 `d3b026d9` · MC-B17 `99b290a5` · MC-B23 = `verifiedAt` `9e8906f1` (closes MC-B11 / `PRIYA-L1-702`, left open by pass 1) |
| **App server (:3000)** | **RESTARTED.** Pre-existing PID 35740 started 2026-08-31 13:56:54 — *earlier than the newest commit under test* (`afc913c0`, 14:08:28 +02:00), so it was serving pre-fix code by 12 minutes. Killed; `npm run dev` restarted as PID 44724 at **14:09:58 +02:00**; healthy at 14:10:24 with Ascent's identity, not merely a 200: `{"status":"ok","db":"up","dbMode":"pglite","autoscan":{"ready":false,"cronSecret":false,"githubApp":false,"db":true}}`. |
| **PGlite self-repair** | Boot log: `[pglite] schema drift repaired — added "Recommendation"."firstStep"`, then `[pglite] schema ensured from prisma/init.sql`, then `embedded local DB ready`. `LaneItemOutcome.verifiedAt` needed no repair (it is in `prisma/init.sql:2126`, applied by the idempotent ensure). **Boot succeeded; no wedge, `.next` untouched.** |
| **Anonymous arm (:3100)** | Rebuilt from scratch — pass 1's instance was dead. Final recipe: `ASCENT_EMPTY=1 PGLITE_DATA_DIR=.pglite/uat-recert2-empty ASCENT_AUTH_BYPASS= PUBLIC_SCAN_QUOTA_DISABLED= ASCENT_SELF_HOSTED=0 PUBLIC_SCAN_MONTHLY_LIMIT=1 npx next dev -p 3100`. Anonymity asserted from ARIA before any verdict (`shots/recert2-B8d-zero.aria.yaml:17` — a bare `button "Sign in"`, no org, no avatar). The limit was pinned to **1** on purpose so a re-typed "5" anywhere would have been visible; see MC-B5. |
| **Drivers** | Reused, unmodified: `drive.mjs`, `drive-armA-report.mjs`, `drive-armA-dims.mjs`, `drive-armA-dimloop.mjs`, `drive-armC-openrun.mjs`. No bespoke driver was written. |
| **Shots** | `SHOT_DIR=uat/runs/2026-08-30-moonshot-cert/shots`, prefix **`recert2-*`** throughout (RC-M2 discipline). Two drivers still hard-code their own stems — see RC2-M2. |
| **Environment note** | A **parallel session sharing this checkout** started loop run `a97baf88` at 14:10 local, one minute after the restart. It was in flight for this whole pass. This pass started and stopped no loop run; the run's survival is used as evidence for MC-B16 and nothing was done to it. |

---

## Verdicts

| Item | Findings | Verdict |
|---|---|---|
| **MC-B23 / MC-B11** | `PRIYA-L1-702` (major) | ✅ **resolved-verified** — the headline |
| **MC-B4** | `SAM-L1-04` (minor, recurrence 3), `SAM-L1-12` (minor) | ✅ **resolved-verified** |
| **MC-B5** | `TOMAS-L1-02` (major) | ✅ **resolved-verified** |
| **MC-B6** | `TOMAS-L1-04` (major) | ✅ **resolved-verified** (label half; the proof half is untouched — ceiling) |
| **MC-B7** | `SAM-L1-01` (minor, recurrence 2) | ✅ **resolved-verified** |
| **MC-B8a** | `SAM-L1-05` (minor) | ⚠️ **open** — landed, wired, and **empty on the first live r14 reading** |
| **MC-B8b** | `SAM-L1-06` (minor) | ✅ **resolved-verified** |
| **MC-B8c** | `SAM-L1-08` (polish) | ✅ **resolved-verified** (`local` branch compile-verified only) |
| **MC-B8d** | `TOMAS-L1-05` (polish) | ✅ **resolved-verified** |
| **MC-B10** | `NADIA-L1-08` (minor) | ✅ **resolved-verified** |
| **MC-B13** | `NADIA-L1-02` (major), `NADIA-L1-03` (minor) | ⚙️ **fixed, not resolved** — `uncertain — not reproducible on this host` |
| **MC-B14** | `NADIA-L1-04` (major), `-05` (major), `-06` (minor) | ✅ **resolved-verified** |
| **MC-B15** | `PRIYA-L1-704` (major) | ✅ **resolved-verified** |
| **MC-B16** | `PRIYA-L1-701` (blocker) | ✅ **resolved-verified** on the local control; the **remote consequence stays `uncertain — not reproducible`, never passed** |
| **MC-B17** | `PRIYA-L2-C5` (major) | ✅ **resolved-verified** |
| **MC-B17** | `PRIYA-L2-C4` (major) | ⚙️ **fixed, not resolved** — code-verified, no live claim exercised |

**Regressed: none.** Every check pass 1 recorded as resolved still holds where this pass crossed it
(the permalink page, the governance card and the Delivery naming all render as pass 1 recorded them).

---

## 1. The headline — `PRIYA-L1-702` is closed, and it is an exact inversion of pass 1

Pass 1's verdict was "mechanism landed, symptom unchanged": the payload had gained a `verified` field
and **36 of 36** stored `resolved` rows still answered `true`, because `listRunOutcomes` joined
verification back out of the lane's `closedIdsJson` — the very trailer set the finding indicted. Pass
1 named the exact remedy: *stop joining, stamp the row*.

That is what `9e8906f1` did, and the measurement flips completely:

```
sweep: GET /api/org/loop?org=kiro  +  20 x GET /api/org/loop/<id>?org=kiro
  resolved itemOutcomes ............ 40
  verified: true ................... 0        (pass 1: 36)
  verified: false .................. 40       (pass 1: 0)
  field absent ..................... 0
  every false row also carries ..... verifiedAt: null
```

`lane-outcomes.ts:156-173` now reads `verified: row.verdict === "resolved" && verifiedAt !== null` —
the row's own stamp, written by the rescan when it rules. A row nothing adjudicated can no longer
borrow the lane's word for it.

**And Priya can see it.** Fresh cockpit capture, `drive-armC-openrun.mjs "/org/kiro?tab=live" "RUN 1"`:

```
ITEM VERDICTS
xkazm04/systedo-case · b87a08e6   skipped
xkazm04/systedo-case · b8d643fa   claimed resolved — awaiting the rescan
xkazm04/systedo-case · 7af1b6d2   claimed resolved — awaiting the rescan
xkazm04/systedo-case · a500af2a   skipped
xkazm04/kp           · f01a307e   claimed resolved — awaiting the rescan
...
```

`shots/recert2-B23-run1.text.txt:1688-1733`. `grep -c "closed by the rescan"` over the ITEM VERDICTS
section: **0**. Pass 1 measured 8 of 8 rows reading "closed by the rescan" and zero reading "claimed".

**The two surfaces no longer contradict.** `GET /api/org/backlog?org=kiro&includeClosed=1` answers
`{tracked: 22, open: 3, inProgress: 19, done: 0}`. Nothing on the cockpit now asserts a rescan
confirmed a close, so `done: 0` and the item verdicts tell the same story — claims in flight, none
adjudicated. That was the second half of the discriminator and it is settled.

**Ceilings** (all three carried in the row's `ceiling` field): the POSITIVE half is unit-verified only
— the one live post-fix run has 12 outcomes and 0 `resolved`, so no live row has yet earned a stamp;
the lane rails (`LaneRail.tsx:56`, `AutopilotBandParts.tsx:123`) still print `closedIds.length`
"closed by the rescan", un-backfilled for pre-fix lanes; and the sheet header still says "324 gaps
closed" where `gaps` is `diff.closedGapCount`, a scan-diff quantity wearing the same word.

---

## 2. What the rest of the pass measured

Full evidence for each row is stamped into `findings.json` under `recertify_evidence` (pass-1 stamps
preserved, pass-2 appended after a `— RECERTIFY PASS 2 —` marker). The short version:

- **MC-B4** — the report header hands over three separately-copyable payloads (permalink,
  commit-pinned, README markdown) with the level line `L1 · Manual · 23` stated twice; a cookie-less
  `GET /report/sindresorhus/slugify` returns 200 and 54 KB of report.
- **MC-B5** — the anonymous arm was pinned to `PUBLIC_SCAN_MONTHLY_LIMIT=1` so derivation could be
  *proved*: the Free card, the scan dialog's meter and the 429 all moved to **1**
  ("1 free public scans / month" · "0 of 1 free scans left this month" ·
  *"You've used your 1 free scan this month. Upgrade to **Starter** for more monthly scans"*).
  The stored id `Pro` no longer reaches a user.
- **MC-B6** — `ILLUSTRATIVE · 8 SAMPLE REPOS, DEMO WEIGHTING — NOT CUSTOMER DATA`, rendered directly
  under the simulator's 8-repo grid and its metric row.
- **MC-B7** — needed a **fresh live scan** (evidence strings are written at scan time). Before:
  `CI runs tests`. After: `CI runs tests (.github/workflows/main.yml)`, and D3's CI-presence award and
  D6's formatter likewise. The detector no longer lags the model's own prose.
- **MC-B8** — (b) each flagged row now ends in `widened` with its clause; (c) `SCORE_STEP_LABEL` is a
  total `Record` over `ProviderName` including `local`, and "Asking Claude…" was captured live
  mid-scan; (d) on a genuinely empty database there is no repos-rated counter at all.
- **MC-B10** — the three catalogue headings all render and each cross-links the other two; the ledger
  says "chained"; the perimeter band still says SEALED.
- **MC-B14** — `?format=csv` returns real CSV with `DIGEST_FIELD_ORDER` as its header line; the
  integrity strip with **Verify now** + **Download observation rows (CSV)** renders in the non-empty
  branch (kiro) *and* the empty one (public); `/api/audit/verify` returns `sealBacklogRemaining` and
  **no longer returns `sealedOnThisRequest`**; the conformance-pack manifest carries a `## Ledger
  integrity` section that honestly says there is no root yet.
- **MC-B15** — the $-for-0-points case reads **`$7.60 · 0 pts`**: the spend is stated beside the zero.
- **MC-B16** — a live local run survived ~35 minutes and ~30 cockpit reads. The remote half is
  **`uncertain — not reproducible on this host`** and is recorded as such, not passed.
- **MC-B17** — a three-way zero-residue probe on the real org proved tenancy: `kiro` + `xkazm04/kp`
  now passes `repoUnderOrg` while `kiro` + `facebook/react` is still refused; the write was then
  exercised end to end on the demo org (200, `derivedTier: T0` / `grantedTier: T1`).
- **MC-B13** — the wiring audit that produced the finding now answers the other way (`failMeans` and
  `descriptor` both have live consumers, and the card's footnote about them renders), but **no row on
  this host is red and no descriptor control is observed**: all 16 observations are `unmeasurable`
  because there is no GitHub App, and `/api/org/controls` is GET-only, so the fixture cannot be built
  over HTTP. Resolved `fixed`, not `resolved-verified`.

---

## 3. Metric deltas

Baselines are this run's `SUMMARY.md` ledger as amended by pass 1, never re-estimated here.

| Journey · Character | Pass 1 | Pass 2 | Δ |
|---|---|---|---|
| `loop-to-l5` · **Priya** | ≈8–10×; **MC-B11 open** — "0 of 36 rows render the new label, 100% of the shipped value is behind MC-B19" | The label is on **every** pre-fix row; cockpit and ledger agree | **The pass's largest swing.** The cockpit stops laundering a claim into a verification, which was the trust cost the whole journey turned on |
| `evaluate-whether-to-adopt` · **Tomáš** | ≈40 min saved through the front door | ≈40 min, unchanged; the funnel now states ONE allowance and names a tier that exists on the price list | **0 min, −1 contradiction.** The remaining one is the credit matrix (RC2-N5) |
| `scan-my-repo-get-a-roadmap` · **Sam** | ≈5 h 50 net | ≈5 h 50 net | **0 min.** Two trust fixes (evidence filenames, flagged-row outcomes) and one **unrealised** promise: r14's first steps came back empty (RC2-N1) |
| `supply-chain-and-governance-posture` · **Nadia** | ≈7–10 h/cycle; rework leak unretired | Same; the seal recipe now has rows, a door and a schedule, so "recompute it yourself" is executable for the first time | **0 h measured** — the leak is the `ControlObservation` path, still blocked by the no-GitHub-App ceiling |
| `set-and-enforce-the-standard` · **Priya** | restored ≈150–200 h/quarter, one out-of-band write remaining | Unchanged (MC-X2 still unbuilt) | **0** |
| `prove-and-track-fleet-maturity` · **Dana** | +2–4 h per board cycle | Unchanged | **0** |
| `repeated-org-scans-worth-the-price` · **Victor** | ≈30 min/cycle, −78% error | Unchanged | **0** |

**Grounding scores: unchanged, 0 delta, deliberately.** One item in this round touches a prompt —
MC-B8a's `firstStep`, which adds an OUTPUT field, not a grounding source. `env.md` §Surface A still
carries its ⚠ STALE banner and re-deriving a scored instrument outside `/uat update` would invalidate
the cross-run trend.

---

## 4. New findings for the next drain

### RC2-N1 — rubric r14 shipped a field the model returns empty *(major · quality-gap / trust · Sam)*

`firstStep` is threaded end to end — schema, prompt skeleton, DB column, wire types, renderer — and
`SCORING_RUBRIC_VERSION` was bumped to **r14** on the stated grounds that "the model is now ASKED a
different question, so a cached r13 answer and a fresh r14 answer are not the same reading" — which
invalidates every cached scan on the estate. **The first live r14 reading returned `firstStep` on 0 of
9 roadmap items** (fresh claude-cli/opus scan of `sindresorhus/slugify`, 177 s), and the rendered
report contains no "First step:" (`shots/recert2-B8-freshreport.text.txt`, 0 hits).

The likely cause is visible in the prompt: `firstStep` appears **only** as an empty slot in the JSON
skeleton (`prompt.ts:354`) and as a JSON-schema description (`schema.ts:66`). The ROADMAP COVERAGE
block (`prompt.ts:291-298`) — where the model is actually told what a roadmap row must contain —
never mentions it, while the surrounding instruction (`prompt.ts:323`) presses in the opposite
direction: *"Ascent is a transition COMPANION, not a boss."* A model asked to be non-prescriptive,
and asked for a concrete first move only by an empty key, omits the key. Label this root cause a
`hypothesis` for the fixer; the 0-of-9 measurement is not a hypothesis.
**Suggested:** one sentence in the ROADMAP COVERAGE block naming when a first step is expected and
when omitting it is right. `build`, small. Do not fabricate a default — the absent-is-absent rule is
correct and must survive the fix.

### RC2-N2 — the derived allowance is not pluralized in the pricing copy *(polish · clarity · Tomáš)*

With `PUBLIC_SCAN_MONTHLY_LIMIT=1` the Free card reads **"1 free public scans / month"** and
"Private scans every month, and **1 free public scans**", and the footnote reads "The **1 free public
scans** run on their own rolling 30-day window" (`shots/recert2-B5-pricing-l1.text.txt:44,51,435`).
The 429 pluralizes correctly (`limit === 1 ? "" : "s"`, `public-scan-quota.ts:367`) — the same care
was not applied to the copy that now derives the same number. Invisible at the default of 5; visible
the moment an operator sets 1. **Suggested:** reuse the same ternary. `build`, trivial.

### RC2-N3 — the register's worded empty state is unreachable *(polish · missing · Tomáš)*

`IndexGallery.tsx:88-90` renders "No public scans yet. Scan a repository below to be the first on the
register." when `board.length === 0`. It cannot fire: `loadPublicGalleryCards` returns **null** when
no cards exist (`scans-read.ts:840`), and the landing page then drops the whole gallery block — which
is what this pass observed on a truly empty arm (no heading, no counter, no empty state). Non-null
implies `cards.length > 0` implies `recent.length > 0` implies `board.length > 0`, so the branch is
dead in the exact case it was written for. Present-and-correct-but-unwired, the class L1's wiring
audit owns. **Suggested:** decide which of the two behaviours is wanted — an absent section or a
worded one — and delete the other. `build`, small.

### RC2-N4 — an admission decision cannot be withdrawn *(major · trust · Priya)*

`/api/org/admission` exposes `GET` and `POST` and nothing else. `upsertRepoAdmission` can *change* a
decision, so the closest thing to a revoke is writing `grantedTier == derivedTier`, which still
records that an owner decided something. On a surface whose whole argument is "an override with no
named author is not a decision — it is a measurement with a different value" (`route.ts:99-102`), the
inverse asymmetry is the problem: a decision made in error is permanent, and the audit trail cannot
distinguish "decided, then withdrawn" from "decided". This pass hit it directly — its own probe row on
org `public` could only be neutralised, not removed (residue #6). **Suggested:** a DELETE that records
a withdrawal in `OrgAudit` (never a silent row removal), so the ledger reads decided → withdrawn.
`build`, small.

### RC2-N5 — /pricing still answers "Unlimited" for the allowance the same page caps *(minor · clarity · Tomáš)*

MC-B5 fixed the Free card, the metadata and the FAQ; the credit matrix further down the **same page**
was not in the write set. `creditMatrixData.ts:124` still opens the Scanning section with *"Public
scans are always free and never metered."* and the "Public repository scan" row renders `Unlimited` in
all four tier cells (`cells: all("Unlimited")`, line 131). The reconciliation exists — "Never metered
on any plan — rate-limited and monthly-capped instead" — but it lives in the row's detail text, below
a cell that says Unlimited, on a page whose Free card says 1 (or 5). This is the direct residue of
`TOMAS-L1-02` and is pinned as intentional by `creditMatrixData.test.ts:58-59`, so it is a **decision
to revisit**, not a miss. **Suggested:** `concept-doc` — the real question is whether "metered"
(credit-consuming) and "capped" (allowance) can be two words on a page a buyer skims, or whether the
matrix cell should simply state the allowance. Rank by convergence: this is the third run in which a
Tomáš-class reader meets two numbers for one free tier.

### RC2-N6 — "closed" still means two things on the cockpit *(minor · clarity · Priya)*

MC-B23 fixed the per-item verdict. Two siblings kept the old word: the lane rails print
`{closedIds.length} closed by the rescan` (`LaneRail.tsx:56`, `AutopilotBandParts.tsx:123`) — honest
for post-fix lanes, still the raw trailer count for every pre-fix one — and the outcome sheet header
prints "324 gaps closed" where `gaps` is `diff.closedGapCount` (`outcomeCellFold.ts:81`), a scan-diff
quantity, not a follow-up count. A reader who has just learned that "claimed resolved" is not "closed"
now meets "closed" twice more, meaning two other things. **Suggested:** `build`, small — the rail says
"verified closed", the header says "gaps no longer raised".

### RC2-M1 — methodology: a shared `distDir` makes an empty-database arm lie *(method)*

The register read `2 PUBLIC REPOS RATED`, then `5`, on **freshly bootstrapped** PGlite directories.
Cause: `loadPublicGalleryCards` is wrapped in Next's `unstable_cache` (`scans-read.ts:797`, tag
`public-scan-gallery`), and every `ASCENT_EMPTY=1` arm shares `distDir: .next-empty`
(`next.config.ts:47`) — so a new arm with a brand-new database serves the **previous arm's** cached
rows. An empty-state check run that way is a silent false pass, and it nearly produced one here for
MC-B8d. **Standing rule for `env.md` §Arm construction:** when the arm's point is an EMPTY database,
`rm -rf .next-empty` before booting it, and note that only one `ASCENT_EMPTY` instance can run at a
time (a second dies with "Another next dev server is already running", pointing at the shared
`.next-empty`).

### RC2-M2 — methodology: RC-M2 is unfixed, and it bit again *(method)*

Pass 1 recorded that `drive-armB-gatepolicy.mjs` hard-codes its shot stems and destroyed arm B's
originals. The same is true of `drive-armA-dimloop.mjs` (writes `armA-dimloop.json`,
`armA-dim-D{1..9}.png`) and `drive-armA-dims.mjs`, and **this pass overwrote pass 1's copies of those
files** before noticing — fresh copies were taken as `recert2-B7-*` afterwards, but the pass-1 bytes
are gone (gitignored). The lesson has now cost two passes. **Fix, concretely:** give every reusable
driver a `shot` argument the way `drive-armC-openrun.mjs` does; three drivers need it.

### RC2-M3 — methodology: two techniques worth keeping *(method)*

(a) **The zero-residue gate probe.** When a POST route validates tenancy *before* the field
validators, sending a deliberately invalid field distinguishes "the gate accepted this repo" from
"the gate rejected it" by *which error comes back* — proving the gate without writing a row. It
settled `PRIYA-L2-C5` on the real working org with no residue at all; the write was then exercised on
a demo org where the residue is inert. (Note for the driver: ascent's org POST routes enforce
same-origin, so a probe must send `Origin`/`Referer` or it answers 403 "Cross-origin request
rejected." before any validator runs.)
(b) **Pin a limit to prove a derivation.** MC-B5's claim was "one number everywhere". Reading the
default (5) on three surfaces proves nothing — three hardcoded 5s look identical. Booting the arm with
`PUBLIC_SCAN_MONTHLY_LIMIT=1` made every surface that re-typed the number visible instantly.
Generalize: **to certify a single-source claim, move the source.**

---

## 5. Residue — everything this pass wrote

| # | What | Where | Reverted? |
|---|---|---|---|
| 1 | Killed PID 35740 (`:3000`, pre-commit-range) and restarted `npm run dev` as PID 44724 | host | n/a — **:3000 is left RUNNING and healthy** |
| 2 | Anonymous arms on `:3100`: three successive instances (`.pglite/uat-armA2`, then `.pglite/uat-recert2-empty`, the last with `PUBLIC_SCAN_MONTHLY_LIMIT=1`). `.next-empty` and `.pglite/uat-recert2-empty` were **deleted and rebuilt** mid-pass (RC2-M1) | host | **:3100 was STOPPED at the end of the pass.** The throwaway PGlite dirs `.pglite/uat-armA2` and `.pglite/uat-recert2-empty` are left on disk for inspection and can be deleted freely; the shared `:3000` and `.pglite/ascent` were never opened by them |
| 3 | **Live claude-cli scan** of `sindresorhus/slugify` on `:3000` (`fresh: true`, 177 s) — a new Scan row, now that repo's latest reading (rubric r14) | `.pglite/ascent` | **No.** Intentional and necessary: MC-B7's evidence strings and MC-B8a's `firstStep` are written at scan time and cannot be certified off a pre-fix row |
| 4 | **Live scan of `sindresorhus/pretty-bytes` started and abandoned** on `:3000` — the browser was closed after capturing the provider label; the server-side scan will have completed and landed a row | `.pglite/ascent` | **No.** One extra public-repo scan row |
| 5 | On the `:3100` throwaway DBs: 5 **mock** scans (`sindresorhus/{slugify,p-limit,ky,got,execa}`), 1 **live** scan of `slugify`, and one 429 probe | `.pglite/uat-armA2`, `.pglite/uat-recert2-empty` | n/a — isolated throwaway databases |
| 6 | **Admission decision row** on org `public` for `sindresorhus/slugify` (the MC-B17 write proof) | `.pglite/ascent` | **Partially.** Neutralised by a second POST to `grantedTier: T0` (== `derivedTier`, so no override is in force) with `mode: blocked` and a rationale naming this run. **It cannot be deleted — the route has no DELETE (RC2-N4).** Org `public` runs no loop, so the row is inert |
| 7 | `OrgAudit` rows from #6 (two admission writes) | `OrgAudit` | **No** — append-only by design. Rows dated 2026-08-31, org `public`, actor `developer`, are UAT residue |
| 8 | 4 zero-residue POST probes to `/api/org/admission` that all returned 400 before any write | — | n/a — nothing was written |
| 9 | **Overwrote** `shots/armA-dimloop.json` and `shots/armA-dim-D{1..9}.png` — hard-coded stems in `drive-armA-dimloop.mjs` (RC2-M2) | run dir | **No — irrecoverable.** Copies of both the pre-fix and post-fix readings were saved as `recert2-B7-dimloop.json` / `recert2-B7-fresh-dimloop.json` / `recert2-B7-D{1..9}.png` |
| 10 | New shots, all prefixed `recert2-*` (gitignored) | run dir | kept as evidence |
| 11 | `findings.json` — **20 rows** patched in place (`resolution`, `ceiling`, `recertify_evidence`, `recertify_commit_range`); pass-1 stamps preserved and appended to, never overwritten. Re-parsed after the write: 86 rows, unchanged count | run dir | intentional |
| 12 | This section | run dir | intentional |
| 13 | **Not this pass:** loop run `a97baf88` (started 14:10 local by a parallel session sharing this checkout) was in flight throughout and was neither started, read destructively, nor stopped by this pass | — | n/a |

**Nothing was committed.** The working tree carries the `findings.json` edit and this file for review.

---

## Recertify pass 3 (`9fe74071..d6fec3a9`)

**Started** 2026-08-31 16:16 local · **range** `9fe74071..d6fec3a9` (30 commits: four merged lanes A–D
plus the backlog roll-up) · **23 items under test**, all carrying `built 2026-08-31 — pending recert`.

**Step 0 (environment freshness) — PASSED, and it mattered.** `:3000` was PID 44724, started
**14:09:58**; the last commit under test landed **16:08:46**. The server predated the entire second
half of the range. Killed and restarted as **PID 8968 at 16:16:15**, health asserted for *identity*
not liveness: `{"status":"ok","db":"up","dbMode":"pglite","autoscan":{…}}`. Every reading below is
from that process.

**⚠ Fidelity caveat, recorded because it is the honest bound on this pass.** At **16:36:17** a
parallel session sharing this checkout renamed `consecutiveRedBaseline` →
`consecutiveUnavailableBaseline` in `src/lib/local/lane-baseline.ts` and the whole app stopped
compiling mid-pass (`/api/health` returned a Turbopack 500 for ~2 minutes; recovered 16:38:19,
untouched by this pass). `HEAD` is still `d6fec3a9`, but eleven `src/lib/local/**` and
`src/lib/db/loop-*` files are dirty with that session's uncommitted work. **All cockpit evidence in
§1 was captured at ~16:19–16:22, before the first of those writes**, and the rendering components
(`src/features/inflight/live/**`) are clean throughout — so the loop verdicts stand. Nothing after
16:38 depends on those files.

### Verdicts

| Item | Findings | Verdict |
|---|---|---|
| **MC-B41** | ceiling of `PRIYA-L1-702` (drain-born) | ✅ **resolved-verified** — three of the four words rendered live |
| **MC-B25** | `PRIYA-L2-C6`, `PRIYA-L2-C7` | ✅ **C6 resolved-verified** (horizon live off a real run) · ⚙️ **C7 fixed** |
| **MC-B40** | `RC2-N4` (drain-born) | ✅ **resolved-verified** — and it deleted pass 2's residue row |
| **MC-B36** | `RC-N2` (drain-born) | ✅ **resolved-verified** — the count came from the stored policy |
| **MC-B37** | `RC-N3` (drain-born) | ✅ **resolved-verified** |
| **MC-B28** | `VICTOR-L1-07` | ✅ **resolved-verified** (empty-but-read branch) |
| **MC-B18** | `TOMAS-L1-11` | ✅ **resolved-verified** — 25 of 25 rows stale under r15, all chipped |
| **MC-B35** | `RC-N1` (drain-born) | ✅ **resolved-verified** — chip and track print one unit on one page |
| **MC-B24** | `SAM-L1-13` | ✅ **resolved-verified** (discovery link) · destination **uncertain — not reproducible** |
| **MC-B19** | `VICTOR-L1-02` ✅ · `VICTOR-L1-04` ⚙️ · `VICTOR-L1-03` 🅑 | ✅ **(a) resolved-verified** (CSV downloaded, reconciles) · ⚙️ **(b) fixed, symptom unchanged** · 🅑 **(c) by-design / sequenced** |
| **MC-B20** | `VICTOR-L2-01` | ✅ **resolved-verified** (drop half, one real model call) — **but the fix creates `RC3-N1`** |
| **MC-B21** | `VICTOR-L1-01` | ✅ **resolved-verified** |
| **MC-B22** | `TOMAS-L1-10` | ✅ **resolved-verified** with the env genuinely unset |
| **MC-B38** | `RC2-N2` (drain-born) | ✅ **resolved-verified** on a `PUBLIC_SCAN_MONTHLY_LIMIT=1` arm |
| **MC-B31** | `VICTOR-L1-06` ✅ · `VICTOR-L1-08` ⚙️ | ✅ **(c) resolved-verified** · ⚙️ **(a)(b) fixed** — **but (c) creates `RC3-N2`** |
| **MC-B39** | `RC2-N3` (drain-born) | ⚙️ **fixed** — the dead branch is deleted, one behaviour declared |
| **MC-B32** | (drain-born) | ⚙️ **fixed** — no anomaly fired to observe |
| **MC-B27** | `DANA-L1-015` | ⚙️ **fixed** — cron not configured on this host (`MC-M3` still owed) |
| **MC-B23** | `SAM-L1-10` | ⚙️ **fixed** — no reachable live fixture |
| **MC-B29** | `PRIYA-L1-03/04/05/06`, `NADIA-L1-09/10` | ⚙️ **fixed, 6 of 6 sub-parts** — none rendered live |
| **MC-B30** | `PRIYA-L1-705/706/707` | ⚙️ **fixed** — (b) took the stronger of the two allowed routes |
| **MC-B34** | (drain-born) | ⚙️ **fixed** — same gate as every other forecast surface |
| **MC-B26** | `PRIYA-L1-703` | ⚠️ **OPEN — partial fix.** The server read and the copy landed; `/api/org/loop/[id]` kept its `selfHostGuard` |

**Regressed: none.** Every check passes 1 and 2 recorded as resolved still holds where this pass
crossed it — the integrity chip, the provenance tracks, the governance card, the register and the
`/usage` panels all render as recorded.

**Tally: 9 `resolved-verified` · 14 `fixed` · 1 `by-design` · 1 `open`** across the 25 mapped finding
ids; 23 items.

---

### 1. The headline — the cockpit's four-word vocabulary, measured on a real run

`MC-B41` is the item with the most ways to be quietly wrong: four different words, on four different
components, all meaning something adjacent. Three of the four rendered live on `/org/kiro?tab=live`
against the in-flight run `a9cf047e` and the completed `RUN 1`
(`shots/recert3-B41-cockpit.*`, `shots/recert3-B41-run1.*`):

| Word | Where | Live evidence | Means |
|---|---|---|---|
| **verified closed** | lane rail | `recert3-B41-cockpit.text.txt:65,70` — *"cycle 1 · 0 commits · 0 verified closed"* | follow-ups the rescan ADJUDICATED closed |
| **gaps no longer raised** | outcome sheet header | `:77` — *"2 repos · 359 gaps no longer raised"* | a scan-diff quantity (`diff.closedGapCount`) |
| **claimed resolved — awaiting the rescan** | per-item verdict | `recert3-B41-run1.text.txt:1855,1862,1876,1883` | an agent's unconfirmed claim |
| **closed by the rescan** | per-item verdict | *not rendered* | a VERIFIED per-item verdict |

The fourth word could not appear and its absence is itself the confirmation: `CockpitVerdicts.tsx:43`
reserves *"closed by the rescan"* for `verdict === "resolved" && verifiedAt !== null`, and pass 2
measured **40 resolved outcomes, 0 with `verifiedAt`** after `MC-B33` stopped the read-time join. So
every one of those rows now renders in the muted `CLAIMED_LABEL` form instead — which is exactly the
inversion `PRIYA-L1-702` asked for, seen from the other side. The rail carries the honest history in
its own title attribute: *"On a lane run before 2026-08-31 this is the commit-trailer count, which was
never backfilled."*

**Ceiling:** the vocabulary is now four words for four facts, but a reader on this host sees only
three of them; the fourth is unobservable until a rescan verifies something, and no lane has since
`MC-B33` landed.

`MC-B25`'s stop half rides the same surface. `GET /api/org/loop?org=kiro` now answers **two new
fields** — `stopping: false`, `stopHorizonMs: 1500000` — and the horizon is not a constant:
`route.ts:93` resolves it as `agentTimeoutMs(active.agentTimeoutMs)`, and 1 500 000 ms is that run's
own `agentTimeoutMs` from the same payload. The comment above it states why (*"a browser guessing
'20 min' would be wrong on every deployment that raised it"*). **The caption was not rendered**:
pressing Stop would have killed a parallel session's live run, so `stoppingCaption(1500000)` →
*"Stopping — in-flight lanes finish their current session first, up to 25 min."* is code- and
unit-verified only (`CockpitHeader.dom.test.tsx:65,73`). The live header correctly shows the pre-stop
state (`STOP`, `STOP AFTER IN-FLIGHT` — `recert3-B41-cockpit.text.txt:38,71`).

### 2. The residue cleanup that was also the test — `MC-B40`

Pass 2 left an admission row on org `public` it *could not delete*, and wrote the missing `DELETE` as
`RC2-N4`. This pass withdrew it through the door that finding opened, so one act serves as both the
live certification and the cleanup:

1. **Before** — `GET /api/org/admission?org=public` returned the neutralised row
   (`sindresorhus/slugify`, `grantedTier: T0`, rationale *"UAT recertify pass 2 - NEUTRALISED…"*).
2. **Act** — `DELETE /api/org/admission` (same-origin headers per `RC2-M3a`) →
   `{"ok":true,"withdrawn":{…}}`, returning the removed decision rather than a bare success.
3. **After** — `GET` returns `{"rows":[],"stanceVersion":null}`. **State is sparse again**; the org
   carries no decision, which is different from carrying a decision that says nothing.
4. **The act persisted** — `/org/public?tab=audit` (`shots/recert3-B40-audit.text.txt:106,109`) shows
   `ADMISSION WITHDRAWN` with the previous grant named: *"sindresorhus/slugify: admission decision
   WITHDRAWN — was blocked, tier T0 (decided by @developer); back to no decision, tier T0 as derived —
   UAT recertify pass 3 …"*. The ledger now reads decided → withdrawn, which is the whole argument of
   the row.
5. **Idempotent, and honest about it** — a second `DELETE` returns `{"ok":true,"withdrawn":null}` and
   writes **no** audit act (`route.ts:174-177`: *"an append-only ledger must carry things that
   happened, not requests that were made"*).

**Ceiling:** withdrawal is attributable only because `resolveViewerLogin()` resolves under the bypass;
on a real deployment the 403 path (`route.ts:166-169`) is untested here. And the withdrawal is not
undoable — re-deciding writes a fresh decision, so the ledger reads decided → withdrawn → decided
rather than restored.

### 3. Governance — the escalation counts from the stored policy, and it was restored

`MC-B36`/`MC-B37` needed an org with (a) failing repos and (b) a declared bar. Org `kiro` has neither —
its card short-circuits to *"No repos fail the gate. 🎉"*. Org `public` has 33 failing repos, so the
test ran there under **pass-1 restore discipline**: found state `{"policy":null}` recorded first,
restored last.

**Found state** (`shots/recert3-B36-public-before.text.txt:124-132`) — `MC-B37` already visible: two
earned zeros carry *"not part of this org's bar"*, and the two structural rows carry *"not judged
fleet-wide — the per-repo gate decides it"* with an em-dash where a count would go.

**With a bar declared** — `POST /api/org/gate-policy` with
`requireChecks: ["control.prepush.lint","guardrail.never-commit"]` and `forbidAiAuthorship: true`,
floors kept (`shots/recert3-B36-declared2.text.txt`):

> A required control is failing — *not judged fleet-wide — the per-repo gate decides it — **you have
> declared 2 required controls; the per-repo gate enforces them***
>
> AI authorship in a blocked repository — *not judged fleet-wide — the per-repo gate decides it — **you
> have declared this bar; the per-repo gate enforces it***

**The 2 is derived, not typed.** `unjudgedBarDeclaration` (`governanceReasons.ts:113-118`) reads
`p?.requireChecks?.length` and pluralizes off it; I declared exactly two and the row said two. This is
the strongest reading of `PRIYA-L1-02` — the lead who has just set two controls — and it is now
answered per row rather than by one all-clear sentence.

**Restored:** `POST … {"policy":null}` → `GET` returns `{"policy":null}`. The response also listed the
five bars it dropped, so the clear is itself auditable.

**A first attempt is worth recording as evidence, not embarrassment:** posting
`requireChecks: ["ci/build","ci/test"]` returned `{"ok":true, "dropped":[]}` with `requireChecks`
**silently absent** from the echoed policy. Raised as `RC3-N3`.

A note on the intermediate state, because it is a real hazard for the next pass: posting a policy that
carried *only* `requireChecks` + `forbidAiAuthorship` **replaced** the default floors, and the whole
card collapsed to *"Every scanned repo clears the gate."* — 33 failing repos vanished from the screen
because the bar, not the fleet, had changed. The policy POST is a whole-object replace, not a merge.

### 4. What the rest of the pass measured

**`MC-B28` — the queue-depth line** renders one org-wide sentence above the Repositories table:
*"Scan queue: nothing waiting — every scheduled rescan and probe has been picked up."*
(`shots/recert3-B28-queue.text.txt:41`). This is the **read-succeeded-and-empty** branch, which the
component keeps distinct from *"Scan queue depth is unavailable — this deployment's job queue could not
be read."* — precisely the aggregate-honesty rule the row cited. Victor's own scenario (a 400-deep
queue) is still unseen.

**`MC-B18` — the register's rubric chips.** `SCORING_RUBRIC_VERSION` is now **r15**
(`model.ts:180`), so for the first time this host is *not* single-rubric and `TOMAS-L1-11`'s
`uncertain` could be discharged: every row carries `RUBRIC R8` (or `RUBRIC UNKNOWN`), and the page
states *"Mixed rubrics on this page. 25 of these 25 rows were scored under an earlier rubric than the
current r15…"* (`recert3-B18-leaderboard.text.txt:357`). Every row on the register is stale, and the
register now says so.

**`MC-B35` — one unit for the blend weight**, verified on one page, one scan:
- chip: *"integrity · widened D2, D6 · **blend weight 57% of 60%**"* (`recert3-B35-blend.text.txt:23`)
- track, all nine dimensions: *"**Blend weight 57%**: after weighting, the model can move this score at
  most ±…"* (`recert3-B35-dimloop.json`)

Both absolute, both from `blendWeightPercent`. The `blend 95%` share form — `RC-N1`'s complaint, a
fix-created defect of `MC-B3` — is gone from `src`, and the chip's tooltip now ends *"Each dimension's
provenance track prints this same weight."*, which is now true.

**`MC-B19` — showback.** The button exists (*"SHOWBACK CSV"*), and it was **followed**: `200`,
`content-type: text/csv`, `content-disposition: attachment;
filename="ascent-showback-kiro-2026-08-31.csv"`, and the body reconciles —
`lane,scan,…,39.599620` + `lane,local,…,241.384410` = `team,,Org-wide (no repo),166,280.984030`,
matching the page's own *"$280.98 / 166 · 100%"*. Victor's *"I would have gone to the vendor and been
told it doesn't exist"* is answered. **(b) is not:** the team panel still reads 100 % Org-wide, because
`defaultOwnerTeamForRepo` (`usage-events.ts:186-197`) needs a repo carrying a team with
`isDefaultOwner: true` and org `kiro` has none. Fix landed, symptom unchanged, fixture named.

**`MC-B20` — one real model call, spent deliberately.** Org `kiro` holds zero memories, so a
memory-check there compares nothing and never reaches the model (`comparedCount: 0`) — no meter, no
evidence. Org `public` holds memories, so the probe ran there and produced unmistakable model output
(*"Both record the same L4 to L5 promotion for prisma/prisma in August 2026, and the stored one already
carries the exact date and score change."*, similarity 0.95). `/api/usage?org=public&days=1` is
**byte-identical before and after** — the funnel still drops its non-scan inference, now keyed on
`Organization.kind` rather than the slug string. The mirror half (a tenant on the slug `public` finally
being metered) is code-verified only, and the fix's own seam became `RC3-N1`.

**`MC-B21` / `MC-B22` / `MC-B38` — the copy batch, all three live.**
- *"Two different currencies: this monthly allotment resets on the 1st (an unused month is not carried
  forward), while prepaid credits you buy on top roll over and never expire…"* — under a header reading
  `Monthly allotment · Free plan · 20 credits / mo`. Exactly the two currencies Victor conflated.
- With `NEXT_PUBLIC_SOURCE_REPO_URL` genuinely **unset** (`grep -c` on `.env.local` → 0), `/pricing`
  renders a real anchor — *"Self-hosting guide (upstream) →"* → `…/blob/HEAD/docs/SELF-HOSTING.md` —
  where pass 1 found a bare text node. The `(upstream)` label is the honest part.
- On a throwaway arm (`:3100`, `PUBLIC_SCAN_MONTHLY_LIMIT=1`, `.next-empty` deleted first per
  `RC2-M1`, anonymity asserted by a bare `Sign in`), all three surfaces pass 2 caught now read
  **singular**: *"1 free public scan / month"*, *"and 1 free public scan"*, *"The 1 free public scan
  runs on their own rolling 30-day window"*. **`RC2-M3b`'s technique paid twice** — the same pinned
  limit that proved the derivation in pass 2 proved the pluralization in pass 3.

**`MC-B26` is the one that did not land.** The half that was measured is real — `LiveTab.tsx:136-139`
loads runs unconditionally (the `selfHosted()` gate is gone), `selfHostGuard` is off `propose`, and
`CockpitSetup.tsx:53` now says *"Remote-agent runs do work here."* — but
`GET /api/org/loop/[id]/route.ts:19` **kept** its `selfHostGuard()`, and that is the route
`fetchLoopDetail` polls (`loopClient.ts:31` ← `useLoopRun.ts:83,88,157`). A cloud owner would get the
server-rendered run and outcome matrix and then a 404 on every detail poll. The tell is a comment the
fix did not update: `LiveCockpit.tsx:44` still reads *"Empty on managed cloud."* `PRIYA-L1-703` stays
**open** — and no cloud arm was needed to establish it, which is why none was built.

### 5. Metric deltas

| Metric | Pass 2 | Pass 3 | Note |
|---|---|---|---|
| Items certified | 16 | 23 | the four merged lanes |
| `resolved-verified` this pass | 11 | 9 | pass 3 is heavier in code-only items by construction |
| `fixed, not resolved` | 2 | 14 | eleven name a **fixture owed**, not a doubt about the code |
| `open` / partial | 1 | 1 | `MC-B26` — unlike pass 2's `MC-B8a`, the cause is located exactly |
| `regressed` | 0 | 0 | — |
| Fix-created defects found | 3 (`RC2-N2/N5/N6`) | 2 (`RC3-N1`, `RC3-N2`) | still this campaign's signature class |
| Live model calls spent | 2 scans | 1 memory-check (+1 accidental scan) | see residue #4 |
| Whole-file resolution mix | — | 43 `resolved-verified` · 21 `fixed` · 11 `open` · 1 `by-design` · 10 `strength` | 86 rows, unchanged count |

**The shape of this pass is worth naming.** Passes 1 and 2 were dominated by *"the mechanism landed,
the symptom is unchanged"*. Pass 3 is dominated by *"the mechanism landed and the fixture to see it
does not exist on this host"* — eleven of the fourteen `fixed` rows name a concrete missing fixture (a
cron secret, a CODEOWNERS default-owner team, an unknown lane string, a multi-model price list, a cloud
deployment, a GitHub App installation). That is a **different and healthier failure mode**, but it is
also a standing bill: this host can no longer certify roughly half of what the campaign builds.

### 6. New findings for the next drain

#### RC3-N1 — the funnel org is excluded by a column nothing sets *(major · trust · Victor)*

`MC-B20` correctly stopped reading an org's slug for meaning, and moved the anonymous-funnel exclusion
to `getUsageLedgerOrg` (`usage-events.ts:165-171`), which drops when `org.kind === "public"`
(`UNMETERED_ORG_KIND`, `:199-201`). **Nothing in the committed schema or seed ever writes that value:**
`prisma/schema.prisma:40` declares `kind String @default("org")` and `prisma/init.sql:2454-2456` inserts
the funnel org with only `(id, slug, name, plan)`. On a stock deployment the shared anonymous funnel org
is therefore `kind: "org"` and its non-scan inference — athena, memory, briefing — is now **ledgered
against it**, the exact inverse of the row's intent. This host happens to carry `kind: "public"` (proved
live: a real claude-cli memory-check on org `public` produced zero ledger rows), which is precisely why
it would not be caught here. A fix that relocates a sentinel must ship the backfill that populates it.
**Suggested:** stamp `kind='public'` in `init.sql` **and** backfill existing rows, or key the exclusion
off the same constant the funnel org is created with. `build`, small. **Fix-created defect of `MC-B20`.**

#### RC3-N2 — two definitions of "the funnel" in one feature *(minor · trust · Victor)*

`MC-B31(c)` made the `/usage` footer conditional, and chose its condition as
`usage.org.toLowerCase() === PUBLIC_ORG` (`usageDashboard.tsx:34`) — the **slug-string sentinel that
`MC-B20` removed from the meter one lane over, in the same batch**. So the meter and the page that
displays it now disagree about what the funnel is: an org kinded `public` on a different slug meters but
reads the private footer; an org slugged `public` but kinded `org` is metered *and* reads the funnel
footer telling it attribution has not activated. Both fixes are individually right and were built in the
same merge. **Suggested:** one predicate, exported once, consumed by both. `build`, trivial.

#### RC3-N3 — a rejected gate-policy field vanishes without a word *(minor · trust · Priya)*

`POST /api/org/gate-policy` with `requireChecks: ["ci/build","ci/test"]` answers
`{"ok":true, "dropped":[]}` and the echoed policy simply **has no `requireChecks`**.
`sanitizeGatePolicy` rejects ids that are not dotted slugs, and the route's `dropped` channel is computed
by `diffGatePolicy(previous, next)` — a diff of *stored* states — so a value the sanitizer threw away was
never in either state and cannot appear there. The route already believes a silently wiped
`requireChecks` is unacceptable (its own comment at `route.ts:227`: *"discoverable only by diffing two
JSON blobs nobody diffs"*); it defends against the wipe and not against the reject. An operator typing a
plausible check id gets `ok: true` and no bar. **Suggested:** have `sanitizeGatePolicy` return its
rejections and surface them in a `rejected[]` beside `dropped[]`. `build`, small.

#### RC3-N4 — a public report resolves to an org that does not exist *(major · broken-flow · Tomáš/Sam)*

`readableOrgForOwner(owner)` (`auth.ts:390-395`) returns the **owner login** whenever
`canReadOrg(owner)` is true, falling back to `public` otherwise. Under `ASCENT_OPEN_ORG_DASHBOARDS=1`,
`canReadOrg` returns true for *every* slug (`authz.ts:216` — verified live:
`/api/org/gate-policy?org=notarealorg-xyz` → `200`), so `/report/n8n-io/n8n` resolves org `n8n-io`, finds
nothing, and renders the **cold-scan gate** ("No report yet for n8n-io/n8n") for a repo the register ranks
at **#1 with a full score row** — and `/report?repo=…` starts a *fresh live scan* of it. `?org=public`
fixes the report page; `/report/compare` has no such override (`page.tsx:82`) and dead-ends
unconditionally. **This is primarily an ARM ARTIFACT** and the honest bound on `SAM-L1-13`'s destination
check. But it is also a real product question the drain should rule on: the register emits permalinks with
no `?org=`, and any viewer for whom `canReadOrg(owner)` is legitimately true — a real member of an org
whose repos were scored under `public` — lands on the same dead end. **Suggested:** `concept-doc` on the
resolution rule (fall back to `public` when the resolved org has no scan for the repo), plus `build` for
the `?org=` passthrough on `/report/compare`. Rank by convergence, not severity: it invalidated a check
in this pass and will invalidate the same check in the next.

#### RC3-N5 — the singular allowance keeps a plural pronoun *(polish · clarity · Tomáš)*

With `PUBLIC_SCAN_MONTHLY_LIMIT=1`, `MC-B38`'s three surfaces now read singular, but the footnote still
says *"The 1 free public scan runs on **their own** rolling 30-day window"*
(`shots/recert3-B38-pricing.text.txt:435`). The noun and verb were switched; the possessive was not.
Residue of a fix that was itself residue of a fix. **Suggested:** `build`, trivial — drive `its own` /
`their own` off the same plural flag the label already carries.

#### RC3-M1 — methodology: `ASCENT_OPEN_ORG_DASHBOARDS=1` silently breaks every public report URL *(method)*

The shared `:3000` arm cannot drive a public repo's report by its natural URL — see `RC3-N4`. **Standing
rule for `env.md` §Arm construction:** on the shared server, every `/report/<owner>/<repo>` and
`/report?repo=` URL for a repo the viewer does not own **must** carry `?org=public`, and
`/report/compare` for a public repo **cannot be driven there at all** (no override exists) — it resolves
`uncertain`, never `refuted`. The tell is a cold-scan gate on a repo the register ranks; the fast probe is
`GET /api/gate/<owner>/<repo>`, which is not org-scoped and answers from the stored scan (used here to
prove the rows existed while the report denied them).

#### RC3-M2 — methodology: a shared checkout can break the app mid-pass *(method)*

At 16:36:17 a parallel session's half-finished rename left the running dev server serving a Turbopack
compile error for two minutes. `never-reset-hard-shared-tree` covers the *git* hazards; this is the
runtime one. **Standing rule:** re-assert `/api/health`'s Ascent shape **immediately before** any capture
whose verdict you intend to record, not only at Step 0 — and when it fails, poll rather than conclude. A
capture taken during that window would have read as a total product failure. Record
`git status --short -- src/` at the end of a pass, so the reader knows which files were dirty under the
evidence.

#### RC3-M3 — methodology: `SHOT_PREFIX` works, and Git Bash eats leading slashes *(method)*

`RC2-M2`'s fix is real: `drive-armA-dimloop.mjs:8` and the other reusable drivers now take `SHOT_PREFIX`
(env) or a positional stem, and this pass reused them as `recert3-*` **without destroying a single prior
shot** — the first pass of the three to leave the run directory intact. Two live traps for the next
driver: `drive-armA-dimloop.mjs:3` defaults `BASE_URL` to `:3100`, so it must be passed explicitly when
driving the shared server; and Git Bash rewrites a bare `"/leaderboard"` argument into
`C:/Program Files/Git/leaderboard`, so prefix every driver invocation with `MSYS_NO_PATHCONV=1` or give
the path a query string.

### 7. Residue — everything this pass wrote

| # | What | Where | Reverted? |
|---|---|---|---|
| 1 | Killed PID 44724 (`:3000`, pre-commit-range) and restarted `npm run dev` as **PID 8968** at 16:16:15 | host | n/a — **`:3000` is left RUNNING and healthy** |
| 2 | **Withdrew** pass 2's admission row on org `public` (`sindresorhus/slugify`) via the new `DELETE` | `.pglite/ascent` | **Yes — this is a NET CLEANUP.** Pass-2 residue #6 is gone; admission state on org `public` is sparse again |
| 3 | `OrgAudit` row `org.admission_withdrawn` from #2, plus a second idempotent `DELETE` that wrote **nothing** | `OrgAudit` | **No** — append-only by design, and the act is the point. Dated 2026-08-31, org `public`, actor `developer` |
| 4 | **Accidental live scan of `n8n-io/n8n`** — `/report?repo=n8n-io%2Fn8n` triggers a fresh scan when the report resolves to a non-existent org (`RC3-N4`); the browser closed but the server-side scan landed a row (visible as `lane scan, calls 1` on org `public`'s 1-day usage) | `.pglite/ascent` | **No.** One extra public-repo scan row on a large repo — the cost of learning `RC3-N4` |
| 5 | **Three `gate-policy` writes on org `public`** (an invalid-checks probe, a bar-only policy, then floors + 2 required controls) and a **fourth clearing it** | `.pglite/ascent` | **Yes — restored to found state.** `GET /api/org/gate-policy?org=public` returns `{"policy":null}`, identical to the found state recorded before the first write |
| 6 | `OrgAudit` rows from #5 (four gate-policy writes) | `OrgAudit` | **No** — append-only. Same date/org/actor signature as #3 |
| 7 | **One real `claude-cli` memory-check on org `public`** (namespace `prisma/prisma`) — the `MC-B20` proof. Returned `duplicate`, wrote **no memory** and **no UsageEvent** | — | n/a — nothing persisted; that absence *is* the evidence |
| 8 | One `claude-cli` memory-check on org `kiro` that never reached the model (`comparedCount: 0`) | — | n/a |
| 9 | Anonymous arm on `:3100`: `ASCENT_EMPTY=1`, `PGLITE_DATA_DIR=.pglite/uat-recert3`, `ASCENT_SELF_HOSTED=0`, `ASCENT_AUTH_BYPASS=`/`PUBLIC_SCAN_QUOTA_DISABLED=`/`ASCENT_OPEN_ORG_DASHBOARDS=` empty, `PUBLIC_SCAN_MONTHLY_LIMIT=1`; `.next-empty` deleted first per `RC2-M1` | host | **`:3100` was STOPPED at the end of the pass.** `.pglite/uat-recert3` is left on disk and can be deleted freely; `.pglite/ascent` was never opened by it |
| 10 | New shots, **all** prefixed `recert3-*` (gitignored). **No prior shot was overwritten** — `SHOT_PREFIX` was passed to every reused driver (`RC2-M2` closed in practice) | run dir | kept as evidence |
| 11 | `findings.json` — **25 rows** patched in place (`resolution`, `ceiling`, `recertify_evidence`, `recertify_commit_range`); passes 1–2 stamps preserved and appended to, never overwritten. Re-parsed after the write: **86 rows, unchanged count** | run dir | intentional |
| 12 | This section | run dir | intentional |
| 13 | **Not this pass:** loop run `a9cf047e` (started 14:16 by a parallel session sharing this checkout) was in flight throughout — read, never started, never stopped. That session also left eleven `src/lib/local/**` and `src/lib/db/loop-*` files dirty and broke compilation for ~2 min at 16:36 (`RC3-M2`) | — | n/a — not this pass's to revert |

**Nothing was committed.** The working tree carries the `findings.json` edit and this file for review —
alongside a parallel session's unrelated uncommitted work, which must not be swept into any commit
(`never-reset-hard-shared-tree`: use pathspec commits).
