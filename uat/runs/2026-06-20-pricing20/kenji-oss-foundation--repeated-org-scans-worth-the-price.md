# L1 — Kenji (OSS foundation steward) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the recurring free read is structurally sound and genuinely valuable at $0, but two pricing-honesty cracks (a capped "unlimited", an unenforced "30-day" cap) plus a wide-open monetization gap make this a *funnel* finding rather than a *user* one. Completes; no blocker for Kenji's job; the majors are the business's, not his.

**PRICING: renew Free / never convert.** He stays on Free forever and there is no code path that would ever ask him to pay — which is the point.

## Reachable surface set (tier-honest, Free)
Kenji is **Free**, all-public, and never touches `/org/*`. Under `ASCENT_AUTH_BYPASS=1` the bypass would *render* the org dashboard, but I judge his **plan's** entitlements honestly — the entire `/org/*` cadence machinery (scheduled autoscans, alerts, segments, >30-day history, fleet rollup) is **Pro+ and `unreachable` for him by tier**. His actual reachable recurring set:

- **Public scan** `/` → `/report/[owner]/[repo]` — free, no signup to *read* a public repo's score (`entitlement.ts:15-17` `isMeteredScan` returns false for the public funnel; public scans are "always free").
- **Badge** `/badge` (generator) + `GET /api/badge/[owner]/[repo]` — free, unauthenticated, publicly embeddable, auto-refreshes on head SHA (`api/badge/.../route.ts:276-287`), click-through to the live report (`:267`).
- **Trends** `/trends?repo=owner/repo` — the rear-view + a forward forecast, free but **sign-in-gated** when auth is configured (`trends/page.tsx:50-59`).
- **Pricing** `/pricing` — Free tier shows `$0` honestly.
- **NOT reachable by tier:** org overview/executive trajectory & movers, scheduled rescans, alerts, digest, usage/credit-burn — all Pro+ (`plans.ts:42-43`). These are the upsell, not a free feature.

## Surface-model notes (recurring-value affordances → file:line, grounding-audit emphasis)

**What Free actually delivers for $0 (verified):**
- `includedCredits: 0`, `retentionDays: 30`, `seats: 1`, blurb *"Public-repo scans, badge, and the full report — free forever."*, features `["Unlimited public-repo scans", "Maturity report + roadmap", "README badge", "1 member"]` — `plans.ts:25-34`.
- Public scans never debit a credit — `entitlement.ts:14-17`; the credit ledger only meters private/installation scans — `credits.ts:3-6`.
- Badge is genuinely Scorecard-shaped: per-commit cache key shared with the scan flow so it reflects a real LLM scan (`route.ts:284-287`), auto-refresh on push via head-SHA resolution (`:276`), evidence click-through (`:267`), `· demo` honesty label when only the mock floor exists (`:324-325`).
- Trajectory needs recurring history to exist and gets it free: `forecastTrajectory` over the per-repo history (`trends/page.tsx:115-117`), null until ≥2 distinct scan days, with an honest "baseline only" note at one scan (`:155-159`).

**GROUNDING AUDIT (retargeted to repetition, scored as coverage of the recurring read's sources):**
1. **Trajectory / forecast** — reaches the read. `/trends` fits OLS over real history (`trends/page.tsx:115`), renders `<Trajectory>` only when a fit exists. ✅
2. **History / rear-view** — reaches the read. `getRepositoryHistory` (`scans-read.ts:127`) feeds `/trends` + CSV export (`trends/page.tsx:146`). ✅
3. **Period movers / deltas** — **does NOT reach Kenji.** Movers/PeriodSummary live on the Pro+ `/org/*` rollup; on Free there is no cross-scan "what moved since last cycle" surface — `/trends` shows lines, not a narrated delta. ❌ (by-tier, not a defect for him — but it means his *recurring* read is "eyeball the trajectory line," not "read the mover.")
4. **Noise-vs-signal defense (R² / flat-floor)** — the forecast carries trend-confidence, but on `/trends` the move is shown as a line; whether a small wobble is real signal vs. claude-cli breathing within its ±25 guardband (`engine.ts`) is **not annotated at the per-repo level**. ◐ partial.

**Grounding for Kenji's recurring read: 2 / 4 sources reach him** (trajectory + history yes; period-movers no by tier; noise-annotation partial). For a Free all-public steward the recurring read is "trajectory line + auto-badge" — solid, but thinner than the narrated org read he's structurally locked out of.

**The two pricing-honesty cracks (his actual facet):**
- **"Unlimited public scans" is capped.** The public funnel has a soft weekly quota: **3/week anonymous, 20/week signed-in** (`public-scan-quota.ts:44-58`), fail-open. /pricing + `plans.ts:33` say *"Unlimited public-repo scans."* For a steward re-scanning ~30 repos a cycle, 3/week anon (or even 20 signed-in) is a real ceiling that the word "unlimited" denies. (Mitigated by fail-open + env kill-switch, so in a mock/dev env it may not bite — an L2 question.)
- **"30-day history" is unenforced — Free silently gets MORE.** `retentionDays` is display-only: the history query clamps to a *row count* (max 200), no date floor (`scans-read.ts:138`); the org trend query applies only request `start`/`end`, no plan-derived retention floor (`org-rollup.ts:220-227`). Already confirmed by the wider roster (priyanka/lena/helena/gabriel L1s). For Kenji this is the *inverse* generosity finding: his trajectory can fit history older than 30 days on Free, so the page under-promises and Free over-delivers.

**The monetization gap (the load-bearing observation):** there is **no OSS-shaped paid hook**. The org dashboard (`/org/*`) is the only paid surface and it's framed around **private** scans + credits (`plans.ts:42-43`, `entitlement.ts`). A foundation steward whose *every* repo is public gets unlimited free scans, a free auto-badge, a free report, and free /trends history — with **zero conversion path**. There is no "portfolio of public repos" dashboard, no foundation/cross-public-repo rollup tier. The funnel hands him recurring value indefinitely and never meters it.

## Findings

```json
[
  {
    "id": "KENJI-L1-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "kenji-oss-foundation",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "No OSS-shaped paid hook — a public-repo-only steward gets unlimited recurring value with zero conversion path (monetization gap)",
    "expected": "Either a paid OSS-shaped upsell (a portfolio/foundation dashboard over many PUBLIC repos: cross-repo health, org badge, longer retention) that could convert a high-value all-public user, OR an explicit product decision that Free is the whole product for him.",
    "got": "The only paid surface (/org/*) is gated on PRIVATE scans + prepaid credits (plans.ts:42-43, entitlement.ts:14-17). A steward whose every repo is public burns 0 credits forever and reaches the full free recurring set (scan+badge+report+/trends). No public-repo org/portfolio tier exists. The funnel delivers unlimited recurring value and never meters it.",
    "evidence": ["src/lib/plans.ts:25-34", "src/lib/plans.ts:42-43", "src/lib/entitlement.ts:14-17", "src/lib/db/credits.ts:3-6"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm a fully-public org reaches /trends + badge + report indefinitely with $0 credit burn and is never prompted to upgrade — i.e. there is no conversion event anywhere in the all-public recurring loop.",
    "suggested_acceptance": "Either ship an OSS/public-repo portfolio tier (paid foundation dashboard) with a defined conversion trigger, or document that the all-public steward is intentionally a free acquisition/loop user (badge = top-of-funnel) with no revenue expectation."
  },
  {
    "id": "KENJI-L1-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "kenji-oss-foundation",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "\"Unlimited public-repo scans\" is actually a soft weekly cap (3 anon / 20 signed-in) — pricing copy overstates Free",
    "expected": "If /pricing and plans.ts say 'Unlimited public-repo scans', the public-scan path imposes no cap below unlimited — a steward re-scanning ~30 repos a cycle can do so.",
    "got": "The public funnel enforces a rolling-7-day quota: default 3/week anonymous, 20/week signed-in (public-scan-quota.ts:44-58), fail-open. 'Unlimited' is the marketing word; the gate says 3–20/week. A 30-repo portfolio cycle exceeds both. (Fail-open + PUBLIC_SCAN_QUOTA_DISABLED kill-switch means it may not bite in dev/mock.)",
    "evidence": ["src/lib/plans.ts:33", "src/lib/public-scan-quota.ts:44-47", "src/lib/public-scan-quota.ts:54-58"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Run >3 public scans/week anonymously (and >20 signed-in) against the seeded env — does the quota actually trip a 429, and does /pricing still claim 'Unlimited'? Confirm whether the quota is enforced or disabled in the run env.",
    "suggested_acceptance": "Reword 'Unlimited public-repo scans' to the real allowance (e.g. 'N public scans / week, more when signed in'), OR raise/remove the cap so 'unlimited' is literally true."
  },
  {
    "id": "KENJI-L1-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "kenji-oss-foundation",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "30-day retention is unenforced — Free silently gets MORE history than advertised (generosity overshoot)",
    "expected": "Free's advertised 30-day retention (plans.ts:31, /pricing) actually clips the trajectory/trends lookback at 30 days.",
    "got": "retentionDays is read by NO query: per-repo history clamps to a row count only, no date floor (scans-read.ts:138); the org trend query applies only request start/end (org-rollup.ts:220-227). So a Free trajectory fits history older than 30 days — the page UNDER-promises and Free OVER-delivers. (Cross-confirmed by priyanka/lena/helena/gabriel L1s; here it's the inverse-generosity reading.)",
    "evidence": ["src/lib/plans.ts:31", "src/lib/db/scans-read.ts:138", "src/lib/db/org-rollup.ts:220-227"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "On Free, scan a repo whose history predates 30 days and confirm the /trends trajectory fits ALL of it (no 30-day clip) — proving Free silently gets unlimited lookback.",
    "suggested_acceptance": "Either enforce retentionDays as a date floor in the history/trend queries, or drop the per-tier 'N-day history' claim so the boundary is honest in both directions."
  },
  {
    "id": "KENJI-L1-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "kenji-oss-foundation",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "Free recurring read has the trajectory line but no narrated 'what moved since last cycle' — period-movers are Pro+",
    "expected": "Each recurring cycle, the free read names what changed since last time (a moved level, a notable mover), not just a re-rendered line.",
    "got": "Period-summary / movers live on the Pro+ /org/* rollup (PeriodSummary, org-insights); on Free, /trends renders trajectory + per-dimension lines but no narrated delta. The recurring read for Kenji is 'eyeball the line', not 'read the mover'. By-tier, not a defect — but it thins his per-cycle 'new + actionable' to a visual read.",
    "evidence": ["src/app/trends/page.tsx:161-169", "src/lib/plans.ts:42-43"],
    "code_check": "unreachable",
    "verdict": "confirmed",
    "l2_priority": "Confirm that on Free /trends, a score move between two scans is shown only as a line (no narrated 'moved +N since last scan'), so the recurring 'what's new' is a visual inference.",
    "suggested_acceptance": "A lightweight free 'since last scan: level/score delta' line on /trends would give the recurring read a narrated 'what's new' without unlocking the paid org rollup."
  },
  {
    "id": "KENJI-L1-05",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "kenji-oss-foundation",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — badge auto-refreshes on push and labels the mock floor '· demo'; the free recurring signal is honest and Scorecard-shaped",
    "expected": "The free auto-badge must reflect a real scan, refresh on push, and not pass the deterministic floor off as a credible verdict.",
    "got": "Badge keys per-commit on the resolved head SHA, sharing the scan-flow cache so it reflects a real LLM scan (route.ts:276-287); marks '· demo' when only the mock rubric ran (route.ts:324-325); click-through to dated evidence (route.ts:267). This clears Kenji's Scorecard-norm bar for a free, auto-updating, evidence-linked public-repo signal.",
    "evidence": ["src/app/api/badge/[owner]/[repo]/route.ts:276-287", "src/app/api/badge/[owner]/[repo]/route.ts:324-325", "src/app/api/badge/[owner]/[repo]/route.ts:267"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Push a commit to a scanned public repo and confirm the badge re-resolves to the new head's level (not a stale TTL-pinned level)."
  }
]
```

## Character feedback (Kenji's voice)

> **Would I renew?** I renew Free every release cycle by doing nothing, and I'll never convert. That's not a compliment to your sales team — it's the finding. I'm an all-public steward: every repo I scan burns zero credits forever (`entitlement.ts:15`), the badge is free and auto-refreshes on push like Scorecard does, the report's free, /trends is free. You handed me unlimited recurring value and never built a meter for me. Great product, leaky funnel.
>
> **Is each cycle telling me something new?** Mostly yes, but I'm reading it off a line. The trajectory fits my real history and the badge moves when I push — that's the recurring value, and it saves me eyeballing CI repo by repo. But there's no "moved +N since last scan" narration on Free; that lives behind the org dashboard I'm structurally locked out of. So my "what's new" is a visual inference, not a sentence.
>
> **Do I trust a move is real?** At the per-repo /trends level, not fully — a small wobble between scans could be the repo changing or the model breathing within its guardband, and nothing on the line tells me which. The forecast carries confidence, but it's not annotated where the move shows.
>
> **Does the cost pencil out?** It pencils out to infinity-over-zero — I save ~2–3 hours a release cycle for $0. There is no cost to pencil. **Can I even see the price?** Mine, yes — Free is honestly $0. The paid tiers hide their dollar amount, but that's not my problem; it's the prospective buyer's.
>
> **Two things bug the steward in me, both honesty cracks.** Your page says "Unlimited public-repo scans" — it's actually 3 a week anonymous, 20 signed in (`public-scan-quota.ts:44`). For a 30-repo portfolio cycle that's not unlimited, that's a wall with the word "unlimited" painted on it. And the other way: you advertise "30-day history" but `retentionDays` is read by no query (`scans-read.ts:138`), so my trajectory quietly fits *more* than 30 days. One claim is too generous, one too stingy, both untrue — and I recommend tools to peer foundations by vouching for their pricing page.
>
> **What's missing for MY recurring job?** A reason to pay, honestly. If you want revenue from a foundation, build the thing I'd actually buy: a portfolio-of-public-repos dashboard — cross-repo health, one org badge, longer retention — and put a price on it. Right now there's a private-repo dashboard and nothing for the all-public world, which is most of OSS.
>
> **Would I tell a peer?** Instantly — *because* it's free: "no signup to read your own public repo's score, the badge auto-updates, go." Which is exactly the problem if you're the one trying to get paid.

## Grounding score · time-saved · verdict

- **Grounding score: 2 / 4** recurring-context sources reach Kenji's read (trajectory ✅, history ✅; period-movers ❌ by tier, noise-annotation ◐). His free recurring read is "trajectory line + auto-badge" — solid but narrower than the narrated org read he's tier-locked out of.
- **Per-cycle time-saved: ~2–3 hours** (≈150 min) per release cycle vs. his manual baseline of eyeballing CI + community signals across ~30 public repos (~3–4 h by hand) — for $0.
- **Renew / downgrade / churn / upgrade: RENEW FREE / NEVER CONVERT.** The free tier clears his bar permanently and no code path ever asks an all-public steward to pay. One-line reason: *unlimited recurring value at $0 with no OSS-shaped paid hook = he stays, he never pays, and that's a monetization gap, not a win.*

## l2_priority carry-forward
1. **(top)** Confirm the all-public conversion gap (KENJI-L1-01): a fully-public org reaches /trends + badge + report indefinitely at $0 credit burn and is never prompted to upgrade — no conversion event in the all-public loop.
2. Trip the public-scan weekly quota (KENJI-L1-02): >3 anon / >20 signed-in scans/week — does it 429, and is the quota enforced or disabled in the run env, while /pricing still says "Unlimited"?
3. Prove the retention overshoot (KENJI-L1-03): on Free, a repo with >30-day-old history fits the FULL trajectory on /trends (no 30-day clip).
4. Confirm the free recurring read has no narrated delta (KENJI-L1-04): a score move shows only as a line, not "moved +N since last scan".
5. Confirm badge auto-refresh on push (KENJI-L1-05, strength).
