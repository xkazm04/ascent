# Usage metering

Usage metering is the billing/visibility view over how many scans an org has run. The
**billable unit is one computed (non-cached) `Scan` row**: re-scanning the same commit is
deduplicated and not double-counted (see [data-model.md](../data/data-model.md)). The dashboard
splits billable vs free scans, breaks them down by LLM provider, and charts a per-day trend.
Requires `DATABASE_URL`.

Since #11 the **metered** unit is wider than the **billable** one: the billable unit is still a
`Scan`, but every model call the deployment serves — Athena's turns, org memory's passes, the
briefing narrative, the local agent — is now recorded in a `UsageEvent` ledger and shown per lane
and per code-owning team. Nothing about what an org is *charged* changed (see
[No repricing](#no-repricing)).

## Metered lanes (`src/lib/llm/meter.ts`)

| Lane | What spends it | Where the row comes from |
| --- | --- | --- |
| `scan` | the scoring pipeline | **`Scan` rows** — not mirrored into `UsageEvent`; that lane already has an authoritative ledger and a copy would drift |
| `athena` | the companion's interactive turns *and* its unattended cycles (both leg kinds fold to one lane) | `runToolLoop`, **one event per loop**, never per leg |
| `memory` | Shared Org Memory's write-gate + reflection passes | the single-shot seam, via `resolveMemoryRunner(orgSlug)` |
| `briefing` | the executive briefing's LLM-written paragraph | metered **in place** in `briefing-narrative.ts` (its own Anthropic egress; re-plumbing it is BACKLOG C3) |
| `local` | the local remediation agent | the agent supplies its own cost envelope, idempotency key **and the owning team of the repo it worked** (`defaultOwnerTeamForRepo`) |
| `unknown` | *read-side only* — rows tagged with a lane string this build does not know (a newer or rolled-back deploy) | folded into one disclosed bucket by `laneTotals`, never dropped |

`meter()` rides beside `trackLlmCall` at the two seams — `withTimeout()` in `text-meter.ts` and
`runToolLoop()` in `tool-loop.ts` — and nowhere else. It returns `void`, is never awaited, and
**cannot throw or reject**: a mis-wired meter must not be able to take down the surface it observes.
An event with **no org** writes nothing — and that is the only drop the seam makes. It does not read
the org's slug for meaning: until 2026-08-31 it dropped every event whose slug spelled `public`, so a
real tenant on that slug burned companion/memory/agent inference and showed `$0` for it forever, in
silence (UAT MC-B20 / VICTOR-L2-01, found when a genuine 12.1 s `claude-cli` turn recorded nothing).
Whether an org is ledgered is now a property of its **row**: `recordUsageEvent` resolves the org and
skips it only when `Organization.kind` is `public`, the flavor reserved for the shared anonymous
funnel. The stamp is guaranteed, not assumed (RC3-N1): the schema defaults `kind` to `"org"`, so
`ensureOrgId` writes `kind: "public"` when it creates the funnel org, repairs an existing funnel row
that lost it, and `init.sql`'s seed carries it — a stock deployment can never quietly meter its
anonymous funnel. The `/usage` footer reads the same row-derived fact (`UsageSummary.unmeteredFunnel`,
RC3-N2) instead of re-deriving it from the slug, so the meter and the page cannot disagree about
which org is the funnel. Any other unstamped org simply meters everything it can attribute — the
honest default; the funnel's own scans never reach this ledger anyway (the scan lane keeps its own).

**Honest nulls.** `inputTokens` / `outputTokens` / `costMicros` are `null` — *never* `0` — when the
provider reported nothing (the `claude-cli` path reports no usage at all and still writes a
token-less row, so the *call* is visible even when its cost is not), when the org runs BYOM (it paid
its own vendor; Ascent has no figure), or when the model has no `MODEL_PRICES` rate. `unpricedCalls`
is reported per lane so a `$0.00` line reads as "nothing to price", not "free". Since 2026-09-05
the **scan lane applies the same BYOM rule**: scans with `engineByom: true` are grouped separately,
never priced (a BYOM-only window prices as `null`, never `$0.00`, and the env-rate override is
refused when every token is BYOM), and `UsageSummary.byomScans` drives a "N BYOM scans, unpriced"
note beside the estimate. Their tokens still count in the volume tiles.

**Idempotency.** `idemKey` is `"<lane>:<refId>"` when the caller owns a stable id, else `null`
(NULLs are distinct under the unique index — the same at-least-once fallback `Scan.dedupKey` uses).
A retried write collides on P2002 and is swallowed by the best-effort writer: no double count.

**Privacy.** `teamKey` is a CODEOWNERS *team* slug, never a person — no contributor login, email or
individual attribution enters `UsageEvent`, and no prompt or response text is stored (token counts,
model id and status only). The team view is omitted entirely for the public funnel, whose summary is
anonymously readable.

**Audit.** Spend-shaped, so `UsageEvent` *is* the audit row; there is no `AuditLog` entry per metered
call (one row per model call would drown the trail).

<a id="no-repricing"></a>
**No repricing.** `PlanFeature.laneAllowances` ships `{}` on every tier, so `decideCharge(lane, …)`
answers `"unlimited"` for every non-scan lane on every plan and delegates verbatim to
`decideScanCharge` for `"scan"` (pinned by a test that diffs the two across the whole table).
Opting a lane in is a pricing decision to be made *with* the numbers this ledger produces, not
alongside the instrument that first measures them. Self-hosted: the meter always writes (it is
observability, and a self-hoster wants their own lane costs most of all) while every *gate* stays off
through the existing `selfHosted()` short-circuits.

## What counts as billable

`isBillableScan()` (exported from `src/lib/db/usage.ts`) is the **single** definition, and
every metered aggregate goes through it: the headline tile, the trend series (both its SQL
and JS-fallback paths) and the top-repos attribution. A scan is billable only when **all
three** hold:

1. the repo is **private** (public scans are free by policy);
2. `engineProvider !== "mock"`: a keyless/degraded run performed no inference (the same
   exclusion `countMeteredScansThisMonth` in `credits.ts` applies to the allowance);
3. `engineByom !== true`: a BYOM scan ran in the org's own provider account, which the org
   already pays directly. `null` (rows predating the column) means the platform account, so
   it stays billable.

Anything else in the period is **free**. Three forms of the predicate exist and must stay in
lockstep: `isBillableScan()` (JS; also the daily series' fallback path), `billableScanWhere()`
(the Prisma `where`), and the `billable` expression inside the daily-series raw SQL, where
`IS NOT TRUE` mirrors `!== true` over a NULL `engineByom`.

> UI wording caveat: the dashboard's split bar still labels the free half "Public (free)"; it
> now also includes private mock/BYOM scans. The value is correct ("not billed"), the label is
> narrower than the number.

## Aggregation (`src/lib/db/usage.ts`)

`getUsageSummary(org, periodDays, window?)` → `UsageSummary` (the page resolves the window once with
`usageWindow(days)` and hands the same object to `getCreditReconciliation(org, { since, before })`,
which no longer takes `days`):

- `totalScans` (all-time), `periodScans` (last *N* days), `privateScans` / `publicScans`
  (period), `distinctRepos`.
  - `privateScans` is the **billable** count per the predicate above (the name is wire
    compatibility, not "every private scan"); `publicScans` is the derived free remainder,
    so `privateScans + publicScans === periodScans` and the tiles equal the chart's stacked
    totals by construction.
- `byProvider`: count per `engineProvider`.
- `byLane`: per-lane calls, tokens, estimated cost and `unpricedCalls`. A **UNION**: the `scan` lane
  is folded from the same `Scan` groupBy the headline figures use (so it cannot double-count or
  disagree with them), every other lane comes from `UsageEvent` over the same window. A row whose
  lane string this build does not know (a newer or rolled-back deploy) is **not** dropped: it folds
  into one `unknown` bucket the panel names out loud. Dropping it made `byLane` and `byTeam` — which
  groups the same rows and never reads `lane` — disagree about the period's call total on one screen,
  with nothing to explain the gap (UAT MC-B31 / VICTOR-L1-08).
- `estimatedCostUsd` / `costBasis`: the **scan lane's** cost and the basis that priced it
  (`LLM_*_COST_PER_MTOK` env override > the built-in per-model table > none). Scan-scoped because it
  is folded from the `Scan` token totals; it is *not* the page's headline.
- `allLanesCostUsd` / `allLanesUnpricedCalls`: the sum of **every** lane in `byLane`, and the count
  of calls no basis could price. This pair is what the "Est. cost" tile shows, so the headline equals
  the "Spend by lane" table by construction. `allLanesCostUsd` is `null` — never `0` — when nothing
  in the period could be priced, and an unpriceable lane is never folded in as `$0`: it lands in
  `allLanesUnpricedCalls`, which makes the headline a **floor**, and the tile says so
  (`… · floor: +34 calls unpriced`). Before this the tile priced the scan lane alone and understated
  the page's own itemization by up to 78% on an org with companion/agent spend.
- `byTeam`: per-code-owning-team calls and cost. A **LEFT** join (`Scan → Repository →
  RepoTeam(isDefaultOwner)`); a repo with no owning team lands in an explicit `Org-wide (no repo)`
  bucket rather than dropping out — an inner join would silently shrink the org's own total. Empty
  for the public funnel. The non-scan lanes join the same way: a lane that knows its repo resolves
  the repo's default owner at write time (`defaultOwnerTeamForRepo`) and stamps it on the event, so
  the panel is no longer 100% `Org-wide` for everything but scans (UAT MC-B19 / VICTOR-L1-04). A lane
  that genuinely has no repo — a briefing, an org-wide memory pass — is org-wide, which is an answer.
- `byLaneTeam`: the **lane × team intersection** — the join `byLane` and `byTeam` cannot make between
  them, and what a finance reader actually allocates on ("Athena cost $40; what is platform's share?").
  **Sparse**: one cell per pair that recorded calls, so a missing pair renders **blank**, never `0` —
  absence of a record is not evidence a team spent nothing on a lane. Same rules as the two tables
  above it: a `null` cost prints *no estimate* with `unpricedCalls` beside it, an unrecognized lane
  folds into the same disclosed `unknown` bucket through the same `isUsageLane` predicate, and the
  team-less bucket is a real, last-sorted column. Empty for the public funnel, whose summary is
  anonymously readable and must carry no attribution surface at all. The `scan` row and `byTeam`'s
  scan half come from **one** fold of one query (`scanTeamUsage` → `LaneTeamCell[]`, projected back
  by `scanTeamRows`), so the matrix and both tables reconcile by construction rather than by luck.
- `daily`: a **zero-filled** per-day series (stable x-axis even with gaps), aggregated per
  UTC day in SQL (`date_trunc`, portable to Aurora DSQL) with a JS row-bucketing fallback.
- `firstScanAt` / `lastScanAt` (all-time).

**Window:** the period counts, the daily series and (since 2026-09-05) the credit reconciliation
share one half-open UTC window, `[since, tomorrow-UTC)`, built by `usageWindow(days)`. The upper
bound is load-bearing: without it a future-dated / clock-skewed row was counted in the headline
tile but silently dropped from the chart (its day key isn't on the axis), so the billing page
disagreed with itself. The reconciliation used to cut at a rolling wall-clock instant, up to a day
off the scan window under the same "last Nd" label; that skew is gone and the mismatch note no longer
offers it as an explanation. The page states **UTC** on the chart and the lane headers, and the API
echoes `timezone: "UTC"`, `windowSince` / `windowBefore` (requested) and `effectiveSince` /
`effectiveDays` (the zero-filled series is clamped at the org's first scan, and the chart says
"window shortened to first scan" when they differ; the CSV follows). The trailing bucket is marked
partial ("today, partial" / "partial: N of 7 days") in the bar, its title, a footnote and the
screen-reader table; buckets chunk forward from the window start so their keys stay stable across
reloads. The footer that used to read "Window: first → last" now says "First scan → last scan (all
time)", since it never was period-scoped. The scan row is captioned "Computed scans (incl. mock)"
under a "calls" header rather than "model calls".

## Page & API

| Surface | Behavior |
| --- | --- |
| `src/app/usage/page.tsx` | Auth-gated, org-scoped (`?org=` or active-org cookie). Stat cards (total, period, billable, distinct repos), public-vs-private + provider breakdowns, timeframe picker (`TimeframePicker`, server-rendered links for 7 / 30 / 90 / 1y that preserve `?org=`; 1y is disabled with its reason on the public funnel, whose bound is 90) (`?days=`, default 30, max 365). The closing note is **conditional**: the shared funnel is told per-org attribution activates with auth / the GitHub App; a private org — which is reading its own per-team, per-repo, per-lane breakdown, i.e. that attribution — is told it is attributed and given the link to plans & credit pricing this billing page otherwise lacked (UAT MC-B31 / VICTOR-L1-06). |
| `GET /api/usage` | `?org=` (default `public`), `?days=`, `?format=json\|csv`. Returns `UsageSummary` JSON, or a CSV/JSON file download. `503` without DB. **IDOR guard:** when auth is on, a private org requires a session with an installation in it; public is readable by any signed-in user. |
| `GET /api/usage?view=showback` | The lane × team allocation as CSV (`scope,lane,team,calls,estimatedCostUsd,unpricedCalls`), for finance. Same route, same auth, same window — a projection, not a new surface. A row that could not be priced exports an **empty** cost cell, never `0`. The `team` column is omitted entirely for the public funnel. Kept separate from `?format=csv` on purpose: the per-day export's shape is a reconciliation artifact downstream sheets key on, and a lane is not a property of a day's scan count. **Linked from the page** as the third export button — for its first months it was built, correct, reconciling and reachable only by hand-typing the query string (UAT MC-B19). |
| `src/app/usage/usageShowbackPanel.tsx` | **Showback · lane × team**, on the page, under the two panels it joins (MC-B45). Lanes down, teams across, `Org-wide (no repo)` last; a pair with nothing recorded is an em dash with the reason on hover, a pair that ran unpriced says *no estimate* with its unpriced count. The table scrolls inside its own container so the page body never scrolls sideways. **Before any team is attributed** — no repo in the window has a CODEOWNERS default owner — it renders no grid at all and says attribution is on and accruing, because a one-column table of `Org-wide / $0.00` reads as a finding rather than as a wait. Renders nothing when the ledger is empty; the lane table above has already said so. |
| `src/components/usage/UsageTrend.tsx` | Stacked-bar chart (free under billable), dependency-free SVG, auto-scaled label cadence, **three** export buttons — per-day CSV, JSON, and the **Showback CSV** (`?view=showback`) — legend + summary. |

## Rate limits & the spend ceiling (`src/lib/rate-limit.ts`)

Every public, unauthenticated endpoint that can cost money (`/api/scan`, `/api/scan/stream`,
`/api/org/import`, `/api/gate/*`, `/api/quota`, `/api/plan-enquiry`,
`/api/org/repos`) is charged against a sliding window with **two halves**:

- **Per-IP burst**: always in-process. A burst is seconds long and normally pinned to one
  instance, so a per-instance cap is a real cap and the check stays synchronous.
- **Global spend ceiling**: the budget itself. In-process it is really `instances × limit`,
  which *rises with autoscaling*. It can be backed by a **shared store** so a whole fleet charges
  one budget (`rateLimitRequestShared()`, `src/lib/rate-limit-store.ts`).

| Env var | Default | Meaning |
| --- | --- | --- |
| `ASCENT_RATE_LIMIT_STORE` | `memory` | `memory` (per-instance, no infrastructure) or `upstash` (fleet-wide global ceiling). |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | — | Required for `upstash`. Spoken over `fetch` against the REST `/pipeline` endpoint: **no npm client dependency**. If either is missing the store falls back to `memory` rather than failing requests. |
| `ASCENT_RATE_LIMIT_SHARED_FAIL_OPEN` | unset (fail **closed**) | When the shared store is unreachable, `1` degrades to the in-memory ceiling (availability) instead of returning 429 (safety). |
| `RATE_LIMIT_{SCAN,PEEK,QUOTA_PEEK,ORG_IMPORT,GATE,CONTACT,ORG_REPOS}_{PER_IP,GLOBAL}` | see source | Per-endpoint overrides; window is 60s. |
| `ASCENT_TRUSTED_PROXY_HOPS` | `1` | How many proxies in front of the app are trusted to set honest forwarding headers, which is the key every per-IP limit *and* the 30-day free-scan quota is bucketed on. `0` trusts nothing (all forwarding headers ignored: anonymous callers share one burst bucket and the monthly quota treats them as unidentifiable); `1` trusts one proxy (`x-real-ip`, else the right-most `X-Forwarded-For` hop); `N` declares an N-hop chain (CDN, LB, app = `2`), taking the Nth-from-the-right XFF entry and ignoring `x-real-ip`. Read by `trustedProxyHops()` in `src/lib/env.ts`. |

**Set `ASCENT_TRUSTED_PROXY_HOPS` on a self-hosted deployment.** At the default of `1`, `x-real-ip`
is trusted verbatim. If the app is reachable without a trusted proxy (the port is exposed, or the
proxy forwards client headers unchanged) a caller can mint a fresh burst bucket *and* a fresh
monthly-quota bucket on every request just by setting that header. Since 2026-09-05 the app logs one
warning per process at first use when the variable is unset and no platform witness (`VERCEL`) is
present. On Vercel the default is correct and nothing needs setting.

**A refused request spends nothing (2026-09-05).** The per-IP window is checked first but recorded
only after the global ceiling admits, so a caller refused by the global ceiling, or by the
fail-closed "store unreachable" branch, keeps their own per-minute budget intact. Before this the
per-IP hit was recorded up front, so during global saturation an innocent caller's own allowance
drained on requests that were never served.

`ORG_REPOS` (`10`/min per IP, `60`/min global) covers `GET /api/org/repos`, the App-free public org
listing behind the onboarding selector — added 2026-08-28, when it was the last public endpoint with
no limiter. It is the costliest of them per call: `listOrgRepos` pages up to 5 × 100 repos against the
server's **ambient** `GITHUB_TOKEN`, so an anonymous loop over invented org names spends the
operator's GitHub quota rather than the caller's. At ~5 upstream calls per request the global cap is a
**burst brake, not a quota guarantee** — the real quota bound stays `listOrgRepos`'s own page budget.
The limiter runs *after* the route's argument validation, so a malformed request costs a `400` rather
than a budget slot.

### What a 429 tells the caller

A refusal names the layer that refused, because the three cases need opposite responses. Routes that
pass the whole `RateLimitResult` to `tooManyRequests()` — the ingest guard plus every JSON API route
that rate-limits (`/api/scan`'s peek gate, `/api/gate/[owner]/[repo]`, `/api/mcp`, `/api/quota`,
`/api/org/import`, `/api/plan-enquiry`) — get:

| `scope` | body `code` | Headers | What the caller should do |
| --- | --- | --- | --- |
| `ip` | `rate_limited` | `retry-after`, `x-ascent-ratelimit-scope: ip`, `x-ascent-ratelimit-limit`, `x-ascent-ratelimit-window` | Slow down — this is *your* budget, and the limit + window are stated. |
| `global` | `rate_limited` | `retry-after`, `x-ascent-ratelimit-scope: global` | Nothing, directly: the service-wide budget is exhausted by aggregate traffic. **The ceiling and the remaining headroom are deliberately withheld** — publishing them hands an attacker the size of the instance budget and a live "how close am I" meter. |
| `unavailable` | `rate_limit_unavailable` | `retry-after` (the store breaker's re-probe delay), `x-ascent-ratelimit-scope: unavailable` | Retry shortly. **No limit was evaluated** (`evaluated: false`): the shared store was unreachable and the request was refused fail-closed, so no budget was consumed or exceeded — and there is no draining window to estimate from, which is why Retry-After is the breaker delay rather than a full window. |

Two callers still emit the bare body (`error` + `code: "rate_limited"` + `retry-after`), for reasons
that are not "not migrated yet":

- **The expensive scan path** on `/api/scan` and `/api/scan/stream`. Both route their refusal through
  `scanRateLimitGate()` (`src/lib/scan-gates.ts`), whose `ScanRateLimitRejection` carries only
  `retryAfterSec` — the scope is discarded inside the gate, before either route sees it. Enriching
  these means widening that gate's rejection type, not editing the routes.

### Where a limit's number comes from

Every `RateLimitConfig` declares a required `basis`:

- **`derived`** — computed from a stated client cadence, with the multiplication written above the
  entry so it can be re-run when the client changes. Only `INGEST_RATE_LIMIT`
  (`src/lib/integrations/ingest-guard.ts`) qualifies: 13 pushes/min/machine × 200 seats behind one
  egress IP ≈ 2,600/min → `perIp` 3,000.
- **`inherited`** — chosen, or matched to a previous bespoke limit, and never computed. Every budget
  in `src/lib/rate-limit.ts` is inherited today. Their comments now state what call pattern each number
  *clears*, which is a headroom check, not a derivation. An operator tuning under load should move
  these before a derived one — and promoting one to `derived` means measuring the client and
  rewriting the number, not reverse-engineering arithmetic that lands on the value already there.

### The free public-scan allowance (`src/lib/public-scan-limit.ts` + `public-scan-quota.ts`)

Layered **on top of** the per-minute burst limiter, and a different kind of thing: a persistent,
per-IP (anonymous) / per-user (signed-in) allowance of **5 free public scans per rolling 30-day
window**, salted-hashed at rest, deliberately soft and fail-open. It is not billing — a public scan
never touches the plan allowance or a credit (see `billing.md`) — it is a cost nudge on a free,
no-signup funnel.

**One number, one source.** The allowance functions live in `src/lib/public-scan-limit.ts`, a pure
module with no `node:crypto` and no Prisma import, *specifically* so the copy that promises the
allowance can read the same function the gate charges against. `plans.ts` is imported by client
components and could never import `public-scan-quota.ts`; before this split it carried a second,
hand-typed number, and the Free card advertised "Unlimited free public scans" against an enforced
limit of 5 while `QuotaMeter` counted down in the scan dialog (UAT `MC-B5`). Every surface now
derives:

| Surface | Reads |
| --- | --- |
| `/pricing` Free card + blurb | `PLAN_SPECS.free` → `publicScanAllowance().label` |
| `/pricing` metadata + the footnote under the credit matrix | `publicScanAllowance()`, `PUBLIC_SCAN_WINDOW_DAYS` |
| Landing FAQ JSON-LD (`src/app/page.tsx`) | the same two |
| `QuotaMeter` in the scan dialog | `GET /api/quota` → `peekPublicScanQuota` |
| The 429 body (`monthlyQuotaExceeded`) | the limit of the scope that actually tripped |

**Ask for the phrase, not the digit.** `publicScanAllowance()` returns `{ limit, label, plural }` —
`"5 free public scans"`, or `"1 free public scan"`. Making the number derived left the sentences
around it written for a constant, so an operator setting `PUBLIC_SCAN_MONTHLY_LIMIT=1` read
*"1 free public scans / month"*, *"and 1 free public scans"*, and *"The 1 free public scans run on
their own rolling 30-day window"* on a single page (UAT MC-B38) — invisible at the default of 5, and
visible to exactly the self-hosting operator the page was rebuilt for. `plural` is exposed for the
surrounding verb, which is the one part of a sentence a shared phrase cannot own.

Never write the allowance as a literal, never append your own plural `s` to it, and never call public
scans "unlimited" or "unmetered" — a meter is rendered on the same screen. `plans.test.ts` fails any
plan copy that does.

**The 429's upsell names a LABEL, not an id.** `monthlyQuotaExceeded` reads `PLAN_FEATURES.pro.label`
("Starter"); it used to say "Upgrade to Pro", naming a tier that appears nowhere a buyer can see.

**Env.** `PUBLIC_SCAN_MONTHLY_LIMIT`, `PUBLIC_SCAN_MONTHLY_LIMIT_SIGNED_IN` (clamped never below the
anonymous limit), `PUBLIC_SCAN_QUOTA_SALT`, `PUBLIC_SCAN_QUOTA_DISABLED`. Raising a limit also raises
what `/pricing` and the FAQ **promise**, since that copy is derived. (`.env.example` documented these
as `PUBLIC_SCAN_WEEKLY_LIMIT`/7 days for a while — a variable nothing read; corrected 2026-08-31.)

### Reclaiming limiter memory

The in-process window map is swept on a **declared cadence with a bounded budget**: at most one sweep
per 10s (1s once over 10,000 keys), inspecting at most 256 entries (4,096 under pressure) and
resuming where the last sweep stopped, so no request pays an O(n) scan — the previous
"scan everything, on every request, while the map is over 10,000 keys" turned the limiter's own
memory pressure into request latency exactly during an attack. Only **fully-aged** keys are evicted
(a key whose window still holds hits would have its limit reset by eviction, which is an attack).
`rateLimiterStats()` exposes keys, peak keys, sweeps, entries scanned, evictions and completed passes.

`CONTACT_RATE_LIMIT` (3/min/IP, 30/min global) is the tightest budget here and the only one guarding a
non-inference cost: `POST /api/plan-enquiry` (the `/pricing` Custom-plan form) writes a row and sends
mail through the operator's provider on every accepted call, so an unthrottled loop is both a spam cannon
aimed at one inbox and a way to burn a metered send quota. A human submits it once.

**Unreachable store → fail closed, by design.** Turning the shared store on is a statement that
the fleet needs *one* hard ceiling; degrading silently would restore the exact
`instances × limit` hole the operator paid to close, on endpoints that spend inference money per
request. A denied free scan is recoverable in a minute; a denial-of-wallet is not. The per-IP
burst cap is in-memory and unaffected, so failing open (`ASCENT_RATE_LIMIT_SHARED_FAIL_OPEN=1`)
is a bounded, not unlimited, degradation. The driver keeps a 1.5s timeout and a 3s breaker so an
outage never stalls the request path.

**Adoption status:** the shared path is implemented and tested but the route handlers still call
the synchronous `rateLimitRequest()`; switching a route is a one-word `await` at its call site.
Until a route adopts `rateLimitRequestShared()`, its global ceiling remains per-instance.

## Key files

| File | Role |
| --- | --- |
| `src/lib/db/usage.ts` | `getUsageSummary()`: totals, provider mix, zero-filled daily series, the lane + team folds. |
| `src/lib/llm/meter.ts` | The meter chokepoint: lane vocabulary, pure cost math (`costMicrosFor`), fire-and-forget `meter()`. |
| `src/lib/db/usage-events.ts` | `recordUsageEvent()` (best-effort writer) + `laneTotals()` / `teamTotals()` / `listUsageEvents()`. |
| `src/app/usage/usageDashboard.tsx` | The page's panel order: tiles → trend → provider mix → lane/team → the showback matrix. |
| `src/app/usage/usageLanePanels.tsx` | The "Spend by lane" / "Spend by team" server panels. |
| `src/lib/db/usage-showback.ts` | `laneTeamTotals()` (the lane × team ledger read) + `buildShowbackMatrix()` (the pure grid fold). |
| `src/app/usage/usageShowbackPanel.tsx` | The "Showback · lane × team" server panel, and its accruing state. |
| `src/app/usage/costHeadline.ts` | The "Est. cost" tile's value + caption: all-lane sum, lane scope, pricing basis, unpriced floor. |
| `src/lib/db/kpi-metrics.ts` | `avgLlmCostPerActiveOrg()` — per-tenant LLM cost across every lane, beside `avgLlmCostPerScan()`. |
| `src/lib/rate-limit.ts` | Sliding-window limiter: sync per-IP burst + sync/shared global ceiling. |
| `src/lib/public-scan-limit.ts` | The free public-scan allowance + window — the ONE source both the gate and the marketing copy read. |
| `src/lib/public-scan-quota.ts` | The persistent rolling-30-day public-scan gate: window math, bucket derivation, fail-open stance, the 429. |
| `src/lib/rate-limit-store.ts` | Shared-store adapter: in-memory default, fetch-based Upstash REST driver. |
| `src/app/usage/page.tsx` | Usage dashboard. |
| `src/app/api/usage/route.ts` | JSON/CSV usage API with the IDOR guard. |
| `src/components/usage/UsageTrend.tsx` | Stacked-bar trend + export. |

## Known gaps

- **Usage is reporting, not invoicing**: billing runs through Polar (see
  [billing.md](billing.md)), which is wired end-to-end (plans, checkout, webhook
  fulfilment, refunds); this page only surfaces scan counts/trends and doesn't
  itself drive invoicing.
- **The briefing narrative is metered where it stands, not on the shared seam.** It calls the
  Anthropic Messages API directly on its own `ANTHROPIC_API_KEY`, so its lane is recorded under the
  legacy `claude` provider id. Routing it through `src/lib/llm/transports.ts` would change which
  credential and which vendor an operator's briefing bills to — an open design question (BACKLOG C3),
  not a wiring task.
- **The showback CSV is still two flat sections, not the matrix.** `toShowbackCsv` exports one `lane`
  scope block and one `team` scope block; the on-page panel is the only place the *intersection* is
  read (MC-B45 built the read half). Adding a third `scope=lane×team` block would change a file shape
  downstream sheets already key on, so it is a deliberate next step rather than a side effect —
  **G19**: the existing itemization is untouched.
- **No lane but `scan` is billed.** `laneAllowances` is `{}` on every tier, so the other four lanes
  are measured and shown but never charged. That is deliberate, and it is the state until a pricing
  decision is made on this data.
