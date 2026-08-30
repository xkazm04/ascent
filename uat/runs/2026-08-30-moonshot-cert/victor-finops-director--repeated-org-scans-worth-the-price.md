# Victor (FinOps-minded Engineering Director) × repeated-org-scans-worth-the-price — L1 (moonshot-cert)

Run: 2026-08-30-moonshot-cert · pair #6 · L1 theoretical, code-grounded, no browser.
In-scope moonshot surfaces: **#11 unified meter (byLane/byTeam/showback)**, **#10 two-speed freshness + durable queue** (post-"Continue" removal), plus the **DANA-L1-003/B1 credit-banner recert**.

---

## 0. Denominator note (overlay maintenance, not an app finding)

My character sheet says **Team = 500 credits/mo**. The code says **Team = 150** (`src/lib/plans.ts:234`,
`includedCredits: 150`, repriced 2026-08-19 with the open-source transition; Free 20, Pro/"Starter" 50,
Custom unlimited). Per the standing rule I take the denominator from the code, not the sheet: I walked
as a Team org with a 150/mo allowance and a $10/mo subscription. **The character file's "500" is stale
and should be updated by run maintenance.**

## 1. Reachable surface set (computed before judging)

- `/usage` — page-gated by `resolveSignInState` + `canReadOrg` (`src/app/usage/page.tsx:43,63`). A
  signed-in member of my org reaches it; no admin role needed; the public funnel is anonymous-readable
  but drops credit/recon/team panels by design. **Every panel I judge below is reachable to me as a
  plain member.** No plan gate on the lane/team panels — the meter is observability, not entitlement
  (`docs`/`plans.ts:179` — `laneAllowances` `{}` on every tier).
- `GET /api/usage` — `requireOrgRead` (`src/app/api/usage/route.ts:84`); `?format=csv` (per-day),
  `?format=json`, `?view=showback` (lane+team CSV, `route.ts:99`).
- Repositories tab freshness cell — org dashboard, member-readable.
- Queue poll `GET /api/org/scan/queue` — `requireOrgAccess`, gate-then-constrain (`queue/route.ts:28-31`).
- Self-hosted note: `selfHosted()` turns every *gate* off but the meter **still writes**
  (spec §Self-hosted; `isUnlimitedPlan`/`scanAllowance` short-circuits in `plans.ts:335-345`). My walk
  is the cloud/Team posture.

## 2. Surface model (what the code actually builds, file:line)

**The meter (#11).** `src/lib/llm/meter.ts` — lane vocabulary `scan|athena|memory|briefing|local`
(`meter.ts:43`), `laneForLegKind` folds `athena_turn|athena_cycle→athena`, `lane_summary→local`
(`meter.ts:68-83`). `meter()` is void/fire-and-forget/swallowing (`meter.ts:214-261`); null-or-public
org writes nothing. Cost math `costMicrosFor` returns **null, never 0** for BYOM / zero-cost provider /
no usage / unpriced model (`meter.ts:189-208`). Producers, all verified by grep:
- scan+memory seams: `src/lib/llm/text-meter.ts:59,84,122,133` (both success/failure paths + the
  token-less `ownsTimeout` claude-cli event);
- athena: `src/lib/llm/tool-loop.ts:174` — **one event per loop**, not per leg;
- briefing: `src/lib/org/briefing-narrative.ts:301`;
- memory attribution: `resolveMemoryRunner(orgSlug)` (`consolidation-engine.ts:62,68`), both callers
  pass `body.org` (`api/org/memory/check/route.ts:61`, `reflect/route.ts:166`);
- local: `src/lib/local/lane-cost.ts:126` with caller-owned `idemKey: loop-lane:<laneId>` and an
  explicit unit conversion micro-cents→USD-micros (`lane-cost.ts:104-136`; units confirmed against
  `agent-envelope.ts:20-22` `MICROS_PER_USD = 100 * 1e6`).

**The read side.** `src/lib/db/usage-events.ts` — `recordUsageEvent` best-effort on `bumpCounter`
(`:106-134`), `laneTotals`/`teamTotals` over the **same half-open window** the summary uses
(`:143-193`). `getUsageSummary` UNIONs the Scan-derived `scan` lane with UsageEvent lanes
(`src/lib/db/usage.ts:282-320`); scan lane's cost **is** the headline estimate so they cannot
disagree; `byTeam` merges a JS **left** join `Scan→Repository→RepoTeam(isDefaultOwner)`
(`usage.ts:452-485`) with `UsageEvent.teamKey`, unknown+known = unknown (`mergeTeamUsage`,
`usage.ts:494-516`). Schema: `prisma/schema.prisma:2055` `UsageEvent` with the three indexes and
nullable-unique `idemKey`.

**The panels.** `src/app/usage/usageLanePanels.tsx` — server components; "Spend by lane" and "Spend by
team" render from `usage.byLane/byTeam` via `usageDashboard.tsx:191`. Null cost renders **"no
estimate"**, never $0.00 (`usageLanePanels.tsx:29-31`), with `unpricedCalls` prose (`:65-71`) and the
org-wide bucket patterned, not dropped (`:90-99`). **Wiring audit: every lane total the db computes
does reach `/usage`** — `byLane`/`byTeam` grep hits in `usageDashboard.tsx` + `usageLanePanels.tsx`,
and the JSON route serializes the whole summary.

**The CSVs.** Per-day CSV kept its `date,billable,free,total` shape (deliberate — downstream sheets
key on it, `api/usage/route.ts:28-40`); the lane/team columns live in a separate
`?view=showback` CSV (`route.ts:42-58`): lane rows + team rows, `estimatedCostUsd` **empty, never 0**,
`team` column omitted for the public org. Spec #11 said "`?format=csv` gains lane+team columns" and
"the per-lane × per-team CSV" — shipped as **two marginal distributions in one file**, not a matrix
(see F3), and the per-day CSV gained nothing (defensibly).

**Allowance/banner.** `AllotmentPanel` (`src/app/usage/AllotmentPanel.tsx`) — burn normalized to
monthly, % of `includedCredits`, fit thresholds over>90 / under<25 (`:36`), Meter with a 90% top-up
line. `creditNotice` (`src/app/usage/creditNotice.ts`) now derives from `resolveScanCharge` — the same
resolver as the 402 (`plans.ts:374-381`); page feeds it `countMeteredScansThisMonth`
(`page.tsx:99-158`). Monthly allowance **resets on the 1st UTC** (`src/lib/db/credits.ts:281`);
prepaid `scanCredits` is a persisted pool that never expires (`credits.ts` ledger).

**Two-speed freshness + queue (#10).** `OrgRepoRow.freshness {scoredAt, controlsAt, queued}`
(`src/lib/db/org-rollup.ts:181-190`), populated by two fleet-wide reads (`:487-511`, degrade-to-empty)
and rendered in the Repositories tab: `FreshnessCell` (`RepoLeaderboardParts.tsx:46-67` — "Scored
7d / Controls 1h", "—" never "now", a "queued" tag) wired at `RepoLeaderboardRow.tsx:118` under a
"Freshness" header (`Parts.tsx:177`), with DOM tests (`Parts.test.tsx:53-73`). The `truncated` frame is
gone from `/api/org/scan` — replaced by a `queued` SSE frame (`api/org/scan/route.ts:194-210`) and a
passive 15s poll in `useOrgScanButton.ts:152-180` against `/api/org/scan/queue` (gate-then-constrain,
no fabricated ETA — `queue/route.ts:45-47`). `queueDepth()` itself surfaces **only** in the two cron
routes' JSON (`cron/rescan/route.ts:83`, `cron/probe/route.ts:49`).

## 3. The walkthrough (first person)

I open `/usage` for my Team org the way I have every month, renewal spreadsheet half-open.

**Utilization.** Top tiles give me billable count; then — new since my last review — the **Monthly
allotment** panel: "≈ N credits / mo at this pace · X% of your 150 / mo allotment", a meter with the
90% line, and a directional verdict (under 25% → "a smaller tier may fit"; over 90% → "top up or move
up a tier"). That is the number that decides the tier, computed for me. *"Okay, that's a row I can
defend to finance."* Criterion 1 and 3: **pass**.

Then I read the fine print under it: *"Unused credits roll over. They never expire, so a quiet month
is not lost."* — printed directly under a header that says **"Monthly allotment · 150 credits / mo"**.
The code says the monthly allowance **resets on the 1st** (`credits.ts:281`) and only my *purchased*
pool persists. If I take that sentence at face value, an idle month costs me nothing and I never
downgrade; the code says an idle month burns 150 scans of headroom I paid $10 for. The one sentence
that answers my rollover question answers it about the **wrong bucket**, in the panel where the
right-sizing decision is made. That's my pet peeve verbatim, and it flips the math. (F1.)

**Lanes.** Below the engine split: **Spend by lane** — Scan, Athena, Org memory, Briefing, Local
agent, each with a $ or "no estimate" and an unpriced-calls count — and **Spend by team**. For the
first time the product can answer *"what did THIS tool's own inference cost us this month, per
lane"* — and the nulls are honest (a BYOM lane says "could not be priced (…your own provider
account…)", never $0). The lane instrumentation is real and end-to-end: I traced all five producers
to `meter()` and the ledger to the panel. This is the row the renewal deck was missing.

Two catches. The **"Est. cost"** tile at the top prices *scan tokens only* (`usage.ts:245-262` — the
per-model fold over `Scan` rows), while the lane panel below shows Athena/memory/briefing dollars the
tile doesn't include. Nothing on the tile says "scan lane only", so the number I'd screenshot for the
CFO understates the total the same page itemizes lower down. (F5.) And **teams**: every non-scan lane
lands in "Org-wide (no repo)" because no producer ever passes `teamKey` — grep across `src/` finds
zero call sites setting it, even the local lane which knows its `repoFullName`. Honest bucket, but the
spec's own goal ("which team's work drives [the companion cost]") is only answerable for scans. (F4.)

**The finance export.** My job ends in a sheet. The **showback CSV exists**
(`/api/usage?view=showback`, formula-guarded, empty-not-zero costs) — and **no pixel on the page
links to it**. `UsageTrend` offers CSV/JSON of the *day series* only (`UsageTrend.tsx:79,86`); grep
for "showback" across `src/` hits the route and its tests, nothing else. The artifact built
specifically for people like me is reachable only by reading the source or the docs. (F2.) And when I
do fetch it, it's lane totals and team totals — not lane×team, so "which team drove the Athena spend"
still has no cell. (F3.)

**Price.** `/pricing` shows Team at $10/mo + 150 private scans/mo (`planPriceLabel`,
`planScanLine`) → $0.067/included-scan; overflow 1 credit/scan. Computable. Criterion 4: **pass**
(with the nit that `/usage` itself never links the subscription price — footer still ends "Per-org
attribution activates with auth / the GitHub App", boilerplate from an era before the page I'm
looking at, F6).

**The banner recert (DANA-L1-003/B1).** Verified in code as actually fixed, not just annotated:
`creditNotice` deleted the local arithmetic and asks `resolveScanCharge` — the same function that
issues the 402 — with real month-to-date usage the page now fetches (`page.tsx:99-107,149-158`).
`charge === "allowance"` → silence (the branch that used to alarm every new org); `denied` requires
allowance spent AND balance 0; monotonic by construction. The banner can no longer contradict the
AllotmentPanel eight lines below it. **Resolved-verified candidate → L2 confirm.**

**Cadence freshness (#10).** On the Repositories tab each repo now carries "Scored 7d / Controls 1h /
queued" — exactly the split I need to believe a weekly *paid* cadence is enough: controls re-observe
free on webhooks, scores on cadence. A budget-stopped bulk scan shows "N queued — finishing in the
background" and ticks down on its own instead of handing me a Continue button. The remainder is owed,
not lost — which also means a truncated run no longer silently under-delivers scans I paid credits
for (`creditCharged` rides the job row). One gap: the *org-wide* queue depth (how deep is my cadence
backlog, oldest age) reaches only the cron's JSON response — no dashboard aggregate; I'd see 400
per-row "queued" tags before I saw the number 400. (F7.)

**Recurring value per credit (criterion 5).** Not my deep lane this round (Dana/Sam own trajectory and
movers); what I can say from this walk is that the *cost half* of the cost↔value ledger is now
genuinely instrumented, which is the half that was missing at the pricing-20 run. Partial credit,
deferred to the pairs that own the value half.

## 4. Findings

Impact = frequency × reach × trust-cost, per rubric §5. All verdicts are mine as skeptic; every claim
carries file:line.

| id | type | sev | verdict | summary |
|---|---|---|---|---|
| VICTOR-L1-01 | trust | **major** | confirmed | Rollover copy in the Monthly-allotment panel ("Unused credits roll over. They never expire, so a quiet month is not lost" — `AllotmentPanel.tsx:80-83`) is placed under the **monthly allotment**, which does NOT roll over (`decideScanCharge` gates on `usageThisMonth < allowance`; resets 1st UTC, `credits.ts:281`). Only the prepaid `scanCredits` pool persists. The sentence is true of one currency and printed under the meter of the other. Impact: every metered org, every month, on the exact panel that decides downgrade/hold — a wrong "idle headroom is not waste" flips the right-sizing verdict. Fix is one sentence: name the two currencies ("Your monthly allotment resets on the 1st; purchased credits never expire"). |
| VICTOR-L1-02 | confusion (present-but-undiscoverable) | **major** | confirmed | The showback CSV (`/api/usage?view=showback`, `route.ts:99-106`) has **zero UI references** — grep "showback" in `src/` = route + tests only; `UsageTrend.tsx:79,86` exports only the day series. The finance artifact #11 was built for is URL-only. Impact: monthly, every finance-minded reader, high — the workflow the feature exists for dead-ends at the screen. Fix: a third export button beside CSV/JSON. |
| VICTOR-L1-03 | quality-gap | minor | confirmed | Showback is two **marginals** (lane rows with empty team, team rows with empty lane — `route.ts:47-56`), not the "per-lane × per-team CSV" spec #11 promised. "Which team drove the Athena lane" has no cell, though `UsageEvent` carries both keys and the scan side already joins repo→team. Renewal allocation by team still works from the marginal; the cross-cut doesn't. |
| VICTOR-L1-04 | quality-gap | minor | confirmed | `teamKey` is written by **no producer** — no `meter()` caller passes it (grep `src/`), so team attribution exists only for the scan lane via the rollup join; even the local lane, which passes `repoFullName` (`lane-cost.ts:133`), lands org-wide. Honest bucket, but the spec goal "which team's work drives the companion cost" is scan-only today. Preconditioned on repo-scoped non-scan work actually existing (athena/memory/briefing are genuinely org-wide), so: minor. |
| VICTOR-L1-05 | confusion | minor | confirmed | The headline **"Est. cost"** tile is scan-lane-only (`usage.ts:245-262` folds `Scan` groupBy) while `LanePanels` below prints additional Athena/memory/briefing dollars; no "scan lane" qualifier on the tile (`usageDashboard.tsx:97-106`). Sum-of-lanes > headline on any org with companion spend — the screenshot number understates the page's own itemization. |
| VICTOR-L1-06 | confusion | polish | confirmed | `/usage` footer always ends "Per-org attribution activates with auth / the GitHub App." (`usageDashboard.tsx:229`) — stale on a fully attributed private-org view; also no route from /usage to the subscription $ (Polar / /pricing). Trust-eroding boilerplate on a billing page. |
| VICTOR-L1-07 | missing-feature | minor | confirmed | Org-wide queue depth reaches no operator surface: `queueDepth()` is returned only by the cron routes' JSON (`cron/rescan/route.ts:83`, `cron/probe/route.ts:49`); the UI has per-repo "queued" tags + the run-scoped poll, but no "N rescans queued, oldest 3h" aggregate anywhere a member looks. Between interactive runs, a deep cadence backlog is invisible except as scattered tags. |
| VICTOR-L1-08 | quality-gap | polish | confirmed | Two honesty nits at the edges: (a) `meterLane` writes `inputTokens: result.inputTokens ?? 0` inside the any-token-present spread (`lane-cost.ts:140`) — a 0 where "provider reported nothing" is the module's own rule; (b) a lane string from a future/rolled-back build is silently dropped from `byLane` (`usage-events.ts:159-162`) but still counted in `byTeam`, so the two panels' call totals can disagree with no "unknown lane" row. Both deliberate-adjacent; neither misprices anything today. |

**Resolved-verified candidates (for L2 to confirm, not findings):**
- **DANA-L1-003/B1** — credit banner now shares the 402's resolver (`creditNotice.ts:67-89` +
  `page.tsx:99-158`); monotonic; new-org default state is silence. L2: fresh Free org (0 credits,
  0 scans) → no banner; spend the allowance → banner only at real `denied`/`low`.
- **#10 "Continue" removal** — `truncated` frame gone; `queued` frame + passive poll + freshness cell
  all wired with tests (`route.ts:194-210`, `useOrgScanButton.ts:152-180`, `Parts.test.tsx:53-73`).
- **#11 meter wiring** — all five lanes produce events; nulls honest end-to-end (panel "no estimate",
  CSV empty-string); `decideCharge` is a no-op generalization (every tier `{}` — no silent repricing).

## 5. Scored acceptance criteria

| criterion | verdict |
|---|---|
| Burn-vs-allotment visible | **pass** — AllotmentPanel, "X% of 150/mo", meter + 90% line |
| Rollover stated + matches behavior | **fail** — stated, but about the wrong bucket where it matters (F1) |
| Right-size signal | **pass** — under/ok/over nudge + runway days on the Credits stat |
| Price legibility ($/scan computable) | **pass** — $10/mo + 150/mo on /pricing; nit F6 |
| Recurring value per credit | **partial / deferred** — cost half now instrumented (lanes); value half owned by pairs #1/#2 |
| Time-saved bar (<5 min glance) | **conditional pass** — the page is the reconciliation; the CSV he pastes onward isn't findable (F2) |

## 6. Grounding, time-saved, verdict

**Grounding: 9/10.** Every load-bearing claim carries file:line read this session; producers, read
path, panels, CSVs, banner, freshness and queue all traced end-to-end. The un-walked 1: rendered
output and the trajectory/movers half (other pairs' scope).

**Time-saved:** manual baseline 30–45 min/cycle spreadsheet + quarterly 60-min deep cut. With the
allotment panel + lane panels the monthly glance is ~3–5 min → **~30 min/cycle saved**; the quarterly
deck still costs ~10 min of hand-work today because the showback CSV is undiscoverable and the
headline cost tile can't be pasted as "total inference cost" (F2/F5). Full ~40 min/quarter more on
the table once F1/F2/F5 land.

**Verdict: HOLD TEAM (renew), with two copy/discoverability fixes as renewal conditions.** The
instrumentation I said last time was missing now exists and is honestly built — utilization vs
allotment, per-lane cost with truthful nulls, per-team scan attribution, freshness decoupled from
spend. What stands between this page and my renewal deck is not a missing meter; it's one wrong
sentence about rollover (F1), one unlinked CSV (F2), and one unqualified headline number (F5). Fix
those and this is the rare tool whose own page computes its own ROI row.

## 7. l2_priority (with environment preconditions)

1. **VICTOR-L1-01** — Team-plan seeded org, `usageThisMonth > 0`, prepaid balance > 0; read the
   allotment panel copy against a month rollover. Precondition: `npm run db:local:seed` +
   `setOrgPlan team`; no lane spend needed.
2. **VICTOR-L1-02 + F3 + F5 bundle** — needs **UsageEvent rows across ≥3 lanes with real costMicros
   plus some null-cost (byom) rows**. The seeders cannot produce this today: grep `UsageEvent` in
   `scripts/` = 0 hits, and live lane spend needs a real Athena turn / memory pass. **Fixture to
   close it:** extend `scripts/seed-org.mjs` with a `--usage-events` step inserting ~20 rows
   (athena/memory/briefing/local, mixed teams via `teamKey`, mixed priced/unpriced) — or run one live
   memory `check` + briefing under `LLM_PROVIDER=claude-cli`. Then: hunt for the showback export as a
   user; diff headline tile vs lane sum.
3. **DANA-L1-003/B1 recert** — fresh Free org (0 credits, 0 scans this month) → no banner; burn 20
   allowance scans + 0 balance → `denied` copy; +1 credit → `low`/silence per burn. Precondition:
   PGlite seed + `ASCENT_AUTH_BYPASS=1`.
4. **#10 queued-flow confirm** — bulk scan an org large enough to hit the wall-clock budget (or lower
   the budget env), watch `queued` frame → poll tick-down → freshness cell "queued" tag clear.
   Precondition: seeded org with ≥10 watched repos, cron runnable locally.
