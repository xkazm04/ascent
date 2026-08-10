# UAT drain — `2026-08-10-ascent-first`

> Drained 2026-08-10 with `/uat drain` (skill v1.2 as installed here; drain contract unchanged in
> v1.3/v1.4). Source run: `uat/runs/2026-08-10-ascent-first/` — 3 Characters (Sam, Dana, Tomáš),
> 37 findings, 35 `confirmed`, 2 honestly `uncertain`, full L1 → L2 on a live app.
>
> This is ascent's **first drain**. Five prior runs (2026-06-19 ×2, 2026-06-20, 2026-07-16 sweep +
> recertify) were never drained, so no prior insight doc exists to extend. This file establishes the
> convention: analysis lives here, `build` items land in [`docs/BACKLOG.md`](../../BACKLOG.md) under
> a per-run section, concept docs go to `docs/features/<area>/`.

Panel verdict the whole document hangs off: **the reasoning is ahead of the reporting.** Where
Ascent *thinks* it clears a senior bar; where it *presents* it undercuts the work that earned the
trust. Every item below is a reporting-layer item or an explicit decision not to touch a thinking-layer
strength.

---

## 1. Confirmed-and-fixed (reference only — the ceilings are inputs to §2)

Two rows in this run's `findings.json` carry a closed resolution. Both are carry-forwards from
2026-07-16, and **both closed on one half only** — the ceilings are what §2 items 3 and 8 are built on.

| id | what closed | resolution | **ceiling** |
|---|---|---|---|
| `PRIOR-2026-07-16-03` | A public-funnel scan no longer vanishes on reload. A real `claude-cli` scan of `vercel/swr` (193 s) survived a **server restart** and rendered anonymously at `/report/vercel/swr` 26 minutes later. | `resolved-verified` (live) | **DB-off was never driven** — only the DB path is proven. And the permalink is *still never handed to the user*: the scan flow ends on `/report?repo=…`. `SAM-L1-04`'s discoverability half stays open (§2 #8). |
| `EXEC-BRIEFING-0716-1` | The engine-mix caveat now reaches the board PDF verbatim: *"Scored by Claude CLI ×5, Mock (deterministic) ×4 — some scores this period used the deterministic mock engine, not the live model."* Dana's core 2026-07-16 complaint. | `fixed` | **Only the engine-mix caveat propagated.** The *forecast* caveat did the opposite — the partial fix **deleted** the hedge instead of replacing it (`briefing.ts:283-287`), so a low-data trajectory now prints a bare dated ETA. That is the ceiling, and it is §2 #10. |

Dana on the first half, unprompted and first: *"Last time that caveat existed somewhere in the app
and never made it to the thing I'd forward. Now it's in the artifact. That's the fix I asked for,
and it landed."* — then twelve lines later: *"I'd retype the slide myself rather than export the
PDF, and that is the whole finding."* One half of one surface closed; the shape survived elsewhere.

**Schema note (also §3):** the run *did* carry these forward as `findings.json` rows with
resolutions and ceilings, which is what v1.2 asks for. `DANA-L1-002` and eleven other rows, however,
carry `resolution: null` — the drain had to read severity/`impact` and the reports to place them.

---

## 2. Design opportunities — ranked

Order is the v1.2 contract: **recurrence first**, then **convergence**, then **voice escalation**,
then impact arithmetic. `[B]` = build (→ backlog), `[C]` = concept-doc, `[D]` = decline-with-reason.

### 1 · `[B]` The `/usage` credits alarm is non-monotonic and fires by default — `DANA-L1-003`, **recurrence 2**
Two sentences on one page: *"Out of private-scan credits — the next private scan will be refused
(402) until you top up"* (`usage.text.txt:16`) beside *"Comfortably within your 5/mo Free
allotment"* (`:117`). L2 executed every branch of `src/app/usage/page.tsx:142` and widened it twice:
the gate is **non-monotonic** (0 credits + 0 scans → harshest alarm; **1** credit + 0 scans →
silence), and `scanCredits DEFAULT 0` (`prisma/schema.prisma:45`) makes this **the default state of
every newly created org**. The banner and `AllotmentPanel.tsx:59-64` are different components reading
different authorities, so they can never reconcile.

> *"A tool that tells me I'm cut off when I'm not teaches me to ignore its warnings — and the one
> time it's right is the time I'll scroll past it… a tool that cries wolf as its default state
> trains me to scroll past the one warning that will eventually be real. I have three vendors' alert
> emails in a filter folder for exactly that reason."* — Dana
>
> *"this is the second run in a row I've reported it — which, after two runs, starts to read as a
> decision rather than a backlog… the cost. Not the banner. The doubt it seeds about the six panels
> around it."* — Dana, L2

**Cost/value:** hours. The 402 authority already exists and is already shared by the read and write
gates (`checkScanEntitlement` → `resolveScanCharge`, `src/lib/plans.ts:146-165`); the banner simply
never asked it. Highest-value/lowest-cost item in the run, and it is on its second cycle. **Build.**

### 2 · `[B]` The advertised free, no-signup scan returns 401 — `TOMAS-L1-01`, **blocker**
L2 built the production-shaped arm (`ASCENT_AUTH_BYPASS=0`, Supabase configured) and got
`POST /api/scan → 401 {"code":"auth_required"}` (`src/lib/scan-gates.ts:77-83`,
`src/app/api/scan/route.ts:258-261`). The widening is the shape: **everything read-only is open**
(report 200, badge 200, gate 422) and the *one* walled action is running a scan yourself — under a
hero CTA reading "Scan a repository" and `README.md:94-98`'s literal heading **"Free & public — no
signup"** / *"Everything here works anonymously."*

> *"They built the hard part — a scan I'd stake my name on — and then put a login in front of it."*
> *"your scan is better than your funnel, and your funnel is currently lying about your scan."*
> *"If I have to hand over an OAuth grant to find out whether the tool is real, I assume the tool
> isn't confident it is. That's the tab closing."* *"Who would I loop in internally? Nobody, this
> week."* — Tomáš, L2

Voice escalation is explicit and pre-registered: *"If L2 confirms it live against the real
deployment, this journey becomes L1-fail retroactively — a buyer who cannot run the scan has no
journey."* Realized time-saved as production is configured: **~0 minutes.**

**The call — open the path with limits, do not soften the copy.** Tomáš's own escape hatch (*"If
it's a decision, say so on the button and I'll respect it"*) is the cheaper fix and it forfeits the
funnel: his criterion is *run one scan **myself***, and no honest wording satisfies it. The
machinery to open it safely is already built and already ordered correctly — `scanRateLimitGate`
runs before the wall, and `public-scan-quota.ts` meters the shared public org. Making the wall
**public-org-scoped** (anonymous single-repo public scans allowed under the existing rate limit +
public quota; private/org scans still walled) restores the advertised product without opening a new
cost surface. Copy honesty about the *quota* is a separate, additive item (#9). **Build.**

### 3 · `[B]` The board PDF prints a regression under "Value this period", against four unlabelled denominators — `DANA-L1-010` + `DANA-L1-012` (+`-011`)
One live page (`_l2-briefing-vercel.txt`): *"Value this period: 1 recommendation completed · fleet
**−6 pts**"* — `valueRealizedLine` pushes `pointsMoved` sign-blind (`briefing.ts:58`). Beside it,
four repository denominators in one board slide: *"Across 6 of 6 repositories scanned"* ·
*"Coverage: 6/6"* · *"Of 2 repositories comparable across the period, 0 improved and 0 regressed"* ·
*"PERCENTILE — vs 1 repos"* · *"shared by 3 repositories"*. A fleet-wide −6 sits next to a
cohort-matched "0 moved", and the percentile tile prints its corpus caption (`briefing-document.tsx:115`)
even when the percentile itself is `—`.

> *"That is not a formatting bug to me. That is the tool not knowing which direction is good — and
> the sign is right there in the variable."*
> *"'Versus one repo' is not a benchmark, it's an apology, and it's sitting in a headline slot on a
> page with my org's name at the top."*
> *"A board member does not need to know the word 'cohort-matched'; they need the page not to
> contradict itself. And I could not have explained the −6 from anything else on that page."*
> *"the tests presumably assert that `pointsMoved` reaches the PDF. None of them assert that a
> negative number does not belong under the word 'Value.'"* — Dana

**Cost/value:** low cost, highest-stakes surface — this is the artifact that leaves the building.
Three coupled edits: label the value line by its own sign rather than suppressing the bad news
(suppression would violate the honesty guardrail below), scope each denominator in words, and make a
sub-threshold benchmark say so instead of rendering an apology in a headline tile. **Build.**

### 4 · `[B]` Per-dimension evidence lines are unsourced labels — `SAM-L1-01`
`Signal.detail` is populated exactly once in all of `analyze/index.ts` — on the *failure*
placeholder. Sam's **stated automatic-trust-failure clause**, and the measurable cost: the entire
~30-minute gap between his 5 h 50 m possible and 5 h 20 m realized time-saved is this one finding.

> *"I clicked into D2, saw 98, and went looking for where it came from. I got 'Found 138 test
> files'. Which 138?… The machinery for the thing I need is built and left empty. So to defend this
> number upward I go re-grep the repo, which is the tedium I came here to skip."* — Sam

**Cost/value:** the largest of the build items (every detector must emit paths/counts through an
existing but unused field) and the one with the clearest payoff — it converts a conditional pass into
a pass on his hardest criterion. Days, not hours. **Build**, ranked below the three above only
because they are hours.

### 5 · `[B]` No badge affordance anywhere on the report — `SAM-L1-03` (third run raising it)
Sam's third JTBD has **no path through the product**, and `/badge` won't accept the repo he just
scanned without retyping it.

> *"It's just not wired to the one screen where anybody would ever want it. That's a link, not a
> feature."* *"Would I stake my name on the badge? I would — except there's still no badge on the
> report. Three runs of this and the one artifact my JTBD is built around has no path."* — Sam

Bundle with the open half of `SAM-L1-04` (the permalink is never surfaced after a scan — see the §1
ceiling): both are the same defect, a durable artifact the product computes and never hands over.
**Build**, small.

### 6 · `[B]` `scoreIntegrity` is computed, typed, persisted, and rendered by nothing — `SAM-L1-02`
The provenance track draws a **fixed ±25 band even where the engine used ±50**, and hides the actual
blend weight.

> *"That's not a hard fix; that's a panel nobody built."* *"the machinery is sound and auditable —
> if you are handed 0.51 and the band. The UI hands you neither, and a reader assuming the obvious
> 50/50 at ±25 gets D2 wrong by a point."* *"on this scan the LLM sat inside ±25 anyway, so the
> visible story doesn't change. That is luck, not design."* — Sam

**Build**, medium. Note the interaction with #7: the honest band makes the ±2-point result *visible*,
which is a positioning question, not a bug.

### 7 · `[C]` The model moves the headline ~±2 points — the product sells the ring and gives away the reasoning — `L2-NEW-01`
The run's sharpest instrument: the app persists `signalScore` beside `llmScore`, so this is a
**measurement, not an inference**. Across nine dimensions the model used ≤24% of its ±25 guardband;
D6 and D9 came back **byte-identical** to the detector. 193 seconds bought ≈±2 points on the number —
and the roadmap, and the discrepancies block.

> *"The model doesn't calibrate. The model explains, and the explanation is the product. You're
> selling the ring and giving away the reasoning."* *"I'd tell a peer: 'ignore the number, read the
> discrepancies.' Which is a strange sentence to have to say about a scoring product."* — Sam

**Concept-doc, not build.** Guardbanding an LLM against a detector is the *correct* design and Sam
says so (*"I'd have built it that way"*); the open question is what the product leads with, which is
positioning + information architecture, not a patch. Extend `docs/features/scanning/maturity-model.md`
with a "what the model actually contributes" section, and fix the README's *"calibrates the signal
scores"* — the weakest true thing it could say — as a small honest-copy sub-item. Do **not** widen
the guardband to make the model look busier (see guardrails).

### 8 · `[B]` The report shows facts the model provably never received — `L2-NEW-02`
`TECH_STACK_PROMPT` is unset, so the stack never enters the prompt — yet "STACK / TypeScript /
React" renders in the passport beside scores the model *did* produce. Same class: `contributors`,
`aiChanges`.

> *"For a tool whose whole pitch is 'here's the evidence behind every number,' having ambiguous
> provenance about your own provenance is the one own-goal you can't afford. Label it, or don't show
> it next to the scores."* — Sam

Cheap (a chip/caption), and it protects the strength the whole product rests on. **Build**, small.

### 9 · `[B]` "Unlimited free public scans" is contradicted by the code in two independent ways — `TOMAS-L1-02`
`plans.ts:54` vs `public-scan-quota.ts:53-60` (a 5/mo cap), and the pricing page and the FAQ JSON-LD
(`src/app/page.tsx:56`) disagree with each other.

> *"Two different numbers, one of them on the thing I'm supposed to buy from. It's small and it's
> the kind of small that makes me re-read everything else."* — Tomáš

Ships with #2 as the honest half of the same promise. **Build**, small.

### 10 · `[B]` A dated ETA with no basis — `DANA-L1-001` (**recurrence 2**), `DANA-L1-002`
Both resolved **`uncertain — not reproducible on this host`**, which is the correct outcome, not a
gap: L2 generated six board PDFs and **not one contains a `Trajectory:` line** (`forecastTrajectory`
returns null below 2 distinct calendar days; `seed-org.mjs` scans in a single pass). The L1 finding
stands on executed code — the low-data fix **nulls `forecastConfidence`**, so the hedge is *omitted*
rather than replaced.

> *"That is not more honest. That is quieter. A number with a bad hedge invites scrutiny; a number
> with no hedge invites belief."* *"Shown 'L4 by August 13th' on a board slide, I'd have said it out
> loud."* *"Whoever wrote that comment — 'the trajectory headline still renders, just without a
> bogus confidence' — knew, and shipped it anyway."* — Dana

She supplied the fix shape herself: a **basis clause on the same line**, not a tooltip — *"L4 by
mid-October, fit over 9 scan days across 84 days."* **Build** the basis line; it is unblocked by the
fixture gap because it is a rendering change. Ranked here, not higher, because it cannot be
*recertified* until the fixture exists (see §3).

### 11 · `[B]` Small honesty/reachability items — batch
- `TOMAS-L1-03` — the scan dialog promises "about a minute"; the app's own calibration says
  100–330 s. *"the entire budget, missed by 3x… somebody there clearly knows."*
- `TOMAS-L1-06` — Enterprise is the only tier that fits his org and has no way to reach it.
  *"the inverse: a price I can't act on."*
- `TOMAS-L1-04` — `/about`'s ROI simulator is eight fabricated numbers. *"Take it out or label it —
  the register of real repos does more for you than that simulator ever will."*
- `TOMAS-L1-05` — a configured-but-empty DB renders a zero-row ranking table under a real heading.
- `SAM-L1-05` — the mandated invitational voice buries the move. His fix: a per-item **"first step"**
  field. *"I don't need to be asked whether I'd like my supply chain not to be compromised."*
- `SAM-L1-06` — "Flagged for review" lists the auditor's claims but never what each one *did*.
- `SAM-L1-08` — `scoreLabel` covers 4 of 6 providers.
- `TOMAS-L1-07` — the landing deck has no pricing section and a header comment claiming otherwise.
- chore — `resolveTextRunnerForOrg` (`llm/text-org.ts:28`) has no production caller (dead seam).

### 12 · `[C]` Give the model a comparison class and a history — convergence, Sam + Dana + Tomáš
Three Characters independently named the same two absences, none of which cleared the finding bar:
**prior scans / score history** (Sam: *"It can score a snapshot; it can't testify to a trajectory"*;
Tomáš: *"His question is directional, not a snapshot"*) and **peer/industry cohort context in the
FACTS payload** (Dana: nothing tells the model what "L3 · Augmented" means against DORA/DX norms;
Tomáš: *"a score with no comparison class is a number he can't defend upward"*). Sam adds a third:
a **full file-tree manifest** — *"the model has no map of its own blind spot"* — directly implicated
in the live D9 discrepancy.

All three change the **grounding denominator**, which is a scored instrument of this method; changing
it casually would invalidate cross-run comparison. **Concept-doc** in
`docs/features/scanning/maturity-model.md` (denominator change + prompt-budget trade-off), then a
journey so the next run certifies it.

### 13 · `[C]` `DANA-L1-005`/`-009` — the briefing narrative bypasses `src/lib/llm/`
POSTs the fleet briefing straight out, and the seam that would fix it (`resolveTextRunnerForOrg`) has
no caller. Both are gated off on this host (`BRIEFING_NARRATIVE` and `ANTHROPIC_API_KEY` absent) and
were declared as preconditions *before* browser time was spent. Egress-path design with a live
security dimension → **concept-doc** (`docs/features/org-dashboard/`), not a blind patch.

### 14 · `[D]` The fleet Overview has no trajectory at all — `DANA-L1-004` · **declined for now**
Adding a trajectory to Overview before #10 lands would multiply the exact defect #10 describes across
one more surface. Dana's own read is that the product is *"most careful where it matters least"* —
the answer is to make the careful hedging travel, not to add another unhedged ETA.
**Revisit after #10 ships and recertifies.** New evidence required to reopen: a Character who needs
the trajectory *on Overview specifically* after the basis line exists.

### 15 · `[D]` The ~8% prompt cap — `SAM-L1-07` · **declined as a defect, recorded as a ceiling**
Tomáš independently audited the same number and **acquitted it**: *"the model isn't reading 8% of the
repo and guessing; it's narrating a fully-computed signal set and sampling 22 KB for texture… The
pitch survives."* Two Characters, opposite verdicts, and the acquitting one did the arithmetic. What
*is* actionable is the mislabel inside it — the confidence chip measures **fetch** coverage, not
**prompt** coverage — folded into #8. Reopen only with evidence that the sample size changes a score.

### 16 · `[D]` "Someone in my role must read the board PDF aloud before it ships" — Dana's process ask · **declined as a code item, recorded as method**
> *"Not test it — read it, out loud, as if to a board."*

There is no human in this loop to assign it to; that is the premise of this repo. The honest response
is that **`/uat` L2 *is* that read** — this run is the first time anyone read the PDF end to end, and
it produced items 3 and 10. Recorded as a standing method commitment: **any change to the briefing
PDF re-runs Dana's journey before merge.** Not a backlog ticket.

### 17 · `[D]` `/launch` is unreachable and invisible · **declined**
Not linked from `MARKETING_NAV`/`FOOTER_LINKS` and prompts anonymous sign-in. No Character's job
touches it; Tomáš tagged it `unreachable` and filed nothing. Reopen with a Character who needs it.

---

## Strengths → do-not-touch guardrails

Phrased as constraints on the build items above, not as compliments.

1. **The model overturns the app's own detector, in public.** The live `discrepancies` block argues
   D9's "Signed releases 0/10" is a false negative (`id-token: write` + npm ≥11.5.1 OIDC trusted
   publishing). Sam: *"I've never had a tool argue with itself in my favour… That single block did
   more for my trust than the entire score ring."* Tomáš: *"Every vendor I've bought from would have
   hidden that."*
   → **Constraint on #3, #6, #8:** no "clean up the report/PDF" pass may remove, collapse, or
   soften LLM-vs-detector disagreement. Item #3 fixes a *label*, never by deleting the −6.
2. **The roadmap is countable, not generic** — *"0 of 8 Action references pinned to a SHA"*, *"56% of
   merged PRs carry an approving review despite a ruleset requiring one"*.
   → **Constraint on #11 (`SAM-L1-05`):** the "first step" field is *additive*. No templating pass
   may flatten a counted evidence line into a catalogue item.
3. **Adoption is separated from rigor structurally**, per-axis at `POSTURE_THRESHOLD=50`, with
   cohort-matched deltas. Dana: *"structurally incapable of letting seat count masquerade as
   maturity. **Do not touch it.**"*
   → **Constraint on #3:** relabelling denominators must not merge the cohort-matched scope into the
   fleet-wide one. Four scopes is the bug; three scopes with three labels is the fix.
4. **The one recommended move refuses to emit a number the data can't support**
   (`OrgLeverageMoves.tsx:12-18`). Dana: *"the single most senior thing in the whole product."*
   → **Constraint on #10:** the basis clause must degrade to *absence*, never to a fabricated basis.
5. **The score is structurally defended against its own model** — ±25 guardband, deterministic D9 the
   prompt is told is ignored, an **all-or-nothing** 2-dimension discrepancy budget, untrusted-content
   fencing, refund-not-cache on degrade.
   → **Constraint on #7:** any response to "the model only moved it 2 points" that *widens the
   guardband* or gives the model more latitude is forbidden. The budget stays all-or-nothing; D9
   stays deterministic. The answer to #7 is presentation, never latitude.
6. **D2 samples test *bodies* and docks 15 points for assertion theater**, with the count in the
   `detail` string. Sam: *"the one place the product refuses to grade on presence."*
   → **Constraint on #4:** the evidence-sourcing work extends `detail`; it must not replace the one
   detector that already populates it, and must preserve the assertion-substance sample.
7. **The scan wait is honest** — six named stages, provider-named, monotonic, elapsed-clocked, an
   estimate defaulting to the *slowest* provider so resolution can only speed the bar up.
   → **Constraint on #11 (`TOMAS-L1-03`):** fix the *dialog's* "about a minute", do not touch the
   progress component that is keeping that finding at `major` instead of `blocker`.
8. **Pricing is numeric, one click from the landing page, and no tier routes an anonymous visitor
   into a form**, with prices derived from the same `PLAN_FEATURES` the entitlement layer reads.
   → **Constraint on #2, #9, #11 (`TOMAS-L1-06`):** the Enterprise contact path is *added*; no
   "talk to sales" experiment may appear on the Pro/Team cards, and no auth may move in front of
   pricing.
9. **The engine-mix caveat reaches the board PDF verbatim.** Dana: *"Nobody makes a product volunteer
   that its own numbers are half-synthetic unless they care about being believed."*
   → **Constraint on #3:** PDF edits keep the caveat in the body, not a footnote.

---

## 3. Methodology lessons

v1.3 and v1.4 already encode this run's method lessons (recurrence ranking, the L1/L2 voice pair, the
precondition declaration, the shared grounding denominator). **Not re-recorded here.** What remains
is repo-local and drain-local:

1. **`env.md` fixture gap, concrete and blocking two findings.** `DANA-L1-001`/`-002` need an org
   whose rollup yields a *non-null* forecast that still flags `lowData`. Six board PDFs, zero
   `Trajectory:` lines — the fixtures **cannot produce a forecast at all** because `seed-org.mjs`
   scans an org in a single pass. Required: **a seeded org with ≥3 scans of one repo across ≥2
   calendar days (≥14-day span for `DANA-L1-002`)**. Until it exists, §2 #10 can ship but cannot
   reach `resolved-verified` — which is exactly the state v1.2 invented `uncertain` to name.
2. **`resolution` is still sparse in this run's `findings.json`.** Two rows carry a closed resolution
   and five carry `open`; the remaining thirty carry `null`, so §1 was reconstructible but §2's
   ranking leaned on prose more than JSON. Repo-local ask for the next run: emit `resolution` on
   **every** row, including the plain `open` ones.
3. **Where drain artifacts live is now decided** and was not before — `uat/README.md` documents the
   run layout but never named an analysis-doc home, a backlog file, or a concept-doc home, which is
   why five prior runs were never drained. Recorded in `uat/README.md` in this same change.
4. **The strongest instrument in the run was a control arm, not a walkthrough.** `signalScore`
   beside `llmScore` turned "does the AI do anything" from an opinion into a table
   (`_L2-control-arm-llm-vs-signal.md`). Repo-local note: ascent persists unusual amounts of
   provenance, and future L2 passes should look for a persisted counterfactual **before** reasoning
   about one.
5. **The run's own orchestration error is recorded in the artifact and should stay there.** A
   "recurrence lead" asserted `briefing.ts:393` renders the headline unconditionally; line 391 guards
   it. The lead was retracted mid-run and the walker then found a sharper real defect. Keeping the
   retraction in the report is what let this drain trust the rest of it.
