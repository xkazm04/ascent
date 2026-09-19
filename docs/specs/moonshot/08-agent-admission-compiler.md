# 08 — Agent-admission compiler: stance + autonomy tier become enforced per-repo controls

size XL · effort 8 / impact 9 / risk 6 · gate: **policy** · lane **W4-O** · wave **4**

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/lib/org/stance.ts` — `StanceFinding.code` gains `no-ai-zone-path` + `review-tier`; the
  degenerate `advisory` flag becomes real; `evaluateStanceCompliance` takes an optional
  `RepoAdmission` + observed-control input.
- `src/lib/scoring/gate.ts` — `GatePolicy.forbidAiAuthorship`, `NormalizedGate.aiInvolvedRate`,
  `GateFailure.code += "admission"`, `sanitizeGatePolicy`/`tightenGatePolicy` coverage, and the
  `policyFromParams` `minAiGovernedRate` drop (BACKLOG group-05 defect) that makes an overlay
  meaningless on the no-org-policy path.
- `src/app/api/gate/[owner]/[repo]/route.ts` — resolve the admission row, **tighten-only** overlay.
- `src/lib/github/pr-gate.ts` — the Check Run path takes the same overlay (one evaluator, no fork).
- `src/lib/mcp/handlers.ts`, `src/lib/mcp/tools.ts` — `get_ai_stance` gains an optional `repo` arg
  and returns the compiled control set + admission mode; the "declared policy, not a runtime
  control" string is replaced by an honest per-clause enforcement map.
- `src/lib/standard/manifest.ts`, `src/lib/standard/types.ts` — `controls.oversight` block.
- `src/features/standing/governance/stance/StancePerimeter.tsx`, `perimeterParts.tsx` — admission
  column wiring only (both stay under 200 LOC).
- `src/features/standing/passports/autonomy/autonomyModel.ts` — delete the `DATA_MODEL_GAPS` entry
  `"owner override: … a grant should also be an overridable recorded decision"` (this closes it).
- `docs/features/org-dashboard/org-intelligence.md` (AI stance section), `docs/features/scanning/gate.md`.

**Files to create**
- `src/lib/org/admission.ts` — pure `compileStance()` + tier→policy derivation (no IO).
- `src/lib/org/admission-artifacts.ts` — pure CODEOWNERS / manifest-oversight / ruleset-JSON
  renderers + the managed-block merge and unified-diff helper.
- `src/lib/db/org-admission.ts` — row read/upsert, org-scoped.
- `src/lib/github/admission-write.ts` — the ruleset proposal + owner-confirmed apply/revert
  (installation token, `githubAppFetch`), and the CODEOWNERS merge-PR writer.
- `src/app/api/org/admission/route.ts`, `src/app/api/org/admission/propose/route.ts`,
  `src/app/api/org/admission/ruleset/route.ts`.
- `src/features/standing/governance/stance/admission/AdmissionColumn.tsx`,
  `AdmissionOverrideControl.tsx`, `ProposalDryRunModal.tsx`, `admissionRows.ts`.
- Tests (see **Tests**).

**Prisma models/columns needed (landed by the wave-4 schema pass, not by this lane)**
```prisma
model RepoAdmission {
  id            String   @id @default(uuid())
  orgId         String
  repoFullName  String   // "owner/name" — denormalized, no FK (mirrors OrgArtifactAck)
  stanceVersion Int      // the OrgAiStance version this decision was made against
  derivedTier   String?  // "T0".."T3" — copied from the passport resolver; NULL = not assessed
  grantedTier   String   // "T0".."T3" — the recorded, overridable decision
  mode          String   @default("assisted-only") // agents-allowed | assisted-only | blocked
  decidedBy     String?  // GitHub login; NULL = seeded from the derived tier, never decided
  decidedAt     DateTime?
  rationale     String   @default("")
  rulesetId     String?  // GitHub ruleset id when an apply landed — the reversal handle
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([orgId, repoFullName])
  @@index([orgId, mode])
}
```
Also: `wire-safe-dates.test.ts` entry for `RepoAdmissionRow` (`decidedAt`/`createdAt`/`updatedAt`
declared `string`); `init.sql` + PGlite reconcile rows.

**Director-owned lines requested at merge**
- `src/lib/db/org.ts`: `export * from "@/lib/db/org-admission";` (`db/index.ts` already
  `export * from "@/lib/db/org"`, so no barrel edit is needed there).
- `context-map.json`: `filePaths` for `src/lib/org/admission*.ts`, `src/lib/github/admission-write.ts`,
  `src/features/standing/governance/stance/admission/**` under **Practices, Governance & Adoption**.
- `scripts/docs/feature-doc-map.json`: add `src/lib/org/admission*.ts` and
  `src/app/api/org/admission/**` to the `org-intelligence.md` globs, and
  `src/lib/github/admission-write.ts` to the `github-app.md` globs.

**MUST NOT TOUCH**
`prisma/schema.prisma` · `prisma/init.sql` · `src/lib/db/index.ts` · `src/lib/db/wire-safe-dates.test.ts` ·
`context-map.json` · `scripts/docs/feature-doc-map.json` · `src/lib/conformance/pack.ts` and
`src/lib/alerts.ts` (**W3-M's alone**) · `src/lib/db/retention.ts` (W1-F) · `src/lib/practices/apply.ts`
(W2-J2 — this lane *calls* `openArtifactDraftPr`, never edits it) · `src/lib/github/write.ts`
(`openDraftPr`'s refuse-to-clobber rule is load-bearing; the merge-append writer is a sibling module) ·
`src/lib/org/followups.ts` and `src/lib/local/**` (W4-N).

**Handoffs to other lanes**
1. **W3-M (evidence ledger)** — stamp `stanceVersion` + `admission.mode` on each sampled row of the
   conformance pack, and read `ControlObservation` for observed required-approval counts. This lane
   exports `compileStance()` and `getRepoAdmission()`; W3-M lands the pack columns.
2. **W3-M** — an `AlertEvent.kind = "control"` firing when an applied ruleset is observed removed
   (admission says T0/enforced, `ControlObservation` says the rule is gone).
3. **W1-F (retention)** — `RepoAdmission` rows join the org-erase cascade and the repo-removal purge.
4. **W2-K / W4-N (MCP)** — this lane adds the `repo` argument to `get_ai_stance`'s input schema; the
   tool name, auth scope (`mcp:read`) and result envelope are unchanged.

## Goal and the Known gaps this deletes

Turn the org's declared AI stance and each repo's derived autonomy tier into a **recorded, overridable
per-repo admission decision** that compiles into machine-checkable controls — CODEOWNERS coverage for
no-AI path zones, a branch ruleset proposal, `.ai/manifest.yaml controls.oversight`, and a tighten-only
gate overlay — every customer-repo write shipped as a reviewable proposal, never a silent mutation.
*Competitive angle:* readiness scorers score and code scanners block, but nobody compiles a declared
oversight policy into per-repo, tier-graded enforcement for a fleet running several agents at once.

Gaps deleted in the same PR:
- `src/features/standing/passports/autonomy/autonomyModel.ts` `DATA_MODEL_GAPS`: *"owner override:
  pp.autonomy is derived + persisted, but a grant should also be an overridable recorded decision."*
- `docs/features/org-dashboard/org-intelligence.md` §"AI stance": the blanket *"never enforced, and
  the copy must never claim it is"* becomes a **per-clause** enforcement map (what is compiled and
  checkable vs what stays declared) — the honesty rule is kept, its scope is narrowed to the truth.
- `src/lib/mcp/handlers.ts` `enforcement:` string ("declared policy, not a runtime control").
- BACKLOG group-05 defect: *"`StanceFinding.advisory` is never emitted true so `compliant` is
  degenerate"* — the new `no-ai-zone-path` finding is the first genuine `advisory: true`.
- BACKLOG group-05 defect: *"gate `policyFromParams` drops `minAiGovernedRate` on the no-org-policy
  path"* — required here, because the overlay must survive both precedence paths.

**Premises verified — all held.** `evaluateStanceCompliance` checks exactly four things with every
push at `advisory: false` and a degenerate `compliant` (`stance.ts:212-274`);
`permittedModels`/`reviewTiers`/`pathGlobs` declared and unchecked (`types.ts:465-505`);
`STANCE_ARTIFACT_PATH = "AI_POLICY.md"` + the "not enforced by tooling" disclaimer
(`stance-artifact.ts:20,74`); the gate route imports no stance module and reads one org-wide policy
(`route.ts:13-16,197-199`); `NormalizedGate` carries no tier; `github/governance.ts` only *reads*
`/rules/branches/{branch}` and no ruleset write path exists anywhere. Two refinements: (a) the tier is
persisted on `Repository.passportJson` via `deriveAutonomyTier`/`deriveAutonomyForStored` — a symbol,
not the cited line pair; (b) the model check the finding sketches is **not buildable**: `AiUsage` keys
by `(source, scope, scopeKey, day)` and retains no model dimension, so `permittedModels` stays
unchecked and its gap-line stays in the doc (see Out of scope).

## Behaviour

### Data model
- One `RepoAdmission` row per `(orgId, repoFullName)`; the unique key **is** the idempotency key
  (upsert, `OrgDecision` shape). Seeded lazily on first read of a repo with a passport:
  `grantedTier = derivedTier`, `mode = "assisted-only"`, `decidedBy = null`.
- **Honest null:** `derivedTier = null` when the latest scan has no passport. A null tier never
  defaults to `T0` and never compiles a control — the row reads *"tier not assessed"* and the gate
  overlay is empty (G4: no number the data cannot support).
- A stance publish does **not** silently re-decide: rows keep their `stanceVersion`; one behind the
  active version is recompiled against the active stance but flagged `staleDecision: true`.
- Wire type `RepoAdmissionRow` declares `decidedAt`/`createdAt`/`updatedAt` as `string`
  (`toRow()` does the `.toISOString()`); `mode`/tiers are string unions validated at the edge.

### Pure modules
```ts
// src/lib/org/admission.ts
export type AdmissionMode = "agents-allowed" | "assisted-only" | "blocked";
export interface AdmissionRepoFacts {
  fullName: string; derivedTier: AutonomyTierId | null;
  codeownersPaths: string[];          // paths already covered by a CODEOWNERS rule (scan-parsed)
  observedRequiredApprovals: number | null; // from #1's ControlObservation; null = unobserved
  protectedBranch: boolean | null;    // null = governance unreadable (never a false negative)
}
export interface CompiledControls {
  tier: AutonomyTierId | null; mode: AdmissionMode; staleDecision: boolean;
  gateOverlay: GatePolicy;            // TIGHTEN-ONLY, never a weakening
  codeownersBlock: string | null;     // managed block for path-scoped no-AI zones
  ruleset: RulesetProposal | null;    // required approvals + code-owner review, as JSON
  manifestOversight: { tier: string; review: string; provenance: string[] } | null;
  unenforceable: { clause: string; why: string }[]; // what stayed declared, and why
}
export function compileStance(stance: AiStance, admission: RepoAdmissionRow, facts: AdmissionRepoFacts): CompiledControls;
export function admissionGateOverlay(mode: AdmissionMode, tier: AutonomyTierId | null): GatePolicy;
```
Tier → overlay (tighten-only; every value is a *floor added*, never a ceiling removed):
`T0` → `requireProtectedBranch`, `minAiGovernedRate: 100`, `forbidPostures: ["ungoverned"]`;
`T1` → `requireProtectedBranch`, `minAiGovernedRate: 100`; `T2` → `minAiGovernedRate: 90`;
`T3` and `tier === null` → `{}` (empty). `mode: "blocked"` adds `forbidAiAuthorship: true`;
`mode: "agents-allowed"` adds nothing beyond the tier's floors.

### The gate
- New `GatePolicy.forbidAiAuthorship?: boolean` with failure code `"admission"`. Enforced **only when
  measurable**: `NormalizedGate.aiInvolvedRate != null && > 0` — the same fail-**open** exception
  `minAiGovernedRate` documents, for the same reason (a repo with no AI activity must not be blocked
  by an AI policy). `evaluateGateLite` passes `aiInvolvedRate: null` (its snapshot has no PR stats) and
  the criterion is skipped, documented as unobserved rather than as a pass.
- Precedence in `/api/gate/[owner]/[repo]` and in `pr-gate.ts`:
  `tightenGatePolicy(tightenGatePolicy(orgPolicy ?? archetypeDefault, admissionOverlay), explicitParams)`.
  **The endpoint is unauthenticated**, so the overlay is passed through `tightenGatePolicy` exactly like
  a query param: an admission row can only ever *raise* a bar. A `T3` repo is not held to a looser bar
  than the org's — it simply receives no extra floor. A read failure on the admission row fails the
  same way the org-policy read does today: **503, no verdict** (never a weaker bar).
- The verdict body gains `admission: { mode, tier, source: "granted" | "derived" | "none" }` so a CI
  log says *why* it was held to this bar. `logGateVerdict` records the same triple.

### Writers — proposal, not mutation
Three artifacts, all built by pure renderers and all previewed as a **unified diff before anything is
sent** (`POST …/propose` with no `confirm` returns `{ diff, willCreate, willModify }` and writes nothing):
1. **CODEOWNERS** — a managed block delimited by
   `# BEGIN ascent:ai-stance vN` / `# END ascent:ai-stance vN` appended to (or replaced inside) the
   repo's existing CODEOWNERS. `openDraftPr` refuses to clobber an existing base file by design, so
   this goes through `admission-write.ts`'s merge writer: read base content, splice the managed block,
   PUT on the generated branch, open a draft PR. Outside the markers nothing is touched.
2. **`.ai/manifest.yaml`** — a `controls.oversight` block (tier, review requirement, provenance
   requirements) rendered by `manifest.ts` so the doctor can read it back.
3. **Branch ruleset** — default is a *document*: `.github/ascent/ruleset-ai-oversight.json` committed
   through `openArtifactDraftPr` with the `gh api` one-liner in the PR body. A second, separate,
   **owner-only** action (`POST /api/org/admission/ruleset`) performs the real
   `POST /repos/{o}/{r}/rulesets` — same-origin, typed-confirm (`confirm === "owner/repo"`), after a
   dry-run diff of the *observed* rules (`fetchBranchGovernance`) against the proposal. The created id
   goes in `RepoAdmission.rulesetId`; `DELETE` on the same route removes it: **reversible**. Audit rows
   on every branch (`recordAudit`, `src/lib/db/scans-audit.ts`): `org.admission`,
   `org.admission_propose`, `org.admission_ruleset`, `org.admission_ruleset_revert`.

### Routes
| Method · path | Auth |
|---|---|
| `GET /api/org/admission?org=` | `requireOrgAccess` (member) — rows + compiled controls |
| `POST /api/org/admission` | `requireOrgRole(org, "owner")` — upsert `{ grantedTier, mode, rationale }`, audited |
| `POST /api/org/admission/propose` | `requireOrgRole(org, "admin")` + `requirePrWriteContext` — dry-run by default; `confirm` opens the PR |
| `POST` / `DELETE /api/org/admission/ruleset` | `requireOrgRole(org, "owner")`, same-origin, typed-confirm |

No `[id]` segment is introduced: every route is `(org, repoFullName)` and gates the org **then**
constrains the query by it (gate-then-constrain), so `id-routes-gated.test.ts` is untouched.

### UI (Governance tab → Stance → Perimeter)
`AdmissionColumn` adds one column to the existing tier bands: mode chip, granted tier, and an
`override` affordance for owners (`AdmissionOverrideControl` — `Modal` + `Kicker` + `Stat` from
`@/components/ui`, rows via `Tile`/`TILE_LEDGER` from `@/components/org/ui`). **No hand-picked hex**; `scoreHex`/`LEVEL_HEX` only where a score is shown.
`ProposalDryRunModal` renders the unified diff in a mono block with the destructive confirm. A repo
with `derivedTier === null` renders "tier not assessed", override disabled. Every new file stays
under the 200-LOC `src/features/**` cap.

### Plan gates, self-hosted, privacy
- Admission + compilation is **Team+**; `selfHosted()` turns the gate off entirely (`plans.ts` is not
  edited — the existing entitlement check is reused). With no GitHub App installation the rows and the
  gate overlay still work; propose/apply answer 403 with the existing `requirePrWriteContext` copy.
- No aggregate/public surface is added, so `CHAMPION_MIN_POP` does not apply; admission rows are
  org-private and never appear in a public gate response beyond the `mode`/`tier` triple, which is
  already implied by the bar the caller just failed.

## Build order

1. `src/lib/db/org-admission.ts`: `getRepoAdmission`, `listOrgAdmissions`, `upsertRepoAdmission`,
   `toRow()` with ISO strings; lazy seed from `Repository.passportJson`'s tier. Ships behind no UI.
2. Pure `src/lib/org/admission.ts` (`compileStance`, `admissionGateOverlay`) + its test over the
   existing stance fixtures. No IO, no callers yet.
3. `gate.ts`: `forbidAiAuthorship`, `aiInvolvedRate` on `NormalizedGate`, `"admission"` failure code,
   sanitize/tighten coverage, and the `policyFromParams` `minAiGovernedRate` fix. Evaluator-only.
4. Gate wiring: the tighten-only overlay in the public route **and** `pr-gate.ts`, plus the
   `admission` triple in the body and in `logGateVerdict`. `docs/features/scanning/gate.md` updated.
5. Governance Perimeter: admission column + owner override + `POST /api/org/admission`, audited.
   First user-visible step; the fleet question is answerable here even before any writer exists.
6. Pure artifact renderers (`admission-artifacts.ts`) + the managed-block splice and diff helper.
7. `admission-write.ts` + `/propose` (dry-run first, `confirm` to open the PR) — CODEOWNERS and
   manifest only.
8. Ruleset JSON proposal PR, then the owner-only apply/revert route with the observed-vs-proposed
   dry run and `rulesetId` reversal.
9. `get_ai_stance(repo?)` returns the compiled controls, the admission mode and the `unenforceable[]`
   list; the blanket enforcement disclaimer is replaced by the per-clause map.
10. `evaluateStanceCompliance` gains the `no-ai-zone-path` advisory finding and the `review-tier`
    finding (declared tier review vs `observedRequiredApprovals`, skipped when null); the doc's stance
    section is rewritten to the per-clause truth.

## Tests

**Unit (vitest)**
- New `src/lib/org/admission.test.ts` — tier→overlay table; `mode: "blocked"` ⇒ `forbidAiAuthorship`;
  `derivedTier === null` ⇒ empty overlay and no compiled control; `staleDecision` when the row's
  `stanceVersion` is behind; CODEOWNERS block is byte-stable for a given stance version.
- New `src/lib/org/admission-artifacts.test.ts` — managed-block splice is idempotent (re-running
  produces an identical file), never edits outside the markers, and the diff is empty on a no-op.
- Extend `src/lib/scoring/gate.test.ts` — **fail-before:** with `forbidAiAuthorship: true` and
  `aiInvolvedRate = 40`, today's evaluator returns `pass: true`; and
  `policyFromParams(new URLSearchParams("min_ai_governed=90"))` today drops the field.
- Extend `src/app/api/gate/[owner]/[repo]/route.test.ts` — **fail-before:** a `T0` admission row plus
  a lenient org policy currently returns the lenient bar; and an admission row that would *loosen*
  the org bar must not (tighten-only regression guard).
- Extend `src/lib/github/pr-gate.test.ts` — the Check Run path applies the identical overlay
  (the drift this module exists to prevent).
- Extend `src/lib/org/stance.test.ts` — **fail-before:** a stance with only a path-scoped zone
  currently yields `compliant: true` with zero findings; after, one `advisory: true` finding and
  `compliant: true` for the right reason. Review-tier finding is skipped on a null observation.
- New `src/app/api/org/admission/route.test.ts` — member GET / owner POST; a non-owner is 403; the
  ruleset apply refuses without the typed confirm and without same-origin; audit row asserted.
- New `src/lib/github/admission-write.test.ts` — dry run sends no write; apply stores `rulesetId`;
  revert deletes it and clears the column.

**Structural guards**
`wire-safe-dates.test.ts` (`RepoAdmissionRow` added by the schema pass — this lane's types must
satisfy it), `id-routes-gated.test.ts` (unchanged: no new `[id]` route), doc-sync
(`org-intelligence.md` + `gate.md` in the same turn), the 200-LOC `src/features/**` sweep.

**UAT**
Re-run **Tomáš** (platform/CISO lens) end-to-end: publish a stance → see the ranked admission list →
override one repo to `blocked` → dry-run the CODEOWNERS proposal → open the PR → observe a gate
verdict citing the tier. Re-run **Sam** on `/api/gate` to confirm an ordinary repo's verdict and
status codes are byte-identical when no admission row exists.

## Gate + done criteria

Ordered ship-loop gate: `npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` →
LOC checks → e2e (UI touched). Done when: a repo with no admission row produces a byte-identical gate
response to today's; an admission row can only tighten; every customer-repo write is preceded by a
dry-run diff and followed by an audit row; the ruleset apply is reversible from the same surface; and
the two gap lines named above are deleted in the same PR.

## Out of scope

- **#5 Gate-as-code** (concept-doc first): the manifest-declared bar, the ratchet/no-regression rule
  and a single pre-push/CI/check-run evaluator. This lane deliberately adds **no** new bar-declaration
  surface — the admission overlay is a *tighten-only overlay on the existing `GatePolicy`*, expressed
  in the existing `sanitizeGatePolicy`/`tightenGatePolicy` vocabulary, precisely so #5 can later make
  the manifest a bar **source** without forking a second policy language. `controls.oversight` is
  written as oversight metadata, never as a threshold.
- **#1 Governance evidence ledger** (W3-M): this lane *reads* `ControlObservation` and requests the
  pack/alert lines; it writes no events, no hash chain, no pack columns.
- **#3 Agent-neutral work protocol** (W4-N): no claim/lease/write scopes; `get_ai_stance` stays read-only.
- **#7 AI Trust Center**, **#6 signed attestation**: no public or signed publication of an admission
  posture.
- **#21 GitHub identity graph / teams**: CODEOWNERS blocks name the teams the stance already names;
  no team sync, no auto-RBAC.
- **#23 Agent behaviour ledger** and **#11 unified meter**: `permittedModels` stays unchecked — the
  model dimension is not retained by any ingest today, so that gap-line is **left in place**, not
  deleted. Enforcing a model allowlist waits for a sensor that observes models.
- Anything that mutates a customer repo without an owner-confirmed, diffed, audited, reversible step.
