# Standards & regulation for the AI-automated SDLC — is the space taken?

_2026-07-28. Research note answering: does a standard/regulatory regime already exist for **using LLMs and
agents to build software**, such that we should scope features to comply with it — or is the space clear
enough to forge our own?_

---

## Verdict

**Two different layers get confused constantly, and the answer is opposite in each.**

| Layer | Question | Standards status |
|---|---|---|
| **L1 — AI as the product** | You ship an AI system. Is *it* governed? | **Saturated.** ISO/IEC 42001, 5338, 23894, 42005/42006, NIST AI RMF + GenAI Profile, NIST SP 800-218A, EU AI Act, CSA AICM (247 controls), OWASP Agentic Top 10 + AISVS. |
| **L2 — AI as the tool that builds your software** | Agents write, review and merge your code. Is *that process* governed? | **Essentially unstandardized — but already being audited.** No normative standard exists. Auditors are nonetheless asking the questions *now*, under SOC 2 / ISO 27001 change-management controls written before agents existed. |

So the field is neither clear nor occupied. It is the worst-and-best case: **controls are being demanded
without a standard to satisfy them.** That is the most valuable shape a market can have for a product that
produces evidence — the buyer has an obligation, no vendor has an answer, and no committee has yet frozen
the format.

**Recommendation: forge our own, but bind it to the auditor's existing question rather than inventing a
parallel universe.** A standard nobody is obliged to follow is a blog post; a schema that answers a
question a SOC 2 auditor is already asking is a purchase order.

---

## 1. What exists — and why most of it does NOT apply to us

Every one of these governs *AI systems you build or deploy*, not *AI used to build software*. Citing them
as our compliance frame would be a category error, and a sophisticated buyer will catch it.

- **ISO/IEC 5338:2023** — AI system life cycle processes, built on ISO/IEC/IEEE 12207/15288 with AI-specific
  additions from 22989/23053. It is about the lifecycle *of an AI system*. Not about agents in your SDLC.
- **NIST SP 800-218A** (Jul 2024) — an SSDF Community Profile for **generative AI and dual-use foundation
  model producers**, written under EO 14110. Despite the tempting title, its audience is model producers and
  acquirers, not teams using Copilot. Adds data-management, training-security and evaluation tasks to SSDF.
- **CSA AI Controls Matrix (AICM) v1.1** — 247 control objectives across 18 domains, mapped to ISO 42001 /
  27001 / BSI AIC4, feeding the **STAR for AI** certification pathway. Vendor-agnostic and genuinely good —
  but scoped to developing/operating AI technologies.
- **OWASP Top 10 for Agentic Applications (Dec 2025)** + **AISVS** + **State of Agentic AI Security &
  Governance (Jun 2026)** — risks of agents you deploy. Notably, **OWASP SAMM still has no agentic-AI
  practice stream**, which is itself evidence of the L2 gap.
- **EU AI Act** — largely *not* our regime. The Digital Omnibus (Parliament 16 Jun 2026, Council 29 Jun 2026)
  deferred Annex III high-risk obligations to **2 Dec 2027** and Annex I to **2 Aug 2028**. Article 50
  transparency lands **2 Aug 2026** but concerns AI *outputs presented to people*, not source code authored
  by an assistant. **Do not market ascent as AI-Act tooling.**

## 2. What actually bites an engineering org today

These are the live obligations a coding-agent fleet already falls under. This is the list to scope against.

1. **SOC 2 change management — the sharpest one.** Type II requires that *all code changes are reviewed and
   approved by authorized personnel prior to implementation*. The 2026 auditor position now circulating is
   explicit and it is devastatingly specific: sufficient evidence requires **a population of AI-generated
   code changes over the audit period, a sample drawn from that population, and evidence for each sampled
   item that the control operated.** "We do code review" is no longer an accepted control statement. Nobody
   can currently produce that population — that is exactly `aiGovernedRate` + PR review coverage + CODEOWNERS
   attribution over time.
2. **ISO/IEC 42001.** Scope covers organizations *providing **or using*** AI systems, across the full
   lifecycle, with a **Statement of Applicability** selecting from **38 Annex A controls in 9 areas**. An org
   whose engineers ship agent-written code has AI in scope whether or not it sells AI. Vanta shipped an ISO
   42001 module first (Mar 2024) and Drata followed — but reviewers consistently note **AI-specific evidence
   collection is materially less automated than SOC 2**, with several Annex A clauses still needing manual
   evidence. That admitted automation gap is the wedge.
3. **EU Cyber Resilience Act.** Notified-body notification began **11 Jun 2026**; exploited-vulnerability and
   severe-incident reporting starts **11 Sep 2026**; full enforcement **11 Dec 2027**; penalties up to €15M
   or 2.5% of global turnover. Mandates machine-readable SBOM, secure-by-design engineering, coordinated
   disclosure, and updates across the support period. It says nothing about AI authorship — but it forces a
   *machine-readable, attestable* view of what is in the product, which is the envelope an AI-BOM rides in.
4. **CISA + G7 "SBOM for AI: Minimum Elements"** (Jun 2026), **CycloneDX ML-BOM 1.7**, **SPDX 3.0 AI/Dataset
   profiles**. Real, citable envelopes — but they describe *models and datasets*, not *which of your source
   files an agent wrote*.

## 3. The vacuum, precisely located

Four things do not exist. Each is claimable.

1. **No repo-level conformance spec for the AI-assisted SDLC.** AGENTS.md (now Linux-Foundation-governed via
   the Agentic AI Foundation, 60k+ repos) standardizes *instructions to an agent*. It does not declare which
   gates, evals, MCP servers, owners, or oversight tiers a repo enforces. `.ai/manifest.yaml` already is that
   declaration — capabilities-not-tools, pointers-not-embeds, declared-then-proven. **There is no competing
   spec.**
2. **No standard for AI-authorship disclosure in code.** The only convention found — `AI_DISCLOSURE.md` with
   SPDX-style `SPDX-AI-Disclosure` / `SPDX-AI-Model` / `SPDX-AI-Provider` file tags and a four-value
   vocabulary (`none` / `ai-assisted` / `ai-generated` / `autonomous`, borrowed from W3C AI content
   disclosure) — is **v0.1 draft, 2 stars, 0 forks, one author, zero implementations**. The vocabulary is
   sensible and the namespace is unowned. This is a gift: adopt the vocabulary, implement it first, and the
   convention becomes ours by implementation rather than by committee.
3. **No normative model of graduated oversight.** The only serious treatment is an arXiv proposal —
   **GAIE (Governed AI-Assisted Engineering)** — defining risk-classified generation tasks, tiered human
   review from minimal to intensive, and per-tier evidence artifacts, explicitly mapped to ISO 42001 /
   NIST AI RMF / EU AI Act / SSDF. Its stated finding matches ours: *current standards lack guidance for
   agentic code generation workflows, particularly proportionate oversight when agents generate, review or
   modify code autonomously.* A paper, not a standard. The tier model is exactly what an **agent-admission
   policy** (T3-4) and the **ungoverned-change gate** (T1-2) implement.
4. **No evidence-production tooling.** GRC platforms hold the framework; security vendors (Cycode, Endor,
   Legit, Apiiro) prevent bad code; Sema quantifies AI-written share for diligence. **Nobody emits the
   population-plus-sample-plus-per-item-evidence artifact a SOC 2 Type II auditor now asks for.**

## 4. What this means for the trio

- **T1 (Governance Evidence Ledger) — anchor to SOC 2 CC8.1 first, ISO 42001 SoA second.** SOC 2 is the
  obligation nearly every buyer already carries; ISO 42001 is the aspirational one with the admitted
  automation gap. Frame the Conformance Pack as *the AI-change population, the sample, and per-item control
  evidence* — the auditor's own words. Drop AI-Act framing entirely.
- **T2 (`.ai/` standard) — the field is clear, and staying compatible is cheap.** Nothing occupies the repo-
  manifest slot. Add an `aiAuthorship` block reusing the `AI_DISCLOSURE.md` vocabulary and SPDX tag names, and
  a `controls.oversight` tier vocabulary borrowed from GAIE. Cost: a few optional fields the spec's
  must-ignore-unknown rule already accommodates. Benefit: when a committee eventually does standardize this,
  we are the prior art and the reference validator rather than the thing being replaced.
- **T3 (fleet / diligence) — CRA is the tailwind, not the AI Act.** Sep 2026 incident-reporting and Dec 2027
  full enforcement force machine-readable product composition; a fleet-wide, evidence-backed posture report
  becomes a diligence and procurement input on that clock.

## 5. Claims discipline (non-negotiable for an assurance product)

- Say **"evidence for"** a control, never **"compliance with"** a standard. We are not an auditor and
  certify nothing.
- Never claim EU AI Act conformity. State the deferral dates if asked.
- Every token-gated signal must be visibly capped on anonymous scans — enforcement rungs (`gated`) are
  unobservable without a token and must say so rather than degrade silently.
- Publish the method and the sampling caps alongside every number. In this market the differentiator is
  falsifiability; an over-claimed metric here is not a marketing sin, it is a product-killing defect.

---

## Sources

**Standards / frameworks**
[ISO/IEC 5338:2023](https://www.iso.org/standard/81118.html) ·
[NIST SP 800-218A](https://csrc.nist.gov/pubs/sp/800/218/a/final) ·
[NIST SSDF project](https://csrc.nist.gov/projects/ssdf) ·
[CSA AI Controls Matrix v1.1](https://cloudsecurityalliance.org/artifacts/ai-controls-matrix-v1-1) ·
[CSA STAR for AI](https://cloudsecurityalliance.org/star/ai) ·
[CSA AICM ↔ ISO 42001 (Schellman)](https://www.schellman.com/blog/iso-certifications/csa-aicm-meets-iso-42001) ·
[OWASP Top 10 for Agentic Applications (via Cycode)](https://cycode.com/blog/owasp-top-10-agentic-applications/) ·
[OWASP State of Agentic AI Security & Governance, Jun 2026](https://www.rockcybermusings.com/p/owasp-state-of-agentic-ai-security-2026)

**ISO 42001 scope & controls**
[Vanta: ISO 42001 controls](https://www.vanta.com/collection/iso-42001/iso-42001-controls) ·
[Annex A, 38 controls / 9 areas](https://www.hicomply.com/hub/annex-a-controls) ·
[Codacy: ISO 42001 for engineering leaders](https://blog.codacy.com/iso-42001-what-engineering-leaders-need-to-know-about-the-ai-management-system-standard)

**The live audit pressure (L2)**
[Does SOC 2 require code review for AI-generated code?](https://www.accelcomply.com/articles/code-review-control-never-tested-for-ai) ·
[The compliance attestation gap in AI-assisted development](https://tianpan.co/blog/2026-05-05-ai-generated-code-compliance-attestation-gap) ·
[What auditors actually ask about AI-generated code](https://anotherdimensioncreativegroup.com/blog/what-auditors-ask-ai-generated-code) ·
[SOC 2 Type II with AI code](https://anotherdimensioncreativegroup.com/blog/soc2-ai-code-compliance) ·
[Codacy: what auditors will ask in 2026](https://blog.codacy.com/what-auditors-will-ask-about-ai-generated-code-in-2026) ·
[Audit trails for AI-assisted development](https://bitloops.com/resources/governance/audit-trails-for-ai-assisted-development)

**Regulation**
[EU Cyber Resilience Act (EC)](https://digital-strategy.ec.europa.eu/en/policies/cyber-resilience-act) ·
[CRA legislative summary](https://digital-strategy.ec.europa.eu/en/policies/cra-summary) ·
[CRA timeline 2026–2027](https://scandog.io/blog/security-compliance/cyber-resilience-act-timeline) ·
[EU AI Act omnibus deferrals (Gibson Dunn)](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/)

**The vacuum**
[GAIE — Governed AI-Assisted Engineering (arXiv 2606.22484)](https://arxiv.org/pdf/2606.22484) ·
[ai-disclosure convention (v0.1 draft)](https://github.com/ggfevans/ai-disclosure) ·
[SPDX overview](https://spdx.dev/learn/overview/) ·
[SPDX AI Working Group publications](https://spdxai.github.io/publications/)
