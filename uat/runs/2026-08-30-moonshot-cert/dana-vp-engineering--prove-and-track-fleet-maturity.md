# Dana (VP Engineering) × `prove-and-track-fleet-maturity` — **L1 (theoretical, code-grounded)**

- **Run:** `2026-08-30-moonshot-cert` · pair #1 · Phase L1 · no browser
- **Character:** `uat/characters/dana-vp-engineering.md` (scored criteria at `:47-54`)
- **Journey:** `uat/journeys/prove-and-track-fleet-maturity.md`
- **Tree:** master `fca0c742` + working tree, waves 1–4 of the moonshot programme landed
- **Environment modelled:** `ASCENT_AUTH_BYPASS=1`, `ASCENT_OPEN_ORG_DASHBOARDS=1`, PGlite live,
  `LLM_PROVIDER=claude-cli`, `BRIEFING_NARRATIVE` **unset**, `ANTHROPIC_API_KEY` **unset**,
  managed-cloud shape (no `ASCENT_AUTOPILOT`, no loop lanes), populated `/org/<slug>` fixture.
- **Grounding denominator:** `uat/env.md` §Grounding, verbatim. No denominator invented; one **named
  addition** recorded (see §3).

---

## 0. Sources — the surface model was built by following import chains, not by grepping names

**Assembly + the four renderers of one object**
- `src/lib/org/briefing.ts:262-436` — `buildExecBriefing`, twelve parallel reads incl. the new
  `getImprovementEvents` (`:310-313`); `:377` forecast headline; `:382-383` confidence suppression;
  `:433` `loopProof`
- `src/lib/org/briefing.ts:446-455` `buildLoopProof` · `:465-477` `briefingLoopProofLine` ·
  `:65-119` `valueRealizedLine` / `valueRealizedHeading` / `benchmarkCaption` / `movementLine` ·
  `:507-520` `nextMoveLine` · `:527-631` `briefingMarkdown`
- `src/features/bought/executive/ExecutiveTab.tsx:48-193` — the on-screen Briefing tab
- `src/features/bought/executive/ExecutiveTrajectoryCard.tsx:9-28` — the screen trajectory
- `src/features/bought/executive/BriefingProofBanner.tsx:16-23` — the proof banner (#26)
- `src/lib/pdf/briefing-document.tsx:86-272` — the board PDF (`:124-129` trajectory, `:162-164` loop proof)
- `src/app/share/briefing/[token]/page.tsx:232` — the anonymous board link

**Forecast math + the moonshot #32 additions**
- `src/lib/maturity/forecast.ts:18-25` `SeriesPoint.compacted` · `:43-75` `Forecast` ·
  `:127-196` `forecastTrajectory` (`:143-144` compacted day-keys, `:180` `compactedPoints`,
  `:192` `lowData`) · `:349-367` `MIN_FORECAST_POINTS` / `MIN_FORECAST_SPAN_DAYS` /
  `forecastInsufficiency` / `isProjectable` · **`:384-389` `forecastBasis`** · `:392-405` `forecastHeadline`
- `src/lib/db/org-rollup.ts:592-608` — where `rollup.forecast` is actually produced
- `src/lib/db/scan-digest.ts:167-179` `CompactedPoint` · `:512-529` `readDigestTail` ·
  **`:566-631` `CompactionCoverage` + `getCompactionCoverage`**
- `src/app/trends/TrajectoryPanel.tsx:17-41` and `src/lib/db/org-delivery-trend.ts:33,354` — the two
  surfaces that DO consult the shared gate
- `src/features/standing/overview/Trajectory.tsx:26-105` — the one renderer carrying a low-data caveat

**Improvement union (#26)**
- `src/lib/db/improvement-events.ts:34-56` `ImprovementEvent` · `:104-167` `foldImprovementEvents`
  (dedupe at `:115,138-140`) · `:176-185` `inReviewPoints` / `inReviewLanes` · `:204-265`
  `getImprovementEvents` · `:281-317` `recordLoopPr`
- `src/lib/db/org-impact.ts:32-33,183-184` · `src/lib/db/org-program.ts:261` ·
  `src/features/bought/executive/ImpactLedger.tsx:103-104`

**Digest (#1)**
- `src/app/api/cron/digest/route.ts:157-222` — the control read (`:165`), the fail rows (`:167-174`),
  the signal gate (`:185-192`), **`:215`** the `controlsFailed` handoff, `:217` the trajectory
- `src/lib/alerts.ts:67-84` `digestHasSignal` · `:377-385` the `controlsFailed` contract ·
  `:393-456` `buildFleetDigestMessage` (`:412-441` the Controls block)
- `src/lib/db/control-observations.ts:249-266` `listObservationsSince` · `:277-281` the coverage law ·
  `:437` `controlCoverage`

**Overview + billing + access**
- `src/features/standing/overview/OverviewFleetPanel.tsx`, `OverviewLedger.tsx:55-86`,
  `OverviewFixFirst.tsx`, `fixFirst.ts:24,56-101`
- `src/app/usage/creditNotice.ts:1-90` (new) · `src/app/usage/page.tsx:141-145`
- `src/lib/org/briefing-narrative.ts:26-53,238,264-268,272-296`

---

## 1. Surface model

### 1.1 Dana's reachable surface set (computed BEFORE judging)

| Surface | Reachable for Dana on this host? | Gate |
|---|---|---|
| `/org/<slug>` Overview | ✅ | `canReadOrg` under bypass |
| `/org/<slug>?tab=executive` (Briefing) | ✅ | same |
| Board PDF `/api/org/briefing/pdf` | ✅ | same; deterministic render |
| Share link / BrandingSettings | ✅ owner-gated; branding additionally needs `planAllowsWhiteLabel` (`ExecutiveTab.tsx:95`) | the bypass seeds a real owner `Membership` |
| **Executive narrative (LLM Surface B)** | ❌ **gated off** — needs `BRIEFING_NARRATIVE=1` **and** `ANTHROPIC_API_KEY` (`briefing-narrative.ts:52-53`) | `deterministicNarrative` runs instead |
| **`loopProof` "Local loop" line (#26)** | ❌ on managed cloud — `getImprovementEvents` returns no lane rows without loop lanes (`improvement-events.ts:200-203`) | self-hosted + `ASCENT_AUTOPILOT` |
| **Weekly digest incl. Controls block (#1)** | ❌ not a UI surface — needs `CRON_SECRET`, a webhook sink, and populated `ControlObservation` rows | cron |
| `/usage`, `/pricing` | ✅ | sanity-check only, per journey §Out of scope |

Two of the four surfaces I was commissioned to certify are **structurally unreachable in Dana's own
session**. That is not a reason to skip them — the digest is the artifact she reads *instead of*
opening the app, and the loop proof is what a self-hosted deployment of hers would show the board —
but every `l2_priority` below carries the precondition explicitly.

### 1.2 The Briefing tab, in reading order (`ExecutiveTab.tsx:97-192`)

Header + **Download PDF / Share link / Copy briefing for LLM** → `BriefingTiles` (each cell deep-links
to the tab that explains it) → the value/activity callout → **`BriefingProofBanner`** (practice proof
+ **the new local-loop line**) → `ImpactLedger` → `ProgramPanel` → `ExecutiveSignalsStrip` →
**`ExecutiveTrajectoryCard`** → vs-previous-period grid → `OrgLeverageMoves` (the one move) →
dimension cards → movement → goals.

**The architecture is still the design's real strength.** One `ExecBriefing` object feeds four
renderers — screen, board PDF, anonymous share page, and the Copy-for-LLM markdown — and every
composed sentence (`valueRealizedLine`, `movementLine`, `nextMoveLine`, `briefingProofLine`,
**`briefingLoopProofLine`**) is a single exported pure function the four all call. Four surfaces
literally cannot disagree. That is exactly what makes the forecast gap below so costly: it is a
single point of failure with a fourfold blast radius, and the digest is a *fifth* consumer that
reimplements the same line (`digest/route.ts:217`) without the hedge at all.

### 1.3 The Overview

`OverviewLedger.tsx:55-86` renders: score badges + sparkline → posture composition bar → dimension
rows → repo-category rollup → repo × dimension heatmap. New since the last run: the **`Fix first`**
band (`OverviewFixFirst.tsx`), up to three triage-ordered deep links derived by `deriveFixFirst`
(`fixFirst.ts:56-101`, kinds `regression | finding | goal`). That materially improves her criterion 4
on the entry page.

**Still absent: any trajectory, ETA, or forecast on the fleet Overview.** `Trajectory.tsx` — the only
forecast renderer in the codebase that prints an explicit low-data caveat (`:88-95`,
`trend confidence · low data (n={points})`) — is imported by exactly two call sites,
`app/trends/TrajectoryPanel.tsx:17` and `components/org/PersonalOverview.tsx:9`. **Neither is a fleet
surface.** Third consecutive run.

---

## 2. Walkthrough — Dana's session

**Minute 0-2 — `/org/acme`.** Headline lands: overall + `Lx · Name`, Adoption and Rigor as two
independent badges, repos scanned, cohort-matched deltas, posture composition. Adoption vs rigor is
separated at the *model* layer, not in copy. Criterion 1's headline half and criterion 3: **pass**.
`Fix first` gives her a decision at the top of the page for the first time. No trajectory, no ETA.

**Minute 2-3 — she looks for the trajectory.** It is one adjacent click away, on the tab labelled
"Briefing" in the same nav group. She finds it — but the component she reaches is
`ExecutiveTrajectoryCard`, not the caveated `Trajectory`.

**Minute 3-8 — the Briefing tab.** The proof banner now carries two lines where it used to carry one:
the practice-rollout proof, and — on a self-hosted fleet — *"+12 verified dimension points from 3
local loop lanes — on branches, not merged · 1 loop PR merged and verified"*
(`briefing.ts:465-477`). The clause "on branches, not merged" is doing real work; a board reading a
points figure without it would believe the change had landed. The dedupe that stops a lane-that-became
-a-merged-PR being counted twice is explicit and correct (`improvement-events.ts:115,138-140`).

`OrgLeverageMoves` names the one move with an engine-true projected gain and the named affected
repos. Criterion 4: **pass**, and it is the same ranked row the PDF and the markdown print.

**Minute 8-9 — the trajectory line.** *"On track to reach L4 · Integrated in ~3 days (≈ 2026-09-02)."*
Underneath it, on a low-data fit: **nothing.** `briefing.ts:382-383` sets `forecastConfidence` to
`null` when `forecast.lowData`, and every renderer's hedge is guarded on that value being non-null
(`ExecutiveTrajectoryCard.tsx:17`, `briefing-document.tsx:127`, `briefing.ts:552-555`). The hedge is
not replaced by a caveat — it is **deleted**. The least trustworthy fit is the one that renders most
confidently.

And here is what is new and what makes this run's version of the finding sharper than the last two:
**the remedy now exists in the repository and nothing calls it.**
`forecast.ts:384-389` `forecastBasis(f)` returns *"fit over 5 scan days across 4 days, 3 of them
compacted"* — exactly the sentence her pet peeve demands — and its own docstring says
*"(Called by the executive briefing's trajectory clause — moonshot #26.)"* Grepping the whole tree:
`forecastBasis` has **six hits, five of them in `forecast.test.ts`**. Zero production callers.
Same for `getCompactionCoverage`, written *"for the briefing's 'timeline extends N months beyond
retained scans' clause (#26 / W2-G calls this)"* (`scan-digest.ts:578-580`): barrel-exported at
`db/index.ts:409`, referenced only by its own test.

**Minute 9-11 — she checks the PDF.** The DANA-L1-010/011/012 fixes all landed and landed in the
right place — in the *shared* functions, so all four renderers got them at once. "Value this period"
now becomes "Activity this period" when the fleet moved down (`briefing.ts:90-92`), and the number is
still printed in full — the fix is a heading, not a filter. The percentile tile no longer captions a
suppressed value with the corpus that was too small to produce it (`benchmarkCaption`, `:104-108`).
The four unlabelled "repositories" denominators are now three labelled ones plus a stated subset
relation (`movementLine`, `nextMoveLine`, `valueRealizedLine`'s `scannedRepos` basis). She reads this
page and does not have to reconcile it herself. **That is the single biggest improvement in this run.**

**Minute 11-13 — `/usage`.** The banner she reported twice is gone, and gone properly: `creditNotice.ts`
deletes the local predicate and asks `resolveScanCharge` — the same resolver that issues the 402.
A brand-new org with 0 credits and 0 scans is now silent, because `charge === "allowance"` returns
null (`:78`). Monotone by construction. **Resolved.**

**The push channel she'd actually live on (modelled, not reachable).** The weekly digest is the one
artifact she reads without opening the app. Its new Controls block sits **above** the movers, which
is the right call. But `alerts.ts:377-384` specifies a deliberate three-state contract —
`undefined` = say nothing, `[]` = *"we looked and none failed"*, rows = these failed — and the only
production caller collapses two of the three: `digest/route.ts:215` sends `undefined` whenever the
array is empty. The `[]` branch is unit-tested (`alerts.test.ts:630`) and **unreachable in
production**. So a week in which every control held is byte-identical to a week in which the ledger
was never populated: no Controls line at all. The module's own stated law — *"Any surface that prints
a control's state over a period must print its coverage beside it"* (`control-observations.ts:277-281`)
— is likewise not honoured: `controlCoverage` is called by `/api/org/controls` and
`ControlTimelineCard`, never by the digest. And `digest/route.ts:217` renders the same forecast
headline with no confidence and no basis in any branch.

---

## 3. Grounding score

Dana's fleet surfaces are **overwhelmingly deterministic**. Per `uat/env.md` §Grounding, the Overview,
the Briefing tiles/trajectory/leverage-moves, the board PDF, the impact ledger and the digest are
**"N/A — not an LLM surface"**. Exactly one LLM surface is in her journey.

### Surface B — Executive Briefing narrative → **14/15**

Facts payload = `briefingMarkdown(b)` cut at `## Ask` (`briefing-narrative.ts:59-62`;
`briefing.ts:624`). Enumerated against the canonical 15:

| # | Denominator item | Present | Cite |
|---|---|---|---|
| 1 | org + period + date | ✅ | `briefing.ts:533-534` |
| 2 | maturity/level/adoption/rigor + delta | ✅ | `:537-538` |
| 3 | coverage counts | ✅ | `:539` |
| 4 | value realized | ✅ (now sign-correctly headed) | `:540-541` |
| 5 | fleet adoption | ✅ | `:542` |
| 6 | corpus benchmark percentile | ✅ | `:543-545` |
| 7 | peer cohort | ✅ | `:546-551` |
| 8 | forecast headline **+ R²** | ⚠️ **headline yes, R² absent exactly on low data** | `:552-555` guarded on `forecastConfidence != null`, nulled at `:383` |
| 9 | engine mix / mock caveat | ✅ | `:556-559` |
| 10 | prior period + per-dim deltas | ✅ | `:560-569` |
| 11 | strengths | ✅ | `:571-572` |
| 12 | risks incl. D9 | ✅ | `:574-576` |
| 13 | movement totals + top movers | ✅ | `:577-584` |
| 14 | goals w/ pace + ETA | ✅ | `:585-591` |
| 15 | ranked next move + widest gaps | ✅ | `:609-621` |

**Score: 14/15** on the branch the finding concerns (a well-supported fit scores 15/15; the loss is
item 8's R² half, which vanishes precisely when the model is instructed at `:268` to
*"say so plainly if the data is thin"*). Denominator unchanged.

**Named additions (recorded, denominator NOT changed):**
- `+ proof block — practice rollout AND local-loop branch proof` — **PRESENT** (`briefing.ts:594-603`),
  new since the denominator was derived on 2026-08-10.
- `+ forecast basis (n, span, compaction)` — **ABSENT**. `forecastBasis` exists and is never called,
  so the narrative model cannot be told what the fit stands on even in principle.

> ⚠ **Environment precondition:** this surface is doubly gated off on the UAT host
> (`BRIEFING_NARRATIVE` and `ANTHROPIC_API_KEY` both unset). Any L2 verdict on it that cannot satisfy
> both resolves `uncertain — not reproducible on this host`, never `refuted`.

---

## 4. Findings

| ID | Type | Sev | Verdict | Recur | One line |
|---|---|---|---|---|---|
| DANA-L1-013 | trust | **major** | confirmed | — | #32's `forecastBasis` — the exact remedy for a two-run-old finding — has **zero non-test callers**; every forecast Dana reads still prints a dated ETA with no basis |
| DANA-L1-014 | trust | **major** | confirmed | — | `getCompactionCoverage` has zero non-test callers, and `org-rollup.ts:608` never sets `compacted`, so `compactedPoints` is structurally 0 on every org forecast — a post-retention fleet trajectory silently re-fits over a truncated history |
| DANA-L1-001 | trust | **major** | confirmed | **3** | On `lowData` the briefing path still *deletes* the hedge rather than replacing it — the least trustworthy fit renders most confidently, on the board PDF |
| DANA-L1-002 | trust | **major** | confirmed | **2** | `isProjectable` / `forecastInsufficiency` still never consulted on the briefing OR digest path; a 4-day sample still prints "trend confidence 99%" |
| DANA-L1-015 | confusion | minor | confirmed | — | The digest's "Controls: none failed this week" branch is unreachable from its only production caller, and no `controlCoverage` N travels with the block |
| DANA-L1-004 | missing-feature | minor | confirmed | **2** | No trajectory/ETA on the fleet Overview; the one caveated `Trajectory` renderer is still wired only to `/trends` + the personal workspace |
| DANA-L1-005 | trust | **major** | confirmed | **2** | The narrative still raw-`fetch`es `api.anthropic.com` outside `src/lib/llm/` — covered by neither BYOM nor the Bedrock boundary claim (now knowingly deferred as BACKLOG C3) |
| DANA-L1-009 | quality-gap | minor | confirmed | **2** | The prompt orders the model to flag thin data; the payload has already deleted the only signal that it is |
| DANA-L1-016 | trust | polish | confirmed | — | **STRENGTH** — the #26 loop proof is wired to all four renderers from one function, with an honest "on branches, not merged" clause and null-is-absence |
| DANA-L1-017 | trust | polish | confirmed | — | **STRENGTH** — the DANA-L1-010/011/012 reconciliation fixes landed in the *shared* functions, so all four renderers got them at once |

### Resolved-verified candidates (for L2 to confirm — **not** findings)

| Prior ID | Fix | Cite |
|---|---|---|
| DANA-L1-003 | The `/usage` banner now asks `resolveScanCharge`, the resolver that issues the 402. `allowance` → silence. Monotone by construction. | `src/app/usage/creditNotice.ts:58-89` |
| DANA-L1-010 | A negative `pointsMoved` is now headed "Activity this period"; the number is still printed in full (G1: never quieter, only correctly labelled). | `briefing.ts:90-92`; `briefing-document.tsx:144-148` |
| DANA-L1-011 | A suppressed percentile now says *why* ("not enough peers to rank") instead of quoting the corpus that was too small. | `briefing.ts:104-108`; `briefing-document.tsx:113-118` |
| DANA-L1-012 | Every "repositories" figure now states its scope: `valueRealizedLine(…, scannedRepos)`, `movementLine(…, scannedRepos)` ("of N scanned"), `nextMoveLine(…, scannedRepos)`. | `briefing.ts:65-75,115-119,507-520` |

### Detail on the two new majors

**DANA-L1-013.** Expected: her stated pet peeve is *"Forecasts/ETAs with no basis — 'you'll reach L4
in Q3' based on what?"*, and criterion 5 requires the ETA to show its basis. Got: `forecastBasis`
(`forecast.ts:384-389`) composes precisely that sentence, is pure, is unit-tested three ways
(`forecast.test.ts:329-346`), documents itself as being called by the briefing — and
`grep -rn forecastBasis src/` returns only `forecast.ts` and `forecast.test.ts`. `ExecBriefing`
(`briefing.ts:150-246`) does not even carry the `Forecast` object, only `forecastHeadline: string|null`
and `forecastConfidence: number|null`, so **the basis is structurally unavailable to every renderer**
— screen, PDF, share page, markdown, and digest. This is the moonshot-shaped defect the brief warned
about: 30+ merged lanes, and the payload half of one lane shipped without its consumer.

**DANA-L1-014.** The compaction half of #32 has the same shape and one extra step. `SeriesPoint`
gained a `compacted?` flag (`forecast.ts:18-25`) and `forecastTrajectory` counts compacted day-keys
correctly (`:143-144,180`). But the org rollup — the sole producer of `rollup.forecast` — reads only
retained `Scan` rows and maps them `({ date, value })` with no flag (`org-rollup.ts:592-608`). So
`compactedPoints` is **always 0 on the org path by construction**, and even a wired `forecastBasis`
would never say "of them compacted" for a fleet. Meanwhile `getCompactionCoverage` — the org-level
reader written for the briefing clause, with honest-null semantics that degrade to `null` rather than
zeros (`scan-digest.ts:583-586`) — has no caller. The user-visible consequence for Dana: after
retention purges her older scans, her fleet trajectory quietly re-fits over the surviving window with
no disclosure that the history behind it was truncated, while `/trends` (a repo page,
`app/trends/page.tsx:94-120`) does the honest thing for a single repo.

---

## 5. Scored acceptance criteria (`dana-vp-engineering.md:47-54`)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Headline level + **trajectory/ETA** + posture from `/org/[slug]` in ~2 min | **PARTIAL** | Headline ✅, posture ✅, `Fix first` ✅ new; trajectory ✗ on Overview, one adjacent click away → DANA-L1-004 |
| 2 | Number **reconciles** fleet → team → dimension → cited evidence | **PASS** *(upgraded from FAIL)* | All four hops link, and the values now state their scopes on the board artifact (`movementLine`, `nextMoveLine`, `benchmarkCaption`) → DANA-L1-017 |
| 3 | **Adoption vs rigor** separated, not conflated | **PASS** | Two independent badges; `posture()` asserts each axis independently; her exact vocabulary |
| 4 | One or two **highest-leverage moves**, tied to dimensions/teams/evidence | **PASS** | `OrgLeverageMoves` + `nextMoveLine` from one ranked source, engine-true projected gain, named repos; `Fix first` now previews it on the Overview |
| 5 | Any trajectory/ETA **shows its basis** | **FAIL** | The function that composes the basis exists and is never called; the low-data hedge is deleted rather than replaced; the shared presentability gate is never consulted → DANA-L1-013 / -001 / -002 |
| 6 | **Time-saved** — board-defensible read well under an afternoon, re-pullable | **PASS** | ~15 min to headline + posture + one move + PDF; re-pullable per board cycle |
| 7 | **Senior-quality** — she'd stake a board slide on the headline and the move **as-is** | **PARTIAL** | The number, the posture split and the one move: yes, and the reconciliation work this cycle is what earned that. The **dated ETA**: no — she cannot tell from any briefing surface whether it rests on two scan days or twenty |

---

## 6. Time saved, if it all worked

Her baseline is the hand-rolled maturity assessment: **4–8 weeks** of DORA pulls, repo sampling,
staff interviews and deck assembly (Jellyfish loop), stale on delivery and not repeatable.

- **First defensible read:** ~15 minutes of reading + ~10 minutes of drilling to evidence ≈ **25
  minutes** against ~160–240 hours of assessment effort → **≈ 150–235 hours saved on cycle one.**
- **Each subsequent board cycle:** a re-pull plus a PDF export, ~20 minutes, versus a partial rebuild
  she costs at 1–2 weeks → **≈ 35–75 hours saved per quarter.**
- **What still leaks:** she hand-verifies the scan-day count and span before quoting any ETA (there is
  no in-product way to do it), and on a self-hosted fleet she cannot tell a clean controls week from a
  silent ledger. Call it **2–4 hours per cycle of manual verification**, plus the compounding cost
  that the one line she can't verify is the one a board member asks about.

Net: the time-saved bar is **cleared decisively**, and by more than it was last run. The leak is not
in the read; it is in the *forward* — the artifact meant to remove her from the loop still needs her
in it for one line.

---

## 7. Verdict

### **`L1-conditional`**

Completion ✅ · Effort ✅ · Clarity ✅ · **Trust ⚠️** · Missing pieces ⚠️ · Time-saved ✅ ·
Senior-quality ⚠️.

Conditional on DANA-L1-013 — because it is the rare case where the fix is already written, tested,
and sitting one function call away from the surface that needs it.

---

## 8. Character feedback — Dana, in her own voice

> Start with what changed, because a lot of it changed and I don't want that buried under the
> complaint.
>
> Last quarter I told you the board PDF gave me four numbers where I needed one, and that I'd retype
> the slide myself rather than export it. I just read the export again. "Six of six repositories
> scanned." "3 of 6 repos with a comparable prior scan moved (of 6 scanned)." "Shared by 2 of the 6
> scanned repositories." Every count says what it is counting now. The percentile tile stopped
> advertising a corpus of one and says "not enough peers to rank," which is an honest sentence and
> costs you nothing. And the period where the fleet went *down* six points is headed "Activity this
> period," not "Value" — you kept the bad number and fixed the word above it. That is the right fix.
> A tool that goes quiet about its own bad news is worse than one that mislabels it.
>
> The usage page no longer tells me I'm cut off and comfortably within my allowance on the same
> screen. I reported that twice. It's fixed at the root — the banner now asks the same thing that
> issues the refusal — which is the version I'd have insisted on if you'd asked me.
>
> So. The one I'm still holding.
>
> The trajectory line says "On track to reach L4 in ~3 days." I have asked, three runs running, on
> what basis. This time I went looking and found something that genuinely annoyed me, in the good way
> where it means somebody understood the problem. There is a function in your codebase called
> `forecastBasis`. It returns "fit over 5 scan days across 4 days, 3 of them compacted." That is my
> sentence. That is exactly, word for word, the thing I have been asking for. It has a comment saying
> it's called by the executive briefing. **Nothing calls it.** Same for the one that measures how far
> your compacted history reaches past what you've still got — written, exported, never called.
>
> I want to be precise about why that lands harder than the original gap, not softer. When a thing is
> missing, I think "they haven't got to it." When a thing is built, tested, documented as being wired,
> and isn't — I stop trusting the *inventory*. I don't know any more which of the other reassuring
> functions in there are actually running. That is the doubt, and it's the same doubt the contradicting
> usage banner used to seed, just moved somewhere I can't see it from the UI.
>
> The concrete version: I cannot tell, from any screen you show me, whether that L4 date is fitted
> over three weeks or over two scans I ran on a Tuesday. Your `/trends` page — the repo one, the one
> nobody on my exec team will ever open — refuses to project at all below three scan days and fourteen
> days of span, and says so in a full sentence. The board document, the thing with my org's name at the
> top, has never once consulted that rule. You built the honest version and pointed it at the audience
> that doesn't need it.
>
> The loop proof is new and I'll say plainly it's good. "+12 verified dimension points from 3 local
> loop lanes — on branches, not merged." That last clause is what makes it usable. Twelve points that
> aren't merged is a real thing to tell a board — it's the pipeline — and it is a *different* thing
> from twelve points that shipped, and you kept them different rather than adding them up. Somebody
> resisted an obvious temptation there. Whoever wrote the note about not folding branch work into the
> bought number understands what I'd do to them in a QBR if they had.
>
> Would I put the slide up? The maturity number, the adoption-versus-rigor split, the one recommended
> move — yes, as-is, and the split is still the thing I cannot buy anywhere else. Four to eight weeks
> of work, in two tabs, and I don't want to lose that in the grumbling.
>
> The ETA I would delete from the slide before presenting. Not because I think it's wrong. Because
> when Marcus on the audit committee asks "based on what?" — and he will, it's the only question he
> asks — the honest answer today is "I couldn't find out either."
>
> One call site. You've already done the hard part twice.
