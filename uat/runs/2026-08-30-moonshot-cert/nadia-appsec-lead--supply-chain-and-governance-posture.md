# Nadia (AppSec Lead) × `supply-chain-and-governance-posture` — **L1 (theoretical, code-grounded)**

- **Run:** `2026-08-30-moonshot-cert` · `/uat` · Phase L1 · pair #4 · no browser
- **Character:** `uat/characters/nadia-appsec-lead.md`
- **Journey:** `uat/journeys/supply-chain-and-governance-posture.md`
- **Environment modelled:** `ASCENT_AUTH_BYPASS=1`, PGlite live, seeded org via `scripts/seed-org.mjs`,
  `SUPPLY_CHAIN_PROVIDER=mock`. Moonshot waves 1–4 on master (`fca0c742`).
- **Grounding denominator:** `uat/env.md` §Grounding, verbatim. No denominator invented.

---

## sources

**The evidence substrate (moonshot #1)**
- `src/lib/controls/catalog.ts:41-134,141-170` — `CONTROLS`, `ControlDef` (`label`/`scope`/`sources`/`failMeans`/`descriptor`), `controlLabel`, `controlOrder`, `stateTone`
- `src/lib/controls/seal.ts:33-64,68-90,94-109,113-125` — `SealableRow`, `DIGEST_FIELD_ORDER`, `rowDigest`, `dayRoot`, `SEAL_RECIPE`, `utcDay`, `isClosedDay`
- `src/lib/controls/transitions.ts:24,58-67,80-88,101-126,135-165` — three codes, `TRANSITION_SEVERITY`, `isDispatchable`, `classifyMove`
- `src/lib/db/control-observations.ts:147-201` (`recordObservations`), `:316` (`TIMELINE_CAP=2000`), `:401-430` (`listControlTimeline`), `:437-493` (`controlCoverage`), `:520,530,573-586` (seal + `sig`), `:640-687` (`verifySeals`), `:693-707` (`sealPendingDays`)
- `src/lib/scan-probe-controls.ts:157-194` — `HEARTBEAT_AFTER_MS`, `diffSamples`
- `src/lib/github/governance-events.ts:1-26,43-63,84-104` — the attribution-only webhook normalizer
- `prisma/schema.prisma` `model ControlObservation` / `model ControlLedgerSeal`; `prisma/init.sql:2321-2339`

**Routes**
- `src/app/api/org/controls/route.ts:23-65` — timeline + coverage + `truncated`
- `src/app/api/audit/verify/route.ts:27-85` — lazy seal, chain verdict, `SEAL_RECIPE`, `scope`
- `src/app/api/audit/route.ts:19-70` — the audit CSV (columns, `integrity`, truncation honesty)
- `src/app/api/org/conformance-pack/route.ts:110-120`
- `src/app/api/gate/[owner]/[repo]/route.ts:218-264,303-305` — admission overlay, `requireChecks`
- `src/app/api/org/gate-policy/route.ts:188-225`; `src/lib/db/org-gate.ts:39-57`

**The as-of-merge pack**
- `src/lib/conformance/pack.ts:45-160` (types), `:164-186` (`ATTESTATION`), `:225-245` (`fallbackEnvironment`), `:246-290` (`toItem`), `:325-375` (`limitations`), `:404-412` (`environmentCoverage`)
- `src/lib/conformance/csv.ts:70-90` (as-of CSV columns), `:146-196` (coverage table, sample, integrity)

**Her three surfaces**
- `src/features/standing/security/SecurityTab.tsx:33-149` — the whole Security tab
- `src/features/standing/governance/GovernancePanel.tsx:26-109` — the whole Governance tab
- `src/features/standing/governance/ControlTimelineCard.tsx:20,25-40,42-141`
- `src/features/standing/governance/controlTimeline.ts:37-113`
- `src/features/standing/governance/EvidencePackCard.tsx:17-81`
- `src/features/standing/governance/useGatePolicyEditor.ts:26-79,105-116,142-160`
- `src/features/standing/governance/stance/StanceSection.tsx:14-58`; `stance/admission/AdmissionColumn.tsx:22-108`; `stance/admission/admissionRows.ts:8-78`
- `src/features/admin/audit/AuditTab.tsx:19-40`
- `src/features/standing/passports/controls/ControlCell.tsx:10-44`; `controlMatrixView.ts:34-78`

**Reachability**
- `src/lib/org/orgTabs.ts:140-205` — Security + Governance in `standing`; Audit in `admin`
- `src/components/org/shell/OrgShell.tsx:116-136,246` — role resolution; `hideTabs` only hides `pairing`
- `src/lib/authz.ts` `requireOrgRead` (all three of her routes); `hasOrgRole(slug,"owner")` for the editors

---

## 1. Surface model

### 1.0 Reachable surface set (computed before judging)

| Surface | Gate | Nadia reaches it? |
|---|---|---|
| `/org/[slug]?tab=security` | `canReadOrg` (org layout) | **Yes**, any member |
| `/org/[slug]?tab=governance` | `canReadOrg` | **Yes**, any member |
| `/org/[slug]?tab=audit` | `canReadOrg` — the tab does **no** auth of its own (`AuditTab.tsx:9-10`) | **Yes**, any member. Sits in the **Admin** nav group though its data is member-readable |
| Gate-policy editor, stance editor, named evidence export | `hasOrgRole(slug,"owner")` (`GovernancePanel.tsx:36`) | **Read-only** unless she is an owner |
| Admission override control | owner (`AdmissionColumn` `canEdit`) | read-only otherwise |
| `/api/org/controls`, `/api/audit/verify` | `requireOrgRead` | **Yes** — but **no UI calls either one** (see NADIA-L1-01/05) |
| `?tab=passports` → Controls matrix (#16) | `canReadOrg` | Yes, but three clicks deep behind a switcher labelled "Passports" |
| Loop / drive / work-protocol surfaces | `selfHosted()`, `ASCENT_AUTOPILOT` | **Out of her set** — irrelevant to this journey |

Nothing in her journey is self-hosted-gated or plan-gated. Reachability is not her problem; **discoverability and reconciliation are**.

### 1.1 Security tab — her entry (`SecurityTab.tsx:66-148`)

Five tiles then one dense register:

| # | Affordance | Computes | Cite |
|---|---|---|---|
| 1 | Avg Security (D9) + delta | `buildSecurityOverview` | `:90-96` |
| 2 | **Branch protection %** + `N repos with rules` | `sec.governance.protectedRate` | `:97-102` |
| 3 | **Repos at risk** — "critical + weak (D9 < 60)" | `band.critical + band.weak` | `:103` |
| 4 | Security gate `N fail` / `all pass` | `sec.securityGate` | `:104-109` |
| 5 | Band spectrum | `SecurityBandSpectrum` | `:113` |
| 6 | **Control matrix** — all scanned repos, posture ┃ exposure | `SecurityRiskRegister` | `:136-144` |
| 7 | Per-repo decidable findings | `SecurityFindings` | `:146` |
| 8 | PDF download + "Copy security brief for LLM" | | `:78-85` |

**Her acceptance criteria 1–3 are met here, and met well.** The Dependabot column is passed in as a *separate prop* (`advisories`), never folded into `sec.avgSecurity`; the demo flag is threaded through as `advisoriesDemo` with a comment naming the exact prior defect (`:140-143`); and the `degraded` branch renders an explicit "that is **not** a clean bill of health" banner (`:129-135`). That last one is the single best line in the fleet for her: it is the difference between *no advisories* and *could not look*, which is the distinction her whole career is built on.

### 1.2 Governance tab (`GovernancePanel.tsx:60-108`)

In order: five gate tiles (`passRate` over `assessed`, with an explicit **"Not judged"** tile so the denominator can't hide a repo — `:76-82`) → policy card + fail-reasons → **failing repos, named** → CI snippet → **Evidence pack** → **Control observations** → **AI stance / Perimeter / Admission**.

`GovernanceFailingReposCard` is her "name the gaps" requirement. The `assessed` vs `scanned` split at `:73-75` is precisely the anti-theater arithmetic she checks for.

### 1.3 The control ledger card (`ControlTimelineCard.tsx`)

One row per (repo, control) with State / Last change / Coverage. `unmeasurable` is an em dash with a tooltip, never red, never zero (`:25-32`, `controlTimeline.ts:96-102`); the header counts `not operating` and `not readable` as **two separate numbers** (`:72-77`, `timelineTotals` `:106-113`). The coverage cell prints "N observations · largest gap Xd · via scan, probe" (`coverageSentence` `:87-94`).

This is the honesty contract done properly — and then two things break it (§3, NADIA-L1-01/02/03).

### 1.4 The evidence pack + as-of merge

`EvidencePackCard` states the lower-bound caveat, the pseudonymous default and the seeded-sample reproducibility *before* the download links (`:35-55`). The manifest carries a **Control-environment coverage** table with `mergedRows` as a visible denominator (`csv.ts:146-163`), and per-row `environmentAsOf.source` columns in both CSVs (`csv.ts:77-83`).

The declared "no governance-history backfill" gap is **disclosed, in the strongest available form**: when the ledger has zero coverage the limitation reads "**NO row in this pack carries an as-of-merge control observation**" (`pack.ts:354-358`). That is the disclosure she wanted and it is not hidden.

### 1.5 Audit tab

`/api/audit` CSV carries `at, action, actorId, orgId, repo, level, overall, headSha, integrity, meta`, quotes every field, recomputes the per-row HMAC verdict at read time, and flags truncation with a `-PARTIAL` filename plus a header (`route.ts:29-30,62-70`). Filters by action/actor/since/until, keyset cursor. **Acceptance criterion 5 is met.**

---

## 2. Walkthrough (first person)

I land on Security. Four tiles, a band spectrum, one dense matrix. Avg D9, branch-protection rate, repos at risk, gate pass — that is my fleet read and it took me about ninety seconds. The exposure columns are visually divided from the posture columns by a `┃`, and the advisory counts arrive as a separate prop with a demo label, not as an input to the score. Good. That is the claim separation I came here to check and I do not have to guess at it. If the advisory fetch had failed I would have been told, in a warning box, that a blank column is not a clean bill of health. I would have written that sentence myself.

Governance next. Gate pass rate over *judged* repos, with an amber "Not judged" tile beside it so the denominator cannot quietly swallow a repo. Failing repos named. Policy shown read-only because I am not an owner. Then the evidence pack, and its card tells me the population is a lower bound and the identities are pseudonymous *before* I click anything — that is the order those sentences have to appear in, and most products get it backwards.

Then the control observations table, which is the thing I actually came for. `pass` reads "operating", `fail` reads "not operating", and a control we could not read is an em dash with a tooltip saying it is missing evidence, not a finding. The header counts "not operating" and "not readable" separately. Somebody understood the assignment.

And then I start reading rows, and three of them stop me.

**"Visibility · operating · public."** Visibility is not a control that operates. The catalogue itself says so — it flags this one a descriptor whose fact lives in the value, and instructs surfaces to render the value rather than the state. The surface renders the state. Green.

**"Published advisories · not operating."** In red. The catalogue's own sentence for that control is *"No coordinated-disclosure advisory was observed. NOT a statement that the repo is insecure."* That sentence exists, it is written, it is unit-tested — and it is never printed anywhere. I grepped. `failMeans` has zero consumers in the entire tree. So the one control on this page most likely to be misread as a vulnerability finding renders as a red failure with its disclaimer sitting in a source file. If I screenshot this table for the CISO, I have just told him nine repositories failed a security control. They did not.

Then the coverage column, which is where I stop trusting the table. "12 observations · largest gap 1d." That is my N. That is the number I would put in a workpaper. So I go and read where it comes from, and the state and the coverage are reading **two different windows in opposite directions**: the row's state comes from the newest 400 observations, the coverage sentence from the *oldest* 2000. On a ledger past two thousand rows those windows do not overlap at all — I would be printing a current state beside an observation count from a different month, and nothing on the page says either number was capped. The route that serves this data computes a `truncated` flag for exactly this reason. The card does not call the route.

And the repo count in that header — "13 controls across 6 repositories" — is over the 400-row slice, not over the fleet. Thirteen controls a repo, a daily heartbeat: four hundred rows is about thirty repo-days. Point that at a forty-repo fleet and whole repositories vanish from the table with no notice. A compliance number that silently excludes repos is the exact thing I have been burned by, and this is it, rebuilt with better comments.

The footer tells me to verify the ledger at `/api/audit/verify?org=…`. Not a button — a `<code>` string I am expected to paste into a browser and read raw JSON out of. I do it, because I am the kind of person who does. And it is *good*: the digest field order is published, the recipe ships in the body, the scope paragraph tells me exactly how far `chainOk: true` goes and admits an operator with database access could re-seal a rewritten day. That is a better honesty statement than most vendors' entire trust pages.

Except the recipe says an examiner recomputes the root "from the exported CSV." There is no export. No route emits control observations as CSV; the org export does not carry them. The one artifact the verification story is written around does not exist, so the check is reproducible in principle and unperformable in practice.

And sealing only happens *inside* that route. Nothing else seals. No cron, no job. So a ledger nobody manually curls is never sealed — while retention purges the observation rows. The route promises me a purged window "stays visible as a gap rather than disappearing," which is true only for days that got sealed before the purge, which is only days someone happened to curl. That condition is not stated anywhere.

Below the table, the Perimeter. The admission column is genuinely excellent copy — "seeded from the derived tier — nobody has decided" is a distinction almost nobody draws, and "tier not assessed" instead of defaulting to a number is right. It says admission "is the only half a gate can enforce," and the gate does apply the overlay automatically, tighten-only, on an unauthenticated endpoint, refusing to gate at all if the admission read fails. That is careful work. But the CODEOWNERS block, the ruleset proposal, the manifest oversight block — the artifacts that make the decision real in GitHub — have no UI at all. Two API routes, zero callers. Nothing on the page says so.

Audit tab last. Attributable, timestamped, filterable, keyset-paginated, CSV with a per-row integrity verdict and a `-PARTIAL` filename when it truncates. That one I file without argument.

So: I leave with a security read I trust, a governance read I trust, an audit export I would hand over as-is, an evidence pack whose caveats I respect — and a control ledger whose numbers I would have to re-derive by hand before citing. Which is a shame, because it is the best-designed thing here.

---

## 3. Findings

### NADIA-L1-01 — the control table's state and its coverage read opposite ends of two different unstated caps
**type** `trust` · **severity** major · **verdict** `confirmed` (`present-broken`)

`ControlTimelineCard.tsx:43-46` calls `listControlTimeline(slug, { limit: 400 })` → `orderBy: { occurredAt: "desc" }, take: 400` (`control-observations.ts:422-423`) and `controlCoverage(slug)` → `orderBy: { occurredAt: "asc" }, take: TIMELINE_CAP` (`:458-459`, `TIMELINE_CAP = 2000` at `:316`). One is the **newest 400**; the other is the **oldest 2000**. Past 2000 rows the two sets are disjoint, so a current state is printed beside an observation count and a max-gap drawn from an older, non-overlapping window.

Compounding it: `timelineTotals` (`controlTimeline.ts:106-113`) states `pairs`, `repos`, `failing`, `unmeasurable` **over the 400-row slice**, rendered as fleet fact at `ControlTimelineCard.tsx:72-77`. At the documented 24 h heartbeat × 13 controls (`scan-probe-controls.ts:159`; `catalog.ts:41-134`), 400 rows ≈ 30 repo-days — a 40-repo fleet drops repositories from the table entirely, unannounced.

`/api/org/controls` computes exactly the right disclosure (`truncated`, `limit` — `route.ts:57-60`) with a comment explaining why. **The card does not use the route** (`grep -rn "api/org/controls" src/` outside the route itself = **0 hits**).

**Why it costs her the job:** her single loudest peeve is a compliance number that silently excludes repos, and her coverage sentence is the N she would put in a workpaper. **Impact:** every visit, every org past ~30 repos or ~2000 rows; costs the ledger card its evidentiary value.
**Fix shape:** have the card read `/api/org/controls` (or take its caps as parameters), render `truncated`, and compute coverage over the same window as the states.

### NADIA-L1-02 — `failMeans` has zero consumers: the disclaimer that keeps "fail" from reading as "insecure" is never printed
**type** `trust` · **severity** major · **verdict** `confirmed` (`confirmed-absent`)

`catalog.ts:24-27` declares `failMeans` as *"What a `fail` on this control MEANS. Printed beside the state so nobody reads 'fail' as 'insecure' on a descriptor control."* The module header asserts *"The timeline card, the conformance pack and the alert message all read those from here"* (`:10-11`).

`grep -rn "failMeans" src/` outside `catalog.ts` and its test = **0 hits**. Only `controlLabel` is consumed (`controlTimeline.ts:63`, `scan-alerts.ts:350,387`, `api/cron/digest/route.ts:172`). `stateTone` (`catalog.ts:168-170`) likewise has **0 non-test callers** — the tone mapping is re-implemented inline at `ControlTimelineCard.tsx:34`.

Concretely, `published-advisories` renders as a red **"not operating"** while its authored sentence — *"No coordinated-disclosure advisory was observed. NOT a statement that the repo is insecure"* (`catalog.ts:110`) — never reaches a screen, an export, or an alert.

**Why it costs her the job:** this is her "implying a control exists that doesn't" trigger, inverted — implying a *failure* that isn't. A screenshot of this table overstates the fleet's security posture to a CISO.
**Fix shape:** print `failMeans` in the `StateCell` tooltip and beside every `fail` row; carry it into the alert body and the pack.

### NADIA-L1-03 — the `descriptor` contract is ignored; three controls render as double negatives
**type** `quality-gap` · **severity** minor · **verdict** `confirmed` (`present-broken`)

`catalog.ts:26-29`: *"True when the control is a DESCRIPTOR rather than a bar (`repo-visibility`): its state is always `pass` and the fact lives in `value`, so **a surface must render the value, not the state**."* `grep` for `descriptor` in the governance UI = **0 hits**. `StateCell` (`ControlTimelineCard.tsx:33-39`) renders `repo-visibility` as green **"operating · public"**.

Same shape from the negative labels: `repo-archived` → "Not archived · **not operating**", `repo-present` → "Repository reachable · **not operating**" — a double negative on a compliance surface, where the reader must invert twice to learn the repo is archived or 404ing.

**Impact:** every ledger view; three of thirteen catalogue rows. **Fix shape:** honour `descriptor` (render the value, suppress the state word) and phrase the two negatives positively ("Archived", "Unreachable").

### NADIA-L1-04 — no control-ledger export; the seal recipe is written around an artifact that doesn't exist
**type** `missing-feature` · **severity** major · **verdict** `confirmed` (`confirmed-absent`)

`seal.ts:23-25`: *"an examiner recomputes the root from the **exported CSV** with `sha256sum` and no key from us."* `SEAL_RECIPE.rowDigest`/`dayRoot` (`:94-102`) publish the exact recipe for that recomputation.

There is no such export. `/api/org/controls` returns JSON only — no `format=csv` branch (`route.ts:23-65`). `grep -rln "format.*csv|text/csv" src/app/api/` returns audit, history, backlog, conformance-pack, org/export, repositories, usage — **not controls**. `/api/org/export` carries no `ControlObservation` rows. `ControlTimelineCard` has no download link.

**Why it costs her the job:** the verification claim is the strongest thing in this feature and its delivery mechanism is absent. She can read the recipe and cannot execute it. **Fix shape:** `?format=csv` on `/api/org/controls` emitting `DIGEST_FIELD_ORDER` verbatim, plus a download link on the card.

### NADIA-L1-05 — `/api/audit/verify` has no UI, and because it is the *only* thing that seals, an unvisited ledger is never sealed — while retention purges the rows
**type** `confusion` + `trust` · **severity** major · **verdict** `confirmed` (`present-but-undiscoverable`, with a real consequence)

`grep -rn "audit/verify" src/` outside the route and its test yields exactly one UI reference: a `<code>` string in `ControlTimelineCard.tsx:134-135` instructing her to visit a raw-JSON endpoint. No button, no rendered verdict, no `chainOk` on any page.

The consequence is not cosmetic. `sealPendingDays` runs **only** from that route (`api/audit/verify/route.ts:47`; `control-observations.ts:693-697` — *"the ledger needs no cron of its own and no `vercel.json` entry"*). `verifySeals` never writes (`:670-671`). So on an installation nobody curls, **no day is ever sealed**. Meanwhile `retention.ts:1102` keeps seals but sweeps observations, and the route's `scope` string promises *"A day whose rows have all been purged under the retention policy is reported as `no-rows`: its seal is kept on purpose, so a deleted window stays visible as a gap rather than disappearing"* (`route.ts:76-80`). That guarantee holds **only for days sealed before the purge**, and nothing states the condition.

**Fix shape:** render the verdict on the Governance tab (a "Ledger integrity: chain verified through YYYY-MM-DD · N days unsealed" line with a Verify action); seal from the existing rescan/digest cron rather than from a read; state the seal-before-purge condition in `scope`.

### NADIA-L1-06 — the seal backlog can never close: 14 days per call, `unsealedDays` itself capped, no cron, no "call again"
**type** `trust` · **severity** minor · **verdict** `confirmed`

`sealPendingDays(orgSlug, now, cap = 14)` breaks at 14 sealed days per invocation (`control-observations.ts:697,702`) — documented in a code comment (*"the next call takes the next `cap` days"*) and **nowhere in the response**. Worse, `verifySeals` derives `unsealedDays` from `take: TIMELINE_CAP` newest observation rows (`:673-685`), so on a busy ledger the oldest unsealed days are not even *listed*, and no number of repeat calls reaches them. With NADIA-L1-05 (no cron) the chain has permanent holes.

`/api/audit/verify` returns `unsealedDays` and `sealedOnThisRequest` (`route.ts:71-72`), so the backlog is *inferable* from the data — which is why this is minor rather than major — but no sentence tells her to call again.
**Fix shape:** return `sealBacklogRemaining` and a one-line instruction; derive `unsealedDays` from a `DISTINCT day` query, not from a capped row read.

### NADIA-L1-07 — the gate-policy editor silently deletes `requireChecks`, and never shows it
**type** `broken-flow` · **severity** major · **verdict** `confirmed` (`present-broken`) · **precondition:** an org whose stored policy carries `requireChecks`

`requireChecks` is a real, enforced bar: sanitized and capped (`gate.ts:306-308`), union-merged by `tightenGatePolicy` (`:693-694`), and evaluated against the repo's own conformance report at gate time (`gate.ts:456-462`; `api/gate/[owner]/[repo]/route.ts:252-256`; `github/pr-gate.ts:130`).

`useGatePolicyEditor.ts:52-65` builds the submitted policy field by field and **never emits `requireChecks`**. `POST /api/org/gate-policy` replaces the whole policy (`route.ts:204-209` → `org-gate.ts:44-55`, `gatePolicy = JSON.stringify(clean)`). So any owner who edits any unrelated field wipes the org's required-check bars.

The safety net does not catch it: the "Saved, but NOT enforced: …" reconciliation (`useGatePolicyEditor.ts:105-116`) compares **the request against the echo**, so a field the form never sent is never reported as dropped. And `grep -rn "requireChecks" src/features/ src/components/org/` finds it rendered **nowhere** — not even read-only in `GovernancePolicyCard`.

Reachability is limited (only a hand-crafted POST can set it today — no UI writer exists), which caps the recurrence, not the severity. For Nadia this is CC8.1 poison: a control that disappears when someone edits an adjacent field.
**Fix shape:** round-trip unknown/unedited policy fields through the form, or make the POST a merge; render the full active policy read-only.

### NADIA-L1-08 — three unrelated things are called "controls" on adjacent tabs
**type** `confusion` · **severity** minor · **verdict** `confirmed`

- Security › **"Control matrix"** = the D9 deterministic check battery (`SecurityTab.tsx:123`)
- Passports › **Controls** = doctor check-ids, moonshot #16 (`features/standing/passports/controls/`)
- Governance › **"Control observations"** = the branch-protection ledger (`ControlTimelineCard.tsx:59`)

Three catalogues, three vocabularies, three `pass|fail|unmeasurable`-shaped state maps (`catalog.ts:168-170`; `controlMatrixView.ts:37`), no cross-reference between them. Add the near-homograph `requireChecks` (doctor check ids, `gate.ts:90`) vs `requireChecksRate` (branch-protection requires-status-checks, `org-signals.ts:359`, rendered as a tile at `DeliveryGovernanceSection.tsx:19`).

For a reader whose mental model is OpenSSF Scorecard — one per-repo control bundle — meeting three disjoint "control" surfaces is the friction that sends her back to the spreadsheet to work out which one she is supposed to cite.
**Fix shape:** name them distinctly on screen ("D9 check battery" / "Manifest conformance" / "Governance control ledger") and cross-link.

### NADIA-L1-09 — admission's artifact half is API-only, and the column implies otherwise
**type** `missing-feature` · **severity** minor · **verdict** `confirmed` (`confirmed-absent`, scoped)

`grep -rn "admission/propose|admission/ruleset" src/ --include=*.tsx` = **0 hits**. `AdmissionOverrideControl.tsx:37` posts only to `/api/org/admission` (record the decision). The CODEOWNERS managed block, the `.ai/manifest.yaml` `controls.oversight` block and the branch-ruleset proposal — three of the compiler's four artifacts (`admission.ts:11-13`) — are reachable only by hand-crafted POST. The declared "dry-run modal is unbuilt" gap is real and is **not disclosed on the surface**.

Scope the claim honestly: the **fourth** artifact, the gate-policy overlay, *is* applied automatically and tighten-only on every gate call (`api/gate/[owner]/[repo]/route.ts:229-251`), and it fails closed if the admission read errors (`:233-239`). So `AdmissionColumn.tsx:55-57` ("the only half a gate can enforce") is *true* — it just leaves her believing the CODEOWNERS/ruleset half also landed.
**Fix shape:** one sentence on the column naming which artifacts a decision does and does not write, plus the dry-run modal the routes already support (`admission/propose/route.ts:3,116-120`; `admission/ruleset/route.ts:13`).

### NADIA-L1-10 — named evidence exists only for the manifest, not for the CSVs an examiner re-verifies
**type** `quality-gap` · **severity** minor · **verdict** `confirmed`

`EvidencePackCard.tsx:69-79` offers exactly one named artifact — the **manifest**. The card's own justification is *"Export it when an examiner needs to re-verify specific rows against GitHub"* — and the rows live in `sample.csv` and `findings.csv`, which have no named variant (`:61-66`, `href(slug, file, named)` at `:17-21` supports it; the two links pass `false`).

### NADIA-L1-11 — the pack manifest omits the ledger seal root
**type** `polish` · **severity** polish · **verdict** `confirmed`

`docs/specs/moonshot/01-governance-evidence-ledger.md` write set: *"`csv.ts` as-of columns **+ seal root in the manifest**."* The as-of columns shipped (`csv.ts:77-83,146-163`); the Integrity section carries only the two file SHA-256s (`csv.ts:188-194`). No seal root, so a filed pack cannot be tied back to a sealed ledger day.

---

### Verified-and-honest (leads checked, no finding — `resolved-verified` candidates for L2)

| Declared gap / lead | Verdict |
|---|---|
| **No governance-history backfill** — as-of coverage starts at the ledger's birth | **Disclosed**, and in the strongest form: zero coverage prints *"NO row in this pack carries an as-of-merge control observation"* (`pack.ts:344-358`); the per-row `environmentAsOf.source` label and the `mergedRows`-denominated coverage table appear in both the CSVs and the manifest (`csv.ts:77-83,146-163`) |
| **Webhook rows are attribution-only** | **Correct and reasoned** (`governance-events.ts:1-26` — a payload-sourced state would *swallow* the probe's alert). Partially disclosed: the card says scan/probe rows carry no actor (`ControlTimelineCard.tsx:60`) but not that a webhook row asserts no state. Below finding threshold |
| **`ControlObservation.sig` is a dead column** | **True** — `recordObservations` (`control-observations.ts:167-190`) never writes it; only the *seal*'s `sig` is signed (`:573-586`). **No over-claim reaches her**: the only `signed` flag exposed is the seal's (`:294,530`), and `SEAL_RECIPE.limits` describes day seals, not per-row signatures. Dead code, not a trust defect |
| **`unmeasurable` never rendered as failed / `unknown` as off** | **Holds across every branch checked.** Ledger card: em dash + tooltip, counted separately (`ControlTimelineCard.tsx:25-32,72-77`). Conformance matrix: `RANK` puts `unchecked` **above** `pass` so an unmeasured clause can never hide behind a measured sibling, and a null cell renders as `unchecked` not blank (`controlMatrixView.ts:37,59-68`; `ControlCell.tsx:10-31`). Transitions: `control-unmeasurable` is `info` and never dispatched (`transitions.ts:58-67`), and `unmeasurable → pass` is deliberately not a celebration (`:80-88`). Digest: `state === "fail"` only (`api/cron/digest/route.ts:166`). Pack fallback: unreadable governance yields all-`unmeasurable`, never `fail` (`pack.ts:236-241`) |
| **Dependabot separate from D9 + demo labelled** | **Wired.** Separate prop, `advisoriesDemo` threaded to the register, and the `degraded` branch surfaced as an explicit warning (`SecurityTab.tsx:58-64,129-143`). Her acceptance criteria 2 and 3 pass |
| **Audit trail audit-grade** | **Wired.** Actor, timestamp, action/actor/date filters, keyset cursor, CSV with a recomputed per-row `integrity` verdict and `-PARTIAL` truncation honesty (`api/audit/route.ts:19-70`). Her acceptance criterion 5 passes |

---

## 4. Grounding score

Per `uat/env.md` §Grounding, verbatim denominators. **Every surface in this journey is deterministic.**

| Surface she touches | Score |
|---|---|
| Security tab (D9 averages, band, register, governance rates) | **N/A — not an LLM surface** (`buildSecurityOverview`, pure aggregation over persisted scans) |
| Governance tab (gate overview, fail reasons, failing repos, CI snippet) | **N/A — not an LLM surface** (`buildGovernanceOverview`) |
| Control ledger (observations, coverage, transitions, seals) | **N/A — not an LLM surface**; `transitions.ts` and `seal.ts` are pure, `catalog.ts:1-11` explicitly forbids a second mapper |
| Conformance pack (population, sample, verdicts, as-of) | **N/A — not an LLM surface**; `verdictFor` is four exhaustive deterministic cases (`pack.ts:210-214`), the sample is a seeded Fisher-Yates (`ATTESTATION.method`) |
| Admission compiler | **N/A — not an LLM surface** (`admission.ts:1-5`, "PURE compiler … no IO, no clock, no random") |
| Audit trail / CSV | **N/A — not an LLM surface** |
| *Adjacent, if she drills into a repo's D9 evidence from a report* | **Surface A**, denominator **N/11** (item 7 flag-gated off). Items **#10 branch governance** and **#11 D9 check battery** — the two she would cite — are both present (`prompt.ts:46-53,63-73,239,242`) |

**No named addition to the denominator.** Nothing this journey needs is missing from Surface A's canonical list; her trust problems are all in the deterministic layer, which is the right place for them to be.

---

## 5. Time saved

| | Her way | Ascent |
|---|---|---|
| Branch protection + required reviewers, 30 repos | ~6–8 min/repo in the GitHub UI + screenshot ≈ **3.5 h** | Security tile + Governance failing-repos card ≈ **3 min** |
| CODEOWNERS presence, 30 repos | ≈ **1 h** | control ledger row ≈ **1 min** |
| Open Dependabot alerts by severity | ≈ **1.5 h** | register exposure columns ≈ **2 min** |
| AI-change population + per-item review evidence for CC8.1 | **not feasible by hand** (she would sample PRs manually, ~1 day) | conformance pack, 3 files ≈ **2 min** |
| Change history / audit trail | screenshots, not a trail | filtered CSV with per-row integrity ≈ **3 min** |
| Collation into a spreadsheet + narrative | ≈ **4 h** | ≈ **20 min** |
| **Baseline total** | **≈ 10–14 h per audit cycle**, stale on export, not repeatable | **≈ 35 min** |
| **Minus rework this run forces** | | **+2–4 h** re-deriving the control table by hand (NADIA-L1-01), and no way to execute the published verification (NADIA-L1-04) |

**Net: ~7–10 hours saved per audit cycle, and re-pullable next cycle** — a decisive win over the spreadsheet, and it clears her time-saved bar (criterion 6) comfortably. It does **not** yet clear "file as-is": the ledger card is the one artifact she would have to reconstruct.

---

## 6. Verdict

**PASS WITH MAJOR RESERVATIONS.**

| Dimension | Verdict |
|---|---|
| **Completion** | **Pass.** All three surfaces reachable at member role, no self-hosted or plan gate. Fleet posture, named gaps, audit CSV and conformance pack all obtainable in one sitting |
| **Effort** | **Pass with friction.** Security → Governance → Audit spans two nav groups; ledger verification requires hand-typing a JSON URL (NADIA-L1-05); three surfaces named "controls" (NADIA-L1-08) |
| **Clarity** | **Pass.** Separated claims, visible denominators, honest empty states. The `pass`/`fail`/`unmeasurable` vocabulary is the best-executed part of the moonshot |
| **Trust** | **Conditional — the deciding dimension.** Criteria 1–5 all pass on their own terms; the ledger card breaks its own contract in three independent ways (01, 02, 03) and the verification story is unexecutable (04, 05). She would file the Security read, the Governance read, the audit CSV and the conformance pack. She would **not** file the control-observations table |
| **Missing pieces** | Control-ledger CSV export; a rendered integrity verdict; a sealing cron; the admission dry-run modal; a `requireChecks` editor |
| **Time-saved** | **Pass** — ~7–10 h/cycle net, re-pullable |
| **Senior-quality** | **Pass on four of five artifacts.** The pack's claims discipline, the `unmeasurable` third arm, the "not judged" denominator tile, and the seal's own statement of its limits are all above what she would produce herself. The control table is the exception, and it fails on her single loudest peeve — a number that silently excludes repos |

The shape of this run is unusual and worth stating plainly: **the design is better than the wiring**. Every honesty contract Nadia cares about was authored, commented, and unit-tested — `failMeans`, `descriptor`, `stateTone`, `truncated`, the CSV the seal recipe is written around. Five of the eleven findings are the same defect: a wave-4 lane wrote the correct behaviour into a module and the surface never reached for it. That is the exact refactor-shape the brief predicted, and it is a cheap class of bug to close.

---

## 7. `l2_priority` — with environment preconditions

Ordered by evidentiary value per minute of L2 time.

1. **NADIA-L1-01** — control table caps. *Precondition:* seeded org, ≥2000 `ControlObservation` rows across ≥30 repos (seed then loop the probe, or backdate `occurredAt`). *Check:* does the rendered repo count match the fleet; does the coverage `N` match a direct DB count for the same pair.
2. **NADIA-L1-04** — no ledger CSV. *Precondition:* seeded org + any observations. *Check:* `GET /api/org/controls?org=…&format=csv` and `/api/org/export` for observation rows; attempt the `SEAL_RECIPE` recomputation end to end from whatever exports exist.
3. **NADIA-L1-05** — verify unreachable + lazy sealing. *Precondition:* seeded org with observations spanning ≥2 closed UTC days, **never having called `/api/audit/verify`**. *Check:* `ControlLedgerSeal` row count before any call (expect 0); then call and observe seals appear.
4. **NADIA-L1-02 / 03** — `failMeans` and `descriptor` unrendered. *Precondition:* an org with at least one `fail` on `published-advisories` and a `repo-visibility` row. *Check:* read the rendered DOM for the disclaimer text and for "Visibility · operating".
5. **NADIA-L1-07** — `requireChecks` wipe. *Precondition:* **owner role** + a policy seeded by direct `POST /api/org/gate-policy` carrying `requireChecks`. *Check:* edit `minOverall` in the UI, save, re-`GET` the policy.
6. **NADIA-L1-06** — seal backlog. *Precondition:* ≥16 closed days of observations. *Check:* one call seals 14; second call seals the rest; are days beyond the 2000-row window ever listed.
7. **NADIA-L1-09** — admission artifacts. *Precondition:* owner + published stance + ≥1 admission row. *Check:* is any UI path to `propose`/`ruleset`; does the gate at `/api/gate/{owner}/{repo}` show the overlay applied.
8. **NADIA-L1-08 / 10 / 11** — cheap DOM/artifact reads; fold into whichever session is already on the tab. *Precondition:* seeded org; #10–11 need a downloaded pack.

**Blocked at L2 on this host:** none. Unlike the forecast fixture gap, every surface here is single-scan-reachable — though findings 01 and 06 need a ledger deliberately grown past its caps, which the standard seeders do not produce.
