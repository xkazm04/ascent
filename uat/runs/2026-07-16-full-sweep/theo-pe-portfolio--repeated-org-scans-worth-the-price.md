# L1 (theoretical) — Theo (PE portfolio engineering lead) × "Repeated org scans worth the price"

cert_level: L1 · promotion: discovery · engine assumed: claude-cli (per env.md) · no browser used

## 1. Surface model (code-grounded, file:line)

### Reachable surface set for Theo (resolved before judging)
Theo is Enterprise, fleet-of-fleets, `ASCENT_AUTH_BYPASS=1` gives him a synthetic owner Membership per org (`src/app/org/[slug]/layout.tsx`, per `uat/env.md`). His `maps_to` in the character file: `/org/[slug]` (overview + Trajectory), `/org/[slug]/executive`, `/share/briefing/[token]`, `/trends`, `/usage`, `/pricing`. Code search adds one surface the character file does **not** list but that is explicitly built for him:

- **`/portfolio?orgs=a,b,c`** — `src/app/portfolio/page.tsx:1-9` — comment literally reads *"the cross-org 'fleet of fleets' view (THEO)"*. Per-org authorized via `canReadOrg` (`page.tsx:29-31`), assembled by `buildPortfolio` (`src/lib/org/portfolio.ts:76-106`).
- This surface has **zero in-app nav link** — `grep -rn "href=\"/portfolio` across `src` returns nothing. It is reachable only by typing/bookmarking the URL. Confirmed present-but-undiscoverable, not confirmed-absent.

Reachable set for this run: `/org/[slug]` (overview), `/org/[slug]/executive`, `/portfolio`, `/trends?repo=`, `/usage`, `/pricing`. All are `dynamic="force-dynamic"` server pages; no client-only trap doors.

### Affordance → code chain, per journey beat

**a) "Is the overall a comparable yardstick?"**
- Overall score: `overallScoreFor()` — `src/lib/maturity/model.ts:278-288` — archetype-weighted renormalized mean.
- The lens that varies it: `ARCHETYPE_WEIGHTS` — `model.ts:246-250` (`org`/`team`/`solo`, three different weight vectors over the same 9 dimensions).
- **Where Theo can SEE the lens**: `ARCHETYPE_HINT`/`ARCHETYPE_LABEL` are rendered only on the **single-repo report header** — `src/components/report/ReportHeader.tsx:43,55,57`. Confirmed by `grep -rln "ARCHETYPE_HINT|ARCHETYPE_LABEL" src --include=*.tsx` → one hit, `ReportHeader.tsx`.
- Neither `/org/[slug]` overview, `/org/[slug]/executive`, nor `PortfolioTable.tsx` render the archetype chip or an archetype mix indicator anywhere. Theo would have to open individual repo reports (15 companies × N repos) to see which lens scored which repo.

**b) "Trend confidence at quarterly cadence"**
- Forecast math: `forecastTrajectory()` — `src/lib/maturity/forecast.ts:119-182`. `fitQuality` (R²) at `:153,175`; `lowData` (n<3) flag at `:63,178`; `FLAT_PER_WEEK=0.5` floor suppressing a phantom trend at `:72,161`.
- **Org-fleet-level Trajectory card** (`src/components/org/overview/Trajectory.tsx`) is **not imported by `/org/[slug]`** (`src/app/org/[slug]/page.tsx:1-11` — imports `RepoCategoryRollup`, `RepoDimensionHeatmap`, `buildTrajectories`, no `Trajectory`). It IS imported by `/trends` (`src/app/trends/page.tsx:5`, single-repo) and `PersonalOverview.tsx:9` (individual workspace, out of Theo's scope). So the exact "low data (n=…)" caveat text at `Trajectory.tsx:89-95` never renders on any surface Theo actually uses.
- What Theo's real surfaces show instead:
  - `/org/[slug]/executive` — `briefing.forecastHeadline` + `forecastConfidenceNote()` (`src/app/org/[slug]/executive/page.tsx:153-161`, `src/lib/org/briefing.ts:36-38`). `forecastConfidenceNote` appends `"· noisy"` when confidence < 50 (matches the intent) **but returns `null` — no caveat text at all — whenever `lowData` is true** (`briefing.ts:247-248`: `forecastConfidence: rollup.forecast && !rollup.forecast.lowData ? … : null`). At exactly 2 quarterly points (the very first renewal cycle, or right after a re-scan cadence starts), the executive page shows a confident-sounding headline with **no low-data caveat printed at all** — silence, not a caveat. At ≥3 points (his stated "~4/yr" steady state) the "· noisy" suffix does fire correctly.
  - `/portfolio` — same pattern, same source flag: `src/lib/org/portfolio.ts:98-100` (`confidence: f && !f.lowData ? … : null`), rendered by `PortfolioTable.tsx:11-28` as `conf {c.confidence}% {noisy}` — again silent (dash-only trajectory line, no caveat) under 3 points, not a "low data" label.
- Net: the mechanism Theo's own scored criterion cites (`Trajectory.tsx:96`) is real code but sits on a surface **outside** his reachable set for this journey; his actual surfaces (executive, portfolio) implement the *same intent* via a different, slightly weaker path (drop the number silently instead of labeling "low data").

**c) "Recurring value / provenance of movement"**
- Cohort-matched (same-repo, not org-average-vs-org-average) deltas: `computeWindowDeltas` over a per-repo baseline join — `src/lib/db/org-rollup.ts:439-486` (baseline query, latest-per-repo, per-repo delta), confirming the character's `org-rollup.ts:130` citation in spirit (the actual delta-join block is ~430-490 in current code — a citation drift worth noting, mechanism itself checks out).
- Prior-period comparison + value-realized ledger surfaced on the exec briefing: `src/lib/org/briefing.ts:83-87` (`priorPeriod`), `:114-124` (`valueRealized`: recsEngaged/recsActioned/pointsMoved/reposPromoted), rendered at `executive/page.tsx:114-120` ("Value this period" strip) and `:200-207` ("vs previous period").
- Repo-level "what changed since last time" now lives in `RepoDimensionHeatmap`/`buildTrajectories` (`src/components/org/overview/repoTrajectory.ts:52-86`, `deltaWindow`/`deltaLast`/`deltaCrossesEngine`), replacing the old org-wide movers list per the journey's discovery hint — confirmed: `org/[slug]/page.tsx:84-98,124-131`. Notably `deltaCrossesEngine` (`repoTrajectory.ts:39-41,61`) exists precisely to stop a mock→live engine transition being read as real movement — directly answers Theo's "is the move real signal or noise" question, one layer deeper than his character file anticipated.

**d) "Cross-company read"**
- `/portfolio` exists and does exactly what criterion #4 asks (`portfolio.ts` full file) — but per (a) above it's unlinked from any nav, and per `page.tsx:19-25` the org list is a **raw comma-separated text input Theo must re-type (or re-paste from a saved bookmark) every visit** — no persisted "my book" list, no per-user saved portfolio. Up to 50 orgs (`:25`), silently drops unreadable/unknown slugs with a count (`:33,64-68`) — good failure hygiene, but no persistence is still Theo's own manual-assembly problem re-appearing at a smaller scale (retyping 15 slugs, not renormalizing 15 PDFs).

**e) Price-legibility**
- `/pricing` reads `planPriceLabel()` off `PLAN_FEATURES` — `src/lib/plans.ts:33-89` (Free $0, Pro $10, Team $20, Enterprise `null`→"Custom"/"contact us" via `planPriceLabel`, `plans.ts:88-92` region). Rendered at `src/app/pricing/page.tsx:40-41,81-82`. Enterprise stays "Custom", matching the character's own acceptance ("acceptable for him only because spend is trivial").
- `/usage` is single-org (`?org=` param, one company view — `src/app/usage/page.tsx:18-160`), showing credit balance/runway (`:138-142`) and burn — no portfolio-wide usage rollup; Theo checks usage per portco, one page load per company, same friction shape as `/portfolio`'s lack of a saved list.

## 2. In-character walkthrough (Theo, over the designed experience — no browser)

I open `/org/acme-portco` the way I do every quarter. The overview is different from last time I looked — no single org-wide "Trajectory" card, no page-level "Movers" list. Instead there's a repos×time rollup and a dimension heatmap. Fine, that's a reframe, not a loss — I click into **Executive** because that's the page I actually screenshot into the deck.

The Executive briefing gives me a maturity tile, adoption/rigor, corpus percentile, a "Value this period" strip (recs actioned, points moved, repos promoted — good, that's new-and-actionable, not a re-render), a Trajectory block, movement this period, goals. This composes onto a slide close to as-is. I'd drop this in.

The Trajectory block: with my real cadence (quarterly, ~4 points a year) it says "Climbing at +X/wk, staying within L3 for now" with "trend confidence NN% · noisy" underneath when it's genuinely thin. Good — that's the caveat I need to defend the number to the IC. But I notice: at my very first renewal cycle, when I've only got 2 quarterly points banked, that confidence line **doesn't say "low data" — it just isn't there.** A headline sentence with no hedge under it reads as MORE confident than the honestly-caveated version, not less. That's the opposite of what I need on day one of a subscription decision. It self-corrects by quarter two, but the exact moment I'm deciding whether to keep paying is the moment the caveat goes missing.

For the yardstick question — is company A's 72 the same 72 as company B's — I can't actually see the answer without opening individual repo reports. The archetype lens chip is on the single-repo report page only. Fifteen companies is not fifteen repos, it's hundreds; I am not going to click into every repo to audit whether a "team" lens quietly inflated one portco's fleet average relative to another's "org" lens. The dashboard tells me the number is comparable in its own copy ("normalized 0–100 on the same 9 dimensions") but doesn't show me the one variable — archetype mix — that actually determines whether that's true fleet-to-fleet.

Then I go looking for the one thing I actually pay for: a single slide with all fifteen companies on it. I remember there's supposed to be a portfolio view — I have to know the URL, because there is no link to it anywhere in the product. I type `/portfolio?orgs=acme,globex,...` by hand (or dig up an old bookmark), and it works — one table, maturity/adoption/rigor/posture/trajectory/percentile per company, "conf NN% · noisy" on the trajectory cell using the same honesty pattern as the executive page. This is genuinely the slide. But it makes me paste 15 slugs into a text box every single quarter with no saved list — a smaller, cheaper version of the manual-stitching problem I bought this tool to avoid, and it's not even discoverable without someone telling me the URL exists.

## 3. Findings

```
[
  {
    "id": "theo-l1-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "theo-pe-portfolio",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Portfolio (fleet-of-fleets) view is unlinked from any nav — present but undiscoverable",
    "expected": "Theo's core recurring job (\"assemble 15 companies into one comparable view\") has a first-class entry point he can find without being told the URL.",
    "got": "src/app/portfolio/page.tsx exists, is purpose-built for him (comment: \"(THEO)\"), and is fully functional, but `grep -rn \"href=\\\"/portfolio\" src` returns zero hits — no nav item, no link from /org/[slug], /pricing, or anywhere else links to it.",
    "evidence": ["src/app/portfolio/page.tsx:1-9", "src/lib/org/portfolio.ts:1-6"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm no nav entry exists live (check header/org-switcher for any Enterprise-tier link to /portfolio); if genuinely absent, this is the single highest-value fix for Theo's journey."
  },
  {
    "id": "theo-l1-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "theo-pe-portfolio",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Low-data trajectory caveat silently disappears (rather than showing \"low data\") on Theo's actual surfaces (executive briefing, portfolio) at exactly the < 3-point moment his cadence starts",
    "expected": "Per his scored criterion #2 and forecast.ts's own doc comment (\"Consumers must not render fitQuality as a hard confidence % when [lowData] is set... surface a low-data caveat instead\"), a <3-point fit should show an explicit low-data hedge, matching Trajectory.tsx's `trend confidence — low data (n=...)` treatment.",
    "got": "briefing.ts:247-248 and portfolio.ts:98-100 both set `confidence: null` when `lowData` is true, and the executive/portfolio UI renders NOTHING in that case (forecastConfidenceNote returns null; the portfolio Trajectory cell just omits the conf line) — a confident-reading headline with zero caveat, not a labeled low-data state.",
    "evidence": [
      "src/lib/org/briefing.ts:36-38,247-248",
      "src/app/org/[slug]/executive/page.tsx:159-161",
      "src/lib/org/portfolio.ts:98-100",
      "src/app/portfolio/PortfolioTable.tsx:11-28",
      "src/lib/maturity/forecast.ts:58-63"
    ],
    "code_check": "present-but-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Seed an org/portfolio with exactly 2 quarterly-spaced scans and confirm live whether the executive/portfolio trajectory line reads as unhedged-confident vs the Trajectory.tsx component's explicit 'low data' label."
  },
  {
    "id": "theo-l1-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "theo-pe-portfolio",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "Archetype lens (what makes the score comparable vs not) is visible only on single-repo reports, never on org/executive/portfolio rollups",
    "expected": "Theo's own criterion #1: \"Theo can SEE what's held constant vs what doesn't [i.e. the archetype re-weight]\" at the level he actually works — org and cross-org, not per-repo.",
    "got": "ARCHETYPE_HINT/ARCHETYPE_LABEL render only in src/components/report/ReportHeader.tsx (grep -rln across src/components confirms one hit). Neither the org overview, the executive briefing, nor PortfolioTable.tsx shows an archetype mix / lens indicator for a company's fleet.",
    "evidence": ["src/lib/maturity/model.ts:246-264", "src/components/report/ReportHeader.tsx:43,55,57"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Check whether an org-level archetype-mix indicator exists anywhere Theo would actually look (e.g. a tooltip on the maturity tile) that static grep might have missed via dynamic class composition."
  },
  {
    "id": "theo-l1-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "theo-pe-portfolio",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "low" },
    "dimension": "effort",
    "title": "/portfolio has no persisted \"my book\" — Theo retypes/re-pastes 15 org slugs every visit",
    "expected": "A recurring quarterly workflow for a fixed 15-company book shouldn't require re-entering the roster each cycle (even a saved-list-via-cookie or an org-level default would do).",
    "got": "src/app/portfolio/page.tsx:19-33 reads `?orgs=` from the query string only, capped at 50, deduped, no persistence layer (no saved list, no per-user default). Bookmarking the URL manually is the only workaround, and even that isn't offered/suggested in-page.",
    "evidence": ["src/app/portfolio/page.tsx:19-33,46-62"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Low priority relative to 01/02 — worth a UX polish ticket, not blocking."
  }
]
```

**What passed (strengths worth protecting):**
- `deltaCrossesEngine` (`repoTrajectory.ts:39-41,61`) is exactly the "is the move real vs. noise" defense his criteria demand, and goes further than a mock/live label — it structurally mutes a delta whose two endpoints came from different engines.
- The executive briefing's "Value this period" strip (`briefing.ts:114-124`, rendered `executive/page.tsx:114-120`) is genuine recurring-value provenance (recs actioned, points moved, repos promoted), not a re-rendered headline number — directly answers "did this cycle tell me something new."
- `/pricing`'s Pro/Team numeric prices derive from the same `plans.ts` the entitlement gate reads (`plans.ts:33-89`), so price copy can't drift from what's charged — good trust hygiene even though Enterprise itself stays "Custom" (acceptable per his own criterion).
- `/portfolio`'s per-org authorization (`canReadOrg` before any row is built, `portfolio/page.tsx:29-31`) means the cross-company view can never leak a tenant he can't already read — the right default for a PE buyer with confidentiality walls between portcos.

## 4. Verdict

**L1-conditional** — the job is structurally completable (a real fleet-of-fleets view exists and is well-built), but two majors sit on the critical path: the portfolio view he needs most is unreachable via any discoverable nav, and the trust-critical low-data trajectory caveat degrades from "explicit low-data label" to "silently absent" on the exact surfaces he uses. Neither is a dead end (URL-guessing and steady-state cadence route around them), which is why this isn't L1-fail — but both would cost him credibility with the IC before he'd notice the gap himself.

---

## Character voice — Theo's reaction

"There's a real portfolio view under the hood — and it's the right one: same yardstick, per-repo trajectory instead of a page-level movers list that would've hidden which company actually moved, and it flags a fitted trend as noisy exactly when it should. If I'd stumbled onto `/portfolio` some other way I'd tell a peer this is the first tool I've seen that composes fifteen companies onto one slide without me doing the normalizing by hand.

But nobody handed me that URL — I had to go read the source to find it, which is not a thing an IC-facing operating partner does. If I'm a real customer, that's a support ticket or a churn, not a five-minute detour. And the one moment it matters most — the FIRST quarter I'm deciding whether to keep paying, sitting on two data points — is exactly the moment the confidence hedge goes quiet instead of saying 'low data.' A missing caveat reads as MORE confident than a low one; that's backwards from what I need to defend a number in front of the board.

The archetype lens — the thing that actually decides whether company A's 72 and company B's 72 are the same 72 — is buried one repo report at a time. Fine for auditing one repo, useless for auditing a fleet of fleets. I'd want a lens-mix chip on the org tile itself, or I'm back to trusting the label instead of verifying it — the exact thing I said I'd never do again after the boutique-firm years.

Net: I'd keep paying, because the mechanism is sound and the value-realized strip on the executive briefing is genuinely new information every cycle. But I wouldn't put my name on the fleet-of-fleets slide until the caveat is honest at low n and I stop needing a bookmark someone else gave me to find the page that does my actual job."
