---
character: Dana (VP Engineering)
journey: Prove and track fleet maturity
cert_level: L2
verdict: L2-fail
date: 2026-07-16
carries_forward_from: L1-conditional
---

# L2 report — Dana (VP Engineering) × "Prove and track fleet maturity"

## 0. Environment
- Server already running (`GET /api/health` → 200, `dbMode: pglite`) — reused, no second instance started.
- Fixture: `/org/vercel`, seeded (mock LLM, 6 repos: ai, eve, next.js, v0-sdk, vercel, workflow), via existing PGlite data (no live scan re-run needed — confirmed non-empty, `RepoCategoryRollup` posture cohorts render, not `PersonalOverview`).
- `ASCENT_AUTH_BYPASS=1`, `ASCENT_OPEN_ORG_DASHBOARDS=1` active per `.env.local`; visited twice to seed the "developer" owner Membership (banner shows `OWNER` chip).
- Browser MCP (claude-in-chrome) was **not connected** in this session ("Browser extension is not connected"). Fell back to `uat/env.md`'s documented alternative: bespoke Playwright drivers built on the pattern in `uat/driver/drive.mjs`, run from repo root with `MSYS_NO_PATHCONV=1`. Scripts: `uat/driver/drive-dana-l2.mjs`, `drive-dana-nav.mjs`, `drive-dana-nav2.mjs`, `drive-dana-timing.mjs`, `drive-dana-teams2.mjs`, `drive-dana-briefing-poll.mjs` (kept in-tree for reproducibility). Screenshots/ARIA/text in `uat/runs/2026-07-16-full-sweep/shots/`.

## 1. Journal (first-person, in-character)

*Trigger: board wants the AI-spend answer. I open the org I know is scanned — vercel.*

**Landing on `/org/vercel`.** The header chrome is exactly what I wanted: `vercel · L4 · 72 · OWNER` sits in the banner before the page body even paints, and it stays there no matter where I click next (`shots/01-overview.png`). Good — that's the number I came for, always in view.

The Overview body groups my 6 repos by posture — "AI-Native · 4 · avg 79" and "Solid but Manual · 2 · avg 59" — genuinely the adoption×rigor split I asked for, not a vanity label (`shots/01-overview.aria.yaml:46,58`). The dimension heatmap under it gives me the receipts (click any repo → its report). Fine so far — this matches what L1 told me to expect.

**Looking for the trajectory and the one move.** The left nav is an accordion — six top-level groups (Overview / Fleet / Intel / Plan / Library / Govern), and only the group containing my current page auto-expands. Landing on Overview, I *do* see, without touching anything: `Overview` and `Briefing` (`shots/01-overview.aria.yaml:24-28`). Not "Executive" — the word never appears in the sidebar. It's called **Briefing**. I click it. It's fast — under half a second to first content, ~2.5s for the page to fully settle past its skeleton placeholders (timed: `06-briefing-page` skeleton at 357ms → `08-briefing-settled` at 2471ms, `shots/08-briefing-settled.text.txt`). So the "second hop" L1 warned me about is real, but it's a *cheap* hop, not a hunt — the link is right there by default and the click-to-content latency is well inside my 2-minute budget.

Once I land, the page heading says **"Executive briefing"** — so the word I was looking for does show up, just one layer later than the nav label. Small friction, forgivable.

**Then I look for the Trajectory.** And it's not there. Not "not enough history yet to project a trajectory" — nothing. No section at all. I go from the four KPI tiles (Org Maturity 72 / AI Adoption 57 / Engineering Rigor 80 / Corpus Percentile —) straight to "The move to make next" (`shots/08-briefing-settled.png`). For an org I'm told is fully scanned, with a real, board-shaped page whose whole job is "trajectory, movement, and goals," the trajectory section just isn't rendered. I check the code with my engineer hat on: the whole Trajectory block is gated by `briefing.forecastHeadline || briefing.regressionCount > 0` (`src/app/org/[slug]/executive/page.tsx:153`) — and there IS a friendly fallback line written for exactly my situation, `"Not enough history yet to project a trajectory"` (line 157) — but it's dead code here, because that fallback only renders inside the same `||` block it's supposed to be the fallback *for*. A single-scan org (this one — every repo shows one scan, "58m ago," no second data point) has `forecastHeadline: null` and `regressionCount: 0`, so the whole section — including its own "not ready yet" apology — never mounts. That's worse than a hop. That's an unmet promise with no explanation, on the exact page I was told to trust for the board story.

**The move to make next**, by contrast, is genuinely good: "AI isn't in the loop yet" tagged Agentic, `≈ +7 maturity pts on each of 5 repos ... advances 2 to the next level`, `affects 5 repos: ai, eve, v0-sdk, vercel, workflow` — that's a real, drillable, ranked recommendation, not a generic backlog item. I'd use this line in a deck.

**Team drill.** I go back to Overview, want to type "team" into the Group toggle — it only offers Type / Stack / Level (confirms L1). I go looking in the accordion; Teams isn't under Overview or Fleet, it's under **Intel** — I have to click "Intel" to expand it, then click "Teams" (timed: 725ms end to end, `shots/07-teams-page.png`). Once there, the page is rich — 9 teams from CODEOWNERS, per-team dimension grid, leader/laggard cards, pairing suggestions. Genuinely useful.

But then I read: *"@vercel/workflow leads at 81 and @vercel/vercel-cli-approvers trails at 77 — a 4-point spread across 9 teams... measured against the **fleet average of 78**."* My header said **72**. That's not a rounding blip, that's a 6-point gap on the same word, "fleet," on two tabs of the same dashboard. I check why: the org headline (72) is the mean across all 6 scanned repos. The Teams "fleet average" (78) is the mean of each *team's* own average — and only 2 of my 6 repos even have a CODEOWNERS-attributed team (`ATTRIBUTED REPOS: 2` / `UNOWNED REPOS: 4`, `shots/07-teams-page.text.txt:47-52`), with owned repos double- and triple-counted across the 9 teams that partially own them. Two different populations, two different weightings, one shared word, zero cross-reference. This is exactly the thing that makes me stop trusting a number and reach for my spreadsheet — my own pet peeve, verbatim: "numbers that contradict reality and don't explain themselves."

## 2. Code cross-check

| Claim | Status | Evidence |
|---|---|---|
| Trajectory/ETA absent from Overview | confirmed-absent (matches L1) | `src/app/org/[slug]/page.tsx:60-133` — no forecast import |
| Trajectory/ETA reachable one click away on Briefing, fast | present-but-refines-L1 | `shots/01-overview.aria.yaml:24-28` (link visible by default), timed 357ms–2471ms |
| Trajectory/ETA renders for THIS seeded org | **confirmed-broken (present-but-broken)** | `src/app/org/[slug]/executive/page.tsx:153,157` — outer gate `forecastHeadline \|\| regressionCount>0` makes the line-157 "not enough history" fallback unreachable exactly when it's needed (single-scan org); live: `shots/08-briefing-settled.png` shows no Trajectory section at all |
| Fleet headline and Teams "fleet average" reconcile | **confirmed-broken** | Header `72` (`shots/01-overview.aria.yaml:6`) vs Teams "fleet average of 78" (`shots/07-teams-page.text.txt:263` / `TeamsStandings.tsx:146`); root cause: `fleetAvgOverall = roundedMean(teams.map(t => t.avgOverall))` (`src/lib/org/teamStandings.ts:66`) — a team-of-teams mean over only 2/6 attributed repos, vs the org headline's flat mean over all 6 repos — never cross-labeled or reconciled on either page |
| Nav label reads "Executive" | confirmed-absent-as-worded | Sidebar link text is `"Briefing"` (`shots/01-overview.aria.yaml:27`); "Executive" only appears in the in-page heading "Executive briefing" after arrival |
| Team-level grouping on Overview | confirmed-absent (matches L1) | `RepoCategoryRollup.tsx:34-39` — Type/Stack/Level only |
| Fixture is unambiguously a fleet org, not personal | confirmed | `shots/01-overview.aria.yaml` shows `RepoCategoryRollup`/posture cohorts, not `PersonalOverview` |
| Adoption vs Rigor separated | confirmed (strength) | Briefing page: `AI ADOPTION 57` / `ENGINEERING RIGOR 80` as two distinct tiles (`shots/08-briefing-settled.text.txt:45-48`) |
| Leverage-move card is grounded, not generic | confirmed (strength) | Real dimension tags, real affected-repo lists, real projected-point math (`shots/08-briefing-settled.text.txt:55-88`) |

## 3. Findings (cert_level L2)

```json
[
  {
    "id": "L2-DANA-01",
    "journey": "prove-and-track-fleet-maturity",
    "character": "dana-vp-engineering",
    "cert_level": "L2",
    "type": "broken-flow",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "senior-quality",
    "title": "Trajectory/ETA section never renders for a realistic freshly-seeded (single-scan) org — including its own 'not enough history yet' fallback text, which is dead code for the exact case it was written for",
    "expected": "Criterion #5: 'Any trajectory/ETA-to-next-level shows its basis' — even absent a forecast, a graceful explanation, per the code's own intent.",
    "got": "Live: the Briefing page goes straight from the 4 KPI tiles to 'The move to make next' with zero Trajectory content (screenshot). Code: src/app/org/[slug]/executive/page.tsx:153 gates the entire section (including line 157's 'Not enough history yet to project a trajectory' fallback) behind `briefing.forecastHeadline || briefing.regressionCount > 0` — both false for a single-scan org, so the fallback text can never actually appear.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/shots/08-briefing-settled.png", "uat/runs/2026-07-16-full-sweep/shots/08-briefing-settled.text.txt:42-64", "src/app/org/[slug]/executive/page.tsx:153,157", "src/lib/maturity/forecast.ts:124 (parsed.length<2 → null, i.e. needs ≥2 scans)"],
    "code_check": "present-but-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": "Even once fixed to show the fallback text, a genuinely new org still has NO real trajectory until it has 2+ historical scans — that's an honest data-maturity limit, not a bug, and should be disclosed as such."
  },
  {
    "id": "L2-DANA-02",
    "journey": "prove-and-track-fleet-maturity",
    "character": "dana-vp-engineering",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The org headline 'fleet' number (72) and the Teams page's own 'fleet average' (78) are two different, unreconciled populations sharing one label",
    "expected": "Criterion #2: fleet → team → dimension figures reconcile, no contradiction she can't explain. Pet peeve, verbatim: 'numbers that contradict reality and don't explain themselves.'",
    "got": "Header (all pages): 'L4 · 72' = flat mean over all 6 scanned repos. Teams page: 'measured against the fleet average of 78' = mean of 9 teams' own averages, computed over only the 2 of 6 repos with a CODEOWNERS team owner (4 repos are 'UNOWNED', excluded; owned repos are multi-counted across owning teams). No cross-reference or footnote anywhere connects or explains the two numbers.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/shots/01-overview.aria.yaml:6 (header 72)", "uat/runs/2026-07-16-full-sweep/shots/07-teams-page.text.txt:263 (\"fleet average of 78\")", "uat/runs/2026-07-16-full-sweep/shots/07-teams-page.text.txt:47-52 (2 attributed / 4 unowned)", "src/lib/org/teamStandings.ts:66 (fleetAvgOverall = roundedMean(teams.map(t=>t.avgOverall)))"],
    "code_check": "present-but-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": "Even reconciled/relabeled, CODEOWNERS-based team attribution will structurally exclude unowned repos from any 'team fleet' figure — an inherent scope note, not something a rename alone fixes."
  },
  {
    "id": "L2-DANA-03",
    "journey": "prove-and-track-fleet-maturity",
    "character": "dana-vp-engineering",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "The nav item Dana is looking for is never labeled 'Executive' — it's labeled 'Briefing'",
    "expected": "L1 hint / character surface-binding calls this the 'Executive' page; discovery hint asks whether she finds 'Executive' unprompted.",
    "got": "Sidebar link text is literally 'Briefing' (only the in-page H1 reads 'Executive briefing', visible only after the click). She is, in practice, hunting for a word ('Executive') that doesn't exist in the live nav.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/shots/01-overview.aria.yaml:27 (link \"Briefing\")", "uat/runs/2026-07-16-full-sweep/shots/08-briefing-settled.text.txt:29 (heading \"Executive briefing\")"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": "Minor — she does find it (it's the only other link visible by default, and it's fast), but the labeling mismatch is a small, avoidable tax on someone scanning for a specific word."
  },
  {
    "id": "L2-DANA-04",
    "journey": "prove-and-track-fleet-maturity",
    "character": "dana-vp-engineering",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "effort",
    "title": "Teams lives inside a collapsed 'Intel' accordion group — she must expand a group she wouldn't guess holds it before the Teams link appears",
    "expected": "Criterion #2's fleet→team drill; L1 flagged this as 'its own tab' but live confirms it's actually one level deeper (a collapsed group, not a top-level tab)",
    "got": "Default landing on Overview shows only the Overview group's links. Teams is under 'Intel' (alongside Security/Adoption/Delivery/Contributors) — she must click 'Intel' to expand it (confirmed: timed 725ms end-to-end for expand+click+load, workable, but not a single top-level click as 'a separate tab' implies)",
    "evidence": ["uat/runs/2026-07-16-full-sweep/shots/nav-groups-report.txt (GROUP Intel: [\"Security...\",\"Adoption\",\"Delivery\",\"Contributors\",\"Teams...\"])", "uat/runs/2026-07-16-full-sweep/shots/07-teams-page.png"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": "Low — the Intel icon (badge \"33\") is visible on Overview and she'd plausibly explore it looking for 'why is my platform team not showing strong,' so this is findable, just one accordion click deeper than L1's model assumed."
  },
  {
    "id": "L2-DANA-05",
    "journey": "prove-and-track-fleet-maturity",
    "character": "dana-vp-engineering",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "L1-DANA-03 (personal-workspace ambiguity) does not apply to this run's fixture — confirmed by-design non-issue",
    "expected": "l2_priority: confirm the seeded fixture is unambiguously a fleet org.",
    "got": "vercel org renders RepoCategoryRollup + posture cohorts on Overview, never PersonalOverview — the fixture is unambiguously a fleet org.",
    "evidence": ["uat/runs/2026-07-16-full-sweep/shots/01-overview.png", "uat/runs/2026-07-16-full-sweep/shots/01-overview.aria.yaml:35-46"],
    "code_check": "by-design",
    "verdict": "refuted",
    "resolution": "by-design",
    "ceiling": "The underlying code risk (silent kind-swap for a mistyped/bookmarked personal slug) is unchanged and untested here — only this run's fixture choice is confirmed clean."
  }
]
```

## 4. What passed (strengths worth protecting)
- **Always-on headline chrome**: `vercel · L4 · 72 · OWNER` in the banner on every org page, confirmed live across Overview/Briefing/Teams captures — she never loses her anchor number while exploring.
- **Genuine Adoption×Rigor split**: the default "Type" grouping on Overview really is a posture taxonomy (AI-Native / Solid-but-Manual / etc.), and the Briefing page renders Adoption (57) and Rigor (80) as two separate tiles — not blended into one feel-good score.
- **Grounded leverage-move card**: "The move to make next" names a real dimension (Agentic), a real projected gain (`≈+7 pts on 5 repos, advances 2 levels`), and the exact repos affected — this is deck-ready, not generic advice.
- **Fast click latency**: click-to-Briefing settles in ~2.5s (first paint <400ms); click-to-Teams ~725ms including an accordion expand. Neither is the "afternoon-not-a-minute" friction L1's voice worried about — the mechanics are fast. It's what's (not) shown once she arrives that costs her, not the wait.
- **Drill-to-evidence**: every repo row and heatmap cell links to its report/detail — confirmed present in the live ARIA tree.

## 5. Character voice — first-person reaction (live)

"Okay — the speed is not the problem. I click 'Briefing' and I'm there before I've finished the thought. I click into 'Intel' and then 'Teams' and that's under a second too. If this were only about hops and patience, L1's worry was overstated — I'd forgive a fast extra click all day.

But then I actually read the two pages side by side, the way I would before a board meeting, and I catch two things a skeptical board member would catch faster than I did. First: I go to the page that's supposed to have my trajectory — the whole point of a board briefing — and there's nothing there. Not a caveat, not a 'come back after another scan.' Nothing. I know enough to go check the code and find out it's actually there in spirit — someone wrote a nice fallback sentence — it's just unreachable, a bug, not a decision. That doesn't help me in the room.

Second, and worse: I open Teams because I want to see my platform team prove me right, and it tells me its 'fleet average' is 78. My own header, thirty seconds earlier, told me 72. Nobody explains that. That is *exactly* the thing that ends a tool's credibility with me — not because the math is wrong, necessarily, but because two numbers on the same dashboard disagree and nothing on either page tells me why. A board member asks 'which one is real?' and I don't have an answer I trust enough to give out loud.

Net, this run: I still think the bones are good — the headline is always there, the posture split is real, the recommended move is genuinely grounded and I'd steal that language for a slide. But I'm not putting the trajectory on a slide because there isn't one for the org I actually looked at, and I'm not quoting either 'fleet' number until someone tells me which one is the real one. That's not 'defensible, with homework' anymore — that's 'not board-ready yet,' full stop, for this exact read."

## Summary

- **Verdict: L2-fail.** The live browser pass confirms two of L1's carried-forward majors materialize as worse than theorized once real (freshly-seeded) data is involved: the Trajectory/ETA isn't just relocated behind a hop — for this org's actual data state it's **entirely absent, with its own graceful fallback dead-coded**. And a wholly new-at-L2 finding — the org headline and the Teams-page "fleet average" **contradicting each other by 6 points with no reconciliation** — breaks her explicit, scored criterion #2 and her single loudest pet peeve. Two of the journey's four definition-of-done bullets ("trajectory shows its basis," "fleet number reconciles... no contradiction she can't explain") fail on live evidence. The mechanics (nav speed, headline persistence, grounded leverage-move) are genuinely good and were confirmed live — but they don't clear her senior-quality bar as-is.
- **Time saved (re-measured live):** the click path itself takes under a minute; getting a number she'd actually stake a board slide on does not, because two live-confirmed defects (missing trajectory, contradicting fleet averages) would force her to manually reconcile or drop those claims before presenting — real, added work the design didn't budget for. Net still strongly positive vs her 4–8-week hand-rolled baseline, but the "as-is, ready to present" promise is not met.
- **New-at-L2 (surface-model gaps L1 missed):** (1) L1 assumed the forecast renders "when present" but never checked whether it's present for the actual seed state (single-scan org) — it is not, and the intended fallback is unreachable code; (2) L1 never cross-referenced the Overview headline against the Teams page's own "fleet average" language — a reconciliation break invisible to a page-by-page structural read but obvious once the same word is compared across two live pages; (3) the nav label is "Briefing," not "Executive" as the character file's surface-binding and L1's language assumed.
