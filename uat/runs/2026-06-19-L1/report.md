# L1 sweep scorecard — 2026-06-19

**Level:** L1 (code-grounded thought experiment, no browser) · **Characters:** 10 · **Journeys:** 10
**Verdicts:** 1 × L1-pass · 9 × L1-conditional · 0 × L1-fail · **0 blockers** · ~17 confirmed majors

The machine is genuinely good — evidence-cited, reconciling, fail-closed. But on the default keyless/mock path that 9 of 10 Characters land on, the credible LLM output the product *sells* is not exercised: every conditional verdict reduces to "show me the live `claude-cli` run." Nadia (AppSec) is the lone clean pass — the one journey whose value (the D9↔Dependabot firewall) is fully provable from code alone.

---

## Per-journey verdict table

| Character | Journey | Cert level | #major / #minor |
|---|---|---|---|
| Dana — VP Engineering | prove-and-track-fleet-maturity | **L1-conditional** | 1 / 3 |
| Marcus — Engineering Manager | understand-my-team | **L1-conditional** | 2 / 2 |
| Priya — Platform/DevEx Lead | set-and-enforce-the-standard | **L1-conditional** | 2 / 2 |
| Sam — Staff Engineer | scan-my-repo-get-a-roadmap | **L1-conditional** | 3 / 2 |
| Tomáš — Prospective Buyer | evaluate-whether-to-adopt | **L1-conditional** | 1 / 4 |
| Elena — CTO / Founder | are-we-keeping-up | **L1-conditional** | 1 / 1 |
| Raj — DevOps / SRE Lead | delivery-and-governance-health | **L1-conditional** | 2 / 1 |
| Nadia — AppSec Lead | supply-chain-and-governance-posture | **L1-pass** | 0 / 2 |
| Oliver — QA / Test Lead | drive-testing-maturity | **L1-conditional** | 3 / 1 |
| Mei — OSS Maintainer | badge-my-oss-repo | **L1-conditional** | 2 / 2 |
| **Totals** | | **1 pass / 9 conditional** | **17 / 18** |

---

## Confirmed MAJOR findings

Grouped by root cause. `file:line` is the sharpest single anchor; full unioned evidence is in `findings.json`.

### A. The keyless/mock default undermines the credibility the product sells (the dominant theme — 5 Characters)

1. **Mock path emits zero LLM-vs-detector discrepancies — the self-audit surface never appears.** · Sam · trust · `src/lib/llm/mock.ts:86` (+ `ReportView.tsx:245`) · *Acceptance:* on the live provider ≥1 honest discrepancy surfaces on a repo the detector demonstrably misses; keyless mode labels the discrepancy audit as LLM-only.
2. **Public/keyless roadmap is catalog-templated — names the gap, not a repo-specific highest-leverage move.** · Sam (Priya, Dana, Oliver echo on their surfaces) · senior-quality · `src/lib/scoring/recommendations.ts:20-120,149-160` · *Acceptance:* on a known repo the top roadmap item references a concrete file/config/count from that repo's evidence, not a dimension restatement.
3. **The merge-blocking PR gate verdict runs the mock/deterministic path by default — a signal threshold, not the AI judgement advertised.** · Raj · trust · `src/app/api/app/webhook/route.ts:216` / `src/app/api/gate/[owner]/[repo]/route.ts:24` / `action.yml:48` (mock.ts:39 → engine.ts:96-102 resolves score = signalScore) · *Acceptance:* the merge-blocking verdict in its recommended config reflects the same scoring path the dashboard shows, OR the mock-vs-live distinction is surfaced on the Check Run.
4. **The README badge renders a deterministic MOCK level by default — can disagree with the credible LLM report.** · Mei · trust · `src/app/api/badge/[owner]/[repo]/route.ts:286-303` · *Acceptance:* the badge resolves to the most recent LLM report (with a freshness note) rather than minting a divergent mock level, OR "scan first" becomes a required step, not a footnote.
5. **D2 is clamped to ±25 of a presence-based signal — and on the keyless scan it IS the signal, zero quality nuance.** · Oliver · trust · `src/lib/scoring/engine.ts:99-102` (+ mock.ts:39, source.ts:606-614 ≤4 test files) · *Acceptance:* on the live provider the LLM can read sampled test bodies and pull an inflated D2 toward reality and flag the discrepancy; keyless D2 carries a "detector-only" caveat.

*(Tomáš's #1 gap and Sam-04/Tomáš-05's anonymous-governance blindness sit adjacent to this cluster — the buyer literally "can't tell mock from real" from code.)*

### B. Scoring measures presence/quantity, not quality (Oliver's crux)

6. **D2 (and D8) measure test PRESENCE and QUANTITY, never QUALITY — a 200-snapshot assertion-free suite scores ~80/100.** · Oliver · senior-quality · `src/lib/analyze/index.ts:193-243` (count buckets :204, coverage = config-string presence :219-220, ratio of file counts :222-226, advanced rigor presence-only :230-240) · *Acceptance:* D2 incorporates a directional assertion-quality signal (assertion density from fetched test bodies, or a parsed mutation score) so a high-count assertion-free suite cannot reach the same band as a behaviorally-tested one.

### C. Surveillance-line / individual-attribution framing (Marcus)

7. **Contributors "Involvement" table is a full per-named-engineer commit/AI-commit scoreboard with CSV export — the surveillance read despite the "not a scoreboard" caption.** · Marcus · trust · `src/app/org/[slug]/contributors/page.tsx:101-149` · *Acceptance:* any per-named-individual output is framed/ordered so it cannot be read as a performance ranking; raw per-person commit counts are not the primary sort key, or the view is opt-in.
8. **Small-population champion guard is inconsistent: Adoption's "AI champions" card and Teams' per-team champion chips have NO contributor-count suppression** (Contributors got it right). · Marcus · trust · `src/app/org/[slug]/adoption/page.tsx:71-89` + `src/app/org/[slug]/teams/page.tsx:70-78` · *Acceptance:* champion/culture-carrier UI on Adoption and Teams applies the same population threshold as Contributors before naming an individual.

### D. Policy-drift / one-source-of-truth seam (Priya, Raj)

9. **The Security (D9) floor enforced on the dashboard + App check is silently dropped from the copyable CI snippet / `action.yml`.** · Priya (Raj corroborates the gate-drift class) · trust · `src/lib/org/governance.ts:81-97` + `action.yml:20-51` + `src/lib/scoring/gate.ts:237-244` · *Acceptance:* when minDimensionFor.D9 is set, ciWith() emits a security/min-security line AND action.yml forwards it, so all three surfaces enforce the identical D9 floor.
10. **Governance read is token-gated and additive-only — no token → blank/under-read; missing guardrails can never demote a repo's score, so an ungoverned repo can pass the gate on score alone.** · Raj · trust · `src/lib/analyze/pulls.ts:236-240` + `src/lib/db/org-signals.ts:113` + `delivery/page.tsx:64-74` · *Acceptance:* a genuinely unprotected repo cannot clear the gate purely on score; the additive-only blend is documented or the gate floors on protection.

### E. Discoverability of the core artifacts (Mei, Priya)

11. **The `/badge` generator is undiscoverable — no link from header, footer, or report.** · Mei · missing · `src/app/badge/page.tsx:9` (no referrer in ReportHeader.tsx:56-71, Brand.tsx:48-145) · *Acceptance:* a "Get README badge" link on the report header (and/or footer) deep-links to /badge with the repo prefilled.
12. **The `.ai/` standard + onboarding SKILL.md generator is undiscoverable from her entry points (lives only on the per-repo report header).** · Priya · missing · `src/components/report/ReportHeader.tsx:65-71` (absent from practices/page.tsx, plan, governance, OrgNav.tsx:32-41) · *Acceptance:* a "Generate the `.ai/` standard / onboarding skill" affordance on /practices (per-repo or fleet-level), not only the report header.

### F. "Dashboard, not a decision" (Dana)

13. **The "one move" is a ranked exploration list, not a decision — and the executive Briefing outsources the recommended actions to an external LLM ("Copy briefing for LLM").** · Dana · senior-quality · `src/components/org/OrgLeverageMoves.tsx:13-15` + `src/lib/org/briefing.ts:259-262` + `src/app/org/[slug]/executive/page.tsx:65` · *Acceptance:* the overview/Briefing surfaces a single named #1 move with its projected fleet-maturity gain and the specific dimension/repos it lifts, on-screen, without a copy-to-LLM round trip.

### G. In-product privacy disclosure (Elena)

14. **Bedrock no-training / in-boundary guarantee is invisible at the point of the private-scan decision — buried in README/docs; default routing isn't even Bedrock.** · Elena · trust · `src/app/connect/page.tsx:46-51` + `src/lib/llm/config.ts:5-8,106-108` + `README.md:151-152` · *Acceptance:* on /connect (and onboarding App path), before a private scan, the product states which provider processes the code and that the Bedrock path is in-boundary / no-training / not-shared-with-providers — in rendered UI, not only docs.

### H. Pricing legibility (Tomáš)

15. **No numeric pricing on any public surface — private-scan rate is "Prepaid credits / final rate TBD", Enterprise is "Custom / Contact us".** · Tomáš · trust · `src/components/landing/prototypes/shared/content.ts:43-70` + `src/app/pricing/page.tsx:3-4,44-64` + `src/lib/plans.ts:4-5` · *Acceptance:* at least one real number on a public surface (e.g. "$X per private scan credit" / "Pro from $Y/mo") so the freemium ladder isn't "Free → talk to us".

### I. Broken-flow on the keyless path (Sam)

16. **"Onboarding skill" and "Export PDF" links render on every public report but 503 without a DB.** · Sam · completion · `src/components/report/ReportHeader.tsx:58-71` + `src/app/api/report/skill/route.ts:27` · *Acceptance:* the skill/PDF affordance is hidden (or shows an inline "needs history" hint) when no persisted report exists, never a raw 503.

*(17th major: counting Sam-02 catalog-roadmap and Priya/Dana/Oliver's roadmap echoes as one shared root cause B/A.2; the per-report total of confirmed severity:"major" objects across the 10 files is 17.)*

---

## Confirmed MINOR findings

- **Drill is fleet → repo, not fleet → team** — Dana re-aggregates teams mentally. · Dana · trust · OrgNav.tsx:20-31, org-insights.ts:147-154 *(uncertain — Teams tab may reconcile; L2)*.
- **Recommendation prose is a deterministic catalog under the fallback path** — risk of generic "add tests/CI" on a mock-seeded fleet. · Dana, Priya · trust · recommendations.ts:20-160.
- **Corpus benchmark/percentile is null below 5 repos** — small seeded org shows "—" for "vs peers". · Dana · trust · org-insights.ts:510-521.
- **Single-repo grounding samples ≤32 files / 180 KB** — thin for a large monorepo/backend. · Marcus (Sam, Priya, Elena echo) · trust · github/source.ts:34-41.
- **On the default mock path the gate uses, remediation PROSE is a generic per-dimension template** — only the score is repo-specific. · Priya · senior-quality · recommendations.ts:20-120,156.
- **Generated manifest ships boundary fields (neverTouch/secretsFrom/agents/blank-purpose) as TODOs.** · Priya · senior-quality · standard/manifest.ts:60-64 *(uncertain — meant to be run; L2)*.
- **Anonymous public scan has no PR/branch-protection evidence — D3/D6/D7/D8 are file/commit-only** (honestly warned). · Sam, Tomáš · trust · scan.ts:136-141,156-161,316-320.
- **Engine guardband can cap an LLM correctly contradicting a wrong detector.** · Sam · trust · engine.ts:99-102 *(uncertain; L2)*.
- **No quantified third-party proof — marketing is self-claim narrative; ROI examples are hypotheticals.** · Tomáš · trust · about/features.ts:16-65.
- **"Pricing" nav points to the on-page anchor, not the dedicated `/pricing` page** (effectively undiscoverable). · Tomáš · clarity · Brand.tsx:55,127.
- **`/about` leads with org-installation CTAs, not the free public scan.** · Tomáš · effort · about/AboutHero.tsx:50-63.
- **Whole-org read via `/onboarding` is a disclosed MOCK preview on the public-handle path** — not live scores. · Elena · trust · importScan.ts:67-70.
- **Regression alerts + weekly digest have no in-app surface — only an audit row + webhook POST.** · Raj · trust · scan-alerts.ts:74, cron/rescan/route.ts:138.
- **"Requires review" rate counts requires-a-PR, not requires-an-approval** (CC8.1 gradation). · Nadia · trust · org-signals.ts:136, github/governance.ts:64,77.
- **Supply-chain card hides entirely when `SUPPLY_CHAIN_PROVIDER=off`** — no "scanning not enabled" affordance. · Nadia · clarity · security/page.tsx:120.
- **Org tabs + audit export need `ASCENT_OPEN_ORG_DASHBOARDS` in addition to `ASCENT_AUTH_BYPASS`** — bypass alone → "No access" empty state. · Nadia · completion · authz.ts:62,68,105.
- **Deterministic D2 roadmap item is generic** ("few tests vouch for behavior") — no mutation/assertion/flaky-quarantine/contract-test move. · Oliver · senior-quality · recommendations.ts:32-41.
- **Recommendation status changes 403 for public-org scans** — Oliver's default public scan can't move a rec open→done. · Oliver · completion · api/recommendations/[id]/route.ts:44-49.
- **Per-dimension evidence is descriptive text, not clickable file links.** · Mei · trust · DimensionCard.tsx:75-87.
- **The PR gate Action requires a self-hosted Ascent deployment (`ascent-url`)** — a solo maintainer has nowhere to point it. · Mei · missing · action.yml:20-27.

---

## Appendix — refuted / uncertain findings

No findings were **refuted** at L1 — every emitted finding held against its file:line. The adversarial method instead produced a set of **uncertain** findings that are real-but-unprovable-without-the-live-app, carried forward rather than dismissed:

- **Dana-002** (fleet→team drill) — `uncertain`: the Teams/segments view may reconcile per-team; the spine being repo-keyed is the visible part. L2 to confirm.
- **Priya-04** (manifest TODOs) — `uncertain`: honest by-design (the skill is meant to be *run* so an agent fills the TODOs); L2 must judge the generated artifact, not the post-run result.
- **Sam-05** (guardband caps a correct LLM) — `uncertain`: defensible anti-hallucination design; only matters live on a repo whose detector demonstrably mis-reads.
- **Marcus-07** (≤32-file grounding depth) — `uncertain`: fine for small repos, thin for a large service; L2 to judge representativeness on a real monorepo.
- **Nadia-SC-03** (no structured posture CSV export) — `uncertain`: PDF + audit-CSV likely cover the attestation need; explicitly scoped as nice-to-have.

---

## What passed / strengths to protect (deduped)

These are the things that are RIGHT and must not regress. Confirmed in code across the panel.

1. **The score reconciles and is glass-box.** Every dimension exposes signalScore / llmScore / blended with a visualized **±25 guardband**; the LLM can nuance but cannot contradict the deterministic signal; the ScoreWaterfall decomposes the headline into per-dimension weighted contributions that **sum to the overall**; loud warnings fire on partial LLM coverage / total detector failure. — *Sam-S1, Dana-S2, Marcus-06, Elena-STR-01, Oliver-PROVENANCE, Mei-S2.* engine.ts:96-156,396-419, DimensionCard.tsx:117-159.
2. **Detectors grade substance, not file presence.** D1 grades guidance *content*; D9 distinguishes present vs. CI-wired; the `.ai/` standard is scored by evidence-of-use (Goodhart guard). — *Sam-S2.* analyze/index.ts:97-153.
3. **D8 rewards a real AI eval/harness, not mere AI usage** — "is AI used" is a separate, *unscored* indicator. — *Oliver-D8.* analyze/index.ts:507-512,665-678.
4. **Nadia's firewall: the Dependabot advisory count is architecturally separate from D9** (consumed only by the Security tab + brief, never by the scoring engine) and labelled "Demo data" under mock. The single most defensible piece in the whole sweep. — *Nadia-SC-01.* security/supply-chain.ts:112,145, analyze/index.ts:552.
5. **The gate is deterministic, fail-closed, evidence-cited, archetype-aware — and the dashboard + App check run the IDENTICAL policy** (the old stochastic-flip bug is explicitly fixed; a hard error posts a neutral check, never a silently-absent required check). — *Raj-S2, Priya-S1, Oliver-GATE.* gate.ts:45-68,112-223, governance.ts:104-118.
6. **The regression alert is engineered against fatigue:** delta-only, per-tenant routing (no cross-org leak), audit trail even with no sink, exactly-once credit alerts, never throws into the scan path. — *Raj-S1.* alerts.ts:46, scan-alerts.test.ts:101-313.
7. **Trajectory/ETA shows its basis** — real OLS slope, R² as "trend confidence", latest-value anchor, 365-day sanity cap. — *Dana-S1.* forecast.ts:82-182.
8. **Adoption is honestly separated from rigor**, and onboarding can't fake fleet movement (cohort-matched period deltas). — *Dana-S3, Elena-STR-03, Marcus-05.* engine.ts:168-182, org-rollup.ts:130-145.
9. **The path-to-green is earned, not mandated** — closest-to-green worklist + per-gap deep-linked practice + one-click/batch starter PRs, roadmap phrased as invitational "explore" prompts. — *Priya-S2.* governance.ts:133-159, gate-comment.ts:112-121.
10. **The `.ai/` doctor PROVES claims** — runs capability commands, checks each pre-push control is wired into the *real* hook, FAILs on unwired controls; guardrails forbid fabricating commands/architecture. Control placement is correct-by-construction (pre-push primary, CI thin backstop). — *Priya-S3.* standard/doctor.ts:80-107, skill.ts:272-281.
11. **Governance reads ENFORCEMENT (active rulesets), not mere existence**, and names each failing repo's exact missed condition; CODEOWNERS used for attribution, not paraded as a required-review control. — *Nadia-STR-01.* github/governance.ts:47-84.
12. **The audit CSV export is binder-grade** — filtered, full-trail cursor-loop, attributable, timestamped, formula-injection-hardened. — *Nadia-STR-02.* api/audit/route.ts:24-72.
13. **The no-signup / no-paywall public front door is genuinely honored in code** — the login wall never touches the public path; the weekly quota is a soft, fail-open nudge that salvages the last report. — *Mei-S1, Tomáš-S1, Elena-STR-02.* api/scan/route.ts:50, public-scan-quota.ts:163-217.
14. **Honest accounting on the mock path** — mock is badged "Demo · deterministic rubric", a degraded scan is not persisted as canonical, SSE streams real per-stage progress. — *Sam-S3.* ReportHeader.tsx:40-46, scan.ts:326-334.
15. **The badge generator emits clean paste-ready Markdown/HTML/AsciiDoc in level + gate modes, with CVD-safe glyphs and a click-through to evidence.** — *Mei-S3.* BadgeGenerator.tsx:45-69, badge/route.ts:319-356.
