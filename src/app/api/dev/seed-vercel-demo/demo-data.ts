// Demo dataset for the "Vercel Demo" org — the example values that scans DON'T produce (segments,
// skills, goals, initiatives, members), applied by the sibling route.ts. Kept as plain typed consts
// (co-located, no logic) so the demo content is easy to read and edit. The repo fullNames below MUST
// match repositories actually imported for the org (see scripts/seed-org.mjs vercel) — an unknown
// fullName is silently ignored by setRepoSegmentsBulk.

import type { DimensionId } from "@/lib/types";
import type { GoalMetric } from "@/lib/db/plan";
import type { SkillCategory } from "@/lib/org/skill-categories";
import type { OrgRole } from "@/lib/db/members";

/** Rebrand: the org imported under the raw GitHub login "vercel" becomes the polished demo tenant. */
export const DEMO_ORG = {
  fromSlug: "vercel",
  slug: "vercel-demo",
  name: "Vercel Demo",
  // Team unlocks the Skills Library (authoring is a Team+ capability — see planAllowsSkillsLibrary).
  plan: "team" as const,
};

/** Named slices of the fleet, each tagging a few of the org's real repos. */
export const SEGMENTS: { name: string; color: string; repos: string[] }[] = [
  { name: "Frameworks", color: "#3b9eff", repos: ["vercel/next.js", "vercel/turborepo", "vercel/swr"] },
  { name: "AI SDK", color: "#a855f7", repos: ["vercel/ai", "vercel/streamdown"] },
  { name: "Platform & CLI", color: "#14b8a6", repos: ["vercel/vercel", "vercel/hyper", "vercel/eve"] },
  { name: "Rendering & Examples", color: "#f59e0b", repos: ["vercel/satori", "vercel/examples"] },
];

/** Org Skills Library entries — categorized, reusable Claude/LLM assets. */
export const SKILLS: { name: string; category: SkillCategory; description: string; tags: string[]; content: string }[] = [
  {
    name: "AGENTS.md Starter",
    category: "ai-native",
    description: "Baseline AGENTS.md conventions to onboard a repo to agentic workflows.",
    tags: ["agents", "conventions", "onboarding"],
    content: [
      "# AGENTS.md Starter",
      "",
      "A minimal, high-signal AGENTS.md every repo should ship.",
      "",
      "## Sections",
      "- **Build & test** — the exact commands an agent must run before opening a PR.",
      "- **Conventions** — file layout, naming, and the max-LOC rule.",
      "- **Guardrails** — what NOT to touch (generated code, migrations, secrets).",
      "- **Definition of done** — lint clean, tests green, changelog entry.",
    ].join("\n"),
  },
  {
    name: "PR Review Checklist (LLM)",
    category: "workflow",
    description: "A structured prompt for LLM-assisted pull-request review.",
    tags: ["review", "pr", "prompt"],
    content: [
      "# PR Review Checklist (LLM)",
      "",
      "Paste the diff and ask the model to check, in order:",
      "1. Correctness — does the change do what the PR says?",
      "2. Edge cases — nulls, empty lists, concurrency, timezones.",
      "3. Security — injection, authz, secret handling.",
      "4. Tests — is the new behavior covered? Any test-only shortcuts?",
      "5. Blast radius — public API / binding / schema changes flagged.",
    ].join("\n"),
  },
  {
    name: "Vitest Coverage Gate",
    category: "testing",
    description: "CI step and prompt to raise and enforce test coverage on core packages.",
    tags: ["testing", "vitest", "coverage"],
    content: [
      "# Vitest Coverage Gate",
      "",
      "```yaml",
      "- run: npx vitest run --coverage",
      "- run: npx vitest run --coverage --coverage.thresholds.lines=80",
      "```",
      "",
      "Start the threshold at the current line %, then ratchet +2 each sprint.",
    ].join("\n"),
  },
  {
    name: "Supply-Chain Hardening",
    category: "security",
    description: "Pin GitHub Actions to SHAs, generate an SBOM, and enable Dependabot.",
    tags: ["security", "supply-chain", "actions"],
    content: [
      "# Supply-Chain Hardening",
      "",
      "- Pin every `uses:` to a full commit SHA (not a floating tag).",
      "- Add `permissions: { contents: read }` at the workflow top level.",
      "- Generate an SBOM (`anchore/sbom-action`) and attach it to releases.",
      "- Enable Dependabot for `github-actions` and the package ecosystem.",
    ].join("\n"),
  },
  {
    name: "Release Notes Generator",
    category: "docs",
    description: "Generate a changelog / release notes from merged PRs since the last tag.",
    tags: ["docs", "changelog", "release"],
    content: [
      "# Release Notes Generator",
      "",
      "Feed the model `git log <lastTag>..HEAD --merges` and ask for:",
      "- A one-line summary grouped by Added / Changed / Fixed.",
      "- Breaking changes called out first, with a migration note.",
      "- A thank-you line listing first-time contributors.",
    ].join("\n"),
  },
  {
    name: "CI Pipeline Bootstrap",
    category: "ci-cd",
    description: "Opinionated GitHub Actions workflow for lint, test, and build.",
    tags: ["ci-cd", "github-actions"],
    content: [
      "# CI Pipeline Bootstrap",
      "",
      "```yaml",
      "on: [push, pull_request]",
      "jobs:",
      "  ci:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@<sha>",
      "      - run: npm ci && npm run lint && npm test && npm run build",
      "```",
    ].join("\n"),
  },
];

/** Maturity goals with live progress on the Plan tab. metric ∈ overall | adoption | rigor | D1..D9. */
export const GOALS: { label: string; metric: GoalMetric; target: number; targetDate: string }[] = [
  { label: "Org-wide L4 (Integrated)", metric: "overall", target: 75, targetDate: "2026-12-31" },
  { label: "Lift AI adoption to 60", metric: "adoption", target: 60, targetDate: "2026-09-30" },
  { label: "Automated Testing (D2) to 70", metric: "D2", target: 70, targetDate: "2026-10-31" },
  { label: "Supply Chain & Security (D9) to 65", metric: "D9", target: 65, targetDate: "2026-11-30" },
];

/** Tracked initiatives; `linkGoalMetric` wires the initiative to the steering goal on the same metric. */
export const INITIATIVES: { title: string; dimId: DimensionId; repos: string[]; targetScore: number; linkGoalMetric?: GoalMetric }[] = [
  { title: "Adopt AGENTS.md across frameworks", dimId: "D1", repos: ["vercel/next.js", "vercel/turborepo", "vercel/swr"], targetScore: 75 },
  { title: "Raise test coverage on core SDKs", dimId: "D2", repos: ["vercel/ai", "vercel/swr"], targetScore: 70, linkGoalMetric: "D2" },
  { title: "Supply-chain hardening (pin actions, SBOM)", dimId: "D9", repos: ["vercel/vercel", "vercel/next.js"], targetScore: 65, linkGoalMetric: "D9" },
];

/** Org members + roles (owner | admin | member | viewer). `name` sets the User display name. */
export const MEMBERS: { login: string; name: string; role: OrgRole }[] = [
  { login: "rauchg", name: "Guillermo Rauch", role: "owner" },
  { login: "leerob", name: "Lee Robinson", role: "admin" },
  { login: "shuding", name: "Shu Ding", role: "member" },
  { login: "timneutkens", name: "Tim Neutkens", role: "member" },
  { login: "styfle", name: "Steven", role: "viewer" },
];
