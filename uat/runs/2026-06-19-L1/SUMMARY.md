# L1 panel synthesis — 2026-06-19

**10 Characters · 10 journeys · 1 L1-pass (Nadia) · 9 L1-conditional · 0 fail · 0 blockers · ~17 confirmed majors.**

The panel is unusually unanimous, in both directions: every Character respects the *machinery*, and 9 of 10 withhold their real "yes" for the same reason. The product's whole value proposition is a *credible* maturity score — and the path the default keyless/mock deployment exercises is exactly the one that strips out the credibility-bearing layer (the LLM). The engine is built right; the demo shows the floor.

---

## Cross-cutting themes (ranked by # of Characters)

### 1. The keyless/mock default undermines the credibility the product sells — **5 Characters direct, 8 touching it**

This is the dominant theme and the headline of the whole sweep. The deterministic MockProvider sets every dimension `score = signalScore` verbatim, emits empty discrepancies, and falls back to a templated catalog roadmap — so on the default path the LLM (the thing the product is *for*) contributes nothing, yet the surfaces still render as if it had.

- **Sam (Staff Engineer):** MockProvider hard-sets `discrepancies: []` — the "Flagged for review" self-audit panel never appears; the public roadmap is catalog-templated, not repo-specific. `src/lib/llm/mock.ts:86`, `recommendations.ts:20-120`.
- **Oliver (QA Lead):** under mock, D2 collapses to the presence-floor signal with zero quality nuance, and even with a key the guardband clamps it to ±25 of a presence number. `analyze/index.ts:193-243`, `engine.ts:99-102`, `mock.ts:39`.
- **Mei (OSS Maintainer):** the README badge renders the mock level on a cache miss and after every push, so the badge can contradict the credible report. `badge/[owner]/[repo]/route.ts:286-303`.
- **Raj (DevOps/SRE):** the merge-blocking gate verdict runs mock by default (public API, App Check Run, and the Action all default to it) — the "maturity verdict" is a deterministic threshold, not the AI read advertised. `webhook/route.ts:216`, `gate/[owner]/[repo]/route.ts:24`, `action.yml:48`.
- **Tomáš (Buyer):** can't tell mock from real from the marketing/code — the scan is his only proof, and whether it reads senior-grade or "deterministic floor" is unknowable at L1. `llm/index.ts:106-116`.
- **Touching it (defer their yes to a live run):** Dana (recommendation prose is templated on a mock-seeded fleet), Priya (the gate/dashboard remediation prose is the mock catalog), Elena (whole-org onboarding read is a disclosed mock preview; default routing is Gemini-or-mock, not Bedrock).

The honest mitigations are real and should be protected: mock is badged "Demo · deterministic rubric," a degraded scan isn't persisted as canonical, partial-coverage warns loudly. But the *credibility-bearing* output isn't on the default path — so the panel's verdict is deferred, not denied.

### 2. Scoring/UI measures presence and quantity where the Character needs quality — **2 Characters**

- **Oliver:** D2/D8 score test *presence and quantity* — file-count buckets, framework string-match, coverage-config presence (not a real %), file-count ratio — never reading a test body for assertions; a 200-snapshot assertion-free suite scores ~80/100. `analyze/index.ts:193-243`.
- **Nadia (corroborating, narrower):** "Requires review" counts requires-a-PR, not requires-an-approval — an enforcement gradation that overstates approval-enforced coverage. `org-signals.ts:136`.

### 3. Discoverability — the core artifacts are hidden from the people who came for them — **2 Characters**

- **Mei:** the `/badge` generator (the prize of her journey) has no link from header, footer, or report. `badge/page.tsx:9`.
- **Priya:** the `.ai/` standard + onboarding SKILL.md generator (the center of her quarter) lives only on the per-repo report header, undiscoverable from /practices, /plan, /governance. `ReportHeader.tsx:65-71`.

### 4. Policy-drift — the "one bar" has a seam — **2 Characters**

- **Priya:** the Security (D9) floor enforced on the dashboard + App check is dropped from the copyable CI snippet and `action.yml` — and the page literally claims "no drift." `org/governance.ts:81-97`, `action.yml:20-51`.
- **Raj (corroborating, different mechanism):** governance score blend is additive-only — missing guardrails can never demote a repo, so an ungoverned repo can pass the gate on score alone. `analyze/pulls.ts:236-240`.

### 5. "Dashboard, not a decision" — **1 Character (Dana)**

The single highest-leverage section is explicitly framed as "inputs to explore… not a to-do list," and the executive Briefing offloads the actual recommended actions to an external LLM via "Copy briefing for LLM." The ranking math knows what #1 is; the product won't say it. `OrgLeverageMoves.tsx:13-15`, `briefing.ts:259-262`.

### 6. Individual-surveillance framing — **1 Character (Marcus)**

A per-engineer commit/AI-commit scoreboard with CSV export despite a "not a scoreboard" caption, and the small-population champion-suppression guard (correct on Contributors) is missing on Adoption + Teams. `contributors/page.tsx:101-149`, `adoption/page.tsx:71-89`.

### 7. In-product privacy disclosure — **1 Character (Elena)**

The Bedrock no-training / in-boundary guarantee is invisible at the private-scan decision point (README/code-comments only); default routing isn't even Bedrock. `connect/page.tsx:46-51`, `llm/config.ts:5-8,106-108`.

### 8. Pricing legibility — **1 Character (Tomáš)**

No numeric pricing anywhere — "Prepaid credits / final rate TBD" and "Custom / Contact us" — failing his #1 buy/no-buy criterion. `shared/content.ts:43-70`, `pricing/page.tsx:3-4`.

---

## Prioritized backlog

### P0 — core promise / trust (the product's credibility rests on these)

- **Exercise the live LLM on the paths the product is judged on.** Default the org dashboard / and surface the live-vs-mock distinction on every credibility-bearing surface (report, gate verdict, badge) so the demo doesn't ship the deterministic floor as the headline. *Sam, Oliver, Mei, Raj, Tomáš.* `mock.ts:86`, `engine.ts:96-102`, `badge/route.ts:286-303`, `webhook/route.ts:216`.
- **Make the badge be the report.** Resolve the badge to the most recent LLM report (with a freshness note) rather than minting a divergent mock level on cache miss / post-push. *Mei.* `badge/[owner]/[repo]/route.ts:286-303`.
- **Surface mock-vs-live on the merge-blocking Check Run** so a blocked dev knows which scoring path scored them, and confirm the mock and live verdicts agree on pass/fail. *Raj.* `webhook/route.ts:216`, `gate-comment.ts:96`.
- **Disclose private-code routing + the Bedrock no-training guarantee in rendered UI at /connect**, before a private scan runs. *Elena.* `connect/page.tsx:46-51`, `llm/config.ts:106-108`.

### P1 — quality-trust (the score must mean what the Character thinks it means)

- **Give D2 a directional assertion-quality signal** (assertion density from the ≤4 fetched test bodies, or a parsed mutation score) so a high-count assertion-free suite can't reach the same band as a behaviorally-tested one. *Oliver.* `analyze/index.ts:193-243`.
- **Close the D9 CI-snippet drift:** when the Security floor is set, emit it in `ciWith()` and forward it through `action.yml`, so dashboard / App-check / CI enforce one identical bar. *Priya, Raj.* `org/governance.ts:81-97`, `action.yml:20-51`, `gate.ts:237-244`.
- **Stop the gate passing ungoverned repos on score alone** — make missing protection able to demote, or document the additive-only blend at the gate. *Raj.* `analyze/pulls.ts:236-240`.
- **Defang the surveillance read:** reframe/aggregate/opt-in the per-named-engineer Involvement table + CSV, and apply the small-population champion guard consistently on Adoption + Teams. *Marcus.* `contributors/page.tsx:101-149`, `adoption/page.tsx:71-89`, `teams/page.tsx:70-78`.
- **Tighten "Requires review" to required_approving_review_count ≥ 1.** *Nadia.* `org-signals.ts:136`.
- **Make the decision the product makes:** surface a single named #1 fleet move with its projected maturity gain on-screen, not a copy-to-LLM round trip. *Dana.* `OrgLeverageMoves.tsx:13-15`, `briefing.ts:259-262`.
- **Don't render affordances that 503:** hide/downgrade the Onboarding-skill + Export-PDF links when there's no persisted report. *Sam.* `ReportHeader.tsx:58-71`, `report/skill/route.ts:27`.

### P2 — polish (discoverability, marketing, completeness)

- **Link the `/badge` generator** from the report header / footer. *Mei.* `badge/page.tsx:9`, `ReportHeader.tsx:56-71`.
- **Link the `.ai/` standard generator** from /practices (per-repo or fleet). *Priya.* `ReportHeader.tsx:65-71`.
- **Put at least one real number on a public pricing surface**, and point nav at the fuller `/pricing` page. *Tomáš.* `shared/content.ts:43-70`, `Brand.tsx:55,127`.
- **Surface regression alerts / the weekly digest in-app** (an alerts view), not just an audit row + webhook. *Raj.* `scan-alerts.ts:74`.
- **Public-org recommendation tracker:** show a sensible message instead of a dead 403. *Oliver.* `api/recommendations/[id]/route.ts:44-49`.
- **Supply-chain "scanning not enabled" empty state** when `SUPPLY_CHAIN_PROVIDER=off`. *Nadia.* `security/page.tsx:120`.
- **Clickable evidence file-links** on dimension cards. *Mei.* `DimensionCard.tsx:75-87`.

---

## Strengths worth protecting (do not regress)

- **Glass-box scoring that reconciles:** per-dimension signal/LLM/blended with a ±25 guardband; a waterfall that sums to the headline; loud partial-coverage warnings. (Sam, Dana, Marcus, Elena, Oliver, Mei.)
- **Detectors grade substance, not file presence** (D1 content, D9 present-vs-CI-wired, `.ai/` evidence-of-use Goodhart guard). (Sam.)
- **D8 rewards a real eval/harness, not mere AI usage** (AI-usage kept as a separate, unscored indicator). (Oliver.)
- **Nadia's firewall: Dependabot advisory count is architecturally separate from D9** and labelled "Demo data" under mock. The cleanest single design in the sweep. (Nadia — the L1-pass.)
- **The gate is deterministic, fail-closed, evidence-cited, archetype-aware; dashboard + App check run ONE policy** (stochastic-flip bug fixed; neutral check on hard error). (Raj, Priya, Oliver.)
- **Regression alerting engineered against fatigue** (delta-only, per-tenant, audited, exactly-once, throw-safe). (Raj.)
- **Trajectory shows its R²/OLS basis; adoption honestly split from rigor; period deltas cohort-matched.** (Dana, Elena, Marcus.)
- **Path-to-green is earned, not mandated** (deep-linked practices + starter PRs, invitational roadmap). (Priya.)
- **No-signup / no-paywall public front door genuinely honored in code; quota fails open and salvages the last report.** (Mei, Tomáš, Elena.)
- **Binder-grade audit CSV** (filtered, attributable, formula-injection-hardened). (Nadia.)

---

## Panel verdict (the shared sentiment across all 10 voices)

The machine is genuinely good — evidence-cited, reconciling, fail-closed, and honest about its own gaps — and on paper it would beat every Character's manual way of doing the job. But its credible output is gated behind a live LLM that the default keyless/mock path doesn't exercise, so the demo every Character lands on shows the deterministic floor rather than the product's actual value. The result is near-unanimous: nine of ten defer their real yes/no to "show me the live `claude-cli` run" — the structure is sound, the verdict is conditional, and L2 is almost entirely a single question.

---

## L2 hand-off list (deduped across all reports)

### THE headline check — resolves the dominant theme for Sam / Tomáš / Oliver / Raj / Dana / Mei in one run:

- **Run a single live `claude-cli` scan + gate on a repo the panel knows cold, and compare it to the mock path.** On that one run, confirm: (a) the LLM populates **real, re-traceable discrepancies** (not `[]`) on a repo whose detector demonstrably misses [Sam]; (b) the **roadmap names a concrete file/config/count**, not a dimension restatement [Sam, Oliver, Priya, Dana]; (c) the **D2 read isn't inflated by volume** and the LLM can pull an assertion-free suite down [Oliver]; (d) the **gate verdict's provider line reads claude (not mock)** and the live verdict agrees with the default mock verdict on pass/fail [Raj]; (e) the **scores reconcile** with a staff/buyer's own read and aren't the deterministic floor [Tomáš, Sam, Mei].

### Then, per-Character carry-forwards:

- **Privacy disclosure (Elena):** is there ANY in-product disclosure of private-code routing + the Bedrock no-training guarantee before/at a private scan? If still docs-only, the major stands.
- **D9 CI-snippet drift (Priya, Raj):** set the Security floor, copy the rendered CI snippet, confirm it enforces D9≥50; diff dashboard pass-rate vs the Gate API for a D9-failing repo. Then confirm whether an unprotected repo can still PASS the gate purely on score.
- **Surveillance read (Marcus):** does the per-named-engineer Involvement table + CSV read as a leaderboard to an EM? On a thin team, do Adoption/Teams celebrate a named individual that Contributors correctly suppresses?
- **/trends movement (Oliver):** seed multiple dated scans with varying D2 and confirm the D2 small-multiple draws a moving line + delta with deep-links — the make-or-break for "prove it moved."
- **Tokened governance truth-check (Raj, Nadia, Sam):** seed an org WITH a GITHUB_TOKEN; confirm protected/required-checks/signed flags match the real ruleset state, "Requires review" doesn't overstate approval-enforced coverage, and D3/D6/D8 PR evidence populates.
- **Decision vs backlog (Dana):** does the #1 leverage move + the LLM Briefing actions read as a single defensible decision a VP puts on a slide, or a hedged exploration list?
- **Discoverability live (Mei, Priya):** from `/` and a finished report, is there any clickable path to `/badge`? Can a platform lead on /practices locate the `.ai/` standard generator? (Inspect rendered DOM.)
- **Badge ↔ report agreement (Mei):** scan with the LLM, load the badge for the same head — equal? Push a commit — does it silently revert to mock?
- **Pricing wall (Tomáš):** confirm no numeric price appears before sign-up and the only "contact" path is genuinely Enterprise-only; decide whether the live scan alone carries "proof."
- **Affordance 503s + tracker (Sam, Oliver):** confirm skill/PDF links resolve (PGlite on) rather than 503; import into a named org and confirm a rec moves open→done; the public-org 403 shows a sensible message.
- **Env flags (Nadia):** confirm the run env sets BOTH `ASCENT_AUTH_BYPASS=1` AND `ASCENT_OPEN_ORG_DASHBOARDS=1` (bypass alone → "No access" on every org tab).
- **Regression alert no-cry-wolf (Raj):** wire a test webhook, drive two seeded scans into a demotion, confirm exactly one alert + audit row, then re-scan with no further drop and confirm no re-page.
- **Latency (all):** confirm the live SSE scan reaches a defensible verdict within patience (env budgets tens of seconds to minutes; the 180s client timeout must not fire).
- **Grounding depth (Marcus, Sam):** scan a large team service / monorepo and judge whether the ≤32-file sample is representative or visibly shallow.
