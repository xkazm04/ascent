# Ascent: The AI-Native Maturity Model

This is the core IP of the product: a defined, evidence-based rubric for scoring how
AI-native an engineering organization is. It is intentionally **transparent**: we
publish the rubric so scores are defensible.

## 1. The Maturity Ladder (5 Levels)

The overall score (0–100) maps to one of five named levels. "Ascent" = climbing the
ladder.

| Level | Name | Score band | Definition |
|---|---|---|---|
| **L1** | **Manual** | 0–24 | AI used ad hoc by individuals, if at all. No machine-readable guidance, weak guardrails. AI output is risky to merge because little verifies it. |
| **L2** | **Assisted** | 25–44 | AI tools adopted by many devs. Basic guardrails exist (some tests, a linter, CI runs). No shared AI conventions; benefits are individual, not systemic. |
| **L3** | **Augmented** | 45–64 | AI is part of the team's standard workflow. Shared agent guidance exists (`CLAUDE.md`/`AGENTS.md`/rules). Solid guardrails: real test suite, CI gates, types/lint enforced. AI-generated code is safe to merge. |
| **L4** | **Integrated** | 65–84 | Agents are *in the loop*, not just at the keyboard: AI code review, AI steps in CI, auto-fix/auto-PR, dependency automation. Strong docs (incl. docs written for agents), observability, and reliable CI/CD make autonomy compound. |
| **L5** | **Autonomous (AI-Native)** | 85–100 | A fully autonomous, reliable, established system. Agents propose, test, document, and ship changes with humans supervising at the policy level. Comprehensive automated tests, docs, and CI/CD; high reliability; governance and guardrails are first-class. |

> **L5 = "perfection"** per the product brief: *fully autonomous, reliable, established
> system with automated tests, docs, and CI/CD pipelines.*

## 2. The 9 Scoring Dimensions

Each dimension is scored **0–100** and contributes to the overall score by weight. A
dimension's score is a blend of **deterministic signals** (objectively detected from the
repo) and an **LLM qualitative assessment** (reasoning over sampled content + signals).

| # | Dimension | Axis | Weight (org) | What it measures |
|---|---|---|---|---|
| D1 | **AI Tooling & Conventions** | Adoption | 15% | Is AI development *operationalized* with shared, machine-readable guidance, and is that guidance *deep* (commands, architecture, test-after-change, MCP/hooks/subagents) vs. a token stub? |
| D2 | **Automated Testing** | Rigor | 15% | The guardrail that makes AI-generated code safe: breadth and depth of tests, incl. advanced rigor (mutation, contract, perf, a11y, schema). |
| D3 | **CI/CD & Delivery** | Rigor | 14% | Automated pipelines + merge gates, release automation, and a declarative, reversible path to production (IaC, policy-as-code, GitOps, progressive delivery, DB migrations). |
| D4 | **Agentic Workflows** | Adoption | 12% | Are agents *in the loop* (review bots, LLM steps in CI, auto-fix/PR, dep automation)? |
| D5 | **Documentation & Knowledge** | Rigor | 9% | Docs for humans *and* agents: README, /docs, ADRs, changelogs, API docs. |
| D6 | **Code Quality & Guardrails** | Rigor | 7% | Linters, formatters, type checking, pre-commit, code owners, commit conventions. |
| D7 | **Commit & Velocity Signals** | Adoption | 7% | Commit hygiene + evidence of AI in the workflow (conventional commits, cadence, AI co-author trailers). |
| D8 | **AI Process & Harness** | Rigor | 12% | Is AI used *properly* in development: evals/golden tests for AI output, prompt/agent library, agent runbooks/ADRs, a structured contribution process (issue + PR templates / DoD)? |
| D9 | **Supply Chain & Security** | Rigor | 9% | Shift-left security as code: SAST/SCA/secret/container scanning, SBOM, signing/provenance (SLSA), security policy & threat modeling. The guardrail against vulnerable or secret-leaking AI output. |

Weights are **configuration** (`src/lib/maturity/model.ts`); the table shows the default
**org** lens; the **archetype lens** re-weights per repo (see §2b). Weights sum to 100%.

### §2b: Archetype lens & two-axis posture (v2)

The model is **population-aware**. Each repo is classified **solo / team / org** (from
CODEOWNERS, CI workflows, stars) and a matching weight preset is applied, so single-author
work isn't dragged down for lacking org-scale CI/review-bots it doesn't need.

Dimensions roll up into **two axes**, **AI Adoption** (D1, D4, D7) and **Engineering
Rigor** (D2, D3, D5, D6, D8, D9), yielding a 2×2 **posture**: *AI-Native* (high/high),
*Fast & Ungoverned* (high adoption / low rigor), *Solid but Manual* (low/high), *Getting
Started* (low/low). The L1–L5 level is the lens-weighted overall; posture carries the
nuance. An **LLM auditor** also flags suspected detector misses (`discrepancies`). Canonical
logic lives in `src/lib/maturity/model.ts` + `src/lib/scoring/engine.ts`.

**Posture cut vs. level bands (deliberate):** each axis is "high" at
`POSTURE_THRESHOLD = 50`, which is **stricter than the L3 band floor (45)**. A repo scoring
45–49 on both axes therefore reads *Augmented* (L3) **and** *Getting Started*, that's by
design, not drift: the level is a weighted average that partial strength can carry into L3,
while the posture quadrant is a claim about each axis independently, and we'd rather
under-claim a quadrant than assert "AI-Native" off a sub-half axis. Treat the 45–55 corridor
as borderline: a ±1-point re-scan can flip the quadrant there.

**Transition hysteresis (2026-07-28).** The *classification* still has no hysteresis: `postureFor`
stays a pure function of the two axis scores, so no repo re-labels and no call site needs prior state.
What is damped is the *announcement*: `postureTransition` (`src/lib/maturity/noise.ts`) reports a
quadrant change as news only once an axis is clear of the corridor (**enter at ≥52, leave at <48**),
and the ungoverned-slide alert is gated on it. Asymmetric on purpose, so a repo that genuinely climbs
is announced once and does not un-announce itself on the next scan's wobble.

**Scoring-integrity record.** Every report carries `scoreIntegrity` (`ScanReport`), recording the
structural step-changes that can move a headline on an *unchanged* commit: `d9Unmeasurable` (the D9
visibility escape hatch fired, renormalizing a 9%-weight dimension out), `widenedDims` (dimensions
whose LLM guardband doubled because the model flagged the detector as suspect), `widenCapped` (the
discrepancy budget below was blown, so *nothing* widened), and `effectiveBlend` (the *realized*
`SCORE_BLEND × coverage`, not the configured constant). Both hatch and widening are triggered by LLM
prose, so anything anchoring a number must be able to attribute a move rather than report it as
repository change.

**Untrusted repo content + the discrepancy budget.** Repo file excerpts, file paths and commit
messages are authored by the repository being scored, and the score gates PR merges, so they are
quoted inside a named `<untrusted_repo_data>` block whose contents the SYSTEM role explicitly denies
any authority (data to evaluate, never instructions; forged boundary markers and triple-backtick runs
are stripped before interpolation; an attempted instruction is reported as a *risk*, never as a
discrepancy). That matters because a `discrepancies` entry **doubles** its dimension's guardband:
without a boundary, a repository could author the text that widens the latitude over its own score.
The second half is a **budget** (`src/lib/scoring/discrepancy-policy.ts`): at most
`MAX_FLAGGED_DIMENSIONS = 2` dimensions may be widened on a scan, and flagging *more* widens **none**
of them and suppresses the D9 hatch: a self-audit that suspects most detectors is treated as
unreliable, not as licence to move further from the evidence. The prompt states the same budget, so
an honest model spends it on its clearest findings.

**Standing decisions are neutralized too.** The per-repo user message can carry the org's standing
decisions (the Shared Org Memory read side), and those notes are written by org members *and by their
agents*: an agent that read a poisoned README and stored what it "learned" is the ordinary way an
injection reaches that store, with no human in the loop by design. The block renders **above** the
untrusted boundary, in the authoritative region of the message, so it inherits none of the "no
authority" denial the file and commit text below it gets. Every field (`module`, `status`, `title`,
`rationale`) therefore goes through the same `neutralize()` the repo-authored text does, *before*
truncation so the marker→placeholder expansion can't push a rationale back over its character cap.

**Incomplete scans are not verdicts.** When every detector fails, `dimensions` is empty and the
renormalized roll-up floors at 0 / L1, numerically indistinguishable from a genuinely manual repo.
The report carries `incomplete: true` alongside the prose warning, because the numeric consumers
(public badge, CI gate, fleet rollup) read scores, not `warnings`. `evaluateGate` fails closed on it
with a single `incomplete` failure rather than certifying (or condemning) a repository on an
ingestion failure (see gate.md).

### Dimension detail

#### D1: AI Tooling & Conventions (15%)
*Signals (deterministic):* presence of `CLAUDE.md`, `AGENTS.md`, `.cursorrules` /
`.cursor/rules`, `.github/copilot-instructions.md`, `.aider.conf.yml`, MCP config
(`mcp.json`, `.mcp.json`), `.claude/` directory, prompt libraries, devcontainer with AI
tooling, Continue/Cline/Windsurf configs.
*LLM assessment:* are the conventions substantive and current, or token? Do they encode
real architectural/testing guidance an agent could follow?

#### D2: Automated Testing (15%)
*Signals:* test directories/files (`__tests__`, `*.test.*`, `*_test.*`, `tests/`),
frameworks (Jest, Vitest, Pytest, Go test, JUnit…), e2e (Playwright/Cypress),
test-to-source file ratio, coverage config (`coverage`, `codecov.yml`), fixtures,
snapshot tests.
*LLM assessment:* do tests look meaningful (behavioral, edge cases) vs. trivial? Is
there a testing philosophy? Coverage breadth across the codebase.

#### D3: CI/CD & Delivery (14%)
*Signals:* `.github/workflows/*`, GitLab CI, CircleCI, etc.; pipeline stages (lint,
test, build, deploy); branch-protection hints; release automation (semantic-release,
release-please, changesets); preview deploys (Vercel/Netlify); IaC (Terraform, CDK,
Pulumi); policy-as-code (OPA/conftest `.rego`); GitOps (ArgoCD/Flux manifests);
progressive delivery (Argo Rollouts/Flagger, feature-flag SDKs); versioned DB migrations
(Prisma/Alembic/Flyway/Liquibase).
*LLM assessment:* completeness of the pipeline (does it actually gate merges?), and how
declarative, auditable, and reversible the path to production is: what lets autonomy
compound.

#### D4: Agentic Workflows (12%)
*Signals:* AI review bots (CodeRabbit, Claude/Copilot review, `claude-code-action`,
Greptile, Sweep), LLM invocations inside CI workflows, auto-fix/auto-format bots,
auto-PR tooling, Renovate/Dependabot **auto-merge**, issue→PR automation, agent configs
in CI.
*LLM assessment:* how deeply are agents embedded: keyboard assist only (low), or
autonomous review/fix/ship loops (high)?

#### D5: Documentation & Knowledge (9%)
*Signals:* README size/sections, `/docs` or `/documentation`, ADRs
(`docs/adr`, `decisions/`), `CHANGELOG.md`, `CONTRIBUTING.md`, API docs
(OpenAPI/Swagger, typedoc), inline doc density, examples/, machine-readable docs.
*LLM assessment:* are docs useful to a new dev *and* to an agent? Architecture clarity,
freshness.

#### D6: Code Quality & Guardrails (7%)
*Signals:* linters/formatters (ESLint, Prettier, Ruff, Biome, golangci-lint), type
checking (`tsconfig` strict, mypy, pyright), pre-commit hooks (`.pre-commit-config`,
husky/lint-staged), `CODEOWNERS`, conventional-commit/commitlint config, PR templates.
(Supply-chain security scanning moved to **D9**.)
*LLM assessment:* are guardrails enforced (CI-wired) vs. merely present? Strictness.

#### D7: Commit & Velocity Signals (7%)
*Signals:* AI co-author trailers (`Co-Authored-By: Claude`, `Copilot`, etc.) and
bot-authored commits in recent history; conventional-commit prefixes; commit cadence /
small-batch pattern; recent activity.
*LLM assessment:* does commit history corroborate an AI-native workflow or contradict
the config (e.g., lots of AI config but no AI-attributed commits)?

#### D8: AI Process & Harness (12%)
*Signals:* evals / golden tests for AI/LLM output (promptfoo, `evals/`, `golden/`); a
structured prompt/agent library (`prompts/`, `.claude/agents/`, multiple agent specs);
agent-readable runbooks/ADRs; a structured contribution process (issue + PR templates,
Definition-of-Done). PR-review discipline on AI-touched PRs folds in from GraphQL.
*LLM assessment:* is AI produced and verified through a repeatable harness with review
gates, or one-off prompting?

#### D9: Supply Chain & Security (9%)
*Signals:* SAST (CodeQL, Semgrep, SonarQube/Cloud, Snyk Code); dependency/SCA + license
scanning (Dependabot, Snyk, OSV-Scanner, `npm/pip/cargo audit`); secret scanning
(gitleaks, trufflehog, detect-secrets); container image scanning (Trivy, Grype, Docker
Scout) when containerized; SBOM (Syft, CycloneDX, SPDX); artifact signing + provenance
(cosign/sigstore, SLSA, `actions/attest`); `SECURITY.md`; threat-model docs. Branch
signing/protection folds in from the governance API.
*LLM assessment:* do these run automatically and gate merges/releases, or just sit in
the repo? This is the shift-left guardrail against vulnerable or secret-leaking AI output.

*Two parsing rules in the battery worth stating, because D9 is taken verbatim* (`src/lib/security/checks.ts`):

- **Pinned dependencies counts only EXTERNAL base images.** A multi-stage alias reference
  (`FROM builder AS test`, an internal pointer at a stage the same Dockerfile declared) and
  `FROM scratch` cannot carry a digest, so neither enters the denominator. Counting them scored
  a repo that had pinned every external image down for its own stage graph. A registry image
  that merely *shares* a stage's name is still external; a stage is internal only when that
  file declared it via `AS`.
- **A broad write grant is capped wherever it appears in a `permissions:` block.** The check
  walks the block's indented body (ending at the first line that dedents to the key's column)
  rather than matching the line after the header, so
  `permissions:\n  issues: read\n  contents: write` is capped like any other broad grant.
  `packages` / `id-token` / `actions` write count too.

## 3. Scoring Methodology (hybrid & explainable)

This pseudo-code mirrors the implemented pipeline (`src/lib/scoring/engine.ts`
`assembleReport` + `src/lib/maturity/model.ts` `overallScoreFor`); the constants quoted
are `SCORE_BLEND = 0.6` and `LLM_GUARDBAND = 25` from `src/lib/maturity/model.ts`.

```
coverage = fraction of the repo actually inspected (0..1; also surfaced as report.confidence)

For each dimension D:
  signals(D)     = deterministic detectors over the repo (files, patterns, metadata)
  signalScore(D) = rubric mapping of signals -> 0..100  (cheap, reliable, explainable)
  llmScore(D)    = LLM judgment 0..100 given signals + sampled content + the rubric

  # Guardband: the LLM may nuance but not contradict the evidence. The band is DOUBLED for
  # a dimension the LLM's self-audit flagged as a detector discrepancy (a missed signal or a
  # false positive) — the deterministic signal is suspect there, so the model's judgment is
  # trusted further, still bounded. BUDGETED: the widening is self-declared and uncorroborated,
  # so at most MAX_FLAGGED_DIMENSIONS (2) dimensions may widen per scan; flag more and none do.
  widened    = (count of widen-eligible flagged dims) <= 2 ? those dims : {}
  band(D)    = D in widened ? 2 * GUARDBAND : GUARDBAND                # GUARDBAND = 25
  guarded(D) = clamp(llmScore(D), signalScore(D) - band(D), signalScore(D) + band(D))

  # Coverage-scaled blend: the LLM's pull is scaled by how much of the repo we inspected. A
  # half-seen (rate-limited / truncated) repo leans harder on the deterministic signals; at
  # full coverage this is exactly BLEND.
  effectiveBlend    = BLEND * coverage                                 # BLEND = 0.6
  dimensionScore(D) = round( effectiveBlend * guarded(D) + (1 - effectiveBlend) * signalScore(D) )

  # Exception — D9 (Supply Chain & Security) is fully deterministic: its check battery IS the
  # score. The LLM narrates it but never moves the number. dimensionScore(D9) = signalScore(D9).

# Overall: a RENORMALIZED, archetype-lens-weighted MEAN over the dimensions actually present.
# A dimension whose detector failed (or that a partial scan dropped) is EXCLUDED and the
# remaining lens weights renormalize — it is never charged as a 0. lensWeight(D) comes from
# the archetype lens (§2b), not the base org weights.
overall = round( Σ lensWeight(D) * dimensionScore(D) / Σ lensWeight(D) )   # over present D
level   = band(overall)   # L1..L5 per the table above
```

Design principles:
- **Deterministic backbone:** signals are computed in code, not by the LLM, so scores
  are reproducible and cheap. The LLM adds nuance and writes the human-readable
  rationale and recommendations.
- **Guardbanding:** the LLM score for a dimension is clamped to within ±25
  (`LLM_GUARDBAND`) of the signal score to prevent hallucinated extremes; the band
  doubles (±50) only where the LLM's self-audit flagged the detector signal itself as
  suspect, for at most 2 dimensions per scan (see the discrepancy budget above).
  Evidence must back any score.
- **Coverage-weighted blend:** the LLM's blend weight scales with inspection coverage,
  so a partially-seen repo leans on the coverage-robust deterministic signals rather
  than blending a low-information LLM read at full weight.
- **Renormalized roll-up:** the overall is a weighted *mean* over the dimensions
  actually scored (lens weights renormalized), so a failed detector or partial scan
  can't silently deflate the headline. Deterministic D9 anchors security to the check
  battery alone; the LLM narrates but never re-scores it. Its only escape is the
  *visibility blind-spot* path, which marks D9 `n/a` rather than raising it.
- **Missing lens weight vs. a genuine zero:** `lensWeight(D)` for a dimension with no
  entry in the active archetype's lens (rubric drift: a dimension added to the base
  rubric without updating every `ARCHETYPE_WEIGHTS` lens) both fall back to 0 in the
  sum, but only the *missing* case logs a loud warning; a dimension deliberately
  weighted at 0 never does. Today every archetype defines all 9 dimension ids, so this
  is latent; it exists so a future drift fails loudly instead of silently vanishing a
  dimension from the headline.
- **Evidence-first:** every dimension returns the concrete signals/files it found, so
  the score is auditable.
- **Confidence:** each report carries a confidence value driven by how much of the repo
  we could actually inspect (file budget, rate-limit truncation), literally the same
  sanitized 0..1 coverage that scales the blend (one binding, so a broken estimate can
  never yield a valid score next to a `NaN`/out-of-range confidence).

## 4. Report Output (per scan)

```jsonc
{
  "repo": { "owner": "...", "name": "...", "url": "...", "stars": 0, "language": "..." },
  "overallScore": 0,            // 0..100
  "level": { "id": "L3", "name": "Augmented", "band": [45, 64] },
  "dimensions": [
    {
      "id": "D2", "name": "Automated Testing", "weight": 0.15,  // the lens-adjusted weight (org lens shown)
      "score": 0, "signalScore": 0, "llmScore": 0,
      "summary": "…",                       // one-paragraph rationale
      "evidence": ["found vitest.config.ts", "42 *.test.ts files", "…"],
      "strengths": ["…"], "gaps": ["…"]
    }
    // …8 more dimensions
  ],
  "headline": "…",              // exec-summary sentence
  "strengths": ["…"], "risks": ["…"],
  "roadmap": [                   // prioritized next steps to climb a level
    { "title": "Wire tests into a CI gate", "dimension": "D3",
      "impact": "high", "effort": "low", "rationale": "…", "levelUnlock": "L3→L4" }
  ],
  "confidence": 0.0,            // 0..1
  "scannedAt": "ISO-8601",
  "engine": { "provider": "gemini|bedrock|mock", "model": "…" }
}
```

## 5. Calibration & Roadmap (post-MVP)
- Build a **labeled benchmark set** (~30 repos hand-rated L1–L5) and tune weights/BLEND
  to maximize agreement (target ≥ 80%).
- Add **peer benchmarking** percentiles (Phase 2, needs DB of anonymized scans).
- Periodic rubric review as the AI-native toolchain evolves (new agent tools, configs).
