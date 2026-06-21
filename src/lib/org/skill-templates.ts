// Starter skill templates (Skills P3) so authoring a library entry isn't a blank form — mirrors
// PLAYBOOK_TEMPLATES. Curated, reusable Claude/LLM "skills" (SKILL.md-like bodies) across the
// categories; the author picks one and edits before saving. Pure + client-safe (only a type import),
// so SkillsPanel can prefill its form inline.

import type { SkillCategory } from "@/lib/org/skill-categories";

export interface SkillTemplate {
  name: string;
  category: SkillCategory;
  description: string;
  content: string;
  tags: string[];
}

export const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    name: "PR Review Checklist",
    category: "workflow",
    description: "A structured pull-request review pass: correctness, tests, security, and clarity.",
    tags: ["review", "pull-request"],
    content: `# PR Review Checklist

When reviewing a pull request, work through these in order and comment inline:

1. **Correctness** — does the change do what the description claims? Trace the happy path and at least one edge case.
2. **Tests** — is the new behavior covered? A bug fix must add a regression test that fails without the change.
3. **Security** — any untrusted input reaching a query/command/filesystem path? Authz checked on every new mutation?
4. **Error handling** — failures surfaced (not swallowed); no partial writes left on a thrown path.
5. **Clarity** — names, comments at the right altitude, no dead code. Matches the surrounding style.

End with a one-line verdict: approve / approve-with-nits / request-changes, and the single most important thing to fix.`,
  },
  {
    name: "Generate Tests for a Module",
    category: "testing",
    description: "Produce focused unit tests for a target file — risk-first, no success theater.",
    tags: ["tests", "coverage"],
    content: `# Generate Tests for a Module

Given a target source file, write tests that pin its real behavior:

- Identify the **public surface** (exports) and the **risk** in each (branches, error paths, boundaries).
- Cover the **untested layer above the pure helpers** — the orchestration / IO / auth-gate where bugs hide.
- For each test: arrange a minimal fixture, act, assert on observable behavior (not implementation detail).
- Include the **failure modes**: invalid input → rejected, missing dependency → handled, race → serialized.
- NO success-theater assertions (\`expect(true).toBe(true)\`, asserting a mock was called with no outcome check).

Output the test file in the project's existing test framework + style; do not change the source.`,
  },
  {
    name: "Security Audit Pass",
    category: "security",
    description: "A focused OWASP-style sweep of changed code: injection, authz, secrets, SSRF.",
    tags: ["security", "owasp"],
    content: `# Security Audit Pass

Review the changed files for exploitable issues, highest-severity first:

- **Injection** — SQL/NoSQL/command/path built from untrusted input without parameterization or validation.
- **Broken authz** — a new mutation or read that doesn't check the caller owns the resource (IDOR / cross-tenant).
- **Secrets** — credentials/keys logged, returned to the client, or committed; tokens with no expiry.
- **SSRF / open redirect** — server-side fetch of a user-supplied URL; redirect to a user-controlled target.
- **Unsafe rendering** — user content via \`dangerouslySetInnerHTML\` / unescaped templates.

For each finding: file:line, the exploit, and the minimal fix. Default to "needs a fix" when uncertain.`,
  },
  {
    name: "CI Pipeline Hardening",
    category: "ci-cd",
    description: "Make the CI workflow a real gate: pinned, fast, fail-closed, with a maturity check.",
    tags: ["ci", "github-actions"],
    content: `# CI Pipeline Hardening

Audit and improve the project's CI workflow:

1. **Pin** action versions to a SHA (not a moving tag) and least-privilege the \`permissions:\` block.
2. **Gate** the merge: typecheck + tests + build must pass; no \`continue-on-error\` on the quality steps.
3. **Cache** dependencies + build artifacts so the pipeline stays fast as it grows.
4. **Fail closed** — a flaky/skipped check must not report green; surface skipped suites explicitly.
5. Add a **maturity/coverage gate** step so quality can't silently regress.

Output the updated workflow YAML with a one-line rationale per change.`,
  },
  {
    name: "API Reference from Code",
    category: "docs",
    description: "Generate accurate, example-driven API docs from the route/handler definitions.",
    tags: ["docs", "api"],
    content: `# API Reference from Code

From the route/handler files, produce reference docs that match the code (not aspirations):

- One entry per endpoint: method, path, auth requirement, request shape, response shape, error codes.
- A **realistic example** request + response for each (use representative, non-secret values).
- Note the **gating** (which role / plan / token is required) read straight from the handler's guard.
- Flag any endpoint whose validation/authz you couldn't find — don't invent it.

Output as Markdown grouped by resource. Keep it terse and copy-pasteable.`,
  },
  {
    name: "Bootstrap the AI-Native Standard",
    category: "ai-native",
    description: "Scaffold an .ai/ foundation — manifest, memory, CONTEXT graph — for a repo.",
    tags: ["ai-native", "agents"],
    content: `# Bootstrap the AI-Native Standard

Set up the vendor-neutral \`.ai/\` foundation so agents work from durable context:

1. **AGENTS.md / CLAUDE.md** at the root — how to build, test, run, and the project's conventions.
2. **.ai/manifest** — the machine-readable index of the standard's pieces.
3. **Structured memory** — a place for decisions/learnings that survives across sessions.
4. **CONTEXT graph** — the map of subsystems and where each lives (file paths).
5. A **doctor** conformance check the repo can run to verify the standard is intact.

Tailor each file to this repo's actual stack and layout; don't emit placeholders.`,
  },
];
