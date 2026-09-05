# L1 (theoretical) — Oliver (QA / Test Lead) × "Drive testing maturity"

cert_level: L1 · date: 2026-07-16 · mode: static/code-grounded, no browser

---

## 1. Surface model (import-chain-verified, file:line cited)

### Entry → D2 Automated Testing read
- Public entry: `/` (ScanForm) → `/report/[owner]/[repo]` (report route, public funnel per `uat/env.md`).
- Dimension rubric (config, not hard-coded): `src/lib/maturity/model.ts:94-102` — D2 "Automated Testing", weight 0.15, axis "rigor", criteria explicitly calls out test-to-source ratio, mutation testing, contract testing, assertion quality ("clear testing philosophy").
- Deterministic signal detector: `src/lib/analyze/index.ts:235-323` (`const d2: Detector`)
  - Test-file discovery + count-banded base score: `index.ts:237-252`.
  - Framework/E2E/coverage-config detection: `index.ts:254-266`.
  - Test-to-source ratio bonus: `index.ts:268-272`.
  - Advanced rigor (mutation, contract/Pact, perf/load, a11y, API-schema): `index.ts:274-294`.
  - **Assertion-quality signal** (the exact "quantity vs quality" guard Oliver's `references:` cites): `index.ts:296-320`. Reads sampled test-file bodies, counts `it/test/describe` cases vs substantive assertion calls (`toBe`, `assert.*`, `t.Error`, testify, etc.); a suite with ≥4 cases and 0 substantive assertions is penalized `-15` ("Sampled tests assert nothing"); a suite with ≥4 substantive assertions is credited `+8`. Verified live/tested: `src/lib/analyze/signals.test.ts:345-353` asserts testify-style calls are credited as substantive.
- LLM layer: `src/lib/scoring/prompt.ts` — system role instructs the LLM to calibrate to the deterministic signal within a guardband and to flag "discrepancies" where it believes the detector missed evidence (`prompt.ts:66,126-129,138`). D2's specific instruction lives in the shared `DIMENSIONS` criteria text injected into the prompt (`model.ts:100-101`).
- Blend + provenance: `SCORE_BLEND=0.6`, `LLM_GUARDBAND=25` (`prompt.ts:30,37`, re-exported via `maturity/model.ts`). Rendered per-dimension as a drillable signal→LLM→blended track: `src/components/report/DimensionDetail.tsx:86-126` (also duplicated in `DimensionCard.tsx:120-163` — the older/alternate render path).
- UI reachability: `/report/[owner]/[repo]` → "Dimensions" tab → `DimensionExplorer` (`src/components/report/DimensionExplorer.tsx:17-60`): radar + clickable per-dimension score-bar list, D2 is the 2nd of 9 dimensions in the list, click opens `DimensionDetail` (evidence, gaps, trend sparkline, provenance track). This is a **separate tab** from "Scoring" (`ScoringTab.tsx:112-113` — the old always-expanded 9-card stack was replaced by this click-to-explore explorer, so D2 is 2 clicks deep: Dimensions tab → D2 bar).

### D8 AI Process & Harness
- Rubric: `model.ts:152-160` — explicitly "evals or golden tests for AI/LLM output... not ad hoc".
- Deterministic detector: `src/lib/analyze/index.ts:665-722` (`const d8`). Detects evals/golden-test dirs or promptfoo config (`668-682`), structured prompt/agent/skill libraries incl. `.claude/skills/` (`684-692`), agent-readable runbooks/ADRs (`694-700`), AI contribution process / PR template / DoD (`702-709`), structured issue templates (`711-714`), plus the `.ai/` standard's D8 slice (`716-717`).
- Same reachability path as D2: Dimensions tab, 8th of 9 bars.

### Roadmap / recommendation tracker
- LLM-generated primary roadmap: prompt instructs 3-5 entries, invitational framing (title = observation, not imperative; "explore" = 2-3 open questions, not directive steps) — `prompt.ts:109-124`. This is a **deliberate product-philosophy choice** ("Ascent is a transition COMPANION, not a boss", `prompt.ts:115-116`), not a bug.
- Deterministic fallback (used only if the LLM roadmap comes back empty): `src/lib/scoring/recommendations.ts` — `CATALOG` per-dimension templates (`20-120`), ranked by weighted upside under the archetype lens (`buildFallbackRoadmap`, `123-161`). D2's fallback title: "Few tests vouch for behavior — little catches a bad change" (`32-42`) — specific to testing-as-guardrail framing, not a generic "add more tests", but also not phrased as a prioritized directive ("enforce coverage gating") the way Oliver's acceptance criterion wants.
- Persistence + open→in-progress→done: `src/components/report/RecommendationTracker.tsx` — `StatusSelect` PATCHes `/api/recommendations/[id]` (`93-129`), optimistic update + rollback + per-row error handling, progress bar computed over the actionable (non-dismissed) set (`51-58`). This is a real, working state machine, not a mock.

### /trends (D2/D8 over time)
- `src/app/trends/page.tsx` — gated on `isDbConfigured()` (`69-79`, degrades to a "Trends need a database" notice otherwise — satisfied under the seeded PGlite env per `uat/env.md`), then on sign-in state (`41-52`, bypassed under `ASCENT_AUTH_BYPASS=1`).
- Overall trajectory forecast: `forecastTrajectory` (`104-110`), rendered via `Trajectory` (`154-158`).
- Per-dimension trend: `src/components/report/DimensionTrends.tsx` — lazy-loads full per-dimension history client-side (`39-58`), iterates `DIMENSIONS` (`model.ts`, so D2 and D8 both appear as small-multiples) with a Last-5/30/90/All range toggle (`RangeToggle`) and hover tooltips (`DimLine`, `chartHover`).

### PR CI maturity gate
- `src/app/api/gate/[owner]/[repo]/route.ts` — unauthenticated GET, returns 200 on pass / 422 on fail so `curl --fail` in CI trips on a failing gate (`route.ts:1-2,138`). Policy precedence: explicit query params → org's persisted policy (`getOrgGatePolicy`) → archetype default (`104-114`).
- Verdict logic: `src/lib/scoring/gate.ts` — `evaluateGate` checks `minLevel`, `minOverall`, the global `minDimension` floor (every dimension ≥ N, `gate.ts:236-245`), and `minDimensionFor` (a `Partial<Record<DimensionId, number>>`, `gate.ts:21,62`) for per-dimension floors.
- **Gap found here** (see Finding 1): the *only* per-dimension floor wired end-to-end through both the URL contract (`policyFromParams`, `gate.ts:326-363`, exposes `min_security`/`security=1` but no `min_<dimension>` for arbitrary IDs) and the owner UI (`GatePolicyEditor.tsx:19,37-41,131-145`, a dedicated "Security floor (D9 ≥)" checkbox+input) is **D9 (Security)**. D2 (Testing) has no equivalent dedicated toggle — an owner can only set the *global* `minDimension` floor, which applies uniformly to all 9 dimensions, not a testing-specific bar.

---

## 2. Reachability check

All surfaces Oliver's journey touches are in the **public funnel + auth-bypass** reachable set per `uat/env.md`:
- `/`, `/report/[owner]/[repo]` — public, no auth, no entitlement gate.
- `/trends?repo=owner/repo` — needs `DATABASE_URL` (PGlite) + `ASCENT_AUTH_BYPASS=1`, both pinned in `.env.local` per env.md; not gated by org membership or plan tier for a single-repo trend read.
- Recommendation tracker persistence — needs DB (same PGlite), no additional entitlement.
- `/api/gate/[owner]/[repo]` — unauthenticated by design (`route.ts:48-54`), always reachable.
- `GatePolicyEditor` — this one **is** org-scoped (`org/[slug]/governance` surface, owner-only per its file header comment `GatePolicyEditor.tsx:3`). Oliver's journey is explicitly scoped to "one repo at a time" (`journeys/drive-testing-maturity.md:23`, out-of-scope: org-wide rollup), so whether he actually opens the org governance page to touch the gate policy is borderline — the journey's discovery hints do list "the PR CI gate" as something he'll look for, and `env.md`'s auth-bypass auto-seeds him as `owner` on a populated `/org/<slug>` (`env.md:34`), so the surface **is** reachable to him if he goes looking. Treated as in-set.

No affordance in this journey sits behind a plan tier or feature flag; nothing found "unreachable" for this Character.

---

## 3. Grounding audit — AI surfaces

**D2/D8 LLM judgment** (the report's dimension scores + summaries):
Real-world context sources Oliver would want the LLM to have seen, vs what actually reaches the prompt:

| Context source | Reaches prompt? | Evidence |
|---|---|---|
| Test file presence/count/paths | Yes | deterministic `signalScore` passed in, `prompt.ts` injects it per dimension |
| Sampled test-file body content (assertion quality) | Yes | `index.ts:296-320` computed and folded into `signalScore` before the LLM sees it; LLM also gets raw sampled file excerpts per the prompt's evidence block |
| CI config / coverage gating config | Yes | `d2` detector reads `idx.workflowText`, codecov/`.coveragerc` (`index.ts:254-266`) |
| Process signals (review discipline, merge velocity) | Yes | `prompt.ts:201` "PROCESS SIGNALS... behind D3/D6/D7/D8" |
| Prior org decisions on this repo's findings | Yes, if present | `decisionsBlock` / `orgDecisions` (`prompt.ts:102,197`) |
| Stack-fit caveat (rubric under-reads this stack) | Yes, if applicable | `prompt.ts:197` |
| Detected tech stack (languages/frameworks/roles) | Yes | `prompt.ts:197` |
| Mutation-testing / eval-harness tool config | Yes | `index.ts:277-278` (D2), `index.ts:672-682` (D8) |
| **Historical trend** (was this repo's D2 rising or falling before this scan) | **No** | Nothing in `prompt.ts` injects prior-scan history into the per-scan LLM judgment — the LLM scores each scan independently; trend is purely a post-hoc DB roll-up (`/trends`), never fed back as context |
| **The specific initiative/gate policy Oliver set** (e.g. "I already require coverage gating org-wide") | **No** | Gate policy (`org-gate.ts`) isn't part of the scoring prompt's inputs — the LLM has no visibility into what bar the org already enforces |

**Grounding score: 6/8** real context sources reach the prompt for D2/D8. The two gaps (no historical-trend context, no visibility into the org's own configured gate policy) are structural, not fatal — Oliver's core ask (evidence-grounded level + reason) is met; what's missing is closer-to-nice-to-have ("the LLM could say 'this is your third scan below the gate policy'").

---

## 4. In-character walkthrough (theoretical, over the designed experience)

I paste a public repo into the scan form. A few minutes later (this is claude-cli, so budget 30s–10min per `env.md:13` — noted, not penalized at L1) I land on `/report/owner/repo`. I go straight for the Dimensions tab, not Scoring — I don't want the headline number, I want to know *why*.

Two clicks: Dimensions tab, then the D2 bar. I get a summary paragraph, up to 4 strengths, up to 4 gaps, and — this is the part that actually matters to me — a provenance track showing the deterministic signal score, the LLM's judgment, and where they landed after the guardband blend. That's the auditable structure I use myself when I don't trust a raw number. Good.

I look for whether a big assertion-light suite would inflate this. Reading the code (not the live output, since this is L1): there's an actual mechanism for it — sampled test bodies get scanned for case count vs substantive assertion calls, and a body-heavy/assertion-empty suite eats a -15 penalty, capped as a signal input before the LLM even nuances it. That's the exact test I'd run myself with a quick grep through a suite. I'd want to *see* this live before I fully believe it (an LLM given ambiguous sample bodies could still miss it) — that's an L2 question, not an L1 gap.

D8 — eighth bar over. It's there, it detects evals/promptfoo/golden dirs, prompt/agent libraries, runbooks, and a structured contribution process. It's discoverable but it's buried at position 8 of 9; I'd have appreciated it being paired next to D2 given they're the two dimensions I actually came for, but that's a minor nav gripe, not a missing feature.

Roadmap: this is where I get more skeptical. The design philosophy here is explicitly "companion, not boss" — titles are framed as observations, not directives, and each item ships with open "explore" questions instead of a ranked action. I understand the intent, but I'm a QA lead who has to walk into a leadership review with three things I'm doing this quarter, ranked. "Explore whether gating would help" is not the same artifact as "enforce coverage gating in CI before adding more tests" — even if the *rationale* text underneath gets specific, the framing itself resists exactly the kind of directive prioritization I need to defend to my VP. I can't tell from the code alone whether the live LLM output will still land as specific enough (that's the L2 question) — but the system prompt is explicitly steering it away from imperative phrasing, which is a real design tension against my stated bar.

Recommendation tracker: real state machine, optimistic UI, PATCH persisted, dismissed items excluded from the progress denominator. I can move one to "in progress" and it sticks. Good — this is the part that lets me actually run an initiative, not just read a report once.

/trends: gated on DB, which the env has. Per-dimension small multiples exist for all nine — including D2 and D8 — with a range toggle and hover detail. This is exactly the "prove I moved the number" artifact I need for the VP. One structural note: the trend is purely historical roll-up; the LLM scoring each individual scan never sees its own prior trajectory as context, so a scan can't reason about "you regressed since last time" in its own summary — only the chart shows that. Fine for my purposes; I read the chart myself.

The CI gate: this is where I found the sharpest gap. I can gate a merge on overall score, on level, and there's a dedicated Security (D9) floor with its own checkbox in the org governance UI and its own `?min_security=`/`?security=1` URL params — someone clearly built a first-class per-dimension gate for security. I look for the equivalent for Testing (D2) — my whole reason for being here — and it isn't there. I have a "Min per-dimension" field, but that's a **global floor across all nine dimensions simultaneously**, not "hold D2 to 70 regardless of what D6 or D7 do." I can't say "gate this merge specifically on testing maturity" the way I can say it for security. That undercuts my last acceptance-criterion bullet directly: the gate is an enforced lever, but not a *testing-specific* one.

---

## 5. Findings

### Finding 1 — No dedicated per-dimension CI gate floor for Testing (D2), unlike Security (D9)
- id: L1-oliver-drive-testing-maturity-001
- journey: drive-testing-maturity · character: Oliver (QA / Test Lead) · cert_level: L1
- type: missing-feature
- severity: major (derived from impact below)
- dimension: trust / completion
- impact: `{ frequency: high (every gate-policy setup he'd do), reachability: high (org governance page, reachable via auth-bypass owner seed), trust_erosion: high (his #1 acceptance bullet is "the gate can actually fail a merge below a policy" specifically for testing) }`
- expected: a "Testing floor (D2 ≥ N)" toggle in `GatePolicyEditor` and a `min_testing`/`min_D2`-style URL param on `/api/gate/[owner]/[repo]`, mirroring the existing Security (D9) treatment.
- got: `GatePolicyEditor.tsx` exposes `minLevel`, `minOverall`, a single global `minDimension` (applies uniformly to all 9 dims), and a D9-only "Security floor" checkbox+input (`GatePolicyEditor.tsx:19,37-41,131-145`). `policyFromParams` (`gate.ts:326-363`) exposes `min_security`/`security=1` but no equivalent for any other dimension id, even though the underlying `GatePolicy.minDimensionFor: Partial<Record<DimensionId,number>>` (`gate.ts:21`) already supports it generically.
- evidence: `src/lib/scoring/gate.ts:21,62,326-363`; `src/components/org/governance/GatePolicyEditor.tsx:19,37-41,131-145`
- code_check: confirmed-absent (the data model supports it; no UI or URL-param path exposes it for D2)
- verdict: confirmed
- l2_priority: confirm live in the org governance UI that no D2-specific floor exists anywhere else (e.g. a different settings surface), and confirm whether a savvy user could still hit the underlying `/api/org/gate-policy` POST directly with `minDimensionFor: {D2: N}` (the API might accept it even though the UI doesn't expose it) — if so this becomes a discoverability finding, not a missing-feature one.
- suggested_acceptance: extend `GatePolicyEditor` with a generic per-dimension floor picker (dimension select + number), or at minimum add a second dedicated "Testing floor (D2 ≥)" control alongside Security, since D2 is one of Ascent's two flagship "rigor" dimensions per its own weighting.

### Finding 2 — Roadmap's invitational framing works against Oliver's need for ranked, directive moves
- id: L1-oliver-drive-testing-maturity-002
- journey: drive-testing-maturity · character: Oliver (QA / Test Lead) · cert_level: L1
- type: quality-gap
- severity: minor (derived from impact below) — not major, because the *rationale* text can still carry specificity even though the *title/explore* framing is deliberately non-directive
- dimension: senior-quality / clarity
- impact: `{ frequency: high (he reads the roadmap every visit), reachability: high, trust_erosion: medium (he'd still get value from the rationale; the framing is a friction, not a dead end) }`
- expected: "The roadmap names specific, correctly-prioritized testing moves a senior QA lead would endorse (gating, quality signal, flaky handling, contract tests)" (his acceptance criterion, character file line 54).
- got: the system prompt explicitly instructs the LLM to phrase roadmap titles as observations ("Agent guidance is thin...") not imperatives ("Add a CLAUDE.md"), and "explore" as open questions rather than steps — stated product philosophy: "Ascent is a transition COMPANION, not a boss" (`prompt.ts:109-124`). The deterministic fallback catalog's D2 entry follows the same pattern (`recommendations.ts:32-42`).
- evidence: `src/lib/scoring/prompt.ts:109-124`; `src/lib/scoring/recommendations.ts:32-42`
- code_check: by-design (this is a deliberate, documented product stance, not a bug)
- verdict: confirmed (as a value-fit tension, not a defect)
- l2_priority: pull a live roadmap for a real repo and check whether the "rationale" and "explore" text, even though non-imperative, land as specific enough (e.g. does it name "coverage gating" and "mutation/assertion signal" specifically, or stay generic under the hood of the invitational phrasing) — this determines whether Finding 2 stays minor or should be escalated.
- suggested_acceptance: none needed if L2 confirms the rationale text carries specific tool/practice names; otherwise consider letting power users (like Oliver, an owner) toggle a "directive" phrasing mode.

### Finding 3 — Historical trend and the org's own gate policy aren't fed back into the LLM's per-scan judgment
- id: L1-oliver-drive-testing-maturity-003
- journey: drive-testing-maturity · character: Oliver (QA / Test Lead) · cert_level: L1
- type: missing-feature
- severity: minor
- dimension: trust
- impact: `{ frequency: low (only relevant on repeat scans), reachability: high, trust_erosion: low (the chart itself still proves movement; this is about the summary prose, not the number) }`
- expected: n/a explicit in his criteria, but implied by "prove an initiative moved the number" — a summary that says "you're the third scan running below your own testing gate" would be stronger than a generic paragraph.
- got: grounding audit (§3) shows no prior-scan history or org gate-policy value reaches `prompt.ts`'s per-scan context.
- evidence: `src/lib/scoring/prompt.ts` (full context-injection block, ~lines 190-201) — no history/gate-policy param present.
- code_check: confirmed-absent
- verdict: confirmed
- l2_priority: n/a — this is a nice-to-have visible purely from code; L2 doesn't need to re-verify absence.
- suggested_acceptance: low priority backlog item, not blocking.

### Strength — D2's assertion-quality signal is a real, tested anti-vanity-metric mechanism
- Not a finding, but worth recording since it's the single highest-trust thing Oliver would look for: `index.ts:296-320` implements exactly the "coverage is execution, not validation" guard his `references:` cite, is wired into the LLM's guardband before any LLM nuance, and is unit-tested (`signals.test.ts:345-353`). Protect this on future edits.

### Strength — Recommendation tracker is a real, working open→in-progress→done state machine
- `RecommendationTracker.tsx` — optimistic updates, per-row rollback, 409 conflict re-fetch, config-vs-transient error distinction. Not vaporware.

---

## 6. Character voice — first-person reaction

Alright. I came in ready to be annoyed, and mostly I wasn't. The provenance track is the thing that would actually get me to stop reaching for my spreadsheet — signal, LLM, blended, side by side, per dimension, and I can see the guardband so I know the LLM isn't allowed to hallucinate a level the evidence doesn't support. And the assertion-quality check on D2 — reading sampled test bodies for actual `expect`/`assert` calls instead of just counting files — that's the exact thing I ran Stryker for once and got burned learning nobody else was checking. Someone here has read the same Codecov post I have. That's a good sign.

Where it loses me a little: the roadmap won't just tell me what to do. I get "explore whether gating would help" when what I want to walk into a leadership review with is "enforce coverage gating before chasing more tests, in that order." I get the philosophy — "companion not boss" — but I didn't come here for a philosophy, I came here for a plan I can defend Monday morning. If the rationale text underneath is specific enough, fine, I can translate it myself. If it's fluffy too, that's a real problem, and I won't know until I see it live.

And then the gate. I went looking for the one thing that would make this more than a report — a way to actually block a PR that lets test quality slide — and I found it, sort of. Security gets its own dedicated floor, its own checkbox, its own query param. Testing doesn't. I can set a "no dimension below 40" blanket rule, but that's not what I want; I want D2 held to a higher bar than, say, D7 commit hygiene, because testing is my actual mandate this half. Somebody built the exact right pattern for security and just... didn't extend it to testing. That's the gap that would make me hesitate before I roll this out as *my* enforcement mechanism — I'd have to go build the equivalent policy by hand outside the tool, which defeats some of the point.

Would I adopt it? Yes, provisionally — for the read itself, the drilldown, and the trend line, this already beats my day-per-repo audit by a wide margin, assuming the live output holds up (that's L2's job to confirm, not mine here). Would I stake the roadmap on it as-is, unedited? Not yet — I'd want to see a live roadmap first, and I'd want the security-grade gate treatment extended to testing before I'd point my squads at this as the lever, not just the mirror.
