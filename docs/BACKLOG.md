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
| B4 | **Populate `Signal.detail` across all detectors** so every dimension score cites re-traceable evidence (paths/counts), not a label. Today it is written exactly once in `analyze/index.ts`, on the failure placeholder. Sam's automatic-trust-failure clause and the entire ~30 min gap between his possible and realized time-saved. Honors G6. | `SAM-L1-01` | L | open |
| B5 | **Badge + permalink affordance on the report.** No badge path exists on the one screen anyone would want it, and the scan flow ends on `/report?repo=…` without ever surfacing the durable permalink. Third run raising the badge half. | `SAM-L1-03` · `SAM-L1-04` (open half; §1 ceiling of `PRIOR-2026-07-16-03`) | S | open |
| B6 | **Render `scoreIntegrity`.** `widenedDims`/`effectiveBlend` are computed, typed and persisted; the provenance track draws a fixed ±25 band even where the engine used ±50, and hides the blend weight. Honors G5 (surface the real band; do not widen it). | `SAM-L1-02` | M | open |
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
