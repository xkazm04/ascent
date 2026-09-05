# T1: AI-Governance Evidence Ledger · resolution

_2026-07-28. Resolves the five directions in `docs/GOLDEN-TRIO.md` §T1 into an implementable design.
Every capability claim below was re-verified against the code; the strategy doc's second-hand claims are
corrected inline and collected in §0. No source code was changed by this pass._

---

## 0. Corrections to the strategy doc (read this first)

| # | GOLDEN-TRIO claim | Verified reality | Impact |
|---|---|---|---|
| C1 | "`aiGovernedRate` … gated at **≥3** AI PRs" | Gate is **≥5**; `src/lib/analyze/pulls.ts:156` reads `aiGovernedRate: aiInvolved >= 5 ? pct(aiApprovedCount, aiInvolved) : null`. The `>=3` floor was deliberately raised; the reason is documented at `pulls.ts:151-155` ("at the old `>= 3` floor, a single unreviewed AI PR in a 3-PR window swings the rate ~33pts"). | Any pack/gate copy quoting "3" is wrong, and the **null rate is far more common than the doc implies**: most repos in a fleet will have `aiGovernedRate === null`. |
| C2 | "**named human approver** per AI-authored change" (D1) | **Does not exist and cannot be derived from stored data.** `aiApprovedCount` is an in-loop counter (`pulls.ts:114`) discarded after producing the ratio. PR nodes are never persisted. `Scan.prStats` (`prisma/schema.prisma:366`) is an aggregate JSON blob. The only PR-numbered table is `ImprovementPr` (`schema.prisma:630-655`), which records *ascent's own* remediation PRs and has **no reviewer column**. No `PullRequest` / `Commit` / `ScanContributor` table exists (`src/lib/db/scans-read.ts:901-908` names the gap explicitly). | **This is the single largest correction.** The Conformance Pack's headline promise requires new ingestion + a new table. Treated below as the keystone (§6). |
| C3 | "extend the existing deterministic 200/422 gate at **`/api/gate/:repo`** with a provenance policy" (D2) | Structurally impossible on that route. `/api/gate/[owner]/[repo]/route.ts:35-41` is **unauthenticated by design** and every ingest passes `noAmbientToken: true` (`:88`, `:133`) precisely so an anonymous caller can't read private data through the operator PAT. PR review data requires a token (`src/lib/scan.ts:283-289`: `prPromise` is `Promise.resolve(null)` without one). A provenance rule there would be permanently unevaluable on the exact repos that matter. | The **per-PR** provenance gate must live on the App check-run path (`src/lib/github/pr-gate.ts:61`), which mints an installation token (`:83`). A weaker **repo-level** provenance floor *can* live on `/api/gate` (see §2). |
| C4 | "an **immutable** audit log with per-row HMAC" | Signing is real (`src/lib/db/audit-integrity.ts:58-71`) but (a) `verifyAudit` (`audit-integrity.ts:76`) **has no caller in the application**: only its own test; there is no verify endpoint or UI, so tamper-evidence is write-side-only today; (b) `conformance.reported` rows are written with a raw `JSON.stringify` bypassing `withAuditSignature` (`src/lib/db/org-watch.ts:423-428`) and therefore verify as `"unsigned"`; (c) the table is **mutable and purgeable**: `purgeExpiredData` batch-deletes audit rows older than the org's `auditDays` (`src/lib/db/retention.ts:217-242`, `:518-522`). | "Immutable" must not appear in customer copy. The honest word is **tamper-evident** (per-row), and only once (a) and (b) are fixed. |
| C5 | "the signed history export" carries engine + model provenance | True, and better than the doc implies. `/api/history` CSV columns are `["scannedAt","overall","level","levelName","engine","model", D1..D9]` (`src/app/api/history/route.ts:27`) with `x-ascent-content-sha256` (`:95-104`). Persisted at `src/lib/db/scans-persist.ts:281-291` (`engineProvider`, `engineModel`, `rubricVersion`, `engineByom`). | Reusable as-is. Note **only** `/api/audit` and `/api/history` emit the content hash; `/api/org/export`, `/api/org/repositories`, `/api/usage` do not. |
| C6 | "repoint **Fleet Alerts**" (D4) implies an alert store to repoint | **There is no `Alert` model in Prisma.** An alert is a transient Slack-shaped webhook POST (`src/lib/alerts.ts:535-559`) plus, for regressions only, an `AuditLog` row `scan.regression` (`src/lib/scan-alerts.ts:101-113`) and an `OrgMemory` event (`src/lib/memory/scan-feed.ts:39`). Dedup is a **globalThis in-process Map** (`alerts.ts:204-225`), lost on cold start, so N serverless instances = up to N duplicate alerts. There is **no email delivery in the digest path** (Slack webhook only; `src/lib/email/*` exists but is not wired into `src/app/api/cron/digest/route.ts`). The reason taxonomy is closed: `"level-demotion" \| "posture-ungoverned" \| "overall-drop" \| "dimension-drop"` (`alerts.ts:29`) + `"level-promotion"` (`alerts.ts:134`). | D4 is **not** a repoint; it is "build the durable control-state store that alerts were never given." Re-scope from S to M. |
| C7 | "the `aiUsage.detected` bug (Renovate) must stay fixed and be regression-tested" | Fixed **and** tested, per `src/lib/analyze/index.ts:865-868` (`detected = aiInPrs > 0 \|\| hasTooling \|\| genuineAi > 0`), guarded by `src/lib/analyze/signals.test.ts:219-229` and `:377-388`. **But two live leaks remain:** (i) `src/lib/analyze/passport.ts:199-202` has a *parallel, looser* detector whose regex includes `.*\[bot\]` and a bare `(${AI_TOOL_ALT})` alternative that matches a Renovate co-author and any message merely containing "copilot"/"github-actions"; (ii) the legacy read-back fallback at `src/lib/db/scans-read.ts:946` computes `aiDetected` as `aiInPrs > 0 \|\| (prStats == null && aiCommitTotal > 0)`, which **does** light up on bot commits for rows persisted before `aiUsageJson` existed. Separately, `aiUsage.commitFraction` still intentionally counts bots (`index.ts:840-841`, pinned by `signals.test.ts:47-72`). | D3's contractual number must be derived from `genuineAi`/`aiInPrs`, never from `commitFraction`, and never through the passport or legacy paths. Both leaks are prerequisites, not nice-to-haves. |
| C8 | Doc citations `docs/ENTERPRISE.md`, `docs/BILLING.md`, `docs/MATURITY_MODEL.md`, `docs/AI_MANIFEST_SPEC.md` | **None of these files exist.** Billing docs live at `docs/features/billing/billing.md`; the `.ai` spec lives in code at `src/lib/standard/spec.ts`, not in `docs/`. | GOLDEN-TRIO's own source list is partly imaginary. Fix the citations. |
| C9 | D3: "CycloneDX / **SPDX-3.0-AI-profile**-shaped attestation" | **Category error.** The SPDX 3.0.1 AI profile describes *AI models as artifacts*: `ai_AIPackage` with `ai_typeOfModel`, `ai_energyConsumption`, `ai_informationAboutTraining`, `ai_safetyRiskAssessment` ([spec](https://spdx.github.io/spdx-spec/v3.0.1/model/AI/AI/)). It has **no class or property for "this source file was written by an AI tool."** Likewise CycloneDX `components[].modelCard` describes a model, not authorship. | See §4: D3 must be re-shaped or de-scoped. |
| C10 | Implicit: CycloneDX 1.6 | Current spec is **1.7** (2025-10-21), standardized as **ECMA-424** ([overview](https://cyclonedx.org/specification/overview/)). `declarations` (1.6) survives into 1.7. | Target 1.7. |

---

## 1. What actually exists: the verified inventory

**Evidence primitives that are real and reusable:**

- Per-row HMAC over `{action, orgId, actorId, createdAt, meta}` with recursive key-sort (`src/lib/db/audit-integrity.ts:32-71`). Inert without `AUDIT_SIGNING_SECRET || AUTH_SECRET` (`:17-19`): it degrades, never fails a write.
- `sha256Hex` + `x-ascent-content-sha256` response header on `/api/audit` (`src/app/api/audit/route.ts:69-82`) and `/api/history` (`src/app/api/history/route.ts:95-104`).
- ~35 distinct audit `action` strings across the app (full list enumerated during this pass; write helpers at `src/lib/db/scans-audit.ts:17-21`, `:58-66`, `:91-97`). Note `AuditLogViewer.tsx:18-31` only labels **12** of them.
- Atomic once-only claim + release, via `claimOrgAuditOnce` / `releaseAuditClaim` (`scans-audit.ts:91-143`), already used for digest idempotency.
- Branch-governance ingestion with **honest unknowns**: `src/lib/github/governance.ts:79-90` returns the ruleset fields; every failure path returns `null` rather than a fabricated `false` (`:50`, `:58`, `:69`, `:91-93`). `readable` distinguishes "no rules" from "couldn't read" (`src/lib/types.ts:431-445`). The gate honors this: `requireProtectedBranch` only fires when `governanceEnforce` (`src/lib/scoring/gate.ts:276`, `:295`).
- CODEOWNERS → `RepoTeam` (`src/lib/github/codeowners.ts:33-84` → `prisma/schema.prisma:331-344`), latest-scan-authoritative replace-all (`src/lib/db/scans-persist.ts:381-394`).
- Engine/model/rubric/BYOM provenance columns (`schema.prisma:358-359`, `:387`, `:392`).
- Org gate policy as policy-as-code, persisted as serialized JSON in a **TEXT** column (the no-jsonb DSQL contract), per `src/lib/db/org-gate.ts:29-57`, sanitized on write *and* read.
- One shared gate evaluator across CI, App check, and fleet view: `evaluateNormalized` (`src/lib/scoring/gate.ts:216`), with `evaluateGate` / `evaluateGateLite` wrappers and a single condition enumeration `describeGatePolicy` (`:92`) feeding the policy text, PR footer chips, gate URL, and Action `with:` lines.
- Fleet control-ish aggregation already computed (not stored): `buildGovernanceOverview` produces `byReason: {level, overall, dimension, posture, governance}` and `closestToGreen` (`src/lib/org/governance.ts:117`, `:188-202`).
- Retention with safety floors: `RETENTION_MIN_AUDIT_DAYS = 7`, sub-floor policies refused unless `RETENTION_FORCE=1` (`src/lib/db/retention.ts:73-74`, `:414-429`); 0 = keep everything, opt-in by default (`:11-14`, `:100-106`).

**Degradation contract to match everywhere below:**

- `isDbConfigured()`, at `src/lib/db/client.ts:538-540`; every db module opens with a guard returning a neutral value.
- `getDbMode()` → `"dsql" | "postgres" | "pglite" | "disabled"` (`src/lib/db/mode.ts:8-30`).
- `isAppConfigured()` (`src/lib/github/app.ts:33-35`).
- No canonical `hasGithubToken()`; token presence is read inline with an explicit `noAmbientToken` opt-out (`src/lib/scan.ts:275`, rationale at `:172-178`).
- `bumpCounter`, the best-effort write skeleton (`src/lib/db/best-effort.ts:11-18`).
- Cron auth fails **closed** on a missing `CRON_SECRET` (503) in both crons.

---

## 2. Direction 2: Ungoverned-AI-change gate

*(Sequenced first by the strategy doc; kept first, but split; see §7.)*

### Gap
`GateFailure["code"]` is a closed union of five values (`src/lib/scoring/gate.ts:33`) with no provenance member. `GatePolicy` (`:13-30`) has no AI-governance field. `GateSnapshot` (`:307-316`) carries no PR signals. And per C3, the public gate route can never see reviews.

### Design 2a: repo-level provenance floor (the shippable slice)

Add one condition to the existing policy machinery, using data the scan **already computes and persists**.

1. `GatePolicy` gains `minAiGovernedRate?: number` (0..100): "of AI-involved PRs, at least N% must carry a human approval."
2. `NormalizedGate` (`gate.ts:202-214`) gains `aiGovernedRate: number | null` and `aiGovernedEnforce: boolean`.
3. `evaluateNormalized` adds a rule that mirrors the `requireProtectedBranch` pattern exactly: **enforce only when measurable**. `null` (fewer than 5 AI-involved PRs, or no token) → rule **skipped**, never a fail. This is the honesty-preserving shape already established at `gate.ts:275-278`.
4. `GateFailure["code"]` gains `"provenance"`. Fan-out: `describeGatePolicy` (new `text`/`bit`/`query: ["min_ai_governed", N]`/`ci: min-ai-governed`), `sanitizeGatePolicy` (`floorScore` reuse), `explicitPolicyFromParams`, `policyFromParams`, `tightenGatePolicy` (`maxOpt`), `GovernanceOverview.byReason` (`src/lib/org/governance.ts:57`, `:117`), `buildGateComment`, `GatePolicyEditor.tsx`, `src/lib/pdf/security-document.tsx` risk register.
5. `GateSnapshot` gains `aiGovernedRate?: number | null`; the rollup must carry it per-repo. It is already aggregated org-wide at `src/lib/db/org-signals.ts:94-104` (analyzed-weighted, null-preserving); the per-repo value must be surfaced through `getOrgRollup` the same way `govReadable`/`protected` are (`src/lib/db/org-rollup.ts:374-375`).

**Degradation:** no token → `prStats` null → rate null → rule skipped, and the gate body should say so. Add `provenanceMeasurable: boolean` to the `/api/gate` JSON response body so a CI consumer can tell "passed the provenance rule" from "provenance was unmeasurable," the same distinction the `degraded` flag makes for the engine (`gate/route.ts:168-175`).

**Honesty constraints (2a):**
- Never render a skipped rule as a pass. The PR comment and the gate body must say **"AI governance: not measurable (fewer than 5 AI-involved PRs / no token)"**, not "✓".
- The denominator is *PRs matched by a keyword haystack*: author login + title + first 1500 chars of body + labels (`pulls.ts:107-116`). A PR authored with Copilot and never mentioning it is invisible. This is a **lower bound on AI involvement**, and the artifact must say so.
- "Approved" means a GitHub review with `state === "APPROVED"` (`pulls.ts:71`). It does **not** mean the approver read the diff, and it does not mean the approver was a CODEOWNER.

### Design 2b: per-PR named-approver gate (after the keystone, §6)
On `runPrGate` (`src/lib/github/pr-gate.ts:61`), which already holds an installation token: classify the PR head as AI-attributed (shared classifier, §6), then fail the check when the merging PR is AI-attributed and has no approving review from a CODEOWNER for the touched paths. `RepoTeam` (`schema.prisma:331-344`) supplies team ownership; individual `@user` owners are **deliberately excluded** by `TEAM_RE` (`codeowners.ts:16`), which is a real limitation for this rule and must be lifted or disclosed.

**Effort:** 2a = **S/M**, ~10-12 files (`gate.ts` + `gate.test.ts`, `gate-comment.ts`, `gate/route.ts`, `org-gate.ts`, `governance.ts`, `org-rollup.ts`, `org-signals.ts`, `GatePolicyEditor.tsx`, `security-document.tsx`, tests). 2b = **M**, ~8 files, **hard-depends on §6**.

**Open decisions:** (a) Does a skipped provenance rule leave the org's advertised pass-rate unchanged, or does the fleet view surface a third "unmeasurable" bucket? (b) Default value for `minAiGovernedRate` in `defaultGatePolicy("org")`: recommend **unset** (opt-in), because turning it on by default would move every org's pass-rate overnight.

---

## 3. Direction 1: the ISO/IEC 42001-mapped signed Conformance Pack

### Gap
Everything the pack would assert exists as *derived, in-memory* values recomputed per request. There is no snapshot artifact, no period concept, no clause mapping, and, per C2, no named approver. The audit CSV that would be the pack's row source is **capped at 10,000 rows, newest-first**, so the *oldest* evidence in a long window is silently dropped (`src/app/api/audit/route.ts:23`, `:58-66`).

### Design

**Data model** (Prisma; TEXT-JSON, no jsonb, per the `org-gate.ts` precedent):

```
model ConformancePack {
  id           String   @id @default(uuid())
  orgId        String
  periodStart  DateTime
  periodEnd    DateTime
  generatedAt  DateTime @default(now())
  generatedBy  String?          // actor login
  // Frozen evidence snapshot — the pack must NOT recompute on read, and must survive
  // retention purging its source audit rows.
  payload      String           // JSON ConformancePackPayload
  payloadSha   String           // sha256 of `payload`
  signature    String?          // HMAC over {orgId, periodStart, periodEnd, generatedAt, payloadSha}
  prevPackId   String?          // hash-chain: pack N carries pack N-1's payloadSha
  prevSha      String?
  schemaVer    String           // e.g. "pack/1.0.0"
  rubricVer    String           // SCORING_RUBRIC_VERSION at generation
  @@unique([orgId, periodStart, periodEnd])
  @@index([orgId, generatedAt])
}
```

The hash chain (`prevPackId`/`prevSha`) is the honest upgrade over per-row HMAC: it makes *deletion* of a quarter detectable, which the current scheme deliberately does not do ("no chain — so no concurrent-writer fork", `audit-integrity.ts:5-7`). That trade-off is correct for a high-write audit table and wrong for a low-write quarterly artifact, so a chain here does not contradict the existing design.

**Modules:**
- `src/lib/conformance/pack.ts`, pure assembler: `(orgSlug, period) => ConformancePackPayload`. No I/O, unit-testable.
- `src/lib/conformance/clauses.ts`, the ISO 42001 Annex A mapping table.
- `src/lib/conformance/sign.ts`, a thin wrapper over `signAudit`/`sha256Hex`; reuses the same secret resolution.
- `src/lib/db/conformance.ts`, persistence, `isDbConfigured()`-guarded.
- `src/lib/pdf/conformance-document.tsx`, modeled on `src/lib/pdf/security-document.tsx`, sharing `./theme`.

**Routes:** `POST /api/org/conformance` (generate, `requireOrgAdmin`), `GET /api/org/conformance` (list), `GET /api/org/conformance/[id]?format=pdf|json|csv` (fetch, with `x-ascent-content-sha256`), `GET /api/org/conformance/[id]/verify` (recompute the HMAC + chain and return a verdict). **The verify endpoint also closes C4(a)**: it should verify the underlying audit rows via `verifyAudit`, which currently has no production caller.

**UI:** a `Conformance` tab under `/org/[slug]/` beside `security` and `audit`. Keep each `.tsx` ≤300 LOC per `AGENTS.md`: expect `ConformanceView.tsx` + co-located `PackList.tsx`, `ClauseTable.tsx`, `PackGaps.tsx`.

**Annex A mapping (the honest subset).** ISO/IEC 42001:2023 has **38 controls in 9 groups, A.2–A.10**; there is no 2025-26 amendment I could verify, and it is *not* on the EU AI Act harmonisation track (that is prEN 18286). Annex A text is ISO-copyrighted: ship **control IDs + short titles only**, never verbatim clause text.

| Annex A control | What ascent can evidence | Evidence source |
|---|---|---|
| **A.6.2.8** AI system event logs | Signed audit trail of governance-affecting actions | `AuditLog` + `verifyAudit` |
| **A.6.2.4** AI system verification and validation | Gate policy + pass/fail history per repo | `evaluateGate`, `ConformancePack.payload` |
| **A.6.1.3** Processes for responsible design and development | Branch-governance posture: required approvals, code-owner review, status checks, signatures, linear history | `governance.ts:79-90` |
| **A.7.5** Data provenance *(partial, analogical)* | Engine/model/rubric provenance of every score | `engineProvider`/`engineModel`/`rubricVersion` |
| **A.9.2 / A.9.4** Responsible use / intended use | AI-tool taxonomy + `aiGovernedRate` | `ai-tools.ts:20-34`, `pulls.ts:156` |
| **A.3.2** AI roles and responsibilities | CODEOWNERS team attribution | `RepoTeam` |
| **A.10.2** Allocation of responsibilities | Org RBAC + membership roles | `Membership` |

Everything else in Annex A (A.2 policy, A.4 resources, A.5 impact assessment, A.8 information for interested parties, A.7.2-A.7.4/A.7.6 data controls) is **out of scope** and the pack must render those rows as *"not evidenced by ascent"* rather than omitting them. A mapping that shows only the clauses you cover reads as coverage.

### Honesty constraints (D1), the product-killing list
1. **Do not call it "ISO 42001 conformance."** It is *evidence that supports* specific Annex A controls for the SDLC of AI-assisted software development. ascent is not an accredited body and the org's AI *systems* are not in scope: only how they build software with AI.
2. **Do not market EU AI Act conformity.** Per GOLDEN-TRIO's own guardrail: high-risk obligations deferred to Dec 2027 / Aug 2028; only Art. 50 transparency lands Aug 2026. Additionally, ISO 42001 is *not* a harmonised standard for the Act.
3. **"Tamper-evident," never "immutable"** (C4). And the pack must state that per-row HMAC only proves a row wasn't *altered*; the chain proves a *pack* wasn't dropped; neither proves an event was *recorded*.
4. **Every token-gated field must carry a per-repo availability flag.** `aiGovernedRate`, `reviewedRate`, all six governance booleans, and the AI-tool counts are `null` on an anonymous scan. The pack must render `unavailable (no token)` distinctly from `0` / `false`. This is the single easiest way for this product to lie.
5. **Sample caps are claims.** `aiGovernedRate` is over the recent-PR window `fetchPrStats` fetched, not "all PRs ever." The commit window is likewise bounded. State the window and the N.
6. **Engine degradation must be stamped.** `report.engine.provider === "mock"` means the deterministic floor produced the score. The pack must show the engine/model mix for the period and refuse to present a mock-heavy quarter as an AI-graded one.
7. **Retention interacts.** If the org's `auditDays` is shorter than the pack period, the pack's audit-row section is incomplete by construction. Detect and disclose it. Also: the 10,000-row CSV cap drops *oldest* rows; the pack must not inherit that silently.
8. **Rescan wobble is unbounded** (tiger P2-7, `tiger/backlog.md:40-43`): temperature 0.2 + the ±15 realized guardband re-roll an unchanged repo's score once the 7-day SHA cache lapses, and `diffScans` has no noise floor. A quarter-over-quarter score delta in a signed pack is currently **not distinguishable from noise**. Either pin `LLM_TEMPERATURE=0` for any scan feeding a pack, or the pack must present score movement with an explicit noise band.

**Degradation:** no DB → generation returns 503 with "A database is required to produce a conformance pack" (packs are inherently durable artifacts; a synthesized in-memory pack would be a lie). No signing secret → generate the pack but stamp `signature: null` and `signed: false` prominently in the PDF header, matching `audit-integrity.ts:17-19`'s inert-not-failing posture.

**Effort:** **M/L**, ~14-18 files (1 Prisma model, 4 lib modules, 4 routes, 1 PDF, 3-4 components, tests). Depends on §6 for the named-approver section; **ship v1 without it** and mark that row "not evidenced."

**Open decisions:** (a) Is the pack a paid artifact? There is no generic feature registry: gating means a sixth hand-written predicate in `src/lib/plans.ts:163-189` (capability gate) *or* a new `CREDIT_REASON` plus a non-scan usage counter, since `countMeteredScansThisMonth` is hard-coded to `Scan` rows (`src/lib/db/credits.ts:295-297`). Recommend the **capability gate** (team+), because a metered pack creates an incentive not to generate evidence. (b) Quarter boundaries: calendar quarters, or arbitrary ranges? Recommend calendar-only for v1: arbitrary ranges invite cherry-picking, which is exactly what an assurance artifact must resist. (c) Who may generate: admin only, or any member?

---

## 4. Direction 3: code AI-BOM

### Gap and correction
Per C9/C10, the envelope the strategy names does not exist:
- **SPDX 3.0.1 AI profile** is about AI models as artifacts (`ai_AIPackage`, `ai_typeOfModel`, `ai_energyConsumption`); see [spec](https://spdx.github.io/spdx-spec/v3.0.1/model/AI/Classes/AIPackage/). SPDX 3.1 is at RC1 (2026-01-26). **No class for AI-authored code.**
- **CycloneDX 1.7 / ECMA-424**: `components[].type` enum is `application, framework, library, container, platform, operating-system, device, device-driver, firmware, file, machine-learning-model, data, cryptographic-asset`; see [1.7 schema](https://raw.githubusercontent.com/CycloneDX/specification/master/schema/bom-1.7.schema.json). `modelCard`/`modelParameters` describe a model. There is **no numeric attribution field**, and the `cdx:` property namespace is **reserved to the CycloneDX Core WG**: you may not mint `cdx:ai:*` yourself ([taxonomy repo](https://github.com/CycloneDX/cyclonedx-property-taxonomy)).
- **in-toto** vetted predicates and **SLSA Provenance v1.x** contain nothing about AI authorship ([predicates](https://github.com/in-toto/attestation/tree/main/spec/predicates)).
- **CISA/G7 "SBOM for AI — Minimum Elements"** is real (June 2026, voluntary, additive), but its seven element clusters are about *models, datasets, infrastructure, adversarial robustness*, i.e. AI systems, **not** AI-written code ([CISA listing](https://www.cisa.gov/resources-tools/resources/software-bill-materials-ai-minimum-elements), [mirror](https://www.bsi.bund.de/SharedDocs/Downloads/EN/BSI/KI/SBOM-for-AI_minimum-elements.pdf)).
- The only real-world convention is **git commit trailers** (Apache's `Generated-By`, OpenInfra's mandatory `Assisted-By`), with no registry, schema, or verification. Which is exactly what `AI_TRAILER` (`src/lib/analyze/index.ts:581-585`) already parses.

**Conclusion: "AI-BOM as a standard document type" does not exist to conform to.** Building to an invented schema and calling it CycloneDX/SPDX would be the exact over-claim this product cannot survive.

### Design (the defensible version)
Emit a **CycloneDX 1.7 `declarations` attestation**, which *is* the designed home for signed claims-with-evidence, rather than a fake BOM component type:

- `declarations.assessors[]`: ascent as a third-party assessor.
- `declarations.targets.components[]`: the repos.
- `declarations.claims[]`: `predicate` = the plain-English claim ("≥N% of merged PRs in the period carried an AI attribution marker; of those, M% had an approving human review"), plus `reasoning` = the method disclosure and `counterEvidence` = the known false-negative modes.
- `declarations.evidence[]`: `propertyName` + `data` + `created`/`expires` + `author`, per-item signable.
- `declarations.affirmation`: the statement + signatory.
- Numbers ride in `properties[] {name, value}` (value is a **string**) under a **registered non-`cdx` namespace** (`ascent:ai:...`): registration is an issue on the taxonomy repo.
- Do **not** repurpose `components[].evidence.identity[].confidence` (a real 0-1 float): its semantics are "confidence this component is what we say it is," not "fraction of AI-authored code."

Genuinely open standards path, if the human wants it: propose an **in-toto predicate type** for AI-authorship disclosure. Nobody occupies it.

**Modules:** `src/lib/conformance/cyclonedx.ts`, a pure serializer over the same `ConformancePackPayload` as D1. This is why D3 is cheap *after* D1 and expensive before it.

**Honesty constraints (D3), the sharpest in the whole of T1:**
1. **Never state a "% of the codebase that is AI-written."** Nothing in this codebase measures that. What is measurable is: % of *PRs in a bounded window* carrying an AI marker, and % of *commits in a bounded window* with an AI co-author trailer. Both are **lower bounds** with unknown false-negative rates.
2. `commitFraction` is **not** an AI number: it counts every `[bot]` author including Renovate, by design and by pinned test (`index.ts:840-841`, `signals.test.ts:47-72`). It must never be serialized into a BOM.
3. C7's two leaks (`passport.ts:199-202`, `scans-read.ts:946`) must be fixed and regression-tested **before** any of this becomes a contractual artifact.
4. Declare the method: exact regexes, the window size, the token requirement, and that a silent AI-assisted commit is undetectable.
5. Do not call the output a "CycloneDX SBOM." It is a **CycloneDX 1.7 attestation document**.

**Effort:** **S** as a serializer *after* D1 (~3-4 files); **L** and inadvisable as a standalone effort. Hard-depends on D1 and on the C7 fixes.

**Open decision:** register an `ascent` namespace in the CycloneDX property taxonomy (public, permanent, slow) or keep everything in `declarations.claims[].predicate` free text (private, immediate, less machine-readable)? Recommend claims-first, register later.

---

## 5. Direction 4: continuous control monitoring

### Gap
Per C6: there is no alert store, no control identity, no cross-repo predicate, no durable dedup, no acknowledge/resolve state, and no email. The closest thing to "control failed in N repos" is `topRecommendation: {title, repoCount}` in the weekly digest (`src/lib/alerts.ts:347`), a recommendation title and a count, not a rule.

Note the asymmetry that makes this direction valuable anyway: `buildGovernanceOverview` **already computes** the fleet control state (`byReason`, per-repo failures, green-path) on every page load (`src/lib/org/governance.ts:117`, `:130-181`). It is thrown away each time. The whole of D4 is "store that, and diff it."

### Design

```
model ControlSnapshot {
  id          String   @id @default(uuid())
  orgId       String
  takenAt     DateTime @default(now())
  // One row per (org, control, period) — the fleet state of ONE control.
  controlId   String   // "gate.level" | "gate.dimension" | "gate.posture" | "gate.governance"
                       // | "gate.provenance" | "branch.protected" | "branch.signatures"
                       // | "branch.codeowner_review" | "ai.governed_rate"
  failing     Int
  passing     Int
  unmeasurable Int     // <- the honesty column: repos where the control could not be evaluated
  repoSample  String   // JSON: up to N failing repo fullNames
  @@unique([orgId, controlId, takenAt])
  @@index([orgId, controlId, takenAt])
}
```

- `src/lib/controls/registry.ts`, the control catalogue: `{id, title, annexA: string[], source}`. This is the join key to D1's clause table **and** to D5's GRC push, so it must exist before either.
- `src/lib/controls/evaluate.ts`, pure: `(rollup, policy) => ControlState[]`. Extracted from `governance.ts` so page + cron + pack share one evaluator (the pattern `evaluateNormalized` already establishes).
- `src/app/api/cron/controls/route.ts`, daily, `CRON_SECRET` fail-closed, `claimOrgAuditOnce` idempotency, `SOFT_DEADLINE_MS` + `remaining` in the response, copying `digest/route.ts:48-90` verbatim in structure.
- Alerting: extend `RegressionReason["code"]` with `"control-failed"` and add a `buildControlAlertMessage`. Fire when a control's `failing` count **crosses** an org-configured threshold (new `Organization.controlAlertThreshold`), reusing the crossing-detection shape of `isLowCreditsCrossing` (`alerts.ts:436-439`) so a persistently-failing control doesn't alert daily.
- **Durable dedup**: use `claimOrgAuditOnce` instead of the in-process Map (C6). This also incidentally fixes duplicate regression alerts across serverless instances, worth doing regardless.

**Degradation:** no DB → cron returns 200 `{skipped}` like the digest (`digest/route.ts:91`). No webhook → `dispatchAlert` returns false, snapshot still written (the *timeline* is the product; delivery is secondary). No token on scans → controls that need governance data report `unmeasurable`, never `failing`.

**Honesty constraints (D4):**
1. `unmeasurable` must be a first-class column, surfaced in every UI and every export. Collapsing unmeasurable into passing is the failure mode that would make an auditor-facing timeline fraudulent.
2. A control's *history starts when you start recording it.* Do not back-fill `ControlSnapshot` from historical `Scan` rows and present it as continuous monitoring: an org's older scans were taken under a different policy (`gatePolicy` is mutable and its changes are audited as `org.gate_policy`, `src/app/api/org/gate-policy/route.ts:155`, but the *scans* aren't stamped with the policy in force). Either stamp the policy hash into each snapshot, or say "monitoring since <date>."
3. "Branch protection removed" is only detectable when governance was readable both before and after. A token-scope change looks identical to a policy change. Report `readable→unreadable` as a distinct state, not as a removal.

**Effort:** **M**, ~10-12 files (1 model, 3 lib modules, 1 cron route, alert extensions, an org page section, tests). Soft-depends on D2a for the `gate.provenance` control. **Feeds D1** (the pack's timeline section) and **is the payload for D5**.

**Open decisions:** (a) Snapshot cadence: daily is honest but 365 rows/control/org/year; weekly matches the digest. Recommend **daily write, weekly alert**. (b) Does `ControlSnapshot` fall under `retentionAuditDays`? If yes, the pack's timeline silently truncates; recommend a separate, longer floor.

---

## 6. The keystone the strategy doc doesn't name: per-change provenance

D1's named approver (C2), D2b's per-PR gate (C3), D3's honest denominator, and D4's `ai.governed_rate` control all bottom out on the same missing thing: **a durable row per AI-attributed change**.

```
model AiChange {
  id           String   @id @default(uuid())
  repoId       String
  prNumber     Int
  headSha      String
  mergedAt     DateTime?
  // Attribution — the classifier's OUTPUT plus its INPUT, so a claim is re-auditable.
  aiTool       String?  // from AI_TOOLS taxonomy, or null = "marker matched, tool unknown"
  markerKind   String   // "author-bot" | "trailer" | "body-marker" | "label"
  markerText   String   // the matched substring, capped — the evidence for the claim
  // Governance
  approvedBy   String?  // GitHub login of the first APPROVED review, null = unapproved
  approvals    Int
  codeownerApproved Boolean?  // null = CODEOWNERS unreadable
  ingestedAt   DateTime @default(now())
  @@unique([repoId, prNumber])
  @@index([repoId, mergedAt])
}
```

Populated from the PR nodes `fetchPrStats` **already fetches and discards** (`src/lib/analyze/pulls.ts:110-116`, `:299-309`), so the marginal GitHub cost is **zero**; this is a persistence change, not an ingestion change. `pulls.ts` must expose the per-PR records alongside the aggregate; `scans-persist.ts` writes them (replace-per-scan, mirroring the `RepoTeam` pattern at `:381-394`).

**Honesty constraints:** `markerText` is what makes the whole product defensible: every named claim carries the string that produced it, so a customer can challenge a specific row rather than the whole number. `codeownerApproved: null` (unreadable) must never render as `false`. And storing GitHub logins is **personal data**: it needs a retention story (`retentionAuditDays` or its own) and a decision about whether it appears in exports.

**Effort:** **M**, ~6-8 files (1 model, `pulls.ts`, `scans-persist.ts`, `scans-read.ts`, a query module, tests). Everything else in T1 gets cheaper and more honest once this lands.

---

## 7. Direction 5: GRC connectors

### Gap
Nothing exists: no outbound integration framework, no connector credential storage beyond `OrgLlmConfig`'s AES-256-GCM pattern (`prisma/schema.prisma:860-879`), no push scheduler.

### Design + vendor reality (verified)

| Vendor | Create custom control | Push evidence | Auth | Gating |
|---|---|---|---|---|
| **Drata** | `POST /workspaces/{id}/controls`, plus custom frameworks/requirements | 3 paths: `POST /public/workspaces/{ws}/controls/{id}/external-evidence` (file), `POST /workspaces/{ws}/evidence-library` (with `controlIds[]`), Custom Connections `POST /public/custom-connections/{c}/resources/{r}/records` | API key, `Authorization: Bearer` | Self-serve keys; Custom Connections/Tests need **Advanced/Enterprise** |
| **Vanta** | `POST /v1/controls` (`externalId`, `name`, `description`, `effectiveDate`, `domain`, optional `sections` for framework mapping) | `PUT /v1/resources/{resourceKind}`: a **full-state upsert**; omitted `uniqueId`s are treated as **deleted**. Max 10k resources / 10MB. `custom_resource` schema is JSON Type Definition, scalars only. | OAuth2 (`POST https://api.vanta.com/oauth/token`); **one active token per Application**: minting revokes the previous | Private integrations self-serve; public marketplace needs partner review; a private app **cannot** be converted to public |
| **Secureframe** | Unverified | Capability claimed, endpoints unverified (docs are a client-rendered SPA) | API key + secret | Custom Integrations = **Complete plan only**; **repositories explicitly not a supported resource type** |

Sources: [Drata](https://developers.drata.com/openapi/reference/v2/tag/Evidence-Library/), [Vanta resources](https://developer.vanta.com/docs/concepts/resources.md), [Vanta controls](https://developer.vanta.com/api-reference/controls/create-custom-control.md), [Secureframe custom integrations](https://support.secureframe.com/en/articles/15111548-create-custom-integrations).

**Build Drata first, not Vanta.** Drata is the only vendor where create-control → create-requirement → attach-evidence is *every step* a documented public endpoint on a self-serve key. The strategy doc lists Vanta first purely by market share.

**Design:** `src/lib/grc/{types,drata,vanta}.ts` behind one `GrcConnector` interface (`pushControls(ControlSnapshot[])`, `pushPack(ConformancePack)`); credentials in a new `OrgGrcConfig` reusing `OrgLlmConfig`'s AES-256-GCM column pattern; push from the same cron as D4; every push writes an audit row (`grc.pushed` / `grc.push_failed`).

**Honesty constraints:** Vanta's full-state upsert semantics mean a partial push **deletes** resources: a failed page must abort the whole push, not commit half. And a control marked "passing" in a GRC tool is a compliance assertion with real consequences; `unmeasurable` must map to the vendor's "not applicable"/"needs review" state, **never** to passing.

**Effort:** **M** per connector (~8 files + credential model), plus non-engineering cost (partner review for Vanta public, plan gating on both). **Hard-depends on D4** (there is nothing to push without `ControlSnapshot`) and on the D1 pack for the document evidence path.

---

## 8. Ranking and recommended build order

Value ÷ effort, given what the code actually is:

| Rank | Item | Value | Effort | Ratio | Why here |
|---|---|---|---|---|---|
| **0** | **Integrity prerequisites** | High (defensive) | **S** (~5 files) | ★★★★★ | Sign `conformance.reported` (`org-watch.ts:423-428`); give `verifyAudit` a caller; fix the two `aiUsage` leaks (`passport.ts:199-202`, `scans-read.ts:946`); fix or disclose the 10k CSV row cap. **Every other direction inherits these defects.** Not in the strategy doc at all. |
| **1** | **D2a: repo-level provenance gate** | High | **S/M** | ★★★★☆ | Genuinely the sharpest unclaimed slice, genuinely small, ships on shipped data, uses the shared evaluator. Agrees with the doc's "2 first." |
| **2** | **§6: `AiChange` persistence (keystone)** | Very high | **M** | ★★★★☆ | Zero marginal GitHub cost; unlocks the named approver, D2b, D3's denominator, and D4's provenance control. The doc's biggest blind spot. |
| **3** | **D4: continuous control monitoring** | High | **M** | ★★★☆☆ | The evaluator already exists and is discarded per request; the timeline is what auditors buy; it is D5's entire payload. **Promoted above D1**, against the doc. |
| **4** | **D1: Conformance Pack** | Very high (WTP) | **M/L** | ★★★☆☆ | The revenue artifact, but it is worth more with a real timeline (3) and real approvers (2) behind it. Shipping it first means shipping a pack whose headline row says "not evidenced." |
| **5** | **D3: CycloneDX attestation** | Medium | **S** *after* D1 | ★★☆☆☆ | A serializer, not a project. **Demoted**: the envelope the doc names doesn't exist, and this is the highest over-claim risk in T1. |
| **6** | **D5: GRC connectors (Drata first)** | Medium-high (distribution) | **M**/connector + partner cost | ★★☆☆☆ | Correctly last. Nothing to push before 3 and 4. |

**Recommended order: 0 → D2a → §6 keystone → D4 → D1 → D3 → D5.**

**Disagreements with the doc's `2 → 1 → 4 → 3 → 5`:**
- Insert an unnamed **§0 integrity pass** and the **§6 persistence keystone**. Without the latter, D1 ships without its headline claim and D3 ships without an honest denominator.
- **Swap 1 and 4.** The doc has it that the gate "generates the evidence stream the Pack sells," which is true, but the *fleet* evidence stream is D4's `ControlSnapshot`, not D2's per-PR verdicts, and a pack over one quarter of stored control state is a materially stronger artifact than a pack over recomputed aggregates.
- **D3 is not a standalone direction.** Fold it into D1's export surface.
- **Drata before Vanta** in D5.

---

## 9. The biggest risk

Not effort. **The engine cannot currently support a signed number.** Two open tiger items (`tiger/backlog.md:26-43`) bear directly on T1: the public tier runs an **unbenchmarked** cheap model, and rescan wobble has **no noise floor**: temperature 0.2 plus the ±15 realized guardband re-rolls an unchanged repo's score once the 7-day SHA cache lapses, and `diffScans` reports the delta with no R²/flat-floor/CI gate. A buyer of an *evidence* product who sees an unchanged repo move between two signed quarters will not buy the next one, and the artifact is signed, so the wrong number is permanent. `docs/VALUE-CASE.md:37-38` (D29) already prescribes the fix: `LLM_TEMPERATURE=0`, pinned model + prompt version, an SDK provider rather than `claude-cli` (which has no temperature knob at all). **Treat D29 as a hard precondition of D1**, not a parallel workstream.

Second-order: `docs/VALUE-CASE.md:40-41` (D30), the GitHub-native scoring bias is claimed fixed and **never re-scan-validated**. A conformance pack that scores an off-GitHub-CI shop low is an assurance artifact that is wrong about the customer.

## 10. Open decisions for the human

1. **Precondition gate:** do D29 (reproducibility) and D30 (bias re-validation) block D1's ship, or does the pack ship with an explicit "scores are indicative, not reproducible" caveat? (Recommend: block. This is an assurance product.)
2. **Pack packaging:** capability gate (team+) vs metered credit? (Recommend: capability.)
3. **`AiChange` and personal data:** GitHub logins in a durable, exportable, signed artifact: retention window, and do they appear in the customer-facing pack or only in the internal evidence?
4. **CODEOWNERS individuals:** `TEAM_RE` (`codeowners.ts:16`) deliberately ignores `@user` owners. D2b's "CODEOWNER approved" rule is wrong for any org that owns by individual. Lift the restriction, or disclose the limitation?
5. **CycloneDX namespace registration**: public `ascent` namespace, or claims-only?
6. **Chain vs no chain** on `ConformancePack`: a chain makes deletion detectable but introduces the fork problem `audit-integrity.ts:5-7` deliberately avoided. (Recommend: chain, because pack writes are rare and serialized.)
7. **Default `minAiGovernedRate`** in `defaultGatePolicy("org")`: unset (recommended) or a value that moves every org's pass-rate on deploy?
8. **Naming.** "Conformance Pack" collides with the existing `conformance.reported` / `aiConformance` columns (`src/lib/db/org-watch.ts:410-430`), which mean `.ai/` standard conformance, a completely different thing. Rename one of them before both exist.
