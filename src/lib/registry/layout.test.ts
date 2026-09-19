// The scaffold is the ONE thing ascent commits into a repo it does not own, so two properties are
// load-bearing and pinned here: it is DETERMINISTIC (a re-run re-seeds identical bytes, which is what
// makes openDraftPr's branch reuse a no-op diff instead of churn), and its two machine-read files
// round-trip through the parsers that will later read them back out of the customer's repo.

import { describe, expect, it } from "vitest";
import { buildScaffoldFiles, parseFullName, REGISTRY_CATALOG_PATH, REGISTRY_SPINE_PATH } from "./layout";
import { CATALOG_SCHEMA, parseCatalog } from "./catalog";
import { parseRegistryYaml } from "./policy";
import { FIXTURE_REGISTRY_YAML } from "./__fixtures__/registry-tree";

describe("buildScaffoldFiles", () => {
  it("is deterministic — same slug, byte-identical files", () => {
    expect(buildScaffoldFiles("acme")).toEqual(buildScaffoldFiles("acme"));
    expect(JSON.stringify(buildScaffoldFiles("acme"))).toBe(JSON.stringify(buildScaffoldFiles("ACME  ")));
  });

  it("puts the registry.yaml SPINE first (the already-installed collision guard depends on it)", () => {
    expect(buildScaffoldFiles("acme")[0]!.path).toBe(REGISTRY_SPINE_PATH);
  });

  it("seeds the documented layout and nothing else", () => {
    expect(buildScaffoldFiles("acme").map((f) => f.path).sort()).toEqual(
      [
        ".ascent/registry.yaml",
        "CODEOWNERS",
        "README.md",
        "catalog.json",
        "memory/.gitkeep",
        "practices/.gitkeep",
        "skills/.gitkeep",
      ].sort(),
    );
  });

  it("carries no secrets and no timestamps", () => {
    const all = buildScaffoldFiles("acme").map((f) => f.body).join("\n");
    expect(all).not.toMatch(/ghp_|github_pat_|BEGIN [A-Z ]*PRIVATE KEY|askl_/);
    expect(all).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it("emits a registry.yaml its own parser reads back", () => {
    const spine = buildScaffoldFiles("acme").find((f) => f.path === REGISTRY_SPINE_PATH)!;
    const d = parseRegistryYaml(spine.body);
    expect(d).toMatchObject({ registry: 1, canonical: true, mode: "git_native", telemetry: "off" });
    expect(d.policies.categories).toContain("ai-native");
    expect(d.policies.memoryKinds).toEqual(["episodic", "semantic", "procedural", "summary"]);
    expect(d.policies.catalogWrites).toBe("bot");
    expect(d.owners).toEqual([]);
  });

  it("emits the catalog ENVELOPE (not a bare array), empty and with zero counts", () => {
    const file = buildScaffoldFiles("acme").find((f) => f.path === REGISTRY_CATALOG_PATH)!;
    const parsed = parseCatalog(file.body)!;
    expect(parsed.schema).toBe(CATALOG_SCHEMA);
    expect(parsed.generatedAt).toBeNull();
    expect(parsed.registry.fullName).toBe("acme/ai-registry");
    expect(parsed.counts).toEqual({ skills: 0, practices: 0, memory: 0, lessons: 0 });
    expect(parsed.skills).toEqual([]);
  });
});

describe("parseRegistryYaml against the real reference registry's file", () => {
  it("reads xkazm04/ai-registry's declaration exactly", () => {
    const d = parseRegistryYaml(FIXTURE_REGISTRY_YAML);
    expect(d.mode).toBe("git_native");
    expect(d.telemetry).toBe("api");
    expect(d.canonical).toBe(true);
    expect(d.owners).toEqual(["xkazm04"]);
    expect(d.policies.requireVersion).toBe(true);
    expect(d.policies.categories).toEqual(["ci-cd", "testing", "security", "ai-native", "docs", "workflow", "other"]);
  });

  it("degrades to documented defaults rather than throwing on garbage", () => {
    const d = parseRegistryYaml("::: not yaml :::\n\t\x00");
    expect(d.mode).toBe("git_native");
    expect(d.telemetry).toBe("off");
    expect(d.policies.categories.length).toBeGreaterThan(0);
  });
});

describe("parseFullName", () => {
  it.each(["acme/ai-registry", "a/b", "Acme-Co/ai_registry.v2"])("accepts %s", (s) => {
    expect(parseFullName(s)).not.toBeNull();
  });
  it.each(["", "acme", "acme/", "/repo", "acme/repo/extra", "../../etc/passwd", "acme/re po"])(
    "rejects %s",
    (s) => {
      expect(parseFullName(s)).toBeNull();
    },
  );
});
