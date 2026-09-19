---
character: Dana (VP Engineering)
journey: Prove and track fleet maturity
cert_level: L1
verdict: L1-conditional
date: 2026-07-16
---

# L1 report — Dana (VP Engineering) × "Prove and track fleet maturity"

## 1. Surface model (code-grounded, file:line)

### Entry: `/org/[slug]` — org shell + Overview
- Auth/tenant gate chain (all must pass before any fleet data renders): DB configured → Supabase wall (`authGateEnabled`) → session → **`canReadOrg(slug)`** tenant check — `src/app/org/[slug]/layout.tsx:48-93`. Under the UAT bypass (`ASCENT_AUTH_BYPASS=1`) this resolves to a synthetic "developer" owner viewer (`layout.tsx:107-108,160-162`), so Dana reaches a real, populated org on the second visit.
- **Persistent headline** (visible on every org tab, not just Overview): `OrgHeader` renders `{levelId} · {score}` — `src/components/Brand.tsx:181-231`, fed by `getOrgHeaderSummary(slug)` (cheap query) — `layout.tsx:110-128`, level computed via `levelForScore(summary.avgOverall)` — `layout.tsx:165`.
- **Kind branch**: `OrgOverview` re-fetches `getOrgHeaderSummary` and if `kind === "personal"` renders `PersonalOverview` instead of the fleet rollup — `src/app/org/[slug]/page.tsx:50-51`. Dana's JTBD assumes a real multi-repo org; a personal-workspace slug would silently swap her into an individual watchlist lens with **no fleet rollup, no posture distribution, no leverage-move surface**.
- **Overview body** (`src/app/org/[slug]/page.tsx:60-133`):
  - `getOrgRollup` + `getOrgRepoHistories` (parallel reads) → `buildTrajectories()` (`src/components/org/overview/repoTrajectory.ts:52-86`) joins latest snapshot + history into `RepoTrajectory[]` (carries `overall`, `level`, **`posture`**, `adoption`, `rigor` fields, deltas).
  - `<RepoCategoryRollup trajectories .../>` (`src/components/org/overview/RepoCategoryRollup.tsx`) — repos grouped by a switchable **Type / Stack / Level** toggle, default **Type = posture** (`RepoCategoryRollup.tsx:181,53-76`). Posture is a genuine two-axis **Adoption × Rigor** taxonomy (`postureFor(adoption, rigor)` — `src/lib/maturity/model.ts:335-370`), not a synthetic label — so the default Overview grouping IS an adoption-vs-rigor cohort view (ai-native / ungoverned / manual / early), each cohort showing count · avg score · net move (`RepoCategoryRollup.tsx:78-83,140-170`).
  - `<RepoDimensionHeatmap .../>` (`src/components/org/overview/RepoDimensionHeatmap.tsx`) — repos × 9 dimensions, sortable, cell click opens per-repo/dimension evidence (`RepoDimensionModal`) — `RepoDimensionHeatmap.tsx:33-60`.
  - Each repo row links to `reportPermalink(fullName, ..., orgSlug)` — `RepoCategoryRollup.tsx:90-97` — the drill-to-evidence path (fleet cohort → repo → scan report).
  - **Not present on this page**: no trajectory/ETA-to-next-level, no ranked "highest-leverage move" card. (Confirmed absent — grepped the file; no `forecast`/`ETA`/`leverage` import.)

### `/org/[slug]/executive` — the board-shaped page
- `buildExecBriefing()` (`src/lib/org/briefing.ts`) assembles `maturity`, `benchmark`, **`forecastHeadline`/`forecastConfidence`** (from `forecastTrajectory()` over the real per-repo score series, `src/lib/maturity/forecast.ts:119-332`), `adoptionRate`, `movement` (top gainers/regressions), `goals` (with `etaDays`).
- `getOrgRecommendations(slug, 5, segmentId, techGroupId)` (`src/lib/db/org-insights.ts:192-232`) → **`<OrgLeverageMoves recs .../>`** (`src/components/org/executive/OrgLeverageMoves.tsx`) — "The move to make next": groups real persisted per-repo LLM recommendations (`scan.recommendations` rows) by `title::dimId`, ranks by `leverage = repos × impact × dimension weight`, computes an **engine-true projected-gain** ("`≈ +N maturity pts on each of K repos ... advances M to the next level`", `gainPhrase()` — `OrgLeverageMoves.tsx:10-15`) — genuinely grounded, not a generic "add more tests" line; explicit comment confirms this card **"Moved here from the Overview"** (`executive/page.tsx:48-50,178-180`).
- Trajectory card renders `briefing.forecastHeadline` with a confidence/noise caveat when present (`executive/page.tsx:153-169`).
- AI Adoption vs Engineering Rigor rendered as **two separate tiles** (`executive/page.tsx:100-101`) — an explicit adoption/rigor split, distinct from the blended overall score.
- "Strengths" / "Weakest dimensions" (`executive/page.tsx:182-212`), each `DimRow` deep-links to `/org/[slug]/practices` evidence (`practiceHref`).

### `/org/[slug]/teams`
- Per-team maturity/AI-knowledge/movement/per-dimension grid — `src/app/org/[slug]/teams/page.tsx:87-96` — the fleet → **team** drill layer the Overview's Type/Stack/Level grouping doesn't itself offer (Overview has no "Team" grouping mode).

### `/usage`, `/pricing`
- Out of scope per the journey file except as a spend-vs-value sanity check; not modeled further here (not load-bearing for the scored criteria).

### Reachability check
Dana's surface-binding is a real, populated, non-personal org under `ASCENT_AUTH_BYPASS=1`. All of the above routes are reachable in that state: `canReadOrg` passes (bypass viewer is treated as owner-authorized), `getOrgHeaderSummary`/`getOrgRollup` return non-empty data once seeded via `seed-org.mjs`. The one reachability trap the discovery hint calls out — landing on a `kind === "personal"` slug — is real in code (`page.tsx:50-51`) but not applicable to Dana's actual seeded fixture (a multi-repo org), so it's a **documented risk, not a live block**, tagged for L2 to confirm she's pointed at the right fixture.

## 2. In-character walkthrough (theoretical, over the model above)

*Trigger: the board wants the AI-spend answer next cycle. I open the org I know is fully scanned.*

**Step 1 — land on `/org/[slug]`.** The header gives me `{level} · {score}` before I've even scrolled — good, that's always-on chrome (`OrgHeader`). That's my headline number, and it survives page-hopping because it's in the layout, not the page body. First box checked, cheaply.

**Step 2 — read the posture spread.** Default grouping is "Type," and Type turns out to be a real Adoption×Rigor posture, not a vanity label — I can see at a glance which cohort is "ai-native" and which is "ungoverned" and how many repos sit in each, with an avg score and a net move per cohort. That's close to what I sketch on a whiteboard myself. Genuinely good — and it directly separates adoption from rigor the way DORA 2025 says I need to, right on the page I land on, not buried in a tooltip.

**Step 3 — look for the trajectory/ETA and "the one move."** This is where I stall. There's no ETA-to-next-level and no ranked recommendation on this page at all. I have to go find the Executive/Briefing tab for that — and *only* there does the forecast headline and "the move to make next" card show up. That's a page I wouldn't have found by osmosis (the journey notes I'd wander into it, and the nav item is labeled "Executive," not obviously "where the ETA lives"). It's real work when I finally get there — the leverage-move card actually IS grounded (real per-repo recommendations, real projected-point gain, ranked by reach×impact×weight) — but it cost me a hop I wasn't told I'd need, and my own scored criterion #1 explicitly says "within ~2 minutes... without hunting across pages." I did have to hunt.

**Step 4 — drill for evidence.** Clicking a repo row from the fleet cohort takes me straight to its report permalink. That's the receipt a skeptical board member would want. Good.

**Step 5 — team-level.** My criterion mentions "fleet → team → dimension → evidence." Team-level maturity does exist, but it's its own tab (`/teams`), not a grouping mode on the Overview (which only offers Type/Stack/Level). I can get there, but it's one more hop, and it's not where my instinct (grouping the Overview by team) would look first.

## 3. Findings (schema per `A finding is always`, cert_level L1)

```json
[
  {
    "id": "L1-DANA-01",
    "journey": "prove-and-track-fleet-maturity",
    "character": "dana-vp-engineering",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "effort",
    "title": "Trajectory/ETA and the single highest-leverage move are absent from /org/[slug] Overview — relocated to /executive, a second hop",
    "expected": "Per her scored criterion #1, Dana reads headline level + trajectory/ETA + posture in ~2 minutes from /org/[slug] without hunting across pages; criterion #4 expects the one/two highest-leverage moves named on the overview she lands on.",
    "got": "OrgOverview (src/app/org/[slug]/page.tsx:60-133) renders only RepoCategoryRollup + RepoDimensionHeatmap — no forecastHeadline, no OrgLeverageMoves. Both live exclusively on /org/[slug]/executive (src/app/org/[slug]/executive/page.tsx:153-169, 178-180), whose own comment confirms the leverage-move card was 'Moved here from the Overview'.",
    "evidence": ["src/app/org/[slug]/page.tsx:60-133", "src/app/org/[slug]/executive/page.tsx:48-50,153-169,178-180", "src/components/org/executive/OrgLeverageMoves.tsx:1-3"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Time Dana's actual click-to-ETA and click-to-recommended-move latency live; confirm she notices/finds the Executive tab unprompted (discoverability of the nav label 'Executive' as 'where the forecast lives'), and whether the two-hop path still clears her 'within ~2 minutes' bar in practice."
  },
  {
    "id": "L1-DANA-02",
    "journey": "prove-and-track-fleet-maturity",
    "character": "dana-vp-engineering",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "No 'Team' grouping mode on the Overview rollup — team-level maturity lives only on a separate /teams tab",
    "expected": "Her scored criterion #2 names an explicit fleet → team → dimension → evidence drill path.",
    "got": "RepoCategoryRollup's Group toggle only offers Type / Stack / Level (src/components/org/overview/RepoCategoryRollup.tsx:34-39); team-level maturity is a different page (src/app/org/[slug]/teams/page.tsx:87-96).",
    "evidence": ["src/components/org/overview/RepoCategoryRollup.tsx:34-39", "src/app/org/[slug]/teams/page.tsx:87-96"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm Dana finds /teams unprompted when she wants to check 'why is my best platform team not showing strong' and that its maturity figures reconcile with the fleet number she saw first."
  },
  {
    "id": "L1-DANA-03",
    "journey": "prove-and-track-fleet-maturity",
    "character": "dana-vp-engineering",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "A personal-workspace slug silently swaps Dana into PersonalOverview with no fleet rollup at all",
    "expected": "Dana's JTBD assumes a real multi-repo org; if she or a teammate types/bookmarks the wrong slug she should get a clear signal she's in the wrong kind of workspace, not a different-looking-but-plausible page.",
    "got": "OrgOverview returns <PersonalOverview slug={slug} /> with zero explanation of the kind switch when getOrgHeaderSummary(slug).kind === 'personal' (src/app/org/[slug]/page.tsx:50-51).",
    "evidence": ["src/app/org/[slug]/page.tsx:50-51"],
    "code_check": "present-but-missed",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Only relevant if Dana's actual seeded fixture is ambiguous; confirm the seed used for her run is unambiguously a fleet org, and if a personal slug is ever hit in the wild, check whether PersonalOverview signals the kind mismatch."
  }
]
```

## 4. Character voice — first-person reaction

"Okay, this is closer to my spreadsheet than anything I've been pitched before, and I want to say that first because it matters: the header number is *always there*, and when I default into the Type grouping, that's not a vanity label — it's actually Adoption crossed with Rigor, which is the exact distinction DORA told me to insist on. That's not nothing. A tool that got that wrong would have lost me in the first ten seconds.

But then I go looking for 'so what do I tell the board to do next,' and it's not on the page I landed on. I have to go click into 'Executive' — which, fine, I'll find it, I'm not new to software — but my own bar was 'within two minutes, no hunting,' and I hunted. And once I'm there, the recommendation itself is actually good — it's not a generic 'add more tests,' it names the dimension, the repos, the projected point gain. I'd almost forgive the extra click for that. Almost. If I'm doing this live in front of the CTO, a two-tab flow reads as 'the good stuff is buried,' and that's the kind of thing a board member notices even if they can't say why.

The team drill is the same story — I know my platform team is strong, I want to type 'team' into that grouping toggle and see it prove me right, and instead I have to go find a whole separate tab. It's there, it's real, it's just not where my hand goes first.

Net: I'd use this over my spreadsheet. It's faster, and the evidence trail (repo → report) is real, which is the single thing that's killed every other tool I've tried. But I'm not putting a two-tab, mentally-assembled story on a board slide without practicing the click path first — and that's exactly the kind of afternoon-not-a-minute friction that erodes 'defensible' into 'defensible, with homework.'"

## Summary

- **Verdict: L1-conditional.** The structural spine is sound — headline, evidence drill, and a genuinely grounded leverage-move exist in code — but the two majors (trajectory/ETA + the recommended move relocated off the page she's told to land on) are real, code-confirmed friction against her own scored criteria, not a fabrication. Still fully L2-eligible.
- **Grounding score (leverage-move / forecast surface): 5/6** — real per-repo recommendations (✓), real dimension/impact weighting (✓), real projected-gain math tied to actual persisted dimension scores (✓), real evidence drill to repo reports (✓), real trend-based forecast with confidence/noise disclosure (✓); missing: none of it surfaces on the page (`/org/[slug]`) her own criteria say it must be reachable from in ~2 minutes — a placement gap, not a grounding gap.
- **Estimated time saved if design promises hold:** ~4-8 weeks (hand-rolled audit) → an afternoon, per her Motivation section — the theoretical design plausibly delivers this once the two-hop friction above is accounted for; L2 should time the actual click path.
