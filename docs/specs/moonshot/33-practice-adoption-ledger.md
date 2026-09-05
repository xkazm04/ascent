# 33 — Practice adoption ledger: post-merge drift, versioned house patterns, fleet rollout

size L · effort 6 / impact 7 / risk 4 · gate **contract** · lane **W2-J2** · wave **2**

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/lib/practices/apply.ts` — stamp an adoption row on every apply; accept `registry:<slug>` ids.
- `src/lib/org/practice-mining.ts` — add `patternHash()` (pure); `minePracticeShapes` semantics unchanged.
- `src/lib/org/playbook-apply.ts` — stamp an adoption row (`source: "playbook"`) inside the existing
  best-effort bookkeeping block, beside the `applyPlaybook` mark.
- `src/lib/analyze/practice-shape.ts` — emit a body-free **artifact census** (paths + digests) on
  `RepoPracticeShape`; `version` → `"2"`, back-compatible parse.
- `src/lib/db/scans-persist.ts` — one best-effort `reconcilePracticeAdoption(...)` after the `Scan`
  row is created (sequencing note under *handoffs*).
- `src/lib/db/org-practice-shapes.ts` — tolerate `version: "2"` in `parsePracticeShape`.
- `src/lib/org/findings.ts` — add `"practices"` to `FINDING_MODULES` + a `practiceFindings()` builder.
- `src/features/shared/practices/PracticesTab.tsx` — fetch the adoption summary, render the new strip.
- `src/features/shared/practices/practiceRows.ts` — carry `adoption` onto `PracticeRow` (display only).
- `src/features/shared/practices/RegistryPractices.tsx` — the Apply affordance (step 7).
- `docs/features/org-dashboard/practices.md` — the doc; deletes three "Known gap" bullets.

**Files to create**
- `src/lib/db/practice-adoption.ts` — ledger reads/writes (`recordProposedAdoption`,
  `reconcilePracticeAdoption`, `getPracticeAdoptionSummary`, `listBehindRepos`, `listDriftedRepos`).
- `src/lib/db/house-pattern-versions.ts` — `syncHousePatternVersions`, `getLatestHousePattern`.
- `src/lib/practices/reconcile.ts` — **pure**: census × ledger → transitions.
- `src/lib/practices/registry-artifact.ts` — **pure**: `PracticeShapeRow` → `ArtifactSpec`.
- `src/app/api/practices/rollout/route.ts` — `GET` target sets (member), `POST` capped rollout (admin).
- `src/features/shared/practices/PracticeDriftStrip.tsx` — the drift/rollout strip (see §Behaviour).
- `src/features/shared/practices/practiceAdoptionRows.ts` — pure fold for the strip.
- Tests: `src/lib/practices/{reconcile,registry-artifact}.test.ts`,
  `src/lib/db/practice-adoption.test.ts`, `src/lib/analyze/practice-shape.census.test.ts`,
  `src/features/shared/practices/practiceAdoptionRows.test.ts`.

**Prisma models/columns needed (landed by the wave-2 schema pass, not by this lane)**

```prisma
model PracticeAdoption {
  id              String    @id @default(uuid())
  orgId           String
  repoFullName    String
  practiceId      String    // catalog id | "registry:<slug>" | "playbook:<uuid>"
  source          String    // generic | house | registry | playbook
  patternVersion  Int?      // HousePatternVersion.version when source = house; NULL otherwise
  artifactPath    String
  proposedHash    String    // sha256-n1 of the body ascent committed to the PR branch
  adoptedHash     String?   // sha256-n1 of the file as it LANDED; NULL until the first post-merge scan
  adoptedOutline  String?   // sha256-n1 over the landed file's normalized heading outline
  state           String    @default("proposed") // proposed|adopted|drifted|removed|superseded
  improvementPrId String?   // read-only join to the ImprovementPr this came from
  prNumber        Int?
  adoptedAt       DateTime?
  driftedAt       DateTime?
  lastCheckedAt   DateTime?
  lastScanId      String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt // wire type declares all five as `string`
  @@unique([orgId, repoFullName, practiceId, artifactPath])
  @@index([orgId, state])
  @@index([orgId, practiceId, patternVersion])
}

model HousePatternVersion {
  id            String   @id @default(uuid())
  orgId         String
  practiceId    String
  version       Int      // 1-based, per (orgId, practiceId)
  linesJson     String   @default("[]") // TEXT JSON string[] — minedStarter() output
  exemplarsJson String   @default("[]") // TEXT JSON string[] — repo fullNames that agreed
  agreementMin  Int      @default(2)    // MIN_AGREEMENT in force when mined
  patternHash   String                  // sha256-n1 over linesJson — the change key
  minedAt       DateTime @default(now())
  @@unique([orgId, practiceId, version])
  @@unique([orgId, practiceId, patternHash])
  @@index([orgId, practiceId])
}
```
Plus `wire-safe-dates.test.ts` entries for `PracticeAdoptionRow` / `HousePatternRow`.

**Director-owned lines requested at merge** — `src/lib/db/index.ts`: re-export `./practice-adoption`
and `./house-pattern-versions`. `context-map.json`: the new `src/lib/practices/*` + `src/lib/db/*`
modules and `PracticeDriftStrip.tsx` onto the *Practices, Governance & Adoption* `filePaths`.
`scripts/docs/feature-doc-map.json`: extend the practices `sourceGlobs` with `src/lib/practices/**`
and `src/lib/db/practice-adoption.ts`.

**MUST NOT TOUCH** — `prisma/schema.prisma`, `prisma/init.sql`, `src/lib/db/index.ts`,
`context-map.json`, `feature-doc-map.json`; `src/lib/db/improvement.ts` (W1-E landed its hook — this
lane only **reads** merged rows); `src/lib/practice-artifact.ts` + `src/lib/practices.ts` (W2-I);
`src/lib/report/compare.ts` (W2-J1); `src/lib/analyze/{index,context-health,guidance-graph}.ts`
(W2-I); `src/lib/mcp/**` (W2-K).

**Handoffs to other lanes**
- **W2-I (#15):** the "Consolidate guidance" starter is a `PRACTICES` entry + a `buildArtifact` case;
  this lane's apply path is catalog-driven and needs **no change** to carry it. One requirement: the
  new practice keeps a single deterministic `artifact.path` — the ledger keys on it.
- **W1-F (#32):** add both tables to the org erase/purge cascade in `src/lib/db/retention.ts`.
- **W1-A (#13):** both lanes edit `scans-persist.ts`. W1-A lands in wave 1 (`manifestJson` on the
  `Scan.create` data block); this lane's edit is a separate statement **after** the create. If the
  Director judges the regions too close, this hook moves to `src/lib/scan-finalize.ts`.
- **W3-M (#1):** a `drifted` transition is a control observation; not emitted as a `GovernanceEvent`
  here, but W3-M may read the ledger.

## Goal

Make practice adoption a **stateful per-repo projection** that survives time: what artifact landed,
whether it is still there, which version of the org's house pattern it came from, and which repos are
behind when that pattern moves. No incumbent keeps a fleet-wide adoption state for the artifacts it
wrote or re-converges a fleet when the org's own pattern moves — it is what turns UC1 from an audit
into a subscription. **Known gaps deleted from `docs/features/org-dashboard/practices.md`:**
*"Adoption is tracked at the PR, not the repo"* (→ the projection), *"Reuse doesn't update"*
(→ version-driven rollout), *"Registry practices are read-only"* (→ the registry apply path).

## Behaviour

### Premise corrections (verified against the tree, 2026-08-29)

- **Held:** `artifactFingerprint` has exactly two non-test call sites, both pre-apply
  (`applyPracticeToRepo`, `PracticeApply.tsx`); no applied hash is persisted. `ImprovementPr` is
  `@@unique([orgId, repoFullName, practiceId])`, no hash column, verified once by `verifyMergedPrs`.
  `MIN_AGREEMENT = 2`, mined live from the latest `Scan.practiceShape`, unversioned.
  `RegistryPractices.tsx` deliberately renders no Apply button.
- **Corrected:** playbook PRs bypass `ImprovementPr`, but `applyPlaybookToRepo` *does* write a
  `PlaybookApplication` adoption mark + audit row (best-effort, swallowed). The gap is **merge/drift
  detection**, not "untracked": this lane adds a ledger row beside the mark rather than re-plumbing
  playbooks onto `ImprovementPr`.
- **Corrected:** `PracticeRolloutStrip.tsx` **already exists** (G7-20, the applied→landed→lift rollup
  folded from `summarizeRollout`) — the new surface is a **distinct** `PracticeDriftStrip.tsx` beneath
  it, not an edit overloading the lift strip. And `persistScanReport` receives a `ScanReport` carrying
  **no tree and no file bodies**, so reconciliation cannot hash at persist time: it needs the
  body-free census computed where tree + files still exist (`extractPracticeShape`, from
  `scan-compose.ts`).

### Data model and honest-null rules

- **Census (`RepoPracticeShape.version: "2"`).** `extractPracticeShape(tree, files)` also emits
  `artifacts: { path, bodyHash: string | null, outlineHash: string | null }[]` (cap 40) for every
  **blob in the tree** whose path matches a practice-artifact path (`OUTLINE_RULES` / `LAYOUT_RULES`
  plus the fixed paths `buildArtifact` writes), and `truncated: boolean`. `bodyHash` is `null` when
  the path is in the tree but its body was not fetched — **unknown, never "changed"**. Digests use
  `contentDigest` (`src/lib/registry/parse.ts`, `sha256-n1:<hex>` over LF-normalized text). Leak
  boundary unchanged: digests and paths only, no body, org-internal.
- **Transitions (pure, `reconcile.ts`).** Per ledger row of the scanned repo:
  | Census state | Verdict |
  |---|---|
  | path absent **and** `truncated === false` | `removed` |
  | path absent **and** `truncated === true`; or `bodyHash === null` | no verdict; `lastCheckedAt` untouched |
  | row `proposed`, PR merged, hash present | `adopted`; stamp `adoptedHash`/`adoptedOutline` **from what landed**, not `proposedHash` |
  | `bodyHash === adoptedHash` | stays `adopted`; bump `lastCheckedAt`/`lastScanId` |
  | body differs, `outlineHash === adoptedOutline` | stays `adopted` (a cosmetic edit is not drift) |
  | body **and** outline differ | `drifted`, stamp `driftedAt` |
  A `drifted`/`removed` row that matches again returns to `adopted` (self-healing). **The baseline is
  the landed file, never the proposed body** — a reviewer editing the PR before merge is the normal
  case and must not read as drift.
- **Merge detection is read-only.** `reconcilePracticeAdoption` reads `ImprovementPr` rows
  (`state: "merged"`, matching org/repo/practice) to promote `proposed → adopted`. It never writes
  that table (W1-E owns it).
- **Versions.** `syncHousePatternVersions(orgSlug)` runs after mining: for each `MinedPractice` with
  `minedStarter() !== null`, `patternHash = contentDigest(JSON.stringify(lines))`; insert
  `version = max + 1` only when the hash is new (`@@unique([orgId, practiceId, patternHash])` makes it
  idempotent under concurrency). An org that mines nothing gets **no row** — absence, not a v0.
  `patternVersion` is `null` for `generic`/`registry`/`playbook`: *not version-tracked*, never *v0*.
- **Idempotency.** The adoption row is upserted on `(orgId, repoFullName, practiceId, artifactPath)`;
  a re-apply updates `proposedHash`/`patternVersion` and resets `state` to `proposed` only if `removed`.

### Modules (signatures)

```ts
// src/lib/practices/reconcile.ts (pure)
export interface CensusEntry { path: string; bodyHash: string | null; outlineHash: string | null }
export interface LedgerRow { id: string; artifactPath: string; state: string;
  adoptedHash: string | null; adoptedOutline: string | null; merged: boolean }
export type Transition =
  | { id: string; to: "adopted"; adoptedHash: string; adoptedOutline: string | null }
  | { id: string; to: "drifted" | "removed" }
  | { id: string; to: "checked" };            // no state change, timestamps only
export function reconcileAdoption(rows: LedgerRow[], census: CensusEntry[], truncated: boolean): Transition[];

// registry-artifact.ts (pure) — `practices/<slug>/PRACTICE.md` committed at `docs/practices/<slug>.md`,
// body = indexed content + a provenance header naming the registry path. Null for an archived row or
// empty content (never commits an empty file).
export function buildRegistryArtifact(row: PracticeShapeRow): ArtifactSpec | null;
export function patternHash(lines: string[]): string;   // practice-mining.ts

// practice-adoption.ts — recordProposedAdoption never throws (logs loudly, as recordPracticePr does)
export async function recordProposedAdoption(input: {
  orgId: string; repoFullName: string; practiceId: string; source: AdoptionSource;
  patternVersion: number | null; artifactPath: string; proposedHash: string;
  prNumber: number | null; improvementPrId?: string | null;
}): Promise<void>;
export async function reconcilePracticeAdoption(
  orgId: string, repoFullName: string, scanId: string, shape: RepoPracticeShape,
): Promise<{ drifted: number; removed: number; adopted: number } | null>;
export async function getPracticeAdoptionSummary(orgSlug: string): Promise<PracticeAdoptionSummary>;
```
`PracticeAdoptionRow` / `PracticeAdoptionSummary` declare **every timestamp as `string`**
(`adoptedAt`, `driftedAt`, `lastCheckedAt`, `minedAt`), mapped with `.toISOString()` server-side —
wire-safe-dates guard.

### Routes

| Method · path | Auth | Behaviour |
|---|---|---|
| `GET /api/practices/rollout?practiceId=…` | `requireOrgAccess` (member) via `?org=` | Returns `{ latestVersion, behind: string[], drifted: string[], removed: string[] }`. Read-only. |
| `POST /api/practices/rollout` | `requireOrgRole(org, "admin")` — the `apply-batch` floor, since it pushes into customer repos | Body `{ org, practiceId, mode: "behind" \| "drifted", repos[] }`. Repos re-validated against the org (a foreign coordinate fails the whole call, never partially applies), case-insensitively deduped, capped at **`MAX_BATCH = 25`** with the excess reported as `skipped`, `mapPool` at `SCAN_CONCURRENCY`, per-repo error isolation. Every repo goes through `applyPracticeToRepo` — one write path, no fork. Audit `practice.rollout_opened` `{ practiceId, mode, fromVersion, toVersion, repos: n, batch: true }`. |

Not an `[id]` route (org arrives in the body and is gated before the query — gate-then-constrain), so
`id-routes-gated.test.ts` is unaffected. `registry:<slug>` ids flow through the existing
`/api/practices/apply` and `apply-batch`: `applyPracticeToRepo` branches to `buildRegistryArtifact`.

### UI

`PracticeDriftStrip.tsx` (`src/features/shared/practices/`, **client**, ≤200 LOC), rendered by
`PracticesTab` directly beneath the existing `PracticeRolloutStrip`:

- Three `Tile`s (`@/components/org/shared/ui`, `TILE_GRID`): **Adopted** (n repos), **Behind** (`n on
  v1 · house pattern is v3`), **Drifted / removed**. Hairline chrome from `TILE_LEDGER`; neutral
  accent `BAND.some`, **not** `scoreHex` — a library behind on one pattern is a baseline, not a red
  maturity reading. Renders **nothing** on an empty ledger (the lift strip's rule).
- A **Roll out** action per non-zero bucket opens the existing `batchPrConfirm` typed-confirm dialog
  (same-origin `POST`), lists the exact repos and states the 25-repo cap first. Drift is a **finding
  to decide**, never auto-reapplied: doing nothing is a valid outcome.
- `practiceRows.ts` gains optional `adoption?: { adopted; behind; drifted }` on `PracticeRow` for the
  ledger table's per-practice column. Display only; sort unchanged.

`practiceFindings()` emits one `Finding` per drifted/removed row into the `practices` module,
`itemKey = \`${repoFullName}:${practiceId}:${artifactPath}\`` — stable ids, never wording, so a
recorded `OrgDecision` survives the next scan and the Follow-ups badge stops re-counting it.

### Self-hosted · plan gates · privacy · audit

- **Self-hosted:** no plan gate exists on this surface today and none is added, so `selfHosted()`
  changes nothing; the rollout's only floor is the org **admin** role.
- **Privacy floors:** adoption rows and house-pattern versions are strictly org-internal — no public
  report, leaderboard, shared corpus or cross-org read. `CHAMPION_MIN_POP` does not apply (nothing is
  aggregated across tenants). The census stores digests and paths, never bodies.
- **Audit:** `practice.rollout_opened` / `practice.registry_applied` (customer-repo writes) go through
  `recordAudit` inside `openArtifactDraftPr`. Drift transitions are **not** audit rows — they are
  ledger observations surfaced as findings. Both tables are erased with the org (handoff to W1-F).

## Build order

1. **Census.** `extractPracticeShape` emits `artifacts[]` + `truncated`, `version: "2"`;
   `parsePracticeShape` accepts `"1"` (no census → reconcile is a no-op for old scans) and `"2"`.
   Gate: `practice-shape.census.test.ts` + the existing shape tests green.
2. **Ledger writes.** `src/lib/db/practice-adoption.ts` + `reconcile.ts` (pure). No call sites yet.
3. **Stamp on apply.** `applyPracticeToRepo` calls `recordProposedAdoption` after `recordPracticePr`
   with `source` (`house` when `resolveHousePattern` returned a pattern, else `generic`),
   `artifact.path`, `contentDigest(artifact.body)`; the same call in `applyPlaybookToRepo`'s
   best-effort block as `source: "playbook"`, `practiceId: \`playbook:${id}\``.
4. **Reconcile at persist.** One best-effort call in `scans-persist.ts` after the `Scan` row is
   created; a failure logs and never fails the scan.
5. **Versions.** `patternHash` in `practice-mining.ts`; `syncHousePatternVersions` called from
   `PracticesTab`'s mining read (already server-side, already awaited) and stamped by
   `applyPracticeToRepo` via `getLatestHousePattern`.
6. **Registry starters.** `registry-artifact.ts` + the `registry:` branch in `applyPracticeToRepo`;
   `RegistryPractices.tsx` gains its Apply affordance through the existing `PracticeApply` flow.
7. **Rollout route** (`GET` + `POST`) over `listBehindRepos` / `listDriftedRepos`.
8. **UI + findings.** `PracticeDriftStrip` + `practiceAdoptionRows.ts`; `practices` added to
   `FINDING_MODULES` with `practiceFindings()`.
9. **Doc.** `practices.md`: the three known gaps deleted, an "Adoption ledger" section added.

## Tests

- **New — `reconcile.test.ts`:** the full transition table. *Fail-before:* a cosmetic edit (reworded
  paragraph under an unchanged heading) must **not** produce `drifted`; a truncated tree must **not**
  produce `removed`.
- **New — `practice-shape.census.test.ts`:** a `#` inside a fenced block still never reaches an
  outline (the leak pin, re-asserted for `outlineHash`); census caps at 40; a tree-present /
  body-unfetched path yields `bodyHash: null`.
- **New — `registry-artifact.test.ts`:** an archived or empty row returns `null`; the provenance
  header names the registry path. **`practice-adoption.test.ts`:** upsert idempotency on the 4-tuple;
  a second identical mine creates **no** new `HousePatternVersion`.
  **`practiceAdoptionRows.test.ts`:** nothing renders on an empty ledger; a null `patternVersion`
  never reads as "v0 / behind".
- **Extend:** `src/lib/org/findings.test.ts` (key stability for `practiceFindings`),
  `fixFirst.test.ts` (`FINDING_MODULES` tie-break now has a fifth member),
  `practiceRowsRollout.test.ts` (the existing lift strip unchanged by the new `adoption` field).
- **Structural guards:** `wire-safe-dates.test.ts` (two new row types — entries landed by the schema
  pass); `id-routes-gated.test.ts` (unaffected — no `[id]` route added; assert still green); doc-sync.
- **UAT — Sam** (`/uat recertify`): apply a practice, merge, rescan, edit the merged artifact, rescan
  again, and confirm the drift reaches the Follow-ups worklist as a decidable finding, not a new PR.
  Dana is not in scope (no briefing/PDF change), so M1 does not bind this lane.
- **Gate:** `npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks
  (200 under `src/features/**`; `PracticesTab.tsx` is 121 LOC today — put the new fold in
  `practiceAdoptionRows.ts` rather than growing it) → e2e for the Practices tab.

## Done criteria

A merged artifact that is later gutted flips to `drifted` on the next scan and appears as a decidable
finding; an org whose house pattern moves v1 → v3 sees exactly which repos are still on v1 and can
open their PRs in one capped, re-confirmed action; a registry `PRACTICE.md` applies through the same
writer; and nothing in the diff auto-reapplies anything.

## Out of scope (explicitly)

- Deferred deck items this must not absorb: **#6** signed maturity attestation, **#12** purchasable
  artifacts, **#20** Athena as registry curator, **#21** GitHub identity graph sync, **#24** billing
  account above the tenant, **#28** durable scheduled drives, **#29** score-input ledger, **#30**
  reproducibility certificate, **#31** signed tenant history bundle, **#37** data-bound deck diagrams.
- Adjacent **accepted** items whose surfaces this lane does not take: **#8** admission compiler
  (writes rulesets; this lane only opens draft PRs), **#9** outcome ledger (owns `improvement.ts`),
  **#15** guidance arbiter (owns the catalog entry + artifact builder), **#26** one improvement ledger
  (`ImprovementPr.source`), **#35** foundation rollout (`standard/pr.ts`), **#1** evidence ledger.
- Not built here: raising the 25-repo cap (a deliberate bound), a create-only safety check on
  `openDraftPr` (a separate known gap), a per-org custom catalog, and any public reporting of
  adoption state.
