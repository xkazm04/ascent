// A checked-in fixture tree mirroring the REAL reference registry, github.com/xkazm04/ai-registry
// (paths, frontmatter keys and the deliberate 0.4.0-vs-0.3.0 drift case), plus three files the real
// repo does NOT have and the indexer must survive:
//
//   skills/no-frontmatter-skill/SKILL.md  — a body with no `---` block at all (indexes, warns)
//   skills/broken-skill/SKILL.md          — frontmatter that never closes    (indexes, warns)
//   skills/empty-skill/SKILL.md           — whitespace only                  (SKIPPED, warns)
//   memory/semantic/empty-note.md         — frontmatter only, no body        (SKIPPED, warns)
//
// Contents are trimmed to what the parsers read; nothing here hits the network.

export interface FixtureBlob {
  path: string;
  body: string;
  size?: number;
}

export const FIXTURE_REGISTRY_YAML = `# The registry's declaration of itself.
registry: 1
canonical: true
mode: git-native
telemetry: api

policies:
  requireDescription: true
  requireVersion: true
  categories:
    - ci-cd
    - testing
    - security
    - ai-native
    - docs
    - workflow
    - other
  memoryKinds:
    - episodic
    - semantic
    - procedural
    - summary
  catalogWrites: bot

owners:
  - xkazm04
`;

const skill = (name: string, category: string, version: string) => `---
name: ${name}
description: "One sentence telling an agent when to reach for ${name}."
category: ${category}
memory: project
version: ${version}
tags: pre-push, gate
---

# ${name}

Body of the skill.
`;

export const FIXTURE_LESSONS = `# Lessons - test-before-commit

Append-only reflection lane.

## 2.0.0 - 2026-05-04 - checkout-service

- One.

## 2.0.0 - 2026-06-19 - internal-tooling-cli

- Two.

## 2.1.0 - 2026-07-30 - reporting-api

- Three.
`;

const practice = (id: string, dimension: string) => `---
id: ${id}
dimension: ${dimension}
applies-when: "The repo has no root AGENTS.md."
---

# ${id}

The shape, never a repo's content.
`;

const note = (kind: string, namespace: string, source: string, confidence = "1.0") => `---
kind: ${kind}
confidence: ${confidence}
namespace: ${namespace}
source: ${source}
---

# A durable note

The body that gets indexed.
`;

/** The full fixture tree, in the order GitHub returns it (path-sorted). */
export const FIXTURE_TREE: FixtureBlob[] = [
  { path: ".ascent/registry.yaml", body: FIXTURE_REGISTRY_YAML },
  { path: "CODEOWNERS", body: "* @xkazm04\n" },
  { path: "README.md", body: "# ai-registry\n" },
  { path: "catalog.json", body: '{"schema":"ascent-registry-catalog"}\n' },
  { path: "memory/_index.md", body: "# Map of content\n" },
  { path: "memory/episodic/2026-06-required-checks-decision.md", body: note("episodic", "engineering", "decision-record") },
  { path: "memory/procedural/rolling-back-a-bad-release.md", body: note("procedural", "platform", "incident-retro") },
  { path: "memory/semantic/empty-note.md", body: "---\nkind: semantic\n---\n" },
  { path: "memory/semantic/service-naming-and-ownership.md", body: note("semantic", "platform", "architecture-review") },
  { path: "memory/summary/2026-h1-delivery-guardrails.md", body: note("summary", "engineering", "half-year-review", "0.6") },
  { path: "practices/agent-guidance/PRACTICE.md", body: practice("agent-guidance", "D1") },
  { path: "practices/agent-guidance/starter/AGENTS.md", body: "# AGENTS.md starter\n" },
  { path: "practices/supply-chain-security/PRACTICE.md", body: practice("supply-chain-security", "D9") },
  { path: "practices/supply-chain-security/starter/SECURITY.md", body: "# SECURITY.md starter\n" },
  { path: "practices/supply-chain-security/starter/.github/workflows/supply-chain.yml", body: "name: supply-chain\n" },
  { path: "skills/agent-guidance-bootstrap/SKILL.md", body: skill("agent-guidance-bootstrap", "ai-native", "0.4.0") },
  { path: "skills/broken-skill/SKILL.md", body: "---\nname: broken-skill\ndescription: never closed\n\n# body\n" },
  { path: "skills/ci-gate-check/SKILL.md", body: skill("ci-gate-check", "ci-cd", "1.3.0") },
  { path: "skills/empty-skill/SKILL.md", body: "   \n" },
  { path: "skills/no-frontmatter-skill/SKILL.md", body: "# Just a heading\n\nProse that should still index.\n" },
  { path: "skills/test-before-commit/LESSONS.md", body: FIXTURE_LESSONS },
  { path: "skills/test-before-commit/SKILL.md", body: skill("test-before-commit", "testing", "2.1.0") },
];
