# 01 — Governance Evidence Ledger   XL · effort 8 / impact 9 / risk 5 · gate: policy · lane W3-M · wave 3

_Merges deck sources 02#1 (event-sourced webhook ledger), 04#1 (per-repo control observations +
transition alerts) and 05#2 (as-of-merge pack, control-flip alerts, verifiability). Starts **only
after W3-L (#10) has merged**: L owns the webhook fan-in for the new event kinds, the durable scan
queue and `src/lib/scan/probe.ts`, and this lane edits those files sequentially behind it. W1-A (#16)
requested the `control-failed` alert kind from this lane; §Handoffs states the exported signature._

## Premise check against the current tree

Every premise held; line numbers drifted, symbol names did not. Verified 2026-08-29:

- `src/app/api/app/webhook/route.ts` — `WebhookPayload` has no review/ruleset/membership shape; the
  dispatch handles exactly `installation`, `installation_repositories`, `pull_request`, `check_run`,
  `push`. Everything else is dropped. `model WebhookDelivery` (`schema.prisma:1349`) is
  `{id, expiresAt, createdAt}` — a replay claim, not an event. No `GovernanceEvent` /
  `ControlObservation` / `ControlState` model exists.
- `src/lib/db/audit-integrity.ts` — `signAudit` / `withAuditSignature` / `verifyAudit` / `sha256Hex`
  exist; its header states the *deliberate* "no chain (so no concurrent-writer fork)" choice.
  `src/app/api/audit/` holds only `route.ts` + `route.test.ts` — **no verify endpoint**.
- `src/lib/db/ai-changes.ts` — the pack's `RepoControlEnvironment` is built from
  `scans: { orderBy: { scannedAt: "desc" }, take: 1 }` (`:138-141`), i.e. **latest scan**, and
  `buildConformancePack`'s `limitations` (`pack.ts:270-299`) does not disclose it. `AiChange` is
  `@@unique([repoId, prNumber])`, upserted per scan → approval state has no history.
- `src/lib/alerts.ts:37` — `RegressionReason["code"]` is still the closed four-value union;
  `AlertEventKind` (`alert-events.ts:11-18`) has no `control` member; the only "security" push is a
  D9 delta (`scan-alerts.ts:200-233`). `ScanDiff` (`compare.ts:137-158`) has no governance field.
- `Scan.governance` is persisted per scan and read point-in-time only (`org-signals.ts` `take: 1`,
  `org-rollup.ts` `parseGovernanceLite`). `Governance` (`types.ts:735-746`) has ten fields including
  the honest `readable` flag. No SARIF/OSCAL/DSSE code exists (grep: detection regexes only).

**One correction that changes the design.** 02#1 and 05#2 both ask for a per-row hash chain over
webhook-fed rows. Webhook deliveries are concurrent and `audit-integrity.ts` refused a chain for
exactly that reason; chaining per row here would reintroduce the fork it avoided. This spec keeps a
**per-row HMAC** (reusing `signAudit`) and adds a **daily seal**: a `ControlLedgerSeal` per
`(orgId, day)` carrying a sha256 root over that day's canonical row digests plus the previous day's
root. Row and whole-day deletion become detectable, writers never contend, and an examiner
recomputes the root from the exported CSV **without the signing secret**.

**Second reconciliation.** 02#1 wanted a `GovernanceEvent` table (actor, before/after) and 04#1/05#2
a `ControlObservation`/`ControlState` table (state at a time). Two tables would force either a
fabricated actor on scan rows or a fabricated before/after on webhook rows. One table with
`source` + nullable `actorLogin`/`prevValue` carries both honestly and gives the pack, the alerts and
the timeline a single reader.

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/app/api/app/webhook/route.ts` — extend `WebhookPayload`; route the new event kinds into the
  normalizer under `after()`. *(W3-L's file, edited after L merged; sequential by §2.)*
- `src/lib/scan/probe.ts` — one call appending probe results as observations. *(W3-L's file, same.)*
- `src/lib/db/scans-persist.ts` — one call appending scan-sourced observations from `report.governance`.
- `src/lib/alerts.ts` — `ControlTransition`, `detectControlTransitions`, `buildControlAlertMessage`,
  `controlCooldownKey`; `digestHasSignal` gains `controlsFailed`; `FleetDigestInput` a controls block.
- `src/lib/scan-alerts.ts` — dispatch `control` alerts beside the regression push (own cooldown key).
- `src/lib/db/alert-events.ts` — `AlertEventKind |= "control"`.
- `src/lib/db/ai-changes.ts` — as-of-merge environment read; `source` on `AiChangeRecord`.
- `src/lib/conformance/pack.ts` — per-item `environmentAsOf`, coverage line, limitations rewrite;
  `csv.ts` as-of columns + seal root in the manifest; `api/org/conformance-pack/route.ts` audit meta.
- `src/lib/db/retention.ts` — purge + erase branches for the two new tables (floor: `auditDays`).
- `src/features/standing/governance/GovernancePanel.tsx` — mount the timeline card.
- `docs/features/github/github-app.md`, `docs/features/fleet/alerts.md`,
  `docs/features/org-dashboard/org-intelligence.md` — doc-sync (§Known gaps below).

**Files to create**
- `src/lib/controls/catalog.ts` — the control catalogue (ids, labels, sources, mapping from `Governance`).
- `src/lib/controls/transitions.ts` — pure transition detector.
- `src/lib/controls/seal.ts` — canonical row digest + daily root (pure).
- `src/lib/github/governance-events.ts` — webhook payload → `ControlObservationInput[]` (pure).
- `src/lib/db/control-observations.ts` — `appendControlObservations`, `controlStateAt`,
  `listControlTimeline`, `controlCoverage`, `sealDay`, `verifySeals`.
- `src/app/api/org/controls/route.ts` — `GET` timeline.
- `src/app/api/audit/verify/route.ts` — `GET` seal chain + recomputation instructions.
- `src/features/standing/governance/ControlTimelineCard.tsx` (+ `controlTimeline.ts` pure helper).
- Tests: see §Tests.

**Prisma models/columns needed (landed by the wave-3 schema pass, not by this lane)**

```prisma
model ControlObservation {                 // append-only; one row = "control X was in state S at T"
  id           String   @id @default(uuid())
  orgId        String
  repoId       String?                     // null = org-scoped control
  repoFullName String                      // denormalized: the pack/timeline read never joins
  controlId    String                      // catalog id, e.g. "branch-protection"
  state        String                      // pass | fail | unmeasurable  — never inferred
  value        String?                     // the measured value ("2", "true"), null when unmeasurable
  prevValue    String?                     // null on the first observation for the pair
  evidenceJson String   @default("{}")     // TEXT JSON (no jsonb — DSQL/PGlite)
  source       String                      // scan | probe | webhook | baseline
  actorLogin   String?                     // webhook only; NEVER fabricated for scan/probe
  occurredAt   DateTime                    // when the state held / the change happened
  observedAt   DateTime @default(now())    // when we learned it
  scanId       String?
  deliveryId   String?                     // GitHub X-GitHub-Delivery — the idempotency key
  sig          String?                     // signAudit() over the canonical fields; null = signing off
  @@unique([deliveryId, controlId, repoFullName])   // webhook redelivery is a no-op
  @@index([orgId, repoFullName, controlId, occurredAt])
  @@index([orgId, occurredAt])
}

model ControlLedgerSeal {                  // one per (org, UTC day); chains days, not rows
  id        String   @id @default(uuid())
  orgId     String
  day       String                         // YYYY-MM-DD (UTC)
  rowCount  Int
  root      String                         // sha256 over sorted per-row digests
  prevRoot  String?                        // previous sealed day's root; null = first
  sealedAt  DateTime @default(now())
  sig       String?                        // HMAC over {orgId, day, rowCount, root, prevRoot}
  @@unique([orgId, day])
  @@index([orgId, day])
}

// AiChange (existing) gains, for the live-stream reducer:
//   source            String  @default("scan")   // scan | webhook
//   approvalObservedAt DateTime?                 // when the approval was OBSERVED (webhook time)
```

Also requested from the schema pass: `wire-safe-dates.test.ts` entries for `ControlObservationRow`
and `ControlSealRow` (both declare every timestamp as `string`).

**Director-owned lines requested at merge**
- `src/lib/db/index.ts`: `export { appendControlObservations, controlStateAt, listControlTimeline, controlCoverage, type ControlObservationRow, type ControlSealRow } from "@/lib/db/control-observations";`
- `context-map.json`: add `src/lib/controls/**`, `src/lib/github/governance-events.ts`,
  `src/lib/db/control-observations.ts`, `src/app/api/org/controls/**`, `src/app/api/audit/verify/**`
  to the *Security Posture & Audit Log* context's `filePaths`.
- `scripts/docs/feature-doc-map.json`: add `src/lib/controls/**`, `src/lib/conformance/**`,
  `src/app/api/org/conformance-pack/**`, `src/app/api/org/controls/**`,
  `src/features/standing/governance/**` to the `org-dashboard` entry's `sourceGlobs` (today only
  `governance/stance/**` and `GovernancePanel.tsx` are mapped, and `src/lib/conformance/**` is mapped
  nowhere — a whole evidence surface currently switches the doc nag off).

**MUST NOT TOUCH** — `prisma/schema.prisma`, `prisma/init.sql`, `src/lib/db/index.ts`,
`context-map.json`, `feature-doc-map.json`, `wire-safe-dates.test.ts` (Class B, request the lines);
`src/lib/scoring/gate*.ts` and `src/app/api/gate/**` (W4-O #8 consumes the ledger, this lane adds no
gate condition); `src/lib/standard/**` and `ConformanceReport`/`ConformanceFinding` (W1-A #16);
`src/lib/db/scan-jobs.ts`, `src/app/api/cron/rescan/**`, `src/lib/pool.ts`, `src/lib/db/org-watch.ts`
(W3-L); `src/lib/analyze/**` and `src/lib/report/compare.ts` (`ScanDiff` gains no field — transitions
are computed from the ledger, not from a diff).

**Handoffs to other lanes**
- **W1-A (#16):** the requested kind ships here as
  `detectControlTransitions(prev: ControlSnapshot, next: ControlSnapshot): ControlTransition[]` +
  `buildControlAlertMessage(input: ControlAlertInput): AlertMessage`, with
  `AlertEventKind = "control"` and reason codes `control-failed | control-restored |
  control-unmeasurable`. A doctor check failing is dispatched by W1-A calling
  `buildControlAlertMessage({ items: [{ repo, controlId, from, to, source: "conformance" }] })`.
  W1-A's `ConformanceFinding` rows are **not** written into `ControlObservation` in this lane.
- **W3-L (#10):** L subscribes the App to `branch_protection_rule`, `repository_ruleset`,
  `pull_request_review` and `pull_request` (`closed`), and enqueues them; this lane adds the
  normalizer + append behind that fan-in. If L lands the subscription only, M adds the dispatch arm.
  L's probe results must expose `{ controlId, state, value, evidence }` (or the raw governance blob)
  from `probeControls()` — this lane appends from that shape.
- **Director:** confirm the two W3-L files above are M's to edit post-merge (§2 names only
  `alerts.ts` / `pack.ts` as M's alone); if not, request the two call sites from L instead.

## Goal and the Known gaps this deletes

Turn every control-facing read from a latest-scan snapshot into a queryable, tamper-evident timeline:
what each control was, when it changed, who changed it, and what state it was in **at the moment a
sampled AI change merged**. Competitive angle: Vanta/Drata state that AI-change evidence collection
is manual and Factory/DX alert on score movement — nobody sells a per-control observation timeline
joined to AI-authored changes at merge time and recomputable by the examiner.

Known gaps deleted in the same PR:
- `docs/features/fleet/alerts.md` §Known gaps — the taxonomy's inability to say "a control failed";
  replaced by the shipped `control` kind plus the honest remainder (`unmeasurable` never alerts as
  failed). The two `(Closed …)` lines stay.
- `docs/features/github/github-app.md` §Known gaps — the event-subscription table gains the new kinds
  and, in the same edit, the scout-noted omission of `installation_repositories` / `check_run`.
- `docs/features/org-dashboard/org-intelligence.md` — the pack section gains the as-of-merge
  guarantee and the coverage statement, closing the scout-noted defect "conformance pack limitations
  omit that `environment` is latest-scan not as-of-merge".

## Behaviour

**Control catalogue** (`src/lib/controls/catalog.ts`, pure, no I/O):
`CONTROLS: readonly ControlDef[]` where
`ControlDef = { id, label, scope: "repo"|"org", sources: ("scan"|"probe"|"webhook")[], from(g: Governance | null): ControlReading }`.
Ids: `branch-protection`, `required-pull-request`, `required-approvals`, `code-owner-review`,
`required-status-checks`, `signed-commits`, `linear-history`, `ai-governed-rate`.
`ControlReading = { state: "pass"|"fail"|"unmeasurable"; value: string | null }` — `governance.readable
=== false` or a null blob maps to **`unmeasurable`**, never to `fail`. That is the whole honesty
contract of this item: absence of evidence is a third state, and it must never dispatch an alert nor
count as an operating control.

**Data model rules.** Append-only: a correction is a new observation, never an update. Idempotency is
`@@unique([deliveryId, controlId, repoFullName])` for webhook rows; scan rows dedupe on
`(scanId, controlId, repoFullName)` at the writer. `prevValue` is filled from the last observation
for the pair *at write time* and is null for the first — the ledger never back-fills a synthetic
"was on" before its first observation. Wire types (`ControlObservationRow`, `ControlSealRow`) declare
`occurredAt`/`observedAt`/`sealedAt` as `string`, `.toISOString()`d in `toRow()` server-side.
`controlCoverage(org, repo, controlId, window)` returns
`{ firstObservedAt, lastObservedAt, observations, sources, gapDays }` and every ledger-reading
surface prints it: "the control operated for N of N observations" is only ever said with N stated.

**Pure modules**
- `normalizeGovernanceEvent(event: string, payload: unknown, ctx: { orgId; repoFullName; deliveryId }): ControlObservationInput[]` (`src/lib/github/governance-events.ts`) — unknown event or unparseable payload → `[]`, never a throw.
- `detectControlTransitions(prev: ControlSnapshot, next: ControlSnapshot): ControlTransition[]` (`src/lib/controls/transitions.ts`) — `ControlTransition = { controlId; repoFullName; code: "control-failed"|"control-restored"|"control-unmeasurable"; from; to; at; actorLogin: string | null }`. `pass → unmeasurable` emits `control-unmeasurable` (severity `info`), never `control-failed`.
- `rowDigest(r: ControlObservationInput): string` and `dayRoot(digests: string[]): string` (`src/lib/controls/seal.ts`) — canonical JSON, recursive key sort, `sha256Hex`. Deterministic and secret-free, so an examiner can recompute from the CSV.

**Reducers.** `pull_request_review` (`submitted`, `state === "approved"`) and `pull_request.closed`
(`merged`) upsert the matching `AiChange` row with `source: "webhook"` and `approvalObservedAt`,
using the same AI-involvement predicate as `extractAiChanges` (`src/lib/analyze/pulls.ts`) — imported,
not re-implemented. A scan re-ingest never downgrades a webhook-sourced approval to `false`.

**As-of-merge pack.** `getAiChangePopulation` gains a second read: for each sampled/finding row,
`controlStateAt(repoFullName, controlId, mergedAt ?? createdAt)`. `SampledItem` gains
`environmentAsOf: { source: "ledger"|"latest-scan"; observedAt: string | null; controls: Record<string, ControlReading> }`.
When the ledger has no observation at or before that instant, the row falls back to the latest-scan
environment **and says so per row** (`source: "latest-scan"`), and the pack's `limitations` keeps a
line naming how many rows fell back. The existing latest-scan limitation line is replaced by the
as-of guarantee only for the rows that got one.

**Routes**
- `GET /api/org/controls?org=&repo=&controlId=&from=&to=` — `requireOrgRead(org)`; returns
  `{ timeline: ControlObservationRow[]; coverage: ControlCoverage[] }`. 503 without a DB.
- `GET /api/audit/verify?org=&from=&to=` — `requireOrgRead(org)`; returns the seal chain
  (`day, rowCount, root, prevRoot, sealedAt`), a `chainOk` boolean, and the recomputation recipe
  (canonical field order + digest algorithm) so the check is reproducible without the secret. Lazily
  seals any **closed** UTC day that has rows and no seal (no new cron, no `vercel.json` change).
  Audited as `controls.verify`.
- No `[id]` route is added, so `id-routes-gated.test.ts` is untouched.

**Alerts.** `AlertEventKind` gains `control`. Dispatch sits in `scan-alerts.ts` beside the D9 push,
with its own cooldown key `${fullName}#control:${controlId}` so a control flip is never starved by a
score push. Severity: `control-failed` → `critical`, `control-restored` → `celebration`,
`control-unmeasurable` → `info` **and not dispatched to a sink** (recorded as an `AlertEvent` with
`suppressedReason: null`, `delivered: false`) — flaky token access must not page anyone. The digest
gains a "Controls that failed this week" block above movers, and `digestHasSignal` returns true when
`controlsFailed > 0` (a week with only a control failure is still a week worth sending).

**UI.** Governance tab (`src/features/standing/governance/`): `ControlTimelineCard.tsx` — a
`Surface` + `Kicker` card with an `OrgTable` of `control × repo × last change`, each row expanding to
the observation list; state chips use `Tile`/`TILE_LEDGER` chrome, score-free so no `scoreHex`;
`unmeasurable` renders as an em dash with a tooltip, never a zero or a red. `controlTimeline.ts`
holds the grouping/pure shaping so the card stays well under 200 LOC (`src/features/**` cap).
`EvidencePackCard.tsx` is untouched; the pack's new coverage line is server-rendered text.

**Self-hosted · plan gates · privacy · audit.** `selfHosted()` turns plan gates off, so ledger,
timeline and verify are available on every tier there. Without an installed App there are no
`source: "webhook"` rows and coverage says so — it degrades to scan+probe rather than pretending.
`actorLogin` is a GitHub login, subject to the pack's existing pseudonymisation (owner-only
`identities=named`); the timeline is org-scoped, so no `CHAMPION_MIN_POP` floor applies (nothing
public or cross-org). New audit actions: `controls.verify`, `controls.timeline.export`. Both tables
purge under the org's **`auditDays`** policy (`RETENTION_MIN_AUDIT_DAYS = 7` floor) and are deleted
by the erase path; a purged day keeps its seal, so a deleted window stays *detectable*.

## Build order

1. `src/lib/controls/catalog.ts` + `transitions.ts` + `seal.ts`, with tests. Pure, no DB, landable alone.
2. `src/lib/db/control-observations.ts`: append (signed, idempotent), `controlStateAt`,
   `listControlTimeline`, `controlCoverage`. Barrel line requested.
3. Scan-sourced writes: `scans-persist.ts` appends from `report.governance` after the governance blob
   is persisted; backfill script reads existing `Scan.governance` history into `source: "scan"` rows.
4. Webhook normalizer + dispatch arm behind W3-L's fan-in; probe-sourced append in `probe.ts`.
5. Real-time `AiChange` reducer for `pull_request_review` / `pull_request.closed`.
6. `detectControlTransitions` wired into `scan-alerts.ts`: `control` alert kind, cooldown, `AlertEvent`
   row; digest Controls block + `digestHasSignal`.
7. As-of-merge pack: `ai-changes.ts` read, `pack.ts` `environmentAsOf` + coverage + limitations,
   `csv.ts` columns, route audit meta.
8. `GET /api/org/controls`, `GET /api/audit/verify` + lazy sealing, retention/erase branches.
9. Governance tab timeline card; docs (three files) + the known-gap deletions.

## Tests

- New: `src/lib/controls/catalog.test.ts` (every `Governance` field maps; `readable: false` →
  `unmeasurable` for all repo controls), `src/lib/controls/transitions.test.ts`,
  `src/lib/controls/seal.test.ts` (digest is key-order-independent; a mutated row changes the root),
  `src/lib/github/governance-events.test.ts` (each subscribed event → expected observations; unknown
  event → `[]`).
- Extend: `src/lib/alerts.test.ts` (control message shape; `digestHasSignal` with only
  `controlsFailed`), `src/lib/conformance/pack.test.ts` (as-of row uses the ledger; a row with no
  observation falls back and is *labelled*; the limitation line counts fallbacks),
  `src/app/api/app/webhook/route.test.ts` (a `pull_request_review` delivery appends once; a
  redelivery appends zero).
- **Fail-before each guard must reproduce:** (a) `detectControlTransitions` on a snapshot pair where
  `required-approvals` goes 2 → 0 currently yields nothing anywhere in the codebase — the test fails
  before step 6 because no such function exists and `detectRegression` returns `[]` for that input;
  (b) `pack.test.ts` asserting `items[0].environmentAsOf.source === "ledger"` fails before step 7
  because the field does not exist and the environment is the latest scan; (c) the seal test asserting
  `chainOk === false` after deleting one row's digest fails before step 1.
- Structural guards: `wire-safe-dates.test.ts` gains the two new row types (Director lands the lines);
  `id-routes-gated.test.ts` untouched (no `[id]` route); doc-sync satisfied by the three docs above.
- UAT: re-run **Dana**'s M1 briefing/fleet journey (the digest gains a section) and **Tomáš**'s
  evaluation journey against the evidence pack (as-of columns, coverage line, verify endpoint).

## Gate + done criteria

Ship-loop order: `npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks
(300 `.tsx` / 200 `src/features/**`) → e2e (Governance tab moved). Done when: a control flip observed
by webhook appears on the timeline with its actor within one delivery; a pack exported over a window
with ledger coverage reports `environmentAsOf.source === "ledger"` for the covered rows and labels the
rest; `GET /api/audit/verify` returns `chainOk: true` on an untouched ledger and `false` after a row
is deleted; an `unmeasurable` transition produces an `AlertEvent` and **no** sink dispatch.

## Out of scope (explicitly)

- **#6 Signed maturity attestation (in-toto/DSSE) + verify CLI — deferred.** No published Ed25519 key,
  no DSSE envelope, no CLI (05#2 asked for both); the seal here is the secret-free half.
- **#7 AI Trust Center — concept-doc first.** Nothing here is published outside the org.
  **#2 Open benchmark corpus — concept-doc first.** No cross-org aggregation of control state.
- **#21 GitHub identity graph + scoped membership — deferred.** 02#1 listed `member`, `membership`,
  `team`, `organization` and `repository` events; **dropped here** — they are identity-graph events,
  not control-state events, and ingesting them would pre-empt #21's model. Also dropped:
  `code_scanning_alert` / `secret_scanning_alert` (they need new App permissions; `known-vulnerabilities`
  stays a scan/probe-sourced control until then).
- **#5 Gate-as-code — concept-doc first**, and **#8 Agent-admission compiler (W4-O)**: this lane adds
  no `GateFailure` code and no `GatePolicy` field. W4-O reads `controlStateAt` as observed state.
- **#16 Doctor per-check ledger (W1-A)**: `ConformanceReport`/`ConformanceFinding` are W1-A's tables;
  this lane only exports the alert kind they dispatch through.
- **#10 Two-speed fleet queue (W3-L)**: `ScanJob`, the cron rewrite and the probe runner itself.
- **#29 Score-input ledger**, **#31 Signed tenant history bundle**: no re-score inputs, no bundle
  export/import. SARIF and OSCAL exporters (05#2 item 6) are deferred with #6/#7 — the control
  catalogue must stabilise before an OSCAL mapping is worth asserting.
