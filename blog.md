# Building Ascent: a maturity index for AI-native engineering — on Aurora DSQL + Vercel

> *I created this content for the purposes of entering the AWS Databases × Vercel
> hackathon.* **#H0Hackathon**
>
> This is a living build journal — the actual mental journey from a blank folder to a
> shippable product. It doubles as the draft for the hackathon's bonus-point published
> content. AWS database used: **Amazon Aurora DSQL**. Front end + API: **Vercel**.

---

## Entry 0 — The brief and the bet (2026-05-29)

The hackathon's pitch is "ship fast on a database that scales to production." Most
people will reach for an e-commerce or social app. I wanted something that (a) is a
real, monetizable B2B product, (b) has an honest reason to use a serverless,
multi-region SQL database, and (c) rides the single biggest shift in how software is
built right now: **LLM-driven development**.

The bet: every engineering org is spending on AI coding tools, and **none of them can
objectively measure whether it's working.** Vendor dashboards measure their own tool's
usage. Nobody measures whether the *codebase and process* are actually engineered for an
AI-native workflow.

So: **Ascent — a capability-maturity model (think CMM) for the AI-native era.** Point it
at a GitHub repo; it scores how AI-native the org is (Level 1–5) across weighted
dimensions, with evidence, and hands back a prioritized roadmap to the next level.

**Track:** Monetizable B2B (Track 2), with a free public-repo scan as the top-of-funnel.

## Entry 1 — Decisions before code

I forced three decisions up front because they ripple through everything:

1. **Name:** *Ascent* — you climb a maturity ladder. Levels are rungs.
2. **LLM for the MVP:** Google **Gemini `gemini-3-flash-preview`** — cheap, fast,
   generous free tier; perfect for scanning *public* repos at funnel scale.
3. **Phase-2 database:** **Aurora DSQL.**

That third choice deserves justification, because the DB is the heart of this hackathon.
An adoption-scoring product is, at its core, an **audit + history + multi-tenant**
system: scans over time per repo, progress trends, recommendation tracking, audit logs,
org rollups. That is a *relational* problem — joins across orgs → repos → scans →
dimensions → evidence, and time-series queries for trends. Aurora DSQL gives me
PostgreSQL semantics for those queries **plus** serverless scale-to-zero and
active-active multi-region resilience. It's the literal embodiment of the hackathon
thesis: prototype this weekend, run it at enterprise scale unchanged.

## Entry 2 — A research detour that changed the architecture

The product promises enterprises **privacy** for private repos. So I asked: *can I run
the model inference inside AWS, the way Azure OpenAI lets you keep data in your Azure
tenant?* I researched it before committing to an architecture.

**Findings (May 2026):**
- **Amazon Bedrock is the AWS analog to Azure OpenAI.** It does **not** train on your
  data, doesn't share prompts/completions with model providers, encrypts with KMS,
  connects privately over PrivateLink/VPC, and is SOC/ISO/GDPR/HIPAA/FedRAMP-eligible.
  It hosts Claude, Amazon Nova, Llama, Mistral, and more.
- **But Gemini's proprietary models are NOT on Bedrock** — only Google's *open* Gemma
  models are. Proprietary Gemini lives on Google Vertex AI.

That's a genuine fork, and it's better to discover it on day one than week three. The
conclusion shaped the design:

- **MVP / public repos →** Gemini (public Google API). Fast and cheap; the repos are
  public anyway, so privacy isn't the concern.
- **Enterprise / private repos →** **Bedrock-hosted models** (e.g., Claude on Bedrock or
  Amazon Nova), so a customer's private source **never leaves the AWS boundary and is
  never used for training.**

So I'm building behind an `LLMProvider` interface from the first commit:
`GeminiProvider` (MVP), `BedrockProvider` (enterprise), `MockProvider` (keyless demo/CI).
Swapping is a config change, not a rewrite.

## Entry 3 — Designing the maturity model (the real IP)

A score nobody trusts is worthless, so the rubric is **published and evidence-based**.
Five levels — **Manual → Assisted → Augmented → Integrated → Autonomous (AI-Native)** —
where L5 is the brief's "perfection": a fully autonomous, reliable, established system
with comprehensive tests, docs, and CI/CD.

Seven weighted dimensions, scored 0–100:
AI Tooling & Conventions · Automated Testing · CI/CD & Automation · Agentic Workflows ·
Documentation & Knowledge · Code Quality & Guardrails · Commit & Velocity Signals.

The scoring is deliberately **hybrid**: deterministic detectors compute the signals
(does `CLAUDE.md` exist? how many test files? is there an AI review bot in CI? are there
`Co-Authored-By: Claude` commit trailers?), and the LLM adds nuance and writes the
human-readable rationale + roadmap — but its score is **guardbanded** to the signal
score so it can't hallucinate an extreme. Cheap, reproducible, and auditable.

> A fun moment: the scaffolder (`create-next-app`, Next.js 16) generated a `CLAUDE.md`
> and `AGENTS.md` in my own repo — which are *exactly* the AI-native signals Ascent
> detects. The tooling is already living in the world the product measures.

## Entry 4 — MVP shape: ship without a database (on purpose)

The MVP runs on **Vercel** with **zero database**: Next.js 16 route handlers read a repo
over the GitHub REST API (no clone — serverless-friendly), deterministic analyzers
extract signals, the scoring engine calls the LLM for synthesis, and the report renders
client-side. This lets me iterate on *scoring quality* — the thing that makes or breaks
the product — without DB friction. **Aurora DSQL comes in Phase 2** for history,
progress, audit, and multi-tenant enterprise data. Keeping the MVP DB-free also means a
slip in the DB work can never block a submittable demo.

*(running journal — entries below are appended as the build progresses)*

## Entry 5 — Building the engine

*(to be written as I implement ingestion, detectors, scoring, and UI)*

## Entry 6 — Wiring Aurora DSQL

*(Phase 2: schema, IAM auth from Vercel, history + trend queries, audit log)*

## Demo (video script outline)
1. **Problem (30s):** orgs can't measure AI-native maturity; budgets without evidence.
2. **Solution (30s):** paste a public repo → Ascent scores it L1–L5 with evidence.
3. **Live (90s):** scan a well-known repo; walk the radar, evidence, and roadmap; show
   the shareable badge.
4. **Under the hood (60s):** hybrid scoring; `LLMProvider` abstraction; **Aurora DSQL**
   for history/audit/multi-tenant; **Bedrock** for private-repo privacy.
5. **Business (30s):** Free → Pro → Team → Enterprise; badge-driven growth loop.

---
*Built for the AWS Databases × Vercel hackathon. AWS database: **Aurora DSQL**.
Front end: **Vercel**.* **#H0Hackathon**
