# L1 (theoretical) — Marcus (Engineering Manager) × "Understand my team"

cert_level: L1 · date: 2026-07-16 · surface: `/org/[slug]/contributors`, `/org/[slug]/delivery`, `/org/[slug]/adoption`, `/org/[slug]/repositories`, `/report/[owner]/[repo]`

---

## 1. Surface model (import-chain-verified)

### Reachability gate (resolved before judging)
- `src/app/org/[slug]/layout.tsx:39-222` — org shell. Under the UAT env (`ASCENT_AUTH_BYPASS=1`, DB configured, seeded org with repos), Marcus reaches every non-personal-workspace org tab: `isDbConfigured()` (48) → auth-gate bypassed via `getViewer()` (58) → `canReadOrg(slug)` (84) → non-empty `summary.repoCount` (144). Since a real Marcus-shaped org is org-kind (not personal), **all six Intelligence-group tabs (`Security · Adoption · Delivery · Contributors · Teams`) are in his reachable set** — `src/components/org/shared/OrgNav.tsx:77-89`, gated only by `kind !== "personal"` (`OrgNav.tsx:123-130`, `PERSONAL_SEGMENTS` excludes adoption/delivery/contributors/teams for personal only).
- `/report/[owner]/[repo]` reachable for any of his teams' repos once scanned; falls back to `ColdScanGate` if unscanned (`src/app/report/[owner]/[repo]/page.tsx:111`) — out of scope per the journey (seed already has scanned repos).
- **Verdict: full reachable surface set = the designed one.** No nav/entitlement gap found for this Character.

### Affordance → code chain

**A. Contributors tab** (`src/app/org/[slug]/contributors/page.tsx`)
- Summary tiles: Contributors / AI-active / Org AI commit share / Solo-maintainer repos — `getContributorInsights()` (`contributors/page.tsx:217-218` → `src/lib/db/org-contributors.ts:49-…`), pure DB aggregation over `RepoContributor` rows, no LLM.
- `ChampionsGrid` (`contributors/page.tsx:18-44`) — renders only when `insights.totalContributors >= CHAMPION_MIN_POP` (=3, `src/components/org/shared/champions.ts:7`, gate at `contributors/page.tsx:251`). **Line 30**: `<span>#{i + 1} ★</span>` — an explicit numbered-rank badge next to each named contributor's login.
- `IndividualInvolvement` (48-121) — per-person table, **opt-in** behind a collapsed `<details>` (60), labeled "names individuals — expand" (65), framed "not performance evaluation" (72).
- `ConcentrationTable` / bus factor (123-199) — `r.busFactor`, `r.soloMaintainer` computed in `org-contributors.ts` (`RepoConcentration` interface, lines 25-34: busFactor = "# contributors needed to cover >50% of commits", soloMaintainer = 1 contributor or top ≥80%). Solo-maintained rows get a `DecisionControl` (181-189) keyed by **repo `fullName`**, never by login — accept/dismiss/snooze, framed as risk-to-explore per the file's own comment (123-125: "a DECISION... never a directive aimed at a named engineer").

**B. Adoption tab** (`src/app/org/[slug]/adoption/page.tsx`, `src/lib/org/adoption.ts`)
- `buildAdoptionOverview()` (`adoption.ts:73-145`) joins `getContributorInsights` + `getOrgPrSignals` + `getOrgTeamRollup` — pure deterministic assembly, **no LLM call on this page**.
- `ChampionsCard` (`adoption/ChampionsCard.tsx:38-51`) — same "champions" concept as Contributors' `ChampionsGrid`, but rendered as a plain meter list with **no `#N ★` rank badge** — and gated by the same `CHAMPION_MIN_POP` with an explicit suppression message when below it (31-34: "Too few contributors to surface champions without it reading as a ranking").
- `TeamAdoption` (`adoption/TeamAdoption.tsx:59-67`) — the one grounded, team-level, cite-able move: "Suggested pairing" (leader team X% → learner team Y%, gap ≥ `PAIRING_MIN_GAP`=15, `adoption.ts:67,110-118`). Concrete, cited, not generic.
- `EnablementTargets` (`adoption/EnablementTargets.tsx`) — names individuals, opt-in `<details>`, gated by the same population floor (`adoption/page.tsx:64`).
- "Copy for LLM" button (`CopyForLlm`, `adoption/page.tsx:76`) exports `adoptionMarkdown()` (`adoption.ts:148-196`) — **this is not an Ascent-generated AI surface**; it hands Marcus a grounded brief to paste into his own LLM. No prompt/grounding to score on Ascent's side here.

**C. Delivery tab** (`src/app/org/[slug]/delivery/page.tsx`)
- `DeliveryPriorities`, `PrSignalsBand`, `GovernanceTable`, `DeliveryActivityChart` — all deterministic, real git/PR data (`getOrgPrSignals`, `getOrgGovernance`, `getOrgActivity`, lines 30-38).
- `AiDeliveryModule`/`AiRoiLedger`/`AiRoiQuadrant` (`src/components/org/delivery/ai/*`) — AI spend fidelity is one of `measured|allocated|simulated` (`aiDeliveryModel.ts:16,117`); when `simulated` (no provider connected — the default), dollar cells are **locked/dashed** and badged "sample spend" (`aiShared.tsx:24`, `AiRoiLedger.tsx:52-112`). Provenance is disclosed but lives in a small badge/tooltip, not headline text.

**D. `/report/[owner]/[repo]` — the AI surface** (`src/lib/scoring/prompt.ts`)
- `buildAssessmentPrompt()` (152-…) assembles the USER message from: `signals` (per-dimension deterministic scores + evidence, 158-165), `files` (repo file excerpts up to a 22k byte window, 176-183), `commitSample`, `archetype`, `prStats`/`governance` (`processBlock()`, 20-46), `securityAssessment` (`securityBlock()`, 54-64, explicitly non-re-scorable, narrative-only), `stackFit`, `techStack`, and `orgDecisions` — standing org decisions rendered so the model doesn't re-raise a dismissed finding (`decisionsBlock()`, 98-103). SYSTEM prompt (66, 109-150) enforces evidence-grounded scoring, an auditor "discrepancies" pass, and **invitational, non-directive roadmap phrasing** ("explore" not "add"; TASK block 115-124).
- **Grounding audit: 8/8 real context sources reach the prompt** — signals, file excerpts, commit sample, archetype, PR stats, branch governance, security assessment, tech stack, and standing org decisions. This is the strongest-grounded surface in the journey.

---

## 2. In-character walkthrough (theoretical, over the designed model)

I land on `/org/<my-org>/contributors` first — that's where "who's a bus-factor risk" lives, and it's Thursday-before-the-skip-level energy.

Tiles load fast: Contributors, AI-active %, org AI commit share, solo-maintainer count. Good — that's a number I could say to Dana in one sentence, and it comes with a footnote about the commit window it reflects. Fine so far (JTBD #1, partially — I'd actually want this framed org-wide first, see below).

Then — three or more contributors, so the champions grid renders. And there it is: **"#1 ★"** next to a name, with commit counts under it. I said this line myself in the reference materials I've read: "if this ranks my people, I close the tab." This is *literally* that. It's dressed as "exemplars," and the section header even says "whose approach the team could learn from" — but the badge itself is a scoreboard. I don't actually close the tab today (my JTBD is too pressing), but I notice it, and it's the first thing that makes me trust this less. If I screen-shared this with Dana or, worse, one of my engineers saw it over my shoulder, that's the surveillance-vibes pet peeve, verbatim.

Interestingly, when I later drift to the Adoption tab, the "AI champions" card there shows the *same underlying data* — a meter list, no rank number. So the product actually agrees with me about how to frame this... on one tab and not the other. That's confusing: which one is "the" champions view?

Bus factor / concentration table is genuinely good — this is exactly what I need. Repo, contributor count, top contributor's share, bus factor number, and a "key-person" chip on the risk rows. It's framed as a DECISION I can accept/dismiss/snooze, keyed to the *repo*, not a person's name in an action column. I could screenshot this table for planning without naming anyone. This clears my #2 criterion cleanly.

Individual involvement is opt-in and collapsed by default, labeled "names individuals — expand," explicitly "not performance evaluation." That's the right default. Good restraint.

Delivery tab: PR signals, governance, commit activity — all real numbers with repo-level breakdown, "riskiest first." The AI ROI dollar figures are locked and badged "sample spend" when nothing's connected — which is my org today, most likely, since we're mid-rollout with no billing connector wired. I appreciate that it doesn't just show me a confident-looking dollar figure that's actually a hash placeholder — but the disclosure is a small badge, and I can imagine grabbing a screenshot of "Idle spend $X/mo" for a planning doc without registering the badge. That's a slower kind of trust erosion than the champions ranking, but the same family of problem: something I could accidentally overclaim to Dana.

Adoption tab gives me exactly one team-level move I'd actually raise in a retro: "Team A (72%) could mentor Team B (31%) — a 41-point gap." That's specific, cited, and not "add more tests." Clears my #4 criterion.

The single-repo report (once I click through from the delivery per-repo table) reads like a peer's assessment — dimension scores tied to concrete evidence (PR stats, branch protection, security checks), a roadmap phrased as things to explore, not orders, and it explicitly won't re-raise something I've already dismissed with a reason. That's the senior-quality bar met, and grounded better than almost anything else in the app.

## 3. Findings

- **F1 — MAJOR — trust/pet-peeve — Contributors tab renders a numbered "#1 ★" rank badge on named individuals**
  - `file:line`: `src/app/org/[slug]/contributors/page.tsx:29-31` (`<span>#{i + 1} ★</span>` inside `ChampionsGrid`)
  - `type`: trust · `severity`: major · `dimension`: trust
  - `impact`: frequency=high (renders by default the moment a real org clears 3 contributors — every EM-shaped org), reachability=high (Contributors is one of the journey's two named entry points, no gating beyond population), trust_erosion=high (this is a verbatim match to the Character's declared pet peeve: `"Individual leaderboards, '#1 ★', or anything that invites him to rank people. Instant tab-close."`)
  - `code_check`: present-but-broken (the component exists and functions as designed — the design itself is the defect, not a bug)
  - `verdict`: confirmed
  - `l2_priority`: does the live rendering read as softer than the code suggests (smaller type, secondary placement), or does it visually read exactly as a leaderboard rank? Would a live Marcus actually react as predicted, or does surrounding copy ("exemplars," "learn from") sufficiently reframe it in practice?
  - `suggested_acceptance`: none yet — recommend dropping the `#{i+1}` ordinal (the Adoption tab's `ChampionsCard` already proves the same data reads fine as an unranked meter list) to make the two "champions" surfaces consistent and pet-peeve-safe.

- **F2 — MINOR (reconciliation) — Two "AI champions" surfaces disagree on ranking framing for the same concept**
  - `file:line`: `src/app/org/[slug]/contributors/page.tsx:18-44` (ranked, `#N ★`) vs. `src/app/org/[slug]/adoption/ChampionsCard.tsx:38-51` (unranked meter list, same population gate)
  - `type`: confusion · `severity`: minor · `dimension`: clarity/trust
  - `impact`: frequency=med (only noticed if he visits both tabs, which the journey's discovery hints say he plausibly does), reachability=high, trust_erosion=med (undermines confidence that the product has one consistent stance on "is this a ranking")
  - `code_check`: confirmed-present (two distinct components, verified above)
  - `verdict`: confirmed
  - `l2_priority`: confirm both render as observed; check whether either page's copy is edited independently in a way that would drift further.

- **F3 — MINOR — AI-spend simulated-figures disclosure is a small badge, not headline-level**
  - `file:line`: `src/components/org/delivery/ai/aiShared.tsx:24` (badge text/tooltip), `src/components/org/delivery/ai/AiRoiLedger.tsx:52-112` (locked/dashed cells)
  - `type`: trust · `severity`: minor · `dimension`: trust
  - `impact`: frequency=med (only surfaces on the Delivery tab's AI ROI module, and only matters when he'd screenshot/quote a dollar figure), reachability=high, trust_erosion=med (this is exactly the "metrics with no provenance he couldn't defend to Dana" pet peeve, though the code *does* disclose provenance — just not prominently)
  - `code_check`: present-but-missed-by-glance (the mechanism is correct and honest; the finding is about discoverability, not absence)
  - `verdict`: confirmed
  - `l2_priority`: in a live screenshot/skim, does the "sample spend" badge register before he'd act on the number? Test with a quick skim, not a careful read.

- **F4 — STRENGTH — `/report` LLM prompt is comprehensively grounded**
  - `file:line`: `src/lib/scoring/prompt.ts:152-183` (8 distinct real-context sources reach the prompt: signals, file excerpts, commit sample, archetype, PR stats, governance, security assessment, tech stack, standing org decisions)
  - Directly satisfies the senior-quality bar and the "faster than his GitHub afternoon" criterion for the single-repo read.

- **STRENGTH — Bus-factor/concentration table cleanly separates risk-to-explore from a directive-at-a-person**
  - `file:line`: `src/app/org/[slug]/contributors/page.tsx:123-199`, `DecisionControl` keyed by repo `fullName` not login (181-189)
  - Clears acceptance criterion #2 as designed.

- **STRENGTH — Champion/enablement small-population guard is real and applied consistently to the *content* (if not the *framing*, see F1/F2)**
  - `file:line`: `src/components/org/shared/champions.ts:7` (`CHAMPION_MIN_POP = 3`), applied at `contributors/page.tsx:251`, `adoption/ChampionsCard.tsx:31`, `adoption/page.tsx:64`
  - Clears acceptance criterion #3's "small-population vanity metrics suppressed" half.

---

## 4. Character voice — would I adopt it?

Mostly, yeah — with one thing I'd flag before I'd trust it fully. The bus-factor table alone is worth the price of admission; that's a real afternoon back, and I could paste that concentration table into planning without naming anyone, which is the whole point. The single-repo report reads like something a competent staff engineer wrote, not a template — it cites real PR and governance numbers and it doesn't repeat a gap I already told it "we know, it's a docs mirror" about.

But that "#1 ★" on the Contributors tab bugs me, and it bugs me *because the same product clearly knows better* — the Adoption tab shows the exact same "champions" concept without the rank number. So somebody on this team already made the right call once and it didn't propagate everywhere. If I'm demoing this to Dana and she lands on Contributors first instead of Adoption, that's the surveillance-scoreboard alarm going off in her head, not mine, and I don't get to control which tab she clicks.

The simulated-spend badge is the kind of thing I'd only catch because I read fine print for a living — most EMs skimming a Delivery tab before a meeting would screenshot "$4,200/mo idle spend" and not notice it's a hash placeholder. That's not lying to me, but it's a landmine for the next guy who forwards my screenshot without the badge.

Net: I'd use this for the bus-factor read and the single-repo report today. I'd hold off showing the Contributors tab to Dana until the champions ranking gets fixed — that one specific screen is the one place this product still smells like the dashboard that burned me at my last job.
