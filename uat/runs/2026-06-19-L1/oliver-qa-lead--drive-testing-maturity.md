# L1 — Oliver (QA / Test Lead) × drive-testing-maturity

**Verdict: L1-conditional** — the flow completes structurally (scan → D2/D8 read → drill-to evidence → roadmap → tracker → /trends), and the provenance machinery is genuinely good. But two majors land squarely on Oliver's crux: the **D2 (and D8) deterministic signal measures test *presence and quantity*, never test *quality*** (no assertion density, no real coverage %, no mutation execution — only "is the tool configured"), and the **out-of-the-box /trends has only a single baseline point**, so he cannot prove the D2 number moved. Both are confirmed in code and carry forward to L2.

---

## Reachable surface set (gating followed)

Oliver's journey is the **public, no-signup** path plus a local `ASCENT_AUTH_BYPASS=1` + PGlite deploy for /trends. Reachable:

- **`/`** (landing + scan form) — public. `src/app/page.tsx:60`, scan gallery is public (`getPublicScanGallery`).
- **`/report/[owner]/[repo]`** — public; serves a pinned persisted report or falls back to a live scan via `ReportClient`. `src/app/report/[owner]/[repo]/page.tsx:52,61,69-77`. Org-scoping resolves an anonymous caller to the `public` org (`readableOrgForOwner`).
- **Scan API** — `POST /api/scan` (+ `/api/scan/stream`) → `scanRepository` (`src/lib/scan.ts:104`). Keyless → `MockProvider` (`src/lib/llm/index.ts:106-108,36-39`).
- **`/trends?repo=…`** — gated on `isDbConfigured()` (returns a "Trends need a database" notice otherwise, `src/app/trends/page.tsx:76-86`) and, when auth is configured, a session (`:50-59`). Under `ASCENT_AUTH_BYPASS=1` the auth gate is open and PGlite satisfies the DB gate, so it is reachable. `/api/history` feeds it (`src/app/api/history/route.ts`).
- **Recommendation tracker** — rendered in the Roadmap tab when persisted recs exist (`src/components/report/ReportView.tsx:232-235`); PATCH via `/api/recommendations/[id]`.
- **CI maturity gate** — `action.yml` + `scripts/maturity-gate.mjs` + `/api/gate/[owner]/[repo]` + `src/lib/scoring/gate.ts`. Reachable as a tool he'd wire into CI (out-of-session to *configure*, but fully present).

**Not reached / deferred:** org dashboards (`/org/*`) are the VP/Dana journey (out of scope per the journey). The `public`-org recommendation tracker is read-only by design — see F5.

---

## Surface model notes (affordances → backing `file:line`, emphasis on the grounding audit)

**Scan path (what feeds the score):**
- Ingestion samples **≤32 files** (`MAX_FILES=32`, `src/lib/github/source.ts:36`) and only **up to 4 test files** are sampled for content (`pickFilesToFetch` step 5, `source.ts:606-614`). Per-file excerpt to the LLM is capped at 2200 bytes (`src/lib/scoring/prompt.ts:87`).
- Deterministic detectors run first (`src/lib/analyze/index.ts:632 analyzeSignals`), then the LLM is guardbanded to ±25 of the signal and blended 60/40 (`src/lib/maturity/model.ts:16,23`; `src/lib/scoring/engine.ts:99-102`).

**D2 — Automated Testing detector (`src/lib/analyze/index.ts:193-243`) — Oliver's crux:**
- Score is built almost entirely from **path/presence + counts**:
  - `n` = count of files matching a **path regex** (`TEST_PATH`, `:186-187`); base points purely by count buckets: `n>=50 →50, >=21 →42, >=6 →32, else 20` (`:204`). **Quantity is rewarded directly.**
  - "Test framework configured" +15 — *manifest/workflow string match* for `vitest|jest|pytest|…` (`:208-215`), presence only.
  - "End-to-end tests configured" +15 — presence (`:216-218`).
  - "Coverage tracking configured" +10 — **presence of a config string** (`codecov.yml`, `--cov`, `nyc`) — **not an actual coverage number** (`:219-220`).
  - "test-to-source ratio" +10/+15 — **ratio of file counts** (`:222-226`).
  - Advanced rigor (mutation/Pact/k6/axe/schema) +6–8 each — **all presence-only** string matches (`:230-240`); never executed, never read for results.
- **Nowhere does D2 read the *body* of a test file to check assertion density, whether tests assert behavior vs. re-assert a mock, snapshot-only suites, or flaky handling.** `idx.content(...)` is used for D1 (CLAUDE.md quality), D5 (README), D6 (tsconfig) — but **D2 never inspects test contents.** A 200-snapshot, assertion-free suite scores `base 50 + framework 15 + ratio 15 = 80/100` (L4-band signal).

**D8 — AI Process & Harness detector (`:502-549`):**
- Eval/golden-test harness +30 (`:507-512`) — **presence** of `evals/`, `promptfoo`, `golden/`, or the strings in path/manifest/workflow. Good *direction* (it explicitly rewards an AI eval harness, not "AI is used" — `detectAiUsage` is a *separate* non-scored indicator, `:665-678`), but again presence-only; it never verifies the eval suite asserts anything.
- Prompt/agent library +25, runbooks/ADRs +20, PR-template/DoD +15, issue templates +10, `.ai/` doctor wired-into-CI +8 (`aiStandard`, `:129-153`). The `.ai/` doctor is the one place the model checks *evidence of use* (wired vs. merely present), the Goodhart guard (`:141-149`).

**Prompt (what the LLM is told about testing) — `src/lib/scoring/prompt.ts`:**
- Rubric criteria injected verbatim from `model.ts` D2/D8 (`prompt.ts:48-57`). The D2 criteria string (`model.ts:87`) names "test-to-source ratio… coverage config… High maturity = meaningful behavioral/edge-case tests with broad coverage and a clear testing philosophy" — so the *rubric language* gestures at quality, but the **only quantitative anchor the LLM is given is the presence-based `signalScore`**, and it's told to "calibrate to these… (nuance within a small band)" (`prompt.ts:46,111,124`) and is hard-clamped to ±25 (`engine.ts:99-102`). With only ≤4 test files in the window and a directive to stay near a presence-driven floor, the LLM cannot independently establish assertion quality.

**Provenance display (strength) — `src/components/report/DimensionCard.tsx`:**
- Expandable D2 card shows `summary`, an **Evidence list** (the exact signal labels, e.g. "Found 23 test files", "Coverage tracking configured"; `:75-87`), Gaps, optional Trend sparkline, and a **signal→LLM→blended ProvenanceTrack** SVG with the ±25 guardband zone and per-element tooltips (`:103,117-159`). This is genuinely drill-to-able and reconciles (signal vs LLM vs blended are all shown).

**Roadmap / recommendations (`src/lib/scoring/recommendations.ts`):**
- Fallback/mock D2 entry: title "Few tests vouch for behavior — little catches a bad change"; rationale "Tests are the guardrail…"; explore "what would catch a regression before it merged?" (`:32-41`). Invitational, decent, but **generic** — no gating-before-volume, no mutation/assertion-density move, no flaky quarantine, no contract-test-at-the-seam. D3's entry does name gating ("A CI gate turns guardrails into enforcement", `:43-52`) and ranking is by weighted upside (`:146-148`), so gating *can* out-rank "more tests" — but only as a D3 item, not as a D2 quality move.
- LLM roadmap (when a key is present) is freer (`prompt.ts:128-136,149`) but invitational-by-design ("never as orders") and unverified at L1.

**CI gate (`src/lib/scoring/gate.ts`, verified):** real pass/fail (`:163`), enforced via HTTP 422 → `curl --fail` → `scripts/maturity-gate.mjs` `process.exit(1)` and a GitHub Check Run conclusion `"failure"` (`gate-comment.ts:65`). **Can target D2** via a global `min-dimension` floor or a DB-persisted `minDimensionFor: { D2: N }` policy (`gate.ts:21,97,139-155`); missing/unscored dim is treated as below-floor (fail-closed, `:45-47`). No dedicated `?min_d2` Action input (only D9 has the `?security` shortcut).

**/trends data reality (verified):** the local seed (`scripts/seed-scans.mjs`, `db:local:seed`) scans each repo **exactly once**, single date; commit-SHA dedup (`scans-persist.ts`) prevents re-runs from adding points. `/trends` shows "Only a baseline scan so far…" at `history.scans.length === 1` (`src/app/trends/page.tsx:155-159`). Per-dimension D2 rows *are* persisted and DimensionTrends *does* render a D2 small-multiple (`DimensionTrends.tsx:107-116`), so the **machine works** — but with one point there is no movement to show out of the box.

---

## Findings

```json
[
  {
    "id": "L1-OLIVER-D2-QUALITY",
    "journey": "drive-testing-maturity",
    "character": "Oliver (QA / Test Lead)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "senior-quality",
    "title": "D2 measures test PRESENCE and QUANTITY, never test QUALITY — a 200-snapshot assertion-free suite scores ~80/100",
    "expected": "The D2 read reflects test quality (assertion density / behavioral coverage / mutation), so a large assertion-light or AI-inflated suite does NOT read as mature — the exact vanity-metric trap Oliver came to detect.",
    "got": "The D2 detector scores entirely from path-regex file counts (base 20-50 by count bucket), presence-only framework/e2e/coverage-config string matches, and a file-count test-to-source ratio. It never reads a single test body for assertions. 'Coverage tracking configured' (+10) is presence of a config string, not a real coverage %. Mutation/contract/perf/a11y/schema are presence-only string matches capped at 6-8 pts. A suite that asserts nothing scores base 50 + framework 15 + ratio 15 = 80 (L4 band).",
    "evidence": [
      "src/lib/analyze/index.ts:193-243 (d2 detector)",
      "src/lib/analyze/index.ts:204 (count-bucket base score)",
      "src/lib/analyze/index.ts:219-220 ('Coverage tracking configured' = presence of config string, not a %)",
      "src/lib/analyze/index.ts:222-226 (test-to-source RATIO of file counts)",
      "src/lib/analyze/index.ts:230-240 (advanced rigor: all presence-only)",
      "src/lib/maturity/model.ts:87 (D2 criteria: rubric LANGUAGE says 'meaningful behavioral tests' but the only anchor is the presence signalScore)"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "On a repo with a known assertion-light / snapshot-heavy suite, confirm the live D2 level reads as mature (L3+) and that neither the LLM summary nor the guardband corrects it down. Then a repo where Copilot doubled the test count — does D2 rise on volume alone?",
    "suggested_acceptance": "D2 incorporates at least a directional assertion-quality signal (assertion density sampled from the ≤4 fetched test bodies, or a mutation-score config that is actually parsed), such that a high-count assertion-free suite cannot reach the same band as a behaviorally-tested one."
  },
  {
    "id": "L1-OLIVER-GUARDBAND-CEILING",
    "journey": "drive-testing-maturity",
    "character": "Oliver (QA / Test Lead)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "Even with an LLM, D2 is clamped to ±25 of the presence-based signal — and on the default keyless public scan it IS the signal, with zero quality nuance",
    "expected": "If the deterministic signal can't see test quality, the LLM layer should be able to read the sampled test bodies and pull the score toward reality (and flag the discrepancy).",
    "got": "The LLM is guardbanded to within ±25 of the deterministic (presence) signal and blended 60/40, so it can nuance but not contradict a presence-inflated D2. Worse, Oliver's default path is a keyless public scan: with no GEMINI_API_KEY the provider is MockProvider, which sets every dimension score EXACTLY to its signalScore (no LLM at all). Only ≤4 test files reach the LLM window even when a key exists, so it can't establish assertion quality across the suite anyway.",
    "evidence": [
      "src/lib/maturity/model.ts:16,23 (SCORE_BLEND 0.6, LLM_GUARDBAND 25)",
      "src/lib/scoring/engine.ts:99-102 (guardband clamp + blend)",
      "src/lib/llm/mock.ts:39 (dimSummary: score = s.signalScore)",
      "src/lib/llm/index.ts:36-39,106-108 (keyless 'auto' => MockProvider)",
      "src/lib/github/source.ts:606-614 (only up to 4 test files sampled)",
      "src/lib/scoring/prompt.ts:46,124 ('calibrate to these', 'nuance within a small band')"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Scan a public repo BOTH keyless (mock) and with a key — confirm the keyless D2 carries no caveat that it's detector-only for this dimension, and that with a key the LLM still can't move an inflated D2 below its band due to the guardband."
  },
  {
    "id": "L1-OLIVER-TRENDS-FLAT",
    "journey": "drive-testing-maturity",
    "character": "Oliver (QA / Test Lead)",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "dimension": "time-saved",
    "title": "/trends has only a single baseline point out of the box — he cannot PROVE the D2 number moved",
    "expected": "/trends shows the D2 score over time so Oliver can point at the line and say 'the gating initiative moved it' — proof of improvement, his core motivation.",
    "got": "The seed (db:local:seed -> seed-scans.mjs) scans each repo exactly once at a single date; commit-SHA dedup means re-running adds no points. /trends then renders 'Only a baseline scan so far — the trend lines fill in after the next scan' and the forecast is null until two distinct scan days. The per-dimension D2 small-multiple machinery works, but has nothing to plot.",
    "evidence": [
      "scripts/seed-scans.mjs (single scan per repo; no date backfill)",
      "src/app/trends/page.tsx:155-159 (single-baseline notice)",
      "src/app/trends/page.tsx:113-117 (forecast null until 2 distinct days)",
      "src/components/report/DimensionTrends.tsx:107-116 (D2 row exists and would render)",
      "src/app/api/history/route.ts (series API works once >1 dated scan exists)"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "l2_priority": "Insert/seed multiple dated scans with VARYING D2 values (distinct commits) and confirm the D2 small-multiple actually draws a moving line + delta, and that a deep-linked trend dot opens the pinned report. This is the make-or-break for his 'prove movement' job."
  },
  {
    "id": "L1-OLIVER-ROADMAP-GENERIC",
    "journey": "drive-testing-maturity",
    "character": "Oliver (QA / Test Lead)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "senior-quality",
    "title": "Deterministic D2 roadmap item is the generic 'few tests vouch for behavior', not specific senior-QA moves (mutation/assertion signal, flaky quarantine, contract tests)",
    "expected": "The roadmap names specific, correctly-prioritized testing moves a senior QA lead would endorse — gating before more tests, a quality signal before chasing coverage, flaky quarantine, contract tests at the seam.",
    "got": "The fallback/mock D2 catalog entry is a single generic gap ('Few tests vouch for behavior'). Gating is named — but as a D3 item, not a D2 quality move; and there is no mutation/assertion-density, flaky-quarantine, or contract-test recommendation anywhere in the catalog. Ranking by weighted upside can surface gating ahead of volume, which is correct directionally.",
    "evidence": [
      "src/lib/scoring/recommendations.ts:32-41 (D2 entry, generic)",
      "src/lib/scoring/recommendations.ts:43-52 (D3 gating entry)",
      "src/lib/scoring/recommendations.ts:146-148 (weighted-upside ranking)"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "With an LLM key, judge whether the GENERATED D2/D8 roadmap names senior-grade moves (mutation, assertion density, flaky quarantine, contract tests at seams) or collapses to 'add more tests / raise coverage'. The deterministic floor alone would not satisfy his senior-quality bar."
  },
  {
    "id": "L1-OLIVER-D8-EVAL-HARNESS",
    "journey": "drive-testing-maturity",
    "character": "Oliver (QA / Test Lead)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "strength",
    "dimension": "trust",
    "title": "STRENGTH: D8 rewards an AI EVAL/HARNESS, not mere AI usage — and keeps 'is AI used' as a separate, unscored indicator",
    "expected": "D8 must reward a real AI eval/test harness (fixtures, eval suites, CI-run AI checks), so 'we use Copilot' can't masquerade as 'we test our AI'.",
    "got": "D8's top signal (+30) is an AI-output eval/golden-test harness (evals/, promptfoo, golden/); 'is AI in the workflow' is computed SEPARATELY as a non-scored indicator (detectAiUsage), explicitly so AI usage isn't conflated with maturity. The .ai/ doctor is scored by evidence-of-use (wired into CI vs merely present) — a Goodhart guard. This is exactly the distinction Oliver wants; it's presence-not-execution (see F1/F2), but the design intent is right.",
    "evidence": [
      "src/lib/analyze/index.ts:507-512 (D8 eval/golden-test harness +30)",
      "src/lib/analyze/index.ts:665-678 (detectAiUsage — separate, unscored)",
      "src/lib/analyze/index.ts:141-149 (.ai/ doctor scored by wired-into-CI evidence)",
      "src/lib/maturity/model.ts:144-145 (D8 criteria: evals/golden tests for AI output)"
    ],
    "code_check": "by-design",
    "verdict": "confirmed"
  },
  {
    "id": "L1-OLIVER-PROVENANCE",
    "journey": "drive-testing-maturity",
    "character": "Oliver (QA / Test Lead)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "strength",
    "dimension": "trust",
    "title": "STRENGTH: every D2 score is drill-to-able — evidence list + signal→LLM→blended provenance track that reconciles",
    "expected": "A score with provenance he can defend to his squads — drill to the file/CI evidence behind the level, see signal vs LLM vs blended.",
    "got": "The D2 card expands to show the exact signal labels as Evidence, the gaps, and a ProvenanceTrack SVG plotting the deterministic signal, the (clamped) LLM judgment, the ±25 guardband zone, and the blended result — all reconciling. The 'Flagged for review' panel surfaces LLM-vs-detector discrepancies. This is the part Oliver would relax at: he can see WHY, not just WHAT.",
    "evidence": [
      "src/components/report/DimensionCard.tsx:75-103 (evidence list + provenance)",
      "src/components/report/DimensionCard.tsx:117-159 (ProvenanceTrack signal/LLM/guardband/blended)",
      "src/components/report/ReportView.tsx:245-261 (discrepancies panel)"
    ],
    "code_check": "by-design",
    "verdict": "confirmed"
  },
  {
    "id": "L1-OLIVER-GATE-ENFORCES",
    "journey": "drive-testing-maturity",
    "character": "Oliver (QA / Test Lead)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "strength",
    "dimension": "completion",
    "title": "STRENGTH: the CI maturity gate genuinely blocks a merge below policy and can target a D2 floor",
    "expected": "The PR CI gate can actually fail a merge below a policy — maturity is an enforced lever, not advisory theater.",
    "got": "The gate computes a real pass/fail and enforces it: HTTP 422 (so 'curl --fail' exits non-zero), scripts/maturity-gate.mjs process.exit(1), and a GitHub Check Run conclusion of 'failure'. A D2 floor is enforceable via a global min-dimension or a DB-persisted minDimensionFor:{D2:N}; an unscored dimension is treated as below-floor (fail-closed). No dedicated D2 Action-input shortcut (only D9/security), so it's slightly less discoverable for D2 specifically.",
    "evidence": [
      "src/lib/scoring/gate.ts:163 (pass = failures.length === 0)",
      "src/lib/scoring/gate.ts:139-155 (per-dimension floors incl. D2)",
      "src/lib/scoring/gate.ts:45-47 (missing dim treated as below floor)",
      "src/app/api/gate/[owner]/[repo]/route.ts:79 (422 on fail)",
      "src/lib/scoring/gate-comment.ts:65 (Check Run conclusion 'failure')"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm a configured D2 floor (via min-dimension or minDimensionFor) actually returns 422 / exit 1 live, and that the PR comment names D2 as the failing dimension."
  },
  {
    "id": "L1-OLIVER-TRACKER-PUBLIC-403",
    "journey": "drive-testing-maturity",
    "character": "Oliver (QA / Test Lead)",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "minor",
    "dimension": "completion",
    "title": "Recommendation status changes 403 for public-org scans — Oliver's default public scan can't move a rec open→in-progress→done",
    "expected": "He can move a testing recommendation open→in-progress→done and see it reflected.",
    "got": "PATCH /api/recommendations/[id] returns 403 when the rec's owning org is the shared 'public' funnel org — and a keyless public scan persists under orgSlug 'public'. ASCENT_AUTH_BYPASS=1 opens the authz check but does NOT lift the public-org 403 (it's independent of auth). So the tracker is fully functional only for recs in a real (non-public) org, e.g. via /api/org/import seeding into a named org. The tracker UI itself (optimistic update, rollback, live region) is solid.",
    "evidence": [
      "src/app/api/recommendations/[id]/route.ts:44-49 (public-org 403)",
      "src/app/api/recommendations/[id]/route.ts:28-33 (503 when no DB)",
      "src/components/report/RecommendationTracker.tsx:77-119 (optimistic PATCH + rollback)",
      "src/lib/scan.ts:81,96 (tokenless scan => orgSlug 'public')"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Under bypass+PGlite, import a repo into a NAMED org and confirm a D2 recommendation moves open→in_progress→done and persists; separately confirm the public-org path shows a sensible message rather than a dead 403 in the UI."
  }
]
```

---

## Character feedback (Oliver, first person)

Right, let me be honest about what I'm looking at, because this is the exact decision I came here to make.

The chrome is better than I expected. The provenance track is the thing that made me lean in — I can expand D2, see the signal score, see where the LLM landed, see the ±25 band it's allowed to move within, and see the blended number. That's the read I'd *want* to hand a squad: here's the level, here's why, here's the evidence. And I genuinely appreciate that D8 keeps "are you using AI" as a separate badge and reserves the actual *score* for whether you have an eval/golden-test harness. That's the distinction nobody draws and it's the one I care about most — "we turned on Copilot" is not "we test our AI." Somebody who's been burned by green-checkmark theater designed that, and it shows. The gate, too: it actually returns a failing status and exits non-zero, and I can set a D2 floor. That's an enforced lever, not a poster. Good.

But here's where I go quiet and start probing the evidence — and the evidence doesn't hold. **D2 is counting my test files and reading my package.json. It is not reading my tests.** It buckets on file count (fifty-plus files buys you fifty points before anything else), it adds points because the word "vitest" appears in a manifest, it adds points because `codecov.yml` *exists* — not because coverage is *enforced* or *high*, just that the config is in the tree. The "coverage tracking configured" line is presence of a string. The test-to-source "ratio" is a ratio of *file counts*. Nowhere does it crack open a test body and ask the only question that matters: does this test assert behavior, or is it a snapshot that re-renders the mock and goes green? My nightmare repo — the one where Copilot doubled the suite and every new test asserts `not null` and nothing else — scores around 80 here. That's L4 band. That is precisely the vanity number I do *not* want to put my name on, dressed up with a nicer chart.

And the LLM can't save me from it, two ways. On a free public scan with no key — which is how I'd first try it — there's no LLM at all; D2 *is* the file-count signal, full stop. Even with a key, the model is clamped to ±25 of that presence number and is handed at most four of my test files. It can't establish assertion quality across a suite from four files while being told to stay near a floor that already rewarded the volume.

The other dealbreaker for *my* job: I came to prove the number moved after an initiative, and out of the box /trends has one dot. The plumbing is there — the per-dimension D2 line would render — but the seed gives me a single baseline and re-scanning the same commit dedups, so there's nothing to plot. "The trend lines fill in after the next scan" is not the same as "here's the line, and here's where the gating initiative moved it."

Would I adopt it? Not yet, and not to replace my spreadsheet. The spreadsheet is slower but it answers the one question this tool currently can't: *is the testing any good, or is there just a lot of it.* If D2 had even a directional assertion-density or real-mutation-score signal so that an assertion-free suite couldn't reach the same band as a behaviorally-tested one, and if I could see a D2 line actually move over a quarter, I'd pilot the gate on one squad tomorrow. Today it's a more honest-looking coverage badge with excellent provenance — and provenance on the wrong measurement is still the wrong measurement.

---

## l2_priority (carry-forward)

- **D2 quality vs quantity (the crux):** scan a repo with a known assertion-light / snapshot-only suite (and one where AI doubled the count) and confirm whether the live D2 reads as mature on volume alone — and whether the LLM summary/guardband ever corrects it down. If it doesn't, F1 is the headline.
- **Keyless vs keyed D2:** verify the keyless (mock) report carries no caveat that D2 is detector-only, and that with a key the guardband still can't pull an inflated D2 below its band.
- **/trends movement:** seed multiple dated scans with varying D2 values (distinct commits) and confirm the D2 small-multiple draws a moving line + delta and the dots deep-link to pinned reports — the make-or-break for "prove it moved."
- **Generated roadmap quality (keyed):** judge whether the LLM D2/D8 roadmap names senior-grade moves (mutation, assertion density, flaky quarantine, contract tests at seams) or collapses to "add more tests."
- **Gate enforces a D2 floor live:** confirm a configured D2 floor returns 422 / exit 1 and the PR comment names D2.
- **Tracker in a real org:** under bypass+PGlite, import into a named org and confirm a D2 rec moves open→in_progress→done and persists; confirm the public-org 403 surfaces a sensible message, not a dead end.
