# From scorer to transition companion — the AI-SDLC plan

_2026-08-13. Successor to [`VISION-TRANSITION.md`](VISION-TRANSITION.md) (which set the voice) and
[`GOLDEN-TRIO.md`](GOLDEN-TRIO.md) (which set the monetizable strengths). Those said **what** ascent
should become. This says **in what order, in which files, and how we know it worked.**_

_Grounded in a code audit of this repo (2026-08-13), the shipped UAT drain
([`BACKLOG.md`](BACKLOG.md) §`2026-08-10-ascent-first`), and the external AI-SDLC framing — chiefly
[Port's AI-SDLC piece](https://www.port.io/blog/ai-sdlc) and IBM's
[AI-DLC](https://www.ibm.com/think/topics/ai-dlc) / [Bob](https://newsroom.ibm.com/2026-04-28-introducing-ibm-bob-ai-development-partner-that-takes-enterprises-from-ai-assisted-coding-to-production-ready-software)._

---

## 0. The thesis in one paragraph

Ascent is an excellent **assessment** product wearing a **companion's** clothes. All nine dimensions
(`src/lib/maturity/model.ts:122-203`) read one source — the git repo and the GitHub API — which is the
*residue* of the software lifecycle, not the lifecycle. Mapped onto IBM's AI-DLC phases, ascent covers
**Construction** and nothing of Inception or Operations. The org surface is 24 tabs in 6 groups
(`src/lib/org/orgTabs.ts:14`) organised by **data type**, which is a BI tool's information
architecture; a companion has a thread and a next move. Onboarding terminates at *"invite a
teammate"* (`src/lib/org/getting-started.ts:96-147`) — the checklist ends exactly where the job
starts. The fix is mostly **rearrangement plus two data joins**, not a rewrite.

## 1. The audit's surprise — most of the hard parts are built

The strategy docs undersell the codebase. Verified present today:

| Asset | Where | Status in `GOLDEN-TRIO.md` |
| --- | --- | --- |
| **Per-PR AI evidence rows** — `AiChange` with `approved` / `approverLogin` / `aiSignal` / `aiTools` | `prisma/schema.prisma:389`, written in `scans-persist.ts:478` | listed as the missing T1 artifact |
| **Tamper-evident audit** — per-row HMAC + CSV content-hash | `src/lib/db/audit-integrity.ts` | "~80% of an assurance product" ✔ |
| **Graduated oversight tiers** T0–T3 + declared-vs-observed compliance | `src/lib/org/stance.ts`, `src/lib/db/org-stance.ts:263` | described as the GAIE gap to claim |
| **Verified improvement loop** — identify → triage → PR → merge → rescan → `impactDim` | `src/lib/db/improvement.ts:1` | "converts a report into a purchase order" |
| **Measured agent spend** — OTel ingest → `AiUsageRecord` → delivery ROI at `measured` fidelity | `src/lib/integrations/otlp.ts`, `.../delivery/ai/aiDeliveryModel.ts:126` | scaffolded ✔ |
| **CI conformance ingest** from in-repo `doctor.mjs`, org-token scoped | `src/app/api/report/conformance/route.ts` | T2-2 ✔ |
| **Org-scoped API tokens** with scopes | `/api/org/tokens`, `src/lib/api-token-auth.ts` | — |

**Implication for sequencing:** the first two waves below ship almost entirely from existing data.
No wave here is a from-scratch bet.

## 2. What is genuinely absent

1. **A journey spine.** Nav is by data type; there is no program state, no cadence, no "you are here".
2. **The evidence *artifact*.** The population exists as rows; nothing exports the signed
   population + sample + per-item pack an auditor asks for.
3. **Agent *behaviour*.** `AiUsageRecord` is day-bucketed tokens/cost/sessions — no attempts, no
   success rate, no per-task outcome. Port's core metrics are unreachable from it.
4. **Anything outside GitHub.** No work items, no deploys, no incidents. Lead time and change-failure
   rate — the outcomes leaders are measured on — cannot be computed.
5. **A door for agents.** Ascent detects MCP in scanned repos and exposes none of its own.
6. **A living action vocabulary.** Every remediation path bottoms out in the same 9 static practices
   (`src/lib/practices.ts`), one per dimension. An org that applies all nine exhausts the product.
7. **Self-measurement.** Per-PR impact exists; there is no org-level "90 days with ascent bought you X".

---

## Wave 1 — The journey spine

**The single highest-leverage change in this document, and the cheapest.** Copy, routing and one new
model over data that already ships.

### 1a. Regroup the rail around the transition, not the data

Replace the six data-type groups in `ORG_NAV_GROUPS` (`src/lib/org/orgTabs.ts:90`) with the four
questions a transformation owner is asked in a leadership meeting. Every existing tab survives as a
member or a drill-in; **no panel is deleted, no route breaks** (`orgTabHref` and the legacy redirects
are untouched).

| Section | Answers | Tabs that move there |
| --- | --- | --- |
| **Standing** | Where are we, honestly? | `overview`, `repositories`, `tech-stacks`, `passports`, `security`, `adoption` |
| **Chosen** | What did we decide our way of working is? | `plan`, `practices`, `skills`, `memory`, `governance` |
| **In flight** | What is moving right now? | `live`, `backlog` |
| **Bought** | What did the last period buy? | `executive`, `delivery`, `contributors`, `teams` |
| **Admin** | The boring rows, deliberately not hidden. | `members`, `integrations`, `audit`, `settings` |

`ORG_TAB_IDS`, `PERSONAL_TAB_IDS`, `MIGRATED_ORG_TAB_IDS` and `TAB_SCOPED_PARAM_KEYS` are unchanged —
this is a regrouping of `ORG_NAV_GROUPS` plus five icons in `OrgTabNav.tsx:35`. The existing
`ORG_NAV_GROUPS ⟷ ORG_TAB_IDS` completeness test keeps it honest.

**Files:** `src/lib/org/orgTabs.ts` · `src/components/org/shell/OrgTabNav.tsx` ·
`src/components/org/overview/orgIcons.tsx` · `src/components/about-org/` (the public module map
derives from the same catalog) · `src/components/onboarding/tour/steps.ts` (teach copy names the
rail) · the nav catalog test.
**Size:** S. **Status: SHIPPED 2026-08-14.**

_Two refinements against the table as first drafted: `skills`/`memory` sit in **Chosen** (they are the
org's declared way of working, not this week's motion), and the tail is labelled **Admin** rather than
Settings to avoid a group key colliding with the `settings` tab id._

### 1b. Land a returning org on the loop, not the ring

`DEFAULT_ORG_TAB` stays `overview` for a *first* visit (the baseline is the point). Once the org has
a completed scan **and** an `ImprovementPr` row in flight, a bare `/org/[slug]` opens on `live`.

Shipped as a pure `resolveLandingTab` (`src/lib/org/landing.ts`) over two cheap facts —
`getOrgHeaderSummary.scannedCount` and a new indexed `countInFlightPrs`, both React-`cache()`d so the
layout and the page share one query each. It **renders** rather than redirects, so the bare URL stays
shareable (it is the URL in the weekly digest) and keeps meaning "this org" for whoever opens it next.

The backlog deliberately does not count toward the decision: an item in the backlog is a decision not
yet taken, and landing someone on a to-do list every visit is nagging, not companionship.

**The one non-obvious consequence.** The bare URL could not mean both "landing" and "the Overview
tab" — with a conditional landing, a rail click on Overview (which normalized to the bare URL) would
bounce straight back to Live, making Overview permanently unreachable. So `buildUrl` no longer
collapses `?tab=overview`, and the shell threads the resolved landing tab into the rail
(`OrgTabNav.landingTab` → `resolveActiveOrgTab`'s third argument) so the highlight matches what
rendered.

**Files:** `src/lib/org/landing.ts` (new, + tests) · `src/lib/org/orgTabs.ts` ·
`src/lib/db/improvement.ts` · `src/app/org/[slug]/{page,layout}.tsx` ·
`src/components/org/shell/OrgTabNav.tsx`.
**Size:** S. **Status: SHIPPED 2026-08-14.**

### 1c. Transition Program — the state that outlives onboarding

A new persisted object that turns the 5-step checklist into step 0 of a named, dated programme.

```
model TransitionProgram {
  id, orgId (unique), name, startedAt,
  targetLevel     Int      // the L-band the org is climbing to
  targetDate      DateTime?
  cadence         String   // "weekly" | "biweekly" | "monthly"
  baselineScanAt  DateTime // Port's rule: baseline BEFORE you turn anything on
  baselineJson    String   // frozen fleet snapshot at start
  status          String   // "active" | "paused" | "achieved"
}
```

`buildGettingStartedModel` (`src/lib/org/getting-started.ts:79`) keeps its five derived steps and
gains a sixth phase, `program`, done when a `TransitionProgram` exists. The **Standing** section
header then renders one persistent line on every tab:

> *Week 7 of "Agent-ready by Q1" · L2 → L3 · 4 of 11 repos at target · 2 PRs in flight · next review Thu*

That line is the companion. It is derived entirely from `fleetSnapshot` (`src/lib/db/plan.ts`),
`listInitiatives`, and `OpsState` (`src/lib/db/improvement.ts`) — all shipped.

**Files:** `prisma/schema.prisma` + migration · `src/lib/db/org-program.ts` (new) ·
`src/lib/org/getting-started.ts` · `src/components/org/shell/` (the header strip) ·
`/api/org/program` (new route).
**Size:** M.

### 1d. Close the "Bought" question with data that already exists

The **Bought** section opens with a ledger built from `ImprovementPr` rows: PRs merged, dimensions
moved, points gained, verified vs awaiting-rescan. `impactDim` / `impactOverall` are already computed
and stored (`src/lib/db/improvement.ts:58-60`) and are currently rendered only inside the war room.

**Honesty rule (binds this whole wave):** the ledger reports **verified** impact only. A merged PR
with no post-merge rescan renders "awaiting rescan", never a projected number. This is the same
null-discipline the Debt Ledger already enforces (`docs/features/org-planning/plan.md` §Debt Ledger).

**Files:** `src/components/org/plan/backlog/debt/` (sibling component) · `src/lib/db/improvement.ts`
(org-level rollup).
**Size:** S/M.

**Wave 1 done when:** a returning org lands on its loop; every tab carries the programme line; the
rail reads as a story; and the "Bought" panel shows only verified movement. Re-run Dana's UAT journey
(method commitment **M1**, `docs/BACKLOG.md:37`).

---

## Wave 2 — The Conformance Pack (gives the journey a destination)

Without a destination a companion is a dashboard that greets you. The quarterly pack is what the
transition is *for* — and per `AI-SDLC-STANDARDS-LANDSCAPE.md:98-100`, nobody ships it.

**What ships:** one signed bundle per org per period containing

1. **The population** — every `AiChange` row in the window, with `aiSignal` (authored vs marked),
   `aiTools`, `state`, `mergedAt`.
2. **The sample** — a deterministic, seeded draw from the population, with the seed printed so an
   examiner can reproduce it.
3. **Per-item evidence** — for each sampled row: approved yes/no, named approver, CODEOWNER review,
   required-checks status from branch governance (`src/lib/github/governance.ts`).
4. **The findings** — merged-without-approval rows, which is the population `AiChange` exists to
   surface and which `org-stance.ts:263` already counts as `unapprovedAiChanges`.
5. **Provenance** — engine + model per scan, rubric version, retention window, the method and the
   sampling caps.
6. **Integrity** — per-row HMAC (`signAudit`) plus the CSV content-hash header
   (`src/lib/db/audit-integrity.ts`), so the filed artifact is self-verifying.

**Claims discipline is non-negotiable** and inherited verbatim from
`AI-SDLC-STANDARDS-LANDSCAPE.md:118-125`: say **"evidence for"** a control, never **"compliance
with"** a standard; anchor to SOC 2 CC8.1 first and ISO 42001 SoA second; **never** claim EU AI Act
conformity; pseudonymize logins unless the org opts into named evidence.

**Also in this wave — the ungoverned-change gate (T1-2).** Extend the deterministic 200/422 gate
(`src/app/api/gate/[owner]/[repo]/route.ts`) with a provenance policy: fail when an AI-attributed
change merges without a named human approver. The stance already declares the policy
(`AiStanceReviewTier`); the gate does not yet read it. Small, deterministic, and it generates the
evidence stream the pack sells.

**Files:** `src/lib/conformance/pack.ts` (new) · `src/lib/db/ai-changes.ts` (new read layer) ·
`/api/org/conformance-pack` (new) · `src/lib/pdf/` (the human-readable cover) ·
`src/lib/scoring/gate.ts` + gate route · `docs/features/org-dashboard/` doc.
**Size:** M/L. **Depends on:** nothing — the rows exist today.

---

## Wave 3 — Agent-run truth

Today ascent infers AI usage archaeologically from commit trailers and PR bodies. That is why
`aiUsage.detected` once counted Renovate (`VALUE-CASE.md:30`). Port's metrics — **agent success rate,
cost per *attempt*, retry rate** — need session-level outcome data, and `AiUsageRecord`
(`prisma/schema.prisma:1067`) is day-bucketed tokens/cost/sessions with no notion of an attempt.

**3a. Extend the OTel ingest to attempts and outcomes.** Claude Code's exporter already emits
per-session counters; fold `AgentSession { orgId, source, repo, startedAt, durationMs, tokens,
costCents, outcome }` beside the day rollup, where `outcome` ∈ `merged | abandoned | superseded`,
resolved by joining the session's branch/PR back to `AiChange`. This is the join that produces
**cost per *merged* change** — the number Port says everyone gets wrong by measuring adoption instead.

**3b. Ship the Copilot connector.** `status: "planned"` today
(`src/lib/integrations/providers.ts`); the Copilot Metrics API is GA and free. Fidelity stays
`allocated` and must render as such — `FIDELITY_META` already carries the honest label.

**3c. Retire simulated spend from any default view.** The FNV-hash placeholder
(`aiDeliveryModel.ts:89`) is the standing violation of `VALUE-CASE.md:46` (D32). Once a connector is
reachable, an unconnected org sees an empty state and a connect CTA, not a plausible fabricated
number.

**Size:** M (3a) · S (3b) · S (3c).

---

## Wave 4 — The outcome join

One external source, chosen for the largest single unlock: **deploys and incidents**.

The killer number nobody sells: *"AI-authored changes in your org fail at X% versus Y% for
human-authored."* Half the arithmetic is already there — `org-rework.ts` computes `reworkRate` /
`aiReworkRate` / `revertRate` from PR data, and `AiChange` gives the authorship split. What's missing
is the deployment event to anchor "failure" to something outside git.

Ingest via the **existing** `/api/integrations/ingest` OTLP path plus a generic webhook, so no new
auth surface is needed (org-scoped tokens already carry `telemetry:write`). Sources in order:
GitHub Deployments API (free, already tokenised) → generic webhook → Vercel/Datadog/Sentry.

Deliverables: change-failure rate split by authorship; MTTR split by authorship; the fourth DORA
metric arriving free with deployment frequency. These land in **Bought**, not in a new tab.

*Work-item ingestion (Jira/Linear) for lead time is the second candidate and is deliberately deferred
— it costs more integration surface for a softer number.*

**Size:** L.

---

## Wave 5 — The agent door (MCP server)

Port's "make the governed route the fastest route" only works if the governed route is reachable at
the moment code is being written. Ascent currently ships its standard as files in a PR; it should
also **serve** it live to the org's coding agents.

Expose an MCP server, authenticated by the existing org API tokens, with read tools:
`get_repo_standing`, `get_gate_verdict`, `list_open_recommendations`, `recall_org_memory`,
`get_practice_shape`, `get_ai_stance`. Every one of these is an existing internal function
(`/api/org/memory/recall`, `/api/gate/…`, `/api/recommendations`, `src/lib/practices.ts`,
`src/lib/org/stance.ts`) — this wave is a protocol adapter, not new logic.

Deliberately **read-only in v1.** A write tool is a governance surface and needs the stance model to
authorize it; that is a later decision, not a v1 default.

**Size:** M.

---

## Wave 6 — A living practice library

`VISION-TRANSITION.md:48` promised mining the org's own exemplars and templatizing their *shape*; the
implementation collapsed to 9 static entries, one per dimension (`src/lib/practices.ts`), which is
also the entire playbook catalog (`playbook-templates.ts:15` maps 1:1). An org that applies all nine
has exhausted the product.

Add a mined tier beside the static catalog: cluster the org's strongest repos per dimension, extract
the *structure* of what they do (headings covered by their agent guidance, the shape of their eval
harness, their PR template's sections), and offer it to gap repos as a starter — **the shape travels,
the code does not**, which is the leak-free property already solved in `src/lib/practice-artifact.ts`
(`buildArtifact`) and reused by `src/lib/org/stance-artifact.ts`.

**Size:** L. **Depends on:** Wave 1 (needs a home in **Chosen**).

---

## Sequencing and rationale

```
W1 spine ──┬── W2 pack ──── W4 outcomes
           ├── W3 agent truth
           ├── W5 MCP door
           └── W6 living practices
```

**W1 first** because it is the cheapest change with the largest effect, and because every later wave
needs a place to land that isn't "one more tab". **W2 second** because it gives the journey a
destination and is the least-crowded, highest-WTP slice in the research. W3/W4 widen the measurement
from repo-state to lifecycle-state. W5/W6 deepen the relationship once the spine holds.

## How we know it worked

Five metrics, Port's cap, each with an owner and each baselined **before** W1 ships:

1. **Return rate** — share of orgs that come back within their programme cadence.
2. **Loop throughput** — `ImprovementPr` rows reaching `verified` per org per month.
3. **Verified points delivered** — summed `impactOverall`, the "Bought" headline.
4. **Programme survival** — share of `TransitionProgram` rows still `active` at 90 days.
5. **Pack pull-through** — orgs exporting a conformance pack at least once a quarter.

Every wave re-enters `/uat recertify` against the originating Character's criteria. `shipped` is a
waypoint; `resolved-verified` is the finish line (`docs/BACKLOG.md:10`).

## Explicitly out of scope

- **Repricing.** `VALUE-CASE.md:44` (D31) and `GOLDEN-TRIO.md:203` both say the $10/$20 seat shape
  contradicts the buyer. Deliberately deferred to its own pass — it is a packaging decision, not an
  engineering one, and it should not ride along with this plan.
- **More analytics tabs.** The 22nd panel adds less than reorganising the 21 that exist.
- **Leading with ROI dollars.** Five funded vendors, free upstream data, and a contested evidence
  base. Cost is the closing arithmetic on a recommendation, never the pitch.
- **Chasing the score.** Table stakes since Jan 2026 (`GOLDEN-TRIO.md:17-32`).
- **Anything that softens the honesty machinery.** The guardband, the discrepancy budget, the honest
  "—" over a fabricated zero, the fidelity tiers. Guardrails **G1–G9** in `docs/BACKLOG.md:24-38`
  bind every wave here.

## Risks

| Risk | Read |
| --- | --- |
| W1 is a regroup, so it can be mistaken for cosmetic and deprioritised | It is the wave the other five land into. Ship it first or the plan degrades to a feature list. |
| The programme line reads as a gimmick if the underlying numbers are thin | Gate 1c on 1d: don't render a programme whose "Bought" panel has nothing verified to show. |
| W2 over-claims and becomes a liability | Claims discipline is inherited verbatim, and the pack states its own method and sampling caps. |
| IBM Bob / Factory ship the same journey | Defend on **neutrality** (no agent to upsell) and fleet depth, never on the score — unchanged from `GOLDEN-TRIO.md:200`. |
| W4's deploy join stalls on integration surface | GitHub Deployments API first: already tokenised, zero new auth. |
