# Backlog

Tracked, evidence-backed work items. Every entry cites its origin: a UAT finding id, a harness scan,
or an issue. **No item enters without a citation**; an idea with no evidence is not a backlog item.

Sections are per-source-run so an item's provenance survives triage. Status vocabulary:
`open` · `in-progress` · `shipped (<sha>)` · `shipped-unverified` · `resolved-verified` (UAT
`recertify` confirmed it live) · `declined (<reason>)`.

> A shipped UAT item is **not done at merge**. It re-enters `/uat recertify`, verified live against
> the originating Character's scored criteria. `shipped (<sha>)` is a waypoint, not a finish line.

---

## UAT run `2026-08-10-ascent-first` (drained 2026-08-10)

Analysis: [`docs/product/uat-insights/2026-08-10-ascent-first.md`](./product/uat-insights/2026-08-10-ascent-first.md).
Characters: Sam (staff engineer), Dana (VP engineering), Tomáš (prospective buyer).
Drain tally: **15 build · 4 concept-doc · 4 decline**.

**Guardrails binding every item in this section** (from the run's strengths; full text in the
analysis doc §"Strengths → do-not-touch guardrails"):

- G1: no report/PDF cleanup may remove or soften **LLM-vs-detector disagreement**.
- G2: no templating pass may flatten a **counted evidence line** into a catalogue item.
- G3: the **adoption/rigor structural split** and its cohort-matched deltas are not to be merged or
  re-scoped.
- G4: the ranked "one move" must keep **refusing to emit numbers the data can't support**; new
  basis text degrades to absence, never to a fabricated basis.
- G5: no response to "the LLM only moved the score 2 points" may **widen the guardband** or give the
  model more latitude. The discrepancy budget stays all-or-nothing; D9 stays deterministic.
- G6: D2's **assertion-substance sample** and its `detail` string survive any evidence rework.
- G7: the **honest scan-progress component** is not to be touched when fixing the dialog's ETA copy.
- G8: pricing stays **numeric, anonymous, one click**; no "talk to sales" on Pro/Team, no auth in
  front of pricing.
- G9: the **engine-mix caveat stays in the PDF body**, not a footnote.
- M1 (method): **any change to the briefing PDF re-runs Dana's journey before merge.** Standing
  commitment in place of the human read-aloud pass she asked for.

### Build

| # | Item | Evidence | Size | Status |
|---|---|---|---|---|
| B1 | **`/usage` credit alarm must derive from the same authority as the 402.** The banner is non-monotonic (0 credits + 0 scans → "will be refused"; 1 credit + 0 scans → silence) and fires as the **default state of every new org** (`scanCredits DEFAULT 0`), while `AllotmentPanel` says "comfortably within your allotment" eight lines below. Route it through `checkScanEntitlement`/`resolveScanCharge`. | `DANA-L1-003` (**recurrence 2**, confirmed live) · `src/app/usage/page.tsx:142` · `usageDashboard.tsx:46-52` · `AllotmentPanel.tsx:59-64` | S | **shipped-unverified** (`10fc02b8`), awaiting `/uat recertify` against Dana's criteria |
| B2 | **Open the advertised free, no-signup public scan.** Scope the sign-in wall to private/org scans; anonymous single-repo public scans proceed under the existing rate limit + public quota. Everything read-only is already open; the one walled action is the only one that converts a buyer. | `TOMAS-L1-01` (**blocker**, L2-confirmed 401) · `src/lib/scan-gates.ts:77-83` · `src/app/api/scan/route.ts:258-261` · `src/app/api/scan/stream/route.ts:79-92` · `README.md:94-98` | S | **shipped-unverified** (`58879bb4`), awaiting `/uat recertify` against Tomáš's criteria |
| B3 | **Board PDF: stop printing a regression under "Value this period"; label the four repository denominators; don't caption an absent percentile.** Sign-aware value line, scoped denominator wording, benchmark tile that says "not enough peers" instead of "vs 1 repos". Honors G1/G3/G9: nothing is suppressed, only labelled. | `DANA-L1-010`, `DANA-L1-012`, `DANA-L1-011` · `src/lib/org/briefing.ts:54-61,280,295-305` · `src/lib/pdf/briefing-document.tsx:114-140` · `ExecutiveTab.tsx:123-128` | S/M | **shipped-unverified** (`84527794`), awaiting `/uat recertify` against Dana's criteria (M1: re-run her journey) |
| B4 | **Populate `Signal.detail` across all detectors** so every dimension score cites re-traceable evidence (paths/counts), not a label. Sam's automatic-trust-failure clause and the entire ~30 min gap between his possible and realized time-saved. Honors G6. **2026-08-28:** `RepoIndex.first()` recovers the path a presence check matched and then discarded; D1 (all presence + quality signals), D2 framework/e2e/coverage, D5 documents, D6 type-check/pre-commit/CODEOWNERS and D9 SAST/SCA/SECURITY.md/threat-model now cite it. A signal fired by the manifest/workflow TEXT blob stays unsourced on purpose — there is no file to name — so the remainder (D3/D8 and the text-only D9 checks) is not closable this way and needs a different evidence carrier. `evidence-source.test.ts` pins both directions. | `SAM-L1-01` | L | **partly shipped** — path-triggered signals done; text-triggered ones open |
| B5 | **Permalink affordance on the report.** The scan flow ends on `/report?repo=…` without ever surfacing the durable permalink. (The badge half of this item is **dropped**: the README badge feature was removed on 2026-08-29.) | `SAM-L1-04` (`SAM-L1-03` closed as no-longer-applicable) | S | open |
| B6 | **Render `scoreIntegrity`.** ~~computed, typed and persisted~~ — it was computed and typed and reached **no column at all**; the row said otherwise. Now persisted (`Scan.scoreIntegrityJson`) and shown: the report header carries an integrity chip (`ScoreIntegrityChip`) and the loop cockpit's outcome ledger chips the same record, both via one `integrityNotes` so they cannot word it differently. **Remaining half:** `ProvenanceTrack` (`DimensionCard.tsx:120`) still draws a fixed ±`LLM_GUARDBAND` zone on a dimension whose band was doubled, and still hides the blend weight — the data to fix it is now readable. Honors G5 (surface the real band; do not widen it). | `SAM-L1-02` | M | **partly shipped** — chip done; provenance track open |
| B7 | **Label facts the model never received.** `techStack` (with `TECH_STACK_PROMPT` off), `contributors`, `aiChanges` render beside model-produced scores with nothing distinguishing detected-and-sent from detected-and-displayed. Include the confidence chip's mislabel (it measures *fetch* coverage, not *prompt* coverage). | `L2-NEW-02` · `SAM-L1-07` (label half only; the cap itself is declined, D2 below) | S | open |
| B8 | **Reconcile the public-scan promise with the 5/mo quota.** "Unlimited free public scans" is contradicted by `public-scan-quota.ts`, and the pricing page and FAQ JSON-LD disagree with each other. Ships with B2 as the honest half of the same promise. Honors G8. | `TOMAS-L1-02` · `src/lib/plans.ts:54` · `src/lib/public-scan-quota.ts:53-60` · `src/app/pricing/page.tsx:100-101` · `src/app/page.tsx:56` | S | open |
| B9 | **A basis clause on every trajectory/ETA**, on the same line, e.g. *"L4 by mid-October, fit over 9 scan days across 84 days."* The low-data fix currently **nulls** `forecastConfidence`, omitting the hedge rather than replacing it. Honors G4. Blocked from `resolved-verified` by the fixture gap (M-item below), not from shipping. | `DANA-L1-001` (**recurrence 2**), `DANA-L1-002`, both `uncertain — not reproducible on this host` · `src/lib/org/briefing.ts:283-287` | S | open |
| B10 | Scan dialog says "about a minute"; the app's own calibration says 100–330 s. Fix the dialog copy only, per **G7**. | `TOMAS-L1-03` | XS | open |
| B11 | Enterprise, the only tier that fits a 150–250 engineer org, has no reachable contact path; its button goes to `/about`. Add the path; **G8** forbids touching the Pro/Team cards. | `TOMAS-L1-06` | XS | open |
| B12 | `/about`'s ROI simulator is eight fabricated numbers. Label it as illustrative or remove it. | `TOMAS-L1-04` | XS | open |
| B13 | A configured-but-empty DB renders a zero-row ranking table under a real heading. Hide the section or seed a curated set (the neighbouring `topAiNative`-empty branch already does this correctly, so copy it). | `TOMAS-L1-05` | XS | open |
| B14 | Add a per-item **"first step"** field to roadmap recommendations so the concrete move isn't buried in the invitational rationale paragraph. Additive only, per **G2**. | `SAM-L1-05` | S | open |
| B15 | Small correctness batch: "Flagged for review" never says what each auditor claim *did* (`SAM-L1-06`); `scoreLabel` covers 4 of 6 providers (`SAM-L1-08`); the landing deck has no pricing section despite a header comment claiming it does (`TOMAS-L1-07`); `resolveTextRunnerForOrg` (`llm/text-org.ts:28`) is a dead seam with no production caller. | `SAM-L1-06`, `SAM-L1-08`, `TOMAS-L1-07` | XS | open |

### Concept-doc (design questions remain, so write, don't code)

| # | Item | Evidence | Status |
|---|---|---|---|
| C1 | **What the model actually contributes.** Measured: the LLM used ≤24% of its ±25 guardband, moved the headline ~±2 points, and returned two dimensions byte-identical to the detector, while producing the roadmap and the discrepancies block. The product leads with the ring and gives away the reasoning; the README's "calibrates the signal scores" is the weakest true claim available. Extend `docs/features/scanning/maturity-model.md`. **G5 forbids the "give the model more latitude" answer.** | `L2-NEW-01` · `_L2-control-arm-llm-vs-signal.md` | open |
| C2 | **Give the model a comparison class and a history.** Three Characters independently named the same absences: prior-scan history, peer/industry cohort context in the FACTS payload, and a full file-tree manifest. All change the **grounding denominator** (a scored instrument of the UAT method), so the trade-off gets written before it gets built, then a journey to certify it. | `SAM` + `DANA` + `TOMAS` near-findings (convergence, no finding id) | open |
| C3 | **Briefing-narrative egress.** The narrative bypasses `src/lib/llm/` and POSTs the fleet briefing straight out; the seam that would fix it has no caller. Gated off on this host, so design it rather than patch it blind. | `DANA-L1-005`, `DANA-L1-009` (both precondition-gated) | open |
| C4 | **Peer-cohort maturity context for the board audience**: "what does L3 · Augmented mean against DORA/DX norms," the board-facing half of C2. May merge into C2. | Dana near-finding (unfiled) | open |

### Declined (recorded so they cannot resurface without new evidence)

| # | Item | Reason | Reopen when |
|---|---|---|---|
| D1 | Add a trajectory/ETA to the fleet Overview (`DANA-L1-004`) | Would multiply the exact unhedged-ETA defect B9 fixes across one more surface. The product is "most careful where it matters least"; make the hedging travel, don't add another ETA. | B9 has shipped **and** recertified, and a Character needs the trajectory on Overview specifically. |
| D2 | Treat the ~8% prompt cap as a defect (`SAM-L1-07`) | Two Characters reached opposite verdicts, and the acquitting one did the arithmetic: *"it's narrating a fully-computed signal set and sampling 22 KB for texture. The pitch survives."* Recorded as a quality **ceiling**, not a gap. The label half is actionable and moved to B7. | Evidence that the sample size changes a score. |
| D3 | "Someone in my role must read the board PDF aloud before it ships" (Dana's process ask) | No human in this loop to assign it to; that is the premise of this repo. `/uat` L2 **is** that read; it is what produced B3 and B9. Converted to method commitment **M1** above rather than a ticket. | n/a, it is a standing rule, not a backlog item. |
| D4 | Wire up `/launch` (unreachable, unlinked, anonymous sign-in prompt) | No Character's job touches it; Tomáš tagged it `unreachable` and filed nothing. | A Character whose journey needs it. |

### Method / fixture

| # | Item | Evidence | Status |
|---|---|---|---|
| M2 | **`env.md` fixture gap.** A seeded org with **≥3 scans of one repo across ≥2 calendar days (≥14-day span)** is required before B9 can reach `resolved-verified`. `seed-org.mjs` scans in a single pass, so `forecastTrajectory` returns null and six generated board PDFs contained zero `Trajectory:` lines. | `DANA-L1-001`/`-002` resolved `uncertain — not reproducible on this host` | open |
| M3 | Next run should emit `resolution` on **every** `findings.json` row, including plain `open` ones: 30 of 37 rows carried `null`, so drain §1 had to be reconstructed from prose. | drain §3 | open |

---

## scan-sweep `--develop --ideas-only` moonshot round (2026-08-29)

Lenses: `feature-scout` + `moonshot-architect` (operator-defined: architecture-grade, category-defining capabilities) over **all 11 context groups / 54 contexts**, L/XL findings only. 45 findings from 11 parallel group scouts, merged into **37 deck items** and triaged one by one in the terminal. Tally: **22 accepted · 5 concept-doc first · 10 deferred · 0 declined**. Full finding bodies (Summary/Description/Flow/Impact/Evaluation, `file:line` evidence) are in `.personas/memory-outbox.jsonl` (30 of 45 emitted — the outbox is past its ingest cap; see the overlay note) and the per-context coverage ledger in `.claude/scan-history/scan-sweep.jsonl`.

Convergence worth noting: four scouts independently proposed the open benchmark corpus (#2), three the control/governance event ledger (#1), two each the forge layer (#4), the guidance arbiter (#15) and GitHub Teams identity/scoping (#21).

| # | Item | Contexts (scout src) | Size | Gate | Decision |
|---|---|---|---|---|---|
| 1 | Governance Evidence Ledger (event-sourced control timeline, as-of-merge pack, control-failed alerts) | GitHub App Installation & Webhooks (02#1); Fleet Alerts & Digests (04#1); Security Posture & Audit Log (05#2) | XL | policy | **accepted** |
| 2 | Open benchmark corpus: rubric-versioned snapshots, public dataset + percentile API, federation, consent | Fleet Rollups & Insights (04#4); Portfolio & Public Leaderboard (08#4); Database Client & Schema (10#3); Landing Page Prototypes (11#1) | XL | policy/contract | concept-doc first |
| 3 | Agent-neutral work protocol: claim/brief/report follow-ups over MCP + tokens | Follow-ups Ledger (06#1) | XL | policy | **accepted** |
| 4 | Forge-neutral ingestion: GitLab / Bitbucket / Azure DevOps behind the RepoSource seam | Scan Pipeline & Ingestion (01#3); GitHub Repo Data Access (02#3) | XL | contract | **accepted** |
| 5 | Gate-as-code: manifest-declared bar, ratchet/no-regression, one evaluator at pre-push/CI/check-run | CI Gate & Status Checks (01#2) | XL | contract | concept-doc first |
| 6 | Signed maturity attestation (in-toto/DSSE) + verify CLI | PDF & LLM Export (08#2) | L | policy | deferred |
| 7 | AI Trust Center: opt-in tenant-published governance scorecard with signed digest | Marketing About Page (11#2) | XL | policy | concept-doc first |
| 8 | Agent-admission compiler: stance + autonomy tier become enforced per-repo controls | Practices, Governance & Adoption (05#1) | XL | policy | **accepted** |
| 9 | Intervention Outcome Ledger: measured lift per recommendation, fleet- and corpus-wide | Roadmap & Recommendation Tracking (08#1) | XL | policy | **shipped-unverified** (wave 1, `5627bf43`) — awaits its UAT journey |
| 10 | Two-speed fleet: durable scan queue + credit-free control probes | Org Import, Scan & Watchlist (04#2) | XL | contract | **accepted** |
| 11 | Unified LLM meter: every inference lane priced, team/segment showback | Usage Metering (09#1) | XL | policy | **shipped-unverified** (wave 1, `5627bf43`) — awaits its UAT journey |
| 12 | Purchasable artifacts: one-time Polar products that fulfil an entitlement | Checkout & Plans (Polar) (09#2) | L | contract | deferred |
| 13 | Manifest-as-scan-input: declared-vs-proven capability conformance | AI-Native Standard & Onboarding Skill (03#1) | L | contract | **shipped-unverified** (wave 1, `5627bf43`) — awaits its UAT journey |
| 14 | `.ai/memory` comes home: per-repo agent memory indexed into Org Memory | AI-Native Standard & Onboarding Skill (03#2) | XL | policy | **shipped-unverified** (wave 1, `5627bf43`) — awaits its UAT journey |
| 15 | Guidance arbiter / guidance graph: canonical source, projections, verified contradictions, D1 coherence | Maturity Model & Scoring Engine (01#5); AI-Native Standard & Onboarding Skill (03#3) | L | contract | **accepted** |
| 16 | Doctor findings as fleet control telemetry: per-check ledger, control matrix | AI-Native Standard & Onboarding Skill (03#4) | L | contract | **shipped-unverified** (wave 1, `5627bf43`) (steps 1–7; `requireChecks` folded into W4-O) — awaits its UAT journey |
| 17 | Work-time registry over MCP: skills, governing subjects, invoke/citation write-back | MCP Server (07#3) | XL | policy | **accepted** |
| 18 | Standards conformance ledger: registry signals + registry-map as a fleet dimension | AI Registry Repo (Onboarding & Index) (07#1) | XL | contract | **shipped-unverified** (wave 1, `5627bf43`) — awaits its UAT journey |
| 19 | Live invoke channel: per-skill/per-repo usage feeding dormancy and outcomes | Skills Registry & API Tokens (07#2) | L | contract | **shipped-unverified** (wave 1, `5627bf43`) — awaits its UAT journey |
| 20 | Athena as registry curator: PR-proposing actions | Athena Companion (07#4) | XL | policy | deferred |
| 21 | GitHub identity graph sync + scoped membership (teams, auto-RBAC, self scope) | GitHub App Installation & Webhooks (02#2); Members & Access Control (04#3) | L | policy | deferred |
| 22 | Developer-held credential lane: user-to-server GitHub tokens for UC3 | GitHub OAuth & Session (02#4) | L | policy | concept-doc first |
| 23 | Agent behaviour ledger: OTLP sessions as UC3's second sensor | Developer home (UC3 individual care) (05#3) | XL | policy | concept-doc first |
| 24 | Billing account above the tenant: pooled credits, sponsored orgs, resellers | Credits & Entitlements (09#3) | XL | policy | deferred |
| 25 | Org-brief for every lane: playbooks/house pattern/memory in; lessons and declines out | Playbooks (06#4) | XL | contract | **accepted** |
| 26 | One improvement ledger: loop lanes become Bought/programme/conformance evidence | Executive Briefing (06#3) | L | contract | **accepted** |
| 27 | Remediation economics: cost per verified dimension point, per model, per lane | Local Autopilot & Loop Engine (06#2) | L | contract | **accepted** |
| 28 | Durable scheduled drives bound to the programme's cadence and pace | Local Autopilot & Loop Engine (06#5) | L | policy | deferred |
| 29 | Score-input ledger: persisted scan inputs for offline re-score and rubric migration | Scan Pipeline & Ingestion (01#1) | L | policy | deferred |
| 30 | Reproducibility certificate: measured per-model noise bands on anchored scores | LLM Provider Abstraction (01#4) | L | policy | deferred |
| 31 | Signed tenant history bundle: export + import of a scan time series | Scan Persistence & History (10#1) | XL | policy | deferred |
| 32 | Retention compaction: pruned scans age into rubric-tagged digests | Data Retention & Purge (10#2) | L | contract | **shipped-unverified** (wave 1, `5627bf43`) — awaits its UAT journey |
| 33 | Practice adoption ledger: post-merge drift, versioned house patterns, fleet rollout | Practices, Governance & Adoption (05#4) | L | contract | **accepted** |
| 34 | Exemplar Diff: signal-level comparison against a peer repo or cohort | Trends & Comparison (08#3) | L | contract | **accepted** |
| 35 | Fleet foundation rollout with self-provisioned report-back | First-Run Onboarding Wizard (03#5) | L | policy | **shipped-unverified** (wave 1, `5627bf43`) — awaits its UAT journey |
| 36 | Git-native improvement channel: lessons mirror, skill Trace, reflect-as-PR | Org Memory (07#5) | L | contract | **shipped-unverified** (wave 1, `5627bf43`) — awaits its UAT journey |
| 37 | Data-bound deck diagrams: every marketing figure is a live public read model | Design System: UI Primitives & Deck (11#3) | L | contract | deferred |

Deferred and concept-doc items stay on this list so they cannot be re-proposed as new; an accepted item is a build direction, not a shipped feature — each still needs its own design/ship-loop milestone and (most carry a `contract` or `policy` gate) a reviewer who is not the author.

### S/M defects the scouts noted in passing (not built — ideas-only round)

- **group 10:** docs/features/data/README.md says 40 models vs data-model.md 48 (drift); ScanDimension lacks (scanId,dimId) index (schema.prisma:640); erase/purge preview reports dims/recs as 0 by design (retention.ts:174-183) but field names imply real counts.
- **group 11:** IndexOrg.tsx:46-48 sells an 'ROI-ranked backlog' while the plan forbids leading with ROI (XS); leaderboard/page.tsx:79-81 promises a link with a plain span (XS); feature-doc-map + AGENTS.md still list src/app/api/badge/** though badge routes are deleted (S).
- **group 01:** noise.ts:9-10 still says guardband ±25 (r8 = 6; stale); context-map brief says 8 dimensions, code has 9; llm-providers.md:739 vs config.ts:81 disagree on which providers are reproducible.
- **group 02:** DEFAULT_TTL_MS in webhook-deliveries.ts is 10 min while the route passes 24h (S); github-app.md/setup.md omit installation_repositories and check_run from the events list (S); source.ts:55-58 comment cites the deleted /connect PrivacyNotice (XS).
- **group 03:** GET /api/report/conformance trend walks up to 1,000 audit rows per request with substring meta match (unindexed); docs/features/onboarding/README.md:31-33 still lists 'Connect & Repo Selection' though /connect was retired; manifest.ts generatedAt is the scan date so a repo can start 'stale' on first doctor run (doctor.ts:233-234).
- **group 04:** reconcileListedRepos never runs for App-installed orgs so renamed/archived private repos burn rescan slots forever; RepoTeam.source github_teams declared with no writer; docs/features/fleet/enterprise.md cites advanceSchedule which no longer exists.
- **group 05:** gate `policyFromParams` drops `minAiGovernedRate` on the no-org-policy path (src/lib/scoring/gate.ts:483-496 vs :474-475); practices.md W6 deviation text says `minedStarter` is not wired into apply, but it is via `resolveHousePattern` (src/lib/practices/apply.ts:72-76, src/lib/practice-artifact.ts:499-513) — doc drift; conformance pack limitations omit that `environment` is latest-scan not as-of-merge (src/lib/conformance/pack.ts:270-299 vs src/lib/db/ai-changes.ts:138-141); `StanceFinding.advisory` is never emitted true so `compliant` is degenerate (src/lib/org/stance.ts:222,238,248,259,274); `TeamStandingSnapshot.standingsJson` is written and never read (src/lib/db/team-standings.ts:59-62); `transferPlaybook` output is ephemeral despite copy promising a Goal/Initiative handoff (src/features/standing/tech-stacks/transferPlaybook.ts:35-80).
- **group 06:** agent.ts:98-103 drops cost/usage/turns from the claude -p envelope; docs/features/org-planning/README.md cites retired routes (/api/org/initiatives, /api/org/simulate) and old component paths; context-map entry points for Live/Playbooks no longer match the feature tree.
- **group 07:** `bySkill` from the usage lane is dropped after the catalog (src/lib/db/org-registry-write.ts:61 persists totals only) so the Registry tab's `invokes30d` can never be attributed; `POST /api/mcp` checks only `mcp:read` and has no memory plan gate (src/lib/athena/grounding.ts:19-24 names it, src/app/api/mcp/route.ts:97-104); `OrgSkillEvent.source` still free text (src/app/api/org/skills/events/route.ts:39); GOLDEN-USE-CASES Phase A telemetry contract (`telemetry/<repo>/<yyyy-mm>.jsonl`) diverges from the shipped `usage/<contributor>.json` lane the indexer reads (src/lib/registry/index-walk.ts:51-58).
- **group 08:** RoadmapSandboxScenarioBar shows projected-vs-actual but nothing writes back to the recommendation timeline; trends/annotations.ts says 'no deploy feed yet' while Deployment rows are persisted and unread; llm-markdown.ts omits scoreIntegrity, governance and aiChanges (relates to B6).
- **group 09:** getCreditReconciliation classifies reversals with /refund/i (credits.ts:508) despite the CREDIT_REASON contract (M); Subscription rows are written by nothing so freeToPaidConversion (kpi-metrics.ts:197-221) can only report 0 (M); public-scan-quota.ts:1,55 says Free is 5 scans/month while plans.ts:190 is 20 (S, adjacent to B8).
