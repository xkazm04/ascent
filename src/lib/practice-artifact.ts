// Turn a Practice Library entry into a CONCRETE, leak-free starter artifact tailored to a target
// repo — the "systematic apply" step the vision calls for. The reusable *shape* travels (the
// practice's starter checklist + a structure the exemplar embodies); the proprietary code never
// does. Output is a real file (path + body) ready to open as a draft PR (see github/write.ts).
//
// Deterministic and pure (no LLM, no I/O) so it is unit-testable and works keyless. The body is
// scaffolding with explicit TODOs for the repo-specific details a maintainer (or their agent)
// fills in — it never invents architecture it can't know. Language-aware where it helps
// (commands, CI matrix).

import { PRACTICES, type PracticeDef } from "@/lib/practices";
import { publicBaseUrl } from "@/lib/site";
import { reportPermalink } from "@/lib/ui";

/** What the builder knows about the target repo (all optional — it degrades to placeholders). */
export interface RepoContext {
  fullName: string;
  name: string;
  description?: string | null;
  primaryLanguage?: string | null;
  defaultBranch?: string;
}

export interface ArtifactSpec {
  practiceId: string;
  /** Repo-relative path the file should live at. */
  path: string;
  /** The full file body to commit. */
  body: string;
  /** Conventional-commit message for the change. */
  commitMessage: string;
  /** Suggested branch name (no slashes that break refs). */
  branch: string;
  prTitle: string;
  prBody: string;
}

export interface LangCommands {
  install: string;
  test: string;
  lint: string;
  build: string;
  /** GitHub Actions setup step language id. */
  ci: "node" | "python" | "go" | "rust" | "generic";
}

/** Map a repo's primary language to its canonical install/test/lint/build commands + CI setup id.
 *  The single source of truth for language→commands; reused by the onboarding-skill generator. */
export function commandsFor(language?: string | null): LangCommands {
  switch ((language ?? "").toLowerCase()) {
    case "typescript":
    case "javascript":
      return { install: "npm ci", test: "npm test", lint: "npm run lint", build: "npm run build", ci: "node" };
    case "python":
      return { install: "pip install -e .[dev]", test: "pytest", lint: "ruff check .", build: "python -m build", ci: "python" };
    case "go":
      return { install: "go mod download", test: "go test ./...", lint: "golangci-lint run", build: "go build ./...", ci: "go" };
    case "rust":
      return { install: "cargo fetch", test: "cargo test", lint: "cargo clippy -- -D warnings", build: "cargo build --release", ci: "rust" };
    default:
      return { install: "<install deps>", test: "<run tests>", lint: "<run linter>", build: "<build>", ci: "generic" };
  }
}

/** Checklist bullets from the practice's reusable shape. */
function shape(p: PracticeDef): string {
  return p.starter.map((s) => `- [ ] ${s}`).join("\n");
}

const TODO = "<!-- TODO: fill in for this repo -->";

function ciWorkflow(ctx: RepoContext, cmd: LangCommands): string {
  const setup =
    cmd.ci === "node"
      ? "      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n"
      : cmd.ci === "python"
        ? "      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'\n"
        : cmd.ci === "go"
          ? "      - uses: actions/setup-go@v5\n        with:\n          go-version: '1.22'\n"
          : cmd.ci === "rust"
            ? "      - uses: dtolnay/rust-toolchain@stable\n"
            : "      # TODO: add the language setup step for this repo\n";
  return `# Continuous integration — gate every PR on lint + tests so AI-generated changes are safe to merge.
name: CI
on:
  pull_request:
  push:
    branches: [${ctx.defaultBranch ?? "main"}]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${setup}      - run: ${cmd.install}
      - run: ${cmd.lint}
      - run: ${cmd.test}
      - run: ${cmd.build}
`;
}

/** Build the concrete artifact for a practice + target repo, or null for an unknown practice id. */
export function buildArtifact(practiceId: string, ctx: RepoContext): ArtifactSpec | null {
  const p = PRACTICES.find((x) => x.id === practiceId);
  if (!p) return null;
  const cmd = commandsFor(ctx.primaryLanguage);
  const desc = ctx.description?.trim() || TODO;

  // Per-practice file path + body. The starter checklist is woven in as the backbone so the
  // generated artifact stays consistent with what the Practice Library promised.
  let path: string;
  let body: string;

  switch (p.id) {
    case "agent-guidance":
      path = "AGENTS.md";
      body = `# ${ctx.name} — agent guidance

> Machine-readable context so any AI contribution lands consistent and on-spec. Replace the
> ${"`<...>`"} / TODO placeholders with this repo's specifics.

${desc}

## Commands
- Install: \`${cmd.install}\`
- Test: \`${cmd.test}\`
- Lint: \`${cmd.lint}\`
- Build: \`${cmd.build}\`

## Architecture map
${TODO}
- Entry points: \`<...>\`
- Key modules and what they own: \`<...>\`
- Data flow: \`<...>\`

## Working agreement (for agents)
- Verify after every change: run the tests and the linter/typecheck above before proposing a diff.
- Keep changes small and focused; match the surrounding code's conventions.

## Constraints — never break these
${TODO}
- Public API / contracts that must stay stable: \`<...>\`
- Security & secrets rules: \`<...>\`

## Tooling in use
${TODO} (MCP servers, hooks, subagents, slash commands — list any the team relies on.)

## Example of a good change
${TODO}
`;
      break;

    case "test-discipline":
      path = "docs/TESTING.md";
      body = `# Testing guide — ${ctx.name}

The guardrail that makes AI-generated changes safe to merge.

## How to run
- All tests: \`${cmd.test}\`

## What we expect
${shape(p)}

## Notes
${TODO} — name the critical paths that must always have coverage, and the framework(s) in use.
`;
      break;

    case "ci-gates":
      path = ".github/workflows/ci.yml";
      body = ciWorkflow(ctx, cmd);
      break;

    case "agent-in-loop":
      path = ".github/workflows/ai-review.yml";
      body = `# AI review in the loop — an agent takes the first pass on each PR; a human confirms before merge.
# This is a leak-free SCAFFOLD: wire it to your chosen review action and provide its token as a secret.
name: AI review
on:
  pull_request:
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # TODO: replace with your AI review step (e.g. an LLM PR-review action). Keep a human
      # confirmation checkpoint — this comments/suggests, it does not auto-merge.
      - name: AI first-pass review
        run: echo "TODO: invoke the AI review action here"
# Checklist for a real agent-in-the-loop:
${p.starter.map((s) => `#   - ${s}`).join("\n")}
`;
      break;

    case "docs-adrs":
      path = "docs/adr/0001-record-architecture-decisions.md";
      body = `# 1. Record architecture decisions

- Status: accepted
- Date: ${TODO}

## Context
We need context both humans and agents can read, so decisions aren't re-litigated and an agent
doesn't unknowingly undo one.

## Decision
We will keep Architecture Decision Records (ADRs) in \`docs/adr/\`, one file per decision, using
this template. Each captures the context, the decision, and its consequences.

## Consequences
- New contributors (human or AI) can read *why*, not just *what*.
- A starting checklist for this repo's knowledge base:
${shape(p)}
`;
      break;

    case "enforced-quality":
      path = ".github/pull_request_template.md";
      body = `## What & why
${TODO}

## Definition of done
${shape(p)}
- [ ] Lint + typecheck + tests pass locally and in CI
- [ ] Docs / ADRs updated if behavior or architecture changed

## Notes for reviewers (human or agent)
${TODO}
`;
      break;

    case "legible-history":
      path = "docs/COMMIT_CONVENTIONS.md";
      body = `# Commit conventions — ${ctx.name}

A legible, attributable history lets you see where AI helped and how it fared, and gives
automation reliable signals.

## Format
\`<type>(<scope>): <summary>\` — types: feat, fix, chore, docs, refactor, test, ci.

## Expectations
${shape(p)}

## AI attribution
When a change was AI-assisted, attribute it (e.g. a \`Co-Authored-By:\` trailer), so the history
stays honest about how the work was produced.
`;
      break;

    case "ai-harness":
      path = "docs/AI_HARNESS.md";
      body = `# AI process & harness — ${ctx.name}

Turns ad-hoc prompting into a repeatable, trustworthy part of how the team ships.

## Components
${shape(p)}

## Where things live
${TODO}
- Evals / golden tests: \`<...>\`
- Prompt & agent library: \`<...>\`
- Runbooks for recurring agent tasks: \`<...>\`

## Review gate for AI changes
${TODO} — describe the Definition-of-Done an AI-generated change must meet before merge.
`;
      break;

    case "supply-chain-security":
      path = "SECURITY.md";
      body = `# Security policy — ${ctx.name}

The shift-left guardrail against the vulnerable or secret-leaking code AI can confidently produce.

## Reporting a vulnerability
${TODO} — how to report privately, and the expected response time.

## Automated guardrails we run
${shape(p)}

## Notes
${TODO} — link the CI workflows that enforce the above (SAST, dependency/secret scanning, signing).
`;
      break;

    default:
      return null;
  }

  const branch = `ascent/${p.id}`;
  // Attribution → this repo's Ascent report on the live deployment (a real inbound funnel back to the
  // product), not the old GitHub-homepage placeholder. Every generated PR is a distribution surface,
  // so the link has to land somewhere useful. Falls back to plain text when no public URL is
  // configured (local dev / preview) so the PR never ships a broken/relative href.
  const base = publicBaseUrl();
  const attribution = base
    ? `Generated by [Ascent](${base}${reportPermalink(ctx.fullName)}) — your AI-native maturity companion.`
    : `Generated by Ascent — your AI-native maturity companion.`;
  return {
    practiceId: p.id,
    path,
    body,
    commitMessage: `chore: add ${p.label.toLowerCase()} starter (via Ascent)`,
    branch,
    prTitle: `Add ${p.label} starter`,
    prBody: `This draft seeds the **${p.label}** practice into \`${ctx.fullName}\`.

> _${p.what}_

It's a **leak-free starter** — the *shape* of what good looks like, with TODO placeholders for the
repo-specific details. Fill those in (or let an agent draft them against ${"`" + path + "`"}), then
mark ready for review.

${attribution}`,
  };
}
