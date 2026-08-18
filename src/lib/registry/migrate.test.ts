// The migration exporter writes the org's own knowledge into a repo it does not own, so the file
// SET it produces is the reviewable artifact. Pinned here: deterministic paths, a frontmatter block
// the indexer can read back, no path collisions between two rows with the same title, and an empty
// input producing NO files (the route turns that into a no-op instead of an empty PR).

import { describe, expect, it } from "vitest";
import { buildMigrationFiles, migrationBranch, type HostedArtifacts } from "./migrate";
import { parseRegistryMemory, parseRegistryPractice, parseRegistrySkill } from "./parse";

const hosted: HostedArtifacts = {
  skills: [
    { name: "PR Review Rigor", description: "Review depth for AI-authored PRs.", category: "workflow", content: "# Review\n", tags: ["review"] },
    { name: "pr review rigor", description: "A near-duplicate name.", category: "workflow", content: "# Dup\n" },
  ],
  practices: [
    { slug: "agents-md-contract", practiceId: "agents-md", dimension: "D1", title: "AGENTS.md contract", appliesWhen: "No root AGENTS.md.", content: "# Shape\n" },
  ],
  memory: [
    { kind: "semantic", namespace: "platform", confidence: 0.8, source: "architecture-review", content: "# Service naming\n\nThe rule.\n" },
    { kind: "not-a-kind", namespace: null, confidence: 1, source: null, content: "# Service naming\n\nSame title, different note.\n" },
  ],
};

const empty: HostedArtifacts = { skills: [], practices: [], memory: [] };

describe("buildMigrationFiles", () => {
  it("is deterministic", () => {
    expect(buildMigrationFiles("skills", hosted)).toEqual(buildMigrationFiles("skills", hosted));
  });

  it("returns NOTHING for an empty org (the route must not open an empty PR)", () => {
    for (const t of ["skills", "practices", "memory"] as const) expect(buildMigrationFiles(t, empty)).toEqual([]);
  });

  it("writes skills into skills/<slug>/SKILL.md with readable frontmatter", () => {
    const files = buildMigrationFiles("skills", hosted);
    expect(files[0]!.path).toBe("skills/pr-review-rigor/SKILL.md");
    const parsed = parseRegistrySkill(files[0]!.path, files[0]!.body);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value.name).toBe("pr-review-rigor");
    expect(parsed.ok && parsed.value.category).toBe("workflow");
  });

  it("de-duplicates colliding slugs instead of overwriting one row with another", () => {
    expect(buildMigrationFiles("skills", hosted).map((f) => f.path)).toEqual([
      "skills/pr-review-rigor/SKILL.md",
      "skills/pr-review-rigor-2/SKILL.md",
    ]);
    expect(buildMigrationFiles("memory", hosted).map((f) => f.path)).toEqual([
      "memory/semantic/service-naming.md",
      "memory/semantic/service-naming-2.md",
    ]);
  });

  it("writes practices with id/dimension/applies-when the indexer reads back", () => {
    const [file] = buildMigrationFiles("practices", hosted);
    expect(file!.path).toBe("practices/agents-md-contract/PRACTICE.md");
    const parsed = parseRegistryPractice(file!.path, file!.body);
    expect(parsed.ok && parsed.value).toMatchObject({
      practiceId: "agents-md",
      dimension: "D1",
      appliesWhen: "No root AGENTS.md.",
    });
  });

  it("files memory under its kind, normalizing an unrecognized one", () => {
    const files = buildMigrationFiles("memory", hosted);
    const parsed = parseRegistryMemory(files[0]!.path, files[0]!.body);
    expect(parsed.ok && parsed.value).toMatchObject({ kind: "semantic", confidence: 0.8, namespace: "platform" });
    // "not-a-kind" is not a bare-word kind we file under; it lands in semantic/ rather than a stray dir.
    expect(files[1]!.path.startsWith("memory/semantic/")).toBe(true);
  });

  it("uses one stable branch per type so a re-run updates the same PR", () => {
    expect(migrationBranch("skills")).toBe("ascent/registry-migrate-skills");
    expect(migrationBranch("memory")).toBe("ascent/registry-migrate-memory");
  });
});
