# 11 — Unified LLM meter: every inference lane priced, team/segment showback

size XL · effort 8 / impact 9 / risk 5 · gate **policy** · lane **W1-C** · wave **1**

## Premise check (read the code first — three premises moved)

Verified against the tree at `42c7b12e`:

- **HELD.** `usage.ts`'s header still states "Scan rows are the authoritative metered unit";
  `getUsageSummary` prices only `prisma.scan.groupBy({ by: ["engineProvider","engineModel"] })`, and
  names neither `RepoTeam` nor `Segment`. `isMeteredScan` (`entitlement.ts`) and every
  `resolveScanCharge` caller are scan-only; `decideScanCharge` (`plans.ts`) has no lane parameter.
  `AthenaTurn.inputTokens/outputTokens/legs` are written by `appendTurn` and priced by nothing;
  `MemoryRunner.usage` (`consolidation-engine.ts`) is live-mutated and never persisted (its own
  comment says so); `briefing-narrative.ts`'s `requestNarrative()` POSTs to the Anthropic Messages
  API and discards the response's `usage` block entirely.
- **FALSE — "a single `meter()` chokepoint".** There are **two** metering seams today, not one, and
  both already emit `trackLlmCall`: `withTimeout()` in `src/lib/llm/text-meter.ts` (single-shot) and
  `runToolLoop()` in `src/lib/llm/tool-loop.ts` (multi-leg, one event per loop by design). `meter()`
  therefore rides beside `trackLlmCall` at **both** sites and nowhere else. A third path —
  `textRunnerFrom`'s `ownsTimeout` branch (claude-cli) — reports no usage at all and stays unmetered
  by construction; it gets a token-less event so the *call* is visible even when its cost is not.
- **FALSE — the `skill-tailor` lane.** No such surface exists (`skill-tailor` matches nothing under
  `src/`). Dropped from the lane vocabulary.
- **FALSE — "wire scan (mirror)".** A `UsageEvent` mirror of every Scan row would give the one lane
  that already has an authoritative ledger a second, drift-prone one, and would force this lane into
  `src/lib/db/scans-persist.ts` — a hot file three other items edit. **Dropped**: the `scan` lane is
  derived from `Scan` rows (as today) and UNIONed with `UsageEvent` for the lanes that had none.
- **PARTIALLY FALSE — "migrate briefing-narrative onto the seam".** `transports.ts` has no
  first-party Anthropic transport; routing the narrative through the seam would silently change which
  credential and vendor an operator's briefing bills to. That is BACKLOG **C3**'s open design
  question, not a wiring task — so this lane meters the existing egress in place.
- **HELD, and load-bearing.** `legKind` is REQUIRED on `TextRunnerOptions` with no default
  (`src/lib/llm/leg.ts`), and `LEG_TEMPERATURE_ENV` / `LEG_TEMPERATURE_DEFAULT`
  (`src/lib/llm/config.ts`) **deliberately omit `scan` and `memory`** so those legs keep resolving
  through `LLM_TEMPERATURE` and `src/lib/cache.ts` sees the number it always saw (D29). **This lane
  adds no row to either table**, including for the new `briefing` leg kind.

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**

- `src/lib/llm/leg.ts` — add `"briefing"` to `LlmLegKind`; add `MeterContext` + optional
  `meter?: MeterContext` on `TextRunnerOptions` and `ToolLoopOptions`' shared vocabulary.
- `src/lib/llm/text-meter.ts` — call `meter()` beside `trackLlmCall` in `withTimeout`'s success and
  failure paths; emit a token-less event on the `ownsTimeout` branch of `textRunnerFrom`.
- `src/lib/llm/tool-loop.ts` — call `meter()` beside the single `trackLlmCall` (loop-level, one
  event per loop; `orgSlug` is already on `ToolLoopOptions`).
- `src/lib/llm/text-org.ts` — default `opts.meter.orgSlug` to the resolver's `orgSlug` (so the BYOM
  path attributes without every caller repeating itself) and stamp `byom: true` on it.
- `src/lib/llm/config.ts` — `priceMicros()` over the existing `priceForModel`, plus any `claude-*`
  `MODEL_PRICES` row `BRIEFING_NARRATIVE_MODEL`'s default lacks. No leg-temperature-table change.
- `src/lib/db/usage.ts` — `byLane` / `byTeam` on `UsageSummary`; UNION the `scan` lane (from `Scan`)
  with the other lanes (from `UsageEvent`); `estimateLlmCostFromTable` unchanged.
- `src/lib/memory/consolidation-engine.ts` — `resolveMemoryRunner(orgSlug?: string)` passing
  `meter: { orgSlug, lane: "memory" }`; plus its two callers `src/app/api/org/memory/check/route.ts`
  and `.../reflect/route.ts` (one argument each, from the route's already-gated slug).
- `src/lib/org/briefing-narrative.ts` — parse `data.usage.{input_tokens,output_tokens}` and call
  `meter()` directly (lane `briefing`). Transport unchanged.
- `src/lib/plans.ts` — `laneAllowances?: Partial<Record<UsageLane, number | null>>` on
  `PlanFeature` (every tier ships `{}` today); `decideCharge(lane, opts)` /
  `resolveLaneCharge(lane, opts)` around the existing pure `decideScanCharge`.
- `src/lib/entitlement.ts` — `isMeteredLane(lane, orgSlug, mock)` generalising `isMeteredScan`, which
  stays and delegates so every scan call site is byte-identical.
- `src/app/api/usage/route.ts` — `?format=csv` gains `lane` + `team` columns; `?view=showback` emits
  the per-lane × per-team CSV. `src/app/usage/{page,usageDashboard}.tsx` render the two new panels.
- `src/lib/db/kpi-metrics.ts` — `avgLlmCostPerActiveOrg(windowDays)` across lanes, beside
  `avgLlmCostPerScan`. `docs/features/billing/usage.md` — metered-lane section; delete the gap.

**Files to create**

- `src/lib/llm/meter.ts` — the chokepoint. Pure lane mapping + cost math; the DB post is a lazy
  `await import("@/lib/db/usage-events")` so the seam never statically pulls Prisma across a client
  boundary (`build-not-in-gate`).
- `src/lib/db/usage-events.ts` — `recordUsageEvent()` (best-effort writer) + `laneTotals()` /
  `teamTotals()` readers. `src/app/usage/usageLanePanels.tsx` — server panels (no `"use client"`).
- Tests: `src/lib/llm/meter.test.ts`, `src/lib/db/usage-events.test.ts`.

**Prisma models/columns needed (landed by the wave-1 schema pass, not by this lane)**

```prisma
// Every model call this deployment served, one row per metered leg (or per tool loop). Standalone
// (no Organization relation — additive-only, mirroring QuotaEvent), TEXT columns only, no jsonb.
model UsageEvent {
  id               String   @id @default(uuid())
  orgId            String
  lane             String   // scan | athena | memory | briefing | local
  legKind          String?  // the raw LlmLegKind when one existed; null for lanes off the seam
  refId            String?  // Scan.id / LoopRunLane.id when the caller has one; null is honest
  repoId           String?
  repoFullName     String?
  teamKey          String?  // normalized "@org/team" from RepoTeam.slug; null = org-wide work
  provider         String
  model            String
  byom             Boolean? // null = unknown provenance = Ascent's account (same rule as Scan.engineByom)
  inputTokens      Int?     // NULL = the provider reported nothing. Never write 0.
  outputTokens     Int?
  cacheReadTokens  Int?
  cacheWriteTokens Int?
  costMicros       Int?     // USD micros; NULL when unpriced, BYOM, or a zero-cost provider
  status           String   @default("success") // success | error | timeout
  latencyMs        Int?
  idemKey          String?  @unique // "<lane>:<refId>" when a caller owns a stable id; else null
  createdAt        DateTime @default(now())

  @@index([orgId, createdAt])
  @@index([orgId, lane, createdAt])
  @@index([orgId, teamKey, createdAt])
}
```

Also: `wire-safe-dates.test.ts` gains `UsageEventRow` (`createdAt` is `string`); `prisma/init.sql`
gains the table + three indexes.

**Director-owned lines requested at merge**

- `src/lib/db/index.ts`: `export { recordUsageEvent, laneTotals, teamTotals, type UsageEventRow, type LaneUsage, type TeamUsage } from "@/lib/db/usage-events";`
- `scripts/docs/feature-doc-map.json`: widen the `billing/usage.md` glob `src/lib/db/usage.ts` →
  `src/lib/db/usage*.ts`, and add `src/lib/llm/meter.ts` to the same entry (it is also matched by
  `src/lib/llm/**` → `llm-providers.md`; both docs are then nagged, which is correct).
- `context-map.json`: add `src/lib/db/usage-events.ts`, `src/lib/llm/meter.ts`,
  `src/app/usage/usageLanePanels.tsx` to the **Usage Metering** context's `filePaths`.

**MUST NOT TOUCH**

`prisma/schema.prisma` · `prisma/init.sql` · `src/lib/db/index.ts` · `context-map.json` ·
`scripts/docs/feature-doc-map.json` · **`src/lib/local/agent.ts` and all of `src/lib/local/**`**
(W2-G) · `src/lib/db/retention.ts` (W1-F) · `src/lib/db/scans-persist.ts` (#13/#33) ·
`src/lib/memory/{scan-feed,memory-kinds}.ts` (W1-B) · `src/lib/memory/recall.ts` (W2-K) ·
`src/lib/db/credits.ts` (charge behaviour is unchanged; no reason to open it).

**Handoffs to other lanes**

1. **W2-G (loop lane, #27):** `meter({ lane: "local", orgSlug, refId: loopRunLaneId, provider:
   "claude-cli", model, inputTokens: null, outputTokens: null })` from wherever `runClaudeAgent`
   returns. This lane ships the function and the `local` lane value; G makes the call. G's own
   `LoopRunLane.costCents` stays G's — the meter records the *call*, not the remediation envelope.
2. **W1-F (retention, #32):** add `UsageEvent` to the purge sweep, aged on
   `Organization.retentionAuditDays` (audit-shaped, not scan-shaped), and to the org-erase cascade.
   This lane must not open `retention.ts`.
3. **W2-K / W1-D:** none. `src/lib/athena/turn.ts` is **reserved but expected untouched** — Athena's
   two `runToolLoop` call sites (`src/app/api/athena/gate.ts`, `src/app/api/cron/athena/deps.ts`)
   already pass `orgSlug` and `legKind`, so the meter picks the lane up with no Athena edit at all.

## Goal and the Known gap it deletes

Give Ascent one ledger for every model call it serves — scan, Athena, memory, briefing, local agent
— priced per model and attributable to a repo team, so an operator can answer "what does the
companion cost this org, and which team's work drives it" before any packaging decision is made.
Competitive angle: DX/Jellyfish/LinearB show *vendor* AI spend per team but have no governance-tool
cost to reconcile against, and Factory bills a flat seat that cannot show what a lane costs.

Deletes from `docs/features/billing/usage.md` "Known gaps": **"Single-org attribution:
multi-org installations don't yet attribute usage per-repo-owner."** — `byTeam` closes it. The
opening sentence ("the **billable unit** is one computed `Scan` row") stays true and is qualified:
the *billable* unit is still a Scan; the *metered* unit is now a leg.

## Behaviour

**Lane vocabulary (pure, `src/lib/llm/meter.ts`).**

```ts
export type UsageLane = "scan" | "athena" | "memory" | "briefing" | "local";
export function laneForLegKind(k: LlmLegKind): UsageLane; // athena_turn|athena_cycle → "athena"
export interface MeterContext { orgSlug: string | null; lane?: UsageLane; refId?: string | null;
  repoId?: string | null; repoFullName?: string | null; teamKey?: string | null; byom?: boolean }
export interface MeterInput extends MeterContext { legKind?: LlmLegKind; provider: ProviderName;
  model: string; usage?: TokenUsage; status: "success" | "error" | "timeout"; latencyMs?: number }
export function meter(input: MeterInput): void;          // fire-and-forget, never awaited, never throws
export function costMicrosFor(provider: string, model: string, usage: TokenUsage | undefined,
  byom: boolean | undefined): number | null;             // pure; null when unpriceable
```

`meter()` returns `void` and swallows everything (`void recordUsageEvent(...).catch(() => {})`), as
`recordQuotaEvent`/`bumpCounter` do — the finding's "could break" risk is a mis-wired meter throwing
inside a runner, and the only defence is that it structurally cannot. `orgSlug === null` writes
nothing: an unattributable event is not worth a row.

**Honest nulls.** `inputTokens`/`outputTokens`/`costMicros` are `null` — never `0` — when the
provider reported nothing, when `byom === true`, or when `isZeroCostProvider(provider)` /
`priceForModel()` cannot price the model. A null means *unknown*; a `0` would be summed and averaged
downstream as a measurement. The UI surfaces null as "no estimate", the existing `costBasis` wording.

**Idempotency.** `idemKey = "<lane>:<refId>"` when a caller owns a stable id (`local` gets the
`LoopRunLane.id`), else null (NULLs are distinct under the unique index, the same rule
`Scan.dedupKey` relies on). A retried write collides on P2002 and is swallowed by the best-effort
guard — no double count, no thrown error.

**Reading (`src/lib/db/usage.ts`).**

```ts
export interface LaneUsage { lane: UsageLane; calls: number; inputTokens: number | null;
  outputTokens: number | null; estimatedCostUsd: number | null; unpricedCalls: number }
export interface TeamUsage { teamKey: string | null; label: string; calls: number;
  estimatedCostUsd: number | null }        // teamKey null → label "Org-wide (no repo)"
interface UsageSummary { …; byLane: LaneUsage[]; byTeam: TeamUsage[] }
```

`byLane[scan]` is computed from the existing `Scan` groupBy (no second ledger); the other lanes come
from `UsageEvent.groupBy({ by: ["lane"] })` over the same half-open UTC window
(`[since, tomorrow-UTC)`) the rest of the summary uses — the window bound is load-bearing and is not
re-derived. `unpricedCalls` is reported per lane so a $0 line can be read as "nothing to price"
rather than "free". `byTeam` joins `Scan → Repository → RepoTeam(isDefaultOwner: true)` for the scan
lane and reads `UsageEvent.teamKey` for the rest; rows with no team fall into the explicit
`Org-wide` bucket instead of being dropped.

**Routes.** `GET /api/usage` is unchanged in method and auth (`requireOrgRead`, the existing IDOR
guard, `boundUsageDays`). `?format=csv` gains `lane` and `team` columns; `?view=showback` returns
the lane × team matrix as CSV through the existing `csvTable` (so the formula-guard and quoting
rules are the shared ones). No new route, no new auth surface, no `[id]` route — the
`id-routes-gated` guard is untouched.

**UI.** Two server panels on `/usage` under the existing provider breakdown, in
`src/app/usage/usageLanePanels.tsx`: **Spend by lane** and **Spend by team**, both built from the
page's local `Bar`/`Stat` (`usagePanels.tsx`) over `@/components/ui` `Surface`/`Stat`, with the
per-lane accent following `providerMeta`'s shape. No new brand tokens, no `LEVEL_HEX`/`scoreHex`
(this is spend, not score). Under 300 LOC; not under `src/features/**`.

**Plan gates — no repricing.** `PlanFeature.laneAllowances` is optional and **every tier ships `{}`**,
so `decideCharge(lane, …)` returns `"unlimited"` for `lane !== "scan"` on every plan and delegates
verbatim to `decideScanCharge` for `"scan"`. Behaviour is byte-identical until a tier opts a lane in;
that opt-in is a pricing decision, explicitly not this lane's.

**Self-hosted.** The meter always writes (it is observability, and a self-hoster wants their own
lane costs most of all). Every *gate* stays off through the existing `selfHosted()` short-circuits in
`isUnlimitedPlan` / `scanAllowance` / `isMeteredScan`; `isMeteredLane` delegates to the same ones, so
there is no second production floor to keep in sync and no new escape-hatch flag in this lane.

**Privacy.** `teamKey` is a CODEOWNERS *team* slug, never a person — no contributor login, email or
individual attribution enters `UsageEvent`, so `CHAMPION_MIN_POP` does not apply and must not be
weakened to make a team panel render. `byTeam` is omitted entirely for `PUBLIC_ORG` (the shared
funnel has no teams and its summary is anonymously readable). No prompt or response text is stored —
token counts, model id and status only.

**Audit.** Spend-shaped, so `UsageEvent` *is* the audit row; no `AuditLog` entry per metered call
(one row per leg would drown the trail). A future plan opting a lane in audits at the denial.

## Build order

1. **Pure core, no callers.** `meter.ts` with `laneForLegKind`, `costMicrosFor`, `MeterContext` and a
   `meter()` whose sink is injectable; `leg.ts` gains `"briefing"` and `meter?: MeterContext`.
2. **Writer.** `usage-events.ts` `recordUsageEvent()` on `bumpCounter`'s guard-and-swallow skeleton;
   wire `meter()`'s sink to it via the lazy import.
3. **Seam wiring.** `text-meter.ts` (both paths + the `ownsTimeout` token-less event),
   `tool-loop.ts`, `text-org.ts` (`orgSlug` default, `byom: true`). Athena is metered from this step
   with no Athena edit.
4. **Memory + briefing.** `resolveMemoryRunner(orgSlug?)` and its two route callers; the briefing
   narrative's `usage` parse + direct `meter()` call.
5. **Read side.** `byLane` / `byTeam`, UNIONing `Scan` with `UsageEvent` over the shared window.
6. **Surfaces.** `/usage` lane + team panels; the CSV columns and `?view=showback`.
7. **Plans + entitlement.** `laneAllowances` (all `{}`), `decideCharge`/`resolveLaneCharge`,
   `isMeteredLane` delegating; `isMeteredScan` retained verbatim.
8. **KPI + doc.** `avgLlmCostPerActiveOrg` in `kpi-metrics.ts`; `usage.md`'s metered-lane section and
   the deleted gap.

Each step is independently gateable; 1–2 and 7 change no observable behaviour on their own.

## Tests

- **New** `src/lib/llm/meter.test.ts` — `laneForLegKind` folds both Athena kinds to `athena`;
  `costMicrosFor` returns **null** (never 0) for BYOM, for a zero-cost provider, and for an unpriced
  model id; `meter()` with a throwing sink resolves and does not reject. *Fail-before:* a `meter()`
  that returns the rejected promise, or a `?? 0` in the cost path, fails these.
- **New** `src/lib/db/usage-events.test.ts` (shaped like `quota-events.test.ts`) — no-op when
  `isDbConfigured()` is false; a P2002 on `idemKey` is swallowed; `laneTotals` buckets by lane over
  the half-open window and reports `unpricedCalls`.
- **Extend** `src/lib/db/usage.test.ts` — `byLane[scan]` equals the existing Scan-derived totals
  (proving no double count from the UNION); `byTeam` puts a team-less event in the `Org-wide` bucket
  rather than dropping it. *Fail-before:* an inner join on `RepoTeam` drops it and fails.
- **Extend** `src/lib/llm/text.test.ts`, `src/lib/llm/tool-loop.test.ts` — one event per single-shot
  call and exactly **one** per tool loop (not one per leg); a failed call still meters with
  `status: "error"`. *Fail-before:* metering inside the leg loop double-counts.
- **Extend** `src/lib/plans.test.ts` — `decideCharge("athena", …)` is `"unlimited"` on every tier
  under today's `{}` allowances, and `decideCharge("scan", …)` matches `decideScanCharge` across the
  existing table. **Extend** `src/app/api/usage/route.test.ts` — the CSV header gains `lane`/`team`;
  `?view=showback` on `PUBLIC_ORG` emits no team column; the IDOR guard is unchanged.
- **Structural guards:** `src/lib/db/wire-safe-dates.test.ts` (add `UsageEventRow` — `createdAt` is
  `string`); `src/app/api/org/id-routes-gated.test.ts` untouched (no `[id]` route added);
  `scripts/docs/__tests__/check-doc-sync.test.mjs` must stay green after the doc-map glob widening.
- **UAT:** re-run **Tomáš** (unit economics: can he see what a lane costs?) and **Dana** (showback:
  which team drives the bill?). Sam is untouched; `M1` does not apply — `src/lib/org/briefing.ts` and
  the PDF are not in this write set.

## Gate + done criteria

`npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks. Done when: a
live Athena turn, a memory write-gate pass and a briefing narrative each produce exactly one
`UsageEvent`; `/usage` shows four non-zero lanes on a seeded org; the CSV round-trips lane + team;
and `decideCharge` diffs byte-identically against `decideScanCharge` on every existing plan fixture.

## Out of scope (explicitly)

- **#24 Billing account above the tenant** (deferred) — pooled credits, sponsored orgs, resellers.
  `UsageEvent.orgId` stays the only tenant key. **#12 Purchasable artifacts** (deferred).
- **#27 Remediation economics** (accepted, **W2-G**) — the loop lane's cost envelope, model policy
  and cockpit chips. This lane ships the `local` lane value and the `meter()` signature; G owns every
  line in `src/lib/local/**`.
- **#23 Agent behaviour ledger / OTLP** (concept-doc) — vendor-side agent telemetry is a different
  sensor; `UsageEvent` records only calls Ascent itself issued.
- **BACKLOG C3** — the briefing narrative's egress redesign. Metered here, not re-plumbed here.
- **Repricing of any kind.** No tier's allowance, price or capability changes; `laneAllowances` ships
  empty on every plan and `/pricing` is not touched.
- **Switching memory to the per-org BYOM resolver** (`resolveTextRunnerForOrg`) — that changes which
  vendor an org's memory passes bill to, a provider decision rather than a metering one.
