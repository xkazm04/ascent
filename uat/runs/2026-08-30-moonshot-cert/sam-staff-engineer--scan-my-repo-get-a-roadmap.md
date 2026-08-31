# Sam (Staff Engineer) × `scan-my-repo-get-a-roadmap` — **L1 (theoretical, code-grounded)**

Run: `2026-08-30-moonshot-cert` · pair #2 · cert level **L1** · no browser, no app run.
Character: `uat/characters/sam-staff-engineer.md`. Journey: `uat/journeys/scan-my-repo-get-a-roadmap.md`.
Tree walked: `HEAD == master == fca0c742`, working tree clean (`git status --porcelain` → only this
run directory). Grounding denominator: `uat/env.md` §Grounding, Surface A — **used verbatim,
unmodified** (and flagged below as now stale, without changing it).

---

## sources:

Surface model built by following the real import chain from each affordance. Every path relative to
`C:\Users\kazda\kiro\ascent`.

**Entry / scan (unchanged from the 2026-08-10 walk, re-verified)**
- `src/app/page.tsx` → `IndexHero.tsx:96` → `ScanModal.tsx:39,47,62,70` — the scan input is a modal;
  `?scan=1` deep-links it; hosts `ScanForm`.
- `src/components/ScanForm.tsx:142` — `router.push('/report?repo=…')`. Still the terminus.
- `src/lib/scan-gates.ts:93-100` — **`scanAuthGate` now exempts the anonymous public funnel**
  (`opts.publicScan && !publicScanSignInRequired()` → PASS). B2 shipped; Sam's entry is reachable
  with no signup, as the journey seed requires.

**Scoring engine (what Sam is actually auditing)**
- `src/lib/analyze/index.ts:238-262` — **rubric r11 D1**: five instruction formats collapse into
  `GUIDANCE_DOC_POINTS = 22` + `round(18 × coherence/100)`; every penalty re-emitted as a note with
  `p.paths.join(" ↔ ")`.
- `src/lib/analyze/guidance-graph.ts:1-25,505` — the arbiter. Pure, dependency-free, itemized
  `penalties[]`, `coherence: null` (never 0) for a repo with no guidance document.
- `src/lib/analyze/index.ts:291-295` — `found()` = `idx.first(...res)` → the matched path becomes
  `Signal.detail`. This is B4's mechanism.
- `src/lib/analyze/index.ts:408-445` — the **assertion-substance detector**: −15 "Sampled tests
  assert nothing" with a `MIN_SAMPLE_FRACTION` fairness floor.
- `src/lib/scoring/claims.ts:207-212` — `CLAIM_SCORED_DIMENSIONS = ["D1","D4"]`.
- `src/lib/scoring/engine.ts:60-64` (`renderClaim` → `path: "quote"`), `:72-74` (`evidenceStrings` =
  `signals.map(formatSignal)`), `:237` (`band = widenedDims.has(id) ? ±50 : ±25`), `:185`
  (`effectiveBlend = SCORE_BLEND × coverage`), `:245-274` (claim-scored ⇒ `score = signal +
  claimPoints`; deterministic ⇒ `score = signal`; else the blend), `:416-430` (`scoreIntegrity`).
- `src/lib/types.ts:542-544` — `formatSignal(x) = detail ? "label (detail)" : label`.
- `src/lib/maturity/model.ts:98-136` — the r11 + r12 log; `SCORING_RUBRIC_VERSION = "r12"`.

**Report surfaces**
- `src/components/report/ReportHeader.tsx:136` — **`ScoreIntegrityChip` is mounted** (B6 half A).
  `:152-190` — the export row: PDF · Share card · Copy for LLM · SkillDownload · FoundationPr.
  No badge, no permalink control.
- `src/components/report/ScoreIntegrityChip.tsx:19-35` + `src/lib/maturity/attribution.ts:271-305`
  — `integrityNotes`: D9-renormalized, unmeasured dims, `audit capped`, `widened D3`, `blend 85%`.
- `src/components/report/DimensionDetail.tsx:49-60` (evidence list), `:89` + `:100-138`
  (**`ProvenanceTrack` — band from the module constant `LLM_GUARDBAND`, no dimension id in scope**).
- `src/components/report/DimensionCard.tsx:106,113-160` — a **second, byte-similar copy** of
  `ProvenanceTrack`. `grep -rn DimensionCard src` → no importer. Dead.
- `src/components/report/ReportPanels.tsx:90` — `<RecommendationTracker items={recs} report=…
  prevDimScores=… />`; `:93` — `<RoadmapSteps items={report.roadmap} report={report} />`.
  **Neither passes `lifts`.**
- `src/components/report/roadmapPieces.tsx:239-249` (`RoadmapSteps`, `lifts?` optional),
  `:274` (`<ExpectedLiftBasis item lifts />`), `:96` (`RoadmapSortToggle`).
- `src/components/report/RecommendationTracker.tsx:25,31,80-81,192-194,264` — `lifts?` optional;
  `anyMeasured` gates both the toggle and the ordering.
- `src/components/report/ExpectedLiftBasis.tsx:29-30` — `if (!clause) return null`.
- `src/components/report/ReportNotices.tsx:22-41` — `ReportDiscrepancies`: dimension + claim, no outcome.
- `src/components/report/ScoringTab.tsx:86-93` — "What changed →", gated on `scans.length >= 2`.
- `src/components/report/ReportClientStatus.tsx:37-53` — `scoreLabel` switch over `ProviderName`.

**Moonshot #9 — expectedLift**
- `src/lib/outcomes/expected-lift.ts:37-46` (`expectedLiftClause` — median + IQR + n + instrument in
  one string, `null` never `"+0"`), `:52-56` (`measuredRank`).
- `src/lib/outcomes/expected-lift-load.ts:31-36` (`getOrgExpectedLifts`, server-only, `cache()`).
- `src/components/report/roadmapPriority.tsx:54-74` (`measuredPriorityScore`, `sortRoadmap`).
- `src/app/api/recommendations/route.ts:49-64` — the **only** consumer of `getOrgExpectedLifts`.
- `src/lib/report/llm-markdown.ts:24-40` (`ReportMarkdownOptions.lifts`), `:229-230`.

**Moonshot #34 — exemplar diff**
- `src/app/report/compare/page.tsx:41-52` (**sign-in wall**), `:69-77` (DB wall), `:100-107`
  (two-scan wall), `:121-127` (`loadSubjectFacets` + `listExemplarOptions`), `:178-186`
  (`ScanComparePicker` + `ExemplarSection`).
- `src/lib/report/exemplar-load.ts:8-27` (the tenancy note), `:200-218` (`loadOrgCandidates`,
  `ORG_CANDIDATE_CAP = 500`), `:267-309` (`listExemplarOptions`).
- `src/lib/report/exemplar.ts:161-201` (`ExemplarDimensionDiff` / `ExemplarDiff`), `:234-260`
  (**`diffStringSets` over evidence — exact normalized equality**), `:375-377,390-443`
  (`buildCohortProfile`, `consensus`).
- `src/lib/report/compare.ts:169` (`norm`), `:190-198` (`diffStringSets`), `:358-373`
  (**`signalName` / `nameKey` — the count-blanking normalizer that exists to solve exactly this, and
  that `exemplar.ts` does not use**).

---

## Walkthrough — first person

I pasted a repo I know cold. Landing → modal → Scan. No signup wall this time; `scan-gates.ts:99`
lets an anonymous public scan through by default now. That's the first thing that's changed since I
last looked, and it's the right change.

**The score arrives. I go straight to Dimensions, because I don't read rings.**

D1. Evidence reads:

> `Agent guidance present (2 documents) (CLAUDE.md, AGENTS.md)`
> `Guidance coherence 88/100 (canonical: AGENTS.md (pointer))`
> `Coherence −6: CLAUDE.md and AGENTS.md give different test commands (CLAUDE.md ↔ AGENTS.md)`
> `Model cited canonical_declared (+8) — AGENTS.md: "@AGENTS.md"`

Okay. That's actually right. That's a number I can re-derive: 22 + round(18×0.88) − the itemized
deductions, each naming the two files it was read from. And the underlying rubric change is one I'd
have argued for myself — `analyze/index.ts:238-246` says out loud that four contradicting copies used
to outscore one true document. That's the "presence of a file" scoring I've been burned by, removed
on purpose, by someone who understood why it was wrong. Criterion #2 passes on D1. Whoever wrote
`guidance-graph.ts:17-21` — never subtract, withhold; `coherence: null` not 0 for "nothing to assess"
— has done this before.

D2. `Sampled tests assert nothing (7 sampled test file(s), ~41 cases, 0 substantive assertions
(counting files, not behavior))`, −15. That is my scar tissue, in a detector, with a sample-fraction
fairness floor at `:433` so it doesn't hang a whole suite on an unlucky 3-of-40 slice. Nobody else
ships this. Criterion #1 gets its hardest test here and holds.

D3. And here it stops.

> `GitHub Actions CI present` · `Multiple CI workflows (4)` · `CI runs tests` · `CI runs linting` ·
> `CI runs a build` · `Automated release tooling`

Where's this coming from? Which workflow? Is the test job required on the branch or is it advisory?
`analyze/index.ts:470-509` — every one of those is a bare `s.add(points, label)` with no third
argument. `idx.first()` exists three lines away and is used elsewhere in the same file. The B4 note
in `docs/BACKLOG.md:48` is honest about why (these fire off a concatenated `workflowText` blob, so
there is no single file to name) — but "the detector can't name a file" and "I can defend this number
upward" are different statements, and D3 is the dimension my VP asks about. Same for D5's
`Linter configured` / `Formatter configured` and all of D8. So SAM-L1-01 is half closed and I still
re-grep the CI config. → **SAM-L1-01, recurrence 2, narrowed, downgraded to minor.**

**Then the provenance track, which is the thing that decides whether I come back.**

New in the header: `integrity · widened D3 · blend 85%`, with a tooltip that says the model flagged
the detector as suspect on D3 so its guardband was **doubled**, and that only 85% of the model's usual
weight applied because the ingest read a fraction of the repo. That is exactly the disclosure I said
was missing last time, and it's good — one record, one wording, shared with the loop cockpit
(`ScoreIntegrityChip.tsx:16-17`). Half of SAM-L1-02 is genuinely closed.

Then I scroll to D3's own card and the picture underneath it draws a ±25 band with a tooltip reading
"the LLM can move the score at most ±25 from the signal" (`DimensionDetail.tsx:106-119`). The header
just told me it was ±50 on this dimension. The page now contradicts itself in two places about the
same number. Before the chip shipped this was an omission; now it's a disagreement, which is worse —
if I'd staked the number on the chip and someone pulled up the track, I'd be the one explaining it.
→ **SAM-L1-02, recurrence 2, narrowed to the track.**

And a second thing about that track, which is new since r11. D1 joined `CLAIM_SCORED_DIMENSIONS`
(`claims.ts:212`), so D1's score is `signal + claimPoints` and the model's D1 number is recorded and
**ignored** (`engine.ts:262-267`). D4 the same. D9 is deterministic. Three of nine dimensions have a
scoring mechanism the track cannot express — it still draws a guardband, still plots an "LLM
judgment" tick, and still says the LLM could have moved the score ±25, when the truthful sentence is
"the model moved this by exactly the points of the facets it cited, and here they are." For D1 that's
a particular shame, because the *evidence list* right above it is the best-sourced thing in the
product and the picture below it describes a different engine. → **SAM-L1-11 (new).**

Two copies of that component, by the way — `DimensionDetail.tsx:100` and `DimensionCard.tsx:120`, and
nothing imports `DimensionCard`. Whoever fixes the band will fix it once and think they're done.
→ **SAM-L1-STR-04.**

"Flagged for review" still lists the auditor's claims and never says what each one *did* — which one
widened a band, which one was structurally ineligible (D9 can't widen: `engine.ts:76-79`), which one
lost to the budget. The header chip now says "widened D3" globally, so a determined reader can join
them by hand. → **SAM-L1-06, recurrence 2, narrowed.**

**The roadmap. This is where the run turns.**

The items are still repo-specific and still good, and still written as observations with the concrete
move buried in the rationale — the prompt mandates it at `prompt.ts:227-232` ("NOT an imperative").
I still extract my own ticket. → **SAM-L1-05, recurrence 2.** B14 is the right shape and is open.

What I didn't get is the thing this release was supposed to add. `ExpectedLiftBasis` exists. It's
lovely: `expected-lift.ts:5-13` refuses to export a bare median so a number can never appear without
its `n` and its instrument, and returns `null` rather than `"+0"` because a zero is a measurement and
absence isn't. `sortRoadmap` can order by measured evidence. `RoadmapSortToggle` exists.

`grep -rn "lifts" src/components/report/ReportPanels.tsx` → nothing. Both mount points
(`ReportPanels.tsx:90` and `:93`) call the components without the prop; the prop is optional; so
`lifts` is `undefined`, `anyMeasured` is `false` (`RecommendationTracker.tsx:80`), the toggle never
renders (`:192`), `ExpectedLiftBasis` returns `null` on every row (`ExpectedLiftBasis.tsx:30`), and
`sortRoadmap` always runs `"priority"`. The single caller of `getOrgExpectedLifts` in the whole
codebase is `api/recommendations/route.ts:49` — a JSON endpoint. `ReportView.tsx:143` fetches that
endpoint **without `&sort=measured`** and reads only `.status` off the rows; `expectedLift` isn't even
on `PersistedRecommendation` (`grep expectedLift src/lib/types.ts` → 0), so the field the route
attaches is dropped by the type it's attached to. `reportLlmMarkdown(report)` is called with no
options at `ReportHeader.tsx:177` and `api/report/llm/route.ts:66`, so the `_measured:_` line never
reaches the clipboard either. Zero rendered surfaces. The whole item is present and unwired.
→ **SAM-L1-09 (new), major.**

**The exemplar diff — the other half of what I was told shipped.**

I can't reach it. `/report/compare` walls on sign-in (`page.tsx:41-52`), then on `DATABASE_URL`
(`:69`), then on two stored scans (`:100`). I'm an anonymous first-time scanner: three walls. And
nothing on the report points at it — `ScoringTab.tsx:86` offers "What changed →" only at
`scans.length >= 2`, and it's a time-vs-time label that never mentions an exemplar; the `?against=`
control is an unlabeled-in-the-CTA `<select>` at the bottom of the picker on the far side of all
three walls. → **SAM-L1-13 (new), minor.**

Reading it anyway, because the brief asked me to: the panel itself is well made — `ExemplarPanel.tsx`
gives every failure state its own sentence and never substitutes a different exemplar, the cohort has
two floors including a distinct-orgs floor, and `exemplar-load.ts:8-27` writes the tenancy argument
out in full. But the diff is computed wrong for the evidence strings that exist today.
`diffAcrossRepos` (`exemplar.ts:234-241`) derives "the exemplar has this and you don't" by
`diffStringSets`, which is exact equality after lowercase-and-collapse-whitespace (`compare.ts:169`).
Since B4 landed on 2026-08-28 those evidence strings carry repo-specific tails:
`Test framework configured (vitest.config.ts)` on my side, `Test framework configured (jest.config.js)`
on theirs. Not equal. So the panel tells me to transfer a test framework I already have. Every
count-bearing line (`Found 138 test files`, `Substantial README (4213 chars, 12 sections)`,
`High test-to-source ratio (0.52)`) is unequal on both sides by construction, so it lands in *both*
`absentSignals` and `aheadSignals`; `absentSignalCount` and `aheadSignalCount` are inflated, and
`nothingToTransfer` can essentially never be true. And every D1/D4 claim line
(`Model cited canonical_declared (+8) — AGENTS.md: "…"`) is unique to one repo, so a strong exemplar's
best evidence shows up as a to-do list of another repo's file quotes. In cohort mode the same equality
runs through `consensus(evidenceLists, minSupport)` (`exemplar.ts:406-411,445-454`), so the strongest
shared practices fragment below support and drop out of the profile entirely. The fix already exists
in the neighbouring module — `signalName` / `nameKey` at `compare.ts:358-373`, written precisely to
make "found 18 test files" and "found 6 test files" one signal — and `exemplar.ts` doesn't import it.
→ **SAM-L1-10 (new), major.**

One more thing on that page: for a viewer whose owner org isn't readable, `readableOrgForOwner`
resolves to the shared public org, and `listExemplarOptions` then runs `loadOrgCandidates(publicOrgId)`
— up to **500** repos from the whole public corpus, rendered in an `<optgroup label="Your repos">`,
with an `org:best` option labelled "Org best" that actually means "best in the public corpus".
→ folded into **SAM-L1-13**.

**The badge.** Gone — `/badge`, `/api/badge/[owner]/[repo]`, `/api/scorecard/[owner]/badge`, all
removed in `773c9aa0` (2026-08-29), the journey retired, `docs/BACKLOG.md:48` closes SAM-L1-03 as
no-longer-applicable. Fine: that's a decision, and SAM-L1-03 is a resolved-verified candidate, not a
finding. What I'll still say is that my third job-to-be-done — "hand me a badge and a level I'd stake
my name on in the README" — now has no answer anywhere in the product. Not a broken feature; an
unserved job, and the character file and scored criterion #6 both still assume it exists.
→ **SAM-L1-12 (new), minor, for explicit triage.**

**Leaving.** My address bar still reads `/report?repo=…`. `reportPermalink` has 25+ call sites across
trends, launch, live, developer, followups — and still exactly one in the scan path, the notify email
at `api/scan/stream/route.ts:348`. Third run, same gap. → **SAM-L1-04, recurrence 3.**

And the progress copy: `scoreLabel` (`ReportClientStatus.tsx:38-53`) covers gemini, claude-cli,
codex-cli, bedrock, mock — five of the **eight** members of `ProviderName` (`types.ts:12-20`).
`openai`, `openrouter` and `local` fall to the generic string. `local` is the self-hosted path this
product now ships, and it's the slowest one. Worse than last run (was 4-of-6). → **SAM-L1-08,
recurrence 2, widened.**

---

## Reachable surface set (computed before judging)

Sam is anonymous, no plan, on the public funnel. Reachable: `/`, `ScanModal`, `POST /api/scan/stream`
(auth gate exempt, `scan-gates.ts:99`), `/report?repo=…` and every tab in `ReportPanels`, the header
export row (PDF is plan-gated at click; LLM/skill exports need `isDbConfigured()`). **Not reachable:**
`/report/compare` (sign-in + DB + ≥2 scans), every `/org/*` surface (so the guidance-coherence fleet
card at `features/standing/repositories/context-health/GuidanceCoherenceCard.tsx` — the *only* place
the arbiter's full verdict is rendered — is out), `/trends` (out of journey scope), any measured-lift
surface (would need a tenant ledger with ≥3 samples, `aggregate.ts:39`), the badge (removed).

---

## Grounding score — Surface A (repo scan scoring + its roadmap field)

`TECH_STACK_PROMPT` is unset in `.env.local` (`scan-score-input.ts:191`; `llm/config.ts`), so source
#7 is out and the denominator is **11**, per the overlay's own rule.

**Score: 10/11 wired · 9/11 effective on Sam's anonymous path.** Unchanged in count from 2026-08-10;
materially improved in *quality* on source #8.

| # | Source (env.md §Grounding, verbatim) | State | Evidence |
|---|---|---|---|
| 1 | Rubric — 5 levels + 9 weighted dimensions + criteria | present | `prompt.ts:85-94` |
| 2 | Task/output contract + auditor role | present | `prompt.ts:138-173,227-232` |
| 3 | Repo metadata | present | `prompt.ts:230-232` |
| 4 | Archetype | present | `scan-score-input.ts` archetype path |
| 5 | Standing org decisions + rationale | **wired, INERT for Sam** | `scan-score-input.ts:156-159` — gated on `decisionSlug`, unset for an anonymous scan ⇒ `orgDecisions = []`. Counts 0. |
| 6 | Stack-fit caveat | present | `provider.ts:71-75`; null for a web/TS repo = wired-and-inapplicable |
| 7 | Detected tech stack | **EXCLUDED — flag off** | `scan-score-input.ts:191`; denominator → 11 |
| 8 | Deterministic per-dimension signal scores + evidence labels | **present, materially richer** | `prompt.ts:192-199,236`; the labels now carry `Signal.detail` on path-triggered signals (`analyze/index.ts:295`, `formatSignal` `types.ts:542`) and the whole r11 guidance-graph itemization (`:249-263`). D3/D8 text-triggered lines remain bare. |
| 9 | PR stats | present | `provider.ts:61-63` |
| 10 | Branch governance | present | `provider.ts:65` |
| 11 | Security D9 check battery | present | `provider.ts:67-70` |
| 12 | Untrusted repo evidence — commits + file excerpts | **present, HARD-CAPPED** | `prompt.ts:296-317` — `PER_FILE = 2200`, `OUTER = 22000` with a hard `break`; ingest budget `MAX_TOTAL_BYTES = 280_000` (`github/source.ts:59`) ⇒ **~8% of what was fetched reaches the model**. `.ai/manifest.yaml` joined the fetch list (`source.ts:793`), which makes D1's `+4` manifest award reachable for the first time — an ingestion change, not a new grounding source. |

### Named additions (recorded; denominator UNCHANGED)

- **+ craft-ladder memory (`craftBuilt`)** — **present in the type and the prompt**
  (`provider.ts:56-60`; `prompt.ts:167-176` `craftBuiltBlock`), **inert for Sam**: gated on
  `decisionSlug` at `scan-score-input.ts:166`, same as #5.
- **+ prior scans / score history** — still absent. Sam's framing is "does this read match mine";
  the model still cannot say "this got worse".
- **+ full file-tree manifest** — still absent. The model sees ~22 KB of excerpts and no map of what
  it didn't see.
- **+ CI gate advisory-vs-blocking** — still only reachable via #10 (branch protection). D3 fires
  "CI runs tests" with no way to know whether that check is required.

> **Harness note (not a product finding):** the overlay's Surface A list was derived 2026-08-10 and
> the prompt builder has changed twice since (r11's guidance block, r12's `craftBuiltBlock`, and
> `LlmScoreInput` grew to 13 fields). Per the standing rule I did **not** change the denominator.
> `/uat update` should re-derive it before the next sweep, or cross-run grounding trends will drift.

---

## Scored acceptance criteria

| # | Criterion | Verdict | Why |
|---|---|---|---|
| 1 | Level + 9 dimensions + quadrant reconcile with each other and the repo | **PASS** | The assertion-substance detector (`index.ts:426-445`) is the strongest anti-theater signal I've seen shipped, and r11 removed the file-presence inversion in D1 outright. |
| 2 | Every dimension cites concrete, re-traceable evidence via the provenance track | **PARTIAL** | D1 is exemplary (paths + coherence itemization + quoted model citations). D2 framework/e2e/coverage, D5 docs, D6, D9 cite paths. **D3 entirely, D8, and D5's linter/formatter still don't.** → SAM-L1-01 |
| 3 | LLM-vs-detector discrepancies surfaced, not hidden | **PASS (partial)** | `ReportDiscrepancies` lists them and the new integrity chip names the *global* outcome. Per-claim outcome still absent. → SAM-L1-06 |
| 4 | Roadmap names a specific, evidence-grounded, highest-leverage next move | **PASS (with friction)** | Content is repo-specific and sharp; the mandated invitational voice buries the move. → SAM-L1-05. And the measured basis that would have made it defensible is computed and never rendered. → SAM-L1-09 |
| 5 | Credible verdict in ~2–3 min vs a day's manual audit | **PASS** | See time-saved. |
| 6 | A badge / level Sam would stake his name on | **N/A — surface retired** | `/badge` and both SVG endpoints removed (`773c9aa0`). SAM-L1-03 is a resolved-verified candidate; the *job* is now unserved. → SAM-L1-12 |
| 7 | Generated artifacts are repo-specific | **PASS (not deeply exercised)** | `api/report/skill/route.ts` builds from the persisted report with a maintainer `?dims=` selection; out of this journey's depth per its Out-of-scope clause. |

---

## Time-saved

Sam's manual baseline (from the character file): the better part of a working day — clone, read the
CI config and the suite for *real* assertions, grep conventions, eyeball PR hygiene, check pinning
and supply chain, hand-write a prioritized plan. Call it **6 h** of focused work.

**If everything on this page worked: ~6 h 00 saved per repo, confidence medium.** The three things
that beat a sharp grep session outright are the guidance-coherence read (I would not have thought to
diff five instruction files against each other, and I'd never have hand-scored the contradictions),
the assertion-substance sample, and the D9 battery.

**Deduct for what doesn't work:** ~15 min re-grepping the CI config, because D3 — the dimension I get
asked about — cites nothing (SAM-L1-01, narrowed from ~30 min last run; B4 bought back half of it).
Plus a few minutes reconstructing the roadmap ticket from the rationale prose (SAM-L1-05).

**Net realized ≈ 5 h 40 min.** Up from 5 h 20 on 2026-08-10, entirely on B4 and r11.

---

## Verdict

**CONDITIONAL PASS — better than last run on the axis that decides this Character, and carrying two
new present-but-unwired defects from the moonshot merge.**

r11 is the best thing in this release for Sam: it deletes the exact failure mode his character file
names as a pet peeve ("scoring on the presence of a file"), and it makes D1 the first dimension in
the product whose number I can fully re-derive from what's on screen. The integrity chip closes the
disclosure half of SAM-L1-02. B2 opened the front door. Those are real.

Against that: **moonshot #9 has zero rendered surfaces** — a genuinely well-designed measurement
discipline (no median without its `n`, `null` never `"+0"`) that no user can see, because two mount
points don't pass an optional prop. And **moonshot #34's diff arithmetic was written against evidence
strings that a lane two days earlier had already made repo-specific**, so it will confidently tell a
reader to adopt things they already have. Both are the exact shape the brief warned about, and both
are cheap to fix — one prop-threading pass, one import of `nameKey`.

The trust picture is net-improved but internally inconsistent: the header now says "widened D3, blend
85%" while the D3 card draws ±25 and asserts the model could move it at most ±25. That contradiction
did not exist before the chip shipped, and it is the kind of thing this Character finds.

---

## Findings

```json
[
  {
    "id": "SAM-L1-09",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "moonshot #9 expectedLift reaches ZERO rendered surfaces — both roadmap mount points omit the optional `lifts` prop, so the basis clause, the measured sort and the sort toggle are dead by construction",
    "expected": "The roadmap's measured basis (`D2 +11 median (IQR +6…+15) across 37 measured closes · r10 · claude`) renders under a gap that the org has actually measured, and `?sort=measured` is reachable. This is the one claim on the shelf that beats 'recommended practice' with evidence — and it is the claim Sam's criterion #4 is written about.",
    "got": "`ReportPanels.tsx:90` renders `<RecommendationTracker items={recs} report={report} prevDimScores={…} />` and `:93` renders `<RoadmapSteps items={report.roadmap} report={report} />`. Neither passes `lifts`, which is optional on both (`RecommendationTracker.tsx:31`, `roadmapPieces.tsx:247`). Therefore `lifts === undefined` ⇒ `anyMeasured === false` (`RecommendationTracker.tsx:80`) ⇒ `RoadmapSortToggle` never renders (`:192`) ⇒ `sortRoadmap(items, undefined, \"priority\")` always ⇒ `ExpectedLiftBasis` returns null on every row (`ExpectedLiftBasis.tsx:29-30`). `getOrgExpectedLifts` has exactly ONE caller in the codebase — `api/recommendations/route.ts:49`, a JSON endpoint. `ReportView.tsx:143` fetches that endpoint WITHOUT `&sort=measured` and reads only `.status` from the rows. `expectedLift` is not a member of `PersistedRecommendation` (`grep expectedLift src/lib/types.ts` -> 0), so the field the route attaches is dropped by the type the client uses. `reportLlmMarkdown(report)` is called with NO options object at `ReportHeader.tsx:177` and `api/report/llm/route.ts:66`, so the `_measured:_` markdown line (`llm-markdown.ts:229-230`) never fires either.",
    "evidence": [
      "src/components/report/ReportPanels.tsx:90,93 — both mount points, no `lifts`",
      "src/components/report/RecommendationTracker.tsx:31,80-81,192-194,264 — optional prop; anyMeasured gates toggle + ordering + clause",
      "src/components/report/roadmapPieces.tsx:242-250,274 — same, on the anonymous path",
      "src/components/report/ExpectedLiftBasis.tsx:29-30 — `if (!clause) return null`",
      "src/lib/outcomes/expected-lift-load.ts:31 — getOrgExpectedLifts",
      "src/app/api/recommendations/route.ts:49-64 — the only caller; also the only place `sort=measured` can be honored",
      "src/components/report/ReportView.tsx:143 — the client fetch, no &sort=measured, reads only .status",
      "src/lib/report/llm-markdown.ts:24-30,229-230 — ReportMarkdownOptions.lifts, never supplied",
      "src/components/report/ReportHeader.tsx:177 / src/app/api/report/llm/route.ts:66 — reportLlmMarkdown(report) with no options",
      "reproduction: `grep -rn 'lifts' src/components/report/ReportPanels.tsx src/app/report` -> 0 hits"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "scope_note": "The pure half is excellent and should not be touched: expected-lift.ts refuses to export a bare median so a number cannot appear without its n and instrument, and returns null rather than \"+0\". The defect is purely the seam — the server report page must call getOrgExpectedLifts(orgSlug) and thread it into ReportPanels, and ReportView's fetch should carry &sort=measured once a toggle can exist. Note the client/server boundary: expected-lift-load.ts is server-only, so the read belongs on `src/app/report/[owner]/[repo]/page.tsx` beside readReportRecommendations, not inside the client tree.",
    "l2_priority": "Complete a scan on a repo in an org that HAS a measured outcome ledger (>=3 `kind:\"recommendation\"` outcome rows sharing one recommendationMatchKey and one instrument — OUTCOME_MIN_SAMPLES=3, aggregate.ts:39), open the Roadmap tab, and confirm NO 'measured' clause and NO priority/measured sort toggle renders. Then GET /api/recommendations?repo=<same>&sort=measured and confirm the JSON DOES carry expectedLift and sort:\"measured\" — proving the data exists and only the UI seam is missing. PRECONDITION: DATABASE_URL on (PGlite), a seeded outcome ledger (no seeder currently produces one — this may resolve `uncertain — not reproducible on this host` unless outcome rows are inserted by hand), any provider, signed-in org member for the ledger arm; the anonymous arm reproduces the absence trivially.",
    "reachable": true
  },
  {
    "id": "SAM-L1-10",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "low", "trust_erosion": "high" },
    "dimension": "senior-quality",
    "title": "The exemplar diff (#34) derives 'the exemplar has this and you don't' by exact string equality over evidence lines that B4 made repo-specific — so it recommends transferring things the repo already has, and the cohort profile fragments below support",
    "expected": "'What does a stronger repo have that this one doesn't' must compare CAPABILITIES, not the incidental tail of an evidence string. Sam's senior-quality bar: output he would reject in code review fails even if the flow worked.",
    "got": "`diffAcrossRepos` computes absentSignals/aheadSignals via `diffStringSets(mine.evidence, theirs.evidence)` (exemplar.ts:234-241), whose identity is `s.trim().replace(/\\s+/g,' ').toLowerCase()` (compare.ts:169,190-198) — exact equality. Since commit 89f143c2 (2026-08-28, B4) evidence strings carry `Signal.detail` via `formatSignal` = `label (detail)` (types.ts:542-544). Consequences, all by construction: (1) `Test framework configured (vitest.config.ts)` != `Test framework configured (jest.config.js)` — a repo with a test framework is told the exemplar 'has' one; (2) every count-bearing line (`Found 138 test files`, `Substantial README (4213 chars, 12 sections)`, `High test-to-source ratio (0.52)`) is unequal on both sides, so it lands in BOTH absentSignals and aheadSignals, inflating absentSignalCount/aheadSignalCount and making `nothingToTransfer` effectively unreachable; (3) D1/D4 claim lines (`Model cited canonical_declared (+8) — AGENTS.md: \"…\"`, engine.ts:60-64) are unique to one repo, so a strong exemplar's best evidence renders as a transfer list of another repo's file quotes. In cohort mode the same equality runs through `consensus(evidenceLists, minSupport)` (exemplar.ts:406-411,445-454), so path/count-bearing signals fall below support and drop out of the cohort profile entirely — weakening the aggregate exactly where it should be strongest. `transferLine` (exemplar.ts:258-261) renders the fabricated deltas verbatim, and `exemplarMarkdownSection` puts them in the Copy-for-LLM payload.",
    "evidence": [
      "src/lib/report/exemplar.ts:234-241 — `diffStringSets(mine?.evidence ?? [], theirs?.evidence ?? [])`",
      "src/lib/report/compare.ts:169,190-198 — norm + diffStringSets: exact normalized equality",
      "src/lib/types.ts:542-544 — formatSignal = `label (detail)`",
      "src/lib/analyze/index.ts:291-295 — found() puts idx.first() into detail; :361,382-383,436,443,644-645 — count-bearing details",
      "src/lib/scoring/engine.ts:60-64,284 — renderClaim strings joined into dimension.evidence",
      "src/lib/report/exemplar.ts:258-261 — transferLine renders absentSignals verbatim",
      "src/lib/report/exemplar.ts:375-377,406-411,445-454 — support()/consensus() use the same equality",
      "src/lib/report/compare.ts:358-373 — signalName + nameKey, the count-blanking normalizer written for exactly this problem, NOT imported by exemplar.ts",
      "reproduction: `grep -n 'signalName\\|nameKey' src/lib/report/exemplar.ts` -> 0 hits",
      "chronology: 89f143c2 (B4 detail) 2026-08-28 precedes e65b21bf (exemplar diff) 2026-08-30 — the lane was written against evidence that already carried details"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "scope_note": "Reachability is LOW for this Character (three walls — see SAM-L1-13) which is why frequency×reachability is not maximal; trust_erosion is high because a wrong transfer recommendation is the single output a staff engineer will forward to their team. The fix is small and local: route both sides through `nameKey`/`signalName` from compare.ts before differencing, and keep the raw string for display.",
    "l2_priority": "Seed two repos in one org with DIFFERENT test-framework config paths (e.g. one vitest.config.ts, one jest.config.js) and different test-file counts, scan both, then open /report/compare?repo=<A>&against=repo:<owner>/<B> and read the D2 transfer line. Confirm it names a framework A already has, and confirm the count-bearing lines appear under BOTH 'exemplar has' and 'you are ahead on'. PRECONDITION: DATABASE_URL on, signed-in viewer whose org owns both repos (org-scoped resolution — a PUBLIC_ORG viewer works too but see SAM-L1-13), >=2 scans on the subject repo for the page to render at all, any provider (the detector layer is provider-independent; mock is sufficient and cheaper).",
    "reachable": false
  },
  {
    "id": "SAM-L1-11",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "ProvenanceTrack draws a guardband and an 'LLM judgment' tick for D1, D4 and D9 — three of nine dimensions whose score the model cannot move that way at all, and r11 made D1 the third",
    "expected": "The provenance track is the affordance that converts this Character ('attribution and traceability built into systems'). For a claim-scored dimension the truthful picture is 'the model moved this by exactly the points of the facets it cited, and here they are'; for a deterministic one it is 'the model moved this by zero'.",
    "got": "`ProvenanceTrack(signal, llm, blended)` (DimensionDetail.tsx:100-138) takes no dimension id and has no branch. It always paints a ±LLM_GUARDBAND rect with the tooltip 'Guardband: the LLM can move the score at most ±25 from the signal' (:106-107,119) and always plots an 'LLM judgment' tick at `d.llmScore` (:127-131). But `engine.ts:262-267` computes `score = claimed ? clamp(signal + claimPoints) : deterministic ? signal : blend(...)`, and `claims.ts:212` sets `CLAIM_SCORED_DIMENSIONS = [\"D1\",\"D4\"]` while D9 is deterministic (engine.ts:76-79). For those three, `llmScore` is recorded for transparency and IGNORED — the tick is plotted at a number that had no causal role, and the band describes a mechanism that was not used. Under r11 D1 JOINED that set (model.ts:105-108), so the count went from 2/9 to 3/9 in this release, and it hit the one dimension whose evidence list is now the product's best.",
    "evidence": [
      "src/components/report/DimensionDetail.tsx:100-138 — no dimension id in the signature; unconditional band + LLM tick + tooltip",
      "src/components/report/DimensionDetail.tsx:89 — called for every dimension",
      "src/lib/scoring/engine.ts:262-267 — the three-way score branch",
      "src/lib/scoring/claims.ts:212 — CLAIM_SCORED_DIMENSIONS = [\"D1\",\"D4\"]",
      "src/lib/scoring/engine.ts:76-79 — D9 deterministic, excluded from the widening loop",
      "src/lib/maturity/model.ts:105-108 — r11: 'D1 also JOINED CLAIM_SCORED_DIMENSIONS, which removes its guardband blend entirely'",
      "src/lib/scoring/engine.ts:255-264 — the claim evidence strings that ARE the real provenance for those dimensions, rendered above the track but not by it"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "scope_note": "Distinct from SAM-L1-02: that one is the WIDTH of the band on a widened dimension and the hidden blend weight; this one is the MECHANISM being wrong for three dimensions regardless of widening. They share a component and would likely be fixed together, but they are separately declinable — and a fix to 02 alone would leave this one intact. Note also that D1/D4 being fully reproducible is a SELLING point for this Character; the track currently hides it.",
    "l2_priority": "On any completed scan, open the Dimensions tab, select D1 and then D9, and read the SVG title elements on the provenance track. Confirm both claim the ±25 guardband and plot an LLM tick, and confirm D9's blended marker sits exactly on the signal tick while the picture implies the model could have moved it. PRECONDITION: any provider (mock included — the branch is provider-independent), DB either, anonymous viewer. On mock, llmScore == signalScore for every dimension, so run at least one arm with LLM_PROVIDER=claude-cli to get a visibly displaced-but-inert LLM tick on D1/D4.",
    "reachable": true
  },
  {
    "id": "SAM-L1-02",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The header now says 'widened D3' and the D3 provenance track still draws ±25 and asserts ±25 — the disclosure gap became an on-page contradiction",
    "expected": "The band drawn on a dimension is the band the engine applied to it, and the blend weight is visible somewhere.",
    "got": "HALF SHIPPED. `ScoreIntegrityChip` is built and mounted (ReportHeader.tsx:136), sourced from `integrityNotes` (attribution.ts:271-305) shared with the loop cockpit, and it names `widened D3` ('its guardband there was DOUBLED') and `blend 85%`. `Scan.scoreIntegrityJson` is now persisted. What did NOT move: `ProvenanceTrack` still computes `bandLo/bandHi` from the module constant `LLM_GUARDBAND` with no per-dimension input (DimensionDetail.tsx:106-107) and its tooltip still reads 'the LLM can move the score at most ±25 from the signal' (:119), while `engine.ts:237` used `LLM_GUARDBAND * 2` for that dimension. `effectiveBlend` (engine.ts:185,274) is still shown nowhere per-dimension. So on a scan with a non-empty widenedDims the page now states both ±50 and ±25 for the same dimension.",
    "evidence": [
      "src/components/report/ReportHeader.tsx:136 — ScoreIntegrityChip mounted (the half that shipped)",
      "src/lib/maturity/attribution.ts:287-302 — the widened / audit-capped / blend notes",
      "src/components/report/DimensionDetail.tsx:106-107,119 — band from the constant; the ±25 claim in the tooltip",
      "src/lib/scoring/engine.ts:237 — `const band = widenedDims.has(s.id) ? LLM_GUARDBAND * 2 : LLM_GUARDBAND`",
      "src/lib/scoring/engine.ts:185,274 — effectiveBlend = SCORE_BLEND × coverage, used in the blend",
      "src/lib/scoring/engine.ts:416-430 — scoreIntegrity assembled (widenedDims, widenCapped, effectiveBlend)",
      "docs/BACKLOG.md:50 — B6 'partly shipped — chip done; provenance track open', which this run confirms"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "recurrence": 2,
    "scope_note": "NARROWED from 2026-08-10. The disclosure half is genuinely closed and well done (one record, one wording, two surfaces). What returns is the per-dimension picture — and it is now strictly worse than an omission, because a reader who trusts the chip and then looks at the card sees the product disagree with itself.",
    "l2_priority": "On a live claude-cli scan whose report.scoreIntegrity.widenedDims is non-empty, read the header chip text, then inspect that dimension's ProvenanceTrack rect width and its <title>. Confirm the rect spans signal±25 and the title says ±25 while the chip says doubled. PRECONDITION: LLM_PROVIDER=claude-cli — mock produces no discrepancies, so widenedDims is always empty and this is NOT reproducible on the mock path. GITHUB_TOKEN present, anonymous viewer, DB on (so scoreIntegrity round-trips through the persisted column).",
    "reachable": true
  },
  {
    "id": "SAM-L1-01",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "D3 cites no file at all — the whole CI/CD dimension, plus D8 and D5's linter/formatter, still render as bare labels while D1/D2/D5-docs/D6/D9 now cite paths",
    "expected": "Every dimension score cites concrete, re-traceable evidence. Sam's stated automatic trust failure.",
    "got": "MOSTLY SHIPPED, and the remainder is concentrated in the dimension Sam is asked about. `found()` (analyze/index.ts:291-295) now recovers the matched path via `idx.first()` and puts it in `Signal.detail`; D1 additionally emits the guidance graph's node paths, canonical basis and per-penalty `paths.join(' ↔ ')` (:249-263), and D1/D4 model claims render as `path: \"quote\"` (engine.ts:60-64). Still bare, verified line by line: D3 `GitHub Actions CI present` (:470), `CI pipeline present` (:471), `Multiple CI workflows (n)` (:476), `CI runs tests` (:487), `CI runs linting` (:491), `CI runs a build` (:495), `Automated release tooling` (:505), `Automated deploy step` (:507), `Infrastructure-as-Code present` (:509), `Policy-as-code` (:519), `GitOps delivery` (:524), `Versioned DB migrations` (:532); D5 `Linter configured` (:689), `Formatter configured` (:696), `Guardrails also enforced in CI` (:707), `TypeScript strict mode` (:710); D2 `Found N test files` (:361), `Mutation testing configured` (:390), `Contract testing (Pact)` (:392); all of D8 via `aiStandard` (:313). The D3 cluster fires off a concatenated workflow-text blob, so there genuinely is no single file to name — but 'the detector can't name a file' and 'Sam can defend this upward' are different statements.",
    "evidence": [
      "src/lib/analyze/index.ts:291-295 — the found() helper that closed the path-triggered half",
      "src/lib/analyze/index.ts:470-532 — the D3 block, every s.add two-arg",
      "src/lib/analyze/index.ts:689,696,707,710 — D5 guardrails, two-arg",
      "src/lib/analyze/index.ts:313 — `for (const g of aiStandardCached(idx).d1) s.add(g.points, g.label)` — detail dropped even where aiStandard could supply one",
      "src/lib/analyze/index.ts:249-263 — the contrast: D1's fully-sourced guidance block",
      "src/lib/scoring/engine.ts:60-64 — renderClaim, the other half of the fix",
      "docs/BACKLOG.md:47 — B4 'partly shipped — path-triggered signals done; text-triggered ones open'",
      "reproduction: `grep -c 'detail' src/lib/analyze/index.ts` -> 15 (was 1 on 2026-08-10)"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "recurrence": 2,
    "scope_note": "NARROWED and DOWNGRADED from major to minor: the majority of dimensions now cite, and D1 is exemplary. It stays a finding because the residue is D3 — CI/CD — which is both this Character's flagship concern and the dimension the backlog says cannot be closed by the same mechanism. The carrier likely needs to be the workflow FILENAME the matching line came from, not a path from idx.first().",
    "l2_priority": "Open the Dimensions tab on a completed scan and read D3, D5 and D8's evidence lists in the rendered DOM. Confirm no path/filename appears on any D3 line and that no expander reveals one; contrast with D1, whose lines carry paths. PRECONDITION: any provider (detector layer is provider-independent), DB either, anonymous viewer, GITHUB_TOKEN present.",
    "reachable": true
  },
  {
    "id": "SAM-L1-04",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "The scan still ends on /report?repo=… and never hands over the permalink — third run, unchanged",
    "expected": "After a multi-minute scan the durable, commit-pinned URL is in the address bar or behind an obvious copy control — the thing Sam pastes into Slack or the PR.",
    "got": "`ScanForm.tsx:142` pushes `/report?repo=…`; nothing navigates or rewrites afterwards. `reportPermalink` (`src/lib/ui.ts`) has 25+ call sites across trends, launch, live, developer, followups, org — and exactly ONE in the scan path: `api/scan/stream/route.ts:348`, inside the notify-email branch, which fires only for a signed-in opt-in. Under `src/components/report/` the only callers are `DimensionTrends.tsx:124,145` (history points, not this scan). The header export row (ReportHeader.tsx:152-190) offers PDF, Share card, Copy for LLM, SkillDownload, FoundationPr — no link/copy-permalink control. The report artifact is persisted (scans-persist) and never named to the person who waited for it.",
    "evidence": [
      "src/components/ScanForm.tsx:142 — the terminus",
      "src/app/api/scan/stream/route.ts:348 — the sole scan-path caller, email-only",
      "src/components/report/ReportHeader.tsx:152-190 — the full export row, no permalink control",
      "src/components/report/DimensionTrends.tsx:124,145 — the only in-report callers, for prior scans",
      "docs/BACKLOG.md:48 — B5 open (badge half dropped)"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "recurrence": 3,
    "scope_note": "Unchanged since 2026-07-16 and 2026-08-10; the badge half of B5 was dropped when /badge was removed, leaving this as the whole of B5 and still open. Smallest fix on this page.",
    "l2_priority": "Complete a scan, record the address bar, reload, then sweep the whole report DOM (header, all five tabs, footer CTA) for any control whose text or href contains /report/{owner}/{repo}. PRECONDITION: needs TWO arms — (a) DB ON (PGlite on this host) where the permalink resolves, and (b) DB OFF where the permalink would 503/ColdScanGate; if arm (b) cannot be served without a restart, resolve it `uncertain — not reproducible on this host`, never refuted. Any provider, anonymous viewer.",
    "reachable": true
  },
  {
    "id": "SAM-L1-05",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "The mandated invitational voice still buries the concrete move inside a rationale paragraph — Sam extracts his own ticket",
    "expected": "Criterion #4: the roadmap names a specific, evidence-grounded next move he'd put in the sprint ('pin the 3 unpinned Actions to SHAs').",
    "got": "Unchanged. `prompt.ts:227-232` mandates that `title` be an observation and NOT an imperative, that `explore` be open questions 'not steps', and that the whole output stay 'invitational throughout — provide inputs to explore, not directives to follow'. The specifics are present and genuinely repo-derived, but they live in the rationale prose. No `firstStep` field exists (`grep -rn firstStep src/lib` -> only unrelated comment matches). The UI has nowhere to put one.",
    "evidence": [
      "src/lib/scoring/prompt.ts:227-232 — the voice mandate",
      "src/lib/scoring/prompt.ts:203,222 — 'invitational voice' repeated for craft entries",
      "reproduction: `grep -rn 'firstStep' src/lib src/components` -> 0 real hits",
      "docs/BACKLOG.md:57 — B14 open, additive per guardrail G2"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "recurrence": 2,
    "scope_note": "By-design in the prompt, which is why B14 is framed as ADDITIVE (a separate field) rather than as changing the voice. Recorded again because it is the last thing standing between criterion #4 and a clean pass.",
    "l2_priority": "Read the rendered Roadmap tab on a live claude-cli scan and check whether any roadmap row states an executable action outside a prose paragraph. PRECONDITION: LLM_PROVIDER=claude-cli — mock roadmaps come from the static fallback catalog (recommendations.ts) and do not exercise the prompt's voice mandate at all, so mock CANNOT refute this. GITHUB_TOKEN present, DB either.",
    "reachable": true
  },
  {
    "id": "SAM-L1-06",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "'Flagged for review' still never says what each auditor claim DID — widened, structurally ineligible, or lost to the budget",
    "expected": "Sam can see where the model and the detector disagreed AND what the disagreement changed. Criterion #3.",
    "got": "`ReportDiscrepancies` (ReportNotices.tsx:22-41) renders `{d.dimension} {d.claim}` and a static lede ('may be wrong: worth verifying'). Nothing states the outcome. The engine knows: `widenedDims` (engine.ts:142,421), `widenCapped` (:425), and D9's structural ineligibility (:76-79). The new integrity chip now discloses the outcome GLOBALLY ('widened D3', 'audit capped'), so a determined reader can join the two panels by hand — which is an improvement, and is why this drops to minor.",
    "evidence": [
      "src/components/report/ReportNotices.tsx:22-41 — dimension + claim only",
      "src/lib/scoring/engine.ts:142,421,425 — widenedDims / widenCapped",
      "src/lib/scoring/engine.ts:76-79 — D9 excluded from widening by construction",
      "src/lib/maturity/attribution.ts:287-296 — the chip's global disclosure, the partial fix",
      "docs/BACKLOG.md:58 — B15 open"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "recurrence": 2,
    "scope_note": "NARROWED: shares a data source with SAM-L1-02, whose chip half shipped and now carries the global outcome. What remains is the per-claim attribution in the panel itself. Downgraded from the 2026-08-10 severity accordingly.",
    "l2_priority": "On a live claude-cli scan with >=1 discrepancy, compare the 'Flagged for review' rows against the header integrity chip and confirm no per-row outcome is stated. PRECONDITION: LLM_PROVIDER=claude-cli (mock produces zero discrepancies — NOT reproducible on mock), GITHUB_TOKEN present, DB on.",
    "reachable": true
  },
  {
    "id": "SAM-L1-08",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "scoreLabel covers 5 of 8 providers and the gap WIDENED — `local`, the self-hosted path, falls through to generic copy during the longest wait in the product",
    "expected": "The progress copy names the provider being queried, so a multi-minute score step reads as work rather than a hung spinner (Sam's 'latency theater' trigger).",
    "got": "`scoreLabel` (ReportClientStatus.tsx:38-53) switches on gemini, claude-cli, codex-cli, bedrock, mock, default. `ProviderName` (types.ts:12-20) now has EIGHT members and `PROVIDER_CHOICES` (llm/index.ts:102) confirms all are selectable. Uncovered: `openai`, `openrouter`, `local`. On 2026-08-10 this was 4 of 6 uncovered-by-2; it is now 5 of 8, uncovered-by-3, because `local` and `codex-cli` were added and only one of them got a branch. `local` is the self-hosted open-source path and typically the slowest.",
    "evidence": [
      "src/components/report/ReportClientStatus.tsx:38-53 — the switch, 5 cases + default",
      "src/lib/types.ts:12-20 — ProviderName, 8 members",
      "src/lib/llm/index.ts:102 — PROVIDER_CHOICES includes local, openai, openrouter",
      "docs/BACKLOG.md:58 — B15 open"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "recurrence": 2,
    "scope_note": "Downgraded to polish for THIS Character (he runs the hosted funnel), but flagged as widening because a self-hosted operator on LLM_PROVIDER=local hits it on every scan. Cheapest fix in the run.",
    "l2_priority": "Run a scan with LLM_PROVIDER=local and read the score step's label during the wait; confirm it reads 'Scoring against the rubric' rather than naming the local model. PRECONDITION: a local model endpoint configured (selfHosted() path) — if this host cannot serve one, resolve `uncertain — not reproducible on this host`; the code branch is unambiguous either way.",
    "reachable": true
  },
  {
    "id": "SAM-L1-12",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "Sam's third job-to-be-done — a badge/level to put in the README — now has no product answer at all after the badge retirement",
    "expected": "JTBD #3, verbatim: 'Hand me a badge and a level I'd stake my name on in the README without getting roasted in the next standup.' Scored criterion #6 judges exactly this object.",
    "got": "The whole badge surface was REMOVED on 2026-08-29 (commit 773c9aa0): `src/app/badge/page.tsx`, `src/app/api/badge/[owner]/[repo]/route.ts`, `src/app/api/scorecard/[owner]/badge/route.ts` and the BadgeImpression table are all gone (`git ls-tree -r HEAD | grep badge` returns only unrelated components). The journey `badge-my-oss-repo` and the character Mei were retired with it, and docs/BACKLOG.md:48 closes SAM-L1-03 as no-longer-applicable. That is a legitimate product decision, not a defect. What is left standing is the JOB: nothing on the report produces a README-embeddable artifact. The nearest neighbours are the Share card PNG (a download, not embeddable by URL) and the CI Scorecard gate (a merge check, not a badge).",
    "evidence": [
      "773c9aa0 — feat(badge)!: remove the public README badge feature",
      "uat/journeys/retired/README.md — 'the /badge generator and both SVG endpoints were removed from the product'",
      "docs/BACKLOG.md:48 — SAM-L1-03 closed as no-longer-applicable",
      "src/components/report/ReportHeader.tsx:152-190 — the export row after the removal; nothing embeddable",
      "uat/characters/sam-staff-engineer.md:25,51 — JTBD #3 and scored criterion #6, both still assuming the surface"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "scope_note": "Filed so the drain has to make the call EXPLICITLY rather than letting criterion #6 quietly evaporate. Two honest resolutions: (a) declare the job out of product scope and amend Sam's character file + criterion #6 in the same change, or (b) serve it another way (a permalink + level line for the README, which would also close SAM-L1-04). Option (b) is one item, not two. What must NOT happen is criterion #6 scoring N/A forever with no decision recorded.",
    "l2_priority": "None — resolvable at L1 from the tree and the retirement commit. If L2 runs anyway: sweep the report DOM for any control mentioning badge/README/embed and confirm zero. PRECONDITION: none.",
    "reachable": true
  },
  {
    "id": "SAM-L1-13",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "low", "trust_erosion": "med" },
    "dimension": "effort",
    "title": "The exemplar diff has no discovery path from the report, sits behind three walls, and for a public-org viewer labels up to 500 corpus repos as 'Your repos'",
    "expected": "'What does a stronger repo have that I don't' is the second-most valuable question the product can answer for a staff engineer. It should be discoverable from the report, and its option groups should mean what they say.",
    "got": "THREE WALLS on Sam's path: /report/compare requires sign-in (page.tsx:41-52 — resolveSignInState, correctly checking the ACTIVE Supabase wall), then DATABASE_URL (:69-77), then >=2 stored scans (:100-107). NO DISCOVERY PATH: the only link from the report is ScoringTab.tsx:86-93 'What changed →', itself gated on scans.length >= 2, labelled purely as time-vs-time and carrying no `?against=`; the exemplar control is a `<select>` at the bottom of ScanComparePicker (:125-149) that renders only when exemplarOptions is non-empty. MISLABELLED GROUPS: `readableOrgForOwner` resolves a non-member viewer to the shared public org, so `listExemplarOptions` runs `loadOrgCandidates(publicOrgId)` — up to ORG_CANDIDATE_CAP = 500 repos from the entire public corpus (exemplar-load.ts:200-206,280) — rendered under `<optgroup label=\"Your repos\">` with an `org:best` option labelled 'Org best' that actually means 'best in the public corpus'.",
    "evidence": [
      "src/app/report/compare/page.tsx:41-52,69-77,100-107 — the three walls",
      "src/components/report/ScoringTab.tsx:86-93 — the only inbound link, gated and time-only",
      "src/components/report/ScanComparePicker.tsx:125-149 — the exemplar select and its AGAINST_GROUPS",
      "src/lib/report/exemplar-load.ts:200-206 — loadOrgCandidates, ORG_CANDIDATE_CAP = 500, no public-org special case",
      "src/lib/report/exemplar-load.ts:280-294 — 'Your repos' + 'Org best' built from those candidates",
      "reproduction: `grep -rn 'report/compare' src --include=*.tsx | grep -v '^src/app/report/compare'` -> trends, PersonalOverview, ScoringTab only; none carries ?against="
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "scope_note": "The sign-in and DB walls are defensible product decisions and are NOT the finding; the finding is that a shipped capability has no path from the surface that would motivate using it, plus the public-org labelling, which is a small correctness bug in a security-conscious module (the tenancy itself is sound — cohort mode is aggregate-only with a distinct-orgs floor). Also relevant to the drain: this reachability is why SAM-L1-10 scores low on reachability despite being a major quality defect.",
    "l2_priority": "Sign in, scan one repo twice, open /report/compare?repo=<r> as a viewer with NO membership in that owner's org, and inspect the 'Against (exemplar)' select: confirm the 'Your repos' optgroup lists repos the viewer does not own. Then sweep the report DOM for any control mentioning 'exemplar' or carrying ?against= and confirm zero. PRECONDITION: DATABASE_URL on with a seeded public corpus of >=2 eligible repos (scripts/seed-scans.mjs), a signed-in Supabase viewer, >=2 scans on the subject repo. Not reproducible anonymously — the page 302s to sign-in first.",
    "reachable": false
  },
  {
    "id": "SAM-L1-STR-04",
    "journey": "scan-my-repo-get-a-roadmap",
    "character": "Sam (Staff Engineer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "low", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "src/components/report/DimensionCard.tsx is dead code carrying a duplicate ProvenanceTrack — the two open findings against that component would have to be fixed twice",
    "expected": "One renderer for one visual, so a correctness fix lands once.",
    "got": "`DimensionCard.tsx` exports `DimensionCard` (:13) and a private `ProvenanceTrack` (:120-160) that is a near-copy of `DimensionDetail.tsx:100-138`. `grep -rn DimensionCard src --include=*.ts --include=*.tsx` returns no importer — only a stale comment reference in chartMotion.ts:40 and the extraction note in DimensionDetail.tsx:4. Both SAM-L1-02 (band width) and SAM-L1-11 (mechanism) target that component; a maintainer greping for ProvenanceTrack will find two and may patch the dead one, or patch both and think the second was needed.",
    "evidence": [
      "src/components/report/DimensionCard.tsx:13,106,120-160 — the component and its private track",
      "src/components/report/DimensionDetail.tsx:100-138 — the live copy",
      "src/components/report/DimensionDetail.tsx:4 — 'Extracted from the old DimensionCard'",
      "reproduction: `grep -rn 'DimensionCard' src --include=*.tsx | grep import` -> 0 hits"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "scope_note": "Not user-visible. Filed only because it sits directly on the fix path of two confirmed major findings.",
    "l2_priority": "None — static.",
    "reachable": false
  }
]
```

## Resolved-verified candidates (for L2 to confirm, NOT findings)

| Prior id | Lead from the brief | State at `fca0c742` | Evidence |
|---|---|---|---|
| `SAM-L1-03` | badge missing from the report | **RESOLVED — no longer applicable.** The badge feature was removed wholesale (`773c9aa0`); the criterion's object no longer exists. Successor concern filed as SAM-L1-12. | `git ls-tree -r HEAD \| grep -i badge`; `uat/journeys/retired/README.md`; `docs/BACKLOG.md:48` |
| `TOMAS-L1-01` / B2 (touches Sam's entry) | public scan walled | **RESOLVED for Sam's path.** `scanAuthGate` exempts the anonymous public funnel by default; the burst limiter and monthly quota are unchanged and independent of the flag. | `src/lib/scan-gates.ts:73-100` |
| `SAM-L1-02` half A | `scoreIntegrity` rendered by nothing | **RESOLVED.** Chip mounted in the header from a shared `integrityNotes`, and the record is now genuinely persisted. | `ReportHeader.tsx:136`; `ScoreIntegrityChip.tsx`; `attribution.ts:271-305` |
| `SAM-L1-01` majority | detectors discard the path they matched | **RESOLVED for path-triggered signals** (D1 fully, D2 framework/e2e/coverage, D5 docs, D6, D9), plus D1/D4 model claims now carry `path: "quote"`. Residue is D3/D8/text-triggered — kept as a narrowed finding. | `analyze/index.ts:291-295`; `engine.ts:60-64` |

---

## L2 — live (arm A)

*Anonymous arm, port 3100, real `claude-cli` (opus) scan of `sindresorhus/p-limit` — 155.4 s,
score 27/100, `integrity · widened D2, D6 · blend 95%`. Construction: `_L2-PREFLIGHT.md` § Arm A.
Full per-check evidence and the raw per-dimension DOM dump (`shots/armA-dimloop.json`):
`_L2-armA.md`.*

| Finding | L1 | L2 (live) |
|---|---|---|
| `SAM-L1-11` | confirmed | **confirmed in mechanism, refuted on the number** — the track says **±6**, not ±25 (`LLM_GUARDBAND` narrowed 25→6 in r8). D1 and D4 plot an inert LLM tick; D9 could not be discriminated this run (llm == signal). |
| `SAM-L1-02` | confirmed | **confirmed** — chip says D2/D6 "DOUBLED", both tracks assert ±6 **and draw a 28.32-wide band identical to every unwidened dimension**. |
| `SAM-L1-04` | confirmed | **confirmed** — address bar unchanged, whole-DOM sweep finds one hit and it's a share-card PNG. DB-off arm not run → that half stays uncertain. |
| `SAM-L1-01` | confirmed | **confirmed for D3/D5/D8**; the D1 contrast is weaker than stated, and the LLM prose *does* cite the paths the EVIDENCE list omits. |
| `SAM-L1-06` | confirmed | **corroborated** — "Flagged for review" names D2 and D6 with the model's claim and states no outcome, while the header three inches above says both were widened. |

### Sam's L2 verdict — first person

I ran a real one. `p-limit` — small, well-made, someone else's, so I couldn't flatter myself.
155 seconds, live model, 27/100. The narrative was better than I expected: it told me `main` is
unprotected with zero required approvals while 76% of CI runs are green, and then said the thing I'd
have written in the ticket myself — *"excellent feedback latency wasted on an ungated gate."* That's
a staff-engineer sentence. I'd forward it.

Then I opened the provenance track, which is the part I actually came for, because a score I can't
audit is a score I can't defend in a design review.

**First: the number in my own L1 was wrong and I want that on the record.** I wrote ±25. The track
says **±6**. They narrowed it in r8 and I was reading a stale constant. Good — ±25 was a full
maturity level of slack and it deserved to die.

**Second: everything I said about the shape was right, and the live run proves it in a way the code
read couldn't.** D1: signal 0, model said 3, blended **0**. D8: signal 0, model said 4, blended
**2**. Same starting point, same size of judgment, and only one of them moves. That's not a
rounding artifact — that's D1 being claim-scored, the model's number recorded and thrown away. D4 is
the same: signal 25, model 24, blended 25, when a 0.57-weight blend would have given me 24. And on
all three the SVG still draws a ±6 guardband and still plots a tick labelled **"LLM judgment"**
inside it. The picture is telling me a negotiation happened. On D1, D4 and D9 there is no
negotiation — there's a number the model isn't allowed to touch, and a diagram implying it did.
That's the opposite of what a provenance widget is for.

D9 I can't prove from this run. The model returned exactly 24 against a signal of 24, so signal,
LLM tick and blended marker all landed on the same pixel. The code is unambiguous — D9 is the one
fully deterministic dimension and never enters the blend — but live, this scan couldn't
discriminate it. Honest gap; a fixture where the model disagrees on D9 would close it.

**Third, and this is the one I'd fix first, because it's a contradiction rather than an
omission.** The header chip on this scan reads *"integrity · widened D2, D6"* and spells it out:
*the model flagged the detector as suspect on D2, D6, so its guardband there was **DOUBLED**.*
I then opened D2's track. Title: **"the LLM can move the score at most ±6 from the signal."** Not
±12. And I measured the rectangle — width **28.32**. D6: 28.32. D3, D4, D5, D7, D9: 28.32,
28.32, 28.32, 28.32, 28.32. The widened band isn't mislabelled, it's **not drawn**. So the page
tells me three things about the same dimension, in three different places, and two of them are
wrong. If I were the one being asked to trust this number in front of a VP, that single page would
be the reason I didn't.

Same page, lower down: **"Flagged for review"** lists D2 and D6 with the model's actual objection —
and both objections are *good* ("D2 reported 1 test file, but `index.test-d.ts` is a second test
file running under `tsd`"; "D6 reported only 'Formatter configured', but `npm test` runs xo and tsd
in CI"). Those are detector bugs I could go fix. But the section never tells me what *happened* to
each claim. It doesn't say "this one widened the band." It doesn't say "this one was ineligible."
The header knows. The list doesn't say. One word per row closes it.

Evidence lists: **D3 still cites nothing.** `GitHub Actions CI present` · `CI runs tests` ·
`Default-branch CI mostly green (76% of last 21 runs green)`. Three lines, zero paths, and I
expanded every collapsible on the page to be sure. D5 gives me `Substantial README (4970 chars, 16
sections)` — the file is actually `readme.md` and it's never named. D8 gives me `No dedicated AI
process/harness detected`.

But I have to soften my own finding here, because the live page shows something my static read
didn't: **the narrative above the evidence list names the files.** D3's prose says
`.github/workflows/main.yml` runs `npm test` on Node 24/22/20 with `fail-fast: false`. D5's says
`readme.md` and `index.d.ts`. So I'm not actually left hunting — I'm left with a paragraph that
cites its sources and a list *labelled EVIDENCE* that doesn't. That's a smaller gap than I claimed
and it points somewhere different: the deterministic detectors are the thing lagging the model, not
the UI. Lower severity, clearer owner.

And the permalink: third run, still nothing. Scan finished, address bar still
`/report?repo=sindresorhus%2Fp-limit`. I swept every anchor and button in the document. One hit —
`/api/report/share-card`, a PNG. Meanwhile the pricing page's Free card sells **"Public report
permalink"** as a bullet. I can't put a query-string URL in a README and I can't put a PNG in CI.

**Verdict: the scoring is worth defending; the page that explains the scoring is not yet.** The
model output cleared my bar — specific, cited, and willing to say its own detectors are wrong. The
provenance layer under it is currently drawing a mechanism that doesn't exist on three dimensions
and contradicting its own header on two more. Fix the track to read the per-dimension band
(`widened ? 12 : 6`) and to suppress the LLM tick on claim-scored and deterministic dimensions, put
one outcome word on each flagged row, and this becomes the most auditable score in the category.

*— "The number's good. The diagram explaining the number is lying to me."*

---

## L2 — live (arm B)

*Driven 2026-08-30 against the shared dev server on `:3000` (PGlite, `LLM_PROVIDER=claude-cli`).
Full journal, evidence and residue: `_L2-armB.md`.*

**SAM-L1-09 — the observation holds, my diagnosis does not.**

The payload first. `GET /api/recommendations?repo=vercel/next.js` (`shots/armB-sam-recs.json`) returns
three persisted rows whose keys are `id, title, dimension, impact, effort, rationale, explore,
levelUnlock, status, assigneeLogin, targetDate, projectedPoints, unlocks, **expectedLift**` —
`expectedLift` is on the wire and is `null` on all three. `&sort=measured` answers `sort:"priority"`.

The rendered Roadmap tab (`/report/vercel/next.js?tab=roadmap`, `shots/armB-sam-roadmap.text.txt`)
carries no measured clause and no priority/measured toggle — `grep -ci "measured|expected lift|sort by"`
→ **0**. So the *prediction* is confirmed exactly.

But I wrote that this proves *"the data exists and only the UI seam is missing"*, and that is wrong.
The seam is there: `src/components/report/ExpectedLiftBasis.tsx:29` renders `expectedLiftClause`, and
`RecommendationTracker.tsx:79-81` holds the sort state —

```ts
const [sortMode, setSortMode] = useState<RoadmapSortMode>("priority");
const anyMeasured = items.some((i) => expectedLiftClause(lifts?.get(roadmapLiftKey(i))) !== null);
const ordered = sortRoadmap(items, lifts, anyMeasured ? sortMode : "priority");
```

The toggle is deliberately conditional on at least one publishable basis, and the API's
`sort:"priority"` downgrade is the *same* refusal, stated in its own comment. Both are a designed
decision not to order by zero measurements. **What is absent is the data, not the UI.** That is a
better product than I credited, and it moves the finding from "wire the seam" to "there is no path to
ever produce an outcome row".

Measured arm: `uncertain — not reproducible on this host`. `expectedLiftClause` returns null below
`OUTCOME_MIN_SAMPLES`, no seeder produces outcome rows, and there is no app path to insert them.
**Fixture:** ≥3 `kind:"recommendation"` outcome rows sharing one `recommendationMatchKey` and one
instrument.

*Seen in passing, on the same capture — SAM-L1-05 is confirmed on screen.* Every roadmap row's
concrete move sits inside a rationale paragraph: *"AI Tooling & Conventions scored 65/100. Substantive,
machine-readable guidance (build/test commands, an architecture map, the rules a change must never
break) is what lets an AI contribution land consistently and on-spec."* The only non-prose fields are
`impact: high`, `effort: low`, `↑ up to +6 pts`. I still have to write my own ticket.

| Check | Verdict |
|---|---|
| No measured clause / no sort toggle renders | **confirmed as observed** |
| "Only the UI seam is missing" | **refuted** — `ExpectedLiftBasis` + a conditional sort toggle both exist; the outcome ledger does not |
| API carries `expectedLift` and honours `sort=measured` | **confirmed** (`expectedLift` present, null; `sort` correctly downgrades on an empty ledger) |
| Measured ordering exercised end to end | **uncertain — not reproducible on this host** (no outcome rows constructible) |
| SAM-L1-05 (move buried in prose) — incidental | **confirmed** live |
