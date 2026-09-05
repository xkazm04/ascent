# 16 — Doctor findings as fleet control telemetry: per-check ledger, control matrix

size L · effort 6 / impact 8 / risk 4 · gate: **contract** · lane **W1-A** (built SECOND, after #13) · wave 1

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/lib/standard/doctor.ts` — `add()`/`check()` gain a stable `check` id; `findings[]` in `--json`
  and in the POST body; `specVersion` + `runShape` in the body.
- `src/lib/standard/types.ts` — `MANIFEST_SCHEMA_VERSION` → `"0.3.0"` (**shared bump**, see below).
- `src/lib/standard/spec.ts` — `SPEC_MD` verbatim mirror re-generated after the doc edit.
- `src/lib/standard/wiring.ts` — comment only: the weekly job is the control probe's cadence.
- `src/lib/db/org-watch.ts` — **`recordConformance()` only**: accepts `findings`/`unchecked`/
  `scored`/`specVersion`/`runShape`, writes `ConformanceReport` (+`ConformanceFinding`) inside the
  same transaction as the `Repository` update, keeps the signed `conformance.reported` AuditLog row.
- `src/app/api/report/conformance/route.ts` — POST validates `findings[]`; GET reads the new tables
  and **deletes `loadConformanceTrend`** (the audit-log walk) and its `getAuditLog` import.
- Tests extended: `src/app/api/report/conformance/route.test.ts`, `src/lib/db/org-watch.test.ts`,
  `src/lib/standard/standard.test.ts`, `src/lib/standard/types.test.ts`, `src/lib/scoring/gate.test.ts`.
- `src/features/standing/passports/PassportsSwitcher.tsx` (third variant `controls`) +
  `PassportsTab.tsx` (fetch + pass the matrix rows).
- `src/lib/scoring/gate.ts`, `src/app/api/gate/[owner]/[repo]/route.ts` — additive `requireChecks`
  (last build step; see the #5 constraint).
- `docs/features/onboarding/ai-manifest-spec.md` (spec 0.3.0: check-id table + `findings[]`) and
  `docs/features/onboarding/README.md` (freshness row: v0.1.0 → v0.3.0).

**Files to create**
- `src/lib/standard/check-ids.ts` — the check-id vocabulary + `parseCheckId()` (pure, shared by the
  ingest and the matrix; the doctor template embeds the literals, it cannot import).
- `src/lib/db/org-conformance.ts` — `writeConformanceReport`, `listConformanceReports`,
  `loadControlMatrix`, wire types.
- `src/lib/standard/control-matrix.ts` — pure aggregation (`buildControlMatrix`, `sinceFor`).
- `src/lib/standard/control-matrix.test.ts`, `src/lib/db/org-conformance.test.ts`,
  `src/lib/standard/check-ids.test.ts`.
- `src/app/api/report/conformance/matrix/route.ts` (+ `matrix/route.test.ts`).
- `src/features/standing/passports/controls/`: `ControlMatrixPanel.tsx`, `ControlMatrixGrid.tsx`,
  `ControlCell.tsx`, `controlMatrixView.ts`, `useControlMatrix.ts`,
  `ControlMatrixPanel.dom.test.tsx` (each ≤200 LOC).

**Prisma models/columns needed (landed by the wave-1 schema pass, NOT by this lane)**

```prisma
model ConformanceReport {
  id           String   @id @default(uuid())
  orgId        String
  repoFullName String
  headSha      String?          // null for older/local doctors — see idempotency
  score        Int
  fails        Int
  warns        Int
  unchecked    Int      @default(0)
  scored       Int      @default(0)   // the score's denominator (spec 0.2.0 field, finally stored)
  specVersion  String?                // schemaVersion the reporter claimed
  runShape     String   @default("plain")   // "plain" | "run"
  summaryOnly  Boolean  @default(false)     // legacy payload: no findings[] travelled
  reportedAt   DateTime @default(now())
  findings     ConformanceFinding[]
  @@unique([orgId, repoFullName, headSha, runShape])
  @@index([orgId, repoFullName, reportedAt])
}

model ConformanceFinding {
  id       String @id @default(uuid())
  reportId String
  report   ConformanceReport @relation(fields: [reportId], references: [id], onDelete: Cascade)
  check    String            // stable id, e.g. "control.prepush.test"
  level    String            // pass | warn | fail | unchecked
  message  String @default("")
  @@index([reportId])
  @@index([check])
}
```
Plus `prisma/init.sql` DDL + the PGlite reconcile, and a `wire-safe-dates.test.ts` entry for
`ConformanceReportRow` / `ControlMatrixRow` (both declare `reportedAt`/`since` as **`string`**).

**Director-owned lines requested at merge**
- `src/lib/db/index.ts` → `src/lib/db/org.ts` barrel: re-export `listConformanceReports`,
  `loadControlMatrix`, `type ConformanceReportRow`, `type ControlMatrixRow` from
  `@/lib/db/org-conformance` (the existing `recordConformance` export is unchanged).
- `context-map.json` → group *Onboarding, Shell & AI Standard* › *AI-Native Standard & Onboarding
  Skill* `filePaths`: `src/lib/standard/check-ids.ts`, `src/lib/standard/control-matrix.ts`,
  `src/lib/db/org-conformance.ts`, `src/app/api/report/conformance/matrix/route.ts`.
- `scripts/docs/feature-doc-map.json` → the `onboarding` / `ai-manifest-spec.md` entry gains the glob
  `src/app/api/report/conformance/**` (today only `skill/**` and `foundation/**` are mapped, so a
  conformance-route edit trips no doc nag at all).

**MUST NOT TOUCH**
`prisma/schema.prisma` · `prisma/init.sql` · `src/lib/db/index.ts` · `context-map.json` ·
`feature-doc-map.json` · `src/lib/alerts.ts` · `src/lib/db/alert-events.ts` ·
`src/app/api/cron/digest/**` · `src/lib/conformance/pack.ts` · `src/lib/standard/pr.ts` (W1-H) ·
`src/lib/analyze/index.ts` beyond #13's `aiStandard()` readout · `src/lib/github/source.ts`.

**Handoffs to other lanes**
1. **W3-M (#1, Governance evidence ledger)** — the `control-failed` alert. This lane writes the
   *detector* (`detectControlRegressions()` in `control-matrix.ts`, pure) and nothing else. W3-M owns
   `AlertEventKind += "control"` in `src/lib/db/alert-events.ts`, the `buildControlFailedMessage()`
   in `src/lib/alerts.ts`, the digest block, and the dispatch call site. W3-M imports the detector.
2. **W3-M** — the Conformance Pack "control status" appendix (`src/lib/conformance/pack.ts` is W3-M's
   alone). This lane ships `loadControlMatrix()` as the read the appendix calls.
3. **W1-F (#32, retention)** — `ConformanceFinding`/`ConformanceReport` need a purge horizon in
   `src/lib/db/retention.ts` (cascade from the report; suggest `retentionAuditDays`). Not taken here.
4. **W1-A internal (#13 first)** — #13 lands the spec 0.3.0 bump (`types.ts` + `spec.ts` +
   the doc header). #16 adds its section under the *same* 0.3.0; do not bump twice. #15 (W2-I, wave 2)
   later adds its guidance block to the same 0.3.0 spec.
5. **W4-O (#8)** rewrites `gate.ts`/the gate route in wave 4 — no parallel overlap, but its spec must
   read `requireChecks` before it re-cuts `GatePolicy`.

## Goal

Every adopting repo already runs the doctor weekly in its own CI and reports back, but only
`{score, fails, warns}` survive the trip — the per-check findings are printed to a CI log and
discarded, and the "trend" is reconstructed by walking up to 1,000 audit rows per request. This spec
persists the findings under stable check ids so a CISO gets a live repo × control matrix sourced from
the repos' own CI, with alerts on a control *regressing* rather than on score wobble.
*Competitive angle:* Scorecard reports per-check results for the vendor's own checks — here the
**repo's own declared controls** are probed in the repo's own CI and monitored fleet-wide per check.

**Known gaps this deletes** — `docs/features/onboarding/README.md`'s freshness table says
`ai-manifest-spec.md` covers "spec v0.1.0" (it is 0.2.0 today, 0.3.0 after this lane); the spec doc's
§"Score semantics" caveat that "the percentage is a display heuristic" currently has **no persisted
alternative**, which this spec supplies — both lines are rewritten in the same PR.

## Premises verified against the tree (2026-08-29)

- **TRUE** — `src/lib/standard/doctor.ts`: `const add = (level, msg) => findings.push({ level, msg })`
  — no ids. The POST body is `{ repo, headSha, score, fails, warns, unchecked }`.
- **PARTLY FALSE (the dossier's `route.ts:689-715`)** — the file is **225 lines**; the audit walk is
  `loadConformanceTrend()` at ~165–190 and the `regressed` computation in `GET` at ~215. The claim
  itself holds: 10 pages × 100 audit rows per request, `regressed` dispatched nowhere.
- **FALSE, worth exploiting** — the doctor *already* sends `unchecked` (and prints `scored`), but the
  route's body type drops both and `recordConformance` never sees them. The run's *shape* is already
  on the wire; only the storage is missing. `scored` is not even sent — add it to the body.
- **TRUE** — `recordConformance` (`org-watch.ts`) writes four columns + one **signed** AuditLog row;
  the sha-ordering stale guard is real and must be preserved.
- **TRUE** — UI is one `.ai N%` chip (`RepoLeaderboardRow.tsx:73-79`) and `contextGate` in
  `autonomy/autonomyModel.ts:88`.
- **TRUE** — `GatePolicy` (`src/lib/scoring/gate.ts:14`) has no conformance-derived criterion.

## Behaviour

### Check ids (spec 0.3.0, additive — a 0.2.0 reader ignores `findings[]`)

`src/lib/standard/check-ids.ts` is the vocabulary; the doctor template embeds the literals verbatim
(it may contain no backticks and no `${}`, so it cannot import):

`manifest.missing` · `structure` · `structure.schema-version` · `pointer.<key>` ·
`guardrail.never-commit` · `capability.declared` · `capability.<name>` (placeholder) ·
`capability.<name>.run` · `manifest.write-back` · `control.prepush.<name>` ·
`control.prepush.<name>.backing` · `control.ci` · `freshness.<path>` · `freshness.unchecked` ·
`context.index` · `context.<path>` · `manifest.todo`. `<name>`/`<key>`/`<path>` are lower-cased,
`[^a-z0-9._/-]` → `-`, id capped at 120 chars. `parseCheckId(id) → { family, subject | null }` drives
the matrix's grouping and is the only place that knows the shape.

### Ingest

POST body gains `findings?: {check,level,message?}[]`, `scored?`, `specVersion?`, `runShape?`.
Validation, all 400 on violation: `findings` ≤ 500 entries, `check` matches
`/^[a-z][a-z0-9]*(\.[a-z0-9._/-]+)*$/` and ≤120 chars, `level ∈ {pass,warn,fail,unchecked}`,
`message` truncated to 300 chars. `runShape ∈ {plain, run}` (default `plain`; the doctor sends `run`
when `--run` is set — the shape that changes the denominator). **No `findings` ⇒
`summaryOnly: true`**, and every matrix cell for that repo reads `unchecked`, never `pass`
(honest-null: an absent finding is not a passing control).

Duplicate `check` ids inside one report are collapsed **worst-level-wins**
(`fail > warn > unchecked > pass`) — deterministic, and it cannot manufacture a pass.

**Idempotency**: `@@unique([orgId, repoFullName, headSha, runShape])`, upserted — a CI re-run of the
same commit in the same shape replaces its findings rather than duplicating the timeline. `headSha`
is nullable and Postgres treats NULLs as distinct, so sha-less reports still append (last-write-wins,
the trade-off `recordConformance` already documents). The existing stale-sha guard runs **before**
the insert and short-circuits it: a stale re-run writes neither the `Repository` columns nor a report
row. Both writes plus the signed AuditLog row go in one `prisma.$transaction`; the
`conformance.reported` audit row **stays** — it is the tamper-evident copy, only the *reader* moves.

### Reads (pure + db)

```ts
// src/lib/standard/control-matrix.ts (pure)
export function buildControlMatrix(reports: ConformanceReportRow[]): ControlMatrix;
export function sinceFor(history: {level: string; reportedAt: string}[]): string | null;
export function detectControlRegressions(
  prev: ConformanceReportRow | null, next: ConformanceReportRow,
): { check: string; from: string; to: string }[];   // pass|warn -> fail only
// src/lib/db/org-conformance.ts
export async function writeConformanceReport(tx, orgId, input): Promise<string | null>;
export async function listConformanceReports(org, repo, limit): Promise<ConformanceReportRow[] | null>;
export async function loadControlMatrix(org, opts?): Promise<ControlMatrixRow[] | null>;
```

`ControlMatrixRow` = `{ repoFullName, checks: { check, level, since: string | null, message }[],
reportedAt: string, summaryOnly: boolean, specVersion: string | null }` — every timestamp is a
**`string`** (wire-safe-dates). `since` walks that repo's last ≤20 reports until the level changes and
is `null` (rendered "—") when the window holds no change: an unknown "since" is never printed as the
first report's date. Fleet aggregate per check = `{ pass, warn, fail, unchecked, repos }`, always
**within one org** — nothing here reaches a public or cross-tenant surface, so `CHAMPION_MIN_POP`
does not apply and no corpus row is written.

### Routes

| Method · path | Auth |
| --- | --- |
| `POST /api/report/conformance` | unchanged: org API token `telemetry:write` (or session owner), legacy shared token still warned/`STRICT`-disabled |
| `GET /api/report/conformance?repo=owner/name&limit=` | unchanged `requireOrgRead(org)`; body now `{ repo, points, regressed, checks }`, read from `ConformanceReport` |
| `GET /api/report/conformance/matrix?org=<slug>[&segment=]` | `requireOrgRead(org)` — org-slug param, not an `[id]` route, so no resolve-then-gate case arises |

`points` keeps its exact `ConformanceTrendPoint` shape (at/score/fails/warns/sha) so no client
changes; `checks` is additive.

### UI — Standing › Passports, third switcher variant "Controls"

`ControlMatrixPanel` renders repos as rows, check families as column groups (collapsed to the family
by default, expandable to `control.prepush.test` etc.). Primitives: `Tile`, `Card`, `Badge`,
`Table` from `@/components/ui`; level colours come from the brand tokens (`scoreHex` for the fleet
%, `LEVEL_HEX` untouched). Cells: pass = accent hairline, warn = amber, fail = rose, **unchecked =
a dashed cell reading "—" with the tooltip "this run did not judge this clause"** — never a zero,
never a blank that reads as pass. A `summaryOnly` repo row is stamped "summary-only (doctor < 0.3.0)"
so an old reporter is visibly distinguishable from a clean one. Every file ≤200 LOC.

### Gate option (last, smallest, and deliberately narrow)

`GatePolicy.requireChecks?: string[]` — the named check ids must be at level `pass` in the repo's
**latest** `ConformanceReport`. Query param `?require_checks=control.prepush.test,guardrail.never-commit`
plus the org gate-policy field; `sanitizeGatePolicy` keeps only ids matching the id regex, max 20.
**Skipped when unmeasurable** (no report, `summaryOnly`, or the id absent) — the same `null ⇒ skip`
rule `minAiGovernedRate` and `requireProtectedBranch` follow, so a missing measurement never
fabricates a verdict (G4). New `GateFailure.code: "conformance"`.
**Constraint vs concept doc #5 (gate-as-code):** this is an *operator-set* bar read from Ascent's
ledger — **not** a manifest-declared bar, **no** second evaluator, and it must not read
`.ai/manifest.yaml`. If #5 is accepted, `requireChecks` becomes one compiled input to that single
evaluator; the spec doc says so in one sentence so the two cannot fork.

### Self-hosted · plan gates · audit

No plan gate anywhere in this item — ingest, matrix and `requireChecks` are free on every tier, so
`selfHosted()` changes nothing. No new escape-hatch env flag. The signed `conformance.reported`
AuditLog row stays the security-shaped record; the ledger tables are derived data and carry no
signature (stated in the doc so nobody mistakes them for the tamper-evident copy).

## Build order

1. **Check ids in the doctor** — `check-ids.ts` + `add(check, level, msg)` / `check(...)` through the
   whole template; `--json` emits `findings: [{check, level, msg}]` and the POST body gains
   `findings`, `scored`, `specVersion`, `runShape`. Extend `standard.test.ts` over the generated body
   (every `add(` call site carries an id; ids match the regex). No server change yet.
2. **Spec 0.3.0 §** — the check-id table + `findings[]` + the "derived, not signed" note in
   `docs/features/onboarding/ai-manifest-spec.md`; re-mirror `SPEC_MD`; `types.test.ts` pin holds.
   (#13 already moved `MANIFEST_SCHEMA_VERSION` to `0.3.0`; if it has not, do it here once.)
3. **Ingest** — `org-conformance.ts` writer + `recordConformance` transaction + route validation.
   Legacy payloads land as `summaryOnly`.
4. **Trend off the audit log** — GET reads `listConformanceReports`; delete `loadConformanceTrend`
   and the now-unused `getAuditLog` import; `regressed` is computed from the new rows.
5. **Matrix** — `control-matrix.ts` + `loadControlMatrix` + `/matrix` route.
6. **Passports "Controls" variant** — panel, grid, cell, view model, hook.
7. **`detectControlRegressions()`** (pure, exported, unused here) — the artifact W3-M consumes.
8. **Gate `requireChecks`** — `GatePolicy` field, `sanitizeGatePolicy`, `explicitPolicyFromParams`,
   `evaluateGate` criterion, route param, doc paragraph. Landable and revertable on its own; if the
   Director prefers, cut it to W4-O without touching steps 1–7.

## Tests

**Unit (vitest)**
- `src/lib/standard/check-ids.test.ts` (new) — slugging, cap, `parseCheckId` round-trip.
- `src/lib/standard/standard.test.ts` (extend) — the generated `doctor.mjs` contains no
  `add('...` two-arg call; every emitted id is in the vocabulary; the template still has **no
  backticks and no `${`**. *Fail-before:* today's template fails the two-arg assertion immediately.
- `src/lib/standard/control-matrix.test.ts` (new) — worst-level de-dupe; `since` returns `null` when
  the window has no change; `summaryOnly` yields all-`unchecked`; `detectControlRegressions` fires on
  `pass→fail` and `warn→fail` only, never on `unchecked→fail` (an environment that started checking
  is not a regression). *Fail-before:* the module does not exist.
- `src/lib/db/org-conformance.test.ts` (new) — upsert on the same `(sha, runShape)` replaces
  findings; a null sha appends; the stale-sha guard writes no report row.
- `src/lib/db/org-watch.test.ts` (extend) — the existing stale-re-run suite stays green; the report +
  `Repository` update + audit row are one transaction.
- `src/app/api/report/conformance/route.test.ts` (extend) — 400 on a bad check id / level / >500
  findings; `summaryOnly` on a legacy payload; the GET no longer calls `getAuditLog`.
  *Fail-before:* the existing `expect(mockGetAuditLog).toHaveBeenCalledWith(...)` assertions at
  ~463/475 must be **rewritten**, and they are the proof the walk is gone.
- `src/app/api/report/conformance/matrix/route.test.ts` (new) — 403 for a non-member,
  503 without a DB, honest `unchecked` cells.
- `src/lib/scoring/gate.test.ts` (extend) — `requireChecks` fails on a `fail`, **skips** when the
  check is absent/`summaryOnly`, and `sanitizeGatePolicy` drops malformed ids.

**Structural guards touched**
`src/lib/db/wire-safe-dates.test.ts` — add `ConformanceReportRow` and `ControlMatrixRow` (schema-pass
edit; the lane only supplies the types). `src/app/api/org/id-routes-gated.test.ts` — unaffected (no
new `[id]` route). Doc-sync — `docs/features/onboarding/ai-manifest-spec.md` is in this PR.
LOC checks — every new `src/features/**` file ≤200 lines.

**e2e / UAT** — re-run **Tomáš** (prospective buyer: "show me every declared control across the
fleet, and prove it came from my repos' own CI") against Standing › Passports › Controls, and
**Sam**'s doctor loop (`node .ai/doctor.mjs --json` → the matrix cell moves). Dana's M1 briefing
journey is not touched (no `briefing.ts`, no PDF).

## Gate + done criteria

`npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks → e2e (UI
moved). Done when: a doctor run POSTs `findings[]`; the matrix renders per-check state with honest
`unchecked` and a "since" that is `null` rather than guessed; `loadConformanceTrend` no longer
exists; `detectControlRegressions` is exported and covered; `requireChecks` skips when unmeasurable;
the spec doc reads 0.3.0 and the README freshness row says so.

## Out of scope (explicitly)

- **#1 Governance evidence ledger (W3-M)** — the `control-failed` alert kind, its message builder,
  digest block and dispatch, plus the `ControlObservation` normalizers and the pack appendix. This
  lane ships the detector and the read, nothing that writes an alert.
- **#5 Gate-as-code (concept doc)** — manifest-declared bars, ratchet/no-regression, and one
  evaluator across pre-push/CI/check-run. `requireChecks` is deliberately narrower than all three.
- **#8 Agent-admission compiler (W4-O)** — turning a control failure into an enforced per-repo
  ruleset or a stance change.
- **#13 Manifest-as-scan-input** (same lane, built first) — the declared-vs-proven capability
  matrix on Passports is #13's; #16 adds a *sibling* variant and must not fold the two together.
- **#15 Guidance arbiter (W2-I)** — the doctor's guidance/drift check block.
- Deferred **#6** (signed maturity attestation), **#29** (score-input ledger), **#30**
  (reproducibility certificate), **#31** (signed tenant history bundle) — no signing, no re-score, no
  export of the conformance timeline. **#2** (open benchmark corpus, concept doc) — no cross-org or
  public aggregation of control state.
