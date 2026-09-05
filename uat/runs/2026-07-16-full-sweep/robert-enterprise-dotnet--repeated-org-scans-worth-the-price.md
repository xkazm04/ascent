# L1 (theoretical) — Robert (enterprise .NET director) × "Repeated org scans worth the price"

cert_level: L1 · promotion: discovery · no browser used, code-grounded only

---

## 1. Surface model (import chain, cited)

Robert's surface binding (per `uat/characters/robert-enterprise-dotnet.md` front-matter `maps_to`) is
deliberately narrow — he does not open the dashboard. His actual touchpoints:

### A. The recurring artifact — `/api/cron/digest`
- Trigger: Vercel Cron, **fixed schedule `"0 13 * * 1"`** (every Monday 13:00 UTC) — `vercel.json:1-16`.
- Handler: `src/app/api/cron/digest/route.ts:67-213`.
  - Auth: `CRON_SECRET` bearer-only, constant-time compare (`route.ts:61-83`) — not a Robert-facing surface, just confirms the cron is real infra, not a stub.
  - Window: `weekRangeParams()` → `src/lib/window.ts:100-104` — **hardcoded 7 calendar days**, no parameter for month/quarter.
  - Per-org gating before any work: resolves `getOrgAlertWebhook(org)` → `isAlertConfigured()` (`alerts.ts:389-391`); no sink → `skippedNoSink` (`route.ts:119-123`).
  - Idempotency: `getAuditLog` / `claimOrgAuditOnce` at-most-once per 7-day window (`route.ts:124-133`, `189-198`).
  - **Movement gate** (the "does repetition still say something new" check): `digestHasSignal()` — `alerts.ts:54-64`, called at `route.ts:153-163`. Silent (`skippedFlat`) unless: level change, regression, gainer beyond noise, overall delta beyond `isWithinNoise` (`maturity/noise.ts:19-21`, `SCORE_NOISE_BAND = 2`), or low credits.
  - Message assembly: `buildFleetDigestMessage()` — `alerts.ts:264-305`. Inputs threaded from `route.ts:134-188`: `rollup.avgOverall`, `level` (`levelForScore`), `overallDelta`, `gainers`/`regressers` (**noise-filtered**, `route.ts:152,180`), `topRecommendation`, `benchmark.overallPercentile`, `forecastHeadline(rollup.forecast)` (trajectory), `creditsRemaining` (only when low).
  - Delivery: `dispatchAlert()` — `alerts.ts:432-456` — **POSTs a Slack Block-Kit payload to a webhook URL only.** No email/SES branch is called anywhere in this file.
  - Deep link in the body: `${base}/org/${org}/executive?range=custom&from=&to=` (`route.ts:168-170`) — carries the exact week window so the linked page reproduces the digest's numbers (`org/[slug]/executive/page.tsx:19,33-38`).

### B. Alert routing config — `AlertsControl.tsx` / `/api/org/alerts`
- `src/components/org/shared/AlertsControl.tsx:1-294` — admin-only popover (`route.ts:41,59` → `requireOrgRole(org,"admin")` in `src/app/api/org/alerts/route.ts:41,59`).
- Fields exposed: **webhook URL** (`AlertsControl.tsx:215-221`) and **regression sensitivity** (`overallDrop`/`dimensionDrop`, `AlertsControl.tsx:223-249`, feeding `DEFAULT_THRESHOLDS` override, `alerts.ts:33-43`).
- **No cadence field exists in this form or its API contract** (`/api/org/alerts` GET/POST payload is `{webhookUrl, overallDrop, dimensionDrop}` only — `route.ts:1-2` header comment, confirmed by the popover's own state: `webhookUrl`, `overallDrop`, `dimensionDrop`, nothing else, `AlertsControl.tsx:18-27`).

### C. Regression alerts (per-repo, the "real movement" bar)
- `detectRegression()` — `alerts.ts:72-121`, thresholds `overallDrop:5 / dimensionDrop:15` (`alerts.ts:43`), both **empirically clear of the measured scan-to-scan noise** (`maturity/noise.ts:1-8`, cites a 2026-06-20 dual-rescan of the same commit moving 0 overall / ±1 per dimension).
- Unchanged-commit suppression: `src/app/api/cron/rescan/route.ts:141-142` — `if (persisted && !persisted.deduped)` gates the alert call; a deduped (unchanged) commit fires nothing.
- Per-repo cooldown (`claimRegressionAlert`, `alerts.ts:156-166`) further suppresses flapping-repo spam.

### D. Renewal price check — `/pricing`
- `src/lib/plans.ts:32-81` — `PLAN_FEATURES.enterprise`: `monthlyPrice: null`, `billing: "custom"`, `retentionDays: null` (unlimited/custom).
- `planPriceLabel()` (`plans.ts:88-93`) renders Enterprise as `{amount:"Custom", cadence:"contact us"}` — single source of truth shared with the entitlement gate, so the copy can't drift from what's actually enforced.
- `src/app/pricing/page.tsx:1-27` — Enterprise CTA is a real `mailto:` (or About-page fallback), not routed into the self-serve `/connect` funnel (fixed bug noted in the file's own comment, line 14-18).

### E. Not reachable / not used by Robert (confirmed absent from his path, in scope only as contrast)
- `ScheduleSelect.tsx` (`src/components/org/repositories/ScheduleSelect.tsx:1-82`) exposes `SCHEDULES = ["off","daily","weekly","monthly"]` (`installationRepoTypes.ts:24-25`) — but this is the **per-repo autoscan cadence** (how often a repo gets re-scanned), consumed by `/api/cron/rescan`, not the digest push cadence. It lives on `/org/[slug]/repositories`, a surface outside Robert's binding (he never opens the dashboard), and even if he did, it would not do what his criterion asks.
- Email infra exists (`src/lib/email/ses.ts`, `src/lib/email/index.ts`) but is wired only to `dispatchScanCompletionEmail` in `src/app/api/scan/stream/route.ts:16` — a single-scan completion notice, never the fleet digest.

---

## 2. Reachability check

Robert's bypass/entitlement path (per `uat/env.md`): `ASCENT_AUTH_BYPASS=1` grants a synthetic "developer" owner Membership on first two visits to a populated `/org/<slug>`. Enterprise tier is `unlimited:true`, `seats:null` — no gate blocks any of the surfaces above once an org exists and has a webhook or SSO org context. All four surfaces (A–D) are within his reach in the code as built; the digest and alert-routing surfaces are also reachable **without ever opening the app**, which is the whole point for this Character. Nothing in his scored criteria requires a surface that's actually gated off — the gaps found below are gaps in *what the reachable surfaces do*, not in *reachability itself*.

---

## 3. Grounding audit (AI-surface)

The digest message itself (`buildFleetDigestMessage`) is **not an LLM call** — it's a pure template function over already-computed rollup/forecast/benchmark facts (`alerts.ts:264-305`). The upstream maturity scores it reports are LLM-graded elsewhere (out of this journey's scope — covered by the scan/report journeys). So:

**Grounding score: n/a for this journey's surface** — there is no prompt to audit here; the relevant "is the number trustworthy" question is answered structurally instead (noise-band math, dedup gating, threshold math), all of which check out against the Character's own bar (section 4 below).

---

## 4. In-character walkthrough (Robert)

*Walking the designed experience, not a live run.*

**"What hits my inbox?"** — A Monday-morning `/api/cron/digest` run assembles `buildFleetDigestMessage`: fleet score, level, delta-vs-last-week, trajectory headline, top 3 gainers, top 3 regressions beyond noise, the single highest-leverage gap, and (if low) a credits line — all in the message body, not gated behind a click. That's a real status doc, not a link with nothing in it. **Self-contained digest criterion: met**, assuming the delivery mechanism reaches him at all (see below).

**"If it pings me every week and 48 of those say 'no change,' I've trained myself to ignore the 2 that matter."** — `digestHasSignal()` is exactly the actionable-alerts discipline my own reference names: it stays silent on a flat week (`skippedFlat`), and the regressers/gainers it does render are pre-filtered to beyond-noise moves so a ±1 wobble never shows up under "Regressions:". **Recurring-value / real-vs-noise criteria: met, and well-reasoned** — the code comments even cite the empirical dual-rescan numbers (0 overall / ±1 per dimension) that justify the 5-/15-point thresholds. I'd defend that math to my CTO.

**"No way to set cadence to quarterly to match my renewal/review rhythm."** — Here's my problem. I read the cron table and the digest window function directly: the send schedule is `"0 13 * * 1"` — every Monday, full stop — and the window it summarizes is hardcoded to the trailing 7 days (`weekRangeParams`). The *content* is adaptive (silent when flat), so in practice a stable fleet might genuinely go silent for weeks — but that's an emergent side effect of the noise gate, not a cadence I control. There is no field anywhere — not in the alert-routing popover, not in an org settings API — that lets me or my admin say "quarterly." I looked for it in the one place that plausibly had it (the alert popover) and it only has webhook URL + two threshold numbers. **Cadence-fit criterion: fails as designed.** The movement gate softens the pain but doesn't satisfy what I actually asked for.

**"What hits my inbox — literally."** — Delivery is `dispatchAlert()`, and it POSTs a Slack Block-Kit JSON body to a webhook URL. That's the only channel. I read the file end to end; there's no branch to SES or any other email sender in this route, even though the codebase clearly *has* email infrastructure (`lib/email/ses.ts`) — it's just wired to a single-scan completion notice, not this digest. My shop runs on Outlook and Teams, not Slack; a lot of enterprise .NET floors do. If nobody on my team has stood up (or maintains) a Slack incoming-webhook — and given I don't log in, I wouldn't even know if it silently broke — the entire "arrives on its own" promise depends on infrastructure my org may not run. **Never-logs-in criterion is at risk**, not because the content is thin, but because the pipe itself is Slack-only.

**"Did this earn its line item — one sentence."** — At renewal, `/pricing` shows Enterprise as `Custom — contact us`, sourced from the same `plans.ts` map the entitlement gate reads, with retention `null` (custom, matches "no fixed retention ceiling" for us). That's exactly the shape I expect — I don't need a visible number, I need my value story to hold, and the price-legibility mechanics (single source of truth, no drift) support that. **Price-legibility criterion: met.**

---

## 5. Findings

```
{
  "id": "L1-robert-01",
  "journey": "repeated-org-scans-worth-the-price",
  "character": "robert-enterprise-dotnet",
  "cert_level": "L1",
  "type": "missing-feature",
  "severity": "major",
  "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
  "dimension": "missing",
  "title": "No digest cadence control — the recurring push is a hardcoded weekly cron, not configurable to monthly/quarterly",
  "expected": "An org (or Robert's admin) can set the fleet-digest push cadence to match his review rhythm (monthly/quarterly), per his 'Cadence fit' scored criterion.",
  "got": "vercel.json:11-14 pins the digest cron to `\"0 13 * * 1\"` (every Monday). src/lib/window.ts:100-104 `weekRangeParams()` hardcodes the summarized window to a trailing 7 days. The only per-org alert config (src/components/org/shared/AlertsControl.tsx:18-27, POST payload confirmed in src/app/api/org/alerts/route.ts:1-2) exposes webhookUrl + two regression thresholds — no cadence field. `SCHEDULES` (off/daily/weekly/monthly, src/components/connect/installationRepoTypes.ts:24-25) is a DIFFERENT control (per-repo autoscan frequency, consumed by /api/cron/rescan) on a surface Robert never opens.",
  "evidence": ["vercel.json:11-14", "src/lib/window.ts:100-104", "src/lib/alerts.ts:54-64", "src/components/org/shared/AlertsControl.tsx:18-27", "src/app/api/org/alerts/route.ts:1-2"],
  "code_check": "confirmed-absent",
  "verdict": "confirmed",
  "resolution": "open",
  "l2_priority": "At L2, try to configure a quarterly digest cadence anywhere in the org settings UI and confirm none exists live; also confirm the cron literally fires weekly against a live seeded org (or accept this as a static/infra fact not worth spending browser time on, since it's config-file-level and cannot differ between L1 and L2)."
}
```

```
{
  "id": "L1-robert-02",
  "journey": "repeated-org-scans-worth-the-price",
  "character": "robert-enterprise-dotnet",
  "cert_level": "L1",
  "type": "missing-feature",
  "severity": "major",
  "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "high" },
  "dimension": "missing",
  "title": "The fleet digest has no email delivery path — Slack-compatible webhook only",
  "expected": "Robert's JTBD is literally 'what hits my inbox' — a recurring artifact that arrives without him logging in, in a channel a director's floor actually uses (email being the enterprise default; many .NET/legacy shops don't run Slack).",
  "got": "src/lib/alerts.ts:432-456 `dispatchAlert()` POSTs a Slack Block-Kit JSON body (`{text, blocks}`) to a single resolved webhook URL (`resolveAlertWebhook`, alerts.ts:380-385) — there is no alternate transport. The codebase DOES have email infra (src/lib/email/ses.ts, an SES sender), but it's wired only to `dispatchScanCompletionEmail` for single-scan completion (src/app/api/scan/stream/route.ts:16) — never referenced from src/app/api/cron/digest/route.ts or src/lib/alerts.ts.",
  "evidence": ["src/lib/alerts.ts:432-456", "src/lib/alerts.ts:380-385", "src/lib/email/ses.ts:1-40", "src/app/api/scan/stream/route.ts:16", "src/app/api/cron/digest/route.ts:199-206 (only dispatchAlert is called)"],
  "code_check": "confirmed-absent",
  "verdict": "confirmed",
  "resolution": "open",
  "l2_priority": "At L2, confirm no email option surfaces anywhere in AlertsControl or org settings for a seeded org, and (if feasible) check whether a Teams-compatible payload shape is even accepted by dispatchAlert (it isn't — Slack Block Kit only) — this determines whether an Enterprise customer without Slack has ANY working delivery channel for the digest."
}
```

```
{
  "id": "L1-robert-03",
  "journey": "repeated-org-scans-worth-the-price",
  "character": "robert-enterprise-dotnet",
  "cert_level": "L1",
  "type": "confusion",
  "severity": "minor",
  "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "med" },
  "dimension": "clarity",
  "title": "Per-repo autoscan 'weekly/monthly' schedule (ScheduleSelect) is easy to conflate with digest push cadence, but controls something else entirely",
  "expected": "If an admin goes looking for 'how often does the recurring push fire', the only 'monthly' option they'll find anywhere in the product (ScheduleSelect's off/daily/weekly/monthly) should either be that control, or be clearly scoped away from it.",
  "got": "SCHEDULES (src/components/connect/installationRepoTypes.ts:24-25) is the per-repo scan frequency read by /api/cron/rescan, rendered on /org/[slug]/repositories (ScheduleSelect.tsx:1-82) — a different surface, different data model, and does not change when or whether the fleet digest sends.",
  "evidence": ["src/components/connect/installationRepoTypes.ts:24-25", "src/components/org/repositories/ScheduleSelect.tsx:1-9"],
  "code_check": "by-design",
  "verdict": "confirmed",
  "resolution": "open",
  "l2_priority": "Low priority — only worth an L2 check if an admin persona's journey specifically goes looking for cadence controls and could be misled into thinking they've solved L1-robert-01 by setting a repo's autoscan to 'monthly'."
}
```

**Strengths worth protecting** (not findings, but decision-relevant):
- `digestHasSignal()` (`alerts.ts:54-64`) is a textbook implementation of the actionable-alerts principle Robert's own reference cites — silent on a flat period, fires on real signal or low credits. This is exactly right and should not be "simplified away."
- Regression thresholds are derived from and documented against measured scan-to-scan noise (`maturity/noise.ts:1-8`), not picked arbitrarily — a defensible, citable design.
- Dedup-skip on unchanged commits (`rescan/route.ts:141-142`) closes the other half of "real movement, not noise."
- `/pricing` Enterprise display and the digest deep-link period are both single-sourced (`plans.ts`, `weekRangeParams`/`resolveWindow`) so they can't silently drift from what's actually charged/computed.

---

## 6. Character voice — would I adopt it?

"There's real engineering here — the part I was most worried about, a weekly email that says 'no change' forty-eight weeks a year, is the one thing this team clearly thought hard about. `digestHasSignal` reads like someone had the exact scar tissue I have. The regression math is defensible; I could put those two thresholds in front of my CTO and explain them in one sentence each, and that's rare.

But I asked for two very specific things and neither is there. One: I want quarterly, not weekly — that's not a preference, it's how my renewal cycle works, and right now the send schedule is a cron string in a config file, not a knob anyone can turn. The movement gate helps — on a stable fleet I might genuinely go quiet for a month — but 'might go quiet as a side effect' isn't the same as 'I set it to quarterly.' Two, and this is the one that actually worries me: it only speaks Slack. My floor runs on Outlook and Teams. If procurement asks me at renewal whether this recurring artifact earned its line, and it turns out nobody in my org even set up the webhook, I have nothing to show — and I wouldn't know, because I don't log in to check. A tool whose whole pitch is 'you don't have to open the dashboard' cannot have its only delivery pipe be an integration my company might not run.

Fix those two and I'd forward the digest up as-is — the content itself already clears my bar. Today, I can't certify it, because I can't be sure it reaches me at all, on a cadence I chose."

---

## Summary

- **Verdict: L1-conditional** — the journey completes structurally (a genuinely substantive, noise-aware, well-reasoned recurring artifact exists and its content clears Robert's senior-quality bar), but two majors — no cadence control and Slack-only delivery — sit directly on his scored criteria and must be resolved or accepted before this can be called done for him. Still L2-eligible: the content-quality claims (does the digest read as substantive, does the noise gate actually behave) are worth confirming live.
- Estimated time-saved-if-design-holds: **~240–480 min (4–8 hrs) of chief-of-staff time per quarterly cycle + ~10 min of Robert's own read time**, per his Motivation section — **conditional on the digest actually reaching him on his cadence**, which today it structurally cannot guarantee (weekly-only, Slack-only).
- Grounding score: n/a (digest is a template over precomputed facts, not an LLM prompt surface).
