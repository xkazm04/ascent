# L1 sweep brief — 2026-06-19 (theoretical / code-grounded, NO browser)

You are running **Level-1 certification** for ONE `character × journey`: a thought experiment over a *surface model built from the code*. **Do not start or drive a browser. Do not run the app.** You read code, build the surface model, walk the journey in-character, and judge the *designed* experience.

## Method (do these in order)

1. **Build the surface model from the code.** For each affordance the Character would use (button / input / link / control), **follow the actual import chain** from the affordance to the code that backs it — page → component → handler → the API route → the lib function / the LLM prompt. Capture: affordances, the inputs each accepts, the state/data it reads, navigation between surfaces. **Cite `file:line` for everything.** Don't guess a file — open it.
   - **Grounding audit (the L1 sweet spot for this AI product):** the whole value is a *credible maturity score*. Trace what actually feeds the score and the generated artifacts — `src/lib/scoring/prompt.ts` (what context the LLM is given), `src/lib/github/source.ts` (what repo data is sampled — ≤32 files), `src/lib/analyze/*` (the deterministic signals), `src/lib/scoring/engine.ts` (signal↔LLM blend + guardband), `src/lib/scoring/recommendations.ts` (the roadmap). Ask: does the score/roadmap get the *real* repo evidence, or thin inputs? Is the evidence re-traceable (provenance)? "Good machinery fed thin context" is the most common defect and it's fully visible in code.
2. **Reachability check (resolve BEFORE judging).** Compute the Character's *actually-reachable surface set*: follow nav + entitlement/auth gating (public vs `/org/*`, DB-on vs off, plan/credits, `ASCENT_AUTH_BYPASS`, feature flags) to the routes THIS Character can actually open. Judge each affordance only within that set. A finding on a surface the Character can't reach isn't "works" — tag it `unreachable` and defer its job-impact to L2 (or flag the *gating itself* as the finding). **Keep three verdicts distinct: a thing existing in code ≠ reachable by this Character ≠ unblocks their job.** L1 can honestly speak only to "exists/landed."
3. **Walk the journey in-character over the model.** At each step ask the cognitive-walkthrough questions (know what to do? · see the control? · connect control→intent? · understand the result?) PLUS the Character's own **scored acceptance criteria** — including **time-saved** and **senior-quality** applied to the *designed* experience (would this flow + this prompt/grounding plausibly save the Character's stated hours and produce senior-grade output?). Stay in their head and vocabulary.
4. **Emit findings + a verdict.**

## Finding schema (one object per finding; strengths allowed too)
`{ id, journey, character, cert_level:"L1", type, severity, dimension, title, expected, got, evidence[], code_check, verdict, l2_priority? , suggested_acceptance? }`
- `type`: missing-feature | quality-gap | broken-flow | confusion | trust
- `dimension`: completion | effort | clarity | trust | missing | time-saved | senior-quality
- `severity`: blocker | major | minor | polish
- `evidence[]`: `file:line` (REQUIRED at L1 — no finding without code evidence)
- `code_check`: confirmed-absent | present-but-missed | present-broken | by-design | unreachable | n-a
- `verdict`: confirmed | refuted | uncertain  (adversarial — default refuted/uncertain unless the file:line holds)
- `l2_priority`: if this needs the live app to confirm (actual score/roadmap/prose quality, real latency, rendering), say what L2 must check.
- A **strength** is a finding with a positive framing — record the things that are *right* (decision-useful: says what NOT to touch).

## Per-journey verdict (pick one)
- **L1-pass** — structurally sound, no majors → clean to L2.
- **L1-conditional** — completes structurally but has major finding(s) to fix; still L2-eligible, majors carry forward.
- **L1-fail** — a structural gap blocks the job; no browser needed to know it's broken.

## App facts (Ascent — the maturity index for AI-native engineering)
Scores a GitHub repo/org on LLM-driven-dev adoption: **5-level ladder L1 Manual→L5 Autonomous × 9 weighted dimensions** (D1 AI Tooling & Conventions · D2 Automated Testing · D3 CI/CD & Delivery · D4 Agentic Workflows · D5 Docs & Knowledge · D6 Code Quality & Guardrails · D7 Commit & Velocity Signals · D8 AI Process & Harness · D9 Supply Chain & Security). Archetype-aware weighting (solo/team/org). Adoption (D1/D4/D7) × rigor (rest) → **posture quadrant** (AI-Native / Fast & Ungoverned / Solid but Manual / Getting Started). Every score cites evidence via a **signal→LLM→blended provenance track** (LLM guardbanded ±25 to the deterministic signal, blended 60/40), surfaces LLM-vs-detector discrepancies, and rolls up a prioritized **roadmap**. Free public single-repo scan (no signup); B2B = org dashboards. Local env: deterministic mock OR `LLM_PROVIDER=claude-cli`; PGlite; `ASCENT_AUTH_BYPASS=1` opens `/org/*` and (on a populated org) persists a "developer" owner profile.

## Surface → entry-point map (where to start reading; follow imports from here)
- **Landing / scan:** `src/app/page.tsx`, `src/components/ScanForm.tsx` → `src/app/api/scan/route.ts` + `…/scan/stream/route.ts` → `src/lib/scan.ts` → `src/lib/github/source.ts`, `src/lib/analyze/*`, `src/lib/scoring/{prompt,engine,recommendations}.ts`, `src/lib/maturity/model.ts`
- **Report:** `src/app/report/page.tsx`, `src/app/report/[owner]/[repo]/page.tsx`, `src/components/report/ReportView.tsx` + `report/*` (RadarChart, DimensionCard, PosturePanel, ScoreWaterfall, RoadmapPanel, RecommendationTracker, PrSignalsPanel, ContributorsPanel) ; compare: `src/app/report/compare/page.tsx` + `report/WhatChanged*.tsx`
- **Trends:** `src/app/trends/page.tsx`, `src/components/report/DimensionTrends*.tsx`, `src/app/api/history/route.ts`
- **Badge:** `src/app/badge/page.tsx`, `src/app/api/badge/[owner]/[repo]/route.ts`
- **Pricing / About / marketing:** `src/app/pricing/page.tsx`, `src/app/about/page.tsx`, `src/app/launch/page.tsx`, `src/components/launch/*`
- **Onboarding / Connect:** `src/app/onboarding/page.tsx` + `src/components/onboarding/*`; `src/app/connect/page.tsx` + `src/components/connect/*`
- **Org overview / executive:** `src/app/org/[slug]/page.tsx` + `…/layout.tsx` + `…/executive/page.tsx` → `src/lib/db/{org-rollup,org-insights,org-signals,window}.ts`
- **Contributors / Delivery / Governance / Security:** `src/app/org/[slug]/{contributors,delivery,governance,security}/page.tsx` → `src/lib/db/{org-contributors,org-teams,org-gate}.ts`, `src/lib/alerts.ts`
- **Practices / .ai standard / onboarding skill:** `src/app/org/[slug]/practices/page.tsx` → `src/lib/standard/*`, `src/lib/onboarding/skill.ts`, `src/app/api/{practices/apply,report/skill}/route.ts`
- **Plan (goals/simulator/initiatives):** `src/app/org/[slug]/plan/page.tsx`
- **Members / Usage:** `src/app/org/[slug]/members/page.tsx` + `src/lib/db/members.ts`; `src/app/usage/page.tsx` + `src/lib/db/usage.ts`
- **CI gate:** `src/lib/scoring/gate.ts`, `src/lib/scoring/gate-comment.ts`, `src/app/api/gate/[owner]/[repo]/route.ts`, `action.yml`
- **Recommendation tracker API:** `src/app/api/recommendations/route.ts` + `…/[id]/route.ts`

## What to WRITE (your deliverable)
Write a single file: `uat/runs/2026-06-19-L1/<your-report-filename>` (given in your task) — Markdown with these sections:
1. **`# L1 — <Character> × <journey>`** + a one-line **verdict** (L1-pass / L1-conditional / L1-fail).
2. **Reachable surface set** (the routes this Character can open, with the gating you followed).
3. **Surface model notes** — key affordances → backing `file:line` (terse, just what the journey touches; emphasize the grounding-audit findings on the scoring path if the Character cares about score quality).
4. **Findings** — a fenced ```json array of finding objects (schema above). Include strengths.
5. **Character feedback (first person, in their VOICE)** — a candid L1 review of the *designed* experience: would I adopt it? · what delights/worries me on paper · does it fit my world · is the score something I'd trust/report/stake on · is it worth my time vs my manual way · what's missing for MY job · what must L2 confirm live? Ground it in the Character's Background/Voice from their file.
6. **`l2_priority`** — bullet list of exactly what L2 must verify live (carry-forward).

## What to RETURN to the orchestrator (keep it short)
`VERDICT: L1-pass|L1-conditional|L1-fail` · counts by severity (blocker/major/minor/polish) · the single sharpest finding (title) · a one-sentence Character verdict in their voice · the top `l2_priority` item.
