# L1 (theoretical) — Priyanka (indie solo) × "Repeated org scans worth the price"

cert_level: L1 · promotion: discovery · verdict: **L1-conditional**

## 0. Character binding note

Priyanka's `maps_to` is explicitly `/report, /trends, /pricing, public scan (single repo)` — `/org/[slug]` +
`Trajectory`/`PeriodSummary` are named as "the upsell she'd weigh, not own." So this journey (framed around org
fleet recurring value) is walked through **her** actual recurring-read surface: **`/trends?repo=owner/repo`**
(the per-repo trajectory + dimension trends), plus `/pricing` for the cost side. The org-level heatmap/
`RepoCategoryRollup`/digest surfaces are noted only where the journey's discovery hints require checking them,
and are marked out-of-binding for her when reached.

## 1. Surface model (import chain, file:line)

### 1a. Entry — `/trends`
- `src/app/trends/page.tsx:31-166` — server component. Gate order: `resolveSignInState()` (`:41`) → under
  `ASCENT_AUTH_BYPASS=1` this passes; `?repo=` required (`:54`); `parseRepoUrl` (`:61`); `isDbConfigured()`
  (`:69`); `readableOrgForOwner` (`:81`) resolves the org slug for the repo.
- History fetch: `getRepositoryHistory(owner, repo, { limit: 60, orgSlug, includeDimensions: false })`
  (`:85-89`) → `src/lib/db/scans-read.ts:227-270`.
- Forecast: `forecastTrajectory(history.scans.map(...))` (`:108-110`) → `src/lib/maturity/forecast.ts:119-182`.
- Render: `Trajectory` (`src/components/org/overview/Trajectory.tsx:26-107`, shared with the org overview) +
  `DimensionTrends` (`src/components/report/DimensionTrends.tsx:19-234`, lazy-loads `/api/history` for
  per-dimension rows at `:39-64`).

### 1b. Trajectory honesty (the load-bearing engine for her #2/#3 criteria)
- `forecastTrajectory` (`src/lib/maturity/forecast.ts:119-182`): returns `null` below 2 distinct calendar
  days (`:124,130`); computes OLS `fitQuality` (R²) (`:149-153`); sets `lowData: n < 3` (`:178`) specifically
  because "OLS through 1–2 points fits perfectly by construction… the LEAST trustworthy fit reports the
  HIGHEST confidence" (`:58-62`, doc comment) — this is a near-verbatim match to her cited
  statistical-trend-meaningfulness reference.
- `Trajectory.tsx:86-104`: when `lowData`, renders `"trend confidence — low data (n=…)"` (muted, small,
  `text-slate-500`) instead of a numeric `%`; otherwise renders `confidence{…}%{…noisy if <50%}`.
- Flat-floor: `FLAT_PER_WEEK = 0.5`/wk (`forecast.ts:72`) classifies a near-zero slope as `"flat"`, and
  `forecastHeadline` (`:332-345`) renders `"Holding around {score}… no level change projected"` — the honest
  "nothing changed" branch her criterion #1 explicitly asks for.

### 1c. Discrete-move honesty (per-dimension "what changed since last time")
- `src/lib/maturity/noise.ts:16-27` defines the canonical noise band (`SCORE_NOISE_BAND = 2`,
  `isWithinNoise`, `classifyDelta`) — doc comment (`:10-13`) states the intent explicitly: "a movers tile, a
  dimension row, a digest line… so a +1 never wears the same confident green arrow as a +8."
- **Actually wired to it:** `src/lib/alerts.ts:63,268` (org regression alerts), `src/app/api/cron/digest/
  route.ts:33,152,157` (weekly digest), `src/components/ui/format.ts:4,33-44` (`toneFor`/`fmtDelta`, noise
  → muted "flat" tone + "≈" glyph) — consumed by `TrendChart.tsx`, `RepoCategoryRollup.tsx`,
  `repoTrajectory.ts` (grep, all org-surface files).
- **Not wired to it:** `src/components/report/DimensionTrends.tsx:197` renders each per-dimension row's move
  via `<DeltaTag delta={r.delta} hideZero />` → `src/components/report/deltas.tsx:47-69`. `DeltaTag` has no
  import of `noise.ts` or `format.ts`'s noise-aware helpers — it colors purely on `delta > 0`/`delta < 0`
  with no floor. A `+1` or `-1` renders identically (bold green/red, same weight) to a `+8`/`-8`.
- This is the **exact per-dimension row** the doc comment in `noise.ts` names as in-scope, and the exact
  view `/trends` (Priyanka's surface) uses to answer "did anything change" — but it's the one place among
  the four listed above that skipped the wiring.

### 1d. Retention / tier boundary
- `src/lib/plans.ts:41-43` (Free: `retentionDays: 30`), `:189-192` (`retentionCutoff`, doc: "callers clamp
  history/trend/trajectory READ queries to it so a tier's advertised retention… is real").
- Applied: `src/lib/db/personal.ts:164,169` (personal watchlist reads), `src/lib/db/org-rollup.ts:396,557`
  (org rollup reads).
- **Not applied:** `src/lib/db/scans-read.ts:227-270` (`getRepositoryHistory`, the function `/trends` calls)
  builds its Prisma query (`:255-264`) with only `{ where: { repoId }, orderBy, take: limit }` — no
  `scannedAt` filter, no `retentionCutoff` import, no plan lookup at all. `/api/history` (used by
  `DimensionTrends`'s lazy per-dimension fetch) is the same code path.

### 1e. Price legibility
- `src/lib/plans.ts:32-81` (`PLAN_FEATURES`, single source), `:88-93` (`planPriceLabel` — real `$10`/`$20`
  for Pro/Team, `"Custom"/"contact us"` only for Enterprise).
- `src/app/pricing/page.tsx:39-45` (metadata description derived from the same source, not hardcoded),
  `:79-83` (card renders `planPriceLabel(id).amount` + cadence directly).

### 1f. Digest / "between logins" delivery
- `src/app/api/cron/digest/route.ts:1-33`: weekly digest requires `Organization.alertWebhookUrl` (a
  Slack/Block-Kit webhook) or the global `ALERT_WEBHOOK_URL`; "Orgs with no resolvable sink are skipped."
  No email/in-app notification path exists for a repo-level Free user with no team webhook configured.

## 2. Reachability

Under `ASCENT_AUTH_BYPASS=1`, `/trends`, `/report`, `/pricing` are all reachable with no plan/entitlement
gate blocking a Free-tier viewer (`resolveSignInState` passes; no `planFeatures`/credit check gates the
`/trends` render path at all — she is never paywalled out of her *own* recurring read, which is itself
notable and positive). `/org/[slug]` heatmap/rollup surfaces are reachable but explicitly out of her binding
— not judged as "hers" here. Digest is reachable only via a webhook config a solo dev with no team channel
is unlikely to set up — effectively unreachable for her segment (noted, not scored as a blocker since it's
outside her bound surface set).

## 3. In-character walkthrough

*I open `/trends?repo=me/my-saas` the way I've done a couple of times now. Cold, half-annoyed I'm even
doing this again.*

**Recurring-value (N=1 criterion).** With ≥2 scans, the page gives me two honest outs: if nothing moved,
the Trajectory card says "Holding around 62 — no level change projected," not a fake headline. If something
*did* move, `DimensionTrends` gives me a per-dimension delta grid — that's the mechanism for "a dimension
that slid I hadn't clocked." Mechanically, this criterion is *met* — there's a real place a non-obvious
mover could surface. But see below: whether I'd *trust* the mover it shows me is a separate question.

**Trust/noise criterion.** This is where it comes apart. The org-level Trajectory card is genuinely careful
— low-data caveat, R² math, flat-floor — that's the "at least it's not lying to me" bar I hold everything
to. But the dimension cards right below it, which is the part I'd actually stare at ("did Testing move?"),
render a `▲+1` in the same bold green as a `▲+8`. I already know from my own repo history that re-scans
wobble ±1-2 points doing nothing. If I see "Testing ▲+1" styled exactly like a real gain, I either (a)
chase it and find nothing changed — wasted the 10 minutes I was supposed to save — or (b) start ignoring
all the deltas, at which point this view has stopped doing its one job. Either way, my own reference bar
("a score change must come with a trustworthiness signal… so I can tell signal from re-scan noise") is not
met on the surface I actually read.

**Trajectory honesty at low N.** With exactly 2 scan-days, the low-data label is there — good, matches the
paper I'd cite back at them. Minor gripe: the ETA badge next to it is a bold colored pill and the low-data
caveat is small gray text underneath. My eye goes to the pill first. It's not lying, but it's not being
loud about its own uncertainty either.

**Price legibility.** Actual dollar numbers for Pro ($10/mo) and Team ($20/mo), no "contact us" wall, no
opaque credits-only pitch. This is exactly what I asked for. If I ever get curious about Pro, I don't have
to email anyone to find out what it costs. Genuinely surprised — most tools fail this one.

**Retention honesty.** I can't actually check this without a real 30+-day-old fixture, but reading the
code: `/trends` doesn't clamp by plan at all. So whatever Free's pricing page promises about 30-day history,
the surface I actually use doesn't enforce it either way — meaning if I ever *did* upgrade for "more
history," this page wouldn't even show me the difference. That undercuts the sales pitch for Pro's 180-day
line as much as it "helps" me on Free.

**Time-saved bar.** If the trust/noise gap weren't there, this clears my bar: quick page, no digging,
tells me plainly if nothing changed. With the gap, I burn part of my 10 minutes second-guessing a `+1` that
was noise — thin margin gets thinner.

## 4. Findings

1. `{ id: "L1-priyanka-repeated-1", journey: "repeated-org-scans-worth-the-price", character: "priyanka-indie-solo", cert_level: "L1", type: "trust", severity: "major", impact: { frequency: "high", reachability: "high", trust_erosion: "high" }, dimension: "trust", title: "Per-dimension movers on /trends render with no noise-band caveat", expected: "A ±1-2 pt dimension delta reads as scan-to-scan noise (muted tone / '≈'), matching the Trajectory card and org-level movers.", got: "DeltaTag colors any nonzero delta the same confident bold green/red regardless of size — the noise-aware primitives (isWithinNoise, toneFor/fmtDelta) that already gate the Trajectory card, alerts, and digest are not wired into this component.", evidence: ["src/components/report/DimensionTrends.tsx:197", "src/components/report/deltas.tsx:47-69", "src/lib/maturity/noise.ts:10-13 (doc comment names this exact surface as in-scope)", "src/components/ui/format.ts:33-44 (the noise-aware formatter that IS used elsewhere)"], code_check: "present-but-missed", verdict: "confirmed", resolution: "open", l2_priority: "seed a repo with a real ±1 dimension delta between two claude-cli scans and confirm live whether it renders as a confident colored arrow; ask whether Priyanka would flag it verbatim as 'noise dressed as a trajectory.'" }`

2. `{ id: "L1-priyanka-repeated-2", journey: "repeated-org-scans-worth-the-price", character: "priyanka-indie-solo", cert_level: "L1", type: "trust", severity: "major", impact: { frequency: "med", reachability: "high", trust_erosion: "med" }, dimension: "trust", title: "/trends history is not clamped to the viewing org's retention plan", expected: "Free's advertised 30-day history (and Pro's 180-day advantage) is real on every surface that reads scan history, per retentionCutoff's stated contract.", got: "getRepositoryHistory (the query backing /trends and /api/history) builds its Prisma query with no scannedAt filter and never calls retentionCutoff — unlike the personal-watchlist and org-rollup reads, which do.", evidence: ["src/lib/db/scans-read.ts:227-270 (no retentionCutoff import/call)", "src/lib/db/personal.ts:164,169 (contrast: applies it)", "src/lib/db/org-rollup.ts:396,557 (contrast: applies it)", "src/lib/plans.ts:189-192 (contract statement)"], code_check: "present-but-missed", verdict: "confirmed", resolution: "open", l2_priority: "seed a Free-plan org with scans >30 days old and confirm live whether /trends still renders them, and whether Pro's 180-day line is actually a differentiator anywhere she'd see it." }`

3. `{ id: "L1-priyanka-repeated-3", journey: "repeated-org-scans-worth-the-price", character: "priyanka-indie-solo", cert_level: "L1", type: "confusion", severity: "minor", impact: { frequency: "med", reachability: "high", trust_erosion: "low" }, dimension: "clarity", title: "Low-data caveat is visually subordinate to the confident ETA pill", expected: "At n=2 (lowData), the honesty caveat is at least as prominent as the projection it's qualifying.", got: "The ETA is a bold colored rounded-pill badge; the 'trend confidence — low data (n=2)' caveat is small slate-500 text beside it — same row, unequal visual weight.", evidence: ["src/components/org/overview/Trajectory.tsx:72-104"], code_check: "present-but-missed", verdict: "confirmed", resolution: "open", l2_priority: "screenshot a real n=2 fixture and judge whether the caveat is actually noticed before the ETA." }`

4. `{ id: "L1-priyanka-repeated-4", journey: "repeated-org-scans-worth-the-price", character: "priyanka-indie-solo", cert_level: "L1", type: "missing-feature", severity: "minor", impact: { frequency: "low", reachability: "low", trust_erosion: "low" }, dimension: "missing", title: "No 'between logins' delivery mechanism exists for a solo/no-webhook user", expected: "Journey's DoD asks whether the digest/alert 'between logins' surfaces something new; for a repo-level Free user this should exist in some reachable form.", got: "The only digest path requires Organization.alertWebhookUrl (a Slack/Block-Kit webhook) — no email or in-app notification exists, so a solo dev with no team channel has no passive delivery at all.", evidence: ["src/app/api/cron/digest/route.ts:1-33"], code_check: "confirmed-absent", verdict: "confirmed", resolution: "by-design", ceiling: "outside her surface binding (/org features are the upsell she'd weigh, not own) — noted as a ceiling on the journey's DoD, not a blocker for her scored criteria.", l2_priority: "n/a — out of her bound surface set; record only if she is ever moved onto /org." }`

**Strengths (protect these):**
- `forecastTrajectory`'s `lowData` flag + honest "holding" headline (`forecast.ts:58-62,178`, `Trajectory.tsx:86-96`, `forecastHeadline` flat branch) is a near-textbook implementation of her cited statistical-trend-meaningfulness bar. Do not regress.
- `/pricing`'s dollar figures are derived from the same `plans.ts` the entitlement gate reads (`pricing/page.tsx:39-45`) — copy cannot drift from what's charged. Exactly what she asked for; a rare pass on her single hardest pet peeve.
- `/trends` has no plan/entitlement gate blocking a Free viewer from her own recurring read — she is never paywalled out of judging whether to pay.

## 5. Character voice — would I adopt it?

"Okay, credit where due — the trajectory card is the first maturity tool I've seen that admits when it's
guessing. Two points, and it says 'low data' instead of pretending it knows my repo's future. That's the
one sentence that would make me trust *anything* else on the page.

But then I scroll to the dimension grid — the actual 'what changed' list, the thing I'm here for every
cycle — and a `+1` on Testing lights up exactly as confident-green as an `+8` would. I know my own re-scans
wobble by a point or two doing nothing. If this thing can't tell me apart from its own noise on the one row
I actually read, I'm going to start ignoring the whole grid within two cycles, and then this is just a
number I already knew, presented slower than my own memory.

Pricing: genuinely, no complaints. Real numbers, no 'contact us' wall for the tier that'd matter to me. If
the noise thing got fixed and it caught one real thing a quarter, I could see paying $10/mo for that. As it
stands — one grudging nod for the trajectory honesty, one 'come on, you clearly know how to do this, why
didn't you do it here too' for the dimension grid. I'm staying Free, and I'm not opening this again next
month unless something changes."

**Does it fit my world?** Reachable without a team, without a webhook, without a login gate blocking my own
data — yes, structurally this is built for someone like me, not just retrofitted for a team product. What's
missing for MY job specifically: the one thing I need every cycle (trust the delta) is the one place the
codebase's own noise-band discipline didn't reach.
