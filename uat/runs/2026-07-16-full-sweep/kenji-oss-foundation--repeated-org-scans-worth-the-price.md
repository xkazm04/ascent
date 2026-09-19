# L1 (theoretical) — Kenji (OSS foundation steward) × "Repeated org scans worth the price"

cert_level: **L1**
date: 2026-07-16

---

## 0. Framing note — journey reinterpreted through Kenji's actual surface binding

The journey file is written generically for the "pricing-20" roster and defaults its discovery hints
to `/org/[slug]`, `/org/[slug]/executive`, `/usage`, and the org cadence controls. Kenji's character
file explicitly excludes that surface:

> `maps_to: / (free public scan), /report/[owner]/[repo], /badge, /trends, /api/badge — the entire
> FREE recurring surface (he never touches the paid /org/* dashboard)`

So this run walks the journey's actual question — *"is the recurring output still telling me
something new, and is the cost/value story still right for me?"* — over Kenji's five reachable
surfaces, plus a look at `/pricing` and the `/org/*` dashboard **from the buyer's chair only** (his
third JTBD is explicitly to probe whether a paid hook exists for him, not to use `/org/*` himself).

---

## 1. Surface model (import-chain traced, file:line cited)

### 1.1 Free recurring read — the core loop
- **Scan entry** — `src/app/page.tsx` → `ScanForm` → `POST /api/scan` (`src/app/api/scan/route.ts:323-346`).
- **Quota gate (the load-bearing one)** — `runScan()` calls `consumeScanQuota()`
  (`src/app/api/scan/route.ts:154`) → `src/lib/scan-finalize.ts:52-84` → only applies when
  `orgSlug === "public" && !token && !mock` (line 56) → `consumePublicScanQuota()`
  (`src/lib/public-scan-quota.ts:207-267`).
  - **Limit**: `publicScanMonthlyLimit()` = **5** scans per rolling **30-day** window, bucketed
    **per-IP** (anonymous) or **per-signed-in-user** (`src/lib/public-scan-quota.ts:46-65`, `:95-112`).
    `signedInScanMonthlyLimit()` defaults to the *same* 5 (line 61-65) — signing in does not raise it.
  - This is a genuine, persistent, cross-instance monthly cap — not just the 60/min burst limiter
    (`SCAN_RATE_LIMIT`, `src/lib/rate-limit.ts:125-130`, which is a separate, much looser guard).
  - **Fresh-commit re-scans only.** A cache hit (unchanged commit) returns free and uncounted
    (`src/app/api/scan/route.ts:79-87`); only a *new* commit — exactly what a release-cycle re-scan is —
    burns one of the 5 monthly slots.
  - Visible pre-commitment via `QuotaMeter` (`src/components/QuotaMeter.tsx:1-86`) reading
    `GET /api/quota` → `peekPublicScanQuota()` (`src/app/api/quota/route.ts:14-18`,
    `src/lib/public-scan-quota.ts:285-304`) — an honest, real-time "N of 5 free scans left this month"
    meter with an upgrade CTA to `/pricing`.
- **Report** — `src/app/report/[owner]/[repo]/page.tsx` — no sign-in gate found (`resolveSignInState`
  is not imported here); stays free/no-signup as advertised.
- **Badge** — `GET /api/badge/[owner]/[repo]` (`src/app/api/badge/[owner]/[repo]/route.ts`).
  - Auto-refreshes on push via a **conditional head-resolve** keyed to the current SHA
    (`resolveHeadWithHint`, line 293) so a stale level isn't served past a push.
  - Runs `scanRepository(..., { mock: true, noAmbientToken: true })` (line 318) — the badge's
    auto-refresh is a **mock (deterministic) scan**, which is explicitly excluded from the monthly
    quota (`consumeScanQuota`'s `!opts.mock` guard, `scan-finalize.ts:56`) — so badge auto-refresh is
    genuinely free, unlimited, and evidence-linked (click-through `href` to the live report, line
    284/365-389) for as many repos as Kenji wants, forever.
  - Honestly labels a mock-derived badge `"· demo"` (line 351-352) rather than presenting the
    deterministic floor as a real LLM verdict — matches his "provenance" bar.
- **Trends / trajectory** — `src/app/trends/page.tsx`.
  - **Gated behind sign-in in production** — line 41-52: `resolveSignInState()`
    (`src/lib/signin-gate.ts:38-57`) → `authGateEnabled()` = `supabaseAuthConfigured() && !authBypassEnabled()`
    (`src/lib/env.ts:43`). In a real production deployment (Supabase configured, bypass off — the
    bypass is dev-only) this is **true**, so an anonymous visitor to `/trends` is redirected to
    `SignInNotice` (line 43-51) before ever seeing history.
  - This directly contradicts `uat/env.md:47`, which lists `/trends` under **"Public (free funnel —
    no auth)"** — the surface-model doc and the shipped gate disagree.
  - History query itself, once past the gate: `getRepositoryHistory()`
    (`src/lib/db/scans-read.ts:227-268`) takes `limit` (default 30, capped 200, line 238) with **no
    `retentionCutoff` applied** — `retentionCutoff` (`src/lib/plans.ts:189-192`) is only called from
    `org-rollup.ts:396,557` and `personal.ts:164`, never from `scans-read.ts`. So Free's advertised
    30-day retention is **not enforced** on `/trends` — Kenji's own single-repo trend history is
    unclipped (up to 200 stored scans, no date floor).
  - Trajectory forecast: `forecastTrajectory()` (`src/lib/maturity/forecast.ts`, called at
    `trends/page.tsx:108`) returns `null` until ≥2 distinct-day scans exist; the page then shows the
    honest "Only a baseline scan so far" notice (`trends/page.tsx:148-152`) rather than faking a line.
  - `Export CSV` (`/api/history?...&format=csv`, `trends/page.tsx:138-144`) and `Compare →`
    (`/report/compare`, line 124-131) sit alongside it — but `/report/compare` is **also** sign-in
    gated (`src/app/report/compare/page.tsx` imports `resolveSignInState`).

### 1.2 Pricing / monetization surface (buyer's-chair-only for Kenji)
- `src/app/pricing/page.tsx` renders directly from `PLAN_FEATURES` (`src/lib/plans.ts:32-81`) — Free
  card shows **"5 scans / mo included"**, not "Unlimited" (line 86-87 of pricing/page.tsx via
  `p.includedCredits`). The page never claims "unlimited public scans" anywhere in rendered copy —
  Kenji's own anchor assumption (from his `references:`, Scorecard-style "unlimited") is **not what
  Ascent actually advertises**; it advertises 5/mo plainly, so there is no pricing-copy/code mismatch
  to find here — the mismatch is between his *expectation* and Ascent's *disclosed* (not hidden) model.
- Pro ($10/mo, 100 scans, 180-day retention, "Org fleet dashboard") / Team ($20/mo, 500 scans, 365-day,
  "Segments + comparisons") — real numeric prices, sourced from `plans.ts` (comment at
  `pricing/page.tsx:1-6` confirms the anti-drift design; `planPriceLabel()` at `plans.ts:88-93`).
- **The org dashboard CAN host a portfolio of public repos** — `scripts/seed-org.mjs` imports a public
  GitHub org's repos via `POST /api/org/import`, and nothing in `runScan()`'s metering branches on
  repo-visibility once `orgSlug !== "public"` — `isMeteredScan(orgSlug, mock)` treats any non-`"public"`
  org (including an org of public repos) as **credit-metered**, sharing the same 5-credit/month Free
  allowance as everything else (`src/lib/plans.ts:109-114`, `123-134`). So the only "OSS-shaped paid
  hook" that exists is the *generic* Pro/Team org dashboard — there is no foundation-specific tier,
  messaging, or discount for "N public repos, no private data."

---

## 2. Reachability check (Kenji's actually-reachable set)

| Surface | Reachable to Kenji (anon, prod) | Basis |
|---|---|---|
| `/` scan form | Yes | no gate |
| `/report/[owner]/[repo]` | Yes | no `resolveSignInState` import |
| `/badge` generator + `/api/badge/*` | Yes | no gate; mock-scan path, unmetered |
| `/trends` | **No — sign-in required** | `trends/page.tsx:41-52` → `authGateEnabled()` true in prod |
| `/report/compare` | **No — sign-in required** | same gate imported |
| `/pricing` | Yes (read-only, as intended) | no gate |
| `/org/*` | Out of binding — not evaluated as "his" surface, only as the pricing question's answer | character file `maps_to` |

This matters because two of the four "recurring" surfaces the journey's Definition of Done names
(trajectory/**trends** history, and the ability to tell real movement from noise via **compare**) sit
**outside** Kenji's reachable set as an anonymous no-signup user, despite `env.md` filing `/trends`
under the public/no-auth bucket. The gate is real code, not a doc error on Ascent's side — but it's a
genuine model-vs-shipped mismatch this run needed to catch before judging.

---

## 3. In-character walkthrough (thought experiment over the model)

*I open `/` the way I have every release cycle. I paste the next repo in the foundation's portfolio.
The `QuotaMeter` under the form already tells me "4 of 5 free scans left this month" before I even
submit — I like that; Scorecard never tells you a budget because it doesn't have one, but at least
this one is honest about having one. First scan goes through, report renders, badge markdown is
right there. Fine.*

*I keep going down my list. Scan two, three, four — the meter ticks down each time, still visible,
still honest. Scan five: "0 of 5 left · resets in 27 days." I have twenty-five more repos in this
portfolio. That's the moment the free-forever story breaks — not because the app lied to me (the
pricing page said "5 scans / mo," not "unlimited," so nobody put words in Scorecard's mouth on my
behalf), but because the number itself doesn't fit a foundation's fleet. Five fresh scans a month
covers a sixth of one release cycle for a 30-repo portfolio, not the portfolio.*

*What DOES keep working past scan five: my badges. They auto-refresh on every push regardless — that's
the mock-scored path, and it's marked "· demo" so I know exactly what I'm looking at. That's honest
and it's genuinely free forever, which is the Scorecard bar. But it's not the LLM-graded read I came
for; it's the deterministic floor with a disclosure tag.*

*I go looking for `/trends` on the one repo I DID get a fresh scan on, to see the trajectory render.
I get bounced to a sign-in screen. GitHub OAuth, no credit card, genuinely free — but it's still a
signup wall between me and my own public repo's score, and that is the exact reflex my file names:
instant hard no, on principle, before I even weigh whether GitHub OAuth is "a big ask." Scorecard
never once has asked me to authenticate to see my own repo's number. I'd flag this even though I
personally have a GitHub account and could clear it in ten seconds — it's the wrong shape for a
recurring, no-friction, public-repo signal.*

*If I DO sign in (purely to finish this evaluation), the trend renders with more history than I
expected — the 30-day retention line on `/pricing` doesn't actually clip anything on my single-repo
trend view. That's the generosity-overshoot I always half-expect from a vendor that hasn't quite
closed every gap between its pricing page and its queries — and I clock it the way I clock any
missed meter: "huh, that's more than advertised, and in MY favor." Free being quietly better than
sold is not a complaint from me — it's the opposite of the pricing-honesty failure I watch for.*

*Now the business question, the one I actually came to answer: is there a meter anywhere in this
funnel? Yes — just not shaped for me. There's a real, priced Pro tier ($10/mo, 100 scans) and Team
($20/mo, 500 scans) with an "org fleet dashboard," and I can see from the seeding script pattern that
dashboard can ingest a portfolio of PUBLIC repos same as private ones — nothing in the credit gate
cares that my repos are public once they're inside an org, not the shared "public" bucket. So the
funnel isn't leaving money on the table out of oversight; it's leaving it on the table because nobody
built a "foundation of public repos" pitch for it. A 30-repo foundation hitting the wall at scan five
is exactly the shape of buyer Team's "500 scans/mo, segments, white-label briefings" tier was built
for — but the page never says that to someone like me. I'd have to do the math myself (which I just
did).*

---

## 4. Scored acceptance criteria (identical lens every run)

- [x] **Free recurring value is real** — public scans, badge, report all reach him at $0
      (`plans.ts:33-44`, `api/scan/route.ts` public branch). **Partial**: `/trends` (part of his
      declared free recurring surface) does **not** reach him at $0 in production — it demands
      sign-in. Badge auto-refresh reaches him at $0 forever, but on the mock engine, not the LLM one.
- [ ] **"Unlimited public scans" is true** — **FALSE, by design, and disclosed.** Free public scans
      are capped at 5/30-day-window (`public-scan-quota.ts:50-53`), not unlimited. The pricing page
      never claims "unlimited," so this isn't a pricing-honesty violation — it's a finding that the
      *actual* cap is far below what a foundation-scale recurring cadence needs, and below the
      Scorecard-class norm his `references:` anchor to.
- [x] **30-day retention is enforced (and only 30)** — **inverted finding, confirmed as
      generosity-overshoot**: `/trends`' `getRepositoryHistory` never calls `retentionCutoff`
      (`scans-read.ts:227-268` vs. `plans.ts:189-192`, only wired into `org-rollup.ts`/`personal.ts`).
      Free silently gets more history than the 30-day figure advertises, once past the sign-in gate.
- [~] **Trajectory needs (and gets) recurring history** — mechanically correct
      (`forecastTrajectory`, honest single-scan fallback text) but gated behind sign-in, so it
      doesn't reach him at $0/no-signup as his criterion requires.
- [x] **Recurring-value check** — each cycle's fresh (non-cached) scan does move the badge/report
      (real per-commit re-score); the mechanism is sound where reachable.
- [~] **"Would I ever pay?" check** — a real, legible OSS-shaped hook technically exists (Pro/Team's
      org dashboard can ingest an all-public-repo org), but is **not marketed or priced for that use
      case** — no foundation tier, no "public portfolio" framing anywhere in `/pricing` copy
      (`pricing/page.tsx` blurbs are generic "small team" / "more volume, more seats"). Counts as a
      **monetization-gap finding**, matching his file's own prediction almost exactly.
- [x] **Price-legibility** — Free's $0 and the numeric Pro/Team $ are plainly visible
      (`plans.ts` → `planPriceLabel` → `pricing/page.tsx`), Enterprise stays "Custom." No issue for him.

## Motivation (time-saved) — applied to the designed experience
Declared baseline: ~5-8 min/repo × ~30 repos ≈ 3-4 hrs/release cycle by hand; Ascent promises ~2-3 hrs
saved via badge auto-refresh + `/trends`. **As designed**, that promise only fully holds for the
mock-scored badge glance (unlimited, no friction) — the *LLM-graded*, trajectory-backed read the time-
saved number is actually anchored to is available for only 5 of his ~30 repos per cycle before the
quota wall, and the `/trends` half of the read requires an unplanned sign-in detour. **Estimated
time-saved if fully live and reachable: ~2-3 hrs/cycle** (matches his file) — but only ~1/6 of his
portfolio can realize it monthly at the badge's real (non-demo) fidelity; the rest reverts to the
demo-labeled mock, which is faster to get but is *not* the senior-grade read the time-saved number
was computed against.

## Senior-quality bar
The recurring number that DOES reach him (badge, report, once-signed-in trend) is evidence-backed,
dated, and provenance-labeled (`· demo` disclosure, SHA-pinned badge cache, per-commit scan rows) —
clears his bar for the surfaces it reaches. The honesty axis clears too: no pricing/code mismatch
found in the direction he watches hardest (advertised-tighter-than-actual). The bar he does NOT clear:
a "recurring number" that requires an unplanned authentication step mid-cycle is not the frictionless,
$0, always-on signal Scorecard trained him to expect — a senior steward would flag that gate before
recommending the tool to a peer foundation, exactly as his Voice predicts he would.

---

## 5. Findings

### F1 — `/trends` (and `/report/compare`) require sign-in in production, contradicting env.md's public-surface classification and Kenji's core "no signup wall" bar
- file: `src/app/trends/page.tsx:41-52`; `src/lib/signin-gate.ts:38-57`; `src/lib/env.ts:43`;
  contradicts `uat/env.md:47` ("Public (free funnel — no auth)... /trends")
- type: `confusion` (surface-model mismatch) / `trust`
- severity: **major**
- impact: frequency=high (every cycle he'd want the trend), reachability=high (this is exactly the
  surface his character file names as core to his JTBD #2), trust_erosion=high (this is his single
  named hard-line pet peeve — "instant hard no")
- code_check: present-but-broken-for-his-persona (present-and-working-as-designed, but the design
  contradicts both the doc and his bar)
- verdict: confirmed
- l2_priority: Confirm live, anonymous, no-bypass: does `/trends?repo=<public repo>` actually render
  `SignInNotice`, and does the GitHub-OAuth sign-in genuinely require zero payment info (so the
  friction is "an account" not "a wall")? Also confirm `/report/compare` behaves identically.

### F2 — Free public-scan quota (5/30-day window, shared across ALL repos) is far below the Scorecard-class "generously-capped" bar for a ~30-repo foundation portfolio's recurring cadence
- file: `src/lib/public-scan-quota.ts:46-65`, `:95-112`; `src/app/api/scan/route.ts:151-159`
- type: `missing-feature` (no per-foundation/no-signup-portfolio allowance) / not a `trust` issue —
  the cap is honestly disclosed on `/pricing`, not hidden
- severity: **major**
- impact: frequency=high (every release cycle, every repo past the 5th), reachability=high (this is
  the literal free public-scan path his file names), trust_erosion=low (he doesn't feel lied to — the
  number is exactly as advertised, he's just disappointed the advertised number is that small)
- code_check: confirmed-present (by design, documented as intentional friction, `public-scan-quota.ts:1-19`)
- verdict: confirmed
- l2_priority: Confirm the meter and 429 message are accurate live for a real 30-repo cadence, and
  that badge auto-refresh genuinely never draws on this quota (mock-path exemption).

### F3 — No OSS-foundation-shaped framing of the paid tiers, even though the mechanism (org-scoped dashboard over an all-public-repo org) already exists
- file: `src/app/pricing/page.tsx` (blurbs at `plans.ts:54,66`: "small team" / "more volume, more
  seats" — no "public portfolio" or "foundation" language anywhere); `scripts/seed-org.mjs` (imports
  a public GitHub org — proves the mechanism works for all-public orgs)
- type: `missing-feature` (monetization gap, not a UX gap)
- severity: **minor** (doesn't block his job — he's not the buyer of that tier — but it IS the exact
  gap his character is designed to probe for)
- impact: frequency=low (he only asks this once per pricing review, not per cycle),
  reachability=med (he can reach `/pricing` any time, but has no incentive to buy), trust_erosion=low
  (reads as a missed upsell, not a broken promise — he'd frame it approvingly: "a leaky funnel, not a
  bad one")
- code_check: confirmed-absent (no foundation-tier copy anywhere in `plans.ts`/`pricing/page.tsx`)
- verdict: confirmed
- l2_priority: n/a (monetization framing is a copy/positioning question, not a live-behavior one — L2
  adds nothing new here beyond confirming the copy still reads this way live)

### F4 (strength, not a defect) — `/trends`' 30-day retention is unenforced on the single-repo read, so Free silently gets MORE history than advertised — exactly the "quietly more generous than advertised" pattern his file predicts he'd notice approvingly
- file: `src/lib/db/scans-read.ts:227-268` (no `retentionCutoff` call) vs. `src/lib/plans.ts:189-192`
  (only wired into `org-rollup.ts:396,557`, `personal.ts:164`)
- type: `trust` (positive — generosity-overshoot, his own named "gap the funnel leaves on the table")
- severity: polish / **strength**
- impact: frequency=med (only visible once he's past the F1 sign-in wall), reachability=med (gated by
  F1), trust_erosion=**negative** (increases trust — this is the kind of gap he explicitly likes finding)
- code_check: confirmed-absent (retentionCutoff never reached from the single-repo trends path)
- verdict: confirmed
- l2_priority: Confirm live that a signed-in Free viewer's `/trends` page actually renders scans older
  than 30 days when they exist, to verify the code-level absence is real, not compensated elsewhere.

### F5 (strength) — Badge auto-refresh is genuinely free, unlimited, evidence-linked, and honestly labeled when it's the mock/demo engine
- file: `src/app/api/badge/[owner]/[repo]/route.ts:293-352`
- type: none (strength) — protect this, don't touch it
- verdict: confirmed

---

## 6. Verdict

**L1-conditional** — the free recurring loop (scan → report → badge) is structurally sound and clears
his bar where it's reachable; but two majors (F1 sign-in gate on `/trends`, contradicting `env.md`'s
own surface model and his hardest pet peeve; F2 the 5/mo quota being too tight for a fleet his size)
mean the *recurring, cadence-scale* version of his job — not just a single scan — has real friction
before it's proven live. Still L2-eligible: nothing here is a dead end, only gates and caps to confirm
against a live browser.

---

## 7. Character voice — first-person reaction

*Would I adopt it? I already have — the badge's on three of our flagship repos and it costs me
nothing, which is exactly the deal I came for. Would I tell a peer maintainer to grab it? Yes, for the
badge and the one-off report, no hesitation, no signup — that part is Scorecard-grade and I mean that
as the highest compliment in my vocabulary.*

*Would I trust the RECURRING story at foundation scale? Only about a sixth of it. Five real scans a
month against thirty repos means I'm eyeballing CI by hand for the other twenty-five anyway — which
means the 3-hour-a-cycle number in my head only pays out for a slice of my actual portfolio, and the
free `/trends` view I'd use to sanity-check "did anything real move" makes me sign in first, which
I did NOT expect from a tool I'd filed next to Scorecard in my head. That's not a dealbreaker — I have
a GitHub account, obviously — but it's a tell. It tells me this product's free tier was sized for "try
it on your one repo," not "run it across my fleet," and those are different products wearing the same
badge.*

*Here's the part that actually amuses me: the funnel IS quietly generous in one direction (my trend
history isn't clipped at 30 days the way the pricing page implies it should be) and honestly disclosed
in the other (nobody told me public scans were unlimited — I told myself that, and the pricing page
corrected me the moment I looked). And there IS a paid lever that could catch me — an org dashboard
that clearly CAN swallow a public-repos-only portfolio — except nobody at Ascent bothered to say so.
If I ran this company, I'd ship one line on `/pricing`: "foundation with 30+ public repos? Team gets
you 500 scans and a fleet view for $20/mo." That's a $20/mo answer sitting three feet from a foundation
board's yes. Right now it's a great product and, still, a leaky funnel — just leakier in a slightly
different spot than I expected when I opened this tab.*
