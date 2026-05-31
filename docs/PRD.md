# Ascent — Product Requirements (PRD)

## 1. Vision

> **A capability-maturity model for the AI-native era.**

CMM/CMMI told the world how mature its *software processes* were. Ascent does the same
for the *single biggest shift in software since the cloud*: the move to LLM-driven
development. Ascent looks at how an engineering organization actually builds software
and answers one question with evidence: **how AI-native are you, and what's the next
rung up the ladder?**

## 2. The Problem

In 2024–2026, engineering orgs adopted AI coding tools at breakneck speed (Copilot,
Claude Code, Cursor, agentic CI bots). But adoption is **assumed, not measured**:

- **Leadership** approved budgets for AI tooling and now wants ROI and adoption
  visibility. "We bought 400 Copilot seats — did anything change in how we ship?"
- **Engineering leaders / platform teams** want a roadmap: where are we weak, what
  should we invest in next (tests? CI gates? agent workflows? docs for agents?).
- **Consultancies / DevEx vendors** need an objective, repeatable assessment to sell
  and benchmark transformation engagements.

There is **no standard, objective, evidence-based way** to measure this today. Vendor
dashboards measure *their own tool's* usage; they can't tell you whether your codebase
and process are genuinely engineered for an AI-native workflow.

## 3. The Insight

A repository is a high-fidelity fingerprint of how a team works. You can *read AI-native
maturity directly off the repo*:

- Is there machine-readable guidance for agents (`CLAUDE.md`, `AGENTS.md`,
  `.cursorrules`, `copilot-instructions.md`, MCP configs)?
- Are there strong **guardrails** (tests, types, linters, pre-commit, CI gates) — the
  scaffolding that makes AI-generated code *safe* to merge?
- Are agents actually **in the loop** (AI review bots, auto-fix, LLM steps in CI,
  auto-PRs, `Co-Authored-By` AI trailers)?
- Is the system **reliable and documented** enough to let autonomy compound
  (observability, docs, ADRs, CI/CD)?

Ascent turns this fingerprint into a score, a level, and a roadmap.

## 4. Target Users & Personas

| Persona | Goal | Ascent value |
|---|---|---|
| **VP Eng / CTO** | Justify AI spend, set transformation strategy | Org-level maturity score + trend + benchmark |
| **Platform / DevEx lead** | Prioritize internal-tooling investments | Per-dimension gaps + prioritized roadmap |
| **Eng manager** | Level up a specific team/repo | Repo report card + concrete next steps |
| **Individual dev / OSS maintainer** | Curiosity, signaling, bragging rights | Free scan + shareable "AI-Native Level N" badge |
| **DevEx consultancy** | Sell & benchmark transformation work | Repeatable assessment, history, client rollups |

## 5. Value Proposition

- **Objective & evidence-based** — every score cites the files/signals behind it. No
  black box; defensible in an exec review.
- **Actionable** — not just a number, but a prioritized, effort-estimated roadmap of
  "do this next to reach Level N+1."
- **Benchmarked** — see where you stand vs. a maturity rubric (and, in Phase 2, vs.
  anonymized peers).
- **Trackable** — re-scan over time; watch the trend; prove the transformation worked.

## 6. Core Use Cases

1. **One-time public scan (B2C / funnel):** paste a public GitHub URL → full report in
   under a minute → share a badge. Zero signup.
2. **Pro repo audit:** authenticate, scan private repos, export PDF, keep history.
3. **Enterprise org assessment (B2B):** install the GitHub App, scan all org repos,
   roll up to an org score, track progress quarterly, export audit-ready reports — all
   with code processed under enterprise privacy controls.

## 7. Monetization — usage-based

Pricing follows cost, not seats: public scans are free (a growth funnel), private scans
are **metered per scan** to cover model-inference + service cost, and enterprise is a
bespoke, on-demand implementation.

| Tier | Price | Who | Includes |
|---|---|---|---|
| **Public** | **Free** | Anyone, on the web | Unlimited public-repo scans, full report (radar + roadmap), shareable badge. No signup. |
| **Private** | **Usage-based** (pay per scan) | Teams scanning private repos | Private repos via token / GitHub App, scan history + progress trends, recommendation tracking, PDF export. You pay only for what you scan — no subscription. |
| **Enterprise** | **Custom** (on demand) | Regulated / large orgs | Bedrock private inference, SSO/SAML + RBAC, audit logs, data residency/VPC, org rollups, dedicated support — implemented to requirements. |

**Why usage-based:** the dominant variable cost is LLM inference per scan, so metering
per private scan keeps margins predictable and lets customers start with zero commitment.
Exact per-scan rate is TBD (a function of model + repo size); the model is the decision,
the number is a later calibration.

**Growth loop:** the free **maturity badge** (an SVG embedded in READMEs — "Ascent:
AI-Native Level 3") drives organic discovery; each badge links back to a fresh scan,
funneling public users toward private/enterprise.

**Why this is monetizable B2B (Track 2):** the buyer is an engineering org; the value
(transformation roadmap, audit, benchmarking, privacy) is squarely enterprise, and the
usage-based private tier converts the free funnel without a subscription barrier.

## 8. Scope

### MVP (this hackathon, Phase 1 — no database)
- Public-repo scan via GitHub REST API (no clone).
- Deterministic signal extraction + LLM synthesis → scored report.
- Report UI: overall level, dimension radar, evidence, prioritized roadmap.
- Shareable SVG badge.
- "Mock mode" so the app is fully demoable without any API key.

### Phase 2 (still within the 1-month window if time allows — DB + enterprise)
- **Aurora DSQL** persistence: scans, dimensions, findings, recommendations, audit log.
- Auth + org/tenant model; scan **history & progress trends**.
- **GitHub App** for private/org repos.
- **AWS Bedrock** provider for privacy-preserving enterprise inference.
- Billing (Stripe), org rollups, benchmarking.

### Explicit non-goals (for now)
- Deep static analysis / AST-level code review (we read structure + sampled content).
- Running the target repo's tests or coverage tools (we infer from configuration).
- Replacing SAST/DAST security tooling.

## 9. Success Metrics
- **Activation:** % of visitors who complete a scan.
- **Quality:** human agreement with assigned level on a labeled benchmark set (target
  ≥ 80%).
- **Virality:** badges embedded → referral scans.
- **B2B:** demo-to-pilot conversion; repos under management; re-scan retention.

## 10. Risks & Mitigations
- **Scoring credibility** → hybrid (deterministic signals + LLM), always show evidence,
  publish the rubric. → see [MATURITY_MODEL.md](./MATURITY_MODEL.md).
- **GitHub rate limits** → optional token, file sampling/budget, cache.
- **LLM cost/latency** → cheap fast model (Gemini Flash) for MVP; cache; sample files.
- **Enterprise data privacy** → Bedrock in-account inference, no training on data, VPC,
  audit. → see [ARCHITECTURE.md](./ARCHITECTURE.md).
