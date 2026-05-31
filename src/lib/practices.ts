// The org's reusable practice catalog — mapped to scoring dimensions. Each practice carries a
// LEAK-FREE templatized "starter" (the *shape* of what good looks like, never proprietary code),
// so a strong repo's institutional knowledge can travel to the repos that lack it.

import type { DimensionId } from "@/lib/types";

export interface PracticeDef {
  id: string;
  label: string;
  dimId: DimensionId;
  /** What this practice gives the org once adopted. */
  what: string;
  /** The reusable shape — generic structure to copy, not code. */
  starter: string[];
}

export const PRACTICES: PracticeDef[] = [
  {
    id: "agent-guidance",
    label: "Agent guidance (CLAUDE.md / AGENTS.md)",
    dimId: "D1",
    what: "Machine-readable project context so any AI contribution lands consistent and on-spec.",
    starter: [
      "Build & test commands (how to run, lint, and verify)",
      "Architecture map — entry points, key modules, data flow",
      "“Verify after every change” rules (run tests, typecheck)",
      "Constraints the agent must never break (security, public API, conventions)",
      "MCP servers / hooks / subagents in use, if any",
      "One or two examples of a good change",
    ],
  },
  {
    id: "test-discipline",
    label: "Test discipline",
    dimId: "D2",
    what: "The guardrail that makes AI-generated changes safe to merge.",
    starter: [
      "A behavioral test suite covering critical paths",
      "Tests runnable with one command (wired into CI)",
      "A “write/extend a test with every change” norm",
      "Coverage visible enough to spot gaps",
    ],
  },
  {
    id: "ci-gates",
    label: "CI gates on merge",
    dimId: "D3",
    what: "Trust that doesn't depend on which human reviewed — checks enforce it.",
    starter: [
      "Lint + typecheck + tests run on every PR",
      "Merges blocked until checks pass",
      "Fast feedback (cached deps, parallel jobs)",
    ],
  },
  {
    id: "agent-in-loop",
    label: "Agent in the loop",
    dimId: "D4",
    what: "AI takes a first pass (review, triage, codegen) with a human confirming.",
    starter: [
      "An AI code-review or triage step on PRs",
      "An eval/golden-test harness for AI-generated output",
      "A clear human-confirmation checkpoint before merge",
    ],
  },
  {
    id: "docs-adrs",
    label: "Architecture docs & ADRs",
    dimId: "D5",
    what: "Context both humans and agents can read — less re-explaining, better changes.",
    starter: [
      "A /docs folder with agent-readable architecture notes",
      "ADRs capturing why key decisions were made",
      "Onboarding / “how this repo works” entry point",
    ],
  },
  {
    id: "enforced-quality",
    label: "Enforced quality",
    dimId: "D6",
    what: "Conventions held by tooling, not habit — slips caught at the earliest point.",
    starter: [
      "Linter + strict type settings, enforced in CI",
      "Pre-commit / pre-push hooks",
      "A PR template with a definition-of-done checklist",
    ],
  },
  {
    id: "legible-history",
    label: "Legible, attributable history",
    dimId: "D7",
    what: "You can see where AI helped and how it fared; automation gets reliable signals.",
    starter: [
      "Conventional commit format (feat/fix/chore…)",
      "AI co-authorship attributed in commits/PRs",
      "Small, focused PRs that are easy to review",
    ],
  },
  {
    id: "ai-harness",
    label: "AI process & harness",
    dimId: "D8",
    what: "Ad-hoc prompting becomes a repeatable, trustworthy part of how the team ships.",
    starter: [
      "Evals / golden tests for AI-generated output",
      "A versioned prompt & agent library the team reuses",
      "Agent runbooks for recurring tasks",
      "A review gate / Definition-of-Done for AI changes",
    ],
  },
  {
    id: "supply-chain-security",
    label: "Supply-chain security",
    dimId: "D9",
    what: "The shift-left guardrail against the vulnerable or secret-leaking code AI can confidently produce.",
    starter: [
      "SAST (e.g. CodeQL/Semgrep) running on every PR",
      "Dependency + secret scanning wired into CI (Dependabot/Snyk, gitleaks)",
      "Container image scanning when you ship images",
      "SBOM + signed, attested build artifacts (cosign/SLSA)",
    ],
  },
];
