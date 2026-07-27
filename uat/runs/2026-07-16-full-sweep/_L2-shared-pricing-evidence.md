# L2 shared evidence — `repeated-org-scans-worth-the-price` (pricing-20 panel)

**Run date:** 2026-07-16. **Engine:** `LLM_PROVIDER=claude-cli` confirmed live — every real scan below returned `engineProvider:"claude-cli"` (not mock). **Env:** `npm run dev` on :3000, in-process PGlite (`.pglite/ascent`), `.env.local` per `uat/env.md` (ASCENT_AUTH_BYPASS=1, ASCENT_OPEN_ORG_DASHBOARDS=1, ASCENT_ALLOW_PLAN_CHANGES=1).

This is the ONE live ground-truth run the 20 pricing-20 Characters' reactions get synthesized against. It supersedes/extends `uat/runs/2026-06-20-pricing20/_L2-claude-cli-report.md` (that run's PGlite data did not survive — `vercel`/`ky` history was empty at the start of this session; re-derived from scratch).

---

## 1. Seed methodology (read this before trusting the trajectory numbers below)

Getting genuine **multi-date** history live, today, without waiting real days, required a documented technique:

1. `node scripts/seed-org.mjs vercel 2 --live` → two real claude-cli scans of `vercel/ai` and `vercel/eve` (headSha `e8043b4f...`, `5f8818b4...`). Took ~4 min total for 2 repos.
2. Stopped the dev server (PGlite is single-writer). Ran a one-off script directly against `.pglite/ascent` that **backdated** those two `Scan` rows' `scannedAt` to 21 days ago (`2026-06-25`) and appended `-backdated21d` to their stored `headSha` (so the unique `(repoId, headSha)` constraint wouldn't block a same-commit re-scan today).
3. Restarted the dev server, re-ran `node scripts/seed-org.mjs vercel 2 --live` — a **second independent live claude-cli scan** of the same two repos, today, real headSha, ~7 minutes after step 1's wall-clock time (repo genuinely unchanged in that window).

Net effect: `vercel/ai` and `vercel/eve` now have **two real claude-cli-scored data points, 21 calendar days apart** in the DB, both against the literal same commit (since the repos didn't change in the few real minutes between the two live calls) — i.e. this is simultaneously (a) a genuine multi-date history fixture for exercising trajectory/trends UI, and (b) an unplanned repeat of the prior run's "rescan the same commit — is the delta noise?" experiment, with a *larger* dimension count sampled.

Remaining 4 `vercel` repos (`next.js`, `vercel/vercel`, `workflow`, `v0-sdk`) are mock-engine, single-scan (from an earlier same-day import) — they exercise the "not enough history yet" / "mock" paths.

Raw data: `C:\Users\kazda\AppData\Local\Temp\claude\...\scratchpad\vercel-ai-history2.json`, `vercel-eve-history2.json` (also reproducible via `GET /api/history?repo=vercel/ai`).

---

## 2. Is the engine stable on repeat (same-commit) scans? → mostly yes, with a wider per-dimension swing than the prior run found

| repo | overall (Jun 25 → Jul 16) | max per-dim swing | which dim |
|---|---|---|---|
| `vercel/ai` | 80 → 80 (**Δ0**) | **±4** | D7 "Commits" 98→94 |
| `vercel/eve` | 75 → 75 (**Δ0**) | ±2 | D5 "Docs" 71→69, D4 "Agentic" 41→39 |

Full `vercel/ai` dims: D1 97/97, D2 99/98, D3 97/98, D4 35/36, D5 61/61, D6 72/71, **D7 98/94**, D8 86/86, D9 54/54.

- **Overall score is rock-stable** (Δ0 on both repos) — reconfirms the prior cycle's L2-01 finding (2026-06-20: Δ0 overall, ±1 max dim on `sindresorhus/ky`) that the blended score doesn't wobble meaningfully run-to-run on an unchanged repo.
- **But the per-dimension swing here (±4 on D7) is wider than the single prior sample (±1)** — still far under the ±25 LLM guardband, but it means `SCORE_NOISE_BAND = 2` (the app's own calibrated noise threshold, see §3) is *tight enough that a real dimension-level swing on an unchanged repo can exceed it*. This doesn't currently mislead anyone in the UI because per-dimension deltas aren't rendered anywhere with up/down styling (the heatmap shows only the latest score, no delta) — but it's a data point the panel should have: the *dimension*-level noise floor is not as tight as the *overall*-level one, so any future feature that adds delta arrows to the dimension heatmap should recheck the ±2 band against a larger sample.

## 3. Is score-move noise now legible to the user? → **materially fixed since the last run — this is the single biggest change**

The prior run (2026-06-20) flagged as its top open item: *"the engine's stability is invisible… movers/briefing/digest render a raw +N with no confidence."* That finding is now resolved by design, in code the panel can point to:

- **`src/lib/maturity/noise.ts`** — a new canonical `SCORE_NOISE_BAND = 2` + `isWithinNoise()`/`classifyDelta()`. The file's own comment cites the exact prior-run numbers as its calibration basis: *"two INDEPENDENT claude-cli re-scans of the SAME commit (UAT pricing-20 L2, 2026-06-20) moved 0 points overall and ±1 per dimension… So a small period-over-period delta is statistically indistinguishable from that wobble."* — a rare, concrete case of a UAT finding closing the loop into shipped product code.
- Applied everywhere a delta renders: `components/ui/format.ts` (`fmtDelta`/`toneFor` render `≈` and a neutral tone for within-noise deltas instead of a confident ▲/▼), the digest (`api/cron/digest/route.ts`: `regressersBeyondNoise`/`gainersBeyondNoise` filter noise out of what triggers/lists in the weekly email), and `lib/alerts.ts` (regression alerts don't fire on a noise-band delta).
- **Live confirmation:** the Fleet rollup on `/org/vercel` renders `vercel/ai` and `vercel/eve` — both genuinely Δ0 across the 21-day window — as **`→0` avg move** (neutral tone, not styled as a "fall"), and the fleet masthead shows `avg move →0` correctly. The delta is real (not synthesized) and correctly read as "held."
- **Engine-transition muting also confirmed live:** `RepoCategoryRollup.tsx`'s `deltaCrossesEngine` greys out (and adds a tooltip to) any delta that spans a mock→live engine change, so a repo re-scanned live for the first time doesn't show a big colored "improvement" that's actually just "we finally used the real model." The other 4 `vercel` repos are single-scan mock and correctly show `—` (no delta at all, not a fake one).
- **Per-repo Trends page (`/trends?repo=vercel/ai`) explicitly names low-data:** with exactly 2 scans, the Trajectory card renders `trend confidence — low data (n=2)` instead of a bogus 100%, per `forecast.ts`'s `lowData: n < 3` guard. `forecastHeadline`: *"Holding around 80 (L4 · Integrated) — no level change projected."* — an honest, specific "nothing changed" read, which is exactly what a repeated scan of an unchanged repo *should* say.

**Net: finding L2-02 from the 2026-06-20 report is resolved for the surfaces it named** (movers tiles, digest). One place it is **not** resolved — see §4, a new, more consequential finding on the highest-stakes surface (the board/exec briefing).

## 4. NEW finding — the org-level Executive Briefing trajectory shows a confident, dated ETA headline with ZERO confidence caveat when the underlying data is low

Live at `/org/vercel/executive`:

> **Trajectory** — *"At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13)."*

No `trend confidence …%` line follows it (verified: `grep -c "confidence" org_vercel_executive.html` → **0** occurrences anywhere on the page). Compare this to the exact same org's per-repo `/trends?repo=vercel/ai` page, which for the identical low-data situation explicitly renders `trend confidence — low data (n=2)`.

**Root cause (code-confirmed, `src/lib/org/briefing.ts:242-248`):**
```ts
forecastHeadline: rollup.forecast ? forecastHeadline(rollup.forecast) : null,
// ...Suppress the number on low data — the trajectory headline still renders, just without a bogus confidence.
forecastConfidence:
  rollup.forecast && !rollup.forecast.lowData ? Math.round(rollup.forecast.fitQuality * 100) : null,
```
and `forecastConfidenceNote()`:
```ts
export function forecastConfidenceNote(confidence: number | null): string | null {
  if (confidence == null) return null;   // ← low-data case returns null, so NOTHING renders
  return `trend confidence ${confidence}%...`;
}
```
The intent (per the code comment) was to avoid showing a **false 100%** on a 2-point fit — a real fix for a real overconfidence bug. But the implementation goes one step further than the per-repo `Trajectory.tsx` component does for the identical case: `Trajectory.tsx` explicitly substitutes an honest `"trend confidence — low data (n=X)"` string; the executive briefing's `forecastConfidenceNote` just returns `null`, so the `{... && (<p>...</p>)}` guard in `executive/page.tsx:159-161` renders **nothing at all**. Same root data, same `lowData` flag, two different renderings — one honest, one silent.

**Why this matters for THIS journey specifically:** the executive briefing is explicitly the **board-ready / renewal-decision surface** — it has a "Download PDF" button and a "Copy briefing for LLM" button that a director would forward unedited to a CFO or paste into a renewal justification. A dated, specific-sounding ETA ("≈ 2026-08-13") with no caveat is the worst place for this gap to exist: it's precisely the "can I tell a real move from noise" question this whole journey turns on, and the one surface most likely to leave the building without a human in the loop to add the missing context. The `briefingMarkdown()` function (used by both PDF and "copy for LLM") has the same `b.forecastConfidence != null` guard, so the exported artifact is silent too.

**Severity:** major, trust-eroding, board-facing. **Fix is cheap** — reuse the exact "low data (n=X)" string `Trajectory.tsx` already has, gated on `briefing.forecastHeadline` alone (not on `forecastConfidence != null`).

## 5. Pricing legibility — `/pricing` now shows real numeric prices (prior finding L2-04 resolved)

Live at `GET /pricing` (`src/lib/plans.ts` is the single source, read by both the entitlement gate and the pricing page — so the copy structurally cannot drift from what's billed):

| Tier | Price shown | Included scans/mo | Seats | Retention |
|---|---|---|---|---|
| Free | **$0** · "free forever" | 5 | 1 | 30d |
| Pro | **$10 / month** | 100 | 3 | 180d |
| Team | **$20 / month** | 500 | 10 | 365d |
| Enterprise | **Custom** · "contact us" | Unlimited | Unlimited | Custom |

This directly **refutes** the 2026-06-20 report's L2-04 ("Pro/Team subscription price is invisible live — value-vs-price is undecidable in-app"). A viewer today CAN compute e.g. "$10/mo ÷ 100 scans = $0.10/scan-cycle at Pro" without contacting sales. Enterprise correctly stays "Custom" (matches the journey's stated expectation, not a gap).

The pricing page also has a full **"Where your credits actually go"** table (◈ draws credits / ○ always free / ▸ included) — e.g. explicitly states *"Re-scan an unchanged commit — Cached — re-running a scan on the same commit never costs a credit… ○ Free ✓ Included [all tiers]"* — which matches what we measured live in §2 (my backdated-then-rescanned commit reused the same headSha the first time and *would* have deduped for free, which is exactly why I had to mangle the stored headSha to force a second billable-looking scan for the test).

## 6. Per-cycle cost↔value legibility at the Free tier — confirmed legible, PLUS one concrete miscalibrated-copy bug

Live at `/usage?org=vercel` (Free plan, 8 scans total — 8 public/free, 0 private/billable):

- **Legible, well-labeled:** `Monthly allotment · Free plan · 5 credits/mo` · `0% of your 5/mo allotment` · `Comfortably within your 5/mo Free allotment. Unused credits roll over — they never expire.` · `Est. cost $1.26 last 30d · built-in rates (approx.)` · `Input tokens 153,827` / `Output tokens 53,534` · `By inference engine: Claude CLI 4 · 50%, Mock 4 · 50%`. This is exactly the "one re-pullable number + provenance" the journey references (DX Core 4 / AI-ROI norm) — a buyer can see real $ cost, real token counts, and real engine mix in one place, per cycle.

- **Bug — the low-balance banner is factually wrong for a fresh Free-tier org.** The page renders, in a warning-colored callout right at the top:

  > **"Out of private-scan credits — the next private scan will be refused (402) until you top up."**

  …on an org that has done **0 private scans** and has its full **5/mo Free allowance untouched**. Root cause (`src/app/usage/page.tsx:142` + `usageDashboard.tsx:45-51`):
  ```ts
  const lowBalance = creditBalance != null && (creditBalance === 0 || (billable > 0 && creditBalance <= billable));
  ```
  `creditBalance` here is the **prepaid overflow-credit balance** (0 for any org that's never bought/been granted credits), which is entirely separate from the monthly allowance. But the actual entitlement logic the scan endpoint uses (`src/lib/plans.ts` `decideScanCharge`) checks the **allowance first**:
  ```ts
  if (opts.allowance != null && opts.usageThisMonth < opts.allowance) return "allowance";  // free, no credit touched
  return opts.balance > 0 ? "credit" : "denied";                                            // credit balance only matters AFTER allowance is exhausted
  ```
  So `creditBalance === 0` alone does **not** imply the next private scan will be refused — it only does once `usage.usageThisMonth (private) >= plan.includedCredits`. The banner ignores `usageThisMonth`/allowance entirely and fires for **every Free-tier org that hasn't purchased overflow credits yet**, which in practice is most Free orgs, including brand-new ones with their full allotment sitting unused. This directly contradicts the very next section of the *same page*, which says "Comfortably within your 5/mo Free allotment." Two panels on one screen disagree about whether the org is about to be locked out.

  **Journey relevance:** this is precisely a "per-cycle cost↔value legibility" bug — a Free-tier evaluator (Priyanka/Kenji/Yusuf-type Characters) opening `/usage` mid-evaluation would read "you're about to be refused" and could panic-upgrade or conclude the free tier is a bait-and-switch, when in fact they have 5 free scans/month sitting untouched. Severity: major (trust-eroding, directly contradicted by adjacent copy on the same page), cheap fix (gate the banner on `usage.usageThisMonth >= scanAllowance(plan)`, not on raw `creditBalance === 0`).

## 7. Cadence controls (schedule / rescan) — render disabled-with-hint, not hidden, when the GitHub App isn't configured (as designed)

Live at `/org/vercel/repositories` (dev has no GitHub App configured — `GET /api/health` → `"autoscan":{"ready":false,"githubApp":false}`):

```html
<select disabled title="Autoscan scheduling requires the GitHub App." aria-label="Autoscan cadence for vercel/ai" .../>
<button disabled title="Rescanning requires the GitHub App." aria-label="Rescan vercel/ai" .../>
```

Matches the code comment's stated intent exactly ("the cadence control renders disabled with a hint rather than vanishing, so the capability stays discoverable") — confirmed live, not just in source. `POST /api/org/schedule` independently 503s with `"Autoscan scheduling requires the GitHub App + a database."` if hit directly. This is a legitimate environment limitation of local dev (no GitHub App credentials), not a product bug — flagging so the panel doesn't mistake "I can't click Rescan in this UAT env" for "the product doesn't have a rescan/cadence feature."

## 8. Executive briefing "value realized" line — legible, cycle-over-cycle actionability confirmed

`/org/vercel/executive` renders, live:
- `Value this period — 1 recommendation completed`
- `0 of 2 repos moved (0▲ / 0▼)` — correctly scoped to only the repos with ≥2 comparable in-window scans (matches §2/§3's genuinely-flat pair), not a fabricated count from the 4 single-scan mock repos.
- `Scored by Claude CLI ×4, Mock (deterministic) ×4 · ⚠ some scores used the deterministic mock engine` — transparent per-period engine-mix disclosure, directly answering "is this cycle's number degraded."
- `The move to make next` — ranked, quantified leverage moves, e.g. *"Agent guidance is thin… AI Tooling · ≈ +9.3 maturity pts on each of 3 repos if closed · advances 1 to the next level · affects 3 repos: next.js, v0-sdk, vercel"* — specific, repo-named, quantified next action. This is the kind of "new, actioned decision" the Gartner renewal-norm reference in the journey frontmatter is looking for, and it's real (not templated) — the numbers tie to this org's actual weakest dimensions (D4 Agentic 33, D9 Security 52, D1 AI Tooling 62 — all confirmed against the live heatmap in §9).

## 9. Live heatmap + fleet rollup numbers (raw reference for the panel)

`/org/vercel` Fleet: **6 repos, avg 72**, `▲0 ▼0 →2` (2 = the two genuinely-compared repos holding flat), `avg move →0`, **4 mock**. Dimension heatmap fleet averages: AI Tooling 62 · Testing 90 · CI/CD 95 · Agentic 33 · Docs 68 · Quality 86 · Commits 87 · AI Process 74 · Security 52 — Agentic (D4) and Security (D9) are the fleet's clear weak points, consistent with the executive briefing's "weakest dimensions" list.

---

## Findings summary (severity-ranked)

1. **[major, NEW]** Executive-briefing trajectory ETA renders with zero confidence/low-data caveat on the board/PDF/LLM-export surface, while the per-repo Trends page shows the caveat for the identical situation. `src/lib/org/briefing.ts:242-248`, `forecastConfidenceNote()`, `executive/page.tsx:159-161`. — §4
2. **[major, NEW]** `/usage` "Out of private-scan credits — next scan will be refused" banner fires for any Free-tier org with 0 prepaid credits, even with its full 5/mo allowance untouched — contradicts the "Comfortably within your allotment" text on the same page and the actual entitlement logic (`decideScanCharge` checks allowance before balance). `src/app/usage/page.tsx:142`, `usageDashboard.tsx:45-51`. — §6
3. **[resolved-verified, closes 2026-06-20 L2-02]** Score-move noise is now legible: `SCORE_NOISE_BAND`/`isWithinNoise` applied to movers/digest/alerts; live-confirmed `→0` neutral rendering on a genuinely-flat real re-scan pair. — §3
4. **[resolved-verified, closes 2026-06-20 L2-04]** `/pricing` now shows real Pro $10/mo, Team $20/mo, Enterprise "Custom." — §5
5. **[strength, refined]** Engine stability reconfirmed (Δ0 overall on 2 repos across a real 21-day-labeled window) but the per-dimension noise floor (±4 seen here vs ±1 in the 2026-06-20 sample) is wider than the app's own calibrated `SCORE_NOISE_BAND=2` constant — not currently user-visible (no per-dim delta UI exists yet) but worth a wider recalibration sample before any feature adds one. — §2
6. **[by-design, confirmed live]** Cadence controls (schedule/rescan) correctly render disabled-with-tooltip, not hidden, when the GitHub App isn't configured — an environment fact for this UAT run, not a product gap. — §7

## Evidence index
- `C:\Users\kazda\AppData\Local\Temp\claude\...\scratchpad\` — `vercel-ai-history2.json`, `vercel-eve-history2.json` (raw 2-scan history), `org-vercel.txt`/`.html`, `org_vercel_executive.txt`/`.html`, `trends-ai.txt`/`.html`, `usage_org_vercel.txt`/`.html`, `org_vercel_repositories.txt`/`.html`, `pricing.html`, `seed-vercel-live-1.log`, `seed-vercel-live-2.log`, `backdate.mjs` (the backdating script, for reproducibility).
- Live endpoints anyone can re-hit while the seeded state persists: `GET /api/health`, `GET /api/history?repo=vercel/ai`, `GET /org/vercel`, `GET /org/vercel/executive`, `GET /trends?repo=vercel/ai`, `GET /usage?org=vercel`, `GET /org/vercel/repositories`, `GET /pricing`.
