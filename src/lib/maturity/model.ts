// The AI-Native Maturity Model — the rubric is configuration, not hard-coded logic.
// Tune levels / dimensions / weights here without touching the engine.
// See docs/MATURITY_MODEL.md.

import type {
  Axis,
  DimensionDef,
  DimensionId,
  LevelId,
  MaturityLevel,
  Posture,
  RepoArchetype,
} from "@/lib/types";

/** Blend factor: how much the LLM judgment counts vs. deterministic signals. */
export const SCORE_BLEND = 0.6;

/**
 * Guardband: the LLM's per-dimension score is clamped to within this many points
 * of the deterministic signal score, so it can nuance but never hallucinate an
 * extreme that the evidence doesn't support.
 */
export const LLM_GUARDBAND = 25;

export const LEVELS: MaturityLevel[] = [
  {
    id: "L1",
    name: "Manual",
    band: [0, 24],
    tagline: "AI used ad hoc, if at all",
    description:
      "AI is used informally by individuals. No machine-readable guidance and weak guardrails, so AI output is risky to merge because little verifies it.",
  },
  {
    id: "L2",
    name: "Assisted",
    band: [25, 44],
    tagline: "Tools adopted, basic guardrails",
    description:
      "AI tools are adopted by many developers and basic guardrails exist (some tests, a linter, CI runs). There are no shared AI conventions, so benefits are individual rather than systemic.",
  },
  {
    id: "L3",
    name: "Augmented",
    band: [45, 64],
    tagline: "AI is part of the standard workflow",
    description:
      "AI is part of the team's standard workflow. Shared agent guidance exists and guardrails are solid (real test suite, CI gates, enforced types/lint), so AI-generated code is safe to merge.",
  },
  {
    id: "L4",
    name: "Integrated",
    band: [65, 84],
    tagline: "Agents in the loop, not just at the keyboard",
    description:
      "Agents are embedded in the process: AI code review, AI steps in CI, auto-fix/auto-PR, and dependency automation. Strong docs (including docs for agents), observability, and reliable CI/CD let autonomy compound.",
  },
  {
    id: "L5",
    name: "Autonomous",
    band: [85, 100],
    tagline: "Fully autonomous, reliable, AI-native system",
    description:
      "A fully autonomous, reliable, established system. Agents propose, test, document, and ship changes with humans supervising at the policy level. Comprehensive automated tests, docs, and CI/CD; high reliability; governance and guardrails are first-class.",
  },
];

export const DIMENSIONS: DimensionDef[] = [
  {
    id: "D1",
    name: "AI Tooling & Conventions",
    weight: 0.15,
    axis: "adoption",
    description:
      "Is AI development operationalized with shared, machine-readable guidance?",
    criteria:
      "Presence AND content-quality of agent guidance / AI tooling config: CLAUDE.md, AGENTS.md, .cursorrules, copilot-instructions.md, MCP config, .claude/, prompt libraries, etc. Crucially, judge the CONTENT when CLAUDE.md/AGENTS.md is provided: does it document build/test/run commands, an architecture map, test-after-change discipline, explicit constraints ('never/always'), and advanced techniques (subagents, MCP servers, hooks, slash commands, skills, tool-permission policy, @-file references)? A token stub scores low; deep, technique-rich guidance an agent can actually follow scores high.",
  },
  {
    id: "D2",
    name: "Automated Testing",
    weight: 0.15,
    axis: "rigor",
    description:
      "The guardrail that makes AI-generated code safe to merge — breadth and depth of tests.",
    criteria:
      "Test files/dirs (__tests__, *.test.*, *_test.*, tests/), frameworks (Jest, Vitest, Pytest, Go test, JUnit, RSpec), e2e (Playwright/Cypress), test-to-source ratio, coverage config (codecov, coverage thresholds), fixtures, snapshots. Advanced rigor — mutation testing (Stryker, mutmut, PIT), contract testing (Pact), performance/load smoke tests (k6, Locust, Lighthouse CI), accessibility tests (axe, pa11y), and API-schema validation (Schemathesis, Dredd, Spectral) — signals a deliberate, high-confidence suite. High maturity = meaningful behavioral/edge-case tests with broad coverage and a clear testing philosophy.",
  },
  {
    id: "D3",
    name: "CI/CD & Delivery",
    weight: 0.14,
    axis: "rigor",
    description: "Automated pipelines, merge gates, release automation, and how code reaches production.",
    criteria:
      "CI config (.github/workflows, GitLab CI, CircleCI), pipeline stages (lint/test/build/deploy), branch-protection hints, release automation (semantic-release, release-please, changesets), preview deploys (Vercel/Netlify). Delivery-as-code: IaC (Terraform/CDK/Pulumi), policy-as-code (OPA/conftest .rego), GitOps (ArgoCD/Flux manifests), progressive delivery (Argo Rollouts/Flagger, feature-flag SDKs), and versioned DB migrations with rollback (Prisma/Alembic/Flyway/Liquibase). High maturity = pipelines that gate merges and a declarative, auditable, reversible path to production that an agent could safely drive.",
  },
  {
    id: "D4",
    name: "Agentic Workflows",
    weight: 0.12,
    axis: "adoption",
    description:
      "Are agents in the loop (review, CI steps, auto-fix/PR, dependency automation)? The high-maturity signal.",
    criteria:
      "AI review bots (CodeRabbit, Claude/Copilot review, claude-code-action, Greptile, Sweep), LLM invocations inside CI, auto-fix/format bots, auto-PR tooling, Renovate/Dependabot auto-merge, issue->PR automation. High maturity = autonomous review/fix/ship loops, not just keyboard assist.",
  },
  {
    id: "D5",
    name: "Documentation & Knowledge",
    weight: 0.09,
    axis: "rigor",
    description: "Docs for humans and agents: README, /docs, ADRs, changelogs, API docs.",
    criteria:
      "README depth, /docs or /documentation, ADRs (docs/adr, decisions/), CHANGELOG.md, CONTRIBUTING.md, API docs (OpenAPI/Swagger, typedoc), inline doc density, examples/. High maturity = docs useful to a new dev and consumable by an agent; clear architecture; kept current.",
  },
  {
    id: "D6",
    name: "Code Quality & Guardrails",
    weight: 0.07,
    axis: "rigor",
    description:
      "Linters, formatters, type checking, pre-commit hooks, code owners, commit conventions.",
    criteria:
      "Linters/formatters (ESLint, Prettier, Ruff, Biome, golangci-lint), type checking (tsconfig strict, mypy, pyright), pre-commit hooks (.pre-commit-config, husky/lint-staged), CODEOWNERS, commitlint/conventional-commit config, PR templates. (Software-supply-chain security — SAST/SCA/secret/container scanning, SBOM, signing — is scored separately under D9.) High maturity = guardrails enforced via CI, not merely present.",
  },
  {
    id: "D7",
    name: "Commit & Velocity Signals",
    weight: 0.07,
    axis: "adoption",
    description:
      "Process hygiene plus direct evidence of AI in the workflow (AI co-author trailers, conventional commits, cadence).",
    criteria:
      "AI co-author trailers (Co-Authored-By: Claude/Copilot/etc.) and bot-authored commits in recent history, conventional-commit prefixes, small-batch cadence, recent activity. High maturity = commit history that corroborates an AI-native workflow.",
  },
  {
    id: "D8",
    name: "AI Process & Harness",
    weight: 0.12,
    axis: "rigor",
    description:
      "The operational discipline that makes AI a reliable, repeatable part of development.",
    criteria:
      "AI Process & Harness — evidence that AI is used *properly* in development, not ad hoc: evals or golden tests for AI/LLM output (promptfoo, evals/, golden/), a structured prompt/agent library (prompts/, agents/ with multiple specs, .claude/agents/), agent-readable operational docs/runbooks/ADRs, and a structured contribution process (issue + PR templates, Definition-of-Done, CONTRIBUTING guidance for agents). High maturity = AI changes are produced and verified through a repeatable harness with review gates, not one-off prompting.",
  },
  {
    id: "D9",
    name: "Supply Chain & Security",
    weight: 0.09,
    axis: "rigor",
    description:
      "Shift-left security and provenance — the guardrail against the vulnerable, secret-leaking code AI can confidently produce.",
    criteria:
      "Software-supply-chain security as code: SAST (CodeQL, Semgrep, SonarQube/SonarCloud, Snyk Code), dependency/SCA scanning + license compliance (Dependabot security updates, Snyk, OSV-Scanner, npm/pip audit in CI), secret scanning (gitleaks, trufflehog, detect-secrets), container image scanning (Trivy, Grype, Docker Scout) when containerized, SBOM generation (Syft, CycloneDX, SPDX, anchore/sbom-action), artifact signing + provenance (cosign/sigstore, SLSA generator, actions/attest), a SECURITY.md policy, and threat-model docs. High maturity = these run automatically in CI and gate merges/releases, not just sit in the repo.",
  },
];

// ---- Derived lookups & helpers ------------------------------------------------

export const DIMENSION_BY_ID: Record<DimensionId, DimensionDef> = Object.fromEntries(
  DIMENSIONS.map((d) => [d.id, d]),
) as Record<DimensionId, DimensionDef>;

/**
 * Canonical dimension-id guard (D1..D9) — the single source of truth for "is this a valid
 * DimensionId?", narrowing the input so callers can pass it straight to the DB. Replaces the
 * `/^D[1-9]$/` literal that was copy-pasted across the org route handlers; if the rubric ever
 * grows/shrinks a dimension this is the one place to update.
 */
export const isDimensionId = (v: string): v is DimensionId => /^D[1-9]$/.test(v);

export const LEVEL_BY_ID: Record<LevelId, MaturityLevel> = Object.fromEntries(
  LEVELS.map((l) => [l.id, l]),
) as Record<LevelId, MaturityLevel>;

/** Clamp a number to [min, max]. */
export function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

/** Map an overall 0..100 score to its maturity level. */
export function levelForScore(score: number): MaturityLevel {
  const s = clamp(Math.round(score));
  return LEVELS.find((l) => s >= l.band[0] && s <= l.band[1]) ?? LEVELS[0]!; // safe: LEVELS is a non-empty const
}

/**
 * Index of a level id in the canonical ladder, clamped to 0 (L1) for an unrecognized id
 * (rubric schema drift / a legacy or hand-edited persisted scan). An unknown level must NOT
 * read as "above everything" / maxed out at L5 — the same clamp the projection, ROI, and
 * fallback-roadmap surfaces relied on inline.
 */
export function levelIndex(id: string): number {
  return Math.max(0, LEVELS.findIndex((l) => l.id === id));
}

/**
 * The next level up the ladder from `id`, or null at the top band. An unrecognized id is treated
 * as the lowest band (L1) — same semantics as {@link levelIndex} — so it climbs from L1 rather
 * than conflating "not found" with "already at the top".
 */
export function nextLevel(id: string): MaturityLevel | null {
  const i = LEVELS.findIndex((l) => l.id === id);
  const idx = i >= 0 ? i : 0;
  return idx < LEVELS.length - 1 ? LEVELS[idx + 1]! : null;
}

/**
 * Sanity check that EVERY weight set sums to 1 (within float tolerance): the base
 * DIMENSIONS weights and each ARCHETYPE_WEIGHTS lens — the lenses are what scoring actually
 * uses, so validating only the base weights left the real ones unchecked.
 */
export function weightsAreValid(): boolean {
  const sums = [
    DIMENSIONS.reduce((acc, d) => acc + d.weight, 0),
    ...Object.values(ARCHETYPE_WEIGHTS).map((set) =>
      Object.values(set).reduce((acc, n) => acc + n, 0),
    ),
  ];
  return sums.every((s) => Math.abs(s - 1) < 1e-9);
}

// ---- Archetype lens (re-weights by how the repo is run) -----------------------

/**
 * Per-archetype dimension weights (each set sums to 1). "org" is the default rubric;
 * "solo"/"team" lenses down-weight org-scale signals (CI, agentic review bots) and lean
 * on tooling/tests/docs/quality, so single-author work is judged fairly rather than
 * being dragged to L1–L2 for lacking infrastructure it doesn't need.
 */
export const ARCHETYPE_WEIGHTS: Record<RepoArchetype, Record<DimensionId, number>> = {
  org: { D1: 0.15, D2: 0.15, D3: 0.14, D4: 0.12, D5: 0.09, D6: 0.07, D7: 0.07, D8: 0.12, D9: 0.09 },
  team: { D1: 0.16, D2: 0.17, D3: 0.11, D4: 0.09, D5: 0.1, D6: 0.09, D7: 0.08, D8: 0.13, D9: 0.07 },
  solo: { D1: 0.2, D2: 0.2, D3: 0.07, D4: 0.07, D5: 0.11, D6: 0.12, D7: 0.08, D8: 0.11, D9: 0.04 },
};

export const ARCHETYPE_LABEL: Record<RepoArchetype, string> = {
  solo: "Solo / early-stage",
  team: "Team / product",
  org: "Org / platform",
};

export function weightsFor(archetype: RepoArchetype): Record<DimensionId, number> {
  return ARCHETYPE_WEIGHTS[archetype] ?? ARCHETYPE_WEIGHTS.org;
}

/**
 * Renormalized, archetype-weighted mean of per-dimension scores (0..100) — the single source of
 * truth for how an overall headline rolls up. Weights come from the archetype lens and are
 * renormalized over just the dimensions present, so a dropped or partial dimension (detector
 * recovery, partial/persisted signals) can't silently deflate the score. Used by the scoring
 * engine (blended dimension scores) and the mock provider (signal scores) alike, so the keyless
 * demo's internal level can't diverge from the report headline the engine composes.
 */
export function overallScoreFor(
  scored: { id: DimensionId; score: number }[],
  archetype: RepoArchetype,
): number {
  const lensW = weightsFor(archetype);
  const presentWsum = scored.reduce((acc, d) => acc + (lensW[d.id] ?? 0), 0);
  if (presentWsum <= 0) return 0;
  return clamp(
    Math.round(scored.reduce((acc, d) => acc + d.score * (lensW[d.id] ?? 0), 0) / presentWsum),
  );
}

/**
 * Weighted roll-up of one axis (Adoption / Rigor) from per-dimension scores, under an
 * archetype lens — weights renormalized over just the axis dimensions that are actually
 * PRESENT, exactly as `overallScoreFor` does. `scoreFor` supplies the score for a dimension
 * id; the optional `isPresent` predicate marks which dimensions a partial scan actually
 * persisted, so an absent dimension is excluded from BOTH the weighted sum and the weight
 * denominator instead of being charged at 0 with full weight (which deflated the axis and
 * flipped the posture). With no predicate every dimension counts as present (the default),
 * and when every dimension IS present the renormalization is a no-op — so a full scan is
 * unchanged. Works for a live report or a persisted scan's dimension list alike.
 */
export function axisScore(
  axis: Axis,
  scoreFor: (id: DimensionId) => number,
  archetype: RepoArchetype,
  isPresent: (id: DimensionId) => boolean = () => true,
): number {
  const lensW = weightsFor(archetype);
  const dims = DIMENSIONS.filter((d) => d.axis === axis && isPresent(d.id));
  const wsum = dims.reduce((a, d) => a + (lensW[d.id] ?? 0), 0);
  if (wsum === 0) return 0;
  return clamp(Math.round(dims.reduce((a, d) => a + scoreFor(d.id) * (lensW[d.id] ?? 0), 0) / wsum));
}

// ---- Two-axis posture (Adoption × Rigor) --------------------------------------

export const POSTURE_THRESHOLD = 50;

export function postureFor(adoption: number, rigor: number): Posture {
  const a = adoption >= POSTURE_THRESHOLD;
  const r = rigor >= POSTURE_THRESHOLD;
  if (a && r)
    return {
      id: "ai-native",
      label: "AI-Native",
      blurb: "Adopting AI with the engineering rigor to ship it safely.",
    };
  if (a && !r)
    return {
      id: "ungoverned",
      label: "Fast & Ungoverned",
      blurb: "Heavy AI use, light guardrails — add tests, CI, and agent guidance to ship safely.",
    };
  if (!a && r)
    return {
      id: "manual",
      label: "Solid but Manual",
      blurb: "Strong engineering foundations with untapped AI leverage — operationalize AI tooling.",
    };
  return {
    id: "early",
    label: "Getting Started",
    blurb: "Early on both AI adoption and engineering rigor — pick one axis to advance first.",
  };
}

/**
 * Canonical, ordered posture taxonomy (id + display label), best→worst.
 * One source of truth for any UI that enumerates postures (e.g. the Posture distribution),
 * so adding/renaming a posture here automatically flows through instead of silently dropping it.
 */
export const POSTURE_META: ReadonlyArray<{ id: Posture["id"]; label: string }> = [
  { id: "ai-native", label: "AI-Native" },
  { id: "ungoverned", label: "Fast & Ungoverned" },
  { id: "manual", label: "Solid but Manual" },
  { id: "early", label: "Getting Started" },
];

// ---- Startup invariant --------------------------------------------------------
// Fail loudly at module load (dev/test only) if any weight set is misconfigured. The engine
// renormalizes defensively so a bad set can't silently deflate scores, but a set that doesn't
// sum to 1 is a config bug worth catching the moment the rubric is edited — not in production.
if (process.env.NODE_ENV !== "production" && !weightsAreValid()) {
  throw new Error(
    "[maturity/model] every weight set must sum to 1 (base DIMENSIONS + each ARCHETYPE_WEIGHTS lens).",
  );
}
