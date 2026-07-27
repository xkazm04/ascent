# L1 (theoretical) — Victor (FinOps-minded Engineering Director) × "Repeated org scans: worth the price?"

cert_level: L1 · promotion: discovery · engine assumed: claude-cli (per uat/env.md) · plan: Team (500 credits/mo)

## 1. Surface model (import-chain-traced, file:line)

### `/usage` — the budgeting surface
- Route: `src/app/usage/page.tsx:18-160`. Auth/tenant gate: `resolveSignInState()` (`:28`) + `canReadOrg(org)` (`:62`, cross-tenant IDOR guard). DB-required guard (`:71`). Empty-state guard for a reachable-but-zero org (`:120-131`).
- Data assembly (`:87-107`): `getUsageSummary(org, days)`, `getCreditState(org)` (`src/lib/db/credits.ts:81-92`), `getCreditReconciliation(org, days)` (`credits.ts:452-486`), `getBadgeReach`, `getQuotaEventTotals`.
- Renders `UsageDashboard` (`src/app/usage/usageDashboard.tsx:8-216`):
  - Low-balance banner (`:45-59`), `UsageTrend` (`:63`), compact totals `Stat` tiles (`:67-72`), cost/tokens/credits row (`:76-105`).
  - **`AllotmentPanel`** (`src/app/usage/AllotmentPanel.tsx:45-85`) — the burn-vs-allotment / right-size instrument, rendered at `usageDashboard.tsx:110` only when `credit` is present. Pure calc `allotmentRead()` (`AllotmentPanel.tsx:29-37`): normalizes `billableInPeriod` to a monthly rate, compares to `planFeatures(plan).includedCredits`, classifies `fit` as `under | ok | over` (`:35`).
  - Reconciliation panel (debited/refunded/granted/net) (`usageDashboard.tsx:112-136`), reading `CreditReconciliation` from `credits.ts:452-486`.
- Credit ledger truth: `src/lib/db/credits.ts` — `getCreditState` (`:81-92`) reads `Organization.scanCredits` (the *prepaid* pool); `countMeteredScansThisMonth` (`:278-288`) computes calendar-month-to-date metered scans, resetting on the UTC month boundary (`:284`); `consumeScanCredit` (`:304-391`) applies the hybrid charge order (allowance first, then credit debit) via `resolveScanCharge`/`decideScanCharge` (`src/lib/plans.ts:117-150`).

### `/pricing` — the price-legibility surface
- `src/app/pricing/page.tsx:48-127`. Prices derived from `planPriceLabel()` (`src/lib/plans.ts:88-93`) reading `PLAN_FEATURES` (`plans.ts:32-81`) — Team: `monthlyPrice: 20`, `includedCredits: 500` (`plans.ts:57-68`). Price cards (`page.tsx:79-95`) + footer copy (`:116-122`).

### `/org/[slug]` overview — recurring-cycle read
- `src/app/org/[slug]/page.tsx:37-134`. Builds `RepoTrajectory[]` via `buildTrajectories()` (`src/components/org/overview/repoTrajectory.ts:52-86`), joining latest snapshot + per-scan history.
- Noise/guardband handling: `deltaCrossesEngine` flag (`repoTrajectory.ts:61`, muted display at `RepoCategoryRollup.tsx:120-128`) plus the shared noise primitive `isWithinNoise`/`toneFor`/`fmtDelta` (`src/lib/maturity/noise.ts:16-27`, wired into `src/components/ui/format.ts:4,33-44`) — used by `movedRepos`/`summarize` (`repoTrajectory.ts:165-203`) to keep "improving/slipping" counts to genuine (non-noise, non-engine-transition) moves.
- Renders `RepoCategoryRollup` (fleet masthead ▲/▼/→ + avg move, `RepoCategoryRollup.tsx:230-255`) and `RepoDimensionHeatmap` (`page.tsx:131`).

### `/org/[slug]/executive` — the "is this cycle worth it" briefing
- `src/app/org/[slug]/executive/page.tsx:24-259`. `buildExecBriefing()` assembles maturity, benchmark, trajectory, movement, goals (`:38`). Renders "Value this period" line (`valueRealizedLine`, `:111-116`), movement count strip (`:129-134`), trajectory/forecast card with regression count (`:153-169`), prior-period comparison (`:171-176`), ranked leverage moves (`:180`), "Copy briefing for LLM" (`:9,85`).

### Credits chip (`/org/[slug]` header, every page)
- `src/components/org/shared/CreditsControl.tsx:25-300`. Balance-only chip (`:172`), popover distinguishes "prepaid balance" from "free scans left this month" (`:198-203`) — does NOT claim the balance is a monthly figure; honest about which number is which.

### Reachability
Victor is a Team-plan owner under `ASCENT_AUTH_BYPASS=1` + the local-profile auto-seed (`src/app/org/[slug]/layout.tsx`, per `uat/env.md`). `canReadOrg`/`hasOrgRole("owner")` resolve true for his own org on every surface above — the entire bound surface set (`/usage`, `/pricing`, `/org/[slug]`, `/org/[slug]/executive`, credits chip) is reachable with no gating gaps found.

## 2. In-character walkthrough (theoretical, over this model)

I open `/org/<mine>` the way I have every week. The Fleet card's ▲/▼/→ counts and avg-move number (`RepoCategoryRollup.tsx:230-255`) already exclude noise-band wobble and mock→live engine-transition deltas — good, that's the first question I'd ask ("is this real or re-scan jitter") answered *before* I even ask it. I can trust a `▲+8` is real movement and a `≈+1` (muted, `format.ts:42`) is not. That's a senior-grade instinct baked into the UI, not left to me to eyeball.

`/org/<mine>/executive` gives me the board-ready "Value this period" line, movement counts, and a prior-period comparison — this is the artifact I'd actually screenshot for the CFO. Good.

Now the budget question. I go to `/usage`. Burn-vs-allotment is right there: "≈340 credits/mo at this pace · 68% of your 500/mo allotment" (`AllotmentPanel.tsx:71-74`), with a fit-based nudge (`:58-63`). This is exactly the number FinOps discipline demands — not a balance, a utilization percentage against the committed volume. I'd call this "a row I can defend to finance."

Then I read the sub-line: *"Unused credits roll over — they never expire, so a quiet month is not lost"* (`AllotmentPanel.tsx:79-82`), directly under the 500/mo allotment I was just reading. I take this at face value — the copy is unambiguous — and I mentally note: "okay, so if I under-run this month, next month's ceiling effectively grows; I don't need to worry about wasting headroom in a slow month." That's a *material* fact for my renewal math — it changes whether "12% utilization for 3 months" is actually waste or just banked runway.

But it's false. The `included` figure this sentence sits under is `planFeatures(plan).includedCredits` (`AllotmentPanel.tsx:31-32`) — the *monthly allowance*, whose consumption is tracked by `countMeteredScansThisMonth()`, which resets hard on the UTC calendar-month boundary (`credits.ts:284,286`) with zero carry-forward logic anywhere in `plans.ts` or `credits.ts`. The thing that genuinely *does* roll over and never expire is the separately-tracked prepaid `scanCredits` balance — a different number, shown three rows up in the same page as the "Credits" stat tile (`usageDashboard.tsx:77-91`). And `/pricing`, the page I'd cross-check against, says the opposite about the exact concept this panel is discussing: *"Every plan's monthly scan allowance resets each month"* (`pricing/page.tsx:117`).

So the same word — "allotment" / "allowance" — carries **contradictory rollover semantics on two surfaces I'd visit in the same budgeting session**, and the surface that's wrong (`/usage`) is the one I actually build my renewal number from. This is precisely my #1 pet peeve pattern ("'500/month' copy when the underlying field is a persisted pool") except worse: it's not just ambiguous copy, it's a copy bug that overstates the allowance's rollover behavior on the money page and understates it (correctly) on the marketing page. If I ran with the `/usage` copy I'd underestimate my true burn rate and could get blindsided by a 402 mid-quarter; if I go re-check `/pricing` and catch the contradiction myself, I no longer trust either page's numbers without independently verifying the schema — which is exactly the manual reconciliation this tool is supposed to replace.

Retention: I never see a rendered "365-day history (Team)" anywhere on `/usage` or `/trends` — it exists only as a `plans.ts` comment and a `/pricing` feature bullet. Minor, but the DoD's "retention window" question ("how long the trajectory can even look back") isn't answered where I'm actually looking at the trajectory.

$/scan: `/pricing` shows Team at $20/mo · 500 scans included → $0.04/scan, computable without leaving the app. That criterion is met, cleanly, and it's grounded in one source (`plans.ts`) so it can't drift from what the entitlement gate reads.

## 3. Findings

```json
[
  {
    "id": "L1-VF-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "victor-finops-director",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "AllotmentPanel's rollover copy contradicts the actual monthly-allowance reset semantics (and contradicts /pricing's own copy for the same concept)",
    "expected": "The allotment panel's rollover statement should describe the SAME field it's displayed under (the monthly allowance, `plan.includedCredits`), and that statement should match what the code actually does with it.",
    "got": "AllotmentPanel.tsx:79-82 states \"Unused credits roll over — they never expire, so a quiet month is not lost\" directly beneath the 500/mo allotment read — but the allowance consumption (`countMeteredScansThisMonth`, credits.ts:278-288) resets every UTC calendar month with no carry-forward logic anywhere. The sentence is true only of the SEPARATE prepaid `scanCredits` pool (shown 3 rows up as the \"Credits\" stat, usageDashboard.tsx:77-91), not of the number this panel is about. Meanwhile /pricing/page.tsx:117 correctly says \"the monthly scan allowance resets each month\" for the same concept — a direct cross-surface contradiction.",
    "evidence": ["src/app/usage/AllotmentPanel.tsx:29-37,79-82", "src/lib/db/credits.ts:278-288", "src/lib/plans.ts:109-114", "src/app/pricing/page.tsx:116-122"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Load /usage live for a Team org with a partially-used allowance across a real month boundary (or read the rendered copy directly) and confirm the sentence still reads 'roll over / never expire' next to the 500/mo figure; also confirm whether the actual displayed % after a month rollover shows the allowance resetting to 0%-used (proving the copy false) or shows a carried balance (proving my code read wrong)."
  },
  {
    "id": "L1-VF-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "victor-finops-director",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "Retention window (30/180/365-day history by tier) is never rendered on /usage or /trends — only in a plans.ts comment and a /pricing bullet",
    "expected": "Somewhere on the page where I'm actually looking at trajectory/history (usage or trends), a line stating my tier's retention window, so I know how far back 'the recurring read' can look.",
    "got": "retentionDays is enforced server-side as a silent read floor (plans.ts:189-192, org-rollup.ts) and mentioned only in the /pricing feature list ('365-day history'), never rendered inline where the history is actually shown.",
    "evidence": ["src/lib/plans.ts:26-27,189-192", "src/app/pricing/page.tsx (feature bullet only)"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm live whether /trends or /usage surfaces retention anywhere in the rendered DOM I missed in the static read."
  },
  {
    "id": "L1-VF-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "victor-finops-director",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "AllotmentPanel's utilization % blends allowance-covered and credit-debited scans into one figure without separately breaking out how much of the burn drew on the free allowance vs paid credits",
    "expected": "A director sizing a downgrade wants to know whether the 68% utilization is entirely inside the free allowance or partly paid-credit overflow — a different renewal argument.",
    "got": "`allotmentRead()` (AllotmentPanel.tsx:29-37) uses `usage.privateScans` as the sole numerator; the split exists elsewhere (CreditReconciliation's debited/granted, usageDashboard.tsx:112-136) but isn't cross-referenced inside AllotmentPanel itself.",
    "evidence": ["src/app/usage/AllotmentPanel.tsx:29-37", "src/lib/db/credits.ts:452-486"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Low priority — only worth an L2 look if L1-VF-01 is fixed and there's time; not a blocker to the renewal decision on its own."
  }
]
```

## 4. Character voice — first-person reaction

Okay, credit where due: the Fleet card already does the hard part I usually have to eyeball myself — it mutes the noise-band wobble and the mock→live artifact instead of dressing a `+1` in the same confident green as a real `+8`. That's the kind of thing I'd expect from a senior platform engineer building this in-house, not a vendor cutting corners. And the `AllotmentPanel` on `/usage` is, structurally, exactly the instrument the 2025 FinOps right-sizing playbook calls for — burn normalized to a monthly rate, compared against my committed allotment, with an explicit downgrade/top-up nudge. If that panel's copy were accurate I'd screenshot it straight into my renewal deck.

But it isn't accurate, and it's wrong in the one place I can least afford it to be wrong — the sentence sitting directly under my 500/mo number tells me my idle headroom banks forward, and the sentence on your own pricing page tells me the opposite about the same concept. I don't know which one you actually built. Until I can find out, I'm not defending this row to finance off the `/usage` page as-is — I'd reopen the spreadsheet just to sanity-check the rollover assumption, which is the ONE thing this page was supposed to save me from doing. That's the worst outcome for you, not because the bug is catastrophic, but because it's exactly the seam a numerate FinOps buyer is trained to go looking for first.

Everything else — the noise handling, the $/scan legibility from `/pricing`, the honest "prepaid balance ≠ monthly figure" phrasing on the credits chip itself — tells me your engineering is disciplined about this stuff elsewhere. Which is exactly why the one contradiction stands out: it reads like two different people wrote the allowance copy on two different pages and nobody diffed them against the actual `countMeteredScansThisMonth` reset logic. Fix that one sentence (or the model it's describing), and this is a "renew, hold Team" verdict with evidence. As shipped, it's "renew provisionally, verify the rollover claim myself before I put a number in front of the CFO."
