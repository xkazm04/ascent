# L1 report — Helena (M&A tech DD advisor) × "Repeated org scans worth the price"

Cert level: **L1 (theoretical, code-grounded)**. No browser was used; this is a walkthrough over the surface model below.

---

## 1. Surface model (with citations)

### Pricing legibility — `/pricing`
- `src/app/pricing/page.tsx:40-45` — `PRO_PRICE`/`TEAM_PRICE` are derived from `planPriceLabel()` (`src/lib/plans.ts:88-93`), which reads `PLAN_FEATURES[plan].monthlyPrice` (`src/lib/plans.ts:32-81`). Free = `$0`, Pro = `$10/mo`, Team = `$20/mo`, Enterprise = `"Custom"`. These are **real numeric $ amounts**, not obfuscated behind "credits" — the same object the entitlement gate (`resolveScanCharge`, `src/lib/plans.ts:143-150`) reads, so copy can't drift from what's charged (`src/app/pricing/page.tsx:35-38` comment).
- `src/app/pricing/page.tsx:110-122` — explicit prose: "Buy prepaid scan credits (1 per scan), which roll over and never expire." Confirms prepaid credits are decoupled from a subscription — buyable while staying on Free.
- **Gap**: `src/lib/polar.ts:39-50` (`creditPacks()`) defines credit packs as `{productId, credits, label}` — **no `$` price field at all**. The catalog is parsed from `POLAR_CREDIT_PACKS` (`id=credits` pairs only). `CreditMatrixLedger` (`src/components/pricing/CreditMatrixLedger.tsx:22-24`) shows *which operations* cost credits, not what a credit costs in dollars. The only place a pack is offered is `CreditsControl` (`src/components/org/shared/CreditsControl.tsx:209-219`), which renders `p.label` ("100 credits") with a link to an external Polar checkout (`/api/billing/checkout`) — the dollar price is revealed only after that click, off-app. So: **subscription $ is honest and visible; prepaid-credit $ is not, anywhere in the app.**

### Burst-vs-subscription mechanics
- `src/lib/plans.ts:117-134` (`decideScanCharge`) — a scan is `allowance` (free, under the plan's monthly included count) → `credit` (prepaid) → `denied` (402). Free plan's allowance is 5/mo (`src/lib/plans.ts:36`).
- `src/lib/polar.ts:91-99` (`polarEnabled`) — checkout works if either a credit-pack catalog *or* a plan-subscription catalog is configured; a **credit-pack-only deployment is explicitly supported** (comment at `src/lib/polar.ts:91-96`), meaning Helena's target usage pattern (stay Free, buy a burst of credits, never subscribe) is a first-class configuration, not an edge case.
- Reachability: `CreditsControl` is rendered in the org header (`src/app/org/[slug]/layout.tsx`, confirmed via grep) and gated by `buyEnabled`/`grantsEnabled` flags that ultimately come from `polarEnabled()`/`ASCENT_ALLOW_CREDIT_GRANTS`. In the UAT bypass env (`uat/env.md`), `ASCENT_ALLOW_CREDIT_GRANTS=1` and `POLAR_SERVER=sandbox` are the dev seams — so this surface is reachable under the pinned env, though real $ price still isn't shown even in the dev "simulate a purchase" path (grant buttons show credit counts, not $).

### Retention window (how far back her trajectory can look)
- `src/lib/plans.ts:189-192` (`retentionCutoff`) — Free 30d, Pro 180d, Team 365d, Enterprise unlimited, derived from `PLAN_FEATURES[plan].retentionDays`.
- Enforced (not just displayed) in the trajectory/history reads: `src/lib/db/org-rollup.ts:396-397` and `:557-558` clamp `trendStart`/`lower` to `retentionCutoff(org.plan, Date.now())` — a real read floor, not a marketing-only number.
- **Gap**: I did not find `retentionDays` surfaced as copy anywhere in `/pricing` or `/org/[slug]` UI (the pricing feature bullets list "180-day history" / "1-year history" as *feature strings*, `src/lib/plans.ts:55,67`, so it IS shown per-plan on `/pricing` — retracting the gap: it's visible there). Confirmed via `src/app/pricing/page.tsx:89-94` which renders `p.features` verbatim.

### Trajectory honesty (short, sparse window)
- `src/lib/maturity/forecast.ts:119-182` (`forecastTrajectory`) — OLS fit over the score series; returns `null` below 2 distinct days (`:124`). `fitQuality` (R²) is computed (`:153`) and a `lowData` flag (`:178`, `n < 3`) explicitly warns consumers not to render `fitQuality` as a hard confidence when the point count is too low to have real degrees of freedom — a 1–2 point fit is perfect by construction, "the LEAST trustworthy fit reports the HIGHEST confidence" (comment, `:58-62`).
- `src/lib/org/briefing.ts:33-38` (`forecastConfidenceNote`) — renders `"trend confidence {confidence}% · noisy"` when confidence < 50, `null` when there's no confidence figure (too little history) — and `src/lib/org/briefing.ts:243-247` explicitly suppresses the number on `lowData` so the exported board PDF never prints a bogus "100% confidence" off 1–2 points.
- Rendered on `/org/[slug]/executive`: `src/app/org/[slug]/executive/page.tsx:153-168` — "Not enough history yet to project a trajectory." when there's no headline, else the headline + the confidence note directly under it.
- For Helena's 3–6 scans over 4–6 weeks: `n` will typically be 3–6 distinct days, so `lowData` is usually `false` (≥3), but a genuinely noisy short series still surfaces via the `< 50%` "noisy" flag on `fitQuality`, not a suppressed confident ETA. This directly satisfies her "don't sell me an ETA off four dots" bar **as designed** — R² on n=3–6 is a thin statistical base but the code is honest about exactly that, which is the promise she's judging.

### Move-is-real vs. LLM guardband noise
- `src/lib/maturity/noise.ts:16-27` — `SCORE_NOISE_BAND = 2`; `isWithinNoise`/`classifyDelta` are the canonical "is this a real move" primitive, with a code comment citing an actual empirical basis: "two INDEPENDENT claude-cli re-scans of the SAME commit... moved 0 points overall and ±1 per dimension" (`:6-8`).
- Used by `src/components/ui/format.ts:33-34,42` (`toneFor`, arrow glyph) — a delta within ±2 renders as `"flat"` tone and a `"≈"` glyph, not a confident up/down arrow.
- Consumed in the Overview's Fleet rollup (`src/components/org/overview/RepoCategoryRollup.tsx:130-133`, `:118-133`, `deltaHex`/`fmtDelta` on `r.deltaWindow`) — each repo row's delta is noise-muted automatically.
- `src/components/org/overview/repoTrajectory.ts:39-41,61,120-127` — a second, distinct kind of false-positive move is also caught: `deltaCrossesEngine` mutes a delta that spans a mock→live engine switch (so a seed-to-real-scan jump never reads as "real" movement either).
- **Gap in the reframed surface**: the new `RepoDimensionHeatmap` (`src/components/org/overview/RepoDimensionHeatmap.tsx`) — which the discovery hints flag as the replacement for the old movers list — shows only the **current absolute score per repo × dimension** (`:113-127`, `byId[d] ?? 0`, no delta, no noise coloring, no "since last scan" framing at all). "What changed since last time" is answered only by the separate `RepoCategoryRollup` component that sits above it on the same Overview page (`src/app/org/[slug]/page.tsx:125,131`), not by the heatmap itself. The heatmap and the movers-replacement are two different components co-located on one page — a Character has to know to read the top card for movement and the bottom one for the strong/weak grid.

### Exportable deal artifact
- PDF: `src/app/org/[slug]/executive/page.tsx:76-81` → `/api/org/briefing/pdf` (confirmed route exists via the href construction; scoped by period/segment/stack query params so the exported PDF matches the viewed scope).
- Markdown: `briefingMarkdown(briefing)` (`src/lib/org/briefing.ts`, imported at `executive/page.tsx:6`) fed to `<CopyForLlm text={md} .../>` (`executive/page.tsx:85`) — a "Copy briefing for LLM" action.
- CSV: `src/app/api/org/export/route.ts`, `src/app/api/history/route.ts`, `src/app/api/usage/route.ts` all emit `text/csv` (confirmed via grep for `text/csv`/`.csv`).
- Share link: `BriefingShareButton` (`executive/page.tsx:10,84`) gated to owners (`isOwner`, `:56-57`) via `hasOrgRole(slug, "owner")` (`src/lib/authz`).
- These artifacts are static exports (PDF bytes, markdown string, CSV rows) — nothing in the export path re-queries a live login on open, matching her "file it and cancel" requirement structurally. I did not find an expiry/revocation check gating *reading* an already-downloaded PDF/CSV (by construction they can't be — they're files), which is the right shape for her.

### Clean exit (no forced ongoing charge)
- `decideScanCharge` (`src/lib/plans.ts:125-134`) never requires an active subscription to *read* existing data — plan gates only the *next scan's* charge. Retention (`retentionCutoff`) gates how far back reads go, but doesn't delete or lock out existing scans within the window.
- I did not find a mechanism that revokes already-exported PDF/CSV/markdown after a plan downgrade or credit exhaustion — consistent with "clean exit," though this is inferred from absence, not a positive assertion I can point to a line for.

### Reachability for Helena specifically
Under the pinned UAT env (`ASCENT_AUTH_BYPASS=1`, `ASCENT_OPEN_ORG_DASHBOARDS=1`, `LLM_PROVIDER=claude-cli`), all of `/org/[slug]`, `/org/[slug]/executive`, `/trends`, `/usage`, `/pricing` are reachable with no login (`uat/env.md:30-42`). Her binding (character frontmatter `maps_to`) matches exactly these five surfaces — no nav/entitlement gate stood between her and any surface examined above. `CreditsControl`'s buy path additionally requires `POLAR_SERVER=sandbox` + a configured pack catalog (`POLAR_CREDIT_PACKS`), which is a real fixture dependency for L2, not a Helena-specific gate.

---

## 2. In-character walkthrough against her scored criteria

**Burst-vs-subscription legibility** — I can see the Pro/Team subscription $ plainly ($10/$20/mo, real numbers, not "prepaid credits" doublespeak — `/pricing`). Good, that's the thing I always distrust and here it isn't hidden. But when I go to actually price *my* pattern — stay on Free, buy a burst of credits for six weeks — the credit pack itself has no dollar sign anywhere in the product. I'd have to click "Buy credits," get punted to an external Polar checkout, and only then see what a pack costs. That's not as bad as a hidden monthly floor, but it's still "click through to discover the price," which is exactly the adversarial read I do on every pricing page. **Partial pass** — the floor question (is there an idle monthly charge?) is answered honestly (no, credits roll over and Free is real $0), but the burst price itself isn't legible without leaving the app.

**Recurring-value-in-window** — the Fleet rollup shows real per-repo deltas with noise-aware coloring, and the executive briefing's "Movement this period" + "Highest-leverage moves" sections are built to surface something new each period, not just restate the number. On paper this looks like it would answer "did this cycle tell me something new" — assuming the target's repos actually move over 4–6 weeks, which for a mature/stable acquisition target might genuinely be "nothing new," and the design at least doesn't fake movement to answer that (noise band mutes it instead of hiding the null result under invented confidence). **Design plausibly passes**; L2 needs to confirm the actual per-cycle content isn't repetitive boilerplate.

**Trajectory honesty over a short window** — this is the strongest match in the whole surface. The `lowData` flag and the `< 50% → "noisy"` copy are exactly the hedge she wants, backed by a genuine "R² through 2 points is meaningless" engineering rationale in the code comments. I'd actually trust an ETA gated this way. **Pass, as designed.**

**Move-is-real vs re-scan noise** — the ±2 noise band, with an empirical basis cited in the code (two independent re-scans of the same commit moved 0 and ±1), is precisely the guardband-wobble problem she names by name in her voice section. It's applied to the Fleet rollup's per-repo deltas. My one worry: the *new* heatmap that replaced the old movers list doesn't apply this at all — it shows raw current scores with no noise framing, so if I only look at the heatmap (which is directly below the Fleet card, same page) I'd get an un-hedged absolute number, not a hedged delta. As long as I read the Fleet card above it for movement, I'm fine; if the heatmap alone were my "what changed" surface, I'd be exposed to unhedged single-point reads. **Pass with a caveat**, flagged as a finding below.

**Exportable deal artifact** — PDF, markdown-for-LLM, and CSV all exist, scoped to the period/segment/stack I'm viewing, gated to owner for sharing. This is squarely the "board-ready PDF I can file and walk away from" she wants. **Pass, as designed.**

**Clean exit** — nothing in the model forces an ongoing charge to keep already-exported artifacts; plan only gates the *next* scan and how far back *reads* look. **Pass, as designed** (an absence-based finding — can't cite a positive control here, only that no revocation-on-downgrade code path turned up).

## Motivation / time-saved (her own numbers)
Her stated math: manual first-pass audit 40–80h/target; Ascent's promise collapses that to ~a day; per-*cycle* (re-scan within a deal) saving is smaller, ~2–4h of her own "re-read the diff since last look" time. The designed surfaces (Fleet deltas, executive Movement section, OrgLeverageMoves) are built to answer exactly "what changed since I last looked" in one glance rather than her re-reading a diff — so the 2–4h/cycle saving is plausible *if* the per-cycle content is genuinely new each time (unconfirmed at L1; genuinely depends on live data, which is L2's job). Estimated time saved if the design holds: **~2–4h per re-scan cycle**, **~30–60h per full 4–6-week deal** (her own stated total-audit-collapse number, since nothing in the surface model contradicts it).

## Senior-quality bar
The trajectory/confidence honesty (lowData, noisy-flag) and the noise-banded deltas are exactly the kind of self-aware caveat a senior DD advisor would insist on before putting a number in a deal memo — this is a genuine strength, not just adequate. The executive briefing's per-dimension evidence (strengths/risks tied to `practiceHref`, dimension rows) gives her something to point at rather than a bare score. The one place the bar is untested at L1 is the *prose quality* of the LLM-authored evaluation text itself (dimension `evaluation`/`next steps` fields) — that's inherently an L2/live-output question, not visible from the surface model.

---

## 3. Findings

```json
[
  {
    "id": "L1-HEL-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "helena-ma-techdd",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Prepaid credit-pack price is never shown in-app — only revealed after clicking into external Polar checkout",
    "expected": "As the buyer of a burst of credits (not a subscription), she can see the $ per pack on /pricing or in the CreditsControl popover before deciding.",
    "got": "CreditPack (src/lib/polar.ts:16-20) carries only {productId, credits, label} — no price field. /pricing's CreditMatrixLedger (src/components/pricing/CreditMatrixLedger.tsx) shows which operations cost credits, not what a credit costs. CreditsControl (src/components/org/shared/CreditsControl.tsx:209-219) renders pack labels like \"100 credits\" linking straight to /api/billing/checkout — price only appears at the external Polar checkout page.",
    "evidence": ["src/lib/polar.ts:16-20", "src/lib/polar.ts:39-50", "src/components/pricing/CreditMatrixLedger.tsx:22-24", "src/components/org/shared/CreditsControl.tsx:205-221"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Drive the actual Buy-credits popover + Polar sandbox checkout and confirm whether the $ ever appears in-app before the external redirect, and whether the sandbox checkout page itself states a clear one-time (non-recurring) price."
  },
  {
    "id": "L1-HEL-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "helena-ma-techdd",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "The heatmap that replaced the old movers list shows only current absolute scores, not deltas — \"what changed since last time\" lives in a separate card above it",
    "expected": "The Repositories×Dimension surface that took over the old movers list's role communicates movement, or at least visibly defers to the card that does.",
    "got": "RepoDimensionHeatmap (src/components/org/overview/RepoDimensionHeatmap.tsx:113-127) renders raw current scores per repo×dimension with no delta, no noise-band coloring, and no \"since last scan\" framing. The noise-aware delta (deltaWindow, toneFor/isWithinNoise) only appears in the separate RepoCategoryRollup card rendered above it on the same page (src/app/org/[slug]/page.tsx:125,131).",
    "evidence": ["src/components/org/overview/RepoDimensionHeatmap.tsx:113-127", "src/app/org/[slug]/page.tsx:100-132"],
    "code_check": "present-by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm a first-time-in-a-while visitor's eye actually lands on the Fleet card's deltas before the heatmap, and doesn't mistake the heatmap's raw scores for \"what moved.\""
  },
  {
    "id": "L1-HEL-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "helena-ma-techdd",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "Prose quality of the per-dimension evaluation/next-steps text is unverifiable at L1",
    "expected": "N/A at this level — flagged so L2 explicitly checks it.",
    "got": "The surface model shows the plumbing (strengths/risks tied to dimension evidence, practiceHref links) but not the actual LLM-authored sentences a senior would judge for genericness (\"add more tests\" style output would fail her bar).",
    "evidence": ["src/app/org/[slug]/executive/page.tsx:183-212"],
    "code_check": "n-a",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Run a live claude-cli scan on a real seeded org and read the dimension evaluation/next-steps prose against her senior-quality bar (would she paste it in a deal memo, or does it read like generic filler)."
  }
]
```

## Strength (positive finding, worth protecting)
- **Trajectory honesty is exactly her bar.** `forecastTrajectory`'s `lowData` guard + `forecastConfidenceNote`'s "· noisy" hedge (`src/lib/maturity/forecast.ts:56-63,176-178`; `src/lib/org/briefing.ts:33-38,243-247`) and the `SCORE_NOISE_BAND` guardband (`src/lib/maturity/noise.ts`) are both grounded in an explicit, cited empirical basis in the code comments (two independent re-scans of the same commit moved 0/±1). This is precisely the "don't sell me an ETA off four dots" and "don't dress a wobble as a regression" behavior her character file names as pet peeves. Do not regress this in future redesigns of the Overview.

---

## 4. Character voice — Helena's reaction

"Okay, the pricing page finally does the one thing I actually check first: real dollar signs on Pro and Team, not 'prepaid credits' fog. Good — I don't have to guess whether there's a monthly floor hiding somewhere. And the fact that I can apparently stay on Free and just buy a burst of credits for the six weeks I'm actually in an org — that's the shape I want. But then I go to price *that* burst and there's no dollar sign on it anywhere in the product. I click 'Buy credits' and I'm suddenly on someone else's checkout page before I've seen a number. That's not the bait-and-switch I've been burned by before, but it's close enough to the pattern that I'd want to see the price before I click through, not after.

"The trajectory logic, though — that's the first tool I've seen that says 'noisy' out loud instead of drawing me a confident line through four data points. And the fact that a wobble on an unchanged repo doesn't dress itself up as a regression, with an arrow instead of a color — that's a build that understands what it's for. I could actually put that PDF in a deal file without a caveat of my own on top of it.

"What's still missing for MY job: I want to see the burst price before I commit to clicking through, and I want to know — before I open a target's org — whether four or five scans is even going to be enough repos moved to be worth a second look, or whether I should expect a mostly-flat read on a mature codebase and plan my week around that instead. If the export holds up and the price stays honest, I'd tell a peer. Right now I'd tell them 'go look, but don't be surprised the credit price makes you leave the app to find it.'"

---

## Verdict
**L1-conditional** — structurally sound, journey completes, but with one major (credit-pack price invisibility, her single sharpest pet peeve) and two minors that L2 should verify live.
