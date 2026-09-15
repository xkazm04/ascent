# 27 — Remediation economics: cost per verified dimension point, per model, per lane

size L · effort 6 / impact 8 / risk 4 · gate **contract** · lane **W2-G** (built FIRST in the lane, before #25 and #26) · wave 2

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/lib/local/agent.ts` — parse the whole `claude -p --output-format json` envelope; widen `AgentRunResult`.
- `src/lib/local/agent.test.ts` — envelope-parsing table (pure, no spawn).
- `src/lib/local/loop-lane.ts` — pass the run's model down; record cost/usage on the lane; call #11's `meter()`.
- `src/lib/local/loop-engine.ts` — `modelPolicy`, per-arm lane fan-out, model on `retryLane`.
- `src/lib/local/drive.ts` — consult the price list when choosing the next run's model.
- `src/lib/local/{drive,loop-engine}.test.ts`, `src/lib/local/loop-lane.release.test.ts` — extend.
- `src/lib/db/loop-runs-types.ts` (record fields, `LaneRow`/`RunRow`, the two `to*Record`),
  `loop-runs-write.ts` (`LoopLanePatch` cost fields, `CreateLoopRunInput.modelPolicy`),
  `loop-runs-read.ts` (select the columns, `economics` on the detail, `getOrgPriceList`),
  `loop-runs.ts` (barrel, lane-owned — re-export).
- `src/app/api/org/loop/route.ts` — accept `model` / `modelPolicy` on `start`; return `prices` on GET.
- Cockpit: `loopTypes.ts` (re-export wire types), `LaneRail.tsx` (cost chip), `CockpitOutcomeLedger.tsx`
  (¢/point on the outcome row), `CockpitSetup.tsx` (model + `single | ab` picker), `LiveCockpit.tsx`
  (mount the panel), `index.ts`.
- `docs/features/org-planning/live.md` — economics section; **delete the "agent model rides `CLAUDE_MODEL`" known gap**.
- `local-mode/README.md` — the cost/model paragraph (one source per lane, declared).

**Files to create**
- `src/lib/local/lane-economics.ts` + `.test.ts` — the pure fold (`laneEconomics`, `priceList`, `pickDriveModel`).
- `src/lib/local/agent-envelope.ts` — pure parser (`parseAgentEnvelope`), so `agent.ts` stays a spawn wrapper
  and the parsing is testable without a subprocess.
- `src/features/inflight/live/cockpit/PriceListPanel.tsx` + `.dom.test.tsx` — the per-org price list.

**Prisma models/columns needed (landed by the wave-2 schema pass, NOT by this lane)**
```prisma
model LoopRunLane {
  // … existing …
  model           String?  // the model this lane actually ran ("sonnet", …). Null = pre-#27 row.
  costSource      String?  // "envelope" — the ONE declared cost source. Never summed with OTLP.
  costMicros      Int?     // millionths of a USD cent, from total_cost_usd. Null = unknown ≠ 0.
  inputTokens     Int?
  outputTokens    Int?
  cacheReadTokens Int?
  turns           Int?
  agentDurationMs Int?
  agentSessionId  String?  // the CLI's own session id when present — A JOIN KEY ONLY.
  abPairKey       String?  // joins the two arms of one `ab` pair; null on a `single` run.
}

model LoopRun {
  // … existing …
  modelPolicy String  @default("single") // single | ab
  modelsJson  String  @default("[]")     // JSON string[]: ["sonnet"] or the two ab arms, in order
}
```
`init.sql` gets the same columns nullable (PGlite reconcile self-repairs); no jsonb — `modelsJson` is TEXT.
`costMicros` is an integer of **micro-cents** (`round(total_cost_usd * 100 * 1_000_000)`) so a 0.4¢ session is not
rounded to zero; every display divides. `agentSessionId` is stored for correlation only and is **never** used to
add an `AgentSession` row's `costCents` to a lane's cost (see the one-source rule below).

**Director-owned lines requested at merge**
- `scripts/docs/feature-doc-map.json`, the `live.md` entry: add `src/lib/local/{agent,agent-envelope,
  lane-economics,drive}.ts` to `sourceGlobs` — none of the four is matched today, so the doc-sync nag is off
  for the whole agent seam.
- `context-map.json`, "Local Autopilot & Loop Engine" → `filePaths`: `agent-envelope.ts`, `lane-economics.ts`
  (+ their tests).
- `src/lib/db/index.ts`: **no new export** — everything ships through the `@/lib/db/loop-runs` barrel this lane
  owns. `wire-safe-dates.test.ts`: **no entry needed** — every new field is a number or string, and
  `LoopLaneRecord` already declares its timestamps as `string`.

**MUST NOT TOUCH**
`prisma/schema.prisma` · `prisma/init.sql` · `src/lib/db/index.ts` · `context-map.json` ·
`scripts/docs/feature-doc-map.json` · `src/lib/mcp/**` (W2-K) · `src/lib/llm/**` and `src/lib/db/usage*.ts`
(W1-C owns the meter and its store) · `src/lib/org/followups.ts` and the lease/executor columns (W4-N) ·
`src/lib/report/compare.ts` (W2-J1 extracts its set logic — this lane only *reads* `ScanDiff`).

**Handoffs to other lanes**
- **→ W1-C (#11, unified LLM meter).** This lane *calls* `meter()` and does not define it. Requirements on
  #11's contract: (a) a caller-supplied idempotency key so a retried write cannot double-count — this lane
  passes `loop-lane:<laneId>`; (b) a cost input taken from the caller rather than re-derived from a price
  table, because the CLI envelope's `total_cost_usd` is authoritative for a subscription-auth session; (c) a
  kind discriminator for "local remediation agent", distinct from assessment traffic. If #11's landed signature
  differs, W2-G adapts at the call site — it does not fork the contract. `/usage` must attribute this spend to
  `costSource = "envelope"` and must never add an `AgentSession` (OTLP) row for the same window on top of it.

---

## Goal and the Known gap it deletes

Every lane already has an independent verifier (the worktree rescan plus the movement-gated close rule) and a
before/after scan pair, but the agent's cost, tokens, turns and model are thrown away at the process boundary;
capture them and Ascent can state **what a verified maturity point costs, by model and by dimension**, and let
the drive spend on evidence instead of on a default. *Competitive angle: AI-ROI vendors have the spend and no
independent verifier of outcome, remediation vendors have the outcome and no neutral scorer — cents per
verified maturity point is arithmetic only a product holding both halves can do.*

Deletes from `docs/features/org-planning/live.md` §Known gaps: **"The agent model rides `CLAUDE_MODEL`
(default `sonnet`); no per-run model picker."**

## Premises — verified against the tree (2026-08-29)

| Dossier claim | Verdict |
|---|---|
| `runClaudeAgent` keeps only `.result`; `total_cost_usd`/`usage`/`num_turns`/`duration_ms` discarded | **true** — the `child.on("close")` handler types the envelope as `{result?, is_error?, subtype?}` only. |
| The model is a global `CLAUDE_MODEL` | **half true, and it changes step 1.** `runClaudeAgent(opts)` already takes `opts.model` (env is only the *fallback*); no caller passes it — `loop-lane.ts` calls `deps.runAgent({ cwd, prompt })`. So this is threading a value, not building a parameter. |
| `LoopRunLane` carries `commits`/`closedIdsJson`/the scan pair, no cost; `listLoopRuns` folds `lift` from that pair | **true** — one batched scan read per page, `null` when no lane has both ends. |
| `AgentSession` holds OTLP tokens/cost with no lane link | **true** — keyed `@@unique([orgId, source, sessionId])`, no run/lane column. |
| `nextDriveStep` picks the next run's repos | **true**, and it is a *pure, heavily tested* three-branch policy. Widening its signature would churn its guards for no gain, so the model choice lands as a **separate pure function** (`pickDriveModel`) called beside it — a deliberate deviation from the finding's Flow. |

## Behaviour

### The one-source rule (the risk the finding named)

A lane's cost has exactly **one** declared source, stamped on the row as `costSource`; today the only value is
`"envelope"`, the `total_cost_usd` the CLI reports for that session. `AgentSession` rows are the OTLP export of
*Claude Code sessions a developer ran* — a different population by a different path — so they are never added
to lane cost, never averaged with it and never used to fill a null. `agentSessionId` lets the two be *joined
for inspection*, not summed. A guard test asserts no read path adds them.

### Envelope parsing (`agent-envelope.ts`, pure)

```ts
export interface AgentEnvelope {
  ok: boolean;
  summary: string;           // .result, or the failure reason (unchanged behaviour)
  model: string | null;
  costMicros: number | null; // round(total_cost_usd * 1e8); null when absent or not finite
  inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null;
  turns: number | null; durationMs: number | null; sessionId: string | null;
}
export function parseAgentEnvelope(raw: string, opts: { fallbackModel: string; exitCode: number | null; stderr: string }): AgentEnvelope;
```
Honest-null throughout: a field the envelope omits, or that is not a finite number, is `null` — **never 0**. A
*failed* session still reports whatever cost the envelope carries (a failure that burned $2 is the most
important row in the ledger). `model` prefers the envelope's own report, falling back to the model we asked for.
`AgentRunResult` gains the same optional fields and `{ ok, summary }` keeps its meaning, so `autopilot.ts` and
`loop-lane.ts` compile unchanged.

### Recording (`loop-lane.ts`)

`LaneRunInput` gains `model?: string | null` and `abPairKey?: string | null`. Immediately after
`deps.runAgent(...)` returns, one `updateLane` writes `model`, `costSource: "envelope"`, `costMicros`, the
three token counts, `turns`, `agentDurationMs`, `agentSessionId` — folded into the write that already records
`commits`, so a lane that dies later still has its cost. Then `meter()` (#11) is called with idempotency key
`loop-lane:<laneId>`; a failing `meter()` is logged to the lane log and never fails the lane. `runLane` logs
`Agent: <model> · <turns> turns · <cost> · <duration>`, with `cost unknown` when the envelope carried none —
never `$0.00`.

### The fold (`lane-economics.ts`, pure — no DB, no React)

```ts
export interface LaneEconomics {
  laneId: string; repo: string; model: string | null; costMicros: number | null;
  /** Sum of POSITIVE dim deltas from the lane's own diffScans, both ends present. Null when unmeasured. */
  verifiedPoints: number | null;
  /** costMicros / verifiedPoints, in micro-cents. Null when either side is null OR verifiedPoints === 0. */
  microsPerVerifiedPoint: number | null;
  byDim: { dimId: string; delta: number }[];   // per-dimension positive deltas → the price list's rows
  unproductive: boolean;                       // spent, moved nothing measurable — counted, never hidden
}
export function laneEconomics(outcome: LoopLaneOutcome): LaneEconomics;

export interface PriceRow { model: string; dimId: string; n: number; microsPerPoint: number; totalMicros: number; totalPoints: number; }
export interface RemediationPriceList { rows: PriceRow[]; unproductiveMicros: number; unpricedLanes: number; generatedAt: string; }
export function priceList(lanes: readonly LaneEconomics[]): RemediationPriceList;

export function pickDriveModel(prices: RemediationPriceList | null, dimIds: readonly string[], opts?: { minN?: number }): string | null;
```

The arithmetic, stated so it cannot drift:
- **A verified point** is a positive `DimensionDiff.delta` on a lane whose `before` *and* `after` scans both
  exist. `diffScans` already refuses to invent a delta when either end is missing; this fold never widens that.
- Lane cost is attributed to moved dimensions **in proportion to their positive deltas**. Negative and zero
  deltas are not netted off — a model that broke D5 while fixing D3 gets no discount.
- A lane that spent and moved nothing does **not** vanish into the working lanes' denominator: it lands in
  `unproductiveMicros`, shown as its own line ("spent without measured movement"). That is the honest half.
- `microsPerPoint` for a `(model, dimId)` cell is `totalMicros / totalPoints` across lanes, `n` = contributing
  lanes. A price is never shipped without its `n`.
- `pickDriveModel` returns `null` unless every named dimension has a cell at `n >= minN` (default **3**) for at
  least two models — with one model measured there is nothing to choose — and `null` means "keep the configured
  default". No intervals, no noise bands: that is deck item **#30 (deferred)**.

### Reads

`getLoopRunDetail` → `LoopRunDetail.economics: LaneEconomics[]` (one per outcome, same order).
`listLoopRuns` → `LoopRunSummary.costMicros: number | null` (summed over lanes that have one, null when none do
— "not measured", not zero), folded in the *same* batched query that already folds `lift`.
`getOrgPriceList(orgSlug, opts?: { since?: Date; limit?: number }): Promise<RemediationPriceList | null>` in
`loop-runs-read.ts` reads the org's lanes that have a `model` and a scan pair, resolves each pair through the
existing `getScanComparison`/`diffScans` path (never a second diff implementation), folds with `priceList`, and
is bounded to the most recent 200 lanes.

### Routes

No new routes, so no new `[id]` gate surface. `GET /api/org/loop?org=…` — unchanged gates (`selfHostGuard` →
`requireOrgAccess`); payload gains `prices: RemediationPriceList | null`. `POST /api/org/loop
{ action: "start", …, model?, modelPolicy?: "single" | "ab", models?: string[] }` — unchanged gates
(`selfHostGuard` → `dbGuard` → `requireOrgRole(org, "owner")`); `model`/`models[]` are validated against the
same `/^[A-Za-z0-9][A-Za-z0-9._:-]*$/` token rule `agent.ts` enforces (shell:true re-parses argv on Windows),
so an invalid token is a 400 and never a spawn; `ab` requires exactly two distinct models and doubles the lane
count, refused with a reason past the concurrency budget. `POST { action: "retry", laneId }` — the retried lane
inherits the original's `model`/`abPairKey`; the `orgIdForSlug` tenancy re-check is unchanged.

### A/B model policy

`modelPolicy: "ab"` fans **the same curated batch** out to two lanes per repo per cycle — two worktrees, two
branches, two models — sharing one `abPairKey`. Each lane rescans **its own** worktree, so the same guardbanded
scorer adjudicates both arms and neither arm grades the other. The batch is claimed once, by the arm that
dispatches first; the second arm carries the curated ids without re-claiming (a claim is a dispatch record, not
a lock), and the existing `releaseClaims` path covers both. The cockpit renders the pair as two rails under one
repo heading, both costs and both lifts.

### UI

All on `?tab=live` → cockpit. **LaneRail**: a cost chip in the existing counters line — `sonnet · 4 turns ·
$0.62` in `font-mono text-xs tabular-nums text-slate-500`, the literal `cost unknown` when null; no new colour,
cost is not a verdict. **CockpitOutcomeLedger** `OutcomeRow`: a `¢/point` figure beside the existing
`before → after` + `fmtDelta(lift)` (`deltaHex` untouched — a ratio is not signed movement), `not measured`
when null, reusing the row's own absent-value idiom. **PriceListPanel** (new, under `CockpitHistory` in
`LiveCockpit`): `Kicker tone="muted"` "Remediation price list", model × dimension → ¢/point with `n=` on every
cell, `dimShort` labels, a footer for `unproductiveMicros`/`unpricedLanes`, and an empty state ("a price needs
a lane with both scan ends and a recorded cost") rather than zeros. Brand: `bg-ink`, `border-divider`,
`text-slate-*`, `focus-ring`; no new hexes, `LEVEL_HEX`/`scoreHex` untouched. `LiveCockpit.tsx` is at 195 LOC,
so the panel is a sibling and the mount is one line — extract a `CockpitLedgerColumn.tsx` if it would pass 200.

### Self-hosted, plans, privacy, audit

The surface is already behind `selfHosted()` **and** `autopilotEnabled()` (floored inside its own definition —
untouched); managed cloud keeps its 404 and has no price list. **No plan gate** — `selfHosted()` turns gates
off, so one here would be dead code that reads as a limit. **Privacy floor:** the price list is org-scoped and
never aggregated across orgs, so there is no public surface for `CHAMPION_MIN_POP` to protect — a cross-tenant
"what does a D3 point cost" figure is a separate product decision, not a free extension here. **Audit:** no new
rows; cost is *observed*, not authorized or spent through Ascent. The one decision worth a record is the
drive's model choice, logged into the lane log with its basis (`n` and the prices compared).
**Retention/erase:** the columns live on `LoopRunLane` and die with the run; the price list is derived at read
time and stores nothing of its own.

## Build order

1. **`agent-envelope.ts` + tests, then `agent.ts` uses it.** Behaviour-preserving on `{ok, summary}`;
   `AgentRunResult` widens with optional fields. Gateable alone.
2. **Schema-pass columns arrive** (wave-2 pass). `toLaneRecord`/`toRunRecord` map them, every absent column
   degrading to `null`; `LoopLanePatch`/`CreateLoopRunInput` accept them; barrel re-exports.
3. **`loop-lane.ts` records.** Thread `model` in, write the cost patch, log the line. No meter yet — green on
   its own even if W1-C has not merged.
4. **`lane-economics.ts` + tests.** Pure, table-driven, no DB; the arithmetic above is pinned here first.
5. **Wire the reads:** `getLoopRunDetail.economics`, `LoopRunSummary.costMicros`, `getOrgPriceList`, `prices`
   on the GET route.
6. **`modelPolicy`/`models` in `startLoopRun`/`retryLane` and the POST route** — `ab` fan-out, token validation.
7. **Cockpit:** LaneRail chip → OutcomeLedger ratio → PriceListPanel + setup picker.
8. **`meter()` call** in `loop-lane.ts` against W1-C's landed signature, plus the one-source guard test.
9. **Docs:** `live.md` economics section + the known-gap deletion; `local-mode/README.md` paragraph.

## Tests

- `src/lib/local/agent.test.ts` (extend) — envelope table: full envelope; envelope with `usage` absent;
  `total_cost_usd: 0` (→ `0`, a real zero the CLI reported) vs field absent (→ `null`); `is_error: true` with a
  cost (cost survives the failure); non-JSON stdout (→ all nulls, `ok: false`). **Fail-before:** every
  numeric expectation is `undefined` today because nothing is parsed.
- `src/lib/local/lane-economics.test.ts` (new) — proportional attribution across two moved dimensions;
  negative delta not netted; lane with cost and no movement → `unproductive`, excluded from every
  `microsPerPoint` denominator and present in `unproductiveMicros`; `verifiedPoints: null` when either scan end
  is missing; `priceList` `n` counting; `pickDriveModel` returns `null` at `n < minN` and with a single
  measured model. **Fail-before:** module does not exist.
- A one-source static guard (its own describe block in the file above): no read under `src/lib/local/**` or in
  `loop-runs-read.ts` adds an `agentSession` cost to a lane cost — a source-text assertion in the spirit of
  `id-routes-gated.test.ts`. **Fail-before:** add a `+ session.costCents` line locally and watch it go red.
- `loop-lane.release.test.ts` (extend) — a failed agent still writes `costMicros` and still releases its
  claims; a failing `meter()` call does not fail the lane.
- `loop-engine.test.ts` (extend) — `ab` yields two lanes per repo per cycle, one `abPairKey`, distinct models;
  an invalid model token never reaches the spawn seam. `drive.test.ts` (extend) — `nextDriveStep`'s guards
  unchanged (signature untouched); `pickDriveModel` consulted beside it.
- `src/app/api/org/loop/route.test.ts` (extend) — `model`/`modelPolicy` validation 400s; `prices` on GET for a
  member; still 404 off self-hosted.
- `PriceListPanel.dom.test.tsx` (new) — `n` beside every price, empty state instead of a zero, `cost unknown`
  for a null. `CockpitOutcome.dom.test.tsx` (extend) — `not measured` where the ratio is null.
- Structural guards: `wire-safe-dates` and `id-routes-gated` **not touched** (no new `Date` on a client type,
  no new `[id]` route). Doc-sync satisfied by `live.md`.
- **UAT journey to re-run: Sam** (staff engineer) — arm a two-repo run, watch the lanes, read the outcome
  ledger and the price list; the claim under test is "the cockpit states cost per verified point by model".
  Dana's briefing journey (M1) is unaffected — `briefing.ts` is #26's, untouched here.

## Gate + done criteria

`npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks (300 `.tsx` /
**200 under `src/features/**`** — the two new cockpit files and every edited one) → e2e for the cockpit.
Done when: a completed lane's row carries a model and a cost; the ledger prints ¢/point or an honest
"not measured"; the price list refuses to print a cell without its `n`; a lane that spent and moved nothing is
visible as spend, not absent; and no read path anywhere sums an `AgentSession` cost with a lane cost.

## Out of scope (explicitly)

- **#28 Durable scheduled drives** (deferred) — the drive's *model* choice becomes evidence-led; drives do not
  become scheduled, durable or programme-bound. **#30 Reproducibility certificate / per-model noise bands**
  (deferred) — the price list ships `n` and nothing else: no intervals, no variance claims.
- **#24 Billing account above the tenant**, **#12 purchasable artifacts** (deferred) — nothing here charges,
  budgets or entitles; cost is observed on a self-hosted box. **#29 Score-input ledger** (deferred) — the
  verifier stays the persisted rescan, no re-score from inputs. **#6 Signed maturity attestation**, **#37
  data-bound deck diagrams** (deferred) — no signed or public economics artifact; the price list is org-private.
- **#25 Org-brief for every lane** and **#26 One improvement ledger** — same lane, same builder, *later*. #27
  adds no `briefJson`, lane brief, playbook stamp, `ImprovementPr` row or PR route: cost columns and the fold,
  then stop.
- **#3 Agent-neutral work protocol** (W4-N) — `executor`/`claimedBy`/`leaseUntil` land in the wave-2 schema
  pass and stay unused here. **#11 Unified LLM meter** (W1-C) — this lane *calls* `meter()`; it does not
  define, store, price or surface usage events, and edits nothing under `src/lib/llm/**` or `db/usage*.ts`.
