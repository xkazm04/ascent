# Priya (Platform/DevEx Lead) — set-and-enforce-the-standard — L1 (theoretical, code-grounded)

Run: 2026-08-30-moonshot-cert · pair #5 · walker: L1, no browser · repo @ branch
`fix/gate-lint-unescaped-entities-20260827` (moonshot waves 1–4 on master `fca0c742`)

Moonshot surfaces in scope: **#13** manifest-as-scan-input + capability matrix · **#16** doctor
check-id ledger + control matrix + gate `requireChecks` · **#35** foundation pr-batch +
self-provisioned report-back secrets · **#15** guidance projections (`maintain.mjs project`, doctor
drift check, consolidate-guidance starter) · **#33** rollout strip.

---

## 1. Surface model (code-derived, file:line)

My afternoon, mapped to what the tree actually holds:

**Author / adopt the standard (#35, #13 generation half)**
- Batch install: `POST /api/report/foundation/pr-batch` — `src/app/api/report/foundation/pr-batch/route.ts:90`
  (`requireOrgRole(org, "admin")`), `MAX_BATCH = 25` (`:34`), per-repo isolation via
  `openFoundationPrBatch` (`src/lib/standard/pr.ts`, pool-bounded, one repo's failure never aborts).
- Report-back secrets: `POST/DELETE /api/report/foundation/secrets` —
  `src/app/api/report/foundation/secrets/route.ts:115` (`requireOrgRole(org, "owner")`), typed
  confirmation of the full `owner/repo`, **one repo per confirmation** (`:96-100`), confirm checked
  *after* the role gate so a 400 leaks nothing (`:118-121`). URL derived server-side from request
  origin. Sealed-box writer `src/lib/github/actions-secrets.ts` — name allowlist **in the type**
  (`CONFORMANCE_SECRETS`, two fixed names), 403 → "The installation lacks Secrets write access"
  (`secrets/route.ts:173`).
- UI: `FoundationRolloutPanel` mounted at `src/features/standing/repositories/RepositoriesTab.tsx:61`
  fed by `getFoundationRollout` (`src/lib/db/org-foundation.ts:64`, audit-derived, `conformance:
  null` = "never reported", legend at `FoundationRolloutPanel.tsx:169-171`). Wizard done-phase panel
  `OnboardingFoundationPanel` (mounted `OnboardingScanStep.tsx:5`) **discloses both secret names and
  the App's `Secrets: write` permission before any request** (`OnboardingFoundationPanel.tsx:86-89`).
- Permission disclosure in docs: `docs/features/github/setup.md:32` (Secrets row, "Read & write
  (optional)"), `docs/features/github/github-app.md:193-232` (report-back subsection: two allowlisted
  names, owner-gated, reversible).
- Getting-started checklist: `foundation` + `conformance` steps (`src/lib/org/getting-started.ts:29-56,150-152`),
  admin-only, anchored on the Repositories tab — the discoverability aid from my entry points.
- Generation reads its own output: `buildManifestData(report, { observed })`
  (`src/lib/standard/manifest.ts:107-193` — observed command/purpose/paths/boundaries/agents/controls
  all win over guesses; `verified` survives regeneration); `resolveStack` prefers the manifest
  (`src/lib/onboarding/stack.ts:33,75`, `source: "manifest"`); the skill gains
  `## What this repo has already proven` (`src/lib/onboarding/skill.ts:63,157,176`).

**Watch conformance come in (#16)**
- Doctor emits stable check ids; vocabulary + `parseCheckId` in `src/lib/standard/check-ids.ts:14-63`
  (families include `guidance` — #15's drift checks joined the same ledger; `standard.test.ts`
  asserts every emitted id is a member).
- Matrix read: `GET /api/report/conformance/matrix` — `route.ts:30` `requireOrgRead(org)`, 503
  without DB (`:24,45`).
- UI: Passports switcher 4th variant `controls` (`PassportsSwitcher.tsx:73`);
  `ControlMatrixPanel.tsx` — headline copy "A clause a run did not judge shows as 'not judged' —
  never as passing" (`:26`); `ControlCell.tsx:14` renders `unchecked` as a dashed "—";
  worst-level family folding with `unchecked` outranking `pass` (`controlMatrixView.ts:35-37`);
  `since: null` → em dash, never guessed (`:95-97`); `summaryOnly` rows counted and stamped.

**See capabilities fleet-wide (#13 read half)**
- Fetch actually carries the manifest: `src/lib/github/source.ts:793-796` (`.ai/manifest.yaml` +
  guardrails, landed on W1-A's behalf — the W1-B handoff that made the whole item live).
- Compose → persist → rollup: `scan-compose.ts:121` (`report.manifest = buildManifestReadout(...)`,
  display-only, never in the prompt), `org-rollup.ts` parse, `PassportsTab.tsx:99,116` feeds the
  matrix.
- `CapabilityMatrix.tsx` — cell states verified/declared/placeholder/absent (`capabilityAgg.ts:12-24`;
  placeholder deliberately outranks a claimed "verified": `:62-64`), `failed` overlay ("its last
  doctor run FAILED", `CapabilityMatrix.tsx:30,42`), `wiredAt` as solid/dotted underline
  (`:23-28`), unbacked-controls amber chip (`:113-115`), **unassessed band below the table, out of
  every denominator** (`:126-134`, `capabilityAgg.ts:4-7`).
- Autonomy gate consumes it: `autonomyGateBuilders.ts:128-136` — +10 presence, +8 × verified/declared,
  `source` flips `"mock"` → `"scan"` when a readout exists (`:159`).

**Keep guidance coherent (#15)**
- Manifest `guidance` block generated from the arbiter's verdict (`manifest.ts:78-92,179`; omitted
  when nothing was nominated — no fabricated authority); `maintain.mjs project` renders declared
  projections under a two-hash provenance header (`src/lib/standard/maintain.ts:143-171`); doctor
  drift check distinguishes BEHIND (warn) from HAND-EDITED (fail), no-block = `unchecked` — "a repo
  that has not adopted it is not failing it" (`doctor.ts:264-311`).
- Coherence surfaces: `GuidanceCoherenceCard` mounted in `ContextHealthPanel.tsx:17,30` — mean
  coherence, "Contradicting" fleet tile, "Not assessed — excluded from every share", contradictions
  quoted with both paths; pre-r11 rows render "not assessed", never 0.
- `consolidate-guidance` starter in `src/lib/practices.ts:150`; drift/rollout strip mounted
  (`PracticesTab.tsx:123`, `/api/practices/rollout` exists).

**Enforce (#16 → gate)**
- `GatePolicy.requireChecks` fully landed in all four evaluator places: `gate.ts:90` (field), `:306-308`
  (sanitize, id-regex + cap), `:456-458` (evaluate), `:693-694` (union-merge tighten);
  `describeGatePolicy` carries it into the query/snippet; the route reads the ledger **only when a
  check is named** (`route.ts:252-256`), ledger read failure = skip, not fail
  (`gate-admission.ts:70-79`). Three honest-null skips documented at `docs/features/scanning/gate.md:250-258`.
- **No editor surface**: `GatePolicyEditor.tsx` offers minLevel / floors / D9 / postures /
  protection / AI-governed — zero hits for `requireChecks` anywhere under
  `src/features/standing/governance/`. The doc says so, plainly:
  `docs/features/scanning/gate.md:379` — "**`requireChecks` has no editor surface yet.** … today it
  can only be set by writing `Organization.gatePolicy` directly."
- One-policy plumbing: org policy is the server-side baseline, params are a tighten-only overlay
  (`route.ts:183-250`, `gate.md:85-100`); the CI snippet is single-sourced (`ciActionYaml`,
  `src/lib/org/governance.ts:206`) and bakes the *current* policy as explicit params
  (`gateQuery`, `:74-78`).

## 2. Reachability (computed before judging)

Under the run env (bypass auth + PGlite + auto-seeded **owner** membership on second `/org/<slug>`
visit): Governance, Passports (all four variants), Repositories rollout panel, Practices strip,
wizard — all reachable. `pr-batch` needs admin (owner ⊇ admin: reachable), `secrets` needs owner +
typed confirm (reachable up to the dialog). **The actual secrets write and batch PR need the GitHub
App configured with the new `Secrets: write` permission — almost certainly NOT satisfiable on the L2
host** (dev PGlite, no App installation); both routes 403/503 honestly before any write
(`isAppConfigured` gates, disclosed error strings). The capability/controls matrices additionally
need a scanned repo that *carries* `.ai/manifest.yaml` and a doctor that has *reported* — neither is
true of the default seed org, so L2 will mostly see the honest-empty states (which are themselves
worth certifying).

## 3. Walkthrough — my afternoon, in order

**Author & roll out.** I come in from `/org/acme/practices`, poke around, and the tour checklist
(OrgShell) hands me `foundation` → Repositories tab. The rollout panel is exactly the shape I killed
Backstage for not having: one row per repo, *install PR* / *report-back* / *conformance*, with a
legend that says "—" is **never reported, not 0%**. The bulk bar opens ≤25 draft PRs; a repo with no
saved scan fails alone with a reason. The secrets flow is the part I'd have expected to be sloppy and
isn't: owner-only where the batch PR is admin (the blast-radius reasoning is written into the route
comment), one typed `owner/repo` per write so the confirmation isn't theatre, URL derived from the
origin so nobody points my fleet's CI at their own host, two type-allowlisted secret names, DELETE
that also revokes the token. The wizard panel names both secrets **and** the App permission before
any request. That's a provisioning flow I'd ship under my own name. *"Okay, that's actually
shippable."*

**The standard itself.** My generic-template allergy test: `buildManifestData` with an observed
readout keeps the repo's own commands, purpose, boundaries, and — critically — the doctor's
`verified` proofs across regeneration; the onboarding skill quotes the manifest's commands
(`source: "manifest"` — "the maintainer's answer rather than our inference") and adds a "What this
repo has already proven" section that refuses to fabricate proof when there's no readout. Placeholder
outranks "verified" in the matrix cell because an unfillable command cannot have been proven. This is
the opposite of the boilerplate I feared.

**Watch conformance come in.** The control matrix is sourced from *my repos' own CI* — the framing
("proven in your own CI", "not a remote scanner's opinion") is precisely the anti-mandate posture I
need with my staff engineers. Four cell states with `unchecked` as a first-class outcome, summaryOnly
reporters visibly stamped, since-dates never guessed. The denominators are honest everywhere I
poked: unassessed repos out of every share, `conformance: null` ≠ 0, fleet pass-rate divided by
*judged* repos with the unjudged bucket named (`governance.ts:175-190`). Nobody gets ranked; every
number reads as friction-to-remove. DX Core 4 bar: met.

**Keep guidance coherent.** The projection loop is complete and closed: arbiter nominates → manifest
declares → `maintain.mjs project` renders with two hashes → doctor distinguishes stale from
hand-edited → the finding lands in the same check-id ledger → the coherence card shows the
contradiction as two quoted lines. A contradiction withholds points, never subtracts — no stick.

**Enforce — and here the afternoon stops one step short.** The whole pipeline funnels toward "make
`control.prepush.test` a merge bar": the ledger exists, the evaluator exists, `requireChecks` is in
sanitize/tighten/describe/evaluate with three principled skips. But the Governance form doesn't offer
it. To actually enforce the standard I just rolled out, I'd have to write `Organization.gatePolicy`
by hand in the database. The gate doc discloses this honestly (gate.md:379) — but I read dashboards,
not feature docs, and the product itself never tells me the field exists. The red control cell has no
"make this a bar" affordance. A standard you can see but not enforce isn't a mandate war — it's a
mandate that hasn't started.

**One policy, no drift — mostly.** The org policy is the server-side baseline and params can only
tighten, so a PR author can't loosen my bar by editing the workflow URL — good. But the copyable CI
snippet bakes today's policy as explicit params, so when I later *relax* the bar, every
already-copied workflow keeps enforcing the old stricter one, and nothing in the UI warns me the
snippet is a snapshot. And the fleet Governance card renders "A required control is failing — 0
repos" as a live meter row when that zero is structural (the fleet path *cannot* judge it —
`governance.ts` says so in a comment the UI never repeats). Two surfaces that can disagree is my
trust trigger; here both disagreements are principled, but neither is disclosed where I'd hit it.

## 4. Findings

Impact = frequency × reachability × trust-cost. Adversarial pass applied; all evidence is file:line
above.

### PRIYA-L1-01 — `requireChecks` is enforced but un-settable in the product (missing-feature, major)
- **Type/severity:** missing-feature · **major** · verdict **confirmed-absent** (grep: zero hits
  under `src/features/standing/governance/`; disclosed at `docs/features/scanning/gate.md:379`).
- The journey's terminal step — enforce the exact controls the doctor proves — dead-ends at "write
  `Organization.gatePolicy` directly". The Governance form (`GatePolicyEditor.tsx`) has no
  requireChecks control, and no UI surface (not the editor, not the control matrix's red cells)
  mentions the field exists. The doc's disclosure is honest and exact; the *product's* is absent.
- **Impact:** high — every org that adopts #16 hits this the moment conformance data arrives;
  reachable by construction; trust cost moderate (the honest doc caps it).
- **Recurrence:** none — new surface.
- **l2_priority: HIGH.** Precondition: none beyond the seeded org — L2 verifies the editor's field
  list and that no affordance exists (negative check; no App needed).

### PRIYA-L1-02 — fleet Governance renders a structurally-impossible "0 repos" for control failures (trust, minor)
- **Type/severity:** trust · **minor** · verdict **confirmed** (`GovernanceFailReasonsCard.tsx:25-42`
  renders every `GOVERNANCE_FAIL_REASONS` row incl. `control` ("A required control is failing") and
  `admission`; `governance.ts` fleet path pins both to 0 by construction — `evaluateGateLite` has no
  ledger/PR inputs, per its own comment "these stay 0 honestly, because the criteria were never DUE
  here").
- The comment's honesty never reaches the screen: a lead whose org sets `requireChecks` (today: DB
  write) sees "0 repos" failing control on the dashboard while the per-repo CI gate blocks PRs on
  exactly that. My "works on the dashboard" argument, shipped as a feature.
- **Impact:** low today (gated behind L1-01's absence of an editor), high the day the editor lands —
  fix should travel with it. Suggested shape: render "not judged fleet-wide" instead of a 0-meter for
  criteria `evaluateGateLite` skips by construction.
- **l2_priority: MEDIUM.** Precondition: seeded org with ≥1 gate-failing repo (so the card renders
  rows) — satisfiable with the standard seed.

### PRIYA-L1-03 — the manual-secrets copy survives at both points of need (confusion / path-to-green, minor)
- **Type/severity:** confusion · **minor** · verdict **confirmed** (spec #35 handoff 1 not landed:
  `src/lib/standard/wiring.ts:55-57` generated-workflow comment still says "Set
  ASCENT_CONFORMANCE_URL to … and ASCENT_CONFORMANCE_TOKEN to an org-scoped API token (Org Settings
  -> API tokens)"; `ControlMatrixPanel.tsx:40-46` empty state says wire the two secrets into CI —
  neither mentions that the Repositories tab provisions both in one click).
- The easy path exists and the copy at the exact moment of need still describes the hard path. My
  #1 rollout principle is "make the right thing the easy thing" — the thing *is* easy; the words
  aren't.
- **l2_priority: LOW** (copy verification only). Precondition: none.

### PRIYA-L1-04 — `schemaAhead` and parse `notes` are computed, persisted, rendered nowhere (quality-gap, minor)
- **Type/severity:** quality-gap (wiring audit hit) · **minor** · verdict **confirmed-absent**
  (`read.ts:165-166` computes + notes it; `readout.ts:121,136` persists; grep over
  `src/features/**`, `src/components/**`: zero consumers of either field).
- #13's spec promised "parsed leniently, **flagged honestly**" for a major-version-ahead manifest.
  The flag exists only in JSON: a fleet running a newer manifest schema than this Ascent deployment
  reads shows normal cells with no hint the reader is behind. Same for parse notes (incl. the
  redaction notes — an operator can't see that a command was redacted). By construction:
  `grep -rn schemaAhead src/features` = 0 hits.
- **l2_priority: LOW** (L1-provable; L2 adds nothing without a schema-1.x fixture repo).

### PRIYA-L1-05 — adoption state is split across tabs; the promised report-back column on the capability matrix never landed (confusion, minor)
- **Type/severity:** confusion · **minor** · verdict **confirmed-absent** (spec #35 handoff 2 gave
  W1-A "the foundation/report-back column on the Passports capability matrix, reading
  `getFoundationRollout`"; grep: `getFoundationRollout`'s only consumer is
  `RepositoriesTab.tsx:61`).
- My one fleet-adoption question ("where is the standard in/not in?") is answered across three
  surfaces: install+report-back on Repositories, declared-vs-proven on Passports › Capabilities,
  per-check state on Passports › Controls — with no cross-links between them (Practices tab has
  none either; the tour checklist is the only connective tissue). Each surface is individually
  honest; the join lives in my head.
- **l2_priority: MEDIUM** (navigation-path timing is an L2 measurement). Precondition: seeded org.

### PRIYA-L1-06 — a copied CI snippet pins the old bar when the org policy is later loosened (confusion, minor; leans by-design)
- **Type/severity:** confusion · **minor** · verdict **confirmed / by-design-leaning**
  (`governance.ts:74-78` bakes current policy into `gateQuery`/`ciWith`; `route.ts:183-250` +
  `gate.md:90` — params are a tighten-only overlay, deliberately, so an anonymous caller can't
  loosen the bar).
- Tightens propagate instantly (org policy is the server baseline — my "edit once, both change"
  criterion holds in the direction that matters). Loosens don't, for any workflow that pasted the
  snippet, and neither the Governance card nor the snippet itself says "these params are a snapshot;
  the server bar alone would follow your edits". The security rationale is right; the disclosure is
  missing. One sentence under the snippet fixes it.
- **l2_priority: LOW.**

### PRIYA-L1-07 — "Require checks" means two different things two tabs apart (confusion, polish)
- **Type/severity:** confusion · **polish** · verdict **confirmed**
  (`DeliveryGovernanceSection.tsx:19` — Tile "Require checks" = share of repos with branch-protection
  required status checks; `GatePolicy.requireChecks` = doctor-control merge bars).
- Once L1-01's editor lands, the same phrase will name a branch-protection rate on Delivery and a
  doctor-control bar on Governance. Rename the Delivery tile ("Required status checks") before then.
- **l2_priority: NONE** (fully L1-provable).

**Resolved-verified candidates for L2:** none of my brief's recurrence leads were mine to carry
(B-items are Dana/Sam/Tomáš); no prior Priya findings exist to re-certify — this is the character's
first walk of this journey.

## 5. Grounding — shared denominator

The journey's surfaces are almost entirely **deterministic** (per the overlay's table: practice
starters, manifest/skill generation, matrices, gate — "N/A — not an LLM surface"). The one live LLM
surface I depend on is **Surface A** (repo scan, whose D1-r11 claim facets feed the coherence
verdicts my card shows): **11/12** — item 7 (detected tech stack) is flag-gated off by default
(`scan-score-input.ts`). Named additions, not denominator changes: the **manifest readout** and the
**conformance ledger** are deliberately absent from the prompt (display-only pins, `scan-compose.ts:118-121`)
— for this journey that absence is a *trust feature*, not a gap: the declared-vs-proven read must not
be the model's opinion. D1's claim-layer verification (guidance-file allowlist, two-citation facets,
contradiction-at-zero-points) grounds the one LLM-touched number I surface fleet-wide.

**Grounding score: 11/12** (Surface A, tech-stack flag off), with the two named honest exclusions.

## 6. Time-saved

My traditional way: 2–3 weeks authoring the standard doc with staff engineers, then ~1 day per repo
of manual conformance review, re-run on every revision of the bar. For a 25-repo fleet: ~4–6 weeks
initial, ~5 person-days per revision, permanently stale between passes.

The designed flow: generate + review the repo-specific standard in minutes (and it survives my
edits — `observed` wins on regeneration), one afternoon to batch-install and provision report-back,
conformance then arrives continuously from each repo's own CI with zero re-audit cost. Estimated
**~150–200 hours saved in the first quarter at my fleet scale, plus the staleness cost going to
zero** — comfortably past my adoption bar, *provided* L2 confirms the empty/degraded states hold up
live. The one discount: enforcement (the last mile) still costs a hand-written DB row (L1-01).

## 7. Scored acceptance criteria

| Criterion | Verdict |
|---|---|
| Fleet conformance visible & reconciles | **PASS** — honest denominators everywhere; split across 3 tabs (L1-05) |
| Path to green, not a red list | **PASS** — batch starter PRs, per-gap practices, "cheapest path" ASK; copy lags the easy path at two points (L1-03) |
| One policy, no drift | **PARTIAL** — server baseline + tighten-only is right; snapshot-snippet undisclosed (L1-06); fleet-vs-CI control counts can disagree (L1-02) |
| Archetype-aware gate | **PASS** — `defaultGatePolicy(archetype)`; org bar uniform by design, scope narrows who, never the bar |
| `.ai/` standard repo-specific & senior-grade | **PASS** — the strongest surface of the walk |
| Starter PR leak-free & mergeable | **PASS** (L1) — command redaction at read time; secrets never in PR bodies |
| Authored + rolled out in minutes | **PASS** (designed; L2 to confirm) |
| Friction-to-remove, not a stick | **PASS** — "proven in your own CI", no rankings, contradictions withhold rather than subtract |
| No fabrication | **PASS** — the honest-null discipline (absent ≠ 0/0, unchecked ≠ pass, null ≠ 0%) is the best I've seen in this product |
| Enforce the same bar in CI | **FAIL as a product flow** — evaluator complete, editor absent (L1-01) |

## 8. Verdict

**PASS with findings — the strongest structural walk I've done on this product, stopped one step
short of its own point.** The authoring, rollout, provisioning, and observation loop is genuinely
senior-grade: repo-specific generation that reads its own output back, a provisioning flow with the
right blast-radius gates and full disclosure, and an honest-null discipline that survives every
branch I enumerated. I would ship the standard it generates under my own name, and I would show the
Controls matrix to my staff engineers without flinching — it's their CI talking, not a scanner. But
"set one bar and enforce it" ends today at a database write the dashboard never mentions, and the
two surfaces that could contradict each other about control failures don't yet say why. Build the
`requireChecks` editor and its fleet-count honesty in the same PR, fix three sentences of copy, and
this journey is a clean pass.

*A standard you have to enforce is a standard that already lost — and for once the tool agrees with
me. It just forgot to hand me the enforce button for the day I need it anyway.*

---

## L2 — live (arm B)

*Driven 2026-08-30 against the shared dev server on `:3000`, org `public` (48 repos).
Full journal, evidence and residue: `_L2-armB.md`.*

**PRIYA-L1-01 (l2_priority HIGH) — confirmed, and materially worse than I wrote.** The Governance
policy editor's complete field list, read off the rendered page (`shots/armB-gov.text.txt:81-110`):

```
EDIT POLICY
  Minimum level                  any | L1 | L2 | L3 | L4 | L5
  Min overall
  Min per-dimension
  Security floor (D9 ≥)
  Forbid "ungoverned" posture
  Require a protected default branch
  OTHER DIMENSION FLOORS  (Enforced by the gate; not exposed as a CI input.)
    Add a floor →  D1 … D8
  [Save policy]  [Reset to default]
```

No `requireChecks` control. Confirmed. But my claim that *"no UI surface mentions the field exists"* is
**refuted** — and the truth is worse. I set the field by API and the Active-policy summary, six rows
above the editor, rendered it:

> `▸ Reported controls must not be failing: control.prepush.lint, guardrail.never-commit`

Then I changed **one unrelated number** in the editor — Min overall 50 → 55 — clicked Save policy, and
that line was gone (`shots/armB-nadia07-{before,after}.text.txt`; `GET` →
`{"minLevel":"L3","minOverall":55,"minDimension":40}`). The app's own audit row carries the deleted
field under `previousPolicy` and says nothing about it in `policy` or in the human-readable `status`.
So the field is **visible, unsettable, and silently destroyed by an adjacent save** — the terminal step
of my journey doesn't merely dead-end at "write the column directly", it actively undoes the write the
next time anyone touches the form.

**PRIYA-L1-02 (l2_priority MEDIUM) — confirmed, under the strongest conditions I could arrange.** This
capture was taken while `requireChecks` was **actively set** and printed six rows above:

```
Where the fleet fails — Repos failing each gate condition (counted once per repo).
  Below required level                       8 repos
  A dimension below floor                   33 repos
  Ungoverned posture                         0 repos
  Below overall score                       15 repos
  Unprotected default branch                 0 repos
  AI changes merged without human review     0 repos
  AI authorship in a blocked repository      0 repos
  A required control is failing              0 repos      ← structural, not measured
  Scored nothing — not judged                0 repos
```
`shots/armB-nadia07-before.text.txt:118-136`

Four of those nine are pinned to 0 by construction (`evaluateGateLite` has no ledger or PR inputs) and
render as identical live meter rows beside five genuinely measured ones. I had just declared two
required controls; the dashboard told me zero repos fail them. `governance.ts`'s own comment —
*"these stay 0 honestly, because the criteria were never DUE here"* — is exactly right and never
reaches the screen. Render "not judged fleet-wide" for those rows; the fix should travel with the
editor.

| Check | Verdict |
|---|---|
| PRIYA-L1-01 — `requireChecks` absent from the editor | **confirmed** |
| PRIYA-L1-01 — "no UI mentions the field exists" | **refuted** — it renders read-only in Active policy, then is deleted by the next save |
| PRIYA-L1-02 — structural `0 repos` rendered as a measured meter | **confirmed**, with `requireChecks` actively set |
