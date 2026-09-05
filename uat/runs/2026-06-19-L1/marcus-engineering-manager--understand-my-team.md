# L1 — Marcus (Engineering Manager) × understand-my-team

**Verdict: L1-conditional** — The journey completes structurally and the headline design choices Marcus cares about (champion suppression below a contributor threshold, bus-factor/concentration framed as risk-to-explore, team-level adoption number with provenance, and a peer-quality grounded single-repo report) all hold in code. But two surveillance-line guards are inconsistent across surfaces: the population-size suppression that protects the Contributors tab is absent on the Adoption tab's "AI champions" card and the Teams tab's per-team champion chips, and the Contributors involvement table renders a full per-named-engineer commit/AI-commit scoreboard that Marcus could read as exactly the thing he closes the tab over. Majors carry forward to L2.

---

## Reachable surface set

Seed is `ASCENT_AUTH_BYPASS=1` + `ASCENT_OPEN_ORG_DASHBOARDS=1` (both pinned in `.env.local`, per `uat/env.md:30-37`) + a populated PGlite org (`node scripts/seed-org.mjs <org>`). Gating I followed:

- **Org shell gate** (`src/app/org/[slug]/layout.tsx:42-87`): DB configured (PGlite) → `authGateEnabled()` is **false** under the bypass (`src/lib/access.ts:44-46` — Supabase configured AND bypass off; bypass is on, so the wall is open). `isAuthConfigured()` (custom OAuth) is unset locally, so `canReadOrg` falls to `openOrgDashboardsEnabled()` (`src/lib/authz.ts:62-70`), which is **true** via `ASCENT_OPEN_ORG_DASHBOARDS=1`. Rollup non-empty → shell renders. On the 2nd visit `ensureOwnerMembership` seeds "developer" as owner (`layout.tsx:142-144`), so the role chip reads `owner`.
- **Nav** (`src/components/org/OrgNav.tsx:25-31`): under "Intelligence", Marcus sees **Repositories** (Fleet group), **Delivery**, **Contributors**, **Teams**, **Adoption**. All are same-shell sub-pages, no extra gate.
- **Single-repo report** (`src/app/report/[owner]/[repo]/page.tsx:52-83`): fully public (no auth gate); served pinned from the persisted scan when present, else a live re-scan. Reachable.

**Reachable for this journey:** `/org/[slug]` (overview), `/org/[slug]/contributors`, `/org/[slug]/delivery`, `/org/[slug]/repositories`, `/org/[slug]/teams`, `/org/[slug]/adoption`, and `/report/[owner]/[repo]`. All within his declared `maps_to`. Nothing he needs is gated away.

---

## Surface model notes (affordances → backing `file:line`)

**Contributors** (`/org/[slug]/contributors/page.tsx` → `src/lib/db/org-contributors.ts`) — his primary surface:
- Page intro literally frames it: *"Inputs to explore… Not a ranking, and not a to-do list for anyone."* (`page.tsx:49-52`).
- Summary tiles: Contributors, AI-active %, Org AI commit share, **Solo-maintainer repos** ("1 author or ≥80% concentration", warn-colored when >0) (`page.tsx:65-70`).
- **Champion suppression:** champions block only renders when `insights.champions.length > 0 && insights.totalContributors >= 3` (`page.tsx:75`), with an explicit comment that below 3 a single Copilot user becomes a "#1 ★ champion" and "100% AI-active" success theater. **This is exactly Marcus's stated acceptance criterion.** Champions themselves are pre-filtered to `commits >= 3 && aiCommits > 0` (`org-contributors.ts:170-173`).
- **Concentration & bus factor table** (`page.tsx:151-196`): per-repo contributor count, top contributor, top share (warn ≥80%), **bus factor** (warn ≤1), `key-person` badge on solo-maintainer repos. Bus factor = # contributors covering >50% of commits (`org-contributors.ts:142-165`). Framed "High top-share or bus-factor 1 = key-person risk" and "inputs to explore, never directives" (`page.tsx:198-202`).
- **Involvement table** (`page.tsx:101-149`): a per-named-login row — commits, AI commits, AI-share bar, repos, last-active. Top 50. This is the surveillance-line tension (see findings).

**Adoption** (`/org/[slug]/adoption/page.tsx` → `src/lib/org/adoption.ts` → `org-teams.ts`):
- Headline tiles: Org AI commit share, AI-active contributors, PR merge time, AI-involved PRs (`adoption/page.tsx:40-50`).
- **"Most AI-attributed team"** (`knowledgeLeader`) is correctly **team-level** — sourced from `getOrgTeamRollup().knowledgeLeader`, a CODEOWNERS team name, not a person (`adoption.ts:55`, `org-teams.ts:255-260`). Good.
- **"AI champions" card** lists named individual logins with AI% — and has **no population-size guard** (`adoption/page.tsx:73-88`), unlike the Contributors tab.

**Teams** (`/org/[slug]/teams/page.tsx` → `org-teams.ts`): team-level Adoption×Rigor, knowledge leader, a single suggested cross-team **pairing** ("invitation to pair, never a directive", `teams/page.tsx:193-206`). Strong team-level read. But each `TeamCard` renders named champion chips (`team.champions`, `teams/page.tsx:70-78`) with no population guard.

**Delivery** (`/org/[slug]/delivery/page.tsx`): review coverage, merge rate, small-PR rate, AI-involved %, AI-PRs-reviewed (governance), typical time-to-merge, branch governance per repo, real commit-activity chart. Pure team/fleet-level, no individual attribution. This is his DORA/flow read and it's clean.

**Repositories** (`/org/[slug]/repositories/page.tsx`): repo leaderboard sorted by maturity + repo×dimension heatmap. Repo-level, not people.

**Single-repo report grounding** (`/report/[owner]/[repo]` → `ReportView` → `DimensionCard`):
- **Provenance is real and rendered.** Each `DimensionCard` shows summary, **Evidence** list, **Gaps**, trend sparkline, and a **ProvenanceTrack** SVG plotting signal → guardband zone → LLM tick → blended marker (`DimensionCard.tsx:75-103,117-159`).
- Blend machinery confirmed: LLM guardbanded to ±`LLM_GUARDBAND` of the deterministic signal (`engine.ts:98-100`), coverage-weighted `SCORE_BLEND` so a thin scan leans on signals (`engine.ts:60-71`). A "where's that from?" answer exists for every dimension.
- **Grounding inputs** (`src/lib/scoring/prompt.ts`): the LLM gets deterministic signals as ground truth, PR/governance process block, recent commit messages, and sampled file excerpts; roadmap is *invitational* ("name the gap as an observation, NOT an imperative", `prompt.ts:129-136`) and dimension/impact/effort-tagged. Ingestion samples ≤32 files / 180KB (`github/source.ts:36-38`) — thin for a large monorepo (carry to L2), but evidence is concrete and re-traceable.

---

## Findings

```json
[
  {
    "id": "L1-MARCUS-UMT-01",
    "journey": "understand-my-team",
    "character": "Marcus (Engineering Manager)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "dimension": "trust",
    "title": "STRENGTH: Contributors tab suppresses the '#1 champion' celebration below 3 contributors — exactly the small-population vanity guard Marcus demands",
    "expected": "Champion/leaderboard celebration is suppressed or honestly qualified when the population is too small to mean anything (<3 people).",
    "got": "The AI-champions block renders only when `champions.length > 0 && totalContributors >= 3`, with an inline comment naming the exact failure mode (a lone Copilot user becoming a celebrated '#1 ★', '100% AI-active' for a team of one).",
    "evidence": ["src/app/org/[slug]/contributors/page.tsx:72-99", "src/lib/db/org-contributors.ts:170-173"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "suggested_acceptance": "Below 3 contributors, no champion/leaderboard UI renders; the threshold holds across all contributor-celebration surfaces."
  },
  {
    "id": "L1-MARCUS-UMT-02",
    "journey": "understand-my-team",
    "character": "Marcus (Engineering Manager)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "dimension": "trust",
    "title": "STRENGTH: Bus-factor and solo-maintainer surfaced as key-person risk-to-explore, never as a directive aimed at a person",
    "expected": "Key-person/bus-factor risk surfaced clearly and framed as risk-to-explore for cross-training — never naming-and-shaming.",
    "got": "Per-repo concentration table with bus-factor (warn ≤1), top-share (warn ≥80%) and a 'key-person' badge on solo-maintainer repos; a summary 'Solo-maintainer repos' tile; framing reads 'inputs to explore, never directives' and 'surface where trust could grow — people decide what to pick up.'",
    "evidence": ["src/app/org/[slug]/contributors/page.tsx:64-70", "src/app/org/[slug]/contributors/page.tsx:151-202", "src/lib/db/org-contributors.ts:142-165"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Confirm the seeded org actually surfaces a bus-factor-1 / solo-maintainer repo so Marcus sees the risk land, not an all-zero table."
  },
  {
    "id": "L1-MARCUS-UMT-03",
    "journey": "understand-my-team",
    "character": "Marcus (Engineering Manager)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "Contributors 'Involvement' table is a full per-named-engineer commit/AI-commit scoreboard — the surveillance read Marcus closes the tab over, despite the 'not a scoreboard' caption",
    "expected": "No surface invites him to rank named individuals; per-person output is not presented in a way he'd be embarrassed to have a report see over his shoulder.",
    "got": "The Involvement table renders up to 50 rows, each a named login with raw commit count, AI-commit count, AI-share bar, repos touched, and last-active — sortable-looking, ranked by commits desc. The 'context to explore, not a scoreboard' caption is text over a table that is structurally an individual-output ranking. The same per-person table is exportable as CSV.",
    "evidence": ["src/app/org/[slug]/contributors/page.tsx:101-149", "src/app/org/[slug]/contributors/page.tsx:54-60", "src/lib/db/org-contributors.ts:121-140"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "l2_priority": "Live: does the rendered involvement table read to an EM as a per-person leaderboard despite the caption? Test whether removing/aggregating raw per-person commit counts (or collapsing behind an opt-in) preserves the 'who could seed a thin repo' value without the scoreboard feel. A CSV of per-person commit+AI counts is precisely the spreadsheet leadership weaponizes — confirm whether that export is defensible.",
    "suggested_acceptance": "Any per-named-individual output is framed and ordered so it cannot be read as a performance ranking; raw per-person commit counts are not the primary sort key, or the view is opt-in."
  },
  {
    "id": "L1-MARCUS-UMT-04",
    "journey": "understand-my-team",
    "character": "Marcus (Engineering Manager)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "Small-population champion guard is inconsistent: the Adoption tab's 'AI champions' card and the Teams tab's per-team champion chips have NO contributor-count suppression",
    "expected": "The same small-population vanity guard that protects the Contributors tab applies wherever named champions are celebrated.",
    "got": "Adoption's 'AI champions' card maps `a.champions` with no `>= 3` (or per-team population) gate, so a 1-2 person org still celebrates a named '#1' culture carrier. Teams cards render named champion chips (`team.champions`, top 3 by AI commits) with no team-size guard — a 2-person CODEOWNERS team surfaces a named individual with their AI%. Contributors got this right; these two did not.",
    "evidence": ["src/app/org/[slug]/adoption/page.tsx:71-89", "src/lib/org/adoption.ts:51", "src/app/org/[slug]/teams/page.tsx:70-78", "src/lib/db/org-teams.ts:213-222"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Live: on a thinly-populated seeded team/org, confirm whether Adoption/Teams celebrate a named individual that Contributors correctly suppresses. The inconsistency itself is the finding.",
    "suggested_acceptance": "Champion/culture-carrier UI on Adoption and Teams applies the same population-size threshold as Contributors (org-level >= 3 contributors; team-level a minimum team size) before naming an individual."
  },
  {
    "id": "L1-MARCUS-UMT-05",
    "journey": "understand-my-team",
    "character": "Marcus (Engineering Manager)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "dimension": "trust",
    "title": "STRENGTH: The team-level adoption read he'd take to Dana is team-scoped with visible provenance — org AI commit share + a team 'knowledge leader' that is a CODEOWNERS team, not a person",
    "expected": "A team/org-level AI-adoption posture/number with a defensible 'where's that from?' answer; honest about small populations; not a leaderboard of people.",
    "got": "Adoption tab gives org AI commit share (commit-weighted), AI-active share, and a 'Most AI-attributed team' that resolves to a CODEOWNERS team name (`knowledgeLeader`), not an individual. The Teams tab rolls maturity up by the teams that own the repos and surfaces ONE cross-team pairing as 'an invitation to pair, never a directive.' Provenance is explicit: shares are 'commit-weighted across the fleet' and team attribution is 'parsed from CODEOWNERS at scan time.'",
    "evidence": ["src/app/org/[slug]/adoption/page.tsx:40-69", "src/lib/org/adoption.ts:30-57", "src/lib/db/org-teams.ts:255-313", "src/app/org/[slug]/teams/page.tsx:179-208"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Live: does the org AI-adoption number reconcile with what Marcus knows about his squads, and is the CODEOWNERS-team attribution populated in the seed (else 'no team attribution yet')?"
  },
  {
    "id": "L1-MARCUS-UMT-06",
    "journey": "understand-my-team",
    "character": "Marcus (Engineering Manager)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "dimension": "senior-quality",
    "title": "STRENGTH: Single-repo report is peer-quality on paper — per-dimension evidence + gaps + a guardbanded signal->LLM->blended provenance track, and an invitational (not generic) roadmap",
    "expected": "The single-repo read on his team's main service cites concrete repo signals and names a specific, evidence-linked move — not a generic 'add more tests / improve CI'.",
    "got": "Each DimensionCard renders Evidence (concrete signals), Gaps, a trend sparkline, and a ProvenanceTrack SVG (signal tick, guardband zone, LLM tick, blended marker). The LLM is guardbanded ±LLM_GUARDBAND to the deterministic signal and blended coverage-weighted, so a thin scan leans on signals. The roadmap prompt forces gaps to be named as observations with invitational 'explore' questions, dimension/impact/effort/levelUnlock tagged — not imperatives.",
    "evidence": ["src/components/report/DimensionCard.tsx:75-103", "src/components/report/DimensionCard.tsx:117-159", "src/lib/scoring/engine.ts:60-100", "src/lib/scoring/prompt.ts:111-141"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Live with LLM_PROVIDER=claude-cli: does the ACTUAL generated roadmap name a specific evidence-linked move (a retro-pasteable line), or does the model regress to 'add more tests'? Senior-quality is only provable on live output."
  },
  {
    "id": "L1-MARCUS-UMT-07",
    "journey": "understand-my-team",
    "character": "Marcus (Engineering Manager)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "trust",
    "title": "Single-repo grounding samples at most 32 files / 180KB — thin for a real team service (a monorepo or large backend), risking a score Marcus couldn't fully defend",
    "expected": "The score on his team's main service is grounded in enough of the real repo that he'd stake a VP conversation on it.",
    "got": "Ingestion budget caps at MAX_FILES=32, MAX_FILE_BYTES=14k, MAX_TOTAL_BYTES=180k; the prompt window further caps file excerpts at PER_FILE=2200 / OUTER=22k. For a small repo this is fine and evidence is concrete; for a large team service the sample is a thin slice. The deterministic detectors read fuller content, so the signal floor mitigates, but the LLM nuance sees little.",
    "evidence": ["src/lib/github/source.ts:34-41", "src/lib/scoring/prompt.ts:87-95"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "l2_priority": "Live: scan one of Marcus's larger team services and judge whether the cited evidence is representative enough that he'd defend the number to Dana, or whether the 32-file cap produces a visibly shallow read on a big repo."
  },
  {
    "id": "L1-MARCUS-UMT-08",
    "journey": "understand-my-team",
    "character": "Marcus (Engineering Manager)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "dimension": "time-saved",
    "title": "STRENGTH: Delivery tab is the team-level DORA/flow read (review coverage, time-to-merge, AI-PR governance) with zero individual attribution — the 'healthy way' bar his references set",
    "expected": "Team-level delivery flow (review coverage, time-to-merge, AI-PR governance) that beats an afternoon of GitHub spelunking, with no developer leaderboard.",
    "got": "Delivery surfaces review coverage, merge rate, small-PR rate, AI-involved %, AI-PRs-reviewed (governed AI), typical time-to-merge, per-repo branch governance, and a real fleet commit-activity chart — all aggregate, no per-person rows. Matches Swarmia's 'team-level, no leaderboards' bar he cites.",
    "evidence": ["src/app/org/[slug]/delivery/page.tsx:77-191"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Live: confirm PR/governance signals are populated in the seed (they need a GitHub token at scan time, else the tab degrades to an empty state) so the time-saved claim actually lands."
  }
]
```

---

## Character feedback (first person, in Marcus's voice)

Alright — on paper, this is closer to a tool I'd actually keep open than I expected, and I came in skeptical.

The part that earns trust first: the Contributors tab knows the trap. It literally suppresses the "#1 ★ champion" tile when there are fewer than three contributors, and someone left a comment explaining *why* — that a lone Copilot user shouldn't get a victory lap and "100% AI-active" shouldn't read as success on a team of one. That's the exact lesson I learned the hard way at my last company. Somebody here has read the same Pragmatic Engineer / Swarmia material I have. And the bus-factor table is the one thing I genuinely own — it flags solo-maintainer repos as "key-person risk," frames it as "input to explore, people decide what to pick up," and never points a finger at a name. That's the cross-training argument I've been hand-waving in planning, handed to me clean. I could raise that with Dana without throwing anyone under the bus.

Where I get nervous: that same Contributors page also drops a full Involvement table — every engineer by name, commit count, AI-commit count, ranked by commits, with a *CSV export*. The caption says "not a scoreboard." It is a scoreboard. The caption doesn't change what it is. I know exactly what happens to that CSV the moment it lands in a skip-level deck — it becomes PRs-merged in calibration, and I've watched a team game that within a quarter. So I'd be careful what I screen-share. And the guard I praised? It's not applied consistently — the Adoption tab and the Teams cards still name individual "champions" with their AI%, no population check. So the thing I trust on one tab, I can't trust on the next. That inconsistency is what would make me hesitate before I tell Dana "yeah, this tool gets it."

The number I'd actually report — org AI commit share, and a team-level "most AI-attributed team" that's a CODEOWNERS *team*, not a person — that's defensible. It tells me where to point provenance when Dana asks "where's that from?" ("commit-weighted across the fleet, attributed by CODEOWNERS at scan time"). Good. The single-repo report looks like a peer wrote it: every dimension cites evidence and shows me the signal-vs-LLM-vs-blended track, so I can see the model didn't just make the number up. I'd want to see the *actual* roadmap text live before I stake anything — if it says "add more tests" I'm out — but the scaffolding is right.

Time-saved: yes, plausibly. The Delivery tab alone — review coverage, time-to-merge, AI-PR governance, all team-level — is the afternoon of GitHub archaeology collapsed into one screen, and crucially with no per-person rows to tempt me. If that's populated, it beats my spreadsheet.

Would I adopt it? Conditionally. Fix the scoreboard-shaped Involvement table and make the small-population guard consistent everywhere a person is named, and I'd show the org dashboard to Dana on Thursday. As is, I'd use it myself but I'd be the filter between it and leadership — which is more than I want to be doing.

---

## l2_priority (carry-forward)

- **Involvement table surveillance read (top item):** Live-confirm whether the per-named-engineer commit/AI-commit table (and its CSV export) reads as a performance leaderboard to an EM despite the "not a scoreboard" caption — and whether it can be reframed/aggregated/opt-in without losing the "who could seed a thin repo" value. (L1-MARCUS-UMT-03)
- **Champion-guard consistency:** On a thinly-populated seeded org/team, verify whether Adoption's "AI champions" card and the Teams per-team champion chips celebrate a named individual that the Contributors tab correctly suppresses. (L1-MARCUS-UMT-04)
- **Roadmap senior-quality (live LLM):** With `LLM_PROVIDER=claude-cli`, confirm the actual single-repo roadmap names a specific, evidence-linked move (retro-pasteable), not a generic "add more tests / improve CI." (L1-MARCUS-UMT-06)
- **Adoption number reconciliation + provenance:** Confirm the org AI-adoption number is populated and reconciles with a known squad, and that the CODEOWNERS team attribution isn't an empty state. (L1-MARCUS-UMT-05)
- **Bus-factor lands in the seed:** Confirm the seeded org actually contains a bus-factor-1 / solo-maintainer repo so the key-person risk surfaces (not an all-zero table). (L1-MARCUS-UMT-02)
- **Grounding depth on a large service:** Scan one of Marcus's larger team services and judge whether the ≤32-file / 180KB sample produces a defensible, representative read or a visibly shallow one. (L1-MARCUS-UMT-07)
- **Delivery/PR signals populated:** Confirm PR + branch-governance signals (token-gated at scan time) are present so the Delivery time-saved claim holds. (L1-MARCUS-UMT-08)
