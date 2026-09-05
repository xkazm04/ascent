# L1 — Tania (scaleup cost-cutter) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the recurring read is real and the *outcome* side exists (a per-repo "What Changed" with recs-done + a backlog "Done" tally), but the **one signal Tania renews on — human engagement / last-active / "did anyone open this"** — is structurally absent: `/usage` measures the *cron and the credit burn*, never a person. There is no `lastLoginAt`/dashboard-open telemetry anywhere in the codebase, and there is no consolidated org-level "you actioned N recs, moved +X points this quarter" value-realization line — so she must reconstruct it. The price for her Team tier is also off-app. Completes, but with a major value-legibility gap for exactly her facet. L2-eligible.

## Reachable surface set (tier-honest — Team)
Under `ASCENT_AUTH_BYPASS=1` on a populated org she renders as a synthetic owner, so the full `/org/*` set is reachable. Honest Team entitlements (`src/lib/plans.ts:45-54`): **500** included credits, **365-day** retention (so a year-back trajectory *can* render — repetition is well-supported for her), segments+comparisons, playbooks+planning, scheduled autoscans+alerts (inherited from Pro). Reachable and load-bearing for her renewal read:
- `/usage` — `src/app/usage/page.tsx`, `src/lib/db/usage.ts`, `src/components/usage/UsageTrend.tsx` (scan volume, credit burn, runway, top repos, cost).
- `/org/[slug]/backlog` — `src/app/org/[slug]/backlog/page.tsx` + `SummaryStrip` (`src/components/org/BacklogSummary.tsx:14-25`) — the org-wide actioned/Done tally.
- per-repo `/report` "What Changed" — `src/components/report/WhatChanged.tsx:76-160` (`recsMovedToDone`, "Why it moved"), fed by `src/lib/report/compare.ts`.
- Overview `/org/[slug]` Trajectory/PeriodSummary; `/trends`; `/pricing`.
- `PATCH /api/recommendations/[id]` — the act of marking a rec done (`src/app/api/recommendations/[id]/route.ts`). **Reachable for her own org** (Team), **403 for the public funnel** (route.ts:44-49) — so the action-tracking she needs is a paid-tier feature, correctly gated.

## Surface-model notes (recurring-value affordances → file:line; grounding emphasis)
- **`/usage` measures the machine, not the human.** `UsageSummary` (`src/lib/db/usage.ts:29-64`) is entirely scan-derived: `periodScans`, `privateScans`, per-day `daily`, `byRepo`, and `firstScanAt`/`lastScanAt`. Critically `lastScanAt` (`usage.ts:194`) is the last *scan computed*, not the last *human open* — and the page surfaces no other recency. `UsageTrend.tsx:25` literally titles the chart "Computed scans per day." For Tania this proves the cron is alive, not that her team is. **This is her churn-signal blind spot, in code.**
- **No login / dashboard-open / active-user telemetry exists at all.** Grep across the repo: `lastLoginAt`/`lastSeen`(for users)/session-count are absent; the only `lastActiveAt` is on **`RepoContributor`** (`prisma/schema.prisma:240`, `src/app/org/[slug]/contributors/page.tsx:158`) and means *last git commit by a code author*, not last dashboard login by a buyer. A feature-scout doc confirms the gap explicitly: the OAuth callback "records nothing about the sign-in event itself … no `lastLoginAt` … no way to show 'last active'" (`docs/harness/feature-scout-2026-06-08/github-oauth-session.md:46`). So the renewal-research "has a human logged in within the window" question cannot be answered in-app.
- **Actioned-outcome data exists, but only per-repo and self-assembled.** Recs carry a real status lifecycle (`open|in_progress|done|dismissed`, `schema.prisma:343`) with an append-only event timeline (`RecommendationEvent`, `schema.prisma:366-380`) attributing who moved it. The per-repo report shows `recsMovedToDone` + "Why it moved" between two scans (`WhatChanged.tsx:76-160`, `compare.ts`). The org backlog shows a **static `Done` count** (`BacklogSummary.tsx:22`) — *cumulative*, not "done **this period**." There is **no org-level "you actioned N recs and moved +X points this quarter" value-realization narrative** — she must open per-repo diffs and tally by hand.
- **Re-scan noise defense exists where the per-repo move is shown but not on the headline.** "Why it moved" attributes each delta to concrete signals (`WhatChanged.tsx:86-101`), and Trajectory carries R²/flat-floor — but the org backlog "Done"/PeriodSummary movers don't tag a move as within-guardband-noise. A documented engine bug compounds this for her exact (live-LLM) path: re-scans match recs by `dimId+title`, so LLM title drift makes `recsMovedToDone` **under-report** completed work (`docs/harness/biz-bug-scan-2026-06-11/maturity-model-scoring-engine.md:32`) — the value-realization count can read *low*, undercutting renewal.
- **Price for Team is not in the app.** `src/lib/plans.ts` is feature/allotment metadata only ("no dollar amounts are invented here", plans.ts:1-5); `/pricing` renders Team as prepaid-credits with no subscription $. `/usage` gives credit burn + an *LLM-token* cost estimate (`usage.ts:148-156`) but not the subscription price — so she can't compute $/actioned-move without leaving for Polar.

## Findings
```json
[
  {
    "id": "TAN-1",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "tania-scaleup-costcut",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "missing",
    "title": "No human-engagement signal — /usage proves the cron ran, never that a person opened the dashboard",
    "expected": "For a renew-or-cut call, the decisive signal is human engagement: last-active by a person, active-user / dashboard-open trend over the renewal window (a 30-day cold streak inside the window is high-risk regardless of other signals).",
    "got": "UsageSummary is entirely scan-derived; lastScanAt is the last scan COMPUTED, not the last human open. No lastLoginAt / session / dashboard-open telemetry exists anywhere — the only lastActiveAt is a repo contributor's last git commit. The page that should answer 'is anyone using this' answers 'did the scanner run'.",
    "evidence": ["src/lib/db/usage.ts:29-64", "src/lib/db/usage.ts:194", "src/components/usage/UsageTrend.tsx:25", "docs/harness/feature-scout-2026-06-08/github-oauth-session.md:46", "prisma/schema.prisma:240"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "On the live org, confirm /usage and every org surface expose ZERO human last-active/login/active-user signal — only scan-derived recency — so the renewal 'did anyone open it' question is unanswerable in-app.",
    "suggested_acceptance": "Record sign-in/dashboard-open events and surface a 'last active' (by a person) + active-users-this-period stat on /usage, distinct from scan volume."
  },
  {
    "id": "TAN-2",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "tania-scaleup-costcut",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "No consolidated value-realization line — 'you actioned N recs, moved +X points this quarter' must be hand-assembled",
    "expected": "The product surfaces its OWN value realization for the period: recs actioned THIS cycle across the fleet + the point movement that followed — one line she can paste into the CFO sheet.",
    "got": "Actioned outcomes exist only per-repo (WhatChanged recsMovedToDone + 'Why it moved') and as a static cumulative backlog 'Done' tile — there is no org-level 'actioned this period + points moved' narrative. She reconstructs it by clicking through repo diffs, the exact manual work she wanted the tool to replace.",
    "evidence": ["src/components/org/BacklogSummary.tsx:14-25", "src/components/report/WhatChanged.tsx:76-160", "src/lib/report/compare.ts", "src/app/org/[slug]/backlog/page.tsx"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Walk the org backlog + executive briefing on a 2-cycle org: is 'recs done THIS period' (not cumulative) and the correlated point move shown anywhere org-wide, or only per-repo?",
    "suggested_acceptance": "Add an org-level value-realization tile/briefing line: 'N recommendations actioned this period · +X points moved · across R repos', period-scoped not cumulative."
  },
  {
    "id": "TAN-3",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "tania-scaleup-costcut",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Actioned-rec count under-reports on the live-LLM path (title-drift re-scan match) — value-realization reads low",
    "expected": "The 'recommendations done' count she'd cite as value is stable across re-scans on the claude-cli engine.",
    "got": "Re-scans carry recommendation state forward by matching on dimId+title; live-LLM title wording drifts between scans, so recsMovedToDone (and the diff's completed-work view) silently UNDER-reports actioned work — documented engine bug. For Tania this makes the renewal-justifying number read lower than reality, biasing toward cut on noise.",
    "evidence": ["docs/harness/biz-bug-scan-2026-06-11/maturity-model-scoring-engine.md:32", "src/lib/report/compare.ts", "prisma/schema.prisma:344-349"],
    "code_check": "present-broken",
    "verdict": "uncertain",
    "l2_priority": "Re-scan a repo with one rec marked done under LLM_PROVIDER=claude-cli; confirm whether title drift drops the matched rec so 'recommendations done' under-counts on the live path.",
    "suggested_acceptance": "Match carried-forward recommendations on a stable key (dimId + stored stable id), not title text, so actioned counts survive LLM phrasing drift."
  },
  {
    "id": "TAN-4",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "tania-scaleup-costcut",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "Price for Team is off-app — can't compute $/actioned-move for the CFO sheet without leaving for Polar",
    "expected": "She can form a defensible cost↔value number in-app: subscription $ for the period vs. actioned moves / points gained.",
    "got": "plans.ts holds no dollar amounts by design; /pricing shows Team as prepaid-credits, no subscription $. /usage shows credit burn and an LLM-TOKEN cost estimate but not the subscription price. The $/actioned-move arithmetic the renewal needs can't close in-app.",
    "evidence": ["src/lib/plans.ts:1-5", "src/lib/plans.ts:45-54", "src/lib/db/usage.ts:148-156", "src/app/usage/page.tsx:230-243"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm neither /pricing nor /usage exposes the Team subscription $ — only prepaid-credit framing + token cost — so cost↔value is undecidable without the billing provider.",
    "suggested_acceptance": "Surface the tier's subscription $ (or $/credit) on /pricing and a period $-value on /usage so cost↔value is computable in-app."
  },
  {
    "id": "TAN-5",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "tania-scaleup-costcut",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Rising scan-volume chart can read as 'healthy usage' while logins are flat — vanity-metric trap",
    "expected": "Usage that climbs because a scheduled autoscan runs nightly should not read as engagement; the renewal-relevant trend is human, not cron.",
    "got": "UsageTrend's billable/free per-day bars climb purely from scheduled rescans (cron route) with zero human involvement; nothing labels the series as machine-driven or separates scheduled from human-initiated scans. A cold-but-scheduled org looks busy.",
    "evidence": ["src/components/usage/UsageTrend.tsx:12-95", "src/app/api/cron/rescan/route.ts"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "On an org with scheduled autoscans and no human logins, confirm /usage trends UP — visually indistinguishable from genuine engagement.",
    "suggested_acceptance": "Split scheduled-autoscan vs. human-initiated scans in the trend, or annotate the series, so cron activity isn't mistaken for engagement."
  },
  {
    "id": "TAN-6",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "tania-scaleup-costcut",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "completion",
    "title": "STRENGTH — recommendation action IS tracked, attributed, and tenant-gated (real value-realization primitive)",
    "expected": "If she does want to prove a rec was actioned, the data should exist and be trustworthy.",
    "got": "Recs have a full status lifecycle + append-only event timeline attributing who moved it (Linear/Jira-grade audit), the PATCH is tenant-gated to her own org and 403s the public funnel, and credits/retention (365d at Team) genuinely support a year-back trajectory. The raw material for value-realization is solid — it's the org-level surfacing + engagement layer on top that's missing.",
    "evidence": ["prisma/schema.prisma:333-380", "src/app/api/recommendations/[id]/route.ts:44-51", "src/lib/plans.ts:45-54"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm marking a rec done writes an attributed RecommendationEvent and the per-repo 'What Changed' reflects it on the next scan."
  },
  {
    "id": "TAN-7",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "tania-scaleup-costcut",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Backlog 'Done' is cumulative, not period-scoped — overstates this-cycle activity at renewal",
    "expected": "At a renewal she needs 'done SINCE last renewal', not 'done ever'.",
    "got": "SummaryStrip 'Done' is an all-time tally of completed recs, with no window control; a backlog that's been worked for a year shows a big green Done number even if nothing moved this quarter — the opposite of the freshness signal she needs.",
    "evidence": ["src/components/org/BacklogSummary.tsx:14-25"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Check whether any backlog/period control scopes 'Done' to the renewal window vs. all-time.",
    "suggested_acceptance": "Add a period-scoped 'Done this period' figure alongside the cumulative tally on the backlog summary."
  }
]
```

## Character feedback (Tania, first person)
Right — renewal's in three weeks, CFO wants a line. I open `/usage` first, because my whole question is *did anyone actually use this since we paid.* And what I get is "Computed scans per day," credit burn, top repos, a runway estimate. That tells me the **scanner** is alive. It does not tell me a single human opened this dashboard. "Last scan two days ago" — fine, that's a cron we set up once. Where's *last opened by a person*? It's not here. I grepped my memory of every renewal I've cut: the tell is always logins flatlining, and this product can't show me logins at all. My honest read is the team stopped opening it six weeks ago, and nothing on this screen contradicts me.

Is each cycle telling me something new? At the **repo** level, yes — "What Changed" with recs done and "why it moved" is genuinely good, that's real value-realization machinery. But I'm not clicking through forty repos to assemble "we actioned N recs and moved +X points this quarter." That one consolidated line is exactly what I'd paste to the CFO, and the product makes me build it by hand. The backlog gives me a "Done" number but it's *all-time*, so it flatters — big green number, zero movement this quarter, same picture.

Do I trust a move is real? Where it shows the move it explains it, which I respect. But I half-trust the **count**: I read that on the live Claude path the recs match by title, and titles drift, so "done" can under-report. If anything that biases me toward *cut* on noise — bad either way.

Does the cost pencil out? Can't tell — I can't even see what Team costs. I see credit burn and a token-cost estimate, not the subscription dollars. I'm not booking a Polar call to learn the number that should be on the pricing page.

Would I tell a peer? I'd say: the assessment engine is real, the per-repo diff is the best part — but if your renewal hinges on *proving people use it*, this can't show you that today. **Verdict: I can't prove engagement, so under a strict cull this gets cut or, charitably, downgraded — not because the product's bad, because it won't tell me anyone's home.**

## Grounding score + time-saved + verdict
- **Grounding (repetition sources reaching the renewal read): 3 / 6.**
  1. Trajectory needs real history — **YES**, and Team's 365-day retention supports it (`plans.ts:45-54`). ✓
  2. Per-repo movers/deltas with provenance ("Why it moved") — **YES** (`WhatChanged.tsx:86-101`, `compare.ts`). ✓
  3. Actioned-outcome data (rec status + event timeline) — **YES, exists** (`schema.prisma:333-380`). ✓
  4. Human-engagement / last-active / active-users — **NO**, structurally absent (TAN-1). ✗
  5. Org-level value-realization narrative ("actioned N, moved +X this period") — **NO**, per-repo only + cumulative Done (TAN-2, TAN-7). ✗
  6. In-app cost↔value (subscription $ for the period) — **NO**, price off-app (TAN-4). ✗
  The three that fail are the three her renewal call actually runs on.
- **Per-cycle time-saved (if it all worked): ~3 hours per renewal** (her ~3–4h manual reconstruction → ~5–10 min from one screen). **As shipped: roughly 0** on her decisive dimension — she still leaves the app to answer "did anyone use it" and to find the price, so the manual scramble survives.
- **Renew / downgrade / churn / upgrade: DOWNGRADE (leaning CHURN under a strict cull).** One-line reason: the product can't prove human engagement or show its own period value-realization in-app and the Team price is invisible — so a cost-cutter mandated to justify every line has no in-app evidence to justify this one; she keeps it only if a *manual* glance at the backlog happens to show recent actioned work.

## l2_priority carry-forward (top)
1. **TAN-1** (top): On the live org, confirm there is NO human last-active/login/active-user signal anywhere — only scan-derived recency — so "did anyone open it this cycle" is unanswerable in-app.
2. **TAN-3**: Re-scan a repo (LLM_PROVIDER=claude-cli) with one rec marked done — does title drift drop the match and under-count "recommendations done" on the live path?
3. **TAN-2**: On a 2-cycle org, is "recs actioned THIS period + points moved" surfaced org-wide anywhere, or only per-repo / as a cumulative Done tile?
