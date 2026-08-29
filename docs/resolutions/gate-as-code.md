# C5 resolution: gate-as-code — the manifest `gate:` block, the ratchet, and one policy merge

_Resolved 2026-08-29 against the working tree on `fix/gate-lint-unescaped-entities-20260827`.
Concept doc for moonshot deck item **#5 (Gate-as-code)**, written in wave 0 so that **#16
(Doctor per-check ledger, `requireChecks`)** and **#8 (Agent-admission compiler, per-repo
override)** land in the SAME policy merge instead of each growing its own evaluator. Every
`file:line` below was re-read; where the finding's premise was stale it is corrected here._

---

## The question

Three accepted deck items all want to add a *new source of gate policy*:

- **#5** wants the repo to declare its own bar in `.ai/manifest.yaml`, plus relative
  (regression / ratchet) criteria, plus an offline runner.
- **#16** wants `requireChecks: [...]` — fail when a named doctor control regressed.
- **#8** wants a per-repo admission tier (T0–T3) to hold a T0 repo to a stricter bar than a T3 one.

Ascent has exactly **one** policy type and **one** merge function today. If each item adds its own
resolution path — one reading a manifest, one a `ConformanceFinding`, one a `RepoAdmission` row —
the gate acquires three precedence rules nobody can state, and the property the current code is
built around (*a caller can tighten a bar, never weaken it*) is lost in the third one that forgets
to fold. Wave 4 already says W4-O "reads the C5 gate-as-code concept doc so the per-repo override
and the manifest bar do not fork". This is that document:

> **What is the contract a new gate-policy source must satisfy, and what does the manifest
> `gate:` block look like such that #16's `requireChecks` and #8's admission override are just
> two more fields under it?**

It also has to answer the operator's own principle — recorded in `.claude/rules` and in the
manifest itself: **controls shift left. Pre-push is primary; CI is the thin hard-pass backstop.**
Ascent's own merge gate violates that principle today, and the manifest is where the fix is
declared.

## Ground truth in code today

**The policy type and the one merge.** `GatePolicy` (`src/lib/scoring/gate.ts`) carries seven
fields, all **absolute floors**: `minLevel`, `minOverall`, `minDimension`, `minDimensionFor`,
`forbidPostures`, `requireProtectedBranch`, `minAiGovernedRate`. `GateFailure.code` is
`"level" | "overall" | "dimension" | "posture" | "governance" | "provenance" | "incomplete"` —
**no relative member**. `tightenGatePolicy(a, b)` is strictest-wins per field (numeric `max`,
higher `minLevel`, per-dim `max`, posture union, `requireProtectedBranch` OR) and is the merge the
*unauthenticated* endpoint relies on. Premise **holds**.

**Four places every field already touches.** A `GatePolicy` field is not one edit. It is
(1) the interface, (2) `sanitizeGatePolicy` (untrusted → clean, with the `parseFloor` `0 < n ≤ 100`
contract), (3) `tightenGatePolicy`, (4) `gateConditions()` → `GateConditionView` (`text` / `bit` /
optional `query` / optional `ci`), which single-sources the human list, the PR footer, the gate URL
and the Action input. `minAiGovernedRate` is the worked example of all four. This is the contract a
new source must satisfy — it is already written, just not written *down*.

**One evaluator, two wrappers.** `evaluateNormalized(g: NormalizedGate, pol)` is the only place
rules run; `evaluateGate` (full `ScanReport`) and `evaluateGateLite` (`GateSnapshot`, the fleet
rollup) both adapt into it. `NormalizedGate` carries `level`/`overall`/`posture`/`dims` plus the
two honest-null fields `aiGovernedRate`/`aiPrSample`. **No baseline, no tier, no check ids.**

**Policy sources today.** `Organization.gatePolicy` only (`src/lib/db/org-gate.ts`,
`getOrgGatePolicy` — TEXT column, serialized JSON, sanitized on read *and* write, `null` without
throwing for every legitimate unset case; a failed read is fail-closed `503`). The gate route
merges org ⊕ explicit params via `tightenGatePolicy`; with no persisted policy it falls back to
`policyFromParams(…, archetype)`. Premise **holds**.

**The manifest declares controls but no bar.** `ManifestData.controls` is
`{ prePush: string[]; ciHardPass: string[] }` (`src/lib/standard/types.ts`), and
`buildManifestData` defaults them to `prePush: ["lint", "typecheck", "scan-secrets"]`,
`ciHardPass: ["test", "sast", "merge-gate"]` (`src/lib/standard/manifest.ts:91-92`). So the
standard **already names `merge-gate` as a CI hard pass** — and the thing that fulfils it is
reachable only as a remote HTTP call. There is no `gate` key in the manifest and no `manifest`
reference anywhere under `src/lib/scoring/` or `src/app/api/gate/`. Premise **holds**.

**Base and head are both scored, and the diff is decoration.** `runPrGate`
(`src/lib/github/pr-gate.ts`) scores the head ref, falls back to the default branch for
unreachable fork heads (`scoredHead=false` → NEUTRAL check), calls `evaluateGate(headReport, policy)`,
and only *then* scores the base ref and computes `diffReports(baseReport, headReport)` — passed to
`buildGateComment` as `baseline`, never to the verdict. Premise **holds**, with two corrections:
the diff runs **after** the verdict and only when `scoredHead` is true, and `diffReports` lives in
`src/lib/scoring/engine.ts`, not `report/compare.ts`.

**The noise primitive exists.** `SCORE_NOISE_BAND = 2` with `isWithinNoise` / `classifyDelta`
(`src/lib/maturity/noise.ts`), dependency-free, already justified by a two-run same-commit
experiment. Premise **holds** — a ratchet has a ready-made tolerance and no excuse to invent one.

**Nothing else exists.** No `GateHighWater` model, no `ratchet` / `noRegression` / `requireChecks`
identifier in `src/`, no SARIF writer in `src/` or `scripts/`. `scripts/maturity-gate.mjs` is a
**thin HTTP client** for `/api/gate` (its own header says so), so there is no offline evaluator;
`LocalFsSource` (`src/lib/local/source.ts`) does yield the same `RepoSnapshot` from a working copy.
Premises **hold**.

**One premise is FALSE as stated.** The finding says the local runner and manifest bar are close
because "the pieces are joined". They are not joined at the *fetch*: `pickFilesToFetch`
(`src/lib/github/source.ts`) does not fetch `.ai/manifest.yaml` at all — grep for `.ai/manifest`
in that file returns nothing. Reading a repo-declared bar in the **remote** gate therefore has a
hard precondition on deck item **#13 (manifest-as-scan-input)** and the W1-B fetch-list edit.
The **local** runner has no such problem: it reads the file off disk.

## Design options

### Option A — the manifest bar is a fourth layer of the same fold (**recommended**)

Every policy source's only job is to **produce a `GatePolicy`**. The gate resolves an ordered
fold, strictest-wins, no exceptions:

```
effective = tighten( tighten( tighten( orgPolicy ?? archetypeDefault,
                                       admissionPolicy(#8) ),
                              manifestPolicy(#5) ),
                     explicitParams )
```

- Nothing in the chain can *weaken* what precedes it, so the trust question that a repo-authored
  file raises ("a PR edits its own bar") answers itself: the worst a manifest edit can do is
  return the repo to the org bar.
- #8 does **not** get a resolution path. `compileStance()` emits a `GatePolicy` fragment from the
  admission tier (e.g. T0 → `{ minAiGovernedRate: 100, requireProtectedBranch: true }`) and hands
  it to the same fold. `NormalizedGate` gains **no tier field**; the tier is an *input to a policy
  fragment*, not a criterion.
- #16 does **not** get a resolution path either. `requireChecks: string[]` becomes a `GatePolicy`
  field with a declared merge rule (**union**, exactly like `forbidPostures`) and a
  `NormalizedGate.checkStates: Record<string, "pass"|"warn"|"fail"|"unchecked"> | null` input, so
  the fleet-lite wrapper can pass `null` and skip rather than invent a failure.
- Trade-offs: the only option that keeps `evaluateNormalized` the single evaluator (the property
  gate.md advertises as "the dashboard and CI can no longer drift"). Cost: three items must agree
  on the four-place field contract before any merges — which is what this doc is for. Respects
  **G5** (D9 stays deterministic) and **G4** (a criterion with no measurement degrades to absence).

### Option B — manifest bar is advisory: rendered, never enforced

Read the `gate:` block, show "declared vs org vs effective" in the governance tab and the PR
footer, enforce nothing. Cheap, zero trust surface, delivers the *legibility* half of #5. It does
not deliver the claim, and it repeats the failure `AI_POLICY.md` already embodies — an artifact
whose own body says it is not enforced (`src/lib/org/stance-artifact.ts`). Reject as an end state;
**keep it as the shipping order**: render first, enforce second.

### Option C — the manifest is authoritative when there is no org

Self-hosted / anonymous callers get the manifest bar as the *base*; org-backed repos get the org
bar. Rejected: it makes the effective policy a function of the deployment mode — the fork this
document exists to prevent — and hands an anonymous caller a bar the repo wrote for itself, on the
endpoint that is unauthenticated by design. Option A already covers self-hosted correctly: with no
org row `orgPolicy` is `null`, the archetype default is the floor, and the manifest tightens it.
`selfHosted()` turns *plan* gates off; it must not turn *policy precedence* into a second path.

### The relative criteria (orthogonal to A/B/C, needed by #5 alone)

`GatePolicy` gains `noRegression?: { overall?: number; dimensions?: number }` (max tolerated drop,
in points) and `ratchet?: { overall?: boolean; dimensions?: boolean }`. `NormalizedGate` gains
`baseline: { overall: number; level: number; dims: Record<string, number>; source: "base-ref" |
"last-scan" | "high-water" } | null`. New `GateFailure.code` members: `regression`, `ratchet`,
`control` (#16), and — if #8 wants a distinct code for a blocked repo — `admission`.

Four rules, each following precedent already in the file:

1. **Honest-null skips.** `baseline === null` (no base ref, no persisted authoritative scan, no
   high-water row) → **skip**, exactly like `requireProtectedBranch` skips when governance was
   unreadable and `minAiGovernedRate` skips under the 5-PR floor. A relative bar with nothing to
   compare against was never *due*; failing it would block every first scan.
2. **Noise-aware.** A drop fails only when `!isWithinNoise(delta)`. Default tolerance is
   `SCORE_NOISE_BAND`; a configured tolerance below it is raised to it — a 1-point bar is a bar the
   measurement cannot support (**G4**).
3. **Fail-open under `incomplete` / `degraded`**, and never fire on an **engine-mix** delta (mock
   baseline vs live head, or vice versa) — the same honesty **G9** requires of the PDF caveat.
4. **Baseline precedence** is fixed and echoed in `GateResult` and `[gate:verdict]`: `base-ref`
   (PR, only when `scoredHead`) → `last-scan` (last persisted *authoritative* scan) → `high-water`.

**The ratchet's memory** is a per-repo `GateHighWater` row (org-scoped), written on every
authoritative scan persist: best observed `overall` / `level` / per-dim scores, plus the
last-declared manifest bar and the sha it was read at. It stops the one real attack on a
repo-declared bar — *a PR that deletes its own `gate:` block*. Tighten-only makes the deletion
harmless within a run; the high-water row makes it visible and, with `ratchet` on, still enforced.

**A PR reads the base ref's manifest**, not the head's: a PR may propose *raising* its bar (the
next run after merge enforces it), never lower the bar it is being judged against.

## The manifest `gate:` block (spec 0.3.0)

```yaml
# .ai/manifest.yaml — the bar this repo holds ITSELF to. Tighten-only: it can raise the bar an
# org or a platform sets, never lower it. Evaluated identically at pre-push, in CI, and on the
# merge check.
gate:
  minLevel: L3            # any absolute GatePolicy floor, same names, same 0<n<=100 contract
  minOverall: 60
  minDimensionFor: { D9: 70 }
  requireProtectedBranch: true
  minAiGovernedRate: 100
  noRegression: { overall: 2, dimensions: 3 }   # max tolerated drop, points; floored at the noise band
  ratchet: { overall: true, dimensions: false } # never go below the best ever observed
  requireChecks:                                 # deck #16 — doctor check ids, union-merged
    - guardrail.never-commit
    - control.prepush.lint
    - capability.test.run
```

`ManifestData` gains `gate?: GatePolicyDeclaration` — its **own** interface in
`src/lib/standard/types.ts` (a serialization view), parsed by a pure
`manifestGatePolicy(manifest): GatePolicy | null` ending in `sanitizeGatePolicy`. The standard's
type does not import the scoring type: the manifest is vendor-neutral, and a reader of the spec
must not need Ascent's internals to validate it.

`controls:` is unchanged and gains meaning: `ciHardPass: [merge-gate]` becomes fulfillable by
`npx ascent gate`, and a repo that moves `merge-gate` to `prePush` gets the same verdict before the
push — the operator's principle made literal rather than asserted. The doctor
(`src/lib/standard/doctor.ts`, check 4) already fails a `prePush` control with no local hook, so
"declared pre-push, not wired" is caught for free.

## Recommendation

**Option A**, shipped in Option B's order: render the three-layer bar first (declared / org /
effective), enforce the manifest layer second, add the relative criteria third, and add
`requireChecks` and the admission fragment last — each as a `GatePolicy` field satisfying the
four-place contract, never as a new resolution path.

Write the contract into `gate.ts`'s header as a rule, not a comment on one field: *a new gate
policy source produces a `GatePolicy` and nothing else; a new bar is a field with a
`sanitizeGatePolicy` clause, a `tightenGatePolicy` rule, a `gateConditions` row, and either an
absolute score input or an honest-null skip in `NormalizedGate`.* The structural test that keeps
it honest is a table-driven one in `gate.test.ts`: every key of a `GatePolicy` fixture must appear
in the output of `tightenGatePolicy` under strictest-wins, and in `gateConditions`.

## Decisions for the owner

1. **Manifest bar tighten-only, never authoritative?** (A: tighten-only / B: authoritative when no
   org row) — **recommended: A.** B is Option C and forks the precedence by deployment mode.
2. **Read the manifest bar from the base ref in a PR?** (yes / no) — **recommended: yes.** A PR must
   not lower the bar it is judged against; raising takes effect on the next run after merge.
3. **Ship `ratchet` on by default, or opt-in per repo?** (default-on / opt-in) — **recommended:
   opt-in.** The finding's own risk note is that a ratchet on a noisy dimension blocks honest PRs;
   `ratchet.dimensions` especially should start off.
4. **Is a missing `requireChecks` report a skip or a fail?** (skip / fail) — **recommended: skip**
   when the repo has *never* reported (the measurement was never due — the `minAiGovernedRate`
   precedent), **fail** when a report exists and names the check `fail`, **skip** on `unchecked`.
5. **Does a stale conformance report fail the check gate?** (yes, with `maxConformanceAgeDays` /
   no) — **recommended: yes, opt-in**, defaulting to unset. A control probe that stopped running is
   the failure mode #16 exists to catch, but it must be a bar the org chooses.
6. **Does `admissionMode: blocked` (#8) fail the gate, or only the MCP door?** (gate + MCP / MCP
   only) — **recommended: gate + MCP**, with its own `admission` failure code so telemetry can
   separate it from a score failure.
7. **Does a manifest-declared bar change write an audit row?** (yes / no) — **recommended: no.** It
   is a git-tracked file; git is the audit trail. The org bar keeps its `org.gate_policy` row, and
   `GateHighWater.declaredSha` records what was read.
8. **Does `npx ascent gate` emit SARIF by default?** (default / `--sarif` flag) — **recommended:
   flag.** SARIF's consumer is GitHub code scanning; the default output should be the human summary
   plus exit 0/1/2 matching `scripts/maturity-gate.mjs` exactly.
9. **Telemetry `policySource` becomes a list?** (yes / no) — **recommended: yes**
   (`["org","manifest","admission","params"]`); a single enum cannot describe a four-layer fold, and
   the `[gate:verdict]` block-rate question ("which layer bites?") is unanswerable without it.

## Preconditions

- **#13 (manifest-as-scan-input)** must land first for the *remote* path: `pickFilesToFetch` does
  not fetch `.ai/manifest.yaml` today, and `Scan.manifestJson` is where the gate route should read
  the declared bar from rather than issuing its own content fetch. The **local** runner has no such
  dependency and can ship first.
- **#16** must land its `ConformanceFinding` rows before `requireChecks` can be evaluated; until
  then the field parses, renders as a declared condition, and skips (decision 4's "never reported").
- **#8** must land `RepoAdmission` before `admissionPolicy()` returns anything; wave 4 already
  sequences it after W3-M.
- The spec version bump is **shared**: #16 (W1-A) bumps `MANIFEST_SCHEMA_VERSION` to `0.3.0` for the
  per-check ids. The `gate:` block must ride **that same bump**, not a fourth one — `types.test.ts`
  pins the constant to the `.ai/SPEC.md` header, so two independent bumps are a guaranteed conflict.
- `docs/features/onboarding/ai-manifest-spec.md` is the mirror of `spec.ts` and is drift-tested;
  the `gate:` row in the field table and the spec constant change in the **same commit**.

## Write set if accepted

**Director-owned (request, do not edit):** `prisma/schema.prisma` + `prisma/init.sql` — model
`GateHighWater { id String @id @default(cuid()); orgId String; repoFullName String; bestOverall
Int; bestLevel Int; bestDimsJson String; declaredPolicyJson String?; declaredSha String?;
declaredAt DateTime?; updatedAt DateTime @updatedAt; @@unique([orgId, repoFullName]) }` (JSON as
**TEXT**, no jsonb — DSQL/PGlite); `src/lib/db/index.ts` barrel line for
`src/lib/db/gate-high-water.ts`; the `GateHighWaterRow` entry in
`src/lib/db/wire-safe-dates.test.ts` (its `declaredAt`/`updatedAt` cross to the governance tab and
are declared `string`).

**Edit:** `src/lib/scoring/gate.ts` (fields, sanitize clauses, tighten rules, `gateConditions`
rows, `NormalizedGate.baseline`/`checkStates`, the four new failure codes, the header contract
note) · `src/lib/scoring/gate-comment.ts` (declared/org/effective footer) ·
`src/lib/scoring/gate-telemetry.ts` (`policySource` list, baseline source) ·
`src/lib/github/pr-gate.ts` (base report feeds the verdict; base-ref manifest read) ·
`src/app/api/gate/[owner]/[repo]/route.ts` (fold the manifest + admission layers; baseline from the
last authoritative scan) · `src/lib/standard/{types,spec,manifest,doctor}.ts` (the `gate:` block,
spec 0.3.0 field-table row, doctor validation) · `docs/features/scanning/gate.md` +
`docs/features/onboarding/ai-manifest-spec.md`.

**Create:** `src/lib/scoring/gate-manifest.ts` (`manifestGatePolicy`, pure) ·
`src/lib/scoring/gate-baseline.ts` (baseline precedence, pure) · `src/lib/db/gate-high-water.ts`
(read/write + `toRow()` with `.toISOString()`) · `bin/ascent-gate.mjs` + `src/lib/local/gate-run.ts`
(`LocalFsSource` → `analyze/**` → `evaluateGate`, no network, no account) ·
`src/lib/scoring/gate-sarif.ts` · tests: `gate-manifest.test.ts`, `gate-baseline.test.ts`,
`gate-ratchet.test.ts`, extensions to `gate.test.ts` (the table-driven four-place guard),
`pr-gate.test.ts` (verdict reads the base report).

**Handoffs:** W1-A owns `src/lib/standard/**` — the `gate:` block in `types.ts`/`spec.ts`/`doctor.ts`
and the 0.3.0 bump are **requested from W1-A**, not taken. W1-B owns the `source.ts` fetch list
(`.ai/manifest.yaml`) for #13. W4-O owns `src/lib/org/admission.ts` and supplies
`admissionPolicy()`; this item supplies the `GatePolicy` shape it must emit. `src/lib/alerts.ts`
is W3-M's.

## Out of scope

- **#16's ledger itself** (`ConformanceReport`/`ConformanceFinding`, the fleet control matrix, the
  `control-failed` alert kind, the pack appendix). This doc defines only the *field* the ledger
  feeds.
- **#8's writers** — rulesets proposals, CODEOWNERS blocks, `compileStance`'s non-gate outputs, the
  `evaluateStanceCompliance` extensions. Only the `GatePolicy` fragment is in scope.
- **#1 (governance evidence ledger)** — gate verdicts stay a log line (`[gate:verdict]`), not a
  `GovernanceEvent`, until #1 lands its normalizers.
- **#2 (open benchmark corpus)** — no cohort-relative or percentile bar; a gate must be
  reproducible from one repo's own tree.
- **#7 (AI trust center)** — publishing a repo's bar or its high-water mark on a public surface is
  that item's decision, under its own privacy floors (aggregate-only, `CHAMPION_MIN_POP = 3`).
- **#4 (forge-neutral ingestion)** — the local runner takes a filesystem path and never a forge URL,
  so it is forge-agnostic by construction and needs no adapter work.
